/* Dynasty Sports Analytics — all-time MLB player stats in this league's
 * fantasy points. A Kaliris Labs project.
 *
 * No framework, no build step: the whole app is this file plus a static JSON
 * dataset produced by scripts/build_web_data.py. Data loads lazily — the boot
 * payload is the search index, and player shards / leaderboards are fetched
 * the first time a view needs them, then cached for the session.
 */
'use strict';

// ------------------------------------------------------------ site config
//
// Everything an owner needs to change lives here. Nothing below this block
// hardcodes a name, an address, or a payment link.

const SITE = {
  name: 'Dynasty Analytics',
  shortName: 'DA',
  tagline: 'Every MLB player since 1871, scored in your league’s points.',

  /* Footer credit line. */
  dynasty: 'The Dynasty (6x) 💍',

  /* Marks. `watermark` is the public one -- it rides on cards, boards and
   * charts, which are the things that get screenshotted and posted somewhere
   * else, so it carries the brand rather than the byline. `watermarkBy` is
   * the personal credit, kept to the footer. */
  watermark: 'Dynasty Analytics',
  watermarkBy: 'Built by Bill Kaliris Jr',
  owner: 'Bill Kaliris Jr',

  /* ---- CONTACT ---------------------------------------------------------
   * Blank fields simply don't render, so partial detail is fine.
   * Social entries that are full URLs (LinkedIn, Facebook) must be pasted
   * from the profile itself -- a URL guessed from a display name lands on a
   * stranger, which is worse than no link at all. */
  contactEmail: 'bkaliris@gmail.com',
  formEndpoint: '',          // optional Formspree/Basin URL — see note below
  twitter: 'bkaliris10',     // handle without the @
  instagram: 'bkaliris10',
  linkedin: '',              // paste the full https://www.linkedin.com/in/… URL
  facebook: '',              // paste the full https://www.facebook.com/… URL
  discord: '',               // invite URL

  /* Shown on About / Privacy / Terms. A personal name is a perfectly valid
   * copyright holder -- no company is required to publish. Swap in a
   * registered entity here if and when one exists. */
  legalEntity: 'Kaliris Labs',
  jurisdiction: 'Massachusetts, USA',
  siteUrl: '',               // canonical URL once it is deployed
  launchedYear: 2026,

  /* Admin console passphrase. Convenience only -- it keeps the page out of a
   * visitor's way and protects nothing a determined person could not read from
   * the source. Change it, and never put anything sensitive behind it. */
  admin: { passphrase: 'dynasty' },

  /* ---- CURRENT SEASON --------------------------------------------------
   * The historical dataset ends at its last complete season. Anything newer
   * is fetched live from the MLB Stats API by the visitor's browser. Set
   * `season` to pin a year; null follows the calendar. */
  live: { enabled: true, season: null },

  /* ---- MONETIZATION ----------------------------------------------------
   * Both are off until switched on. See README "Monetization" for the full
   * rundown, including the licence obligations that come with charging for
   * access to this data. */
  ads: {
    enabled: false,
    client: '',              // AdSense publisher id, e.g. 'ca-pub-0000000000000000'
    slots: { leaderboard: '', inline: '' },
  },
  billing: {
    priceMonthly: 4,
    priceYearly: 39,
    checkoutUrl: '',   // Stripe/Lemon Squeezy link; empty keeps the demo switch
  },
  support: {
    enabled: false,
    url: '',                 // Ko-fi / Buy Me a Coffee / Stripe payment link
    label: 'Support the site',
    blurb: 'This site is free and has no login. If it saved you an argument, chip in.',
  },
};

// ------------------------------------------------------------------ sports
//
// One registry drives everything that differs between leagues: palette, nav,
// scoring, roster, and where the data lives. Adding a sport is a new entry
// here plus a dataset -- not a second copy of the site.
//
// MLB is `live`: it has a built dataset. NBA and NFL are `placeholder` -- the
// pages, scoring tables and rosters are real and editable, but there is no
// dataset behind them yet, and every data view says so rather than pretending.

const SPORTS = {
  mlb: {
    id: 'mlb', short: 'MLB', league: 'MLB', name: 'Baseball',
    status: 'live', dataDir: 'data',
    tagline: 'Every MLB player since 1871, scored in your league’s points.',
    searchPlaceholder: 'Search any player, 1871–present…',
    // Scoring and roster come from meta.json, which the data build writes
    // straight out of fantasy_baseball/config.py.
  },

  nba: {
    id: 'nba', short: 'NBA', league: 'NBA', name: 'Basketball',
    status: 'placeholder', dataDir: 'data-nba',
    tagline: 'Every NBA player, scored in your league’s points.',
    searchPlaceholder: 'Search any NBA player…',
    league_settings: { size: 12, type: 'H2H Points' },
    /* PLACEHOLDER SETTINGS -- replace with the real league's values. */
    scoringGroups: [{
      title: 'Scoring',
      rules: {
        'Point': 1, 'Rebound': 1.2, 'Assist': 1.5, 'Steal': 3, 'Block': 3,
        'Turnover': -1, 'Three-pointer made': 0.5, 'Field goal made': 1,
        'Field goal missed': -0.5, 'Free throw made': 1, 'Free throw missed': -0.5,
        'Double-double': 1.5, 'Triple-double': 3,
      },
    }],
    roster: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util',
             'BN', 'BN', 'BN', 'IL'],
    dataNote: 'Historical NBA statistics are available from the public ' +
      'stats.nba.com endpoints and from Basketball Reference’s downloadable ' +
      'tables. Neither is wired up yet.',
  },

  nfl: {
    id: 'nfl', short: 'NFL', league: 'NFL', name: 'Football',
    status: 'placeholder', dataDir: 'data-nfl',
    tagline: 'Every NFL player, scored in your league’s points.',
    searchPlaceholder: 'Search any NFL player…',
    league_settings: { size: 12, type: 'H2H Points' },
    /* PLACEHOLDER SETTINGS -- replace with the real league's values. */
    scoringGroups: [
      { title: 'Passing', rules: {
        'Passing yard': 0.04, 'Passing touchdown': 4, 'Interception thrown': -2,
        '2-point conversion pass': 2, '300+ yard game': 1 } },
      { title: 'Rushing & receiving', rules: {
        'Rushing yard': 0.1, 'Rushing touchdown': 6, 'Reception': 0.5,
        'Receiving yard': 0.1, 'Receiving touchdown': 6,
        '100+ yard game': 1, '2-point conversion': 2, 'Fumble lost': -2 } },
      { title: 'Kicking & defence', rules: {
        'PAT made': 1, 'FG 0-39 yd': 3, 'FG 40-49 yd': 4, 'FG 50+ yd': 5,
        'FG missed': -1, 'Sack': 1, 'Defensive interception': 2,
        'Fumble recovery': 2, 'Defensive touchdown': 6, 'Safety': 2,
        'Return touchdown': 6 } },
    ],
    roster: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'W/R/T', 'K', 'DEF',
             'BN', 'BN', 'BN', 'BN', 'BN', 'IR'],
    dataNote: 'Historical NFL statistics are available from nflverse’s public ' +
      'release files and from Pro Football Reference. Neither is wired up yet.',
  },
};

const SPORT_IDS = Object.keys(SPORTS);
const sport = () => SPORTS[state.sport] || SPORTS.mlb;

// ------------------------------------------------------------- entitlement
//
// DEMO GATING ONLY. This runs entirely in the browser, so it decides what the
// interface offers, not what a determined visitor can reach -- anyone can flip
// the flag in devtools. Real paid access needs the premium data served from
// behind an authenticated endpoint. See README "Monetization".

const TIER_KEY = 'dsa-tier';

const tier = () => {
  try { return localStorage.getItem(TIER_KEY) === 'pro' ? 'pro' : 'free'; }
  catch { return 'free'; }
};
const isPro = () => tier() === 'pro';

function setTier(value) {
  try { localStorage.setItem(TIER_KEY, value); } catch { /* private mode */ }
  updateTierBadge();
  route();
}

/** What the free tier stops at. Generous enough to be useful, short enough
 *  that the ceiling is obvious. */
const FREE = {
  boardRows: 100,
  seasonRows: 5,
  comparePlayers: 2,
  yearRows: 10,
  liveStats: false,
  export: false,
  sports: ['mlb'],
};

// ---------------------------------------------------------------- constants

const DATA_DIRS = SPORT_IDS.reduce((acc, id) => {
  acc[id] = SPORTS[id].dataDir;
  return acc;
}, {});

/* Column layouts of the packed arrays written by the build script. Keeping
 * these as named index maps means the JSON stays small without the render
 * code turning into a wall of magic numbers. */
const B = { YEAR:0, TEAM:1, LG:2, POS:3, G:4, PA:5, AB:6, R:7, H:8, D2:9, D3:10,
            HR:11, RBI:12, SB:13, CS:14, BB:15, IBB:16, HBP:17, SO:18,
            PTS:19, PLUS:20 };
const CB = { G:0, PA:1, AB:2, R:3, H:4, D2:5, D3:6, HR:7, RBI:8, SB:9, CS:10,
             BB:11, IBB:12, HBP:13, SO:14, PTS:15, Y0:16, Y1:17, N:18 };
const P = { YEAR:0, TEAM:1, LG:2, W:3, L:4, G:5, GS:6, CG:7, SHO:8, SV:9,
            IPOUTS:10, H:11, ER:12, HR:13, BB:14, SO:15, ERA:16, PTS:17, PLUS:18,
            HBP:19,
            // Alias so the shared scoring/metric helpers, which speak the
            // dataset's column names, resolve against packed rows too.
            IPouts:10 };
const CP = { W:0, L:1, G:2, GS:3, CG:4, SHO:5, SV:6, IPOUTS:7, H:8, ER:9, HR:10,
             BB:11, SO:12, ERA:13, PTS:14, Y0:15, Y1:16, N:17, HBP:18,
             IPouts:7 };

// Every era carries its own window. A reader should never have to guess which
// years "Dead Ball" covers, on screen or in an exported file.
const ERAS = [
  ['All-time',       1871, 2100],
  ['19th Century',   1871, 1900],
  ['Dead Ball',      1901, 1919],
  ['Live Ball',      1920, 1941],
  ['Integration',    1942, 1960],
  ['Expansion',      1961, 1976],
  ['Free Agency',    1977, 1993],
  ['Steroid Era',    1994, 2005],
  ['Modern',         2006, 2100],
];

/** "Dead Ball (1901–1919)" — the label a human should actually see. */
function eraLabel([name, lo, hi], maxYear) {
  if (name === 'All-time') return `All-time (1871–${maxYear})`;
  return `${name} (${lo}–${hi >= 2100 ? maxYear : hi})`;
}

const state = {
  meta: null,
  index: null,        // columnar search index
  pct: null,          // percentile breakpoints
  norm: [],           // normalized lowercase names, aligned to index arrays
  shards: new Map(),  // shard id -> parsed JSON
  boards: new Map(),  // board name -> parsed JSON
  ranks: new Map(),   // board name -> Map(playerId -> rank)
  compare: [],        // player ids pinned in the Compare view
  view: null,
  sport: 'mlb',       // active league; the URL is the source of truth
};

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');

