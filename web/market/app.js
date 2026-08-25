/* Kaliris Markets — a personal market terminal.
 *
 * No framework and no build step: this file, a stylesheet, and a folder of
 * static JSON written by the Python pipeline in market/. That constraint is
 * the point -- the whole thing is a directory of files a static host can serve,
 * which is why it costs nothing to run and cannot break at 3am.
 *
 * Layout of this file:
 *   1. config      site details, column and filter definitions
 *   2. state       what the user has chosen, and what persists across visits
 *   3. format      every number-to-string decision, in one place
 *   4. data        fetching and caching the JSON
 *   5. charts      candlesticks, sparklines, treemap -- all hand-rolled canvas
 *   6. views       one function per route
 *   7. shell       search, routing, boot
 *
 * On colour: up/down uses green/red because that is what this domain means by
 * up and down, but green/red is precisely the pair that deuteranopia cannot
 * separate. So every coloured number is also a signed number, and the palette
 * button in the header swaps to a blue/orange pair that does separate. Colour
 * is the fast channel here; it is never the only one.
 */
'use strict';

/* ============================================================ 1. config */

const SITE = {
  name: 'Kaliris Markets',
  owner: 'BK',
  /* The fantasy-baseball side of the house. Blank it to drop the link. */
  siblingName: 'Dynasty Sports Analytics',
  siblingUrl: '../',
};

const ROUTES = [
  { id: 'overview', label: 'Overview', path: '/' },
  { id: 'screener', label: 'Screener', path: '/screener' },
  { id: 'heatmap', label: 'Heatmap', path: '/heatmap' },
  { id: 'groups', label: 'Groups', path: '/groups' },
  { id: 'news', label: 'News', path: '/news' },
  { id: 'insider', label: 'Insider', path: '/insider' },
];

/* Every screener column the app knows about.
 *
 *   key    field on a screener row
 *   fmt    which formatter renders it
 *   sort   'desc' when a first click should sort high-to-low (true of every
 *          measure where "more" is the interesting end)
 *   help   the column header's tooltip; these are the definitions that stop a
 *          screener from being a wall of unexplained abbreviations
 */
const COLUMNS = [
  { key: 'symbol', label: 'Ticker', fmt: 'symbol', align: 'left', sticky: true, help: 'Exchange symbol' },
  { key: 'name', label: 'Company', fmt: 'name', align: 'left', help: 'Registered name' },
  { key: 'sector', label: 'Sector', fmt: 'text', align: 'left', help: 'Broad sector classification' },
  { key: 'industry', label: 'Industry', fmt: 'text', align: 'left', help: 'Narrower industry classification' },
  { key: 'country', label: 'Country', fmt: 'text', align: 'left', help: 'Country of domicile' },
  { key: 'market_cap', label: 'Mkt Cap', fmt: 'compact', sort: 'desc', help: 'Shares outstanding × price' },
  { key: 'price', label: 'Price', fmt: 'price', sort: 'desc', help: 'Last traded price' },
  { key: 'change', label: 'Change', fmt: 'pct', sort: 'desc', help: 'Move since the previous close' },
  { key: 'volume', label: 'Volume', fmt: 'compact', sort: 'desc', help: 'Shares traded this session' },
  { key: 'avg_volume', label: 'Avg Vol', fmt: 'compact', sort: 'desc', help: 'Average daily volume, 3 months' },
  { key: 'rel_volume', label: 'Rel Vol', fmt: 'ratio', sort: 'desc', help: 'Volume ÷ average volume. Above 1 means unusual activity' },
  { key: 'pe', label: 'P/E', fmt: 'ratio', help: 'Price ÷ trailing twelve-month earnings per share' },
  { key: 'forward_pe', label: 'Fwd P/E', fmt: 'ratio', help: 'Price ÷ forecast earnings per share' },
  { key: 'peg', label: 'PEG', fmt: 'ratio', help: 'P/E ÷ earnings growth rate. Below 1 is the classic screen' },
  { key: 'ps', label: 'P/S', fmt: 'ratio', help: 'Price ÷ sales per share' },
  { key: 'pb', label: 'P/B', fmt: 'ratio', help: 'Price ÷ book value per share' },
  { key: 'eps', label: 'EPS', fmt: 'price', sort: 'desc', help: 'Trailing twelve-month earnings per share' },
  { key: 'revenue', label: 'Revenue', fmt: 'compact', sort: 'desc', help: 'Trailing twelve-month revenue' },
  { key: 'revenue_growth', label: 'Sales Y/Y', fmt: 'pct', sort: 'desc', help: 'Revenue growth against the year-ago quarter' },
  { key: 'earnings_growth', label: 'EPS Y/Y', fmt: 'pct', sort: 'desc', help: 'Earnings growth against the year-ago quarter' },
  { key: 'dividend_yield', label: 'Div %', fmt: 'pct0', sort: 'desc', help: 'Annual dividend ÷ price' },
  { key: 'roe', label: 'ROE', fmt: 'pct0', sort: 'desc', help: 'Return on equity' },
  { key: 'roa', label: 'ROA', fmt: 'pct0', sort: 'desc', help: 'Return on assets' },
  { key: 'gross_margin', label: 'Gross M', fmt: 'pct0', sort: 'desc', help: 'Gross profit ÷ revenue' },
  { key: 'operating_margin', label: 'Oper M', fmt: 'pct0', sort: 'desc', help: 'Operating income ÷ revenue' },
  { key: 'profit_margin', label: 'Profit M', fmt: 'pct0', sort: 'desc', help: 'Net income ÷ revenue' },
  { key: 'debt_to_equity', label: 'Debt/Eq', fmt: 'ratio', help: 'Total debt ÷ shareholder equity' },
  { key: 'current_ratio', label: 'Cur R', fmt: 'ratio', sort: 'desc', help: 'Current assets ÷ current liabilities' },
  { key: 'beta', label: 'Beta', fmt: 'ratio', sort: 'desc', help: 'Sensitivity to the broad market. 1 moves with it' },
  { key: 'atr', label: 'ATR', fmt: 'price', sort: 'desc', help: 'Average true range, 14 days, in dollars' },
  { key: 'rsi', label: 'RSI', fmt: 'rsi', sort: 'desc', help: 'Relative strength index, 14 days. Under 30 oversold, over 70 overbought' },
  { key: 'volatility_w', label: 'Vol W', fmt: 'pct0', sort: 'desc', help: 'Mean absolute daily move over the last week' },
  { key: 'volatility_m', label: 'Vol M', fmt: 'pct0', sort: 'desc', help: 'Mean absolute daily move over the last month' },
  { key: 'from_sma20', label: 'SMA20', fmt: 'pct', sort: 'desc', help: 'Distance from the 20-day simple moving average' },
  { key: 'from_sma50', label: 'SMA50', fmt: 'pct', sort: 'desc', help: 'Distance from the 50-day simple moving average' },
  { key: 'from_sma200', label: 'SMA200', fmt: 'pct', sort: 'desc', help: 'Distance from the 200-day simple moving average' },
  { key: 'from_high_52w', label: '52W High', fmt: 'pct', sort: 'desc', help: 'Distance below the 52-week high' },
  { key: 'from_low_52w', label: '52W Low', fmt: 'pct', sort: 'desc', help: 'Distance above the 52-week low' },
  { key: 'perf_1w', label: 'Perf W', fmt: 'pct', sort: 'desc', help: 'Return over 5 sessions' },
  { key: 'perf_1m', label: 'Perf M', fmt: 'pct', sort: 'desc', help: 'Return over 21 sessions' },
  { key: 'perf_3m', label: 'Perf 3M', fmt: 'pct', sort: 'desc', help: 'Return over 63 sessions' },
  { key: 'perf_6m', label: 'Perf 6M', fmt: 'pct', sort: 'desc', help: 'Return over 126 sessions' },
  { key: 'ytd', label: 'YTD', fmt: 'pct', sort: 'desc', help: 'Return since the last close of the previous year' },
  { key: 'perf_1y', label: 'Perf Y', fmt: 'pct', sort: 'desc', help: 'Return over 252 sessions' },
  { key: 'short_percent_float', label: 'Short %', fmt: 'pct0', sort: 'desc', help: 'Shares sold short ÷ free float' },
  { key: 'short_ratio', label: 'Short R', fmt: 'ratio', sort: 'desc', help: 'Days of average volume needed to cover the short interest' },
  { key: 'insider_own', label: 'Insider %', fmt: 'pct0', sort: 'desc', help: 'Shares held by officers and directors' },
  { key: 'institution_own', label: 'Inst %', fmt: 'pct0', sort: 'desc', help: 'Shares held by institutions' },
  { key: 'analysts', label: 'Analysts', fmt: 'int', sort: 'desc', help: 'Number of covering analysts' },
  { key: 'target_upside', label: 'Target %', fmt: 'pct', sort: 'desc', help: 'Distance to the mean analyst price target' },
  { key: 'earnings_in', label: 'Earnings', fmt: 'earnings', sort: 'asc', help: 'Days until the next scheduled earnings report' },
];

const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map((column) => [column.key, column]));

/* The column presets, lifted straight from how a screener is actually used:
 * you are asking one kind of question at a time. */
const PRESETS = {
  overview: ['symbol', 'name', 'sector', 'industry', 'market_cap', 'pe', 'price', 'change', 'volume', 'rel_volume'],
  valuation: ['symbol', 'market_cap', 'pe', 'forward_pe', 'peg', 'ps', 'pb', 'eps', 'revenue_growth', 'earnings_growth', 'price', 'change'],
  financial: ['symbol', 'market_cap', 'dividend_yield', 'roa', 'roe', 'gross_margin', 'operating_margin', 'profit_margin', 'debt_to_equity', 'current_ratio', 'price', 'change'],
  technical: ['symbol', 'price', 'change', 'beta', 'atr', 'rsi', 'volatility_m', 'from_sma20', 'from_sma50', 'from_sma200', 'from_high_52w', 'from_low_52w', 'rel_volume'],
  performance: ['symbol', 'perf_1w', 'perf_1m', 'perf_3m', 'perf_6m', 'ytd', 'perf_1y', 'volatility_m', 'rel_volume', 'avg_volume', 'price', 'change'],
  ownership: ['symbol', 'name', 'market_cap', 'insider_own', 'institution_own', 'short_percent_float', 'short_ratio', 'analysts', 'target_upside', 'price', 'change'],
};

const PRESET_LABELS = {
  overview: 'Overview', valuation: 'Valuation', financial: 'Financial',
  technical: 'Technical', performance: 'Performance', ownership: 'Ownership', custom: 'Custom',
};

/* Filters are declarative so the toolbar, the URL and the predicate all read
 * from one definition. Adding a filter means adding one entry here. */
