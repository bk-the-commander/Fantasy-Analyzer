/* Fantasy Analyzer — all-time MLB player stats in this league's fantasy points.
 *
 * No framework, no build step: the whole app is this file plus a static JSON
 * dataset produced by scripts/build_web_data.py. Data loads lazily — the boot
 * payload is the search index, and player shards / leaderboards are fetched
 * the first time a view needs them, then cached for the session.
 */
'use strict';

// ---------------------------------------------------------------- constants

const DATA = 'data';

/* Column layouts of the packed arrays written by the build script. Keeping
 * these as named index maps means the JSON stays small without the render
 * code turning into a wall of magic numbers. */
const B = { YEAR:0, TEAM:1, LG:2, POS:3, G:4, PA:5, AB:6, R:7, H:8, D2:9, D3:10,
            HR:11, RBI:12, SB:13, CS:14, BB:15, IBB:16, HBP:17, SO:18,
            PTS:19, PLUS:20 };
const CB = { G:0, PA:1, AB:2, R:3, H:4, D2:5, D3:6, HR:7, RBI:8, SB:9, CS:10,
             BB:11, IBB:12, HBP:13, SO:14, PTS:15, Y0:16, Y1:17, N:18 };
const P = { YEAR:0, TEAM:1, LG:2, W:3, L:4, G:5, GS:6, CG:7, SHO:8, SV:9,
            IPOUTS:10, H:11, ER:12, HR:13, BB:14, SO:15, ERA:16, PTS:17, PLUS:18 };
const CP = { W:0, L:1, G:2, GS:3, CG:4, SHO:5, SV:6, IPOUTS:7, H:8, ER:9, HR:10,
             BB:11, SO:12, ERA:13, PTS:14, Y0:15, Y1:16, N:17 };

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
};

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');

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
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function getJSON(path) {
  const res = await fetch(`${DATA}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function getShard(id) {
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

// idPos: id -> position in the columnar index arrays (built once at boot).
// Leaderboards resolve tens of thousands of names through this, so it has to
// be a map lookup rather than a scan of the ids array.
let idPos = new Map();

function nameOf(id) {
  const i = idPos.get(id);
  return i === undefined ? `#${id}` : state.index.names[i];
}

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
    let score = 0;
    if (n === q) score = 1000;
    else if (n.startsWith(q)) score = 800;
    else {
      const last = n.slice(n.indexOf(' ') + 1);
      if (last.startsWith(q)) score = 700;
      else if (terms.every((t) => n.includes(t))) score = n.includes(q) ? 500 : 300;
    }
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
        onclick: () => { close(); input.value = ''; go(`#/player/${h.id}`); },
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
      if (h) { close(); input.value = ''; go(`#/player/${h.id}`); }
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
  return el('div', { class: `tile${hero ? ' hero' : ''}` },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'tile-value' }, value),
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

  return el('div', { class: 'chart-wrap' }, svg);
}

// -------------------------------------------------------------- player view

async function viewPlayer(id) {
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

  const p = await getShard(Number(id));
  if (!p) return app().replaceChildren(el('div', { class: 'empty-state' }, 'Player not found.'));

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
    onchange: (e) => go(`#/player/${id}?season=${e.target.value}`),
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
          if (!state.compare.includes(Number(id))) state.compare.push(Number(id));
          go(`#/compare/${state.compare.join(',')}`);
        },
      }, '+ Add to compare')));

  const card = el('div', { class: 'panel' }, hero);
  const container = el('div', {}, card);
  app().replaceChildren(container);

  // --- tiles + rails ------------------------------------------------------
  const isCareer = scope === 'career';
  const yr = Number(scope);

  if (!primaryPitcher || isTwoWay) {
    const row = isCareer ? null : bat.find((r) => r[B.YEAR] === yr);
    if (isCareer ? p.cb : row) await addBattingBlock(card, p, id, isCareer, row);
  }
  if (primaryPitcher || isTwoWay) {
    const row = isCareer ? null : pit.find((r) => r[P.YEAR] === yr);
    if (isCareer ? p.cp : row) await addPitchingBlock(card, p, id, isCareer, row);
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
    seasonChart(seasons, (y) => go(`#/player/${id}?season=${y}`), isCareer ? null : yr)));

  // --- season logs --------------------------------------------------------
  if (bat.length) container.append(battingLog(bat, p));
  if (pit.length) container.append(pitchingLog(pit, p));

  if (pit.length) {
    container.append(el('div', { class: 'note', html:
      '<b>Pitching caveat:</b> the historical databank carries no Holds, Blown Saves or ' +
      'Quality Starts, so those three categories score 0 here. Totals for relievers ' +
      '(holds) and starters (QS) are therefore conservative — see the Scoring tab.' }));
  }
}