/** append(), minus the DOM's habit of stringifying null into "null". */
function mount(parent, ...children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c);
  }
  return parent;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const num = (v, d = 0) =>
  (v === null || v === undefined || Number.isNaN(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const ip = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;
/** Same notation, from fractional innings rather than raw outs. */
const ipFrom = (innings) => ip(Math.round((Number(innings) || 0) * 3));
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* The packaged single-file preview inlines its data on the page instead of
 * serving it, so there is nothing to fetch. Everything downstream of these two
 * functions is identical in both builds. */
const EMBEDDED = typeof window !== 'undefined' ? (window.__DSA_DATA__ || null) : null;

async function getJSON(path) {
  if (EMBEDDED && EMBEDDED[path]) return EMBEDDED[path];
  const res = await fetch(`${DATA_DIRS[state.sport] || 'data'}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function getShard(id) {
  if (EMBEDDED) return EMBEDDED.players[String(id)] || null;
  const s = id % state.meta.shards;
  if (!state.shards.has(s)) state.shards.set(s, await getJSON(`players/${s}.json`));
  return state.shards.get(s)[String(id)];
}

async function getBoard(name) {
  if (!state.boards.has(name)) {
    const raw = await getJSON(`${name}.json`);
    // Re-shape packed rows into objects once, up front: every view sorts and
    // filters these repeatedly, and index lookups by name are far easier to
    // read than positional ones.
    const rows = raw.rows.map((r) => {
      const o = {};
      raw.cols.forEach((c, i) => { o[c] = r[i]; });
      o.name = nameOf(o.id);
      return o;
    });
    const group = name.includes('batting') ? 'batting' : 'pitching';
    applyScoring(rows, group, name.includes('career'));
    state.boards.set(name, rows);
  }
  return state.boards.get(name);
}

async function rankMap(board, key = 'pts') {
  const cacheKey = `${board}:${key}`;
  if (!state.ranks.has(cacheKey)) {
    const rows = await getBoard(board);
    const sorted = [...rows].sort((a, b) => b[key] - a[key]);
    const m = new Map();
    sorted.forEach((r, i) => { if (!m.has(r.id)) m.set(r.id, i + 1); });
    state.ranks.set(cacheKey, m);
  }
  return state.ranks.get(cacheKey);
}

// idPos: numeric id -> position in the columnar index arrays; pidPos does the
// same for the databank's string playerID. Leaderboards resolve tens of
// thousands of rows through these, so both are maps rather than array scans.
let idPos = new Map();
let pidPos = new Map();

function nameOf(id) {
  const i = idPos.get(id);
  return i === undefined ? `#${id}` : state.index.names[i];
}

/** Stable, build-independent id for URLs (e.g. "bondsba01"). */
function pidOf(id) {
  const i = idPos.get(id);
  return i === undefined ? String(id) : state.index.pid[i];
}

/** Accepts either a stable playerID or a legacy numeric id from an old link. */
function resolveId(key) {
  if (key === null || key === undefined || key === '') return null;
  const i = pidPos.get(String(key));
  if (i !== undefined) return state.index.ids[i];
  return /^\d+$/.test(String(key)) ? Number(key) : null;
}

/** Player page URL. Uses the stable id so shared links survive a rebuild. */
const playerHref = (id, extra = '') => `#/player/${pidOf(id)}${extra}`;

const posOf = (id) => idPos.get(id);
const indexField = (id, field) => {
  const i = posOf(id);
  return i === undefined ? null : state.index[field][i];
};

function teamName(code) {
  if (!code) return '';
  return code.split('/').map((c) => state.meta.teams[c] || c).join(' / ');
}

/** Percentile (0-100) of `v` against the 101 breakpoints for `group.metric`. */
function pctile(group, metric, v) {
  const breaks = state.pct?.[group]?.[metric];
  if (!breaks || v === null || v === undefined || Number.isNaN(v)) return null;
  if (v <= breaks[0]) return 0;
  if (v >= breaks[100]) return 100;
  let lo = 0;
  for (let i = 1; i <= 100; i++) { if (breaks[i] > v) { lo = i - 1; break; } lo = i; }
  const span = breaks[lo + 1] - breaks[lo];
  const frac = span > 0 ? (v - breaks[lo]) / span : 0;
  return Math.max(0, Math.min(100, lo + frac));
}

// -------------------------------------------------------------------- theme
//
// Three settings: auto (default), light, dark. Auto reads the visitor's own
// clock -- daylight hours get the light treatment, evenings get dark -- and
// re-checks periodically so a tab left open at dusk follows along. The initial
// value is applied by an inline script in index.html, before first paint, so
// the page never flashes the wrong theme.

const THEME_KEY = 'fa-theme';
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };

const themePref = () => {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
};

const resolveTheme = (pref) => {
  if (pref === 'light' || pref === 'dark') return pref;
  const hour = new Date().getHours();
  return (hour >= 7 && hour < 19) ? 'light' : 'dark';
};

function applyTheme() {
  const pref = themePref();
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  const btn = $('#themeToggle');
  if (btn) {
    btn.textContent = THEME_ICON[pref];
    btn.title = pref === 'auto'
      ? `Theme: auto (${resolved} right now) — click to override`
      : `Theme: ${pref} — click to change`;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f7f5fb' : '#0b0810');
}

function initTheme() {
  const order = ['auto', 'light', 'dark'];
  $('#themeToggle')?.addEventListener('click', () => {
    const next = order[(order.indexOf(themePref()) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    applyTheme();
  });
  // Follow the clock across sunset without a reload.
  setInterval(() => { if (themePref() === 'auto') applyTheme(); }, 5 * 60 * 1000);
  applyTheme();
}

// ------------------------------------------------------- sport + tier chrome

function applySport(id) {
  state.sport = SPORTS[id] ? id : 'mlb';
  const s = sport();
  document.documentElement.setAttribute('data-sport', s.id);

  const search = $('#globalSearch');
  if (search) search.placeholder = s.searchPlaceholder;
  const sub = $('.brand-sub em');
  if (sub) sub.textContent = `${s.league} · scored in your league’s points`;

  document.querySelectorAll('#sportSwitch button').forEach((b) => {
    b.classList.toggle('on', b.dataset.sport === s.id);
  });
  // Every nav link carries the sport, so switching leagues keeps your place.
  document.querySelectorAll('#tabs a').forEach((a) => {
    a.setAttribute('href', `#/${s.id}/${a.dataset.view}`);
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content',
      getComputedStyle(document.body).backgroundColor || '#0b0810');
  }
}

function initSportSwitch() {
  const wrap = $('#sportSwitch');
  if (!wrap) return;
  wrap.replaceChildren(...SPORT_IDS.map((id) => el('button', {
    type: 'button', 'data-sport': id,
    class: state.sport === id ? 'on' : '',
    title: `${SPORTS[id].league} — ${SPORTS[id].name}`,
    onclick: () => go(`#/${id}/player`),
  }, SPORTS[id].short,
     SPORTS[id].status === 'placeholder' ? el('span', { class: 'soon' }, 'soon') : null)));
}

function updateTierBadge() {
  const badge = $('#tierBadge');
  if (!badge) return;
  const pro = isPro();
  badge.className = `tier-badge${pro ? ' pro' : ''}`;
  badge.textContent = pro ? 'PRO' : 'FREE';
  badge.title = pro ? 'Pro features unlocked — tap to see plans'
                    : 'Free plan — tap to see what Pro adds';
}

// --------------------------------------------------------------- gating UI

/** The bar that replaces content the free plan does not include. */
function upgradeBar(headline, detail) {
  return el('div', { class: 'upgrade-bar' },
    el('div', { class: 'upgrade-text' },
      el('b', {}, headline),
      detail ? el('span', {}, detail) : null),
    el('a', { class: 'btn primary', href: '#/pricing' }, 'See Pro'));
}

/** Everything the free tier is allowed to see of a list. */
function limitRows(rows, cap) {
  return isPro() ? rows : rows.slice(0, cap);
}

function downloadCSV(rows, cols, filename) {
  const header = cols.map((c) => c.label).join(',');
  const body = rows.map((r) => cols.map((c) => {
    const v = c.raw ? c.raw(r) : r[c.key];
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportButton(rows, cols, filename) {
  if (!isPro()) {
    return el('a', { class: 'btn lock', href: '#/pricing', title: 'Pro feature' },
      '↓ Export CSV', el('span', { class: 'lock-icon' }, '🔒'));
  }
  return el('button', { class: 'btn', onclick: () => downloadCSV(rows, cols, filename) },
    '↓ Export CSV');
}

/** Panel shown for a sport whose dataset does not exist yet. */
function awaitingData(viewName) {
  const s = sport();
  return el('div', {},
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, `${s.league} ${viewName}`),
        el('span', { class: 'hint' }, 'Dataset not built yet')),
      el('div', { class: 'empty-state' },
        el('h3', {}, `${s.league} data is not loaded yet`),
        el('div', {}, `The ${viewName.toLowerCase()} view is built and waiting on a ` +
          `${s.league} dataset. Scoring rules and roster are already configured — ` +
          'see the Scoring tab.')),
      el('div', { class: 'note', html:
        `<b>What it needs.</b> ${s.dataNote} Once a dataset is built into ` +
        `<code>web/${s.dataDir}/</code> in the same shape as the MLB one, every ` +
        'view on this page starts working with no further changes.' }),
      watermark()),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Meanwhile')),
      el('div', { class: 'empty-state' },
        el('div', {}, 'Baseball is fully loaded — ',
          el('a', { href: '#/mlb/career' }, 'browse the MLB leaders'), '.'))));
}

/** True when the current sport has a dataset behind it. */
const sportHasData = () => sport().status === 'live';

// --------------------------------------------------------------- watermark

/** The house mark, for work product: player cards, boards, charts. */
function watermark(centered = false) {
  return el('div', { class: `watermark${centered ? ' center' : ''}` }, SITE.watermark);
}

// ---------------------------------------------------------------- ad slots

let adScriptLoaded = false;

/** An ad container, or null when ads are off — a reserved empty box on a page
 *  with nothing running just reads as broken layout. */
function adSlot(slotName) {
  const { enabled, client, slots } = SITE.ads;
  if (!enabled || !client) return null;
  const slotId = slots[slotName];
  if (!adScriptLoaded) {
    const s = el('script', {
      async: 'true', crossorigin: 'anonymous',
      src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
    });
    document.head.append(s);
    adScriptLoaded = true;
  }
  const ins = el('ins', {
    class: 'adsbygoogle', style: 'display:block;width:100%',
    'data-ad-client': client, 'data-ad-slot': slotId,
    'data-ad-format': 'auto', 'data-full-width-responsive': 'true',
  });
  const box = el('div', { class: 'ad-slot' }, ins);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
  return box;
}

/** Optional tip-jar block, off by default. */
function supportCard() {
  const { enabled, url, label, blurb } = SITE.support;
  if (!enabled || !url) return null;
  return el('div', { class: 'support-card' },
    el('h3', {}, label),
    el('p', {}, blurb),
    el('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, label));
}

// ------------------------------------------------------- custom league rules
//
// THE PRODUCT. Everything on this site is scored with weights the visitor
// controls. Change what a stolen base is worth and every page -- player, board,
// season, projection -- recomputes from the raw counting stats that ship with
// each row. The precomputed points in the dataset are just the default view.

const SCORING_KEY = 'da-scoring';

function defaultScoring() {
  return {
    batting: { ...(state.meta?.batting_scoring || {}) },
    pitching: { ...(state.meta?.pitching_scoring || {}) },
  };
}

function customScoring() {
  try {
    const raw = localStorage.getItem(SCORING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** The weights in force right now: the league's defaults unless overridden. */
function activeScoring() {
  const base = defaultScoring();
  const custom = customScoring();
  if (!custom) return base;
  return {
    batting: { ...base.batting, ...(custom.batting || {}) },
    pitching: { ...base.pitching, ...(custom.pitching || {}) },
  };
}

const usingCustomScoring = () => customScoring() !== null;

function saveScoring(rules) {
  try { localStorage.setItem(SCORING_KEY, JSON.stringify(rules)); }
  catch { /* private mode */ }
  state.boards.clear();
  state.ranks.clear();
  state.shards.clear();
  route();
}

function resetScoring() {
  try { localStorage.removeItem(SCORING_KEY); } catch { /* ignore */ }
  state.boards.clear();
  state.ranks.clear();
  state.shards.clear();
  route();
}

/** Score a batting line from raw counting stats. `get` reads a category. */
function scoreBatting(get, weights) {
  const singles = get('H') - get('D2') - get('D3') - get('HR');
  const parts = {
    R: get('R'), '1B': singles, '2B': get('D2'), '3B': get('D3'),
    HR: get('HR'), RBI: get('RBI'), SB: get('SB'), CS: get('CS'),
    BB: get('BB'), IBB: get('IBB'), HBP: get('HBP'), SO: get('SO'),
    H: get('H'), AB: get('AB'), TB: singles + 2 * get('D2') + 3 * get('D3') + 4 * get('HR'),
  };
  let points = 0;
  for (const [cat, w] of Object.entries(weights)) {
    if (parts[cat] !== undefined) points += w * parts[cat];
  }
  return points;
}

function scorePitching(get, weights) {
  const parts = {
    IP: get('IPouts') / 3, W: get('W'), L: get('L'), CG: get('CG'),
    SHO: get('SHO'), SV: get('SV'), ER: get('ER'), K: get('SO'),
    H: get('H'), BB: get('BB'), HR: get('HR'), HBP: get('HBP'),
    GS: get('GS'),
  };
  let points = 0;
  for (const [cat, w] of Object.entries(weights)) {
    if (parts[cat] !== undefined) points += w * parts[cat];
  }
  return points;
}

/** Reader over a packed array row, given its index map. */
const packed = (row, map) => (key) => (map[key] === undefined ? 0 : (row[map[key]] || 0));
/** Reader over a leaderboard row object. */
const flat = (row) => (key) => Number(row[key]) || 0;

/** Recompute a whole leaderboard in place under the active weights. */
function applyScoring(rows, group, isCareer) {
  if (!usingCustomScoring()) return rows;
  const w = activeScoring();
  for (const row of rows) {
    row.pts = group === 'batting'
      ? scoreBatting(flat(row), w.batting)
      : scorePitching(flat(row), w.pitching);
    row.ptsg = row.G ? row.pts / row.G : 0;
    if (isCareer) {
      if (group === 'batting') row.ptspa = row.PA ? row.pts / row.PA : 0;
      else row.ptsip = row.IPouts ? row.pts / (row.IPouts / 3) : 0;
    }
    // The era adjustment is calibrated on the league's own weights; it cannot
    // follow arbitrary ones without re-deriving every season's baseline.
    row.ptsplus = null;
  }
  return rows;
}

/** Recompute every points figure on a player record under the active weights. */
function rescorePlayer(p) {
  if (!p || !usingCustomScoring()) return p;
  const w = activeScoring();
  for (const row of p.bat || []) {
    row[B.PTS] = scoreBatting(packed(row, B), w.batting);
    row[B.PLUS] = null;
  }
  for (const row of p.pit || []) {
    row[P.PTS] = scorePitching(packed(row, P), w.pitching);
    row[P.PLUS] = null;
  }
  if (p.cb) p.cb[CB.PTS] = scoreBatting(packed(p.cb, CB), w.batting);
  if (p.cp) p.cp[CP.PTS] = scorePitching(packed(p.cp, CP), w.pitching);
  return p;
}

// ------------------------------------------------------- advanced metrics
//
// Sabermetrics computed in the browser from the counting stats already on the
// page. No extra request, no third-party feed -- and they follow the same rows
// the custom weights do.

/** A synthetic league baseline for a whole career: each season the player
 *  played, weighted by his own opportunities in it. Comparing a 20-year career
 *  against any single season's league would be arbitrary. */
function careerContext(rows, map, denomKey) {
  const table = state.meta.league_context || {};
  const acc = { obp: 0, slg: 0, era: 0, fipC: 0, w: { obp: 0, slg: 0, era: 0, fipC: 0 } };
  for (const row of rows) {
    const ctx = table[row[map.YEAR]];
    if (!ctx) continue;
    const weight = row[map[denomKey]] || 0;
    if (!weight) continue;
    for (const key of ['obp', 'slg', 'era', 'fipC']) {
      if (typeof ctx[key] === 'number') { acc[key] += ctx[key] * weight; acc.w[key] += weight; }
    }
  }
  const out = {};
  for (const key of ['obp', 'slg', 'era', 'fipC']) {
    if (acc.w[key]) out[key] = acc[key] / acc.w[key];
  }
  // Cached under a key the metric helpers can look up like any season.
  state.meta.league_context.__career = out;
  return '__career';
}

function battingMetrics(get, year) {
  const ab = get('AB'), h = get('H'), bb = get('BB'), hbp = get('HBP');
  const d2 = get('D2'), d3 = get('D3'), hr = get('HR'), so = get('SO');
  const pa = get('PA') || (ab + bb + hbp);
  const singles = h - d2 - d3 - hr;
  const tb = singles + 2 * d2 + 3 * d3 + 4 * hr;
  const obpDen = ab + bb + hbp;
  const avg = ab ? h / ab : 0;
  const obp = obpDen ? (h + bb + hbp) / obpDen : 0;
  const slg = ab ? tb / ab : 0;
  const babipDen = ab - so - hr;
  const ctx = state.meta.league_context?.[year];
  const ops = obp + slg;
  const opsPlus = ctx && ctx.obp && ctx.slg
    ? 100 * (obp / ctx.obp + slg / ctx.slg - 1) : null;
  return {
    AVG: avg, OBP: obp, SLG: slg, OPS: ops,
    ISO: slg - avg,
    BABIP: babipDen > 0 ? (h - hr) / babipDen : 0,
    'BB%': pa ? bb / pa : 0,
    'K%': pa ? so / pa : 0,
    'OPS+': opsPlus,
  };
}

function pitchingMetrics(get, year) {
  const outs = get('IPouts'), innings = outs / 3;
  const bb = get('BB'), so = get('SO'), hr = get('HR');
  const hits = get('H'), er = get('ER'), hbp = get('HBP');
  const ctx = state.meta.league_context?.[year];
  const fipC = ctx?.fipC;
  return {
    ERA: innings ? er * 9 / innings : 0,
    WHIP: innings ? (bb + hits) / innings : 0,
    'K/9': innings ? so * 9 / innings : 0,
    'BB/9': innings ? bb * 9 / innings : 0,
    'HR/9': innings ? hr * 9 / innings : 0,
    FIP: innings && fipC !== undefined
      ? (13 * hr + 3 * (bb + hbp) - 2 * so) / innings + fipC : null,
    'ERA+': innings && ctx?.era && er >= 0
      ? (er ? 100 * ctx.era / (er * 9 / innings) : null) : null,
  };
}

const METRIC_DP = { AVG: 3, OBP: 3, SLG: 3, OPS: 3, ISO: 3, BABIP: 3,
                    ERA: 2, WHIP: 2, 'K/9': 1, 'BB/9': 1, 'HR/9': 1, FIP: 2 };

function metricsPanel(title, metrics, note) {
  const cells = Object.entries(metrics)
    .filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v))
    .map(([label, v]) => el('div', { class: 'metric' },
      el('div', { class: 'metric-label' }, label),
      el('div', { class: 'metric-value' },
        label.endsWith('%') ? `${(v * 100).toFixed(1)}%`
                            : num(v, METRIC_DP[label] ?? 0))));
  if (!cells.length) return null;
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, title),
      note ? el('span', { class: 'hint' }, note) : null),
    el('div', { class: 'metrics' }, cells),
    // OPS+ and ERA+ elsewhere are usually park-adjusted; these are not, because
    // the databank carries no park factors. Expect a few points of difference
    // against Baseball-Reference, especially for extreme home parks.
    el('div', { class: 'metrics-note' },
      'Computed in your browser from the counting stats on this page. ' +
      'OPS+ and ERA+ are league-adjusted but not park-adjusted.'),
    watermark());
}

// --------------------------------------------------------------- projection
//
// A Marcel-style forecast: weight the last three seasons 5/4/3, regress toward
// the league's own rate, then apply an age curve. Marcel is deliberately the
// simplest forecast worth running -- Tom Tango published it as the baseline any
// projection system should have to beat -- and it needs nothing but the seasons
// already on the page, so it follows the visitor's custom weights for free.

const AGE_PEAK = 27;

function marcel(rows, map, ptsKey, denomKey, birthYear, weights, scorer) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b[map.YEAR] - a[map.YEAR]);
  const recent = sorted.slice(0, 3);
  const lastYear = recent[0][map.YEAR];
  const seasonWeights = [5, 4, 3];

  let wPts = 0, wDen = 0, wTotal = 0;
  recent.forEach((row, i) => {
    const w = seasonWeights[i];
    wPts += w * scorer(packed(row, map), weights);
    wDen += w * (row[map[denomKey]] || 0);
    wTotal += w;
  });
  if (!wDen) return null;

  const rate = wPts / wDen;
  // Regress toward the league mean with a fixed prior; the fewer opportunities
  // behind the rate, the more it gets pulled back.
  const prior = denomKey === 'PA' ? 1200 : 400;
  const leagueRate = state.leagueRate?.[denomKey === 'PA' ? 'bat' : 'pit'] ?? rate;
  const regressed = (wPts + leagueRate * prior) / (wDen + prior);

  const projDen = (recent[0][map[denomKey]] || 0) * 0.9 +
                  (wDen / wTotal) * 0.1 * 3;
  const age = birthYear ? (lastYear + 1) - birthYear : null;
  const ageFactor = age === null ? 1
    : age > AGE_PEAK ? Math.max(0.7, 1 - 0.003 * (age - AGE_PEAK) ** 1.4)
                     : Math.min(1.1, 1 + 0.006 * (AGE_PEAK - age));

  return {
    season: lastYear + 1,
    age: age === null ? null : age + 1,
    rate: regressed,
    denom: Math.round(projDen),
    points: regressed * projDen * ageFactor,
    seasonsUsed: recent.length,
    ageFactor,
  };
}

function projectionPanel(p) {
  const w = activeScoring();
  const bat = (p.bat || []).filter((r) => r[B.PA] > 0);
  const pit = (p.pit || []).filter((r) => r[P.IPOUTS] > 0);
  const cards = [];

  if (bat.length) {
    const m = marcel(bat, B, 'PTS', 'PA', p.by, w.batting, scoreBatting);
    if (m) cards.push(['Batting', m, `${num(m.denom)} PA`]);
  }
  if (pit.length) {
    const m = marcel(pit, P, 'PTS', 'IPOUTS', p.by, w.pitching, scorePitching);
    if (m) cards.push(['Pitching', m, `${ipFrom((m.denom || 0) / 3)} IP`]);
  }
  if (!cards.length) return null;

  const season = cards[0][1].season;
  const total = cards.reduce((sum, [, m]) => sum + m.points, 0);

  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, `Projected ${season}`),
      el('span', { class: 'hint' },
        'Marcel-style forecast · scored on your current settings')),
    el('div', { class: 'tiles' },
      tile('Projected points', num(total, 0),
        cards[0][1].age ? `age ${cards[0][1].age} season` : null, true),
      cards.map(([label, m, denom]) =>
        tile(`${label} points`, num(m.points, 0), denom)),
      tile('Age curve', `${m2pct(cards[0][1].ageFactor)}`,
        cards[0][1].ageFactor >= 1 ? 'still improving' : 'past peak')),
    el('div', { class: 'note', html:
      '<b>How this is built.</b> The last three seasons weighted 5/4/3, ' +
      'regressed toward the league rate, then adjusted for age off a peak of ' +
      `${AGE_PEAK}. Marcel is the deliberately simple baseline any forecast ` +
      'should beat, not a full projection system — treat it as a sanity check, not ' +
      'a draft board. It rescores instantly when you change your league settings.' }),
    watermark());
}

const m2pct = (f) => `${f >= 1 ? '+' : ''}${((f - 1) * 100).toFixed(1)}%`;

// --------------------------------------------------------------------- bios
//
// Nicknames are not in any public statistical database, so this is a curated
// list of the well-established ones. Everything else in a player's write-up is
// generated from the data on the page: milestones, awards, era, and where he
// ranks all-time.

