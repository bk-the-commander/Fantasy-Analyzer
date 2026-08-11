"""Per-stat leaderboards, computed from the complete season logs.

Why this exists rather than reading the boards the site already ships:

The season leaderboards are a *pool* -- the global top few thousand by fantasy
points, unioned with the best of each year and each club. That is the right
shape for a sortable board, but it is selected by points, so a player who led a
league in one category without scoring heavily may not be in it. Asking that
pool "who has the most blocks in a season" would quietly return the best answer
among the players who happened to make the cut, which is a wrong answer that
looks right.

The player shards, on the other hand, carry every season of every player in the
index. This walks all of them, adds up careers, keeps the best single seasons,
and writes a small `leaders.json` per league. Nothing here is sampled.

    python scripts/build_leaders.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
TOP_N = 10

# Packed column order for the baseball shards. These mirror the B/P maps in
# web/app.js; if a builder ever reorders a row, both have to move together.
B = {"YEAR": 0, "TEAM": 1, "G": 4, "PA": 5, "AB": 6, "R": 7, "H": 8, "D2": 9,
     "D3": 10, "HR": 11, "RBI": 12, "SB": 13, "CS": 14, "BB": 15, "SO": 18}
P = {"YEAR": 0, "TEAM": 1, "W": 3, "L": 4, "G": 5, "GS": 6, "CG": 7, "SHO": 8,
     "SV": 9, "IPouts": 10, "H": 11, "ER": 12, "HR": 13, "BB": 14, "SO": 15}

# What each league leads with. `asc` marks a stat where low is good, and those
# always carry a qualifier -- a career 0.00 ERA over four innings is not a
# record, it is a rounding artefact.
STATS = {
    "mlb": [
        {"key": "HR",  "label": "Home runs",     "side": "bat"},
        {"key": "H",   "label": "Hits",          "side": "bat"},
        {"key": "RBI", "label": "RBI",           "side": "bat"},
        {"key": "R",   "label": "Runs",          "side": "bat"},
        {"key": "SB",  "label": "Stolen bases",  "side": "bat"},
        {"key": "BB",  "label": "Walks",         "side": "bat"},
        {"key": "D2",  "label": "Doubles",       "side": "bat"},
        {"key": "SO",  "label": "Strikeouts",    "side": "pit"},
        {"key": "W",   "label": "Wins",          "side": "pit"},
        {"key": "SV",  "label": "Saves",         "side": "pit"},
        {"key": "SHO", "label": "Shutouts",      "side": "pit"},
        {"key": "IP",  "label": "Innings",       "side": "pit", "dp": 1},
        {"key": "ERA", "label": "ERA",           "side": "pit", "asc": True, "dp": 2,
         "qual": {"key": "IPouts", "career": 3000, "season": 450}},
    ],
    "nfl": [
        {"key": "PassYd", "label": "Passing yards"},
        {"key": "PassTD", "label": "Passing TDs"},
        {"key": "RushYd", "label": "Rushing yards"},
        {"key": "RushTD", "label": "Rushing TDs"},
        {"key": "Rec",    "label": "Receptions"},
        {"key": "RecYd",  "label": "Receiving yards"},
        {"key": "RecTD",  "label": "Receiving TDs"},
        {"key": "Cmp",    "label": "Completions"},
    ],
    "nba": [
        {"key": "PTS",  "label": "Points"},
        {"key": "REB",  "label": "Rebounds"},
        {"key": "AST",  "label": "Assists"},
        {"key": "STL",  "label": "Steals"},
        {"key": "BLK",  "label": "Blocks"},
        {"key": "FG3M", "label": "Three-pointers"},
        {"key": "FGM",  "label": "Field goals"},
        {"key": "FTM",  "label": "Free throws"},
        {"key": "MIN",  "label": "Minutes"},
    ],
}

DIRS = {"mlb": "data", "nfl": "data-nfl", "nba": "data-nba"}


def shards(folder: Path):
    for path in sorted(folder.glob("players/*.json"), key=lambda p: int(p.stem)):
        yield json.loads(path.read_text())


def rounded(v, dp):
    return round(v, dp) if dp else int(round(v))


def pick(rows, spec, scope):
    """Top TOP_N of `rows`, honouring direction and any qualifier."""
    qual = spec.get("qual")
    if qual:
        floor = qual[scope]
        rows = [r for r in rows if r.get(qual["key"], 0) >= floor]
    rows = [r for r in rows if r["v"] is not None]
    rows.sort(key=lambda r: r["v"], reverse=not spec.get("asc"))
    dp = spec.get("dp", 0)
    out = []
    for r in rows[:TOP_N]:
        row = {"pid": r["pid"], "name": r["name"], "v": rounded(r["v"], dp)}
        if scope == "season":
            row["year"] = r["year"]
            if r.get("team"):
                row["team"] = r["team"]
        else:
            row["span"] = [r["y0"], r["y1"]]
        out.append(row)
    return out


def build_mlb(folder: Path):
    career = {"bat": [], "pit": []}
    season = {"bat": [], "pit": []}
    for shard in shards(folder):
        for p in shard.values():
            pid, name = p["p"], p["n"]
            for side, rows, cols in (("bat", p.get("bat") or [], B),
                                     ("pit", p.get("pit") or [], P)):
                if not rows:
                    continue
                totals = defaultdict(float)
                years = []
                for r in rows:
                    years.append(r[cols["YEAR"]])
                    entry = {"pid": pid, "name": name, "year": r[cols["YEAR"]],
                             "team": r[cols["TEAM"]]}
                    for key, i in cols.items():
                        if key in ("YEAR", "TEAM"):
                            continue
                        v = r[i] or 0
                        totals[key] += v
                        entry[key] = v
                    entry["IP"] = entry.get("IPouts", 0) / 3
                    entry["ERA"] = (entry.get("ER", 0) * 27 / entry["IPouts"]
                                    if entry.get("IPouts") else None)
                    season[side].append(entry)
                c = {"pid": pid, "name": name, "y0": min(years), "y1": max(years)}
                c.update(totals)
                c["IP"] = totals.get("IPouts", 0) / 3
                c["ERA"] = (totals["ER"] * 27 / totals["IPouts"]
                            if totals.get("IPouts") else None)
                career[side].append(c)

    out = {"career": {}, "season": {}}
    for spec in STATS["mlb"]:
        side = spec["side"]
        for scope, pool in (("career", career[side]), ("season", season[side])):
            rows = [dict(r, v=r.get(spec["key"])) for r in pool]
            out[scope][spec["key"]] = pick(rows, spec, scope)
    return out


def build_generic(folder: Path, sport: str):
    meta = json.loads((folder / "meta.json").read_text())
    stat_cols = meta["stat_cols"]
    # Generic rows are [year, team, pos, G, *stat_cols..., pts, plus].
    idx = {name: 4 + i for i, name in enumerate(stat_cols)}
    idx["G"] = 3

    career, season = [], []
    for shard in shards(folder):
        for p in shard.values():
            pid, name = p["p"], p["n"]
            rows = p.get("s") or p.get("seasons") or []
            if not rows:
                continue
            totals = defaultdict(float)
            years = []
            for r in rows:
                years.append(r[0])
                entry = {"pid": pid, "name": name, "year": r[0], "team": r[1]}
                for key, i in idx.items():
                    v = r[i] or 0 if i < len(r) else 0
                    totals[key] += v
                    entry[key] = v
                season.append(entry)
            c = {"pid": pid, "name": name, "y0": min(years), "y1": max(years)}
            c.update(totals)
            career.append(c)

    out = {"career": {}, "season": {}}
    for spec in STATS[sport]:
        if spec["key"] not in idx:
            continue
        for scope, pool in (("career", career), ("season", season)):
            rows = [dict(r, v=r.get(spec["key"])) for r in pool]
            out[scope][spec["key"]] = pick(rows, spec, scope)
    return out


def main():
    for sport, folder_name in DIRS.items():
        folder = WEB / folder_name
        if not (folder / "meta.json").exists():
            print(f"  skip {sport}: no dataset")
            continue
        data = build_mlb(folder) if sport == "mlb" else build_generic(folder, sport)
        specs = [s for s in STATS[sport] if s["key"] in data["career"]]
        payload = {
            "stats": [{k: v for k, v in s.items() if k != "qual"} for s in specs],
            "career": data["career"],
            "season": data["season"],
        }
        path = folder / "leaders.json"
        path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
        size = path.stat().st_size / 1024
        print(f"  {sport}: {len(specs)} stats -> {path.relative_to(ROOT)} ({size:.0f} KB)")
        for s in specs[:3]:
            top = payload["career"][s["key"]][0]
            print(f"      career {s['label']}: {top['name']} {top['v']}")


if __name__ == "__main__":
    main()
