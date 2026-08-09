/* Source of Truth — identity resolution.
 *
 * Nothing else in the product works until this does. Every "discrepancy" is a
 * claim that two systems describe the same person differently, so a bad match
 * doesn't produce a small error — it produces a confident lie.
 *
 * The design consequence: matches are scored, only strong matches are applied
 * automatically, and everything in between goes to a human queue instead of
 * being guessed at. A visible queue of forty uncertain matches is a better
 * product than a silent one that invented forty facts.
 */
(function (SOT) {
  'use strict';

  const AUTO_LINK = 0.9;   // apply without asking
  const REVIEW = 0.4;      // propose to a human
  // Below REVIEW: not a match.

  const RULES = {
    'exact-email':  { score: 0.98, label: 'Work email matches exactly' },
    'employee-id':  { score: 0.96, label: 'Employee ID cross-referenced' },
    'name-and-team':{ score: 0.66, label: 'Full name and team match; email does not' },
    'name-only':    { score: 0.45, label: 'Full name matches; nothing else corroborates' },
    'confirmed':    { score: 1.00, label: 'Confirmed by a reviewer' },
  };

  const normEmail = (e) => (e || '').trim().toLowerCase();
  const normName = (n) =>
    (n || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  function makeUnionFind() {
    const parent = {};
    function find(x) {
      if (parent[x] === undefined) parent[x] = x;
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    return { find, union };
  }

  function resolveIdentities(dataset, opts) {
    const adapters = SOT.adapters;
    opts = opts || {};
    const forcedLinks = opts.forcedLinks || [];   // [{a: recordKey, b: recordKey}]
    const dismissedKeys = new Set(opts.dismissedKeys || []);

    // 1. Flatten every source record into a comparable identity entry.
    const entries = [];
    Object.keys(adapters).forEach((sysId) => {
      const adapter = adapters[sysId];
      (dataset.records[adapter.collection] || []).forEach((record) => {
        const ident = adapter.identity(record);
        entries.push({
          key: sysId + ':' + ident.nativeId,
          system: sysId,
          nativeId: ident.nativeId,
          record,
          ident,
          email: normEmail(ident.email),
          name: normName(ident.name),
          employeeRef: ident.employeeRef || null,
          team: ident.team || null,
        });
      });
    });

    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

    // 2. Score every candidate pair that shares any key at all. Bucketing on
    //    email / employee ref / name keeps this linear-ish rather than O(n²);
    //    a production implementation would use the same blocking strategy.
    const buckets = { email: {}, employeeRef: {}, name: {} };
    entries.forEach((e) => {
      if (e.email) (buckets.email[e.email] || (buckets.email[e.email] = [])).push(e);
      if (e.employeeRef) (buckets.employeeRef[e.employeeRef] || (buckets.employeeRef[e.employeeRef] = [])).push(e);
      if (e.name) (buckets.name[e.name] || (buckets.name[e.name] = [])).push(e);
    });

    const edges = new Map(); // "keyA|keyB" -> best edge
    function addEdge(a, b, rule) {
      if (a.key === b.key || a.system === b.system) {
        // Two records in the same system are a duplicate question, not an
        // identity question — but we still want them clustered so the
        // duplicate surfaces on the person rather than vanishing.
        if (a.key === b.key) return;
      }
      const id = a.key < b.key ? a.key + '|' + b.key : b.key + '|' + a.key;
      const existing = edges.get(id);
      const score = RULES[rule].score;
      if (!existing || existing.score < score) edges.set(id, { a: a.key, b: b.key, rule, score });
    }

    Object.values(buckets.email).forEach((group) => {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) addEdge(group[i], group[j], 'exact-email');
    });
    Object.values(buckets.employeeRef).forEach((group) => {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) addEdge(group[i], group[j], 'employee-id');
    });
    Object.values(buckets.name).forEach((group) => {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          if (a.email && b.email && a.email === b.email) continue; // already strong
          const rule = a.team && b.team && a.team === b.team ? 'name-and-team' : 'name-only';
          addEdge(a, b, rule);
        }
    });

    // 3. Apply only the confident edges.
    const uf = makeUnionFind();
    entries.forEach((e) => uf.find(e.key));
    const strong = [];
    const weak = [];
    const forcedSet = new Set(forcedLinks.map((f) => (f.a < f.b ? f.a + '|' + f.b : f.b + '|' + f.a)));
    edges.forEach((edge, id) => {
      if (forcedSet.has(id)) return; // handled below with full confidence
      if (edge.score >= AUTO_LINK) { uf.union(edge.a, edge.b); strong.push(edge); }
      else if (edge.score >= REVIEW) weak.push(edge);
    });
    // A human said these are the same person. That outranks every heuristic.
    forcedLinks.forEach((f) => {
      if (!byKey[f.a] || !byKey[f.b]) return;
      uf.union(f.a, f.b);
      strong.push({ a: f.a, b: f.b, rule: 'confirmed', score: 1 });
    });

    // 4. Turn clusters into people.
    const clusters = {};
    entries.forEach((e) => {
      const root = uf.find(e.key);
      (clusters[root] || (clusters[root] = [])).push(e);
    });

    const people = [];
    const unresolved = [];
    const dismissed = [];
    const personByRecordKey = {};

    Object.values(clusters).forEach((members) => {
      const workdayEntry = members.find((m) => m.system === 'workday');
      const activeSfdc = members.find((m) => m.system === 'salesforce' && m.ident.active);

      if (!workdayEntry && !activeSfdc) {
        // No worker record and no active CRM seat. This is an account, not a
        // person, until someone says otherwise.
        members.forEach((m) => {
          if (dismissedKeys.has(m.key)) { dismissed.push(m); return; }
          unresolved.push({
            key: m.key,
            system: m.system,
            nativeId: m.nativeId,
            name: m.ident.name,
            email: m.ident.email,
            reason: 'No HR record and no active CRM user could be matched to this seat.',
            recommendation: 'Confirm whether this is a real person, a shared seat, or a licence to reclaim.',
            suggestions: [],
          });
        });
        return;
      }

      const anchor = workdayEntry || activeSfdc;
      const id = workdayEntry ? 'P-' + workdayEntry.nativeId : 'P-SF-' + activeSfdc.nativeId;

      const links = members.map((m) => {
        const edge = strong.find(
          (e) => (e.a === m.key || e.b === m.key) && (e.a === anchor.key || e.b === anchor.key)
        );
        return {
          system: m.system,
          nativeId: m.nativeId,
          confidence: m === anchor ? 1 : edge ? edge.score : 0.9,
          method: m === anchor ? 'anchor' : edge ? edge.rule : 'transitive',
          methodLabel: m === anchor ? 'System of record for identity' : edge ? RULES[edge.rule].label : 'Linked through another matched system',
          record: m.record,
          active: m.ident.active,
        };
      });

      const flags = [];
      const bySystem = {};
      links.forEach((l) => { (bySystem[l.system] || (bySystem[l.system] = [])).push(l); });
      Object.keys(bySystem).forEach((sys) => {
        if (bySystem[sys].length > 1) {
          flags.push({
            kind: 'duplicate-source-record',
            system: sys,
            severity: 'high',
            label: bySystem[sys].length + ' ' + SOT.model.SYSTEM_BY_ID[sys].name + ' records resolve to this person',
          });
        }
      });
      if (!workdayEntry) {
        flags.push({
          kind: 'no-hr-record',
          system: 'workday',
          severity: 'critical',
          label: 'Active system access with no Workday worker record',
        });
      }

      const person = {
        id,
        anchorSystem: anchor.system,
        displayName: anchor.ident.name,
        email: anchor.ident.email,
        links,
        bySystem,
        flags,
        confidence: Math.min.apply(null, links.map((l) => l.confidence)),
        suggestions: [],
      };
      people.push(person);
      members.forEach((m) => { personByRecordKey[m.key] = person.id; });
    });

    const personById = Object.fromEntries(people.map((p) => [p.id, p]));

    // 5. Weak edges become proposals, attached to whichever side is a person.
    weak.forEach((edge) => {
      const pidA = personByRecordKey[edge.a];
      const pidB = personByRecordKey[edge.b];
      if (pidA && pidB && pidA !== pidB) return; // two known people who merely share a name
      const personId = pidA || pidB;
      if (!personId) return;
      const looseKey = pidA ? edge.b : edge.a;
      const loose = byKey[looseKey];
      if (!loose || personByRecordKey[looseKey]) return;
      if (dismissedKeys.has(looseKey)) return;

      const proposal = {
        personId,
        personName: personById[personId].displayName,
        system: loose.system,
        nativeId: loose.nativeId,
        name: loose.ident.name,
        email: loose.ident.email,
        score: edge.score,
        method: edge.rule,
        methodLabel: RULES[edge.rule].label,
      };
      personById[personId].suggestions.push(proposal);
      const entry = unresolved.find((u) => u.key === looseKey);
      if (entry) entry.suggestions.push(proposal);
      else
        unresolved.push({
          key: looseKey,
          system: loose.system,
          nativeId: loose.nativeId,
          name: loose.ident.name,
          email: loose.ident.email,
          reason: 'Matches a known person by name, but the email address does not correspond.',
          recommendation: 'Confirm the link so this system starts contributing to ' + proposal.personName + "'s profile.",
          suggestions: [proposal],
        });
    });

    // 6. Reference index: lets the resolver turn "manager = WD-10234" or
    //    "manager = someone@…" into a person ID, whichever dialect was used.
    const refIndex = { nativeId: {}, employeeRef: {}, email: {} };
    entries.forEach((e) => {
      const pid = personByRecordKey[e.key];
      if (!pid) return;
      refIndex.nativeId[e.system + ':' + e.nativeId] = pid;
      if (e.employeeRef) refIndex.employeeRef[e.system + ':' + e.employeeRef] = pid;
      if (e.email) refIndex.email[e.system + ':' + e.email] = pid;
      // Employee refs and emails are useful across systems too.
      if (e.employeeRef) refIndex.employeeRef['*:' + e.employeeRef] = pid;
      if (e.email) refIndex.email['*:' + e.email] = pid;
    });

    return {
      people,
      personById,
      unresolved,
      dismissed,
      personByRecordKey,
      refIndex,
      stats: {
        sourceRecords: entries.length,
        people: people.length,
        autoLinked: strong.length,
        needsReview: unresolved.length,
        dismissed: dismissed.length,
        systemsLinked: entries.length - unresolved.length,
      },
      thresholds: { AUTO_LINK, REVIEW },
      rules: RULES,
    };
  }

  function dereference(refIndex, reference) {
    if (!reference) return null;
    const { system, keyType, key } = reference;
    if (keyType === 'nativeId') return refIndex.nativeId[system + ':' + key] || null;
    if (keyType === 'employeeRef') return refIndex.employeeRef[system + ':' + key] || refIndex.employeeRef['*:' + key] || null;
    if (keyType === 'email') return refIndex.email[system + ':' + normEmail(key)] || refIndex.email['*:' + normEmail(key)] || null;
    return null;
  }

  SOT.identity = { resolveIdentities, dereference, normName, normEmail, RULES, AUTO_LINK, REVIEW };
})(window.SOT || (window.SOT = {}));