const FILTERS = [
  { id: 'sector', label: 'Sector', type: 'choice', field: 'sector' },
  { id: 'industry', label: 'Industry', type: 'choice', field: 'industry' },
  { id: 'exchange', label: 'Exchange', type: 'choice', field: 'exchange' },
  {
    id: 'cap', label: 'Market cap', type: 'range', field: 'market_cap',
    options: [
      ['mega', 'Mega ($200B+)', 200e9, null], ['large', 'Large ($10-200B)', 10e9, 200e9],
      ['mid', 'Mid ($2-10B)', 2e9, 10e9], ['small', 'Small ($300M-2B)', 300e6, 2e9],
      ['micro', 'Micro (under $300M)', null, 300e6],
    ],
  },
  {
    id: 'price', label: 'Price', type: 'range', field: 'price',
    options: [
      ['u10', 'Under $10', null, 10], ['10to50', '$10 to $50', 10, 50],
      ['50to200', '$50 to $200', 50, 200], ['o200', 'Over $200', 200, null],
    ],
  },
  {
    id: 'change', label: 'Change', type: 'range', field: 'change',
    options: [
      ['up', 'Up', 0.0001, null], ['up2', 'Up more than 2%', 2, null], ['up5', 'Up more than 5%', 5, null],
      ['down', 'Down', null, -0.0001], ['down2', 'Down more than 2%', null, -2], ['down5', 'Down more than 5%', null, -5],
    ],
  },
  {
    id: 'relvol', label: 'Rel volume', type: 'range', field: 'rel_volume',
    options: [['o1', 'Over 1', 1, null], ['o1_5', 'Over 1.5', 1.5, null], ['o2', 'Over 2', 2, null], ['u0_5', 'Under 0.5', null, 0.5]],
  },
  {
    id: 'pe', label: 'P/E', type: 'range', field: 'pe',
    options: [['profitable', 'Profitable (any P/E)', 0.0001, null], ['u15', 'Under 15', 0.0001, 15], ['u25', 'Under 25', 0.0001, 25], ['o40', 'Over 40', 40, null]],
  },
  {
    id: 'div', label: 'Dividend', type: 'range', field: 'dividend_yield',
    options: [['any', 'Pays a dividend', 0.0001, null], ['o2', 'Over 2%', 2, null], ['o4', 'Over 4%', 4, null]],
  },
  {
    id: 'rsi', label: 'RSI', type: 'range', field: 'rsi',
    options: [['oversold', 'Oversold (under 30)', null, 30], ['weak', 'Under 40', null, 40], ['strong', 'Over 60', 60, null], ['overbought', 'Overbought (over 70)', 70, null]],
  },
  {
    id: 'sma200', label: 'vs SMA200', type: 'range', field: 'from_sma200',
    options: [['above', 'Above', 0.0001, null], ['below', 'Below', null, -0.0001], ['above10', 'More than 10% above', 10, null]],
  },
  {
    id: 'perf', label: 'Perf year', type: 'range', field: 'perf_1y',
    options: [['up', 'Up on the year', 0.0001, null], ['up25', 'Up more than 25%', 25, null], ['down', 'Down on the year', null, -0.0001]],
  },
  {
    id: 'high52', label: '52W high', type: 'range', field: 'from_high_52w',
    options: [['near', 'Within 3% of the high', -3, null], ['near10', 'Within 10% of the high', -10, null], ['far', 'More than 25% below', null, -25]],
  },
];

const FILTER_BY_ID = Object.fromEntries(FILTERS.map((filter) => [filter.id, filter]));

const PAGE_SIZE = 60;
const STORE_KEY = 'kaliris.markets.v1';

/* ============================================================= 2. state */

/* Anything the user chose that should survive a reload lives in one object in
 * localStorage. Nothing here ever leaves the browser -- there is no account,
 * no sync and no server to send it to. */
const defaults = {
  theme: null,          // null = follow the operating system
  cvd: false,           // colourblind-safe palette
  watchlist: [],        // starred symbols
  screens: {},          // saved screener setups, by name
  customColumns: PRESETS.overview.slice(),
  lastPreset: 'overview',
  heatMetric: 'change',
  heatGroup: 'sector',
};

const store = {
  data: { ...defaults },

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.data = { ...defaults, ...JSON.parse(raw) };
    } catch (error) {
      // A locked-down browser, a private window, or corrupted JSON. Defaults
      // are a perfectly good answer; nothing here is worth an error message.
      console.debug('preferences unavailable', error);
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (error) {
      console.debug('preferences not saved', error);
    }
  },

  set(key, value) {
    this.data[key] = value;
    this.save();
  },

  toggleWatch(symbol) {
    const list = new Set(this.data.watchlist);
    if (list.has(symbol)) list.delete(symbol); else list.add(symbol);
    this.data.watchlist = [...list].sort();
    this.save();
    return list.has(symbol);
  },

  watching(symbol) {
    return this.data.watchlist.includes(symbol);
  },
};

/* Live application state: the dataset, and where the user currently is. */
const app = {
  meta: null,
  rows: [],
  rowBySymbol: new Map(),
  groups: null,
  news: [],
  insider: [],
  route: { view: 'overview', arg: '' },
  screen: null,       // the screener's current filter/sort/column state
};

/* ============================================================ 3. format */

const NBSP = ' ';

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A dash, not a zero. An unknown value and a zero value are different facts. */
function dash() {
  return '–';
}

function fmtNumber(value, digits = 2) {
  if (!isNum(value)) return dash();
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 1.24T / 87.3B / 412M / 88.1K — the only sane way to show a market cap. */
function fmtCompact(value, digits = 2) {
  if (!isNum(value)) return dash();
  const sign = value < 0 ? '-' : '';
  const size = Math.abs(value);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [scale, suffix] of units) {
    if (size >= scale) {
      const scaled = size / scale;
      return sign + scaled.toFixed(scaled >= 100 ? 0 : digits === 0 ? 0 : scaled >= 10 ? 1 : 2) + suffix;
    }
  }
  return sign + size.toFixed(0);
}

