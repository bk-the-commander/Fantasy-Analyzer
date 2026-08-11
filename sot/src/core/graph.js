/* SOT — the entity graph.
 *
 * Every relationship is stored once, typed, directional and time-bounded, and
 * indexed in both directions. That is what makes the interface navigable in
 * the way the product promises: from any entity you can ask "what is attached
 * to this, by what kind of relationship, and when was that true" — and every
 * answer is itself an entity you can open.
 *
 * The time bounds are load-bearing. `neighbours(id, 'assigned_to')` answers
 * "who works this ward"; the same call with `{ when: 'past' }` answers "who
 * used to". No separate history table, no snapshotting.
 */
(function (SOT) {
  'use strict';

  const S = SOT.schema;

  function build(entities, rawEdges, entityIdOf) {
    const byId = {};
    const byType = {};
    entities.forEach((e) => {
      byId[e.id] = e;
      (byType[e.type] || (byType[e.type] = [])).push(e);
    });

    /* Resolve each edge's endpoints from source-native references to entity
       ids. An edge pointing at something identity resolution never matched is
       dropped and counted — silently keeping a dangling pointer would show up
       later as a confidently wrong org chart. */
    const edges = [];
    const dangling = [];
    rawEdges.forEach((raw, i) => {
      const from = entityIdOf(raw.from);
      const to = entityIdOf(raw.to);
      if (!from || !to || from === to) {
        dangling.push(raw);
        return;
      }
      edges.push({
        id: 'E' + i,
        type: raw.type,
        from,
        to,
        fromTs: raw.fromTs == null ? null : raw.fromTs,
        toTs: raw.toTs == null ? null : raw.toTs,
        role: raw.role || null,
        meta: raw.meta || null,
        systemId: raw.systemId || null,
      });
    });

    const out = {}; // fromId -> type -> [edge]
    const inc = {}; // toId   -> type -> [edge]
    edges.forEach((e) => {
      ((out[e.from] || (out[e.from] = {}))[e.type] || (out[e.from][e.type] = [])).push(e);
      ((inc[e.to] || (inc[e.to] = {}))[e.type] || (inc[e.to][e.type] = [])).push(e);
    });

    /**
     * Everything hanging off an entity.
     *
     * @param id        entity id
     * @param type      edge type, or null for every type
     * @param opts.dir  'out' | 'in' | 'both'  (default 'both')
     * @param opts.when 'current' | 'past' | 'all'  (default 'all')
     * @param opts.at   timestamp for 'current' (default asOf)
     */
    function edgesOf(id, type, opts) {
      opts = opts || {};
      const dir = opts.dir || 'both';
      const when = opts.when || 'all';
      const at = opts.at;
      const collect = (index, direction) => {
        const bucket = index[id];
        if (!bucket) return [];
        const lists = type ? [bucket[type] || []] : Object.keys(bucket).map((k) => bucket[k]);
        const flat = [];
        lists.forEach((l) => l.forEach((e) => flat.push({ edge: e, direction })));
        return flat;
      };
      let rows = [];
      if (dir === 'out' || dir === 'both') rows = rows.concat(collect(out, 'out'));
      if (dir === 'in' || dir === 'both') rows = rows.concat(collect(inc, 'in'));
      if (when !== 'all') {
        rows = rows.filter((r) => {
          const live = S.activeAt(r.edge.fromTs, r.edge.toTs, at);
          return when === 'current' ? live : !live;
        });
      }
      return rows;
    }

    /** The same thing, resolved to the entity at the far end. */
    function neighbours(id, type, opts) {
      return edgesOf(id, type, opts)
        .map((r) => {
          const otherId = r.direction === 'out' ? r.edge.to : r.edge.from;
          const entity = byId[otherId];
          return entity ? { entity, edge: r.edge, direction: r.direction } : null;
        })
        .filter(Boolean);
    }

    /** First neighbour of a type, preferring one that is currently active. */
    function neighbour(id, type, opts) {
      const all = neighbours(id, type, opts);
      const live = all.filter((n) => S.activeAt(n.edge.fromTs, n.edge.toTs, (opts && opts.at) || Infinity));
      return (live[0] || all[0] || null);
    }

    /** Walk one edge type upward until it runs out — reporting lines, unit trees. */
    function ancestors(id, type, at) {
      const chain = [];
      const seen = new Set([id]);
      let cur = id;
      for (let i = 0; i < 24; i++) {
        const next = neighbour(cur, type, { dir: 'out', at });
        if (!next || seen.has(next.entity.id)) break;
        chain.push(next.entity);
        seen.add(next.entity.id);
        cur = next.entity.id;
      }
      return chain;
    }

    /** Everything below an entity along one edge type. */
    function descendants(id, type, at) {
      const acc = [];
      const seen = new Set([id]);
      const walk = (cur) => {
        neighbours(cur, type, { dir: 'in', at }).forEach((n) => {
          if (seen.has(n.entity.id)) return;
          seen.add(n.entity.id);
          acc.push(n.entity);
          walk(n.entity.id);
        });
      };
      walk(id);
      return acc;
    }

    return {
      entities,
      byId,
      byType,
      edges,
      dangling,
      edgesOf,
      neighbours,
      neighbour,
      ancestors,
      descendants,
      of: (id) => byId[id] || null,
      typed: (type) => byType[type] || [],
    };
  }

  SOT.graph = { build };
})(window.SOT || (window.SOT = {}));