const NICKNAMES = {
  ruthba01: 'The Bambino · The Sultan of Swat', cobbty01: 'The Georgia Peach',
  willite01: 'The Splendid Splinter · Teddy Ballgame', mayswi01: 'The Say Hey Kid',
  aaronha01: 'Hammerin’ Hank', dimagjo01: 'Joltin’ Joe · The Yankee Clipper',
  gehrilo01: 'The Iron Horse', musiast01: 'Stan the Man',
  robinja02: 'Jackie', paigesa01: 'Satchel', johnswa01: 'The Big Train',
  youngcy01: 'Cy', alexape01: 'Old Pete', deandi01: 'Dizzy',
  ryanno01: 'The Ryan Express', johnsra05: 'The Big Unit',
  martipe02: 'Pedro', riverma01: 'The Sandman', hoffmtr01: 'Hells Bells',
  eckerde01: 'The Eck', fingero01: 'Rollie', gossari01: 'Goose',
  henderi01: 'The Man of Steal', bondsba01: 'Barry',
  griffke02: 'The Kid · Junior', jeterde01: 'The Captain',
  pujolal01: 'The Machine', ortizda01: 'Big Papi', rodrial01: 'A-Rod',
  thomafr04: 'The Big Hurt', ramirma02: 'Manny', guerrvl01: 'Vlad the Impaler',
  jonesch06: 'Chipper', biggicr01: 'Bidge', bagweje01: 'Bags',
  smithoz01: 'The Wizard of Oz', brettge01: 'Mullet',
  yastrca01: 'Yaz', schmimi01: 'Schmidty', bencjo01: 'Little General',
  morgajo02: 'Little Joe', rosepe01: 'Charlie Hustle',
  clemero01: 'The Great One', kaltery01: 'Mr. Tiger',
  killeha01: 'Killer', mccovwi01: 'Stretch', stargwi01: 'Pops',
  jacksre01: 'Mr. October', winfida01: 'Winny', murraed02: 'Steady Eddie',
  ripkeca01: 'The Iron Man', gwynnto01: 'Mr. Padre',
  boggswa01: 'Chicken Man', molitpa01: 'The Ignitor',
  carewro01: 'Rod', fiskca01: 'Pudge', rodriiv01: 'Pudge',
  piazzmi01: 'Mike', bagweje01x: '', ohtansh01: 'Shotime',
  troutmi01: 'The Millville Meteor', judgeaa01: 'All Rise',
  scherma01: 'Mad Max', kershcl01: 'Kersh', verlaju01: 'JV',
  clemero02: 'The Rocket', maddugr01: 'The Professor', glavito02: 'Tom',
  smoltjo01: 'Smoltzie', schilcu01: 'Schill', hallaro01: 'Doc',
  hallaro01x: '', carltst01: 'Lefty', seaveto01: 'Tom Terrific',
  gibsobo01: 'Hoot', koufasa01: 'The Left Arm of God',
  drysddo01: 'Big D', marisro01: 'Roger', mantlmi01: 'The Mick',
  berrayo01: 'Yogi', fordwh01: 'The Chairman of the Board',
  snidedu01: 'The Duke of Flatbush', camparo01: 'Campy',
  hornsro01: 'The Rajah', speaktr01: 'The Grey Eagle',
  wagneho01: 'The Flying Dutchman', collied01: 'Cocky',
  lajoina01: 'Nap', foxxji01: 'Double X · The Beast',
  greenha01: 'Hammerin’ Hank', ottme01: 'Master Melvin',
  simmoal01: 'Bucketfoot Al', medwijo01: 'Ducky',
  radboch01: 'Old Hoss', keefeti01: 'Sir Timothy',
};

/** Milestones worth calling out, checked against career totals. */
function milestones(p) {
  const out = [];
  const c = p.cb, q = p.cp;
  if (c) {
    if (c[CB.HR] >= 500) out.push(`${num(c[CB.HR])} home runs`);
    if (c[CB.H] >= 3000) out.push(`${num(c[CB.H])} hits`);
    if (c[CB.R] >= 1500) out.push(`${num(c[CB.R])} runs`);
    if (c[CB.RBI] >= 1500) out.push(`${num(c[CB.RBI])} RBI`);
    if (c[CB.SB] >= 400) out.push(`${num(c[CB.SB])} stolen bases`);
    if (c[CB.BB] >= 1500) out.push(`${num(c[CB.BB])} walks`);
  }
  if (q) {
    if (q[CP.W] >= 250) out.push(`${num(q[CP.W])} wins`);
    if (q[CP.SO] >= 2500) out.push(`${num(q[CP.SO])} strikeouts`);
    if (q[CP.SV] >= 300) out.push(`${num(q[CP.SV])} saves`);
    if (q[CP.SHO] >= 40) out.push(`${num(q[CP.SHO])} shutouts`);
  }
  return out;
}

function eraName(year) {
  const hit = ERAS.slice(1).find(([, lo, hi]) => year >= lo && year <= hi);
  return hit ? hit[0] : null;
}

