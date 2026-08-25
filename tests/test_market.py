"""Tests for the market pipeline.

The split mirrors the package: metrics is pure and gets exercised directly,
sources is tested through its parsers against recorded payload shapes (no
socket is opened here), and build is tested on its aggregation logic.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

import pytest

from market import build, demo, metrics, sources, universe


# ------------------------------------------------------------------ fixtures

def make_bars(closes, start_day="2026-01-02"):
    """Turn a list of closes into a bar series with plausible OHLC and volume."""
    base = datetime.fromisoformat(start_day).replace(tzinfo=timezone.utc)
    stamps, opens, highs, lows, volumes = [], [], [], [], []
    day = base
    for index, close in enumerate(closes):
        while day.weekday() >= 5:
            day += timedelta(days=1)
        stamps.append(int(day.timestamp()))
        day += timedelta(days=1)
        previous = closes[index - 1] if index else close
        opens.append(previous)
        highs.append(max(previous, close) * 1.01)
        lows.append(min(previous, close) * 0.99)
        volumes.append(1_000_000 + index * 1000)
    return {"t": stamps, "o": opens, "h": highs, "l": lows, "c": list(closes), "v": volumes}


# -------------------------------------------------------------------- metrics

def test_clean_drops_bars_without_a_close():
    bars = {"t": [1, 2, 3], "o": [1, None, 3], "h": [1, 2, 3],
            "l": [1, 2, 3], "c": [10, None, 12], "v": [5, 5, None]}
    cleaned = metrics.clean(bars)
    assert cleaned["c"] == [10.0, 12.0]
    assert cleaned["t"] == [1, 3]
    # A missing open falls back to the close rather than to zero.
    assert cleaned["o"] == [1.0, 3.0]
    assert cleaned["v"] == [5.0, 0.0]


def test_sma_needs_a_full_window():
    assert metrics.sma([1, 2, 3], 5) is None
    assert metrics.sma([1, 2, 3, 4], 4) == 2.5


def test_pct_change_guards_a_zero_base():
    assert metrics.pct_change(110, 100) == pytest.approx(10.0)
    assert metrics.pct_change(110, 0) is None
    assert metrics.pct_change(None, 100) is None


def test_performance_is_none_past_the_start_of_the_series():
    closes = [100.0] * 30
    closes[-1] = 110.0
    perf = metrics.performance(closes)
    assert perf["1w"] == pytest.approx(10.0)
    assert perf["1m"] == pytest.approx(10.0)
    # Only 30 bars exist, so a 3-month or 1-year number would be a fabrication.
    assert perf["3m"] is None
    assert perf["1y"] is None


def test_year_to_date_measures_from_the_prior_year_close():
    bars = make_bars([100.0, 101.0, 120.0], start_day="2025-12-30")
    # The first two bars land in 2025; the last is 2026, so YTD is measured
    # against the final 2025 close rather than the first bar of the series.
    assert metrics.year_to_date(bars) == pytest.approx((120 / 101 - 1) * 100)


def test_rsi_matches_wilders_definition_at_the_extremes():
    assert metrics.rsi([10.0] * 30) == 50.0
    assert metrics.rsi([10.0 + i for i in range(30)]) == 100.0
    assert metrics.rsi([100.0 - i for i in range(30)]) == 0.0
    assert metrics.rsi([1.0, 2.0, 3.0]) is None


def test_rsi_is_smoothed_over_the_whole_series_not_just_the_last_window():
    """A late reversal must not fully erase the earlier trend."""
    closes = [100.0 + i for i in range(40)] + [140.0 - i for i in range(14)]
    value = metrics.rsi(closes)
    assert value is not None
    # Naively averaging only the final 14 bars would read 0; Wilder smoothing
    # keeps the long uptrend in the average.
    assert 15 < value < 50


def test_atr_and_volatility_need_enough_history():
    assert metrics.atr(make_bars([100.0] * 5)) is None
    bars = make_bars([100.0 + (i % 3) for i in range(40)])
    assert metrics.atr(bars) > 0
    assert metrics.volatility(bars["c"], 5) > 0
    assert metrics.volatility([100.0], 5) is None


def test_technicals_produces_the_screener_columns():
    closes = [100.0 * (1.001 ** i) for i in range(260)]
    row = metrics.technicals(make_bars(closes))
    for key in ("price", "change", "rsi", "atr", "sma20", "sma50", "sma200",
                "from_sma200", "high_52w", "low_52w", "perf_1m", "perf_1y",
                "rel_volume", "volatility_m"):
        assert row[key] is not None, key
    assert row["price"] == pytest.approx(closes[-1])
    assert row["bars"] == 260
    assert row["from_high_52w"] <= 0        # nothing trades above its own high
    assert row["from_low_52w"] >= 0


def test_technicals_on_an_empty_series_is_empty_not_an_exception():
    assert metrics.technicals({"t": [], "o": [], "h": [], "l": [], "c": [], "v": []}) == {}


def test_apply_quote_refreshes_price_but_leaves_the_averages_alone():
    row = metrics.technicals(make_bars([100.0] * 260))
    before_sma = row["sma200"]
    updated = metrics.apply_quote(row, {"price": 110.0, "prev_close": 100.0,
                                        "open": 101.0, "high": 111.0, "low": 100.5,
                                        "volume": 5_000_000})
    assert updated["price"] == 110.0
    assert updated["change"] == pytest.approx(10.0)
    # The average is still yesterday's -- only the distance to it moved.
    assert updated["sma200"] == before_sma
    assert updated["from_sma200"] == pytest.approx((110.0 / before_sma - 1) * 100)
    assert updated["high_52w"] >= 110.0
    assert updated["intraday"] is True


def test_apply_quote_ignores_a_quote_with_no_price():
    row = {"price": 50.0, "prev_close": 49.0}
    assert metrics.apply_quote(row, {"price": None}) == row


# -------------------------------------------------------------------- sources

def test_parse_chart_reads_yahoos_envelope():
    payload = {"chart": {"result": [{
        "timestamp": [1, 2],
        "indicators": {"quote": [{"open": [1, 2], "high": [2, 3], "low": [0.5, 1],
                                  "close": [1.5, 2.5], "volume": [10, 20]}]},
        "meta": {"currency": "USD", "longName": "Example Inc",
                 "fullExchangeName": "NasdaqGS", "chartPreviousClose": 1.4},
    }]}}
    bars = sources.parse_chart(payload)
    assert bars["c"] == [1.5, 2.5]
    assert bars["meta"]["name"] == "Example Inc"
    assert bars["meta"]["exchange"] == "NasdaqGS"


def test_parse_chart_returns_none_for_an_empty_or_error_payload():
    assert sources.parse_chart({}) is None
    assert sources.parse_chart({"chart": {"result": []}}) is None
    assert sources.parse_chart({"chart": {"result": [{"timestamp": [], "indicators": {}}]}}) is None


def test_parse_quote_summary_unwraps_raw_values_and_converts_ratios():
    payload = {"quoteSummary": {"result": [{
        "price": {"longName": "Example Inc", "marketCap": {"raw": 1.5e12}},
        "assetProfile": {"sector": "Technology", "industry": "Semiconductors", "country": "USA"},
        "summaryDetail": {"trailingPE": {"raw": 28.4}, "dividendYield": {"raw": 0.0052}},
        "defaultKeyStatistics": {"trailingEps": {"raw": 6.1}, "heldPercentInsiders": {"raw": 0.031}},
        "financialData": {"profitMargins": {"raw": 0.243}, "returnOnEquity": {"raw": 0.51}},
        "calendarEvents": {"earnings": {"earningsDate": [{"raw": 1780000000}]}},
    }]}}
    parsed = sources.parse_quote_summary(payload)
    assert parsed["sector"] == "Technology"
    assert parsed["market_cap"] == 1.5e12
    # Yahoo hands back ratios; the screener shows percentages.
    assert parsed["profit_margin"] == pytest.approx(24.3)
    assert parsed["roe"] == pytest.approx(51.0)
    assert parsed["insider_own"] == pytest.approx(3.1)
    assert parsed["dividend_yield"] == pytest.approx(0.52)
    assert parsed["earnings_date"] == 1780000000


def test_parse_quote_summary_returns_none_when_the_module_is_missing():
    assert sources.parse_quote_summary({"quoteSummary": {"result": []}}) is None
    assert sources.parse_quote_summary(None) is None


def test_parse_rss_reads_titles_links_and_timestamps():
    body = b"""<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Example beats estimates</title><link>https://example.com/a</link>
        <pubDate>Mon, 24 Aug 2026 13:45:00 GMT</pubDate></item>
      <item><title></title><link>https://example.com/skip</link></item>
    </channel></rss>"""
    items = sources.parse_rss(body, symbol="EXA")
    assert len(items) == 1                    # the untitled item is dropped
    assert items[0]["title"] == "Example beats estimates"
    assert items[0]["symbol"] == "EXA"
    assert items[0]["published"] > 0


def test_parse_rss_survives_malformed_xml():
    assert sources.parse_rss(b"<rss><channel><item>") == []


FORM4 = b"""<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector><isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-10</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1500</value></transactionShares>
        <transactionPricePerShare><value>212.50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>48000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-11</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>800</value></transactionShares>
        <transactionPricePerShare><value>210.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>"""


def test_parse_form4_extracts_both_transactions_with_roles():
    rows = sources.parse_form4(FORM4, symbol="EXA", filed="2026-08-12", accession="0001-26-1")
    assert len(rows) == 2

    sale, purchase = rows
    assert sale["person"] == "DOE JANE"
    assert "Director" in sale["title"] and "Chief Executive Officer" in sale["title"]
    assert sale["label"] == "Sell" and sale["kind"] == "sell"
    assert sale["shares"] == 1500 and sale["price"] == 212.50
    assert sale["value"] == pytest.approx(318750.0)
    assert sale["shares_after"] == 48000
    assert sale["date"] == "2026-08-10"

    assert purchase["label"] == "Buy" and purchase["kind"] == "buy"
    assert purchase["direction"] == "A"
    # A filing need not report post-transaction holdings.
    assert purchase["shares_after"] is None


def test_parse_form4_labels_grants_as_compensation_not_conviction():
    body = FORM4.replace(b"<transactionCode>P</transactionCode>", b"<transactionCode>A</transactionCode>")
    rows = sources.parse_form4(body, symbol="EXA", filed="2026-08-12")
    assert rows[1]["kind"] == "grant"
    assert rows[1]["label"] == "Grant"


def test_parse_form4_survives_malformed_xml():
    assert sources.parse_form4(b"not xml", symbol="EXA", filed="2026-01-01") == []


def test_rate_limiter_spaces_calls_apart():
    limiter = sources.RateLimiter(per_second=50)
    import time
    start = time.monotonic()
    for _ in range(5):
        limiter.wait()
    assert time.monotonic() - start >= 0.06     # 4 gaps of 20ms, minus slack


# ---------------------------------------------------------------------- build

def test_compact_rounds_and_drops_nulls():
    row = build._compact({"symbol": "EXA", "price": 123.456789, "pe": None,
                          "change": 1.23456, "eps": 0.123456})
    assert row["price"] == 123.46
    assert row["change"] == 1.23
    assert row["eps"] == 0.1235          # sub-$10 values keep more precision
    assert "pe" not in row


def test_compact_drops_non_finite_floats():
    row = build._compact({"symbol": "EXA", "pe": float("inf"), "ps": float("nan")})
    assert "pe" not in row and "ps" not in row


def test_aggregate_groups_reports_both_weightings():
    rows = [
        {"sector": "Tech", "industry": "Semis", "change": 2.0, "market_cap": 100.0},
        {"sector": "Tech", "industry": "Software", "change": -1.0, "market_cap": 900.0},
    ]
    sectors = build.aggregate_groups(rows)["sectors"]
    tech = next(group for group in sectors if group["name"] == "Tech")
    assert tech["count"] == 2
    assert tech["change"] == pytest.approx(0.5)        # equal-weighted
    assert tech["change_cap"] == pytest.approx(-0.7)   # cap-weighted
    assert tech["advancing"] == 1 and tech["declining"] == 1


def test_aggregate_groups_sorts_by_size_and_buckets_the_unclassified():
    rows = [{"sector": None, "change": 1.0, "market_cap": 10.0},
            {"sector": "Big", "change": 1.0, "market_cap": 500.0}]
    sectors = build.aggregate_groups(rows)["sectors"]
    assert [group["name"] for group in sectors] == ["Big", "Unclassified"]


def test_breadth_counts_advances_declines_and_extremes():
    rows = [
        {"change": 1.0, "from_sma200": 4.0, "from_high_52w": -0.1, "from_low_52w": 60.0},
        {"change": -2.0, "from_sma200": -3.0, "from_high_52w": -30.0, "from_low_52w": 0.2},
        {"change": 0.0},
        {"change": None},
    ]
    result = build.breadth(rows)
    assert result["advancing"] == 1
    assert result["declining"] == 1
    assert result["unchanged"] == 1
    assert result["counted"] == 3          # the unpriced row is not counted
    assert result["new_highs"] == 1
    assert result["new_lows"] == 1
    assert result["above_sma200"] == 1


def test_dedupe_news_collapses_one_story_across_many_symbols():
    items = [
        {"title": "Rates hold", "link": "https://x/1", "published": 20, "symbol": "AAA"},
        {"title": "Rates hold", "link": "https://x/1", "published": 20, "symbol": "BBB"},
        {"title": "Other", "link": "https://x/2", "published": 30, "symbol": "CCC"},
    ]
    merged = build._dedupe_news(items)
    assert len(merged) == 2
    assert merged[0]["title"] == "Other"                 # newest first
    shared = next(item for item in merged if item["link"] == "https://x/1")
    assert shared["symbols"] == ["AAA", "BBB"]
    assert "symbol" not in shared


def test_quote_row_maps_yahoos_field_names():
    quote = build._quote_row({"regularMarketPrice": 10.0, "regularMarketPreviousClose": 9.0,
                              "regularMarketVolume": 1234})
    assert quote["price"] == 10.0 and quote["prev_close"] == 9.0 and quote["volume"] == 1234


def test_safe_filename_handles_index_and_class_symbols():
    assert build._safe("^GSPC") == "_GSPC"
    assert build._safe("BRK-B") == "BRK-B"


# ------------------------------------------------------------------- universe

def test_universe_parses_comments_blank_lines_and_multiple_symbols(tmp_path):
    path = tmp_path / "u.txt"
    path.write_text("# a comment\n\nAAPL MSFT  # trailing comment\nmsft\n  nvda\n")
    assert universe.load(path) == ["AAPL", "MSFT", "NVDA"]   # de-duplicated, upper-cased


def test_shipped_universe_is_non_trivial_and_unique():
    symbols = universe.load()
    assert len(symbols) > 400
    assert len(set(symbols)) == len(symbols)
    assert "AAPL" in symbols and "SPY" in symbols


# ----------------------------------------------------------------------- demo

def test_demo_dataset_is_self_consistent_and_clearly_labelled(tmp_path):
    meta = demo.generate(tmp_path, count=24, seed=7)
    assert meta["source"] == "demo"
    assert "invented" in meta["notice"]

    rows = json.loads((tmp_path / "screener.json").read_text())
    assert len(rows) == 24 + len(demo.DEMO_ETFS)
    assert all(row["name"].endswith("(demo)") for row in rows)

    for row in rows:
        if row.get("quote_type") != "EQUITY":
            continue
        # P/E, P/S and profit margin are derived from one another, so a screen
        # that filters on all three cannot return a contradiction.
        if row.get("pe"):
            assert row["pe"] == pytest.approx(row["ps"] / (row["profit_margin"] / 100), rel=0.02)
        else:
            assert row["profit_margin"] <= 0     # only losses lack a trailing P/E

    for name in ("meta.json", "groups.json", "news.json", "insider.json"):
        assert (tmp_path / name).exists()
    assert (tmp_path / "tickers" / f"{rows[0]['symbol']}.json").exists()


def test_demo_series_ends_on_the_most_recent_weekday(tmp_path):
    demo.generate(tmp_path, count=3, seed=11)
    rows = json.loads((tmp_path / "screener.json").read_text())
    bars = json.loads((tmp_path / "tickers" / f"{rows[0]['symbol']}.json").read_text())["bars"]
    last = datetime.fromtimestamp(bars["t"][-1], timezone.utc).date()
    today = datetime.now(timezone.utc).date()
    assert (today - last).days <= 3          # today, or the Friday before a weekend
    assert all(datetime.fromtimestamp(stamp, timezone.utc).weekday() < 5 for stamp in bars["t"])


def test_demo_is_deterministic_for_a_seed(tmp_path):
    first = demo.generate(tmp_path / "a", count=6, seed=99)
    second = demo.generate(tmp_path / "b", count=6, seed=99)
    assert (tmp_path / "a" / "screener.json").read_text() == (tmp_path / "b" / "screener.json").read_text()
    assert first["symbols"] == second["symbols"]


# ------------------------------------------------------- failure behaviour

def test_circuit_breaker_stops_retrying_a_dead_provider(monkeypatch):
    """A provider that is down must fail fast, not retry 580 symbols x3."""
    client = sources.Client(requests_per_second=1000)
    client._circuit_threshold = 3

    attempts = {"count": 0}

    def always_fails(*args, **kwargs):
        attempts["count"] += 1
        raise sources.requests.ConnectionError("no route")

    monkeypatch.setattr(client.session, "get", always_fails)
    monkeypatch.setattr(sources.time, "sleep", lambda _: None)

    for _ in range(3):
        assert client._get("https://example.test", limiter=client._yahoo) is None
    assert client.circuit_open

    before = attempts["count"]
    assert client._get("https://example.test", limiter=client._yahoo) is None
    # One attempt now, not three.
    assert attempts["count"] - before == 1


def test_a_success_closes_the_circuit_again():
    client = sources.Client(requests_per_second=1000)
    client._circuit_threshold = 2
    client._record(False)
    client._record(False)
    assert client.circuit_open
    client._record(True)
    assert not client.circuit_open


def test_a_404_is_a_definitive_answer_not_an_outage(monkeypatch):
    """A delisted symbol must not push the breaker toward tripping."""
    client = sources.Client(requests_per_second=1000)

    class Missing:
        status_code = 404

    monkeypatch.setattr(client.session, "get", lambda *a, **k: Missing())
    for _ in range(30):
        assert client._get("https://example.test/gone", limiter=client._yahoo) is None
    assert not client.circuit_open


def test_build_refuses_to_publish_an_empty_dataset(tmp_path, monkeypatch):
    """An outage must leave the previous dataset in place, not blank it."""
    existing = tmp_path / "screener.json"
    existing.parent.mkdir(parents=True, exist_ok=True)
    existing.write_text('[{"symbol":"KEEP"}]')

    monkeypatch.setattr(build.universe, "load", lambda path=None: ["AAA", "BBB"])
    monkeypatch.setattr(build.sources.Client, "history", lambda self, *a, **k: None)
    monkeypatch.setattr(build.sources.Client, "quotes", lambda self, *a, **k: {})

    meta = build.build(tmp_path, mode="daily", cache_dir=None)
    assert meta["symbols"] == 0
    assert meta["source"] == "failed"
    # The good data is untouched.
    assert json.loads(existing.read_text()) == [{"symbol": "KEEP"}]


def test_build_main_exits_non_zero_when_nothing_was_priced(tmp_path, monkeypatch):
    monkeypatch.setattr(build.universe, "load", lambda path=None: ["AAA"])
    monkeypatch.setattr(build.sources.Client, "history", lambda self, *a, **k: None)
    monkeypatch.setattr(build.sources.Client, "quotes", lambda self, *a, **k: {})
    assert build.main(["--out", str(tmp_path), "--mode", "daily"]) == 1
