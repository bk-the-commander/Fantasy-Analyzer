"""Technical indicator math, computed from a plain price series.

Kept free of any network/data-fetching code on purpose: every function here
takes a pandas Series of daily closes and returns a Series/scalar, so it can
be unit tested with hand-built price series (see tests/test_indicators.py)
without hitting yfinance.
"""
from __future__ import annotations

import pandas as pd

from finance_tracker.config import MACD_FAST, MACD_SIGNAL, MACD_SLOW, RSI_PERIOD


def sma(closes: pd.Series, window: int) -> pd.Series:
    return closes.rolling(window=window, min_periods=window).mean()


def rsi(closes: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    """Wilder's RSI. Returns NaN until `period` observations are available."""
    delta = closes.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    result = 100 - (100 / (1 + rs))
    # Wilder's RSI is 100 when there are gains but zero losses in the window.
    result[(avg_loss == 0) & (avg_gain > 0)] = 100.0
    return result


def macd(
    closes: pd.Series,
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL,
) -> pd.DataFrame:
    """Returns a DataFrame with columns: macd, signal, histogram."""
    ema_fast = closes.ewm(span=fast, adjust=False).mean()
    ema_slow = closes.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame(
        {"macd": macd_line, "signal": signal_line, "histogram": macd_line - signal_line}
    )


def pct_off_52w_low(closes: pd.Series) -> float:
    """How far the latest close is above the trailing-52-week low, as a fraction."""
    low = closes.min()
    if low == 0 or pd.isna(low):
        return float("nan")
    return (closes.iloc[-1] - low) / low


def pct_off_52w_high(closes: pd.Series) -> float:
    """How far the latest close is below the trailing-52-week high, as a fraction."""
    high = closes.max()
    if high == 0 or pd.isna(high):
        return float("nan")
    return (high - closes.iloc[-1]) / high


def crossed_above(series_a: pd.Series, series_b: pd.Series) -> bool:
    """True if `a` was <= `b` on the prior observation and is > `b` on the latest."""
    if len(series_a) < 2 or len(series_b) < 2:
        return False
    a_prev, a_last = series_a.iloc[-2], series_a.iloc[-1]
    b_prev, b_last = series_b.iloc[-2], series_b.iloc[-1]
    if pd.isna(a_prev) or pd.isna(a_last) or pd.isna(b_prev) or pd.isna(b_last):
        return False
    return bool(a_prev <= b_prev and a_last > b_last)