/** A short written profile, assembled from the record rather than scraped. */
function bioPanel(p, ranks) {
  const years = [];
  for (const r of p.bat || []) years.push(r[B.YEAR]);
  for (const r of p.pit || []) years.push(r[P.YEAR]);
  if (!years.length) return null;
  const first = Math.min(...years), last = Math.max(...years);

  const teams = [...new Set([...(p.bat || []).map((r) => r[B.TEAM]),
                             ...(p.pit || []).map((r) => r[P.TEAM])]
    .flatMap((t) => String(t).split('/')).filter(Boolean))];

  const sentences = [];
  const role = p.pos === 'P' ? 'pitcher' : `${p.pos || 'player'}`;
  const era = eraName(Math.round((first + last) / 2));
  sentences.push(
    `<b>${p.n}</b> played ${last - first + 1} season${last - first ? 's' : ''} ` +
    `as a ${role} from <b>${first} to ${last}</b>${era ? `, through the ${era} era` : ''}, ` +
    `appearing for ${teams.length} club${teams.length === 1 ? '' : 's'}.`);

  if (p.hof) {
    sentences.push(`Inducted into the Hall of Fame in <b>${p.hof}</b>.`);
  }
  const aw = p.aw || {};
  const honours = [];
  if (aw.MVP) honours.push(`${aw.MVP}× MVP`);
  if (aw.CY) honours.push(`${aw.CY}× Cy Young`);
  if (aw.ROY) honours.push('Rookie of the Year');
  if (aw.TC) honours.push(`${aw.TC}× Triple Crown`);
  if (aw.GG) honours.push(`${aw.GG}× Gold Glove`);
  if (aw.SS) honours.push(`${aw.SS}× Silver Slugger`);
  if (honours.length) sentences.push(`Honours: ${honours.join(', ')}.`);

  const miles = milestones(p);
  if (miles.length) sentences.push(`Career milestones: ${miles.join(', ')}.`);

  if (ranks?.batting) {
    sentences.push(`Ranks <b>${ordinal(ranks.batting)}</b> all-time in league ` +
      'points among hitters.');
  }
  if (ranks?.pitching) {
    sentences.push(`Ranks <b>${ordinal(ranks.pitching)}</b> all-time in league ` +
      'points among pitchers.');
  }
  if (p.bt || p.bc) {
    sentences.push(`Born in ${[p.bt, p.bs, p.bc].filter(Boolean).join(', ')}` +
      `${p.by ? ` in ${p.by}` : ''}.`);
  }

  const nickname = NICKNAMES[p.p];
  const links = el('div', { class: 'bio-links' },
    p.br ? el('a', { class: 'btn', target: '_blank', rel: 'noopener',
                     href: `https://www.baseball-reference.com/players/${p.br[0]}/${p.br}.shtml` },
              'Baseball-Reference') : null,
    el('a', { class: 'btn', target: '_blank', rel: 'noopener',
              href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(p.n + ' baseball')}` },
       'Wikipedia'));

  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Profile'),
      el('span', { class: 'hint' }, 'Written from the record, not scraped')),
    el('div', { class: 'bio' },
      nickname ? el('div', { class: 'bio-nick' }, `“${nickname}”`) : null,
      el('p', { html: sentences.join(' ') }),
      links),
    watermark());
}

// ------------------------------------------------------------------ tooltip

let tipEl = null;
function showTip(html, evt) {
  if (!tipEl) { tipEl = el('div', { class: 'tooltip' }); document.body.append(tipEl); }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  const pad = 14;
  const r = tipEl.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ------------------------------------------------------------------- search

function searchPlayers(query, limit = 12) {
  const q = norm(query.trim());
  if (!q) return [];
  const terms = q.split(/\s+/);
  const { ids, names, y0, y1, pos, bp, pp, hof } = state.index;
  const hits = [];

  for (let i = 0; i < names.length; i++) {
    const n = state.norm[i];
    const last = n.slice(n.indexOf(' ') + 1);
    let score = 0;
    // People search by surname. A bare surname that matches exactly outranks a
    // first-name prefix, and a surname prefix ties with one -- otherwise typing
    // "mays" surfaces Mays Copeland, a 1935 pitcher, ahead of Willie Mays,
    // purely because his given name starts with the query.
    if (n === q) score = 1000;
    else if (last === q) score = 900;
    else if (n.startsWith(q) || last.startsWith(q)) score = 800;
    else if (terms.every((t) => n.includes(t))) score = n.includes(q) ? 500 : 300;
    if (!score) continue;
    // Break ties toward the players someone is most likely to mean.
    const career = bp[i] + pp[i];
    hits.push({ i, id: ids[i], name: names[i], y0: y0[i], y1: y1[i],
                pos: pos[i], pts: career, hof: hof[i], score: score + Math.min(career / 200, 90) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function initSearch() {
  const input = $('#globalSearch');
  const panel = $('#searchResults');
  let sel = -1, hits = [];

  const close = () => { panel.hidden = true; sel = -1; };

  const render = () => {
    panel.innerHTML = '';
    if (!hits.length) {
      panel.append(el('div', { class: 'sr-empty' }, 'No player found. Try a last name.'));
    }
    hits.forEach((h, k) => {
      const q = norm(input.value.trim());
      const at = norm(h.name).indexOf(q);
      const nameHtml = at >= 0
        ? `${h.name.slice(0, at)}<mark>${h.name.slice(at, at + q.length)}</mark>${h.name.slice(at + q.length)}`
        : h.name;
      panel.append(el('div', {
        class: `sr-item${k === sel ? ' sel' : ''}`,
        onclick: () => { close(); input.value = ''; go(playerHref(h.id)); },
      },
        el('div', {},
          el('div', { class: 'sr-name', html: nameHtml + (h.hof ? ' <span class="hof-star">★ HOF</span>' : '') }),
          el('div', { class: 'sr-meta' }, `${h.y0}–${h.y1} · ${h.pos || '—'}`)),
        el('div', { class: 'sr-pts' }, num(h.pts, 0), el('small', {}, 'CAREER PTS'))));
    });
    panel.hidden = false;
  };

  input.addEventListener('input', () => {
    hits = searchPlayers(input.value);
    sel = -1;
    input.value.trim() ? render() : close();
  });

  input.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, hits.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') {
      const h = hits[sel >= 0 ? sel : 0];
      if (h) { close(); input.value = ''; go(playerHref(h.id)); }
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  });
}

// ------------------------------------------------------------ UI components

function tile(label, value, sub, hero = false) {
  // "171·428·437" needs a different size from "6" — a single headline size
  // either clips the compound values or wastes the tile on the short ones.
  const compound = typeof value === 'string' && /[·–]/.test(value);
  return el('div', { class: `tile${hero ? ' hero' : ''}` },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: `tile-value${compound ? ' compound' : ''}` }, value),
    sub ? el('div', { class: 'tile-sub', html: sub }) : null);
}

function rail(label, value, percentile, display) {
  const p = percentile === null ? null : Math.round(percentile);
  const track = el('div', { class: 'rail-track' });
  if (p !== null) {
    track.append(el('div', { class: 'rail-fill', style: `width:${p}%` }));
    track.append(el('div', {
      class: `rail-dot${p < 50 ? ' low' : ''}`,
      style: `left:${Math.max(3, Math.min(97, p))}%`,
    }, p));
  }
  return el('div', { class: 'rail' },
    el('div', { class: 'rail-label' }, label),
    track,
    el('div', { class: 'rail-value' }, display ?? num(value, 0)));
}

/** Sortable table. `cols` = [{key, label, fmt, cls, sort}] */
function statTable(rows, cols, opts = {}) {
  let sortKey = opts.sortKey ?? null;
  let asc = opts.asc ?? false;
  const wrap = el('div', { class: 'table-scroll' });
  const table = el('table', { class: 'stats' });
  wrap.append(table);

  const draw = () => {
    table.innerHTML = '';
    wrap.querySelectorAll(':scope > .more').forEach((n) => n.remove());
    let data = [...rows];
    if (sortKey) {
      const col = cols.find((c) => c.key === sortKey);
      data.sort((a, b) => {
        const va = col.sortVal ? col.sortVal(a) : a[sortKey];
        const vb = col.sortVal ? col.sortVal(b) : b[sortKey];
        if (typeof va === 'string' || typeof vb === 'string') {
          return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        }
        return asc ? (va ?? -Infinity) - (vb ?? -Infinity) : (vb ?? -Infinity) - (va ?? -Infinity);
      });
    }
    const limit = opts.limit ?? data.length;
    const shown = data.slice(0, limit);

    const thead = el('thead');
    const tr = el('tr');
    if (opts.rank) tr.append(el('th', {}, '#'));
    cols.forEach((c) => {
      const th = el('th', {
        class: `sortable${sortKey === c.key ? ' sorted' + (asc ? ' asc' : '') : ''}`,
        title: c.title || c.label,
        onclick: () => {
          if (sortKey === c.key) asc = !asc; else { sortKey = c.key; asc = !!c.ascDefault; }
          draw();
        },
      }, c.label);
      tr.append(th);
    });
    thead.append(tr);
    table.append(thead);

    const tbody = el('tbody');
    shown.forEach((row, i) => {
      const tr = el('tr', row.__total ? { class: 'total' } : {});
      if (opts.rank) {
        tr.append(el('td', { class: `rank-cell${i < 3 ? ' top' : ''}` }, row.__total ? '' : i + 1));
      }
      cols.forEach((c) => {
        const v = c.get ? c.get(row) : row[c.key];
        const td = el('td', { class: c.cls || '' });
        if (v && v.nodeType) td.append(v);
        else td.append(document.createTextNode(v === null || v === undefined ? '—' : String(v)));
        if (c.heat && !row.__total) {
          const raw = row[c.key];
          const t = c.heat(raw);
          if (t > 0) {
            td.classList.add('heat');
            td.style.setProperty('--heat', `rgba(168,85,247,${(t * 0.34).toFixed(3)})`);
            td.innerHTML = `<span>${td.textContent}</span>`;
          }
        }
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);

    if (data.length > shown.length) {
      wrap.append(el('div', { class: 'more', style: 'padding:14px 18px;text-align:center' },
        el('button', {
          class: 'btn',
          onclick: () => { opts.limit = (opts.limit ?? 0) + (opts.page ?? 200); draw(); },
        }, `Show more (${num(data.length - shown.length)} remaining)`)));
    }
  };

  draw();
  return wrap;
}

/** Career points-by-season bar chart; batting and pitching stack. */
function seasonChart(seasons, onPick, selected) {
  // Drawn at a fixed logical width and scaled by the viewBox, so it fills a
  // desktop panel and shrinks cleanly on a phone without re-layout.
  const W = Math.max(1400, seasons.length * 46);
  const H = 210, padL = 46, padR = 14, padT = 14, padB = 30;
  const max = Math.max(...seasons.map((s) => s.bat + s.pit), 1);
  const bw = (W - padL - padR) / seasons.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);

  // SVG nodes must be namespaced: document.createElement('svg') yields an inert
  // HTMLUnknownElement that renders nothing at all.
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (t, a = {}) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    return n;
  };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          style: 'max-width:100%;height:auto' });

  const defs = mk('defs');
  defs.innerHTML =
    `<linearGradient id="gBat" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#c4a2ff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>
     <linearGradient id="gPit" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#3c1673"/></linearGradient>`;
  svg.append(defs);

  const step = max > 800 ? 200 : max > 400 ? 100 : max > 150 ? 50 : 25;
  for (let v = 0; v <= max; v += step) {
    svg.append(mk('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'chart-grid' }));
    const t = mk('text', { x: padL - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'chart-axis' });
    t.textContent = v;
    svg.append(t);
  }

  seasons.forEach((s, i) => {
    const x = padL + i * bw;
    const w = Math.max(3, bw - 4);
    const g = mk('g', { class: `bar${selected === s.year ? ' sel' : ''}` });
    const total = s.bat + s.pit;
    if (s.bat > 0) {
      g.append(mk('rect', { x, y: y(s.bat), width: w, height: Math.max(1, y(0) - y(s.bat)),
                            fill: 'url(#gBat)', rx: 2 }));
    }
    if (s.pit > 0) {
      g.append(mk('rect', { x, y: y(total), width: w, height: Math.max(1, y(0) - y(s.pit)),
                            fill: 'url(#gPit)', rx: 2 }));
    }
    if (total <= 0) {
      g.append(mk('rect', { x, y: y(0) - 2, width: w, height: 2, fill: '#3a3050' }));
    }
    g.addEventListener('mousemove', (e) => showTip(
      `<b>${s.year}</b> · ${s.team || ''}
       <div class="tt-row"><span>Total</span><span>${num(total, 1)}</span></div>` +
      (s.bat ? `<div class="tt-row"><span>Batting</span><span>${num(s.bat, 1)}</span></div>` : '') +
      (s.pit ? `<div class="tt-row"><span>Pitching</span><span>${num(s.pit, 1)}</span></div>` : ''),
      e));
    g.addEventListener('mouseleave', hideTip);
    g.addEventListener('click', () => onPick(s.year));
    svg.append(g);

    if (seasons.length <= 30 || i % Math.ceil(seasons.length / 22) === 0) {
      const t = mk('text', { x: x + w / 2, y: H - 10, 'text-anchor': 'middle', class: 'chart-axis' });
      t.textContent = `'${String(s.year).slice(2)}`;
      svg.append(t);
    }
  });

  // Charts travel — screenshots get shared without the page around them, so the
  // mark is baked into the SVG itself rather than layered over it in CSS.
  const mark = mk('text', { x: W - padR, y: padT + 4, 'text-anchor': 'end', class: 'chart-mark' });
  mark.textContent = SITE.watermark;
  svg.append(mark);

  return el('div', { class: 'chart-wrap' }, svg);
}

// -------------------------------------------------------------- player view

async function viewPlayer(key) {
  const id = resolveId(key);
  if (!id) {
    return app().replaceChildren(el('div', { class: 'view-head' },
      el('h1', {}, 'Player Lookup'),
      el('p', {}, 'Search any of the ' + num(state.meta.players) +
        ' players in major-league history and see their career scored in our league’s points. Press / to jump to the search box.')),
      el('div', { class: 'panel' }, el('div', { class: 'empty-state' },
        el('h3', {}, 'Start typing a name'),
        el('div', {}, 'Try Bonds, Ohtani, Mays, Rivera, Radbourn…'))),
      randomSuggestions());
  }

  const p = rescorePlayer(await getShard(id));
  if (!p) {
    return app().replaceChildren(el('div', { class: 'empty-state' },
      el('h3', {}, EMBEDDED ? 'Not in this preview' : 'Player not found'),
      el('div', {}, EMBEDDED
        ? `This preview carries full season logs for the ${num(EMBEDDED.playerCount)} ` +
          'highest-scoring careers. Search still covers all ' +
          `${num(state.meta.players)} players, and the deployed site has every one of them.`
        : 'Check the link and try again.')));
  }

  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const scope = params.get('season') || 'career';

  const bat = p.bat || [], pit = p.pit || [];
  const years = [...new Set([...bat.map((r) => r[B.YEAR]), ...pit.map((r) => r[P.YEAR])])].sort();
  const isTwoWay = bat.length > 0 && pit.length > 0 &&
                   (p.cb?.[CB.PTS] ?? 0) > 200 && (p.cp?.[CP.PTS] ?? 0) > 200;
  const primaryPitcher = (p.cp?.[CP.PTS] ?? 0) > (p.cb?.[CB.PTS] ?? 0);

  // --- hero ---------------------------------------------------------------
  const badges = el('div', { class: 'ph-badges' });
  if (p.hof) badges.append(el('span', { class: 'badge gold' }, `★ Hall of Fame ${p.hof}`));
  if (p.pos) badges.append(el('span', { class: 'badge' }, p.pos));
  badges.append(el('span', { class: 'badge ghost' }, `${years[0]}–${years[years.length - 1]}`));
  if (isTwoWay) badges.append(el('span', { class: 'badge' }, 'Two-way'));
  for (const [k, label] of [['MVP', 'MVP'], ['CY', 'Cy Young'], ['ROY', 'ROY'],
                            ['GG', 'Gold Glove'], ['SS', 'Silver Slugger'], ['TC', 'Triple Crown']]) {
    const n = p.aw?.[k];
    if (n) badges.append(el('span', { class: 'badge' }, `${n}× ${label}`));
  }

  const bio = [];
  if (p.b || p.t) bio.push(`<b>Bats</b> ${p.b || '?'} / <b>Throws</b> ${p.t || '?'}`);
  if (p.ht) bio.push(`<b>${Math.floor(p.ht / 12)}'${p.ht % 12}"</b>${p.wt ? ` · ${p.wt} lb` : ''}`);
  if (p.bt || p.bc) bio.push(`Born ${[p.bt, p.bs, p.bc].filter(Boolean).join(', ')}${p.by ? ` (${p.by})` : ''}`);
  if (p.dbt) bio.push(`Debut ${p.dbt}`);

  const seasonSelect = el('select', {
    onchange: (e) => go(playerHref(id, `?season=${e.target.value}`)),
  }, el('option', { value: 'career' }, 'Career totals'),
     years.slice().reverse().map((y) => el('option', { value: y, selected: String(y) === scope }, y)));

  const hero = el('div', { class: 'player-hero' },
    el('div', {},
      el('h1', { class: 'ph-name' }, p.n),
      badges,
      el('div', { class: 'ph-bio', html: bio.join(' &nbsp;·&nbsp; ') })),
    el('div', { class: 'scope-switch' },
      el('label', {}, 'Showing'),
      seasonSelect,
      el('button', {
        class: 'btn',
        onclick: () => {
          if (!state.compare.includes(id)) state.compare.push(id);
          go(`#/compare/${state.compare.map(pidOf).join(',')}`);
        },
      }, '+ Add to compare')));

  const card = el('div', { class: 'panel' }, hero, watermark());
  const container = el('div', {}, card);
  app().replaceChildren(container);

  // --- tiles + rails ------------------------------------------------------
  const isCareer = scope === 'career';
  const yr = Number(scope);

  // The primary role leads the page: a pitcher opens on pitching, a hitter on
  // batting, and a two-way player on whichever earns him more points. Only a
  // two-way player gets a summary for his second role -- a shortstop's one
  // mop-up inning is history, not a headline.
  const roles = primaryPitcher ? ['pit', 'bat'] : ['bat', 'pit'];
  for (const role of roles) {
    const pitching = role === 'pit';
    if (!isTwoWay && pitching !== primaryPitcher) continue;
    const row = isCareer ? null
      : (pitching ? pit.find((r) => r[P.YEAR] === yr) : bat.find((r) => r[B.YEAR] === yr));
    const career = pitching ? p.cp : p.cb;
    if (!(isCareer ? career : row)) continue;
    await (pitching ? addPitchingBlock : addBattingBlock)(card, p, id, isCareer, row);
  }

  // --- chart --------------------------------------------------------------
  const byYear = new Map();
  for (const r of bat) byYear.set(r[B.YEAR], { year: r[B.YEAR], bat: r[B.PTS], pit: 0, team: r[B.TEAM] });
  for (const r of pit) {
    const e = byYear.get(r[P.YEAR]) || { year: r[P.YEAR], bat: 0, pit: 0, team: r[P.TEAM] };
    e.pit = r[P.PTS];
    byYear.set(r[P.YEAR], e);
  }
  const seasons = [...byYear.values()].sort((a, b) => a.year - b.year);
  container.append(el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Fantasy points by season'),
      el('span', { class: 'hint' }, isTwoWay ? 'Light = batting · dark = pitching · click a bar to drill in'
                                             : 'Click a bar to load that season')),
    seasonChart(seasons, (y) => go(playerHref(id, `?season=${y}`)), isCareer ? null : yr)));

  // --- season logs, in the same role order as the summary above -----------
  // The free plan shows a player's best seasons rather than a truncated run
  // of his first ones -- a taste of the real thing, not an arbitrary prefix.
  const trim = (rows, ptsIndex) => {
    if (isPro() || rows.length <= FREE.seasonRows) return rows;
    return [...rows].sort((a, b) => b[ptsIndex] - a[ptsIndex])
      .slice(0, FREE.seasonRows)
      .sort((a, b) => a[0] - b[0]);
  };
  const batShown = trim(bat, B.PTS);
  const pitShown = trim(pit, P.PTS);
  mount(container, (primaryPitcher
    ? [pit.length && pitchingLog(pitShown, p), bat.length && battingLog(batShown, p)]
    : [bat.length && battingLog(batShown, p), pit.length && pitchingLog(pitShown, p)]
  ).filter(Boolean));
  const hidden = (bat.length - batShown.length) + (pit.length - pitShown.length);
  if (hidden > 0) {
    mount(container, upgradeBar(
      `${hidden} more ${hidden === 1 ? 'season' : 'seasons'} on Pro`,
      `The free plan shows a player's ${FREE.seasonRows} best seasons.`));
  }

  // --- data caveats, only where they actually bite ------------------------
  const firstYear = years[0];
  const unrecorded = Object.entries(state.meta.unrecorded_before || {})
    .filter(([, from]) => firstYear < from);
  if (unrecorded.length) {
    container.append(el('div', { class: 'note', html:
      `<b>Era note:</b> ${unrecorded.map(([cat, from]) => `${cat} was not recorded before ${from}`)
        .join(', ')}. Seasons before then show 0 in those categories because nobody was ` +
      'counting, not because the player never did it — so points for those years are ' +
      'understated against a modern player’s. Marked with † in the table above.' }));
  }
  if (pit.length) {
    container.append(el('div', { class: 'note', html:
      '<b>Pitching caveat:</b> the historical databank carries no Holds, Blown Saves or ' +
      'Quality Starts, so those three categories score 0 here. Totals for relievers ' +
      '(holds) and starters (QS) are therefore conservative — see the ' +
      '<a href="#/scoring">Scoring</a> page.' }));
  }

  // --- profile, advanced metrics, projection ------------------------------
  const [batRank, pitRank] = await Promise.all([
    bat.length ? rankMap('lb_career_batting').then((m) => m.get(id)) : null,
    pit.length ? rankMap('lb_career_pitching').then((m) => m.get(id)) : null,
  ]);
  mount(container, bioPanel(p, { batting: batRank, pitching: pitRank }));

  const metricYear = isCareer ? null : yr;
  const batPanel = () => {
    if (!bat.length) return null;
    const row = metricYear ? bat.find((r) => r[B.YEAR] === metricYear) : null;
    const get = row ? packed(row, B) : packed(p.cb, CB);
    const ctx = row ? metricYear : careerContext(bat, B, 'PA');
    return metricsPanel(
      row ? `${metricYear} batting — advanced` : 'Career batting — advanced',
      battingMetrics(get, ctx),
      row ? `vs. the ${metricYear} league` : 'career rates vs. the leagues he faced');
  };
  const pitPanel = () => {
    if (!pit.length) return null;
    const row = metricYear ? pit.find((r) => r[P.YEAR] === metricYear) : null;
    const get = row ? packed(row, P) : packed(p.cp, CP);
    const ctx = row ? metricYear : careerContext(pit, P, 'IPOUTS');
    return metricsPanel(
      row ? `${metricYear} pitching — advanced` : 'Career pitching — advanced',
      pitchingMetrics(get, ctx),
      row ? `vs. the ${metricYear} league` : 'career rates vs. the leagues he faced');
  };
  mount(container, primaryPitcher ? [pitPanel(), batPanel()]
                                  : [batPanel(), pitPanel()]);
  mount(container, projectionPanel(p));

  mount(container, adSlot('inline'));

  // Live current-season figures, folded in only for someone recent enough to
  // plausibly still be playing. Awaited after the page is already on screen,
  // so a slow or failed request never delays the historical view.
  const lastPlayed = years[years.length - 1];
  const season = SITE.live.season || new Date().getFullYear();
  if (SITE.live.enabled && isPro() && lastPlayed >= season - LIVE.activeWithin) {
    const live = await ensureLive();
    const block = liveBlockFor(p, live);
    if (block) card.after(block);
    else mount(container, liveStatusNote(live, lastPlayed));
  }
}

/** Earliest season for which every scoring category was actually being kept. */
function fullyRecordedFrom() {
  const map = state.meta.unrecorded_before || {};
  return Math.max(0, ...Object.values(map));
}

async function addBattingBlock(card, p, id, isCareer, row) {
  const c = p.cb;
  const pts = isCareer ? c[CB.PTS] : row[B.PTS];
  const g   = isCareer ? c[CB.G]   : row[B.G];
  const pa  = isCareer ? c[CB.PA]  : row[B.PA];
  const grp = isCareer ? 'career_batting' : 'season_batting';
  const ranks = await rankMap('lb_career_batting');
  const rank = ranks.get(id);

  card.append(el('div', { class: 'panel-head' },
    el('h2', {}, isCareer ? 'Career batting — league points' : `${row[B.YEAR]} batting — league points`),
    el('span', { class: 'hint' }, isCareer
      ? `${c[CB.N]} seasons · ${c[CB.Y0]}–${c[CB.Y1]}`
      : `${teamName(row[B.TEAM])} · ${row[B.POS] || ''}`)));

  card.append(el('div', { class: 'tiles' },
    tile('Fantasy points', num(pts, 0),
      isCareer && rank ? `<span class="rank">${ordinal(rank)}</span> all-time` : null, true),
    tile('Points / game', num(pts / (g || 1), 2), `${num(g)} G`),
    tile('Points / PA', num(pts / (pa || 1), 3), `${num(pa)} PA`),
    !isCareer && row[B.PLUS] ? tile('PTS+', num(row[B.PLUS], 0), 'vs. league avg (100)') : null,
    isCareer ? tile('Seasons', num(c[CB.N]), `${c[CB.Y0]}–${c[CB.Y1]}`) : null,
    tile('HR / R / RBI', `${num(isCareer ? c[CB.HR] : row[B.HR])}·${num(isCareer ? c[CB.R] : row[B.R])}·${num(isCareer ? c[CB.RBI] : row[B.RBI])}`),
  ));

  if (usingCustomScoring()) {
    card.append(el('div', { class: 'note', html:
      '<b>Percentile rails are hidden under custom scoring.</b> They are ' +
      'calibrated on every qualified season scored the league\'s own way; ' +
      'against arbitrary weights they would be quietly wrong. Points, rates ' +
      'and rankings above are all recomputed on your settings. ' +
      '<a href="#/settings">Reset to the league defaults</a> to bring them back.' }));
    return;
  }

  const rails = el('div', { class: 'rails' });
  rails.append(el('div', { class: 'rail-legend' },
    el('span', {}, 'Worse'), el('span', {}, 'Percentile rank'), el('span', {}, 'Better')));
  rails.append(rail('Points', pts, pctile(grp, 'pts', pts), num(pts, 0)));
  rails.append(rail('Points/G', pts / (g || 1), pctile(grp, 'ptsg', pts / (g || 1)), num(pts / (g || 1), 2)));
  rails.append(rail('Points/PA', pts / (pa || 1), pctile(grp, 'ptspa', pts / (pa || 1)), num(pts / (pa || 1), 3)));
  if (!isCareer) {
    rails.append(rail('PTS+ (era adj.)', row[B.PLUS], pctile(grp, 'ptsplus', row[B.PLUS]), num(row[B.PLUS], 0)));
    for (const [key, idx] of [['HR', B.HR], ['R', B.R], ['RBI', B.RBI], ['SB', B.SB], ['BB', B.BB]]) {
      rails.append(rail(key, row[idx], pctile(grp, key, row[idx]), num(row[idx])));
    }
  }
  const qual = isCareer ? `${num(state.meta.qualifiers.career_pa)}+ career PA`
                        : `${num(state.meta.qualifiers.season_pa)}+ PA in a season`;
  rails.append(el('div', { class: 'rails-note' },
    `Percentiles vs. every qualified hitter in history (${qual}).`));
  card.append(rails);
}

async function addPitchingBlock(card, p, id, isCareer, row) {
  const c = p.cp;
  const pts = isCareer ? c[CP.PTS] : row[P.PTS];
  const g   = isCareer ? c[CP.G]   : row[P.G];
  const outs = isCareer ? c[CP.IPOUTS] : row[P.IPOUTS];
  const innings = outs / 3;
  const grp = isCareer ? 'career_pitching' : 'season_pitching';
  const ranks = await rankMap('lb_career_pitching');
  const rank = ranks.get(id);

  card.append(el('div', { class: 'panel-head' },
    el('h2', {}, isCareer ? 'Career pitching — league points' : `${row[P.YEAR]} pitching — league points`),
    el('span', { class: 'hint' }, isCareer
      ? `${c[CP.N]} seasons · ${c[CP.Y0]}–${c[CP.Y1]}`
      : teamName(row[P.TEAM]))));

  card.append(el('div', { class: 'tiles' },
    tile('Fantasy points', num(pts, 0),
      isCareer && rank ? `<span class="rank">${ordinal(rank)}</span> all-time` : null, true),
    tile('Points / IP', num(pts / (innings || 1), 2), `${ip(outs)} IP`),
    tile('Points / game', num(pts / (g || 1), 2), `${num(g)} G`),
    !isCareer && row[P.PLUS] ? tile('PTS+', num(row[P.PLUS], 0), 'vs. league avg (100)') : null,
    tile('W–L · SV', `${num(isCareer ? c[CP.W] : row[P.W])}–${num(isCareer ? c[CP.L] : row[P.L])} · ${num(isCareer ? c[CP.SV] : row[P.SV])}`),
    tile('K · ERA', `${num(isCareer ? c[CP.SO] : row[P.SO])} · ${num(isCareer ? c[CP.ERA] : row[P.ERA], 2)}`),
  ));

  if (usingCustomScoring()) return;

  const rails = el('div', { class: 'rails' });
  rails.append(el('div', { class: 'rail-legend' },
    el('span', {}, 'Worse'), el('span', {}, 'Percentile rank'), el('span', {}, 'Better')));
  rails.append(rail('Points', pts, pctile(grp, 'pts', pts), num(pts, 0)));
  rails.append(rail('Points/IP', pts / (innings || 1), pctile(grp, 'ptsip', pts / (innings || 1)), num(pts / (innings || 1), 2)));
  rails.append(rail('Points/G', pts / (g || 1), pctile(grp, 'ptsg', pts / (g || 1)), num(pts / (g || 1), 2)));
  if (!isCareer) {
    rails.append(rail('PTS+ (era adj.)', row[P.PLUS], pctile(grp, 'ptsplus', row[P.PLUS]), num(row[P.PLUS], 0)));
    rails.append(rail('Strikeouts', row[P.SO], pctile(grp, 'SO', row[P.SO]), num(row[P.SO])));
    rails.append(rail('Wins', row[P.W], pctile(grp, 'W', row[P.W]), num(row[P.W])));
    rails.append(rail('Saves', row[P.SV], pctile(grp, 'SV', row[P.SV]), num(row[P.SV])));
    rails.append(rail('Innings', innings, pctile(grp, 'IP', innings), ip(outs)));
  }
  const qual = isCareer ? `${num(state.meta.qualifiers.career_ip)}+ career IP`
                        : `${num(state.meta.qualifiers.season_ip)}+ IP in a season`;
  rails.append(el('div', { class: 'rails-note' },
    `Percentiles vs. every qualified pitcher in history (${qual}).`));
  card.append(rails);
}

function battingLog(bat, p) {
  const rows = bat.map((r) => ({
    year: r[B.YEAR], team: r[B.TEAM], lg: r[B.LG], pos: r[B.POS], G: r[B.G],
    PA: r[B.PA], AB: r[B.AB], R: r[B.R], H: r[B.H], D2: r[B.D2], D3: r[B.D3],
    HR: r[B.HR], RBI: r[B.RBI], SB: r[B.SB], BB: r[B.BB], IBB: r[B.IBB],
    HBP: r[B.HBP], SO: r[B.SO], pts: r[B.PTS], plus: r[B.PLUS],
    ptsg: r[B.PTS] / (r[B.G] || 1),
  }));
  const c = p.cb;
  rows.push({ __total: true, year: 'Career', team: '', lg: '', pos: '', G: c[CB.G],
    PA: c[CB.PA], AB: c[CB.AB], R: c[CB.R], H: c[CB.H], D2: c[CB.D2], D3: c[CB.D3],
    HR: c[CB.HR], RBI: c[CB.RBI], SB: c[CB.SB], BB: c[CB.BB], IBB: c[CB.IBB],
    HBP: c[CB.HBP], SO: c[CB.SO], pts: c[CB.PTS], plus: null,
    ptsg: c[CB.PTS] / (c[CB.G] || 1) });

  const maxPts = Math.max(...bat.map((r) => r[B.PTS]), 1);
  const recordedFrom = fullyRecordedFrom();
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Batting — season by season'),
      el('span', { class: 'hint' }, 'Click any column header to sort')),
    statTable(rows, [
      { key: 'year', label: 'Year', cls: 'txt', get: (r) => {
        if (r.__total || r.year >= recordedFrom) return String(r.year);
        // † marks a season played before every scoring category was tracked.
        return el('span', {}, String(r.year),
          el('span', { class: 'partial-mark',
                       title: 'Some scoring categories were not recorded this season' }, '†'));
      } },
      { key: 'team', label: 'Tm', cls: 'txt', get: (r) => r.team ? el('span', { title: teamName(r.team) }, r.team) : '' },
      { key: 'lg', label: 'Lg', cls: 'txt' },
      { key: 'pos', label: 'Pos', cls: 'txt' },
      { key: 'G', label: 'G' }, { key: 'PA', label: 'PA' }, { key: 'AB', label: 'AB' },
      { key: 'R', label: 'R' }, { key: 'H', label: 'H' },
      { key: 'D2', label: '2B' }, { key: 'D3', label: '3B' }, { key: 'HR', label: 'HR' },
      { key: 'RBI', label: 'RBI' }, { key: 'SB', label: 'SB' }, { key: 'BB', label: 'BB' },
      { key: 'IBB', label: 'IBB' }, { key: 'HBP', label: 'HBP' }, { key: 'SO', label: 'SO' },
      { key: 'plus', label: 'PTS+', title: 'Points per PA vs. league average that season (100 = average)',
        get: (r) => r.plus ? num(r.plus, 0) : '—' },
      { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
      { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0),
        heat: (v) => Math.max(0, v / maxPts) },
    ], { sortKey: null }));
}

