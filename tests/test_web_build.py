"""Tests for the web dataset builder.

The point of these is parity: there are now two places that turn a stat line
into league points -- ``fantasy_baseball.scoring`` (live current-season data,
MLB Stats API column names) and ``scripts.build_web_data`` (historical Lahman
column names). They must agree, or the website and the CLI will quietly report
different totals for the same player.
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_baseball import scoring  # noqa: E402
from scripts import build_web_data as web  # noqa: E402


def test_batting_parity_with_package_scoring():
    """Same player, two column vocabularies, identical points."""
    lahman = pd.DataFrame([{
        "G": 153, "AB": 476, "R": 129, "H": 156, "D2": 32, "D3": 2, "HR": 73,
        "RBI": 137, "SB": 13, "CS": 3, "BB": 177, "SO": 93, "IBB": 35,
        "HBP": 9, "SH": 0, "SF": 2,
    }])
    statsapi = lahman.rename(columns={"D2": "2B", "D3": "3B"}).assign(PA=664)

    web_points = web.score_batting(lahman).iloc[0]
    pkg_points = scoring.score_batting(statsapi).iloc[0]["Points"]

    # Barry Bonds, 2001, computed by hand from the league's weights:
    # R 129 + 1B 49 + 2B 64 + 3B 6 + HR 219 + RBI 137 + SB 26 + BB 177
    # + IBB 35 + HBP 9
    assert web_points == pytest.approx(851)
    assert web_points == pytest.approx(pkg_points)


def test_pitching_parity_with_package_scoring():
    lahman = pd.DataFrame([{
        "W": 20, "L": 5, "G": 33, "GS": 33, "CG": 2, "SHO": 1, "SV": 0,
        "IPouts": 660, "H": 180, "ER": 60, "HR": 15, "BB": 40, "SO": 250,
    }])
    statsapi = pd.DataFrame([{
        "IP": 220.0, "W": 20, "L": 5, "CG": 2, "SHO": 1, "SV": 0, "ER": 60,
        "K": 250, "G": 33,
    }])

    web_points = web.score_pitching(lahman).iloc[0]
    pkg_points = scoring.score_pitching(statsapi).iloc[0]["Points"]

    # IP 220 + W 60 - L 10 + CG 4 + SHO 3 - ER 60 + K 250
    assert web_points == pytest.approx(467)
    # The package scores HLD/QS/BS too; absent from this frame they contribute
    # 0, so the two engines land on the same number.
    assert web_points == pytest.approx(pkg_points)


def test_ipouts_converts_to_thirds_of_an_inning():
    """IPouts 661 is 220.1 innings, worth 220.333 points, not 220."""
    df = pd.DataFrame([{"IPouts": 661, "W": 0, "L": 0, "CG": 0, "SHO": 0,
                        "SV": 0, "ER": 0, "SO": 0}])
    assert web.score_pitching(df).iloc[0] == pytest.approx(661 / 3)


def test_missing_columns_score_zero_rather_than_raising():
    """Early-era rows have null IBB/HBP; they must not poison the total."""
    df = pd.DataFrame([{"H": 4, "D2": 1, "D3": 0, "HR": 1, "R": 2, "RBI": 3,
                        "SB": 0, "BB": 1, "IBB": None, "HBP": None}])
    # R 2 + 1B 2 + 2B 2 + HR 3 + RBI 3 + BB 1
    assert web.score_batting(df).iloc[0] == pytest.approx(13)


def test_txt_rejects_nan_so_json_stays_valid():
    """`NaN or ""` keeps the NaN, which json.dumps writes as invalid JSON."""
    assert web.txt(float("nan")) == ""
    assert web.txt(None) == ""
    assert web.txt("NL") == "NL"


def test_dump_refuses_to_write_nan(tmp_path):
    with pytest.raises(ValueError):
        web.dump(tmp_path / "bad.json", {"x": float("nan")})


def test_era_adjustment_indexes_to_100():
    """A player exactly at his season's league rate scores PTS+ of 100."""
    df = pd.DataFrame([
        {"yearID": 1990, "PA": 600, "PTS": 600},
        {"yearID": 1990, "PA": 600, "PTS": 300},
        {"yearID": 1990, "PA": 600, "PTS": 900},
    ])
    plus = web.era_adjust(df, "PA", 300)
    assert plus.iloc[0] == pytest.approx(100)
    assert plus.iloc[1] == pytest.approx(50)
    assert plus.iloc[2] == pytest.approx(150)


def test_era_adjustment_ignores_non_qualifiers_in_the_baseline():
    """A 5-PA hitter with a fluke rate must not move the league average."""
    df = pd.DataFrame([
        {"yearID": 1990, "PA": 600, "PTS": 600},
        {"yearID": 1990, "PA": 5, "PTS": 500},
    ])
    plus = web.era_adjust(df, "PA", 300)
    assert plus.iloc[0] == pytest.approx(100)


def test_empty_seasons_are_dropped_but_real_contributions_survive():
    """A DH-era pitcher who never batted is noise; a pinch runner is not."""
    df = pd.DataFrame([
        {"PA": 600, "PTS": 700},   # everyday player
        {"PA": 0, "PTS": 0},       # pitcher with a batting row and no PA
        {"PA": 0, "PTS": 5},       # pinch runner: no PA, still scored runs
    ])
    kept = web.drop_empty_seasons(df, "PA", "batting")
    assert len(kept) == 2
    assert list(kept["PTS"]) == [700, 5]


def test_era_adjustment_is_withheld_for_tiny_samples():
    """One relief inning must not report a 472 rating."""
    df = pd.DataFrame([
        {"yearID": 1925, "IP": 200.0, "PTS": 220.0},
        {"yearID": 1925, "IP": 1.0, "PTS": 5.0},
    ])
    plus = web.era_adjust(df, "IP", web.QUAL_SEASON_IP).where(df["IP"] >= web.MIN_RATE_IP)
    assert plus.iloc[0] == pytest.approx(100)
    assert pd.isna(plus.iloc[1])
    assert web.opt(plus.iloc[1]) is None   # serialises as JSON null, renders as "—"


def test_top_pool_keeps_every_season_and_team_represented():
    """A global cutoff alone would make year/team filters look broken."""
    rows = []
    for year in (1900, 2000):
        for team in ("AAA", "BBB"):
            for i in range(5):
                # 1900 scores far below 2000, so a pure global top-N drops it.
                rows.append({"playerID": f"{year}{team}{i}", "yearID": year,
                             "teamID": team, "PTS": (year - 1899) * 100 + i})
    df = pd.DataFrame(rows)

    pool = web.top_pool(df, "PTS", top_global=3, per_year=2, per_team=2)

    assert set(pool["yearID"]) == {1900, 2000}
    assert set(pool["teamID"]) == {"AAA", "BBB"}
    assert not pool.duplicated(subset=["playerID", "yearID"]).any()