async function addBattingBlock(card, p, id, isCareer, row) {
  const c = p.cb;
  const pts = isCareer ? c[CB.PTS] : row[B.PTS];
  const g   = isCareer ? c[CB.G]   : row[B.G];
  const pa  = isCareer ? c[CB.PA]  : row[B.PA];
  const grp = isCareer ? 'career_batting' : 'season_batting';
  const ranks = await rankMap('lb_career_batting');
  const rank = ranks.get(Number(id));

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
  rails.append(el('div', { class: 'hint', style: 'padding:10px 0 0 132px;font-size:11px;color:var(--grey)' },
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
  const rank = ranks.get(Number(id));

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
  rails.append(el('div', { class: 'hint', style: 'padding:10px 0 0 132px;font-size:11px;color:var(--grey)' },
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
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Batting — season by season'),
      el('span', { class: 'hint' }, 'Click any column header to sort')),
    statTable(rows, [
      { key: 'year', label: 'Year', cls: 'txt' },
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
      picks.map((p) => el('a', { class: 'cmp-card', href: `#/player/${p.id}` },
        el('h3', {}, p.name),
        el('div', { class: 'yrs' }, `${p.y0}–${p.y1}`),
        el('div', { class: 'cmp-row best' }, el('span', {}, 'Career points'), el('span', {}, num(p.pts, 0)))))));
}

// -------------------------------------------------------- leaderboard views

function eraSelect(onChange, current) {
  return el('select', { onchange: (e) => onChange(ERAS[e.target.value]) },
    ERAS.map((e, i) => el('option', { value: i, selected: current === i }, e[0])));
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
    filters, body);
  app().replaceChildren(head, panel);

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

    body.replaceChildren(
      el('div', { class: 'panel-head', style: 'border-top:1px solid var(--line)' },
        el('h2', {}, `${num(filtered.length)} ${isCareer ? 'players' : 'seasons'}`),
        el('span', { class: 'hint' }, opts.group === 'batting' ? 'Batting' : 'Pitching')),
      buildBoardTable(filtered, opts.group, isCareer));
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

function playerLink(row) {
  const hof = indexField(row.id, 'hof');
  const a = el('a', { class: 'plink', href: `#/player/${row.id}` }, row.name);
  if (hof) a.append(el('span', { class: 'hof-star' }, '★'));
  return a;
}

function buildBoardTable(rows, group, isCareer) {
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
      { key: 'ptsplus', label: 'PTS+', title: 'Era-adjusted: points per PA vs. league average (100)',
        get: (r) => r.ptsplus ? num(r.ptsplus, 0) : '—' },
      ptsCol];
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
      { key: 'ptsplus', label: 'PTS+', title: 'Era-adjusted: points per IP vs. league average (100)',
        get: (r) => r.ptsplus ? num(r.ptsplus, 0) : '—' },
      ptsCol];
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
      wrap));

  const [bat, pit] = await Promise.all([
    getBoard('lb_season_batting'), getBoard('lb_season_pitching'),
  ]);
  const bRows = bat.filter((r) => r.year === year).sort((a, b) => b.pts - a.pts);
  const pRows = pit.filter((r) => r.year === year).sort((a, b) => b.pts - a.pts);

  const section = (title, rows, group) => el('div', {},
    el('div', { class: 'panel-head', style: 'border-top:1px solid var(--line)' },
      el('h2', {}, title),
      el('span', { class: 'hint' }, rows.length ? `Top ${Math.min(rows.length, 40)} shown` : 'No data')),
    rows.length ? buildBoardTable(rows, group, false)
                : el('div', { class: 'empty-state' }, 'No qualifying players for this season.'));

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
  const ids = (idsParam || '').split(',').filter(Boolean).map(Number);
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
          if (hit && !ids.includes(hit.id)) go(`#/compare/${[...ids, hit.id].join(',')}`);
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

  const players = await Promise.all(ids.map((id) => getShard(id)));
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
      el('h3', {}, el('a', { href: `#/player/${p.i}`, class: 'plink' }, p.n)),
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
        onclick: () => go(`#/compare/${ids.filter((x) => x !== p.i).join(',')}`),
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

  app().replaceChildren(
    el('div', { class: 'view-head' },
      el('h1', {}, 'League Scoring'),
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

// ------------------------------------------------------------------- router

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'player';
  const [path] = raw.split('?');
  const [view, arg] = path.split('/');

  document.querySelectorAll('#tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.view === view));
  window.scrollTo({ top: 0 });

  try {
    switch (view) {
      case 'player':  await viewPlayer(arg); break;
      case 'career':  await viewLeaders('career'); break;
      case 'season':  await viewLeaders('season'); break;
      case 'year':    await viewYear(arg); break;
      case 'compare': await viewCompare(arg); break;
      case 'scoring': viewScoring(); break;
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
  try {
    const [meta, index, pct] = await Promise.all([
      getJSON('meta.json'), getJSON('search.json'), getJSON('percentiles.json'),
    ]);
    state.meta = meta;
    state.index = index;
    state.pct = pct;
    state.norm = index.names.map(norm);
    idPos = new Map(index.ids.map((id, i) => [id, i]));

    $('#footMeta').textContent =
      `${num(meta.players)} players · ${meta.seasons[0]}–${meta.seasons[1]} · built ${meta.built}`;

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