function pitchingLog(pit, p) {
  const rows = pit.map((r) => ({
    year: r[P.YEAR], team: r[P.TEAM], lg: r[P.LG], W: r[P.W], L: r[P.L], G: r[P.G],
    GS: r[P.GS], CG: r[P.CG], SHO: r[P.SHO], SV: r[P.SV], outs: r[P.IPOUTS],
    ER: r[P.ER], BB: r[P.BB], SO: r[P.SO], ERA: r[P.ERA], pts: r[P.PTS],
    plus: r[P.PLUS], ptsip: r[P.PTS] / ((r[P.IPOUTS] / 3) || 1),
  }));
  const c = p.cp;
  rows.push({ __total: true, year: 'Career', team: '', lg: '', W: c[CP.W], L: c[CP.L],
    G: c[CP.G], GS: c[CP.GS], CG: c[CP.CG], SHO: c[CP.SHO], SV: c[CP.SV],
    outs: c[CP.IPOUTS], ER: c[CP.ER], BB: c[CP.BB], SO: c[CP.SO], ERA: c[CP.ERA],
    pts: c[CP.PTS], plus: null, ptsip: c[CP.PTS] / ((c[CP.IPOUTS] / 3) || 1) });

  const maxPts = Math.max(...pit.map((r) => r[P.PTS]), 1);
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Pitching — season by season'),
      el('span', { class: 'hint' }, 'Click any column header to sort')),
    statTable(rows, [
      { key: 'year', label: 'Year', cls: 'txt' },
      { key: 'team', label: 'Tm', cls: 'txt', get: (r) => r.team ? el('span', { title: teamName(r.team) }, r.team) : '' },
      { key: 'lg', label: 'Lg', cls: 'txt' },
      { key: 'W', label: 'W' }, { key: 'L', label: 'L' }, { key: 'G', label: 'G' },
      { key: 'GS', label: 'GS' }, { key: 'CG', label: 'CG' }, { key: 'SHO', label: 'SHO' },
      { key: 'SV', label: 'SV' },
      { key: 'outs', label: 'IP', get: (r) => ip(r.outs) },
      { key: 'ER', label: 'ER' }, { key: 'BB', label: 'BB' }, { key: 'SO', label: 'K' },
      { key: 'ERA', label: 'ERA', get: (r) => num(r.ERA, 2) },
      { key: 'plus', label: 'PTS+', title: 'Points per IP vs. league average that season (100 = average)',
        get: (r) => r.plus ? num(r.plus, 0) : '—' },
      { key: 'ptsip', label: 'PTS/IP', get: (r) => num(r.ptsip, 2) },
      { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 1),
        heat: (v) => Math.max(0, v / maxPts) },
    ], { sortKey: null }));
}

function randomSuggestions() {
  const { ids, names, bp, pp, y0, y1 } = state.index;
  const picks = [];
  const seen = new Set();
  while (picks.length < 8 && seen.size < 400) {
    const i = Math.floor(Math.random() * ids.length);
    if (seen.has(i)) continue;
    seen.add(i);
    if (bp[i] + pp[i] < 4000) continue;
    picks.push({ id: ids[i], name: names[i], pts: bp[i] + pp[i], y0: y0[i], y1: y1[i] });
  }
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Or jump into someone')),
    el('div', { class: 'compare-grid' },
      picks.map((p) => el('a', { class: 'cmp-card', href: playerHref(p.id) },
        el('h3', {}, p.name),
        el('div', { class: 'yrs' }, `${p.y0}–${p.y1}`),
        el('div', { class: 'cmp-row best' }, el('span', {}, 'Career points'), el('span', {}, num(p.pts, 0)))))));
}

// -------------------------------------------------------- leaderboard views

function eraSelect(onChange, current) {
  const maxYear = state.meta.seasons[1];
  return el('select', { onchange: (e) => onChange(ERAS[e.target.value]) },
    ERAS.map((e, i) => el('option', { value: i, selected: current === i },
      eraLabel(e, maxYear))));
}

async function viewLeaders(kind) {
  const isCareer = kind === 'career';
  const head = el('div', { class: 'view-head' },
    el('h1', {}, isCareer ? 'Career Leaders' : 'Single-Season Leaders'),
    el('p', {}, isCareer
      ? 'Every player in MLB history, ranked by the fantasy points they would have banked under our league’s scoring. Sort by any column.'
      : 'The best individual seasons ever recorded, in our scoring. Note the 1880s pitchers at the top — that is what a 670-inning workload does to a points league. Sort by PTS+ to compare across eras fairly.'));

  const filters = el('div', { class: 'filters' });
  const body = el('div', {});
  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Leaderboard'),
      el('span', { class: 'hint' }, 'Click a name for the full player page')),
    filters, body, watermark());
  app().replaceChildren();
  mount(app(), head, panel, adSlot('leaderboard'));

  const opts = {
    group: 'batting',
    era: 0,
    minG: 0,
    pos: '',
    q: '',
    sortKey: 'pts',
  };

  const draw = async () => {
    const board = `lb_${isCareer ? 'career' : 'season'}_${opts.group}`;
    const rows = await getBoard(board);
    const [, lo, hi] = ERAS[opts.era];
    const q = norm(opts.q);

    const filtered = rows.filter((r) => {
      const y0 = isCareer ? r.year0 : r.year;
      const y1 = isCareer ? r.year1 : r.year;
      if (y1 < lo || y0 > hi) return false;
      if (opts.minG && r.G < opts.minG) return false;
      if (opts.pos && (r.pos || indexField(r.id, 'pos')) !== opts.pos) return false;
      if (q && !norm(r.name).includes(q)) return false;
      return true;
    });

    const shown = limitRows(filtered, FREE.boardRows);
    const capped = shown.length < filtered.length;
    body.replaceChildren(
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--line)' },
        el('h2', {}, `${num(filtered.length)} ${isCareer ? 'players' : 'seasons'}`),
        el('span', { class: 'hint' },
          (opts.group === 'batting' ? 'Batting' : 'Pitching') +
          (capped ? ` · showing the top ${num(shown.length)}` : '')),
        el('div', { style: 'margin-top:8px' },
          exportButton(filtered, boardExportCols(opts.group, isCareer),
            `${state.sport}-${isCareer ? 'career' : 'season'}-${opts.group}.csv`))),
      buildBoardTable(shown, opts.group, isCareer),
      capped ? upgradeBar(
        `${num(filtered.length - shown.length)} more rows on Pro`,
        'The free plan shows the top ' + num(FREE.boardRows) + '.') : null);
  };

  // --- filter controls ----------------------------------------------------
  const seg = el('div', { class: 'seg' },
    el('button', { class: 'on', onclick: (e) => setGroup('batting', e.target) }, 'Batting'),
    el('button', { onclick: (e) => setGroup('pitching', e.target) }, 'Pitching'));
  function setGroup(g, btn) {
    opts.group = g; opts.pos = '';
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    posField.style.display = g === 'batting' ? '' : 'none';
    draw();
  }

  const posField = el('div', { class: 'field' },
    el('label', {}, 'Position'),
    el('select', { onchange: (e) => { opts.pos = e.target.value; draw(); } },
      el('option', { value: '' }, 'Any'),
      ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'].map((p) => el('option', { value: p }, p))));

  filters.append(
    el('div', { class: 'field' }, el('label', {}, 'Group'), seg),
    el('div', { class: 'field' }, el('label', {}, 'Era'),
      eraSelect((e) => { opts.era = ERAS.indexOf(e); draw(); }, 0)),
    posField,
    el('div', { class: 'field' }, el('label', {}, 'Min games'),
      el('input', { type: 'number', value: 0, min: 0, step: 10,
                    oninput: (e) => { opts.minG = Number(e.target.value) || 0; draw(); } })),
    el('div', { class: 'field' }, el('label', {}, 'Filter by name'),
      el('input', { type: 'text', placeholder: 'e.g. Griffey',
                    oninput: (e) => { opts.q = e.target.value; draw(); } })));

  draw();
}

/** Flat column set for CSV export -- names resolved, no DOM getters. */
function boardExportCols(group, isCareer) {
  const base = [{ key: 'name', label: 'Player', raw: (r) => r.name }];
  const keys = group === 'batting'
    ? (isCareer ? ['year0', 'year1', 'seasons', 'G', 'PA', 'HR', 'R', 'RBI', 'SB', 'BB', 'ptsg', 'ptspa', 'pts']
                : ['year', 'team', 'lg', 'pos', 'G', 'PA', 'HR', 'R', 'RBI', 'SB', 'BB', 'ptsg', 'ptsplus', 'pts'])
    : (isCareer ? ['year0', 'year1', 'seasons', 'G', 'GS', 'W', 'L', 'SV', 'IP', 'SO', 'ERA', 'ptsip', 'pts']
                : ['year', 'team', 'lg', 'G', 'GS', 'W', 'L', 'SV', 'IP', 'SO', 'ERA', 'ptsplus', 'pts']);
  return base.concat(keys.map((k) => ({ key: k, label: k })));
}

function playerLink(row) {
  const hof = indexField(row.id, 'hof');
  const a = el('a', { class: 'plink', href: playerHref(row.id) }, row.name);
  if (hof) a.append(el('span', { class: 'hof-star' }, '★'));
  return a;
}

function buildBoardTable(rows, group, isCareer) {
  const hidePlus = usingCustomScoring();
  const maxPts = Math.max(...rows.map((r) => r.pts), 1);
  const heat = (v) => Math.max(0, v / maxPts);
  const nameCol = { key: 'name', label: 'Player', cls: 'txt', get: playerLink };
  const teamCol = { key: 'team', label: 'Tm', cls: 'txt',
                    get: (r) => el('span', { title: teamName(r.team) }, r.team) };
  const ptsCol = { key: 'pts', label: 'Points', cls: 'pts-cell',
                   get: (r) => num(r.pts, 0), heat };

  let cols;
  if (group === 'batting' && isCareer) {
    cols = [nameCol,
      { key: 'year0', label: 'From' }, { key: 'year1', label: 'To' },
      { key: 'seasons', label: 'Yrs' }, { key: 'G', label: 'G' }, { key: 'PA', label: 'PA' },
      { key: 'HR', label: 'HR' }, { key: 'R', label: 'R' }, { key: 'RBI', label: 'RBI' },
      { key: 'SB', label: 'SB' }, { key: 'BB', label: 'BB' },
      { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
      { key: 'ptspa', label: 'PTS/PA', get: (r) => num(r.ptspa, 3) },
      ptsCol];
  } else if (group === 'batting') {
    cols = [nameCol,
      { key: 'year', label: 'Year' }, teamCol, { key: 'lg', label: 'Lg', cls: 'txt' },
      { key: 'pos', label: 'Pos', cls: 'txt' }, { key: 'G', label: 'G' }, { key: 'PA', label: 'PA' },
      { key: 'HR', label: 'HR' }, { key: 'R', label: 'R' }, { key: 'RBI', label: 'RBI' },
      { key: 'SB', label: 'SB' }, { key: 'BB', label: 'BB' },
      { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
      hidePlus ? null : { key: 'ptsplus', label: 'PTS+',
        title: 'Era-adjusted: points per PA vs. league average (100)',
        get: (r) => r.ptsplus ? num(r.ptsplus, 0) : '—' },
      ptsCol].filter(Boolean);
  } else if (isCareer) {
    cols = [nameCol,
      { key: 'year0', label: 'From' }, { key: 'year1', label: 'To' },
      { key: 'seasons', label: 'Yrs' }, { key: 'G', label: 'G' }, { key: 'GS', label: 'GS' },
      { key: 'W', label: 'W' }, { key: 'L', label: 'L' }, { key: 'SV', label: 'SV' },
      { key: 'IP', label: 'IP', get: (r) => num(r.IP, 1) }, { key: 'SO', label: 'K' },
      { key: 'ERA', label: 'ERA', get: (r) => num(r.ERA, 2), ascDefault: true },
      { key: 'ptsip', label: 'PTS/IP', get: (r) => num(r.ptsip, 2) },
      ptsCol];
  } else {
    cols = [nameCol,
      { key: 'year', label: 'Year' }, teamCol, { key: 'lg', label: 'Lg', cls: 'txt' },
      { key: 'G', label: 'G' }, { key: 'GS', label: 'GS' }, { key: 'W', label: 'W' },
      { key: 'L', label: 'L' }, { key: 'SV', label: 'SV' },
      { key: 'IP', label: 'IP', get: (r) => num(r.IP, 1) }, { key: 'SO', label: 'K' },
      { key: 'ERA', label: 'ERA', get: (r) => num(r.ERA, 2), ascDefault: true },
      hidePlus ? null : { key: 'ptsplus', label: 'PTS+',
        title: 'Era-adjusted: points per IP vs. league average (100)',
        get: (r) => r.ptsplus ? num(r.ptsplus, 0) : '—' },
      ptsCol].filter(Boolean);
  }
  return statTable(rows, cols, { rank: true, sortKey: 'pts', limit: 200, page: 200 });
}

// ------------------------------------------------------------- year explorer

async function viewYear(year) {
  const [ymin, ymax] = state.meta.seasons;
  year = Number(year) || ymax;

  const head = el('div', { class: 'view-head' },
    el('h1', {}, 'Year Explorer'),
    el('p', {}, 'Pick any season back to 1871 and see who actually won your league that year.'));

  const picker = el('select', { onchange: (e) => go(`#/year/${e.target.value}`) },
    Array.from({ length: ymax - ymin + 1 }, (_, i) => ymax - i)
      .map((y) => el('option', { value: y, selected: y === year }, y)));

  const wrap = el('div', {});
  app().replaceChildren(head,
    el('div', { class: 'panel' },
      el('div', { class: 'filters' },
        el('div', { class: 'field' }, el('label', {}, 'Season'), picker)),
      wrap, watermark()));

  const [bat, pit] = await Promise.all([
    getBoard('lb_season_batting'), getBoard('lb_season_pitching'),
  ]);
  const bRows = bat.filter((r) => r.year === year).sort((a, b) => b.pts - a.pts);
  const pRows = pit.filter((r) => r.year === year).sort((a, b) => b.pts - a.pts);

  const section = (title, rows, group) => {
    const shown = limitRows(rows, FREE.yearRows);
    return el('div', {},
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--line)' },
        el('h2', {}, title),
        el('span', { class: 'hint' },
          rows.length ? `Top ${Math.min(shown.length, 40)} shown` : 'No data')),
      rows.length ? buildBoardTable(shown, group, false)
                  : el('div', { class: 'empty-state' }, 'No qualifying players for this season.'),
      shown.length < rows.length
        ? upgradeBar(`${num(rows.length - shown.length)} more from ${year} on Pro`, null)
        : null);
  };

  wrap.replaceChildren(
    section(`${year} — batting leaders`, bRows, 'batting'),
    section(`${year} — pitching leaders`, pRows, 'pitching'),
    el('div', { class: 'note', html:
      'The Year Explorer draws on a precomputed pool: the top 40 of every season plus ' +
      'the all-time top 7,000, so the leaders for any given year are complete but the ' +
      'deep tail of that season is not.' }));
}

// ------------------------------------------------------------- compare view

async function viewCompare(idsParam) {
  const ids = (idsParam || '').split(',').filter(Boolean).map(resolveId).filter(Boolean);
  state.compare = ids;

  const head = el('div', { class: 'view-head' },
    el('h1', {}, 'Compare Players'),
    el('p', {}, 'Put careers side by side in league points. Search for a player and use “+ Add to compare”, or add one below.'));

  const adder = el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', {}, 'Add player'),
      el('input', {
        type: 'text', placeholder: 'Type a name and press Enter',
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          const hit = searchPlayers(e.target.value, 1)[0];
          if (hit && !ids.includes(hit.id)) go(`#/compare/${[...ids, hit.id].map(pidOf).join(',')}`);
          e.target.value = '';
        },
      })),
    ids.length ? el('button', { class: 'btn', onclick: () => go('#/compare') }, 'Clear all') : null);

  const grid = el('div', { class: 'compare-grid' });
  app().replaceChildren(head, el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Head to head')), adder, grid));

  if (!ids.length) {
    grid.append(el('div', { class: 'cmp-empty' }, 'Add two or more players to compare their careers.'));
    return;
  }

  const allowed = isPro() ? ids : ids.slice(0, FREE.comparePlayers);
  const players = (await Promise.all(allowed.map((id) => getShard(id)))).filter(Boolean);
  if (allowed.length < ids.length) {
    grid.after(upgradeBar(
      `Comparing ${ids.length} players needs Pro`,
      `The free plan compares ${FREE.comparePlayers} at a time.`));
  }
  const metrics = [
    ['Career points', (p) => (p.cb?.[CB.PTS] || 0) + (p.cp?.[CP.PTS] || 0), 0],
    ['Batting points', (p) => p.cb?.[CB.PTS] || 0, 0],
    ['Pitching points', (p) => p.cp?.[CP.PTS] || 0, 0],
    ['Best season', (p) => bestSeason(p).pts, 0],
    ['Points / season', (p) => {
      const yrs = new Set([...(p.bat || []).map((r) => r[B.YEAR]), ...(p.pit || []).map((r) => r[P.YEAR])]);
      return ((p.cb?.[CB.PTS] || 0) + (p.cp?.[CP.PTS] || 0)) / (yrs.size || 1);
    }, 1],
    ['Points / game', (p) => {
      const g = (p.cb?.[CB.G] || 0) + (p.cp?.[CP.G] || 0);
      return ((p.cb?.[CB.PTS] || 0) + (p.cp?.[CP.PTS] || 0)) / (g || 1);
    }, 2],
    ['Games', (p) => (p.cb?.[CB.G] || 0) + (p.cp?.[CP.G] || 0), 0],
    ['HR', (p) => p.cb?.[CB.HR] || 0, 0],
    ['SB', (p) => p.cb?.[CB.SB] || 0, 0],
    ['Strikeouts (P)', (p) => p.cp?.[CP.SO] || 0, 0],
  ];

  const best = metrics.map(([, fn]) => Math.max(...players.map((p) => fn(p))));

  players.forEach((p, i) => {
    const card = el('div', { class: 'cmp-card' },
      el('h3', {}, el('a', { href: playerHref(p.i), class: 'plink' }, p.n)),
      el('div', { class: 'yrs' }, `${bestSeason(p).span} · ${p.pos || ''}${p.hof ? ' · ★ HOF' : ''}`));
    metrics.forEach(([label, fn, dp], m) => {
      const v = fn(p);
      if (!v && (label.includes('(P)') || label === 'Pitching points' || label === 'Batting points')) return;
      card.append(el('div', { class: `cmp-row${v === best[m] && v > 0 ? ' best' : ''}` },
        el('span', {}, label), el('span', {}, num(v, dp))));
    });
    card.append(el('div', { style: 'margin-top:12px' },
      el('button', {
        class: 'btn',
        onclick: () => go(`#/compare/${ids.filter((x) => x !== p.i).map(pidOf).join(',')}`),
      }, 'Remove')));
    grid.append(card);
  });
}