/** Prices need more decimals when they are small; 4-cent stocks exist. */
function fmtPrice(value) {
  if (!isNum(value)) return dash();
  const size = Math.abs(value);
  if (size >= 1000) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (size >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

/** Percentages always carry their sign: the number says the direction even
 *  when the colour cannot be seen. */
function fmtPct(value, digits = 2) {
  if (!isNum(value)) return dash();
  return (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(digits) + '%';
}

/** Unsigned percentage, for quantities that are not a change (margins, yields). */
function fmtPctPlain(value, digits = 2) {
  return isNum(value) ? value.toFixed(digits) + '%' : dash();
}

function fmtInt(value) {
  return isNum(value) ? Math.round(value).toLocaleString('en-US') : dash();
}

function fmtDate(epochSeconds) {
  if (!isNum(epochSeconds)) return dash();
  return new Date(epochSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(epochSeconds) {
  if (!isNum(epochSeconds)) return '';
  const seconds = Math.round(Date.now() / 1000 - epochSeconds);
  if (seconds < 90) return 'just now';
  const steps = [[60, 'min'], [3600, 'hr'], [86400, 'day'], [604800, 'wk']];
  let unit = 'min';
  let size = 60;
  for (const [scale, name] of steps) {
    if (seconds >= scale) { size = scale; unit = name; }
  }
  const count = Math.round(seconds / size);
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Sign class, used for both colour and the arrow glyph. */
function signClass(value) {
  if (!isNum(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

const FORMATTERS = {
  symbol: (value) => value,
  name: (value) => value || dash(),
  text: (value) => value || dash(),
  price: fmtPrice,
  compact: (value) => fmtCompact(value),
  int: fmtInt,
  ratio: (value) => (isNum(value) ? fmtNumber(value, 2) : dash()),
  pct: (value) => fmtPct(value),
  pct0: (value) => fmtPctPlain(value, 2),
  rsi: (value) => (isNum(value) ? value.toFixed(1) : dash()),
  earnings: (value) => {
    if (!isNum(value)) return dash();
    if (value === 0) return 'today';
    return value > 0 ? `in ${value}d` : `${Math.abs(value)}d ago`;
  },
};

/** Render one cell's text for a column definition. */
function cellText(column, row) {
  const formatter = FORMATTERS[column.fmt] || FORMATTERS.text;
  return formatter(row[column.key]);
}

/** Which columns get coloured. Only signed changes -- a P/E is not "good". */
const SIGNED_COLUMNS = new Set([
  'change', 'perf_1w', 'perf_1m', 'perf_3m', 'perf_6m', 'perf_1y', 'ytd',
  'from_sma20', 'from_sma50', 'from_sma200', 'from_high_52w', 'from_low_52w',
  'revenue_growth', 'earnings_growth', 'target_upside',
]);

/* ============================================================== 4. dom */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name === 'html') node.innerHTML = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else if (name === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function $(selector, scope = document) {
  return scope.querySelector(selector);
}

let toastTimer = null;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

/* ============================================================= 5. data */

const cache = new Map();

/** Fetch a JSON file once and remember it for the session. */
async function loadJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = fetch(path, { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  });
  cache.set(path, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(path);   // a failed fetch must not poison the next attempt
    throw error;
  }
}

/** The detail payload for one symbol: bars, profile, news, insider rows. */
function loadTicker(symbol) {
  return loadJSON(`data/tickers/${encodeURIComponent(symbol.replace(/\^/g, '_'))}.json`);
}

/** Columns the pipeline does not store because they depend on "now". */
function deriveRow(row) {
  if (isNum(row.target_price) && isNum(row.price) && row.price > 0) {
    row.target_upside = (row.target_price / row.price - 1) * 100;
  }
  if (isNum(row.earnings_date)) {
    row.earnings_in = Math.round((row.earnings_date * 1000 - Date.now()) / 86400000);
  }
  return row;
}

async function loadDataset() {
  const [meta, rows, groups] = await Promise.all([
    loadJSON('data/meta.json'),
    loadJSON('data/screener.json'),
    loadJSON('data/groups.json'),
  ]);
  app.meta = meta;
  app.rows = rows.map(deriveRow);
  app.rowBySymbol = new Map(app.rows.map((row) => [row.symbol, row]));
  app.groups = groups;

  // Headlines and filings are not needed to paint the first screen, so they
  // load behind it rather than holding it up.
  Promise.all([
    loadJSON('data/news.json').catch(() => []),
    loadJSON('data/insider.json').catch(() => []),
  ]).then(([news, insider]) => {
    app.news = news;
    app.insider = insider;
    if (['overview', 'news', 'insider'].includes(app.route.view)) render();
  });
}

/* ============================================================ 6. charts */

/** Read a CSS custom property so canvas drawing follows the active theme. */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Size a canvas for the device pixel ratio and return a ready 2d context. */
function prepareCanvas(canvas, cssWidth, cssHeight) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  return context;
}

/** Simple moving average as a series aligned to `values`, with leading nulls. */
function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let running = 0;
  for (let i = 0; i < values.length; i += 1) {
    running += values[i];
    if (i >= period) running -= values[i - period];
    if (i >= period - 1) out[i] = running / period;
  }
  return out;
}

/** Axis ticks that land on human numbers rather than wherever the range fell. */
function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const roughStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalised = roughStep / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 0.01; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The price chart: candles, a volume pane beneath, moving averages over the
 * top, and a crosshair that reads out the bar under the pointer.
 *
 * Drawn by hand on a canvas rather than pulled from a charting library,
 * because a library would be several hundred kilobytes to draw four shapes,
 * and this way the whole site stays a folder of static files.
 */
function drawPriceChart(container, bars, options = {}) {
  const { smas = [20, 50, 200], height = 380, showVolume = true } = options;
  const count = bars.c.length;
  if (!count) {
    container.append(el('div', { class: 'empty', text: 'No price history for this symbol.' }));
    return;
  }

  const canvas = el('canvas');
  const tooltip = el('div', { class: 'chart-tooltip', hidden: true });
  const legend = el('div', { class: 'chart-legend' });
  container.append(legend, canvas, tooltip);

  const averages = smas.map((period) => ({ period, values: smaSeries(bars.c, period) }));
  const smaColor = { 20: '--sma-20', 50: '--sma-50', 200: '--sma-200' };

  let hoverIndex = -1;
  let layout = null;

  function paint() {
    const width = container.clientWidth || 720;
    const context = prepareCanvas(canvas, width, height);

    const padding = { top: 10, right: 58, bottom: 22, left: 8 };
    const volumeHeight = showVolume ? Math.round(height * 0.2) : 0;
    const priceTop = padding.top;
    const priceBottom = height - padding.bottom - volumeHeight - (showVolume ? 8 : 0);
    const plotLeft = padding.left;
    const plotWidth = width - padding.left - padding.right;

    // Vertical range covers the candles and every average on screen, so a
    // 200-day line never runs off the top of its own chart.
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < count; i += 1) {
      low = Math.min(low, bars.l[i]);
      high = Math.max(high, bars.h[i]);
    }
    for (const average of averages) {
      for (const value of average.values) {
        if (value !== null) { low = Math.min(low, value); high = Math.max(high, value); }
      }
    }
    const span = (high - low) || high || 1;
    low -= span * 0.04;
    high += span * 0.04;

    const xOf = (index) => plotLeft + (plotWidth * (index + 0.5)) / count;
    const yOf = (price) => priceTop + ((high - price) / (high - low)) * (priceBottom - priceTop);

    const gridColor = token('--grid');
    const mutedColor = token('--text-muted');
    const upColor = token('--up');
    const downColor = token('--down');

    context.font = '10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    context.textBaseline = 'middle';

    // ---- horizontal grid and the price axis on the right
    context.strokeStyle = gridColor;
    context.fillStyle = mutedColor;
    context.lineWidth = 1;
    for (const tick of niceTicks(low, high, 6)) {
      const y = Math.round(yOf(tick)) + 0.5;
      if (y < priceTop || y > priceBottom) continue;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotLeft + plotWidth, y);
      context.stroke();
      context.textAlign = 'left';
      context.fillText(fmtPrice(tick), plotLeft + plotWidth + 6, y);
    }

    // ---- date axis: one label per month boundary, never one per bar
    context.textAlign = 'center';
    context.textBaseline = 'top';
    let lastMonth = -1;
    for (let i = 0; i < count; i += 1) {
      const date = new Date(bars.t[i] * 1000);
      const month = date.getUTCMonth();
      if (month === lastMonth) continue;
      lastMonth = month;
      const x = xOf(i);
      if (x < plotLeft + 14 || x > plotLeft + plotWidth - 14) continue;
      context.strokeStyle = gridColor;
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, priceTop);
      context.lineTo(Math.round(x) + 0.5, priceBottom);
      context.stroke();
      context.fillStyle = mutedColor;
      context.fillText(MONTHS[month] + (month === 0 ? ` ’${String(date.getUTCFullYear()).slice(2)}` : ''),
        x, height - padding.bottom + 4);
    }

    // ---- candles. Below ~2px a body is a smear, so wide series draw as a
    // line instead of pretending each bar is legible.
    const slot = plotWidth / count;
    const bodyWidth = Math.max(1, Math.min(9, slot * 0.68));
    if (slot < 2.4) {
      context.beginPath();
      for (let i = 0; i < count; i += 1) {
        const x = xOf(i);
        const y = yOf(bars.c[i]);
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = bars.c[count - 1] >= bars.c[0] ? upColor : downColor;
      context.lineWidth = 2;
      context.stroke();
    } else {
      for (let i = 0; i < count; i += 1) {
        const rising = bars.c[i] >= (i ? bars.c[i - 1] : bars.o[i]);
        const color = rising ? upColor : downColor;
        const x = Math.round(xOf(i)) + 0.5;
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, yOf(bars.h[i]));
        context.lineTo(x, yOf(bars.l[i]));
        context.stroke();
        const openY = yOf(bars.o[i]);
        const closeY = yOf(bars.c[i]);
        const top = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        context.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
      }
    }

    // ---- moving averages, 2px, over the candles
    for (const average of averages) {
      context.beginPath();
      let started = false;
      for (let i = 0; i < count; i += 1) {
        const value = average.values[i];
        if (value === null) { started = false; continue; }
        const x = xOf(i);
        const y = yOf(value);
        if (!started) { context.moveTo(x, y); started = true; } else { context.lineTo(x, y); }
      }
      context.strokeStyle = token(smaColor[average.period] || '--sma-20');
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.stroke();
    }

    // ---- volume pane
    if (showVolume && volumeHeight > 6) {
      const volumeTop = height - padding.bottom - volumeHeight;
      let peak = 0;
      for (const value of bars.v) peak = Math.max(peak, value);
      if (peak > 0) {
        for (let i = 0; i < count; i += 1) {
          const rising = bars.c[i] >= (i ? bars.c[i - 1] : bars.o[i]);
          context.fillStyle = rising ? upColor : downColor;
          context.globalAlpha = 0.42;
          const barHeight = (bars.v[i] / peak) * volumeHeight;
          context.fillRect(xOf(i) - bodyWidth / 2, volumeTop + volumeHeight - barHeight,
            Math.max(1, bodyWidth), barHeight);
        }
        context.globalAlpha = 1;
        context.fillStyle = mutedColor;
        context.textAlign = 'left';
        context.textBaseline = 'top';
        context.fillText(`Vol ${fmtCompact(peak)}`, plotLeft + plotWidth + 6, volumeTop);
      }
    }

    // ---- crosshair
    if (hoverIndex >= 0 && hoverIndex < count) {
      const x = Math.round(xOf(hoverIndex)) + 0.5;
      context.save();
      context.setLineDash([3, 3]);
      context.strokeStyle = token('--text-faint');
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, priceTop);
      context.lineTo(x, height - padding.bottom);
      context.stroke();
      context.restore();
    }

    layout = { plotLeft, plotWidth, count, priceTop, priceBottom, height };
    renderLegend();
  }

  function renderLegend() {
    const index = hoverIndex >= 0 ? hoverIndex : count - 1;
    clear(legend);
    legend.append(el('span', {}, [
      el('b', { text: fmtPrice(bars.c[index]) }),
      el('span', { class: 'dim', text: `${NBSP}${fmtDate(bars.t[index])}` }),
    ]));
    for (const average of averages) {
      const value = average.values[index];
      legend.append(el('span', {}, [
        el('i', { style: `background:${token(smaColor[average.period] || '--sma-20')}` }),
        `SMA${average.period} ${value === null ? dash() : fmtPrice(value)}`,
      ]));
    }
  }

  function showTooltip(event) {
    if (!layout) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const index = Math.round(((x - layout.plotLeft) / layout.plotWidth) * layout.count - 0.5);
    hoverIndex = Math.max(0, Math.min(count - 1, index));
    paint();

    const previous = hoverIndex ? bars.c[hoverIndex - 1] : bars.o[hoverIndex];
    const change = previous ? (bars.c[hoverIndex] / previous - 1) * 100 : null;
    clear(tooltip).append(el('dl', {}, [
      el('dt', { text: 'Date' }), el('dd', { text: fmtDate(bars.t[hoverIndex]) }),
      el('dt', { text: 'Open' }), el('dd', { text: fmtPrice(bars.o[hoverIndex]) }),
      el('dt', { text: 'High' }), el('dd', { text: fmtPrice(bars.h[hoverIndex]) }),
      el('dt', { text: 'Low' }), el('dd', { text: fmtPrice(bars.l[hoverIndex]) }),
      el('dt', { text: 'Close' }), el('dd', { text: fmtPrice(bars.c[hoverIndex]) }),
      el('dt', { text: 'Change' }), el('dd', { class: signClass(change), text: fmtPct(change) }),
      el('dt', { text: 'Volume' }), el('dd', { text: fmtCompact(bars.v[hoverIndex]) }),
    ]));
    tooltip.hidden = false;
    const width = tooltip.offsetWidth || 170;
    const flip = x > bounds.width - width - 24;
    tooltip.style.left = `${Math.max(4, flip ? x - width - 14 : x + 14)}px`;
    tooltip.style.top = `${Math.min(layout.height - 130, Math.max(4, event.clientY - bounds.top - 20))}px`;
  }

  function hideTooltip() {
    hoverIndex = -1;
    tooltip.hidden = true;
    paint();
  }

  canvas.addEventListener('mousemove', showTooltip);
  canvas.addEventListener('mouseleave', hideTooltip);
  canvas.addEventListener('touchstart', (event) => showTooltip(event.touches[0]), { passive: true });
  canvas.addEventListener('touchmove', (event) => showTooltip(event.touches[0]), { passive: true });
  canvas.addEventListener('touchend', hideTooltip);

  paint();
  observeResize(container, paint);
  return paint;
}

/** A small close-only line with an area wash, for hover previews and cards. */
function drawSparkline(canvas, closes, width, height) {
  if (!closes || closes.length < 2) return;
  const context = prepareCanvas(canvas, width, height);
  let low = Infinity;
  let high = -Infinity;
  for (const value of closes) { low = Math.min(low, value); high = Math.max(high, value); }
  const span = (high - low) || high || 1;
  const xOf = (i) => (width * i) / (closes.length - 1);
  const yOf = (v) => height - 3 - ((v - low) / span) * (height - 6);

  const rising = closes[closes.length - 1] >= closes[0];
  const color = rising ? token('--up') : token('--down');

  context.beginPath();
  context.moveTo(xOf(0), yOf(closes[0]));
  for (let i = 1; i < closes.length; i += 1) context.lineTo(xOf(i), yOf(closes[i]));

  const area = context.createLinearGradient(0, 0, 0, height);
  area.addColorStop(0, color);
  area.addColorStop(1, 'transparent');
  context.save();
  context.lineTo(xOf(closes.length - 1), height);
  context.lineTo(xOf(0), height);
  context.closePath();
  context.globalAlpha = 0.16;
  context.fillStyle = area;
  context.fill();
  context.restore();

  context.beginPath();
  context.moveTo(xOf(0), yOf(closes[0]));
  for (let i = 1; i < closes.length; i += 1) context.lineTo(xOf(i), yOf(closes[i]));
  context.strokeStyle = color;
  context.lineWidth = 1.6;
  context.lineJoin = 'round';
  context.stroke();
}

/* ---- heatmap ------------------------------------------------------------ */

/* Thresholds per metric, in percent. A day's 3% move and a year's 3% move are
 * not the same event, so each window gets its own scale. */
const HEAT_SCALE = {
  change: [0.25, 0.9, 2, 4],
  perf_1w: [0.5, 2, 4, 8],
  perf_1m: [1, 3, 7, 14],
  perf_3m: [2, 6, 12, 24],
  perf_6m: [3, 9, 18, 34],
  ytd: [3, 10, 20, 40],
  perf_1y: [4, 12, 25, 50],
};

/** Map a percent move onto one of the five steps of the diverging ramp. */
function heatColor(value, metric = 'change') {
  if (isHeatNeutral(value, metric)) return token('--heat-neutral');
  const bounds = HEAT_SCALE[metric] || HEAT_SCALE.change;
  const size = Math.abs(value);
  let step = 1;
  for (const bound of bounds) if (size >= bound) step += 1;
  return token(`--heat-${value >= 0 ? 'up' : 'dn'}-${step}`);
}

/** True when a tile lands on the ramp's neutral midpoint, which is close
 *  enough to the surface colour that white text on it is unreadable. */
function isHeatNeutral(value, metric = 'change') {
  if (!isNum(value)) return true;
  const bounds = HEAT_SCALE[metric] || HEAT_SCALE.change;
  return Math.abs(value) < bounds[0] * 0.35;
}

/**
 * Squarified treemap. Lays a list of weighted items into a rectangle keeping
 * each tile as close to square as it can, which is what makes areas
 * comparable at a glance -- long slivers are unreadable at any size.
 */
function squarify(items, x, y, width, height) {
  const out = [];
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0) || width <= 0 || height <= 0) return out;

  let queue = items.map((item) => ({ ...item, area: (item.weight / total) * width * height }));
  let box = { x, y, width, height };

  const worst = (row, side) => {
    const sum = row.reduce((acc, item) => acc + item.area, 0);
    const max = Math.max(...row.map((item) => item.area));
    const min = Math.min(...row.map((item) => item.area));
    const side2 = side * side;
    const sum2 = sum * sum;
    return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
  };

  while (queue.length) {
    const side = Math.min(box.width, box.height);
    const row = [queue[0]];
    let index = 1;
    while (index < queue.length && worst([...row, queue[index]], side) <= worst(row, side)) {
      row.push(queue[index]);
      index += 1;
    }
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    const thickness = rowArea / side;

    let offset = 0;
    for (const item of row) {
      const length = item.area / thickness;
      if (box.width >= box.height) {
        out.push({ ...item, x: box.x, y: box.y + offset, width: thickness, height: length });
      } else {
        out.push({ ...item, x: box.x + offset, y: box.y, width: length, height: thickness });
      }
      offset += length;
    }
    if (box.width >= box.height) {
      box = { x: box.x + thickness, y: box.y, width: box.width - thickness, height: box.height };
    } else {
      box = { x: box.x, y: box.y + thickness, width: box.width, height: box.height - thickness };
    }
    queue = queue.slice(index);
  }
  return out;
}

