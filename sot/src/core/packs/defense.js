/* SOT — Defence / public sector vertical pack.
 *
 * This pack exists to prove a claim rather than to be complete. Nothing in the
 * engine changed to support it: same identity resolution, same assertions and
 * policy, same graph, same interface. Only the declarations below are
 * different — different systems, different entity types, different edges,
 * different statistics.
 *
 * A hospital asks "who was the nurse on that visit". A command asks "who was
 * in that platoon in March, and is their clearance current". They are the same
 * question shape, and this file is the whole difference between them.
 *
 * Entirely synthetic. Units, people, identifiers and readiness data are
 * generated from a fixed seed and describe no real organization or person.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  const SYSTEMS = [
    { id: 'personnel', name: 'Personnel System', category: 'HR of record', deepLink: 'https://personnel.jtfm.example/member/{id}',
      syncCadence: 'Nightly, 03:00', blurb: 'Assignment orders, rank, occupational specialty, duty status.' },
    { id: 'training', name: 'Training Management', category: 'Readiness', deepLink: 'https://tms.jtfm.example/record/{id}',
      syncCadence: 'Every 6 hours', blurb: 'Qualifications, schools, unit training rosters.' },
    { id: 'medical', name: 'Medical Readiness', category: 'Readiness', deepLink: 'https://medrdy.jtfm.example/profile/{id}',
      syncCadence: 'Daily, 06:00', blurb: 'Periodic health assessments, immunisations, deployability.' },
    { id: 'security', name: 'Security Clearance', category: 'Vetting', deepLink: 'https://vetting.jtfm.example/subject/{id}',
      syncCadence: 'Weekly, Sunday', blurb: 'Clearance level, investigation dates, adjudication status.' },
    { id: 'access', name: 'Installation Access', category: 'Physical access', deepLink: 'https://access.jtfm.example/credential/{id}',
      syncCadence: 'Every 30 minutes', blurb: 'Base credentials, gate access, visitor sponsorship.' },
  ];

  const ENTITY_TYPES = [
    { id: 'member', label: 'Service member', plural: 'Personnel', kind: 'person', glyph: '◍',
      titleField: 'fullName', subtitle: ['rank', 'mos'],
      masterSystems: ['personnel'], expectedSystems: ['personnel', 'medical'], requireMaster: true,
      keyFacts: ['rank', 'mos', 'unitCode', 'dutyStatus', 'clearanceLevel', 'deployable'] },
    { id: 'unit', label: 'Unit', plural: 'Units', kind: 'group', glyph: '▤',
      titleField: 'unitName', subtitle: ['echelon'],
      masterSystems: ['personnel'], expectedSystems: ['personnel'], requireMaster: true,
      keyFacts: ['uic', 'echelon', 'installationCode', 'authorizedStrength'] },
    { id: 'installation', label: 'Installation', plural: 'Installations', kind: 'place', glyph: '▣',
      titleField: 'installationName', subtitle: ['installationType'],
      masterSystems: ['personnel'], expectedSystems: ['personnel'], requireMaster: true,
      keyFacts: ['installationCode', 'state', 'installationType'] },
    { id: 'event', label: 'Readiness event', plural: 'Readiness events', kind: 'event', glyph: '◷',
      titleField: 'eventName', subtitle: ['eventType', 'result'], dateField: 'eventDate',
      masterSystems: ['training'], expectedSystems: ['training'], requireMaster: true,
      keyFacts: ['eventType', 'eventDate', 'result', 'expiresOn'] },
  ];

  const EDGE_TYPES = [
    { id: 'assigned_to', label: 'Assigned to', inverse: 'Assigned personnel', from: 'member', to: 'unit', temporal: true, roled: true },
    { id: 'commands', label: 'Commands', inverse: 'Commanded by', from: 'member', to: 'unit', temporal: true },
    { id: 'subordinate_to', label: 'Reports to', inverse: 'Subordinate units', from: 'unit', to: 'unit', temporal: false },
    { id: 'stationed_at', label: 'Stationed at', inverse: 'Units stationed', from: 'unit', to: 'installation', temporal: false },
    { id: 'completed_by', label: 'Personnel', inverse: 'Readiness record', from: 'event', to: 'member', temporal: false, roled: true },
    { id: 'conducted_at', label: 'Conducting unit', inverse: 'Events', from: 'event', to: 'unit', temporal: false },
  ];

  const F = (entity, key, label, group, contributors, sensitivity, weight, tolerance, extra) =>
    Object.assign({ entity, key, label, group, contributors, sensitivity, weight, tolerance }, extra || {});

  const FIELDS = [
    F('member', 'fullName', 'Name', 'identity', ['personnel', 'training', 'medical', 'security', 'access'], 'public', 1, 7),
    F('member', 'serviceNumber', 'Service number', 'identity', ['personnel', 'medical', 'access'], 'internal', 2, 30),
    F('member', 'rank', 'Rank', 'identity', ['personnel', 'training'], 'public', 3, 14),
    F('member', 'mos', 'Occupational specialty', 'role', ['personnel', 'training'], 'internal', 3, 14,
      { impact: 'Specialty drives what a member may be tasked with. Training rosters built on the wrong one put unqualified people on a mission.' }),
    F('member', 'unitCode', 'Assigned unit', 'role', ['personnel', 'training', 'access'], 'internal', 4, 7,
      { impact: 'Strength reporting, accountability and alert rosters all read the assigned unit.' }),
    F('member', 'dutyStatus', 'Duty status', 'identity', ['personnel'], 'internal', 4, 7),
    F('member', 'clearanceLevel', 'Clearance', 'vetting', ['security'], 'confidential', 4, 14),
    F('member', 'clearanceExpiry', 'Clearance expires', 'vetting', ['security'], 'confidential', 5, 7,
      { impact: 'An expired clearance with live facility access is a reportable security incident.' }),
    F('member', 'accessStatus', 'Installation access', 'access', ['access'], 'internal', 4, 2),
    F('member', 'medicalReadiness', 'Medical readiness', 'readiness', ['medical'], 'protected', 5, 7,
      { impact: 'Deployability is asserted from medical readiness. A stale assessment means the roster is wrong about who can go.' }),
    F('member', 'deployable', 'Deployable', 'readiness', ['medical', 'personnel'], 'confidential', 5, 7),

    F('unit', 'unitName', 'Unit', 'identity', ['personnel', 'training'], 'public', 2, 30),
    F('unit', 'uic', 'Unit identification code', 'identity', ['personnel', 'training'], 'public', 3, 30),
    F('unit', 'echelon', 'Echelon', 'structure', ['personnel'], 'public', 2, 30),
    F('unit', 'installationCode', 'Installation', 'structure', ['personnel'], 'public', 2, 30),
    F('unit', 'authorizedStrength', 'Authorised strength', 'structure', ['personnel'], 'internal', 2, 30),

    F('installation', 'installationName', 'Installation', 'identity', ['personnel'], 'public', 2, 30),
    F('installation', 'installationCode', 'Code', 'identity', ['personnel'], 'public', 3, 30),
    F('installation', 'state', 'State', 'structure', ['personnel'], 'public', 1, 30),
    F('installation', 'installationType', 'Type', 'structure', ['personnel'], 'public', 1, 30),

    F('event', 'eventName', 'Event', 'identity', ['training'], 'internal', 2, 30),
    F('event', 'eventType', 'Type', 'identity', ['training'], 'internal', 2, 30),
    F('event', 'eventDate', 'Date', 'timing', ['training'], 'internal', 2, 30),
    F('event', 'result', 'Result', 'timing', ['training'], 'internal', 3, 30),
    F('event', 'expiresOn', 'Currency expires', 'timing', ['training'], 'internal', 3, 30),
  ];

  const POLICY = {
    fullName: ['personnel', 'training', 'medical', 'security', 'access'],
    serviceNumber: ['personnel', 'medical', 'access'],
    rank: ['personnel', 'training'],
    mos: ['personnel', 'training'],
    unitCode: ['personnel', 'training', 'access'],
    dutyStatus: ['personnel'],
    clearanceLevel: ['security'],
    clearanceExpiry: ['security'],
    accessStatus: ['access'],
    medicalReadiness: ['medical'],
    deployable: ['medical', 'personnel'],
    unitName: ['personnel', 'training'],
    uic: ['personnel', 'training'],
    echelon: ['personnel'],
    installationCode: ['personnel'],
    authorizedStrength: ['personnel'],
    installationName: ['personnel'],
    state: ['personnel'],
    installationType: ['personnel'],
    eventName: ['training'],
    eventType: ['training'],
    eventDate: ['training'],
    result: ['training'],
    expiresOn: ['training'],
  };

  const RATIONALE = {
    unitCode: 'Assignment orders are cut in the personnel system. Training rosters and gate credentials are downstream copies that drift between reassignments.',
    mos: 'The personnel record is authoritative for specialty. Training systems hold what the member was last scheduled as, which is not the same thing.',
    deployable: 'Medical readiness determines deployability. The personnel system carries a cached flag that goes stale between assessments.',
  };

  const ROLES = [
    { id: 'commander', name: 'Commander', persona: 'Battalion Commander', maxSensitivity: 'protected', landing: '#/me',
      scopes: { member: 'all', unit: 'all', installation: 'all', event: 'all' },
      blurb: 'The whole formation: strength, readiness and every subordinate unit.' },
    { id: 'company', name: 'Company commander', persona: 'Commander, Alpha Company', maxSensitivity: 'protected', landing: '#/me',
      scopes: { member: 'unit', unit: 'all', installation: 'all', event: 'unit' },
      blurb: 'One company — its personnel, its readiness events and nothing else.' },
    { id: 's1', name: 'Personnel staff', persona: 'S1, Personnel Officer', maxSensitivity: 'confidential', landing: '#/dashboard',
      scopes: { member: 'all', unit: 'all', installation: 'all', event: 'all' },
      blurb: 'Assignments, strength and records. Medical detail is redacted.' },
    { id: 'security', name: 'Security manager', persona: 'Security Manager', maxSensitivity: 'confidential', landing: '#/integrity',
      scopes: { member: 'all', unit: 'all', installation: 'all', event: 'none' },
      blurb: 'Clearances, access credentials and the records that disagree about them.' },
  ];

  const HIERARCHY = [
    { key: 'system', label: 'Command', entity: null },
    { key: 'installationCode', label: 'Installation', entity: 'unit' },
    { key: 'echelon', label: 'Echelon', entity: 'unit' },
    { key: 'unitName', label: 'Unit', entity: 'unit' },
  ];

  const INSTALLATIONS = [
    { code: 'FTM', name: 'Fort Meridian', state: 'NC', type: 'Army installation' },
    { code: 'CPH', name: 'Camp Halstead', state: 'WA', type: 'Training centre' },
  ];

  const RANKS = ['PVT', 'PFC', 'SPC', 'SGT', 'SSG', 'SFC', '1SG', '2LT', '1LT', 'CPT', 'MAJ', 'LTC'];
  const MOS = ['11B Infantry', '68W Combat Medic', '25B IT Specialist', '92Y Supply', '13F Fire Support', '35F Intelligence', '88M Transport', '12B Combat Engineer'];
  const EVENT_TYPES = ['Weapons qualification', 'Physical fitness test', 'Periodic health assessment', 'Land navigation', 'Combat lifesaver', 'Gunnery table', 'Cyber awareness'];
  const CLEARANCES = ['None', 'Secret', 'Secret', 'Top Secret'];

  function build(seed) {
    const rand = SOT.gen.mulberry32(seed == null ? 19940704 : seed);
    const h = SOT.gen.helpers(rand);
    const namer = SOT.gen.makeNamer(rand);
    const asOf = Date.parse('2026-02-10T14:20:00Z');

    const syncState = {
      personnel: { lastSync: asOf - 10 * 3600000, status: 'healthy' },
      training: { lastSync: asOf - 4 * 3600000, status: 'healthy' },
      medical: { lastSync: asOf - 7 * 3600000, status: 'healthy' },
      security: { lastSync: asOf - 5 * DAY, status: 'healthy', message: 'Weekly batch. Next run Sunday.' },
      access: { lastSync: asOf - 14 * DAY, status: 'degraded', message: 'Gateway certificate expired on 27 Jan. No successful poll since.' },
    };
    const obs = (s) => syncState[s].lastSync;

    /* Battalion → companies → platoons */
    const units = [{ uic: 'W3BN12', name: '3rd Battalion, 12th Regiment', echelon: 'Battalion', parent: null, inst: 'FTM', auth: 0 }];
    const COMPANIES = ['Alpha', 'Bravo', 'Charlie', 'Headquarters'];
    COMPANIES.forEach((c, ci) => {
      const uic = 'W3B' + c[0] + '0';
      units.push({ uic, name: c + ' Company', echelon: 'Company', parent: 'W3BN12', inst: ci === 3 ? 'FTM' : h.pick(['FTM', 'CPH']), auth: 0 });
      const platoons = c === 'Headquarters' ? 2 : 3;
      for (let p = 1; p <= platoons; p++) {
        units.push({ uic: uic + p, name: c + ' Co, ' + p + ordinal(p) + ' Platoon', echelon: 'Platoon', parent: uic, inst: null, auth: h.between(28, 40) });
      }
    });
    function ordinal(n) { return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'; }
    const platoons = units.filter((u) => u.echelon === 'Platoon');
    units.forEach((u) => { if (!u.inst) u.inst = units.find((x) => x.uic === u.parent).inst; });
    units.filter((u) => u.echelon !== 'Platoon').forEach((u) => {
      u.auth = units.filter((x) => x.parent === u.uic).reduce((s, x) => s + x.auth, 0);
    });

    const members = [];
    let mSeq = 0;
    function newMember(spec) {
      mSeq++;
      const n = namer();
      const m = Object.assign({
        rid: 'm' + mSeq,
        name: n.full,
        dodId: 'D' + String(1000000 + mSeq * 37).slice(-7),
        rank: h.pick(RANKS.slice(0, 6)),
        mos: h.pick(MOS),
        dutyStatus: 'Present for duty',
        clearance: h.pick(CLEARANCES),
        clearanceExpiry: asOf + h.between(-30, 1200) * DAY,
        medicalCurrentTo: asOf + h.between(-60, 330) * DAY,
        joined: asOf - h.between(60, 2000) * DAY,
        priorUnit: null,
      }, spec);
      members.push(m);
      return m;
    }

    const bnCdr = newMember({ rank: 'LTC', mos: '11B Infantry', unit: 'W3BN12', role: 'Commander', clearance: 'Top Secret' });
    platoons.forEach((pl) => {
      const co = units.find((u) => u.uic === pl.parent);
      for (let i = 0; i < pl.auth - h.between(0, 6); i++) {
        newMember({ unit: pl.uic, role: i === 0 ? 'Platoon Sergeant' : 'Member', rank: i === 0 ? 'SFC' : undefined });
      }
      if (!members.some((m) => m.unit === co.uic && m.role === 'Commander')) {
        newMember({ unit: co.uic, role: 'Commander', rank: 'CPT', clearance: 'Top Secret' });
      }
    });

    /* ------------------------------- deliberate, documented discrepancies */
    const notes = [];
    const note = (kind, who, detail) => notes.push({ kind, who, detail });

    // Reassignment orders cut nine days ago; the gate system has not been read
    // since its certificate expired, so it still shows the old unit.
    h.shuffle(members).slice(0, 6).forEach((m) => {
      const to = h.pick(platoons.filter((p) => p.uic !== m.unit));
      m.priorUnit = m.unit;
      m.unit = to.uic;
      m.unitEffectiveFrom = asOf - 9 * DAY;
      note('reassignment', m.name, 'Reassigned nine days ago. Systems not read since are behind, not wrong.');
    });

    // Training roster carries a specialty the personnel record never had.
    h.shuffle(members).slice(0, 5).forEach((m) => {
      m.trainingMos = h.pick(MOS.filter((x) => x !== m.mos));
      note('mos-mismatch', m.name, 'Training roster and personnel record disagree on occupational specialty.');
    });

    // Clearance lapsed, base credential still live.
    h.shuffle(members.filter((m) => m.clearance !== 'None')).slice(0, 4).forEach((m) => {
      m.clearanceExpiry = asOf - h.between(5, 90) * DAY;
      note('clearance-lapsed', m.name, 'Clearance expired while installation access remains active.');
    });

    // Medical assessment overdue but the personnel record still says deployable.
    h.shuffle(members).slice(0, 7).forEach((m) => {
      m.medicalCurrentTo = asOf - h.between(5, 120) * DAY;
      m.personnelDeployable = 'Yes';
      note('readiness-stale', m.name, 'Medical readiness lapsed; the personnel record still reports deployable.');
    });

    // Contractors: base access and training records, no personnel record.
    const contractors = [];
    for (let i = 0; i < 3; i++) {
      const n = namer();
      contractors.push({ name: n.full, credentialId: 'CAC9' + (100 + i), unit: h.pick(platoons).uic });
      note('no-personnel-record', n.full, 'Installation credential and training record with no personnel record.');
    }

    /* --------------------------------------------------------- records */
    const records = { personnel: [], training: [], medical: [], security: [], access: [] };

    INSTALLATIONS.forEach((i) =>
      records.personnel.push({ _type: 'installation', code: i.code, name: i.name, state: i.state, type: i.type, observedAt: obs('personnel') }));

    units.forEach((u) => {
      records.personnel.push({ _type: 'unit', uic: u.uic, name: u.name, echelon: u.echelon, parentUic: u.parent,
        installationCode: u.inst, authorizedStrength: u.auth, observedAt: obs('personnel') });
      records.training.push({ _type: 'unit', rosterUic: u.uic, rosterName: u.name, observedAt: obs('training') });
    });

    members.forEach((m) => {
      records.personnel.push({ _type: 'member', dodId: m.dodId, name: m.name, rank: m.rank, mos: m.mos,
        unitUic: m.unit, dutyStatus: m.dutyStatus, deployable: m.personnelDeployable || (m.medicalCurrentTo > asOf ? 'Yes' : 'No'),
        assignedFrom: m.unitEffectiveFrom || m.joined, observedAt: obs('personnel') });
      records.training.push({ _type: 'member', traineeId: 'T' + m.dodId.slice(1), name: m.name, rank: m.rank,
        mos: m.trainingMos || m.mos, rosterUic: m.unit, observedAt: obs('training') });
      records.medical.push({ _type: 'member', patientId: 'M' + m.dodId.slice(1), dodId: m.dodId, name: m.name,
        readinessStatus: m.medicalCurrentTo > asOf ? 'Current' : 'Overdue', currentTo: m.medicalCurrentTo,
        deployable: m.medicalCurrentTo > asOf ? 'Yes' : 'No', observedAt: obs('medical') });
      if (m.clearance !== 'None') {
        records.security.push({ _type: 'member', subjectId: 'S' + m.dodId.slice(1), name: m.name,
          clearanceLevel: m.clearance, expiresOn: m.clearanceExpiry,
          adjudication: m.clearanceExpiry > asOf ? 'Favourable' : 'Lapsed', observedAt: obs('security') });
      }
      records.access.push({ _type: 'member', credentialId: 'CAC' + m.dodId.slice(1), holder: m.name, dodId: m.dodId,
        unitUic: m.priorUnit || m.unit, credentialStatus: 'Active', lastGate: asOf - h.between(0, 20) * DAY,
        observedAt: obs('access') });
    });

    contractors.forEach((c) => {
      records.access.push({ _type: 'member', credentialId: c.credentialId, holder: c.name, dodId: null,
        unitUic: c.unit, credentialStatus: 'Active', lastGate: asOf - h.between(0, 5) * DAY, observedAt: obs('access') });
      records.training.push({ _type: 'member', traineeId: 'T' + c.credentialId, name: c.name, rank: 'CTR',
        mos: 'Contractor support', rosterUic: c.unit, observedAt: obs('training') });
    });

    /* -------------------------------------------------------- events */
    const events = [];
    let eSeq = 0;
    members.forEach((m) => {
      const n = h.between(2, 6);
      for (let i = 0; i < n; i++) {
        eSeq++;
        const type = h.pick(EVENT_TYPES);
        const when = asOf - h.between(10, 900) * DAY;
        events.push({ id: 'EV' + String(10000 + eSeq * 3).slice(-5), memberRid: m.rid, unit: m.unit, type,
          name: type + ' — ' + new Date(when).getUTCFullYear(),
          date: when, result: h.pick(['Go', 'Go', 'Go', 'No-go', 'Waived']), expires: when + 365 * DAY });
      }
    });
    events.forEach((e) =>
      records.training.push({ _type: 'event', eventId: e.id, eventName: e.name, eventType: e.type,
        eventDate: e.date, result: e.result, expiresOn: e.expires, observedAt: obs('training') }));

    /* --------------------------------------------------------- edges */
    const edges = [];
    const memberRef = (m) => ({ type: 'member', sys: 'personnel', id: m.dodId });
    const unitRef = (uic) => ({ type: 'unit', sys: 'personnel', id: uic });
    const instRef = (code) => ({ type: 'installation', sys: 'personnel', id: code });

    members.forEach((m) => {
      if (m.priorUnit) {
        edges.push({ type: 'assigned_to', from: memberRef(m), to: unitRef(m.priorUnit), fromTs: m.joined, toTs: m.unitEffectiveFrom, role: m.role, systemId: 'personnel' });
        edges.push({ type: 'assigned_to', from: memberRef(m), to: unitRef(m.unit), fromTs: m.unitEffectiveFrom, toTs: null, role: m.role, systemId: 'personnel' });
      } else {
        edges.push({ type: 'assigned_to', from: memberRef(m), to: unitRef(m.unit), fromTs: m.joined, toTs: null, role: m.role, systemId: 'personnel' });
      }
      if (m.role === 'Commander') edges.push({ type: 'commands', from: memberRef(m), to: unitRef(m.unit), fromTs: m.joined, toTs: null, systemId: 'personnel' });
    });
    units.forEach((u) => {
      if (u.parent) edges.push({ type: 'subordinate_to', from: unitRef(u.uic), to: unitRef(u.parent), systemId: 'personnel' });
      edges.push({ type: 'stationed_at', from: unitRef(u.uic), to: instRef(u.inst), systemId: 'personnel' });
    });
    const memberByRid = Object.fromEntries(members.map((m) => [m.rid, m]));
    events.forEach((e) => {
      const ref = { type: 'event', sys: 'training', id: e.id };
      edges.push({ type: 'completed_by', from: ref, to: memberRef(memberByRid[e.memberRid]), role: 'Participant', systemId: 'training' });
      edges.push({ type: 'conducted_at', from: ref, to: unitRef(e.unit), systemId: 'training' });
    });

    const recordCounts = {
      personnel: records.personnel.length * 4,
      training: records.training.length * 2,
      medical: records.medical.length * 9,
      security: records.security.length * 3,
      access: records.access.length * 240,
    };

    return { records, edges, syncState, recordCounts, notes, asOf };
  }

  const N = () => SOT.schema.norm;

  const ADAPTERS = {
    personnel: {
      collection: 'personnel', effectiveDating: true,
      identity: (r) => {
        if (r._type === 'member') return { nativeId: r.dodId, name: r.name, detail: r.rank + ' · ' + r.mos, active: true,
          keys: { serviceNumber: r.dodId, name: N().name(r.name) } };
        if (r._type === 'unit') return { nativeId: r.uic, name: r.name, detail: r.echelon, active: true, keys: { code: r.uic } };
        if (r._type === 'installation') return { nativeId: r.code, name: r.name, detail: r.state, active: true, keys: { code: r.code } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        if (r._type === 'member') return [
          { field: 'fullName', value: r.name, effectiveFrom: t }, { field: 'serviceNumber', value: r.dodId, effectiveFrom: t },
          { field: 'rank', value: r.rank, effectiveFrom: t }, { field: 'mos', value: r.mos, effectiveFrom: t },
          { field: 'unitCode', value: r.unitUic, effectiveFrom: r.assignedFrom },
          { field: 'dutyStatus', value: r.dutyStatus, effectiveFrom: t }, { field: 'deployable', value: r.deployable, effectiveFrom: t },
        ].map((x) => Object.assign({ observedAt: t }, x));
        if (r._type === 'unit') return [
          { field: 'unitName', value: r.name }, { field: 'uic', value: r.uic }, { field: 'echelon', value: r.echelon },
          { field: 'installationCode', value: r.installationCode }, { field: 'authorizedStrength', value: r.authorizedStrength },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'installation') return [
          { field: 'installationName', value: r.name }, { field: 'installationCode', value: r.code },
          { field: 'state', value: r.state }, { field: 'installationType', value: r.type },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        return [];
      },
    },
    training: {
      collection: 'training', effectiveDating: false,
      identity: (r) => {
        if (r._type === 'member') return { nativeId: r.traineeId, name: r.name, detail: r.mos, active: true,
          keys: { serviceNumber: r.traineeId.slice(1) && 'D' + r.traineeId.slice(1), nameGroup: N().name(r.name) + '|' + r.rosterUic, name: N().name(r.name) } };
        if (r._type === 'unit') return { nativeId: r.rosterUic, name: r.rosterName, detail: 'Training roster', active: true, keys: { code: r.rosterUic } };
        if (r._type === 'event') return { nativeId: r.eventId, name: r.eventName, detail: r.eventType, active: true, keys: { code: r.eventId } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        if (r._type === 'member') return [
          { field: 'fullName', value: r.name }, { field: 'rank', value: r.rank },
          { field: 'mos', value: r.mos }, { field: 'unitCode', value: r.rosterUic },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'unit') return [
          { field: 'unitName', value: r.rosterName }, { field: 'uic', value: r.rosterUic },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'event') return [
          { field: 'eventName', value: r.eventName }, { field: 'eventType', value: r.eventType },
          { field: 'eventDate', value: r.eventDate }, { field: 'result', value: r.result },
          { field: 'expiresOn', value: r.expiresOn },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        return [];
      },
    },
    medical: {
      collection: 'medical', effectiveDating: false,
      identity: (r) => ({ nativeId: r.patientId, name: r.name, detail: r.readinessStatus, active: true,
        keys: { serviceNumber: r.dodId, name: N().name(r.name) } }),
      assertions: (r) => [
        { field: 'fullName', value: r.name }, { field: 'serviceNumber', value: r.dodId },
        { field: 'medicalReadiness', value: r.readinessStatus }, { field: 'deployable', value: r.deployable },
      ].map((x) => Object.assign({ observedAt: r.observedAt, effectiveFrom: r.observedAt }, x)),
    },
    security: {
      collection: 'security', effectiveDating: false,
      identity: (r) => ({ nativeId: r.subjectId, name: r.name, detail: r.clearanceLevel, active: true,
        keys: { serviceNumber: 'D' + r.subjectId.slice(1), name: N().name(r.name) } }),
      assertions: (r) => [
        { field: 'fullName', value: r.name }, { field: 'clearanceLevel', value: r.clearanceLevel },
        { field: 'clearanceExpiry', value: r.expiresOn },
      ].map((x) => Object.assign({ observedAt: r.observedAt, effectiveFrom: r.observedAt }, x)),
    },
    access: {
      collection: 'access', effectiveDating: false,
      identity: (r) => ({ nativeId: r.credentialId, name: r.holder, detail: r.credentialStatus, active: r.credentialStatus === 'Active',
        keys: { serviceNumber: r.dodId, name: N().name(r.holder) } }),
      assertions: (r) => [
        { field: 'fullName', value: r.holder }, { field: 'serviceNumber', value: r.dodId },
        { field: 'unitCode', value: r.unitUic }, { field: 'accessStatus', value: r.credentialStatus },
      ].map((x) => Object.assign({ observedAt: r.observedAt, effectiveFrom: r.observedAt }, x)),
    },
  };

  /* Statistics for this vertical. Same engine, different questions. */
  const DAYS = 86400000;
  SOT.stats.register('defense', {
    member: [
      { id: 'events12', label: 'Readiness events', hint: 'Last 12 months', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'completed_by', { dir: 'in' })
          .filter((n) => ctx.profiles[n.entity.id].get('eventDate') > ctx.asOf - 365 * DAYS).length },
      { id: 'current', label: 'Qualifications current', hint: 'Not yet expired', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'completed_by', { dir: 'in' })
          .filter((n) => ctx.profiles[n.entity.id].get('expiresOn') > ctx.asOf && ctx.profiles[n.entity.id].get('result') === 'Go').length },
      { id: 'expired', label: 'Qualifications lapsed', hint: 'Past their currency date', fmt: 'int', invert: true,
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'completed_by', { dir: 'in' })
          .filter((n) => ctx.profiles[n.entity.id].get('expiresOn') <= ctx.asOf).length },
      { id: 'units', label: 'Units served', hint: 'Including previous assignments', fmt: 'int',
        calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'out' }).map((n) => n.entity.id)).size },
      { id: 'timeInUnit', label: 'Time in unit', hint: 'Current assignment', fmt: 'years',
        calc: (p, ctx) => {
          const n = ctx.graph.neighbour(p.entity.id, 'assigned_to', { dir: 'out', at: ctx.asOf });
          return n && n.edge.fromTs ? Number(((ctx.asOf - n.edge.fromTs) / (365 * DAYS)).toFixed(1)) : null;
        } },
    ],
    unit: [
      { id: 'assigned', label: 'Assigned strength', hint: 'Currently assigned', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).length },
      { id: 'authorized', label: 'Authorised strength', hint: 'On the books', fmt: 'int', calc: (p) => p.get('authorizedStrength') },
      { id: 'fill', label: 'Fill', hint: 'Assigned against authorised', fmt: 'pct',
        calc: (p, ctx) => {
          const a = ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).length;
          const auth = p.get('authorizedStrength');
          return auth ? Math.round((a / auth) * 100) : null;
        } },
      { id: 'deployable', label: 'Deployable', hint: 'Of those assigned', fmt: 'pct',
        calc: (p, ctx) => {
          const ppl = ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf })
            .map((n) => ctx.profiles[n.entity.id]);
          if (!ppl.length) return null;
          return Math.round((ppl.filter((m) => m.get('deployable') === 'Yes').length / ppl.length) * 100);
        } },
      { id: 'everAssigned', label: 'Ever assigned', hint: 'Including past personnel', fmt: 'int',
        calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in' }).map((n) => n.entity.id)).size },
      { id: 'events90', label: 'Readiness events', hint: 'Last 90 days', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'conducted_at', { dir: 'in' })
          .filter((n) => ctx.profiles[n.entity.id].get('eventDate') > ctx.asOf - 90 * DAYS).length },
    ],
    installation: [
      { id: 'units', label: 'Units stationed', hint: 'Directly stationed here', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'stationed_at', { dir: 'in' }).length },
      { id: 'people', label: 'Personnel', hint: 'Across stationed units', fmt: 'int',
        calc: (p, ctx) => {
          let n = 0;
          ctx.graph.neighbours(p.entity.id, 'stationed_at', { dir: 'in' }).forEach((u) => {
            n += ctx.graph.neighbours(u.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).length;
          });
          return n;
        } },
    ],
    event: [
      { id: 'participants', label: 'Personnel', hint: 'On this record', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'completed_by', { dir: 'out' }).length },
      { id: 'daysAgo', label: 'Days ago', hint: 'Since the event', fmt: 'int',
        calc: (p, ctx) => (p.get('eventDate') ? Math.round((ctx.asOf - p.get('eventDate')) / DAYS) : null) },
    ],
  });

  SOT.packs = SOT.packs || {};
  SOT.packs.defense = {
    id: 'defense',
    label: 'Defence command',
    industry: 'Public sector & defence',
    tenantName: 'Joint Task Force Meridian',
    tagline: 'One battalion, five systems, one answer about who is ready.',
    systems: SYSTEMS,
    entityTypes: ENTITY_TYPES,
    edgeTypes: EDGE_TYPES,
    fields: FIELDS,
    policy: POLICY,
    rationale: RATIONALE,
    roles: ROLES,
    hierarchy: HIERARCHY,
    adapters: ADAPTERS,
    build,
    searchTypes: ['member', 'unit', 'installation', 'event'],
    // Personnel are described by rank rather than a job title.
    personaRules: {
      commander: { field: 'rank', match: '^LTC$' },
      company: { field: 'rank', match: '^CPT$' },
      s1: { field: 'rank', match: '^LTC$' },
      security: { field: 'rank', match: '^LTC$' },
    },
    codeRefs: { unitCode: ['unit', 'uic'], installationCode: ['installation', 'installationCode'] },
  };
})(window.SOT || (window.SOT = {}));