function bestSeason(p) {
  let best = { pts: 0, year: null };
  const years = new Set();
  for (const r of p.bat || []) { years.add(r[B.YEAR]); if (r[B.PTS] > best.pts) best = { pts: r[B.PTS], year: r[B.YEAR] }; }
  for (const r of p.pit || []) { years.add(r[P.YEAR]); if (r[P.PTS] > best.pts) best = { pts: r[P.PTS], year: r[P.YEAR] }; }
  const sorted = [...years].sort();
  best.span = sorted.length ? `${sorted[0]}–${sorted[sorted.length - 1]}` : '';
  return best;
}

// ------------------------------------------------------------- scoring view

function viewScoring() {
  const m = state.meta;
  const ruleList = (scoring, unsupported, labels = {}) => el('div', { class: 'rule-list' },
    Object.entries(scoring).map(([k, v]) => {
      const off = unsupported.includes(k);
      return el('div', { class: `rule${off ? ' off' : ''}` },
        el('span', {}, labels[k] || k, off ? el('span', { class: 'badge ghost', style: 'margin-left:8px' }, 'no data') : null),
        el('span', { class: `w${v < 0 ? ' neg' : ''}` }, v > 0 ? `+${v}` : v));
    }));

  const labels = {
    '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', R: 'Run',
    RBI: 'RBI', SB: 'Stolen base', BB: 'Walk', IBB: 'Intentional walk',
    HBP: 'Hit by pitch', CYCLE: 'Cycle', GRAND_SLAM: 'Grand slam',
    IP: 'Inning pitched', W: 'Win', L: 'Loss', CG: 'Complete game',
    SHO: 'Shutout', SV: 'Save', ER: 'Earned run', K: 'Strikeout', HLD: 'Hold',
    NO_HITTER: 'No-hitter', PERFECT_GAME: 'Perfect game', QS: 'Quality start',
    BS: 'Blown save',
  };

  if (state.sport !== 'mlb') return viewScoringPlaceholder();

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, `${sport().league} League Scoring`),
      el('p', {}, `${m.league.size}-team ${m.league.type}, all-baseball keeper league. ` +
        'Every number on this site is computed with exactly these weights — they are read ' +
        'straight out of fantasy_baseball/config.py at build time, so the site and the CLI can never drift apart.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Scoring categories')),
      el('div', { class: 'rules' },
        el('div', {}, el('div', { class: 'tile-label', style: 'margin-bottom:8px' }, 'Batting'),
          ruleList(m.batting_scoring, m.unsupported_batting, labels)),
        el('div', {}, el('div', { class: 'tile-label', style: 'margin-bottom:8px' }, 'Pitching'),
          ruleList(m.pitching_scoring, m.unsupported_pitching, labels)))),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Roster')),
      el('div', { class: 'roster-slots', style: 'padding-top:18px' },
        m.league.roster.map((s) => el('span', { class: 'slot' }, s)))),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'What the data does and does not cover')),
      el('div', { class: 'note', html:
        `<b>Coverage.</b> ${num(m.players)} players, ${num(m.batting_seasons)} batting seasons and ` +
        `${num(m.pitching_seasons)} pitching seasons, ${m.seasons[0]}–${m.seasons[1]}. ` +
        `Source: ${m.source}, built ${m.built}.` }),
      el('div', { class: 'note', html:
        '<b>Categories with no historical data.</b> Holds, Blown Saves and Quality Starts are ' +
        'not carried by the historical databank at all, and Cycles / Grand Slams / No-hitters / ' +
        'Perfect Games need play-by-play data rather than season totals. All seven score 0 here ' +
        'and are greyed out above. In practice that understates modern relievers (holds) and ' +
        'innings-eating starters (QS) by a modest amount; it does not affect batting at all ' +
        'beyond the two rare-event bonuses.' }),
      el('div', { class: 'note', html:
        '<b>Walks are counted twice, on purpose.</b> An intentional walk scores 1 for the walk ' +
        'plus 1 for the IBB, matching how Yahoo applies these two categories. It is why ' +
        'Barry Bonds’ 2004 (232 BB, 120 IBB) is the highest-scoring batting season ever recorded here.' }),
      el('div', { class: 'note', html:
        '<b>PTS+ is the honest cross-era number.</b> Raw point totals reward era as much as talent — ' +
        'Old Hoss Radbourn threw 678 innings in 1884, so he tops the single-season pitching board ' +
        'forever. PTS+ divides a player’s points per opportunity (PA for hitters, IP for pitchers) by ' +
        'that season’s qualified-league average and indexes it to 100, so 150 means 50% better than ' +
        'his contemporaries. Sort any season board by PTS+ to see it.' }),
      el('div', { class: 'note', html:
        `<b>Qualifiers.</b> Percentile rails and rate leaderboards use ${m.qualifiers.season_pa}+ PA ` +
        `or ${m.qualifiers.season_ip}+ IP for a season, ${num(m.qualifiers.career_pa)}+ PA or ` +
        `${m.qualifiers.career_ip}+ IP for a career.` })));
}

// --------------------------------------------------------- current season
//
// The historical databank ends at its last complete season, so anything more
// recent is fetched live, in the visitor's own browser, from the MLB Stats API
// (statsapi.mlb.com) -- the same public, documented, no-auth JSON service that
// powers MLB's own site.
//
// Not Baseball Reference: it has no public API and its terms forbid scraping.
// Not a paid feed: this needs to stay a static site with no server and no key.
//
// Everything here is best-effort. The fetch can fail -- offline, an API change,
// a blocked network -- and when it does the site carries on with its historical
// data and says plainly that live figures are unavailable. Live data is never
// on the critical path of a page render.

const LIVE = {
  base: 'https://statsapi.mlb.com/api/v1',
  timeoutMs: 9000,
  /* How far back a career can end and still be matched to a live player. Stops
   * a 2026 "Will Smith" from being stapled onto the 1890s one. */
  activeWithin: 3,
};

/** MLB reports innings as "182.1" meaning 182 innings and one out. */
function parseInnings(value) {
  if (value === null || value === undefined) return 0;
  const [whole, outs] = String(value).split('.');
  return (Number(whole) || 0) + (Number(outs) || 0) / 3;
}

function scoreLiveBatting(s, weights) {
  const singles = (s.hits || 0) - (s.doubles || 0) - (s.triples || 0) - (s.homeRuns || 0);
  const parts = {
    R: s.runs, '1B': singles, '2B': s.doubles, '3B': s.triples, HR: s.homeRuns,
    RBI: s.rbi, SB: s.stolenBases, BB: s.baseOnBalls, IBB: s.intentionalWalks,
    HBP: s.hitByPitch,
  };
  let points = 0;
  for (const [cat, weight] of Object.entries(weights)) {
    if (parts[cat] !== undefined && parts[cat] !== null) points += weight * Number(parts[cat]);
  }
  return points;
}

function scoreLivePitching(s, weights) {
  // The live feed carries Holds and Blown Saves, which the historical databank
  // does not -- so a current-season reliever scores more completely here than
  // his 1990s counterpart does.
  const parts = {
    IP: parseInnings(s.inningsPitched), W: s.wins, L: s.losses, CG: s.completeGames,
    SHO: s.shutouts, SV: s.saves, ER: s.earnedRuns, K: s.strikeOuts,
    HLD: s.holds, BS: s.blownSaves, QS: s.qualityStarts,
  };
  let points = 0;
  const scored = [];
  for (const [cat, weight] of Object.entries(weights)) {
    if (parts[cat] !== undefined && parts[cat] !== null) {
      points += weight * Number(parts[cat]);
      scored.push(cat);
    }
  }
  return { points, scored };
}

async function fetchLiveGroup(group, season) {
  const url = `${LIVE.base}/stats?stats=season&group=${group}&season=${season}` +
              '&sportId=1&limit=2000&playerPool=ALL&gameType=R';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`MLB Stats API returned ${res.status}`);
    const json = await res.json();
    const splits = [];
    for (const block of json.stats || []) for (const split of block.splits || []) splits.push(split);
    return splits;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch once per session; every caller after the first awaits the same promise. */
let livePromise = null;

function ensureLive() {
  if (!SITE.live.enabled || EMBEDDED) {
    return Promise.resolve({ status: 'off' });
  }
  if (livePromise) return livePromise;

  livePromise = (async () => {
    const wanted = SITE.live.season || new Date().getFullYear();
    // Early in a calendar year the new season has no rows yet; fall back one.
    for (const season of [wanted, wanted - 1]) {
      let hitting, pitching;
      try {
        [hitting, pitching] = await Promise.all([
          fetchLiveGroup('hitting', season),
          fetchLiveGroup('pitching', season),
        ]);
      } catch (err) {
        return { status: 'error', error: err.message || String(err) };
      }
      if (!hitting.length && !pitching.length) continue;

      const bw = state.meta.batting_scoring, pw = state.meta.pitching_scoring;
      const byName = new Map();
      const bat = [], pit = [];
      let pitchingCats = [];

      for (const split of hitting) {
        const s = split.stat || {}, person = split.player || {};
        const row = {
          id: person.id, name: person.fullName || '', team: (split.team || {}).abbreviation || '',
          G: s.gamesPlayed || 0, PA: s.plateAppearances || 0, HR: s.homeRuns || 0,
          R: s.runs || 0, RBI: s.rbi || 0, SB: s.stolenBases || 0, BB: s.baseOnBalls || 0,
          pts: scoreLiveBatting(s, bw),
        };
        row.ptsg = row.G ? row.pts / row.G : 0;
        bat.push(row);
        const key = norm(row.name);
        if (!byName.has(key)) byName.set(key, {});
        // A traded player appears once per club; keep the fuller line.
        const slot = byName.get(key);
        if (!slot.bat || row.PA > slot.bat.PA) slot.bat = row;
      }

      for (const split of pitching) {
        const s = split.stat || {}, person = split.player || {};
        const { points, scored } = scoreLivePitching(s, pw);
        if (scored.length > pitchingCats.length) pitchingCats = scored;
        const row = {
          id: person.id, name: person.fullName || '', team: (split.team || {}).abbreviation || '',
          G: s.gamesPlayed || 0, GS: s.gamesStarted || 0, W: s.wins || 0, L: s.losses || 0,
          SV: s.saves || 0, HLD: s.holds || 0, IP: parseInnings(s.inningsPitched),
          SO: s.strikeOuts || 0, ERA: Number(s.era) || 0, pts: points,
        };
        row.ptsg = row.G ? row.pts / row.G : 0;
        pit.push(row);
        const key = norm(row.name);
        if (!byName.has(key)) byName.set(key, {});
        const slot = byName.get(key);
        if (!slot.pit || row.IP > slot.pit.IP) slot.pit = row;
      }

      bat.sort((a, b) => b.pts - a.pts);
      pit.sort((a, b) => b.pts - a.pts);
      return { status: 'ready', season, bat, pit, byName, pitchingCats,
               fetchedAt: new Date() };
    }
    return { status: 'empty', season: wanted };
  })();

  return livePromise;
}

/** Live block for a player page. Returns null when there is nothing to add. */
function liveBlockFor(record, live) {
  if (!live || live.status !== 'ready') return null;
  const hit = live.byName.get(norm(record.n));
  if (!hit || (!hit.bat && !hit.pit)) return null;

  const tiles = [];
  if (hit.bat && hit.bat.PA > 0) {
    tiles.push(
      tile('Batting points', num(hit.bat.pts, 0), `${num(hit.bat.G)} G · ${num(hit.bat.PA)} PA`, true),
      tile('Points / game', num(hit.bat.ptsg, 2), hit.bat.team || null),
      tile('HR · R · RBI', `${num(hit.bat.HR)}·${num(hit.bat.R)}·${num(hit.bat.RBI)}`),
      tile('SB · BB', `${num(hit.bat.SB)} · ${num(hit.bat.BB)}`));
  }
  if (hit.pit && hit.pit.IP > 0) {
    tiles.push(
      tile('Pitching points', num(hit.pit.pts, 0),
        `${num(hit.pit.G)} G · ${ipFrom(hit.pit.IP)} IP`, !tiles.length),
      tile('Points / IP', num(hit.pit.IP ? hit.pit.pts / hit.pit.IP : 0, 2), hit.pit.team || null),
      tile('W–L · SV · HLD', `${num(hit.pit.W)}–${num(hit.pit.L)} · ${num(hit.pit.SV)} · ${num(hit.pit.HLD)}`),
      tile('K · ERA', `${num(hit.pit.SO)} · ${num(hit.pit.ERA, 2)}`));
  }
  if (!tiles.length) return null;

  return el('div', { class: 'panel live-panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, el('span', { class: 'live-dot' }), `${live.season} season — live`),
      el('span', { class: 'hint' },
        `Fetched from the MLB Stats API at ${live.fetchedAt.toLocaleTimeString()}`)),
    el('div', { class: 'tiles' }, tiles),
    watermark());
}

function liveStatusNote(live, lastPlayed) {
  if (!live) return null;
  if (live.status === 'off') return null;
  if (live.status === 'error') {
    return el('div', { class: 'note', html:
      `<b>Live stats unavailable.</b> Current-season figures come from the MLB ` +
      `Stats API in your browser, and that request did not succeed (${live.error}). ` +
      'Everything else on this page is historical data and is unaffected.' });
  }
  if (live.status === 'empty') {
    return el('div', { class: 'note', html:
      `<b>No ${live.season} data yet.</b> The season has not produced statistics ` +
      'to score. Historical figures below are unaffected.' });
  }
  if (live.status === 'ready' && lastPlayed) {
    return null;
  }
  return null;
}

async function viewLive() {
  const head = el('div', { class: 'view-head' },
    el('h1', {}, 'This Season'),
    el('p', {}, 'Current-season totals, scored in our league’s points and refreshed ' +
      'from the MLB Stats API every time you load this page.'));

  const body = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Loading current season…'),
      el('span', { class: 'hint' }, 'Fetching from statsapi.mlb.com')),
    el('div', { class: 'empty-state' }, el('div', { class: 'boot-spinner' })));
  app().replaceChildren(head, body);

  if (!isPro() && !FREE.liveStats) {
    return app().replaceChildren(head, el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Current season — Pro')),
      el('div', { class: 'empty-state' },
        el('h3', {}, 'Live stats are a Pro feature'),
        el('div', {}, 'Current-season totals are fetched fresh from the MLB Stats ' +
          'API every time the page loads. Everything historical stays free.')),
      upgradeBar('Unlock this season', 'Plus full leaderboards, exports and every league.'),
      watermark()));
  }

  const live = await ensureLive();

  if (live.status !== 'ready') {
    const why = live.status === 'off'
      ? 'Live stats are switched off in this build. The offline preview has no network access; the deployed site fetches them.'
      : live.status === 'empty'
        ? `The ${live.season} season has not produced statistics yet.`
        : `The request to the MLB Stats API did not succeed (${live.error}). This can happen ` +
          'offline, behind a restrictive network, or if the API changes shape.';
    return app().replaceChildren(head, el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Current season unavailable')),
      el('div', { class: 'empty-state' },
        el('h3', {}, 'No live data right now'),
        el('div', {}, why)),
      el('div', { class: 'note', html:
        'The rest of the site is built from a local historical dataset and works ' +
        'regardless — try <a href="#/career">Career Leaders</a>.' })));
  }

  const opts = { group: 'batting' };
  const table = el('div', {});

  const draw = () => {
    const batting = opts.group === 'batting';
    const rows = batting ? live.bat : live.pit;
    const cols = batting
      ? [{ key: 'name', label: 'Player', cls: 'txt' },
         { key: 'team', label: 'Tm', cls: 'txt' },
         { key: 'G', label: 'G' }, { key: 'PA', label: 'PA' }, { key: 'HR', label: 'HR' },
         { key: 'R', label: 'R' }, { key: 'RBI', label: 'RBI' }, { key: 'SB', label: 'SB' },
         { key: 'BB', label: 'BB' },
         { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
         { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0) }]
      : [{ key: 'name', label: 'Player', cls: 'txt' },
         { key: 'team', label: 'Tm', cls: 'txt' },
         { key: 'G', label: 'G' }, { key: 'GS', label: 'GS' }, { key: 'W', label: 'W' },
         { key: 'L', label: 'L' }, { key: 'SV', label: 'SV' }, { key: 'HLD', label: 'HLD' },
         { key: 'IP', label: 'IP', get: (r) => ipFrom(r.IP) }, { key: 'SO', label: 'K' },
         { key: 'ERA', label: 'ERA', get: (r) => num(r.ERA, 2), ascDefault: true },
         { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0) }];
    table.replaceChildren(
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--border)' },
        el('h2', {}, `${num(rows.length)} players`),
        el('span', { class: 'hint' }, batting ? 'Batting' : 'Pitching')),
      statTable(rows, cols, { rank: true, sortKey: 'pts', limit: 100, page: 100 }));
  };

  const seg = el('div', { class: 'seg' },
    el('button', { class: 'on', onclick: (e) => set('batting', e.target) }, 'Batting'),
    el('button', { onclick: (e) => set('pitching', e.target) }, 'Pitching'));
  function set(group, btn) {
    opts.group = group;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    draw();
  }
  draw();

  const missing = ['QS', 'CYCLE', 'GRAND_SLAM', 'NO_HITTER', 'PERFECT_GAME']
    .filter((c) => !live.pitchingCats.includes(c));

  app().replaceChildren(head,
    el('div', { class: 'panel live-panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, el('span', { class: 'live-dot' }), `${live.season} season leaders`),
        el('span', { class: 'hint' },
          `Fetched ${live.fetchedAt.toLocaleString()} · reload for the latest`)),
      el('div', { class: 'filters' },
        el('div', { class: 'field' }, el('label', {}, 'Group'), seg)),
      table, watermark()),
    el('div', { class: 'note', html:
      '<b>Live figures score more categories than the historical pages.</b> The MLB ' +
      'Stats API carries Holds and Blown Saves, which the historical databank does ' +
      'not — so a reliever here is scored on ' +
      `${live.pitchingCats.join(', ')}. Rare-event bonuses (${missing.join(', ')}) ` +
      'still need play-by-play data and score 0.' }));
}