/** Re-run a paint callback when its container changes width. */
function observeResize(node, callback) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', callback);
    return;
  }
  let lastWidth = node.clientWidth;
  const observer = new ResizeObserver(() => {
    if (Math.abs(node.clientWidth - lastWidth) < 2) return;
    lastWidth = node.clientWidth;
    callback();
  });
  observer.observe(node);
}

/* ============================================================= 7. views */

/* ---- shared pieces ------------------------------------------------------ */

function watchButton(symbol) {
  const button = el('button', {
    class: 'star', type: 'button', 'aria-pressed': store.watching(symbol) ? 'true' : 'false',
    title: 'Add to my list', 'aria-label': `Toggle ${symbol} in my list`, text: '★',
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    const watching = store.toggleWatch(symbol);
    button.setAttribute('aria-pressed', watching ? 'true' : 'false');
    toast(watching ? `${symbol} added to My list` : `${symbol} removed from My list`);
  });
  return button;
}

function tickerLink(symbol, label) {
  return el('a', { href: `#/t/${encodeURIComponent(symbol)}`, class: 'sym', text: label || symbol,
    dataset: { hoverSymbol: symbol } });
}

/** One cell, with sign colouring where the column is a signed change. */
function buildCell(column, row) {
  const text = cellText(column, row);
  const attrs = { class: column.align === 'left' || column.fmt === 'name' || column.fmt === 'text' ? 'left' : '' };
  if (SIGNED_COLUMNS.has(column.key)) attrs.class += ` ${signClass(row[column.key])}`;
  if (column.fmt === 'name') attrs.class += ' name';
  if (column.fmt === 'text') attrs.class += ' dim';

  if (column.key === 'symbol') {
    return el('td', { class: 'left' }, [watchButton(row.symbol), ' ', tickerLink(row.symbol)]);
  }
  if (column.key === 'rsi' && isNum(row.rsi)) {
    const extreme = row.rsi >= 70 ? 'down' : row.rsi <= 30 ? 'up' : '';
    return el('td', { class: extreme }, [text]);
  }
  const cell = el('td', attrs, [text]);
  if (column.fmt === 'name' && row.name) cell.title = row.name;
  return cell;
}

/**
 * Build a sortable table. `sort` is the current {key, dir}; clicking a header
 * calls `onSort` with the next state -- first click uses the column's natural
 * direction (descending for measures, ascending for names), second reverses.
 */
function buildTable(columns, rows, { sort, onSort, caption } = {}) {
  const head = el('tr');
  for (const column of columns) {
    const active = sort && sort.key === column.key;
    const th = el('th', {
      class: column.align === 'left' ? 'left' : '',
      scope: 'col',
      title: column.help || column.label,
      'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      tabindex: onSort ? '0' : null,
      role: onSort ? 'button' : null,
    }, [column.label, active ? el('span', { class: 'arrow', text: sort.dir === 'asc' ? '▲' : '▼' }) : null]);
    if (onSort) {
      const activate = () => {
        const natural = column.sort || (column.fmt === 'symbol' || column.fmt === 'name' || column.fmt === 'text' ? 'asc' : 'desc');
        onSort(active ? { key: column.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: column.key, dir: natural });
      };
      th.addEventListener('click', activate);
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    }
    head.append(th);
  }

  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const column of columns) tr.append(buildCell(column, row));
    body.append(tr);
  }

  const table = el('table', { class: 'data' }, [
    caption ? el('caption', { text: caption }) : null,
    el('thead', {}, [head]),
    body,
  ]);
  return el('div', { class: 'table-wrap' }, [table]);
}

/** Sort a copy of `rows`. Missing values always sink, in both directions --
 *  an unknown P/E is not the cheapest stock on the board. */
function sortRows(rows, sort) {
  if (!sort || !sort.key) return rows;
  const direction = sort.dir === 'asc' ? 1 : -1;
  const column = COLUMN_BY_KEY[sort.key];
  const textual = column && ['symbol', 'name', 'text'].includes(column.fmt);
  return rows.slice().sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const leftMissing = left === null || left === undefined || (typeof left === 'number' && !Number.isFinite(left));
    const rightMissing = right === null || right === undefined || (typeof right === 'number' && !Number.isFinite(right));
    if (leftMissing && rightMissing) return a.symbol.localeCompare(b.symbol);
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    if (textual) return String(left).localeCompare(String(right)) * direction;
    return (left - right) * direction;
  });
}

/** Apply the screener's active filters to the universe. */
function filterRows(rows, screen) {
  const query = (screen.query || '').trim().toLowerCase();
  const watchlist = new Set(store.data.watchlist);

  return rows.filter((row) => {
    if (screen.watchOnly && !watchlist.has(row.symbol)) return false;
    if (query && !`${row.symbol} ${row.name || ''}`.toLowerCase().includes(query)) return false;

    for (const [id, value] of Object.entries(screen.filters || {})) {
      if (!value) continue;
      const filter = FILTER_BY_ID[id];
      if (!filter) continue;
      const field = row[filter.field];

      if (filter.type === 'choice') {
        if (field !== value) return false;
        continue;
      }
      const option = (filter.options || []).find((entry) => entry[0] === value);
      if (!option) continue;
      const [, , min, max] = option;
      if (!isNum(field)) return false;
      if (min !== null && field < min) return false;
      if (max !== null && field > max) return false;
    }
    return true;
  });
}

/** Distinct values for a choice filter, so the dropdowns match the dataset. */
function choicesFor(field) {
  const seen = new Set();
  for (const row of app.rows) if (row[field]) seen.add(row[field]);
  return [...seen].sort();
}

/* ---- tape and banner ---------------------------------------------------- */

function renderTape() {
  const tape = clear($('#ticker-tape'));
  const indices = (app.meta && app.meta.indices) || [];
  if (!indices.length) { tape.hidden = true; return; }
  tape.hidden = false;
  for (const index of indices) {
    tape.append(el('div', { class: 'tape-item' }, [
      el('span', { class: 'tape-name', text: index.name || index.symbol }),
      el('span', { class: 'tape-value', text: fmtPrice(index.price) }),
      el('span', { class: `tape-change ${signClass(index.change)}`, text: fmtPct(index.change) }),
    ]));
  }
}

function renderBanner() {
  const banner = $('#banner');
  if (app.meta && app.meta.source === 'demo') {
    banner.hidden = false;
    clear(banner).append(
      el('b', { text: 'Demo data. ' }),
      'Every company, fund, headline and filing below is invented and every price is a random walk. ',
      'Run the data pipeline (or let the scheduled job run) to replace this with live market data.',
    );
    return;
  }
  banner.hidden = true;
}

function renderFooterMeta() {
  const meta = app.meta || {};
  const parts = [`${meta.symbols || 0} symbols`];
  if (meta.generated_at) parts.push(`updated ${fmtRelative(meta.generated_at)}`);
  if (meta.source && meta.source !== 'demo') parts.push(`source: ${meta.source}`);
  if (meta.failed && meta.failed.length) parts.push(`${meta.failed.length} symbol(s) unavailable`);
  clear($('#footer-meta')).append(
    `${SITE.name} — ${parts.join(' · ')}. Built by ${SITE.owner}.`,
    SITE.siblingUrl ? el('span', {}, [' ', el('a', { href: SITE.siblingUrl, text: SITE.siblingName })]) : null,
  );
}

/* ---- overview ----------------------------------------------------------- */

function moverCard(title, rows, note) {
  const columns = ['symbol', 'price', 'change', 'rel_volume'].map((key) => COLUMN_BY_KEY[key]);
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: title }),
      note ? el('span', { class: 'card-note', text: note }) : null,
    ]),
    el('div', { class: 'card-body flush' }, [buildTable(columns, rows)]),
  ]);
}

