/* Source of Truth — dashboard, organization explorer, employee profile. */
(function (SOT) {
  'use strict';

  const U = () => SOT.ui;

  function levelValue(profile, key, company) {
    if (key === 'company') return company.name;
    return profile.get(key) || 'Unassigned';
  }

  /* ============================================================= DASHBOARD */

  function dashboard(ctx) {
    const u = U();
    const { view, store, state } = ctx;
    const people = store.visiblePeople();
    const ids = new Set(people.map((p) => p.person.id));
    const conflicts = view.conflicts.filter((c) => ids.has(c.personId));
    const openTasks = view.tasks.filter((t) => t.status === 'open' && (!t.personId || ids.has(t.personId)));
    const scoped = view.role.scope !== 'all';

    const active = people.filter((p) => p.get('employmentStatus') === 'Active').length;
    const managers = new Set(people.map((p) => p.get('managerId')).filter(Boolean)).size;
    const territories = new Set(people.map((p) => p.get('territory')).filter(Boolean)).size;
    const depts = new Set(people.map((p) => p.get('department')).filter(Boolean)).size;
    const avgAlign = people.length ? Math.round(people.reduce((s, p) => s + p.alignment, 0) / people.length) : 100;
    const critical = conflicts.filter((c) => c.severity === 'critical' || c.severity === 'high').length;

    const degraded = SOT.model.SYSTEMS.filter((s) => view.dataset.syncState[s.id].status !== 'healthy');

    /* -- organizational rollup by the first configured level below company -- */
    const level = state.hierarchy[1] || state.hierarchy[0];
    const groups = {};
    people.forEach((p) => {
      const k = levelValue(p, level.key, view.dataset.company);
      (groups[k] || (groups[k] = [])).push(p);
    });
    const rollup = Object.keys(groups).sort().map((k) => {
      const g = groups[k];
      const issues = view.conflicts.filter((c) => g.some((p) => p.person.id === c.personId) && c.actionable).length;
      const align = Math.round(g.reduce((s, p) => s + p.alignment, 0) / g.length);
      return { key: k, size: g.length, issues, align };
    });

    /* -- organizational change feed ---------------------------------------- */
    const changes = [];
    people.forEach((p) => {
      const f = p.fields.managerId;
      if (f && f.effectiveFrom && view.asOf - f.effectiveFrom < 45 * 86400000 && f.value) {
        const mgr = view.profiles[f.value];
        changes.push({
          ts: f.effectiveFrom,
          person: p,
          text: 'moved under ' + (mgr ? (mgr.get('fullName') || mgr.person.displayName) : 'a new manager'),
          tag: 'Reorganization',
        });
      }
      p.scheduledChanges.forEach((s) => {
        changes.push({
          ts: s.effectiveFrom,
          person: p,
          text: s.fieldLabel.toLowerCase() + ' becomes “' + s.value + '”',
          tag: 'Scheduled',
          future: true,
        });
      });
      if (p.get('employmentStatus') !== 'Active') {
        changes.push({ ts: view.asOf, person: p, text: 'terminated in Workday, still active elsewhere', tag: 'Exit', alarm: true });
      }
    });
    changes.sort((a, b) => b.ts - a.ts);

    const roleIntro = {
      exec: 'Whole-organization view. Every figure below is resolved from the connected systems under the current system-of-record policy.',
      revops: 'Revenue operations view. Territory, quota and ownership conflicts are surfaced first because they move money.',
      hr: 'People operations view. Worker records, positions and reporting lines, reconciled against every downstream system.',
      manager: 'Your reporting line only. Compensation figures are redacted at your permission level.',
    }[view.role.id];

    return (
      '<div class="page-head"><div><h1>' + u.esc(scoped && view.persona ? 'My organization' : view.dataset.company.name) + '</h1>' +
      '<div class="sub">' + u.esc(roleIntro) + '</div></div>' +
      '<div class="actions">' +
      '<span class="badge plain">As of ' + u.esc(u.date(view.asOf)) + '</span>' +
      '<a class="btn" href="#/integrity">Review data integrity</a></div></div>' +

      (degraded.length
        ? '<div class="banner warn" style="margin-bottom:14px"><span>⚠</span><div><b>' + u.esc(degraded[0].name) +
          ' connector is degraded.</b> ' + u.esc(view.dataset.syncState[degraded[0].id].message || '') +
          ' Values from it are ' + u.ago(view.dataset.syncState[degraded[0].id].lastSync, view.asOf) +
          ' and are being reported as lag rather than conflict. <a href="#/systems">Connector status</a></div></div>'
        : '') +

      '<div class="grid g-stats" style="margin-bottom:14px">' +
      u.stat('People', people.length, active + ' active · ' + (people.length - active) + ' exited') +
      u.stat('Departments', depts, territories + ' territories · ' + managers + ' managers') +
      u.stat('System alignment', avgAlign + '%', 'Weighted across ' + SOT.model.FIELDS.length + ' reconciled fields', avgAlign >= 90 ? 'good' : '') +
      u.stat('Open discrepancies', conflicts.filter((c) => c.actionable).length, critical + ' at high severity or above', critical ? 'alarm' : '') +
      u.stat('Remediation queue', openTasks.length, 'Assigned across RevOps and People Ops') +
      u.stat('Identity queue', view.identity.stats.needsReview, 'Seats awaiting a human decision') +
      '</div>' +

      '<div class="split">' +
      '<div class="grid" style="gap:14px">' +

      '<div class="card"><div class="card-head"><h3>' + u.esc(level.label) + ' rollup</h3>' +
      '<span class="sub">Resolved from ' + u.esc(SOT.model.SYSTEM_BY_ID[level.source] ? SOT.model.SYSTEM_BY_ID[level.source].name : 'the org graph') + '</span>' +
      '<div class="right"><a class="btn sm" href="#/org">Open explorer</a></div></div>' +
      '<div class="card-body tight"><div class="scroll-x"><table class="table">' +
      '<thead><tr><th>' + u.esc(level.label) + '</th><th class="num">People</th><th class="num">Open issues</th><th style="width:180px">Alignment</th></tr></thead><tbody>' +
      rollup.map((r) =>
        '<tr class="click" data-goto="#/org?' + encodeURIComponent(level.key) + '=' + encodeURIComponent(r.key) + '">' +
        '<td><b>' + u.esc(r.key) + '</b></td>' +
        '<td class="num">' + r.size + '</td>' +
        '<td class="num">' + (r.issues ? u.badge(String(r.issues), 'bad') : '<span style="color:var(--text-3)">0</span>') + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:9px"><div class="bar" style="flex:1"><i style="width:' + r.align +
        '%;background:' + (r.align >= 90 ? 'var(--ok)' : r.align >= 70 ? 'var(--warn)' : 'var(--bad)') + '"></i></div>' +
        '<span class="num" style="font-size:11.5px;color:var(--text-2);width:32px;text-align:right">' + r.align + '%</span></div></td></tr>'
      ).join('') +
      '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-head"><h3>Organizational change</h3>' +
      '<span class="sub">Last 45 days and scheduled</span></div><div class="card-body tight">' +
      (changes.length
        ? '<table class="table"><tbody>' + changes.slice(0, 8).map((c) =>
            '<tr class="click" data-goto="#/person/' + u.attr(c.person.person.id) + '">' +
            '<td style="width:44%">' + u.personLine(c.person) + '</td>' +
            '<td>' + u.esc(c.text) + '</td>' +
            '<td style="text-align:right;white-space:nowrap">' +
            u.badge(c.tag, c.alarm ? 'bad' : c.future ? 'info' : 'plain') +
            '<div style="font-size:11px;color:var(--text-3);margin-top:3px">' +
            u.esc(c.future ? 'from ' + u.date(c.ts) : u.ago(c.ts, view.asOf)) + '</div></td></tr>'
          ).join('') + '</tbody></table>'
        : u.empty('No organizational change recorded')) +
      '</div></div>' +

      '</div>' +

      /* --------------------------------------------------------- right rail */
      '<div class="grid" style="gap:14px">' +
      '<div class="card"><div class="card-head"><h3>Discrepancies by severity</h3></div><div class="card-body">' +
      ['critical', 'high', 'medium', 'low'].map((sev) => {
        const n = conflicts.filter((c) => c.severity === sev).length;
        const pct = conflicts.length ? Math.round((n / conflicts.length) * 100) : 0;
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">' +
          '<span style="width:64px">' + u.severityBadge(sev) + '</span>' +
          '<div class="bar" style="flex:1"><i style="width:' + pct + '%;background:var(--' +
          (sev === 'critical' || sev === 'high' ? 'bad' : sev === 'medium' ? 'warn' : 'info') + ')"></i></div>' +
          '<span class="num" style="width:26px;text-align:right;font-size:12px">' + n + '</span></div>';
      }).join('') +
      '<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:11px;font-size:11.5px;color:var(--text-2);line-height:1.55">' +
      '<b>' + view.stats.byKind.lag + '</b> further differences are classified as lag — a system that has not been read since the value changed. ' +
      'They are excluded from the queue because they resolve on the next sync.</div>' +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>Needs attention</h3><div class="right"><a class="btn sm" href="#/tasks">All tasks</a></div></div>' +
      '<div class="card-body tight">' +
      (openTasks.length
        ? '<table class="table"><tbody>' + openTasks.slice(0, 6).map((t) =>
            '<tr class="click" data-drawer="task:' + u.attr(t.id) + '"><td>' +
            '<div style="font-weight:550">' + u.esc(t.title) + '</div>' +
            '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">' + u.esc(t.personName) + '</div></td>' +
            '<td style="text-align:right">' + u.severityBadge(t.severity) + '</td></tr>'
          ).join('') + '</tbody></table>'
        : u.empty('Queue is clear')) +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>Connected systems</h3><div class="right"><a class="btn sm" href="#/systems">Details</a></div></div>' +
      '<div class="card-body tight"><table class="table"><tbody>' +
      SOT.model.SYSTEMS.map((s) => {
        const st = view.dataset.syncState[s.id];
        return '<tr><td>' + u.systemTag(s.id) + '</td>' +
          '<td style="text-align:right;font-size:11.5px;color:var(--text-3)">' + u.esc(u.ago(st.lastSync, view.asOf)) + '</td>' +
          '<td style="width:1%">' + u.badge(st.status === 'healthy' ? 'Healthy' : 'Degraded', st.status === 'healthy' ? 'ok' : 'warn', true) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>' +

      '</div></div>'
    );
  }

  /* ================================================== ORGANIZATION EXPLORER */

  function orgExplorer(ctx) {
    const u = U();
    const { view, store, state, route } = ctx;
    const company = view.dataset.company;
    const hierarchy = state.hierarchy;
    let people = store.visiblePeople();

    // The path is expressed in the URL so a drill-down is linkable.
    const path = [];
    for (let i = 1; i < hierarchy.length; i++) {
      const v = route.query[hierarchy[i].key];
      if (v === undefined) break;
      path.push({ level: hierarchy[i], value: v });
      people = people.filter((p) => levelValue(p, hierarchy[i].key, company) === v);
    }

    const q = (state.orgQuery || '').trim().toLowerCase();
    if (q) {
      people = people.filter((p) =>
        [p.get('fullName'), p.get('jobTitle'), p.get('team'), p.get('territory'), p.get('workEmail')]
          .filter(Boolean).join(' ').toLowerCase().includes(q)
      );
    }
    if (state.orgIssuesOnly) people = people.filter((p) => p.conflicts.some((c) => c.actionable));

    const nextLevel = hierarchy[path.length + 1];
    const crumbs =
      '<div class="crumbs">' +
      '<button data-orgpath="">' + u.esc(company.name) + '</button>' +
      path.map((p, i) =>
        '<span class="sep">›</span>' +
        (i === path.length - 1
          ? '<span class="cur">' + u.esc(p.value) + '</span>'
          : '<button data-orgpath="' + u.attr(path.slice(0, i + 1).map((x) => x.level.key + '=' + x.value).join('&')) + '">' + u.esc(p.value) + '</button>')
      ).join('') +
      '</div>';

    let body;
    if (state.orgMode === 'tree') {
      body = treeView(ctx, people);
    } else if (nextLevel && !q && !state.orgIssuesOnly) {
      const groups = {};
      people.forEach((p) => {
        const k = levelValue(p, nextLevel.key, company);
        (groups[k] || (groups[k] = [])).push(p);
      });
      const keys = Object.keys(groups).sort();
      body =
        '<div class="grid g-3">' +
        keys.map((k) => {
          const g = groups[k];
          const issues = g.reduce((s, p) => s + p.conflicts.filter((c) => c.actionable).length, 0);
          const align = Math.round(g.reduce((s, p) => s + p.alignment, 0) / g.length);
          const leads = g.filter((p) => view.org.nodes[p.person.id].reports.length > 0)
            .sort((a, b) => view.org.nodes[b.person.id].reports.length - view.org.nodes[a.person.id].reports.length);
          const href = path.map((x) => x.level.key + '=' + encodeURIComponent(x.value)).concat(nextLevel.key + '=' + encodeURIComponent(k)).join('&');
          return (
            '<button class="pcard" data-goto="#/org?' + u.attr(href) + '">' +
            '<span class="top"><span style="min-width:0;flex:1">' +
            '<span class="nm">' + u.esc(k) + '</span><br>' +
            '<span class="ti">' + g.length + ' people · ' + u.esc(nextLevel.label) + '</span></span>' +
            u.ring(align, 44) + '</span>' +
            '<span class="meta">' +
            (leads.length ? '<span class="m">Led by ' + u.esc(leads[0].get('fullName')) + '</span>' : '<span class="m">No manager resolved</span>') +
            '<span style="margin-left:auto">' + (issues ? u.badge(issues + ' open', 'bad') : u.badge('Clean', 'ok')) + '</span>' +
            '</span></button>'
          );
        }).join('') +
        '</div>';
    } else {
      body = people.length
        ? '<div class="grid g-people">' + people
            .sort((a, b) => (a.get('fullName') || '').localeCompare(b.get('fullName') || ''))
            .map((p) => u.personCard(p, view)).join('') + '</div>'
        : u.empty('Nobody matches', 'Try clearing the filters.');
    }

    return (
      '<div class="page-head"><div><h1>Organization explorer</h1>' +
      '<div class="sub">Drill through the hierarchy this tenant has configured — ' +
      u.esc(hierarchy.map((h) => h.label).join(' › ')) +
      '. Levels are configuration, not code; change them in <a href="#/admin?tab=hierarchy">Admin</a>.</div></div>' +
      '<div class="actions">' +
      '<input class="input" id="org-q" placeholder="Filter people…" value="' + u.attr(state.orgQuery || '') + '" style="width:180px">' +
      '<button class="chip ' + (state.orgIssuesOnly ? 'on' : '') + '" data-action="org-issues">Only with issues</button>' +
      '<div class="chips"><button class="chip ' + (state.orgMode !== 'tree' ? 'on' : '') + '" data-action="org-mode" data-mode="explore">Hierarchy</button>' +
      '<button class="chip ' + (state.orgMode === 'tree' ? 'on' : '') + '" data-action="org-mode" data-mode="tree">Reporting tree</button></div>' +
      '</div></div>' +
      crumbs +
      '<div style="margin-bottom:12px;font-size:12px;color:var(--text-3)">' + people.length + ' people in scope</div>' +
      body
    );
  }

  function treeView(ctx, people) {
    const u = U();
    const { view, state } = ctx;
    const inScope = new Set(people.map((p) => p.person.id));
    const roots = view.org.roots.filter((r) => inScope.has(r));
    // If the scope excludes the very top of the company, start from whoever in
    // scope has no manager inside it.
    const effectiveRoots = roots.length
      ? roots
      : people.filter((p) => !inScope.has(view.org.nodes[p.person.id].managerId)).map((p) => p.person.id);

    function node(id, depth) {
      const p = view.profiles[id];
      if (!p) return '';
      const kids = view.org.nodes[id].reports.filter((r) => inScope.has(r));
      const open = state.treeOpen[id] !== undefined ? state.treeOpen[id] : depth < 2;
      const issues = p.conflicts.filter((c) => c.actionable).length;
      const total = view.org.descendants(id).filter((d) => inScope.has(d)).length;
      return (
        '<div class="tree-node"><div class="tree-row" data-goto="#/person/' + u.attr(id) + '">' +
        (kids.length
          ? '<button class="tree-toggle" data-action="tree-toggle" data-id="' + u.attr(id) + '">' + (open ? '−' : '+') + '</button>'
          : '<span style="width:15px;flex:none"></span>') +
        u.avatar(p.get('fullName'), 'sm') +
        '<span class="tt">' + u.esc(p.get('fullName')) + '</span>' +
        '<span class="ts">' + u.esc(p.get('jobTitle') || '') + '</span>' +
        (total ? '<span class="badge plain">' + total + '</span>' : '') +
        (issues ? '<span class="badge bad">' + issues + '</span>' : '') +
        '</div>' +
        (kids.length && open ? '<div class="tree-kids">' + kids.map((k) => node(k, depth + 1)).join('') + '</div>' : '') +
        '</div>'
      );
    }

    return '<div class="card"><div class="card-body"><div class="tree">' +
      effectiveRoots.map((r) => node(r, 0)).join('') + '</div></div></div>';
  }

  /* ======================================================= EMPLOYEE PROFILE */

  function profile(ctx) {
    const u = U();
    const { view, store, state, route } = ctx;
    const p = view.profiles[route.parts[1]];
    if (!p) return '<div class="empty">That person is not in the resolved graph.</div>';

    const name = p.get('fullName') || p.person.displayName;
    const mgrId = p.get('managerId');
    const mgr = mgrId && view.profiles[mgrId];
    const terminated = p.get('employmentStatus') !== 'Active';
    const visible = new Set(store.visiblePeople().map((x) => x.person.id));
    if (!visible.has(p.person.id)) {
      return (
        '<div class="page-head"><h1>' + u.esc(name) + '</h1></div>' +
        '<div class="banner warn"><span>🔒</span><div><b>Outside your permission scope.</b> ' +
        'The ' + u.esc(view.role.name) + ' role can only see its own reporting line. ' +
        'Switch role in the top bar to view this profile.</div></div>'
      );
    }

    const tab = route.query.tab || 'overview';
    const openIssues = p.conflicts.filter((c) => c.actionable).length;

    const header =
      '<div class="card" style="margin-bottom:16px"><div class="card-body" style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">' +
      u.avatar(name, 'lg') +
      '<div style="flex:1;min-width:240px">' +
      '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">' +
      '<h1 style="font-size:21px">' + u.esc(name) + '</h1>' +
      (terminated ? u.badge('Terminated', 'bad', true) : u.badge('Active', 'ok', true)) +
      (p.get('workerType') && p.get('workerType') !== 'Employee' ? u.badge(p.get('workerType'), 'warn') : '') +
      p.person.flags.map((f) => u.badge(f.label, f.severity === 'critical' ? 'bad' : 'warn')).join('') +
      '</div>' +
      '<div style="color:var(--text-2);margin-top:3px">' + u.esc(p.get('jobTitle') || '—') +
      (p.get('team') ? ' · ' + u.esc(p.get('team')) : '') + '</div>' +
      '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:12.5px">' +
      [['Department', p.get('department')], ['Location', p.get('location')],
       ['Territory', p.get('territory')], ['Manager', mgr ? mgr.get('fullName') : '—'],
       ['Employee ID', p.get('employeeId')], ['Position ID', p.get('positionId')]]
        .map(([k, v]) => '<div><div style="color:var(--text-3);font-size:11px">' + u.esc(k) + '</div>' +
          '<div style="font-weight:550">' + u.esc(v || '—') + '</div></div>').join('') +
      '</div></div>' +
      '<div style="text-align:center">' + u.ring(p.alignment) +
      '<div style="font-size:11px;color:var(--text-3);margin-top:5px">System<br>alignment</div></div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border);padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span style="font-size:11.5px;color:var(--text-3);margin-right:4px">Open in</span>' +
      SOT.model.SYSTEMS.map((s) => {
        const link = (p.person.bySystem[s.id] || [])[0];
        return link
          ? u.systemLink(s.id, link.nativeId)
          : '<span class="btn sm" style="opacity:.4;cursor:default">' + u.esc(s.name) + ' — not linked</span>';
      }).join('') +
      (openIssues ? '<a class="btn sm primary" style="margin-left:auto" href="#/person/' + u.attr(p.person.id) + '?tab=integrity">' +
        openIssues + ' open ' + (openIssues === 1 ? 'discrepancy' : 'discrepancies') + '</a>' : '') +
      '</div></div>';

    const tabsHtml = u.tabs(
      [
        { id: 'overview', label: 'Overview' },
        { id: 'org', label: 'Organization' },
        { id: 'gtm', label: 'Go-to-market' },
        { id: 'systems', label: 'Systems', count: p.linkedSystems.length },
        { id: 'integrity', label: 'Data integrity', count: p.conflicts.length },
      ],
      tab,
      'person-tab'
    );

    const body =
      tab === 'org' ? profileOrg(ctx, p) :
      tab === 'gtm' ? profileGtm(ctx, p) :
      tab === 'systems' ? profileSystems(ctx, p) :
      tab === 'integrity' ? profileIntegrity(ctx, p) :
      profileOverview(ctx, p);

    return header + tabsHtml + body;
  }

  function fieldRowsFor(ctx, p, group) {
    const u = U();
    return SOT.model.FIELDS.filter((f) => f.group === group).map((f) => {
      const cell = p.fields[f.key];
      if (!cell || cell.absent) return '<dt>' + u.esc(f.label) + '</dt><dd style="color:var(--text-3)">—</dd>';
      if (!ctx.store.canSee(f.sensitivity))
        return '<dt>' + u.esc(f.label) + '</dt><dd style="color:var(--text-3)">🔒 Restricted at your permission level</dd>';
      const conflict = cell.conflict;
      return (
        '<dt>' + u.esc(f.label) + '</dt><dd>' + u.esc(u.fieldValue(f.key, cell.value, ctx.view)) +
        ' <span style="opacity:.62;font-size:11px">' + u.systemTag(cell.systemId, { short: true }) + '</span>' +
        (conflict ? ' ' + u.kindBadge(conflict.kind) : '') + '</dd>'
      );
    }).join('');
  }

  function profileOverview(ctx, p) {
    const u = U();
    const scheduled = p.scheduledChanges;
    return (
      '<div class="split">' +
      '<div class="grid" style="gap:14px">' +
      '<div class="card"><div class="card-head"><h3>Identity</h3><span class="sub">Resolved under the current policy</span></div>' +
      '<div class="card-body"><dl class="kv">' + fieldRowsFor(ctx, p, 'identity') + '</dl></div></div>' +
      '<div class="card"><div class="card-head"><h3>Position and organization</h3></div>' +
      '<div class="card-body"><dl class="kv">' + fieldRowsFor(ctx, p, 'org') + '</dl></div></div>' +
      '<div class="card"><div class="card-head"><h3>Go-to-market</h3></div>' +
      '<div class="card-body"><dl class="kv">' + fieldRowsFor(ctx, p, 'gtm') + '</dl></div></div>' +
      '</div>' +
      '<div class="grid" style="gap:14px">' +
      '<div class="card"><div class="card-head"><h3>Identity resolution</h3></div><div class="card-body">' +
      '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:10px">This person was assembled from ' +
      p.person.links.length + ' source records across ' + p.linkedSystems.length + ' systems.</div>' +
      '<table class="table" style="font-size:12px"><tbody>' +
      p.person.links.map((l) =>
        '<tr><td style="padding-left:0">' + u.systemTag(l.system) + '</td>' +
        '<td class="mono" style="color:var(--text-3)">' + u.esc(l.nativeId) + '</td>' +
        '<td style="text-align:right">' + u.badge(Math.round(l.confidence * 100) + '%', l.confidence >= 0.95 ? 'ok' : 'warn') + '</td></tr>' +
        '<tr><td colspan="3" style="padding:0 0 8px;font-size:11px;color:var(--text-3);border-bottom:1px solid var(--border)">' +
        u.esc(l.methodLabel) + '</td></tr>'
      ).join('') + '</tbody></table>' +
      (p.person.suggestions.length
        ? '<div class="banner info" style="margin-top:12px"><span>?</span><div><b>' + p.person.suggestions.length +
          ' possible additional ' + (p.person.suggestions.length === 1 ? 'record' : 'records') + '.</b> ' +
          '<a href="#/identity">Review in the identity queue</a></div></div>'
        : '') +
      '</div></div>' +
      (scheduled.length
        ? '<div class="card"><div class="card-head"><h3>Scheduled changes</h3></div><div class="card-body">' +
          '<div style="font-size:12px;color:var(--text-2);margin-bottom:10px">Future-dated in Workday. Deliberately not counted as discrepancies.</div>' +
          scheduled.map((s) =>
            '<div style="display:flex;gap:9px;align-items:baseline;margin-bottom:7px">' + u.badge(u.date(s.effectiveFrom), 'info') +
            '<div><b>' + u.esc(s.fieldLabel) + '</b> → ' + u.esc(String(s.value)) + '</div></div>').join('') +
          '</div></div>'
        : '') +
      '</div></div>'
    );
  }

  function profileOrg(ctx, p) {
    const u = U();
    const { view } = ctx;
    const id = p.person.id;
    const chain = view.org.chain(id).slice().reverse();
    const reports = view.org.nodes[id].reports;
    const mgrId = view.org.nodes[id].managerId;
    const peers = mgrId ? view.org.nodes[mgrId].reports.filter((r) => r !== id) : [];
    const total = view.org.descendants(id).length;

    const card = (title, list, emptyText) =>
      '<div class="card"><div class="card-head"><h3>' + u.esc(title) + '</h3>' +
      '<span class="sub">' + list.length + '</span></div><div class="card-body tight">' +
      (list.length
        ? '<table class="table"><tbody>' + list.map((rid) => {
            const r = view.profiles[rid];
            if (!r) return '';
            const iss = r.conflicts.filter((c) => c.actionable).length;
            return '<tr class="click" data-goto="#/person/' + u.attr(rid) + '"><td>' + u.personLine(r) + '</td>' +
              '<td style="text-align:right">' + (iss ? u.badge(iss + ' open', 'bad') : u.badge(r.alignment + '%', 'ok')) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty" style="padding:22px">' + u.esc(emptyText) + '</div>') +
      '</div></div>';

    return (
      '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Reporting line</h3>' +
      '<span class="sub">Resolved from ' + u.esc(SOT.model.SYSTEM_BY_ID[p.fields.managerId && p.fields.managerId.systemId ? p.fields.managerId.systemId : 'workday'].name) + '</span>' +
      (total ? '<div class="right"><span class="badge plain">' + total + ' in organization</span></div>' : '') +
      '</div><div class="card-body"><div class="crumbs" style="margin:0">' +
      chain.map((cid) => {
        const c = view.profiles[cid];
        return '<button data-goto="#/person/' + u.attr(cid) + '">' + u.esc(c.get('fullName')) + '</button><span class="sep">›</span>';
      }).join('') +
      '<span class="cur">' + u.esc(p.get('fullName')) + '</span></div>' +
      (p.fields.managerId && p.fields.managerId.conflict
        ? '<div class="banner bad" style="margin-top:12px"><span>!</span><div><b>Systems disagree on this reporting line.</b> ' +
          p.fields.managerId.conflict.offenders.map((o) =>
            SOT.model.SYSTEM_BY_ID[o.systemId].name + ' says ' +
            (o.value && view.profiles[o.value] ? view.profiles[o.value].get('fullName') : 'nobody')).join('; ') +
          '. <a href="#/person/' + u.attr(p.person.id) + '?tab=integrity">Inspect</a></div></div>'
        : '') +
      '</div></div>' +
      '<div class="grid g-2">' +
      card('Direct reports', reports, 'No direct reports.') +
      card('Peers', peers, 'No peers on this manager.') +
      '</div>'
    );
  }

  function profileGtm(ctx, p) {
    const u = U();
    const { view, store } = ctx;
    const ds = view.dataset;
    const sfLink = (p.person.bySystem.salesforce || [])[0];
    const accounts = sfLink ? ds.accounts.filter((a) => sfLink.record._rid && a.ownerRid === sfLink.record._rid) : [];
    const opps = sfLink ? ds.opportunities.filter((o) => sfLink.record._rid && o.ownerRid === sfLink.record._rid) : [];
    const gong = (p.person.bySystem.gong || [])[0];

    const fx = SOT.metrics.FX_TODAY;
    const pipeline = opps.reduce((s, o) => s + o.amountLocal * (fx[o.currency] || 1), 0);
    const weighted = opps.reduce((s, o) => s + o.amountLocal * (fx[o.currency] || 1) * o.probability, 0);
    const quota = p.get('quota');
    const canSeeQuota = store.canSee('restricted');

    if (!accounts.length && !opps.length && !gong) {
      return '<div class="card"><div class="card-body">' + u.empty('No go-to-market footprint', 'This person does not own accounts or pipeline in any connected system.') + '</div></div>';
    }

    return (
      '<div class="grid g-stats" style="margin-bottom:14px">' +
      u.stat('Open pipeline', u.money(pipeline), opps.length + ' opportunities') +
      u.stat('Weighted forecast', u.money(weighted), 'Amount × stage probability') +
      u.stat('Annual quota', canSeeQuota ? (quota ? u.money(quota) : '—') : '🔒', canSeeQuota ? (p.fields.quota && p.fields.quota.conflict ? 'Salesforce and Clari disagree' : 'Agreed across systems') : 'Restricted at your permission level') +
      u.stat('Coverage', canSeeQuota && quota ? (pipeline / quota).toFixed(1) + '×' : '—', 'Pipeline against quota') +
      u.stat('Accounts owned', accounts.length, u.money(accounts.reduce((s, a) => s + a.arr, 0)) + ' ARR') +
      (gong
        ? u.stat('Calls (30d)', gong.record.callsLast30, gong.record.meetingsLast30 + ' meetings · ' + gong.record.talkRatioPct + '% talk ratio')
        : u.stat('Calls (30d)', '—', 'No Gong seat linked')) +
      '</div>' +

      (p.get('employmentStatus') !== 'Active' && accounts.length
        ? '<div class="banner bad" style="margin-bottom:14px"><span>!</span><div><b>' + accounts.length +
          ' accounts are owned by a terminated worker.</b> ' + u.money(accounts.reduce((s, a) => s + a.arr, 0)) +
          ' of ARR has no active owner, and the Salesforce user is still able to log in.</div></div>'
        : '') +

      '<div class="split">' +
      '<div class="card"><div class="card-head"><h3>Open opportunities</h3><span class="sub">' + opps.length + '</span>' +
      '<div class="right">' + (sfLink ? u.systemLink('salesforce', sfLink.nativeId) : '') + '</div></div>' +
      '<div class="card-body tight"><div class="scroll-x"><table class="table">' +
      '<thead><tr><th>Opportunity</th><th>Stage</th><th>Close</th><th>Type</th><th class="num">Amount</th></tr></thead><tbody>' +
      (opps.length
        ? opps.sort((a, b) => a.closeDate - b.closeDate).slice(0, 14).map((o) =>
            '<tr><td>' + u.esc(o.name) + '</td><td style="white-space:nowrap">' + u.esc(o.stageName) + '</td>' +
            '<td style="white-space:nowrap">' + u.esc(u.date(o.closeDate)) + '</td>' +
            '<td>' + u.esc(o.recordType) + '</td>' +
            '<td class="num">' + u.money(o.amountLocal * (fx[o.currency] || 1)) +
            (o.currency !== 'USD' ? '<div style="font-size:10.5px;color:var(--text-3)">' + o.currency + ' ' + o.amountLocal.toLocaleString('en-US') + '</div>' : '') +
            '</td></tr>').join('')
        : '<tr><td colspan="5"><div class="empty" style="padding:20px">No open opportunities</div></td></tr>') +
      '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-head"><h3>Accounts</h3><span class="sub">' + accounts.length + '</span></div>' +
      '<div class="card-body tight"><table class="table"><tbody>' +
      (accounts.length
        ? accounts.sort((a, b) => b.arr - a.arr).slice(0, 12).map((a) =>
            '<tr class="click" data-goto="#/account/' + u.attr(a.id) + '"><td>' + u.esc(a.name) +
            '<div style="font-size:11px;color:var(--text-3)">Renews ' + u.esc(u.date(a.renewalDate)) + '</div></td>' +
            '<td class="num">' + u.money(a.arr) + '</td></tr>').join('')
        : '<tr><td><div class="empty" style="padding:20px">No accounts</div></td></tr>') +
      '</tbody></table></div></div>' +
      '</div>'
    );
  }

  function profileSystems(ctx, p) {
    const u = U();
    return (
      '<div class="grid g-2">' +
      SOT.model.SYSTEMS.map((s) => {
        const links = p.person.bySystem[s.id] || [];
        const sync = ctx.view.dataset.syncState[s.id];
        if (!links.length) {
          return '<div class="card"><div class="card-head">' + u.systemTag(s.id) +
            '<div class="right">' + u.badge('Not linked', 'warn') + '</div></div>' +
            '<div class="card-body" style="color:var(--text-3);font-size:12.5px">' +
            'No record in ' + u.esc(s.name) + ' resolves to this person. ' +
            (ctx.view.identity.unresolved.some((x) => x.system === s.id)
              ? 'There are unmatched ' + u.esc(s.name) + ' seats in the <a href="#/identity">identity queue</a>.'
              : '') +
            '</div></div>';
        }
        return links.map((l) => {
          const rec = l.record;
          const rows = Object.keys(rec)
            .filter((k) => k[0] !== '_' && k !== 'observedAt' && rec[k] !== null && rec[k] !== undefined && typeof rec[k] !== 'object')
            .slice(0, 14);
          return (
            '<div class="card"><div class="card-head">' + u.systemTag(s.id) +
            '<span class="sub">' + u.esc(s.idLabel) + ' ' + u.esc(l.nativeId) + '</span>' +
            '<div class="right">' + u.badge(Math.round(l.confidence * 100) + '% match', l.confidence >= 0.95 ? 'ok' : 'warn') +
            u.systemLink(s.id, l.nativeId) + '</div></div>' +
            '<div class="card-body"><dl class="kv">' +
            rows.map((k) => {
              let v = rec[k];
              if (/date|Date|lastLogin|lastActivity|effectiveFrom/.test(k) && typeof v === 'number' && v > 1e11) v = u.date(v);
              if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
              if (typeof v === 'number' && /quota|amount|arr/i.test(k)) v = '$' + v.toLocaleString('en-US');
              return '<dt>' + u.esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())) + '</dt><dd>' + u.esc(v) + '</dd>';
            }).join('') +
            '</dl>' +
            '<div style="margin-top:11px;padding-top:10px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-3)">' +
            'Matched by ' + u.esc(l.methodLabel.toLowerCase()) + ' · read ' + u.esc(u.ago(sync.lastSync, ctx.view.asOf)) +
            '</div></div></div>'
          );
        }).join('');
      }).join('') +
      '</div>'
    );
  }

  function profileIntegrity(ctx, p) {
    const u = U();
    const { view, state } = ctx;
    const rows = SOT.model.FIELDS.map((f) => p.fields[f.key]).filter((c) => c && !c.absent);
    const conflicted = rows.filter((r) => r.conflict);
    const clean = rows.length - conflicted.length;

    const icon = (cell) => {
      if (!cell.conflict) return '<span style="color:var(--ok)">●</span>';
      return { divergence: '<span style="color:var(--bad)">●</span>', gap: '<span style="color:var(--warn)">●</span>', lag: '<span style="color:var(--info)">●</span>' }[cell.conflict.kind];
    };

    return (
      '<div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">' +
      u.ring(p.alignment, 76) +
      '<div style="flex:1;min-width:260px">' +
      '<h3 style="font-size:15px">System alignment ' + p.alignment + '%</h3>' +
      '<div style="color:var(--text-2);font-size:12.5px;margin-top:4px;max-width:70ch">' +
      clean + ' of ' + rows.length + ' reconciled fields agree across every system that carries them. ' +
      'The score is weighted: a disputed reporting line costs far more than a stale office location, and lag counts as a third of a divergence.' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">' +
      u.badge(clean + ' aligned', 'ok', true) +
      u.badge(conflicted.filter((c) => c.conflict.kind === 'divergence').length + ' divergent', 'bad', true) +
      u.badge(conflicted.filter((c) => c.conflict.kind === 'gap').length + ' gaps', 'warn', true) +
      u.badge(conflicted.filter((c) => c.conflict.kind === 'lag').length + ' lagging', 'info', true) +
      '</div></div></div></div>' +

      '<div class="prov">' +
      rows.map((cell) => {
        const f = cell.field;
        const open = !!state.expanded['prov:' + p.person.id + ':' + f.key];
        const c = cell.conflict;
        const redacted = !ctx.store.canSee(f.sensitivity);
        return (
          '<div class="prov-row">' +
          '<button class="prov-head" data-action="prov-toggle" data-key="prov:' + u.attr(p.person.id) + ':' + u.attr(f.key) + '">' +
          '<span>' + icon(cell) + '</span>' +
          '<span class="fname">' + u.esc(f.label) + '</span>' +
          '<span class="fval">' + (redacted ? '<span style="color:var(--text-3)">🔒 Restricted</span>' : u.esc(u.fieldValue(f.key, cell.value, view))) + '</span>' +
          '<span class="fsrc">' + u.systemTag(cell.systemId, { short: true }) + '</span>' +
          '<span>' + (c ? u.kindBadge(c.kind) : u.badge('Aligned', 'ok')) + '</span>' +
          '</button>' +
          (open
            ? '<div class="prov-body"><table><tbody>' +
              cell.assertions.map((a) =>
                '<tr><td style="width:150px">' + u.systemTag(a.systemId) + '</td>' +
                '<td><b>' + (redacted ? '🔒' : u.esc(u.fieldValue(f.key, a.value, view))) + '</b></td>' +
                '<td style="text-align:right;color:var(--text-3);font-size:11px">read ' + u.esc(u.ago(a.observedAt, view.asOf)) +
                (a.effectiveDating ? ' · effective ' + u.esc(u.date(a.effectiveFrom)) : '') + '</td>' +
                '<td style="text-align:right;width:90px">' +
                (a.systemId === cell.systemId ? u.badge('System of record', 'accent') :
                  SOT.resolve.sameValue(a.value, cell.value) ? u.badge('Agrees', 'ok') : u.badge('Differs', 'bad')) +
                '</td></tr>').join('') +
              (c ? c.offenders.filter((o) => o.kind === 'gap').map((o) =>
                '<tr><td>' + u.systemTag(o.systemId) + '</td><td style="color:var(--text-3)">empty</td>' +
                '<td colspan="2" style="text-align:right">' + u.badge('Gap', 'warn') + '</td></tr>').join('') : '') +
              '</tbody></table>' +
              '<div class="prov-note">' +
              (c
                ? '<b>' + u.esc(SOT.model.CONFLICT_KINDS[c.kind].label) + '.</b> ' + u.esc(SOT.model.CONFLICT_KINDS[c.kind].blurb) +
                  (c.kind === 'lag'
                    ? ' No action required — it will reconcile on the next successful sync.'
                    : ' <a href="#" data-drawer="conflict:' + u.attr(c.id) + '">Investigate and raise a fix</a>.')
                : 'Every system carrying this field reports the same value. Policy: ' +
                  u.esc((ctx.state.policy[f.key] || []).map((s) => SOT.model.SYSTEM_BY_ID[s].name).join(' → '))) +
              '</div></div>'
            : '') +
          '</div>'
        );
      }).join('') +
      '</div>'
    );
  }

  /* ============================================================== ACCOUNT */

  function account(ctx) {
    const u = U();
    const { view, route } = ctx;
    const acc = view.dataset.accounts.find((a) => a.id === route.parts[1]);
    if (!acc) return '<div class="empty">Account not found.</div>';
    const owner = Object.values(view.profiles).find((p) => {
      const l = (p.person.bySystem.salesforce || [])[0];
      return l && l.record._rid === acc.ownerRid;
    });
    const opps = view.dataset.opportunities.filter((o) => o.accountId === acc.id);
    const fx = SOT.metrics.FX_TODAY;
    const orphaned = owner && owner.get('employmentStatus') !== 'Active';

    return (
      '<div class="page-head"><div><h1>' + u.esc(acc.name) + '</h1>' +
      '<div class="sub">' + u.esc(acc.segment) + ' · ' + u.esc(acc.territory || 'No territory') + ' · ' + u.money(acc.arr) + ' ARR</div></div>' +
      '<div class="actions">' + u.systemLink('salesforce', acc.id) + '</div></div>' +
      (orphaned
        ? '<div class="banner bad" style="margin-bottom:14px"><span>!</span><div><b>Owned by a terminated worker.</b> ' +
          u.esc(owner.get('fullName')) + ' is terminated in Workday but still the active Salesforce owner of this account.</div></div>'
        : '') +
      '<div class="split"><div class="card"><div class="card-head"><h3>Opportunities</h3><span class="sub">' + opps.length + '</span></div>' +
      '<div class="card-body tight"><table class="table"><thead><tr><th>Name</th><th>Stage</th><th>Close</th><th class="num">Amount</th></tr></thead><tbody>' +
      (opps.length ? opps.map((o) =>
        '<tr><td>' + u.esc(o.name) + '</td><td>' + u.esc(o.stageName) + '</td><td>' + u.esc(u.date(o.closeDate)) + '</td>' +
        '<td class="num">' + u.money(o.amountLocal * (fx[o.currency] || 1)) + '</td></tr>').join('')
        : '<tr><td colspan="4"><div class="empty" style="padding:20px">No open opportunities</div></td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-head"><h3>Owner</h3></div><div class="card-body">' +
      (owner
        ? '<div class="pcard" data-goto="#/person/' + u.attr(owner.person.id) + '" style="cursor:pointer">' + u.personLine(owner) + '</div>'
        : '<div style="color:var(--text-3)">No resolved owner.</div>') +
      '<dl class="kv" style="margin-top:14px">' +
      '<dt>Account ID</dt><dd class="mono">' + u.esc(acc.id) + '</dd>' +
      '<dt>Renewal</dt><dd>' + u.esc(u.date(acc.renewalDate)) + '</dd>' +
      '<dt>Territory</dt><dd>' + u.esc(acc.territory || '—') + '</dd>' +
      '</dl></div></div></div>'
    );
  }

  SOT.views = Object.assign(SOT.views || {}, { dashboard, orgExplorer, profile, account });
})(window.SOT || (window.SOT = {}));
