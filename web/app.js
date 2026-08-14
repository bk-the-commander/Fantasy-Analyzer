/* Dynasty Analytics — all-time NFL, NBA and MLB player stats in your league's
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
  tagline: 'Every player in football, basketball and baseball — scored in your league’s points.',

  /* Footer credit line. */
  dynasty: 'The Dynasty (6x) 💍',

  /* Marks. `watermark` is the public one -- it rides on cards, boards and
   * charts, which are the things that get screenshotted and posted somewhere
   * else, so it carries the brand rather than the byline. `watermarkBy` is
   * the personal credit, kept to the footer. */
  watermark: 'Dynasty Analytics',
  watermarkBy: 'Built by Bill Kaliris Jr',
  owner: 'Bill Kaliris Jr',

  /* PARKED, both. A personal byline reads as a portfolio piece, and the
   * dynasty line is an inside joke a first-time visitor is not in on. Flip
   * either to true to put it back. See #/parked. */
  showByline: false,
  showDynasty: false,

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
  /* PARKED. Kaliris Labs is not a registered company, and a copyright line
   * naming an entity that does not exist is a claim you cannot support. Left
   * blank until an LLC exists; the footer and legal pages fall back to the
   * product name and "the operator of this site". See #/parked. */
  legalEntity: '',
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
  /* PARKED. Exists for one league out of three and has never made a real
   * request from the build environment. Still reachable at #/mlb/live. */
  live: { enabled: true, season: null, inNav: false },

  /* ---- MONETIZATION ----------------------------------------------------
   * Both are off until switched on. See README "Monetization" for the full
   * rundown, including the licence obligations that come with charging for
   * access to this data. */
  ads: {
    enabled: false,
    client: '',              // AdSense publisher id, e.g. 'ca-pub-0000000000000000'
    slots: { leaderboard: '', inline: '' },
  },
  /* Metering is OFF. Nothing about the product is good enough yet to be worth
   * gating, and a ceiling someone hits on their first visit is a reason to
   * leave, not a reason to pay. The plan machinery stays wired so it can be
   * switched on later without rebuilding it: flip `paywall` to true. */
  paywall: false,

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
    coverage: '1871–2023',
    searchPlaceholder: 'Search any player, 1871–present…',
    emoji: '⚾',
    // Scoring and roster come from meta.json, which the data build writes
    // straight out of fantasy_baseball/config.py.
  },

  nba: {
    id: 'nba', short: 'NBA', league: 'NBA', name: 'Basketball',
    status: 'live', generic: true, dataDir: 'data-nba',
    tagline: 'Every NBA player, scored in your league’s points.',
    coverage: '1996–2025',
    searchPlaceholder: 'Search any NBA player…',

    emoji: '🏀',
  },

  nfl: {
    id: 'nfl', short: 'NFL', league: 'NFL', name: 'Football',
    status: 'live', generic: true, dataDir: 'data-nfl',
    tagline: 'Every NFL player, scored in your league’s points.',
    coverage: '1999–2024',
    searchPlaceholder: 'Search any NFL player…',

    emoji: '🏈',
  },
};

/* Order matters: this drives the league switcher, the home feed and which
 * league a first-time visitor lands in. Football first because it is by a
 * wide margin the biggest fantasy audience of the three, then basketball,
 * then baseball -- which is also the order their seasons arrive in. Baseball
 * was built first, but being built first is not a reason to lead with it. */
const SPORT_IDS = ['nfl', 'nba', 'mlb'];
const DEFAULT_SPORT = 'nfl';
const sport = () => SPORTS[state.sport] || SPORTS[DEFAULT_SPORT];

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
/** Everyone gets everything while metering is off. */
const isPro = () => !SITE.paywall || tier() === 'pro';

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
  sport: DEFAULT_SPORT,   // active league; the URL is the source of truth
  genRates: new Map(),    // points per game per league, for regression
  sports: {},         // id -> {meta, index, pct, norm, idPos, pidPos}
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

/** replaceChildren(), with the same habit removed. Views are built out of
 *  conditional pieces -- `capped ? upgradeBar(...) : null` -- and the DOM turns
 *  a null child into the four-letter word "null" on the page rather than
 *  dropping it. Every view swaps its contents through here so that a condition
 *  going false leaves a gap instead of a bug. */
function swap(parent, ...children) {
  parent.replaceChildren();
  mount(parent, ...children);
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
  if (EMBEDDED) {
    const scoped = EMBEDDED[`${state.sport}:${path}`];
    if (scoped) return scoped;
    if (state.sport === 'mlb' && EMBEDDED[path]) return EMBEDDED[path];
    if (EMBEDDED[`${state.sport}:__missing`]) throw new Error('not in this preview');
  }
  const res = await fetch(`${DATA_DIRS[state.sport] || 'data'}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Load a league's index and metadata once, then keep it. */
async function loadSportData(id) {
  if (state.sports[id]) return state.sports[id];
  const previous = state.sport;
  state.sport = id;                       // getJSON reads the directory from this
  try {
    const [meta, index, pct] = await Promise.all([
      getJSON('meta.json'), getJSON('search.json'), getJSON('percentiles.json'),
    ]);
    const entry = {
      meta, index, pct,
      norm: index.names.map(norm),
      idPos: new Map(index.ids.map((n, i) => [n, i])),
      pidPos: new Map((index.pid || []).map((pid, i) => [pid, i])),
    };
    state.sports[id] = entry;
    return entry;
  } finally {
    state.sport = previous;
  }
}

/** Per-stat leader tables, built offline from the complete season logs.
 *  Kept separate from the boards because the boards are a pool selected by
 *  fantasy points -- see scripts/build_leaders.py for why that matters. */
async function loadLeaders(id) {
  const entry = state.sports[id];
  if (!entry) return null;
  if (entry.leaders !== undefined) return entry.leaders;
  const previous = state.sport;
  state.sport = id;
  try {
    entry.leaders = await getJSON('leaders.json');
  } catch (err) {
    // An older dataset without the file is a missing card, not a broken page.
    console.info(`[${SITE.shortName}] no leaders.json for ${id}`);
    entry.leaders = null;
  } finally {
    state.sport = previous;
  }
  return entry.leaders;
}

/** Point the shared lookups at a league's data. */
function useSportData(id) {
  const entry = state.sports[id];
  if (!entry) return false;
  state.meta = entry.meta;
  state.index = entry.index;
  state.pct = entry.pct;
  state.norm = entry.norm;
  idPos = entry.idPos;
  pidPos = entry.pidPos;
  return true;
}

async function getShard(id) {
  if (EMBEDDED && state.sport === 'mlb') return EMBEDDED.players[String(id)] || null;
  if (EMBEDDED && EMBEDDED[`${state.sport}:players`]) {
    return EMBEDDED[`${state.sport}:players`][String(id)] || null;
  }
  const n = id % state.meta.shards;
  const key = `${state.sport}:${n}`;
  if (!state.shards.has(key)) state.shards.set(key, await getJSON(`players/${n}.json`));
  return state.shards.get(key)[String(id)];
}

async function getBoard(rawName) {
  const name = rawName;
  const key = `${state.sport}:${name}`;
  if (!state.boards.has(key)) {
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
    const group = name.includes('pitching') ? 'pitching' : 'batting';
    applyScoring(rows, group, name.includes('career'));
    state.boards.set(key, rows);
  }
  return state.boards.get(key);
}

async function rankMap(board, key = 'pts') {
  const cacheKey = `${state.sport}:${board}:${key}`;
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

/** Player page URL. Carries the league, because a player id is only unique
 *  within its own dataset -- without it an NBA link resolves against the
 *  baseball index and opens whoever happens to sit at that position. Uses the
 *  source's stable id so shared links survive a rebuild. */
const playerHref = (id, extra = '') => `#/${state.sport}/player/${pidOf(id)}${extra}`;

const posOf = (id) => idPos.get(id);
const indexField = (id, field) => {
  const i = posOf(id);
  return i === undefined ? null : state.index[field][i];
};

/** Full club name for a code. Only the baseball dataset ships a club register
 *  -- the football and basketball feeds already carry readable abbreviations --
 *  so everywhere else this hands back the code unchanged instead of throwing. */
function teamName(code) {
  if (!code) return '';
  const reg = state.meta?.teams;
  return code.split('/').map((c) => (reg && reg[c]) || c).join(' / ');
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

/** Light or dark. Nothing else -- a switch should switch, and a third "auto"
 *  state made the button's current meaning impossible to read at a glance.
 *  First visit follows the device's own setting, then the choice sticks. */
function themePref() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* private mode */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  const theme = themePref();
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#themeToggle');
  if (btn) {
    btn.textContent = theme === 'light' ? '☾' : '☀';
    btn.title = theme === 'light' ? 'Switch to dark' : 'Switch to light';
    btn.setAttribute('aria-label', btn.title);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f6f6f8' : '#0a0810');
}

function initTheme() {
  $('#themeToggle')?.addEventListener('click', () => {
    const next = themePref() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    applyTheme();
  });
  applyTheme();
}

// ------------------------------------------------------------- navigation
//
// Twelve destinations across the top gave every one of them equal weight and
// none of them any explanation. They live in the left panel now, in folders
// that match how someone actually thinks about the product: look things up,
// set up my league, tools, account, and the owner's own pages.
//
// `scoped: true` marks a view that belongs to a league, so its link carries
// the active one -- #/nba/career rather than a bare #/career.

const NAV = [
  // Every entry here works, in every league. Anything that exists for one
  // sport out of three, or describes a feature rather than being one, lives in
  // the Owner folder until that stops being true -- see #/parked.
  { id: 'explore', label: 'Explore', icon: '🔎', open: true, items: [
    ['home',    'Home',            '🏠', false, 'Highlights across all three leagues'],
    ['player',  'Player Lookup',   '👤', true,  'Search anyone and see their career'],
    ['career',  'Career Leaders',  '🏆', true,  'Every career ranked by your points'],
    ['season',  'Season Leaders',  '📈', true,  'The best individual seasons ever'],
    ['year',    'Year Explorer',   '📅', true,  'Any single season, top to bottom'],
    ['compare', 'Compare',         '⚖️', true,  'Two careers side by side'],
  ] },
  { id: 'league', label: 'My League', icon: '⚙️', open: true, items: [
    ['sync',     'Sync Your League', '🔗', true,  'Import scoring from Sleeper, ESPN, Yahoo'],
    ['settings', 'Scoring Settings', '🎛️', false, 'Set your weights — everything recomputes'],
  ] },
  { id: 'tools', label: 'Tools', icon: '🧰', open: false, items: [
    ['chat',   'Ask AI',  '💬', true,  'Questions answered from this data'],
  ] },
  { id: 'about', label: 'About', icon: '👋', open: false, items: [
    ['about',   'About',   'ℹ️', false, 'What this is and where the data comes from'],
    ['scoring', 'Scoring Rules', '📋', true, 'The weights every number here uses'],
    ['contact', 'Contact', '✉️', false, 'Corrections and enquiries'],
  ] },
  { id: 'owner', label: 'Owner', icon: '🔧', open: false, owner: true, items: [
    ['health',  'System Health',      '🩺', false, 'What is running and what needs work'],
    ['parked',  'Parked for Review',  '🅿️', false, 'Hidden from visitors, and why'],
    ['roadmap', 'Build Plan & Costs', '🗺️', false, 'Next steps, pricing, what to pay for'],
    ['trends',  'Trends (unbuilt)',   '📊', false, 'Waiver and hot/cold — needs a backend'],
    ['live',    'This Season (MLB)',  '🔴', true,  'One league only, never verified'],
    ['admin',   'Admin Console',      '🔐', false, 'Plan override and feature flags'],
  ] },
];

const NAV_OPEN_KEY = 'da-nav-open';

function openGroups() {
  try {
    const raw = localStorage.getItem(NAV_OPEN_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* private mode */ }
  return new Set(NAV.filter((g) => g.open).map((g) => g.id));
}

function saveOpenGroups(set) {
  try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...set])); }
  catch { /* private mode */ }
}

function buildSidebar() {
  const nav = $('#sideNav');
  if (!nav) return;
  const open = openGroups();

  swap(nav, ...NAV.map((group) => {
    const list = el('div', { class: 'nav-items', id: `nav-${group.id}` },
      group.items.map(([view, label, icon, scoped, blurb]) =>
        el('a', {
          class: `nav-item${group.owner ? ' owner' : ''}`,
          href: scoped ? `#/${state.sport}/${view}` : `#/${view}`,
          'data-view': view,
          'data-scoped': scoped ? '1' : null,
          title: blurb,
        },
          el('span', { class: 'nav-icon' }, icon),
          el('span', { class: 'nav-text' },
            el('span', { class: 'nav-label' }, label),
            el('span', { class: 'nav-blurb' }, blurb)))));

    const isOpen = open.has(group.id);
    list.hidden = !isOpen;

    const toggle = el('button', {
      class: `nav-group${group.owner ? ' owner' : ''}${isOpen ? ' open' : ''}`,
      type: 'button',
      'aria-expanded': String(isOpen),
      'aria-controls': `nav-${group.id}`,
      onclick: () => {
        const next = openGroups();
        if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
        saveOpenGroups(next);
        buildSidebar();
        markActiveNav();
      },
    },
      el('span', { class: 'nav-icon' }, group.icon),
      el('span', { class: 'nav-group-label' }, group.label),
      el('span', { class: 'nav-caret' }, '▸'));

    return el('div', { class: 'nav-group-wrap' }, toggle, list);
  }));
  markActiveNav();
}

/** Highlight the current view. `autoOpen` reveals the folder holding it --
 *  true when the route changes, false on a repaint, so collapsing the folder
 *  you are standing in actually collapses it. */
function markActiveNav(autoOpen = false) {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const parts = raw.split('?')[0].split('/');
  const view = (SPORTS[parts[0]] ? parts[1] : parts[0]) || 'home';
  document.querySelectorAll('.nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === view);
  });
  if (!autoOpen) return;
  const group = NAV.find((g) => g.items.some(([v]) => v === view));
  if (group) {
    const set = openGroups();
    if (!set.has(group.id)) {
      set.add(group.id);
      saveOpenGroups(set);
      buildSidebar();
    }
  }
}

function initDrawer() {
  const body = document.body;
  const scrim = $('#drawerScrim');
  const btn = $('#menuToggle');
  const close = () => {
    body.classList.remove('drawer-open');
    scrim.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
  };
  btn?.addEventListener('click', () => {
    const opening = !body.classList.contains('drawer-open');
    body.classList.toggle('drawer-open', opening);
    scrim.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
  });
  scrim?.addEventListener('click', close);
  // Picking a destination should get you there, not leave the menu in the way.
  $('#sidebar')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// ------------------------------------------------------- sport + tier chrome

async function applySport(id) {
  state.sport = SPORTS[id] ? id : DEFAULT_SPORT;
  const s = sport();
  if (s.status === 'live') {
    try { await loadSportData(s.id); useSportData(s.id); }
    catch (err) { console.error(`[${s.id}] data failed to load`, err); }
  }
  document.documentElement.setAttribute('data-sport', s.id);

  const context = $('#topbarContext');
  if (context) {
    context.textContent = state.meta
      ? `${s.emoji} ${s.league} · ${state.meta.seasons[0]}–${state.meta.seasons[1]}`
      : `${s.emoji} ${s.league}`;
  }
  const search = $('#globalSearch');
  if (search) search.placeholder = `Search any ${s.league} player…`;

  document.querySelectorAll('#sportSwitch button').forEach((b) => {
    b.classList.toggle('on', b.dataset.sport === s.id);
  });
  // League-scoped links carry the active league, so switching keeps your place.
  document.querySelectorAll('.nav-item[data-scoped]').forEach((a) => {
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
  swap(wrap, ...SPORT_IDS.map((id) => el('button', {
    type: 'button', 'data-sport': id,
    class: state.sport === id ? 'on' : '',
    title: `${SPORTS[id].league} — ${SPORTS[id].name}`,
    onclick: () => go(`#/${id}/player`),
  }, el('span', { class: 'ball' }, SPORTS[id].emoji), SPORTS[id].short,
     SPORTS[id].status === 'placeholder' ? el('span', { class: 'soon' }, 'soon') : null)));
}

function updateTierBadge() {
  const badge = $('#tierBadge');
  if (!badge) return;
  if (!SITE.paywall) { badge.hidden = true; return; }
  badge.hidden = false;
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
  state.genRates.clear();
  route();
}

function resetScoring() {
  try { localStorage.removeItem(SCORING_KEY); } catch { /* ignore */ }
  state.boards.clear();
  state.ranks.clear();
  state.shards.clear();
  state.genRates.clear();
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

/** Where a player played, and when. Consecutive years with the same club are
 *  collapsed into one stint, which is how anyone would describe a career. */
function teamHistoryPanel(entries, label = 'Teams') {
  const stints = [];
  for (const [year, team] of entries) {
    const clubs = String(team || '').split('/').filter(Boolean);
    const key = clubs.join('/') || '—';
    const last = stints[stints.length - 1];
    if (last && last.key === key && year === last.to + 1) last.to = year;
    else stints.push({ key, clubs, from: year, to: year });
  }
  if (!stints.length) return null;

  const distinct = new Set(stints.flatMap((s2) => s2.clubs));
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, label),
      el('span', { class: 'hint' },
        `${distinct.size} club${distinct.size === 1 ? '' : 's'} · ` +
        `${stints.length} stint${stints.length === 1 ? '' : 's'}`)),
    el('ol', { class: 'stints' },
      stints.map((s2) => el('li', { class: 'stint' },
        el('span', { class: 'stint-years' },
          s2.from === s2.to ? String(s2.from) : `${s2.from}–${s2.to}`),
        el('span', { class: 'stint-bar' }),
        // "SFN" tells a Lahman user something and everyone else nothing, so a
        // single club is spelled out where the dataset knows the name. Split
        // seasons keep the codes -- "Boston Red Sox / New York Yankees" on one
        // row is worse than "BOS/NYA" -- and carry the full names on hover.
        el('span', { class: 'stint-club', title: teamName(s2.key) },
          s2.clubs.length === 1 ? teamName(s2.key) : s2.key),
        el('span', { class: 'stint-len' },
          `${s2.to - s2.from + 1} yr${s2.to === s2.from ? '' : 's'}`)))),
    watermark());
}

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
  // Values are normally numbers, which must never break mid-number. A words
  // value -- "right Shoulder" as the most common injury -- is the opposite
  // case: nowrap just clips it. Detect which one this is rather than making
  // every caller say.
  const wordy = typeof value === 'string' && !compound && /[a-z]{3}/i.test(value);
  return el('div', { class: `tile${hero ? ' hero' : ''}` },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: `tile-value${compound ? ' compound' : ''}${wordy ? ' wordy' : ''}` }, value),
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
/* Four-and-five-figure counting stats read as a wall without separators: 12606
 * plate appearances next to 13,817 points looked like two different kinds of
 * number. Columns that hold a year are the exception -- 1,986 is not a season.
 * A column can opt out entirely with `plain: true`. */
