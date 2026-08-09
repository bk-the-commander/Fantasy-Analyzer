"""Paths and tunable thresholds for the finance tracker.

Nothing in this file is private -- your actual salary, holdings, and spending
live in ``data/`` (gitignored), not here. See README "Finance Tracker" ->
"Setup" for how to populate that directory from the templates in
``data/examples/``.
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
EXAMPLES_DIR = DATA_DIR / "examples"

PROFILE_PATH = DATA_DIR / "profile.yaml"
HOLDINGS_PATH = DATA_DIR / "holdings.csv"
TRANSACTIONS_PATH = DATA_DIR / "transactions.csv"
WATCHLIST_PATH = DATA_DIR / "watchlist.csv"

# --- Technical indicator windows --------------------------------------------
RSI_PERIOD = 14
SMA_SHORT = 50
SMA_LONG = 200
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
PRICE_HISTORY_PERIOD = "1y"  # yfinance period string

# --- Buy-signal thresholds ---------------------------------------------------
# These are plain technical rules of thumb, not investment advice. Tune them
# to taste in this one place -- signals.py reads all of them from here.
RSI_OVERSOLD = 30          # RSI below this = "oversold"
RSI_OVERBOUGHT = 70        # RSI above this = "overbought" (flagged, not a buy signal)
NEAR_52W_LOW_PCT = 0.05    # within 5% of the 52-week low
NEAR_52W_HIGH_PCT = 0.05   # within 5% of the 52-week high (flagged, not a buy signal)

# --- Budget categories --------------------------------------------------------
# Used only as a display fallback (ordering) when a category appears in
# transactions.csv but not in profile.yaml's budget section.
INCOME_CATEGORY = "Income"
