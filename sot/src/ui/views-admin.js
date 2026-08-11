/* SOT — integrity centre, identity queue, systems, remediation, admin, drawer. */
(function (SOT) {
  'use strict';

  const U = () => SOT.ui;
  const S = SOT.schema;

  /* ====================================================== DATA INTEGRITY */

  function integrity(ctx) {
    const u = U();
    const { view, store, state } = ctx;
    const pack = view.pack;
    const f = state.integrity;

    const all = view.conflicts.filter((c) => view.summary.inScope.has(c.entityId));
    let rows = all;
    if (f.severity !== 'all') rows = rows.filter((c) => c.severity === f.severity);
    if (f.kind !== 'all') rows = rows.filter((c) => c.kind === f.kind);
    if (f.system !== 'all') rows = rows.filter((c) => c.systems.indexOf(f.system) >= 0);
    if (f.type !== 'all') rows = rows.filter((c) => c.entityType === f.type);
    if (f.q) rows = rows.filter((c) => (c.entityName + ' ' + c.fieldLabel).toLowerCase().includes(f.q.toLowerCase()));

    const sel = (key, label, opts) =>
      '<label style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--ink-3)">' + u.esc(label) +
      '<select class="in" data-act="int-sel" data-key="' + key + '">' +
      opts.map((o) => '<option value="' + u.at(o[0]) + '"' + (o[0] === f[key] ? ' selected' : '') + '>' + u.esc(o[1]) + '</option>').join('') +
      '</select></label>';

    return (
      '<div class="head"><div><h1>Data integrity</h1>' +
      '<div class="sub">Every field where the connected systems disagree, classified by <b>why</b>. Lag is separated from divergence ' +
      'deliberately: a system that has not been read since the value changed is behind, not wrong, and mixing the two is how these ' +
      'reports get switched off.</div></div>' +
      '<div class="acts"><a class="btn" href="#/tasks">Remediation</a><a class="btn" href="#/admin">Systems of record</a></div></div>' +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Findings', all.length, 'Across ' + new Set(all.map((c) => c.entityId)).size + ' records') +
      u.stat('Divergence', all.filter((c) => c.kind === 'divergence').length, 'Both current, both confident', 'hot') +
      u.stat('Gaps', all.filter((c) => c.kind === 'gap').length, 'Expected but empty') +
      u.stat('Lag', all.filter((c) => c.kind === 'lag').length, 'Not queued — resolves on next read') +
      u.stat('Critical + high', all.filter((c) => c.severity === 'critical' || c.severity === 'high').length, 'Safety, access or money') +
      '</div>' +

      '<div class="card" style="margin-bottom:12px"><div class="card-b" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<div class="chips">' + ['all', 'critical', 'high', 'medium', 'low'].map((s) =>
        '<button class="chip ' + (f.severity === s ? 'on' : '') + '" data-act="int-chip" data-key="severity" data-val="' + s + '">' +
        u.esc(s === 'all' ? 'All severities' : s) + '</button>').join('') + '</div>' +
      '<div class="chips">' + ['all', 'divergence', 'gap', 'lag'].map((k) =>
        '<button class="chip ' + (f.kind === k ? 'on' : '') + '" data-act="int-chip" data-key="kind" data-val="' + k + '">' +
        u.esc(k === 'all' ? 'All kinds' : k) + '</button>').join('') + '</div>' +
      sel('type', 'Record', [['all', 'Any']].concat(pack.entityTypes.map((t) => [t.id, t.label]))) +
      sel('system', 'System', [['all', 'Any']].concat(pack.systems.map((s) => [s.id, s.name]))) +
      '<input class="in" id="int-q" placeholder="Search…" value="' + u.at(f.q) + '" style="flex:1;min-width:150px">' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + rows.length + ' findings</h3><span class="sub">most severe first</span></div>' +
      '<div class="card-b flush"><div class="xs">' +
      (rows.length
        ? '<table class="tbl"><thead><tr><th>Record</th><th>Field</th><th>Resolved</th><th>Disagreeing</th><th>Kind</th><th>Severity</th></tr></thead><tbody>' +
          rows.slice(0, 250).map((c) => {
            const p = view.profiles[c.entityId];
            return '<tr class="go" data-drawer="conflict:' + u.at(c.id) + '">' +
              '<td>' + u.entityLine(p, pack) + '</td>' +
              '<td>' + u.esc(c.fieldLabel) + '</td>' +
              '<td><b>' + u.esc(store.formatValue(c.field, c.resolvedValue)) + '</b><br>' +
              '<span class="dim" style="font-size:10.5px">' + u.esc(pack.systemById[c.resolvedSystem].name) + '</span></td>' +
              '<td>' + c.offenders.map((o) => '<div style="font-size:11.5px">' + u.systemTag(pack, o.systemId) + ' ' +
                (o.kind === 'gap' ? '<i class="dim">empty</i>' : u.esc(store.formatValue(c.field, o.value))) + '</div>').join('') + '</td>' +
              '<td>' + u.kindTag(c.kind) + '</td><td>' + u.severityTag(c.severity) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : u.empty('Nothing matches these filters.')) +
      '</div></div></div>'
    );
  }

  /* ================================================== IDENTITY RESOLUTION */

  function identity(ctx) {
    const u = U();
    const { view } = ctx;
    const pack = view.pack;
    const id = view.identity;
    const flagged = id.entities.filter((e) => e.flags.length);

    return (
      '<div class="head"><div><h1>Identity resolution</h1>' +
      '<div class="sub">Nothing downstream works until the platform knows that a record in one system and a record in another describe ' +
      'the same thing. Strong evidence links automatically; anything uncertain waits here. A wrong match does not cause a small error — ' +
      'it causes a confident lie about a person.</div></div></div>' +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Source records', id.stats.sourceRecords.toLocaleString('en-US'), 'Across ' + pack.systems.length + ' systems') +
      u.stat('Entities resolved', id.stats.entities.toLocaleString('en-US'),
        pack.entityTypes.map((t) => id.stats.byType[t.id] + ' ' + t.plural.toLowerCase()).join(' · ')) +
      u.stat('Links applied', id.stats.autoLinked.toLocaleString('en-US'), 'At or above ' + Math.round(S.AUTO_LINK * 100) + '% confidence') +
      u.stat('Awaiting review', id.stats.needsReview, 'Below the automatic threshold', id.stats.needsReview ? 'hot' : '') +
      u.stat('Flagged', flagged.length, 'Duplicates and missing records') +
      '</div>' +

      '<div class="split"><div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Review queue</h3><span class="sub">' + id.unresolved.length + '</span></div>' +
      '<div class="card-b flush"><div class="xs">' +
      (id.unresolved.length
        ? '<table class="tbl"><thead><tr><th>Record</th><th>System</th><th>Proposed match</th><th></th></tr></thead><tbody>' +
          id.unresolved.map((r) => {
            const s = r.suggestions[0];
            return '<tr><td><b>' + u.esc(r.name || '—') + '</b><div class="dim mono">' + u.esc(r.detail || r.nativeId) + '</div></td>' +
              '<td>' + u.systemTag(pack, r.system) + '</td>' +
              '<td>' + (s
                ? '<div style="display:flex;gap:6px;align-items:center">' + u.tag(Math.round(s.score * 100) + '%', 'medium') +
                  '<a class="link" href="#/e/' + u.at(s.entityId) + '">' + u.esc(s.entityName) + '</a></div>' +
                  '<div class="dim" style="font-size:10.5px;margin-top:2px">' + u.esc(s.methodLabel) + '</div>'
                : '<span class="dim">no candidate above ' + Math.round(S.REVIEW * 100) + '%</span>') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' +
              (s ? '<button class="btn sm solid" data-act="confirm" data-entity="' + u.at(s.entityId) + '" data-system="' + u.at(r.system) +
                '" data-native="' + u.at(r.nativeId) + '">Confirm</button> ' : '') +
              '<button class="btn sm" data-act="dismiss" data-system="' + u.at(r.system) + '" data-native="' + u.at(r.nativeId) + '">Set aside</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : u.empty('Queue is clear — every record is linked or explicitly set aside.')) +
      '</div></div></div>' +

      '<div class="card"><div class="card-h"><h3>Flagged records</h3><span class="sub">' + flagged.length + '</span></div>' +
      '<div class="card-b flush">' +
      (flagged.length
        ? '<table class="tbl"><tbody>' + flagged.slice(0, 40).map((e) =>
            '<tr class="go" data-go="#/e/' + u.at(e.id) + '"><td>' + u.entityLine(view.profiles[e.id], pack) + '</td>' +
            '<td>' + e.flags.map((fl) => u.tag(fl.label, fl.severity === 'critical' ? 'critical' : 'high')).join(' ') + '</td></tr>').join('') +
          '</tbody></table>'
        : u.empty('No flags.')) +
      '</div></div></div>' +

      '<div class="card"><div class="card-h"><h3>Matching rules</h3></div><div class="card-b">' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:11px">Rules are scored, not boolean. At or above ' +
      Math.round(S.AUTO_LINK * 100) + '% a link is applied; between ' + Math.round(S.REVIEW * 100) +
      '% and that, a human decides; below, it is not a match.</div>' +
      '<table class="tbl" style="font-size:12px"><tbody>' +
      Object.keys(S.KEY_STRENGTH).filter((k) => k !== 'confirmed').map((k) =>
        '<tr><td style="padding-left:0">' + u.esc(S.KEY_STRENGTH[k].label) + '</td>' +
        '<td style="text-align:right">' + u.tag(Math.round(S.KEY_STRENGTH[k].score * 100) + '%',
          S.KEY_STRENGTH[k].score >= S.AUTO_LINK ? 'ok' : 'medium') + '</td></tr>').join('') +
      '</tbody></table>' +
      '<div class="dim" style="margin-top:12px;padding-top:11px;border-top:1px solid var(--border);font-size:11.5px;line-height:1.6">' +
      'The same code serves every vertical — only the key names change. A hospital matches on medical record and provider numbers; ' +
      'a command matches on service number. Production adds fuzzy name distance, historical aliases and provisioning logs, and the ' +
      'architecture is unchanged: rules produce scores, scores produce links, uncertainty produces a queue.</div>' +
      '</div></div></div>'
    );
  }

  /* ============================================================== SYSTEMS */

  function systems(ctx) {
    const u = U();
    const { view } = ctx;
    const pack = view.pack;

    return (
      '<div class="head"><div><h1>Connected systems</h1>' +
      '<div class="sub">' + pack.systems.length + ' simulated connectors. No live system is contacted and no credentials exist anywhere ' +
      'in this prototype — each one is a fixture behind the same adapter interface a production integration would implement.</div></div></div>' +

      '<div class="grid g-3">' + pack.systems.map((s) => {
        const st = pack.syncState[s.id];
        const sorFields = pack.fields.filter((f) => (view.policy[f.key] || [])[0] === s.id);
        const involved = view.conflicts.filter((c) => c.systems.indexOf(s.id) >= 0).length;
        const linked = view.identity.entities.filter((e) => e.bySystem[s.id]).length;
        return '<div class="card"><div class="card-h"><i class="sysdot"></i><h3>' + u.esc(s.name) + '</h3>' +
          '<div class="right">' + (st.status === 'healthy' ? u.tag('connected', 'ok') : u.tag('degraded', 'critical')) + '</div></div>' +
          '<div class="card-b">' +
          '<div class="dim" style="font-size:11.5px;margin-bottom:11px">' + u.esc(s.category) + ' · ' + u.esc(s.blurb) + '</div>' +
          '<dl class="kv">' +
          '<dt>Last read</dt><dd>' + u.esc(u.ago(st.lastSync, view.asOf)) + '</dd>' +
          '<dt>Cadence</dt><dd>' + u.esc(s.syncCadence) + '</dd>' +
          '<dt>Records</dt><dd class="num">' + pack.recordCounts[s.id].toLocaleString('en-US') + '</dd>' +
          '<dt>Entities linked</dt><dd class="num">' + linked.toLocaleString('en-US') + '</dd>' +
          '<dt>Authoritative for</dt><dd>' + (sorFields.length
            ? u.esc(Array.from(new Set(sorFields.map((f) => f.label))).join(', '))
            : '<span class="dim">nothing — corroboration only</span>') + '</dd>' +
          '<dt>In findings</dt><dd>' + (involved ? u.tag(involved + '', 'medium') : u.tag('none', 'ok')) + '</dd>' +
          '</dl>' +
          (st.message ? '<div class="note ' + (st.status === 'healthy' ? '' : 'medium') + '" style="margin-top:11px">' +
            '<span>' + (st.status === 'healthy' ? 'i' : '▲') + '</span><div>' + u.esc(st.message) + '</div></div>' : '') +
          '</div></div>';
      }).join('') + '</div>' +

      '<div class="card" style="margin-top:12px"><div class="card-h"><h3>How an integration plugs in</h3></div>' +
      '<div class="card-b muted" style="font-size:12.5px;line-height:1.7;max-width:96ch">' +
      'Each connector implements two functions: <span class="mono">identity(record)</span>, returning the keys a record can be matched on, ' +
      'and <span class="mono">assertions(record)</span>, returning that system’s claims about canonical fields with their timestamps. ' +
      'Nothing downstream — resolution, classification, the graph, the statistics, this interface — knows which vendor a value came from. ' +
      'Adding a new source system is one adapter of roughly forty lines. Replacing these fixtures with live API calls changes the fetch ' +
      'and nothing else.</div></div>'
    );
  }

  /* ========================================================== REMEDIATION */

  function tasks(ctx) {
    const u = U();
    const { view, state } = ctx;
    const pack = view.pack;
    const f = state.tasks;
    const all = view.tasks.filter((t) => !t.entityId || view.summary.inScope.has(t.entityId));
    let rows = all;
    if (f.status !== 'all') rows = rows.filter((t) => t.status === f.status);
    if (f.owner !== 'all') rows = rows.filter((t) => t.owner === f.owner);
    const owners = Array.from(new Set(all.map((t) => t.owner))).sort();
    const n = (s) => all.filter((t) => t.status === s).length;

    return (
      '<div class="head"><div><h1>Remediation</h1>' +
      '<div class="sub">Each actionable finding becomes a specific instruction routed to the team that can act on it. The platform ' +
      'deliberately does not write back into source systems — it produces the correction and the audit trail, and the owning team applies it.</div></div>' +
      '<div class="acts"><button class="btn" data-act="task-bulk" data-status="in_progress">Accept all critical</button></div></div>' +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Open', n('open'), 'Awaiting an owner') +
      u.stat('In progress', n('in_progress'), 'Accepted by a team') +
      u.stat('Resolved', n('resolved'), 'Fixed at source') +
      u.stat('Set aside', n('dismissed'), 'Accepted as intentional') +
      '</div>' +

      '<div class="card" style="margin-bottom:12px"><div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap">' +
      '<div class="chips">' + ['open', 'in_progress', 'resolved', 'dismissed', 'all'].map((s) =>
        '<button class="chip ' + (f.status === s ? 'on' : '') + '" data-act="task-filter" data-key="status" data-val="' + s + '">' +
        u.esc(s === 'in_progress' ? 'in progress' : s) + '</button>').join('') + '</div>' +
      '<div class="chips">' + ['all'].concat(owners).map((o) =>
        '<button class="chip ' + (f.owner === o ? 'on' : '') + '" data-act="task-filter" data-key="owner" data-val="' + u.at(o) + '">' +
        u.esc(o === 'all' ? 'All owners' : o) + '</button>').join('') + '</div>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + rows.length + ' items</h3></div><div class="card-b flush"><div class="xs">' +
      (rows.length
        ? '<table class="tbl"><thead><tr><th>Action</th><th>Record</th><th>Owner</th><th>Fix in</th><th>Severity</th><th>Status</th></tr></thead><tbody>' +
          rows.slice(0, 250).map((t) =>
            '<tr class="go" data-drawer="task:' + u.at(t.id) + '">' +
            '<td><b>' + u.esc(t.title) + '</b><div class="dim" style="font-size:11px;margin-top:2px">' + u.esc(t.fieldLabel) + '</div></td>' +
            '<td>' + u.esc(t.entityName) + '</td><td>' + u.esc(t.owner) + '</td>' +
            '<td>' + t.targets.map((s) => u.systemTag(pack, s)).join(' ') + '</td>' +
            '<td>' + u.severityTag(t.severity) + '</td><td>' + statusTag(t.status) + '</td></tr>').join('') +
          '</tbody></table>'
        : u.empty('Nothing matches.')) +
      '</div></div></div>'
    );
  }

  function statusTag(s) {
    const u = U();
    return { open: u.tag('open', 'medium'), in_progress: u.tag('in progress', 'solid'),
      resolved: u.tag('resolved', 'ok'), dismissed: u.tag('set aside', 'line') }[s];
  }

  /* ================================================================ ADMIN */

  function admin(ctx) {
    const u = U();
    const { view, store, state, route } = ctx;
    const tab = route.query.tab || 'sor';
    const changed = store.policyChanged();

    const head =
      '<div class="head"><div><h1>Administration</h1>' +
      '<div class="sub">Configuration, not code. The policy below decides which system wins for each field; because nothing merged is ' +
      'ever stored, changing it re-answers every screen immediately.</div></div>' +
      '<div class="acts">' + (changed.length ? '<button class="btn" data-act="policy-reset">Restore defaults</button>' : '') +
      '<button class="btn" data-act="reset-all">Reset prototype</button></div></div>' +
      u.tabs([
        { id: 'sor', label: 'Systems of record' },
        { id: 'model', label: 'Model' },
        { id: 'roles', label: 'Roles & permissions' },
      ], tab, 'admin-tab');

    if (tab === 'model') return head + adminModel(ctx);
    if (tab === 'roles') return head + adminRoles(ctx);
    return head + adminSor(ctx, changed);
  }

  function adminSor(ctx, changed) {
    const u = U();
    const { view, store, state } = ctx;
    const pack = view.pack;
    const sel = state.adminField;

    const list = '<div class="card"><div class="card-h"><h3>Field policy</h3><span class="sub">' + pack.fields.length + ' reconciled fields</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl"><thead><tr><th>Field</th><th>Record</th><th>System of record</th><th>Fallback</th><th class="num">Findings</th></tr></thead><tbody>' +
      pack.fields.map((f) => {
        const order = view.policy[f.key] || [];
        const n = view.conflicts.filter((c) => c.field === f.key && c.entityType === f.entity).length;
        const isSel = sel === f.entity + '.' + f.key;
        return '<tr class="go" data-act="admin-field" data-field="' + u.at(f.entity + '.' + f.key) + '"' +
          (isSel ? ' style="background:var(--surface-3)"' : '') + '>' +
          '<td><b>' + u.esc(f.label) + '</b>' + (changed.indexOf(f.key) >= 0 ? ' ' + u.tag('modified', 'solid') : '') +
          '<div class="dim" style="font-size:10.5px">weight ' + f.weight + ' · ' + u.esc(f.sensitivity) + '</div></td>' +
          '<td class="dim">' + u.esc(pack.typeById[f.entity].label) + '</td>' +
          '<td>' + (order[0] ? u.systemTag(pack, order[0]) : '<span class="dim">none</span>') + '</td>' +
          '<td class="dim" style="font-size:11px">' + u.esc(order.slice(1).map((s) => pack.systemById[s].name).join(' → ') || '—') + '</td>' +
          '<td class="num">' + (n ? u.tag(String(n), 'medium') : '<span class="dim">0</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    let detail;
    if (!sel || !pack.fieldByKey[sel]) {
      detail = '<div class="card"><div class="card-h"><h3>Impact preview</h3></div><div class="card-b muted" style="font-size:12.5px;line-height:1.65">' +
        'Choose a field to see what each system would resolve it to if it were authoritative, and how many records would change their ' +
        'answer. The preview runs the resolution engine against the alternative policy — the same code path the live application uses.</div></div>';
    } else {
      const f = pack.fieldByKey[sel];
      const rows = f.contributors.map((sysId) => {
        const alt = {};
        Object.keys(view.policy).forEach((k) => { alt[k] = view.policy[k].slice(); });
        alt[f.key] = [sysId].concat((alt[f.key] || []).filter((s) => s !== sysId));
        const preview = SOT.resolve.resolveAll(pack, view.identity, alt, view.asOf);
        let moved = 0;
        Object.keys(preview.profiles).forEach((id) => {
          if (preview.profiles[id].type !== f.entity) return;
          if (!SOT.resolve.sameValue(preview.profiles[id].get(f.key), view.profiles[id].get(f.key))) moved++;
        });
        return { sysId, current: (view.policy[f.key] || [])[0] === sysId, moved,
          findings: preview.conflicts.filter((c) => c.field === f.key && c.entityType === f.entity).length };
      });

      detail = '<div class="card"><div class="card-h"><h3>' + u.esc(f.label) + '</h3>' +
        '<span class="sub">' + u.esc(pack.typeById[f.entity].label) + '</span></div><div class="card-b">' +
        (pack.rationale[f.key] ? '<div class="note" style="margin-bottom:12px"><span>i</span><div>' + u.esc(pack.rationale[f.key]) + '</div></div>' : '') +
        (f.impact ? '<div class="sect">Why it matters</div><div class="muted" style="font-size:12.5px;line-height:1.6">' + u.esc(f.impact) + '</div>' : '') +
        '<div class="sect">If this system were authoritative</div>' +
        '<table class="tbl" style="font-size:12px"><thead><tr><th>System</th><th class="num">Answers that change</th><th class="num">Findings</th><th></th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td>' + u.systemTag(pack, r.sysId) + (r.current ? ' ' + u.tag('current', 'solid') : '') + '</td>' +
          '<td class="num">' + (r.current ? '—' : r.moved) + '</td><td class="num">' + r.findings + '</td>' +
          '<td style="text-align:right">' + (r.current ? '' :
            '<button class="btn sm solid" data-act="promote" data-field="' + u.at(f.key) + '" data-system="' + u.at(r.sysId) + '">Make authoritative</button>') +
          '</td></tr>').join('') + '</tbody></table>' +
        '<div class="dim" style="margin-top:11px;font-size:11.5px;line-height:1.6">Changing the system of record rarely reduces the number ' +
        'of disagreements. It changes which side is considered wrong, and therefore which team gets the work. That is the honest behaviour, ' +
        'and it is why the policy belongs to the customer rather than to us.</div>' +
        '</div></div>';
    }

    return (changed.length
      ? '<div class="note" style="margin-bottom:12px"><span>i</span><div><b>' + changed.length + ' field' +
        (changed.length === 1 ? '' : 's') + ' differ from the default policy.</b> ' +
        u.esc(changed.map((k) => (view.pack.fields.find((f) => f.key === k) || { label: k }).label + ' → ' +
          view.pack.systemById[view.policy[k][0]].name).join('; ')) + '</div></div>'
      : '') + '<div class="split">' + list + detail + '</div>';
  }

  function adminModel(ctx) {
    const u = U();
    const { view } = ctx;
    const pack = view.pack;
    return '<div class="split">' +
      '<div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Entity types</h3><span class="sub">' + pack.entityTypes.length + '</span></div>' +
      '<div class="card-b flush"><table class="tbl"><thead><tr><th>Type</th><th>Kind</th><th>Authoritative source</th><th class="num">Resolved</th></tr></thead><tbody>' +
      pack.entityTypes.map((t) => '<tr class="go" data-go="#/t/' + u.at(t.id) + '"><td><span class="av sq sm" style="display:inline-grid;vertical-align:middle;margin-right:7px">' +
        u.esc(t.glyph) + '</span><b>' + u.esc(t.label) + '</b></td><td class="dim">' + u.esc(t.kind) + '</td>' +
        '<td>' + t.masterSystems.map((s) => u.systemTag(pack, s)).join(' ') + '</td>' +
        '<td class="num">' + (view.identity.stats.byType[t.id] || 0).toLocaleString('en-US') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-h"><h3>Relationship types</h3><span class="sub">' + pack.edgeTypes.length + '</span></div>' +
      '<div class="card-b flush"><table class="tbl"><thead><tr><th>Relationship</th><th>From → to</th><th>Time-bounded</th><th class="num">Edges</th></tr></thead><tbody>' +
      pack.edgeTypes.map((e) => {
        const n = view.graph.edges.filter((x) => x.type === e.id).length;
        return '<tr><td><b>' + u.esc(e.label) + '</b><div class="dim" style="font-size:10.5px">inverse: ' + u.esc(e.inverse) + '</div></td>' +
          '<td class="dim">' + u.esc(pack.typeById[e.from].label) + ' → ' + u.esc(pack.typeById[e.to].label) + '</td>' +
          '<td>' + (e.temporal ? u.tag('yes', 'ok') : '<span class="dim">no</span>') + '</td>' +
          '<td class="num">' + n.toLocaleString('en-US') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-h"><h3>Why this is configuration</h3></div><div class="card-b muted" style="font-size:12.5px;line-height:1.7">' +
      'Everything on the left is declared by the vertical pack, not built into the engine. A hospital declares staff, patients, units, ' +
      'facilities and visits; a command declares personnel, units, installations and readiness events; a sales organisation declares people, ' +
      'territories and accounts. The resolution engine, the identity matcher, the graph, the statistics runner and this entire interface ' +
      'are identical across all of them.' +
      '<div style="margin-top:12px">Time-bounded relationships are the reason the product can answer questions about the past. ' +
      '“Who used to cover that territory”, “who was on the ward in March”, “which platoon was this member in before the reassignment” ' +
      'are all the same query against the same edge table.</div>' +
      '<div style="margin-top:12px"><a class="btn" href="#/systems">See the connectors</a></div>' +
      '</div></div></div>';
  }

  function adminRoles(ctx) {
    const u = U();
    const { view } = ctx;
    const pack = view.pack;
    return '<div class="card" style="margin-bottom:12px"><div class="card-h"><h3>Roles</h3>' +
      '<span class="sub">Prototype scope: the model is real, the enforcement point is the interface</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl"><thead><tr><th>Role</th><th>Persona</th>' +
      pack.entityTypes.map((t) => '<th>' + u.esc(t.plural) + '</th>').join('') + '<th>Max sensitivity</th></tr></thead><tbody>' +
      pack.roles.map((r) => '<tr' + (r.id === view.role.id ? ' style="background:var(--surface-3)"' : '') + '>' +
        '<td><b>' + u.esc(r.name) + '</b>' + (r.id === view.role.id ? ' ' + u.tag('you', 'solid') : '') + '</td>' +
        '<td class="dim">' + u.esc(r.persona) + '</td>' +
        pack.entityTypes.map((t) => {
          const rule = (r.scopes || {})[t.id] || 'all';
          return '<td>' + (rule === 'none' ? u.tag('none', 'critical') : rule === 'all' ? u.tag('all', 'ok') : u.tag(rule, 'medium')) + '</td>';
        }).join('') +
        '<td>' + u.tag(r.maxSensitivity, r.maxSensitivity === 'protected' ? 'critical' : 'medium') + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="split"><div class="card"><div class="card-h"><h3>Field sensitivity</h3></div><div class="card-b flush"><div class="xs">' +
      '<table class="tbl"><thead><tr><th>Field</th><th>Record</th><th>Sensitivity</th><th>Visible to</th></tr></thead><tbody>' +
      pack.fields.filter((f) => f.sensitivity !== 'public').map((f) =>
        '<tr><td>' + u.esc(f.label) + '</td><td class="dim">' + u.esc(pack.typeById[f.entity].label) + '</td>' +
        '<td>' + u.tag(f.sensitivity, f.sensitivity === 'protected' ? 'critical' : f.sensitivity === 'confidential' ? 'high' : 'medium') + '</td>' +
        '<td class="dim" style="font-size:11px">' + u.esc(pack.roles.filter((r) => S.canSee(r, f.sensitivity)).map((r) => r.name).join(', ') || 'nobody') + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-h"><h3>What production requires</h3></div><div class="card-b muted" style="font-size:12.5px;line-height:1.7">' +
      'This prototype enforces permissions in the interface, which is not enforcement. A platform that concentrates clinical, personnel and ' +
      'access data in one place is a high-value target, so the real build needs the checks below the API rather than above it:' +
      '<ul style="padding-left:18px;line-height:1.8;margin:10px 0 0">' +
      '<li>Single sign-on with directory-driven provisioning</li>' +
      '<li>Row- and field-level authorisation evaluated server-side on every read</li>' +
      '<li>Per-tenant isolation and separate encryption keys</li>' +
      '<li>Immutable audit log of every value served and every policy change</li>' +
      '<li>Break-glass access with review, and regional data residency</li>' +
      '</ul><div style="margin-top:11px">Every field already carries a sensitivity classification and every role a scope, so enforcement is ' +
      'a filter over labelled data rather than a schema change.</div></div></div></div>';
  }

  /* =============================================================== DRAWER */

  function drawer(ctx) {
    const u = U();
    const { view, store, state } = ctx;
    const pack = view.pack;
    if (!state.drawer) return '';
    const [kind, id] = state.drawer.split(':');

    const shell = (title, tags, body, footer) =>
      '<div class="dw" data-act="close-drawer"><div class="drawer" data-stop="1">' +
      '<header><div style="flex:1"><h3>' + title + '</h3><div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">' + tags + '</div></div>' +
      '<button class="btn ghost" data-act="close-drawer">✕</button></header>' +
      '<div class="body">' + body + '</div><footer>' + (footer || '') + '</footer></div></div>';

    if (kind === 'conflict') {
      const c = view.conflicts.find((x) => x.id === id);
      if (!c) return '';
      const task = view.tasks.find((t) => t.conflictId === c.id);
      return shell(
        u.esc(c.fieldLabel) + ' — ' + u.esc(c.entityName),
        u.kindTag(c.kind) + u.severityTag(c.severity) + u.tag(pack.typeById[c.entityType].label, 'line'),
        '<div class="sect">What each system says</div>' +
        '<table class="tbl" style="font-size:12.5px"><tbody>' +
        '<tr><td>' + u.systemTag(pack, c.resolvedSystem) + '</td><td><b>' + u.esc(store.formatValue(c.field, c.resolvedValue)) + '</b></td>' +
        '<td style="text-align:right">' + u.tag('of record', 'solid') + '</td></tr>' +
        c.offenders.map((o) => '<tr><td>' + u.systemTag(pack, o.systemId) + '</td>' +
          '<td>' + (o.kind === 'gap' ? '<i class="dim">empty</i>' : u.esc(store.formatValue(c.field, o.value))) +
          '<div class="dim" style="font-size:10.5px">read ' + u.esc(u.ago(o.observedAt, view.asOf)) + '</div></td>' +
          '<td style="text-align:right">' + u.kindTag(o.kind) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="sect">Why it is classified this way</div>' +
        '<div class="muted" style="font-size:12.5px;line-height:1.6">' + u.esc(S.CONFLICT_KINDS[c.kind].blurb) + ' ' +
        u.esc(c.kind === 'lag'
          ? 'The disagreeing system was last read before this value changed, so it cannot know about it yet. No task was raised.'
          : c.kind === 'gap'
            ? 'The field is expected in that system and is empty, which breaks any join that depends on it.'
            : 'Both systems have been read recently and both are confident. One of them is wrong.') + '</div>' +
        (c.impact ? '<div class="sect">Consequence</div><div class="muted" style="font-size:12.5px;line-height:1.6">' + u.esc(c.impact) + '</div>' : '') +
        '<div class="sect">Policy applied</div><div class="muted" style="font-size:12.5px">' +
        u.esc((view.policy[c.field] || []).map((s) => pack.systemById[s].name).join(' → ')) +
        (pack.rationale[c.field] ? '<div style="margin-top:6px">' + u.esc(pack.rationale[c.field]) + '</div>' : '') +
        '<div style="margin-top:8px"><a class="link" href="#/admin">Change which system is authoritative →</a></div></div>' +
        (task ? '<div class="sect">Remediation</div><div class="card"><div class="card-b">' +
          '<div style="font-weight:600;margin-bottom:5px">' + u.esc(task.title) + '</div>' +
          '<div class="muted" style="font-size:12.5px;line-height:1.55">' + u.esc(task.instruction) + '</div>' +
          '<div style="margin-top:9px;display:flex;gap:7px;align-items:center">' + statusTag(task.status) +
          '<span class="dim" style="font-size:11px">' + u.esc(task.owner) + '</span></div></div></div>' : ''),
        '<a class="btn" href="#/e/' + u.at(c.entityId) + '?tab=integrity" data-act="close-drawer">Open record</a>' +
        (task ? '<button class="btn" data-act="task-status" data-id="' + u.at(task.id) + '" data-status="dismissed">Set aside</button>' +
          '<button class="btn" data-act="task-status" data-id="' + u.at(task.id) + '" data-status="resolved">Mark fixed</button>' +
          '<button class="btn solid" data-act="task-status" data-id="' + u.at(task.id) + '" data-status="in_progress">Accept</button>' : '')
      );
    }

    if (kind === 'task') {
      const t = view.tasks.find((x) => x.id === id);
      if (!t) return '';
      return shell(
        u.esc(t.title),
        u.severityTag(t.severity) + statusTag(t.status) + u.kindTag(t.kind),
        '<div class="sect">Instruction</div><div style="font-size:13px;line-height:1.6">' + u.esc(t.instruction) + '</div>' +
        '<div class="sect">Why it matters</div><div class="muted" style="font-size:12.5px;line-height:1.6">' + u.esc(t.impact) + '</div>' +
        '<div class="sect">Detail</div><dl class="kv">' +
        '<dt>Record</dt><dd>' + (t.entityId ? '<a class="link" href="#/e/' + u.at(t.entityId) + '" data-act="close-drawer">' + u.esc(t.entityName) + '</a>' : u.esc(t.entityName)) + '</dd>' +
        '<dt>Field</dt><dd>' + u.esc(t.fieldLabel) + '</dd>' +
        '<dt>Fix in</dt><dd>' + t.targets.map((s) => u.systemTag(pack, s)).join(' ') + '</dd>' +
        '<dt>Owner</dt><dd>' + u.esc(t.owner) + '</dd></dl>',
        '<button class="btn" data-act="task-status" data-id="' + u.at(t.id) + '" data-status="dismissed">Set aside</button>' +
        '<button class="btn" data-act="task-status" data-id="' + u.at(t.id) + '" data-status="resolved">Mark fixed</button>' +
        '<button class="btn solid" data-act="task-status" data-id="' + u.at(t.id) + '" data-status="in_progress">Accept</button>'
      );
    }
    return '';
  }

  SOT.views = Object.assign(SOT.views || {}, { integrity, identity, systems, tasks, admin, drawer, statusTag });
})(window.SOT || (window.SOT = {}));
