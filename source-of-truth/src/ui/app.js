/* Source of Truth — shell, routing and interaction.
 *
 * One render function, one delegated event handler. The whole application is
 * re-rendered on any state change; with this dataset that costs a few
 * milliseconds and removes an entire class of stale-view bugs.
 */
(function (SOT) {
  'use strict';

  const store = SOT.store.create();
  const u = SOT.ui;

  /* Interface state — deliberately separate from the store, which holds only
     things that change what the *data* resolves to. */
  const state = {
    orgMode: 'explore',
    orgQuery: '',
    orgIssuesOnly: false,
    treeOpen: {},
    expanded: {},
    integrity: { severity: 'all', kind: 'all', system: 'all', field: 'all', dept: 'all', q: '' },
    tasks: { status: 'open', owner: 'all' },
    metricId: 'pipeline',
    adminField: null,
    drawer: null,
    palette: false,
    paletteQ: '',
    paletteSel: 0,
  };

  const NAV = [
    { group: 'Organization', items: [
      { href: '#/dashboard', label: 'Dashboard', ico: '▦' },
      { href: '#/org', label: 'Explorer', ico: '⌗' },
    ] },
    { group: 'Reconciliation', items: [
      { href: '#/integrity', label: 'Data integrity', ico: '◈', alarm: true,
        count: (v, seen) => v.conflicts.filter((c) => c.actionable && seen.has(c.personId)).length },
      { href: '#/identity', label: 'Identity', ico: '⚯', count: (v) => v.identity.stats.needsReview },
      { href: '#/metrics', label: 'Metrics', ico: '≠' },
      { href: '#/tasks', label: 'Remediation', ico: '✓',
        count: (v, seen) => v.tasks.filter((t) => t.status === 'open' && (!t.personId || seen.has(t.personId))).length },
    ] },
    { group: 'Configuration', items: [
      { href: '#/systems', label: 'Systems', ico: '⧉' },
      { href: '#/admin', label: 'Admin', ico: '⚙' },
    ] },
  ];

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

  function loginScreen() {
    return (
      '<div class="login"><div class="login-left">' +
      '<div class="wordmark"><span class="mark">K</span><div>' +
      '<div class="parent">Kaliris Labs</div><div class="product">Source of Truth</div></div></div>' +
      '<div><h1>One organization.<br>Every system.<br>One source of truth.</h1>' +
      '<p class="tagline">Your systems each hold a different version of who works where, reporting to whom, ' +
      'owning which territory. Source of Truth sits above them, resolves one identity per person, and explains ' +
      'every disagreement it finds.</p></div>' +
      '<div class="note"><b>Prototype.</b> Every figure is synthetic: one fictional company, ' +
      store.view.identity.stats.people + ' generated people and ' +
      store.view.identity.stats.sourceRecords.toLocaleString('en-US') +
      ' records across six simulated connectors. No live system is contacted and no real personal data is used.</div>' +
      '</div>' +
      '<div class="login-right">' +
      '<div style="font-size:12px;color:var(--text-3);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">Choose a role to enter</div>' +
      '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:10px">Different roles see different slices of the organization. ' +
      'You can switch at any time from the top bar.</div>' +
      SOT.model.ROLES.map((r) =>
        '<button class="role-card" data-action="signin" data-role="' + u.attr(r.id) + '">' +
        '<span><span class="r-name">' + u.esc(r.name) + '</span>' +
        '<span class="r-persona"> · ' + u.esc(r.persona) + '</span>' +
        '<span class="r-blurb" style="display:block">' + u.esc(r.blurb) + '</span></span>' +
        '<span class="r-go">→</span></button>').join('') +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------------ shell */

  function sidebar(view, route) {
    // Counts follow the signed-in role's scope, so the badge in the rail and
    // the number on the page can never disagree.
    const seen = new Set(store.visiblePeople().map((p) => p.person.id));
    return (
      '<aside class="sidebar"><div class="sidebar-head">' +
      '<div class="wordmark"><span class="mark">K</span><div>' +
      '<div class="parent">Kaliris Labs</div><div class="product">Source of Truth</div></div></div></div>' +
      '<nav class="nav">' +
      NAV.map((g) =>
        '<div class="nav-label">' + u.esc(g.group) + '</div>' +
        g.items.map((it) => {
          const on = route.path.indexOf(it.href.slice(1)) === 0;
          const n = it.count ? it.count(view, seen) : null;
          return '<a href="' + it.href + '" class="' + (on ? 'active' : '') + '">' +
            '<span class="ico">' + it.ico + '</span>' + u.esc(it.label) +
            (n ? '<span class="count ' + (it.alarm ? 'alarm' : '') + '">' + n + '</span>' : '') + '</a>';
        }).join('')
      ).join('') +
      '</nav>' +
      '<div class="sidebar-foot">' + u.esc(view.dataset.company.name) + '<br>' +
      'Resolved ' + u.esc(u.date(view.asOf)) + '</div></aside>'
    );
  }

  function topbar(view) {
    return (
      '<div class="topbar">' +
      '<button class="searchbtn" data-action="palette"><span>⌕</span>' +
      '<span style="flex:1;text-align:left">Search people, teams, territories, accounts…</span>' +
      '<span class="kbd">' + (navigator.platform.indexOf('Mac') >= 0 ? '⌘' : 'Ctrl ') + 'K</span></button>' +
      '<div class="rolepick"><span class="lbl">Signed in as</span>' +
      '<select data-action="role">' +
      SOT.model.ROLES.map((r) => '<option value="' + u.attr(r.id) + '"' + (r.id === view.role.id ? ' selected' : '') + '>' +
        u.esc(r.name) + '</option>').join('') +
      '</select></div>' +
      (view.persona
        ? '<span class="badge plain" title="This role is anchored to a real person in the graph">' +
          u.esc(view.persona.displayName) + '</span>'
        : '') +
      '<button class="btn ghost" data-action="signout" title="Return to role selection">Exit</button>' +
      '</div>'
    );
  }

  function palette(view) {
    if (!state.palette) return '';
    const q = state.paletteQ.trim().toLowerCase();
    const visible = new Set(store.visiblePeople().map((p) => p.person.id));
    let rows = view.searchIndex.filter((r) => r.type !== 'person' || visible.has(r.id));
    if (q) rows = rows.filter((r) => r.terms.indexOf(q) >= 0);
    rows = rows
      .sort((a, b) => {
        const at = a.title.toLowerCase().indexOf(q), bt = b.title.toLowerCase().indexOf(q);
        const rank = { person: 0, team: 1, territory: 2, account: 3 };
        if (q && (at === 0) !== (bt === 0)) return at === 0 ? -1 : 1;
        return rank[a.type] - rank[b.type] || a.title.localeCompare(b.title);
      })
      .slice(0, 40);
    state.paletteSel = Math.min(state.paletteSel, Math.max(0, rows.length - 1));

    return (
      '<div class="overlay" data-action="close-palette"><div class="palette" data-stop="1">' +
      '<input id="palette-input" placeholder="Search people, teams, territories, accounts, IDs…" value="' + u.attr(state.paletteQ) + '" autocomplete="off">' +
      '<div class="results">' +
      (rows.length
        ? rows.map((r, i) =>
            '<div class="res ' + (i === state.paletteSel ? 'on' : '') + '" data-goto="' + u.attr(r.href) + '" data-idx="' + i + '">' +
            (r.type === 'person' ? u.avatar(r.title, 'sm') : '<span class="avatar sm" style="background:var(--surface-3);color:var(--text-2)">' +
              (r.type === 'team' ? '⌗' : r.type === 'territory' ? '◎' : '◱') + '</span>') +
            '<span style="min-width:0"><span class="t">' + u.esc(r.title) + '</span><br>' +
            '<span class="s">' + u.esc(r.subtitle) + (r.meta ? ' · ' + u.esc(r.meta) : '') + '</span></span>' +
            '<span class="type">' + u.esc(r.type) + '</span></div>').join('')
        : '<div class="empty" style="padding:28px">Nothing matches “' + u.esc(state.paletteQ) + '”</div>') +
      '</div>' +
      '<div class="hint"><span><span class="kbd">↑↓</span> navigate</span><span><span class="kbd">↵</span> open</span>' +
      '<span><span class="kbd">esc</span> close</span></div>' +
      '</div></div>'
    );
  }

  /* ----------------------------------------------------------------- render */

  function render() {
    const view = store.view;
    const route = parseRoute();
    const ctx = { view, store, state: Object.assign(state, { policy: store.state.policy, hierarchy: store.state.hierarchy }), route };
    const root = document.getElementById('app');

    if (!store.state.signedIn) {
      root.innerHTML = loginScreen();
      return;
    }

    let body;
    switch (route.parts[0]) {
      case 'org': body = SOT.views.orgExplorer(ctx); break;
      case 'person': body = SOT.views.profile(ctx); break;
      case 'account': body = SOT.views.account(ctx); break;
      case 'integrity': body = SOT.views.integrity(ctx); break;
      case 'identity': body = SOT.views.identity(ctx); break;
      case 'metrics': body = SOT.views.metrics(ctx); break;
      case 'systems': body = SOT.views.systems(ctx); break;
      case 'tasks': body = SOT.views.tasks(ctx); break;
      case 'admin': body = SOT.views.admin(ctx); break;
      default: body = SOT.views.dashboard(ctx);
    }

    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const caret = focusId && active.selectionStart !== undefined ? active.selectionStart : null;

    root.innerHTML =
      '<div class="shell">' + sidebar(view, route) +
      '<main><div>' + topbar(view) + '</div><div class="content">' + body + '</div></main></div>' +
      palette(view) + SOT.views.drawer(ctx);

    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
    } else if (state.palette) {
      const el = document.getElementById('palette-input');
      if (el) el.focus();
    }
  }

  /* ------------------------------------------------------------- interaction */

  function go(href) {
    if (state.palette) { state.palette = false; state.paletteQ = ''; }
    state.drawer = null;
    if (href.slice(0, 1) === '#') location.hash = href;
    else location.hash = '#' + href;
    render();
  }

  document.addEventListener('click', (e) => {
    const stop = e.target.closest('[data-stop]');
    const closer = e.target.closest('[data-action="close-drawer"], [data-action="close-palette"]');

    const actionEl = e.target.closest('[data-action]');
    const action = actionEl ? actionEl.getAttribute('data-action') : null;

    // Overlay backgrounds close, clicks inside them do not.
    if ((action === 'close-drawer' || action === 'close-palette') && stop && !e.target.closest('button,a')) return;

    if (action) {
      const d = (k) => actionEl.getAttribute('data-' + k);
      switch (action) {
        case 'signin': store.signIn(d('role')); location.hash = SOT.model.ROLES.find((r) => r.id === d('role')).landing; render(); return;
        case 'signout': store.signOut(); render(); return;
        case 'palette': state.palette = true; state.paletteQ = ''; state.paletteSel = 0; render(); return;
        case 'close-palette': state.palette = false; render(); return;
        case 'close-drawer': state.drawer = null; if (e.target.closest('a[href]')) { setTimeout(render, 0); return; } render(); return;
        case 'org-mode': state.orgMode = d('mode'); render(); return;
        case 'org-issues': state.orgIssuesOnly = !state.orgIssuesOnly; render(); return;
        case 'tree-toggle': {
          e.stopPropagation();
          const id = d('id');
          const cur = state.treeOpen[id];
          const node = store.view.org.nodes[id];
          state.treeOpen[id] = cur === undefined ? false : !cur;
          if (node && node.depth >= 2 && cur === undefined) state.treeOpen[id] = true;
          render(); return;
        }
        case 'person-tab': {
          const r = parseRoute();
          go('#/person/' + r.parts[1] + '?tab=' + d('tab')); return;
        }
        case 'admin-tab': go('#/admin?tab=' + d('tab')); return;
        case 'prov-toggle': state.expanded[d('key')] = !state.expanded[d('key')]; render(); return;
        case 'integrity-chip': state.integrity[d('key')] = d('val'); render(); return;
        case 'integrity-filter': state.integrity[d('key')] = actionEl.value; render(); return;
        case 'metric-pick': state.metricId = d('id'); render(); return;
        case 'task-filter': state.tasks[d('key')] = d('val'); render(); return;
        case 'task-status': store.setTaskStatus(d('id'), d('status')); state.drawer = null; render(); return;
        case 'task-bulk': {
          const ids = store.view.tasks.filter((t) => t.status === 'open' && (t.severity === 'critical' || t.severity === 'high')).map((t) => t.id);
          store.bulkTaskStatus(ids, d('status')); render(); return;
        }
        case 'confirm-link': store.confirmLink(d('person'), d('system'), d('native')); render(); return;
        case 'dismiss-record': store.dismissRecord(d('system'), d('native')); render(); return;
        case 'admin-field': state.adminField = state.adminField === d('field') ? null : d('field'); render(); return;
        case 'promote': store.setSystemOfRecord(d('field'), d('system')); render(); return;
        case 'policy-reset': store.resetPolicy(); render(); return;
        case 'reset-all': store.resetAll(); state.adminField = null; render(); return;
        case 'hier-move': store.moveHierarchyLevel(Number(d('i')), Number(d('d'))); render(); return;
        case 'hier-remove': store.removeHierarchyLevel(Number(d('i'))); render(); return;
        case 'hier-add': {
          const f = SOT.model.FIELD_BY_KEY[d('key')];
          store.addHierarchyLevel({ key: f.key, label: f.label, source: (store.state.policy[f.key] || ['workday'])[0] });
          render(); return;
        }
        case 'role': return;
        default: break;
      }
    }

    const drawerEl = e.target.closest('[data-drawer]');
    if (drawerEl) { e.preventDefault(); state.drawer = drawerEl.getAttribute('data-drawer'); render(); return; }

    const orgPath = e.target.closest('[data-orgpath]');
    if (orgPath) { const v = orgPath.getAttribute('data-orgpath'); go('#/org' + (v ? '?' + v : '')); return; }

    const goEl = e.target.closest('[data-goto]');
    if (goEl && !e.target.closest('a[href]')) { e.preventDefault(); go(goEl.getAttribute('data-goto')); return; }

    if (closer && !stop) { state.drawer = null; state.palette = false; render(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'role') { store.setRole(el.value); render(); }
    if (action === 'integrity-filter') { state.integrity[el.getAttribute('data-key')] = el.value; render(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'palette-input') { state.paletteQ = e.target.value; state.paletteSel = 0; render(); }
    if (e.target.id === 'org-q') { state.orgQuery = e.target.value; render(); }
    if (e.target.id === 'integrity-q') { state.integrity.q = e.target.value; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!store.state.signedIn) return;
      state.palette = true; state.paletteSel = 0; render();
      return;
    }
    if (e.key === 'Escape') {
      if (state.palette) { state.palette = false; render(); return; }
      if (state.drawer) { state.drawer = null; render(); return; }
    }
    if (!state.palette) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = document.querySelectorAll('.palette .res');
      if (!items.length) return;
      state.paletteSel = (state.paletteSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
      const el = document.querySelectorAll('.palette .res')[state.paletteSel];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      const el = document.querySelectorAll('.palette .res')[state.paletteSel];
      if (el) go(el.getAttribute('data-goto'));
    }
  });

  // Exposed for the smoke test and for poking at the engine from the console.
  SOT.app = { store, state, render, parseRoute };

  window.addEventListener('hashchange', render);
  store.subscribe(() => {});

  render();
})(window.SOT || (window.SOT = {}));
