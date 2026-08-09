"""Offline demo: runs the real scoring/ranking code on fictional stat lines.

No network required. This exists so the output format (columns, sorting,
Points/G, Points/PA, regression detection) can be sanity-checked without
hitting MLB Stats API / Baseball Savant -- useful for a quick "does this even
work" check, or if you're offline. Player names below are fictional
placeholders, not real stat projections.

Usage:
    python scripts/demo_mock_output.py
"""
import pandas as pd

from fantasy_baseball.rank import rank_batters, rank_pitchers, regression_candidates
from fantasy_baseball.scoring import score_batting, score_pitching

BATTERS = pd.DataFrame(
    [
        {"player_id": 1, "Name": "Sample Slugger", "Team": "Metro Sox", "Pos": "OF",
         "G": 108, "PA": 460, "AB": 405, "R": 78, "H": 122, "2B": 24, "3B": 2, "HR": 28,
         "RBI": 81, "SB": 9, "BB": 45, "IBB": 3, "HBP": 6, "SO": 98},
        {"player_id": 2, "Name": "Speedy Leadoff", "Team": "River City Nine", "Pos": "OF",
         "G": 112, "PA": 490, "AB": 440, "R": 84, "H": 128, "2B": 20, "3B": 6, "HR": 8,
         "RBI": 40, "SB": 34, "BB": 42, "IBB": 1, "HBP": 4, "SO": 70},
        {"player_id": 3, "Name": "Steady Infielder", "Team": "Harbor Crabs", "Pos": "2B",
         "G": 100, "PA": 410, "AB": 370, "R": 55, "H": 98, "2B": 18, "3B": 1, "HR": 10,
         "RBI": 48, "SB": 4, "BB": 32, "IBB": 0, "HBP": 3, "SO": 65},
        {"player_id": 4, "Name": "Backup Catcher", "Team": "Metro Sox", "Pos": "C",
         "G": 60, "PA": 190, "AB": 170, "R": 18, "H": 40, "2B": 8, "3B": 0, "HR": 4,
         "RBI": 20, "SB": 0, "BB": 15, "IBB": 0, "HBP": 2, "SO": 42},
    ]
)

PITCHERS = pd.DataFrame(
    [
        {"player_id": 101, "Name": "Ace Righthander", "Team": "River City Nine", "Pos": "P",
         "G": 20, "GS": 20, "Role": "SP", "IP": 118 + 2 / 3,  # 118.2 in box-score notation = 118 IP + 2 outs
         "W": 9, "L": 5, "CG": 1, "SHO": 1, "SV": 0, "BS": 0, "HLD": 0, "ER": 42, "K": 130, "QS": 13},
        {"player_id": 102, "Name": "Closer McSaveington", "Team": "Harbor Crabs", "Pos": "P",
         "G": 42, "GS": 0, "Role": "RP", "IP": 43.0,
         "W": 3, "L": 2, "CG": 0, "SHO": 0, "SV": 26, "BS": 3, "HLD": 0, "ER": 12, "K": 55, "QS": 0},
        {"player_id": 103, "Name": "Setup Reliable", "Team": "Metro Sox", "Pos": "P",
         "G": 55, "GS": 0, "Role": "RP", "IP": 58 + 1 / 3,  # 58.1 box-score notation = 58 IP + 1 out
         "W": 4, "L": 1, "CG": 0, "SHO": 0, "SV": 1, "BS": 1, "HLD": 22, "ER": 20, "K": 68, "QS": 0},
    ]
)

# fictional Statcast-style context, same shape data.py would return
BATTER_STATCAST = pd.DataFrame(
    [
        {"player_id": 1, "xwOBA": 0.352, "wOBA": 0.398, "barrel_pct": 12.1, "hard_hit_pct": 44.5},
        {"player_id": 2, "xwOBA": 0.318, "wOBA": 0.335, "barrel_pct": 4.2, "hard_hit_pct": 32.0},
        {"player_id": 3, "xwOBA": 0.330, "wOBA": 0.312, "barrel_pct": 7.8, "hard_hit_pct": 36.9},
        {"player_id": 4, "xwOBA": 0.298, "wOBA": 0.301, "barrel_pct": 5.0, "hard_hit_pct": 33.1},
    ]
)

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 40)

print("=" * 70)
print("BATTERS -- ranked by fantasy Points (OF slot)")
print("=" * 70)
scored_batters = score_batting(BATTERS)
ranked = rank_batters(scored_batters, BATTER_STATCAST, position="OF")
print(ranked[["Name", "Team", "Pos", "G", "PA", "Points", "Points/G", "Points/PA", "xwOBA", "barrel_pct", "hard_hit_pct"]]
      .to_string(index=False))

print("\n" + "=" * 70)
print("PITCHERS -- ranked by fantasy Points")
print("=" * 70)
scored_pitchers = score_pitching(PITCHERS)
ranked_p = rank_pitchers(scored_pitchers)
print(ranked_p[["Name", "Team", "Role", "IP", "W", "SV", "HLD", "K", "QS", "Points", "Points/IP"]]
      .to_string(index=False))

print("\n" + "=" * 70)
print("REGRESSION CANDIDATES -- Points/PA percentile vs. xwOBA percentile")
print("=" * 70)
candidates = regression_candidates(scored_batters, BATTER_STATCAST, points_col="Points/PA",
                                    skill_col="xwOBA", top_n=2)
print(candidates[["Name", "Points/PA", "xwOBA", "RegressionGap", "Candidate"]].to_string(index=False))
