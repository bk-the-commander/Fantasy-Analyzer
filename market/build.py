"""Turns the universe into the JSON the terminal reads.

    python scripts/build_market_data.py --out web/market/data

Two shapes of run, chosen by --mode:

    daily    pull a year of bars, fundamentals, headlines and Form 4s.
             Roughly 1,300 requests; run it once after the close.
    quotes   reuse the cached bars and refresh only live prices. Six
             requests for the whole universe; run it every 15 minutes.
    auto     quotes if the cache is warm, daily otherwise (the default).

Output layout under --out:

    meta.json          when this ran, against what, and how it went
    screener.json      one row per symbol, every column
    groups.json        sector and industry aggregates
    news.json          recent headlines
    insider.json       recent Form 4 transactions
    tickers/SYM.json   bars + profile + per-symbol news for the detail page
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from . import metrics, sources, universe

log = logging.getLogger("market.build")

# How much history the detail chart gets. A year of daily bars is ~11 KB per
# symbol after rounding, which keeps the whole dataset well inside what a
# static host serves comfortably.
HISTORY_RANGE = "1y"

# Insider data is the most expensive thing here -- several SEC round-trips per
# company -- so a daily run covers the largest names plus the day's biggest
# movers rather than all 580.
INSIDER_SYMBOLS = 80
NEWS_SYMBOLS = 60


def _round(value, places=2):
    """JSON-safe rounding. Non-finite floats become null rather than NaN."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return None
        return round(value, places)
    return value


def _compact(row: dict) -> dict:
    """Round a row for the wire and drop keys that carry no information."""
    money = {"price", "prev_close", "open", "high", "low", "sma20", "sma50",
             "sma200", "high_52w", "low_52w", "atr", "eps", "eps_forward", "target_price"}
    out = {}
    for key, value in row.items():
        if isinstance(value, float):
            # _round maps inf/nan to None, so this has to be tested after
            # rounding -- otherwise a non-finite value survives as a null key.
            value = _round(value, 4 if key in money and abs(value) < 10 else 2)
        if value is None:
            continue
        out[key] = value
    return out


def _write(path: Path, payload) -> int:
    """Write compact JSON and report the byte count for the build log."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def _quote_row(record: dict) -> dict:
    """Yahoo's batch-quote record -> the few fields apply_quote consumes."""
    return {
        "price": record.get("regularMarketPrice"),
        "prev_close": record.get("regularMarketPreviousClose"),
        "open": record.get("regularMarketOpen"),
        "high": record.get("regularMarketDayHigh"),
        "low": record.get("regularMarketDayLow"),
        "volume": record.get("regularMarketVolume"),
    }


def build_symbol(client: sources.Client, symbol: str, *, history_age: float,
                 fundamentals_age: float, want_fundamentals: bool) -> tuple[dict, dict] | None:
    """Assemble one screener row plus its detail payload.

    Returns (row, detail) or None when the symbol could not be priced at all --
    a delisting, a typo in universe.txt, or a provider hiccup. The caller logs
    it and carries on; one bad symbol must never fail a build.
    """
    bars = client.history(symbol, range_=HISTORY_RANGE, max_age_hours=history_age)
    if not bars:
        return None
    technical = metrics.technicals(bars)
    if not technical:
        return None

    meta = bars.get("meta") or {}
    row = {"symbol": symbol, "name": meta.get("name"), "exchange": meta.get("exchange")}
    row.update(technical)

    fundamentals = client.fundamentals(symbol, max_age_hours=fundamentals_age) if want_fundamentals else None
    if fundamentals:
        row["name"] = fundamentals.get("name") or row.get("name")
        for key in ("sector", "industry", "country", "market_cap", "pe", "forward_pe", "peg",
                    "ps", "pb", "eps", "eps_forward", "beta", "dividend_yield", "roe", "roa",
                    "gross_margin", "operating_margin", "profit_margin", "revenue",
                    "revenue_growth", "earnings_growth", "debt_to_equity", "current_ratio",
                    "shares_out", "float_shares", "short_percent_float", "short_ratio",
                    "insider_own", "institution_own", "target_price", "recommendation",
                    "analysts", "earnings_date", "quote_type"):
            if fundamentals.get(key) is not None:
                row[key] = fundamentals[key]

    # An ETF has no sector of its own; grouping them together is far more
    # useful than 90 rows of "n/a" scattered through the sector view.
    if not row.get("sector"):
        row["sector"] = "ETF" if (fundamentals or {}).get("quote_type") == "ETF" else "Unclassified"
        row.setdefault("industry", row["sector"])

    clean_bars = metrics.clean(bars)
    detail = {
        "symbol": symbol,
        "profile": fundamentals or {},
        "bars": {
            "t": clean_bars["t"],
            "o": [_round(v, 4) for v in clean_bars["o"]],
            "h": [_round(v, 4) for v in clean_bars["h"]],
            "l": [_round(v, 4) for v in clean_bars["l"]],
            "c": [_round(v, 4) for v in clean_bars["c"]],
            "v": [int(v) for v in clean_bars["v"]],
        },
    }
    return _compact(row), detail


