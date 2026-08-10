/* SOT — vertical pack toolkit.
 *
 * "Works for any industry" is only true if adding one is a declaration rather
 * than a project. This file is what makes that true.
 *
 * Almost every organization that would buy this product has the same shape
 * underneath the vocabulary:
 *
 *     site      somewhere work happens        hospital · campus · branch · terminal · salon
 *     group     a team inside a site          ward · department · desk · lane · chair row
 *     worker    someone who does the work     nurse · lecturer · adviser · driver · stylist
 *     client    someone the work is done for  patient · student · household · shipper · guest
 *     event     a dated thing that joins them visit · enrolment · review · load · appointment
 *
 * A pack declares its vocabulary, its source systems, which system carries
 * which field, how many of everything to generate, and which of the standard
 * data-quality failures to inject. The kit turns that into source records,
 * adapters, a time-bounded edge set and statistics — the same inputs the
 * hand-written health and defence packs produce, so nothing downstream can
 * tell the difference.
 *
 * Everything generated here is synthetic and deterministic.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;
  const N = () => SOT.schema.norm;

  /* ---------------------------------------------------------- field catalog
   *
   * Fixed keys, renameable labels. A "credential expiry" is a nursing licence
   * in one pack, a commercial driving medical certificate in another, and a
   * securities registration in a third — same field, same failure mode, same
   * consequence, different word on the screen.
   */
  const FIELD_SPECS = [
    ['worker', 'fullName', 'Full name', 'identity', 'public', 1, 7],
    ['worker', 'workEmail', 'Work email', 'identity', 'public', 2, 7],
    ['worker', 'employeeId', 'Employee ID', 'identity', 'internal', 2, 30],
    ['worker', 'jobTitle', 'Job title', 'role', 'public', 2, 14],
    ['worker', 'credential', 'Credential', 'credential', 'public', 3, 14],
    ['worker', 'credentialId', 'Credential number', 'credential', 'internal', 3, 30],
    ['worker', 'credentialExpiry', 'Credential expires', 'credential', 'internal', 5, 7],
    ['worker', 'credentialStatus', 'Credential status', 'credential', 'internal', 5, 7],
    ['worker', 'homeGroup', 'Assigned group', 'role', 'internal', 4, 7],
    ['worker', 'employmentStatus', 'Employment status', 'identity', 'internal', 5, 2],
    ['worker', 'employmentType', 'Employment type', 'identity', 'internal', 2, 30],
    ['worker', 'hireDate', 'Start date', 'identity', 'internal', 1, 30],
    ['worker', 'accessStatus', 'System access', 'access', 'internal', 4, 2],

    ['client', 'fullName', 'Name', 'identity', 'confidential', 3, 7],
    ['client', 'clientRef', 'Reference', 'identity', 'confidential', 4, 30],
    ['client', 'dob', 'Date of birth', 'identity', 'protected', 5, 7],
    ['client', 'phone', 'Phone', 'contact', 'protected', 1, 14],
    ['client', 'email', 'Email', 'contact', 'protected', 1, 14],
    ['client', 'address', 'Address', 'contact', 'protected', 1, 14],
    ['client', 'plan', 'Plan', 'commercial', 'confidential', 2, 14],
    ['client', 'clientStatus', 'Status', 'identity', 'confidential', 3, 7],

    ['group', 'groupName', 'Name', 'identity', 'public', 2, 30],
    ['group', 'groupCode', 'Code', 'identity', 'public', 3, 30],
    ['group', 'siteCode', 'Site', 'structure', 'public', 3, 30],
    ['group', 'category', 'Category', 'structure', 'public', 2, 30],
    ['group', 'capacity', 'Capacity', 'structure', 'internal', 2, 30],
    ['group', 'costCenter', 'Cost centre', 'structure', 'internal', 2, 30],

    ['site', 'siteName', 'Name', 'identity', 'public', 2, 30],
    ['site', 'siteCode', 'Code', 'identity', 'public', 3, 30],
    ['site', 'city', 'City', 'structure', 'public', 1, 30],
    ['site', 'siteType', 'Type', 'structure', 'public', 1, 30],
    ['site', 'capacity', 'Capacity', 'structure', 'internal', 1, 30],

    ['event', 'eventLabel', 'Record', 'identity', 'confidential', 2, 30],
    ['event', 'eventType', 'Type', 'identity', 'confidential', 2, 30],
    ['event', 'startAt', 'Started', 'timing', 'confidential', 3, 30],
    ['event', 'endAt', 'Ended', 'timing', 'confidential', 3, 30],
    ['event', 'outcome', 'Outcome', 'timing', 'confidential', 2, 30],
    ['event', 'quantity', 'Quantity', 'commercial', 'confidential', 4, 7],
    ['event', 'channel', 'Channel', 'commercial', 'confidential', 2, 14],
    ['event', 'eventStatus', 'Status', 'commercial', 'confidential', 2, 7],
  ];

  const EDGE_SPECS = [
    ['reports_to', 'worker', 'worker', true, false],
    ['assigned_to', 'worker', 'group', true, false],
    ['part_of', 'group', 'site', false, false],
    ['served_by', 'client', 'worker', true, false],
    ['event_client', 'event', 'client', false, false],
    ['event_group', 'event', 'group', false, false],
    ['event_team', 'event', 'worker', false, true],
  ];

  /* ------------------------------------------------------- statistics library
   *
   * Generic over the skeleton, renameable per pack. `quantityLabel` might be
   * "length of stay", "billable hours", "miles" or "credit hours" — the
   * arithmetic is the same.
   */
  function statsFor(spec) {
    const L = spec.statLabels || {};
    const lbl = (k, d) => L[k] || d;
    const eventsOfWorker = (id, ctx) => ctx.graph.neighbours(id, 'event_team', { dir: 'in' }).map((n) => ctx.profiles[n.entity.id]);
    const eventsOfClient = (id, ctx) => ctx.graph.neighbours(id, 'event_client', { dir: 'in' }).map((n) => ctx.profiles[n.entity.id]);
    const eventsOfGroup = (id, ctx) => ctx.graph.neighbours(id, 'event_group', { dir: 'in' }).map((n) => ctx.profiles[n.entity.id]);
    const within = (list, days, asOf) => list.filter((e) => e && e.get('startAt') && asOf - e.get('startAt') <= days * DAY);
    const avg = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null);
    const qty = (list) => list.map((e) => e.get('quantity')).filter((v) => v != null);

    return {
      worker: [
        { id: 'events90', label: lbl('workerEvents', 'Records handled'), hint: 'Last 90 days', fmt: 'int',
          calc: (p, ctx) => within(eventsOfWorker(p.entity.id, ctx), 90, ctx.asOf).length },
        { id: 'clients', label: lbl('workerClients', 'People served'), hint: 'All time, distinct', fmt: 'int', sensitivity: 'confidential',
          calc: (p, ctx) => new Set(eventsOfWorker(p.entity.id, ctx).map((e) => {
            const c = ctx.graph.neighbour(e.entity.id, 'event_client', { dir: 'out' });
            return c ? c.entity.id : null;
          }).filter(Boolean)).size },
        { id: 'book', label: lbl('workerBook', 'Assigned book'), hint: 'Where they are the primary contact', fmt: 'int', sensitivity: 'confidential',
          calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'served_by', { dir: 'in', when: 'current', at: ctx.asOf }).length },
        { id: 'groups', label: lbl('workerGroups', 'Groups worked'), hint: 'Including previous assignments', fmt: 'int',
          calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'out' }).map((n) => n.entity.id)).size },
        { id: 'avgQty', label: lbl('workerAvg', 'Average size'), hint: spec.quantityHint || 'Per record handled', fmt: spec.quantityFmt || 'int',
          calc: (p, ctx) => avg(qty(eventsOfWorker(p.entity.id, ctx))) },
        { id: 'tenure', label: 'Tenure', hint: 'Since start date', fmt: 'years',
          calc: (p, ctx) => (p.get('hireDate') ? Number(((ctx.asOf - p.get('hireDate')) / (365 * DAY)).toFixed(1)) : null) },
      ],
      client: [
        { id: 'events', label: lbl('clientEvents', 'Records'), hint: 'All time', fmt: 'int', sensitivity: 'protected',
          calc: (p, ctx) => eventsOfClient(p.entity.id, ctx).length },
        { id: 'events12', label: lbl('clientEvents', 'Records'), hint: 'Last 12 months', fmt: 'int', sensitivity: 'protected',
          calc: (p, ctx) => within(eventsOfClient(p.entity.id, ctx), 365, ctx.asOf).length },
        { id: 'last', label: lbl('clientLast', 'Last seen'), hint: 'Most recent record', fmt: 'date', sensitivity: 'protected',
          calc: (p, ctx) => {
            const ds = eventsOfClient(p.entity.id, ctx).map((e) => e && e.get('startAt')).filter(Boolean);
            return ds.length ? Math.max.apply(null, ds) : null;
          } },
        { id: 'total', label: lbl('clientTotal', 'Lifetime total'), hint: spec.quantityHint || 'Across every record', fmt: spec.quantityFmt || 'int', sensitivity: 'protected',
          calc: (p, ctx) => {
            const q = qty(eventsOfClient(p.entity.id, ctx));
            return q.length ? Number(q.reduce((a, b) => a + b, 0).toFixed(1)) : null;
          } },
        { id: 'people', label: lbl('clientPeople', 'People involved'), hint: 'Distinct, all records', fmt: 'int', sensitivity: 'protected',
          calc: (p, ctx) => {
            const set = new Set();
            eventsOfClient(p.entity.id, ctx).forEach((e) =>
              e && ctx.graph.neighbours(e.entity.id, 'event_team', { dir: 'out' }).forEach((n) => set.add(n.entity.id)));
            return set.size;
          } },
      ],
      group: [
        { id: 'events90', label: lbl('groupEvents', 'Records'), hint: 'Last 90 days', fmt: 'int',
          calc: (p, ctx) => within(eventsOfGroup(p.entity.id, ctx), 90, ctx.asOf).length },
        { id: 'staffNow', label: lbl('groupStaff', 'Assigned now'), hint: 'Currently on this group', fmt: 'int',
          calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).length },
        { id: 'staffEver', label: lbl('groupEver', 'Ever assigned'), hint: 'Including people who left', fmt: 'int',
          calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in' }).map((n) => n.entity.id)).size },
        { id: 'avgQty', label: lbl('groupAvg', 'Average size'), hint: spec.quantityHint || 'Per record', fmt: spec.quantityFmt || 'int',
          calc: (p, ctx) => avg(qty(eventsOfGroup(p.entity.id, ctx))) },
        { id: 'perCap', label: lbl('groupPerCap', 'Per unit of capacity'), hint: 'Last 90 days', fmt: 'ratio',
          calc: (p, ctx) => {
            const cap = p.get('capacity');
            return cap ? Number((within(eventsOfGroup(p.entity.id, ctx), 90, ctx.asOf).length / cap).toFixed(1)) : null;
          } },
      ],
      site: [
        { id: 'groups', label: lbl('siteGroups', 'Groups'), hint: 'Based here', fmt: 'int',
          calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'part_of', { dir: 'in' }).length },
        { id: 'staff', label: lbl('siteStaff', 'People'), hint: 'Currently assigned across groups', fmt: 'int',
          calc: (p, ctx) => {
            const set = new Set();
            ctx.graph.neighbours(p.entity.id, 'part_of', { dir: 'in' }).forEach((g) =>
              ctx.graph.neighbours(g.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).forEach((w) => set.add(w.entity.id)));
            return set.size;
          } },
        { id: 'events90', label: lbl('siteEvents', 'Records'), hint: 'Last 90 days', fmt: 'int',
          calc: (p, ctx) => {
            let n = 0;
            ctx.graph.neighbours(p.entity.id, 'part_of', { dir: 'in' }).forEach((g) => { n += within(eventsOfGroup(g.entity.id, ctx), 90, ctx.asOf).length; });
            return n;
          } },
      ],
      event: [
        { id: 'qty', label: lbl('eventQty', 'Size'), hint: spec.quantityHint || 'As recorded', fmt: spec.quantityFmt || 'int', sensitivity: 'confidential',
          calc: (p) => p.get('quantity') },
        { id: 'team', label: lbl('eventTeam', 'People involved'), hint: 'Attached to this record', fmt: 'int', sensitivity: 'confidential',
          calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'event_team', { dir: 'out' }).length },
        { id: 'daysAgo', label: 'Days ago', hint: 'Since it started', fmt: 'int', sensitivity: 'confidential',
          calc: (p, ctx) => (p.get('startAt') ? Math.round((ctx.asOf - p.get('startAt')) / DAY) : null) },
      ],
    };
  }

  /* ---------------------------------------------------------- world builder */

  function buildWorld(spec) {
    const rand = SOT.gen.mulberry32(spec.seed || 20260210);
    const h = SOT.gen.helpers(rand);
    const namer = SOT.gen.makeNamer(rand);
    const asOf = spec.asOf || Date.parse('2026-02-10T14:20:00Z');
    const w = spec.world;
    const sysRoles = spec.systemRoles || {};

    const syncState = {};
    spec.systems.forEach((s) => {
      syncState[s.id] = Object.assign({ lastSync: asOf - (s.sync && s.sync.agoMs != null ? s.sync.agoMs : h.between(1, 10) * 3600000), status: 'healthy' },
        s.sync || {});
      if (s.sync && s.sync.agoDays != null) syncState[s.id].lastSync = asOf - s.sync.agoDays * DAY;
    });

    let seq = 0;
    const nat = (prefix, i) => prefix + String(100000 + i * 7).slice(-6);
    const entities = { site: [], group: [], worker: [], client: [], event: [] };
    const notes = [];
    const note = (kind, who, detail) => notes.push({ kind, who, detail });

    /* sites */
    w.sites.forEach((s, i) => entities.site.push({
      slot: 'site', key: s.code, idx: i,
      f: { siteName: s.name, siteCode: s.code, city: s.city, siteType: s.type, capacity: s.capacity == null ? null : s.capacity },
      overrides: {}, present: {},
    }));

    /* groups */
    w.groups.forEach((g, i) => entities.group.push({
      slot: 'group', key: g.code, idx: i, site: g.site,
      f: { groupName: g.name, groupCode: g.code, siteCode: g.site, category: g.category,
           capacity: g.capacity == null ? null : g.capacity, costCenter: 'CC-' + g.code },
      overrides: {}, present: {},
    }));

    /* workers: a leadership spine, then each group's roster */
    const workers = entities.worker;
    function addWorker(o) {
      seq++;
      const nm = namer();
      const wk = Object.assign({
        slot: 'worker', idx: seq, key: 'W' + seq,
        f: {
          fullName: nm.full,
          workEmail: (nm.first + '.' + nm.last).toLowerCase() + '@' + (spec.domain || 'example.com'),
          employeeId: 'E' + String(200000 + seq * 13).slice(-6),
          jobTitle: o.title,
          credential: o.credential || null,
          credentialId: o.credential ? 'C' + h.between(100000, 999999) : null,
          credentialExpiry: o.credential ? asOf + h.between(70, 900) * DAY : null,
          credentialStatus: o.credential ? 'Active' : null,
          homeGroup: o.group || null,
          employmentStatus: 'Active',
          employmentType: o.employmentType || 'Employee',
          hireDate: asOf - h.between(180, 3600) * DAY,
          accessStatus: 'Active',
        },
        group: o.group || null,
        managerKey: o.managerKey || null,
        lead: !!o.lead,
        overrides: {}, present: {}, extraRecords: [],
      }, o.extra || {});
      workers.push(wk);
      return wk;
    }

    const exec = addWorker({ title: w.leadership[0], credential: w.leadCredential || null, lead: true });
    const leaders = [exec];
    (w.leadership.slice(1) || []).forEach((t) => leaders.push(addWorker({ title: t, credential: w.leadCredential || null, managerKey: exec.key, lead: true })));

    w.groups.forEach((g, gi) => {
      const boss = leaders[1 + (gi % Math.max(1, leaders.length - 1))] || exec;
      const lead = addWorker({ title: w.groupLeadTitle, credential: w.leadCredential || h.pick(w.credentials), group: g.code, managerKey: boss.key, lead: true });
      (g.roster || w.defaultRoster).forEach((r) => {
        for (let i = 0; i < r.count; i++) {
          addWorker({ title: r.title, credential: r.credential === null ? null : (r.credential || h.pick(w.credentials)), group: g.code, managerKey: lead.key });
        }
      });
    });

    /* clients */
    for (let i = 0; i < w.clients.count; i++) {
      const nm = namer();
      entities.client.push({
        slot: 'client', idx: i, key: 'C' + i,
        f: {
          fullName: nm.full,
          clientRef: (w.clients.refPrefix || 'REF-') + String(400000 + i * 37).slice(-6),
          dob: w.clients.dob === false ? null : Date.parse('1945-01-01') + Math.floor(rand() * (Date.parse('2010-01-01') - Date.parse('1945-01-01'))),
          phone: '(555) ' + h.between(200, 989) + '-' + String(h.between(1000, 9999)),
          email: (nm.first + '.' + nm.last).toLowerCase() + '@' + h.pick(['mailbox.example', 'postbox.example', 'inbox.example']),
          address: h.between(12, 980) + ' ' + h.street() + ', ' + h.pick(w.sites.map((s) => s.city.split(',')[0])),
          plan: h.pick(w.clients.plans),
          clientStatus: 'Active',
        },
        overrides: {}, present: {}, extraRecords: [],
      });
    }

    /* events */
    const groupWorkers = {};
    workers.forEach((wk) => { if (wk.group) (groupWorkers[wk.group] || (groupWorkers[wk.group] = [])).push(wk); });

    let ev = 0;
    entities.client.forEach((c, ci) => {
      const home = w.groups[ci % w.groups.length];
      const count = h.between(w.events.perClient[0], w.events.perClient[1]);
      for (let i = 0; i < count; i++) {
        const g = h.chance(0.6) ? home : h.pick(w.groups);
        const roster = groupWorkers[g.code] || [];
        if (!roster.length) continue;
        const type = h.pick(w.events.types);
        const start = asOf - h.between(2, w.events.windowDays || 700) * DAY - h.between(0, 20) * 3600000;
        const durationH = h.between(type.hours ? type.hours[0] : 1, type.hours ? type.hours[1] : 6);
        const end = start + durationH * 3600000;
        if (end > asOf) continue;
        ev++;
        const team = h.shuffle(roster).slice(0, h.between(1, Math.min(3, roster.length)));
        const leadWorker = roster.find((x) => x.lead) || team[0];
        entities.event.push({
          slot: 'event', idx: ev, key: 'V' + ev,
          clientKey: c.key, groupKey: g.code, siteKey: g.site,
          teamKeys: team.map((t) => t.key), leadKey: leadWorker.key,
          f: {
            eventLabel: type.name + ' · ' + new Date(start).toISOString().slice(0, 10),
            eventType: type.name,
            startAt: start,
            endAt: end,
            outcome: h.pick(w.events.outcomes),
            quantity: type.quantity ? h.between(type.quantity[0], type.quantity[1]) : Number((durationH / 24).toFixed(1)),
            channel: c.f.plan,
            eventStatus: h.pick(w.events.statuses || ['Complete', 'Complete', 'Complete', 'In review', 'Disputed']),
          },
          overrides: {}, present: {}, extraRecords: [],
        });
      }
    });

    /* --------------------------------------------- deliberate imperfections */
    const A = spec.anomalies || {};
    const nonLead = workers.filter((x) => x.group && !x.lead);
    const pickWorkers = (n) => h.shuffle(nonLead).slice(0, n);

    if (A.ghostAccess) {
      pickWorkers(A.ghostAccess).forEach((wk) => {
        wk.f.employmentStatus = 'Terminated';
        wk.terminatedAt = asOf - h.between(20, 80) * DAY;
        [sysRoles.primary, sysRoles.access, sysRoles.schedule].filter(Boolean).forEach((s) => {
          wk.overrides[s] = Object.assign(wk.overrides[s] || {}, { employmentStatus: 'Active', accessStatus: 'Active' });
        });
        note('ghost-access', wk.f.fullName, 'Terminated in the system of record; operational systems still show them active.');
      });
    }

    // Whoever is furthest behind among the systems that carry employment
    // status is the one that will still be showing a leaver as present. Found
    // rather than assumed, so a pack cannot accidentally lose its lag example
    // by changing which connector is slow.
    const statusSystems = spec.systems
      .filter((sy) => sy.provides && sy.provides.worker && sy.provides.worker.fields.employmentStatus)
      .map((sy) => sy.id)
      .sort((a, b) => syncState[a].lastSync - syncState[b].lastSync);
    const stalest = statusSystems.find((sy) => sy !== sysRoles.hr && asOf - syncState[sy].lastSync > 2 * DAY);

    if (A.badgeLag && stalest) {
      pickWorkers(A.badgeLag).forEach((wk) => {
        wk.f.employmentStatus = 'Terminated';
        wk.terminatedAt = asOf - 5 * DAY;
        wk.statusEffectiveFrom = asOf - 5 * DAY;
        wk.overrides[stalest] = Object.assign(wk.overrides[stalest] || {}, { employmentStatus: 'Active', accessStatus: 'Active' });
        note('lag', wk.f.fullName, 'Left five days ago. Only the connector that has not been read since still shows them active — behind, not wrong.');
      });
    }

    if (A.credentialLapsed) {
      pickWorkers(A.credentialLapsed).filter((x) => x.f.credential).forEach((wk) => {
        wk.f.credentialExpiry = asOf - h.between(4, 60) * DAY;
        wk.f.credentialStatus = 'Expired';
        note('credential-lapsed', wk.f.fullName, 'Credential expired but the person is still rostered and still has access.');
      });
    }

    if (A.groupTransfer) {
      pickWorkers(A.groupTransfer).forEach((wk) => {
        const to = h.pick(w.groups.filter((g) => g.code !== wk.group));
        wk.priorGroup = wk.group;
        wk.group = to.code;
        wk.f.homeGroup = to.code;
        wk.groupEffectiveFrom = asOf - 4 * DAY;
        if (sysRoles.hr) wk.overrides[sysRoles.hr] = Object.assign(wk.overrides[sysRoles.hr] || {}, { homeGroup: wk.priorGroup });
        note('transfer', wk.f.fullName, 'Moved groups four days ago; the slower system still carries the old assignment.');
      });
    }

    if (A.credentialDrift && sysRoles.primary) {
      pickWorkers(A.credentialDrift).filter((x) => x.f.credential).forEach((wk) => {
        wk.overrides[sysRoles.primary] = Object.assign(wk.overrides[sysRoles.primary] || {},
          { credential: h.pick(w.credentials.filter((c) => c !== wk.f.credential)) });
        note('credential-drift', wk.f.fullName, 'The operational system shows a credential the person no longer holds.');
      });
    }

    if (A.idGap && sysRoles.primary) {
      pickWorkers(A.idGap).forEach((wk) => {
        wk.overrides[sysRoles.primary] = Object.assign(wk.overrides[sysRoles.primary] || {}, { employeeId: null });
        note('id-gap', wk.f.fullName, 'Employee ID is blank on the operational record, breaking the join to payroll.');
      });
    }

    if (A.titleDrift && sysRoles.primary) {
      pickWorkers(A.titleDrift).forEach((wk) => {
        wk.overrides[sysRoles.primary] = Object.assign(wk.overrides[sysRoles.primary] || {}, { jobTitle: w.staleTitle || 'Associate' });
        note('title-drift', wk.f.fullName, 'A promotion recorded in HR was never reflected downstream.');
      });
    }

    if (A.scheduledChange) {
      pickWorkers(A.scheduledChange).filter((x) => x.f.employmentStatus === 'Active').forEach((wk) => {
        wk.scheduled = { field: 'employmentStatus', value: w.scheduledStatus || 'On leave', from: asOf + h.between(14, 45) * DAY };
        note('scheduled', wk.f.fullName, 'A future-dated change. Recorded, and correctly not counted as a discrepancy.');
      });
    }

    if (A.contractors) {
      for (let i = 0; i < A.contractors; i++) {
        const wk = addWorker({
          title: w.contractorTitle || 'Contractor', credential: h.pick(w.credentials),
          group: h.pick(w.groups).code, employmentType: 'Contractor',
        });
        wk.group = wk.f.homeGroup;
        if (sysRoles.hr) wk.present[sysRoles.hr] = false;
        wk.noHr = true;
        note('no-hr-record', wk.f.fullName, 'Working, scheduled and credentialed with no record in the system of record.');
      }
    }

    if (A.duplicateWorker && sysRoles.primary) {
      const wk = nonLead[Math.floor(nonLead.length / 3)];
      if (wk) {
        wk.extraRecords.push({ system: sysRoles.primary, suffix: 'X', overrides: { workEmail: wk.f.workEmail.replace('@', '.prior@') } });
        note('duplicate-account', wk.f.fullName, 'Two active accounts in the same system share one employee number.');
      }
    }

    if (A.duplicateClient && sysRoles.master) {
      const c = entities.client[7] || entities.client[0];
      if (c) {
        c.extraRecords.push({ system: sysRoles.master, suffix: 'D',
          overrides: { clientRef: (w.clients.refPrefix || 'REF-') + '999999' } });
        note('duplicate-client', c.f.fullName, 'Two references in the same system share a name and date of birth. The history is split across both.');
      }
    }

    if (A.clientMismatch && sysRoles.billing) {
      h.shuffle(entities.client).slice(0, A.clientMismatch).forEach((c) => {
        const o = {};
        if (c.f.dob) o.dob = c.f.dob + h.between(1, 2) * 365 * DAY;
        o.phone = '(555) ' + h.between(200, 989) + '-' + String(h.between(1000, 9999));
        c.overrides[sysRoles.billing] = Object.assign(c.overrides[sysRoles.billing] || {}, o);
        note('client-mismatch', c.f.fullName, 'Registration and billing disagree on identifying details.');
      });
    }

    if (A.quantityMismatch && sysRoles.billing) {
      h.shuffle(entities.event).slice(0, A.quantityMismatch).forEach((e) => {
        const delta = h.pick([-1, 1, 2]);
        const alt = Math.max(1, Number((e.f.quantity + delta).toFixed(1)));
        e.overrides[sysRoles.billing] = Object.assign(e.overrides[sysRoles.billing] || {}, { quantity: alt });
        note('quantity-mismatch', e.f.eventLabel, 'What was delivered and what was billed do not agree on the same record.');
      });
    }

    if (A.orphanAccounts && sysRoles.primary) {
      for (let i = 0; i < A.orphanAccounts; i++) {
        const label = (w.orphanNames || ['Shared Terminal', 'Training Account'])[i % 2];
        entities.worker.push({
          slot: 'worker', idx: 9000 + i, key: 'ORPH' + i, orphanIn: sysRoles.primary,
          f: { fullName: label, workEmail: label.toLowerCase().replace(/[^a-z]/g, '.') + '@' + (spec.domain || 'example.com'),
               employeeId: null, jobTitle: null, credential: null, credentialId: null, credentialExpiry: null,
               credentialStatus: null, homeGroup: h.pick(w.groups).code, employmentStatus: 'Active',
               employmentType: null, hireDate: null, accessStatus: 'Active' },
          group: null, managerKey: null, overrides: {}, present: {}, extraRecords: [],
        });
        note('orphan-account', label, 'A shared login with live access and no owner.');
      }
    }

    /* cost-centre disagreement on exactly one group keeps the structural
       reconciliation honest without flooding the queue */
    if (A.costCentre && sysRoles.schedule) {
      const g = entities.group[Math.min(3, entities.group.length - 1)];
      g.overrides[sysRoles.schedule] = { costCenter: 'CC-' + g.key + '-ALT' };
      note('cost-centre', g.f.groupName, 'Finance and scheduling carry different cost centres for the same group.');
    }

    return { entities, syncState, notes, asOf, h, rand, nat };
  }

  /* ------------------------------------------------------- records + adapters */

  // Which identity keys a record of each kind exposes, given its canonical
  // values and the raw vendor row.
  const KEY_BUILDERS = {
    worker: (c, raw) => ({
      employeeId: c.employeeId, email: c.workEmail, name: N().name(c.fullName), badge: raw._badge || null,
    }),
    client: (c) => ({
      mrn: c.clientRef, nameDob: c.dob ? N().name(c.fullName) + '|' + c.dob : null, name: N().name(c.fullName),
    }),
    group: (c) => ({ code: c.groupCode }),
    site: (c) => ({ code: c.siteCode }),
    event: (c, raw) => ({ code: raw.eventLabelKey }),
  };

  function build(spec) {
    const world = buildWorld(spec);
    const { entities, syncState, notes, asOf } = world;
    const sysRoles = spec.systemRoles || {};
    const records = {};
    spec.systems.forEach((s) => { records[s.id] = []; });

    // Deterministic native identifier per (system, entity).
    const natId = (sys, slot, e, suffix) => {
      const p = (sys.idPrefix || sys.id.slice(0, 3).toUpperCase()) + '-';
      return p + slot[0].toUpperCase() + String(100000 + (e.idx + 1) * 17).slice(-6) + (suffix || '');
    };

    function valueFor(e, sysId, field) {
      const o = e.overrides[sysId];
      if (o && Object.prototype.hasOwnProperty.call(o, field)) return o[field];
      return e.f[field];
    }

    // For every system, for every entity type it carries, emit a native record
    // whose property names are that vendor's, not ours.
    spec.systems.forEach((sys) => {
      Object.keys(sys.provides || {}).forEach((slot) => {
        const p = sys.provides[slot];
        (entities[slot] || []).forEach((e) => {
          if (e.present[sys.id] === false) return;
          if (e.orphanIn && e.orphanIn !== sys.id) return;
          if (p.only && !p.only(e)) return;
          const make = (suffix, extraOverrides) => {
            const generated = natId(sys, slot, e, suffix);
            const rec = { _type: slot, observedAt: syncState[sys.id].lastSync, _key: e.key };
            // The native id goes down first so that a system whose primary key
            // *is* the employee number (Workday's worker ID, a payroll number)
            // keeps the real value rather than a generated one. Getting this
            // backwards silently breaks identity matching for that system.
            rec[p.id] = generated;
            Object.keys(p.fields).forEach((canon) => {
              let v = valueFor(e, sys.id, canon);
              if (extraOverrides && Object.prototype.hasOwnProperty.call(extraOverrides, canon)) v = extraOverrides[canon];
              rec[p.fields[canon]] = v === undefined ? null : v;
            });
            if (rec[p.id] == null) rec[p.id] = generated;
            if (slot === 'event') rec.eventLabelKey = e.key;
            if (slot === 'worker' && p.badge) rec._badge = 'BDG-' + String(90000 + e.idx * 11).slice(-5);
            if (p.extra) Object.assign(rec, p.extra(e, world));
            if (slot === 'worker' && e.scheduled && sys.id === sysRoles.hr) {
              rec._scheduled = { field: e.scheduled.field, value: e.scheduled.value, effectiveFrom: e.scheduled.from };
            }
            if (slot === 'worker' && sys.id === sysRoles.hr) {
              rec._groupEffectiveFrom = e.groupEffectiveFrom || e.f.hireDate;
              rec._statusEffectiveFrom = e.statusEffectiveFrom || e.terminatedAt || e.f.hireDate;
            }
            records[sys.id].push(rec);
            if (!e.nat) e.nat = {};
            if (!suffix) e.nat[sys.id] = rec[p.id];
          };
          make(null, null);
          (e.extraRecords || []).forEach((x) => { if (x.system === sys.id) make(x.suffix, x.overrides); });
        });
      });
    });

    /* ---------------------------------------------------------- the adapters */
    const adapters = {};
    spec.systems.forEach((sys) => {
      const effectiveDating = sys.id === sysRoles.hr;
      adapters[sys.id] = {
        collection: sys.id,
        effectiveDating,
        identity: (r) => {
          const p = sys.provides[r._type];
          if (!p) return null;
          const canon = {};
          Object.keys(p.fields).forEach((c) => { canon[c] = r[p.fields[c]]; });
          canon._badge = r._badge;
          const allKeys = KEY_BUILDERS[r._type](canon, r) || {};
          const keys = {};
          (p.keys || Object.keys(allKeys)).forEach((k) => { if (allKeys[k] != null) keys[k] = allKeys[k]; });
          const nameField = { worker: 'fullName', client: 'fullName', group: 'groupName', site: 'siteName', event: 'eventLabel' }[r._type];
          return {
            nativeId: r[p.id],
            name: canon[nameField],
            detail: p.detail ? p.detail(canon, r) : null,
            active: canon.employmentStatus ? canon.employmentStatus === 'Active' : true,
            keys,
          };
        },
        assertions: (r) => {
          const p = sys.provides[r._type];
          if (!p) return [];
          const t = r.observedAt;
          const out = [];
          Object.keys(p.fields).forEach((canon) => {
            let effectiveFrom = t;
            if (effectiveDating && r._type === 'worker') {
              if (canon === 'homeGroup') effectiveFrom = r._groupEffectiveFrom || t;
              else if (canon === 'employmentStatus') effectiveFrom = r._statusEffectiveFrom || t;
            }
            out.push({ field: canon, value: r[p.fields[canon]], observedAt: t, effectiveFrom });
          });
          if (r._scheduled) out.push({ field: r._scheduled.field, value: r._scheduled.value, observedAt: t, effectiveFrom: r._scheduled.effectiveFrom, scheduled: true });
          return out;
        },
      };
    });

    /* ------------------------------------------------------------- the edges */
    const master = sysRoles.master;
    const hr = sysRoles.hr || master;
    const edges = [];
    const workerRef = (e) => ({ type: 'worker', sys: (e.present[hr] === false ? sysRoles.primary : hr), id: e.nat && e.nat[e.present[hr] === false ? sysRoles.primary : hr] });
    const groupRef = (code) => {
      const g = entities.group.find((x) => x.key === code);
      return g && g.nat ? { type: 'group', sys: master, id: g.nat[master] } : null;
    };
    const siteRef = (code) => {
      const s = entities.site.find((x) => x.key === code);
      return s && s.nat ? { type: 'site', sys: master, id: s.nat[master] } : null;
    };
    const byKey = {};
    ['worker', 'client', 'event'].forEach((slot) => entities[slot].forEach((e) => { byKey[slot + ':' + e.key] = e; }));
    const resolvable = (e) => !!e && !e.orphanIn && e.present[hr] !== false && !!e.nat && !!e.nat[hr];

    entities.group.forEach((g) => {
      const gr = groupRef(g.key), sr = siteRef(g.site);
      if (gr && sr) edges.push({ type: 'part_of', from: gr, to: sr, systemId: master });
    });

    entities.worker.forEach((e) => {
      if (!resolvable(e)) return;
      const wr = workerRef(e);
      if (!wr.id) return;
      if (e.managerKey) {
        const m = byKey['worker:' + e.managerKey];
        if (resolvable(m)) edges.push({ type: 'reports_to', from: wr, to: workerRef(m), fromTs: e.f.hireDate, toTs: e.terminatedAt || null, systemId: hr });
      }
      if (e.group) {
        const gr = groupRef(e.group);
        if (gr) {
          if (e.priorGroup) {
            const pg = groupRef(e.priorGroup);
            if (pg) edges.push({ type: 'assigned_to', from: wr, to: pg, fromTs: e.f.hireDate, toTs: e.groupEffectiveFrom, systemId: sysRoles.schedule || hr });
            edges.push({ type: 'assigned_to', from: wr, to: gr, fromTs: e.groupEffectiveFrom, toTs: e.terminatedAt || null, systemId: sysRoles.schedule || hr });
          } else if (world.h.chance(0.28)) {
            // A rotation somewhere in their history, so the roster has a past.
            const prior = groupRef(world.h.pick(entities.group.filter((g) => g.key !== e.group)).key);
            const switched = e.f.hireDate + Math.floor((asOf - e.f.hireDate) * (0.3 + world.rand() * 0.4));
            if (prior) edges.push({ type: 'assigned_to', from: wr, to: prior, fromTs: e.f.hireDate, toTs: switched, systemId: sysRoles.schedule || hr });
            edges.push({ type: 'assigned_to', from: wr, to: gr, fromTs: switched, toTs: e.terminatedAt || null, systemId: sysRoles.schedule || hr });
          } else {
            edges.push({ type: 'assigned_to', from: wr, to: gr, fromTs: e.f.hireDate, toTs: e.terminatedAt || null, systemId: sysRoles.schedule || hr });
          }
        }
      }
    });

    entities.event.forEach((e) => {
      if (!e.nat) return;
      const er = { type: 'event', sys: master, id: e.nat[master] };
      if (!er.id) return;
      const c = byKey['client:' + e.clientKey];
      if (c && c.nat && c.nat[master]) edges.push({ type: 'event_client', from: er, to: { type: 'client', sys: master, id: c.nat[master] }, systemId: master });
      const gr = groupRef(e.groupKey);
      if (gr) edges.push({ type: 'event_group', from: er, to: gr, systemId: master });
      e.teamKeys.forEach((k) => {
        const wk = byKey['worker:' + k];
        if (!resolvable(wk)) return;
        edges.push({ type: 'event_team', from: er, to: workerRef(wk),
          role: k === e.leadKey ? (spec.world.leadRole || 'Lead') : (spec.world.memberRole || 'Support'), systemId: master });
      });
    });

    // Primary-relationship history: who looks after this client, and who used to.
    entities.client.forEach((c, i) => {
      if (!c.nat || !c.nat[master]) return;
      const g = entities.group[i % entities.group.length];
      const roster = entities.worker.filter((x) => x.group === g.key && resolvable(x));
      if (!roster.length) return;
      const cur = roster[i % roster.length];
      const cr = { type: 'client', sys: master, id: c.nat[master] };
      if (roster.length > 1 && world.h.chance(0.35)) {
        const prev = roster[(i + 1) % roster.length];
        const changed = asOf - world.h.between(60, 520) * DAY;
        edges.push({ type: 'served_by', from: cr, to: workerRef(prev), fromTs: changed - 700 * DAY, toTs: changed, systemId: master });
        edges.push({ type: 'served_by', from: cr, to: workerRef(cur), fromTs: changed, toTs: null, systemId: master });
      } else {
        edges.push({ type: 'served_by', from: cr, to: workerRef(cur), fromTs: asOf - world.h.between(200, 1400) * DAY, toTs: null, systemId: master });
      }
    });

    const recordCounts = {};
    spec.systems.forEach((s) => { recordCounts[s.id] = records[s.id].length * (s.volume || 3); });

    return { records, edges, syncState, recordCounts, notes, asOf, adapters };
  }

  /* ------------------------------------------------------------- definition */

  function define(spec) {
    const V = spec.types;
    const L = spec.labels || {};
    const label = (slot, key, dflt) => (L[slot + '.' + key] || L[key] || dflt);

    const entityTypes = ['site', 'group', 'worker', 'client', 'event'].filter((s) => V[s]).map((slot) => {
      const t = V[slot];
      const base = {
        site: { titleField: 'siteName', subtitle: ['siteType', 'city'], keyFacts: ['siteCode', 'city', 'siteType', 'capacity'] },
        group: { titleField: 'groupName', subtitle: ['category', 'siteCode'], keyFacts: ['groupCode', 'category', 'siteCode', 'capacity', 'costCenter'] },
        worker: { titleField: 'fullName', subtitle: ['jobTitle', 'credential'], keyFacts: ['jobTitle', 'credential', 'homeGroup', 'employmentType', 'employeeId', 'credentialExpiry'] },
        client: { titleField: 'fullName', subtitle: ['clientRef', 'plan'], keyFacts: ['clientRef', 'plan', 'clientStatus', 'phone', 'email', 'dob'] },
        event: { titleField: 'eventLabel', subtitle: ['eventType', 'outcome'], dateField: 'startAt', keyFacts: ['eventType', 'startAt', 'endAt', 'outcome', 'quantity', 'eventStatus'] },
      }[slot];
      const masters = { site: [spec.systemRoles.master], group: [spec.systemRoles.master], worker: [spec.systemRoles.hr || spec.systemRoles.master],
        client: [spec.systemRoles.master], event: [spec.systemRoles.master] }[slot];
      return Object.assign({}, base, {
        id: slot, label: t.label, plural: t.plural, kind: t.kind, glyph: t.glyph,
        masterSystems: masters,
        expectedSystems: t.expected || masters,
        requireMaster: t.requireMaster !== false,
      });
    });

    const carried = {};
    spec.systems.forEach((s) => Object.keys(s.provides || {}).forEach((slot) => {
      Object.keys(s.provides[slot].fields).forEach((f) => {
        const k = slot + '.' + f;
        (carried[k] || (carried[k] = [])).push(s.id);
      });
    }));

    const fields = FIELD_SPECS
      .filter(([slot, key]) => V[slot] && carried[slot + '.' + key])
      .map(([slot, key, dflt, group, sensitivity, weight, tolerance]) => ({
        entity: slot, key, group,
        label: label(slot, key, dflt),
        contributors: carried[slot + '.' + key],
        sensitivity: (spec.sensitivity && spec.sensitivity[slot + '.' + key]) || sensitivity,
        weight, tolerance,
        impact: (spec.impact && spec.impact[key]) || null,
      }));

    const policy = {};
    fields.forEach((f) => {
      const declared = spec.policy && spec.policy[f.key];
      policy[f.key] = (declared || f.contributors).filter((s) => f.contributors.indexOf(s) >= 0);
      if (!policy[f.key].length) policy[f.key] = f.contributors.slice();
    });

    const edgeTypes = EDGE_SPECS.filter(([, from, to]) => V[from] && V[to]).map(([id, from, to, temporal, roled]) => ({
      id, from, to, temporal, roled,
      label: (spec.edgeLabels && spec.edgeLabels[id] && spec.edgeLabels[id][0]) || id,
      inverse: (spec.edgeLabels && spec.edgeLabels[id] && spec.edgeLabels[id][1]) || id,
    }));

    let built = null;
    const pack = {
      id: spec.id,
      label: spec.label,
      industry: spec.industry,
      tenantName: spec.tenantName,
      tagline: spec.tagline,
      systems: spec.systems.map((s) => ({ id: s.id, name: s.name, category: s.category, deepLink: s.deepLink,
        syncCadence: s.syncCadence, blurb: s.blurb })),
      entityTypes,
      edgeTypes,
      fields,
      policy,
      rationale: spec.rationale || {},
      roles: spec.roles,
      hierarchy: spec.hierarchy || [
        { key: 'system', label: spec.label, entity: null },
        { key: 'siteCode', label: V.site ? V.site.label : 'Site', entity: 'group' },
        { key: 'category', label: 'Category', entity: 'group' },
        { key: 'groupName', label: V.group ? V.group.label : 'Group', entity: 'group' },
      ],
      codeRefs: { homeGroup: ['group', 'groupCode'], siteCode: ['site', 'siteCode'] },
      searchTypes: entityTypes.map((t) => t.id),
      personaRules: spec.personaRules || {},
      build() {
        if (!built) built = build(spec);
        return built;
      },
      get adapters() {
        if (!built) built = build(spec);
        return built.adapters;
      },
    };

    SOT.stats.register(spec.id, statsFor(spec));
    SOT.packs = SOT.packs || {};
    SOT.packs[spec.id] = pack;
    return pack;
  }

  SOT.kit = { define, FIELD_SPECS, EDGE_SPECS };
})(window.SOT || (window.SOT = {}));
