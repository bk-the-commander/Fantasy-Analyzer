# Dynasty Analytics

Tools for a 12-team Yahoo H2H points, all-baseball, keeper league. Two pieces:

1. **[Dynasty Analytics](web/)** — the public web app. Every MLB player
   since 1871, scored in *our* league's points. Look anybody up, see their
   career and season-by-season totals, percentile rails against every qualified
   player in history, and filterable all-time leaderboards.
2. **[The CLI](#usage)** — current-season rankings with Statcast context
   (xwOBA, barrel%, hard-hit%, xERA) for spotting regression and breakout
   candidates in-season.

Both read the scoring rules from the same `fantasy_baseball/config.py`, so they
can't drift apart.

## The product

Every other record book scores baseball the way baseball scores baseball. This
one scores it **the way your league does**. Put your own weights into
**My League** and every number on every page — player pages, all-time
leaderboards, season boards, projections — recomputes from the raw counting
stats that ship with each row.

That is why the dataset carries full counting categories on every leaderboard
row rather than just a points total: the rescoring happens in the browser, with
no request and no server. Set stolen bases to 10 and Rickey Henderson passes
Barry Bonds on the all-time board, live.

Two things deliberately do *not* follow custom weights, and the site says so
rather than quietly misleading: **PTS+** and the **percentile rails**. Both are
calibrated against every qualified season scored the league's own way; against
arbitrary weights they would be wrong in a way nobody could see. They hide
until you reset to the defaults.

### On top of the scoring engine

- **Advanced metrics** — AVG/OBP/SLG/OPS/ISO/BABIP/BB%/K%/OPS+ for hitters,
  ERA/WHIP/K9/BB9/HR9/FIP/ERA+ for pitchers, computed in the browser from the
  counting stats already on the page. League-adjusted against the seasons the
  player actually played; **not** park-adjusted, since the databank carries no
  park factors — expect a few points of difference against Baseball-Reference.
- **Projections** — a Marcel-style forecast (last three seasons weighted 5/4/3,
  regressed to the league rate, age-curved off a peak of 27). Marcel is the
  deliberately simple baseline any forecast should have to beat, not a full
  projection system. It follows your custom weights like everything else.
- **Profiles** — a written summary assembled from the record: span, era,
  honours, milestones, all-time rank, birthplace. Plus curated nicknames for
  the players who have well-established ones, and outbound links to
  Baseball-Reference and Wikipedia.
- **Eras carry their dates** everywhere they appear — "Dead Ball (1901–1919)",
  never a bare label a reader has to decode.

## Leagues

The site is multi-league. A switcher in the header picks **MLB**, **NBA** or
**NFL**, and the whole page re-themes: MLB is blue on black/grey/white, NBA
orange on white, NFL brown on white. Each league keeps its own accent ramp for
both light and dark, so no combination falls back to another league's colour.

| League | Status | What exists |
| --- | --- | --- |
| MLB | **Live** | Full dataset, 1871–2023, every view working |
| NBA | Placeholder | Scoring rules and roster configured; no dataset yet |
| NFL | Placeholder | Scoring rules and roster configured; no dataset yet |

Colours: the brand purple is constant — logo, wordmark, footer — and only the
data accent changes with the league. **MLB green** (the field), **NBA red**
(the league's own mark), **NFL navy** (the shield). Each accent is defined
twice, lighter for dark grounds and darker for light ones, because one mid-tone
cannot clear contrast on both.

NBA and NFL scoring values are **placeholders** and say so on their own Scoring
pages. Edit them in the `SPORTS` registry at the top of `web/app.js` and every
page for that league follows. Their data views explain what a dataset would
take rather than rendering an empty shell.

Routes carry the league — `#/nba/career`, `#/mlb/player/bondsba01`. Links from
before the site had leagues (`#/player/bondsba01`) still resolve to baseball.

Adding a league is a registry entry plus a dataset in `web/data-<id>/` matching
the MLB shape — not a second copy of the site.

## Plans (free vs Pro)

| | Free | Pro |
| --- | --- | --- |
| All-time leaderboards | Top 100 | Every row |
| Player game log | 5 best seasons | Every season |
| Single-season boards | Top 10 | Full board |
| Compare | 2 players | Unlimited |
| Live current-season stats | — | ✓ |
| CSV export | — | ✓ |
| Basketball & football | — | ✓ |

Career totals, percentile rails and the points-by-season chart are free for
every player — the ceiling is on depth, not on access.

> **The paywall is a working demo, not a real one.** Gating runs entirely in
> the browser, so it decides what the interface offers, not what a determined
> visitor can reach — anyone can flip `localStorage.dsa-tier` in devtools.
> Charging for real needs the Pro data served from behind an authenticated
> endpoint. The plan switch on `#/pricing` exists so both experiences can be
> seen side by side. Set `SITE.billing.checkoutUrl` to point Pro at a real
> Stripe/Lemon Squeezy link, which replaces the demo switch.

## Admin console

`#/admin`, behind a passphrase set in `SITE.admin.passphrase` (currently
`dynasty` — change it). It gives the owner:

- **Plan override** — see the site exactly as a Free or a Pro customer does
- **Scoring status** — whether custom weights are active, and a link to edit
- **Feature flags** — ads, tip jar, live stats, checkout link, contact form,
  each showing ON/OFF and the value behind it
- **League status** — which sports have datasets
- **Dataset facts** — build date, coverage, player and season counts

> **It is convenience, not security.** The console runs in the browser like the
> rest of the site, so the passphrase keeps the page out of a visitor's way and
> protects nothing a determined person could not read from the source. Nothing
> sensitive belongs behind it. Real admin authentication arrives with the same
> backend that would enforce paid access.

## Roadmap (beta pages)

**Trends** and **Ask** are live as pages that describe their intended mechanics
and name the data each needs — not fabricated charts. Both require a scheduled
backend job, which is the one thing static hosting cannot provide:

- **Trends** — daily most-added/dropped across platforms, rolling hot/cold
  scored by *your* settings, buy-low candidates from the gap between rate stats
  and point totals, and waiver fit against your roster slots.
- **Ask** — a question box answering over the dataset *and* your league
  settings, with every claim linked to the row it came from. It ships when
  answers can be grounded and cited; a stats assistant that invents
  plausible-looking numbers is worse than none.

## The web app

A static site — plain HTML/CSS/JS plus a prebuilt JSON dataset. No server, no
framework, no build step, no API keys.

```bash
python3 -m http.server 8811 -d web   # then open http://localhost:8811
```

Opening `web/index.html` straight off disk will *not* work: browsers block
local JSON reads, and the app says so if you try.

**Views**

| Tab | What it does |
| --- | --- |
| Player Lookup | Search all 20,653 players. Career or any single season: point tiles, percentile rails, a points-by-season chart, full stat log. |
| Career Leaders | Every career ranked by league points. Filter by era, position, games; sort by any column. |
| Season Leaders | The best single seasons ever, same filters. Sort by PTS+ for a fair cross-era read. |
| Year Explorer | Any season back to 1871 — who would have won your league that year. |
| This Season | Current-season totals, fetched live from the MLB Stats API in the visitor's browser. |
| Compare | Careers side by side, best value per row highlighted. |
| Scoring | The league's rules, plus exactly which categories the historical data can and cannot support. |
| About / Contact / Privacy / Terms | Standard site pages, generated from the config block below. |

**Light and dark, by the clock.** The theme follows the visitor's own local
time — light between 07:00 and 19:00, dark otherwise — and is applied before
first paint so the page never flashes. The header button cycles
auto → light → dark and remembers the choice in `localStorage`. A tab left
open across sunset follows along on its own.

**Permanent URLs.** Player pages are addressed by the databank's stable player
id (`#/player/bondsba01`), not by a row number, so links keep working across
data rebuilds. Old numeric links still resolve.

### Naming

The public site is **Dynasty Sports Analytics**; the entity behind it is
**Kaliris Labs** (`© 2026 Kaliris Labs` in the footer, and the party named in
the Terms). The repository is still called `Fantasy-Analyzer` — renaming it is
a GitHub-side change and would move the Pages URL, so it is left alone
deliberately. The Python package and CLI keep their `fantasy_baseball` module
name; that is internal tooling, not brand surface.

Two marks, on purpose: cards, leaderboards and charts carry
**Dynasty Sports Analytics**, because those are what get screenshotted and
posted somewhere else and the brand is what should travel. *Generated by BK*
stays in the footer as the byline.

### Current-season (live) data

The historical dataset ends at its last complete season, so anything newer is
fetched **at page load, by the visitor's browser**, from the
[MLB Stats API](https://statsapi.mlb.com) — the public, documented, no-auth
JSON service behind MLB's own site. Two requests (hitting and pitching), scored
with the same league weights, cached for the session.

Not Baseball Reference: no public API, and its terms forbid scraping. Not a
paid feed: this stays a static site with no server and no keys.

Live figures appear in two places: the **This Season** tab, and a block on the
page of any player whose career ends within three years of the current season —
that recency guard stops a 2026 *Will Smith* from being stapled onto the 1890s one.

Live data is never on a page's critical path. If the request fails — offline,
restrictive network, API change — the historical page renders exactly as
before and says plainly that live figures are unavailable.

Live scoring is **more complete than the historical pages**: the API carries
Holds and Blown Saves, which the databank does not. A current-season reliever
is therefore scored on categories his 1990s counterpart is missing, and the
This Season tab says so.

> **Not verified against the live API.** `statsapi.mlb.com` is blocked by egress
> policy in the environment this was built in, so the integration is tested
> against a mocked API (both the success and failure paths are asserted in
> `scripts/audit_web.js`) but has never made a real request. Your browser is not
> behind that proxy; the first real load is the true test. Set
> `SITE.live.enabled = false` to switch it off entirely.

### Configuring the site

Everything an owner needs to set lives in the `SITE` block at the top of
`web/app.js` — nothing else hardcodes a name, an address, or a payment link.

| Field | What it's for | Status |
| --- | --- | --- |
| `contactEmail` | Contact page button and privacy contact line | set |
| `legalEntity` | Copyright line and Terms | set (Kaliris Labs) |
| `jurisdiction` | Governing law on Terms | set (Massachusetts, USA) |
| `twitter` / `instagram` | Contact buttons | set |
| `linkedin` / `facebook` | Contact buttons — need full profile URLs | **blank** |
| `formEndpoint` | Formspree/Basin URL. When set, renders a real contact form and hides the email address | **blank** |
| `siteUrl` | Canonical URL once deployed | blank |
| `dynasty` | Footer credit — *The Dynasty (6x) 💍* | set |
| `watermark` | Public mark on cards, boards and charts — the brand | set |
| `watermarkBy` | Personal credit, footer only — *Generated by BK* | set |
| `ads` / `support` | Monetization, both off | see below |

LinkedIn and Facebook take **full URLs**, not display names — a URL guessed
from a name lands on a stranger's profile. Open your profile, copy the address
bar, paste it in.

Blank fields degrade gracefully — an unset social handle just doesn't render a
button — so the site is publishable as-is and improves as you fill them in.

### Monetization

Both hooks ship switched off. Turning either on is a one-line change:

```js
ads:     { enabled: true, client: 'ca-pub-…', slots: { leaderboard: '…', inline: '…' } },
support: { enabled: true, url: 'https://ko-fi.com/…' },
```

When `ads.enabled` is false no ad container is rendered at all — an empty
reserved box on a page with nothing running just reads as broken layout.
Turning ads on also switches the Privacy page's advertising section from "no
ads run here" to the full AdSense cookie disclosure, automatically.

**Before charging for any of this, read the licence.** The underlying
statistics are Lahman / Chadwick Bureau data under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). That licence
*does* permit commercial use, and it requires two things in return:
attribution (already in the footer and on About) and share-alike on derivative
databases — if you redistribute the dataset, it goes out under the same terms.
Ad-supported browsing is squarely fine. Putting the raw dataset behind a paywall
is where the share-alike clause starts to bite; a subscription that sells
*tools and analysis* rather than the database itself is the cleaner structure.

Also note the site carries an explicit "not affiliated with MLB" disclaimer in
the footer and on About. Keep it there — using team and player names
descriptively is fine, implying endorsement is not.

**PTS+** is the era-adjusted number: a player's points per opportunity (PA for
hitters, IP for pitchers) divided by that season's qualified-league average,
indexed to 100. Raw totals reward era as much as talent — Old Hoss Radbourn
threw 678 innings in 1884 and owns the single-season pitching record forever —
so PTS+ is what to sort by when comparing across generations.

### Rebuilding the dataset

```bash
python scripts/build_web_data.py          # ~70s, writes web/data/ (~19 MB)
node scripts/smoke_web.js                 # every view renders, no console errors
node scripts/audit_web.js                 # deeper: behaviour, layout, themes
python scripts/build_preview.py           # one self-contained HTML file
```

`audit_web.js` is the one that matters before shipping. It asserts that
pitchers' pages lead with pitching and hitters' with batting, that search /
sorting / filtering / paging / compare / the season chart all actually do
something, that nothing overflows the viewport at 390px or 1400px, that text
and background stay far apart in both themes, and that a failed live-stats
fetch degrades cleanly. It exits non-zero on any failure.

The builder pulls the Lahman / Chadwick Bureau Baseball Databank from the
`pylahman` wheel on PyPI and reads its parquet payload directly. PyPI is used
because `statsapi.mlb.com` is blocked by egress policy in the environment this
was built in; if you have open network access, nothing stops you from swapping
in another source.

### Publishing

`.github/workflows/pages.yml` deploys `web/` to GitHub Pages. Turn it on once
under **Settings → Pages → Source: GitHub Actions**; after that every push
that touches `web/` redeploys. (Pages' simpler "deploy from a branch" mode only
serves `/` or `/docs`, which is why this uses Actions instead.)

### What the historical data cannot cover

The databank carries season totals, not play-by-play, and predates some
modern bookkeeping. These categories score **0** on the site and are greyed out
on the Scoring tab rather than being silently folded in:

- **Holds, Blown Saves, Quality Starts** — not in the databank at all. This
  makes modern relievers (holds) and innings-eating starters (QS) look modestly
  cheaper than they'd score in a live season.
- **Cycles, Grand Slams, No-hitters, Perfect Games** — need play-by-play data.

Everything else — every batting category, plus IP/W/L/CG/SHO/SV/ER/K — is
computed exactly as the league scores it. Note that a walk scores twice for an
intentional walk (1 for BB, 1 for IBB), matching how Yahoo applies the two
categories; it's why Bonds' 2004 is the highest-scoring batting season here.

Three further honesty measures, all visible in the UI rather than buried here:

- **Categories nobody was counting yet.** IBB isn't recorded before 1955, HBP
  before 1887, SB before 1886. Affected seasons are marked `†` in the stat log
  with an explanatory note, because a 1930 hitter's 0 IBB means "unrecorded",
  not "never happened" — his points are understated against a modern player's.
- **Empty seasons are dropped**, not shown as rows of zeroes: 16,996 batting
  rows (mostly DH-era pitchers who never took a plate appearance) and 41
  pitching rows. A row survives if the player actually took the opportunity or
  scored points some other way — a pinch runner with no PA still counts.
- **PTS+ is withheld below 50 PA / 15 IP.** An era rating off a one-inning
  cameo is arithmetic, not information; Ty Cobb's single relief inning in 1925
  came out at 472 before this floor existed. Those cells read `—`.

Coverage runs **1871–2023** (the databank's last complete season), 20,653
players, 88,154 batting seasons, 47,325 pitching seasons.

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
