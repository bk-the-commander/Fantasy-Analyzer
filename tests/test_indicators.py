"""Unit tests for technical indicator math -- pure pandas, no network."""
import pandas as pd
import pytest

from finance_tracker.indicators import crossed_above, macd, pct_off_52w_high, pct_off_52w_low, rsi, sma


def test_sma_basic():
    closes = pd.Series([1, 2, 3, 4, 5])
    result = sma(closes, window=2)
    assert result.iloc[-1] == pytest.approx(4.5)
    assert pd.isna(result.iloc[0])


def test_rsi_all_gains_is_100():
    closes = pd.Series(range(1, 20))  # strictly increasing -> no losses
    result = rsi(closes, period=14)
    assert result.iloc[-1] == pytest.approx(100.0)


def test_rsi_all_losses_is_0():
    closes = pd.Series(range(20, 1, -1))  # strictly decreasing -> no gains
    result = rsi(closes, period=14)
    assert result.iloc[-1] == pytest.approx(0.0)


def test_rsi_flat_price_is_undefined_until_period_then_neutral():
    closes = pd.Series([10.0] * 20)
    result = rsi(closes, period=14)
    assert pd.isna(result.iloc[13])  # not enough data yet


def test_pct_off_52w_low_and_high():
    closes = pd.Series([100, 90, 80, 110])
    assert pct_off_52w_low(closes) == pytest.approx((110 - 80) / 80)
    assert pct_off_52w_high(closes) == pytest.approx((110 - 110) / 110)


def test_crossed_above_true_case():
    a = pd.Series([1, 2, 5])
    b = pd.Series([3, 3, 3])
    assert crossed_above(a, b) is True


def test_crossed_above_false_when_already_above():
    a = pd.Series([4, 5, 6])
    b = pd.Series([3, 3, 3])
    assert crossed_above(a, b) is False


def test_crossed_above_false_when_still_below():
    a = pd.Series([1, 2, 2.5])
    b = pd.Series([3, 3, 3])
    assert crossed_above(a, b) is False


def test_macd_columns_and_length():
    closes = pd.Series(range(1, 50), dtype=float)
    result = macd(closes)
    assert list(result.columns) == ["macd", "signal", "histogram"]
    assert len(result) == len(closes)
    assert result["histogram"].iloc[-1] == pytest.approx(
        result["macd"].iloc[-1] - result["signal"].iloc[-1]
    )
