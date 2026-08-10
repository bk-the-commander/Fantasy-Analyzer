/* SOT — resolution and conflict classification.
 *
 * No merged record is ever stored. Each system's claims are kept as immutable
 * assertions, and the value of a field is computed at read time from a policy
 * the customer owns. Change the policy and the entire application re-answers,
 * with no migration and no re-sync, because there was never a golden copy to
 * migrate.
 *
 * Classification is the part that decides whether anyone keeps using this:
 *
 *   Divergence  both systems read recently, both confident, values differ
 *   Lag         a system has not been read since the value changed
 *   Gap         a system that should carry the field is empty
 *
 * Reporting lag as a defect is how reconciliation tools generate four thousand
 * findings, half of which fix themselves overnight, and lose the customer's
 * trust in the other half.
 */
(function (SOT) {
  'use strict';

  const S = SOT.schema;

  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }
  const isEmpty = (v) => v === null || v === undefined || v === '';

  function severityFor(field, kind) {
    const w = field.weight;
    const base = w >= 5 ? 0 : w >= 4 ? 1 : w >= 2 ? 2 : 3;
    const shift = kind === 'divergence' ? 0 : kind === 'gap' ? 1 : 2;
    return S.SEVERITY_ORDER[Math.min(3, base + shift)];
  }

  function capabilities(pack) {
    if (pack._capabilities) return pack._capabilities;
    const caps = {};
    Object.keys(pack.adapters).forEach((sysId) => {
      const set = new Set();
      (pack.records[pack.adapters[sysId].collection] || []).forEach((rec) => {
        (pack.adapters[sysId].assertions(rec) || []).forEach((a) => set.add(a.field));
      });
      caps[sysId] = set;
    });
    pack._capabilities = caps;
    return caps;
  }

  function resolveAll(pack, identity, policy, asOf) {
    const caps = capabilities(pack);
    const fieldsByEntity = {};
    pack.fields.forEach((f) => (fieldsByEntity[f.entity] || (fieldsByEntity[f.entity] = [])).push(f));

    const profiles = {};
    const conflicts = [];
    let seq = 0;

    identity.entities.forEach((entity) => {
      const fields = fieldsByEntity[entity.type] || [];
      const bucket = {};
      const linked = new Set();

      entity.links.forEach((link) => {
        linked.add(link.system);
        const adapter = pack.adapters[link.system];
        (adapter.assertions(link.record) || []).forEach((a) => {
          if (isEmpty(a.value)) return;
          (bucket[a.field] || (bucket[a.field] = [])).push({
            field: a.field,
            value: a.value,
            systemId: link.system,
            nativeId: link.nativeId,
            observedAt: a.observedAt,
            effectiveFrom: a.effectiveFrom == null ? a.observedAt : a.effectiveFrom,
            scheduled: !!a.scheduled,
            effectiveDating: !!adapter.effectiveDating,
          });
        });
      });

      const resolved = {};
      const scheduled = [];
      let weightTotal = 0;
      let weightLost = 0;

      fields.forEach((field) => {
        const all = bucket[field.key] || [];
        const current = [];
        all.forEach((a) => {
          if (a.scheduled || a.effectiveFrom > asOf) scheduled.push(Object.assign({ fieldLabel: field.label }, a));
          else current.push(a);
        });
        if (!current.length) {
          resolved[field.key] = { field, value: null, systemId: null, assertions: [], conflict: null, absent: true };
          return;
        }

        const order = policy[field.key] || [];
        let winner = null;
        for (let i = 0; i < order.length && !winner; i++) {
          const cands = current.filter((a) => a.systemId === order[i] && !isEmpty(a.value));
          if (cands.length) {
            cands.sort((x, y) => y.effectiveFrom - x.effectiveFrom);
            winner = cands[0];
          }
        }
        if (!winner) winner = current.slice().sort((x, y) => y.observedAt - x.observedAt)[0];
        if (!winner) {
          resolved[field.key] = { field, value: null, systemId: null, assertions: current, conflict: null, absent: true };
          return;
        }

        weightTotal += field.weight;
        const offenders = [];

        current.forEach((a) => {
          if (a.systemId === winner.systemId || isEmpty(a.value) || sameValue(a.value, winner.value)) return;
          let kind;
          if (winner.effectiveDating && a.observedAt < winner.effectiveFrom) kind = 'lag';
          else if (asOf - a.observedAt > field.tolerance * S.DAY) kind = 'lag';
          else kind = 'divergence';
          offenders.push({ systemId: a.systemId, value: a.value, observedAt: a.observedAt, kind, assertion: a });
        });

        field.contributors.forEach((sysId) => {
          if (sysId === winner.systemId || !linked.has(sysId)) return;
          if (!caps[sysId] || !caps[sysId].has(field.key)) return;
          if (current.some((a) => a.systemId === sysId && !isEmpty(a.value))) return;
          offenders.push({ systemId: sysId, value: null, observedAt: pack.syncState[sysId].lastSync, kind: 'gap' });
        });

        let conflict = null;
        if (offenders.length) {
          const kind = offenders.some((o) => o.kind === 'divergence')
            ? 'divergence'
            : offenders.some((o) => o.kind === 'gap') ? 'gap' : 'lag';
          seq++;
          conflict = {
            id: 'C' + String(seq).padStart(4, '0'),
            entityId: entity.id,
            entityType: entity.type,
            entityName: entity.displayName,
            field: field.key,
            fieldLabel: field.label,
            group: field.group,
            kind,
            severity: field.severity ? field.severity(kind) : severityFor(field, kind),
            resolvedValue: winner.value,
            resolvedSystem: winner.systemId,
            offenders,
            systems: [winner.systemId].concat(offenders.map((o) => o.systemId)),
            actionable: kind !== 'lag',
            impact: field.impact || null,
          };
          conflicts.push(conflict);
          weightLost += field.weight * (kind === 'lag' ? 0.34 : 1);
        }

        resolved[field.key] = {
          field,
          value: winner.value,
          systemId: winner.systemId,
          effectiveFrom: winner.effectiveFrom,
          observedAt: winner.observedAt,
          assertions: current,
          conflict,
          absent: false,
        };
      });

      profiles[entity.id] = {
        entity,
        type: entity.type,
        fields: resolved,
        scheduled,
        linkedSystems: Array.from(linked),
        alignment: weightTotal ? Math.max(0, Math.round((1 - weightLost / weightTotal) * 100)) : 100,
        conflicts: [],
        get: (k) => (resolved[k] ? resolved[k].value : null),
        name: null,
      };
    });

    conflicts.forEach((c) => profiles[c.entityId].conflicts.push(c));
    conflicts.sort(
      (a, b) =>
        S.SEVERITY_ORDER.indexOf(a.severity) - S.SEVERITY_ORDER.indexOf(b.severity) ||
        a.entityName.localeCompare(b.entityName)
    );

    // Display name comes from the entity type's title field once resolved, so
    // a renamed ward or a patient's corrected legal name flows through.
    const typeById = Object.fromEntries(pack.entityTypes.map((t) => [t.id, t]));
    Object.values(profiles).forEach((p) => {
      const t = typeById[p.type];
      p.name = (t && t.titleField && p.get(t.titleField)) || p.entity.displayName;
    });

    return { profiles, conflicts, asOf, policy };
  }

  SOT.resolve = { resolveAll, sameValue, severityFor };
})(window.SOT || (window.SOT = {}));