const YEAR_KEYS = new Set(['year', 'year0', 'year1', 'season', 'draft_year']);
function cellNumber(v, col) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (col.plain || YEAR_KEYS.has(col.key)) return String(v);
  return num(v, Number.isInteger(v) ? 0 : 1);
}

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
    const col = sortKey ? cols.find((c) => c.key === sortKey) : null;
    if (sortKey && !col) sortKey = null;   // deep link naming a column we do not show
    if (sortKey) {
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
        class: `sortable${c.cls === 'txt' ? ' txt' : ''}` +
               `${sortKey === c.key ? ' sorted' + (asc ? ' asc' : '') : ''}`,
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
        const v = c.get ? c.get(row) : cellNumber(row[c.key], c);
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
    return swap(app(), el('div', { class: 'view-head' },
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
    return swap(app(), el('div', { class: 'empty-state' },
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
  swap(app(), container);

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

  const seasonTeams = new Map();
  for (const r of bat) seasonTeams.set(r[B.YEAR], r[B.TEAM]);
  for (const r of pit) if (!seasonTeams.has(r[P.YEAR])) seasonTeams.set(r[P.YEAR], r[P.TEAM]);
  mount(container, teamHistoryPanel(
    [...seasonTeams.entries()].sort((a, b) => a[0] - b[0]), 'Team history'));

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
  swap(app());
  mount(app(), head, panel, adSlot('leaderboard'));

  const wanted = state.query || {};
  const opts = {
    group: wanted.group === 'pitching' ? 'pitching' : 'batting',
    era: 0,
    minG: 0,
    pos: '',
    q: '',
    sortKey: wanted.sort || 'pts',
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
    swap(body,
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--line)' },
        el('h2', {}, `${num(filtered.length)} ${isCareer ? 'players' : 'seasons'}`),
        el('span', { class: 'hint' },
          (opts.group === 'batting' ? 'Batting' : 'Pitching') +
          (capped ? ` · showing the top ${num(shown.length)}` : '')),
        el('div', { style: 'margin-top:8px' },
          exportButton(filtered, boardExportCols(opts.group, isCareer),
            `${state.sport}-${isCareer ? 'career' : 'season'}-${opts.group}.csv`))),
      buildBoardTable(shown, opts.group, isCareer, opts.sortKey),
      capped ? upgradeBar(
        `${num(filtered.length - shown.length)} more rows on Pro`,
        'The free plan shows the top ' + num(FREE.boardRows) + '.') : null);
  };

  // --- filter controls ----------------------------------------------------
  const seg = el('div', { class: 'seg' },
    el('button', { class: opts.group === 'batting' ? 'on' : '',
                   onclick: (e) => setGroup('batting', e.target) }, 'Batting'),
    el('button', { class: opts.group === 'pitching' ? 'on' : '',
                   onclick: (e) => setGroup('pitching', e.target) }, 'Pitching'));
  function setGroup(g, btn) {
    // Switching sides invalidates a column that only exists on the other one.
    if (opts.group !== g) opts.sortKey = 'pts';
    opts.group = g; opts.pos = '';
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    posField.style.display = g === 'batting' ? '' : 'none';
    draw();
  }

  const posField = el('div', { class: 'field',
                              style: opts.group === 'batting' ? '' : 'display:none' },
    el('label', {}, 'Position'),
    el('select', { onchange: (e) => { opts.pos = e.target.value; draw(); } },
      el('option', { value: '' }, 'Any'),
      ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'].map((p) => el('option', { value: p }, p))));

  mount(filters,
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

function buildBoardTable(rows, group, isCareer, sortKey = 'pts') {
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
  // ERA sorts low-to-high; everything else reads best-first descending.
  const asc = !!cols.find((c) => c.key === sortKey)?.ascDefault;
  return statTable(rows, cols, { rank: true, sortKey, asc, limit: 200, page: 200 });
}

// ------------------------------------------------------------- year explorer

async function viewYear(year) {
  const [ymin, ymax] = state.meta.seasons;
  year = Number(year) || ymax;

  const head = el('div', { class: 'view-head' },
    el('h1', {}, 'Year Explorer'),
    el('p', {}, `Pick any season back to ${state.meta.seasons[0]} and see who ` +
      'actually won your league that year.'));

  const picker = el('select', { onchange: (e) => go(`#/year/${e.target.value}`) },
    Array.from({ length: ymax - ymin + 1 }, (_, i) => ymax - i)
      .map((y) => el('option', { value: y, selected: y === year }, y)));

  const wrap = el('div', {});
  swap(app(), head,
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

  swap(wrap,
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
  swap(app(), head, el('div', { class: 'panel' },
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

  swap(app(),
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
  swap(app(), head, body);

  if (!isPro() && !FREE.liveStats) {
    return swap(app(), head, el('div', { class: 'panel' },
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
    return swap(app(), head, el('div', { class: 'panel' },
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
    swap(table,
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

  swap(app(), head,
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
function viewGenericScoring() {
  const s = sport();
  const m = state.meta;
  const weights = genWeights();
  return swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, `${s.league} League Scoring`),
      el('p', {}, `${m.league.size}-team ${m.league.type}. These are the default ` +
        'weights every page opens with — change them in My League and everything ' +
        'here recomputes.')),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Scoring categories'),
        el('span', { class: 'hint' },
          genCustom() ? 'showing your custom weights' : 'league defaults')),
      el('div', { class: 'rules' },
        el('div', {}, el('div', { class: 'rule-list' },
          Object.entries(weights).map(([cat, w]) => el('div', { class: 'rule' },
            el('span', {}, cat),
            el('span', { class: `w${w < 0 ? ' neg' : ''}` },
              w > 0 ? `+${w}` : String(w))))))),
      el('div', { class: 'settings-actions' },
        el('a', { class: 'btn primary', href: '#/settings' }, 'Edit these weights')),
      watermark()),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Roster')),
      el('div', { class: 'roster-slots' },
        m.league.roster.map((slot) => el('span', { class: 'slot' }, slot)))),
    el('div', { class: 'note', html:
      `<b>Coverage.</b> ${m.coverage_note} Source: ${m.source}. ` +
      `${num(m.players)} players and ${num(m.player_seasons)} player-seasons, ` +
      `${m.seasons[0]}–${m.seasons[1]}, built ${m.built}.` }));
}

function viewScoringPlaceholder() {
  const s = sport();
  swap(app(),
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

  swap($('#siteFoot'), el('div', { class: 'foot-inner' },
    el('div', { class: 'foot-brand', html: 'DYNASTY <em>ANALYTICS</em>' }),
    SITE.showDynasty
      ? el('div', { class: 'foot-dynasty' }, `Brought to you by ${SITE.dynasty}`)
      : null,

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
        ['Sync Your League', '#/sync'], ['League Settings', '#/settings'],
        ...(SITE.paywall ? [['Plans', '#/pricing']] : []),
      ]),
      col('Site', [
        ['About', '#/about'], ['Contact', '#/contact'],
      ]),
      col('Legal', [
        ['Privacy Policy', '#/privacy'], ['Terms of Use', '#/terms'],
      ])),

    el('div', { class: 'foot-legal' },
      // Falls back to the product name while no registered entity exists, so
      // the copyright line never names a company that has not been formed.
      el('div', {}, `© ${span} ${SITE.legalEntity || SITE.name}. The analysis, ` +
        'scoring engine and presentation on this site are its own work. Not ' +
        'affiliated with, endorsed by, or sponsored by the NFL, the NBA, Major ' +
        'League Baseball or any club. League, team and player names are used ' +
        'descriptively.'),
      el('div', {},
        'Statistics from the Lahman / Chadwick Bureau Databank (',
        el('a', { href: 'https://creativecommons.org/licenses/by-sa/3.0/',
                  target: '_blank', rel: 'noopener' }, 'CC BY-SA 3.0'),
        '), nflverse and the hoopR / sportsdataverse NBA release. ',
        el('a', { href: '#/about' }, 'Full sources'),
        m ? ` · ${sport().league} ${m.seasons[0]}–${m.seasons[1]} · built ${m.built}` : ''),
    ),
    el('div', { class: 'foot-mark' },
      [SITE.showByline ? SITE.watermarkBy : null, SITE.legalEntity]
        .filter(Boolean).join(' · ') || SITE.name)));
}

/** Small helper so the static pages read like documents, not DOM code. */
function prose(...nodes) {
  return el('div', { class: 'prose' }, nodes.flat());
}

const p = (html) => el('p', { html });
const h3 = (text) => el('h3', {}, text);
const ul = (items) => el('ul', {}, items.map((i) => el('li', { html: i })));

async function viewAbout() {
  // Every league is loaded so the page can state each one's real coverage
  // rather than describing whichever one happens to be selected.
  const metas = [];
  for (const id of SPORT_IDS) {
    try {
      const entry = await loadSportData(id);
      metas.push({ id, s: SPORTS[id], m: entry.meta });
    } catch { /* a league that will not load is left out rather than faked */ }
  }
  const totalPlayers = metas.reduce((n, x) => n + (x.m.players || 0), 0);
  const totalSeasons = metas.reduce((n, x) =>
    n + (x.m.player_seasons || ((x.m.batting_seasons || 0) + (x.m.pitching_seasons || 0))), 0);

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, `About ${SITE.name}`),
      el('p', {}, SITE.tagline)),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'What this is')),
      prose(
        p(`<span class="lead">A record book for football, basketball and baseball
           that runs on your league’s scoring instead of the sport’s.</span>`),
        p(`Official statistics were never designed to answer the question fantasy
           managers actually ask: <b>how many points would this guy have put up for
           me?</b> This site answers it in all three leagues, for
           ${num(totalPlayers)} players across ${num(totalSeasons)} recorded
           seasons.`),
        p(`Every total is computed with your league’s exact weights — not an
           approximation, not a generic points preset. Import your rules once from
           <a href="#/sync">Sync Your League</a> and every leaderboard, player page
           and projection on the site recomputes under them.`),
        p(`The three leagues are not tiers. Each one gets the same tools: player
           lookup, career and season leaderboards, a year explorer, category
           leaders, head-to-head compare, advanced rates, projections and the
           assistant. What differs is only what each sport records — completion
           percentage in one, true shooting in another, ERA in the third.`),

        h3('What each league covers'),
        ul(metas.map((x) =>
          `<b>${x.s.emoji} ${x.s.league} ${x.m.seasons[0]}–${x.m.seasons[1]}.</b> ` +
          `${num(x.m.players)} players. ${x.m.coverage_note ||
            'Complete for every season in that range.'}`)),

        h3('How the numbers are built'),
        ul([
          `<b>Scoring.</b> Each stat line is run through your category weights —
           see the <a href="#/scoring">Scoring</a> page for the full table and for
           the categories the historical record cannot support.`,
          `<b>PTS+.</b> Raw totals reward era as much as talent: a pitcher who
           threw 678 innings in 1884 will out-point anyone alive, and a 1996
           three-point shooter is not competing in the same game as a 2024 one.
           PTS+ divides points per opportunity by that season’s qualified-league
           average and indexes it to 100, so 150 means half again better than that
           player’s own contemporaries.`,
          `<b>Percentile rails.</b> The bars on a player page rank a player
           against every qualified player in that league’s dataset.`,
          `<b>Category leaders.</b> Home runs, assists and rushing yards are
           computed from the complete season logs, not from the points-ranked
           boards — so a player who led a category without scoring heavily is
           still found.`,
          `<b>Empty seasons are dropped.</b> Years with no real playing time are
           removed rather than shown as rows of zeroes.`,
        ]),

        h3('Where the data comes from'),
        ul(metas.map((x) => `<b>${x.s.league}.</b> ${x.m.source}`)),
        p(`Baseball comes from the Lahman / Chadwick Bureau Databank, published
           under <a href="https://creativecommons.org/licenses/by-sa/3.0/"
           target="_blank" rel="noopener">CC BY-SA 3.0</a>. All three datasets are
           historical: they are complete through the seasons listed above and do
           not include live in-progress games.`),
        p(`<span class="meta">This site is independent. It is not affiliated with,
           endorsed by, or sponsored by the NFL, the NBA, Major League Baseball,
           any club, or any fantasy platform. Statistics are facts; team names and
           marks belong to their owners and are used here only to identify who
           played where.</span>`),

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

  swap(app(),
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

// -------------------------------------------------- generic league renderer
//
// Baseball earns bespoke pages: two disjoint stat groups, a century and a half
// of context, and metrics that only mean anything in that sport. Football and
// basketball share one shape -- a single stat line per season -- so they share
// one renderer driven entirely by the column names in their meta.json. Adding
// a fourth league is a dataset, not another view layer.

const GEN = { YEAR: 0, TEAM: 1, POS: 2, G: 3 };   // fixed head of every row
const genStats = () => state.meta.stat_cols || [];
const genStatIndex = (name) => 4 + genStats().indexOf(name);
const genPts = () => 4 + genStats().length;
const genPlus = () => genPts() + 1;

/** Reader over a generic season row, by category name. */
function genRead(row) {
  const stats = genStats();
  return (key) => {
    if (key === 'G') return row[GEN.G] || 0;
    const i = stats.indexOf(key);
    return i < 0 ? 0 : (row[4 + i] || 0);
  };
}

/** Reader over a generic career array (no year/team/pos head). */
function genReadCareer(arr) {
  const stats = genStats();
  return (key) => {
    if (key === 'G') return arr[0] || 0;
    const i = stats.indexOf(key);
    return i < 0 ? 0 : (arr[1 + i] || 0);
  };
}

function genScore(read, weights) {
  let points = 0;
  for (const [cat, w] of Object.entries(weights)) points += w * read(cat);
  return points;
}

const genWeights = () => {
  const custom = customScoring();
  const base = { ...(state.meta.scoring || {}) };
  return custom && custom[state.sport] ? { ...base, ...custom[state.sport] } : base;
};
const genCustom = () => {
  const custom = customScoring();
  return !!(custom && custom[state.sport]);
};

// ------------------------------------------------- parity: every league, same tools
//
// Baseball was built first and grew four panels the other two never got:
// advanced rates, a projection, a written career summary, and head-to-head
// compare. Football and basketball are not secondary sports here -- football is
// the largest fantasy audience of the three -- so the same four are built once,
// generically, against whatever categories a league happens to record.
//
// Nothing here is baseball logic wearing a different hat. Each league declares
// the rates that mean something in that sport, and the shared code does the
// arithmetic.

/* Advanced rates worth showing, per league. `need` gives a per-game minimum
 * for the categories a group depends on: a group appears only when that part
 * of the game was a real part of the player's job. Tom Brady has three career
 * receptions, and a receiving panel built on them says nothing true about him.
 * Per-game rather than absolute so a four-year career is judged the same way
 * as a twenty-year one. */
const GEN_METRICS = {
  nfl: [
    { group: 'Passing', need: { Att: 3 }, rows: [
      ['Completion %', (t) => (t.Cmp / t.Att) * 100, 1, '%'],
      ['Yards / attempt', (t) => t.PassYd / t.Att, 2],
      ['TD %', (t) => (t.PassTD / t.Att) * 100, 1, '%'],
      ['Interception %', (t) => (t.Int / t.Att) * 100, 1, '%'],
      ['TD / INT', (t) => (t.Int ? t.PassTD / t.Int : t.PassTD), 2],
      ['Yards / game', (t) => t.PassYd / t.G, 1],
    ] },
    { group: 'Rushing', need: { Car: 1 }, rows: [
      ['Yards / carry', (t) => t.RushYd / t.Car, 2],
      ['Carries / game', (t) => t.Car / t.G, 1],
      ['Yards / game', (t) => t.RushYd / t.G, 1],
      ['TD / 100 carries', (t) => (t.RushTD / t.Car) * 100, 1],
    ] },
    { group: 'Receiving', need: { Rec: 0.5 }, rows: [
      ['Catch rate', (t) => (t.Tgt ? (t.Rec / t.Tgt) * 100 : null), 1, '%'],
      ['Yards / catch', (t) => t.RecYd / t.Rec, 2],
      ['Yards / target', (t) => (t.Tgt ? t.RecYd / t.Tgt : null), 2],
      ['Catches / game', (t) => t.Rec / t.G, 1],
      ['Yards / game', (t) => t.RecYd / t.G, 1],
      ['TD / 10 catches', (t) => (t.RecTD / t.Rec) * 10, 2],
    ] },
  ],
  nba: [
    { group: 'Per game', need: {}, rows: [
      ['Points', (t) => t.PTS / t.G, 1],
      ['Rebounds', (t) => t.REB / t.G, 1],
      ['Assists', (t) => t.AST / t.G, 1],
      ['Steals', (t) => t.STL / t.G, 1],
      ['Blocks', (t) => t.BLK / t.G, 1],
      ['Turnovers', (t) => t.TOV / t.G, 1],
      ['Minutes', (t) => t.MIN / t.G, 1],
    ] },
    { group: 'Shooting', need: { FGA: 1 }, rows: [
      ['Field goal %', (t) => (t.FGM / t.FGA) * 100, 1, '%'],
      ['Free throw %', (t) => (t.FTA ? (t.FTM / t.FTA) * 100 : null), 1, '%'],
      // True shooting counts threes and free throws at what they are worth,
      // which is the whole reason a 45% three-point shooter is not "worse"
      // than a 50% shooter at the rim.
      ['True shooting %', (t) => (t.PTS / (2 * (t.FGA + 0.44 * t.FTA))) * 100, 1, '%'],
      ['Threes / game', (t) => t.FG3M / t.G, 1],
      ['Threes / field goal', (t) => (t.FGM ? t.FG3M / t.FGM : null), 2],
    ] },
    { group: 'Per 36 minutes', need: { MIN: 5 }, rows: [
      ['Points', (t) => (t.PTS / t.MIN) * 36, 1],
      ['Rebounds', (t) => (t.REB / t.MIN) * 36, 1],
      ['Assists', (t) => (t.AST / t.MIN) * 36, 1],
      ['Assist / turnover', (t) => (t.TOV ? t.AST / t.TOV : null), 2],
    ] },
  ],
};

/** Career (or single-season) totals for a generic player, by category name. */
function genTotals(rows) {
  const stats = genStats();
  const t = { G: 0 };
  for (const name of stats) t[name] = 0;
  for (const r of rows) {
    t.G += r[GEN.G] || 0;
    stats.forEach((name, i) => { t[name] += r[4 + i] || 0; });
  }
  return t;
}

/** The advanced-rate panels for whichever league is active. */
function genMetricsPanels(rows, label) {
  const groups = GEN_METRICS[state.sport];
  if (!groups || !rows.length) return null;
  const t = genTotals(rows);
  if (!t.G) return null;

  const panels = groups.map((g) => {
    // Skip the whole group rather than printing a column of near-zeroes.
    if (!Object.entries(g.need).every(([k, perGame]) => (t[k] || 0) / t.G >= perGame)) return null;
    const cells = g.rows.map(([name, fn, dp, unit]) => {
      const v = fn(t);
      if (v === null || !Number.isFinite(v)) return null;
      return [name, `${num(v, dp)}${unit || ''}`];
    }).filter(Boolean);
    if (!cells.length) return null;
    // Built here rather than through metricsPanel(), which takes raw numbers
    // and applies baseball's own rounding table. These rates are already
    // formatted -- a completion percentage is 62.5, not 0.625 -- so they are
    // rendered as given, in the same markup so the styling matches.
    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, `${label} — ${g.group.toLowerCase()}`),
        el('span', { class: 'hint' }, 'Computed in your browser from the totals on this page')),
      el('div', { class: 'metrics' },
        cells.map(([name, value]) => el('div', { class: 'metric' },
          el('div', { class: 'metric-label' }, name),
          el('div', { class: 'metric-value' }, value)))),
      watermark());
  }).filter(Boolean);

  return panels.length ? panels : null;
}

/* A projection for leagues whose seasons are a flat row of categories. Same
 * Marcel shape as the baseball one -- last three seasons weighted 5/4/3,
 * regressed toward a prior, adjusted for age -- but it works on points per
 * game, which is the one denominator every sport shares. */
function genMarcel(rows, birthYear) {
  if (!rows.length) return null;
  const weights = genWeights();
  const sorted = [...rows].sort((a, b) => b[GEN.YEAR] - a[GEN.YEAR]);
  const recent = sorted.slice(0, 3);
  const lastYear = recent[0][GEN.YEAR];
  const seasonWeights = [5, 4, 3];

  let wPts = 0, wG = 0, wTotal = 0;
  recent.forEach((row, i) => {
    const w = seasonWeights[i];
    wPts += w * genScore(genRead(row), weights);
    wG += w * (row[GEN.G] || 0);
    wTotal += w;
  });
  if (!wG) return null;

  // Regress toward the average of everyone in this league who played a real
  // number of games. A prior of 30 games is roughly a third of a basketball
  // season and twice a football one, which is the right amount of scepticism
  // for each: football seasons are short, so a single one proves less.
  const prior = state.sport === 'nfl' ? 12 : 30;
  const leagueRate = state.genRates.get(
    `${state.sport}:${genCustom() ? 'custom' : 'default'}`) ?? (wPts / wG);
  const regressed = (wPts + leagueRate * prior) / (wG + prior);

  const projG = (recent[0][GEN.G] || 0) * 0.9 + (wG / wTotal) * 0.1 * 3;
  const age = birthYear ? (lastYear + 1) - birthYear : null;
  const ageFactor = age === null ? 1
    : age > AGE_PEAK ? Math.max(0.7, 1 - 0.003 * (age - AGE_PEAK) ** 1.4)
                     : Math.min(1.1, 1 + 0.006 * (AGE_PEAK - age));

  return {
    season: lastYear + 1,
    age: age === null ? null : age + 1,
    rate: regressed,
    games: Math.round(projG),
    points: regressed * projG * ageFactor,
    ageFactor,
    seasonsUsed: recent.length,
  };
}

/** The average points per game across this league, for regression. Cached per
 *  league and per scoring choice -- change your weights and the league average
 *  moves with them, so a rate cached under the old ones would be wrong. */
async function genLeagueRate() {
  const key = `${state.sport}:${genCustom() ? 'custom' : 'default'}`;
  if (state.genRates.has(key)) return state.genRates.get(key);
  let rate;
  try {
    const board = await getBoard('lb_career');
    const weights = genWeights();
    let pts = 0, g = 0;
    for (const r of board) {
      if ((r.G || 0) < 20) continue;   // a four-game career is not a league average
      pts += genCustom() ? genScore((k) => Number(r[k]) || 0, weights) : r.pts;
      g += r.G;
    }
    rate = g ? pts / g : undefined;
  } catch { rate = undefined; }
  state.genRates.set(key, rate);
  return rate;
}

function genProjectionPanel(p) {
  const born = p.bio?.born ? Number(String(p.bio.born).slice(0, 4)) : null;
  const m = genMarcel(p.s || [], born);
  if (!m) return null;
  const s = sport();

  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, `Projected ${m.season}`),
      el('span', { class: 'hint' },
        'Marcel-style forecast · scored on your current settings')),
    el('div', { class: 'tiles' },
      tile('Projected points', num(m.points, 0),
        m.age ? `age ${m.age} season` : null, true),
      tile('Points / game', num(m.rate, 2), `over ${num(m.games)} games`),
      tile('Games assumed', num(m.games), `${m.seasonsUsed} season${m.seasonsUsed === 1 ? '' : 's'} used`),
      tile('Age curve', m.age ? m2pct(m.ageFactor) : '—',
        m.age ? (m.ageFactor >= 1 ? 'still improving' : 'past peak')
              : 'no birth date in this dataset')),
    el('div', { class: 'note', html:
      '<b>How this is built.</b> The last three seasons weighted 5/4/3, ' +
      'regressed toward the league rate, then adjusted for age off a peak of ' +
      `${AGE_PEAK}. Marcel is the deliberately simple baseline any forecast ` +
      'should beat, not a full projection system — treat it as a sanity check, ' +
      'not a draft board. It rescores instantly when you change your league ' +
      'settings.' +
      (m.age ? '' : ` The ${s.league} dataset carries no birth dates, so the ` +
        'age adjustment is left at neutral rather than guessed.') }),
    watermark());
}

/* A written summary of a career, generated from the record rather than typed
 * out. Baseball gets curated nicknames because no public database has them;
 * everything else here is computed and therefore works for all three leagues. */
function genBioPanel(p, rank) {
  const s = sport();
  const rows = p.s || [];
  if (!rows.length) return null;
  const t = genTotals(rows);
  const stats = genStats();
  const span = `${p.yrs[0]}–${p.yrs[1]}`;
  const years = p.yrs[1] - p.yrs[0] + 1;
  const clubs = [...new Set(p.teams || [])];

  const bits = [];
  bits.push(`${p.n} played ${rows.length} ${s.league} season${rows.length === 1 ? '' : 's'} ` +
    `between ${p.yrs[0]} and ${p.yrs[1]}` +
    (clubs.length === 1 ? ` for ${teamName(clubs[0])}.`
      : ` for ${clubs.length} clubs.`));

  // Whatever this league leads with, said in plain numbers.
  const headline = stats.slice(0, 3)
    .filter((k) => (t[k] || 0) > 0)
    .map((k) => `${num(t[k], t[k] % 1 ? 1 : 0)} ${k}`);
  if (headline.length) bits.push(`Career totals: ${headline.join(', ')}, over ${num(t.G)} games.`);

  if (rank) {
    bits.push(`That is ${ordinal(rank)} in this dataset by fantasy points under ` +
      `${genCustom() ? 'your scoring' : 'the default scoring'}.`);
  }
  if (p.bio?.college) bits.push(`College: ${p.bio.college}.`);
  if (p.bio?.rookie) bits.push(`Entered the league in ${p.bio.rookie}.`);

  const facts = [
    ['Seasons', `${rows.length} (${span})`],
    ['Clubs', clubs.length ? clubs.map(teamName).join(', ') : '—'],
    ['Games', num(t.G)],
    ['Position', p.pos || p.bio?.pos || '—'],
    years !== rows.length ? ['Note', `${years} calendar years, ${rows.length} played`] : null,
  ].filter(Boolean);

  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Career summary'),
      el('span', { class: 'hint' }, 'Written from the record on this page')),
    el('div', { class: 'prose' }, el('p', {}, bits.join(' '))),
    el('div', { class: 'factgrid' },
      facts.map(([k, v]) => el('div', { class: 'fact' },
        el('div', { class: 'fact-key' }, k),
        el('div', { class: 'fact-val' }, v)))),
    el('div', { class: 'chip-row' },
      el('a', {
        class: 'chip', target: '_blank', rel: 'noopener noreferrer',
        href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(`${p.n} ${s.league}`)}`,
      }, 'Wikipedia ↗')),
    watermark());
}

/* Head to head, for leagues whose careers are a flat row of categories. The
 * baseball version reads batting and pitching records; this reads whatever the
 * league records, so the same page works for a wide receiver and a centre. */
async function viewGenericCompare(idsParam) {
  const s = sport();
  const ids = (idsParam || '').split(',').filter(Boolean).map(resolveId).filter(Boolean);
  state.compare = ids;

  const head = el('div', { class: 'view-head' },
    el('h1', {}, `Compare ${s.league} Players`),
    el('p', {}, 'Put careers side by side in league points. Search for a player ' +
      'and use “+ Add to compare”, or add one below.'));

  const adder = el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', {}, 'Add player'),
      el('input', {
        type: 'text', placeholder: 'Type a name and press Enter',
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          const hit = searchPlayers(e.target.value, 1)[0];
          if (hit && !ids.includes(hit.id)) {
            go(`#/${s.id}/compare/${[...ids, hit.id].map(pidOf).join(',')}`);
          }
          e.target.value = '';
        },
      })),
    ids.length ? el('button', { class: 'btn',
      onclick: () => go(`#/${s.id}/compare`) }, 'Clear all') : null);

  const grid = el('div', { class: 'compare-grid' });
  swap(app(), head, el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Head to head')), adder, grid,
    watermark()));

  if (!ids.length) {
    grid.append(el('div', { class: 'cmp-empty' },
      'Add two or more players to compare their careers.'));
    return;
  }

  const allowed = isPro() ? ids : ids.slice(0, FREE.comparePlayers);
  const players = (await Promise.all(allowed.map((id) => getShard(id))))
    .filter((p) => p && Array.isArray(p.s));
  if (allowed.length < ids.length) {
    grid.after(upgradeBar(
      `Comparing ${ids.length} players needs Pro`,
      `The free plan compares ${FREE.comparePlayers} at a time.`));
  }
  if (!players.length) {
    grid.append(el('div', { class: 'cmp-empty' }, 'None of those players are in this dataset.'));
    return;
  }

  const weights = genWeights();
  const totals = players.map((p) => {
    const t = genTotals(p.s);
    const pts = p.s.reduce((sum, r) => sum + genScore(genRead(r), weights), 0);
    const best = p.s.reduce((b, r) => Math.max(b, genScore(genRead(r), weights)), 0);
    return { p, t, pts, best };
  });

  // The first four categories a league records, plus the universals.
  const leagueCats = genStats().slice(0, 4);
  const metrics = [
    ['Career points', (x) => x.pts, 0],
    ['Best season', (x) => x.best, 0],
    ['Points / season', (x) => x.pts / (x.p.s.length || 1), 1],
    ['Points / game', (x) => x.pts / (x.t.G || 1), 2],
    ['Seasons', (x) => x.p.s.length, 0],
    ['Games', (x) => x.t.G, 0],
    ...leagueCats.map((k) => [k, (x) => x.t[k] || 0, 0]),
  ];

  const best = metrics.map(([, fn]) => Math.max(...totals.map(fn)));

  totals.forEach((x) => {
    const card = el('div', { class: 'cmp-card' },
      el('h3', {}, el('a', { href: playerHref(x.p.i), class: 'plink' }, x.p.n)),
      el('div', { class: 'yrs' },
        `${x.p.yrs[0]}–${x.p.yrs[1]}${x.p.pos ? ` · ${x.p.pos}` : ''}`));
    metrics.forEach(([label, fn, dp], m) => {
      const v = fn(x);
      if (!v && m >= 6) return;   // a receiver has no passing yards worth a row
      card.append(el('div', { class: `cmp-row${v === best[m] && v > 0 ? ' best' : ''}` },
        el('span', {}, label), el('span', {}, num(v, dp))));
    });
    card.append(el('div', { style: 'margin-top:12px' },
      el('button', {
        class: 'btn',
        onclick: () => go(`#/${s.id}/compare/${ids.filter((y) => y !== x.p.i).map(pidOf).join(',')}`),
      }, 'Remove')));
    grid.append(card);
  });
}

