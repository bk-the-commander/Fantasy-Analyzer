"""Check the built datasets against facts that are known independently.

Every other test in this repo asks "is the code self-consistent". This one asks
"is the data right", by comparing against records a baseball, football or
basketball fan could check from memory. A dataset can be perfectly consistent
and still be wrong -- a column read from the wrong place, a season misaligned,
an aggregation counting playoffs -- and only outside facts catch that.

    python scripts/verify_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failures: list[str] = []
checks = 0


def load(sport_dir: str, name: str):
    return json.loads((ROOT / "web" / sport_dir / name).read_text())


def check(label: str, actual, expected, tol=0):
    global checks
    checks += 1
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        good = abs(actual - expected) <= tol
    else:
        good = actual == expected
    if good:
        print(f"  ok   {label}: {actual}")
    else:
        failures.append(f"{label}: got {actual!r}, expected {expected!r}")
        print(f"  FAIL {label}: got {actual!r}, expected {expected!r}")


def rows_as_dicts(board):
    return [dict(zip(board["cols"], r)) for r in board["rows"]]


def name_map(index):
    return {i: n for i, n in zip(index["ids"], index["names"])}


def season_leader(board, names, year, key):
    rows = [r for r in rows_as_dicts(board) if r.get("year") == year]
    if not rows:
        return None, None
    top = max(rows, key=lambda r: r.get(key, 0) or 0)
    return names[top["id"]], top.get(key)


def career_leader(board, names, key):
    rows = rows_as_dicts(board)
    top = max(rows, key=lambda r: r.get(key, 0) or 0)
    return names[top["id"]], top.get(key)


# --------------------------------------------------------------------- MLB
print("\n— MLB —")
mlb_index = load("data", "search.json")
mlb_names = name_map(mlb_index)
bat_season = load("data", "lb_season_batting.json")
bat_career = load("data", "lb_career_batting.json")
pit_career = load("data", "lb_career_pitching.json")

name, hr = season_leader(bat_season, mlb_names, 1927, "HR")
check("1927 home-run leader", name, "Babe Ruth")
check("Ruth 1927 home runs", hr, 60)

name, hr = season_leader(bat_season, mlb_names, 2001, "HR")
check("2001 home-run leader", name, "Barry Bonds")
check("Bonds 2001 home runs", hr, 73)

name, hr = season_leader(bat_season, mlb_names, 1961, "HR")
check("1961 home-run leader", name, "Roger Maris")
check("Maris 1961 home runs", hr, 61)

name, sb = career_leader(bat_career, mlb_names, "SB")
check("career stolen-base leader", name, "Rickey Henderson")
check("Henderson career steals", sb, 1406)

name, h = career_leader(bat_career, mlb_names, "H")
check("career hits leader", name, "Pete Rose")
check("Rose career hits", h, 4256)

name, hr = career_leader(bat_career, mlb_names, "HR")
check("career home-run leader", name, "Barry Bonds")
check("Bonds career home runs", hr, 762)

name, so = career_leader(pit_career, mlb_names, "SO")
check("career strikeout leader", name, "Nolan Ryan")
check("Ryan career strikeouts", so, 5714)

name, w = career_leader(pit_career, mlb_names, "W")
check("career wins leader", name, "Cy Young")
check("Young career wins", w, 511)

name, sv = career_leader(pit_career, mlb_names, "SV")
check("career saves leader", name, "Mariano Rivera")
check("Rivera career saves", sv, 652)

meta = load("data", "meta.json")
check("MLB season range", meta["seasons"], [1871, 2023])

# --------------------------------------------------------------------- NFL
print("\n— NFL —")
nfl_index = load("data-nfl", "search.json")
nfl_names = name_map(nfl_index)
nfl_season = load("data-nfl", "lb_season.json")
nfl_career = load("data-nfl", "lb_career.json")

name, yds = season_leader(nfl_season, nfl_names, 2013, "PassYd")
check("2013 passing-yards leader", name, "Peyton Manning")
check("Manning 2013 passing yards", yds, 5477)

name, td = season_leader(nfl_season, nfl_names, 2013, "PassTD")
check("2013 passing-TD leader", name, "Peyton Manning")
check("Manning 2013 passing TDs", td, 55)

name, yds = season_leader(nfl_season, nfl_names, 2012, "RushYd")
check("2012 rushing-yards leader", name, "Adrian Peterson")
check("Peterson 2012 rushing yards", yds, 2097)

name, rec = season_leader(nfl_season, nfl_names, 2019, "Rec")
check("2019 receptions leader", name, "Michael Thomas")
check("Thomas 2019 receptions", rec, 149)

name, td = season_leader(nfl_season, nfl_names, 2020, "PassTD")
check("2020 passing-TD leader", name, "Aaron Rodgers")
check("Rodgers 2020 passing TDs", td, 48)

nfl_meta = load("data-nfl", "meta.json")
check("NFL season range", nfl_meta["seasons"], [1999, 2024])

# --------------------------------------------------------------------- NBA
print("\n— NBA —")
nba_index = load("data-nba", "search.json")
nba_names = name_map(nba_index)
nba_season = load("data-nba", "lb_season.json")

name, pts = season_leader(nba_season, nba_names, 2016, "PTS")
check("2016-17 points leader", name, "Russell Westbrook")
check("Westbrook 2016-17 points", pts, 2558, tol=300)

name, ast = season_leader(nba_season, nba_names, 2016, "AST")
check("2016-17 assists leader", name, "James Harden")

# Love led both total and per-game rebounds in 2010-11 (1,112 in 73 games);
# Howard was second on totals with 1,098. Getting this wrong twice while
# writing the check is the reason the check exists.
name, reb = season_leader(nba_season, nba_names, 2010, "REB")
check("2010-11 total-rebounds leader", name, "Kevin Love")
check("Love 2010-11 rebounds", reb, 1112, tol=3)

name, pts = season_leader(nba_season, nba_names, 2005, "PTS")
check("2005-06 points leader", name, "Kobe Bryant")

nba_meta = load("data-nba", "meta.json")
check("NBA season range", nba_meta["seasons"], [1996, 2025])

# ------------------------------------------------------------- integrity
print("\n— integrity —")
for label, folder in (("MLB", "data"), ("NFL", "data-nfl"), ("NBA", "data-nba")):
    index = load(folder, "search.json")
    checks += 1
    blanks = sum(1 for n in index["names"] if not n or not n.strip())
    if blanks:
        failures.append(f"{label}: {blanks} players with no name")
        print(f"  FAIL {label} blank names: {blanks}")
    else:
        print(f"  ok   {label}: no blank names among {len(index['names'])} players")

    checks += 1
    dupes = len(index["pid"]) - len(set(index["pid"]))
    if dupes:
        failures.append(f"{label}: {dupes} duplicate player ids")
        print(f"  FAIL {label} duplicate ids: {dupes}")
    else:
        print(f"  ok   {label}: player ids unique")

print("\n" + "=" * 60)
if failures:
    print(f"{len(failures)} of {checks} checks FAILED:")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)
print(f"All {checks} data checks passed.")
