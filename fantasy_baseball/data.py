"""Data fetchers for MLB season stats (MLB Stats API) and Statcast metrics
(Baseball Savant, via pybaseball).

MLB Stats API (statsapi.mlb.com) is used for season batting/pitching totals
instead of scraping FanGraphs: it's a stable, documented, no-auth JSON API and
gives us primary position + team in the same trip. pybaseball is used for the
Statcast leaderboards (xwOBA, barrel%, hard-hit%, xERA) since it already wraps
Baseball Savant's CSV leaderboard endpoints.

NOTE ON UNVERIFIED FIELDS: this module was written without live network
access to statsapi.mlb.com / baseballsavant.mlb.com (blocked by the sandbox's
egress policy at write time). Field names below reflect the documented/known
MLB Stats API and Baseball Savant schemas, but should be re-checked against
`scripts/fetch_sample.py` output the first time this runs with network
access -- see README "Verifying the pipeline".
"""
from __future__ import annotations

import logging
import time
from typing import Iterable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

STATSAPI_BASE = "https://statsapi.mlb.com/api/v1"
SPORT_ID_MLB = 1

_session = requests.Session()
_session.headers.update({"User-Agent": "fantasy-baseball-assistant/0.1"})


def _get_json(path: str, params: dict | None = None, retries: int = 3, timeout: int = 20) -> dict:
    url = f"{STATSAPI_BASE}{path}"
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning("Request to %s failed (attempt %d/%d): %s", url, attempt, retries, exc)
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts") from last_exc


def _parse_innings_pitched(ip_str) -> float:
    """Convert MLB's '182.1' notation (182 innings + 1 out) to a true float."""
    if ip_str is None or ip_str == "":
        return 0.0
    ip_str = str(ip_str)
    whole, _, frac_outs = ip_str.partition(".")
    whole = int(whole) if whole not in ("", "-") else 0
    frac_outs = int(frac_outs) if frac_outs else 0
    return whole + frac_outs / 3.0


def fetch_player_positions(season: int) -> pd.DataFrame:
    """Primary position + team for every player active in `season`."""
    data = _get_json("/sports/1/players", {"season": season})
    rows = []
    for p in data.get("people", []):
        rows.append(
            {
                "player_id": p.get("id"),
                "Name": p.get("fullName"),
                "Team": (p.get("currentTeam") or {}).get("name"),
                "TeamAbbrev": (p.get("currentTeam") or {}).get("abbreviation"),
                "Pos": (p.get("primaryPosition") or {}).get("abbreviation"),
            }
        )
    return pd.DataFrame(rows)


def fetch_batting_stats(season: int, positions: pd.DataFrame | None = None) -> pd.DataFrame:
    """Season batting totals for all hitters, canonical column names.

    Returns columns: player_id, Name, Team, Pos, G, PA, AB, R, H, 2B, 3B, HR,
    RBI, SB, CS, BB, IBB, HBP, SO
    """
    data = _get_json(
        "/stats",
        {
            "stats": "season",
            "group": "hitting",
            "season": season,
            "sportId": SPORT_ID_MLB,
            "limit": 3000,
            "playerPool": "ALL",
            "gameType": "R",
        },
    )
    rows = []
    for stat_block in data.get("stats", []):
        for split in stat_block.get("splits", []):
            s = split.get("stat", {})
            player = split.get("player", {})
            team = split.get("team", {})
            rows.append(
                {
                    "player_id": player.get("id"),
                    "Name": player.get("fullName"),
                    "Team": team.get("name"),
                    "G": s.get("gamesPlayed", 0),
                    "PA": s.get("plateAppearances", 0),
                    "AB": s.get("atBats", 0),
                    "R": s.get("runs", 0),
                    "H": s.get("hits", 0),
                    "2B": s.get("doubles", 0),
                    "3B": s.get("triples", 0),
                    "HR": s.get("homeRuns", 0),
                    "RBI": s.get("rbi", 0),
                    "SB": s.get("stolenBases", 0),
                    "CS": s.get("caughtStealing", 0),
                    "BB": s.get("baseOnBalls", 0),
                    "IBB": s.get("intentionalWalks", 0),
                    "HBP": s.get("hitByPitch", 0),
                    "SO": s.get("strikeOuts", 0),
                }
            )
    df = pd.DataFrame(rows)
    if positions is not None and not df.empty:
        df = df.merge(positions[["player_id", "Pos"]], on="player_id", how="left")
    return df