def aggregate_groups(rows: list[dict]) -> dict:
    """Sector and industry roll-ups, cap-weighted and equal-weighted.

    Both weightings are published because they answer different questions: the
    cap-weighted number is what the sector ETF did, the equal-weighted one is
    what the average stock in it did, and the gap between them is often the
    most interesting thing on the page.
    """

    def summarise(bucket: list[dict], name: str) -> dict:
        caps = [r.get("market_cap") or 0 for r in bucket]
        total_cap = sum(caps)
        summary = {"name": name, "count": len(bucket), "market_cap": total_cap}
        for column in ("change", "perf_1w", "perf_1m", "perf_3m", "perf_6m", "perf_1y", "ytd"):
            values = [(r.get(column), r.get("market_cap") or 0) for r in bucket
                      if r.get(column) is not None]
            if not values:
                continue
            summary[column] = _round(sum(v for v, _ in values) / len(values))
            weight = sum(w for _, w in values)
            if weight:
                summary[column + "_cap"] = _round(sum(v * w for v, w in values) / weight)
        advancing = sum(1 for r in bucket if (r.get("change") or 0) > 0)
        summary["advancing"] = advancing
        summary["declining"] = sum(1 for r in bucket if (r.get("change") or 0) < 0)
        return summary

    def by(key: str) -> list[dict]:
        buckets: dict[str, list[dict]] = {}
        for row in rows:
            buckets.setdefault(row.get(key) or "Unclassified", []).append(row)
        out = [summarise(bucket, name) for name, bucket in buckets.items()]
        return sorted(out, key=lambda g: g.get("market_cap") or 0, reverse=True)

    return {"sectors": by("sector"), "industries": by("industry")}


def breadth(rows: list[dict]) -> dict:
    """Market-wide advance/decline and new-high/new-low counts."""
    priced = [r for r in rows if r.get("change") is not None]
    return {
        "advancing": sum(1 for r in priced if r["change"] > 0),
        "declining": sum(1 for r in priced if r["change"] < 0),
        "unchanged": sum(1 for r in priced if r["change"] == 0),
        "new_highs": sum(1 for r in rows if (r.get("from_high_52w") or -99) > -0.5),
        "new_lows": sum(1 for r in rows if (r.get("from_low_52w") or 99) < 0.5),
        "above_sma200": sum(1 for r in rows if (r.get("from_sma200") or 0) > 0),
        "counted": len(priced),
    }


