/* SOT — shell, routing, search and the drill trail.
 *
 * One render function, one delegated event handler. The trail in the header is
 * the small thing that makes the product feel like what it claims to be: it
 * records the path of records you clicked through to get here, so following a
 * question five entities deep never loses the thread back.
 */
(function (SOT) {
  'use strict';

  const store = SOT.store.create();
  const u = SOT.ui;

  const state = {
    browseQ: '',
    browseIssues: false,
    expanded: {},
    showPast: {},
    integrity: { severity: 'all', kind: 'all', system: 'all', type: 'all', q: '' },
    tasks: { status: 'open', owner: 'all' },
    adminField: null,
    drawer: null,
    palette: false,
    palQ: '',
    palSel: 0,
    trail: [],
  };

  function parseRoute() {
    const raw = (location.hash || '#/dashboard').slice(1);
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const query = {};
    (qs || '').split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { path, parts, query, raw };
  }

  /* ------------------------------------------------------------------ login */

  function login() {
    const packs = store.packs;
    const view = store.view;
    return (
      '<div class="login"><div class="login-left">' +
      u.wordmark() +
      '<div><h1>Everything you know<br>about someone,<br>in one place.</h1>' +
      '<p>Your systems each hold a fragment — who they are, where they sit, who they report to, who they treated, ' +
      'which territory they carry. SOT resolves one identity per person, per place, per event, and lets you follow ' +
      'the thread from any one of them to all the others.</p></div>' +
      '<div class="fine"><b>Prototype.</b> Every record is synthetic — ' +
      view.identity.stats.entities.toLocaleString('en-US') + ' generated entities and ' +
      view.identity.stats.sourceRecords.toLocaleString('en-US') + ' source records across ' + view.pack.systems.length +
      ' simulated connectors. No live system is contacted, no credentials exist in the codebase, and no real personal, ' +
      'clinical or personnel data is used anywhere.</div>' +
      '</div><div class="login-right">' +
      '<div class="pick-label">Organization</div>' +
      '<div class="seg" style="margin-bottom:14px">' + packs.map((p) =>
        '<button class="' + (p.id === store.state.packId ? 'on' : '') + '" data-act="pack" data-pack="' + u.at(p.id) + '">' +
        u.esc(p.label) + '</button>').join('') + '</div>' +
      '<div class="dim" style="font-size:12px;margin:-6px 0 12px;line-height:1.5">' + u.esc(view.pack.tenantName) + ' — ' +
      u.esc(view.pack.tagline) + ' Both run on the same engine; only the configuration differs.</div>' +
      '<div class="pick-label">Sign in as</div>' +
      view.pack.roles.map((r) =>
        '<button class="pick-card" data-act="signin" data-role="' + u.at(r.id) + '">' +
        '<span><span class="pc-name">' + u.esc(r.name) + '</span> <span class="pc-persona">· ' + u.esc(r.persona) + '</span>' +
        '<span class="pc-blurb" style="display:block">' + u.esc(r.blurb) + '</span></span><span class="pc-go">→</span></button>').join('') +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------------ shell */

  function rail(view, route) {
    const pack = view.pack;
    const nav = [
      { group: 'Explore', items: [{ href: '#/dashboard', label: 'Overview', g: '▦' }]
          .concat(pack.entityTypes.map((t) => ({
            href: '#/t/' + t.id, label: t.plural, g: t.glyph,
            n: view.summary.counts[t.id],
          }))) },
      { group: 'Reconcile', items: [
        { href: '#/integrity', label: 'Data integrity', g: '◈', n: view.summary.actionable, hot: true },
        { href: '#/identity', label: 'Identity', g: '⚯', n: view.summary.identity.needsReview },
        { href: '#/tasks', label: 'Remediation', g: '✓', n: view.tasks.filter((t) => t.status === 'open').length },
      ] },
      { group: 'Configure', items: [
        { href: '#/systems', label: 'Systems', g: '⧉' },
        { href: '#/admin', label: 'Admin', g: '⚙' },
      ] },
    ];

    return '<aside class="rail"><div class="rail-head">' + u.wordmark() + '</div><nav class="nav">' +
      nav.map((g) => '<div class="nav-label">' + u.esc(g.group) + '</div>' +
        g.items.map((it) => {
          const on = route.path === it.href.slice(1) || (it.href !== '#/dashboard' && route.path.indexOf(it.href.slice(1)) === 0);
          return '<a href="' + it.href + '" class="' + (on ? 'on' : '') + '"><span class="g">' + it.g + '</span>' +
            u.esc(it.label) + (it.n ? '<span class="n ' + (it.hot ? 'hot' : '') + '">' + it.n.toLocaleString('en-US') + '</span>' : '') + '</a>';
        }).join('')).join('') +
      '</nav><div class="rail-foot">' + u.esc(view.pack.tenantName) + '<br>Resolved ' + u.esc(u.date(view.asOf)) + '</div></aside>';
  }

  function topbar(view) {
    return '<div class="top">' +
      '<button class="searchbtn" data-act="palette"><span>⌕</span><span style="flex:1;text-align:left">Search ' +
      u.esc(view.pack.entityTypes.map((t) => t.plural.toLowerCase()).join(', ')) + '…</span>' +
      '<span class="kbd">' + (navigator.platform.indexOf('Mac') >= 0 ? '⌘K' : 'Ctrl K') + '</span></button>' +
      '<div class="right">' +
      '<div class="selwrap"><span class="lbl">Org</span><select data-act="pack-sel">' +
      store.packs.map((p) => '<option value="' + u.at(p.id) + '"' + (p.id === store.state.packId ? ' selected' : '') + '>' +
        u.esc(p.label) + '</option>').join('') + '</select></div>' +
      '<div class="selwrap"><span class="lbl">Role</span><select data-act="role">' +
      view.pack.roles.map((r) => '<option value="' + u.at(r.id) + '"' + (r.id === view.role.id ? ' selected' : '') + '>' +
        u.esc(r.name) + '</option>').join('') + '</select></div>' +
      (view.persona ? '<a class="btn sm" href="#/e/' + u.at(view.persona.entity.id) + '">' + u.esc(view.persona.name) + '</a>' : '') +
      '<button class="btn ghost sm" data-act="signout">Exit</button>' +
      '</div></div>';
  }

  /* The drill trail: the path of records that got you here. */
  function trail(view) {
    if (state.trail.length < 2) return '';
    const items = state.trail.slice(-7);
    return '<div class="trail"><span class="t-lbl">Trail</span>' +
      items.map((t, i) => {
        const last = i === items.length - 1;
        const inner = '<span class="g">' + u.esc(t.glyph) + '</span>' + u.esc(t.name);
        return (last ? '<span class="cur">' + inner + '</span>' : '<a href="#/e/' + u.at(t.id) + '">' + inner + '</a>') +
          (last ? '' : '<span class="sep">›</span>');
      }).join('') +
      '<button class="btn ghost sm" style="margin-left:auto;flex:none" data-act="clear-trail">Clear</button></div>';
  }

  function palette(view) {
    if (!state.palette) return '';
    const q = state.palQ.trim().toLowerCase();
    let rows = view.searchIndex.filter((r) => store.canOpen(r.id));
    if (q) rows = rows.filter((r) => r.terms.indexOf(q) >= 0);
    rows = rows.sort((a, b) => {
      const ai = a.title.toLowerCase().indexOf(q), bi = b.title.toLowerCase().indexOf(q);
      if (q && (ai === 0) !== (bi === 0)) return ai === 0 ? -1 : 1;
      return a.typeLabel.localeCompare(b.typeLabel) || a.title.localeCompare(b.title);
    }).slice(0, 40);
    state.palSel = Math.min(state.palSel, Math.max(0, rows.length - 1));

    return '<div class="ov" data-act="close-palette"><div class="pal" data-stop="1">' +
      '<input id="pal-in" placeholder="Search every record — names, codes, identifiers…" value="' + u.at(state.palQ) + '" autocomplete="off">' +
      '<div class="res">' +
      (rows.length
        ? rows.map((r, i) => '<div class="r ' + (i === state.palSel ? 'on' : '') + '" data-go="' + u.at(r.href) + '">' +
            '<span class="av sm sq">' + u.esc(r.glyph) + '</span>' +
            '<span style="min-width:0"><span class="t">' + u.esc(r.title) + '</span><br>' +
            '<span class="s">' + u.esc(r.subtitle || r.typeLabel) + '</span></span>' +
            '<span class="ty">' + u.esc(r.typeLabel) + '</span></div>').join('')
        : '<div class="empty">Nothing matches “' + u.esc(state.palQ) + '”</div>') +
      '</div><div class="hint"><span><span class="kbd">↑↓</span> move</span><span><span class="kbd">↵</span> open</span>' +
      '<span><span class="kbd">esc</span> close</span></div></div></div>';
  }

  /* ----------------------------------------------------------------- render */

  function pushTrail(id) {
    const v = store.view;
    const p = v.profiles[id];
    if (!p) return;
    const t = v.pack.typeById[p.type];
    const entry = { id, name: p.name, glyph: t.glyph };
    const existing = state.trail.findIndex((x) => x.id === id);
    if (existing >= 0) state.trail = state.trail.slice(0, existing + 1);
    else state.trail.push(entry);
    if (state.trail.length > 14) state.trail = state.trail.slice(-14);
  }

  function render() {
    const view = store.view;
    const route = parseRoute();
    const root = document.getElementById('app');

    if (!store.state.signedIn) { root.innerHTML = login(); return; }
    if (route.parts[0] === 'e' && route.parts[1]) pushTrail(route.parts[1]);
    if (route.parts[0] === 'me' && view.persona) { location.hash = '#/e/' + view.persona.entity.id; return; }

    const ctx = { view, store, state, route };
    let body;
    switch (route.parts[0]) {
      case 't': body = SOT.views.browse(ctx); break;
      case 'e': body = SOT.views.entity(ctx); break;
      case 'integrity': body = SOT.views.integrity(ctx); break;
      case 'identity': body = SOT.views.identity(ctx); break;
      case 'systems': body = SOT.views.systems(ctx); break;
      case 'tasks': body = SOT.views.tasks(ctx); break;
      case 'admin': body = SOT.views.admin(ctx); break;
      default: body = SOT.views.dashboard(ctx);
    }

    const active = document.activeElement;
    const fid = active && active.id ? active.id : null;
    const caret = fid && active.selectionStart !== undefined ? active.selectionStart : null;

    root.innerHTML = '<div class="shell">' + rail(view, route) +
      '<main class="main">' + topbar(view) + trail(view) + '<div class="content">' + body + '</div></main></div>' +
      palette(view) + SOT.views.drawer(ctx);

    if (fid) {
      const el = document.getElementById(fid);
      if (el) { el.focus(); if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
    } else if (state.palette) {
      const el = document.getElementById('pal-in');
      if (el) el.focus();
    }
  }

  function go(href) {
    state.palette = false; state.palQ = '';
    state.drawer = null;
    location.hash = href.charAt(0) === '#' ? href : '#' + href;
    render();
  }

  /* ------------------------------------------------------------ interaction */

  document.addEventListener('click', (e) => {
    const stop = e.target.closest('[data-stop]');
    const el = e.target.closest('[data-act]');
    const act = el ? el.getAttribute('data-act') : null;
    const d = (k) => el.getAttribute('data-' + k);

    if ((act === 'close-drawer' || act === 'close-palette') && stop && !e.target.closest('button,a')) return;

    if (act) {
      switch (act) {
        case 'pack': store.setPack(d('pack')); render(); return;
        case 'pack-sel': return;
        case 'signin': {
          store.signIn(d('role'));
          state.trail = [];
          const role = store.view.pack.roles.find((r) => r.id === d('role'));
          location.hash = role.landing;
          render(); return;
        }
        case 'signout': store.signOut(); state.trail = []; render(); return;
        case 'palette': state.palette = true; state.palQ = ''; state.palSel = 0; render(); return;
        case 'close-palette': state.palette = false; render(); return;
        case 'close-drawer':
          state.drawer = null;
          if (e.target.closest('a[href]')) { setTimeout(render, 0); return; }
          render(); return;
        case 'ent-tab': go('#/e/' + parseRoute().parts[1] + '?tab=' + d('tab')); return;
        case 'admin-tab': go('#/admin?tab=' + d('tab')); return;
        case 'prov': state.expanded[d('key')] = !state.expanded[d('key')]; render(); return;
        case 'toggle-past': state.showPast[d('key')] = state.showPast[d('key')] === false; render(); return;
        case 'browse-issues': state.browseIssues = !state.browseIssues; render(); return;
        case 'int-chip': state.integrity[d('key')] = d('val'); render(); return;
        case 'int-sel': state.integrity[d('key')] = el.value; render(); return;
        case 'task-filter': state.tasks[d('key')] = d('val'); render(); return;
        case 'task-status': store.setTaskStatus(d('id'), d('status')); state.drawer = null; render(); return;
        case 'task-bulk': {
          const ids = store.view.tasks.filter((t) => t.status === 'open' && (t.severity === 'critical' || t.severity === 'high')).map((t) => t.id);
          store.bulkTaskStatus(ids, d('status')); render(); return;
        }
        case 'confirm': store.confirmLink(d('entity'), d('system'), d('native')); render(); return;
        case 'dismiss': store.dismissRecord(d('system'), d('native')); render(); return;
        case 'admin-field': state.adminField = state.adminField === d('field') ? null : d('field'); render(); return;
        case 'promote': store.setSystemOfRecord(d('field'), d('system')); render(); return;
        case 'policy-reset': store.resetPolicy(); render(); return;
        case 'reset-all': store.resetAll(); state.adminField = null; state.trail = []; render(); return;
        case 'clear-trail': state.trail = state.trail.slice(-1); render(); return;
        case 'role': return;
        default: break;
      }
    }

    const dr = e.target.closest('[data-drawer]');
    if (dr) { e.preventDefault(); state.drawer = dr.getAttribute('data-drawer'); render(); return; }

    const g = e.target.closest('[data-go]');
    if (g && !e.target.closest('a[href]') && !g.disabled) { e.preventDefault(); go(g.getAttribute('data-go')); return; }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'role') { store.setRole(el.value); state.trail = []; render(); }
    if (act === 'pack-sel') { store.setPack(el.value); state.trail = []; location.hash = '#/dashboard'; render(); }
    if (act === 'int-sel') { state.integrity[el.getAttribute('data-key')] = el.value; render(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'pal-in') { state.palQ = e.target.value; state.palSel = 0; render(); }
    if (e.target.id === 'browse-q') { state.browseQ = e.target.value; render(); }
    if (e.target.id === 'int-q') { state.integrity.q = e.target.value; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!store.state.signedIn) return;
      state.palette = true; state.palSel = 0; render();
      return;
    }
    if (e.key === 'Escape') {
      if (state.palette) { state.palette = false; render(); return; }
      if (state.drawer) { state.drawer = null; render(); return; }
    }
    if (!state.palette) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = document.querySelectorAll('.pal .r').length;
      if (!n) return;
      state.palSel = (state.palSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      render();
      const el = document.querySelectorAll('.pal .r')[state.palSel];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      const el = document.querySelectorAll('.pal .r')[state.palSel];
      if (el) go(el.getAttribute('data-go'));
    }
  });

  window.addEventListener('hashchange', render);
  SOT.app = { store, state, render, parseRoute };
  render();
})(window.SOT || (window.SOT = {}));
