"""Every outbound request the pipeline makes.

Nothing else in the package touches the network. Providers change their minds
about URLs and auth roughly once a year; when that happens this is the only
file that needs an edit.

Providers used, all free and all key-less:

    Yahoo Finance   prices, OHLCV history, fundamentals   (undocumented API)
    Yahoo RSS       per-symbol and market headlines
    SEC EDGAR       insider Form 4 transactions           (official, rate-limited)

Yahoo's endpoints are not a published product and can break without notice.
Every fetch here therefore degrades rather than raises: a symbol that fails
comes back as None, the build logs it, and the remaining 579 still publish.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

import requests

log = logging.getLogger("market.sources")

YAHOO_HOSTS = ("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com")
YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline"
SEC_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}"

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# The SEC asks automated clients to identify themselves with a contact route
# and throttles anything that does not. Point SEC_USER_AGENT at your own email
# if you ever run this hard enough to matter to them.
SEC_UA = os.environ.get(
    "SEC_USER_AGENT", "Kaliris Markets/1.0 (github.com/bk-the-commander/Fantasy-Analyzer)"
)


class RateLimiter:
    """Smallest thing that keeps us a polite client: a per-host minimum gap."""

    def __init__(self, per_second: float):
        self._gap = 1.0 / per_second if per_second > 0 else 0.0
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            sleep_for = self._next - now
            self._next = max(now, self._next) + self._gap
        if sleep_for > 0:
            time.sleep(sleep_for)


class Client:
    """A requests session with retries, throttling and an optional disk cache.

    The cache is what makes a 15-minute refresh cheap. A full build stores each
    symbol's year of daily bars under `cache/`; later runs on the same trading
    day reuse them and fetch only live quotes, turning ~600 history requests
    into one batched quote call.
    """

    def __init__(self, cache_dir: str | Path | None = None, requests_per_second: float = 6.0):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": BROWSER_UA, "Accept": "application/json"})
        self.cache_dir = Path(cache_dir) if cache_dir else None
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._yahoo = RateLimiter(requests_per_second)
        self._sec = RateLimiter(8.0)  # SEC's published ceiling is 10/s
        self._crumb: str | None = None
        self.failures: list[str] = []

        # Circuit breaker. When a provider is genuinely down -- an endpoint
        # moved, the network is blocked, the runner has no egress -- retrying
        # 580 symbols three times each with backoff turns a fast failure into a
        # twenty-minute one. After this many consecutive failures with no
        # success in between, requests stop retrying and return immediately;
        # any success closes the circuit again.
        self._consecutive_failures = 0
        self._circuit_threshold = 25

    # ---------------------------------------------------------------- plumbing

    @property
    def circuit_open(self) -> bool:
        """True once the provider has failed enough times to stop trying."""
        return self._consecutive_failures >= self._circuit_threshold

    def _record(self, ok: bool) -> None:
        if ok:
            self._consecutive_failures = 0
        else:
            self._consecutive_failures += 1
            if self._consecutive_failures == self._circuit_threshold:
                log.error(
                    "%d consecutive request failures -- treating the provider as "
                    "unavailable and failing fast for the rest of this run",
                    self._circuit_threshold,
                )

    def _get(self, url: str, *, limiter: RateLimiter, params=None, headers=None, tries=3):
        """GET with backoff. Returns a Response, or None once retries run out."""
        if self.circuit_open:
            tries = 1
        for attempt in range(tries):
            limiter.wait()
            try:
                response = self.session.get(url, params=params, headers=headers, timeout=20)
            except requests.RequestException as exc:
                log.debug("%s: %s", url, exc)
            else:
                if response.status_code == 200:
                    self._record(True)
                    return response
                # 404 means the symbol is gone; retrying will not resurrect it.
                if response.status_code in (400, 401, 403, 404):
                    log.debug("%s -> HTTP %s", url, response.status_code)
                    if response.status_code not in (401, 403):
                        self._record(True)   # a definitive answer, not an outage
                        return None
                log.debug("%s -> HTTP %s (retrying)", url, response.status_code)
            if attempt < tries - 1 and not self.circuit_open:
                time.sleep(1.5 * (attempt + 1))
        self._record(False)
        return None

    def _get_json(self, url: str, *, limiter: RateLimiter, params=None, headers=None):
        response = self._get(url, limiter=limiter, params=params, headers=headers)
        if response is None:
            return None
        try:
            return response.json()
        except ValueError:
            log.debug("%s returned non-JSON", url)
            return None

    def _cache_path(self, kind: str, key: str) -> Path | None:
        if not self.cache_dir:
            return None
        safe = re.sub(r"[^A-Za-z0-9._^-]", "_", key)
        directory = self.cache_dir / kind
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"{safe}.json"

    def cache_read(self, kind: str, key: str, max_age_hours: float):
        """Return a cached payload if it is younger than `max_age_hours`."""
        path = self._cache_path(kind, key)
        if not path or not path.exists():
            return None
        if (time.time() - path.stat().st_mtime) > max_age_hours * 3600:
            return None
        try:
            return json.loads(path.read_text())
        except (ValueError, OSError):
            return None

    def cache_write(self, kind: str, key: str, payload) -> None:
        path = self._cache_path(kind, key)
        if path:
            try:
                path.write_text(json.dumps(payload, separators=(",", ":")))
            except OSError as exc:
                log.debug("cache write failed for %s: %s", key, exc)

    # ------------------------------------------------------------------ yahoo

    def _crumb_token(self) -> str | None:
        """Yahoo's quote endpoint wants a cookie plus a matching crumb.

        One handshake per process: hit the consent-free host to pick up the
        cookie, then trade it for a crumb. If either step fails we return None
        and the caller falls back to the chart endpoint, which needs neither.
        """
        if self._crumb is not None:
            return self._crumb or None
        try:
            self._yahoo.wait()
            self.session.get("https://fc.yahoo.com", timeout=15)
        except requests.RequestException:
            pass
        response = self._get(
            "https://query1.finance.yahoo.com/v1/test/getcrumb",
            limiter=self._yahoo,
            headers={"Accept": "text/plain"},
        )
        crumb = (response.text or "").strip() if response is not None else ""
        self._crumb = crumb if "<" not in crumb else ""
        if not self._crumb:
            log.info("no Yahoo crumb; using chart endpoint for quotes")
        return self._crumb or None

    def history(self, symbol: str, *, range_: str = "1y", interval: str = "1d",
                max_age_hours: float = 8.0) -> dict | None:
        """A year of daily bars for one symbol, cached per trading session."""
        cached = self.cache_read("history", f"{symbol}-{range_}-{interval}", max_age_hours)
        if cached:
            return cached

        payload = None
        for host in YAHOO_HOSTS:
            payload = self._get_json(
                f"{host}/v8/finance/chart/{quote_plus(symbol)}",
                limiter=self._yahoo,
                params={"range": range_, "interval": interval, "includePrePost": "false"},
            )
            if payload:
                break
        bars = parse_chart(payload)
        if bars is None:
            self.failures.append(symbol)
            return None
        self.cache_write("history", f"{symbol}-{range_}-{interval}", bars)
        return bars

    def quotes(self, symbols: list[str], chunk: int = 100) -> dict[str, dict]:
        """Live-ish quotes for many symbols in as few requests as possible.

        Yahoo's batch endpoint takes ~100 symbols per call, so the whole
        universe is six requests. Without a crumb it refuses, and the caller is
        expected to fall back to per-symbol history.
        """
        crumb = self._crumb_token()
        if not crumb:
            return {}
        out: dict[str, dict] = {}
        for start in range(0, len(symbols), chunk):
            batch = symbols[start : start + chunk]
            payload = None
            for host in YAHOO_HOSTS:
                payload = self._get_json(
                    f"{host}/v7/finance/quote",
                    limiter=self._yahoo,
                    params={"symbols": ",".join(batch), "crumb": crumb},
                )
                if payload:
                    break
            for record in ((payload or {}).get("quoteResponse") or {}).get("result") or []:
                symbol = record.get("symbol")
                if symbol:
                    out[symbol] = record
        return out

    def fundamentals(self, symbol: str, max_age_hours: float = 20.0) -> dict | None:
        """Sector, industry and the valuation/financial columns for one symbol.

        Cached for the best part of a day: a company's sector does not change
        between the open and the close, and re-pulling it every quarter hour
        would quadruple the request budget for no new information.
        """
        cached = self.cache_read("fundamentals", symbol, max_age_hours)
        if cached is not None:
            return cached

        modules = "assetProfile,summaryDetail,defaultKeyStatistics,financialData,price,calendarEvents"
        payload = None
        for host in YAHOO_HOSTS:
            params = {"modules": modules}
            if self._crumb_token():
                params["crumb"] = self._crumb
            payload = self._get_json(
                f"{host}/v10/finance/quoteSummary/{quote_plus(symbol)}",
                limiter=self._yahoo,
                params=params,
            )
            if payload and (payload.get("quoteSummary") or {}).get("result"):
                break
        parsed = parse_quote_summary(payload)
        if parsed is not None:
            self.cache_write("fundamentals", symbol, parsed)
        return parsed

    def news(self, symbol: str | None = None, limit: int = 12) -> list[dict]:
        """Headlines from Yahoo's RSS feed -- per symbol, or the market feed."""
        params = {"region": "US", "lang": "en-US"}
        if symbol:
            params["s"] = symbol
        response = self._get(
            YAHOO_RSS, limiter=self._yahoo, params=params, headers={"Accept": "application/rss+xml"}
        )
        if response is None:
            return []
        return parse_rss(response.content, symbol=symbol)[:limit]

    # -------------------------------------------------------------------- sec

    def sec_cik_map(self, max_age_hours: float = 168.0) -> dict[str, str]:
        """Ticker -> zero-padded CIK, straight from the SEC's own index."""
        cached = self.cache_read("sec", "cik_map", max_age_hours)
        if cached:
            return cached
        payload = self._get_json(SEC_TICKERS, limiter=self._sec, headers={"User-Agent": SEC_UA})
        if not payload:
            return {}
        mapping = {
            str(row["ticker"]).upper(): str(row["cik_str"]).zfill(10)
            for row in payload.values()
            if row.get("ticker") and row.get("cik_str") is not None
        }
        self.cache_write("sec", "cik_map", mapping)
        return mapping

    def insider_filings(self, symbol: str, cik: str, limit: int = 6) -> list[dict]:
        """Recent Form 4 transactions for one company.

        Walks the company's filing index for Form 4s, then parses each one's
        XML for the reporting owner, transaction code, size and price. Sales
        under a 10b5-1 plan are flagged rather than dropped -- a scheduled sale
        is genuinely less interesting than a discretionary one, and the table
        says which is which instead of deciding for you.
        """
        payload = self._get_json(
            SEC_SUBMISSIONS.format(cik=cik), limiter=self._sec, headers={"User-Agent": SEC_UA}
        )
        recent = ((payload or {}).get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        accessions = recent.get("accessionNumber") or []
        dates = recent.get("filingDate") or []

        out: list[dict] = []
        for form, accession, filed in zip(forms, accessions, dates):
            if form != "4" or len(out) >= limit:
                continue
            document = self._sec_form4_xml(cik, accession)
            if document is None:
                continue
            out.extend(parse_form4(document, symbol=symbol, filed=filed, accession=accession))
        return out

    def _sec_form4_xml(self, cik: str, accession: str) -> bytes | None:
        """Find and download the XML body of one Form 4 filing."""
        folder = accession.replace("-", "")
        base = SEC_ARCHIVE.format(cik=int(cik), accession=folder)
        index = self._get_json(
            f"{base}/index.json", limiter=self._sec, headers={"User-Agent": SEC_UA}
        )
        names = [
            item.get("name", "")
            for item in ((index or {}).get("directory") or {}).get("item") or []
        ]
        # Ownership documents are the .xml that is not the submission wrapper
        # or the rendering stylesheet.
        candidates = [
            name
            for name in names
            if name.lower().endswith(".xml") and "index" not in name.lower()
        ]
        if not candidates:
            return None
        response = self._get(
            f"{base}/{candidates[0]}", limiter=self._sec, headers={"User-Agent": SEC_UA}
        )
        return response.content if response is not None else None


# --------------------------------------------------------------------- parsing
#
# Split out from Client so every one of them can be tested against a recorded
# payload without a socket in sight.


def parse_chart(payload) -> dict | None:
    """Yahoo's chart envelope -> the parallel-list bar format metrics.py wants."""
    result = ((payload or {}).get("chart") or {}).get("result") or []
    if not result:
        return None
    block = result[0]
    stamps = block.get("timestamp") or []
    quote = ((block.get("indicators") or {}).get("quote") or [{}])[0]
    if not stamps or not quote.get("close"):
        return None

    bars = {
        "t": stamps,
        "o": quote.get("open") or [],
        "h": quote.get("high") or [],
        "l": quote.get("low") or [],
        "c": quote.get("close") or [],
        "v": quote.get("volume") or [],
    }
    meta = block.get("meta") or {}
    bars["meta"] = {
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "name": meta.get("longName") or meta.get("shortName"),
        "prev_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
        "market_price": meta.get("regularMarketPrice"),
        "market_state": meta.get("marketState"),
    }
    return bars


def _raw(node):
    """quoteSummary wraps every number as {raw, fmt, longFmt}. Unwrap it."""
    if isinstance(node, dict):
        return node.get("raw")
    return node if isinstance(node, (int, float)) else None


def parse_quote_summary(payload) -> dict | None:
    """Flatten Yahoo's module soup into the fundamental screener columns."""
    result = ((payload or {}).get("quoteSummary") or {}).get("result") or []
    if not result:
        return None
    blocks = result[0]
    profile = blocks.get("assetProfile") or {}
    summary = blocks.get("summaryDetail") or {}
    stats = blocks.get("defaultKeyStatistics") or {}
    financial = blocks.get("financialData") or {}
    price = blocks.get("price") or {}
    calendar = blocks.get("calendarEvents") or {}

    earnings_dates = (calendar.get("earnings") or {}).get("earningsDate") or []
    earnings = _raw(earnings_dates[0]) if earnings_dates else None

    dividend_yield = _raw(summary.get("dividendYield"))
    return {
        "name": price.get("longName") or price.get("shortName"),
        "exchange": price.get("exchangeName"),
        "quote_type": price.get("quoteType"),
        "sector": profile.get("sector"),
        "industry": profile.get("industry"),
        "country": profile.get("country"),
        "employees": profile.get("fullTimeEmployees"),
        "summary": (profile.get("longBusinessSummary") or "")[:900] or None,
        "website": profile.get("website"),
        "market_cap": _raw(price.get("marketCap")) or _raw(summary.get("marketCap")),
        "pe": _raw(summary.get("trailingPE")),
        "forward_pe": _raw(summary.get("forwardPE")),
        "peg": _raw(stats.get("pegRatio")),
        "ps": _raw(summary.get("priceToSalesTrailing12Months")),
        "pb": _raw(stats.get("priceToBook")),
        "eps": _raw(stats.get("trailingEps")),
        "eps_forward": _raw(stats.get("forwardEps")),
        "beta": _raw(summary.get("beta")) or _raw(stats.get("beta")),
        "dividend_yield": dividend_yield * 100 if dividend_yield and dividend_yield < 1 else dividend_yield,
        "payout_ratio": _raw(summary.get("payoutRatio")),
        "roe": _pct(_raw(financial.get("returnOnEquity"))),
        "roa": _pct(_raw(financial.get("returnOnAssets"))),
        "gross_margin": _pct(_raw(financial.get("grossMargins"))),
        "operating_margin": _pct(_raw(financial.get("operatingMargins"))),
        "profit_margin": _pct(_raw(financial.get("profitMargins"))),
        "revenue": _raw(financial.get("totalRevenue")),
        "revenue_growth": _pct(_raw(financial.get("revenueGrowth"))),
        "earnings_growth": _pct(_raw(financial.get("earningsGrowth"))),
        "debt_to_equity": _raw(financial.get("debtToEquity")),
        "current_ratio": _raw(financial.get("currentRatio")),
        "free_cashflow": _raw(financial.get("freeCashflow")),
        "target_price": _raw(financial.get("targetMeanPrice")),
        "recommendation": financial.get("recommendationKey"),
        "analysts": _raw(financial.get("numberOfAnalystOpinions")),
        "shares_out": _raw(stats.get("sharesOutstanding")),
        "float_shares": _raw(stats.get("floatShares")),
        "short_percent_float": _pct(_raw(stats.get("shortPercentOfFloat"))),
        "short_ratio": _raw(stats.get("shortRatio")),
        "insider_own": _pct(_raw(stats.get("heldPercentInsiders"))),
        "institution_own": _pct(_raw(stats.get("heldPercentInstitutions"))),
        "earnings_date": earnings,
    }


def _pct(value):
    """Yahoo hands back ratios; the screener displays percentages."""
    return value * 100.0 if isinstance(value, (int, float)) else None


def parse_rss(body: bytes, symbol: str | None = None) -> list[dict]:
    """RSS 2.0 -> a list of headline dicts."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    items = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        items.append(
            {
                "title": title,
                "link": (item.findtext("link") or "").strip(),
                "published": _rss_time(item.findtext("pubDate")),
                "source": (item.findtext("source") or "Yahoo Finance").strip(),
                "symbol": symbol,
            }
        )
    return items


def _rss_time(text: str | None) -> int | None:
    """RFC-822 timestamps out of RSS, epoch seconds in."""
    if not text:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z"):
        try:
            parsed = datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    return None


# Form 4 XML is namespace-free in practice, but strip any namespace anyway so a
# future schema revision does not silently produce zero rows.
def _tag(element) -> str:
    return element.tag.split("}")[-1]


def _find(node, *path):
    """Namespace-tolerant nested lookup; returns the element or None."""
    current = node
    for name in path:
        if current is None:
            return None
        current = next((child for child in current if _tag(child) == name), None)
    return current


def _value(node, *path):
    """Form 4 wraps most fields in a <value> child. Reach through it."""
    element = _find(node, *path)
    if element is None:
        return None
    inner = _find(element, "value")
    text = (inner if inner is not None else element).text
    return text.strip() if text else None


# Transaction codes worth surfacing. P and S are the open-market trades people
# actually mean by "insider buying"; A and M (grants and option exercises) are
# compensation and are labelled as such so they do not read as conviction.
FORM4_CODES = {
    "P": ("Buy", "buy"),
    "S": ("Sell", "sell"),
    "A": ("Grant", "grant"),
    "M": ("Option exercise", "exercise"),
    "F": ("Tax withholding", "tax"),
    "G": ("Gift", "gift"),
}


def parse_form4(body: bytes, symbol: str, filed: str, accession: str = "") -> list[dict]:
    """One Form 4 document -> zero or more transaction rows."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []

    owner = _find(root, "reportingOwner")
    person = _value(owner, "reportingOwnerId", "rptOwnerName") if owner is not None else None
    relationship = _find(owner, "reportingOwnerRelationship") if owner is not None else None
    titles = []
    if relationship is not None:
        for child in relationship:
            flag = (child.text or "").strip()
            if _tag(child) == "officerTitle" and flag:
                titles.append(flag)
            elif flag in ("1", "true") and _tag(child) != "officerTitle":
                titles.append({"isDirector": "Director", "isOfficer": "Officer",
                               "isTenPercentOwner": "10% owner"}.get(_tag(child), _tag(child)))

    rows = []
    for node in root.iter():
        if _tag(node) != "nonDerivativeTransaction":
            continue
        code = _value(node, "transactionCoding", "transactionCode")
        label, kind = FORM4_CODES.get(code or "", (code or "Other", "other"))
        shares = _value(node, "transactionAmounts", "transactionShares")
        price = _value(node, "transactionAmounts", "transactionPricePerShare")
        disposed = _value(node, "transactionAmounts", "transactionAcquiredDisposedCode")
        after = _value(node, "postTransactionAmounts", "sharesOwnedFollowingTransaction")
        try:
            share_count = float(shares) if shares else None
            unit_price = float(price) if price else None
        except ValueError:
            share_count = unit_price = None

        rows.append(
            {
                "symbol": symbol,
                "person": person,
                "title": ", ".join(dict.fromkeys(titles)) or None,
                "code": code,
                "label": label,
                "kind": kind,
                "direction": "D" if disposed == "D" else "A",
                "shares": share_count,
                "price": unit_price,
                "value": (share_count * unit_price) if share_count and unit_price else None,
                "shares_after": float(after) if after and after.replace(".", "").isdigit() else None,
                "date": _value(node, "transactionDate") or filed,
                "filed": filed,
                "accession": accession,
            }
        )
    return rows
