"""Apply league scoring rules to batting/pitching stat DataFrames."""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from fantasy_baseball.config import (
    BATTING_SCORING,
    PITCHING_SCORING,
    RARE_EVENT_CATEGORIES,
)

logger = logging.getLogger(__name__)


def _score(df: pd.DataFrame, scoring_map: dict) -> pd.Series:
    """Weighted sum of scoring_map over whatever columns df actually has.

    Missing (but scored) categories contribute 0 and are reported once via
    logging rather than raising, since not every data source carries every
    stat (see RARE_EVENT_CATEGORIES).
    """
    points = pd.Series(0.0, index=df.index)
    missing = []
    for category, weight in scoring_map.items():
        if category in df.columns and df[category].notna().any():
            points = points + weight * df[category].fillna(0)
        else:
            missing.append(category)
    if missing:
        known_rare = [m for m in missing if m in RARE_EVENT_CATEGORIES]
        other_missing = [m for m in missing if m not in RARE_EVENT_CATEGORIES]
        if known_rare:
            logger.info(
                "Scoring 0 for rare-event categories not in season-aggregate data: %s",
                known_rare,
            )
        if other_missing:
            logger.warning("Scoring 0 for missing columns: %s", other_missing)
    return points


def score_batting(df: pd.DataFrame) -> pd.DataFrame:
    """Add Points, Points/G, Points/PA to a batting stats DataFrame.

    Expects canonical columns from fantasy_baseball.data.fetch_batting_stats
    (H, 2B, 3B, HR, R, RBI, SB, BB, IBB, HBP, PA, G). Derives 1B = H-2B-3B-HR.
    """
    df = df.copy()
    df["1B"] = df["H"] - df["2B"] - df["3B"] - df["HR"]
    df["Points"] = _score(df, BATTING_SCORING)
    df["Points/G"] = np.where(df["G"] > 0, df["Points"] / df["G"], 0.0)
    df["Points/PA"] = np.where(df["PA"] > 0, df["Points"] / df["PA"], 0.0)
    return df.sort_values("Points", ascending=False).reset_index(drop=True)


def score_pitching(df: pd.DataFrame) -> pd.DataFrame:
    """Add Points, Points/G, Points/IP to a pitching stats DataFrame.

    Expects canonical columns from fantasy_baseball.data.fetch_pitching_stats
    (IP, W, L, CG, SHO, SV, ER, K, HLD, QS, BS, G).
    """
    df = df.copy()
    df["Points"] = _score(df, PITCHING_SCORING)
    df["Points/G"] = np.where(df["G"] > 0, df["Points"] / df["G"], 0.0)
    df["Points/IP"] = np.where(df["IP"] > 0, df["Points"] / df["IP"], 0.0)
    return df.sort_values("Points", ascending=False).reset_index(drop=True)
