"""Merge scored stats with Statcast context and filter/rank for roster decisions."""
from __future__ import annotations

import pandas as pd

from fantasy_baseball.config import BATTER_SLOTS, PITCHER_SLOTS


def merge_statcast(scored_df: pd.DataFrame, statcast_df: pd.DataFrame) -> pd.DataFrame:
    """Left-join Statcast context columns onto a scored stats DataFrame."""
    if statcast_df is None or statcast_df.empty:
        return scored_df
    return scored_df.merge(statcast_df, on="player_id", how="left", suffixes=("", "_sc"))


def filter_by_position(df: pd.DataFrame, position: str) -> pd.DataFrame:
    """Filter to players eligible for a roster slot.

    `position` may be a specific slot (e.g. "SS", "SP") or "Util"/"P" for the
    flex slots, matched case-insensitively.
    """
    position = position.strip()
    if "Pos" not in df.columns and "Role" not in df.columns:
        raise ValueError("DataFrame has neither 'Pos' nor 'Role' column to filter on")

    if position == "Util":
        return df[df["Pos"].notna()] if "Pos" in df.columns else df
    if position == "P":
        return df  # any pitcher is eligible for a generic P slot
    if position in ("SP", "RP") and "Role" in df.columns:
        return df[df["Role"] == position]
    if "Pos" in df.columns:
        return df[df["Pos"] == position]
    return df


def rank_batters(scored_df: pd.DataFrame, statcast_df: pd.DataFrame | None = None,
                  position: str | None = None, min_pa: int = 0) -> pd.DataFrame:
    df = merge_statcast(scored_df, statcast_df)
    if position:
        df = filter_by_position(df, position)
    if min_pa:
        df = df[df["PA"] >= min_pa]
    return df.sort_values("Points", ascending=False).reset_index(drop=True)


def rank_pitchers(scored_df: pd.DataFrame, statcast_df: pd.DataFrame | None = None,
                   position: str | None = None, min_ip: float = 0) -> pd.DataFrame:
    df = merge_statcast(scored_df, statcast_df)
    if position:
        df = filter_by_position(df, position)
    if min_ip:
        df = df[df["IP"] >= min_ip]
    return df.sort_values("Points", ascending=False).reset_index(drop=True)


def regression_candidates(scored_df: pd.DataFrame, statcast_df: pd.DataFrame,
                           points_col: str = "Points/PA", skill_col: str = "xwOBA",
                           top_n: int = 25) -> pd.DataFrame:
    """Players whose actual fantasy production is running well ahead of/behind
    their Statcast-implied skill -- i.e. positive/negative regression candidates.

    Ranks by the gap between each metric's percentile rank, so batting-points
    and xwOBA (different scales) are compared fairly.
    """
    df = merge_statcast(scored_df, statcast_df)
    df = df[df[points_col].notna() & df[skill_col].notna()].copy()
    df["_points_pct"] = df[points_col].rank(pct=True)
    df["_skill_pct"] = df[skill_col].rank(pct=True)
    df["RegressionGap"] = df["_points_pct"] - df["_skill_pct"]
    df = df.drop(columns=["_points_pct", "_skill_pct"])
    overperforming = df.sort_values("RegressionGap", ascending=False).head(top_n)
    underperforming = df.sort_values("RegressionGap", ascending=True).head(top_n)
    return pd.concat(
        [overperforming.assign(Candidate="Overperforming (regression risk)"),
         underperforming.assign(Candidate="Underperforming (breakout candidate)")],
        ignore_index=True,
    )
