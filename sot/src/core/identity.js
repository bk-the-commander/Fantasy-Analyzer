/* SOT — identity resolution.
 *
 * Every claim this product makes rests on knowing that an Epic user, a Workday
 * worker and a badge record are one human being — or that two medical record
 * numbers are one patient. A wrong match doesn't cause a small error; it
 * causes a confident lie about a person, and in a hospital that lie can be
 * attached to a chart.
 *
 * So matching is scored rather than boolean, only strong evidence links
 * automatically, and everything in between becomes a queue a human works. The
 * queue is a feature: forty uncertain matches shown honestly beat forty
 * invented facts.
 *
 * The algorithm is vertical-agnostic. It clusters records *within an entity
 * type* on shared identity keys, weighted by how much that kind of key is
 * worth (see KEY_STRENGTH). Hospitals match on MRN and NPI, defence on service
 * number, sales on employee ID — same code, different keys.
 */
(function (SOT) {
  'use strict';

  const S = SOT.schema;

  function resolveIdentities(pack, opts) {
    opts = opts || {};
    const forced = opts.forcedLinks || [];
    const dismissed = new Set(opts.dismissedKeys || []);
    const typeById = Object.fromEntries(pack.entityTypes.map((t) => [t.id, t]));

    /* 1. flatten every source record into a comparable entry */
    const entries = [];
    Object.keys(pack.adapters).forEach((sysId) => {
      const adapter = pack.adapters[sysId];
      (pack.records[adapter.collection] || []).forEach((record) => {
        const ident = adapter.identity(record);
        if (!ident) return;
        entries.push({
          key: sysId + ':' + ident.nativeId,
          system: sysId,
          nativeId: ident.nativeId,
          entityType: record._type,
          record,
          ident,
          keys: ident.keys || {},
        });
      });
    });
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

    /* 2. bucket on every identity key value, then score pairs.
       Blocking on key values keeps this near-linear; a production build uses
       the same strategy against an index. */
    const buckets = {};
    entries.forEach((e) => {
      Object.keys(e.keys).forEach((kind) => {
        const v = e.keys[kind];
        if (v == null || v === '') return;
        const b = kind + '|' + e.entityType + '|' + String(v).toLowerCase();
        (buckets[b] || (buckets[b] = [])).push({ entry: e, kind });
      });
    });

    const edges = new Map();
    Object.keys(buckets).forEach((b) => {
      const group = buckets[b];
      if (group.length < 2 || group.length > 60) return; // a 60-way "match" is a bad key, not a person
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i].entry;
          const c = group[j].entry;
          if (a.key === c.key) continue;
          const kind = group[i].kind;
          const strength = S.KEY_STRENGTH[kind];
          if (!strength) continue;
          const id = a.key < c.key ? a.key + '|' + c.key : c.key + '|' + a.key;
          const prev = edges.get(id);
          if (!prev || prev.score < strength.score) edges.set(id, { a: a.key, b: c.key, kind, score: strength.score });
        }
      }
    });

    /* 3. union only what is strong enough to apply without asking */
    const parent = {};
    const find = (x) => {
      if (parent[x] === undefined) parent[x] = x;
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    entries.forEach((e) => find(e.key));

    const strong = [];
    const weak = [];
    const forcedIds = new Set(forced.map((f) => (f.a < f.b ? f.a + '|' + f.b : f.b + '|' + f.a)));
    edges.forEach((edge, id) => {
      if (forcedIds.has(id)) return;
      if (edge.score >= S.AUTO_LINK) { union(edge.a, edge.b); strong.push(edge); }
      else if (edge.score >= S.REVIEW) weak.push(edge);
    });
    forced.forEach((f) => {
      if (!byKey[f.a] || !byKey[f.b]) return;
      union(f.a, f.b);
      strong.push({ a: f.a, b: f.b, kind: 'confirmed', score: 1 });
    });

    /* 4. clusters become entities */
    const clusters = {};
    entries.forEach((e) => {
      const root = find(e.key);
      (clusters[root] || (clusters[root] = [])).push(e);
    });

    const entities = [];
    const unresolved = [];
    const entityByRecordKey = {};

    Object.values(clusters).forEach((members) => {
      const type = typeById[members[0].entityType];
      if (!type) return;
      const masters = type.masterSystems || [];
      let anchor = null;
      for (let i = 0; i < masters.length && !anchor; i++) {
        anchor = members.find((m) => m.system === masters[i] && m.ident.active !== false);
      }
      if (!anchor) anchor = members.find((m) => m.ident.active !== false) || members[0];

      // A cluster with no evidence from any authoritative system is not an
      // entity yet — it is a question. Ghost seats and orphaned records land
      // here rather than becoming people.
      const hasMaster = members.some((m) => masters.indexOf(m.system) >= 0);
      if (!hasMaster && type.requireMaster) {
        members.forEach((m) => {
          if (dismissed.has(m.key)) return;
          unresolved.push({
            key: m.key,
            system: m.system,
            entityType: m.entityType,
            nativeId: m.nativeId,
            name: m.ident.name,
            detail: m.ident.detail || '',
            reason: 'No record in an authoritative system could be matched to this.',
            recommendation: 'Confirm what this record represents, or retire it.',
            suggestions: [],
          });
        });
        return;
      }

      const id = type.id.toUpperCase().slice(0, 3) + '-' + anchor.nativeId.replace(/[^A-Za-z0-9-]/g, '');
      const links = members.map((m) => {
        const edge = strong.find((e) => (e.a === m.key || e.b === m.key) && (e.a === anchor.key || e.b === anchor.key));
        const kind = m === anchor ? null : edge ? edge.kind : null;
        return {
          system: m.system,
          nativeId: m.nativeId,
          record: m.record,
          confidence: m === anchor ? 1 : edge ? edge.score : 0.9,
          method: m === anchor ? 'anchor' : kind || 'transitive',
          methodLabel:
            m === anchor
              ? 'Authoritative record for this entity'
              : kind
                ? S.KEY_STRENGTH[kind].label
                : 'Linked through another matched system',
          active: m.ident.active !== false,
        };
      });

      const bySystem = {};
      links.forEach((l) => (bySystem[l.system] || (bySystem[l.system] = [])).push(l));

      const flags = [];
      Object.keys(bySystem).forEach((sys) => {
        if (bySystem[sys].length > 1) {
          flags.push({
            kind: 'duplicate-record',
            system: sys,
            severity: 'high',
            label: bySystem[sys].length + ' ' + pack.systemById[sys].name + ' records resolve to this ' + type.label.toLowerCase(),
          });
        }
      });
      (type.expectedSystems || []).forEach((sys) => {
        if (!bySystem[sys]) {
          flags.push({
            kind: 'missing-system',
            system: sys,
            severity: type.id === 'staff' ? 'critical' : 'medium',
            label: 'No ' + pack.systemById[sys].name + ' record',
          });
        }
      });

      entities.push({
        id,
        type: type.id,
        anchorSystem: anchor.system,
        displayName: anchor.ident.name,
        links,
        bySystem,
        flags,
        confidence: Math.min.apply(null, links.map((l) => l.confidence)),
        suggestions: [],
      });
      members.forEach((m) => { entityByRecordKey[m.key] = id; });
    });

    const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));

    /* 5. the middle band becomes proposals rather than assumptions */
    weak.forEach((edge) => {
      const ea = entityByRecordKey[edge.a];
      const eb = entityByRecordKey[edge.b];
      if (ea && eb && ea !== eb) return; // two known entities that merely share a name
      const entityId = ea || eb;
      if (!entityId) return;
      const looseKey = ea ? edge.b : edge.a;
      if (entityByRecordKey[looseKey] || dismissed.has(looseKey)) return;
      const loose = byKey[looseKey];
      if (!loose) return;

      const proposal = {
        entityId,
        entityName: entityById[entityId].displayName,
        system: loose.system,
        entityType: loose.entityType,
        nativeId: loose.nativeId,
        name: loose.ident.name,
        detail: loose.ident.detail || '',
        score: edge.score,
        methodLabel: S.KEY_STRENGTH[edge.kind].label,
      };
      entityById[entityId].suggestions.push(proposal);
      const existing = unresolved.find((x) => x.key === looseKey);
      if (existing) existing.suggestions.push(proposal);
      else
        unresolved.push({
          key: looseKey,
          system: loose.system,
          entityType: loose.entityType,
          nativeId: loose.nativeId,
          name: loose.ident.name,
          detail: loose.ident.detail || '',
          reason: 'Resembles a known record but shares no identifier with it.',
          recommendation: 'Confirm the link so this system starts contributing to ' + proposal.entityName + '.',
          suggestions: [proposal],
        });
    });

    /* 6. reference index — lets edges and manager pointers written in one
          system's dialect find the entity they mean */
    const refIndex = {};
    entries.forEach((e) => {
      const eid = entityByRecordKey[e.key];
      if (!eid) return;
      refIndex[e.entityType + '|' + e.system + '|' + e.nativeId] = eid;
    });

    function entityIdOf(ref) {
      if (!ref) return null;
      return refIndex[ref.type + '|' + ref.sys + '|' + ref.id] || null;
    }

    return {
      entities,
      entityById,
      unresolved,
      entityByRecordKey,
      entityIdOf,
      refIndex,
      stats: {
        sourceRecords: entries.length,
        entities: entities.length,
        autoLinked: strong.length,
        needsReview: unresolved.length,
        byType: pack.entityTypes.reduce((acc, t) => {
          acc[t.id] = entities.filter((e) => e.type === t.id).length;
          return acc;
        }, {}),
      },
      thresholds: { AUTO_LINK: S.AUTO_LINK, REVIEW: S.REVIEW },
    };
  }

  SOT.identity = { resolveIdentities };
})(window.SOT || (window.SOT = {}));