async function viewGenericPlayer(key) {
  const id = resolveId(key);
  if (!id) {
    const s = sport();
    return swap(app(),
      el('div', { class: 'view-head' },
        el('h1', {}, `${s.league} Player Lookup`),
        el('p', {}, s.tagline)),
      el('div', { class: 'panel' }, el('div', { class: 'empty-state' },
        el('h3', {}, 'Start typing a name'),
        el('div', {}, s.id === 'nfl' ? 'Try Brady, Manning, Peterson, Gronkowski…'
                                     : 'Try LeBron, Curry, Duncan, Nowitzki…'))),
      genericSuggestions());
  }

  const raw = await getShard(id);
  const p = raw && Array.isArray(raw.s) && Array.isArray(raw.yrs) ? raw : null;
  if (!p) {
    return swap(app(), el('div', { class: 'empty-state' },
      el('h3', {}, 'Not in this dataset'),
      el('div', {}, `${sport().league} coverage runs ` +
        `${state.meta.seasons[0]}–${state.meta.seasons[1]}. ` +
        (EMBEDDED ? 'This offline preview also carries a subset of players.' : ''))));
  }

  const weights = genWeights();
  const stats = genStats();
  const rows = p.s || [];
  const careerRead = genReadCareer(p.c || []);
  const careerPts = genScore(careerRead, weights);
  const games = careerRead('G');
  const ranks = await rankMap('lb_career');

  const hero = el('div', { class: 'player-hero' },
    el('h1', { class: 'ph-name' }, p.n),
    el('div', { class: 'ph-badges' },
      p.pos ? el('span', { class: 'badge' }, p.pos) : null,
      el('span', { class: 'badge ghost' }, `${p.yrs[0]}–${p.yrs[1]}`),
      el('span', { class: 'badge' }, `${p.s.length} season${p.s.length === 1 ? '' : 's'}`)),
    el('div', { class: 'ph-bio', html:
      `<b>${sport().league}</b> · league points under ` +
      (genCustom() ? 'your custom scoring' : 'the default scoring') }));

  const card = el('div', { class: 'panel' }, hero, watermark());
  const container = el('div', {}, card);
  swap(app(), container);

  const rank = ranks.get(id);
  const topStats = stats.slice(0, 3);
  card.append(el('div', { class: 'panel-head' },
    el('h2', {}, 'Career — league points'),
    el('span', { class: 'hint' }, `${p.yrs[0]}–${p.yrs[1]} · ${num(games)} games`)));
  card.append(el('div', { class: 'tiles' },
    tile('Fantasy points', num(careerPts, 0),
      rank ? `<span class="rank">${ordinal(rank)}</span> in this dataset` : null, true),
    tile('Points / game', num(games ? careerPts / games : 0, 2), `${num(games)} G`),
    tile('Seasons', num(p.s.length), `${p.yrs[0]}–${p.yrs[1]}`),
    topStats.map((s2) => tile(s2, num(careerRead(s2), 0)))));

  if (!genCustom() && state.pct?.career) {
    const railsEl = el('div', { class: 'rails' },
      el('div', { class: 'rail-legend' },
        el('span', {}, 'Worse'), el('span', {}, 'Percentile rank'), el('span', {}, 'Better')),
      rail('Points', careerPts, pctile('career', 'pts', careerPts), num(careerPts, 0)),
      rail('Points/G', games ? careerPts / games : 0,
        pctile('career', 'ptsg', games ? careerPts / games : 0),
        num(games ? careerPts / games : 0, 2)),
      el('div', { class: 'rails-note' },
        `Percentiles vs. every ${sport().league} player in the dataset.`));
    card.append(railsEl);
  }

  // --- chart ------------------------------------------------------------
  const seasons = rows.map((r) => ({
    year: r[GEN.YEAR], bat: genScore(genRead(r), weights), pit: 0, team: r[GEN.TEAM],
  })).sort((a, b) => a.year - b.year);
  container.append(el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Fantasy points by season'),
      el('span', { class: 'hint' }, 'Hover a bar for the detail')),
    seasonChart(seasons, () => {}, null)));

  // --- season log -------------------------------------------------------
  const logRows = rows.map((r) => {
    const read = genRead(r);
    const o = { year: r[GEN.YEAR], team: r[GEN.TEAM], G: read('G') };
    for (const s2 of stats) o[s2] = read(s2);
    o.pts = genScore(read, weights);
    o.ptsg = o.G ? o.pts / o.G : 0;
    o.plus = genCustom() ? null : r[genPlus()];
    return o;
  });
  const totals = { __total: true, year: 'Career', team: '', G: games, pts: careerPts,
                   ptsg: games ? careerPts / games : 0, plus: null };
  for (const s2 of stats) totals[s2] = careerRead(s2);
  logRows.push(totals);

  const maxPts = Math.max(...logRows.filter((r) => !r.__total).map((r) => r.pts), 1);
  const cols = [
    { key: 'year', label: 'Year', cls: 'txt' },
    { key: 'team', label: 'Tm', cls: 'txt' },
    { key: 'G', label: 'G', get: (r) => num(r.G, r.G % 1 ? 1 : 0) },
    ...stats.map((s2) => ({ key: s2, label: s2,
      get: (r) => num(r[s2], Math.abs(r[s2]) < 100 && r[s2] % 1 ? 1 : 0) })),
    { key: 'plus', label: 'PTS+', title: 'Points per game vs. the league average that season (100)',
      get: (r) => (r.plus ? num(r.plus, 0) : '—') },
    { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
    { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0),
      heat: (v) => Math.max(0, v / maxPts) },
  ];
  container.append(el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Season by season'),
      el('span', { class: 'hint' }, 'Click any column header to sort')),
    statTable(logRows, cols, { sortKey: null }),
    watermark()));

  // --- profile, teams, injuries ------------------------------------------
  if (p.bio) {
    const b = p.bio;
    const facts = [];
    if (b.pos) facts.push(['Position', b.pos]);
    if (b.jersey) facts.push(['Jersey', `#${b.jersey}`]);
    if (b.ht) facts.push(['Height', `${Math.floor(b.ht / 12)}'${b.ht % 12}"`]);
    if (b.wt) facts.push(['Weight', `${b.wt} lb`]);
    if (b.college) facts.push(['College', b.college]);
    if (b.dyear) {
      facts.push(['Drafted', b.dround
        ? `${b.dyear} · round ${b.dround}, pick ${b.dpick || '—'}${b.dteam ? ` (${b.dteam})` : ''}`
        : String(b.dyear)]);
    } else if (b.rookie) {
      facts.push(['Rookie season', String(b.rookie)]);
    }
    if (b.born) facts.push(['Born', b.born]);
    if (facts.length) {
      container.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' },
          el('h2', {}, 'Profile'),
          el('span', { class: 'hint' }, 'From the league’s own player register')),
        el('div', { class: 'factgrid' },
          facts.map(([k, v]) => el('div', { class: 'fact' },
            el('div', { class: 'fact-key' }, k),
            el('div', { class: 'fact-val' }, v)))),
        watermark()));
    }
  }

  mount(container, genBioPanel(p, rank));

  mount(container, teamHistoryPanel(
    rows.map((r) => [r[GEN.YEAR], r[GEN.TEAM]]), 'Team history'));

  mount(container, genMetricsPanels(rows, 'Career'));

  await genLeagueRate();
  mount(container, genProjectionPanel(p));

  if (p.inj) {
    const inj = p.inj;
    container.append(el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Injury history'),
        el('span', { class: 'hint' },
          `${inj.seasons.length} season${inj.seasons.length === 1 ? '' : 's'} with reports`)),
      el('div', { class: 'tiles' },
        tile('Report weeks', num(inj.n), 'times on an injury report', true),
        tile('Ruled out', num(inj.out), 'weeks listed Out'),
        tile('Seasons affected', num(inj.seasons.length),
          `${inj.seasons[0]}–${inj.seasons[inj.seasons.length - 1]}`),
        inj.common[0] ? tile('Most common', inj.common[0][0],
          `${inj.common[0][1]} report${inj.common[0][1] === 1 ? '' : 's'}`) : null),
      inj.common.length ? el('div', { class: 'chip-row' },
        inj.common.map(([what, n]) => el('span', { class: 'chip static' }, `${what} · ${n}`))) : null,
      el('div', { class: 'table-scroll' },
        statTable(inj.log.slice().reverse().map((e) => ({
          season: e[0], week: e[1], injury: e[2] || '—', status: e[3] || '—',
        })), [
          { key: 'season', label: 'Season' },
          { key: 'week', label: 'Week' },
          { key: 'injury', label: 'Injury', cls: 'txt' },
          { key: 'status', label: 'Game status', cls: 'txt' },
        ], { limit: 12, page: 12 })),
      watermark()));
  } else if (state.meta.has_injuries) {
    container.append(el('div', { class: 'note', html:
      '<b>No injury reports on file.</b> The league publishes weekly reports ' +
      'from 2009 onward; this player has none in that window.' }));
  }

  container.append(el('div', { class: 'note', html:
    `<b>Coverage.</b> ${state.meta.coverage_note} Source: ${state.meta.source}.` +
    (state.meta.has_injuries ? '' :
      ' No public injury or transaction feed is available for this league without ' +
      'scraping a site whose terms forbid it, so those panels are absent rather ' +
      'than guessed.') }));
}

function genericSuggestions() {
  const { ids, names, bp, y0, y1 } = state.index;
  const order = ids.map((id, i) => i).sort((a, b) => bp[b] - bp[a]).slice(0, 8);
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Top careers in this dataset')),
    el('div', { class: 'compare-grid' },
      order.map((i) => el('a', { class: 'cmp-card', href: playerHref(ids[i]) },
        el('h3', {}, names[i]),
        el('div', { class: 'yrs' }, `${y0[i]}–${y1[i]}`),
        el('div', { class: 'cmp-row best' },
          el('span', {}, 'Career points'), el('span', {}, num(bp[i], 0)))))));
}

