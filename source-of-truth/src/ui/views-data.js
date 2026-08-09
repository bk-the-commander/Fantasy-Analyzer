/* Source of Truth — integrity centre, identity queue, metrics, systems,
 * remediation and administration. */
(function (SOT) {
  'use strict';

  const U = () => SOT.ui;

  /* ====================================================== DATA INTEGRITY */

  function integrity(ctx) {
    const u = U();
    const { view, store, state } = ctx;
    const f = state.integrity;
    const visible = new Set(store.visiblePeople().map((p) => p.person.id));

    let rows = view.conflicts.filter((c) => visible.has(c.personId));
    const all = rows.slice();
    if (f.severity !== 'all') rows = rows.filter((c) => c.severity === f.severity);
    if (f.kind !== 'all') rows = rows.filter((c) => c.kind === f.kind);
    if (f.system !== 'all') rows = rows.filter((c) => c.systems.indexOf(f.system) >= 0);
    if (f.field !== 'all') rows = rows.filter((c) => c.field === f.field);
    if (f.dept !== 'all') rows = rows.filter((c) => (view.profiles[c.personId].get('department') || '') === f.dept);
    if (f.q) {
      const q = f.q.toLowerCase();
      rows = rows.filter((c) => (c.personName + ' ' + c.fieldLabel).toLowerCase().includes(q));
    }

    const depts = Array.from(new Set(Object.values(view.profiles).map((p) => p.get('department')).filter(Boolean))).sort();
    const fields = Array.from(new Set(all.map((c) => c.field)));

    const sel = (id, label, value, options) =>
      '<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3)">' + u.esc(label) +
      '<select class="input" data-action="integrity-filter" data-key="' + id + '">' +
      options.map((o) => '<option value="' + u.attr(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + u.esc(o[1]) + '</option>').join('') +
      '</select></label>';

    return (
      '<div class="page-head"><div><h1>Data integrity</h1>' +
      '<div class="sub">Every field where the connected systems do not agree, classified by <b>why</b> they disagree. ' +
      'Lag is separated from divergence deliberately: a system that has not been read since the value changed is behind, not wrong, ' +
      'and putting it in the same queue is how these reports get ignored.</div></div>' +
      '<div class="actions"><a class="btn" href="#/tasks">Remediation queue</a>' +
      '<a class="btn" href="#/admin">Systems of record</a></div></div>' +

      '<div class="grid g-stats" style="margin-bottom:14px">' +
      u.stat('Total findings', all.length, 'Across ' + new Set(all.map((c) => c.personId)).size + ' people') +
      u.stat('Divergence', all.filter((c) => c.kind === 'divergence').length, 'Both systems current and disagreeing', 'alarm') +
      u.stat('Gaps', all.filter((c) => c.kind === 'gap').length, 'Field empty where it should be populated') +
      u.stat('Lag', all.filter((c) => c.kind === 'lag').length, 'Resolves on next sync — not queued', 'good') +
      u.stat('High severity+', all.filter((c) => c.severity === 'critical' || c.severity === 'high').length, 'Money, access or reporting-line impact') +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">' +
      '<div class="chips">' +
      ['all', 'critical', 'high', 'medium', 'low'].map((s) =>
        '<button class="chip ' + (f.severity === s ? 'on' : '') + '" data-action="integrity-chip" data-key="severity" data-val="' + s + '">' +
        (s === 'all' ? 'All severities' : s[0].toUpperCase() + s.slice(1)) + '</button>').join('') +
      '</div>' +
      '<div class="chips">' +
      ['all', 'divergence', 'gap', 'lag'].map((k) =>
        '<button class="chip ' + (f.kind === k ? 'on' : '') + '" data-action="integrity-chip" data-key="kind" data-val="' + k + '">' +
        (k === 'all' ? 'All kinds' : k[0].toUpperCase() + k.slice(1)) + '</button>').join('') +
      '</div>' +
      sel('system', 'System', f.system, [['all', 'Any']].concat(SOT.model.SYSTEMS.map((s) => [s.id, s.name]))) +
      sel('field', 'Field', f.field, [['all', 'Any']].concat(fields.map((k) => [k, SOT.model.FIELD_BY_KEY[k].label]))) +
      sel('dept', 'Department', f.dept, [['all', 'Any']].concat(depts.map((d) => [d, d]))) +
      '<input class="input" id="integrity-q" placeholder="Search person or field…" value="' + u.attr(f.q) + '" style="min-width:180px;flex:1">' +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>' + rows.length + ' findings</h3>' +
      '<div class="right"><span class="sub">Sorted by severity</span></div></div>' +
      '<div class="card-body tight"><div class="scroll-x">' +
      (rows.length
        ? '<table class="table"><thead><tr>' +
          '<th>Person</th><th>Field</th><th>Resolved value</th><th>Conflicting</th><th>Kind</th><th>Severity</th><th></th>' +
          '</tr></thead><tbody>' +
          rows.slice(0, 200).map((c) =>
            '<tr class="click" data-drawer="conflict:' + u.attr(c.id) + '">' +
            '<td>' + u.personLine(view.profiles[c.personId]) + '</td>' +
            '<td>' + u.esc(c.fieldLabel) + '</td>' +
            '<td><b>' + u.esc(u.fieldValue(c.field, c.resolvedValue, view)) + '</b><br>' +
            '<span style="font-size:11px;color:var(--text-3)">' + u.esc(SOT.model.SYSTEM_BY_ID[c.resolvedSystem].name) + '</span></td>' +
            '<td>' + c.offenders.map((o) =>
              '<div style="font-size:11.5px">' + u.systemTag(o.systemId, { short: true }) + ' ' +
              (o.kind === 'gap' ? '<i style="color:var(--text-3)">empty</i>' : u.esc(u.fieldValue(c.field, o.value, view))) + '</div>').join('') + '</td>' +
            '<td>' + u.kindBadge(c.kind) + '</td>' +
            '<td>' + u.severityBadge(c.severity) + '</td>' +
            '<td style="text-align:right"><span class="btn sm">Investigate</span></td></tr>'
          ).join('') + '</tbody></table>'
        : u.empty('No findings match these filters')) +
      '</div></div></div>'
    );
  }

  /* ================================================== IDENTITY RESOLUTION */

  function identity(ctx) {
    const u = U();
    const { view } = ctx;
    const id = view.identity;
    const flagged = id.people.filter((p) => p.flags.length);

    return (
      '<div class="page-head"><div><h1>Identity resolution</h1>' +
      '<div class="sub">Before anything can be reconciled, the platform has to know that a Salesforce user, a Workday worker and a Gong seat ' +
      'are the same human being. Strong matches are applied automatically; anything uncertain waits here rather than being guessed at. ' +
      'A wrong match does not produce a small error — it produces a confident lie about someone.</div></div></div>' +

      '<div class="grid g-stats" style="margin-bottom:14px">' +
      u.stat('Source records', id.stats.sourceRecords, 'Across ' + SOT.model.SYSTEMS.length + ' connected systems') +
      u.stat('People resolved', id.stats.people, 'Clusters with a worker record or an active CRM seat') +
      u.stat('Links applied', id.stats.autoLinked, 'Confidence ≥ ' + Math.round(id.thresholds.AUTO_LINK * 100) + '%') +
      u.stat('Awaiting review', id.stats.needsReview, 'Below the automatic threshold', id.stats.needsReview ? 'alarm' : 'good') +
      u.stat('Flagged people', flagged.length, 'Duplicates and missing HR records') +
      '</div>' +

      '<div class="split"><div class="grid" style="gap:14px">' +

      '<div class="card"><div class="card-head"><h3>Review queue</h3>' +
      '<span class="sub">' + id.unresolved.length + ' seats</span></div><div class="card-body tight">' +
      (id.unresolved.length
        ? '<table class="table"><thead><tr><th>Seat</th><th>System</th><th>Proposed match</th><th></th></tr></thead><tbody>' +
          id.unresolved.map((row) => {
            const s = row.suggestions[0];
            return '<tr><td><b>' + u.esc(row.name || '—') + '</b>' +
              '<div class="mono" style="color:var(--text-3)">' + u.esc(row.email || row.nativeId) + '</div></td>' +
              '<td>' + u.systemTag(row.system) + '</td>' +
              '<td>' + (s
                ? '<div style="display:flex;align-items:center;gap:7px">' + u.badge(Math.round(s.score * 100) + '%', 'warn') +
                  '<a href="#/person/' + u.attr(s.personId) + '">' + u.esc(s.personName) + '</a></div>' +
                  '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + u.esc(s.methodLabel) + '</div>'
                : '<span style="color:var(--text-3)">No candidate above ' + Math.round(id.thresholds.REVIEW * 100) + '%</span>') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' +
              (s ? '<button class="btn sm primary" data-action="confirm-link" data-person="' + u.attr(s.personId) +
                '" data-system="' + u.attr(row.system) + '" data-native="' + u.attr(row.nativeId) + '">Confirm</button> ' : '') +
              '<button class="btn sm" data-action="dismiss-record" data-system="' + u.attr(row.system) +
              '" data-native="' + u.attr(row.nativeId) + '">Not a person</button></td></tr>';
          }).join('') + '</tbody></table>'
        : u.empty('Queue is clear', 'Every source record is either linked to a person or explicitly set aside.')) +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>Flagged people</h3><span class="sub">' + flagged.length + '</span></div>' +
      '<div class="card-body tight">' +
      (flagged.length
        ? '<table class="table"><tbody>' + flagged.map((p) =>
            '<tr class="click" data-goto="#/person/' + u.attr(p.id) + '">' +
            '<td>' + u.personLine(view.profiles[p.id]) + '</td>' +
            '<td>' + p.flags.map((f) => u.badge(f.label, f.severity === 'critical' ? 'bad' : 'warn')).join(' ') + '</td>' +
            '</tr>').join('') + '</tbody></table>'
        : u.empty('No flags')) +
      '</div></div></div>' +

      '<div class="card"><div class="card-head"><h3>Matching rules</h3></div><div class="card-body">' +
      '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">Rules are scored, not boolean. Anything at or above ' +
      Math.round(id.thresholds.AUTO_LINK * 100) + '% links automatically; between ' + Math.round(id.thresholds.REVIEW * 100) +
      '% and that, a human decides; below, it is not a match.</div>' +
      '<table class="table" style="font-size:12px"><tbody>' +
      Object.keys(id.rules).map((k) =>
        '<tr><td style="padding-left:0"><b>' + u.esc(id.rules[k].label) + '</b></td>' +
        '<td style="text-align:right">' + u.badge(Math.round(id.rules[k].score * 100) + '%', id.rules[k].score >= id.thresholds.AUTO_LINK ? 'ok' : 'warn') + '</td></tr>').join('') +
      '</tbody></table>' +
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-3);line-height:1.6">' +
      'Production would add fuzzy name distance, historical email aliases, HRIS-to-CRM provisioning logs and manual overrides. ' +
      'The architecture is unchanged: rules produce scores, scores produce links, and everything uncertain becomes a queue instead of an assumption.' +
      '</div></div></div>' +
      '</div>'
    );
  }

  /* ============================================================== METRICS */

  function metrics(ctx) {
    const u = U();
    const { view, state } = ctx;
    const m = view.metrics.find((x) => x.id === (state.metricId || 'pipeline')) || view.metrics[0];
    const isMoney = m.id === 'pipeline';
    const fmt = (n) => (isMoney ? u.money(n, { signed: true }) : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n));
    const peak = Math.max.apply(null, m.waterfall.map((w) => Math.abs(w.value)));

    return (
      '<div class="page-head"><div><h1>Metric reconciliation</h1>' +
      '<div class="sub">The fourth question — <b>why don’t these numbers match?</b> Each figure below is recomputed from the same ' +
      'underlying records by applying each system’s own filters in sequence, so the bridge reconciles exactly rather than being narrated.</div></div>' +
      '<div class="actions"><div class="chips">' +
      view.metrics.map((x) =>
        '<button class="chip ' + (x.id === m.id ? 'on' : '') + '" data-action="metric-pick" data-id="' + u.attr(x.id) + '">' +
        u.esc(x.name) + '</button>').join('') +
      '</div></div></div>' +

      '<div class="banner info" style="margin-bottom:14px"><span>?</span><div><b>' + u.esc(m.question) + '</b></div></div>' +

      '<div class="grid g-3" style="margin-bottom:14px">' +
      m.definitions.map((d) =>
        '<div class="card"><div class="card-head">' + u.systemTag(d.system) +
        '<div class="right"><span class="sub">' + d.count + ' records</span></div></div>' +
        '<div class="card-body">' +
        '<div style="font-size:26px;font-weight:640;letter-spacing:-.03em;font-variant-numeric:tabular-nums">' +
        (isMoney ? u.money(d.total) : d.total) + '</div>' +
        '<div style="font-size:12px;color:var(--text-2);margin-top:2px">' + u.esc(d.label) + '</div>' +
        '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + u.esc(d.artefact) + '</div>' +
        '<ul style="margin:12px 0 0;padding-left:16px;font-size:11.5px;color:var(--text-2);line-height:1.65">' +
        d.filters.map((x) => '<li>' + u.esc(x) + '</li>').join('') + '</ul>' +
        '</div></div>').join('') +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Reconciliation bridge</h3>' +
      '<span class="sub">Every term computed, none asserted</span></div><div class="card-body"><div class="wf">' +
      m.waterfall.map((w) => {
        const total = w.type === 'start' || w.type === 'end' || w.type === 'subtotal';
        const width = peak ? Math.max(1.5, (Math.abs(w.value) / peak) * 100) : 0;
        const colour = total ? 'var(--text-3)' : w.value < 0 ? 'var(--bad)' : 'var(--ok)';
        return (
          '<div class="wf-row ' + (total ? 'total' : '') + '">' +
          '<div class="lb">' + u.esc(w.label) + '</div>' +
          '<div class="wf-bar"><i style="width:' + width + '%;background:' + colour + ';opacity:' + (total ? '.35' : '.85') + '"></i></div>' +
          '<div class="amt ' + (total ? '' : w.value < 0 ? 'neg' : 'pos') + '">' +
          (total ? (isMoney ? u.money(w.value) : w.value) : fmt(w.value)) + '</div>' +
          (w.reason ? '<div class="wf-why">' + u.esc(w.reason) + '</div>' : '') +
          '</div>'
        );
      }).join('') +
      '</div>' +
      (m.unexplained !== 0
        ? '<div class="banner bad" style="margin-top:12px"><span>!</span><div><b>Unexplained residual: ' +
          (isMoney ? u.money(m.unexplained) : m.unexplained) + '.</b> The known definition differences do not fully account for the gap.</div></div>'
        : '<div class="banner ok" style="margin-top:12px;background:var(--ok-soft);color:var(--ok);border-color:color-mix(in srgb, var(--ok) 24%, transparent)">' +
          '<span>✓</span><div><b>Fully reconciled.</b> No unexplained residual.</div></div>') +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>Verdict</h3></div><div class="card-body" style="font-size:13px;line-height:1.65;color:var(--text-2);max-width:90ch">' +
      u.esc(m.verdict) + '</div></div>'
    );
  }

  /* ============================================================== SYSTEMS */

  function systems(ctx) {
    const u = U();
    const { view, state } = ctx;
    const ds = view.dataset;

    return (
      '<div class="page-head"><div><h1>Connected systems</h1>' +
      '<div class="sub">Six simulated connectors. No live credentials are used anywhere in this prototype and no real data is read — ' +
      'each connector is a fixture behind the same adapter interface a production integration would implement.</div></div></div>' +

      '<div class="grid g-3">' +
      SOT.model.SYSTEMS.map((s) => {
        const st = ds.syncState[s.id];
        const sorFields = SOT.model.FIELDS.filter((f) => (state.policy[f.key] || [])[0] === s.id);
        const involved = view.conflicts.filter((c) => c.systems.indexOf(s.id) >= 0).length;
        const linked = view.identity.people.filter((p) => p.bySystem[s.id]).length;
        return (
          '<div class="card"><div class="card-head">' +
          '<i class="sysdot" style="width:10px;height:10px;background:' + s.color + '"></i>' +
          '<h3>' + u.esc(s.name) + '</h3>' +
          '<div class="right">' + u.badge(st.status === 'healthy' ? 'Connected' : 'Degraded', st.status === 'healthy' ? 'ok' : 'warn', true) + '</div></div>' +
          '<div class="card-body">' +
          '<div style="font-size:11.5px;color:var(--text-3);margin-bottom:12px">' + u.esc(s.category) + ' · ' + u.esc(s.blurb) + '</div>' +
          '<dl class="kv">' +
          '<dt>Last sync</dt><dd>' + u.esc(u.ago(st.lastSync, view.asOf)) + '</dd>' +
          '<dt>Cadence</dt><dd>' + u.esc(s.syncCadence) + '</dd>' +
          '<dt>Records</dt><dd class="num">' + ds.recordCounts[s.id].toLocaleString('en-US') + '</dd>' +
          '<dt>People linked</dt><dd class="num">' + linked + '</dd>' +
          '<dt>System of record for</dt><dd>' + (sorFields.length ? u.esc(sorFields.map((f) => f.label).join(', ')) : '<span style="color:var(--text-3)">Nothing — corroboration only</span>') + '</dd>' +
          '<dt>In conflicts</dt><dd>' + (involved ? u.badge(involved + ' findings', 'warn') : u.badge('None', 'ok')) + '</dd>' +
          '</dl>' +
          (st.message ? '<div class="banner ' + (st.status === 'healthy' ? 'info' : 'warn') + '" style="margin-top:12px"><span>' +
            (st.status === 'healthy' ? 'i' : '⚠') + '</span><div>' + u.esc(st.message) + '</div></div>' : '') +
          '</div></div>'
        );
      }).join('') +
      '</div>' +

      '<div class="card" style="margin-top:14px"><div class="card-head"><h3>How an integration plugs in</h3></div>' +
      '<div class="card-body" style="font-size:12.5px;color:var(--text-2);line-height:1.7;max-width:96ch">' +
      'Each connector implements two functions: <span class="mono">identity(record)</span>, returning the keys a person can be matched on, and ' +
      '<span class="mono">assertions(record)</span>, returning that system’s claims about canonical fields with their timestamps. ' +
      'Nothing downstream — resolution, conflict classification, scoring, this interface — knows which vendor a value came from. ' +
      'Adding HubSpot, NetSuite, Snowflake or Microsoft Dynamics is one adapter of roughly forty lines. ' +
      'Replacing this fixture data with live API calls changes the fetch and nothing else.' +
      '</div></div>'
    );
  }

  /* ========================================================== REMEDIATION */

  function tasks(ctx) {
    const u = U();
    const { view, state, store } = ctx;
    const f = state.tasks;
    const visible = new Set(store.visiblePeople().map((p) => p.person.id));
    let rows = view.tasks.filter((t) => !t.personId || visible.has(t.personId));
    const all = rows.slice();
    if (f.status !== 'all') rows = rows.filter((t) => t.status === f.status);
    if (f.owner !== 'all') rows = rows.filter((t) => t.owner === f.owner);

    const owners = Array.from(new Set(all.map((t) => t.owner)));
    const counts = (s) => all.filter((t) => t.status === s).length;

    return (
      '<div class="page-head"><div><h1>Remediation</h1>' +
      '<div class="sub">Each actionable finding becomes a specific instruction: which system, which field, which value, and the evidence behind it. ' +
      'The platform deliberately does not write back into source systems — it produces the correction and the audit trail, and the owning team applies it.</div></div>' +
      '<div class="actions">' +
      '<button class="btn" data-action="task-bulk" data-status="in_progress">Accept all critical</button>' +
      '</div></div>' +

      '<div class="grid g-stats" style="margin-bottom:14px">' +
      u.stat('Open', counts('open'), 'Awaiting an owner') +
      u.stat('In progress', counts('in_progress'), 'Accepted by a team') +
      u.stat('Resolved', counts('resolved'), 'Marked fixed at source') +
      u.stat('Dismissed', counts('dismissed'), 'Accepted as intentional') +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<div class="chips">' +
      ['open', 'in_progress', 'resolved', 'dismissed', 'all'].map((s) =>
        '<button class="chip ' + (f.status === s ? 'on' : '') + '" data-action="task-filter" data-key="status" data-val="' + s + '">' +
        u.esc(s === 'all' ? 'All' : s === 'in_progress' ? 'In progress' : s[0].toUpperCase() + s.slice(1)) + '</button>').join('') +
      '</div><div class="chips">' +
      ['all'].concat(owners).map((o) =>
        '<button class="chip ' + (f.owner === o ? 'on' : '') + '" data-action="task-filter" data-key="owner" data-val="' + u.attr(o) + '">' +
        u.esc(o === 'all' ? 'All owners' : o) + '</button>').join('') +
      '</div></div></div>' +

      '<div class="card"><div class="card-head"><h3>' + rows.length + ' items</h3></div><div class="card-body tight"><div class="scroll-x">' +
      (rows.length
        ? '<table class="table"><thead><tr><th>Action</th><th>Person</th><th>Owner</th><th>Fix in</th><th>Severity</th><th>Status</th></tr></thead><tbody>' +
          rows.slice(0, 200).map((t) =>
            '<tr class="click" data-drawer="task:' + u.attr(t.id) + '">' +
            '<td><b>' + u.esc(t.title) + '</b><div style="font-size:11.5px;color:var(--text-3);margin-top:2px">' + u.esc(t.fieldLabel) + '</div></td>' +
            '<td>' + u.esc(t.personName) + '</td>' +
            '<td>' + u.esc(t.owner) + '</td>' +
            '<td>' + t.targets.map((s) => u.systemTag(s, { short: true })).join(' ') + '</td>' +
            '<td>' + u.severityBadge(t.severity) + '</td>' +
            '<td>' + statusBadge(t.status) + '</td></tr>').join('') +
          '</tbody></table>'
        : u.empty('Nothing here', 'No remediation items match these filters.')) +
      '</div></div></div>'
    );
  }

  function statusBadge(s) {
    const u = U();
    return {
      open: u.badge('Open', 'warn'),
      in_progress: u.badge('In progress', 'accent'),
      resolved: u.badge('Resolved', 'ok'),
      dismissed: u.badge('Dismissed', 'plain'),
    }[s];
  }

  /* ================================================================ ADMIN */

  function admin(ctx) {
    const u = U();
    const { view, state, route, store } = ctx;
    const tab = route.query.tab || 'sor';

    const head =
      '<div class="page-head"><div><h1>Administration</h1>' +
      '<div class="sub">Configuration, not code. The system-of-record policy and the hierarchy below are data; changing either re-answers ' +
      'every question in the application immediately, because no merged record is ever stored.</div></div>' +
      '<div class="actions">' +
      (SOT.policy.isDefault(state.policy) ? '' : '<button class="btn" data-action="policy-reset">Restore default policy</button>') +
      '<button class="btn" data-action="reset-all" title="Clear every change made in this prototype">Reset prototype</button>' +
      '</div></div>' +
      u.tabs([
        { id: 'sor', label: 'Systems of record' },
        { id: 'hierarchy', label: 'Hierarchy' },
        { id: 'permissions', label: 'Roles and permissions' },
      ], tab, 'admin-tab');

    if (tab === 'hierarchy') return head + adminHierarchy(ctx);
    if (tab === 'permissions') return head + adminPermissions(ctx);
    return head + adminSor(ctx);
  }

  function adminSor(ctx) {
    const u = U();
    const { view, state, store } = ctx;
    const selected = state.adminField;
    const changed = SOT.policy.diff(state.policy);

    const list =
      '<div class="card"><div class="card-head"><h3>Field policy</h3><span class="sub">' +
      SOT.model.FIELDS.length + ' reconciled fields</span></div><div class="card-body tight"><div class="scroll-x">' +
      '<table class="table"><thead><tr><th>Field</th><th>System of record</th><th>Fallback order</th><th class="num">Conflicts</th></tr></thead><tbody>' +
      SOT.model.FIELDS.map((f) => {
        const order = state.policy[f.key] || [];
        const n = view.conflicts.filter((c) => c.field === f.key).length;
        const isChanged = changed.some((c) => c.field === f.key);
        return '<tr class="click ' + (selected === f.key ? '' : '') + '" data-action="admin-field" data-field="' + u.attr(f.key) + '"' +
          (selected === f.key ? ' style="background:var(--accent-soft)"' : '') + '>' +
          '<td><b>' + u.esc(f.label) + '</b>' + (isChanged ? ' ' + u.badge('modified', 'accent') : '') +
          '<div style="font-size:11px;color:var(--text-3)">' + u.esc(f.group) + ' · weight ' + f.weight + '</div></td>' +
          '<td>' + (order[0] ? u.systemTag(order[0]) : '<span style="color:var(--text-3)">none</span>') + '</td>' +
          '<td style="font-size:11.5px;color:var(--text-3)">' + u.esc(order.slice(1).map((s) => SOT.model.SYSTEM_BY_ID[s].name).join(' → ') || '—') + '</td>' +
          '<td class="num">' + (n ? u.badge(String(n), 'warn') : '<span style="color:var(--text-3)">0</span>') + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div></div>';

    let detail;
    if (!selected) {
      detail =
        '<div class="card"><div class="card-head"><h3>Impact preview</h3></div><div class="card-body" style="color:var(--text-2);font-size:12.5px;line-height:1.65">' +
        'Select a field to see what each system would resolve to if it were made authoritative, and how many people’s answers would change. ' +
        'The preview is computed by re-running the resolution engine against the alternative policy — the same code path the live application uses.' +
        '</div></div>';
    } else {
      const f = SOT.model.FIELD_BY_KEY[selected];
      const order = state.policy[selected] || [];
      const candidates = f.contributors;
      const rows = candidates.map((sysId) => {
        const alt = SOT.policy.promote(state.policy, selected, sysId);
        const preview = SOT.resolve.resolveAll(view.dataset, view.identity, alt, view.asOf);
        let changedPeople = 0;
        Object.keys(preview.profiles).forEach((pid) => {
          const before = view.profiles[pid].get(selected);
          const after = preview.profiles[pid].get(selected);
          if (!SOT.resolve.sameValue(before, after) && !(before == null && after == null)) changedPeople++;
        });
        return {
          sysId,
          current: order[0] === sysId,
          changedPeople,
          conflicts: preview.conflicts.filter((c) => c.field === selected).length,
        };
      });

      detail =
        '<div class="card"><div class="card-head"><h3>' + u.esc(f.label) + '</h3>' +
        '<span class="sub">' + u.esc(f.sensitivity) + ' · weight ' + f.weight + ' · tolerance ' + f.tolerance + 'd</span></div>' +
        '<div class="card-body">' +
        (SOT.policy.RATIONALE[selected]
          ? '<div class="banner info" style="margin-bottom:14px"><span>i</span><div>' + u.esc(SOT.policy.RATIONALE[selected]) + '</div></div>'
          : '') +
        '<div class="section-title">If this system were authoritative</div>' +
        '<table class="table" style="font-size:12px"><thead><tr><th>System</th><th class="num">Answers that change</th><th class="num">Findings</th><th></th></tr></thead><tbody>' +
        rows.map((r) =>
          '<tr><td>' + u.systemTag(r.sysId) + (r.current ? ' ' + u.badge('current', 'accent') : '') + '</td>' +
          '<td class="num">' + (r.current ? '—' : r.changedPeople + ' people') + '</td>' +
          '<td class="num">' + r.conflicts + '</td>' +
          '<td style="text-align:right">' + (r.current ? '' :
            '<button class="btn sm primary" data-action="promote" data-field="' + u.attr(selected) + '" data-system="' + u.attr(r.sysId) + '">Make authoritative</button>') +
          '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="prov-note" style="margin-top:12px">Changing the system of record does not usually reduce the number of disagreements — ' +
        'it changes which side is considered wrong, and therefore which team gets the remediation task. That is the honest behaviour, ' +
        'and it is why the policy belongs to the customer rather than to us.</div>' +
        '</div></div>';
    }

    return (
      (changed.length
        ? '<div class="banner accent" style="margin-bottom:14px;background:var(--accent-soft);color:var(--accent);border-color:color-mix(in srgb, var(--accent) 22%, transparent)">' +
          '<span>i</span><div><b>' + changed.length + ' field' + (changed.length === 1 ? '' : 's') + ' differ from the default policy.</b> ' +
          u.esc(changed.map((c) => SOT.model.FIELD_BY_KEY[c.field].label + ' → ' + SOT.model.SYSTEM_BY_ID[c.to[0]].name).join('; ')) +
          '</div></div>'
        : '') +
      '<div class="split">' + list + detail + '</div>'
    );
  }

  function adminHierarchy(ctx) {
    const u = U();
    const { state, view } = ctx;
    return (
      '<div class="split">' +
      '<div class="card"><div class="card-head"><h3>Hierarchy levels</h3>' +
      '<span class="sub">Drives the organization explorer</span></div><div class="card-body tight">' +
      '<table class="table"><thead><tr><th>#</th><th>Level</th><th>Resolved from</th><th class="num">Distinct values</th><th></th></tr></thead><tbody>' +
      state.hierarchy.map((h, i) => {
        const distinct = h.key === 'company' ? 1 :
          new Set(Object.values(view.profiles).map((p) => p.get(h.key)).filter(Boolean)).size;
        return '<tr><td class="num" style="color:var(--text-3)">' + (i + 1) + '</td>' +
          '<td><b>' + u.esc(h.label) + '</b><div class="mono" style="color:var(--text-3)">' + u.esc(h.key) + '</div></td>' +
          '<td>' + (SOT.model.SYSTEM_BY_ID[h.source] ? u.systemTag(h.source) : '<span style="color:var(--text-3)">derived</span>') + '</td>' +
          '<td class="num">' + distinct + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
          (i > 1 ? '<button class="btn sm" data-action="hier-move" data-i="' + i + '" data-d="-1">↑</button> ' : '') +
          (i > 0 && i < state.hierarchy.length - 1 ? '<button class="btn sm" data-action="hier-move" data-i="' + i + '" data-d="1">↓</button> ' : '') +
          (i > 0 ? '<button class="btn sm" data-action="hier-remove" data-i="' + i + '">Remove</button>' : '') +
          '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="card-body" style="border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<span style="font-size:12px;color:var(--text-3)">Add a level:</span>' +
      ['department', 'segment', 'region', 'businessUnit', 'team', 'territory']
        .filter((k) => !state.hierarchy.some((h) => h.key === k))
        .map((k) => '<button class="btn sm" data-action="hier-add" data-key="' + k + '">' + u.esc(SOT.model.FIELD_BY_KEY[k].label) + '</button>')
        .join('') || '<span style="font-size:12px;color:var(--text-3)">All available levels are in use.</span>' +
      '</div></div>' +

      '<div class="card"><div class="card-head"><h3>Why this is configuration</h3></div>' +
      '<div class="card-body" style="font-size:12.5px;color:var(--text-2);line-height:1.7">' +
      'One company runs Company → Americas → Enterprise → Northeast → Team. Another runs Company → Revenue → North America → Mid-Market. ' +
      'Hard-coding either shape would force every customer onto ours, which is the first thing that kills an enterprise deal. ' +
      'The explorer walks whatever ladder is defined here and groups people by the <em>resolved</em> value of each level — so the hierarchy ' +
      'itself inherits the system-of-record policy. Reorder the levels and the explorer, breadcrumbs and dashboard rollup all follow.' +
      '<div style="margin-top:14px"><a class="btn" href="#/org">Open the explorer</a></div>' +
      '</div></div></div>'
    );
  }

  function adminPermissions(ctx) {
    const u = U();
    const { view } = ctx;
    return (
      '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Roles</h3>' +
      '<span class="sub">Prototype scope: the shape of the model, enforced in the interface</span></div>' +
      '<div class="card-body tight"><div class="scroll-x"><table class="table">' +
      '<thead><tr><th>Role</th><th>Persona</th><th>Who they can see</th><th>Maximum field sensitivity</th></tr></thead><tbody>' +
      SOT.model.ROLES.map((r) =>
        '<tr' + (r.id === view.role.id ? ' style="background:var(--accent-soft)"' : '') + '>' +
        '<td><b>' + u.esc(r.name) + '</b>' + (r.id === view.role.id ? ' ' + u.badge('signed in', 'accent') : '') + '</td>' +
        '<td>' + u.esc(r.persona) + '</td>' +
        '<td>' + u.esc(r.scope === 'all' ? 'Whole organization' : 'Own reporting line only') + '</td>' +
        '<td>' + u.badge(r.maxSensitivity, r.maxSensitivity === 'restricted' ? 'warn' : 'plain') + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="split">' +
      '<div class="card"><div class="card-head"><h3>Field sensitivity</h3></div><div class="card-body tight">' +
      '<table class="table"><thead><tr><th>Field</th><th>Sensitivity</th><th>Visible to</th></tr></thead><tbody>' +
      SOT.model.FIELDS.map((f) =>
        '<tr><td>' + u.esc(f.label) + '</td>' +
        '<td>' + u.badge(f.sensitivity, f.sensitivity === 'restricted' ? 'bad' : f.sensitivity === 'internal' ? 'warn' : 'ok') + '</td>' +
        '<td style="font-size:11.5px;color:var(--text-2)">' +
        u.esc(SOT.model.ROLES.filter((r) => SOT.model.canSee(r, f.sensitivity)).map((r) => r.name).join(', ')) + '</td></tr>').join('') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-head"><h3>What production requires</h3></div>' +
      '<div class="card-body" style="font-size:12.5px;color:var(--text-2);line-height:1.7">' +
      'This prototype enforces permissions in the interface, which is not enforcement. A platform that concentrates compensation, ' +
      'performance and employment status into one place is an attractive target, so the real build needs the checks below the API, not above it:' +
      '<ul style="padding-left:18px;line-height:1.8;margin:10px 0 0">' +
      '<li>SAML/OIDC single sign-on with SCIM provisioning</li>' +
      '<li>Row- and field-level authorization evaluated server-side on every read</li>' +
      '<li>Per-tenant data isolation and encryption keys</li>' +
      '<li>Immutable audit log of every resolved value served and every policy change</li>' +
      '<li>Configurable retention and regional data residency</li>' +
      '</ul>' +
      '<div style="margin-top:12px">The sensitivity classification on every field already exists in the model, so the enforcement point is a filter over data that is ' +
      'already labelled rather than a schema change.</div>' +
      '</div></div></div>'
    );
  }

  /* =============================================================== DRAWER */

  function drawer(ctx) {
    const u = U();
    const { state, view } = ctx;
    if (!state.drawer) return '';
    const [type, id] = state.drawer.split(':');

    if (type === 'conflict') {
      const c = view.conflicts.find((x) => x.id === id);
      if (!c) return '';
      const p = view.profiles[c.personId];
      const task = view.tasks.find((t) => t.conflictId === c.id);
      const sor = SOT.model.SYSTEM_BY_ID[c.resolvedSystem];
      return shell(
        u.esc(c.fieldLabel) + ' — ' + u.esc(c.personName),
        u.kindBadge(c.kind) + ' ' + u.severityBadge(c.severity),
        '<div class="section-title">What each system says</div>' +
        '<table class="table" style="font-size:12.5px"><tbody>' +
        '<tr><td>' + u.systemTag(c.resolvedSystem) + '</td>' +
        '<td><b>' + u.esc(u.fieldValue(c.field, c.resolvedValue, view)) + '</b></td>' +
        '<td style="text-align:right">' + u.badge('System of record', 'accent') + '</td></tr>' +
        c.offenders.map((o) =>
          '<tr><td>' + u.systemTag(o.systemId) + '</td>' +
          '<td>' + (o.kind === 'gap' ? '<i style="color:var(--text-3)">empty</i>' : u.esc(u.fieldValue(c.field, o.value, view))) +
          '<div style="font-size:11px;color:var(--text-3)">read ' + u.esc(u.ago(o.observedAt, view.asOf)) + '</div></td>' +
          '<td style="text-align:right">' + u.kindBadge(o.kind) + '</td></tr>').join('') +
        '</tbody></table>' +

        '<div class="section-title">Why it is classified as ' + u.esc(SOT.model.CONFLICT_KINDS[c.kind].label.toLowerCase()) + '</div>' +
        '<div style="font-size:12.5px;color:var(--text-2);line-height:1.65">' +
        u.esc(SOT.model.CONFLICT_KINDS[c.kind].blurb) + ' ' +
        (c.kind === 'lag'
          ? 'The disagreeing system was last read before this value changed, so it cannot yet know about it. No action is required and no task was raised.'
          : c.kind === 'gap'
            ? 'The field is expected in that system and is empty, which breaks the join used by downstream reporting.'
            : 'Both systems have been read recently and both are confident. One of them is wrong.') +
        '</div>' +

        '<div class="section-title">Policy applied</div>' +
        '<div style="font-size:12.5px;color:var(--text-2)">' +
        u.esc((ctx.state.policy[c.field] || []).map((s) => SOT.model.SYSTEM_BY_ID[s].name).join(' → ')) +
        (SOT.policy.RATIONALE[c.field] ? '<div style="margin-top:6px">' + u.esc(SOT.policy.RATIONALE[c.field]) + '</div>' : '') +
        '<div style="margin-top:8px"><a href="#/admin" data-action="close-drawer">Change which system is authoritative →</a></div></div>' +

        (task
          ? '<div class="section-title">Remediation</div>' +
            '<div class="card"><div class="card-body">' +
            '<div style="font-weight:600;margin-bottom:5px">' + u.esc(task.title) + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);line-height:1.6">' + u.esc(task.instruction) + '</div>' +
            '<div style="margin-top:10px;font-size:12px;color:var(--text-3)"><b>Impact:</b> ' + u.esc(task.impact) + '</div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">' + statusBadge(task.status) +
            '<span style="font-size:11.5px;color:var(--text-3)">Owner: ' + u.esc(task.owner) + '</span></div>' +
            '</div></div>'
          : ''),
        task
          ? '<button class="btn" data-action="task-status" data-id="' + u.attr(task.id) + '" data-status="dismissed">Dismiss</button>' +
            '<button class="btn" data-action="task-status" data-id="' + u.attr(task.id) + '" data-status="resolved">Mark fixed at source</button>' +
            '<button class="btn primary" data-action="task-status" data-id="' + u.attr(task.id) + '" data-status="in_progress">Accept</button>'
          : '<a class="btn primary" href="#/person/' + u.attr(c.personId) + '?tab=integrity" data-action="close-drawer">Open profile</a>'
      );
    }

    if (type === 'task') {
      const t = view.tasks.find((x) => x.id === id);
      if (!t) return '';
      return shell(
        u.esc(t.title),
        u.severityBadge(t.severity) + ' ' + statusBadge(t.status),
        '<div class="section-title">Instruction</div>' +
        '<div style="font-size:13px;line-height:1.65">' + u.esc(t.instruction) + '</div>' +
        '<div class="section-title">Why it matters</div>' +
        '<div style="font-size:12.5px;color:var(--text-2);line-height:1.65">' + u.esc(t.impact) + '</div>' +
        '<div class="section-title">Detail</div>' +
        '<dl class="kv">' +
        '<dt>Person</dt><dd>' + (t.personId ? '<a href="#/person/' + u.attr(t.personId) + '" data-action="close-drawer">' + u.esc(t.personName) + '</a>' : u.esc(t.personName)) + '</dd>' +
        '<dt>Field</dt><dd>' + u.esc(t.fieldLabel) + '</dd>' +
        '<dt>Fix in</dt><dd>' + t.targets.map((s) => u.systemTag(s)).join(' ') + '</dd>' +
        '<dt>Owner</dt><dd>' + u.esc(t.owner) + '</dd>' +
        '<dt>Classification</dt><dd>' + u.kindBadge(t.kind) + '</dd>' +
        '</dl>',
        '<button class="btn" data-action="task-status" data-id="' + u.attr(t.id) + '" data-status="dismissed">Dismiss</button>' +
        '<button class="btn" data-action="task-status" data-id="' + u.attr(t.id) + '" data-status="resolved">Mark fixed</button>' +
        '<button class="btn primary" data-action="task-status" data-id="' + u.attr(t.id) + '" data-status="in_progress">Accept</button>'
      );
    }
    return '';

    function shell(title, badges, body, footer) {
      return (
        '<div class="drawer-wrap" data-action="close-drawer"><div class="drawer" data-stop="1">' +
        '<header><div style="flex:1"><h3>' + title + '</h3>' +
        '<div style="margin-top:6px;display:flex;gap:6px">' + badges + '</div></div>' +
        '<button class="btn ghost" data-action="close-drawer">✕</button></header>' +
        '<div class="body">' + body + '</div>' +
        '<footer>' + (footer || '') + '</footer>' +
        '</div></div>'
      );
    }
  }

  SOT.views = Object.assign(SOT.views || {}, { integrity, identity, metrics, systems, tasks, admin, drawer, statusBadge });
})(window.SOT || (window.SOT = {}));