function viewOverview(view) {
  const breadth = (app.meta && app.meta.breadth) || {};
  const priced = app.rows.filter((row) => isNum(row.change));
  const advancing = breadth.advancing || 0;
  const declining = breadth.declining || 0;
  const ratio = declining ? advancing / declining : advancing;

  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Market overview' }),
      el('p', { class: 'page-sub', text: `${app.rows.length} symbols tracked · ${app.meta && app.meta.generated_at ? `data ${fmtRelative(app.meta.generated_at)}` : 'no timestamp'}` }),
    ]),
  ]));

  view.append(el('div', { class: 'stats' }, [
    statTile('Advancing', String(advancing), `${declining} declining`),
    statTile('Advance / decline', ratio ? ratio.toFixed(2) : dash(), 'Above 1 is broad strength',
      ratio >= 1 ? 'up' : 'down'),
    statTile('Above SMA200', String(breadth.above_sma200 || 0),
      `${Math.round(((breadth.above_sma200 || 0) / Math.max(1, app.rows.length)) * 100)}% of the universe`),
    statTile('At 52-week highs', String(breadth.new_highs || 0), `${breadth.new_lows || 0} at lows`),
    statTile('My list', String(store.data.watchlist.length), 'Starred symbols'),
  ]));

  const byChange = sortRows(priced, { key: 'change', dir: 'desc' });
  const byVolume = sortRows(app.rows.filter((row) => isNum(row.rel_volume)), { key: 'rel_volume', dir: 'desc' });

  const left = el('div', { class: 'grid' }, [
    el('div', { class: 'grid grid-3' }, [
      moverCard('Top gainers', byChange.slice(0, 10)),
      moverCard('Top losers', byChange.slice(-10).reverse()),
      moverCard('Unusual volume', byVolume.slice(0, 10), 'vs 3-month average'),
    ]),
    heatmapCard({ compact: true }),
  ]);

  const watchlist = app.rows.filter((row) => store.watching(row.symbol));
  const right = el('div', { class: 'grid' }, [
    watchlist.length
      ? el('section', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: 'My list' })]),
          el('div', { class: 'card-body flush' }, [
            buildTable(['symbol', 'price', 'change'].map((key) => COLUMN_BY_KEY[key]),
              sortRows(watchlist, { key: 'change', dir: 'desc' })),
          ]),
        ])
      : el('section', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: 'My list' })]),
          el('div', { class: 'card-body' }, [
            el('p', { class: 'prose', text: 'Star any ticker to pin it here. Your list stays in this browser — there is no account and nothing is sent anywhere.' }),
          ]),
        ]),
    newsCard(app.news.slice(0, 14), 'Latest headlines'),
  ]);

  view.append(el('div', { class: 'grid grid-main', style: 'margin-top:14px' }, [left, right]));
}

function statTile(label, value, sub, tone) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: `stat-value ${tone || ''}`, text: value }),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null,
  ]);
}

function newsCard(items, title) {
  const list = el('ul', { class: 'news-list' });
  if (!items.length) {
    list.append(el('li', { class: 'empty', text: 'No headlines in this dataset yet.' }));
  }
  for (const item of items) {
    list.append(el('li', { class: 'news-item' }, [
      el('div', { class: 'news-title' }, [
        item.link
          ? el('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', text: item.title })
          : item.title,
      ]),
      el('div', { class: 'news-meta' }, [
        el('span', { text: item.source || 'Wire' }),
        el('span', { text: fmtRelative(item.published) }),
        ...(item.symbols || []).slice(0, 5).map((symbol) =>
          el('a', { class: 'news-tag', href: `#/t/${encodeURIComponent(symbol)}`, text: symbol })),
      ]),
    ]));
  }
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: title })]),
    el('div', { class: 'card-body flush' }, [list]),
  ]);
}

/* ---- screener ----------------------------------------------------------- */

function defaultScreen() {
  return {
    preset: store.data.lastPreset || 'overview',
    columns: null,               // null = use the preset's columns
    filters: {},
    sort: { key: 'market_cap', dir: 'desc' },
    query: '',
    watchOnly: false,
    page: 0,
  };
}

function screenColumns(screen) {
  const keys = screen.preset === 'custom'
    ? store.data.customColumns
    : PRESETS[screen.preset] || PRESETS.overview;
  return keys.map((key) => COLUMN_BY_KEY[key]).filter(Boolean);
}

/** Serialise the screen into the hash so a setup can be bookmarked or shared. */
function screenToQuery(screen) {
  const params = new URLSearchParams();
  if (screen.preset !== 'overview') params.set('view', screen.preset);
  if (screen.query) params.set('q', screen.query);
  if (screen.watchOnly) params.set('mine', '1');
  if (screen.sort && screen.sort.key) params.set('sort', (screen.sort.dir === 'asc' ? '' : '-') + screen.sort.key);
  for (const [id, value] of Object.entries(screen.filters)) if (value) params.set(id, value);
  return params.toString();
}

function screenFromQuery(params) {
  const screen = defaultScreen();
  if (params.has('view') && (PRESETS[params.get('view')] || params.get('view') === 'custom')) {
    screen.preset = params.get('view');
  }
  screen.query = params.get('q') || '';
  screen.watchOnly = params.get('mine') === '1';
  const sort = params.get('sort');
  if (sort) {
    const key = sort.replace(/^-/, '');
    if (COLUMN_BY_KEY[key]) screen.sort = { key, dir: sort.startsWith('-') ? 'desc' : 'asc' };
  }
  for (const filter of FILTERS) {
    const value = params.get(filter.id);
    if (value) screen.filters[filter.id] = value;
  }
  return screen;
}

/** Push the screen back into the URL without adding a history entry per click. */
function syncScreenUrl(screen) {
  const query = screenToQuery(screen);
  const next = `#/screener${query ? `?${query}` : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function updateScreen(changes) {
  Object.assign(app.screen, changes);
  if (!('page' in changes)) app.screen.page = 0;
  if (changes.preset) store.set('lastPreset', changes.preset);
  syncScreenUrl(app.screen);
  render();
}

function viewScreener(view) {
  const screen = app.screen;
  const columns = screenColumns(screen);
  const filtered = filterRows(app.rows, screen);
  const sorted = sortRows(filtered, screen.sort);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(screen.page, pages - 1);
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Screener' }),
      el('p', { class: 'page-sub', text: `${sorted.length} of ${app.rows.length} symbols match` }),
    ]),
    el('div', { class: 'toolbar-group' }, [
      el('button', { class: 'button', type: 'button', text: 'Save this screen', onclick: saveScreenPrompt }),
      el('button', { class: 'button', type: 'button', text: 'Export CSV', onclick: () => exportCsv(columns, sorted) }),
    ]),
  ]));

  const card = el('section', { class: 'card' });

  /* --- preset tabs */
  const tabs = el('div', { class: 'tabs' });
  for (const [id, label] of Object.entries(PRESET_LABELS)) {
    tabs.append(el('button', {
      class: 'tab', type: 'button', role: 'tab', text: label,
      'aria-selected': screen.preset === id ? 'true' : 'false',
      onclick: () => updateScreen({ preset: id }),
    }));
  }

  /* --- filter row */
  const toolbar = el('div', { class: 'toolbar' });
  toolbar.append(el('input', {
    type: 'text', placeholder: 'Filter by ticker or name', value: screen.query,
    'aria-label': 'Filter by ticker or name',
    oninput: debounce((event) => updateScreen({ query: event.target.value }), 220),
  }));

  for (const filter of FILTERS) {
    const options = filter.type === 'choice'
      ? choicesFor(filter.field).map((value) => [value, value])
      : filter.options.map((entry) => [entry[0], entry[1]]);
    const select = el('select', {
      'aria-label': filter.label,
      onchange: (event) => updateScreen({ filters: { ...screen.filters, [filter.id]: event.target.value } }),
    }, [el('option', { value: '', text: filter.label })]);
    for (const [value, label] of options) {
      select.append(el('option', { value, text: label, selected: screen.filters[filter.id] === value }));
    }
    toolbar.append(select);
  }

  toolbar.append(el('button', {
    class: `button ${screen.watchOnly ? 'primary' : ''}`, type: 'button',
    text: screen.watchOnly ? '★ My list only' : '★ My list',
    'aria-pressed': screen.watchOnly ? 'true' : 'false',
    onclick: () => updateScreen({ watchOnly: !screen.watchOnly }),
  }));

  const active = Object.entries(screen.filters).filter(([, value]) => value);
  if (active.length || screen.query || screen.watchOnly) {
    toolbar.append(el('button', {
      class: 'button ghost', type: 'button', text: 'Reset',
      onclick: () => updateScreen({ filters: {}, query: '', watchOnly: false }),
    }));
  }

  card.append(el('div', { class: 'card-head' }, [tabs, el('span', { class: 'card-note', text: 'Click a column to sort' })]));

  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const activeCount = Object.values(screen.filters).filter(Boolean).length;
  card.append(el('details', { class: 'filters', open: !narrow || activeCount > 0 }, [
    el('summary', { text: activeCount ? `Filters (${activeCount} active)` : 'Filters' }),
    toolbar,
  ]));

  /* --- active filter chips, so a narrow result set is never a mystery */
  if (active.length) {
    const chips = el('div', { class: 'chip-row', style: 'padding:9px 13px 0' });
    for (const [id, value] of active) {
      const filter = FILTER_BY_ID[id];
      const option = filter.type === 'choice' ? null : (filter.options || []).find((entry) => entry[0] === value);
      chips.append(el('span', { class: 'chip' }, [
        `${filter.label}: ${option ? option[1] : value}`,
        el('button', {
          type: 'button', text: '×', 'aria-label': `Remove ${filter.label} filter`,
          onclick: () => updateScreen({ filters: { ...screen.filters, [id]: '' } }),
        }),
      ]));
    }
    card.append(chips);
  }

  /* --- custom column picker */
  if (screen.preset === 'custom') card.append(customColumnPicker());

  /* --- the table */
  if (!visible.length) {
    card.append(el('div', { class: 'empty' }, [
      el('h3', { text: 'Nothing matches' }),
      el('p', { text: 'Loosen a filter or reset to see the full universe.' }),
    ]));
  } else {
    card.append(buildTable(columns, visible, {
      sort: screen.sort,
      onSort: (sort) => updateScreen({ sort }),
    }));
    if (pages > 1) card.append(pager(page, pages, sorted.length));
  }

  const saved = Object.keys(store.data.screens);
  view.append(card);
  if (saved.length) view.append(savedScreensCard(saved));
}

function pager(page, pages, total) {
  const go = (next) => updateScreen({ page: Math.max(0, Math.min(pages - 1, next)) });
  return el('div', { class: 'toolbar', style: 'border-top:1px solid var(--border);border-bottom:0;justify-content:space-between' }, [
    el('span', { class: 'card-note', text: `Showing ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total}` }),
    el('div', { class: 'toolbar-group' }, [
      el('button', { class: 'button', type: 'button', text: '← Prev', disabled: page === 0, onclick: () => go(page - 1) }),
      el('span', { class: 'card-note', text: `Page ${page + 1} of ${pages}` }),
      el('button', { class: 'button', type: 'button', text: 'Next →', disabled: page >= pages - 1, onclick: () => go(page + 1) }),
    ]),
  ]);
}

function customColumnPicker() {
  const chosen = new Set(store.data.customColumns);
  const wrap = el('div', { style: 'padding:11px 13px;border-bottom:1px solid var(--border)' }, [
    el('div', { class: 'card-note', style: 'margin-bottom:7px', text: 'Pick the columns you actually use. Ticker is always shown.' }),
  ]);
  const row = el('div', { class: 'chip-row' });
  for (const column of COLUMNS) {
    if (column.key === 'symbol') continue;
    const on = chosen.has(column.key);
    row.append(el('button', {
      type: 'button', class: 'chip', title: column.help || column.label,
      style: on ? '' : 'background:var(--surface-3);color:var(--text-muted)',
      'aria-pressed': on ? 'true' : 'false',
      text: column.label,
      onclick: () => {
        const next = new Set(store.data.customColumns);
        if (next.has(column.key)) next.delete(column.key); else next.add(column.key);
        next.add('symbol');
        store.set('customColumns', COLUMNS.map((c) => c.key).filter((key) => next.has(key)));
        render();
      },
    }));
  }
  wrap.append(row);
  return wrap;
}

function savedScreensCard(names) {
  const list = el('div', { class: 'chip-row' });
  for (const name of names) {
    list.append(el('span', { class: 'chip' }, [
      el('button', {
        type: 'button', text: name, style: 'font-weight:600',
        onclick: () => {
          location.hash = `#/screener?${store.data.screens[name]}`;
        },
      }),
      el('button', {
        type: 'button', text: '×', 'aria-label': `Delete saved screen ${name}`,
        onclick: () => {
          const screens = { ...store.data.screens };
          delete screens[name];
          store.set('screens', screens);
          render();
        },
      }),
    ]));
  }
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: 'Saved screens' }),
      el('span', { class: 'card-note', text: 'Stored in this browser only' }),
    ]),
    el('div', { class: 'card-body' }, [list]),
  ]);
}