def build(out_dir: Path, *, mode: str = "auto", limit: int | None = None,
          cache_dir: Path | None = None, workers: int = 8,
          universe_path: Path | None = None) -> dict:
    """Run a build and write the dataset. Returns the meta block."""
    started = time.time()
    symbols = universe.load(universe_path)
    if limit:
        symbols = symbols[:limit]

    client = sources.Client(cache_dir=cache_dir)
    warm = cache_dir and (Path(cache_dir) / "history").exists()
    if mode == "auto":
        mode = "quotes" if warm else "daily"
    daily = mode == "daily"
    log.info("building %d symbols in %s mode", len(symbols), mode)

    history_age = 8.0 if daily else 36.0
    fundamentals_age = 20.0 if daily else 240.0

    rows: list[dict] = []
    details: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(build_symbol, client, symbol, history_age=history_age,
                        fundamentals_age=fundamentals_age, want_fundamentals=True): symbol
            for symbol in symbols
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                result = future.result()
            except Exception as exc:  # one symbol must never sink the build
                log.warning("%s failed: %s", symbol, exc)
                continue
            if not result:
                log.warning("%s: no usable price history", symbol)
                continue
            row, detail = result
            rows.append(row)
            details[symbol] = detail

    # A run that priced nothing is an outage, not a market with no stocks in
    # it. Publishing that would replace a working dataset with an empty one, so
    # the build stops here -- before spending another thousand requests on
    # headlines and SEC filings for a universe it could not price -- and leaves
    # whatever is on disk alone.
    if not rows:
        log.error("no symbols priced (provider unavailable?) -- leaving the existing dataset in place")
        return {
            "generated_at": int(time.time()), "mode": mode, "source": "failed",
            "symbols": 0, "requested": len(symbols),
            "failed": sorted(set(client.failures)), "quotes_live": False,
            "duration_seconds": round(time.time() - started, 1),
            "breadth": {}, "indices": [], "history_range": HISTORY_RANGE,
        }

    # ---- live prices on top of the daily bars
    quotes = client.quotes([r["symbol"] for r in rows])
    if quotes:
        by_symbol = {r["symbol"]: r for r in rows}
        for symbol, record in quotes.items():
            if symbol in by_symbol:
                by_symbol[symbol].update(_compact(metrics.apply_quote(by_symbol[symbol], _quote_row(record))))
    log.info("quotes refreshed for %d/%d symbols", len(quotes), len(rows))

    index_rows = []
    for symbol, label in universe.INDICES:
        bars = client.history(symbol, range_="1y", max_age_hours=history_age)
        if not bars:
            continue
        technical = metrics.technicals(bars)
        if technical:
            index_rows.append(_compact({"symbol": symbol, "name": label, **technical}))
    index_quotes = client.quotes([s for s, _ in universe.INDICES])
    by_symbol = {r["symbol"]: r for r in index_rows}
    for symbol, record in index_quotes.items():
        if symbol in by_symbol:
            by_symbol[symbol].update(_compact(metrics.apply_quote(by_symbol[symbol], _quote_row(record))))

    rows.sort(key=lambda r: r.get("market_cap") or 0, reverse=True)

    # ---- headlines and insider activity (daily runs only; both are slow)
    news: list[dict] = []
    insider: list[dict] = []
    if daily:
        movers = sorted(rows, key=lambda r: abs(r.get("change") or 0), reverse=True)[:20]
        focus = list(dict.fromkeys([r["symbol"] for r in rows[:NEWS_SYMBOLS]]
                                   + [r["symbol"] for r in movers]))
        news.extend(client.news(None, limit=25))
        with ThreadPoolExecutor(max_workers=6) as pool:
            for headlines in pool.map(lambda s: client.news(s, limit=6), focus):
                news.extend(headlines)

        cik_map = client.sec_cik_map()
        insider_focus = [r["symbol"] for r in rows if r["symbol"] in cik_map][:INSIDER_SYMBOLS]
        with ThreadPoolExecutor(max_workers=4) as pool:
            for filings in pool.map(
                lambda s: client.insider_filings(s, cik_map[s], limit=4), insider_focus
            ):
                insider.extend(filings)
        insider.sort(key=lambda f: (f.get("filed") or "", f.get("date") or ""), reverse=True)

        for row in rows:
            symbol = row["symbol"]
            if symbol in details:
                details[symbol]["news"] = [n for n in news if n.get("symbol") == symbol][:10]
                details[symbol]["insider"] = [i for i in insider if i.get("symbol") == symbol][:20]

    news = _dedupe_news(news)

    # ---- write
    generated = int(time.time())
    meta = {
        "generated_at": generated,
        "generated_iso": datetime.fromtimestamp(generated, timezone.utc).isoformat(),
        "mode": mode,
        "source": "yahoo+sec",
        "symbols": len(rows),
        "requested": len(symbols),
        "failed": sorted(set(client.failures)),
        "quotes_live": bool(quotes),
        "duration_seconds": round(time.time() - started, 1),
        "breadth": breadth(rows),
        "indices": index_rows,
        "history_range": HISTORY_RANGE,
    }

    out_dir = Path(out_dir)
    written = {
        "meta.json": _write(out_dir / "meta.json", meta),
        "screener.json": _write(out_dir / "screener.json", rows),
        "groups.json": _write(out_dir / "groups.json", aggregate_groups(rows)),
        "news.json": _write(out_dir / "news.json", news[:250]),
        "insider.json": _write(out_dir / "insider.json", insider[:400]),
    }
    detail_bytes = 0
    for symbol, detail in details.items():
        detail_bytes += _write(out_dir / "tickers" / f"{_safe(symbol)}.json", detail)
    written["tickers/"] = detail_bytes

    log.info(
        "wrote %d symbols in %.1fs (%s)",
        len(rows),
        meta["duration_seconds"],
        ", ".join(f"{name} {size / 1024:.0f}KB" for name, size in written.items()),
    )
    return meta


def _dedupe_news(items: list[dict]) -> list[dict]:
    """Collapse the same headline arriving on several symbols' feeds.

    A market-wide story shows up on every constituent's feed. Keeping one copy
    and recording which symbols carried it turns 40 duplicate rows into one row
    with 40 tags.
    """
    merged: dict[str, dict] = {}
    for item in items:
        key = (item.get("link") or item.get("title") or "").strip().lower()
        if not key:
            continue
        existing = merged.get(key)
        if existing:
            symbols = set(existing.get("symbols") or [])
            if item.get("symbol"):
                symbols.add(item["symbol"])
            existing["symbols"] = sorted(symbols)
        else:
            entry = dict(item)
            entry["symbols"] = [item["symbol"]] if item.get("symbol") else []
            entry.pop("symbol", None)
            merged[key] = entry
    return sorted(merged.values(), key=lambda i: i.get("published") or 0, reverse=True)


def _safe(symbol: str) -> str:
    """Filename-safe symbol. BRK-B is fine; ^GSPC and BF-B need care."""
    return symbol.replace("^", "_").replace("/", "-")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="web/market/data", type=Path)
    parser.add_argument("--mode", choices=("auto", "daily", "quotes"), default="auto")
    parser.add_argument("--cache", default=".market-cache", type=Path)
    parser.add_argument("--universe", default=None, type=Path)
    parser.add_argument("--limit", type=int, default=None, help="first N symbols only")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    meta = build(args.out, mode=args.mode, limit=args.limit, cache_dir=args.cache,
                 workers=args.workers, universe_path=args.universe)
    if not meta["symbols"]:
        log.error("no symbols priced -- refusing to publish an empty dataset")
        return 1
    return 0
