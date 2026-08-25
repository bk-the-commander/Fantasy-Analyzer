# Kaliris Markets

A Finviz-shaped market terminal built for one person: a screener, a sector
heatmap, candlestick charts, headlines and insider filings — with your own
ticker universe, your own saved screens, no ads, and no account.

Live at `/market` on the Pages site. Locally: `npm run serve` then
<http://localhost:8811/market/>.

---

## How it works

There is no server and no database. A scheduled GitHub Action fetches real
market data, writes it to a folder of JSON, and publishes that folder as a
static site:

```
GitHub Actions (every 15 min, US market hours)
  │
  ├── market/universe.txt ──► which symbols to track
  ├── Yahoo Finance        ──► prices, OHLCV history, fundamentals
  ├── Yahoo RSS            ──► headlines
  └── SEC EDGAR            ──► Form 4 insider transactions
                               │
                               ▼
                    web/market/data/*.json
                               │
                               ▼
                    GitHub Pages (the site you open)
```

The dataset is **not committed** on each run — it is built on the runner and
goes straight into the Pages artifact. A year of daily bars for 580 symbols is
several megabytes; committing that twice a day would add a gigabyte a year to
the repository for data that is stale by tomorrow.

### Freshness

Quotes refresh every 15 minutes during the US session, which is the same
freshness Finviz gives you for free. Real-time data requires a paid feed and a
live server; this is delayed, and the footer always says how delayed.

Two shapes of run:

| Mode | What it fetches | Requests | When |
|---|---|---|---|
| `daily` | A year of bars, fundamentals, headlines, Form 4s | ~1,300 | Once after the close |
| `quotes` | Live prices only, reusing cached bars | ~6 | Every 15 minutes |
| `auto` | `quotes` if the cache is warm, else `daily` | — | The default |

The cache is what makes this cheap. Bars and fundamentals are stored under
`.market-cache/` and reused within their freshness window, so a quarter-hourly
refresh is six batched quote requests for the entire universe.

---

## Running it yourself

```bash
pip install -r market/requirements.txt

npm run market:build     # full build: bars, fundamentals, news, insider
npm run market:quotes    # fast refresh: live prices only
npm run market:demo      # regenerate the offline demo dataset

npm run serve            # http://localhost:8811/market/
npm run test             # pipeline unit tests
npm run smoke:market     # drives every view in a real browser
```

Useful flags:

```bash
python3 scripts/build_market_data.py --limit 20 --verbose   # try 20 symbols
python3 scripts/build_market_data.py --universe my.txt      # a different list
python3 scripts/build_market_data.py --mode daily --workers 4
```

### Demo data

The repository ships a demo dataset so the site works before the first real
build. **Every company, fund, index, headline and filing in it is invented**,
and every price is a random walk. That is deliberate: a demo built from real
tickers with fabricated prices looks authoritative and there is no moment where
a reader is forced to notice the numbers are fake. Fictional names cannot be
mistaken for a quote, and the site puts an amber banner across the top whenever
`meta.source` is `demo`.

---

## Making it yours

**Your universe** is `market/universe.txt` — one editable list of symbols.
Add a ticker on its own line, delete one you never look at. Sector, industry,
market cap and every fundamental column are looked up at build time, so a bare
symbol is all you need. A symbol that no longer trades is dropped with a
warning rather than breaking the build.

**Your screens.** Set up filters, sorts and columns, then *Save this screen*.
Saved screens, your starred watchlist and your custom column set live in
`localStorage` — this browser only, never sent anywhere, because there is
nowhere to send them.

**Your columns.** The *Custom* preset tab lets you pick exactly which of the 50
columns you want to see, and remembers it.

**Your palette.** The header has two toggles: light/dark, and a colourblind-safe
palette. See below.

---

## A note on colour

Up is green and down is red because that is what this domain means by up and
down. It is also, measurably, the worst possible pair: deuteranopia cannot
separate them (CVD ΔE 4.1 against a ≥8 target, verified with the palette
validator). Two things follow from that:

1. **Every coloured number is also a signed number.** Every heatmap tile with
   room prints its own percentage; every coloured cell carries `+` or `−`.
   Colour is the fast channel, never the only one.
2. **The palette button swaps to blue/orange**, which clears every separation
   check (ΔE 26.8). Both palettes keep their meaning across light and dark —
   the up/down pair and the heatmap ramps are data, not decoration, so they do
   not follow the theme.

The heatmap ramps were computed rather than eyeballed: five steps per arm,
lightness descending as magnitude grows so the ramp still reads in greyscale,
chroma growing so it reads in colour, and every step holding at least 4.4:1
contrast against the white tile labels.

The moving-average overlays (SMA20 blue, SMA50 orange, SMA200 aqua) are a
validated categorical triple in both modes.

---

## Data sources and their limits

| Source | Provides | Caveats |
|---|---|---|
| Yahoo Finance | Prices, OHLCV, fundamentals | Undocumented API. Free, no key, and can change without notice. Every fetch degrades rather than raises — a failed symbol is logged and the rest still publish. |
| Yahoo RSS | Headlines | Public feed, per symbol. |
| SEC EDGAR | Form 4 insider transactions | Official and stable. Rate-limited to 10 req/s and asks clients to identify themselves — set the `SEC_USER_AGENT` repository variable to your email. |

Insider collection is the most expensive part (several SEC round-trips per
company), so a daily run covers the largest names plus the day's biggest movers
rather than all 580.

If Yahoo breaks, the workflow's fetch step is `continue-on-error`: the site
still deploys with whatever dataset is in the repository, and the run summary
says what happened.

---

## Layout

```
market/
  universe.txt      your symbols — the file you actually edit
  universe.py       reads it
  sources.py        every outbound HTTP call, and nowhere else
  metrics.py        pure functions: OHLCV in, technical columns out
  build.py          orchestrates the above, writes the JSON
  demo.py           the synthetic dataset
  requirements.txt  one dependency (requests)

web/market/
  index.html        the shell
  app.js            the whole app — no framework, no build step
  styles.css        tokens, then everything else
  data/             generated JSON (demo copy is committed)

scripts/
  build_market_data.py       live build
  build_demo_market_data.py  demo build
  smoke_market.js            browser test over every view

tests/test_market.py         pipeline unit tests
```

Keeping the network confined to `sources.py` is deliberate: `metrics.py` is
then trivially testable, and swapping a data provider touches one file.

---

## Not investment advice

Delayed, provided as-is, and assembled from free sources that can be wrong.
Nothing here is a recommendation to buy or sell anything.
