"""Unit tests for the buy-signal screener against hand-built price histories.
No network -- crossed_above's own cross-detection logic is covered in
test_indicators.py, so these focus on screen_ticker's flag assembly.
"""
import pandas as pd

from finance_tracker.signals import screen_ticker, screen_tickers


def _history(closes: list[float]) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=len(closes), freq="D")
    return pd.DataFrame({"Close": closes}, index=dates)


def test_screen_ticker_returns_none_for_short_history():
    assert screen_ticker("XXX", _history([100.0] * 5)) is None


def test_screen_ticker_returns_none_for_empty_history():
    assert screen_ticker("XXX", pd.DataFrame()) is None


def test_screen_ticker_flags_oversold_and_near_52w_low():
    # Steadily declining price: RSI trends toward 0, and the latest close
    # (the lowest value seen) is by construction the 52-week low.
    closes = [200 - i for i in range(60)]
    row = screen_ticker("DOWN", _history(closes))
    assert row is not None
    assert row["rsi14"] < 30
    assert row["pct_off_52w_low"] == 0.0
    assert row["buy_signal_count"] >= 2
    assert any("oversold" in f for f in row["flags"])
    assert any("52-week low" in f for f in row["flags"])


def test_screen_ticker_flags_overbought_and_near_52w_high():
    closes = [100 + i for i in range(60)]
    row = screen_ticker("UP", _history(closes))
    assert row is not None
    assert row["rsi14"] > 70
    assert row["pct_off_52w_high"] == 0.0
    # overbought/near-high are watch flags, not buy flags
    assert not any("oversold" in f for f in row["flags"])
    assert any("overbought" in f for f in row["flags"])


def test_screen_tickers_sorts_by_buy_signal_count_desc():
    histories = {
        "FLAT": _history([100.0] * 60),
        "DOWN": _history([200 - i for i in range(60)]),
    }
    result = screen_tickers(histories)
    assert list(result["ticker"]) == ["DOWN", "FLAT"]


def test_screen_tickers_skips_tickers_with_no_data():
    result = screen_tickers({"EMPTY": pd.DataFrame()})
    assert result.empty
