"""Build the NFL and NBA datasets in the same shape as the baseball one.

Sources, both public and both reachable without a key:

  NFL   nflverse-data `player_stats` release (github.com/nflverse/nflverse-data)
        Weekly offensive player stats, 1999-2024, aggregated to seasons here.
  NBA   hoopR / sportsdataverse `nba_stats_player_season_stats` release, which
        republishes the NBA Stats `leaguedashplayerstats` endpoint. 1996-2025.

Neither reaches back to its league's founding: nflverse begins in 1999 and the
NBA Stats season endpoint in 1996. Those are the honest limits of what is
publicly downloadable without scraping a site whose terms forbid it, and the
site states its coverage per league rather than implying more.

A player is written out only if the source carries real statistics for him --
no empty rows for people the data does not cover.

    python scripts/build_sport_data.py nfl --src DIR --out web/data-nfl
    python scripts/build_sport_data.py nba --src DIR --out web/data-nba
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import shutil
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_sport_data")

SHARD_COUNT = 128
NFL_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
           "player_stats/player_stats.parquet")
NBA_URL = ("https://github.com/sportsdataverse/sportsdataverse-data/releases/"
           "download/nba_stats_player_season_stats/player_season_stats_{year}.parquet")
NBA_SEASONS = range(1996, 2026)


# --------------------------------------------------------------------------
# Scoring — the default weights each league's pages open with. Editable in the
# site's My League panel, which rescores everything from the counting stats.
# --------------------------------------------------------------------------
NFL_SCORING = {
    "PassYd": 0.04, "PassTD": 4, "Int": -2, "Pass2PT": 2,
    "RushYd": 0.1, "RushTD": 6, "Rush2PT": 2,
    "Rec": 0.5, "RecYd": 0.1, "RecTD": 6, "Rec2PT": 2,
    "FumLost": -2, "RetTD": 6,
}
NFL_ROSTER = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "W/R/T", "K", "DEF",
              "BN", "BN", "BN", "BN", "BN", "IR"]

NBA_SCORING = {
    "PTS": 1, "REB": 1.2, "AST": 1.5, "STL": 3, "BLK": 3, "TOV": -1,
    "FG3M": 0.5, "FGM": 1, "FGA": -0.5, "FTM": 1, "FTA": -0.5,
}
NBA_ROSTER = ["PG", "SG", "G", "SF", "PF", "F", "C", "C", "Util", "Util",
              "BN", "BN", "BN", "IL"]


def r1(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


def r2(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0
    return round(float(x), 2)


def i0(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0
    return int(round(float(x)))


def txt(x) -> str:
    return x if isinstance(x, str) else ""


def dump(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))


def fetch(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading %s", url)
    with urllib.request.urlopen(url, timeout=600) as resp:
        dest.write_bytes(resp.read())
    return dest


# --------------------------------------------------------------------------
# NFL
# --------------------------------------------------------------------------
NFL_STATS = [
    ("PassYd", "passing_yards"), ("PassTD", "passing_tds"),
    ("Int", "interceptions"), ("Pass2PT", "passing_2pt_conversions"),
    ("Cmp", "completions"), ("Att", "attempts"),
    ("RushYd", "rushing_yards"), ("RushTD", "rushing_tds"),
    ("Rush2PT", "rushing_2pt_conversions"), ("Car", "carries"),
    ("Rec", "receptions"), ("RecYd", "receiving_yards"),
    ("RecTD", "receiving_tds"), ("Rec2PT", "receiving_2pt_conversions"),
    ("Tgt", "targets"), ("RetTD", "special_teams_tds"),
]


def build_nfl(src: Path):
    raw = pd.read_parquet(fetch(NFL_URL, src / "nfl_player_stats.parquet"))
    raw = raw[raw["season_type"] == "REG"] if "season_type" in raw else raw

    frame = pd.DataFrame({
        "pid": raw["player_id"].astype(str),
        "name": raw["player_display_name"].fillna(raw["player_name"]).astype(str),
        "pos": raw["position"].fillna("").astype(str),
        "team": raw["recent_team"].fillna("").astype(str),
        "year": raw["season"].astype(int),
    })
    for label, col in NFL_STATS:
        frame[label] = pd.to_numeric(raw.get(col), errors="coerce").fillna(0.0)
    frame["FumLost"] = sum(
        pd.to_numeric(raw.get(c), errors="coerce").fillna(0.0)
        for c in ("sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost")
    )
    frame["G"] = 1.0   # one row per game played

    stats = [label for label, _ in NFL_STATS] + ["FumLost", "G"]
    season = frame.groupby(["pid", "year"], as_index=False).agg(
        {**{s: "sum" for s in stats},
         "name": "last", "pos": "last", "team": lambda s: "/".join(dict.fromkeys(s))[:14]}
    )
    # A row with no offensive production at all is a player the source does not
    # really cover -- a lineman credited with a snap, say. Leave him out.
    produced = season[[s for s in stats if s != "G"]].abs().sum(axis=1)
    season = season[produced > 0].reset_index(drop=True)
    return season, stats


# --------------------------------------------------------------------------
# NBA
# --------------------------------------------------------------------------
NBA_STATS = [
    ("PTS", "pts"), ("REB", "reb"), ("AST", "ast"), ("STL", "stl"),
    ("BLK", "blk"), ("TOV", "tov"), ("FG3M", "fg3m"), ("FGM", "fgm"),
    ("FGA", "fga"), ("FTM", "ftm"), ("FTA", "fta"), ("OREB", "oreb"),
    ("DREB", "dreb"), ("PF", "pf"), ("MIN", "min"),
]


def build_nba(src: Path):
    frames = []
    for year in NBA_SEASONS:
        path = fetch(NBA_URL.format(year=year), src / f"nba_{year}.parquet")
        try:
            d = pd.read_parquet(path)
        except Exception as exc:                      # noqa: BLE001
            logger.warning("Skipping %s: %s", year, exc)
            continue
        d["year"] = year
        frames.append(d)
    raw = pd.concat(frames, ignore_index=True)
    logger.info("NBA raw rows: %d across %d seasons", len(raw), len(frames))

    frame = pd.DataFrame({
        "pid": raw["player_id"].astype("Int64").astype(str),
        "name": raw["player_name"].astype(str),
        "pos": "",
        "team": raw.get("team_abbreviation", pd.Series("", index=raw.index)).fillna("").astype(str),
        "year": raw["year"].astype(int),
        "G": pd.to_numeric(raw.get("gp"), errors="coerce").fillna(0.0),
    })
    for label, col in NBA_STATS:
        frame[label] = pd.to_numeric(raw.get(col), errors="coerce").fillna(0.0)

    stats = [label for label, _ in NBA_STATS] + ["G"]
    season = frame.groupby(["pid", "year"], as_index=False).agg(
        {**{s: "sum" for s in stats},
         "name": "last", "pos": "last", "team": lambda s: "/".join(dict.fromkeys(s))[:14]}
    )
    season = season[season["G"] > 0].reset_index(drop=True)
    return season, stats


# --------------------------------------------------------------------------
# Shared writer
# --------------------------------------------------------------------------
def score(df: pd.DataFrame, weights: dict) -> pd.Series:
    points = pd.Series(0.0, index=df.index)
    for cat, weight in weights.items():
        if cat in df.columns:
            points += weight * df[cat]
    return points


def write_dataset(sport: str, season: pd.DataFrame, stats: list[str],
                  scoring: dict, roster: list[str], out: Path,
                  source: str, note: str):
    season = season.copy()
    season["PTSF"] = score(season, scoring)

    # Era-adjusted rating: points per game against the season's own qualified
    # average, indexed to 100 -- the same idea the baseball pages use.
    qualified = season[season["G"] >= (8 if sport == "nfl" else 30)]
    league = qualified.groupby("year").apply(
        lambda g: g["PTSF"].sum() / g["G"].sum() if g["G"].sum() else np.nan,
        include_groups=False)
    rate = np.where(season["G"] > 0, season["PTSF"] / season["G"].replace(0, np.nan), np.nan)
    season["PLUS"] = pd.Series(100.0 * rate / season["year"].map(league),
                               index=season.index).replace([np.inf, -np.inf], np.nan)
    min_games = 4 if sport == "nfl" else 15
    season.loc[season["G"] < min_games, "PLUS"] = np.nan

    career = season.groupby("pid").agg(
        **{**{s: (s, "sum") for s in stats + ["PTSF"]},
           "y0": ("year", "min"), "y1": ("year", "max"), "n": ("year", "count"),
           "name": ("name", "last"), "pos": ("pos", "last")})

    people = career.reset_index()[["pid", "name", "pos", "y0", "y1"]]
    people = people.sort_values("pid").reset_index(drop=True)
    people["nid"] = np.arange(len(people))
    nid = dict(zip(people["pid"], people["nid"]))
    logger.info("%s: %d players, %d player-seasons", sport.upper(),
                len(people), len(season))

    # --- player shards -----------------------------------------------------
    cols = ["year", "team", "pos", "G"] + stats[:-1] + ["PTSF", "PLUS"]
    shards: dict[int, dict] = {i: {} for i in range(SHARD_COUNT)}
    by_player = dict(tuple(season.sort_values("year").groupby("pid")))
    career_rec = career.to_dict("index")

    for row in people.itertuples(index=False):
        pid, n = row.pid, int(row.nid)
        rows = by_player[pid]
        c = career_rec[pid]
        rec = {
            "i": n, "p": pid, "n": txt(row.name) or pid, "pos": txt(row.pos),
            "yrs": [i0(row.y0), i0(row.y1)],
            "s": [[i0(r.year), txt(r.team), txt(r.pos), r1(r.G)]
                  + [r1(getattr(r, s)) for s in stats[:-1]]
                  + [r1(r.PTSF), None if pd.isna(r.PLUS) else r1(r.PLUS)]
                  for r in rows.itertuples(index=False)],
            "c": [r1(c["G"])] + [r1(c[s]) for s in stats[:-1]]
                 + [r1(c["PTSF"]), i0(c["y0"]), i0(c["y1"]), i0(c["n"])],
        }
        shards[n % SHARD_COUNT][str(n)] = rec

    shard_dir = out / "players"
    if shard_dir.exists():
        shutil.rmtree(shard_dir)
    shard_dir.mkdir(parents=True, exist_ok=True)
    for idx, payload in shards.items():
        dump(shard_dir / f"{idx}.json", payload)

    # --- search index ------------------------------------------------------
    index = {"ids": [], "pid": [], "names": [], "y0": [], "y1": [], "pos": [],
             "bp": [], "pp": [], "hof": [], "shards": SHARD_COUNT}
    for row in people.itertuples(index=False):
        c = career_rec[row.pid]
        index["ids"].append(int(row.nid))
        index["pid"].append(row.pid)
        index["names"].append(txt(row.name) or pid)
        index["y0"].append(i0(row.y0))
        index["y1"].append(i0(row.y1))
        index["pos"].append(txt(row.pos))
        index["bp"].append(r1(c["PTSF"]))
        index["pp"].append(0)
        index["hof"].append(0)
    dump(out / "search.json", index)

    # --- leaderboards ------------------------------------------------------
    season["nid"] = season["pid"].map(nid)
    ordered = season.sort_values("PTSF", ascending=False)
    pool = pd.concat([ordered.head(9000), ordered.groupby("year").head(60)],
                     ignore_index=True).drop_duplicates(subset=["pid", "year"])
    season_cols = ["id", "year", "team", "pos", "G"] + stats[:-1] + ["pts", "ptsg", "ptsplus"]
    dump(out / "lb_season.json", {
        "cols": season_cols,
        "rows": [[i0(r.nid), i0(r.year), txt(r.team), txt(r.pos), r1(r.G)]
                 + [r1(getattr(r, s)) for s in stats[:-1]]
                 + [r1(r.PTSF), r2(r.PTSF / r.G) if r.G else 0,
                    None if pd.isna(r.PLUS) else r1(r.PLUS)]
                 for r in pool.sort_values("PTSF", ascending=False).itertuples(index=False)],
    })

    career_cols = ["id", "year0", "year1", "seasons", "G"] + stats[:-1] + ["pts", "ptsg"]
    csorted = career.sort_values("PTSF", ascending=False)
    dump(out / "lb_career.json", {
        "cols": career_cols,
        "rows": [[i0(nid[pid]), i0(c["y0"]), i0(c["y1"]), i0(c["n"]), r1(c["G"])]
                 + [r1(c[s]) for s in stats[:-1]]
                 + [r1(c["PTSF"]), r2(c["PTSF"] / c["G"]) if c["G"] else 0]
                 for pid, c in csorted.iterrows()],
    })

    # --- percentile breakpoints -------------------------------------------
    def breaks(values):
        values = np.asarray(values, dtype=float)
        values = values[np.isfinite(values)]
        if not len(values):
            return [0] * 101
        return [r1(v) for v in np.percentile(values, np.arange(0, 101))]

    q = season[season["G"] >= min_games]
    qc = career[career["G"] >= (min_games * 3)]
    dump(out / "percentiles.json", {
        "season": {"pts": breaks(q["PTSF"].values),
                   "ptsg": breaks((q["PTSF"] / q["G"].replace(0, np.nan)).values),
                   "ptsplus": breaks(q["PLUS"].values)},
        "career": {"pts": breaks(qc["PTSF"].values),
                   "ptsg": breaks((qc["PTSF"] / qc["G"].replace(0, np.nan)).values)},
    })

    dump(out / "meta.json", {
        "built": pd.Timestamp.now("UTC").strftime("%Y-%m-%d"),
        "sport": sport,
        "source": source,
        "coverage_note": note,
        "seasons": [int(season["year"].min()), int(season["year"].max())],
        "players": int(len(people)),
        "player_seasons": int(len(season)),
        "league": {"size": 12, "type": "H2H Points", "roster": roster},
        "scoring": scoring,
        "stat_cols": stats[:-1],
        "season_cols": season_cols,
        "career_cols": career_cols,
        "qualifiers": {"season_games": min_games},
        "shards": SHARD_COUNT,
    })

    total = sum(f.stat().st_size for f in out.rglob("*.json"))
    logger.info("%s -> %s (%.1f MB)", sport.upper(), out, total / 1e6)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sport", choices=["nfl", "nba"])
    ap.add_argument("--src", default=".cache/sports")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    src = Path(args.src) if Path(args.src).is_absolute() else root / args.src
    out = Path(args.out) if args.out else root / f"web/data-{args.sport}"
    out.mkdir(parents=True, exist_ok=True)

    if args.sport == "nfl":
        season, stats = build_nfl(src)
        write_dataset("nfl", season, stats, NFL_SCORING, NFL_ROSTER, out,
                      "nflverse-data player_stats release (github.com/nflverse)",
                      "Offensive statistics only, 1999-2024. nflverse's public "
                      "player stats begin in 1999; kicking and team defence are "
                      "separate releases and are not loaded yet.")
    else:
        season, stats = build_nba(src)
        write_dataset("nba", season, stats, NBA_SCORING, NBA_ROSTER, out,
                      "hoopR / sportsdataverse NBA Stats season release",
                      "1996-2025. The NBA Stats season endpoint this is built "
                      "from does not publish earlier seasons, so the pre-1996 "
                      "era is absent rather than partially filled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