function saveScreenPrompt() {
  const name = window.prompt('Name this screen', 'My screen');
  if (!name) return;
  store.set('screens', { ...store.data.screens, [name.trim()]: screenToQuery(app.screen) });
  toast(`Saved “${name.trim()}”`);
  render();
}

/** CSV of exactly what is on screen -- same columns, same order, same filters. */
function exportCsv(columns, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((column) => escape(column.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column.key])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `kaliris-screener-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length} rows`);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---- heatmap ------------------------------------------------------------ */

const HEAT_METRICS = [
  ['change', 'Today'], ['perf_1w', '1 week'], ['perf_1m', '1 month'],
  ['perf_3m', '3 months'], ['perf_6m', '6 months'], ['ytd', 'Year to date'], ['perf_1y', '1 year'],
];

function heatLegend(metric) {
  const bounds = HEAT_SCALE[metric] || HEAT_SCALE.change;
  const legend = el('div', { class: 'heat-legend' }, [el('span', { text: `−${bounds[3]}%` })]);
  for (const step of [5, 4, 3, 2, 1]) legend.append(el('i', { style: `background:var(--heat-dn-${step})` }));
  legend.append(el('i', { style: 'background:var(--heat-neutral)' }));
  for (const step of [1, 2, 3, 4, 5]) legend.append(el('i', { style: `background:var(--heat-up-${step})` }));
  legend.append(el('span', { text: `+${bounds[3]}%` }));
  return legend;
}

/**
 * The treemap. Sized by market cap, coloured by the chosen return window.
 *
 * Every tile that has room prints its own number, so the colour is a fast
 * summary rather than the only way to read the value -- which matters
 * doubly here, because the default green/red pair is the one deuteranopia
 * cannot separate.
 */
function renderHeatmap(container, { compact = false } = {}) {
  const metric = store.data.heatMetric;
  const groupField = store.data.heatGroup;

  const rows = app.rows.filter((row) => isNum(row.market_cap) && row.market_cap > 0 && isNum(row[metric]));
  const buckets = new Map();
  for (const row of rows) {
    const key = row[groupField] || 'Unclassified';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  let groups = [...buckets.entries()]
    .map(([name, members]) => ({
      name,
      members: members.sort((a, b) => b.market_cap - a.market_cap),
      weight: members.reduce((sum, row) => sum + row.market_cap, 0),
    }))
    .sort((a, b) => b.weight - a.weight);

  if (compact) groups = groups.slice(0, 6);
  // An industry view can produce a hundred buckets of one stock each; cap the
  // tail so the page stays a heatmap rather than a list of squares.
  if (groupField === 'industry') groups = groups.slice(0, compact ? 6 : 28);

  clear(container);
  if (!groups.length) {
    container.append(el('div', { class: 'empty', text: 'No priced symbols to map.' }));
    return;
  }

  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
  const availableHeight = compact ? 300 : Math.max(520, Math.min(980, window.innerHeight - 220));

  function paint() {
    const width = container.clientWidth || 900;
    clear(container);

    for (const group of groups) {
      const share = group.weight / totalWeight;
      const groupHeight = Math.max(compact ? 74 : 96, Math.round(availableHeight * share * (compact ? 2.4 : 2.1)));
      const members = compact ? group.members.slice(0, 26) : group.members.slice(0, 90);

      const weighted = members.reduce((sum, row) => sum + row.market_cap, 0);
      const groupChange = weighted
        ? members.reduce((sum, row) => sum + row[metric] * row.market_cap, 0) / weighted
        : null;

      const canvasBox = el('div', { class: 'heat-canvas', style: `height:${groupHeight}px` });
      const tiles = squarify(
        members.map((row) => ({ row, weight: row.market_cap })),
        0, 0, width - 2, groupHeight,
      );

      for (const tile of tiles) {
        const row = tile.row;
        const value = row[metric];
        const roomy = tile.width > 46 && tile.height > 30;
        const tight = tile.width > 30 && tile.height > 18;
        const node = el('a', {
          class: 'heat-tile',
          href: `#/t/${encodeURIComponent(row.symbol)}`,
          style: `left:${tile.x}px;top:${tile.y}px;width:${tile.width}px;height:${tile.height}px;`
            + `background:${heatColor(value, metric)};`
            + `font-size:${Math.max(9, Math.min(15, Math.sqrt(tile.width * tile.height) / 5.2))}px`,
          title: `${row.symbol} — ${row.name || ''}\n${fmtPct(value)} · ${fmtCompact(row.market_cap)} cap`,
          'data-neutral': isHeatNeutral(value, metric) ? '' : null,
          dataset: { hoverSymbol: row.symbol },
        }, [
          tight ? el('b', { text: row.symbol }) : null,
          roomy ? el('span', { text: fmtPct(value, 1) }) : null,
        ]);
        canvasBox.append(node);
      }

      container.append(el('div', { class: 'heat-group' }, [
        el('div', { class: 'heat-group-head' }, [
          el('span', { text: `${group.name} · ${group.members.length}` }),
          el('span', { class: signClass(groupChange), text: fmtPct(groupChange) }),
        ]),
        canvasBox,
      ]));
    }
  }

  paint();
  observeResize(container, paint);
}

function heatmapCard({ compact = false } = {}) {
  const body = el('div', { class: 'card-body flush', style: 'padding:9px' });
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: compact ? 'Heatmap' : 'Market heatmap' }),
      el('div', { class: 'toolbar-group' }, [
        heatLegend(store.data.heatMetric),
        el('select', {
          'aria-label': 'Heatmap window',
          onchange: (event) => { store.set('heatMetric', event.target.value); render(); },
        }, HEAT_METRICS.map(([value, label]) =>
          el('option', { value, text: label, selected: store.data.heatMetric === value }))),
        compact ? null : el('select', {
          'aria-label': 'Group by',
          onchange: (event) => { store.set('heatGroup', event.target.value); render(); },
        }, [
          el('option', { value: 'sector', text: 'By sector', selected: store.data.heatGroup === 'sector' }),
          el('option', { value: 'industry', text: 'By industry', selected: store.data.heatGroup === 'industry' }),
        ]),
        compact ? el('a', { href: '#/heatmap', class: 'button', text: 'Full map' }) : null,
      ]),
    ]),
    body,
  ]);
  const map = el('div', { class: 'heatmap' });
  body.append(map);
  requestAnimationFrame(() => renderHeatmap(map, { compact }));
  return card;
}

function viewHeatmap(view) {
  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Heatmap' }),
      el('p', { class: 'page-sub', text: 'Tile area is market capitalisation; colour and the printed number are the same return.' }),
    ]),
  ]));
  view.append(heatmapCard({ compact: false }));
}

/* ---- groups ------------------------------------------------------------- */

function viewGroups(view) {
  const groups = app.groups || { sectors: [], industries: [] };
  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Groups' }),
      el('p', { class: 'page-sub', text: 'Sector and industry returns, both cap-weighted and equal-weighted. The gap between the two is often the story.' }),
    ]),
  ]));

  for (const [key, title] of [['sectors', 'Sectors'], ['industries', 'Industries']]) {
    const rows = groups[key] || [];
    view.append(el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'card-title', text: title }),
        el('span', { class: 'card-note', text: `${rows.length} groups` }),
      ]),
      el('div', { class: 'card-body flush' }, [groupTable(rows, key === 'sectors' ? 'sector' : 'industry')]),
    ]));
  }
}

function groupTable(groups, field) {
  const head = el('tr', {}, [
    el('th', { class: 'left', scope: 'col', text: 'Group' }),
    el('th', { scope: 'col', text: 'Symbols' }),
    el('th', { scope: 'col', title: 'Total market capitalisation of the group', text: 'Mkt Cap' }),
    el('th', { scope: 'col', title: 'Cap-weighted: what the sector ETF did', text: 'Today' }),
    el('th', { scope: 'col', title: 'Equal-weighted: what the average stock did', text: 'Today (eq)' }),
    el('th', { scope: 'col', text: '1W' }), el('th', { scope: 'col', text: '1M' }),
    el('th', { scope: 'col', text: '3M' }), el('th', { scope: 'col', text: 'YTD' }),
    el('th', { scope: 'col', text: '1Y' }),
    el('th', { scope: 'col', title: 'Advancing versus declining members', text: 'A/D' }),
  ]);

  const body = el('tbody');
  const sorted = groups.slice().sort((a, b) => (b.change_cap ?? b.change ?? -99) - (a.change_cap ?? a.change ?? -99));
  for (const group of sorted) {
    const cell = (value) => el('td', { class: signClass(value), text: fmtPct(value) });
    body.append(el('tr', {}, [
      el('td', { class: 'left' }, [
        el('a', { href: `#/screener?${field}=${encodeURIComponent(group.name)}&sort=-market_cap`, text: group.name }),
      ]),
      el('td', { class: 'dim', text: String(group.count) }),
      el('td', { text: fmtCompact(group.market_cap) }),
      cell(group.change_cap ?? group.change),
      cell(group.change),
      cell(group.perf_1w_cap ?? group.perf_1w),
      cell(group.perf_1m_cap ?? group.perf_1m),
      cell(group.perf_3m_cap ?? group.perf_3m),
      cell(group.ytd_cap ?? group.ytd),
      cell(group.perf_1y_cap ?? group.perf_1y),
      el('td', { class: 'dim', text: `${group.advancing}/${group.declining}` }),
    ]));
  }
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [el('thead', {}, [head]), body])]);
}

