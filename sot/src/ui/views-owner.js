/* SOT — operator console.
 *
 * The view from Kaliris Labs rather than from inside a customer: every tenant
 * on the instance, every connector, the shared model that all of them run on,
 * who has access to what, what has been changed, and what is left to build.
 *
 * It is deliberately a control plane and not a second analytics product. The
 * question it answers is "is the platform healthy and who did what", not
 * "how is the business doing" — that is what the tenant view is for.
 */
(function (SOT) {
  'use strict';

  const U = () => SOT.ui;
  const S = SOT.schema;

  /* ══════════════════════════════════════════════════════════════ TENANTS ═ */

  function tenants(ctx) {
    const u = U();
    const { store } = ctx;
    const p = store.platform();

    return (
      head('Tenants', 'Every organization on this instance, resolved through the same engine. ' +
        'Two were hand-written; four are declarations against the vertical toolkit. Nothing downstream can tell which is which.') +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Tenants', p.tenants.length, 'Across ' + new Set(p.tenants.map((t) => t.industry)).size + ' industries') +
      u.stat('Entities resolved', p.totals.entities.toLocaleString('en-US'), 'People, places, groups and events') +
      u.stat('Source records', p.totals.records.toLocaleString('en-US'), 'Read from ' + p.totals.systems + ' connectors') +
      u.stat('Relationships', p.totals.edges.toLocaleString('en-US'), 'Typed and time-bounded') +
      u.stat('Open findings', p.totals.findings.toLocaleString('en-US'), p.totals.critical + ' critical', p.totals.critical ? 'hot' : '') +
      u.stat('Degraded connectors', p.totals.degraded, 'Across all tenants', p.totals.degraded ? 'hot' : '') +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>Instance</h3><span class="sub">click a row to enter that tenant</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl">' +
      '<thead><tr><th>Tenant</th><th>Industry</th><th>Origin</th><th class="num">Entities</th><th class="num">Records</th>' +
      '<th class="num">Connectors</th><th class="num">Findings</th><th class="num">Queue</th><th class="num">Alignment</th></tr></thead><tbody>' +
      p.tenants.map((t) =>
        '<tr class="go" data-act="enter-tenant" data-tenant="' + u.at(t.id) + '">' +
        '<td><b>' + u.esc(t.tenantName) + '</b><div class="dim" style="font-size:10.5px">' + u.esc(t.label) + '</div></td>' +
        '<td class="dim">' + u.esc(t.industry) + '</td>' +
        '<td>' + (t.generated ? u.tag('declared', 'line') : u.tag('hand-written', 'line')) + '</td>' +
        '<td class="num">' + t.entities.toLocaleString('en-US') + '</td>' +
        '<td class="num">' + t.records.toLocaleString('en-US') + '</td>' +
        '<td class="num">' + t.systems + (t.degraded ? ' ' + u.tag(t.degraded + ' down', 'critical') : '') + '</td>' +
        '<td class="num">' + (t.critical ? u.tag(String(t.findings), 'critical') : t.findings) + '</td>' +
        '<td class="num">' + t.queue + '</td>' +
        '<td class="num">' + t.alignment + '%</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="grid g-3" style="margin-top:12px">' +
      p.tenants.map((t) =>
        '<div class="card"><div class="card-h"><h3>' + u.esc(t.tenantName) + '</h3>' +
        '<div class="right"><button class="btn sm" data-act="enter-tenant" data-tenant="' + u.at(t.id) + '">Open</button></div></div>' +
        '<div class="card-b">' +
        '<div class="dim" style="font-size:11.5px;margin-bottom:10px;line-height:1.5">' + u.esc(t.tagline) + '</div>' +
        '<table class="tbl" style="font-size:12px"><tbody>' +
        t.entityTypes.map((et) => '<tr><td style="padding-left:0">' + u.esc(et.plural) + '</td>' +
          '<td class="num">' + (t.counts[et.id] || 0).toLocaleString('en-US') + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="dim" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border);font-size:11px">' +
        t.fields + ' reconciled fields · ' + t.roles.length + ' roles' +
        (t.policyChanged ? ' · ' + u.esc(String(t.policyChanged)) + ' policy override' + (t.policyChanged === 1 ? '' : 's') : '') +
        '</div></div></div>').join('') +
      '</div>'
    );
  }

  /* ═══════════════════════════════════════════════════════════ CONNECTORS ═ */

  function connectors(ctx) {
    const u = U();
    const { store } = ctx;
    const p = store.platform();
    const rows = [];
    p.tenants.forEach((t) => t.systemList.forEach((sy) => {
      const st = t.syncState[sy.id];
      rows.push({ tenant: t, sy, st, records: t.recordCounts[sy.id] || 0 });
    }));
    rows.sort((a, b) => (a.st.status === 'healthy' ? 1 : 0) - (b.st.status === 'healthy' ? 1 : 0) || a.st.lastSync - b.st.lastSync);
    const now = Date.now();
    const asOfOf = (t) => p.tenants.find((x) => x.id === t.id).syncState;

    return (
      head('Connectors', 'Every integration across every tenant. A connector that has stopped responding does not produce wrong answers — ' +
        'it produces answers classified as lag, which is the difference between a queue people work and a report people mute.') +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Connectors', rows.length, 'Across ' + p.tenants.length + ' tenants') +
      u.stat('Healthy', rows.filter((r) => r.st.status === 'healthy').length, 'Reading on schedule') +
      u.stat('Degraded', rows.filter((r) => r.st.status !== 'healthy').length, 'Needs attention', rows.some((r) => r.st.status !== 'healthy') ? 'hot' : '') +
      u.stat('Records read', p.totals.records.toLocaleString('en-US'), 'Person, place and event rows') +
      u.stat('Categories', new Set(rows.map((r) => r.sy.category)).size, 'Distinct kinds of system') +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>All integrations</h3><span class="sub">worst first</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl">' +
      '<thead><tr><th>Connector</th><th>Tenant</th><th>Category</th><th>Cadence</th><th>Last read</th><th class="num">Records</th><th>Status</th></tr></thead><tbody>' +
      rows.map((r) =>
        '<tr class="go" data-act="enter-tenant" data-tenant="' + u.at(r.tenant.id) + '" data-to="#/systems">' +
        '<td><b>' + u.esc(r.sy.name) + '</b><div class="dim" style="font-size:10.5px">' + u.esc(r.sy.blurb) + '</div></td>' +
        '<td class="dim">' + u.esc(r.tenant.tenantName) + '</td>' +
        '<td class="dim">' + u.esc(r.sy.category) + '</td>' +
        '<td class="dim">' + u.esc(r.sy.syncCadence) + '</td>' +
        '<td class="dim">' + u.esc(u.ago(r.st.lastSync, now)) + '</td>' +
        '<td class="num">' + r.records.toLocaleString('en-US') + '</td>' +
        '<td>' + (r.st.status === 'healthy' ? u.tag('healthy', 'ok') : u.tag('degraded', 'critical')) + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      (rows.some((r) => r.st.message)
        ? '<div class="card" style="margin-top:12px"><div class="card-h"><h3>Notices</h3></div><div class="card-b flush">' +
          '<table class="tbl"><tbody>' + rows.filter((r) => r.st.message).map((r) =>
            '<tr><td style="width:200px"><b>' + u.esc(r.sy.name) + '</b><div class="dim" style="font-size:10.5px">' +
            u.esc(r.tenant.tenantName) + '</div></td><td>' + u.esc(r.st.message) + '</td>' +
            '<td style="text-align:right">' + (r.st.status === 'healthy' ? u.tag('by design', 'line') : u.tag('degraded', 'critical')) + '</td></tr>').join('') +
          '</tbody></table></div></div>'
        : '')
    );
  }

  /* ════════════════════════════════════════════════════════════════ MODEL ═ */

  function model(ctx) {
    const u = U();
    const { store, state } = ctx;
    const p = store.platform();
    const sel = state.ownerTenant || p.tenants[0].id;
    const t = p.tenants.find((x) => x.id === sel) || p.tenants[0];
    const pack = store.packFor(t.id);

    return (
      head('Model', 'What each tenant declares. The engine has no opinion about hospitals or freight — it reads these declarations, ' +
        'and everything else follows from them.') +

      '<div class="chips" style="margin-bottom:12px">' +
      p.tenants.map((x) => '<button class="chip ' + (x.id === sel ? 'on' : '') + '" data-act="owner-tenant" data-tenant="' + u.at(x.id) + '">' +
        u.esc(x.tenantName) + '</button>').join('') + '</div>' +

      '<div class="split"><div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Entity types</h3><span class="sub">' + pack.entityTypes.length + '</span></div>' +
      '<div class="card-b flush"><table class="tbl"><thead><tr><th>Type</th><th>Structural role</th><th>Authoritative source</th><th class="num">Resolved</th></tr></thead><tbody>' +
      pack.entityTypes.map((et) =>
        '<tr><td><span class="av sq sm" style="display:inline-grid;vertical-align:middle;margin-right:7px">' + u.esc(et.glyph) + '</span><b>' +
        u.esc(et.label) + '</b><div class="dim mono" style="margin-left:29px">' + u.esc(et.id) + '</div></td>' +
        '<td class="dim">' + u.esc(et.kind) + '</td>' +
        '<td>' + et.masterSystems.map((sy) => u.systemTag(pack, sy)).join(' ') + '</td>' +
        '<td class="num">' + (t.counts[et.id] || 0).toLocaleString('en-US') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-h"><h3>Relationship types</h3><span class="sub">' + pack.edgeTypes.length + '</span></div>' +
      '<div class="card-b flush"><table class="tbl"><thead><tr><th>Relationship</th><th>From → to</th><th>Time-bounded</th></tr></thead><tbody>' +
      pack.edgeTypes.map((e) =>
        '<tr><td><b>' + u.esc(e.label) + '</b><div class="dim" style="font-size:10.5px">inverse: ' + u.esc(e.inverse) + '</div></td>' +
        '<td class="dim">' + u.esc(pack.typeById[e.from].label) + ' → ' + u.esc(pack.typeById[e.to].label) + '</td>' +
        '<td>' + (e.temporal ? u.tag('yes', 'ok') : '<span class="dim">no</span>') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-h"><h3>Field catalog</h3><span class="sub">' + pack.fields.length + ' reconciled fields</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl"><thead><tr><th>Field</th><th>On</th><th>Carried by</th><th>Sensitivity</th><th class="num">Weight</th></tr></thead><tbody>' +
      pack.fields.map((f) =>
        '<tr><td><b>' + u.esc(f.label) + '</b><div class="dim mono">' + u.esc(f.key) + '</div></td>' +
        '<td class="dim">' + u.esc(pack.typeById[f.entity].label) + '</td>' +
        '<td>' + f.contributors.map((sy) => u.systemTag(pack, sy)).join(' ') + '</td>' +
        '<td>' + u.tag(f.sensitivity, f.sensitivity === 'protected' ? 'critical' : f.sensitivity === 'confidential' ? 'high' : 'line') + '</td>' +
        '<td class="num">' + f.weight + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +
      '</div>' +

      '<div class="grid" style="gap:12px">' +
      '<div class="card"><div class="card-h"><h3>Identity matching</h3></div><div class="card-b">' +
      '<div class="muted" style="font-size:12.5px;line-height:1.6;margin-bottom:11px">Shared by every tenant. Rules produce scores; ' +
      'scores at or above ' + Math.round(S.AUTO_LINK * 100) + '% link automatically, the middle band becomes a queue, below ' +
      Math.round(S.REVIEW * 100) + '% is not a match.</div>' +
      '<table class="tbl" style="font-size:12px"><tbody>' +
      Object.keys(S.KEY_STRENGTH).map((k) =>
        '<tr><td style="padding-left:0">' + u.esc(S.KEY_STRENGTH[k].label) + '</td>' +
        '<td style="text-align:right">' + u.tag(Math.round(S.KEY_STRENGTH[k].score * 100) + '%',
          S.KEY_STRENGTH[k].score >= S.AUTO_LINK ? 'ok' : 'medium') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-h"><h3>Adding an industry</h3></div><div class="card-b muted" style="font-size:12.5px;line-height:1.7">' +
      'A vertical is a declaration: the words it uses, the systems it reads, which system carries which field, and which of the ' +
      'standard failure modes apply. Four of the six tenants here were produced that way.' +
      '<div style="margin-top:11px">The skeleton underneath is deliberately small — somewhere work happens, a team inside it, someone who ' +
      'does the work, someone it is done for, and a dated record that joins them. A ward round, a freight load, a salon appointment and a ' +
      'client review are the same shape.</div>' +
      '<div style="margin-top:11px"><a class="btn" href="#/owner/roadmap">What is left to build →</a></div>' +
      '</div></div></div></div>'
    );
  }

  /* ═══════════════════════════════════════════════════════════════ ACCESS ═ */

  const OPERATORS = [
    { name: 'You', email: 'owner@kalirislabs.example', role: 'Owner', tenants: 'All tenants', mfa: true, last: 0 },
    { name: 'R. Okafor', email: 'r.okafor@kalirislabs.example', role: 'Platform admin', tenants: 'All tenants', mfa: true, last: 6 },
    { name: 'J. Mensah', email: 'j.mensah@kalirislabs.example', role: 'Implementation', tenants: 'Thornfield · Halyard', mfa: true, last: 31 },
    { name: 'P. Vasquez', email: 'p.vasquez@kalirislabs.example', role: 'Support', tenants: 'Read-only, all tenants', mfa: false, last: 74 },
    { name: 'Ingest service', email: 'svc-ingest@kalirislabs.example', role: 'Service account', tenants: 'All tenants', mfa: null, last: 0 },
  ];

  function access(ctx) {
    const u = U();
    const { store } = ctx;
    const p = store.platform();

    return (
      head('Access', 'Who can reach what, on the platform side and inside each tenant. In production these checks belong below the API — ' +
        'this prototype enforces them in the interface, which is not the same thing and is called out as such.') +

      '<div class="card" style="margin-bottom:12px"><div class="card-h"><h3>Operator accounts</h3>' +
      '<span class="sub">Kaliris Labs staff and services</span></div><div class="card-b flush"><div class="xs">' +
      '<table class="tbl"><thead><tr><th>Person</th><th>Role</th><th>Scope</th><th>MFA</th><th>Last active</th></tr></thead><tbody>' +
      OPERATORS.map((o) =>
        '<tr><td><b>' + u.esc(o.name) + '</b><div class="dim mono">' + u.esc(o.email) + '</div></td>' +
        '<td>' + u.esc(o.role) + '</td><td class="dim">' + u.esc(o.tenants) + '</td>' +
        '<td>' + (o.mfa === null ? '<span class="dim">n/a</span>' : o.mfa ? u.tag('on', 'ok') : u.tag('off', 'critical')) + '</td>' +
        '<td class="dim">' + (o.last === 0 ? 'now' : o.last + ' h ago') + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="card" style="margin-bottom:12px"><div class="card-h"><h3>Tenant roles</h3>' +
      '<span class="sub">' + p.tenants.reduce((a, t) => a + t.roles.length, 0) + ' across all tenants</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl">' +
      '<thead><tr><th>Tenant</th><th>Role</th><th>Persona</th><th>Sees</th><th>Max sensitivity</th></tr></thead><tbody>' +
      p.tenants.map((t) => t.roles.map((r) =>
        '<tr><td class="dim">' + u.esc(t.tenantName) + '</td><td><b>' + u.esc(r.name) + '</b></td>' +
        '<td class="dim">' + u.esc(r.persona) + '</td>' +
        '<td style="font-size:11px">' + Object.keys(r.scopes || {}).map((k) => {
          const rule = r.scopes[k];
          const tl = (t.entityTypes.find((et) => et.id === k) || {}).plural || k;
          return rule === 'all' ? '' : u.esc(tl) + ': ' + u.esc(rule);
        }).filter(Boolean).join(' · ') || '<span class="dim">everything</span>' + '</td>' +
        '<td>' + u.tag(r.maxSensitivity, r.maxSensitivity === 'protected' ? 'critical' : 'medium') + '</td></tr>').join('')).join('') +
      '</tbody></table></div></div></div>' +

      '<div class="note medium"><span>▲</span><div><b>Not production enforcement.</b> Scopes and sensitivity are honoured by this ' +
      'interface, and the model behind them is real, but a shipped platform must evaluate both below the API on every read, with ' +
      'per-tenant isolation and an immutable log of what was served. That work is on the roadmap and is not optional for a customer ' +
      'holding clinical or personnel data.</div></div>'
    );
  }

  /* ════════════════════════════════════════════════════════════════ AUDIT ═ */

  function auditView(ctx) {
    const u = U();
    const { store } = ctx;
    const rows = store.audit;
    const now = Date.now();
    const label = { 'policy.change': 'Policy', 'policy.reset': 'Policy', 'identity.confirm': 'Identity',
      'identity.dismiss': 'Identity', 'tenant.open': 'Tenant', 'tenant.provision': 'Tenant',
      'session.start': 'Session', 'session.role': 'Session', 'connector.degraded': 'Connector',
      'sync.complete': 'Connector', 'prototype.reset': 'Platform' };

    return (
      head('Activity', 'Everything that changed, who changed it and when. Policy edits, identity decisions and remediation calls ' +
        'are the actions that alter what the platform reports as true, so they are the ones that have to be recoverable.') +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Entries', rows.length, 'This session and seeded history') +
      u.stat('Policy changes', rows.filter((r) => r.action.indexOf('policy') === 0).length, 'Changes to what counts as true') +
      u.stat('Identity decisions', rows.filter((r) => r.action.indexOf('identity') === 0).length, 'Links confirmed or set aside') +
      u.stat('Remediation', rows.filter((r) => r.action.indexOf('task') === 0).length, 'Accepted, fixed or set aside') +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>Log</h3><span class="sub">newest first</span></div>' +
      '<div class="card-b flush"><div class="xs"><table class="tbl">' +
      '<thead><tr><th>When</th><th>Actor</th><th>Tenant</th><th>Kind</th><th>Detail</th></tr></thead><tbody>' +
      rows.slice(0, 120).map((r) =>
        '<tr><td class="dim" style="white-space:nowrap">' + u.esc(u.ago(r.ts, now)) + '</td>' +
        '<td class="mono">' + u.esc(r.actor) + '</td>' +
        '<td class="dim">' + u.esc(r.tenant === 'platform' ? '—' : ((SOT.packs[r.tenant] || {}).tenantName || r.tenant)) + '</td>' +
        '<td>' + u.tag(label[r.action] || r.action.split('.')[0], 'line') + '</td>' +
        '<td>' + u.esc(r.detail) + '</td></tr>').join('') +
      '</tbody></table></div></div></div>' +

      '<div class="dim" style="margin-top:9px;font-size:11.5px">In production this is append-only, signed, exportable and retained ' +
      'per the tenant’s contract. Here it lives in the browser and resets with the prototype.</div>'
    );
  }

  /* ══════════════════════════════════════════════════════════════ ROADMAP ═ */

  const ROADMAP = [
    { phase: 'Now — make it real', items: [
      { t: 'Move the engine server-side behind Postgres', s: 'next', e: 'L',
        d: 'Tables follow the model directly: sources, source_records, entities, entity_links, assertions (append-only), edges with valid-time columns, policies, findings, tasks. `resolveAll()` becomes an incremental job plus a query layer. Nothing about the computation changes — this is a hosting move, not a redesign.' },
      { t: 'Wrap the interface in Next.js and TypeScript', s: 'next', e: 'M',
        d: 'The view functions become components with the same signatures. Type the pack declaration first — it is the contract every vertical is written against, and a typo in a field map currently fails silently.' },
      { t: 'Build two real connectors end to end', s: 'next', e: 'L',
        d: 'Pick the two that prove the shape: one HR system (SCIM or a vendor REST API) and one operational system (FHIR for health, or the CRM for revenue). Only the adapter changes — identity(), assertions(), and a fetch. Getting two working de-risks the other forty.' },
      { t: 'Incremental resolution instead of full recompute', s: 'later', e: 'M',
        d: 'Recomputing everything is correct and fast at prototype scale and will not survive a real tenant. Resolve per entity on assertion change, and recompute findings only for the fields touched.' },
      { t: 'Authorization below the API', s: 'next', e: 'M',
        d: 'Row and field checks evaluated server-side on every read, per-tenant isolation, and an immutable log of every value served. Every field already carries a sensitivity and every role a scope, so this is a filter over labelled data rather than a schema change.' },
    ] },
    { phase: 'Next — make it sellable', items: [
      { t: 'Pack authoring in the product, not in code', s: 'later', e: 'L',
        d: 'An implementation consultant should be able to declare a vertical through a form: vocabulary, systems, field map, policy. The declaration is already data; what is missing is an editor, validation and versioning.' },
      { t: 'Field mapping UI for onboarding', s: 'later', e: 'M',
        d: 'The hardest part of every implementation is deciding which vendor column means which canonical field. Show a sample of real rows next to the canonical catalog and let someone map them by hand, with suggestions.' },
      { t: 'Confidence tuning per tenant', s: 'later', e: 'S',
        d: 'The auto-link threshold is a single global number today. Some customers will want it stricter for patients than for staff. Make it policy, like everything else.' },
      { t: 'Remediation that closes the loop', s: 'later', e: 'M',
        d: 'Push tasks into the tool the owning team already uses — ServiceNow, Jira, a queue in the source system — and detect the fix on the next read rather than asking someone to tick a box here.' },
      { t: 'Scheduled digests and alerting', s: 'later', e: 'S',
        d: 'A weekly note to each owner listing what appeared, what resolved itself, and what is still open. Findings nobody is told about are findings nobody fixes.' },
    ] },
    { phase: 'Then — make it defensible', items: [
      { t: 'History as a first-class query surface', s: 'idea', e: 'M',
        d: 'Every edge already carries valid time. Expose "as of" on the whole application: show me this ward, this territory, this org chart as it stood on any past date. Source systems throw this away, which is exactly why it is worth keeping.' },
      { t: 'Metric reconciliation', s: 'idea', e: 'L',
        d: 'Explain why the same number differs between two systems by diffing their definitions and attributing the gap term by term. Scope this narrowly — a general query-lineage engine is a different company.' },
      { t: 'Write-back, carefully', s: 'idea', e: 'L',
        d: 'Only after remediation has been trusted for a while, only per-field, only with an approval step and a full reversal path. Owning the correctness of a customer\\u2019s clinical record is a liability to take on deliberately, not by default.' },
      { t: 'Cross-tenant benchmarks', s: 'idea', e: 'M',
        d: 'Aggregate, anonymised: how does this hospital\\u2019s identity hygiene compare to its peers? Valuable, and a data-governance minefield — needs contractual permission before a line of code.' },
    ] },
    { phase: 'Compliance track — runs in parallel', items: [
      { t: 'SSO and directory provisioning', s: 'next', e: 'M',
        d: 'SAML or OIDC with SCIM. Nothing sells to an enterprise without it, and it is also how the platform learns who its own users are.' },
      { t: 'SOC 2 Type II', s: 'next', e: 'L',
        d: 'Start the observation window early — it is elapsed time, not effort, and it gates the first serious deal.' },
      { t: 'HIPAA readiness and a BAA', s: 'next', e: 'M',
        d: 'Required before a single real patient record is touched. Encryption, access logging, retention, breach process, subcontractor flow-down.' },
      { t: 'Data residency and retention controls', s: 'later', e: 'M',
        d: 'Per-tenant region pinning and configurable retention. Public sector and European customers will ask on the first call.' },
    ] },
    { phase: 'Open questions — decide before building', items: [
      { t: 'Which vertical do you actually sell first?', s: 'decide', e: '—',
        d: 'Healthcare has the sharpest pain and the slowest sales cycle. Freight and personal services buy faster and pay less. The engine does not care; the go-to-market does, and pricing, packaging and the first three connectors all follow from the answer.' },
      { t: 'Read-only or system of action?', s: 'decide', e: '—',
        d: 'Read-only caps the price and keeps you safe. Write-back raises the ceiling and makes you liable. This decision shapes the security review, the contract and the insurance.' },
      { t: 'Per-seat, per-entity, or per-connector pricing?', s: 'decide', e: '—',
        d: 'Per-entity aligns price with value and is legible to a buyer. Per-connector is easier to forecast. Per-seat is worst here — the product is most valuable when everyone can look.' },
      { t: 'Who owns the policy in a real customer?', s: 'decide', e: '—',
        d: 'Someone has to be accountable for declaring which system wins. If nobody owns it, the default policy becomes a vendor opinion nobody agreed to, and the first disagreement lands on you.' },
    ] },
  ];

  function roadmap() {
    const u = U();
    const badge = { next: ['Next up', 'critical'], later: ['Later', 'medium'], idea: ['Idea', 'line'], decide: ['Needs a decision', 'high'] };
    const effort = { S: 'small', M: 'medium', L: 'large', '—': '' };
    const all = ROADMAP.reduce((a, p) => a.concat(p.items), []);

    return (
      head('Roadmap', 'What it would take to run this for real, in the order the dependencies actually fall. ' +
        'Written to be argued with — the sequencing matters more than the list.') +

      '<div class="grid g-stat" style="margin-bottom:12px">' +
      u.stat('Items', all.length, 'Across ' + ROADMAP.length + ' tracks') +
      u.stat('Next up', all.filter((i) => i.s === 'next').length, 'Blocking a first real customer', 'hot') +
      u.stat('Decisions', all.filter((i) => i.s === 'decide').length, 'Yours to make, not engineering’s') +
      u.stat('Large efforts', all.filter((i) => i.e === 'L').length, 'Multi-sprint pieces of work') +
      '</div>' +

      ROADMAP.map((p) =>
        '<div class="card" style="margin-bottom:12px"><div class="card-h"><h3>' + u.esc(p.phase) + '</h3>' +
        '<span class="sub">' + p.items.length + '</span></div><div class="card-b flush"><table class="tbl"><tbody>' +
        p.items.map((i) =>
          '<tr><td style="width:34%"><b>' + u.esc(i.t) + '</b>' +
          '<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">' +
          u.tag(badge[i.s][0], badge[i.s][1]) +
          (effort[i.e] ? u.tag(effort[i.e], 'line') : '') + '</div></td>' +
          '<td class="muted" style="line-height:1.6">' + u.esc(i.d) + '</td></tr>').join('') +
        '</tbody></table></div></div>').join('') +

      '<div class="card"><div class="card-h"><h3>What this prototype already settles</h3></div>' +
      '<div class="card-b muted" style="font-size:12.5px;line-height:1.7;max-width:92ch">' +
      'The parts that are usually argued about for months are decided and demonstrated here: truth is computed from a policy rather than ' +
      'stored, disagreements are classified instead of merely counted, relationships carry valid time so the past stays answerable, ' +
      'identity is scored with a human queue for the uncertain middle, and a vertical is a declaration rather than a fork. ' +
      'Six industries run on it with no engine changes between them.' +
      '<div style="margin-top:11px">What is unproven is everything about operating it: scale, incremental resolution, real connector ' +
      'behaviour against real APIs, and whether a customer will accept a policy they have to own. Those are the first things to find out, ' +
      'and none of them require rebuilding what is here.</div>' +
      '</div></div>'
    );
  }

  /* -------------------------------------------------------------- helpers */

  function head(title, sub) {
    const u = U();
    return '<div class="head"><div><h1>' + u.esc(title) + '</h1>' +
      '<div class="sub">' + u.esc(sub) + '</div></div></div>';
  }

  SOT.owner = { tenants, connectors, model, access, audit: auditView, roadmap, ROADMAP, OPERATORS };
})(window.SOT || (window.SOT = {}));
