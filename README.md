# Fantasy Analyzer

Fantasy baseball assistant for a 12-team Yahoo H2H points, all-baseball,
keeper league. Pulls current-season MLB stats, applies the league's exact
scoring formulas, ranks players by fantasy points, and surfaces Statcast
context (xwOBA, barrel%, hard-hit%, xERA) to help spot regression/breakout
candidates that raw box-score points miss.

## League settings

**Roster:** C, 1B, 2B, 3B, SS, OF, OF, OF, Util, Util, SP, SP, RP, P, P, P

**Batting scoring:** R 1, 1B 1, 2B 2, 3B 3, HR 3, RBI 1, SB 2, BB 1, IBB 1,
HBP 1, Cycle 7, Grand Slam 4

**Pitching scoring:** IP 1, W 3, L -2, CG 2, SHO 3, SV 4, ER -1, K 1, HLD 1,
No-hitter 7, Perfect game 10, Quality Start 2, Blown Save -1

All of this lives in `fantasy_baseball/config.py` — edit it there if the
league settings change.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Verifying the pipeline

```bash
python scripts/fetch_sample.py 2026
```

This pulls a small sample of current-season batting stats, scores it, and
prints the actual column names returned by each data source. **Run this
first** any time the data sources or pybaseball version change — see "Known
limitations" below for why.

## Usage

```bash
# Top OF by fantasy points, with Statcast context
python -m fantasy_baseball.cli --season 2026 --type batting --position OF

# Starting pitchers with at least 20 IP
python -m fantasy_baseball.cli --season 2026 --type pitching --position SP --min-ip 20

# Regression/breakout candidates: actual points vs. Statcast-implied skill
python -m fantasy_baseball.cli --season 2026 --type batting --regression

# Save the full ranked table for the week
python -m fantasy_baseball.cli --season 2026 --type batting --out weekly_batting.csv
```

Run it weekly (or whenever) with the same command — it always pulls fresh
current-season totals.

## Architecture

- `fantasy_baseball/config.py` — scoring rules and roster/position config.
- `fantasy_baseball/data.py` — fetches season batting/pitching totals from the
  MLB Stats API (`statsapi.mlb.com`) and Statcast metrics from Baseball Savant
  (via `pybaseball`).
- `fantasy_baseball/scoring.py` — applies the scoring formulas to a stats
  DataFrame, derives 1B (= H − 2B − 3B − HR), computes Points/G, Points/PA,
  Points/IP.
- `fantasy_baseball/rank.py` — merges Statcast context onto scored stats,
  filters by roster position/slot, and finds regression/breakout candidates
  by comparing percentile rank of fantasy production vs. percentile rank of
  underlying skill (xwOBA / xERA).
- `fantasy_baseball/cli.py` — command-line entry point tying it together.

### Why MLB Stats API instead of FanGraphs for season totals

`pybaseball.batting_stats()` / `pitching_stats()` scrape FanGraphs' HTML
leaderboard tables, which is fragile and easy to get rate-limited/blocked on.
The MLB Stats API is a stable, documented, no-auth JSON API that gives us
counting stats plus player position/team in the same call. `pybaseball` is
still used for Statcast (Baseball Savant) leaderboards, since Savant doesn't
expose an equally simple public JSON endpoint and pybaseball already wraps it.

## Known limitations (V1)

- **Rare-event bonuses (Cycle, Grand Slam, No-hitter, Perfect Game) are not
  computed.** These require per-game/play-by-play data, not season-aggregate
  totals — none of the current data sources report "cycles hit" or "grand
  slams" as a leaderboard column. They currently score 0 (logged as a
  warning, not silently dropped). Adding them would mean parsing MLB Stats
  API game logs/boxscores per player — a good V2 addition, scoped to your
  actual roster rather than the whole league to keep it fast.
- **Quality Starts (QS)** are read from the bulk MLB Stats API endpoint if
  present; if that field isn't populated, QS scores 0 and a warning is
  logged. `fantasy_baseball.data.fetch_quality_starts_from_gamelogs()` computes
  exact QS (IP ≥ 6 and ER ≤ 3) via per-pitcher game logs — slower (one API
  call per pitcher), so it's opt-in rather than part of the default fetch.
  Scope it to your roster/watchlist, not the full league.
- **Statcast column names are best-effort.** `data.py` maps several known
  alias candidates (Baseball Savant/pybaseball column names have shifted
  across versions) and logs a warning for anything it can't find. Run
  `scripts/fetch_sample.py` after any pybaseball upgrade to confirm the
  mapping still matches reality.
