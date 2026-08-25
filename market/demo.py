"""A synthetic dataset so the terminal has something to render on day one.

Every company in here is invented. That is a deliberate choice: a demo built
from real tickers with made-up prices is a trap -- it looks authoritative,
screenshots convincingly, and there is no moment where a reader is forced to
notice the numbers are fake. Fictional names cannot be mistaken for a quote.

The generator runs the same metrics.technicals() the live pipeline does, so
the demo exercises the real code path rather than a parallel one, and the
front end has no idea it is being fed anything unusual beyond meta.source
being "demo" (which is what raises the banner across the top of the app).
"""

from __future__ import annotations

import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import build, metrics

# name-stem, sector, industry, how volatile, drift per year
BLUEPRINT = [
    ("Northwind", "Technology", "Semiconductors", 0.034, 0.28),
    ("Halcyon", "Technology", "Software - Infrastructure", 0.030, 0.22),
    ("Beacon Ridge", "Technology", "Software - Application", 0.028, 0.15),
    ("Ironvale", "Technology", "Computer Hardware", 0.025, 0.10),
    ("Quillon", "Technology", "Information Technology Services", 0.021, 0.08),
    ("Sable Creek", "Financial", "Banks - Diversified", 0.019, 0.09),
    ("Meridian Trust", "Financial", "Capital Markets", 0.021, 0.12),
    ("Cobblestone", "Financial", "Insurance - Property & Casualty", 0.015, 0.07),
    ("Auburn Park", "Financial", "Asset Management", 0.018, 0.06),
    ("Larkspur", "Healthcare", "Drug Manufacturers", 0.022, 0.11),
    ("Verdigris", "Healthcare", "Biotechnology", 0.041, 0.05),
    ("Cardinal Bay", "Healthcare", "Medical Devices", 0.020, 0.09),
    ("Thornfield", "Healthcare", "Healthcare Plans", 0.018, 0.10),
    ("Willowmere", "Consumer Defensive", "Packaged Foods", 0.013, 0.05),
    ("Copperline", "Consumer Defensive", "Discount Stores", 0.015, 0.08),
    ("Marrow & Fen", "Consumer Defensive", "Beverages", 0.014, 0.04),
    ("Gaslight", "Consumer Cyclical", "Restaurants", 0.024, 0.07),
    ("Fairweather", "Consumer Cyclical", "Apparel Retail", 0.027, 0.03),
    ("Stonecrop", "Consumer Cyclical", "Auto Manufacturers", 0.033, 0.06),
    ("Tidewater", "Consumer Cyclical", "Travel Services", 0.029, 0.12),
    ("Kestrel Works", "Industrials", "Aerospace & Defense", 0.021, 0.13),
    ("Ambervale", "Industrials", "Railroads", 0.016, 0.08),
    ("Grantham", "Industrials", "Specialty Industrial Machinery", 0.019, 0.10),
    ("Redpoint", "Industrials", "Building Products", 0.023, 0.09),
    ("Petrichor", "Energy", "Oil & Gas Integrated", 0.024, 0.04),
    ("Blackmoor", "Energy", "Oil & Gas E&P", 0.031, -0.02),
    ("Coalwater", "Energy", "Oil & Gas Midstream", 0.017, 0.06),
    ("Feldspar", "Basic Materials", "Specialty Chemicals", 0.020, 0.05),
    ("Orehaven", "Basic Materials", "Copper", 0.030, 0.11),
    ("Kilnstone", "Basic Materials", "Building Materials", 0.019, 0.07),
    ("Brightwell", "Utilities", "Utilities - Regulated Electric", 0.012, 0.04),
    ("Longmoor", "Utilities", "Utilities - Renewable", 0.021, 0.03),
    ("Harborstone", "Real Estate", "REIT - Industrial", 0.017, 0.06),
    ("Cloverfield", "Real Estate", "REIT - Residential", 0.016, 0.02),
    ("Palisade", "Real Estate", "REIT - Data Center", 0.022, 0.09),
    ("Vantage Row", "Communication Services", "Telecom Services", 0.016, 0.03),
    ("Emberlight", "Communication Services", "Entertainment", 0.028, 0.08),
    ("Foxglove", "Communication Services", "Internet Content", 0.026, 0.14),
]

SUFFIXES = ["Corp", "Holdings", "Industries", "Group", "Labs", "Partners", "Systems", "Technologies"]

DEMO_ETFS = [
    ("ZBRD", "Broad Market Index Fund (demo)", "ETF", 0.011, 0.11),
    ("ZTEC", "Technology Select Fund (demo)", "ETF", 0.018, 0.19),
    ("ZFIN", "Financials Select Fund (demo)", "ETF", 0.014, 0.08),
    ("ZNRG", "Energy Select Fund (demo)", "ETF", 0.021, 0.02),
    ("ZHLT", "Healthcare Select Fund (demo)", "ETF", 0.013, 0.07),
    ("ZSML", "Small Cap Index Fund (demo)", "ETF", 0.017, 0.05),
    ("ZBND", "Aggregate Bond Fund (demo)", "ETF", 0.005, 0.01),
    ("ZGLD", "Gold Trust (demo)", "ETF", 0.012, 0.09),
]