async function viewGenericBoard(kind) {
  const isCareer = kind === 'career';
  const s = sport();
  const head = el('div', { class: 'view-head' },
    el('h1', {}, `${s.league} ${isCareer ? 'Career' : 'Season'} Leaders`),
    el('p', {}, isCareer
      ? `Every ${s.league} career in the dataset, ranked by fantasy points under ${genCustom() ? 'your scoring' : 'the default scoring'}.`
      : `The best individual ${s.league} seasons in the dataset. Sort by any column.`));

  const body = el('div', {});
  const filters = el('div', { class: 'filters' });
  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Leaderboard'),
      el('span', { class: 'hint' }, 'Click a name for the full player page')),
    filters, body, watermark());
  swap(app(), head, panel);

  const raw = await getBoard(isCareer ? 'lb_career' : 'lb_season');
  const weights = genWeights();
  const stats = genStats();
  const wanted = state.query || {};
  // A deep link may ask to sort by a category the default eight columns do not
  // include (minutes, free throws). Show that column rather than silently
  // ignoring the request the reader clicked on.
  const shownStats = stats.slice(0, 8);
  if (wanted.sort && stats.includes(wanted.sort) && !shownStats.includes(wanted.sort)) {
    shownStats.push(wanted.sort);
  }
  const opts = { q: '', minG: 0, pos: '', sortKey: wanted.sort || 'pts' };

  const scored = raw.map((r) => {
    const read = (k) => Number(r[k]) || 0;
    const pts = genCustom() ? genScore(read, weights) : r.pts;
    return { ...r, pts, ptsg: r.G ? pts / r.G : 0 };
  }).sort((a, b) => b.pts - a.pts);

  const positions = [...new Set(raw.map((r) => r.pos).filter(Boolean))].sort();

  const draw = () => {
    const q = norm(opts.q);
    const filtered = scored.filter((r) =>
      (!q || norm(r.name).includes(q)) &&
      (!opts.minG || r.G >= opts.minG) &&
      (!opts.pos || r.pos === opts.pos));
    const shown = limitRows(filtered, FREE.boardRows);
    const maxPts = Math.max(...shown.map((r) => r.pts), 1);

    const cols = [
      { key: 'name', label: 'Player', cls: 'txt', get: playerLink },
      isCareer ? { key: 'year0', label: 'From' } : { key: 'year', label: 'Year' },
      isCareer ? { key: 'year1', label: 'To' } : { key: 'team', label: 'Tm', cls: 'txt' },
      isCareer ? { key: 'seasons', label: 'Yrs' }
               : { key: 'pos', label: 'Pos', cls: 'txt' },
      { key: 'G', label: 'G', get: (r) => num(r.G, r.G % 1 ? 1 : 0) },
      ...shownStats.map((s2) => ({ key: s2, label: s2,
        get: (r) => num(r[s2], Math.abs(r[s2]) < 100 && r[s2] % 1 ? 1 : 0) })),
      !isCareer && !genCustom()
        ? { key: 'ptsplus', label: 'PTS+', get: (r) => (r.ptsplus ? num(r.ptsplus, 0) : '—') }
        : null,
      { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
      { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0),
        heat: (v) => Math.max(0, v / maxPts) },
    ].filter(Boolean);

    swap(body,
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--border)' },
        el('h2', {}, `${num(filtered.length)} ${isCareer ? 'players' : 'seasons'}`),
        el('span', { class: 'hint' },
          `${state.meta.seasons[0]}–${state.meta.seasons[1]}` +
          (shown.length < filtered.length ? ` · showing the top ${num(shown.length)}` : '')),
        el('div', { style: 'margin-top:8px' },
          exportButton(filtered, cols.filter((c) => c.key !== 'name')
            .map((c) => ({ key: c.key, label: c.label }))
            .concat([{ key: 'name', label: 'Player' }]),
            `${state.sport}-${kind}.csv`))),
      statTable(shown, cols, { rank: true, sortKey: opts.sortKey, limit: 200, page: 200 }),
      shown.length < filtered.length
        ? upgradeBar(`${num(filtered.length - shown.length)} more rows on Pro`,
            `The free plan shows the top ${num(FREE.boardRows)}.`)
        : null);
  };

  mount(filters,
    positions.length ? el('div', { class: 'field' }, el('label', {}, 'Position'),
      el('select', { onchange: (e) => { opts.pos = e.target.value; draw(); } },
        el('option', { value: '' }, 'Any'),
        positions.map((pos) => el('option', { value: pos }, pos)))) : null,
    el('div', { class: 'field' }, el('label', {}, 'Min games'),
      el('input', { type: 'number', value: 0, min: 0, step: 1,
        oninput: (e) => { opts.minG = Number(e.target.value) || 0; draw(); } })),
    el('div', { class: 'field' }, el('label', {}, 'Filter by name'),
      el('input', { type: 'text', placeholder: 'e.g. Brady',
        oninput: (e) => { opts.q = e.target.value; draw(); } })));
  draw();
}

async function viewGenericYear(yearArg) {
  const [lo, hi] = state.meta.seasons;
  const year = Number(yearArg) || hi;
  const s = sport();
  const picker = el('select', { onchange: (e) => go(`#/${s.id}/year/${e.target.value}`) },
    Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)
      .map((y) => el('option', { value: y, selected: y === year }, y)));

  const wrap = el('div', {});
  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, `${s.league} Year Explorer`),
      el('p', {}, `Any season from ${lo} to ${hi}, scored your way.`)),
    el('div', { class: 'panel' },
      el('div', { class: 'filters' },
        el('div', { class: 'field' }, el('label', {}, 'Season'), picker)),
      wrap, watermark()));

  const raw = await getBoard('lb_season');
  const weights = genWeights();
  const stats = genStats();
  const rows = raw.filter((r) => r.year === year).map((r) => {
    const read = (k) => Number(r[k]) || 0;
    const pts = genCustom() ? genScore(read, weights) : r.pts;
    return { ...r, pts, ptsg: r.G ? pts / r.G : 0 };
  }).sort((a, b) => b.pts - a.pts);
  const shown = limitRows(rows, FREE.yearRows);
  const maxPts = Math.max(...shown.map((r) => r.pts), 1);

  swap(wrap,
    el('div', { class: 'panel-head', style: 'border-top:1px solid var(--border)' },
      el('h2', {}, `${year} leaders`),
      el('span', { class: 'hint' }, `${num(rows.length)} qualifying players`)),
    rows.length ? statTable(shown, [
      { key: 'name', label: 'Player', cls: 'txt', get: playerLink },
      { key: 'team', label: 'Tm', cls: 'txt' },
      { key: 'pos', label: 'Pos', cls: 'txt' },
      { key: 'G', label: 'G', get: (r) => num(r.G, r.G % 1 ? 1 : 0) },
      ...stats.slice(0, 8).map((s2) => ({ key: s2, label: s2,
        get: (r) => num(r[s2], Math.abs(r[s2]) < 100 && r[s2] % 1 ? 1 : 0) })),
      { key: 'ptsg', label: 'PTS/G', get: (r) => num(r.ptsg, 2) },
      { key: 'pts', label: 'Points', cls: 'pts-cell', get: (r) => num(r.pts, 0),
        heat: (v) => Math.max(0, v / maxPts) },
    ], { rank: true, sortKey: 'pts', limit: 200, page: 200 })
      : el('div', { class: 'empty-state' }, 'No players for that season.'),
    shown.length < rows.length
      ? upgradeBar(`${num(rows.length - shown.length)} more from ${year} on Pro`, null)
      : null);
}

function viewGenericSettings() {
  const s = sport();
  const defaults = { ...(state.meta.scoring || {}) };
  const draft = { ...genWeights() };
  const preview = el('div', { class: 'settings-preview' });

  const refresh = async () => {
    swap(preview, el('div', { class: 'boot-spinner' }));
    const rows = await getBoard('lb_career');
    const top = rows.map((r) => ({
      name: r.name, id: r.id,
      pts: genScore((k) => Number(r[k]) || 0, draft),
    })).sort((a, b) => b.pts - a.pts).slice(0, 5);
    swap(preview,
      el('div', { class: 'preview-head' }, `${s.league} career leaders under these settings`),
      el('ol', { class: 'preview-list' }, top.map((r) => el('li', {},
        el('a', { class: 'plink', href: playerHref(r.id) }, r.name),
        el('span', {}, num(r.pts, 0))))));
  };

  const grid = el('div', { class: 'settings-grid' },
    Object.keys(defaults).map((cat) => {
      const wrap = el('div', { class: `setting${draft[cat] !== defaults[cat] ? ' changed' : ''}` },
        el('label', { for: `g-${cat}` }, cat),
        el('input', {
          id: `g-${cat}`, type: 'number', step: '0.01', inputmode: 'decimal',
          value: String(draft[cat]),
          oninput: (e) => {
            const v = Number(e.target.value);
            draft[cat] = Number.isFinite(v) ? v : 0;
            wrap.classList.toggle('changed', draft[cat] !== defaults[cat]);
            clearTimeout(wrap._t);
            wrap._t = setTimeout(refresh, 350);
          },
        }));
      return wrap;
    }));

  const save = () => {
    const all = customScoring() || {};
    all[s.id] = draft;
    saveScoring(all);
  };
  const reset = () => {
    const all = customScoring() || {};
    delete all[s.id];
    if (Object.keys(all).length) saveScoring(all); else resetScoring();
  };

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, `Your ${s.league} League Settings`),
      el('p', {}, 'Set your own weights and every ' + s.league +
        ' page recomputes to what those players would have been worth to you.')),
    el('div', {}, genCustom() ? el('div', { class: 'note', html:
      `<b>Custom ${s.league} scoring is on.</b>` }) : null),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Scoring'),
        el('span', { class: 'hint' }, 'Previews live · nothing saves until you apply')),
      el('div', { class: 'rules' }, el('div', {}, grid)),
      el('div', { class: 'settings-actions' },
        el('button', { class: 'btn primary', onclick: save }, 'Apply to the whole site'),
        el('button', { class: 'btn', onclick: reset }, 'Reset to defaults')),
      watermark()),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Live preview')),
      preview));
  refresh();
}

// ------------------------------------------------------- league settings
//
// The reason to use this site rather than a record book: put your own league's
// weights in, and every number on every page becomes what that player would
// have been worth to you.

function viewSettings() {
  if (sport().generic) return viewGenericSettings();
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
    swap(preview, el('div', { class: 'boot-spinner' }));
    const rows = await getBoard('lb_career_batting');
    const scored = rows.map((r) => ({
      name: r.name, id: r.id,
      pts: scoreBatting(flat(r), draft.batting),
    })).sort((a, b) => b.pts - a.pts).slice(0, 5);
    swap(preview,
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

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, 'Your League Settings'),
      el('p', {}, 'Put your own scoring in and every page — players, ' +
        'leaderboards, seasons, projections — recomputes to what those players ' +
        'would have been worth in your league.')),

    el('div', {}, usingCustomScoring()
      ? el('div', { class: 'note', html:
          '<b>Custom scoring is on.</b> Every points figure on the site is ' +
          'currently computed with your weights, not the defaults.' })
      : null),

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

  swap(app(),
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
           [true, `Top ${FREE.yearRows} of any single season, in every league`],
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

// ---------------------------------------------------------------- home page
//
// Everything here is computed from the datasets on this site. It is not news:
// no wire feed is reachable from a static page, and inventing headlines would
// be worse than having none. What it can do honestly is surface the things a
// fantasy manager would actually click -- record seasons, era leaders, the
// players whose value swings most under different scoring.

/* ------------------------------------------------------- stat leaders card
 *
 * Points are this site's own invention; home runs, assists and rushing yards
 * are what the sport actually recorded. Leading with only points asks a new
 * visitor to trust a number they have never seen before, so the home page
 * opens each league on its real categories and lets them switch.
 *
 * Every row is a link, every chip re-renders the list, and the bar next to a
 * name is that player's share of the leader's total -- a chart small enough to
 * read at a glance and honest enough to show a runaway record for what it is.
 */
function statLeadersCard(sportId, leaders, meta) {
  if (!leaders || !leaders.stats || !leaders.stats.length) return null;
  const s = SPORTS[sportId];
  const state2 = { stat: leaders.stats[0].key, scope: 'career' };

  const chips = el('div', { class: 'lead-chips', role: 'group',
                            'aria-label': `${s.league} categories` });
  const listWrap = el('div', { class: 'lead-body' });
  const foot = el('a', { class: 'home-more' });
  const caption = el('span', { class: 'home-meta' });

  const spec = () => leaders.stats.find((x) => x.key === state2.stat) || leaders.stats[0];

  const draw = () => {
    const sp = spec();
    const rows = (leaders[state2.scope] || {})[sp.key] || [];
    chips.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.key === state2.stat);
      b.setAttribute('aria-pressed', String(b.dataset.key === state2.stat));
    });

    // Bars are scaled against the top value, and for an ascending stat like
    // ERA the best value is the smallest -- so the bar reads "how close to the
    // leader", not "how big", in both directions.
    const vals = rows.map((r) => r.v).filter((v) => typeof v === 'number');
    const best = sp.asc ? Math.min(...vals) : Math.max(...vals);
    const worst = sp.asc ? Math.max(...vals) : 0;
    const share = (v) => {
      if (!vals.length || best === undefined) return 0;
      if (!sp.asc) return best ? Math.max(0, v / best) : 0;
      const range = worst - best;
      return range ? 1 - ((v - best) / range) * 0.7 : 1;
    };

    if (!rows.length) {
      swap(listWrap, el('div', { class: 'empty-state' },
        el('h3', {}, 'Nothing recorded for that category')));
    } else {
      swap(listWrap, el('ol', { class: 'lead-list' },
        rows.slice(0, 5).map((r, i) => el('li', { class: 'lead-row' },
          el('span', { class: 'lead-rank' }, String(i + 1)),
          el('a', { class: 'lead-name plink', href: `#/${sportId}/player/${r.pid}`,
                    title: `${r.name} — full player page` }, r.name),
          el('span', { class: 'lead-when' }, state2.scope === 'season'
            ? `${r.year}${r.team ? ` · ${r.team}` : ''}`
            : (r.span ? `${r.span[0]}–${r.span[1]}` : '')),
          el('span', { class: 'lead-bar' },
            el('span', { class: 'lead-fill',
                         style: `width:${(share(r.v) * 100).toFixed(1)}%` })),
          el('span', { class: 'lead-value' }, num(r.v, sp.dp || 0))))));
    }

    const range = `${meta.seasons[0]}–${meta.seasons[1]}`;
    caption.textContent = state2.scope === 'career'
      ? `Career totals · seasons ${range}`
      : `Best single seasons · ${range}`;
    // Deep-link into the sortable board already sorted by this category, so the
    // card is a way in rather than a dead end.
    const group = sp.side === 'pit' ? 'pitching' : 'batting';
    const view = state2.scope === 'career' ? 'career' : 'season';
    foot.href = `#/${sportId}/${view}?sort=${encodeURIComponent(sp.key)}` +
                (SPORTS[sportId].generic ? '' : `&group=${group}`);
    foot.textContent = `All ${sp.label.toLowerCase()} leaders →`;
  };

  mount(chips, leaders.stats.map((st) => el('button', {
    type: 'button', class: 'lead-chip', 'data-key': st.key,
    onclick: () => { state2.stat = st.key; draw(); },
  }, st.label)));

  const scopeSeg = el('div', { class: 'seg lead-seg' },
    ['career', 'season'].map((k) => el('button', {
      type: 'button', class: k === 'career' ? 'on' : '',
      onclick: (e) => {
        state2.scope = k;
        scopeSeg.querySelectorAll('button')
          .forEach((b) => b.classList.toggle('on', b === e.target));
        draw();
      },
    }, k === 'career' ? 'Career' : 'Single season')));

  const card = el('article', { class: 'home-card wide lead-card' },
    el('div', { class: 'home-card-head' },
      el('span', { class: 'home-ball' }, s.emoji),
      el('div', {},
        el('h3', {}, `${s.league} — category leaders`),
        caption),
      scopeSeg),
    chips, listWrap, foot);

  draw();
  return card;
}

async function viewHome() {
  const cards = [];
  const s = sport();

  swap(app(),
    el('div', { class: 'hero' },
      el('h1', { class: 'hero-title' },
        'Every player. ', el('em', {}, 'Your'), ' scoring.'),
      el('p', { class: 'hero-sub' },
        'Put your league’s rules in once and see how anyone in the record ' +
        'book would have scored for you — football, basketball and baseball, ' +
        'all three under the same rules.'),
      el('div', { class: 'hero-actions' },
        el('a', { class: 'btn primary', href: '#/settings' }, 'Set your league scoring'),
        el('a', { class: 'btn', href: `#/${s.id}/career` }, 'Browse all-time leaders'),
        el('a', { class: 'btn', href: `#/${s.id}/chat` }, 'Ask a question')),
      el('div', { class: 'hero-leagues' },
        SPORT_IDS.map((id) => el('a', { class: 'hero-league', href: `#/${id}/player` },
          el('span', { class: 'hero-ball' }, SPORTS[id].emoji),
          el('span', {}, SPORTS[id].league),
          el('small', {}, SPORTS[id].coverage || ''))))),
    el('div', { class: 'home-grid', id: 'homeGrid' },
      el('div', { class: 'boot' }, el('div', { class: 'boot-spinner' }))));

  // Pull the headline facts from each league in parallel.
  const grid = $('#homeGrid');
  const feed = [];

  for (const id of SPORT_IDS) {
    try {
      await loadSportData(id);
      const before = state.sport;
      state.sport = id;
      useSportData(id);
      const meta = state.meta;
      const generic = SPORTS[id].generic;
      const leaders = await loadLeaders(id);
      const careerBoard = await getBoard(generic ? 'lb_career' : 'lb_career_batting');
      const seasonBoard = await getBoard(generic ? 'lb_season' : 'lb_season_batting');
      const topCareer = careerBoard.slice(0, 3);
      const topSeason = [...seasonBoard].sort((a, b) => b.pts - a.pts).slice(0, 3);
      const latest = Math.max(...seasonBoard.map((r) => r.year));
      const latestBest = seasonBoard.filter((r) => r.year === latest)
        .sort((a, b) => b.pts - a.pts).slice(0, 3);

      feed.push({
        id, league: SPORTS[id].league, emoji: SPORTS[id].emoji, meta, leaders,
        topCareer, topSeason, latest, latestBest,
        href: `#/${id}/career`,
      });
      state.sport = before;
      useSportData(before);
    } catch (err) {
      console.error('home feed', id, err);
    }
  }

  const list = (rows, valueKey) => el('ol', { class: 'home-list' },
    rows.map((r) => el('li', {},
      el('a', { class: 'plink', href: `#/${r.__sport}/player/${r.__pid}` }, r.name),
      el('span', {}, num(r[valueKey], 0)))));

  const decorate = (rows, sportId) => rows.map((r) => {
    const entry = state.sports[sportId];
    const i = entry.idPos.get(r.id);
    return { ...r, __sport: sportId, __pid: entry.index.pid[i] };
  });

  for (const f of feed) {
    // The sport's own categories come first; fantasy points -- which are this
    // site's construction, not the league's -- come after them.
    const leadCard = statLeadersCard(f.id, f.leaders, f.meta);
    if (leadCard) cards.push(leadCard);

    cards.push(el('article', { class: 'home-card' },
      el('div', { class: 'home-card-head' },
        el('span', { class: 'home-ball' }, f.emoji),
        el('div', {},
          el('h3', {}, `${f.league} — all-time points`),
          el('span', { class: 'home-meta' },
            `${f.meta.seasons[0]}–${f.meta.seasons[1]} · ${num(f.meta.players)} players`))),
      list(decorate(f.topCareer, f.id), 'pts'),
      el('a', { class: 'home-more', href: f.href }, 'Full leaderboard →')));

    cards.push(el('article', { class: 'home-card' },
      el('div', { class: 'home-card-head' },
        el('span', { class: 'home-ball' }, f.emoji),
        el('div', {},
          el('h3', {}, `${f.league} — best single seasons`),
          el('span', { class: 'home-meta' }, 'The highest-scoring years on record'))),
      list(decorate(f.topSeason, f.id), 'pts'),
      el('a', { class: 'home-more', href: `#/${f.id}/season` }, 'Season leaders →')));

    cards.push(el('article', { class: 'home-card' },
      el('div', { class: 'home-card-head' },
        el('span', { class: 'home-ball' }, f.emoji),
        el('div', {},
          el('h3', {}, `${f.league} — most recent season (${f.latest})`),
          el('span', { class: 'home-meta' }, 'The newest year this dataset covers'))),
      list(decorate(f.latestBest, f.id), 'pts'),
      el('a', { class: 'home-more', href: `#/${f.id}/year/${f.latest}` }, `Explore ${f.latest} →`)));
  }

  cards.push(el('article', { class: 'home-card wide' },
    el('div', { class: 'home-card-head' },
      el('span', { class: 'home-ball' }, '⚙️'),
      el('div', {},
        el('h3', {}, 'Why the numbers here differ from everywhere else'),
        el('span', { class: 'home-meta' }, 'How to read this site'))),
    el('div', { class: 'home-body' },
      el('p', {}, 'Every total on this site is fantasy points under a scoring ' +
        'system you control — not the sport’s own statistics. Change what a ' +
        'stolen base or a reception is worth and the all-time order changes ' +
        'with it. That is the point.'),
      el('p', {}, 'Turn receptions up to 2 points in ',
        el('a', { href: '#/settings' }, 'My League'),
        ' and the football board reorders around slot receivers. Do the same to ' +
        'stolen bases and Rickey Henderson passes Barry Bonds. Every league ' +
        'behaves the same way.')),
    el('a', { class: 'home-more', href: '#/settings' }, 'Set your scoring →')));

  cards.push(el('article', { class: 'home-card wide' },
    el('div', { class: 'home-card-head' },
      el('span', { class: 'home-ball' }, '📅'),
      el('div', {},
        el('h3', {}, 'What this data does and does not cover'),
        el('span', { class: 'home-meta' }, 'Stated plainly, per league'))),
    el('div', { class: 'home-body' },
      feed.map((f) => el('p', { html:
        `<b>${f.emoji} ${f.league} ${f.meta.seasons[0]}–${f.meta.seasons[1]}.</b> ` +
        (f.meta.coverage_note || 'Complete for every season in that range.') })))));

  swap(grid, ...cards);
  mount(grid.parentNode, adSlot('inline'));
}

// ------------------------------------------------------------ health check
//
// The owner's view of the machine: what every tab is, whether it is actually
// working, and what the next piece of work on it would be. Deliberately
// opinionated -- a status page that says "OK" about everything is useless.

