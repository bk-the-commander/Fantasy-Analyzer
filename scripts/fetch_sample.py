"""Smoke test: confirm the data pipeline works end-to-end on a small sample.

Run this first after network access to statsapi.mlb.com / baseballsavant.mlb.com
is available. It pulls a small slice of current-season batting stats, scores
them, and prints actual column names from each source so any mismatch between
this codebase's assumed schema and the real API response is caught early.

Usage:
    python scripts/fetch_sample.py [season]
"""
import sys

import pandas as pd

from fantasy_baseball.data import fetch_batting_stats, fetch_player_positions, fetch_statcast_batter_metrics
from fantasy_baseball.scoring import score_batting


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026

    print(f"--- Fetching player positions for {season} ---")
    positions = fetch_player_positions(season)
    print(f"Got {len(positions)} players. Columns: {list(positions.columns)}")
    print(positions.head(3))

    print(f"\n--- Fetching batting stats for {season} ---")
    batting = fetch_batting_stats(season, positions=positions)
    print(f"Got {len(batting)} batters. Columns: {list(batting.columns)}")
    print(batting.sort_values("PA", ascending=False).head(5))

    print("\n--- Scoring sample ---")
    scored = score_batting(batting[batting["PA"] >= 50])
    print(scored[["Name", "Team", "Pos", "G", "PA", "Points", "Points/G", "Points/PA"]].head(10))

    print(f"\n--- Fetching Statcast batter metrics for {season} (this hits Baseball Savant) ---")
    try:
        statcast = fetch_statcast_batter_metrics(season, min_pa=50)
        print(f"Got {len(statcast)} rows. Columns: {list(statcast.columns)}")
        print(statcast.head(5))
    except Exception as exc:  # noqa: BLE001 - smoke test, surface everything
        print(f"Statcast fetch failed: {exc}")

    print("\nPipeline smoke test complete.")


if __name__ == "__main__":
    main()