def fetch_pitching_stats(season: int, positions: pd.DataFrame | None = None) -> pd.DataFrame:
    """Season pitching totals for all pitchers, canonical column names.

    Returns columns: player_id, Name, Team, Pos, Role, G, GS, IP, W, L, CG,
    SHO, SV, BS, HLD, ER, K, BB, H, QS (QS may be NaN -- see below).

    `qualityStarts` is not guaranteed to be present on the bulk MLB Stats API
    season endpoint. If it's missing for every row, QS is left as NaN and a
    warning is logged; use `fetch_quality_starts_from_gamelogs` for an exact
    (but much slower, per-pitcher) count.
    """
    data = _get_json(
        "/stats",
        {
            "stats": "season",
            "group": "pitching",
            "season": season,
            "sportId": SPORT_ID_MLB,
            "limit": 3000,
            "playerPool": "ALL",
            "gameType": "R",
        },
    )
    rows = []
    for stat_block in data.get("stats", []):
        for split in stat_block.get("splits", []):
            s = split.get("stat", {})
            player = split.get("player", {})
            team = split.get("team", {})
            g = s.get("gamesPlayed", 0) or 0
            gs = s.get("gamesStarted", 0) or 0
            rows.append(
                {
                    "player_id": player.get("id"),
                    "Name": player.get("fullName"),
                    "Team": team.get("name"),
                    "G": g,
                    "GS": gs,
                    "Role": "SP" if g and gs / g >= 0.5 else "RP",
                    "IP": _parse_innings_pitched(s.get("inningsPitched")),
                    "W": s.get("wins", 0),
                    "L": s.get("losses", 0),
                    "CG": s.get("completeGames", 0),
                    "SHO": s.get("shutouts", 0),
                    "SV": s.get("saves", 0),
                    "BS": s.get("blownSaves", 0),
                    "HLD": s.get("holds", 0),
                    "ER": s.get("earnedRuns", 0),
                    "K": s.get("strikeOuts", 0),
                    "BB": s.get("baseOnBalls", 0),
                    "H": s.get("hits", 0),
                    "QS": s.get("qualityStarts"),
                }
            )
    df = pd.DataFrame(rows)
    if not df.empty and df["QS"].isna().all():
        logger.warning(
            "Quality Starts not present on the bulk pitching endpoint for season %s; "
            "QS will score as 0 unless you run fetch_quality_starts_from_gamelogs().",
            season,
        )
    if positions is not None and not df.empty:
        df = df.merge(positions[["player_id", "Pos"]], on="player_id", how="left")
    return df


def fetch_quality_starts_from_gamelogs(season: int, player_ids: Iterable[int]) -> pd.DataFrame:
    """Exact Quality Start counts (IP >= 6 and ER <= 3) via per-pitcher game logs.

    One API call per player_id -- slow for the full league (~600+ pitchers).
    Prefer scoping `player_ids` to players you actually roster/are considering.
    """
    rows = []
    for pid in player_ids:
        data = _get_json(f"/people/{pid}/stats", {"stats": "gameLog", "group": "pitching", "season": season})
        qs = 0
        for stat_block in data.get("stats", []):
            for split in stat_block.get("splits", []):
                s = split.get("stat", {})
                ip = _parse_innings_pitched(s.get("inningsPitched"))
                er = s.get("earnedRuns", 0) or 0
                if ip >= 6 and er <= 3:
                    qs += 1
        rows.append({"player_id": pid, "QS": qs})
    return pd.DataFrame(rows)


# --- Statcast (Baseball Savant, via pybaseball) ------------------------------

# Alias candidates for each metric we want, in priority order. Baseball
# Savant / pybaseball column names have shifted across versions, so we search
# for the first match rather than hardcoding one name.
_BATTER_STATCAST_ALIASES = {
    "player_id": ["player_id"],
    "xwOBA": ["est_woba", "xwoba", "est_woba_using_speedangle"],
    "wOBA": ["woba", "woba_using_speedangle"],
    "xBA": ["est_ba", "xba"],
    "xSLG": ["est_slg", "xslg"],
    "barrel_pct": ["brl_percent", "barrel_batted_rate"],
    "hard_hit_pct": ["ev95percent", "hard_hit_percent"],
    "avg_exit_velo": ["avg_hit_speed", "exit_velocity_avg"],
    "avg_launch_angle": ["avg_hit_angle", "launch_angle_avg"],
    "sweet_spot_pct": ["anglesweetspotpercent", "sweet_spot_percent"],
}

_PITCHER_STATCAST_ALIASES = {
    "player_id": ["player_id"],
    "xERA": ["era", "xera", "est_era"],
    "xwOBA_against": ["est_woba", "xwoba"],
    "barrel_pct_against": ["brl_percent", "barrel_batted_rate"],
    "hard_hit_pct_against": ["ev95percent", "hard_hit_percent"],
    "avg_exit_velo_against": ["avg_hit_speed", "exit_velocity_avg"],
}


def _apply_aliases(df: pd.DataFrame, alias_map: dict) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    unmatched = []
    for canonical, candidates in alias_map.items():
        match = next((c for c in candidates if c in df.columns), None)
        if match:
            out[canonical] = df[match]
        else:
            unmatched.append(canonical)
    if unmatched:
        logger.warning(
            "Statcast column(s) not found, left out of output: %s. Actual columns were: %s",
            unmatched,
            list(df.columns),
        )
    return out


def fetch_statcast_batter_metrics(season: int, min_pa: int = 100) -> pd.DataFrame:
    """xwOBA, barrel%, hard-hit%, etc. from Baseball Savant, keyed by player_id."""
    import pybaseball as pb

    expected = pb.statcast_batter_expected_stats(season, minPA=min_pa)
    exitvelo = pb.statcast_batter_exitvelo_barrels(season, minBBE=min_pa)
    merge_key = "player_id" if "player_id" in expected.columns else expected.columns[1]
    merged = expected.merge(exitvelo, on=merge_key, suffixes=("", "_ev"), how="outer")
    return _apply_aliases(merged, _BATTER_STATCAST_ALIASES)


def fetch_statcast_pitcher_metrics(season: int, min_pa: int = 50) -> pd.DataFrame:
    """xERA, barrel%/hard-hit% against, etc. from Baseball Savant, keyed by player_id."""
    import pybaseball as pb

    expected = pb.statcast_pitcher_expected_stats(season, minPA=min_pa)
    exitvelo = pb.statcast_pitcher_exitvelo_barrels(season, minBBE=min_pa)
    merge_key = "player_id" if "player_id" in expected.columns else expected.columns[1]
    merged = expected.merge(exitvelo, on=merge_key, suffixes=("", "_ev"), how="outer")
    return _apply_aliases(merged, _PITCHER_STATCAST_ALIASES)