const HEALTH = [
  // [tab, route, status, what it is, what it needs next]
  ['Player Lookup', '#/player', 'live',
   'Search any player and see their career scored in league points, with ' +
   'percentile rails, a points-by-season chart and the full stat log.',
   'All three leagues now carry the same panels: career summary, team history, ' +
   'advanced rates, projection and the season log. What each shows differs by ' +
   'sport because the sports record different things.'],
  ['Career Leaders', '#/career', 'live',
   'Every career ranked by fantasy points, filterable and sortable.',
   'Nothing blocking. Adding league-relative filters (division, era) would help.'],
  ['Season Leaders', '#/season', 'live',
   'The best individual seasons, with the era-adjusted PTS+ rating.',
   'Nothing blocking.'],
  ['Year Explorer', '#/year', 'live',
   'Any single season, scored your way.',
   'Nothing blocking.'],
  ['This Season', '#/live', 'parked',
   'Current-season totals fetched live from the MLB Stats API in the browser.',
   'Pulled from the customer navigation. It exists for one league out of three ' +
   'and has never made a real request from the build environment, which makes ' +
   'it the least finished thing on the site. It stays reachable by URL for ' +
   'testing. Turning it back on means a data source for all three leagues — ' +
   'see Build Plan & Costs.'],
  ['Compare', '#/compare', 'live',
   'Careers side by side with the best value per row highlighted.',
   'Works in all three leagues. The baseball version splits batting and ' +
   'pitching; the others compare on whatever categories that sport records.'],
  ['My League', '#/settings', 'live',
   'The product: set your own scoring weights and every page recomputes from ' +
   'raw counting stats.',
   'Works for all three leagues. Roster-slot editing is not built — only ' +
   'scoring weights. Settings live in this browser, not an account.'],
  ['Trends', '#/trends', 'planned',
   'Daily most-added/dropped, rolling hot/cold under your scoring, buy-low ' +
   'candidates, waiver fit.',
   'Not built. Needs a scheduled backend job to collect platform trend data; ' +
   'static hosting cannot poll on a timer.'],
  ['Ask', '#/ask', 'planned',
   'Natural-language questions over the dataset.',
   'A deterministic query engine is live at #/chat and answers a fixed set of ' +
   'question shapes exactly. A general language model needs a backend to hold ' +
   'an API key — a key shipped to the browser is a key given away.'],
  ['Chat', '#/chat', 'live',
   'Ask a question in plain English and get an answer computed from the data ' +
   'on this site, with a link to the page it came from.',
   'Rule-based, not a language model: it recognises a defined set of question ' +
   'shapes and says so when a question falls outside them. Widening it means ' +
   'adding intents, which is cheap.'],
  ['Plans', '#/pricing', 'demo',
   'Free vs Pro, with a switch to preview both.',
   'The paywall is browser-side: it decides what the interface offers, not ' +
   'what someone determined can reach. Real paid access needs the Pro data ' +
   'behind an authenticated endpoint.'],
  ['Admin', '#/admin', 'demo',
   'Owner console: plan override, feature flags, dataset facts.',
   'Passphrase gate is convenience, not security. Same backend unlocks it ' +
   'properly.'],
  ['Sync Your League', '#/sync', 'partial',
   'Read a league’s scoring rules from the platform it lives on, map them onto ' +
   'this site’s categories, show what changes, and apply them everywhere.',
   'Sleeper is a public key-free API and should work from a browser today. ' +
   'ESPN works for public leagues; private ones need a server to hold session ' +
   'cookies. Yahoo is OAuth, so it needs a server for the client secret. The ' +
   'paste-in reader needs no network and covers every other platform. None of ' +
   'the three network paths has been exercised from the build sandbox — its ' +
   'egress blocks all of them — so the first real call happens in a browser.'],
  ['Parked for Review', '#/parked', 'live',
   'Everything pulled out of the customer-facing site because it is not ' +
   'finished, with what each item needs before it goes back.',
   'Read it once before deploying. Four of the items are decisions only you ' +
   'can make; three are waiting on the same backend.'],
  ['Build Plan & Costs', '#/roadmap', 'live',
   'Owner view of the work left: four phases, what each step costs, the live-' +
   'data licensing question, and how monetisation would actually work.',
   'A written plan, not a running system. Revisit it whenever a phase closes.'],
  ['About / Contact / Privacy / Terms', '#/about', 'live',
   'Standard site pages generated from the SITE config block.',
   'LinkedIn and Facebook URLs are still blank. Contact form endpoint unset, ' +
   'so the page publishes an email address instead.'],
];

const STATUS_META = {
  live:    ['OK', 'Working end to end'],
  partial: ['PARTIAL', 'Works, with a stated gap'],
  planned: ['PLANNED', 'Described, not built'],
  demo:    ['DEMO', 'Real UI, not enforceable'],
  parked:  ['PARKED', 'Built, but pulled out of the customer site — see Parked for Review'],
};

async function viewHealth() {
  const rows = [];
  const started = performance.now();

  // Probe each league's dataset the same way a visitor's browser would.
  for (const id of SPORT_IDS) {
    const s = SPORTS[id];
    const t0 = performance.now();
    let entry = null, error = null;
    try { entry = await loadSportData(id); }
    catch (err) { error = err.message || String(err); }
    rows.push({
      league: s.league, emoji: s.emoji, ms: Math.round(performance.now() - t0),
      ok: !!entry, error,
      meta: entry?.meta || null,
    });
  }

  const datasetPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Datasets'),
      el('span', { class: 'hint' }, 'Loaded live, in this browser, just now')),
    el('div', { class: 'admin-list' },
      rows.map((r) => el('div', { class: 'admin-row' },
        el('div', {},
          el('b', {}, `${r.emoji} ${r.league}`),
          el('span', { class: 'hint' }, r.ok
            ? `${num(r.meta.players)} players · ${num(r.meta.player_seasons || r.meta.batting_seasons)} seasons · ` +
              `${r.meta.seasons[0]}–${r.meta.seasons[1]} · built ${r.meta.built}`
            : `failed: ${r.error}`)),
        el('span', { class: `pill ${r.ok ? 'on' : 'off'}` },
          r.ok ? `${r.ms} ms` : 'ERROR')))),
    el('div', { class: 'note', html:
      rows.filter((r) => r.ok).map((r) =>
        `<b>${r.league}:</b> ${r.meta.coverage_note || 'Full historical coverage.'}`
      ).join('<br>') }));

  const tabPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Every tab: what it is, how it runs, what it needs'),
      el('span', { class: 'hint' }, `${HEALTH.length} surfaces`)),
    el('div', { class: 'health-list' },
      HEALTH.map(([name, route, status, what, next]) => {
        const [label, blurb] = STATUS_META[status] || [status.toUpperCase(), ''];
        return el('div', { class: `health-item ${status}` },
          el('div', { class: 'health-head' },
            el('a', { class: 'health-name', href: route }, name),
            el('span', { class: `pill status-${status}`, title: blurb }, label)),
          el('p', { class: 'health-what' }, what),
          el('div', { class: 'health-next' }, el('b', {}, 'Next: '), next));
      })));

  const counts = HEALTH.reduce((a, [, , st]) => { a[st] = (a[st] || 0) + 1; return a; }, {});

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, 'System Health'),
      el('p', {}, 'Owner view. What every surface does, whether it is running, ' +
        'and the next piece of work on it.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'At a glance')),
      el('div', { class: 'tiles' },
        tile('Surfaces', num(HEALTH.length), 'tabs and pages', true),
        tile('Working', num(counts.live || 0), 'end to end'),
        tile('Partial', num(counts.partial || 0), 'with a stated gap'),
        tile('Planned', num(counts.planned || 0), 'described, not built'),
        tile('Demo only', num(counts.demo || 0), 'needs a backend'),
        tile('Boot', `${Math.round(performance.now() - started)} ms`, 'all datasets')),
      watermark()),

    datasetPanel,
    tabPanel,

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'The one thing blocking the rest')),
      el('div', { class: 'prose' },
        p('<span class="lead">Four separate items — enforceable paid access, ' +
          'a real admin login, Trends, and a language-model Ask — are all the ' +
          'same missing piece: a small server.</span>'),
        p('Everything on this site today is static files. That is why it is ' +
          'fast, free to host and impossible to break. It is also why a paywall ' +
          'can be bypassed from devtools, why an API key cannot be held, and ' +
          'why nothing can run on a schedule.'),
        p('<b>The next build step, in order:</b>'),
        ul([
          'Decide the repo goes public (free hosting) or pick Cloudflare Pages / Netlify, which serve private repos free.',
          'Point a domain at it. AdSense will not approve a github.io subdomain.',
          'Add a tiny backend — a serverless function is enough — to hold the Stripe webhook, the admin session, and one scheduled job.',
          'Move the Pro dataset behind that function. That single change makes the paywall real and the admin console real at once.',
          'Then Trends and a language-model Ask become straightforward.',
        ]))),

    el('div', { class: 'note', html:
      '<b>This page reads live.</b> Dataset rows above are fetched when you ' +
      'open it, so a broken or missing league shows as an error here before a ' +
      'customer ever finds it.' }));
}

// -------------------------------------------------------------- chat engine
//
// A deterministic query engine, not a language model. It recognises a fixed
// set of question shapes and answers each by computing over the loaded data,
// which means it is either exactly right or it says it does not understand --
// it can never invent a plausible-sounding number, which is the failure mode
// that makes stats chatbots untrustworthy.

const STAT_WORDS = {
  mlb: {
    'home run': 'HR', 'homer': 'HR', 'hr': 'HR', 'rbi': 'RBI', 'run': 'R',
    'hit': 'H', 'stolen base': 'SB', 'steal': 'SB', 'walk': 'BB',
    'double': 'D2', 'triple': 'D3', 'strikeout': 'SO',
    'win': 'W', 'save': 'SV', 'inning': 'IPouts', 'era': 'ERA',
    'point': 'pts', 'fantasy point': 'pts',
  },
  nfl: {
    'passing yard': 'PassYd', 'pass yard': 'PassYd', 'passing touchdown': 'PassTD',
    'pass td': 'PassTD', 'rushing yard': 'RushYd', 'rush yard': 'RushYd',
    'rushing touchdown': 'RushTD', 'rush td': 'RushTD', 'reception': 'Rec',
    'catch': 'Rec', 'receiving yard': 'RecYd', 'receiving touchdown': 'RecTD',
    'interception': 'Int', 'fumble': 'FumLost', 'target': 'Tgt',
    'point': 'pts', 'fantasy point': 'pts',
  },
  nba: {
    'point': 'PTS', 'rebound': 'REB', 'assist': 'AST', 'steal': 'STL',
    'block': 'BLK', 'turnover': 'TOV', 'three': 'FG3M', '3-pointer': 'FG3M',
    'free throw': 'FTM', 'minute': 'MIN', 'fantasy point': 'pts',
  },
};

const AWARD_WORDS = { 'cy young': 'CY', mvp: 'MVP', 'rookie of the year': 'ROY',
                      'gold glove': 'GG', 'silver slugger': 'SS',
                      'triple crown': 'TC' };

function chatStat(text, sportId) {
  const table = STAT_WORDS[sportId] || {};
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const k of keys) if (text.includes(k)) return table[k];
  return null;
}

/** Answer a question, or explain that it is out of scope. Returns nodes. */
async function chatAnswer(question) {
  const q = norm(question);
  const s = sport();
  const league = s.league;
  const askLine = `Ask ${/^[AEIOUFHLMNRSX]/.test(s.league) ? 'an' : 'a'} ${s.league} question.`;

  if (!q.trim()) return [el('p', {}, askLine)];

  const year = (q.match(/\b(18[7-9]\d|19\d\d|20[0-2]\d)\b/) || [])[1];
  const wantsMost = /\b(most|lead|led|leader|leads|top|best|highest|record)\b/.test(q);
  const award = Object.keys(AWARD_WORDS).find((a) => q.includes(a));

  // --- awards (baseball only; the award table is in the MLB dataset) -----
  if (award && s.id === 'mlb') {
    const key = AWARD_WORDS[award];
    const board = await getBoard('lb_career_batting');
    const pitch = await getBoard('lb_career_pitching');
    const seen = new Map();
    for (const row of [...board, ...pitch]) seen.set(row.id, row.name);
    const holders = [];
    for (const [id, name] of seen) {
      const rec = await getShard(id).catch(() => null);
      if (rec?.aw?.[key]) holders.push({ id, name, n: rec.aw[key] });
      if (holders.length > 400) break;
    }
    holders.sort((a, b) => b.n - a.n);
    if (!holders.length) return [el('p', {}, `No ${award} data in this dataset.`)];
    return [
      el('p', { html: `<b>${holders[0].name}</b> has the most, with ` +
        `<b>${holders[0].n}</b>.` }),
      chatList(holders.slice(0, 5).map((h) => [h.name, `${h.n}×`, playerHref(h.id)])),
      el('div', { class: 'chat-note' },
        'Counted across the players on the career leaderboards.'),
    ];
  }

  const stat = chatStat(q, s.id);

  // --- "who led <league> in <stat> in <year>" ---------------------------
  if (year && (wantsMost || stat)) {
    const boardName = s.generic ? 'lb_season'
      : (isPitchingStat(stat) ? 'lb_season_pitching' : 'lb_season_batting');
    const rows = (await getBoard(boardName)).filter((r) => r.year === Number(year));
    if (!rows.length) {
      return [el('p', {}, `No ${league} data for ${year}. ` +
        `Coverage runs ${state.meta.seasons[0]}–${state.meta.seasons[1]}.`)];
    }
    const key = stat && rows[0][stat] !== undefined ? stat : 'pts';
    const sorted = [...rows].sort((a, b) => (b[key] || 0) - (a[key] || 0));
    const label = key === 'pts' ? 'fantasy points' : key;
    return [
      el('p', { html: `<b>${sorted[0].name}</b> led ${league} in ${label} in ` +
        `${year} with <b>${num(sorted[0][key], 0)}</b>.` }),
      chatList(sorted.slice(0, 5).map((r) => [r.name, num(r[key], 0), playerHref(r.id)])),
    ];
  }

  // --- "who has the most <stat> of all time" ---------------------------
  if (wantsMost || stat) {
    const boardName = s.generic ? 'lb_career'
      : (isPitchingStat(stat) ? 'lb_career_pitching' : 'lb_career_batting');
    const rows = await getBoard(boardName);
    const key = stat && rows[0][stat] !== undefined ? stat : 'pts';
    const sorted = [...rows].sort((a, b) => (b[key] || 0) - (a[key] || 0));
    const label = key === 'pts' ? 'career fantasy points' : `career ${key}`;
    return [
      el('p', { html: `<b>${sorted[0].name}</b> leads all time in ${label} with ` +
        `<b>${num(sorted[0][key], 0)}</b>.` }),
      chatList(sorted.slice(0, 5).map((r) => [r.name, num(r[key], 0), playerHref(r.id)])),
      el('div', { class: 'chat-note' },
        `${league} coverage: ${state.meta.seasons[0]}–${state.meta.seasons[1]}.`),
    ];
  }

  // --- a player's name on its own ---------------------------------------
  const hit = searchPlayers(question, 1)[0];
  if (hit) {
    return [
      el('p', { html: `<b>${hit.name}</b> — ${hit.y0}–${hit.y1}, ` +
        `<b>${num(hit.pts, 0)}</b> career fantasy points under the current scoring.` }),
      chatList([[hit.name, 'open player page', playerHref(hit.id)]]),
    ];
  }

  return [el('p', { class: 'chat-miss' }, askLine)];
}

const PITCHING_STATS = new Set(['W', 'SV', 'ERA', 'IPouts', 'SO']);
const isPitchingStat = (stat) => stat !== null && PITCHING_STATS.has(stat);

function chatList(items) {
  return el('ol', { class: 'chat-list' },
    items.map(([name, value, href]) => el('li', {},
      el('a', { class: 'plink', href }, name),
      el('span', {}, value))));
}

function viewChat() {
  const s = sport();
  const log = el('div', { class: 'chat-log' });
  const input = el('input', {
    type: 'text', class: 'chat-input', autocomplete: 'off',
    placeholder: `Ask ${/^[AEIOUFHLMNRSX]/.test(s.league) ? 'an' : 'a'} ${s.league} question…`,
    'aria-label': `Ask about ${s.league}`,
  });

  const say = (who, nodes) => {
    log.append(el('div', { class: `chat-msg ${who}` }, nodes));
    log.scrollTop = log.scrollHeight;
  };

  const ask = async (text) => {
    if (!text.trim()) return;
    say('you', [el('p', {}, text)]);
    input.value = '';
    const thinking = el('div', { class: 'chat-msg bot' }, el('p', {}, '…'));
    log.append(thinking);
    try {
      const answer = await chatAnswer(text);
      thinking.remove();
      say('bot', answer);
    } catch (err) {
      thinking.remove();
      say('bot', [el('p', { class: 'chat-miss' },
        `Ask ${/^[AEIOUFHLMNRSX]/.test(s.league) ? 'an' : 'a'} ${s.league} question.`)]);
    }
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });

  const examples = s.id === 'mlb'
    ? ['Who led MLB in home runs in 1972?', 'Who has the most Cy Young awards of all time?',
       'Most stolen bases all time', 'Who led the league in fantasy points in 1998?']
    : s.id === 'nfl'
      ? ['Who led the NFL in passing yards in 2013?', 'Most receiving touchdowns all time',
         'Who scored the most fantasy points in 2007?']
      : ['Who led the NBA in points in 2016?', 'Most assists all time',
         'Who had the most rebounds in 2011?'];

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, `Ask ${s.league}`),
      el('p', {}, 'Questions answered by computing over this site’s data — ' +
        'never guessed. Every answer links to the page it came from.')),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, el('span', { class: 'live-dot' }), `${s.emoji} ${s.league} assistant`),
        el('span', { class: 'hint' },
          `${state.meta.seasons[0]}–${state.meta.seasons[1]} · switch leagues to ask about another`)),
      log,
      el('div', { class: 'chat-bar' },
        input,
        el('button', { class: 'btn primary', onclick: () => ask(input.value) }, 'Ask')),
      el('div', { class: 'chat-examples' },
        examples.map((ex) => el('button', { class: 'chip', onclick: () => ask(ex) }, ex))),
      watermark()),
    el('div', { class: 'note', html:
      '<b>Rule-based, on purpose.</b> This is a query engine, not a language ' +
      'model: it recognises a set of question shapes and computes the answer ' +
      'from the same data the rest of the site draws on. It cannot invent a ' +
      'number, and when a question falls outside what it understands it says ' +
      'so rather than guessing. Answers follow your custom scoring.' }));

  say('bot', [el('p', {}, `Ask me about ${s.league} — leaders, records, or a player. ` +
    'Tap an example below to see the shape of question I understand.')]);
}

// -------------------------------------------------------------- beta views
//
// Announced, scoped, and honest about not being built. A roadmap page that
// describes real mechanics is worth more than a fake chart.

