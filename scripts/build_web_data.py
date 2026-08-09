"""Build the static JSON dataset that powers the Fantasy Analyzer web app.

Reads the Lahman / Chadwick Bureau Baseball Databank (every MLB player-season
from 1871 onward), applies THIS LEAGUE's scoring rules -- imported from
``fantasy_baseball.config`` so the website and the CLI can never disagree about
what a home run is worth -- and writes a sharded, compact JSON dataset to
``web/data/``.

Data source
-----------
The databank is distributed on PyPI inside the ``pylahman`` wheel as parquet
files. We download the wheel and read the parquet payload directly rather than
installing the package (it requires a newer Python than we build under, and we
only want its data). PyPI is used because ``statsapi.mlb.com`` and GitHub raw
downloads are not reachable from every build environment.

Usage
-----
    python scripts/build_web_data.py                   # download, then build
    python scripts/build_web_data.py --lahman-dir DIR  # use extracted parquet
    python scripts/build_web_data.py --out web/data

Outputs (all under --out)
-------------------------
    meta.json              build info, scoring rules, coverage caveats
    search.json            columnar search index over every player
    players/<n>.json       256 shards of full player records, keyed id % 256
    lb_career_batting.json / lb_career_pitching.json
    lb_season_batting.json / lb_season_pitching.json
    percentiles.json       percentile breakpoints for the Savant-style bars

Leaderboard rows carry a numeric player id, not a name -- the client already
holds every name in search.json, so repeating them would inflate the payload
for nothing.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import math
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_baseball.config import (  # noqa: E402
    BATTING_SCORING,
    LEAGUE_SIZE,
    LEAGUE_TYPE,
    PITCHING_SCORING,
    ROSTER_SLOTS,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_web_data")

PYPI_JSON = "https://pypi.org/pypi/pylahman/json"
SHARD_COUNT = 256

# Scoring categories the historical databank does not carry at all. Surfaced
# in the UI rather than silently scored as zero.
UNSUPPORTED_BATTING = ["CYCLE", "GRAND_SLAM"]
UNSUPPORTED_PITCHING = ["HLD", "BS", "QS", "NO_HITTER", "PERFECT_GAME"]

# Qualifying thresholds for percentile bars and rate leaderboards. Deliberately
# below the modern 502-PA batting-title cutoff so 19th-century and part-season
# players are not all discarded, but high enough that a three-game cup of
# coffee cannot top a rate board.
QUAL_SEASON_PA = 300
QUAL_SEASON_IP = 60
QUAL_CAREER_PA = 1500
QUAL_CAREER_IP = 400

POS_COLUMNS = [
    ("G_c", "C"), ("G_1b", "1B"), ("G_2b", "2B"), ("G_3b", "3B"),
    ("G_ss", "SS"), ("G_of", "OF"), ("G_dh", "DH"), ("G_p", "P"),
]

AWARD_MAP = {
    "Most Valuable Player": "MVP",
    "Cy Young Award": "CY",
    "Rookie of the Year": "ROY",
    "Gold Glove": "GG",
    "Silver Slugger": "SS",
    "Triple Crown": "TC",
}

# Lahman names two columns "2B"/"3B", which are not valid Python identifiers --
# renamed up front so named aggregation and itertuples both stay readable.
RENAME = {"2B": "D2", "3B": "D3"}

BAT_COUNTING = ["G", "AB", "R", "H", "D2", "D3", "HR", "RBI", "SB", "CS", "BB",
                "SO", "IBB", "HBP", "SH", "SF"]
PIT_COUNTING = ["W", "L", "G", "GS", "CG", "SHO", "SV", "IPouts", "H", "ER",
                "HR", "BB", "SO"]


# --------------------------------------------------------------------------
# Source data
# --------------------------------------------------------------------------
def download_lahman(cache_dir: Path) -> Path:
    """Download and extract the pylahman wheel's parquet payload. Cached."""
    data_dir = cache_dir / "pylahman" / "data"
    if (data_dir / "Batting.parquet").exists():
        logger.info("Using cached Lahman parquet at %s", data_dir)
        return data_dir

    cache_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Resolving latest pylahman release from PyPI")
    with urllib.request.urlopen(PYPI_JSON, timeout=60) as resp:
        info = json.load(resp)
    version = info["info"]["version"]
    url = next(u["url"] for u in info["releases"][version]
               if u["filename"].endswith(".whl"))
    logger.info("Downloading %s", url)
    with urllib.request.urlopen(url, timeout=300) as resp:
        blob = resp.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        members = [n for n in z.namelist() if n.startswith("pylahman/data/")]
        z.extractall(cache_dir, members=members)
    logger.info("Extracted %d parquet tables (pylahman %s)", len(members), version)
    return data_dir


