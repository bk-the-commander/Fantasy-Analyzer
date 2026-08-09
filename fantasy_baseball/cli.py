"""Command-line entry point: pull stats, score, rank, filter, save.

Examples:
    python -m fantasy_baseball.cli --season 2026 --type batting --position OF
    python -m fantasy_baseball.cli --season 2026 --type pitching --position SP --min-ip 20
    python -m fantasy_baseball.cli --season 2026 --type batting --regression
"""
from __future__ import annotations

import argparse
import logging
import sys

import pandas as pd

from fantasy_baseball.config import DEFAULT_SEASON
from fantasy_baseball.data import (
    fetch_batting_stats,
    fetch_pitching_stats,
    fetch_player_positions,
    fetch_statcast_batter_metrics,
    fetch_statcast_pitcher_metrics,
)
from fantasy_baseball.rank import rank_batters, rank_pitchers, regression_candidates
from fantasy_baseball.scoring import score_batting, score_pitching


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Fantasy baseball points ranker")
    p.add_argument("--season", type=int, default=DEFAULT_SEASON)
    p.add_argument("--type", choices=["batting", "pitching"], required=True)
    p.add_argument("--position", default=None, help="e.g. OF, SS, SP, RP, Util, P")
    p.add_argument("--min-pa", type=int, default=0)
    p.add_argument("--min-ip", type=float, default=0)
    p.add_argument("--top", type=int, default=30)
    p.add_argument("--no-statcast", action="store_true", help="skip Baseball Savant lookup")
    p.add_argument("--regression", action="store_true", help="show over/underperformers vs xwOBA/xERA")
    p.add_argument("--out", default=None, help="write full ranked table to this CSV path")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                         format="%(levelname)s %(name)s: %(message)s")

    positions = fetch_player_positions(args.season)

    if args.type == "batting":
        raw = fetch_batting_stats(args.season, positions=positions)
        scored = score_batting(raw)
        statcast = None if args.no_statcast else fetch_statcast_batter_metrics(args.season)
        if args.regression:
            result = regression_candidates(scored, statcast, points_col="Points/PA", skill_col="xwOBA")
        else:
            result = rank_batters(scored, statcast, position=args.position, min_pa=args.min_pa)
    else:
        raw = fetch_pitching_stats(args.season, positions=positions)
        scored = score_pitching(raw)
        statcast = None if args.no_statcast else fetch_statcast_pitcher_metrics(args.season)
        if args.regression:
            result = regression_candidates(scored, statcast, points_col="Points/IP", skill_col="xERA")
        else:
            result = rank_pitchers(scored, statcast, position=args.position, min_ip=args.min_ip)

    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 40)
    print(result.head(args.top).to_string(index=False))

    if args.out:
        result.to_csv(args.out, index=False)
        print(f"\nWrote {len(result)} rows to {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