function betaPage(title, lede, sections, statusNote) {
  return swap(app(),
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

// ------------------------------------------------------------ league sync
//
// The differentiator for this product is that it scores history under *your*
// league's rules. Everything upstream of that is data entry, and data entry is
// where people give up. This page removes it.
//
// Four platforms, four different realities, and the honest answer differs for
// each one:
//
//   Sleeper  A documented, public, key-free REST API. A browser can call it
//            directly. This one genuinely works with no server at all.
//   ESPN     No public API since they retired the developer programme, but the
//            endpoint their own app calls is reachable and returns a public
//            league's settings. A private league needs the visitor's session
//            cookies, which is a thing to build carefully, not casually.
//   Yahoo    A real, documented, supported API -- behind OAuth 2.0. OAuth needs
//            a client secret, a secret cannot live in a page anyone can view
//            source on, so this needs a backend. The parser is written and the
//            exact backend contract is spelled out below.
//   Everyone Paste your scoring page in and let it be read. No API, no keys,
//   else     no network, works for CBS, NFL.com, Fantrax, ottoneu, a league
//            constitution in a Google Doc, or a screenshot someone typed out.
//
// The paste path is deliberately the backstop for all of them: it is the only
// one that cannot break when a vendor changes an endpoint.
//
// NOTE ON TESTING. The sandbox this was written in blocks outbound calls to
// all three platforms, so the network path has never made a real request from
// here. The request shapes and response shapes are implemented from each
// platform's documented/observed format; the parsing, mapping, preview and
// apply steps are all tested against captured fixtures. The first real call
// will happen in your browser, and every failure path lands on the paste form.

/* One catalogue per sport: my category key, what to call it, and every name a
 * platform might use for it. Synonyms are matched longest-first so that
 * "three point field goals made" cannot be swallowed by "field goals". */
const SYNC_CATS = {
  mlb: [
    { key: 'R',    side: 'batting',  label: 'Runs',            syn: ['runs scored', 'runs', 'run'] },
    { key: '1B',   side: 'batting',  label: 'Singles',         syn: ['singles', 'single'] },
    { key: '2B',   side: 'batting',  label: 'Doubles',         syn: ['doubles', 'double'] },
    { key: '3B',   side: 'batting',  label: 'Triples',         syn: ['triples', 'triple'] },
    { key: 'HR',   side: 'batting',  label: 'Home runs',       syn: ['home runs', 'home run', 'homerun', 'hr'] },
    { key: 'RBI',  side: 'batting',  label: 'RBI',             syn: ['runs batted in', 'rbi'] },
    { key: 'SB',   side: 'batting',  label: 'Stolen bases',    syn: ['stolen bases', 'stolen base', 'sb'] },
    { key: 'BB',   side: 'batting',  label: 'Walks',           syn: ['bases on balls', 'base on balls', 'walks', 'walk', 'bb'] },
    { key: 'IBB',  side: 'batting',  label: 'Intentional walks', syn: ['intentional walks', 'intentional walk', 'ibb'] },
    { key: 'HBP',  side: 'batting',  label: 'Hit by pitch',    syn: ['hit by pitch', 'hbp'] },
    { key: 'IP',   side: 'pitching', label: 'Innings pitched', syn: ['innings pitched', 'innings', 'ip'] },
    { key: 'W',    side: 'pitching', label: 'Wins',            syn: ['wins', 'win'] },
    { key: 'L',    side: 'pitching', label: 'Losses',          syn: ['losses', 'loss'] },
    { key: 'CG',   side: 'pitching', label: 'Complete games',  syn: ['complete games', 'complete game', 'cg'] },
    { key: 'SHO',  side: 'pitching', label: 'Shutouts',        syn: ['shutouts', 'shutout', 'sho'] },
    { key: 'SV',   side: 'pitching', label: 'Saves',           syn: ['saves', 'save', 'sv'] },
    { key: 'HLD',  side: 'pitching', label: 'Holds',           syn: ['holds', 'hold', 'hld'] },
    { key: 'BS',   side: 'pitching', label: 'Blown saves',     syn: ['blown saves', 'blown save', 'bs'] },
    { key: 'QS',   side: 'pitching', label: 'Quality starts',  syn: ['quality starts', 'quality start', 'qs'] },
    { key: 'ER',   side: 'pitching', label: 'Earned runs',     syn: ['earned runs allowed', 'earned runs', 'earned run', 'er'] },
    { key: 'K',    side: 'pitching', label: 'Strikeouts',      syn: ['strikeouts pitched', 'strikeouts', 'strikeout', 'so', 'k'] },
  ],
  nfl: [
    { key: 'PassYd',  label: 'Passing yards',    syn: ['passing yards', 'pass yards', 'pass yds', 'passing yds'] },
    { key: 'PassTD',  label: 'Passing TDs',      syn: ['passing touchdowns', 'passing touchdown', 'passing td', 'pass td'] },
    { key: 'Int',     label: 'Interceptions',    syn: ['interceptions thrown', 'interception thrown', 'interceptions', 'interception'] },
    { key: 'Pass2PT', label: 'Passing 2-pt',     syn: ['2 point conversion passes', 'two point conversion pass', 'passing 2pt', 'pass 2pt'] },
    { key: 'RushYd',  label: 'Rushing yards',    syn: ['rushing yards', 'rush yards', 'rush yds', 'rushing yds'] },
    { key: 'RushTD',  label: 'Rushing TDs',      syn: ['rushing touchdowns', 'rushing touchdown', 'rushing td', 'rush td'] },
    { key: 'Rush2PT', label: 'Rushing 2-pt',     syn: ['2 point conversion runs', 'two point conversion run', 'rushing 2pt', 'rush 2pt'] },
    { key: 'Rec',     label: 'Receptions',       syn: ['receptions', 'reception', 'each reception', 'catches', 'ppr'] },
    { key: 'RecYd',   label: 'Receiving yards',  syn: ['receiving yards', 'rec yards', 'rec yds', 'receiving yds'] },
    { key: 'RecTD',   label: 'Receiving TDs',    syn: ['receiving touchdowns', 'receiving touchdown', 'receiving td', 'rec td'] },
    { key: 'Rec2PT',  label: 'Receiving 2-pt',   syn: ['2 point conversion receptions', 'receiving 2pt', 'rec 2pt'] },
    { key: 'FumLost', label: 'Fumbles lost',     syn: ['fumbles lost', 'fumble lost', 'lost fumble'] },
    { key: 'RetTD',   label: 'Return TDs',       syn: ['kickoff return touchdowns', 'punt return touchdowns', 'return touchdowns', 'return td'] },
  ],
  nba: [
    { key: 'PTS',  label: 'Points',        syn: ['points scored', 'points', 'point', 'pts'] },
    { key: 'REB',  label: 'Rebounds',      syn: ['total rebounds', 'rebounds', 'rebound', 'reb'] },
    { key: 'AST',  label: 'Assists',       syn: ['assists', 'assist', 'ast'] },
    { key: 'STL',  label: 'Steals',        syn: ['steals', 'steal', 'stl'] },
    { key: 'BLK',  label: 'Blocks',        syn: ['blocked shots', 'blocks', 'block', 'blk'] },
    { key: 'TOV',  label: 'Turnovers',     syn: ['turnovers', 'turnover', 'to', 'tov'] },
    { key: 'FG3M', label: 'Three-pointers', syn: ['three point field goals made', '3 point shots made', 'three pointers made', 'three pointers', '3 pointers made', '3pm', 'threes made'] },
    { key: 'FGM',  label: 'Field goals made', syn: ['field goals made', 'field goal made', 'fgm'] },
    { key: 'FGA',  label: 'Field goals attempted', syn: ['field goals attempted', 'field goal attempted', 'fga'] },
    { key: 'FTM',  label: 'Free throws made', syn: ['free throws made', 'free throw made', 'ftm'] },
    { key: 'FTA',  label: 'Free throws attempted', syn: ['free throws attempted', 'free throw attempted', 'fta'] },
  ],
};

const catsFor = (sportId) => SYNC_CATS[sportId] || [];
const catByKey = (sportId, key) => catsFor(sportId).find((c) => c.key === key);

/* Sleeper names its categories in its own shorthand. Documented and stable. */
const SLEEPER_KEYS = {
  nfl: {
    pass_yd: 'PassYd', pass_td: 'PassTD', pass_int: 'Int', pass_2pt: 'Pass2PT',
    rush_yd: 'RushYd', rush_td: 'RushTD', rush_2pt: 'Rush2PT',
    rec: 'Rec', rec_yd: 'RecYd', rec_td: 'RecTD', rec_2pt: 'Rec2PT',
    fum_lost: 'FumLost', st_td: 'RetTD', pr_td: 'RetTD', kr_td: 'RetTD',
  },
  nba: {
    pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
    to: 'TOV', tov: 'TOV', tpm: 'FG3M', fg3m: 'FG3M',
    fgm: 'FGM', fga: 'FGA', ftm: 'FTM', fta: 'FTA',
  },
  mlb: {
    r: 'R', s: '1B', d: '2B', t: '3B', hr: 'HR', rbi: 'RBI', sb: 'SB',
    bb: 'BB', hbp: 'HBP',
    ip: 'IP', w: 'W', l: 'L', cg: 'CG', sho: 'SHO', sv: 'SV', hld: 'HLD',
    bs: 'BS', qs: 'QS', er: 'ER', k: 'K',
  },
};

/* ESPN identifies categories by numeric stat id. These are the community-
 * documented ids their fantasy API has used for years. They are the one part
 * of this file most likely to need a correction against a real league, which
 * is why the preview shows you exactly what was read before anything is
 * applied. */
const ESPN_STAT_IDS = {
  nfl: {
    3: 'PassYd', 4: 'PassTD', 20: 'Int', 19: 'Pass2PT',
    24: 'RushYd', 25: 'RushTD', 26: 'Rush2PT',
    42: 'RecYd', 43: 'RecTD', 44: 'Rec2PT', 53: 'Rec',
    72: 'FumLost', 101: 'RetTD', 102: 'RetTD',
  },
  nba: {
    0: 'PTS', 1: 'BLK', 2: 'STL', 3: 'AST', 6: 'REB',
    11: 'TOV', 13: 'FGM', 14: 'FGA', 15: 'FTM', 16: 'FTA', 17: 'FG3M',
  },
  mlb: {
    20: 'R', 1: '1B', 2: '2B', 3: '3B', 4: 'HR', 21: 'RBI', 23: 'SB',
    10: 'BB', 16: 'HBP',
    34: 'IP', 53: 'W', 54: 'L', 57: 'SV', 47: 'ER', 48: 'K', 63: 'HLD',
  },
};

const ESPN_GAME = { nfl: 'ffl', nba: 'fba', mlb: 'flb' };

/* Yahoo also uses numeric stat ids, per game. */
const YAHOO_STAT_IDS = {
  nfl: { 4: 'PassYd', 5: 'PassTD', 6: 'Int', 9: 'RushYd', 10: 'RushTD',
         11: 'Rec', 12: 'RecYd', 13: 'RecTD', 18: 'FumLost',
         15: 'RetTD', 16: 'RetTD', 19: 'Pass2PT', 20: 'Rush2PT', 21: 'Rec2PT' },
  nba: { 12: 'PTS', 15: 'REB', 16: 'AST', 17: 'STL', 18: 'BLK', 19: 'TOV',
         10: 'FG3M', 4: 'FGM', 3: 'FGA', 7: 'FTM', 6: 'FTA' },
  mlb: { 7: 'R', 8: '1B', 9: '2B', 10: '3B', 12: 'HR', 13: 'RBI', 16: 'SB',
         18: 'BB', 20: 'HBP', 50: 'IP', 28: 'W', 29: 'L', 32: 'SV',
         39: 'ER', 42: 'K', 48: 'HLD' },
};

const SYNC_PROVIDERS = [
  {
    id: 'sleeper', name: 'Sleeper', sports: ['nfl', 'nba', 'mlb'],
    reach: 'open',
    blurb: 'Public API, no key, no sign-in. Your browser calls it directly.',
    idLabel: 'League ID',
    idHint: 'Open your league on sleeper.com. The long number in the address ' +
            'bar after /leagues/ is the ID.',
    idExample: '992819272847511552',
    idPattern: /^\d{6,25}$/,
    url: (id) => `https://api.sleeper.app/v1/league/${encodeURIComponent(id)}`,
    parse: (json, sportId) => {
      const map = SLEEPER_KEYS[sportId] || {};
      const scoring = {};
      const unmapped = [];
      for (const [k, v] of Object.entries(json.scoring_settings || {})) {
        if (typeof v !== 'number') continue;
        const mine = map[k.toLowerCase()];
        if (mine) scoring[mine] = (scoring[mine] || 0) + v;
        else if (v !== 0) unmapped.push([k, v]);
      }
      return {
        leagueName: json.name || null,
        teams: json.total_rosters || null,
        roster: (json.roster_positions || []).filter((p) => p !== 'BN'),
        scoring, unmapped,
      };
    },
  },
  {
    id: 'espn', name: 'ESPN', sports: ['nfl', 'nba', 'mlb'],
    reach: 'public-only',
    blurb: 'Works now for public leagues. A private league needs your ESPN ' +
           'session cookies, which needs a server to hold them safely.',
    idLabel: 'League ID',
    idHint: 'On fantasy.espn.com, the leagueId in the address bar. If your ' +
            'league is set to private this will fail — paste instead.',
    idExample: '1234567',
    idPattern: /^\d{3,12}$/,
    url: (id, season, sportId) =>
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${ESPN_GAME[sportId]}` +
      `/seasons/${season}/segments/0/leagues/${encodeURIComponent(id)}?view=mSettings`,
    parse: (json, sportId) => {
      const ids = ESPN_STAT_IDS[sportId] || {};
      const s = json.settings || {};
      const items = (s.scoringSettings || {}).scoringItems || [];
      const scoring = {};
      const unmapped = [];
      for (const it of items) {
        const v = Number(it.points);
        if (!Number.isFinite(v) || v === 0) continue;
        const mine = ids[it.statId];
        if (mine) scoring[mine] = (scoring[mine] || 0) + v;
        else unmapped.push([`stat ${it.statId}`, v]);
      }
      const slots = (s.rosterSettings || {}).lineupSlotCounts || {};
      const roster = Object.entries(slots)
        .filter(([, n]) => n > 0)
        .map(([slot, n]) => `${slot}×${n}`);
      return {
        leagueName: s.name || null,
        teams: s.size || null,
        roster, scoring, unmapped,
      };
    },
  },
  {
    id: 'yahoo', name: 'Yahoo', sports: ['nfl', 'nba', 'mlb'],
    reach: 'oauth',
    blurb: 'A real, supported, documented API — behind OAuth 2.0. The sign-in ' +
           'secret cannot live in a web page, so this one needs a server.',
    idLabel: 'League key',
    idHint: 'Yahoo identifies a league as game.l.id, for example nfl.l.123456. ' +
            'Until the server exists, paste your settings instead.',
    idExample: 'nfl.l.123456',
    idPattern: /^[a-z]+\.l\.\d+$/i,
    url: (id) =>
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(id)}` +
      '/settings?format=json',
    parse: (json, sportId) => {
      const ids = YAHOO_STAT_IDS[sportId] || {};
      const scoring = {};
      const unmapped = [];
      // Yahoo's JSON is a numerically-keyed tree; walk it for stat modifiers
      // rather than assuming a fixed depth, because the depth moves.
      const mods = [];
      (function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > 12) return;
        if (node.stat_id !== undefined && node.value !== undefined) mods.push(node);
        for (const v of Object.values(node)) walk(v, depth + 1);
      })(json, 0);
      for (const m of mods) {
        const v = Number(m.value);
        if (!Number.isFinite(v) || v === 0) continue;
        const mine = ids[Number(m.stat_id)];
        if (mine) scoring[mine] = (scoring[mine] || 0) + v;
        else unmapped.push([`stat ${m.stat_id}`, v]);
      }
      return { leagueName: null, teams: null, roster: [], scoring, unmapped };
    },
  },
  {
    id: 'paste', name: 'Any other platform', sports: ['nfl', 'nba', 'mlb'],
    reach: 'paste',
    blurb: 'CBS, NFL.com, Fantrax, ottoneu, or a league constitution in a ' +
           'document. Copy your scoring settings page and paste it in. No ' +
           'network, no account, nothing to break.',
  },
];

const REACH_META = {
  open:          ['WORKS NOW', 'Public API — your browser can call it directly'],
  'public-only': ['PUBLIC LEAGUES', 'Reachable for public leagues; private needs a server'],
  oauth:         ['NEEDS A SERVER', 'Official API, but OAuth secrets cannot live in a web page'],
  paste:         ['ALWAYS WORKS', 'No network involved'],
};

/** Read a pasted scoring page. Tolerant on purpose: platforms format these
 *  wildly differently, and a parser that only understands one of them is a
 *  parser for one platform. */
/* Categories a platform scores as one thing that this site stores as several.
 * Yahoo baseball leagues very often score "Hits" rather than listing singles,
 * doubles and triples separately -- and a home run is also a hit, so the value
 * lands on all four. Total bases is the same idea weighted by base. These are
 * additive on top of any explicit category, which is exactly how the platforms
 * treat them: a league scoring Hits 1 and Home Runs 3 pays 4 for a homer. */
const SYNC_SPREAD = {
  mlb: [
    { syn: ['total bases', 'total base'], spread: { '1B': 1, '2B': 2, '3B': 3, HR: 4 } },
    { syn: ['hits', 'hit'], spread: { '1B': 1, '2B': 1, '3B': 1, HR: 1 } },
  ],
  nfl: [
    // Yahoo lists one combined two-point category; this site stores the three
    // ways a conversion can happen. One line in, three weights out.
    { syn: ['2 point conversions', '2 point conversion', 'two point conversions'],
      spread: { Pass2PT: 1, Rush2PT: 1, Rec2PT: 1 } },
  ],
  nba: [],
};

