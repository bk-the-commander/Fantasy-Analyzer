/* Source of Truth — resolution and conflict detection.
 *
 * Given assertions + a policy, produce (a) the resolved value of every field
 * for every person, with full provenance, and (b) the disagreements.
 *
 * The classification is the part that matters commercially. Anyone can diff
 * two systems and print the differences; that produces a spreadsheet nobody
 * opens twice. The product has to separate:
 *
 *   Divergence — two systems that have both been read recently disagree.
 *                Somebody has to fix something.
 *   Lag        — a system has not been read since the value changed. It is
 *                behind, not wrong, and raising it as a defect is noise.
 *   Gap        — a system that ought to carry the field is empty.
 *
 * Getting Lag wrong is how data-quality products die: they emit thousands of
 * findings, half of them resolve themselves overnight, and the customer stops
 * believing the other half.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  const isEmpty = (v) => v === null || v === undefined || v === '';

  function severityFor(field, kind) {
    const w = field.weight;
    const base = w >= 5 ? 0 : w >= 4 ? 1 : w >= 2 ? 2 : 3; // index into SEVERITY_ORDER
    const shift = kind === 'divergence' ? 0 : kind === 'gap' ? 1 : 2;
    return SOT.model.SEVERITY_ORDER[Math.min(3, base + shift)];
  }

  /**
   * Build every person's assertion set, dereference cross-system pointers, and
   * resolve each field under the supplied policy.
   */
  function resolveAll(dataset, identityResult, policy, asOf) {
    const { FIELD_BY_KEY, FIELDS } = SOT.model;
    const adapters = SOT.adapters;
    asOf = asOf || dataset.company.asOf;

    /* ---- 0. what each system is even capable of saying ---------------------
     * A field can only be "missing" from a system that carries it at all. The
     * declared contributor list is intent; this is what the adapter actually
     * emits. Without the check, every field a vendor simply does not model
     * reports as a gap on every single person — which is how a reconciliation
     * tool ends up with ten thousand meaningless findings on day one.
     */
    if (!dataset._capabilities) {
      const caps = {};
      Object.keys(adapters).forEach((sysId) => {
        const set = new Set();
        (dataset.records[adapters[sysId].collection] || []).forEach((rec) => {
          adapters[sysId].assertions(rec).forEach((a) => set.add(a.field));
        });
        caps[sysId] = set;
      });
      dataset._capabilities = caps;
    }
    const capabilities = dataset._capabilities;

    /* ---- 1. assertions ---------------------------------------------------- */

    const assertionsByPerson = {};
    identityResult.people.forEach((person) => {
      const bucket = {};
      person.links.forEach((link) => {
        const adapter = adapters[link.system];
        adapter.assertions(link.record).forEach((a) => {
          if (isEmpty(a.value) && !a.ref) return;
          const entry = {
            field: a.field,
            value: a.value,
            ref: a.ref || null,
            systemId: link.system,
            nativeId: link.nativeId,
            observedAt: a.observedAt,
            effectiveFrom: a.effectiveFrom == null ? a.observedAt : a.effectiveFrom,
            scheduled: !!a.scheduled,
            effectiveDating: !!adapter.effectiveDating,
            linkConfidence: link.confidence,
          };
          (bucket[a.field] || (bucket[a.field] = [])).push(entry);
        });
      });
      assertionsByPerson[person.id] = bucket;
    });

    /* ---- 2. dereference person-valued fields ------------------------------ */

    Object.keys(assertionsByPerson).forEach((pid) => {
      const bucket = assertionsByPerson[pid];
      (bucket.managerId || []).forEach((a) => {
        a.value = SOT.identity.dereference(identityResult.refIndex, a.ref);
        a.unresolvedRef = a.ref && !a.value ? a.ref : null;
      });
      bucket.managerId = (bucket.managerId || []).filter((a) => a.value || a.unresolvedRef);
    });

    /* ---- 3. resolve ------------------------------------------------------- */

    const profiles = {};
    const conflicts = [];
    let conflictSeq = 0;

    identityResult.people.forEach((person) => {
      const bucket = assertionsByPerson[person.id];
      const linkedSystems = new Set(person.links.map((l) => l.system));
      const fields = {};
      const scheduledChanges = [];
      let weightTotal = 0;
      let weightLost = 0;

      FIELDS.forEach((field) => {
        const all = bucket[field.key] || [];
        const current = [];
        all.forEach((a) => {
          if (a.effectiveFrom > asOf || a.scheduled) scheduledChanges.push(Object.assign({ fieldLabel: field.label }, a));
          else current.push(a);
        });
        if (!current.length) {
          fields[field.key] = { field, value: null, systemId: null, assertions: [], conflict: null, absent: true };
          return;
        }

        // Winner: highest-priority system in the policy that has a value.
        const order = policy[field.key] || [];
        let winner = null;
        for (let i = 0; i < order.length && !winner; i++) {
          const candidates = current.filter((a) => a.systemId === order[i] && !isEmpty(a.value));
          if (candidates.length) {
            candidates.sort((x, y) => y.effectiveFrom - x.effectiveFrom);
            winner = candidates[0];
          }
        }
        if (!winner) {
          // No policy system has it; fall back to the freshest claim so the
          // profile is still useful, and say so.
          const fallback = current.filter((a) => !isEmpty(a.value)).sort((x, y) => y.observedAt - x.observedAt)[0];
          winner = fallback || null;
        }
        if (!winner) {
          fields[field.key] = { field, value: null, systemId: null, assertions: current, conflict: null, absent: true };
          return;
        }

        weightTotal += field.weight;

        /* --- disagreements ------------------------------------------------ */
        const offenders = [];
        current.forEach((a) => {
          if (a.systemId === winner.systemId) return;
          if (isEmpty(a.value)) return;
          if (sameValue(a.value, winner.value)) return;
          let kind;
          if (winner.effectiveDating && a.observedAt < winner.effectiveFrom) kind = 'lag';
          else if (asOf - a.observedAt > field.tolerance * DAY) kind = 'lag';
          else kind = 'divergence';
          offenders.push({ systemId: a.systemId, value: a.value, observedAt: a.observedAt, kind, assertion: a });
        });

        /* --- gaps --------------------------------------------------------- */
        field.contributors.forEach((sysId) => {
          if (sysId === winner.systemId) return;
          if (!linkedSystems.has(sysId)) return; // not connected for this person — not a gap
          if (!capabilities[sysId] || !capabilities[sysId].has(field.key)) return; // system does not model it
          const has = current.some((a) => a.systemId === sysId && !isEmpty(a.value));
          if (!has) offenders.push({ systemId: sysId, value: null, observedAt: dataset.syncState[sysId].lastSync, kind: 'gap' });
        });

        let conflict = null;
        if (offenders.length) {
          const kind = offenders.some((o) => o.kind === 'divergence')
            ? 'divergence'
            : offenders.some((o) => o.kind === 'gap') ? 'gap' : 'lag';
          const severity = severityFor(field, kind);
          conflictSeq++;
          conflict = {
            id: 'C' + String(conflictSeq).padStart(4, '0'),
            personId: person.id,
            personName: person.displayName,
            field: field.key,
            fieldLabel: field.label,
            group: field.group,
            kind,
            severity,
            resolvedValue: winner.value,
            resolvedSystem: winner.systemId,
            resolvedEffectiveFrom: winner.effectiveFrom,
            offenders,
            systems: [winner.systemId].concat(offenders.map((o) => o.systemId)),
            actionable: kind !== 'lag',
          };
          conflicts.push(conflict);
          weightLost += field.weight * (kind === 'lag' ? 0.34 : 1);
        }

        fields[field.key] = {
          field,
          value: winner.value,
          systemId: winner.systemId,
          effectiveFrom: winner.effectiveFrom,
          observedAt: winner.observedAt,
          assertions: current,
          agreeing: current.filter((a) => a.systemId !== winner.systemId && sameValue(a.value, winner.value)).map((a) => a.systemId),
          conflict,
          absent: false,
        };
      });

      const alignment = weightTotal ? Math.max(0, Math.round((1 - weightLost / weightTotal) * 100)) : 100;

      profiles[person.id] = {
        person,
        fields,
        scheduledChanges,
        alignment,
        conflicts: conflicts.filter((c) => c.personId === person.id),
        linkedSystems: Array.from(linkedSystems),
        get: (key) => (fields[key] ? fields[key].value : null),
      };
    });

    /* ---- 4. the org graph, derived from resolved managers ----------------- */

    const nodes = {};
    Object.keys(profiles).forEach((pid) => {
      nodes[pid] = { id: pid, managerId: profiles[pid].get('managerId') || null, reports: [] };
    });
    Object.keys(nodes).forEach((pid) => {
      const mid = nodes[pid].managerId;
      if (mid && nodes[mid] && mid !== pid) nodes[mid].reports.push(pid);
      else nodes[pid].managerId = null;
    });

    // Cycle guard. A CRM hierarchy edited by hand can absolutely contain one,
    // and an org chart that hangs the browser is not a good demo.
    const depthOf = (pid) => {
      let d = 0, cur = nodes[pid], seen = new Set();
      while (cur && cur.managerId && !seen.has(cur.id)) { seen.add(cur.id); cur = nodes[cur.managerId]; d++; if (d > 20) break; }
      return d;
    };
    Object.keys(nodes).forEach((pid) => { nodes[pid].depth = depthOf(pid); });

    const roots = Object.keys(nodes).filter((pid) => !nodes[pid].managerId);
    Object.keys(nodes).forEach((pid) => {
      nodes[pid].reports.sort((a, b) => profiles[a].person.displayName.localeCompare(profiles[b].person.displayName));
    });

    function descendants(pid, acc) {
      acc = acc || [];
      (nodes[pid] ? nodes[pid].reports : []).forEach((r) => { acc.push(r); descendants(r, acc); });
      return acc;
    }
    function chain(pid) {
      const out = [];
      let cur = nodes[pid] && nodes[pid].managerId;
      let guard = 0;
      while (cur && guard++ < 20) { out.push(cur); cur = nodes[cur].managerId; }
      return out;
    }

    conflicts.sort((a, b) => {
      const s = SOT.model.SEVERITY_ORDER.indexOf(a.severity) - SOT.model.SEVERITY_ORDER.indexOf(b.severity);
      return s !== 0 ? s : a.personName.localeCompare(b.personName);
    });

    const org = { nodes, roots, descendants, chain };
    const stats = summarize(profiles, conflicts, identityResult);

    return { profiles, conflicts, org, stats, assertionsByPerson, asOf, policy };
  }

  function summarize(profiles, conflicts, identityResult) {
    const people = Object.values(profiles);
    const active = people.filter((p) => p.get('employmentStatus') === 'Active');
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const byKind = { divergence: 0, lag: 0, gap: 0 };
    const byField = {};
    const bySystem = {};
    conflicts.forEach((c) => {
      bySeverity[c.severity]++;
      byKind[c.kind]++;
      byField[c.field] = (byField[c.field] || 0) + 1;
      c.systems.forEach((s) => { bySystem[s] = (bySystem[s] || 0) + 1; });
    });

    const departments = {};
    const territories = {};
    const managers = new Set();
    people.forEach((p) => {
      const d = p.get('department');
      if (d) departments[d] = (departments[d] || 0) + 1;
      const t = p.get('territory');
      if (t) territories[t] = (territories[t] || 0) + 1;
      const m = p.get('managerId');
      if (m) managers.add(m);
    });

    const avgAlignment = people.length
      ? Math.round(people.reduce((s, p) => s + p.alignment, 0) / people.length)
      : 100;

    return {
      people: people.length,
      activePeople: active.length,
      departments: Object.keys(departments).length,
      departmentCounts: departments,
      territories: Object.keys(territories).length,
      territoryCounts: territories,
      managers: managers.size,
      conflicts: conflicts.length,
      actionable: conflicts.filter((c) => c.actionable).length,
      bySeverity,
      byKind,
      byField,
      bySystem,
      avgAlignment,
      identity: identityResult.stats,
    };
  }

  SOT.resolve = { resolveAll, severityFor, sameValue };
})(window.SOT || (window.SOT = {}));