/** Scoring page for a sport whose settings are configured but whose data is
 *  not built yet. The rules below are placeholders, and say so. */
function viewScoringPlaceholder() {
  const s = sport();
  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, `${s.league} League Scoring`),
      el('p', {}, `${s.league_settings.size}-team ${s.league_settings.type}. ` +
        'These are placeholder settings — edit them in the SPORTS registry at the ' +
        'top of app.js and every page here follows.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Scoring categories'),
        el('span', { class: 'hint' }, 'Placeholder values')),
      el('div', { class: 'rules' },
        s.scoringGroups.map((group) => el('div', {},
          el('div', { class: 'tile-label', style: 'margin-bottom:8px' }, group.title),
          el('div', { class: 'rule-list' },
            Object.entries(group.rules).map(([label, weight]) =>
              el('div', { class: 'rule' },
                el('span', {}, label),
                el('span', { class: `w${weight < 0 ? ' neg' : ''}` },
                  weight > 0 ? `+${weight}` : String(weight)))))))),
      watermark()),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Roster')),
      el('div', { class: 'roster-slots' },
        s.roster.map((slot) => el('span', { class: 'slot' }, slot)))),

    el('div', { class: 'note', html:
      `<b>Placeholder, not the real league.</b> Swap these for your actual ` +
      `${s.league} settings and they become the scoring every ${s.league} page ` +
      'uses — the same way the baseball rules are read straight out of ' +
      '<code>fantasy_baseball/config.py</code> at build time.' }),
    el('div', { class: 'note', html: `<b>Data.</b> ${s.dataNote}` }));
}

// ------------------------------------------------------------ site pages

function renderFooter() {
  const m = state.meta;
  const year = new Date().getFullYear();
  const span = year > SITE.launchedYear ? `${SITE.launchedYear}–${year}` : `${year}`;

  const col = (title, links) => el('div', { class: 'foot-col' },
    el('h4', {}, title),
    links.map(([label, href]) => el('a', { href }, label)));

  $('#siteFoot').replaceChildren(el('div', { class: 'foot-inner' },
    el('div', { class: 'foot-brand', html: 'DYNASTY <em>ANALYTICS</em>' }),
    el('div', { class: 'foot-dynasty' }, `Brought to you by ${SITE.dynasty}`),

    el('div', { class: 'foot-cols' },
      col('Explore', [
        ['Player Lookup', '#/player'], ['Career Leaders', '#/career'],
        ['Season Leaders', '#/season'], ['Year Explorer', '#/year'],
        ['Compare', '#/compare'],
      ]),
      col('Reference', [
        ['League Scoring', '#/scoring'], ['Methodology', '#/about'],
        ['Data & Sources', '#/about'],
      ]),
      col('Product', [
        ['League Settings', '#/settings'], ['Plans', '#/pricing'],
        ['Trends (beta)', '#/trends'], ['Ask (beta)', '#/ask'],
      ]),
      col('Site', [
        ['About', '#/about'], ['Contact', '#/contact'],
      ]),
      col('Legal', [
        ['Privacy Policy', '#/privacy'], ['Terms of Use', '#/terms'],
      ])),

    el('div', { class: 'foot-legal' },
      el('div', {}, `© ${span} ${SITE.legalEntity}. ${SITE.name} and its ` +
        'analysis, scoring engine and presentation are the property of ' +
        `${SITE.legalEntity}. Not affiliated with, endorsed by, or sponsored by ` +
        'Major League Baseball, the NBA, the NFL or any club. League, team and ' +
        'player names are used descriptively.'),
      el('div', {},
        'Statistics derived from the Lahman / Chadwick Bureau Baseball Databank, ',
        el('a', { href: 'https://creativecommons.org/licenses/by-sa/3.0/',
                  target: '_blank', rel: 'noopener' }, 'CC BY-SA 3.0'),
        m ? ` · ${m.seasons[0]}–${m.seasons[1]} · ${num(m.players)} players · built ${m.built}` : ''),
    ),
    el('div', { class: 'foot-mark' },
      `${SITE.watermarkBy} · ${SITE.legalEntity}`)));
}

/** Small helper so the static pages read like documents, not DOM code. */
function prose(...nodes) {
  return el('div', { class: 'prose' }, nodes.flat());
}

const p = (html) => el('p', { html });
const h3 = (text) => el('h3', {}, text);
const ul = (items) => el('ul', {}, items.map((i) => el('li', { html: i })));

function viewAbout() {
  const m = state.meta;
  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, `About ${SITE.name}`),
      el('p', {}, SITE.tagline)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'What this is')),
      prose(
        p(`<span class="lead">A fantasy baseball record book that runs on one league’s
           scoring instead of the sport’s.</span>`),
        p(`Baseball’s official statistics were never designed to answer the question
           fantasy managers actually ask: <b>how many points would this guy have put
           up for me?</b> This site answers it for every player who has ever appeared
           in a major-league game — ${num(m.players)} of them, across
           ${num(m.batting_seasons)} batting seasons and ${num(m.pitching_seasons)}
           pitching seasons from ${m.seasons[0]} to ${m.seasons[1]}.`),
        p(`Every total is computed with the league’s exact weights, not an
           approximation and not a generic points preset. Look up a player, sort the
           all-time boards, drop into any single season back to ${m.seasons[0]}, or
           put two careers side by side.`),

        h3('How the numbers are built'),
        ul([
          `<b>Scoring.</b> Each stat line is run through the league’s category
           weights — see the <a href="#/scoring">Scoring</a> page for the full table
           and for the categories the historical record cannot support.`,
          `<b>PTS+.</b> Raw totals reward era as much as talent: a pitcher who threw
           678 innings in 1884 will out-point anyone alive. PTS+ divides a player’s
           points per opportunity by that season’s qualified-league average and
           indexes it to 100, so 150 means half again better than his own
           contemporaries.`,
          `<b>Percentile rails.</b> The bars on a player page rank him against every
           qualified player in history — ${num(m.qualifiers.season_pa)}+ PA or
           ${m.qualifiers.season_ip}+ IP for a season.`,
          `<b>Empty seasons are dropped.</b> Years with no real playing time — a
           pitcher who never batted, a call-up who never got in — are removed rather
           than shown as rows of zeroes.`,
        ]),

        h3('Where the data comes from'),
        p(`Statistics come from the <b>Lahman / Chadwick Bureau Baseball Databank</b>,
           the long-running public record of season-by-season major-league statistics,
           licensed <a href="https://creativecommons.org/licenses/by-sa/3.0/"
           target="_blank" rel="noopener">CC BY-SA 3.0</a>. The dataset here was built
           on ${m.built} and covers complete seasons through ${m.seasons[1]}.`),
        p(`<span class="meta">This site is independent. It is not affiliated with,
           endorsed by, or sponsored by Major League Baseball, any MLB club, or any
           fantasy platform.</span>`),

        watermark(true)),
      adSlot('inline'),
      supportCard()));
}

/** A real contact form when a form endpoint is configured, otherwise nothing.
 *  Formspree/Basin accept a plain POST, so this needs no JavaScript and no
 *  backend -- and it keeps the address off the page, which is the whole point. */
function contactForm() {
  if (!SITE.formEndpoint) return null;
  return el('form', { class: 'contact-form', action: SITE.formEndpoint, method: 'POST' },
    el('div', { class: 'field' },
      el('label', { for: 'cf-email' }, 'Your email'),
      el('input', { type: 'email', id: 'cf-email', name: 'email', required: 'required',
                    placeholder: 'you@example.com' })),
    el('div', { class: 'field' },
      el('label', { for: 'cf-topic' }, 'Topic'),
      el('select', { id: 'cf-topic', name: 'topic' },
        ['Stat correction', 'Feature request', 'Advertising or sponsorship',
         'Licensing', 'Something else'].map((t) => el('option', { value: t }, t)))),
    el('div', { class: 'field full' },
      el('label', { for: 'cf-msg' }, 'Message'),
      el('textarea', { id: 'cf-msg', name: 'message', rows: '5', required: 'required',
                       placeholder: 'Player, season, and what looks off…' })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Send'));
}

function viewContact() {
  const rows = [];
  if (SITE.contactEmail && !SITE.formEndpoint) {
    rows.push(el('a', { class: 'btn primary', href: `mailto:${SITE.contactEmail}` },
      SITE.contactEmail));
  }
  if (SITE.twitter) {
    rows.push(el('a', { class: 'btn', href: `https://twitter.com/${SITE.twitter}`,
                        target: '_blank', rel: 'noopener' }, `X / @${SITE.twitter}`));
  }
  if (SITE.instagram) {
    rows.push(el('a', { class: 'btn', href: `https://instagram.com/${SITE.instagram}`,
                        target: '_blank', rel: 'noopener' }, `Instagram / @${SITE.instagram}`));
  }
  if (SITE.linkedin) {
    rows.push(el('a', { class: 'btn', href: SITE.linkedin,
                        target: '_blank', rel: 'noopener' }, 'LinkedIn'));
  }
  if (SITE.facebook) {
    rows.push(el('a', { class: 'btn', href: SITE.facebook,
                        target: '_blank', rel: 'noopener' }, 'Facebook'));
  }
  if (SITE.discord) {
    rows.push(el('a', { class: 'btn', href: SITE.discord,
                        target: '_blank', rel: 'noopener' }, 'Discord'));
  }

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Contact'),
      el('p', {}, 'Corrections, feature requests, league questions, business enquiries.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Get in touch')),
      prose(
        p(`<span class="lead">Found a number that looks wrong? Tell us — with the
           player and season — and it gets checked against the source data.</span>`),
        contactForm(),
        rows.length
          ? el('div', { class: 'contact-actions' }, rows)
          : (SITE.formEndpoint ? null : p(`<span class="meta">Contact details are
               being finalised — check back shortly.</span>`)),

        h3('Good things to include'),
        ul([
          '<b>Stat corrections</b> — player, season, the figure shown, and what you believe it should be.',
          '<b>Feature requests</b> — the question you were trying to answer when the site fell short.',
          '<b>Advertising & sponsorship</b> — audience and placement enquiries.',
          '<b>Licensing</b> — using these numbers in a newsletter, podcast, or app.',
        ]),
        p(`<span class="meta">This is a side project, not a newsroom — replies come
           when they come.</span>`),
        watermark(true))));
}

// ------------------------------------------------------- league settings
//
// The reason to use this site rather than a record book: put your own league's
// weights in, and every number on every page becomes what that player would
// have been worth to you.

function viewSettings() {
  const defaults = defaultScoring();
  const active = activeScoring();
  const draft = { batting: { ...active.batting }, pitching: { ...active.pitching } };

  const labels = {
    '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', R: 'Run',
    RBI: 'RBI', SB: 'Stolen base', CS: 'Caught stealing', BB: 'Walk',
    IBB: 'Intentional walk', HBP: 'Hit by pitch', SO: 'Strikeout (batter)',
    CYCLE: 'Cycle', GRAND_SLAM: 'Grand slam',
    IP: 'Inning pitched', W: 'Win', L: 'Loss', CG: 'Complete game',
    SHO: 'Shutout', SV: 'Save', ER: 'Earned run', K: 'Strikeout (pitcher)',
    HLD: 'Hold', NO_HITTER: 'No-hitter', PERFECT_GAME: 'Perfect game',
    QS: 'Quality start', BS: 'Blown save', H: 'Hit allowed',
  };
  // Categories the databank cannot support are still editable -- your league
  // may score them -- but they are marked so nobody expects them to move a
  // historical total.
  const unsupported = new Set([...(state.meta.unsupported_batting || []),
                               ...(state.meta.unsupported_pitching || [])]);

  const preview = el('div', { class: 'settings-preview' });

  const refreshPreview = async () => {
    preview.replaceChildren(el('div', { class: 'boot-spinner' }));
    const rows = await getBoard('lb_career_batting');
    const scored = rows.map((r) => ({
      name: r.name, id: r.id,
      pts: scoreBatting(flat(r), draft.batting),
    })).sort((a, b) => b.pts - a.pts).slice(0, 5);
    preview.replaceChildren(
      el('div', { class: 'preview-head' }, 'Career leaders under these settings'),
      el('ol', { class: 'preview-list' },
        scored.map((r) => el('li', {},
          el('a', { class: 'plink', href: playerHref(r.id) }, r.name),
          el('span', {}, num(r.pts, 0))))));
  };

  const field = (group, cat) => {
    const changed = draft[group][cat] !== defaults[group][cat];
    const wrap = el('div', { class: `setting${changed ? ' changed' : ''}` },
      el('label', { for: `s-${group}-${cat}` },
        labels[cat] || cat,
        unsupported.has(cat) ? el('span', { class: 'no-data' }, 'no data') : null),
      el('input', {
        id: `s-${group}-${cat}`, type: 'number', step: '0.05', inputmode: 'decimal',
        value: String(draft[group][cat]),
        oninput: (e) => {
          const v = Number(e.target.value);
          draft[group][cat] = Number.isFinite(v) ? v : 0;
          wrap.classList.toggle('changed', draft[group][cat] !== defaults[group][cat]);
          clearTimeout(wrap._t);
          wrap._t = setTimeout(refreshPreview, 350);
        },
      }));
    return wrap;
  };

  const groupPanel = (group, title) => el('div', {},
    el('div', { class: 'tile-label', style: 'margin-bottom:10px' }, title),
    el('div', { class: 'settings-grid' },
      Object.keys(defaults[group]).map((cat) => field(group, cat))));

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Your League Settings'),
      el('p', {}, 'Put your own scoring in and every page — players, ' +
        'leaderboards, seasons, projections — recomputes to what those players ' +
        'would have been worth in your league.')),

    usingCustomScoring()
      ? el('div', { class: 'note', html:
          '<b>Custom scoring is on.</b> Every points figure on the site is ' +
          'currently computed with your weights, not the defaults.' })
      : null,

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Scoring'),
        el('span', { class: 'hint' }, 'Changes preview live · nothing saves until you apply')),
      el('div', { class: 'rules' },
        groupPanel('batting', 'Batting'),
        groupPanel('pitching', 'Pitching')),
      el('div', { class: 'settings-actions' },
        el('button', { class: 'btn primary', onclick: () => saveScoring(draft) },
          'Apply to the whole site'),
        el('button', { class: 'btn', onclick: () => resetScoring() },
          'Reset to league defaults'),
        el('button', {
          class: 'btn',
          onclick: () => {
            const blob = new Blob([JSON.stringify(draft, null, 2)],
              { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: 'league-scoring.json' });
            document.body.append(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
          },
        }, '↓ Save settings file')),
      watermark()),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Live preview')),
      preview),

    el('div', { class: 'note', html:
      '<b>What custom scoring changes, and what it cannot.</b> Points, ' +
      'points-per-game, rate stats, rankings and projections all follow your ' +
      'weights. PTS+ and the percentile rails do not: both are calibrated ' +
      'against every qualified season scored the league\'s own way, and against ' +
      'arbitrary weights they would be quietly wrong, so they are hidden rather ' +
      'than left to mislead.' }));

  refreshPreview();
}

function viewPricing() {
  const pro = isPro();
  const plan = (name, price, per, blurb, features, current, cta) =>
    el('div', { class: `plan${current ? ' current' : ''}` },
      current ? el('div', { class: 'plan-flag' }, 'Your plan') : null,
      el('h3', {}, name),
      el('div', { class: 'plan-price' }, price,
        per ? el('span', { class: 'per' }, per) : null),
      el('p', { class: 'plan-blurb' }, blurb),
      el('ul', { class: 'plan-features' },
        features.map(([has, text]) => el('li', { class: has ? 'yes' : 'no' },
          el('span', { class: 'mark' }, has ? '✓' : '—'), text))),
      cta);

  const freeCta = pro
    ? el('button', { class: 'btn', onclick: () => setTier('free') }, 'Switch to Free')
    : el('span', { class: 'btn ghost-btn' }, 'Current plan');

  const proCta = pro
    ? el('span', { class: 'btn ghost-btn' }, 'Current plan')
    : (SITE.billing.checkoutUrl
        ? el('a', { class: 'btn primary', href: SITE.billing.checkoutUrl,
                    target: '_blank', rel: 'noopener' },
            `Get Pro — $${SITE.billing.priceMonthly}/mo`)
        : el('button', { class: 'btn primary', onclick: () => setTier('pro') },
            'Preview Pro (demo)'));

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Plans'),
      el('p', {}, 'The whole record book is free to browse. Pro removes the ' +
        'caps, unlocks live current-season data, and adds every league.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Free vs Pro')),
      el('div', { class: 'plans' },
        plan('Free', '$0', null,
          'Enough to settle most arguments.',
          [[true, `Top ${FREE.boardRows} of every all-time leaderboard`],
           [true, 'Full career totals and percentile rails for any player'],
           [true, `${FREE.seasonRows} seasons of any player's game log`],
           [true, `Top ${FREE.yearRows} of any single season, back to 1871`],
           [true, `Compare up to ${FREE.comparePlayers} players`],
           [false, 'Live current-season stats'],
           [false, 'CSV export'],
           [false, 'Basketball and football']],
          !pro, freeCta),

        plan('Pro', `$${SITE.billing.priceMonthly}`, '/month',
          'The full dataset, no ceilings.',
          [[true, 'Every row of every leaderboard — all 20,653 players'],
           [true, 'Complete season-by-season logs, every year'],
           [true, 'Full single-season boards for all 150+ seasons'],
           [true, 'Compare as many players as you like'],
           [true, 'Live current-season stats, refreshed on every load'],
           [true, 'CSV export from any table'],
           [true, 'Basketball and football as they land'],
           [true, 'No ads']],
          pro, proCta)),
      watermark()),

    el('div', { class: 'note', html:
      '<b>This is a working demo of the paywall, not a real one.</b> The plan ' +
      'switch above runs entirely in your browser, so it decides what the ' +
      'interface offers — not what a determined visitor can reach. Charging for ' +
      'access needs the Pro data served from behind an authenticated endpoint; ' +
      'a purely client-side gate can be flipped by anyone who opens devtools. ' +
      'Use the switch to see both experiences.' }),

    el('div', { class: 'note', html:
      '<b>What can and cannot be sold.</b> The underlying statistics are ' +
      '<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" ' +
      'rel="noopener">CC BY-SA 3.0</a>, which permits commercial use but requires ' +
      'attribution and share-alike on derivative databases. Selling tools, ' +
      'analysis and convenience is clean; putting the raw dataset behind a ' +
      'paywall is where that licence starts to bite.' }));

  mount(app(), adSlot('inline'));
}