function parsePastedScoring(text, sportId) {
  const cats = catsFor(sportId);
  // Longest synonym first so "three point field goals made" is claimed before
  // "field goals" can take it, and "total bases" before "bases on balls".
  const lookup = [
    ...cats.flatMap((c) => c.syn.map((sy) => [sy, { key: c.key }])),
    ...(SYNC_SPREAD[sportId] || []).flatMap((d) => d.syn.map((sy) => [sy, { spread: d.spread }])),
  ].sort((a, b) => b[0].length - a[0].length);

  // Explicit categories take their first mention; spread categories accumulate.
  // Kept apart so "Hits 1" followed by "Home Runs 3" reaches 4 rather than
  // whichever one happened to be read first.
  const explicit = {};
  const spread = {};
  const unmapped = [];
  const lines = text.split(/[\n\r]+/).map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Two readings of the same line. Numbers come off `raw`, which still has
    // its signs; labels are matched against `flat`, where underscores and
    // dashes have become spaces so that "3-pointers" and "pass_yd" both read
    // as words. Flattening before reading the number turned "-2" into "2" and
    // imported an interception penalty as a bonus.
    const raw = line.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
    const flat = raw.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

    const hit = lookup.find(([sy]) =>
      new RegExp(`(^|[^a-z0-9])${sy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(flat));

    // Per-unit scoring arrives in two word orders and both mean the same thing:
    //   "1 point per 25 passing yards"           -> 0.04 a yard
    //   "Passing Yards (25 yards per point)  1"  -> 0.04 a yard
    // The second is Yahoo's house style. Missing it reads the weight as 25
    // instead of 0.04 and silently imports scoring that is wrong by a factor
    // of several hundred, which is worse than importing nothing.
    const PER_POINT = /\b(\d+(?:\.\d+)?)\s*(?:yards?|yds?|receptions?)?\s*per\s+point\b/;
    const PER_N = /\b(?:per|every|each)\s+(\d+(?:\.\d+)?)\b/;
    const perPoint = flat.match(PER_POINT);
    const perN = perPoint ? null : flat.match(PER_N);
    const divisor = Number((perPoint || perN || [])[1]) || 1;
    const rest = raw.replace(PER_POINT, ' ').replace(PER_N, ' ');
    let nums = rest.match(/-?\d+(?:\.\d+)?/g);

    // Platforms that lay their settings out as a table put the category on one
    // line and its value on the next. Look ahead one line for a bare number.
    if (hit && !nums) {
      const next = (lines[i + 1] || '').trim();
      if (/^-?\d+(?:\.\d+)?$/.test(next)) { nums = [next]; i++; }
    }
    if (!nums) continue;

    const value = Number(nums[nums.length - 1]) / divisor;
    if (!Number.isFinite(value)) continue;

    if (hit && hit[1].spread) {
      for (const [k, mult] of Object.entries(hit[1].spread)) {
        spread[k] = (spread[k] || 0) + value * mult;
      }
    } else if (hit) {
      // First mention wins: settings pages often repeat a category lower down
      // in a summary or a bonus table.
      if (explicit[hit[1].key] === undefined) explicit[hit[1].key] = value;
    } else if (/[a-z]/.test(flat) && value !== 0) {
      // A zero on a line nothing recognised is a category the league does not
      // score. Reporting it as "read but not used" is noise, not information.
      unmapped.push([line.slice(0, 60), value]);
    }
  }

  const scoring = {};
  for (const k of new Set([...Object.keys(explicit), ...Object.keys(spread)])) {
    scoring[k] = Number(((explicit[k] || 0) + (spread[k] || 0)).toFixed(6));
  }
  return { leagueName: null, teams: null, roster: [], scoring, unmapped };
}

/** Write a synced result into the same store the settings page writes to, so
 *  every board, player page and projection on the site recomputes from it. */
function applySyncedScoring(sportId, scoring) {
  const existing = customScoring() || {};
  if (sportId === 'mlb') {
    const batting = { ...(existing.batting || {}) };
    const pitching = { ...(existing.pitching || {}) };
    for (const [k, v] of Object.entries(scoring)) {
      const cat = catByKey('mlb', k);
      if (!cat) continue;
      (cat.side === 'pitching' ? pitching : batting)[k] = v;
    }
    saveScoring({ ...existing, batting, pitching });
  } else {
    saveScoring({ ...existing, [sportId]: { ...(existing[sportId] || {}), ...scoring } });
  }
}

function viewSync() {
  const s = sport();
  const sportId = s.id;
  const season = (state.meta?.seasons || [0, new Date().getFullYear()])[1];
  const ui = { provider: 'sleeper', result: null, error: null, busy: false };

  const body = el('div', {});
  const providerRow = el('div', { class: 'lead-chips' });

  const provider = () => SYNC_PROVIDERS.find((p) => p.id === ui.provider);

  // ---- the result preview, and the button that commits it ---------------
  const renderResult = () => {
    const r = ui.result;
    if (!r) return null;
    const cats = catsFor(sportId);
    const found = cats.filter((c) => r.scoring[c.key] !== undefined);
    const missing = cats.filter((c) => r.scoring[c.key] === undefined);

    if (!found.length) {
      return el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, el('h2', {}, 'Nothing recognised')),
        el('div', { class: 'empty-state' },
          el('h3', {}, 'No scoring categories were found'),
          el('div', {}, 'That usually means the page you pasted was a standings ' +
            'or roster page rather than the scoring settings. Paste the page ' +
            'that lists each category and what it is worth.')));
    }

    const current = sportId === 'mlb' ? activeScoring() : genWeights();
    const currentOf = (c) => (sportId === 'mlb'
      ? (current[c.side] || {})[c.key]
      : current[c.key]);

    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, r.leagueName ? `Read from “${r.leagueName}”` : 'What was read'),
        el('span', { class: 'hint' },
          `${found.length} of ${cats.length} categories recognised` +
          (r.teams ? ` · ${r.teams} teams` : ''))),
      statTable(found.map((c) => ({
        cat: c.label,
        was: currentOf(c),
        now: r.scoring[c.key],
        change: currentOf(c) === r.scoring[c.key] ? 'same' : 'changed',
      })), [
        { key: 'cat', label: 'Category', cls: 'txt' },
        { key: 'was', label: 'Currently', get: (x) => (x.was === undefined ? '—' : num(x.was, 2)) },
        { key: 'now', label: 'Your league', get: (x) => num(x.now, 2) },
        { key: 'change', label: '', cls: 'txt',
          get: (x) => el('span', { class: `plan-tag${x.change === 'changed' ? ' you' : ''}` },
            x.change === 'changed' ? 'changes' : 'same') },
      ], { sortKey: null }),
      missing.length ? el('div', { class: 'note', html:
        `<b>Not found, so left alone:</b> ${missing.map((c) => c.label).join(', ')}. ` +
        'Anything not read keeps its current value — nothing is silently zeroed.' }) : null,
      r.unmapped.length ? el('div', { class: 'note', html:
        `<b>Read but not used:</b> ${r.unmapped.slice(0, 14)
          .map(([k, v]) => `${k} (${v})`).join(', ')}` +
        (r.unmapped.length > 14 ? `, and ${r.unmapped.length - 14} more` : '') +
        '. These are categories this site does not carry — kickers, team ' +
        'defence, and per-game bonuses have no equivalent in a historical ' +
        'dataset, so they are shown rather than quietly dropped.' }) : null,
      r.roster.length ? el('div', { class: 'note', html:
        `<b>Roster read:</b> ${r.roster.join(', ')}. Roster slots are not used ` +
        'by the scoring engine yet — they are shown so you can see the sync ' +
        'found them.' }) : null,
      el('div', { class: 'sync-actions' },
        el('button', { class: 'btn primary', onclick: () => {
          applySyncedScoring(sportId, r.scoring);
          go(`#/${sportId}/career`);
        } }, `Use this scoring for ${s.league}`),
        el('a', { class: 'btn', href: '#/settings' }, 'Review it first')),
      watermark());
  };

  // ---- the input for whichever provider is selected ----------------------
  const renderInput = () => {
    const p = provider();
    const [pill, pillWhy] = REACH_META[p.reach];

    if (p.reach === 'paste' || p.reach === 'oauth') {
      const box = el('textarea', {
        rows: 10, class: 'sync-paste', spellcheck: 'false',
        placeholder: sportId === 'nfl'
          ? 'Passing Yards            0.04\nPassing TD               4\n' +
            'Interceptions           -2\nRushing Yards            0.1\n' +
            'Rushing TD               6\nReceptions               0.5\n' +
            'Receiving Yards          0.1\nReceiving TD             6\nFumbles Lost            -2'
          : sportId === 'nba'
            ? 'Points        1\nRebounds      1.2\nAssists       1.5\nSteals        3\n' +
              'Blocks        3\nTurnovers    -1\nThree Pointers Made  0.5'
            : 'Runs          1\nSingles       1\nDoubles       2\nHome Runs     3\n' +
              'RBI           1\nStolen Bases  2\nWalks         1\n' +
              'Innings Pitched 1\nWins          3\nStrikeouts    1\nEarned Runs  -1',
      });
      return el('div', {},
        p.reach === 'oauth' ? el('div', { class: 'note', html:
          '<b>Why this one needs a server.</b> Yahoo’s API is the best of the ' +
          'four — documented, supported, and it will not change under you. It ' +
          'uses OAuth 2.0, which means an app secret. A secret shipped to a ' +
          'browser is a secret published. Until there is a server to hold it, ' +
          'paste your settings below — the reader understands Yahoo’s own ' +
          'format, including “25 yards per point” and a single Hits or ' +
          '2-Point Conversions line that has to become several weights.' }) : null,
        p.id === 'yahoo' ? el('ol', { class: 'plan-steps sync-steps' },
          [['Open your league on Yahoo Fantasy',
            'Any browser, signed in as normal.'],
           ['Go to League → Settings',
            'On the league home page, the Settings link is under the League tab.'],
           ['Scroll to the scoring table',
            'It is titled “Fantasy Points” or “Stat Categories and Point Values”, ' +
            'depending on the sport.'],
           ['Select that table and copy it',
            'Click and drag across the whole table, then copy. Extra headings, ' +
            'section titles and stray text are ignored.'],
           ['Paste it below and press Read this',
            'Nothing changes until you have seen what was read and pressed apply.'],
          ].map(([head, detail]) => el('li', { class: 'plan-step' },
            el('div', { class: 'plan-step-head' }, el('b', {}, head)),
            el('p', {}, detail)))) : null,
        el('label', { class: 'sync-label' }, 'Paste your league’s scoring settings'),
        box,
        el('div', { class: 'sync-actions' },
          el('button', { class: 'btn primary', onclick: () => {
            ui.result = parsePastedScoring(box.value, sportId);
            ui.error = null;
            draw();
          } }, 'Read this'),
          el('span', { class: 'hint' },
            'Copy the whole scoring page — extra text is ignored.')));
    }

    const input = el('input', {
      type: 'text', class: 'sync-input', spellcheck: 'false',
      placeholder: p.idExample, 'aria-label': p.idLabel,
    });
    const status = el('div', { class: 'sync-status' });

    const run = async () => {
      const id = input.value.trim();
      if (!p.idPattern.test(id)) {
        swap(status, el('div', { class: 'note', html:
          `<b>That does not look like a ${p.name} ${p.idLabel.toLowerCase()}.</b> ` +
          `Expected something like <code>${p.idExample}</code>.` }));
        return;
      }
      swap(status, el('div', { class: 'boot-spinner' }));
      try {
        const res = await fetch(p.url(id, season, sportId));
        if (!res.ok) throw new Error(`${p.name} returned ${res.status}`);
        const json = await res.json();
        ui.result = p.parse(json, sportId);
        ui.error = null;
        draw();
      } catch (err) {
        // A failure here is nearly always one of four things, and saying which
        // is more useful than printing the exception.
        swap(status, el('div', { class: 'note', html:
          `<b>Could not read that league.</b> ${String(err.message || err)}<br><br>` +
          'Usually one of: the ID is wrong; the league is private; the ' +
          `platform is blocking the request from a web page; or this copy of ` +
          'the site is running from a file rather than a web address. ' +
          'The paste option below works regardless — pick ' +
          '<b>Any other platform</b> and paste your settings in.' }));
      }
    };

    return el('div', {},
      el('div', { class: 'sync-provider-note' },
        el('span', { class: `pill status-${p.reach === 'open' ? 'live' : 'partial'}`,
                     title: pillWhy }, pill),
        el('span', {}, p.blurb)),
      el('label', { class: 'sync-label' }, p.idLabel),
      el('div', { class: 'sync-row' },
        input,
        el('button', { class: 'btn primary', onclick: run }, `Sync from ${p.name}`)),
      el('div', { class: 'hint sync-hint' }, p.idHint),
      status);
  };

  const draw = () => {
    swap(providerRow, SYNC_PROVIDERS.map((p) => el('button', {
      type: 'button',
      class: `lead-chip${p.id === ui.provider ? ' on' : ''}`,
      'aria-pressed': String(p.id === ui.provider),
      onclick: () => { ui.provider = p.id; ui.result = null; draw(); },
    }, p.name)));

    swap(body,
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' },
          el('h2', {}, `Sync a ${s.league} league`),
          el('span', { class: 'hint' },
            'Bring your scoring in once — every page on this site recomputes from it')),
        el('div', { class: 'sync-body' },
          providerRow,
          renderInput()),
        watermark()),
      renderResult());
  };

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, 'Sync Your League'),
      el('p', {}, 'Point this at your league and it reads your scoring rules. ' +
        'Every leaderboard, player page and projection then recomputes under ' +
        'them — including seasons played eighty years before your league existed.')),
    body,
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Where each platform stands'),
        el('span', { class: 'hint' }, 'Stated plainly, because they differ a lot')),
      el('div', { class: 'health-list' },
        SYNC_PROVIDERS.map((p) => {
          const [pill, why] = REACH_META[p.reach];
          return el('div', { class: 'health-item' },
            el('div', { class: 'health-head' },
              el('span', { class: 'health-name' }, p.name),
              el('span', {
                class: `pill status-${p.reach === 'open' || p.reach === 'paste' ? 'live' : 'partial'}`,
                title: why,
              }, pill)),
            el('p', { class: 'health-what' }, p.blurb),
            el('div', { class: 'health-next' },
              el('b', {}, 'Covers: '),
              p.sports.map((id) => SPORTS[id].league).join(', ')));
        })),
      watermark()));

  draw();
}

// --------------------------------------------------------------- parked items
//
// Things a visitor should not see yet, and why. Each entry names what it is,
// what is unfinished about it, exactly what has to be true before it goes back
// in front of customers, and where the switch lives.
//
// The rule for this list: a stranger seeing it would either be misled or
// unimpressed. An unregistered company name in a copyright line is a claim
// that is not true yet. A personal name on a product page is a hobby signal. A
// pricing page for a product that charges nothing is a promise of a thing that
// does not exist. None of those are bugs, and all of them are reasons someone
// decides this is not a serious product.
//
// Nothing here is deleted. Every one is a flag in SITE, so any of them can be
// turned back on the moment the thing behind it is real.

const PARKED = [
  {
    what: 'Company name in the copyright line',
    was: `“© Kaliris Labs” on every page footer, and named as the owner of the ` +
         'scoring engine in the Terms.',
    why: 'Kaliris Labs is not a registered company. A copyright line naming an ' +
         'entity that does not exist is a claim you cannot support, and it is ' +
         'the first thing a lawyer reads. An individual is a perfectly valid ' +
         'copyright holder — no company is required to publish.',
    now: 'The footer credits the product name only. Privacy and Terms refer to ' +
         '“the operator of this site”.',
    unblock: 'Form the LLC in Massachusetts, then set SITE.legalEntity to the ' +
             'registered name. Roughly $500 and a week.',
    flag: 'SITE.legalEntity',
  },
  {
    what: 'Personal name in the watermark',
    was: '“Built by Bill Kaliris Jr” in the footer mark.',
    why: 'A personal byline reads as a portfolio piece rather than a product. ' +
         'It is also your real name on a page you are about to send to ' +
         'strangers, which is a decision worth making on purpose rather than ' +
         'by default.',
    now: 'The mark carries the product name only.',
    unblock: 'Nothing technical. Decide whether you want to be publicly ' +
             'attached to this before launch, and set SITE.showByline.',
    flag: 'SITE.showByline',
  },
  {
    what: 'The Dynasty (6x) 💍 footer line',
    was: '“Brought to you by The Dynasty (6x) 💍” under the wordmark on every page.',
    why: 'It means something to your league and nothing to anyone else. On a ' +
         'public product it reads as an inside joke a stranger is not in on, ' +
         'which is the opposite of the effect you want on a first visit.',
    now: 'Hidden. It is a good line for an About page story or a launch post — ' +
         'it just should not be site furniture.',
    unblock: 'Set SITE.showDynasty to true if you decide you want it anyway. ' +
             'It is your product and this is a taste call, not a rule.',
    flag: 'SITE.showDynasty',
  },
  {
    what: 'Plans / pricing page',
    was: 'A Free vs Pro comparison page with a tier switch, reachable from the ' +
         'footer.',
    why: 'Metering is switched off, so the page advertises limits that are not ' +
         'enforced and a Pro tier nobody can buy. Showing a price for a thing ' +
         'that cannot be purchased costs trust for no gain.',
    now: 'Removed from the footer. Still reachable at #/pricing so you can ' +
         'review the layout.',
    unblock: 'It comes back automatically when SITE.paywall is set to true — ' +
             'which should not happen before there is a backend that can ' +
             'actually enforce it and people who would pay.',
    flag: 'SITE.paywall',
  },
  {
    what: 'Trends (beta)',
    was: 'A Tools entry labelled “Waiver and hot/cold — in development”.',
    why: 'It is a page describing a feature rather than a feature. A visitor ' +
         'clicking a nav item and finding a promise learns that the nav cannot ' +
         'be trusted.',
    now: 'Moved out of the customer navigation into the Owner folder.',
    unblock: 'Needs a scheduled job collecting platform trend data. That means ' +
             'a backend — the same one everything else is waiting on.',
    flag: 'NAV (owner folder)',
  },
  {
    what: 'This Season / live stats',
    was: 'An Explore entry fetching current-season totals from the MLB Stats API.',
    why: 'Two problems at once. It exists for one league out of three, which ' +
         'breaks the promise that all three are equal, and it has never made a ' +
         'real request from the build environment because outbound calls to ' +
         'every sports API are blocked here. It is the least verified thing on ' +
         'the site.',
    now: 'Out of the customer navigation. Still at #/mlb/live for testing.',
    unblock: 'A current-season source for all three leagues, and one real ' +
             'successful request. See the live-data section of Build Plan & Costs.',
    flag: 'SITE.live.enabled',
  },
  {
    what: 'Ask (beta)',
    was: 'A footer link to a natural-language page separate from the assistant.',
    why: 'Duplicates the assistant, which works and is honest about its limits. ' +
         'Two doors to one half-built room.',
    now: 'Removed from the footer. The working assistant is Ask AI in Tools.',
    unblock: 'Fold anything worth keeping into the assistant, or delete the ' +
             'route. A language-model version needs a backend to hold the key.',
    flag: 'route #/ask',
  },
  {
    what: 'Blank social profiles',
    was: 'LinkedIn and Facebook fields in the contact block.',
    why: 'They were never filled in, so they render as nothing. Harmless, but ' +
         'they are on the list because Contact looks thinner than it should.',
    now: 'Twitter, Instagram and email render. The two blanks are simply absent.',
    unblock: 'Paste the full profile URLs into SITE.linkedin and SITE.facebook. ' +
             'A URL guessed from a display name lands on a stranger, so these ' +
             'have to be copied from the profiles themselves.',
    flag: 'SITE.linkedin / SITE.facebook',
  },
  {
    what: 'Which email address receives mail',
    was: 'bkaliris@gmail.com is in the config; every handle you gave is bkaliris10.',
    why: 'A contact address that is one character wrong is worse than no ' +
         'contact address — the sender thinks they reached you.',
    now: 'Still set to bkaliris@gmail.com. Unresolved, and the only item on ' +
         'this list that is a question rather than a decision.',
    unblock: 'Tell me which address is right and I will set it.',
    flag: 'SITE.contactEmail',
  },
];

function viewParked() {
  const live = PARKED.filter((x) => x.flag.startsWith('SITE.')).length;
  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, 'Parked for Review'),
      el('p', {}, 'Owner view. Things pulled out of the customer-facing site ' +
        'because they are not finished, with what each one needs before it ' +
        'goes back.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'At a glance')),
      el('div', { class: 'tiles' },
        tile('Parked', String(PARKED.length), 'items hidden from visitors', true),
        tile('One flag each', String(live), 'switchable in the SITE config'),
        tile('Waiting on you', '4', 'decisions nobody else can make'),
        tile('Waiting on a server', '3', 'the same backend, three times')),
      el('div', { class: 'note', html:
        '<b>Nothing here is deleted.</b> Every item is a flag rather than a ' +
        'removal, so any of them can be switched back on the moment the thing ' +
        'behind it is real. The test each one failed is the same: would a ' +
        'stranger seeing this be misled, or unimpressed?' }),
      watermark()),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', {}, 'Every parked item'),
        el('span', { class: 'hint' }, `${PARKED.length} items`)),
      el('div', { class: 'health-list' },
        PARKED.map((x) => el('div', { class: 'health-item' },
          el('div', { class: 'health-head' },
            el('span', { class: 'health-name' }, x.what),
            el('span', { class: 'pill status-planned', title: 'Hidden from visitors' }, 'PARKED')),
          el('p', { class: 'health-what' }, el('b', {}, 'Was: '), x.was),
          el('p', { class: 'health-what' }, el('b', {}, 'Why: '), x.why),
          el('p', { class: 'health-what' }, el('b', {}, 'Now: '), x.now),
          el('div', { class: 'health-next' }, el('b', {}, 'To bring it back: '), x.unblock),
          el('div', { class: 'plan-tags' },
            el('span', { class: 'plan-tag' }, x.flag))))),
      watermark()));
}

// ------------------------------------------------------------- build plan
//
// The owner's page that is not about the code: what to do next, in what order,
// what each step costs, and which decisions have to be made by a person rather
// than by a build script.
//
// Everything with a price in it is an estimate and is marked as such. Vendors
// change pricing; the numbers here are the right order of magnitude to plan
// with, not a quote. The one line that matters most -- a live stats licence --
// is the one with the widest range, and the reason is explained rather than
// averaged away.

/* Phased, in the order the work actually unblocks itself. `blocked` names the
   thing that has to exist first; `you` marks a decision only Bill can make. */
