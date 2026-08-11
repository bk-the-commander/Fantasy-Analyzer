/* SOT — dashboard, type browser, and the universal entity page.
 *
 * There is one entity page, not five. A clinician, a patient, a ward, a
 * facility and a visit all render through the same function, because in the
 * model they are the same kind of thing: something with resolved fields,
 * provenance, statistics and typed relationships. That is what lets a user
 * click from a doctor to a ward to a visit to a patient to the nurse who was
 * on that visit without ever leaving the same interface.
 */
(function (SOT) {
  'use strict';

  const U = () => SOT.ui;
  const S = SOT.schema;

  /** A field value, rendered as a link when it points at another entity. */
  function fieldHtml(ctx, key, value) {
    const u = U();
    const target = ctx.store.resolveCode(key, value);
    if (!target) return u.esc(u.value(key, value));
    return '<a class="link" data-go="#/e/' + u.at(target.entity.id) + '" href="#/e/' + u.at(target.entity.id) + '">' +
      u.esc(target.name) + '</a>';
  }

  /* ============================================================= DASHBOARD */

  function dashboard(ctx) {
    const u = U();
    const { view, store } = ctx;
    const pack = view.pack;
    const sum = view.summary;
    const degraded = pack.systems.filter((s) => pack.syncState[s.id].status !== 'healthy');

    const typeCards = pack.entityTypes.map((t) => {
      const n = sum.counts[t.id];
      const denied = view.scope.allowed[t.id] instanceof Set && view.scope.allowed[t.id].size === 0;
      return '<button class="ecard" data-go="#/t/' + u.at(t.id) + '"' + (denied ? ' disabled style="opacity:.45"' : '') + '>' +
        '<span class="top"><span class="av sq">' + u.esc(t.glyph) + '</span>' +
        '<span><span class="nm num">' + (denied ? '—' : n.toLocaleString('en-US')) + '</span><br>' +
        '<span class="ti">' + u.esc(t.plural) + '</span></span></span>' +
        '<span class="meta">' + (denied ? 'Not visible to ' + u.esc(view.role.name) : 'Browse all ' + u.esc(t.plural.toLowerCase())) + '</span></button>';
    }).join('');

    // Most recent event-kind entities in scope — the pulse of the organisation.
    const eventType = pack.entityTypes.find((t) => t.kind === 'event');
    let recent = [];
    if (eventType) {
      recent = store.visible(eventType.id)
        .filter((p) => p.get(eventType.dateField))
        .sort((a, b) => b.get(eventType.dateField) - a.get(eventType.dateField))
        .slice(0, 7);
    }

    const worst = view.conflicts.filter((c) => sum.inScope.has(c.entityId) && c.actionable).slice(0, 6);

    return (
      '<div class="head"><div><h1>' + u.esc(pack.tenantName) + '</h1>' +
      '<div class="sub">' + u.esc(view.role.blurb) + ' Every figure below is resolved from ' + pack.systems.length +
      ' connected systems under the current system-of-record policy — nothing here is stored as a merged record.</div></div>' +
      '<div class="acts"><span class="tag line">As of ' + u.esc(u.date(view.asOf)) + '</span>' +
      '<a class="btn" href="#/integrity">Data integrity</a></div></div>' +

      (degraded.length
        ? '<div class="note medium" style="margin-bottom:12px"><span>▲</span><div><b>' + u.esc(degraded[0].name) +
          ' has not been read in ' + u.esc(u.ago(pack.syncState[degraded[0].id].lastSync, view.asOf).replace(' ago', '')) + '.</b> ' +
          u.esc(pack.syncState[degraded[0].id].message || '') +
          ' Its disagreements are being reported as lag rather than conflict. <a class="link" href="#/systems">Connector status</a></div></div>'
        : '') +

      '<div class="grid g-cards" style="margin-bottom:12px">' + typeCards + '</div>' +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Open findings', sum.actionable, sum.bySeverity.critical + ' critical · ' + sum.bySeverity.high + ' high', sum.bySeverity.critical ? 'hot' : '') +
      u.stat('Classified as lag', sum.byKind.lag, 'Behind, not wrong — excluded from the queue') +
      u.stat('System alignment', sum.alignment + '%', 'Weighted across every reconciled field') +
      u.stat('Identity queue', sum.identity.needsReview, 'Records awaiting a human decision') +
      u.stat('Relationships', view.graph.edges.length.toLocaleString('en-US'), 'Typed and time-bounded') +
      '</div>' +

      '<div class="split"><div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Needs attention</h3>' +
      '<div class="right"><a class="btn sm" href="#/tasks">Remediation queue</a></div></div>' +
      '<div class="card-b flush">' +
      (worst.length
        ? '<table class="tbl"><tbody>' + worst.map((c) =>
            '<tr class="go" data-drawer="conflict:' + u.at(c.id) + '"><td>' +
            '<div style="font-weight:560">' + u.esc(c.fieldLabel) + ' — ' + u.esc(c.entityName) + '</div>' +
            '<div class="dim" style="font-size:11px;margin-top:2px">' +
            u.esc(pack.systemById[c.resolvedSystem].name) + ' says “' + u.esc(store.formatValue(c.field, c.resolvedValue)) + '”, ' +
            u.esc(c.offenders.map((o) => pack.systemById[o.systemId].name + (o.kind === 'gap' ? ' has nothing' : ' says “' + store.formatValue(c.field, o.value) + '”')).join('; ')) +
            '</div></td><td style="text-align:right;white-space:nowrap">' + u.severityTag(c.severity) + '</td></tr>').join('') + '</tbody></table>'
        : u.empty('Nothing outstanding in your scope.')) +
      '</div></div>' +

      (recent.length
        ? '<div class="card"><div class="card-h"><h3>Recent ' + u.esc(eventType.plural.toLowerCase()) + '</h3>' +
          '<div class="right"><a class="btn sm" href="#/t/' + u.at(eventType.id) + '">All</a></div></div>' +
          '<div class="card-b flush"><table class="tbl"><tbody>' +
          recent.map((e) => {
            const unit = view.graph.neighbours(e.entity.id, pack.id === 'health' ? 'occurred_at' : 'conducted_at', { dir: 'out' })[0];
            return '<tr class="go" data-go="#/e/' + u.at(e.entity.id) + '">' +
              '<td>' + u.entityLine(e, pack) + '</td>' +
              '<td class="dim">' + (unit ? u.esc(view.profiles[unit.entity.id].name) : '') + '</td>' +
              '<td style="text-align:right;white-space:nowrap" class="dim">' + u.esc(u.ago(e.get(eventType.dateField), view.asOf)) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>'
        : '') +
      '</div>' +

      '<div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Findings by kind</h3></div><div class="card-b">' +
      ['divergence', 'gap', 'lag'].map((k) => {
        const n = sum.byKind[k];
        const total = sum.conflicts || 1;
        return '<div style="margin-bottom:11px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">' +
          u.kindTag(k) + '<span class="num dim" style="margin-left:auto;font-size:12px">' + n + '</span></div>' +
          '<div class="bar"><i style="width:' + Math.round((n / total) * 100) + '%"></i></div>' +
          '<div class="dim" style="font-size:11px;margin-top:4px">' + u.esc(S.CONFLICT_KINDS[k].blurb) + '</div></div>';
      }).join('') +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>Connected systems</h3><div class="right"><a class="btn sm" href="#/systems">Details</a></div></div>' +
      '<div class="card-b flush"><table class="tbl"><tbody>' +
      pack.systems.map((s) => {
        const st = pack.syncState[s.id];
        return '<tr><td>' + u.systemTag(pack, s.id) + '</td>' +
          '<td class="dim" style="text-align:right;font-size:11px">' + u.esc(u.ago(st.lastSync, view.asOf)) + '</td>' +
          '<td style="width:1%">' + (st.status === 'healthy' ? u.tag('OK', 'ok') : u.tag('Stale', 'medium')) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '</div></div>'
    );
  }

  /* ========================================================== TYPE BROWSER */

  function browse(ctx) {
    const u = U();
    const { view, store, state, route } = ctx;
    const pack = view.pack;
    const type = pack.typeById[route.parts[1]];
    if (!type) return u.empty('Unknown type.');

    let rows = store.visible(type.id);
    const denied = view.scope.allowed[type.id] instanceof Set && view.scope.allowed[type.id].size === 0;
    if (denied) {
      return '<div class="head"><h1>' + u.esc(type.plural) + '</h1></div>' +
        '<div class="note critical"><span>✕</span><div><b>Not visible at your permission level.</b> ' +
        'The ' + u.esc(view.role.name) + ' role has no access to ' + u.esc(type.plural.toLowerCase()) +
        '. This is enforced on the data, not hidden in the interface — the records are not in scope at all.</div></div>';
    }

    const q = (state.browseQ || '').trim().toLowerCase();
    if (q) rows = rows.filter((p) => (p.name + ' ' + (type.keyFacts || []).map((k) => p.get(k)).join(' ')).toLowerCase().includes(q));
    if (state.browseIssues) rows = rows.filter((p) => p.conflicts.some((c) => c.actionable));

    const statDefs = SOT.stats.forType(pack.id, type.id).slice(0, 3);
    const dateField = type.dateField;
    rows = rows.sort((a, b) => (dateField ? (b.get(dateField) || 0) - (a.get(dateField) || 0) : a.name.localeCompare(b.name)));

    const cols = (type.keyFacts || []).slice(0, 3);

    return (
      '<div class="head"><div><h1>' + u.esc(type.plural) + '</h1>' +
      '<div class="sub">' + rows.length.toLocaleString('en-US') + ' in scope. Every row opens a full record — ' +
      'resolved fields, statistics, relationships and the systems each value came from.</div></div>' +
      '<div class="acts">' +
      '<input class="in" id="browse-q" placeholder="Filter…" value="' + u.at(state.browseQ || '') + '" style="width:170px">' +
      '<button class="chip ' + (state.browseIssues ? 'on' : '') + '" data-act="browse-issues">Only with findings</button>' +
      '</div></div>' +

      '<div class="card"><div class="card-b flush"><div class="xs">' +
      (rows.length
        ? '<table class="tbl"><thead><tr><th>' + u.esc(type.label) + '</th>' +
          cols.map((c) => '<th>' + u.esc((pack.fieldByKey[type.id + '.' + c] || { label: c }).label) + '</th>').join('') +
          statDefs.map((s) => '<th class="num">' + u.esc(s.label) + '</th>').join('') +
          '<th class="num">Alignment</th></tr></thead><tbody>' +
          rows.slice(0, 250).map((p) => {
            const stats = store.statsFor(p.entity.id);
            const open = p.conflicts.filter((c) => c.actionable).length;
            return '<tr class="go" data-go="#/e/' + u.at(p.entity.id) + '">' +
              '<td>' + u.entityLine(p, pack) + '</td>' +
              cols.map((c) => {
                const f = pack.fieldByKey[type.id + '.' + c];
                if (f && !store.canSee(f.sensitivity)) return '<td class="dim">restricted</td>';
                return '<td>' + fieldHtml(ctx, c, p.get(c)) + '</td>';
              }).join('') +
              statDefs.map((sd) => {
                const s = stats.find((x) => x.id === sd.id);
                if (s && !store.canSee(s.sensitivity)) return '<td class="num dim">—</td>';
                return '<td class="num">' + u.esc(s ? u.statValue(s) : '—') + '</td>';
              }).join('') +
              '<td class="num">' + (open ? '<span class="tag critical">' + open + '</span>' : '<span class="dim">' + p.alignment + '%</span>') + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table>'
        : u.empty('Nothing matches.')) +
      '</div></div></div>' +
      (rows.length > 250 ? '<div class="dim" style="margin-top:8px;font-size:11.5px">Showing the first 250 of ' + rows.length.toLocaleString('en-US') + '.</div>' : '')
    );
  }

  /* ======================================================== ENTITY PROFILE */

  function entity(ctx) {
    const u = U();
    const { view, store, state, route } = ctx;
    const pack = view.pack;
    const id = route.parts[1];
    const p = view.profiles[id];
    if (!p) return u.empty('Not in the resolved graph.');

    const type = pack.typeById[p.type];

    if (!store.canOpen(id)) {
      return '<div class="head"><h1>' + u.esc(type.label) + '</h1></div>' +
        '<div class="note critical"><span>✕</span><div><b>Outside your permission scope.</b> ' +
        'The ' + u.esc(view.role.name) + ' role can see ' + u.esc(describeScope(view.role, p.type)) +
        '. Switch role in the top bar to open this record.</div></div>';
    }

    const tab = route.query.tab || 'overview';
    const conns = connectionGroups(ctx, p);
    const connCount = conns.reduce((n, g) => n + g.rows.length, 0);
    const timeline = timelineOf(ctx, p);
    const open = p.conflicts.filter((c) => c.actionable).length;

    const facts = (type.keyFacts || []).map((k) => {
      const f = pack.fieldByKey[p.type + '.' + k];
      const label = f ? f.label : k;
      const val = f && !store.canSee(f.sensitivity) ? '<span class="dim">restricted</span>' : fieldHtml(ctx, k, p.get(k));
      return '<div><div class="dim" style="font-size:10.5px">' + u.esc(label) + '</div>' +
        '<div style="font-weight:550;margin-top:1px">' + val + '</div></div>';
    }).join('');

    const statusTags = statusFor(ctx, p).join(' ');

    const header =
      '<div class="card" style="margin-bottom:14px"><div class="card-b" style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
      u.avatar(p, pack, 'lg') +
      '<div style="flex:1;min-width:220px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h1 style="font-size:20px">' + u.esc(p.name) + '</h1>' + u.tag(type.label, 'line') + statusTags + '</div>' +
      '<div class="muted" style="margin-top:3px;font-size:12.5px">' +
      u.esc((type.subtitle || []).map((k) => p.get(k)).filter(Boolean).join(' · ') || '—') + '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12.5px">' + facts + '</div>' +
      '</div>' +
      '<div style="text-align:center">' + u.ring(p.alignment) +
      '<div class="dim" style="font-size:10px;margin-top:4px">alignment</div></div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border);padding:9px 14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<span class="dim" style="font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;margin-right:2px">Open in</span>' +
      pack.systems.map((s) => {
        const link = (p.entity.bySystem[s.id] || [])[0];
        return link ? u.systemLink(pack, s.id, link.nativeId)
          : '<span class="btn sm" style="opacity:.35;cursor:default">' + u.esc(s.name) + '</span>';
      }).join('') +
      (open ? '<a class="btn sm solid" style="margin-left:auto" href="#/e/' + u.at(id) + '?tab=integrity">' + open + ' open</a>' : '') +
      '</div></div>';

    const body =
      tab === 'connections' ? connectionsTab(ctx, p, conns) :
      tab === 'timeline' ? timelineTab(ctx, p, timeline) :
      tab === 'systems' ? systemsTab(ctx, p) :
      tab === 'integrity' ? integrityTab(ctx, p) :
      overviewTab(ctx, p, conns);

    return header + u.tabs([
      { id: 'overview', label: 'Overview' },
      { id: 'connections', label: 'Connections', count: connCount },
      { id: 'timeline', label: 'Timeline', count: timeline.length },
      { id: 'systems', label: 'Systems', count: p.linkedSystems.length },
      { id: 'integrity', label: 'Integrity', count: p.conflicts.length },
    ], tab, 'ent-tab') + body;
  }

  function describeScope(role, typeId) {
    const rule = (role.scopes || {})[typeId];
    if (rule === 'none') return 'no records of this kind at all';
    if (rule === 'unit' || rule === 'group') return 'only records attached to their own group';
    if (rule === 'care' || rule === 'book') return 'only records they personally handle';
    return 'everything';
  }

  function statusFor(ctx, p) {
    const u = U();
    const out = [];
    const status = p.get('employmentStatus') || p.get('patientStatus') || p.get('dutyStatus');
    if (status && /Terminated|Inactive|Deceased/i.test(status)) out.push(u.tag(status, 'critical'));
    const expiry = p.get('licenseExpiry') || p.get('clearanceExpiry');
    if (expiry && expiry < ctx.view.asOf) out.push(u.tag('Expired ' + (p.get('licenseExpiry') ? 'licence' : 'clearance'), 'critical'));
    if (p.get('privilegeStatus') === 'Expired') out.push(u.tag('Privileges lapsed', 'critical'));
    if (p.get('medicalReadiness') === 'Overdue') out.push(u.tag('Readiness overdue', 'high'));
    p.entity.flags.forEach((f) => out.push(u.tag(f.label, f.severity === 'critical' ? 'critical' : 'high')));
    if (p.scheduled.length) out.push(u.tag(p.scheduled.length + ' scheduled change' + (p.scheduled.length === 1 ? '' : 's'), 'low'));
    return out;
  }

  /* ------------------------------------------------------- connections ---
   *
   * Grouped by edge type and direction, split into current and previous. The
   * "previous" half is the point of the whole model: it is how the product
   * answers who used to hold a territory, a ward or a caseload.
   */
  function connectionGroups(ctx, p) {
    const { view, store } = ctx;
    const pack = view.pack;
    const groups = [];
    pack.edgeTypes.forEach((et) => {
      [['out', et.label, et.to], ['in', et.inverse, et.from]].forEach(([dir, label, otherType]) => {
        if ((dir === 'out' && et.from !== p.type) || (dir === 'in' && et.to !== p.type)) return;
        const rows = view.graph.neighbours(p.entity.id, et.id, { dir })
          .filter((n) => store.canOpen(n.entity.id))
          .map((n) => ({
            profile: view.profiles[n.entity.id],
            edge: n.edge,
            current: !et.temporal || S.activeAt(n.edge.fromTs, n.edge.toTs, view.asOf),
          }))
          .sort((a, b) => (b.edge.fromTs || 0) - (a.edge.fromTs || 0));
        if (!rows.length) return;
        groups.push({ edgeType: et, dir, label, otherType, rows });
      });
    });
    return groups;
  }

  function connectionsTab(ctx, p, groups) {
    const u = U();
    const { view, state } = ctx;
    const pack = view.pack;
    if (!groups.length) return '<div class="card"><div class="card-b">' + u.empty('Nothing is connected to this record.') + '</div></div>';

    return '<div class="grid g-2">' + groups.map((g) => {
      const showPast = state.showPast[g.edgeType.id + g.dir] !== false;
      const current = g.rows.filter((r) => r.current);
      const past = g.rows.filter((r) => !r.current);
      const rowHtml = (r) =>
        '<tr class="go" data-go="#/e/' + u.at(r.profile.entity.id) + '">' +
        '<td>' + u.entityLine(r.profile, pack) + '</td>' +
        (g.edgeType.roled ? '<td class="dim">' + u.esc(r.edge.role || '') + '</td>' : '') +
        '<td style="text-align:right;white-space:nowrap" class="dim">' +
        (g.edgeType.temporal
          ? (r.current
              ? (r.edge.fromTs ? 'since ' + u.esc(u.date(r.edge.fromTs)) : 'current')
              : u.esc(u.date(r.edge.fromTs)) + ' – ' + u.esc(u.date(r.edge.toTs)))
          : '') + '</td></tr>';

      return '<div class="card"><div class="card-h"><h3>' + u.esc(g.label) + '</h3>' +
        '<span class="sub">' + current.length + (past.length ? ' current · ' + past.length + ' previous' : '') + '</span>' +
        (past.length ? '<div class="right"><button class="chip ' + (showPast ? 'on' : '') + '" data-act="toggle-past" data-key="' +
          u.at(g.edgeType.id + g.dir) + '">Show previous</button></div>' : '') +
        '</div><div class="card-b flush"><div class="xs"><table class="tbl"><tbody>' +
        current.slice(0, 40).map(rowHtml).join('') +
        (past.length && showPast
          ? '<tr><td colspan="4" style="background:var(--surface-2);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);font-weight:650">Previously</td></tr>' +
            past.slice(0, 40).map(rowHtml).join('')
          : '') +
        '</tbody></table></div></div></div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------- timeline --- */

  function timelineOf(ctx, p) {
    const { view, store } = ctx;
    const pack = view.pack;
    const events = [];

    pack.edgeTypes.forEach((et) => {
      if (!et.temporal) return;
      [['out', et.label], ['in', et.inverse]].forEach(([dir, label]) => {
        if ((dir === 'out' && et.from !== p.type) || (dir === 'in' && et.to !== p.type)) return;
        view.graph.neighbours(p.entity.id, et.id, { dir }).forEach((n) => {
          if (!store.canOpen(n.entity.id)) return;
          const other = view.profiles[n.entity.id];
          if (n.edge.fromTs) events.push({ ts: n.edge.fromTs, text: label + ' — ' + other.name, href: '#/e/' + other.entity.id, kind: 'start' });
          if (n.edge.toTs) events.push({ ts: n.edge.toTs, text: 'Ended: ' + label.toLowerCase() + ' — ' + other.name, href: '#/e/' + other.entity.id, kind: 'end' });
        });
      });
    });

    // Event-kind entities attached to this one, whichever edge type carries them.
    pack.entityTypes.filter((t) => t.kind === 'event').forEach((et) => {
      pack.edgeTypes.forEach((edge) => {
        const dir = edge.from === et.id && edge.to === p.type ? 'in' : edge.to === et.id && edge.from === p.type ? 'out' : null;
        if (!dir) return;
        view.graph.neighbours(p.entity.id, edge.id, { dir }).forEach((n) => {
          const e = view.profiles[n.entity.id];
          if (!e || e.type !== et.id || !store.canOpen(e.entity.id)) return;
          events.push({
            ts: e.get(et.dateField), text: e.name + (n.edge.role ? ' — ' + n.edge.role : ''),
            href: '#/e/' + e.entity.id, kind: 'event',
          });
        });
      });
    });

    p.scheduled.forEach((s) => events.push({ ts: s.effectiveFrom, text: s.fieldLabel + ' becomes “' + s.value + '”', kind: 'future' }));

    const seen = new Set();
    return events
      .filter((e) => e.ts && !seen.has(e.ts + e.text) && seen.add(e.ts + e.text))
      .sort((a, b) => b.ts - a.ts);
  }

  function timelineTab(ctx, p, events) {
    const u = U();
    const { view } = ctx;
    if (!events.length) return '<div class="card"><div class="card-b">' + u.empty('No dated activity.') + '</div></div>';
    const future = events.filter((e) => e.ts > view.asOf);
    const past = events.filter((e) => e.ts <= view.asOf);
    const row = (e) =>
      '<div class="tev ' + (e.kind === 'event' ? 'open' : '') + '"' + (e.href ? ' data-go="' + u.at(e.href) + '"' : '') + '>' +
      '<span class="when">' + u.esc(u.date(e.ts)) + '</span>' +
      '<span class="what">' + u.esc(e.text) + '</span>' +
      '<span>' + (e.kind === 'future' ? u.tag('scheduled', 'low') : e.kind === 'end' ? u.tag('ended', 'line') : '') + '</span></div>';

    return '<div class="card"><div class="card-h"><h3>Timeline</h3>' +
      '<span class="sub">' + events.length + ' dated events, newest first</span></div>' +
      '<div class="card-b"><div class="tline">' +
      (future.length ? future.map(row).join('') + '<div class="sect" style="margin-left:-18px">Today — ' + u.esc(u.date(view.asOf)) + '</div>' : '') +
      past.slice(0, 120).map(row).join('') +
      '</div>' +
      (past.length > 120 ? '<div class="dim" style="font-size:11.5px;margin-top:8px">Showing the most recent 120 of ' + past.length + '.</div>' : '') +
      '</div></div>';
  }

  /* ----------------------------------------------------------- overview -- */

  function overviewTab(ctx, p, groups) {
    const u = U();
    const { view, store } = ctx;
    const pack = view.pack;
    const stats = store.statsFor(p.entity.id).filter((s) => store.canSee(s.sensitivity));
    const byGroup = {};
    pack.fields.filter((f) => f.entity === p.type).forEach((f) => (byGroup[f.group] || (byGroup[f.group] = [])).push(f));

    const fieldCard = (groupName, fields) =>
      '<div class="card"><div class="card-h"><h3>' + u.esc(groupName[0].toUpperCase() + groupName.slice(1)) + '</h3></div>' +
      '<div class="card-b"><dl class="kv">' + fields.map((f) => {
        const cell = p.fields[f.key];
        if (!store.canSee(f.sensitivity)) return '<dt>' + u.esc(f.label) + '</dt><dd class="dim">restricted at your permission level</dd>';
        if (!cell || cell.absent) return '<dt>' + u.esc(f.label) + '</dt><dd class="dim">—</dd>';
        return '<dt>' + u.esc(f.label) + '</dt><dd>' + fieldHtml(ctx, f.key, cell.value) +
          ' <span class="dim" style="font-size:10.5px">' + u.esc(pack.systemById[cell.systemId].name) + '</span>' +
          (cell.conflict ? ' ' + u.kindTag(cell.conflict.kind) : '') + '</dd>';
      }).join('') + '</dl></div></div>';

    const quickLinks = groups.slice(0, 4).map((g) =>
      '<div style="margin-bottom:10px"><div class="dim" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">' +
      u.esc(g.label) + '</div>' +
      g.rows.filter((r) => r.current).slice(0, 4).map((r) =>
        '<div class="tev" style="grid-template-columns:1fr auto;padding:4px 6px" data-go="#/e/' + u.at(r.profile.entity.id) + '">' +
        '<span class="what">' + u.esc(r.profile.name) + '</span>' +
        '<span class="dim" style="font-size:11px">' + u.esc(r.edge.role || pack.typeById[r.profile.type].label) + '</span></div>').join('') +
      '</div>').join('');

    return (
      (stats.length ? '<div class="grid g-stat" style="margin-bottom:12px">' + stats.map(u.statTile).join('') + '</div>' : '') +
      '<div class="split"><div class="grid" style="gap:12px">' +
      Object.keys(byGroup).map((g) => fieldCard(g, byGroup[g])).join('') +
      '</div><div class="grid" style="gap:12px">' +
      (quickLinks ? '<div class="card"><div class="card-h"><h3>Connected</h3>' +
        '<div class="right"><a class="btn sm" href="#/e/' + u.at(p.entity.id) + '?tab=connections">All</a></div></div>' +
        '<div class="card-b">' + quickLinks + '</div></div>' : '') +
      (p.scheduled.length
        ? '<div class="card"><div class="card-h"><h3>Scheduled</h3></div><div class="card-b">' +
          '<div class="dim" style="font-size:11.5px;margin-bottom:9px">Future-dated facts. Deliberately not counted as discrepancies.</div>' +
          p.scheduled.map((s) => '<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:6px">' +
            u.tag(u.date(s.effectiveFrom), 'low') + '<div><b>' + u.esc(s.fieldLabel) + '</b> → ' + u.esc(String(s.value)) + '</div></div>').join('') +
          '</div></div>'
        : '') +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------ systems -- */

  function systemsTab(ctx, p) {
    const u = U();
    const { view } = ctx;
    const pack = view.pack;
    return '<div class="grid g-2">' + pack.systems.map((s) => {
      const links = p.entity.bySystem[s.id] || [];
      const sync = pack.syncState[s.id];
      if (!links.length) {
        return '<div class="card"><div class="card-h">' + u.systemTag(pack, s.id) +
          '<div class="right">' + u.tag('not linked', 'line') + '</div></div>' +
          '<div class="card-b dim" style="font-size:12.5px">No record in ' + u.esc(s.name) + ' resolves to this ' +
          u.esc(pack.typeById[p.type].label.toLowerCase()) + '.</div></div>';
      }
      return links.map((l) => {
        const rows = Object.keys(l.record).filter((k) => k[0] !== '_' && k !== 'observedAt' && l.record[k] !== null && typeof l.record[k] !== 'object');
        return '<div class="card"><div class="card-h">' + u.systemTag(pack, s.id) +
          '<span class="sub mono">' + u.esc(l.nativeId) + '</span>' +
          '<div class="right">' + u.tag(Math.round(l.confidence * 100) + '% match', l.confidence >= 0.95 ? 'ok' : 'medium') +
          u.systemLink(pack, s.id, l.nativeId) + '</div></div>' +
          '<div class="card-b"><dl class="kv">' +
          rows.slice(0, 16).map((k) => {
            let v = l.record[k];
            if (typeof v === 'number' && Math.abs(v) > 1e10) v = u.date(v);
            if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
            return '<dt>' + u.esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())) + '</dt><dd>' + u.esc(v) + '</dd>';
          }).join('') + '</dl>' +
          '<div class="dim" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border);font-size:11px">' +
          u.esc(l.methodLabel) + ' · read ' + u.esc(u.ago(sync.lastSync, view.asOf)) + '</div></div></div>';
      }).join('');
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------- integrity -- */

  function integrityTab(ctx, p) {
    const u = U();
    const { view, store, state } = ctx;
    const pack = view.pack;
    const cells = pack.fields.filter((f) => f.entity === p.type).map((f) => p.fields[f.key]).filter((c) => c && !c.absent);
    const conflicted = cells.filter((c) => c.conflict);

    const glyph = (c) => c.conflict
      ? '<span style="color:var(--' + (c.conflict.kind === 'divergence' ? 'sev-critical' : c.conflict.kind === 'gap' ? 'sev-medium' : 'sev-low') + ')">●</span>'
      : '<span style="color:var(--ok)">●</span>';

    return (
      '<div class="card" style="margin-bottom:12px"><div class="card-b" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      u.ring(p.alignment, 66) +
      '<div style="flex:1;min-width:240px">' +
      '<h3 style="font-size:14px">' + (cells.length - conflicted.length) + ' of ' + cells.length + ' fields agree</h3>' +
      '<div class="muted" style="font-size:12.5px;margin-top:4px;line-height:1.55">Weighted by consequence — a disputed reporting line or a wrong date of birth costs far more than a stale phone number, and lag counts as a third of a divergence.</div>' +
      '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">' +
      u.tag((cells.length - conflicted.length) + ' aligned', 'ok') +
      u.kindTag('divergence') + '<span class="dim" style="font-size:11.5px;align-self:center">' + conflicted.filter((c) => c.conflict.kind === 'divergence').length + '</span>' +
      u.kindTag('gap') + '<span class="dim" style="font-size:11.5px;align-self:center">' + conflicted.filter((c) => c.conflict.kind === 'gap').length + '</span>' +
      u.kindTag('lag') + '<span class="dim" style="font-size:11.5px;align-self:center">' + conflicted.filter((c) => c.conflict.kind === 'lag').length + '</span>' +
      '</div></div></div></div>' +

      '<div class="prov">' + cells.map((cell) => {
        const f = cell.field;
        const key = 'prov:' + p.entity.id + ':' + f.key;
        const openRow = !!state.expanded[key];
        const redacted = !store.canSee(f.sensitivity);
        const c = cell.conflict;
        return '<div class="prow"><button class="phead" data-act="prov" data-key="' + u.at(key) + '">' +
          '<span>' + glyph(cell) + '</span>' +
          '<span class="fn">' + u.esc(f.label) + '</span>' +
          '<span class="fv">' + (redacted ? '<span class="dim">restricted</span>' : u.esc(u.value(f.key, cell.value))) + '</span>' +
          u.systemTag(pack, cell.systemId) +
          '<span>' + (c ? u.kindTag(c.kind) : u.tag('aligned', 'ok')) + '</span></button>' +
          (openRow
            ? '<div class="pbody"><table><tbody>' +
              cell.assertions.map((a) =>
                '<tr><td style="width:150px">' + u.systemTag(pack, a.systemId) + '</td>' +
                '<td><b>' + (redacted ? '—' : u.esc(u.value(f.key, a.value))) + '</b></td>' +
                '<td class="dim" style="text-align:right;font-size:11px">read ' + u.esc(u.ago(a.observedAt, view.asOf)) +
                (a.effectiveDating && a.effectiveFrom !== a.observedAt ? ' · effective ' + u.esc(u.date(a.effectiveFrom)) : '') + '</td>' +
                '<td style="text-align:right;width:96px">' +
                (a.systemId === cell.systemId ? u.tag('of record', 'solid')
                  : SOT.resolve.sameValue(a.value, cell.value) ? u.tag('agrees', 'ok') : u.tag('differs', 'critical')) +
                '</td></tr>').join('') +
              (c ? c.offenders.filter((o) => o.kind === 'gap').map((o) =>
                '<tr><td>' + u.systemTag(pack, o.systemId) + '</td><td class="dim">empty</td>' +
                '<td colspan="2" style="text-align:right">' + u.kindTag('gap') + '</td></tr>').join('') : '') +
              '</tbody></table>' +
              '<div class="dim" style="margin-top:9px;font-size:11.5px;line-height:1.55">' +
              (c
                ? '<b>' + u.esc(S.CONFLICT_KINDS[c.kind].label) + '.</b> ' + u.esc(S.CONFLICT_KINDS[c.kind].blurb) +
                  (c.kind === 'lag'
                    ? ' No action — it reconciles on the next successful read.'
                    : ' <a class="link" href="#" data-drawer="conflict:' + u.at(c.id) + '">Investigate</a>')
                : 'Every system carrying this field reports the same value. Policy: ' +
                  u.esc((view.policy[f.key] || []).map((s) => pack.systemById[s].name).join(' → '))) +
              '</div></div>'
            : '') + '</div>';
      }).join('') + '</div>'
    );
  }

  SOT.views = Object.assign(SOT.views || {}, { dashboard, browse, entity, connectionGroups });
})(window.SOT || (window.SOT = {}));