- **This was built without live network access to `statsapi.mlb.com` /
  `baseballsavant.mlb.com`** (blocked by the build sandbox's egress policy).
  The field names reflect the documented API schemas but haven't been
  confirmed against a live response — `scripts/fetch_sample.py` is the first
  thing to run once you have network access, specifically to catch any
  mismatch.

## Tests

```bash
pytest tests/ -v
```

Unit tests validate the scoring arithmetic against hand-computed expected
point totals — they don't hit the network, since the scoring math is what
actually encodes the league rules and is what most needs to be provably
correct.

---

# Finance Tracker

A personal budget + stock portfolio dashboard: net worth, spending vs.
budget, portfolio value/gain-loss, and a technical-indicator screener that
flags your holdings/watchlist for RSI, moving-average, and MACD buy/watch
signals, plus recent news per ticker.

**This is not financial advice.** The "buy signals" are plain technical
rules of thumb (RSI oversold, golden cross, MACD crossover, proximity to the
52-week range) — a starting point for your own research, not a
recommendation.

**Your data stays local.** Income, holdings, and spending live in `data/`,
which is gitignored — nothing you enter is ever committed. Only the
templates in `data/examples/` (fake numbers) are tracked in git.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Populate your real data from the templates (gitignored, edit freely):
cp data/examples/profile.yaml data/profile.yaml
cp data/examples/holdings.csv data/holdings.csv
cp data/examples/transactions.csv data/transactions.csv
cp data/examples/watchlist.csv data/watchlist.csv
```

Then edit those four files in `data/`:
- **`profile.yaml`** — monthly take-home pay, budget target per spending
  category, cash account balances, liabilities.
- **`holdings.csv`** — `ticker,shares,cost_basis,account` for stocks/ETFs you
  own.
- **`transactions.csv`** — `date,category,description,amount` spending/income
  log. Negative `amount` = money out, positive = money in. Log a paycheck as
  `category=Income`.
- **`watchlist.csv`** — `ticker,note` for stocks you don't own yet but want
  screened for buy signals.

## Usage

```bash
streamlit run finance_tracker/app.py
```

Opens a local dashboard with four tabs:
- **Overview** — net worth, portfolio value, this month's spending, savings
  rate, cash/liability balances.
- **Spending** — budget vs. actual by category (with an over-budget
  warning), spending by category, and a 12-month spending trend.
- **Portfolio** — holdings priced live via yfinance, unrealized gain/loss,
  allocation by ticker.
- **Buy Signals** — screens every holding + watchlist ticker for RSI,
  moving-average cross, MACD, and 52-week-range signals, plus a news feed
  per ticker.

## Architecture

- `finance_tracker/config.py` — file paths and all tunable thresholds (RSI
  levels, moving-average windows, "near 52-week high/low" cutoffs) in one
  place.
- `finance_tracker/storage.py` — loads and validates the four files in
  `data/`; raises a clear "copy this template" error if one is missing.
- `finance_tracker/indicators.py` — pure price-series math (SMA, RSI, MACD,
  52-week range, crossover detection). No network calls, so it's fully unit
  tested against hand-built price series.
- `finance_tracker/market.py` — the only module that talks to the network
  (via `yfinance`): current prices, historical OHLCV, news, portfolio
  valuation. Fetch failures are logged and skipped per-ticker rather than
  crashing the dashboard.
- `finance_tracker/budget.py` — spending-by-category, budget-vs-actual,
  savings rate, net worth. Pure pandas over the transactions log.
- `finance_tracker/signals.py` — combines `indicators.py` output into
  human-readable buy/watch flags per ticker (e.g. "RSI oversold (24 < 30)",
  "Golden cross (SMA50 crossed above SMA200)").
- `finance_tracker/app.py` — the Streamlit dashboard tying it all together.

## Known limitations

- **Built without live network access to `query1.finance.yahoo.com`**
  (blocked by the build sandbox's egress policy, same as the fantasy
  baseball tool's MLB Stats API access — see above). `market.py`'s network
  calls were verified to fail *gracefully* (logged warning, ticker skipped,
  no crash) but not verified against real price data. Run the dashboard with
  real network access first thing and sanity-check a couple of known prices.
- **Rare-event/dividend/split adjustments** aren't handled beyond what
  `yfinance`'s `auto_adjust=True` does automatically.
- **The screener is single-signal-per-indicator**, not a composite/weighted
  score — `buy_signal_count` is a simple count of triggered buy-oriented
  flags. Tune thresholds in `config.py`, or extend `signals.py`, to match
  your own strategy.