// -------------------------------------------------------------- beta views
//
// Announced, scoped, and honest about not being built. A roadmap page that
// describes real mechanics is worth more than a fake chart.

function betaPage(title, lede, sections, statusNote) {
  return app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, title, el('span', { class: 'beta-tag' }, 'Beta')),
      el('p', {}, lede)),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'What this will do'),
        el('span', { class: 'hint' }, 'In development')),
      el('div', { class: 'roadmap' },
        sections.map(([heading, body, need]) => el('div', { class: 'roadmap-item' },
          el('h4', {}, heading),
          el('p', {}, body),
          need ? el('div', { class: 'roadmap-need' }, el('b', {}, 'Needs: '), need) : null))),
      watermark()),
    el('div', { class: 'note', html: statusNote }),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Meanwhile')),
      el('div', { class: 'empty-state' },
        el('div', {}, 'Everything historical already works — ',
          el('a', { href: '#/mlb/career' }, 'browse the all-time leaders'),
          ' or ', el('a', { href: '#/settings' }, 'load your league settings'), '.'))));
}

function viewTrends() {
  betaPage('Trends',
    'What the rest of the fantasy world is doing, daily — and whether they are right.',
    [
      ['Most added and dropped',
       'A daily roll-up of the players being picked up and cut across the major ' +
       'fantasy platforms, ranked by how sharply the add rate is moving rather ' +
       'than by raw volume — the second derivative is where the edge is.',
       'A platform trends feed. The major hosts expose add/drop percentages ' +
       'publicly on their own pages; a scheduled job would collect and normalise them.'],
      ['Hot and cold, scored your way',
       'Rolling 7, 15 and 30-day point totals under your own league settings, so ' +
       '"hot" means hot for you — a steals-heavy scoring profile rates a very ' +
       'different player than a home-run one.',
       'Game-level logs from the MLB Stats API, which already powers This Season.'],
      ['Buy low, sell high',
       'Players whose underlying rate stats have moved much further than their ' +
       'point totals — the gap between what a hitter is actually doing and what ' +
       'the box score has paid him for so far.',
       'The advanced metrics already computed on player pages, run across the ' +
       'active roster on a schedule.'],
      ['Waiver-wire fit',
       'Free agents ranked against the specific holes in your roster rather than ' +
       'a universal ranking, using the roster slots on your settings page.',
       'Your league settings, which the site already stores.'],
    ],
    '<b>Status: not built.</b> This page describes the intended mechanics ' +
    'rather than showing invented numbers. Every input listed above is public ' +
    'data; the work is the scheduled collection job, which needs a small backend ' +
    'rather than the static hosting this site runs on today.');
}

function viewAsk() {
  betaPage('Ask',
    'A question box for the record book — plain English in, real numbers out.',
    [
      ['Questions over your own scoring',
       '"Who would have been the best keeper in 1998 under my settings?" — the ' +
       'kind of question that needs both the full history and your league rules, ' +
       'which is exactly the pair this site already holds.',
       'An assistant with tool access to the dataset and your saved settings.'],
      ['Comparisons with reasoning',
       'Not just two columns of numbers but which differences actually matter ' +
       'for a points league, and where the era gap makes a raw comparison unfair.',
       'The PTS+ and advanced metrics already computed here.'],
      ['Cited answers only',
       'Every claim linked to the player page and season it came from, so an ' +
       'answer can be checked rather than trusted. An assistant that cannot ' +
       'point at the row it used should not be believed.',
       'A retrieval layer over the dataset — not a model asked to recall stats ' +
       'from memory, which is how wrong numbers get stated confidently.'],
    ],
    '<b>Status: not built, and deliberately unhurried.</b> A stats assistant ' +
    'that invents plausible-looking numbers is worse than none at all, so this ' +
    'ships when answers can be grounded in and linked to actual rows. It needs a ' +
    'backend to hold an API key — a key shipped to the browser is a key given away.');
}

// -------------------------------------------------------------- admin console

const ADMIN_KEY = 'da-admin';
const isAdmin = () => {
  try { return localStorage.getItem(ADMIN_KEY) === SITE.admin.passphrase; }
  catch { return false; }
};

function viewAdmin() {
  if (!isAdmin()) {
    const input = el('input', { type: 'password', placeholder: 'Passphrase',
                                autocomplete: 'off' });
    const msg = el('div', { class: 'admin-msg' });
    const submit = () => {
      if (input.value === SITE.admin.passphrase) {
        try { localStorage.setItem(ADMIN_KEY, input.value); } catch { /* ignore */ }
        route();
      } else {
        msg.textContent = 'That is not the passphrase.';
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return app().replaceChildren(
      el('div', { class: 'view-head' }, el('h1', {}, 'Admin')),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, el('h2', {}, 'Sign in')),
        el('div', { class: 'admin-gate' },
          input,
          el('button', { class: 'btn primary', onclick: submit }, 'Enter'),
          msg)));
  }

  const flag = (label, on, hint) => el('div', { class: 'admin-row' },
    el('div', {}, el('b', {}, label), hint ? el('span', { class: 'hint' }, hint) : null),
    el('span', { class: `pill ${on ? 'on' : 'off'}` }, on ? 'ON' : 'OFF'));

  const meta = state.meta;
  const leagues = SPORT_IDS.map((id) => el('div', { class: 'admin-row' },
    el('div', {}, el('b', {}, SPORTS[id].league), el('span', { class: 'hint' },
      SPORTS[id].status === 'live' ? `dataset in web/${SPORTS[id].dataDir}/`
                                   : 'no dataset yet')),
    el('span', { class: `pill ${SPORTS[id].status === 'live' ? 'on' : 'off'}` },
      SPORTS[id].status === 'live' ? 'LIVE' : 'PLACEHOLDER')));

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Admin Console'),
      el('p', {}, `Signed in as ${SITE.owner}. Visitors never see this page.`)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Your view of the site')),
      el('div', { class: 'admin-list' },
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Plan override'),
            el('span', { class: 'hint' }, 'See the site exactly as either customer does')),
          el('div', { class: 'seg' },
            el('button', { class: isPro() ? '' : 'on', onclick: () => setTier('free') }, 'Free'),
            el('button', { class: isPro() ? 'on' : '', onclick: () => setTier('pro') }, 'Pro'))),
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Scoring'),
            el('span', { class: 'hint' },
              usingCustomScoring() ? 'custom weights active' : 'league defaults')),
          el('a', { class: 'btn', href: '#/settings' }, 'Edit')),
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Sign out of admin'),
            el('span', { class: 'hint' }, 'Clears the passphrase on this device')),
          el('button', {
            class: 'btn',
            onclick: () => { try { localStorage.removeItem(ADMIN_KEY); } catch { /* ignore */ } go('#/player'); },
          }, 'Sign out')))),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Feature flags'),
        el('span', { class: 'hint' }, 'Edit SITE at the top of app.js, then redeploy')),
      el('div', { class: 'admin-list' },
        flag('Advertising', SITE.ads.enabled, SITE.ads.client || 'no publisher id set'),
        flag('Support / tip jar', SITE.support.enabled, SITE.support.url || 'no link set'),
        flag('Live current-season stats', SITE.live.enabled, 'MLB Stats API, in-browser'),
        flag('Checkout link', !!SITE.billing.checkoutUrl,
          SITE.billing.checkoutUrl || 'demo switch in use'),
        flag('Contact form endpoint', !!SITE.formEndpoint,
          SITE.formEndpoint || 'falls back to a mailto link'))),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Leagues')),
      el('div', { class: 'admin-list' }, leagues)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Dataset')),
      el('div', { class: 'admin-list' },
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Built'), el('span', { class: 'hint' }, meta.source)),
          el('span', {}, meta.built)),
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Coverage')),
          el('span', {}, `${meta.seasons[0]}–${meta.seasons[1]}`)),
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Players')), el('span', {}, num(meta.players))),
        el('div', { class: 'admin-row' },
          el('div', {}, el('b', {}, 'Seasons scored')),
          el('span', {}, `${num(meta.batting_seasons)} batting · ${num(meta.pitching_seasons)} pitching`)))),

    el('div', { class: 'note', html:
      '<b>This console is convenience, not security.</b> It runs in the browser ' +
      'like the rest of the site, so the passphrase gate keeps the page out of a ' +
      'visitor\'s way — it does not protect anything a determined person could not ' +
      'read from the source. Nothing sensitive belongs here. Real admin ' +
      'authentication arrives with the same backend that would enforce paid access.' }));
}

function viewPrivacy() {
  const ads = SITE.ads.enabled;
  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Privacy Policy'),
      el('p', {}, `Last updated ${state.meta.built}`)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'What we collect')),
      prose(
        p(`<span class="lead">Short version: there are no accounts, no logins, and
           nothing you type here is sent to us.</span>`),

        h3('Information you give us'),
        p(`None is required to use the site. There is no sign-up and no user
           account. If you email us, we hold that message and your address for as
           long as it takes to answer you.`),

        h3('Information stored on your device'),
        p(`One item: your colour-theme preference, kept in your browser’s
           <code>localStorage</code> under <code>fa-theme</code>. It never leaves
           your device and is not a tracking cookie. Clearing site data removes it.`),

        h3('Search and page use'),
        p(`Player searches run entirely inside your browser against a dataset
           downloaded with the page. Search terms are never transmitted.`),

        h3('Hosting and server logs'),
        p(`The site is served as static files by our hosting provider, which may
           record standard request logs (IP address, timestamp, user agent) for
           security and reliability. We do not combine those logs with anything else.`),

        h3('Advertising'),
        ads
          ? p(`This site shows ads served by Google AdSense. Google and its partners
               may use cookies or device identifiers to serve and measure ads, and
               may personalise them based on your prior browsing. You can review and
               change your choices at <a href="https://adssettings.google.com"
               target="_blank" rel="noopener">Google Ad Settings</a> and read
               Google’s practices at <a href="https://policies.google.com/technologies/partner-sites"
               target="_blank" rel="noopener">policies.google.com</a>.`)
          : p(`The site currently shows no advertising and runs no advertising
               cookies. If that changes, this section will say exactly who serves
               the ads and how to opt out, before any ad runs.`),

        h3('Analytics'),
        p(`No third-party analytics are loaded. If that changes, this page will name
           the provider first.`),

        h3('Children'),
        p(`The site is intended for a general audience and does not knowingly
           collect personal information from children under 13.`),

        h3('Your rights'),
        p(`Because we hold no account data, there is generally nothing to export or
           delete. If you have emailed us and want that correspondence removed, ask
           and it will be.`),

        h3('Changes'),
        p(`Material changes will be reflected here with a new “last updated” date.`),

        SITE.contactEmail
          ? p(`Questions: <a href="mailto:${SITE.contactEmail}">${SITE.contactEmail}</a>.`)
          : p(`Questions about this policy can be sent through the
               <a href="#/contact">Contact</a> page.`),
        watermark(true))));
}

function viewTerms() {
  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'Terms of Use'),
      el('p', {}, `Last updated ${state.meta.built}`)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'The deal')),
      prose(
        p(`<span class="lead">Use the site, enjoy the site, don’t scrape it into the
           ground or pass it off as your own.</span>`),

        h3('Acceptance'),
        p(`Using ${SITE.name} means accepting these terms. If you do not agree,
           please do not use the site.`),

        h3('What you may do'),
        ul([
          'Browse, search, and share links to any page here.',
          'Quote or screenshot figures in a post, newsletter, or broadcast with credit to this site.',
          'Use the numbers to settle an argument in your own league.',
        ]),

        h3('What you may not do'),
        ul([
          'Automated bulk downloading that degrades the service for others.',
          'Republishing the dataset as your own product without the attribution and share-alike terms the underlying data carries (see below).',
          'Presenting the site, or its numbers, as officially affiliated with Major League Baseball or any fantasy platform.',
        ]),

        h3('Accuracy — read this one'),
        p(`<b>The statistics are provided “as is”, without warranty of any kind.</b>
           They are derived from a third-party historical database and re-scored by
           our own code. Historical records contain genuine errors and revisions,
           some scoring categories are not recorded for older seasons, and our
           calculations may themselves contain bugs. <b>Do not rely on this site for
           wagering, for money decisions, or for anything where being wrong costs
           you.</b> Verify anything that matters against an official source.`),

        h3('Data licensing'),
        p(`Underlying statistics come from the Lahman / Chadwick Bureau Baseball
           Databank under <a href="https://creativecommons.org/licenses/by-sa/3.0/"
           target="_blank" rel="noopener">CC BY-SA 3.0</a>. That licence permits
           commercial use, and it requires attribution and that derivative databases
           be shared under the same licence. Our own code and presentation are
           separate from the underlying data.`),

        h3('Availability'),
        p(`This is a free service with no uptime guarantee. It may change, break, or
           disappear without notice.`),

        h3('Liability'),
        p(`To the fullest extent the law allows, ${SITE.legalEntity || SITE.name} is
           not liable for any loss arising from use of, or inability to use, this
           site — including lost leagues, lost bets, and lost arguments.`),

        SITE.jurisdiction ? h3('Governing law') : null,
        SITE.jurisdiction
          ? p(`These terms are governed by the laws of ${SITE.jurisdiction}.`)
          : null,

        watermark(true))));
}

/** Nudge the owner about config the public pages need, in the console only. */
function warnUnsetConfig() {
  const missing = ['contactEmail', 'legalEntity', 'jurisdiction']
    .filter((k) => !SITE[k]);
  if (missing.length) {
    console.info(
      `[${SITE.shortName}] Unset SITE fields: ${missing.join(', ')}. ` +
      'Set them at the top of app.js — the Contact, Privacy and Terms pages ' +
      'fill themselves in from there.');
  }
}

// ------------------------------------------------------------------- router

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'player';
  const [path] = raw.split('?');
  const parts = path.split('/');

  // Routes are #/<sport>/<view>/<arg>. A first segment that is not a known
  // sport means an older link from before the site had leagues -- treat it as
  // a view under baseball so nothing anyone bookmarked breaks.
  const hasSport = SPORTS[parts[0]] !== undefined;
  const sportId = hasSport ? parts[0] : 'mlb';
  const [view, arg] = hasSport ? parts.slice(1) : parts;

  if (sportId !== state.sport) applySport(sportId);

  document.querySelectorAll('#tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.view === (view || 'player')));
  window.scrollTo({ top: 0 });

  // Data views need a dataset. Reference and account pages work everywhere.
  const dataViews = ['player', 'career', 'season', 'year', 'live', 'compare'];
  if (dataViews.includes(view || 'player') && !sportHasData()) {
    const labels = { player: 'Player Lookup', career: 'Career Leaders',
                     season: 'Season Leaders', year: 'Year Explorer',
                     live: 'This Season', compare: 'Compare' };
    return app().replaceChildren(
      el('div', { class: 'view-head' },
        el('h1', {}, `${sport().league} ${labels[view || 'player']}`),
        el('p', {}, sport().tagline)),
      awaitingData(labels[view || 'player']));
  }

  try {
    switch (view) {
      case 'player':  await viewPlayer(arg); break;
      case 'career':  await viewLeaders('career'); break;
      case 'season':  await viewLeaders('season'); break;
      case 'year':    await viewYear(arg); break;
      case 'compare': await viewCompare(arg); break;
      case 'scoring': viewScoring(); break;
      case 'live':    await viewLive(); break;
      case 'about':   viewAbout(); break;
      case 'contact': viewContact(); break;
      case 'privacy': viewPrivacy(); break;
      case 'terms':   viewTerms(); break;
      case 'pricing': viewPricing(); break;
      case 'settings': viewSettings(); break;
      case 'trends':  viewTrends(); break;
      case 'ask':     viewAsk(); break;
      case 'admin':   viewAdmin(); break;
      default:        await viewPlayer(null);
    }
  } catch (err) {
    console.error(err);
    app().replaceChildren(el('div', { class: 'empty-state' },
      el('h3', {}, 'Something went wrong loading that view'),
      el('div', {}, String(err.message || err))));
  }
}

// --------------------------------------------------------------------- boot

async function boot() {
  initTheme();   // before any await, so the toggle works even if data fails
  try {
    const [meta, index, pct] = await Promise.all([
      getJSON('meta.json'), getJSON('search.json'), getJSON('percentiles.json'),
    ]);
    state.meta = meta;
    state.index = index;
    state.pct = pct;
    state.norm = index.names.map(norm);
    idPos = new Map(index.ids.map((id, i) => [id, i]));
    pidPos = new Map((index.pid || []).map((pid, i) => [pid, i]));

    initSportSwitch();
    applySport(state.sport);
    updateTierBadge();
    renderFooter();
    warnUnsetConfig();
    initSearch();
    window.addEventListener('hashchange', route);
    await route();
  } catch (err) {
    console.error(err);
    app().replaceChildren(el('div', { class: 'empty-state' },
      el('h3', {}, 'Could not load the dataset'),
      el('div', { html:
        'If you opened this file directly from disk, the browser blocks local JSON reads. ' +
        'Serve the folder instead:<br><br><code style="font-family:var(--mono);background:#000;padding:6px 10px;border-radius:6px;display:inline-block">python3 -m http.server -d web 8000</code>' +
        `<br><br><span style="color:var(--grey)">${String(err.message || err)}</span>` })));
  }
}

boot();