DEMO_INDICES = [
    ("ZDX-500", "Demo 500", 0.010, 0.12),
    ("ZDX-TECH", "Demo Tech 100", 0.015, 0.18),
    ("ZDX-30", "Demo Industrial 30", 0.009, 0.08),
    ("ZDX-SMALL", "Demo Small Cap", 0.014, 0.04),
    ("ZDX-VOL", "Demo Volatility", 0.055, -0.10),
    ("ZDX-10Y", "Demo 10Y Yield", 0.014, -0.05),
]

HEADLINES = [
    "{name} guides above consensus on {industry} demand",
    "{name} announces $2B buyback, lifts dividend",
    "Analysts split on {name} after margin miss",
    "{name} names new chief financial officer",
    "{name} expands capacity with third plant",
    "{name} shares slip as guidance disappoints",
    "{name} closes acquisition of regional rival",
    "{name} reports record quarterly revenue",
    "Regulator opens review of {name} unit",
    "{name} raises full-year outlook",
]

MARKET_HEADLINES = [
    "Futures steady as traders weigh rate path",
    "Breadth improves with cyclicals leading",
    "Volatility gauge slips to a three-month low",
    "Sector rotation continues out of defensives",
    "Earnings season opens with a modest beat rate",
    "Bond yields ease after soft inflation print",
]

INSIDER_NAMES = [
    ("Rowan Alcott", "Chief Executive Officer"),
    ("Imogen Vale", "Chief Financial Officer"),
    ("Desmond Pike", "Director"),
    ("Marisol Quint", "Chief Operating Officer"),
    ("Hollis Bramble", "Director"),
    ("Ines Kaur", "EVP, Operations"),
    ("Tobias Renn", "10% owner"),
    ("Priya Ashworth", "Chief Technology Officer"),
]


def _walk(rng: random.Random, days: int, start: float, vol: float, drift: float) -> dict:
    """A geometric random walk with a mild trend and volatility clustering."""
    today = datetime.now(timezone.utc).replace(hour=20, minute=0, second=0, microsecond=0)

    # Build the calendar first, walking back from the most recent weekday, so
    # the series always ends today rather than drifting short of it.
    sessions: list[datetime] = []
    cursor = today
    while len(sessions) < days:
        if cursor.weekday() < 5:
            sessions.append(cursor)
        cursor -= timedelta(days=1)
    sessions.reverse()

    stamps, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    price = start
    daily_drift = drift / 252.0
    regime = 1.0
    base_volume = rng.uniform(4e5, 3.5e7)

    for session in sessions:
        # Volatility clusters: quiet stretches and loud ones, not white noise.
        regime = max(0.45, min(2.4, regime * math.exp(rng.gauss(0, 0.12))))
        step = rng.gauss(daily_drift, vol * regime)
        open_price = price * (1 + rng.gauss(0, vol * 0.25))
        price = max(0.6, price * math.exp(step))
        high = max(open_price, price) * (1 + abs(rng.gauss(0, vol * 0.4)))
        low = min(open_price, price) * (1 - abs(rng.gauss(0, vol * 0.4)))

        stamps.append(int(session.timestamp()))
        opens.append(open_price)
        highs.append(high)
        lows.append(low)
        closes.append(price)
        volumes.append(base_volume * (0.5 + regime) * rng.uniform(0.6, 1.6))
    return {"t": stamps, "o": opens, "h": highs, "l": lows, "c": closes, "v": volumes}


def _company(rng: random.Random, index: int) -> tuple[str, dict]:
    stem, sector, industry, vol, drift = BLUEPRINT[index % len(BLUEPRINT)]
    variant = index // len(BLUEPRINT)
    suffix = SUFFIXES[(index * 7) % len(SUFFIXES)]
    name = f"{stem} {suffix} (demo)" if variant == 0 else f"{stem} {suffix} {'IVX'[variant % 3]} (demo)"

    letters = "".join(part[0] for part in stem.replace("&", "").split() if part)[:2].upper()
    symbol = f"Z{letters}{chr(ord('A') + (index % 26))}"
    return symbol, {"name": name, "sector": sector, "industry": industry, "vol": vol, "drift": drift}


