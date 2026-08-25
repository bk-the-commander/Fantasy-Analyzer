"""Technical columns derived from a daily OHLCV series.

Every function here is pure: no network, no clock, no globals. That is what
makes the screener's numbers auditable -- if a column looks wrong, it can be
reproduced from the bars alone in a test.

Series convention throughout: `bars` is a dict of parallel lists ordered
oldest-first::

    {"t": [epoch_seconds, ...], "o": [...], "h": [...], "l": [...],
     "c": [...], "v": [...]}

Any function may return None when there is not enough history to compute an
honest answer. None means "unknown" and renders as a dash; it never means
zero, and it is never quietly filled in with a neighbouring value.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

# Trading-day counts for the lookback windows. Calendar windows would be more
# precise but the bars are trading days, and off-by-a-day on a 6-month return
# is noise next to the clarity of a fixed offset.
WINDOWS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252}


def _num(value):
    """Coerce to float, mapping anything non-finite to None."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def clean(bars: dict) -> dict:
    """Drop bars with a missing close and coerce everything to floats.

    Providers return nulls for halted sessions and for the not-yet-closed
    current bar. Carrying those through would put holes in every moving
    average, so they come out here, once, at the door.
    """
    keys = ("t", "o", "h", "l", "c", "v")
    rows = zip(*(bars.get(k) or [] for k in keys))
    out: dict[str, list] = {k: [] for k in keys}
    for t, o, h, low, c, v in rows:
        close = _num(c)
        if close is None or close <= 0:
            continue
        out["t"].append(int(t))
        out["o"].append(_num(o) if _num(o) else close)
        out["h"].append(_num(h) if _num(h) else close)
        out["l"].append(_num(low) if _num(low) else close)
        out["c"].append(close)
        out["v"].append(_num(v) or 0.0)
    return out


def sma(values: list[float], period: int) -> float | None:
    """Simple moving average of the last `period` values."""
    if len(values) < period or period <= 0:
        return None
    return sum(values[-period:]) / period


def pct_change(current: float | None, base: float | None) -> float | None:
    """Percent move from `base` to `current`, as a number like 1.5 for +1.5%."""
    current, base = _num(current), _num(base)
    if current is None or base is None or base == 0:
        return None
    return (current / base - 1.0) * 100.0


def performance(closes: list[float]) -> dict[str, float | None]:
    """Trailing returns over the standard screener windows.

    A window that reaches past the start of the series is None rather than
    being silently measured from the oldest bar available -- a "1 year" column
    computed off eight months of history is a lie that sorts to the top.
    """
    out: dict[str, float | None] = {}
    latest = closes[-1] if closes else None
    for name, offset in WINDOWS.items():
        idx = len(closes) - 1 - offset
        out[name] = pct_change(latest, closes[idx]) if idx >= 0 else None
    return out


def year_to_date(bars: dict) -> float | None:
    """Return since the last close of the previous calendar year.

    Measured against the final bar of the prior year, which is what every
    broker statement means by YTD -- not against the first bar of January.
    """
    closes, stamps = bars["c"], bars["t"]
    if not closes:
        return None
    this_year = datetime.fromtimestamp(stamps[-1], timezone.utc).year
    base = None
    for stamp, close in zip(stamps, closes):
        if datetime.fromtimestamp(stamp, timezone.utc).year < this_year:
            base = close
        else:
            break
    return pct_change(closes[-1], base)


