"""League scoring rules and roster configuration.

Values here are pulled directly from the league settings. Column names on the
right side of each scoring dict must match the canonical column names produced
by ``fantasy_baseball.data`` after normalization (see NORMALIZATION in that
module) -- not raw source-specific column names.
"""

# --- Batting scoring -------------------------------------------------------
# 1B (singles) is not reported directly by any source; it is derived as
# H - 2B - 3B - HR in fantasy_baseball.scoring before these weights are applied.
BATTING_SCORING = {
    "R": 1,
    "1B": 1,
    "2B": 2,
    "3B": 3,
    "HR": 3,
    "RBI": 1,
    "SB": 2,
    "BB": 1,
    "IBB": 1,
    "HBP": 1,
    "CYCLE": 7,
    "GRAND_SLAM": 4,
}

# --- Pitching scoring --------------------------------------------------------
PITCHING_SCORING = {
    "IP": 1,
    "W": 3,
    "L": -2,
    "CG": 2,
    "SHO": 3,
    "SV": 4,
    "ER": -1,
    "K": 1,
    "HLD": 1,
    "NO_HITTER": 7,
    "PERFECT_GAME": 10,
    "QS": 2,
    "BS": -1,
}

# Stat categories that require per-game / play-by-play data (cycles, grand
# slams, no-hitters, perfect games) rather than season aggregate totals.
# V1's data sources are season-aggregate leaderboards, so these are not
# populated automatically -- see README "Known limitations".
RARE_EVENT_CATEGORIES = {"CYCLE", "GRAND_SLAM", "NO_HITTER", "PERFECT_GAME"}

# --- Roster ------------------------------------------------------------------
LEAGUE_SIZE = 12
LEAGUE_TYPE = "H2H Points"

ROSTER_SLOTS = [
    "C", "1B", "2B", "3B", "SS",
    "OF", "OF", "OF",
    "Util", "Util",
    "SP", "SP",
    "RP",
    "P", "P", "P",
]

# Position-slot eligibility. "Util" accepts any batter; "P" accepts any pitcher
# (SP or RP). Positions come from MLB Stats API primary/eligible position codes.
BATTER_SLOTS = {"C", "1B", "2B", "3B", "SS", "OF", "Util"}
PITCHER_SLOTS = {"SP", "RP", "P"}

DEFAULT_SEASON = 2026