def load(data_dir: Path, table: str) -> pd.DataFrame:
    return pd.read_parquet(data_dir / f"{table}.parquet").rename(columns=RENAME)


def num(df: pd.DataFrame, col: str) -> pd.Series:
    """Numeric column, missing-safe. Lahman leaves early-era stats null."""
    if col not in df.columns:
        return pd.Series(0.0, index=df.index)
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0)


# --------------------------------------------------------------------------
# Scoring -- weights come from fantasy_baseball.config, never hardcoded here
# --------------------------------------------------------------------------
def score_batting(df: pd.DataFrame) -> pd.Series:
    singles = num(df, "H") - num(df, "D2") - num(df, "D3") - num(df, "HR")
    contributions = {
        "R": num(df, "R"), "1B": singles, "2B": num(df, "D2"),
        "3B": num(df, "D3"), "HR": num(df, "HR"), "RBI": num(df, "RBI"),
        "SB": num(df, "SB"), "BB": num(df, "BB"), "IBB": num(df, "IBB"),
        "HBP": num(df, "HBP"),
    }
    points = pd.Series(0.0, index=df.index)
    for category, weight in BATTING_SCORING.items():
        if category in contributions:
            points += weight * contributions[category]
    return points


def score_pitching(df: pd.DataFrame) -> pd.Series:
    contributions = {
        "IP": num(df, "IPouts") / 3.0, "W": num(df, "W"), "L": num(df, "L"),
        "CG": num(df, "CG"), "SHO": num(df, "SHO"), "SV": num(df, "SV"),
        "ER": num(df, "ER"), "K": num(df, "SO"),
    }
    points = pd.Series(0.0, index=df.index)
    for category, weight in PITCHING_SCORING.items():
        if category in contributions:
            points += weight * contributions[category]
    return points