def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI, the same smoothing every charting package uses.

    Needs period+1 closes to seed and is then smoothed forward over the rest
    of the series, so the value matches a chart rather than a naive average of
    only the last 14 bars.
    """
    if len(closes) < period + 1:
        return None
    gains = losses = 0.0
    for prev, cur in zip(closes[:period], closes[1 : period + 1]):
        delta = cur - prev
        gains += max(delta, 0.0)
        losses += max(-delta, 0.0)
    avg_gain, avg_loss = gains / period, losses / period
    for prev, cur in zip(closes[period:-1], closes[period + 1 :]):
        delta = cur - prev
        avg_gain = (avg_gain * (period - 1) + max(delta, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-delta, 0.0)) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def atr(bars: dict, period: int = 14) -> float | None:
    """Average true range in dollars, Wilder-smoothed."""
    highs, lows, closes = bars["h"], bars["l"], bars["c"]
    if len(closes) < period + 1:
        return None
    trs = [
        max(h - l, abs(h - prev), abs(l - prev))
        for h, l, prev in zip(highs[1:], lows[1:], closes[:-1])
    ]
    value = sum(trs[:period]) / period
    for tr in trs[period:]:
        value = (value * (period - 1) + tr) / period
    return value


def volatility(closes: list[float], period: int) -> float | None:
    """Mean absolute daily move over `period` sessions, in percent.

    This is the definition Finviz's Volatility W / Volatility M columns use --
    average absolute daily change, not an annualised standard deviation.
    """
    if len(closes) < period + 1:
        return None
    moves = [
        abs(cur / prev - 1.0) * 100.0
        for prev, cur in zip(closes[-period - 1 : -1], closes[-period:])
        if prev
    ]
    return sum(moves) / len(moves) if moves else None


def extremes(bars: dict, period: int = 252) -> tuple[float | None, float | None]:
    """Highest high and lowest low over the trailing `period` bars."""
    highs, lows = bars["h"][-period:], bars["l"][-period:]
    if not highs or not lows:
        return None, None
    return max(highs), min(lows)


def technicals(bars: dict) -> dict:
    """Every technical screener column for one symbol.

    Returns a flat dict ready to merge into a screener row. Keys mirror the
    column ids the front end sorts on.
    """
    bars = clean(bars)
    closes, volumes = bars["c"], bars["v"]
    if not closes:
        return {}

    last = closes[-1]
    prev_close = closes[-2] if len(closes) > 1 else None
    high_52, low_52 = extremes(bars)
    avg_volume = sma(volumes, 63) or (sum(volumes) / len(volumes) if volumes else None)
    perf = performance(closes)

    row = {
        "price": last,
        "prev_close": prev_close,
        "change": pct_change(last, prev_close),
        "open": bars["o"][-1],
        "high": bars["h"][-1],
        "low": bars["l"][-1],
        "volume": volumes[-1] if volumes else None,
        "avg_volume": avg_volume,
        "rel_volume": (volumes[-1] / avg_volume) if avg_volume else None,
        "gap": pct_change(bars["o"][-1], prev_close),
        "rsi": rsi(closes),
        "atr": atr(bars),
        "volatility_w": volatility(closes, 5),
        "volatility_m": volatility(closes, 21),
        "high_52w": high_52,
        "low_52w": low_52,
        "from_high_52w": pct_change(last, high_52),
        "from_low_52w": pct_change(last, low_52),
        "ytd": year_to_date(bars),
        "bars": len(closes),
    }
    for name, value in perf.items():
        row["perf_" + name] = value
    for period in (20, 50, 200):
        average = sma(closes, period)
        row[f"sma{period}"] = average
        row[f"from_sma{period}"] = pct_change(last, average)
    return row


def apply_quote(row: dict, quote: dict) -> dict:
    """Fold a fresh intraday quote into a row built from daily bars.

    The daily build runs after the close; the quote refresh runs every quarter
    hour while the market is open. Rather than recompute a year of history for
    a price tick, the columns that actually move intraday are recomputed off
    the live print and the rest are left as the close-of-day build found them.
    Moving averages deliberately stay put: an SMA that silently included a
    partial session would disagree with every chart the user cross-checks.
    """
    price = _num(quote.get("price"))
    if price is None:
        return row

    updated = dict(row)
    prev_close = _num(quote.get("prev_close")) or row.get("prev_close")
    updated["price"] = price
    updated["prev_close"] = prev_close
    updated["change"] = pct_change(price, prev_close)
    for key in ("open", "high", "low"):
        if _num(quote.get(key)) is not None:
            updated[key] = _num(quote[key])
    if _num(quote.get("volume")) is not None:
        updated["volume"] = _num(quote["volume"])
        if updated.get("avg_volume"):
            updated["rel_volume"] = updated["volume"] / updated["avg_volume"]
    if updated.get("open") is not None:
        updated["gap"] = pct_change(updated["open"], prev_close)

    # Distance-from-average columns are the point of a live screener, so they
    # do move -- the average is yesterday's, the price is now.
    for period in (20, 50, 200):
        updated[f"from_sma{period}"] = pct_change(price, row.get(f"sma{period}"))
    for key, base in (("from_high_52w", "high_52w"), ("from_low_52w", "low_52w")):
        updated[key] = pct_change(price, row.get(base))
    if row.get("high_52w") is not None:
        updated["high_52w"] = max(row["high_52w"], price)
    if row.get("low_52w") is not None:
        updated["low_52w"] = min(row["low_52w"], price)
    updated["intraday"] = True
    return updated