/* ---- news and insider --------------------------------------------------- */

function viewNews(view) {
  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Headlines' }),
      el('p', { class: 'page-sub', text: 'Aggregated from the wire feeds for the symbols this terminal tracks.' }),
    ]),
  ]));
  view.append(newsCard(app.news.slice(0, 120), `${Math.min(app.news.length, 120)} stories`));
}

function viewInsider(view) {
  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: 'Insider filings' }),
      el('p', { class: 'page-sub', text: 'Form 4 transactions. Open-market buys and sells are the signal; grants and option exercises are compensation and are labelled as such.' }),
    ]),
  ]));

  const kinds = ['all', 'buy', 'sell'];
  const state = { kind: 'all' };
  const card = el('section', { class: 'card' });
  const body = el('div', { class: 'card-body flush' });

  function paint() {
    clear(body);
    const rows = app.insider.filter((row) => state.kind === 'all' || row.kind === state.kind);
    if (!rows.length) {
      body.append(el('div', { class: 'empty' }, [
        el('h3', { text: 'No filings in this dataset' }),
        el('p', { text: 'Insider data is collected on the daily build. Run it once and this fills in.' }),
      ]));
      return;
    }
    body.append(insiderTable(rows.slice(0, 300)));
  }

  card.append(el('div', { class: 'card-head' }, [
    el('div', { class: 'tabs' }, kinds.map((kind) => el('button', {
      class: 'tab', type: 'button', text: kind === 'all' ? 'All' : kind === 'buy' ? 'Buys' : 'Sells',
      'aria-selected': state.kind === kind ? 'true' : 'false',
      onclick: (event) => {
        state.kind = kind;
        for (const tab of event.target.parentElement.children) tab.setAttribute('aria-selected', 'false');
        event.target.setAttribute('aria-selected', 'true');
        paint();
      },
    }))),
    el('span', { class: 'card-note', text: `${app.insider.length} recent transactions` }),
  ]));
  card.append(body);
  paint();
  view.append(card);
}

function insiderTable(rows) {
  const head = el('tr', {}, ['Date', 'Ticker', 'Insider', 'Role', 'Transaction', 'Shares', 'Price', 'Value']
    .map((label, index) => el('th', { class: index < 5 ? 'left' : '', scope: 'col', text: label })));
  const body = el('tbody');
  for (const row of rows) {
    const tone = row.kind === 'buy' ? 'up' : row.kind === 'sell' ? 'down' : 'flat';
    body.append(el('tr', {}, [
      el('td', { class: 'left dim', text: row.date || row.filed || dash() }),
      el('td', { class: 'left' }, [tickerLink(row.symbol)]),
      el('td', { class: 'left', text: row.person || dash() }),
      el('td', { class: 'left dim', text: row.title || dash() }),
      el('td', { class: 'left' }, [el('span', { class: `pill ${tone}`, text: row.label || row.code || '—' })]),
      el('td', { text: fmtInt(row.shares) }),
      el('td', { text: fmtPrice(row.price) }),
      el('td', { text: fmtCompact(row.value) }),
    ]));
  }
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [el('thead', {}, [head]), body])]);
}

/* ---- ticker detail ------------------------------------------------------ */

const RANGES = [['1m', '1M', 21], ['3m', '3M', 63], ['6m', '6M', 126], ['1y', '1Y', 999]];

function kvCard(title, pairs) {
  const grid = el('div', { class: 'kv' });
  let shown = 0;
  for (const [label, value, tone, help] of pairs) {
    if (value === null || value === undefined || value === dash()) continue;
    shown += 1;
    grid.append(el('div', { class: 'kv-row', title: help || '' }, [
      el('span', { class: 'kv-key', text: label }),
      el('span', { class: `kv-val ${tone || ''}`, text: value }),
    ]));
  }
  if (!shown) return null;
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: title })]),
    el('div', { class: 'card-body' }, [grid]),
  ]);
}

async function viewTicker(view, symbol) {
  const row = app.rowBySymbol.get(symbol);
  view.append(el('div', { class: 'loading', text: `Loading ${symbol}…` }));

  let detail = null;
  try {
    detail = await loadTicker(symbol);
  } catch (error) {
    clear(view).append(el('div', { class: 'empty' }, [
      el('h3', { text: `No data for ${symbol}` }),
      el('p', { text: 'That symbol is not in this terminal’s universe. Add it to market/universe.txt and rebuild, or search for another.' }),
      el('p', {}, [el('a', { href: '#/screener', text: 'Back to the screener' })]),
    ]));
    return;
  }
  if (app.route.view !== 'ticker' || app.route.arg !== symbol) return;  // navigated away mid-fetch

  clear(view);
  const profile = detail.profile || {};
  const name = (row && row.name) || profile.name || symbol;

  /* --- header */
  view.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title' }, [
        watchButton(symbol), ' ', symbol,
        el('span', { style: 'font-weight:400;color:var(--text-2)', text: `${NBSP} ${name}` }),
      ]),
      el('p', { class: 'page-sub', text: [profile.sector, profile.industry, (row && row.exchange) || profile.exchange, profile.country].filter(Boolean).join(' · ') || 'No profile data' }),
    ]),
    row ? el('div', { style: 'text-align:right' }, [
      el('div', { style: 'font-size:26px;font-weight:650;letter-spacing:-.02em' , text: fmtPrice(row.price) }),
      el('div', { class: signClass(row.change) }, [
        `${row.change > 0 ? '▲' : row.change < 0 ? '▼' : '■'} `,
        fmtPct(row.change),
        isNum(row.prev_close) && isNum(row.price)
          ? `${NBSP}(${fmtPrice(row.price - row.prev_close)})` : '',
      ]),
    ]) : null,
  ]));

  /* --- chart */
  const chartCard = el('section', { class: 'card' });
  const chartBody = el('div', { class: 'card-body', style: 'padding:9px 4px 4px' });
  const shell = el('div', { class: 'chart-shell' });
  chartBody.append(shell);

  const rangeState = { id: '1y' };
  const rangeTabs = el('div', { class: 'tabs' });
  function paintRange() {
    const bars = detail.bars;
    const entry = RANGES.find((item) => item[0] === rangeState.id) || RANGES[3];
    const take = Math.min(bars.c.length, entry[2] === 999 ? bars.c.length : entry[2]);
    const sliced = {};
    for (const key of ['t', 'o', 'h', 'l', 'c', 'v']) sliced[key] = bars[key].slice(-take);
    clear(shell);
    // Short windows cannot support a 200-day average; offering one would draw
    // an empty line and a dash in the legend.
    const periods = [20, 50, 200].filter((period) => period < take);
    drawPriceChart(shell, sliced, { smas: periods.length ? periods : [20], height: 400 });
    for (const tab of rangeTabs.children) {
      tab.setAttribute('aria-selected', tab.dataset.range === rangeState.id ? 'true' : 'false');
    }
  }
  for (const [id, label] of RANGES) {
    rangeTabs.append(el('button', {
      class: 'tab', type: 'button', text: label, dataset: { range: id },
      'aria-selected': rangeState.id === id ? 'true' : 'false',
      onclick: () => { rangeState.id = id; paintRange(); },
    }));
  }
  chartCard.append(el('div', { class: 'card-head' }, [
    el('h2', { class: 'card-title', text: 'Price' }),
    rangeTabs,
  ]), chartBody);
  view.append(chartCard);
  paintRange();

  if (!row) {
    view.append(el('div', { class: 'empty', text: 'This symbol has price history but no screener row — it may have failed the last fundamentals fetch.' }));
    return;
  }

  /* --- performance strip */
  const perfCells = [['perf_1w', '1 week'], ['perf_1m', '1 month'], ['perf_3m', '3 months'],
    ['perf_6m', '6 months'], ['ytd', 'Year to date'], ['perf_1y', '1 year']];
  view.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: 'Performance' })]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'stats' }, perfCells.map(([key, label]) =>
        statTile(label, fmtPct(row[key]), null, signClass(row[key])))),
    ]),
  ]));

  /* --- fundamentals */
  const cards = [
    kvCard('Valuation', [
      ['Market cap', fmtCompact(row.market_cap)],
      ['Revenue (ttm)', fmtCompact(row.revenue)],
      ['P/E', FORMATTERS.ratio(row.pe)],
      ['Forward P/E', FORMATTERS.ratio(row.forward_pe)],
      ['PEG', FORMATTERS.ratio(row.peg)],
      ['P/S', FORMATTERS.ratio(row.ps)],
      ['P/B', FORMATTERS.ratio(row.pb)],
      ['EPS (ttm)', fmtPrice(row.eps)],
      ['Sales growth Y/Y', fmtPct(row.revenue_growth), signClass(row.revenue_growth)],
      ['Earnings growth Y/Y', fmtPct(row.earnings_growth), signClass(row.earnings_growth)],
    ]),
    kvCard('Financial health', [
      ['Gross margin', fmtPctPlain(row.gross_margin)],
      ['Operating margin', fmtPctPlain(row.operating_margin)],
      ['Profit margin', fmtPctPlain(row.profit_margin)],
      ['Return on equity', fmtPctPlain(row.roe)],
      ['Return on assets', fmtPctPlain(row.roa)],
      ['Debt / equity', FORMATTERS.ratio(row.debt_to_equity)],
      ['Current ratio', FORMATTERS.ratio(row.current_ratio)],
      ['Dividend yield', row.dividend_yield ? fmtPctPlain(row.dividend_yield) : null],
    ]),
    kvCard('Technicals', [
      ['Previous close', fmtPrice(row.prev_close)],
      ['Day range', isNum(row.low) && isNum(row.high) ? `${fmtPrice(row.low)} – ${fmtPrice(row.high)}` : null],
      ['52-week range', isNum(row.low_52w) && isNum(row.high_52w) ? `${fmtPrice(row.low_52w)} – ${fmtPrice(row.high_52w)}` : null],
      ['From 52-week high', fmtPct(row.from_high_52w), signClass(row.from_high_52w)],
      ['SMA 20 / 50 / 200', [row.from_sma20, row.from_sma50, row.from_sma200].map((v) => fmtPct(v, 1)).join(' / ')],
      ['RSI (14)', FORMATTERS.rsi(row.rsi), row.rsi >= 70 ? 'down' : row.rsi <= 30 ? 'up' : ''],
      ['ATR (14)', fmtPrice(row.atr)],
      ['Beta', FORMATTERS.ratio(row.beta)],
      ['Volume', fmtCompact(row.volume)],
      ['Relative volume', FORMATTERS.ratio(row.rel_volume)],
    ]),
    kvCard('Ownership and coverage', [
      ['Shares outstanding', fmtCompact(row.shares_out)],
      ['Float', fmtCompact(row.float_shares)],
      ['Short % of float', row.short_percent_float ? fmtPctPlain(row.short_percent_float) : null],
      ['Short ratio', FORMATTERS.ratio(row.short_ratio)],
      ['Held by insiders', row.insider_own ? fmtPctPlain(row.insider_own) : null],
      ['Held by institutions', row.institution_own ? fmtPctPlain(row.institution_own) : null],
      ['Analyst target', fmtPrice(row.target_price)],
      ['Upside to target', fmtPct(row.target_upside), signClass(row.target_upside)],
      ['Analysts covering', fmtInt(row.analysts)],
      ['Next earnings', isNum(row.earnings_date) ? fmtDate(row.earnings_date) : null],
      ['Employees', fmtInt(profile.employees)],
    ]),
  ].filter(Boolean);
  view.append(el('div', { class: 'grid grid-2', style: 'margin-top:14px' }, cards));

  /* --- description */
  if (profile.summary) {
    view.append(el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'card-title', text: 'Business' }),
        profile.website ? el('a', { class: 'card-note', href: profile.website, target: '_blank', rel: 'noopener noreferrer', text: 'Company site' }) : null,
      ]),
      el('div', { class: 'card-body' }, [el('p', { class: 'prose', text: profile.summary })]),
    ]));
  }

  /* --- news and insider for this symbol */
  const symbolNews = (detail.news && detail.news.length)
    ? detail.news
    : app.news.filter((item) => (item.symbols || []).includes(symbol));
  const symbolInsider = (detail.insider && detail.insider.length)
    ? detail.insider
    : app.insider.filter((item) => item.symbol === symbol);

  const columnPair = el('div', { class: 'grid grid-2', style: 'margin-top:14px' });
  columnPair.append(newsCard(symbolNews.slice(0, 12), `Headlines — ${symbol}`));
  columnPair.append(el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: `Insider filings — ${symbol}` })]),
    symbolInsider.length
      ? el('div', { class: 'card-body flush' }, [insiderTable(symbolInsider.slice(0, 20))])
      : el('div', { class: 'card-body' }, [el('p', { class: 'prose', text: 'No Form 4 filings collected for this symbol.' })]),
  ]));
  view.append(columnPair);
}