def r1(x) -> float | int:
    """Round to 1dp, collapsing to int when exact -- shrinks the JSON a lot."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


def i0(x) -> int:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0
    return int(round(float(x)))


def opt(x):
    """1dp value, or None when undefined (era adjustment for a non-qualifier)."""
    return None if x is None or pd.isna(x) else r1(x)


def txt(x) -> str:
    """String field, missing-safe.

    Lahman leaves lgID null for 1871-1875 and POS null for players who never
    took the field. Those arrive as float NaN, and `NaN or ""` keeps the NaN
    because NaN is truthy -- which json.dumps then happily writes as a bare
    `NaN` literal that no JSON parser will accept.
    """
    return x if isinstance(x, str) else ""


def dump(path: Path, payload) -> None:
    """Write compact JSON, refusing NaN/Infinity rather than emitting invalid
    JSON that only fails later, in the browser."""
    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------
def combine_stints(df: pd.DataFrame, counting: list[str]) -> pd.DataFrame:
    """One row per player-season. Traded players have several Lahman rows."""
    for c in counting:
        df[c] = num(df, c)
    agg = {c: "sum" for c in counting}
    agg["teamID"] = lambda s: "/".join(dict.fromkeys(s))
    agg["lgID"] = "first"
    return df.groupby(["playerID", "yearID"], as_index=False).agg(agg)


def build_batting(data_dir: Path) -> pd.DataFrame:
    bat = load(data_dir, "Batting")
    for c in BAT_COUNTING:
        bat[c] = num(bat, c)
    # PA is not a Lahman column; reconstruct it. Catcher's interference is not
    # carried by the databank, so this is off by at most a handful per career.
    bat["PA"] = bat["AB"] + bat["BB"] + bat["HBP"] + bat["SH"] + bat["SF"]
    bat["PTS"] = score_batting(bat)
    return combine_stints(bat, BAT_COUNTING + ["PA", "PTS"])


def build_pitching(data_dir: Path) -> pd.DataFrame:
    pit = load(data_dir, "Pitching")
    pit["PTS"] = score_pitching(pit)
    out = combine_stints(pit, PIT_COUNTING + ["PTS"])
    out["IP"] = out["IPouts"] / 3.0
    out["ERA"] = np.where(out["IPouts"] > 0, out["ER"] * 27.0 / out["IPouts"], 0.0)
    return out


def season_positions(data_dir: Path) -> pd.DataFrame:
    """Primary position per player-season, by games played at each spot."""
    app = load(data_dir, "Appearances")
    cols = [c for c, _ in POS_COLUMNS if c in app.columns]
    for c in cols:
        app[c] = num(app, c)
    grouped = app.groupby(["playerID", "yearID"], as_index=False)[cols].sum()
    labels = dict(POS_COLUMNS)
    values = grouped[cols].values
    best, played = values.argmax(axis=1), values.max(axis=1)
    grouped["POS"] = [labels[cols[b]] if p > 0 else "" for b, p in zip(best, played)]
    return grouped[["playerID", "yearID", "POS"]]


def era_adjust(df: pd.DataFrame, denom: str, qual: float) -> pd.Series:
    """PTS+ : points per opportunity vs. that season's league average (100).

    This is what makes 1927 and 2023 comparable at all -- raw point totals are
    hostage to schedule length, run environment, and how many innings a
    starter was expected to throw. Only qualified players set the baseline.
    """
    qualified = df[df[denom] >= qual]
    league = qualified.groupby("yearID").apply(
        lambda g: g["PTS"].sum() / g[denom].sum() if g[denom].sum() else np.nan,
        include_groups=False,
    )
    league_rate = df["yearID"].map(league)
    own_rate = np.where(df[denom] > 0, df["PTS"] / df[denom].replace(0, np.nan), np.nan)
    return pd.Series(100.0 * own_rate / league_rate, index=df.index).replace(
        [np.inf, -np.inf], np.nan
    )


def career_totals(df: pd.DataFrame, counting: list[str]) -> pd.DataFrame:
    named = {c: (c, "sum") for c in counting}
    named.update(
        yr_min=("yearID", "min"), yr_max=("yearID", "max"), yr_n=("yearID", "count")
    )
    return df.groupby("playerID").agg(**named)


def percentile_breaks(values: np.ndarray) -> list:
    """101 breakpoints so the client can percentile-rank any value cheaply."""
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) == 0:
        return [0] * 101
    return [r1(v) for v in np.percentile(values, np.arange(0, 101))]


def top_pool(df: pd.DataFrame, key: str, top_global: int, per_year: int,
             per_team: int) -> pd.DataFrame:
    """Global top N, unioned with the best of every season and every club.

    Without the per-year and per-team unions, filtering the board to 1908 or to
    the Padres would silently show only whichever rows happened to clear a
    global cutoff -- the filter would look broken rather than sparse.
    """
    ordered = df.sort_values(key, ascending=False)
    picks = [ordered.head(top_global)]
    if per_year:
        picks.append(ordered.groupby("yearID").head(per_year))
    if per_team:
        picks.append(ordered.groupby("teamID").head(per_team))
    merged = pd.concat(picks, ignore_index=True)
    return merged.drop_duplicates(subset=["playerID", "yearID"]).sort_values(
        key, ascending=False
    )


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Build the web dataset.")
    parser.add_argument("--out", default="web/data")
    parser.add_argument("--lahman-dir", default=None,
                        help="directory of already-extracted Lahman parquet")
    parser.add_argument("--cache", default=".cache/lahman")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    out = Path(args.out) if os.path.isabs(args.out) else root / args.out
    out.mkdir(parents=True, exist_ok=True)
    data_dir = (Path(args.lahman_dir) if args.lahman_dir
                else download_lahman(root / args.cache))

    logger.info("Loading databank tables")
    people = load(data_dir, "People")
    teams = load(data_dir, "Teams")
    bat = build_batting(data_dir)
    pit = build_pitching(data_dir)

    bat = bat.merge(season_positions(data_dir), on=["playerID", "yearID"], how="left")
    bat["POS"] = bat["POS"].fillna("")
    logger.info("Scored %d batting seasons, %d pitching seasons", len(bat), len(pit))

    bat["PTS_PLUS"] = era_adjust(bat, "PA", QUAL_SEASON_PA)
    pit["PTS_PLUS"] = era_adjust(pit, "IP", QUAL_SEASON_IP)
    bat["PTS_G"] = np.where(bat["G"] > 0, bat["PTS"] / bat["G"], 0.0)
    pit["PTS_G"] = np.where(pit["G"] > 0, pit["PTS"] / pit["G"], 0.0)

    # --- identity ----------------------------------------------------------
    hof = load(data_dir, "HallOfFame")
    hof_players = (
        hof[(hof["inducted"] == "Y") & (hof["category"] == "Player")]
        .set_index("playerID")["yearid"].to_dict()
    )
    awards = load(data_dir, "AwardsPlayers")
    awards = awards[awards["awardID"].isin(AWARD_MAP)]
    award_counts: dict[str, dict[str, int]] = {}
    for player_id, award_id in zip(awards["playerID"], awards["awardID"]):
        counts = award_counts.setdefault(player_id, {})
        key = AWARD_MAP[award_id]
        counts[key] = counts.get(key, 0) + 1

    people = people.copy()
    people["Name"] = (
        people["nameFirst"].fillna("") + " " + people["nameLast"].fillna("")
    ).str.strip()
    played = set(bat["playerID"]) | set(pit["playerID"])
    people = (people[people["playerID"].isin(played)]
              .sort_values("playerID").reset_index(drop=True))
    people["nid"] = np.arange(len(people))
    nid = dict(zip(people["playerID"], people["nid"]))
    logger.info("%d players with major-league playing time", len(people))

    # --- career totals -----------------------------------------------------
    cb = career_totals(bat, BAT_COUNTING + ["PA", "PTS"])
    cp = career_totals(pit, PIT_COUNTING + ["PTS"])
    cp["IP"] = cp["IPouts"] / 3.0
    cp["ERA"] = np.where(cp["IPouts"] > 0, cp["ER"] * 27.0 / cp["IPouts"], 0.0)
    cb_rec = cb.to_dict("index")
    cp_rec = cp.to_dict("index")

    career_pos = (
        bat[bat["POS"] != ""].groupby(["playerID", "POS"])["G"].sum()
        .reset_index().sort_values("G").groupby("playerID").last()["POS"].to_dict()
    )

    # --- player shards -----------------------------------------------------
    shards: dict[int, dict] = {i: {} for i in range(SHARD_COUNT)}
    bat_by_player = dict(tuple(bat.sort_values("yearID").groupby("playerID")))
    pit_by_player = dict(tuple(pit.sort_values("yearID").groupby("playerID")))

    for row in people.itertuples(index=False):
        pid, n = row.playerID, int(row.nid)
        rec: dict = {
            "i": n, "p": pid, "n": row.Name,
            "b": row.bats if isinstance(row.bats, str) else "",
            "t": row.throws if isinstance(row.throws, str) else "",
            "by": i0(row.birthYear) or None,
            "bc": row.birthCountry if isinstance(row.birthCountry, str) else "",
            "bs": row.birthState if isinstance(row.birthState, str) else "",
            "bt": row.birthCity if isinstance(row.birthCity, str) else "",
            "dbt": row.debut if isinstance(row.debut, str) else "",
            "fin": row.finalGame if isinstance(row.finalGame, str) else "",
            "ht": i0(row.height) or None, "wt": i0(row.weight) or None,
            "br": row.bbrefID if isinstance(row.bbrefID, str) else "",
            "pos": career_pos.get(pid, ""),
        }
        if pid in hof_players:
            rec["hof"] = i0(hof_players[pid])
        if pid in award_counts:
            rec["aw"] = award_counts[pid]

        if pid in bat_by_player:
            rec["bat"] = [
                [i0(r.yearID), txt(r.teamID), txt(r.lgID), txt(r.POS), i0(r.G),
                 i0(r.PA), i0(r.AB), i0(r.R), i0(r.H), i0(r.D2), i0(r.D3),
                 i0(r.HR), i0(r.RBI), i0(r.SB), i0(r.CS), i0(r.BB), i0(r.IBB),
                 i0(r.HBP), i0(r.SO), r1(r.PTS), opt(r.PTS_PLUS)]
                for r in bat_by_player[pid].itertuples(index=False)
            ]
            c = cb_rec[pid]
            rec["cb"] = [
                i0(c["G"]), i0(c["PA"]), i0(c["AB"]), i0(c["R"]), i0(c["H"]),
                i0(c["D2"]), i0(c["D3"]), i0(c["HR"]), i0(c["RBI"]), i0(c["SB"]),
                i0(c["CS"]), i0(c["BB"]), i0(c["IBB"]), i0(c["HBP"]), i0(c["SO"]),
                r1(c["PTS"]), i0(c["yr_min"]), i0(c["yr_max"]), i0(c["yr_n"]),
            ]
        if pid in pit_by_player:
            rec["pit"] = [
                [i0(r.yearID), txt(r.teamID), txt(r.lgID), i0(r.W), i0(r.L), i0(r.G),
                 i0(r.GS), i0(r.CG), i0(r.SHO), i0(r.SV), i0(r.IPouts), i0(r.H),
                 i0(r.ER), i0(r.HR), i0(r.BB), i0(r.SO), r1(r.ERA), r1(r.PTS),
                 opt(r.PTS_PLUS)]
                for r in pit_by_player[pid].itertuples(index=False)
            ]
            c = cp_rec[pid]
            rec["cp"] = [
                i0(c["W"]), i0(c["L"]), i0(c["G"]), i0(c["GS"]), i0(c["CG"]),
                i0(c["SHO"]), i0(c["SV"]), i0(c["IPouts"]), i0(c["H"]), i0(c["ER"]),
                i0(c["HR"]), i0(c["BB"]), i0(c["SO"]), r1(c["ERA"]), r1(c["PTS"]),
                i0(c["yr_min"]), i0(c["yr_max"]), i0(c["yr_n"]),
            ]
        shards[n % SHARD_COUNT][str(n)] = rec

    shard_dir = out / "players"
    if shard_dir.exists():
        shutil.rmtree(shard_dir)
    shard_dir.mkdir(parents=True, exist_ok=True)
    for idx, payload in shards.items():
        dump(shard_dir / f"{idx}.json", payload)
    logger.info("Wrote %d player shards", SHARD_COUNT)

    # --- search index (columnar: one array per field, aligned by position) --
    index: dict[str, list] = {k: [] for k in
                             ("ids", "names", "y0", "y1", "pos", "bp", "pp", "hof")}
    for row in people.itertuples(index=False):
        pid, n = row.playerID, int(row.nid)
        b, p = cb_rec.get(pid), cp_rec.get(pid)
        years = ([i0(b["yr_min"]), i0(b["yr_max"])] if b else []) + \
                ([i0(p["yr_min"]), i0(p["yr_max"])] if p else [])
        index["ids"].append(n)
        index["names"].append(row.Name)
        index["y0"].append(min(years) if years else 0)
        index["y1"].append(max(years) if years else 0)
        index["pos"].append(career_pos.get(pid, "") or ("P" if p else ""))
        index["bp"].append(r1(b["PTS"]) if b else 0)
        index["pp"].append(r1(p["PTS"]) if p else 0)
        index["hof"].append(1 if pid in hof_players else 0)
    index["shards"] = SHARD_COUNT
    dump(out / "search.json", index)
    logger.info("Wrote search index (%d players)", len(index["ids"]))

    # --- leaderboards ------------------------------------------------------
    bat["nid"] = bat["playerID"].map(nid)
    pit["nid"] = pit["playerID"].map(nid)

    season_bat = top_pool(bat, "PTS", 7000, 40, 30)
    dump(out / "lb_season_batting.json", {
        "cols": ["id", "year", "team", "lg", "pos", "G", "PA", "HR", "R", "RBI",
                 "SB", "BB", "pts", "ptsg", "ptsplus"],
        "rows": [[i0(r.nid), i0(r.yearID), txt(r.teamID), txt(r.lgID), txt(r.POS),
                  i0(r.G), i0(r.PA), i0(r.HR), i0(r.R), i0(r.RBI), i0(r.SB),
                  i0(r.BB), r1(r.PTS), round(r.PTS_G, 2), opt(r.PTS_PLUS)]
                 for r in season_bat.itertuples(index=False)],
    })

    season_pit = top_pool(pit, "PTS", 7000, 40, 30)
    dump(out / "lb_season_pitching.json", {
        "cols": ["id", "year", "team", "lg", "G", "GS", "W", "L", "SV", "IP",
                 "SO", "ERA", "pts", "ptsg", "ptsplus"],
        "rows": [[i0(r.nid), i0(r.yearID), txt(r.teamID), txt(r.lgID), i0(r.G),
                  i0(r.GS), i0(r.W), i0(r.L), i0(r.SV), r1(r.IP), i0(r.SO),
                  r1(r.ERA), r1(r.PTS), round(r.PTS_G, 2), opt(r.PTS_PLUS)]
                 for r in season_pit.itertuples(index=False)],
    })

    # Career boards: anyone who cleared a token amount of playing time.
    cbf = cb[(cb["PA"] >= 100) | (cb["PTS"] >= 50)]
    cpf = cp[(cp["IPouts"] >= 90) | (cp["PTS"] >= 50)]
    dump(out / "lb_career_batting.json", {
        "cols": ["id", "year0", "year1", "seasons", "G", "PA", "HR", "R", "RBI",
                 "SB", "BB", "pts", "ptsg", "ptspa"],
        "rows": [[i0(nid[pid]), i0(r["yr_min"]), i0(r["yr_max"]), i0(r["yr_n"]),
                  i0(r["G"]), i0(r["PA"]), i0(r["HR"]), i0(r["R"]), i0(r["RBI"]),
                  i0(r["SB"]), i0(r["BB"]), r1(r["PTS"]),
                  round(r["PTS"] / r["G"], 2) if r["G"] else 0,
                  round(r["PTS"] / r["PA"], 3) if r["PA"] else 0]
                 for pid, r in cbf.sort_values("PTS", ascending=False).iterrows()],
    })
    dump(out / "lb_career_pitching.json", {
        "cols": ["id", "year0", "year1", "seasons", "G", "GS", "W", "L", "SV",
                 "IP", "SO", "ERA", "pts", "ptsg", "ptsip"],
        "rows": [[i0(nid[pid]), i0(r["yr_min"]), i0(r["yr_max"]), i0(r["yr_n"]),
                  i0(r["G"]), i0(r["GS"]), i0(r["W"]), i0(r["L"]), i0(r["SV"]),
                  r1(r["IP"]), i0(r["SO"]), r1(r["ERA"]), r1(r["PTS"]),
                  round(r["PTS"] / r["G"], 2) if r["G"] else 0,
                  round(r["PTS"] / r["IP"], 3) if r["IP"] else 0]
                 for pid, r in cpf.sort_values("PTS", ascending=False).iterrows()],
    })
    logger.info("Wrote leaderboards")

    # --- percentile breakpoints for the Savant-style bars ------------------
    qb = bat[bat["PA"] >= QUAL_SEASON_PA]
    qp = pit[pit["IP"] >= QUAL_SEASON_IP]
    qcb = cb[cb["PA"] >= QUAL_CAREER_PA]
    qcp = cp[cp["IP"] >= QUAL_CAREER_IP]

    def rate(df: pd.DataFrame, numer: str, denom: str) -> np.ndarray:
        return (df[numer] / df[denom].replace(0, np.nan)).values

    dump(out / "percentiles.json", {
        "season_batting": {
            "pts": percentile_breaks(qb["PTS"].values),
            "ptsg": percentile_breaks(rate(qb, "PTS", "G")),
            "ptspa": percentile_breaks(rate(qb, "PTS", "PA")),
            "ptsplus": percentile_breaks(qb["PTS_PLUS"].values),
            "HR": percentile_breaks(qb["HR"].values),
            "R": percentile_breaks(qb["R"].values),
            "RBI": percentile_breaks(qb["RBI"].values),
            "SB": percentile_breaks(qb["SB"].values),
            "BB": percentile_breaks(qb["BB"].values),
        },
        "season_pitching": {
            "pts": percentile_breaks(qp["PTS"].values),
            "ptsg": percentile_breaks(rate(qp, "PTS", "G")),
            "ptsip": percentile_breaks(rate(qp, "PTS", "IP")),
            "ptsplus": percentile_breaks(qp["PTS_PLUS"].values),
            "SO": percentile_breaks(qp["SO"].values),
            "W": percentile_breaks(qp["W"].values),
            "SV": percentile_breaks(qp["SV"].values),
            "IP": percentile_breaks(qp["IP"].values),
        },
        "career_batting": {
            "pts": percentile_breaks(qcb["PTS"].values),
            "ptsg": percentile_breaks(rate(qcb, "PTS", "G")),
            "ptspa": percentile_breaks(rate(qcb, "PTS", "PA")),
        },
        "career_pitching": {
            "pts": percentile_breaks(qcp["PTS"].values),
            "ptsg": percentile_breaks(rate(qcp, "PTS", "G")),
            "ptsip": percentile_breaks(rate(qcp, "PTS", "IP")),
        },
    })

    # --- metadata ----------------------------------------------------------
    team_info = (teams.sort_values("yearID").groupby("teamID")
                 .agg(name=("name", "last"), franch=("franchID", "last"))
                 .to_dict("index"))
    year_min = int(min(bat["yearID"].min(), pit["yearID"].min()))
    year_max = int(max(bat["yearID"].max(), pit["yearID"].max()))
    dump(out / "meta.json", {
        "built": pd.Timestamp.now("UTC").strftime("%Y-%m-%d"),
        "source": "Lahman / Chadwick Bureau Baseball Databank (via pylahman)",
        "seasons": [year_min, year_max],
        "players": int(len(people)),
        "batting_seasons": int(len(bat)),
        "pitching_seasons": int(len(pit)),
        "league": {"size": LEAGUE_SIZE, "type": LEAGUE_TYPE, "roster": ROSTER_SLOTS},
        "batting_scoring": BATTING_SCORING,
        "pitching_scoring": PITCHING_SCORING,
        "unsupported_batting": UNSUPPORTED_BATTING,
        "unsupported_pitching": UNSUPPORTED_PITCHING,
        "qualifiers": {"season_pa": QUAL_SEASON_PA, "season_ip": QUAL_SEASON_IP,
                       "career_pa": QUAL_CAREER_PA, "career_ip": QUAL_CAREER_IP},
        "teams": {k: v["name"] for k, v in team_info.items()},
        "franchises": {k: v["franch"] for k, v in team_info.items()},
        "shards": SHARD_COUNT,
    })

    files = list(out.rglob("*.json"))
    logger.info("Done. %s -> %.1f MB across %d files", out,
                sum(f.stat().st_size for f in files) / 1e6, len(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
