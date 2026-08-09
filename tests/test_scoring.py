"""Unit tests for the scoring engine using small hand-crafted DataFrames.

These don't touch the network -- they verify the point arithmetic in
fantasy_baseball.scoring matches the league's scoring rules exactly, since
the real data pipeline can't be exercised from this sandbox (egress to
statsapi.mlb.com / baseballsavant.mlb.com is blocked here; see README).
"""
import pandas as pd
import pytest

from fantasy_baseball.scoring import score_batting, score_pitching


def test_score_batting_basic():
    df = pd.DataFrame(
        [
            {
                "player_id": 1, "Name": "Test Batter", "G": 3, "PA": 10,
                "R": 2, "H": 3, "2B": 1, "3B": 0, "HR": 1,
                "RBI": 2, "SB": 1, "BB": 1, "IBB": 0, "HBP": 0,
            }
        ]
    )
    scored = score_batting(df)
    row = scored.iloc[0]

    assert row["1B"] == 1  # H - 2B - 3B - HR = 3 - 1 - 0 - 1
    # R:1*2 + 1B:1*1 + 2B:2*1 + 3B:3*0 + HR:3*1 + RBI:1*2 + SB:2*1 + BB:1*1
    expected_points = 2 + 1 + 2 + 0 + 3 + 2 + 2 + 1
    assert row["Points"] == pytest.approx(expected_points)
    assert row["Points/G"] == pytest.approx(expected_points / 3)
    assert row["Points/PA"] == pytest.approx(expected_points / 10)


def test_score_batting_zero_pa_or_g_does_not_divide_by_zero():
    df = pd.DataFrame([{"player_id": 1, "Name": "Bench", "G": 0, "PA": 0, "R": 0, "H": 0,
                         "2B": 0, "3B": 0, "HR": 0, "RBI": 0, "SB": 0, "BB": 0, "IBB": 0, "HBP": 0}])
    scored = score_batting(df)
    assert scored.iloc[0]["Points/G"] == 0
    assert scored.iloc[0]["Points/PA"] == 0


def test_score_pitching_basic():
    df = pd.DataFrame(
        [
            {
                "player_id": 1, "Name": "Test Pitcher", "G": 1, "IP": 6 + 1 / 3,
                "W": 1, "L": 0, "CG": 0, "SHO": 0, "SV": 0, "ER": 2, "K": 7,
                "HLD": 0, "QS": 1, "BS": 0,
            }
        ]
    )
    scored = score_pitching(df)
    row = scored.iloc[0]

    ip = 6 + 1 / 3
    expected_points = ip * 1 + 1 * 3 + 0 * -2 + 0 * 2 + 0 * 3 + 0 * 4 + 2 * -1 + 7 * 1 + 0 * 1 + 1 * 2 + 0 * -1
    assert row["Points"] == pytest.approx(expected_points)
    assert row["Points/IP"] == pytest.approx(expected_points / ip)


def test_score_pitching_missing_qs_scores_zero_not_error():
    df = pd.DataFrame(
        [{"player_id": 1, "Name": "No QS Data", "G": 1, "IP": 5.0, "W": 0, "L": 1,
          "CG": 0, "SHO": 0, "SV": 0, "ER": 3, "K": 4, "HLD": 0, "BS": 0}]
        # QS column intentionally omitted, simulating a source that lacks it
    )
    scored = score_pitching(df)
    expected_points = 5.0 * 1 + 0 * 3 + 1 * -2 + 3 * -1 + 4 * 1
    assert scored.iloc[0]["Points"] == pytest.approx(expected_points)


def test_ranking_order():
    df = pd.DataFrame(
        [
            {"player_id": 1, "Name": "Low", "G": 1, "PA": 5, "R": 1, "H": 1, "2B": 0, "3B": 0,
             "HR": 0, "RBI": 0, "SB": 0, "BB": 0, "IBB": 0, "HBP": 0},
            {"player_id": 2, "Name": "High", "G": 1, "PA": 5, "R": 3, "H": 3, "2B": 0, "3B": 0,
             "HR": 2, "RBI": 4, "SB": 1, "BB": 1, "IBB": 0, "HBP": 0},
        ]
    )
    scored = score_batting(df)
    assert scored.iloc[0]["Name"] == "High"
    assert scored.iloc[0]["Points"] > scored.iloc[1]["Points"]