/* ============================================================== 8. shell */

/* ---- hover preview ------------------------------------------------------ */

/* A chart on hover, the way a screener wants to be read: skim the table, and
 * the shape of anything interesting appears without leaving the row. */
const hover = { timer: null, symbol: null, node: $('#hover-chart') };

function showHoverChart(anchor, symbol) {
  clearTimeout(hover.timer);
  hover.timer = setTimeout(async () => {
    let detail;
    try {
      detail = await loadTicker(symbol);
    } catch { return; }
    if (hover.symbol !== symbol) return;

    const row = app.rowBySymbol.get(symbol);
    const node = clear(hover.node);
    node.append(el('div', { class: 'hc-head' }, [
      el('b', { text: symbol }),
      el('span', { class: signClass(row && row.change), text: fmtPct(row && row.change) }),
    ]));
    const canvas = el('canvas');
    node.append(canvas);
    node.hidden = false;

    const bounds = anchor.getBoundingClientRect();
    const cardWidth = node.offsetWidth || 288;
    const left = Math.min(window.innerWidth - cardWidth - 10, Math.max(8, bounds.right + 12));
    const top = Math.min(window.innerHeight - 150, Math.max(8, bounds.top - 14));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    drawSparkline(canvas, detail.bars.c.slice(-126), canvas.clientWidth || cardWidth - 16, 92);
  }, 260);
}

function hideHoverChart() {
  clearTimeout(hover.timer);
  hover.symbol = null;
  hover.node.hidden = true;
}

document.addEventListener('mouseover', (event) => {
  const anchor = event.target.closest('[data-hover-symbol]');
  if (!anchor) return;
  hover.symbol = anchor.dataset.hoverSymbol;
  showHoverChart(anchor, hover.symbol);
});
document.addEventListener('mouseout', (event) => {
  if (event.target.closest('[data-hover-symbol]')) hideHoverChart();
});
window.addEventListener('scroll', hideHoverChart, { passive: true });

/* ---- search ------------------------------------------------------------- */

const search = { input: $('#search'), results: $('#search-results'), items: [], cursor: -1 };

function runSearch(term) {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  const scored = [];
  for (const row of app.rows) {
    const symbol = row.symbol.toLowerCase();
    const name = (row.name || '').toLowerCase();
    let score = -1;
    if (symbol === query) score = 0;
    else if (symbol.startsWith(query)) score = 1;
    else if (name.startsWith(query)) score = 2;
    else if (symbol.includes(query)) score = 3;
    else if (name.includes(query)) score = 4;
    if (score >= 0) scored.push({ row, score });
  }
  scored.sort((a, b) => a.score - b.score || (b.row.market_cap || 0) - (a.row.market_cap || 0));
  return scored.slice(0, 10).map((entry) => entry.row);
}

function paintSearch(rows) {
  const list = clear(search.results);
  search.items = rows;
  search.cursor = rows.length ? 0 : -1;
  if (!rows.length) {
    list.hidden = true;
    search.input.parentElement.setAttribute('aria-expanded', 'false');
    return;
  }
  rows.forEach((row, index) => {
    list.append(el('li', { role: 'option', 'aria-selected': index === 0 ? 'true' : 'false' }, [
      el('button', { type: 'button', onclick: () => pickSearch(index) }, [
        el('span', { class: 'r-sym', text: row.symbol }),
        el('span', { class: 'r-name', text: row.name || '' }),
        el('span', { class: `r-chg ${signClass(row.change)}`, text: fmtPct(row.change) }),
      ]),
    ]));
  });
  list.hidden = false;
  search.input.parentElement.setAttribute('aria-expanded', 'true');
}

function moveSearchCursor(delta) {
  if (!search.items.length) return;
  search.cursor = (search.cursor + delta + search.items.length) % search.items.length;
  [...search.results.children].forEach((node, index) => {
    node.setAttribute('aria-selected', index === search.cursor ? 'true' : 'false');
    if (index === search.cursor) node.scrollIntoView({ block: 'nearest' });
  });
}

function pickSearch(index) {
  const row = search.items[index];
  if (!row) return;
  search.input.value = '';
  paintSearch([]);
  search.input.blur();
  location.hash = `#/t/${encodeURIComponent(row.symbol)}`;
}

search.input.addEventListener('input', debounce(() => paintSearch(runSearch(search.input.value)), 110));
search.input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveSearchCursor(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveSearchCursor(-1); }
  else if (event.key === 'Enter') { event.preventDefault(); pickSearch(search.cursor); }
  else if (event.key === 'Escape') { search.input.value = ''; paintSearch([]); search.input.blur(); }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search')) paintSearch([]);
});
document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (event.key === '/' && !typing) { event.preventDefault(); search.input.focus(); }
});

/* ---- theme -------------------------------------------------------------- */

function applyTheme() {
  const root = document.documentElement;
  if (store.data.theme) root.setAttribute('data-theme', store.data.theme);
  else root.removeAttribute('data-theme');
  root.setAttribute('data-cvd', store.data.cvd ? 'safe' : 'default');
}

$('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!store.data.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  store.set('theme', dark ? 'light' : 'dark');
  applyTheme();
  render();
});

$('#cvd-toggle').addEventListener('click', () => {
  store.set('cvd', !store.data.cvd);
  applyTheme();
  toast(store.data.cvd
    ? 'Colourblind-safe palette: blue is up, orange is down'
    : 'Conventional palette: green is up, red is down');
  render();
});

/* ---- routing ------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');

  if (!segments.length) return { view: 'overview', arg: '', params };
  if (segments[0] === 't' && segments[1]) {
    return { view: 'ticker', arg: decodeURIComponent(segments[1]).toUpperCase(), params };
  }
  const known = ROUTES.find((route) => route.id === segments[0]);
  return { view: known ? known.id : 'overview', arg: '', params };
}

function renderNav() {
  const nav = clear($('#nav'));
  for (const route of ROUTES) {
    nav.append(el('a', {
      href: `#${route.path}`,
      text: route.label,
      'aria-current': app.route.view === route.id ? 'page' : null,
    }));
  }
}

function render() {
  const view = clear($('#view'));
  renderNav();
  renderTape();
  renderBanner();
  renderFooterMeta();

  const titles = {
    overview: 'Market overview', screener: 'Screener', heatmap: 'Heatmap',
    groups: 'Groups', news: 'Headlines', insider: 'Insider filings',
  };
  document.title = app.route.view === 'ticker'
    ? `${app.route.arg} — ${SITE.name}`
    : `${titles[app.route.view] || SITE.name} — ${SITE.name}`;

  switch (app.route.view) {
    case 'screener': viewScreener(view); break;
    case 'heatmap': viewHeatmap(view); break;
    case 'groups': viewGroups(view); break;
    case 'news': viewNews(view); break;
    case 'insider': viewInsider(view); break;
    case 'ticker': viewTicker(view, app.route.arg); break;
    default: viewOverview(view);
  }
}

function onRouteChange() {
  const previous = app.route;
  app.route = parseHash();
  if (app.route.view === 'screener') {
    // Always adopt the URL. In-page filter changes update the hash with
    // replaceState, which fires no hashchange, so reaching here means someone
    // actually navigated -- a saved screen, a back button, a pasted link --
    // and the query string is the intent.
    app.screen = screenFromQuery(app.route.params);
  }
  hideHoverChart();
  render();
  if (previous.view !== app.route.view || previous.arg !== app.route.arg) {
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', onRouteChange);

/* ---- boot --------------------------------------------------------------- */

async function boot() {
  store.load();
  applyTheme();
  app.route = parseHash();
  app.screen = app.route.view === 'screener' ? screenFromQuery(app.route.params) : defaultScreen();

  $('#view').append(el('div', { class: 'loading', text: 'Loading market data…' }));
  try {
    await loadDataset();
  } catch (error) {
    clear($('#view')).append(el('div', { class: 'empty' }, [
      el('h3', { text: 'Could not load the dataset' }),
      el('p', { text: String(error.message || error) }),
      el('p', { class: 'prose', text: 'The site expects JSON under web/market/data. Generate it with "python3 scripts/build_demo_market_data.py" for the offline demo, or "python3 scripts/build_market_data.py" for live data.' }),
    ]));
    return;
  }
  render();
}

boot();