def generate(out_dir: Path, count: int = 132, seed: int = 20260825) -> dict:
    """Write a complete demo dataset to `out_dir`. Deterministic for a seed."""
    rng = random.Random(seed)
    rows, details, news, insider = [], {}, [], []
    used: set[str] = set()

    for index in range(count):
        symbol, spec = _company(rng, index)
        while symbol in used:
            symbol += rng.choice("XYZ")
        used.add(symbol)

        bars = _walk(rng, 260, rng.uniform(9, 640), spec["vol"], spec["drift"])
        technical = metrics.technicals(bars)

        # Derive the fundamentals from one another rather than rolling each
        # column independently. A screener whose P/E, P/S and profit margin
        # disagree reads as a bug in the site, not as fake data -- and the
        # filters would return nonsense combinations. So: pick a market cap,
        # a sales multiple and a margin, then let everything else follow.
        # Squaring the draw skews the distribution the way real markets are
        # shaped -- a handful of giants and a long tail -- instead of handing
        # out trillion-dollar caps to a third of the list.
        market_cap = math.exp(
            math.log(9e8) + (rng.random() ** 2.3) * (math.log(2.4e12) - math.log(9e8))
        )
        shares = market_cap / technical["price"]
        sales_multiple = math.exp(rng.uniform(math.log(0.4), math.log(16)))
        revenue = market_cap / sales_multiple
        margin = rng.uniform(-0.06, 0.36)
        net_income = revenue * margin
        book_value = revenue * rng.uniform(0.25, 1.6)
        profitable = net_income > 0

        row = {
            "symbol": symbol,
            "name": spec["name"],
            "sector": spec["sector"],
            "industry": spec["industry"],
            "country": "USA",
            "exchange": rng.choice(["NasdaqGS", "NYSE"]),
            "market_cap": market_cap,
            "shares_out": shares,
            "float_shares": shares * rng.uniform(0.6, 0.99),
            # A loss-making company has no meaningful trailing P/E, which is
            # exactly why the screener needs to handle a null there.
            "pe": (market_cap / net_income) if profitable else None,
            "forward_pe": (market_cap / (net_income * rng.uniform(1.0, 1.6))) if profitable else None,
            "peg": rng.uniform(0.4, 4.2) if profitable else None,
            "ps": sales_multiple,
            "pb": market_cap / book_value,
            "eps": net_income / shares,
            "beta": rng.uniform(0.35, 2.1),
            "dividend_yield": rng.uniform(0, 5.4) if profitable and rng.random() > 0.42 else None,
            "roe": (net_income / book_value) * 100,
            "roa": (net_income / (book_value * rng.uniform(1.4, 3.2))) * 100,
            "gross_margin": min(92.0, margin * 100 + rng.uniform(18, 46)),
            "operating_margin": margin * 100 + rng.uniform(1, 9),
            "profit_margin": margin * 100,
            "revenue": revenue,
            "revenue_growth": rng.uniform(-18, 46),
            "earnings_growth": rng.uniform(-40, 70),
            "debt_to_equity": rng.uniform(0, 220),
            "current_ratio": rng.uniform(0.6, 4.1),
            "short_percent_float": rng.uniform(0.4, 18),
            "short_ratio": rng.uniform(0.4, 9),
            "insider_own": rng.uniform(0.05, 14),
            "institution_own": rng.uniform(35, 96),
            "target_price": technical["price"] * rng.uniform(0.8, 1.4),
            "recommendation": rng.choice(["buy", "hold", "buy", "underperform", "strong_buy"]),
            "analysts": rng.randint(3, 44),
            "quote_type": "EQUITY",
            "demo": True,
            **technical,
        }
        rows.append(build._compact(row))
        details[symbol] = {
            "symbol": symbol,
            "profile": {
                "name": spec["name"],
                "sector": spec["sector"],
                "industry": spec["industry"],
                "country": "USA",
                "employees": rng.randint(400, 190000),
                "summary": (
                    f"{spec['name']} is a fictional company generated to populate this "
                    f"demo dataset. It is presented as a {spec['industry'].lower()} business "
                    f"in the {spec['sector'].lower()} sector so that every column, filter and "
                    "chart on this site has something realistic to render. None of these "
                    "figures describe a real security."
                ),
                "market_cap": row["market_cap"],
                "pe": row.get("pe"),
                "eps": row["eps"],
                "beta": row["beta"],
                "dividend_yield": row.get("dividend_yield"),
            },
            "bars": {
                "t": bars["t"],
                "o": [round(v, 4) for v in bars["o"]],
                "h": [round(v, 4) for v in bars["h"]],
                "l": [round(v, 4) for v in bars["l"]],
                "c": [round(v, 4) for v in bars["c"]],
                "v": [int(v) for v in bars["v"]],
            },
            "news": [],
            "insider": [],
        }

    # ETFs share the row shape but carry no fundamentals, exactly as the live
    # pipeline produces them.
    for symbol, name, sector, vol, drift in DEMO_ETFS:
        bars = _walk(rng, 260, rng.uniform(28, 520), vol, drift)
        technical = metrics.technicals(bars)
        row = build._compact({
            "symbol": symbol, "name": name, "sector": sector, "industry": sector,
            "country": "USA", "exchange": "NYSEArca", "quote_type": "ETF",
            # Net assets, not price times a share count -- a fund's size is
            # independent of what one share happens to cost.
            "market_cap": math.exp(rng.uniform(math.log(4e8), math.log(6e11))),
            "demo": True, **technical,
        })
        rows.append(row)
        details[symbol] = {
            "symbol": symbol,
            "profile": {"name": name, "sector": sector, "industry": sector,
                        "summary": "A fictional exchange-traded fund included so the ETF "
                                   "views have something to show. Not a real fund."},
            "bars": {"t": bars["t"], "o": [round(v, 4) for v in bars["o"]],
                     "h": [round(v, 4) for v in bars["h"]], "l": [round(v, 4) for v in bars["l"]],
                     "c": [round(v, 4) for v in bars["c"]], "v": [int(v) for v in bars["v"]]},
            "news": [], "insider": [],
        }

    index_rows = []
    for symbol, label, vol, drift in DEMO_INDICES:
        bars = _walk(rng, 260, rng.uniform(18, 5200), vol, drift)
        index_rows.append(build._compact({"symbol": symbol, "name": label, **metrics.technicals(bars)}))

    now = int(datetime.now(timezone.utc).timestamp())
    for offset, title in enumerate(MARKET_HEADLINES):
        news.append({"title": title + " (demo)", "link": "", "published": now - offset * 2400,
                     "source": "Demo wire", "symbols": []})
    for row in rng.sample(rows, min(48, len(rows))):
        template = rng.choice(HEADLINES)
        item = {
            "title": template.format(name=row["name"].replace(" (demo)", ""),
                                     industry=row.get("industry", "end-market").lower()) + " (demo)",
            "link": "", "published": now - rng.randint(600, 260000),
            "source": "Demo wire", "symbols": [row["symbol"]],
        }
        news.append(item)
        details[row["symbol"]]["news"].append({**item, "symbol": row["symbol"]})

    for row in rng.sample(rows, min(70, len(rows))):
        person, title = rng.choice(INSIDER_NAMES)
        kind = rng.choice(["buy", "sell", "sell", "grant", "exercise"])
        shares = rng.randint(500, 240000)
        price = row["price"] * rng.uniform(0.94, 1.06)
        day = datetime.now(timezone.utc) - timedelta(days=rng.randint(0, 45))
        entry = {
            "symbol": row["symbol"], "person": person, "title": title,
            "code": {"buy": "P", "sell": "S", "grant": "A", "exercise": "M"}[kind],
            "label": {"buy": "Buy", "sell": "Sell", "grant": "Grant",
                      "exercise": "Option exercise"}[kind],
            "kind": kind, "direction": "A" if kind in ("buy", "grant", "exercise") else "D",
            "shares": shares, "price": round(price, 2), "value": round(shares * price, 2),
            "date": day.strftime("%Y-%m-%d"), "filed": day.strftime("%Y-%m-%d"),
            "accession": "",
        }
        insider.append(entry)
        details[row["symbol"]]["insider"].append(entry)

    insider.sort(key=lambda i: i["date"], reverse=True)
    news.sort(key=lambda i: i["published"], reverse=True)
    rows.sort(key=lambda r: r.get("market_cap") or 0, reverse=True)

    meta = {
        "generated_at": now,
        "generated_iso": datetime.fromtimestamp(now, timezone.utc).isoformat(),
        "mode": "demo",
        "source": "demo",
        "symbols": len(rows),
        "requested": len(rows),
        "failed": [],
        "quotes_live": False,
        "duration_seconds": 0,
        "breadth": build.breadth(rows),
        "indices": index_rows,
        "history_range": "1y",
        "notice": (
            "Demo data. Every company, fund, index, headline and insider filing below is "
            "invented, and every price is a random walk. Run the data pipeline to replace "
            "this with live market data."
        ),
    }

    out_dir = Path(out_dir)
    build._write(out_dir / "meta.json", meta)
    build._write(out_dir / "screener.json", rows)
    build._write(out_dir / "groups.json", build.aggregate_groups(rows))
    build._write(out_dir / "news.json", news[:200])
    build._write(out_dir / "insider.json", insider[:300])
    for symbol, detail in details.items():
        build._write(out_dir / "tickers" / f"{symbol}.json", detail)
    return meta


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Generate the demo dataset.")
    parser.add_argument("--out", default="web/market/data", type=Path)
    parser.add_argument("--count", type=int, default=132)
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args(argv)
    meta = generate(args.out, count=args.count, seed=args.seed)
    print(f"demo dataset: {meta['symbols']} symbols -> {args.out}")
    return 0