const PLAN = [
  {
    phase: 'Phase 1 — Put it somewhere real',
    why: 'Nothing else can be tested by anyone but you until the site has a URL. ' +
         'Everything in this phase is a day of work or less and costs almost nothing.',
    steps: [
      { do: 'Buy the domain', detail:
          'dynastyanalytics.com if it is free, otherwise a variant you are happy ' +
          'saying out loud. Buy the .com even if you launch on something else — ' +
          'it is cheap now and expensive later.',
        cost: '$10–20/yr', you: true },
      { do: 'Deploy the static site', detail:
          'Cloudflare Pages, Netlify or Vercel. Point them at the repo, they build ' +
          'on every push, and the whole site is files — no server to run. This is ' +
          'the same thing you are looking at now, on a real address with HTTPS.',
        cost: 'Free tier is enough' },
      { do: 'Decide public vs. private', detail:
          'The repo is private, which is why GitHub Pages would not serve it. ' +
          'Cloudflare/Netlify/Vercel serve private repos on their free tiers. ' +
          'Keep the repo private; the deployed site is what people see.',
        you: true },
      { do: 'Put a password on it while it is unfinished', detail:
          'Cloudflare Access or Netlify password protection puts one shared ' +
          'password in front of the whole site. That is how you show your dad and ' +
          'brother without it being findable.',
        cost: 'Free tier' },
      { do: 'Fill in the blanks in the SITE block', detail:
          'LinkedIn and Facebook URLs are still empty, and the contact email in ' +
          'the code is bkaliris@gmail.com while every handle you gave me is ' +
          'bkaliris10. Confirm which address should receive mail.',
        you: true },
    ],
  },
  {
    phase: 'Phase 2 — Make it worth coming back to',
    why: 'This is the churn phase. A tool people use once and abandon is a demo. ' +
         'The three things below are what turn a lookup site into something with ' +
         'a reason to return every week.',
    steps: [
      { do: 'Accounts, so settings survive', detail:
          'Right now your league scoring lives in one browser. Clear the cache and ' +
          'it is gone; open it on your phone and it never existed. Nobody sets up ' +
          'a 13-category scoring system twice. This is the single highest-value ' +
          'thing left to build.',
        cost: '$0 → ~$25/mo', blocked: 'Needs a backend' },
      { do: 'Finish league import', detail:
          'Built and live at Sync Your League: Sleeper reads directly from the ' +
          'browser, ESPN works for public leagues, and a paste-in reader covers ' +
          'every other platform with no network at all. What is left is Yahoo, ' +
          'which is OAuth and needs somewhere safe to keep a client secret, and ' +
          'private ESPN leagues, which need somewhere safe to keep a session ' +
          'cookie. Both are the same small server.',
        blocked: 'Yahoo + private ESPN need a backend' },
      { do: 'Save players and get told things', detail:
          'A watchlist, and a weekly email: "here is how your saved players did ' +
          'under your scoring". Email is what brings people back without an app.',
        cost: '$0 → ~$20/mo', blocked: 'Needs accounts' },
    ],
  },
  {
    phase: 'Phase 3 — Live and current-season data',
    why: 'The hard one, and the one with a real bill attached. Read the licensing ' +
         'panel below before committing to a vendor.',
    steps: [
      { do: 'Decide how current you actually need to be', detail:
          'Yesterday’s box scores and last night’s totals are a different ' +
          'product — and a different price — from live in-game scoring. Daily is ' +
          'enough for almost everything this site does. Say which one you are ' +
          'building before you shop for a feed.',
        you: true },
      { do: 'Pick a data source and read its terms', detail:
          'The historical data here is free and openly licensed. Current-season ' +
          'data is not. See the licensing panel.',
        cost: 'See below', you: true },
      { do: 'Add a nightly job that refreshes the season', detail:
          'A scheduled function that pulls yesterday’s games, rescores them, ' +
          'and writes new JSON. The site stays static and fast; only the data ' +
          'underneath moves.',
        cost: 'Free tier likely', blocked: 'Needs a data source' },
    ],
  },
  {
    phase: 'Phase 4 — Charge for it',
    why: 'Deliberately last. You cannot price something until people use it, and ' +
         'a paywall on a product nobody depends on just loses you the visit.',
    steps: [
      { do: 'Watch what people actually use', detail:
          'Add privacy-friendly analytics and find out which pages get returned to. ' +
          'Charge for the thing they come back for, not the thing you enjoyed ' +
          'building most.',
        cost: '~$9–19/mo' },
      { do: 'Turn metering back on', detail:
          'The plan machinery is still wired up — one flag in the config turns it ' +
          'on. It is off right now on purpose.',
        cost: 'Nothing to build' },
      { do: 'Take payments', detail:
          'Stripe. No monthly fee, they take a cut per transaction. Stripe Checkout ' +
          'means you never handle a card number.',
        cost: '~2.9% + $0.30/txn' },
    ],
  },
];

/* Priced separately from the plan because the question "what will this cost me
   a month" deserves a straight answer. `when` says whether the line starts on
   day one, only once people show up, or only if it works. */
const COSTS = [
  ['Domain name', 'day one', '$10–20 / year',
   'One .com. Renews annually.'],
  ['Static hosting', 'day one', '$0',
   'Cloudflare Pages, Netlify or Vercel free tiers all comfortably cover a site ' +
   'this size and this much traffic. You will not outgrow this soon.'],
  ['Password gate while private', 'day one', '$0',
   'Included in the same free tiers.'],
  ['Backend / serverless functions', 'when you add accounts', '$0–20 / month',
   'Free tiers are generous. A paid plan matters when you need more execution ' +
   'time or want the scheduled jobs to be reliable.'],
  ['Database', 'when you add accounts', '$0–25 / month',
   'Supabase, Neon or Turso. Free tiers hold thousands of users; the paid step ' +
   'is mostly about backups and not being paused when idle.'],
  ['Sign-in', 'when you add accounts', '$0–25 / month',
   'Clerk, Auth0 or Supabase Auth. All have free tiers into the thousands of ' +
   'monthly users. Do not build your own password handling.'],
  ['Transactional email', 'when you add accounts', '$0–20 / month',
   'Resend or Postmark. Free tiers cover a few thousand sends a month, which is ' +
   'plenty for password resets and a weekly digest.'],
  ['Analytics', 'when you want to price it', '$0–19 / month',
   'Plausible or Fathom. Cheap, no cookie banner, tells you what people use.'],
  ['Payments', 'when you charge', '~2.9% + $0.30 per transaction',
   'Stripe. No fixed monthly cost — they only earn when you do. Recurring ' +
   'billing adds a small percentage on top.'],
  ['Current-season sports data', 'phase 3', '$0 → $10,000+ / year',
   'The widest range on this list by far, and the one to research properly. ' +
   'See the licensing panel.'],
  ['An AI assistant that is a real model', 'optional', 'per-use, cents to dollars',
   'The assistant on this site today is rule-based and free to run. A language ' +
   'model would answer far more, but needs a backend to hold the API key and ' +
   'costs per question.'],
  ['Business formation', 'before you take money', '$50–800 one-off + annual',
   'An LLC in Massachusetts. Filing fee plus an annual report. A registered ' +
   'agent service is optional. Talk to an accountant before you take revenue.'],
  ['Trademark', 'only if it works', '$250–350 per class + legal',
   'Federal registration for the name. Not urgent; matters once there is ' +
   'something worth defending.'],
];

/* The single most expensive decision on the page, so it gets its own panel
   rather than a line in a table. */
const LIVE_DATA = [
  ['What you have now is free and clean',
   'Lahman/Chadwick for baseball, nflverse for football, and the hoopR/' +
   'sportsdataverse republication of NBA Stats for basketball. All openly ' +
   'published, all fine to use. They are historical — they stop at the end of a ' +
   'season and are updated by volunteers on their own schedule.'],
  ['The cheap tier of live data',
   'API-Sports, MySportsFeeds, balldontlie and similar sell current-season and ' +
   'in-game data in the tens of dollars a month. Coverage and reliability vary, ' +
   'and you must read whether their licence permits a commercial product rather ' +
   'than personal use. This is where to start, and it may be all you ever need.'],
  ['The expensive tier',
   'Sportradar, Stats Perform and SportsDataIO are the official and near-official ' +
   'feeds. Real-time, reliable, and priced for businesses — commonly thousands to ' +
   'tens of thousands a year, per sport. You do not need this to launch, and you ' +
   'should not sign one until customers are paying you.'],
  ['The one nobody admits to using',
   'The public MLB Stats endpoint and ESPN’s internal JSON are open in the ' +
   'sense that a browser can reach them. They are not licensed for you to build ' +
   'a commercial product on, they change without notice, and building on them is ' +
   'a business risk rather than a technical one. Fine for a prototype. Not a ' +
   'foundation.'],
  ['What the law actually protects',
   'Statistics are facts, and facts are not copyrightable. A US appeals court ' +
   'held in C.B.C. Distribution v. MLB Advanced Media (2007) that using players’ ' +
   'names and statistics for fantasy games is protected. What is not yours: team ' +
   'logos, club names as branding, player photographs, and anything you agreed ' +
   'to in a site’s terms of service when you took their data. Publishing ' +
   'numbers is one question; how you obtained them is a separate one.'],
];

/* Monetisation, written as mechanics rather than aspiration. */
const MONEY = [
  ['How the money actually moves',
   'Stripe Checkout hosts the payment page, so a card number never touches your ' +
   'site. Someone pays, Stripe sends your backend a webhook saying so, you flip a ' +
   'flag on their account, and the API starts returning the paid data. The ' +
   'important half is that last step: the paywall on this site today is in the ' +
   'browser, which decides what the interface offers — not what a determined ' +
   'person can reach. Real paid access means the data lives behind an endpoint ' +
   'that checks who is asking.'],
  ['What to charge for',
   'Gate depth and convenience, never the front door. Free should be genuinely ' +
   'useful: search anyone, see any career, set your scoring. Paid is the things ' +
   'that save a returning user time — saved leagues on every device, league ' +
   'import, exports, projections, the weekly email, more than two players ' +
   'compared at once.'],
  ['What to price it at',
   'Somewhere around $4–8 a month, or a season pass in the $25–40 range. The ' +
   'season pass is the better instinct for this product, and the reason is the ' +
   'next point.'],
  ['Churn is the whole problem in fantasy sports',
   'Fantasy is seasonal. A monthly subscription to a baseball tool gets cancelled ' +
   'in October by someone who was perfectly happy with it — that is not ' +
   'dissatisfaction, it is the calendar. Three things fight it: sell a season or ' +
   'a year rather than a month; carry all three sports so the quiet months for ' +
   'one are the loud months for another; and store something the user built — ' +
   'their scoring settings, their watchlist, their league — because leaving means ' +
   'abandoning it. This is the argument for doing Phase 2 before Phase 4.'],
  ['Ways to earn that are not subscriptions',
   'Display advertising pays poorly at small scale and makes the site worse — ' +
   'the slots exist in the code and are switched off. A one-off "draft kit" sold ' +
   'in the pre-season fits the seasonality better than a subscription. Affiliate ' +
   'links to sportsbooks pay well and carry regulatory and reputational baggage; ' +
   'that is a decision, not an integration.'],
];

/* Things that are neither code nor cost. */
const THINK = [
  ['Who is this for, precisely',
   'Right now it is for people in a points league who want to know how a player ' +
   'would score under their own rules. That is a real and underserved question. ' +
   'Say it in one sentence and let it decide what you build next.'],
  ['What makes it hard to copy',
   'Not the data — anyone can download Lahman. The moat is the scoring engine ' +
   'plus league import plus the fact that a returning user’s settings are ' +
   'already there. Three sports under one set of rules is a real differentiator; ' +
   'most tools do one.'],
  ['Say where the numbers came from',
   'You already do, on every page. Keep doing it. It is the difference between a ' +
   'site people trust with a draft and a site people check against another one.'],
  ['Terms, privacy and a business entity',
   'The pages exist and are generated from your config. They currently name ' +
   'Kaliris Labs, which is not yet a registered company. Form the LLC before you ' +
   'take a single payment, not after.'],
  ['Support is a real cost',
   'Once people pay, they email you. Decide now whether that is a support inbox ' +
   'you check on a schedule or your personal address, because it will not stay ' +
   'small if this works.'],
  ['These owner pages are not access-controlled',
   'System Health, Admin Console and this page are hidden from the navigation, ' +
   'not protected. Anyone who types the URL can read them. That is fine for a ' +
   'prototype and must change before launch — it is the same backend that fixes ' +
   'the paywall.'],
];

function viewRoadmap() {
  const done = HEALTH.filter(([, , st]) => st === 'live').length;
  const stepCount = PLAN.reduce((n, p) => n + p.steps.length, 0);
  const decisions = PLAN.reduce((n, p) => n + p.steps.filter((s) => s.you).length, 0);

  const planPanels = PLAN.map((p) => el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, p.phase),
      el('span', { class: 'hint' }, p.why)),
    el('ol', { class: 'plan-steps' },
      p.steps.map((st) => el('li', { class: `plan-step${st.you ? ' decision' : ''}` },
        el('div', { class: 'plan-step-head' },
          el('b', {}, st.do),
          st.cost ? el('span', { class: 'plan-cost' }, st.cost) : null),
        el('p', {}, st.detail),
        el('div', { class: 'plan-tags' },
          st.you ? el('span', { class: 'plan-tag you' }, 'Your call') : null,
          st.blocked ? el('span', { class: 'plan-tag blocked' }, st.blocked) : null)))),
    watermark()));

  const costPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'What you would pay for'),
      el('span', { class: 'hint' },
        'Estimates, not quotes — confirm current pricing before you commit')),
    statTable(COSTS.map(([item, when, cost, note]) => ({ item, when, cost, note })), [
      { key: 'item', label: 'Line item', cls: 'txt' },
      { key: 'when', label: 'Starts', cls: 'txt' },
      { key: 'cost', label: 'Estimate', cls: 'txt' },
      { key: 'note', label: 'What it buys', cls: 'txt' },
    ], { sortKey: null }),
    el('div', { class: 'note', html:
      '<b>The realistic number.</b> Phase 1 is about <b>$20 for the year</b> — a ' +
      'domain, on free hosting. Adding accounts and email takes it to roughly ' +
      '<b>$0–70 a month</b> depending on how much you lean on free tiers. Live ' +
      'data is the only line that can change the shape of the business, which is ' +
      'why it is worth deciding what "live" means to you before you shop.' }),
    watermark());

  const section = (title, hint, entries) => el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, title),
      el('span', { class: 'hint' }, hint)),
    el('div', { class: 'health-list' },
      entries.map(([head, body]) => el('div', { class: 'health-item' },
        el('div', { class: 'health-head' }, el('span', { class: 'health-name' }, head)),
        el('p', { class: 'health-what' }, body)))),
    watermark());

  swap(app(),
    el('div', { class: 'view-head' },
      el('h1', {}, 'Build Plan & Costs'),
      el('p', {}, 'Owner view. What to do next, in order, with what each step ' +
        'costs and which calls only you can make.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Where this stands')),
      el('div', { class: 'tiles' },
        tile('Surfaces live', String(done), `of ${HEALTH.length} built and running`, true),
        tile('Steps to launch', String(stepCount), 'across four phases'),
        tile('Your decisions', String(decisions), 'nobody else can make these'),
        tile('Day-one cost', '~$20', 'a domain, on free hosting')),
      el('div', { class: 'note', html:
        '<b>Read this first.</b> The product is further along than the business. ' +
        'Every league’s data is loaded and accurate, the scoring engine works, ' +
        'and the site runs on a phone. What does not exist is anything that ' +
        'remembers a person: no accounts, no saved leagues, no server. Almost ' +
        'everything left — real paid access, live stats, the weekly email, an AI ' +
        'that is a real model — is blocked on that same missing piece, and it is ' +
        'one small backend rather than four separate projects.' }),
      watermark()),

    ...planPanels,
    costPanel,
    section('Live stats: what it takes and what it costs',
      'The decision with the widest price range on this page', LIVE_DATA),
    section('Monetisation, mechanically',
      'How the money moves, what to gate, and the churn problem', MONEY),
    section('Things to think about',
      'Not code, and not optional', THINK),

    el('div', { class: 'note', html:
      `<b>Last reviewed.</b> Written against the build dated ` +
      `${state.meta?.built || 'today'}. Vendor pricing moves; treat every figure ` +
      'here as an order of magnitude to plan with, and confirm before you sign ' +
      'anything. Nothing on this page is legal or financial advice.' }));
}

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
    return swap(app(),
      el('div', { class: 'view-head' },
        el('h1', {}, 'Admin Console'),
        el('p', {}, 'The owner’s view: plan override, feature flags, league ' +
          'status and dataset facts. Customers never see this page.')),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' },
          el('h2', {}, 'Sign in'),
          el('span', { class: 'hint' }, 'Passphrase set in SITE.admin')),
        el('div', { class: 'admin-gate' },
          input,
          el('button', { class: 'btn primary', onclick: submit }, 'Enter'),
          msg),
        el('div', { class: 'note', html:
          '<b>Convenience, not security.</b> This gate runs in the browser like ' +
          'the rest of the site: it keeps the page out of a visitor’s way and ' +
          'protects nothing a determined person could not read from the source. ' +
          'Nothing sensitive belongs behind it.' })));
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

  swap(app(),
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
  swap(app(),
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
  swap(app(),
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
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, search] = raw.split('?');
  // #/mlb/career?sort=HR&group=pitching -- so a card, a share or a bookmark can
  // land on a board already sorted by the column the reader came for.
  state.query = Object.fromEntries(new URLSearchParams(search || ''));
  const parts = path.split('/');

  // Routes are #/<sport>/<view>/<arg>. A first segment that is not a known
  // sport means an older link from before the site had leagues. Those were
  // minted when this was a baseball-only site, so they still resolve to
  // baseball -- the default league changing must not silently repoint a link
  // somebody already shared.
  const hasSport = SPORTS[parts[0]] !== undefined;
  const [view, arg] = hasSport ? parts.slice(1) : parts;
  // Only the views that actually show a league's data fall back to baseball.
  // A bare #/home or #/about is not an old baseball link, it is a page that
  // belongs to whichever league you are already in -- and on a cold start that
  // is the default league, not the one this site happened to be built for.
  const LEGACY_VIEWS = ['player', 'career', 'season', 'year', 'live', 'compare', 'scoring'];
  const sportId = hasSport ? parts[0]
    : (LEGACY_VIEWS.includes(view) ? 'mlb' : state.sport);

  if (sportId !== state.sport || !state.meta) await applySport(sportId);

  markActiveNav(true);
  window.scrollTo({ top: 0 });

  // Data views need a dataset. Reference and account pages work everywhere.
  const generic = sport().generic === true;
  const dataViews = ['player', 'career', 'season', 'year', 'live', 'compare'];
  if (view === 'home') { await viewHome(); return; }
  if (generic && ['live'].includes(view)) {
    return swap(app(),
      el('div', { class: 'view-head' },
        el('h1', {}, `${sport().league} This Season`),
        el('p', {}, sport().tagline)),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, el('h2', {}, 'Baseball only, for now')),
        el('div', { class: 'empty-state' },
          el('h3', {}, `Live stats are not wired up for ${sport().league}`),
          el('div', {}, `${sport().league} data is a published season file, not a ` +
            'live feed. Historical seasons are complete and searchable.')),
        el('div', { class: 'empty-state' },
          el('div', {}, 'Try ', el('a', { href: `#/${sport().id}/career` }, `${sport().league} Career Leaders`), '.')),
        watermark()));
  }
  if (dataViews.includes(view || 'player') && !sportHasData()) {
    const labels = { player: 'Player Lookup', career: 'Career Leaders',
                     season: 'Season Leaders', year: 'Year Explorer',
                     live: 'This Season', compare: 'Compare' };
    return swap(app(),
      el('div', { class: 'view-head' },
        el('h1', {}, `${sport().league} ${labels[view || 'player']}`),
        el('p', {}, sport().tagline)),
      awaitingData(labels[view || 'player']));
  }

  try {
    switch (view) {
      case 'player':  await (generic ? viewGenericPlayer : viewPlayer)(arg); break;
      case 'career':  await (generic ? viewGenericBoard('career') : viewLeaders('career')); break;
      case 'season':  await (generic ? viewGenericBoard('season') : viewLeaders('season')); break;
      case 'year':    await (generic ? viewGenericYear(arg) : viewYear(arg)); break;
      case 'compare': await (generic ? viewGenericCompare : viewCompare)(arg); break;
      case 'scoring': generic ? viewGenericScoring() : viewScoring(); break;
      case 'live':    await viewLive(); break;
      case 'about':   await viewAbout(); break;
      case 'contact': viewContact(); break;
      case 'privacy': viewPrivacy(); break;
      case 'terms':   viewTerms(); break;
      case 'pricing': viewPricing(); break;
      case 'settings': viewSettings(); break;
      case 'sync':    viewSync(); break;
      case 'trends':  viewTrends(); break;
      case 'ask':     viewAsk(); break;
      case 'admin':   viewAdmin(); break;
      case 'health':  await viewHealth(); break;
      case 'roadmap': viewRoadmap(); break;
      case 'parked':  viewParked(); break;
      case 'home':    await viewHome(); break;
      case 'chat':    viewChat(); break;
      default:        await viewHome();
    }
  } catch (err) {
    console.error(err);
    swap(app(), el('div', { class: 'empty-state' },
      el('h3', {}, 'Something went wrong loading that view'),
      el('div', {}, String(err.message || err))));
  }
}

// --------------------------------------------------------------------- boot

async function boot() {
  initTheme();   // before any await, so the toggle works even if data fails
  try {
    await loadSportData(DEFAULT_SPORT);
    useSportData(DEFAULT_SPORT);

    buildSidebar();
    initDrawer();
    initSportSwitch();
    await applySport(state.sport);
    updateTierBadge();
    renderFooter();
    warnUnsetConfig();
    initSearch();
    window.addEventListener('hashchange', route);
    await route();
  } catch (err) {
    console.error(err);
    swap(app(), el('div', { class: 'empty-state' },
      el('h3', {}, 'Could not load the dataset'),
      el('div', { html:
        'If you opened this file directly from disk, the browser blocks local JSON reads. ' +
        'Serve the folder instead:<br><br><code style="font-family:var(--mono);background:#000;padding:6px 10px;border-radius:6px;display:inline-block">python3 -m http.server -d web 8000</code>' +
        `<br><br><span style="color:var(--grey)">${String(err.message || err)}</span>` })));
  }
}

boot();
