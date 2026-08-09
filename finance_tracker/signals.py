"""Technical-indicator screener: flags tickers hitting configured buy/watch
signals. These are plain technical rules of thumb (RSI, moving-average
crosses, 52-week range) -- not investment advice, and not a guarantee of
future performance. Combine with your own research.
"""
from __future__ import annotations

import pandas as pd

from finance_tracker.config import (
    NEAR_52W_HIGH_PCT,
    NEAR_52W_LOW_PCT,
    RSI_OVERBOUGHT,
    RSI_OVERSOLD,
    SMA_LONG,
    SMA_SHORT,
)
from finance_tracker.indicators import crossed_above, macd, pct_off_52w_high, pct_off_52w_low, rsi, sma


def screen_ticker(ticker: str, history: pd.DataFrame) -> dict | None:
    """Computes indicators and buy/watch flags for one ticker's price history.

    Returns None if there isn't enough history to compute anything useful.
    """
    if history.empty or "Close" not in history.columns:
        return None
    closes = history["Close"].dropna()
    if len(closes) < 20:
        return None

    latest_price = float(closes.iloc[-1])
    rsi_series = rsi(closes)
    latest_rsi = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else None

    sma_short = sma(closes, SMA_SHORT)
    sma_long = sma(closes, SMA_LONG)
    macd_df = macd(closes)

    flags: list[str] = []

    if latest_rsi is not None and latest_rsi < RSI_OVERSOLD:
        flags.append(f"RSI oversold ({latest_rsi:.0f} < {RSI_OVERSOLD})")
    if latest_rsi is not None and latest_rsi > RSI_OVERBOUGHT:
        flags.append(f"RSI overbought ({latest_rsi:.0f} > {RSI_OVERBOUGHT})")

    off_low = pct_off_52w_low(closes)
    if not pd.isna(off_low) and off_low <= NEAR_52W_LOW_PCT:
        flags.append(f"Near 52-week low (+{off_low:.1%})")

    off_high = pct_off_52w_high(closes)
    if not pd.isna(off_high) and off_high <= NEAR_52W_HIGH_PCT:
        flags.append(f"Near 52-week high (-{off_high:.1%})")

    if crossed_above(sma_short, sma_long):
        flags.append(f"Golden cross (SMA{SMA_SHORT} crossed above SMA{SMA_LONG})")
    if crossed_above(sma_long, sma_short):
        flags.append(f"Death cross (SMA{SMA_LONG} crossed above SMA{SMA_SHORT})")

    if crossed_above(macd_df["macd"], macd_df["signal"]):
        flags.append("MACD bullish crossover")
    if crossed_above(macd_df["signal"], macd_df["macd"]):
        flags.append("MACD bearish crossover")

    buy_flags = [f for f in flags if any(k in f for k in ("oversold", "52-week low", "Golden cross", "bullish"))]

    return {
        "ticker": ticker,
        "price": latest_price,
        "rsi14": latest_rsi,
        f"sma{SMA_SHORT}": float(sma_short.iloc[-1]) if not pd.isna(sma_short.iloc[-1]) else None,
        f"sma{SMA_LONG}": float(sma_long.iloc[-1]) if not pd.isna(sma_long.iloc[-1]) else None,
        "pct_off_52w_low": float(off_low) if not pd.isna(off_low) else None,
        "pct_off_52w_high": float(off_high) if not pd.isna(off_high) else None,
        "buy_signal_count": len(buy_flags),
        "flags": flags,
    }


def screen_tickers(histories: dict[str, pd.DataFrame]) -> pd.DataFrame:
    rows = [row for ticker, hist in histories.items() if (row := screen_ticker(ticker, hist)) is not None]
    if not rows:
        return pd.DataFrame(
            columns=["ticker", "price", "rsi14", "buy_signal_count", "flags"]
        )
    return pd.DataFrame(rows).sort_values("buy_signal_count", ascending=False).reset_index(drop=True)
