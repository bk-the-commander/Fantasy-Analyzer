/* SOT — application store.
 *
 * Owns the small amount of state a user can change (vertical pack, role,
 * policy, task status, confirmed identity links) and re-runs the whole
 * pipeline whenever any of it moves:
 *
 *   source records → identities → assertions → policy → resolved entities
 *                                                     → graph → statistics
 *
 * The pipeline is a few milliseconds over this dataset, so the application
 * recomputes rather than maintaining caches. At real scale the same functions
 * run server-side and incrementally; the shape does not change, which is the
 * point of keeping the engine free of storage and interface concerns.
 */
(function (SOT) {
  'use strict';

  const KEY = 'kaliris.sot.v2';
  const DAY = 86400000;

  function load() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(state) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        packId: state.packId, roleId: state.roleId, policies: state.policies,
        taskStatus: state.taskStatus, forcedLinks: state.forcedLinks, dismissedKeys: state.dismissedKeys,
      }));
    } catch (e) { /* storage disabled — the app just forgets between reloads */ }
  }

  /** Values are stored raw; this is the engine-side rendering used in task text. */
  function formatValue(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (/At$|Date$|Expiry$|dob/i.test(field) && typeof value === 'number' && value > 1e11)
      return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return String(value);
  }

  function create() {
    const packs = SOT.packs;
    const saved = load() || {};

    const state = {
      packId: saved.packId && packs[saved.packId] ? saved.packId : 'health',
      roleId: saved.roleId || null,
      policies: saved.policies || {},
      taskStatus: saved.taskStatus || {},
      forcedLinks: saved.forcedLinks || [],
      dismissedKeys: saved.dismissedKeys || [],
      signedIn: false,
    };

    const prepared = {};
    function preparePack(id) {
      if (prepared[id]) return prepared[id];
      const base = packs[id];
      const built = base.build();
      const pack = Object.assign({}, base, built);
      pack.systemById = Object.fromEntries(pack.systems.map((s) => [s.id, s]));
      pack.typeById = Object.fromEntries(pack.entityTypes.map((t) => [t.id, t]));
      pack.edgeTypeById = Object.fromEntries(pack.edgeTypes.map((e) => [e.id, e]));
      pack.fieldByKey = {};
      pack.fields.forEach((f) => { pack.fieldByKey[f.entity + '.' + f.key] = f; });
      prepared[id] = pack;
      return pack;
    }

    const listeners = [];
    let view = null;

    function policyFor(pack) {
      const override = state.policies[pack.id] || {};
      const merged = {};
      Object.keys(pack.policy).forEach((k) => { merged[k] = (override[k] || pack.policy[k]).slice(); });
      return merged;
    }

    function recompute() {
      const pack = preparePack(state.packId);
      const policy = policyFor(pack);

      const identity = SOT.identity.resolveIdentities(pack, {
        forcedLinks: state.forcedLinks.filter((f) => f.pack === pack.id),
        dismissedKeys: state.dismissedKeys.filter((k) => k.indexOf(pack.id + '::') === 0).map((k) => k.split('::')[1]),
      });

      const resolution = SOT.resolve.resolveAll(pack, identity, policy, pack.asOf);
      const graph = SOT.graph.build(identity.entities, pack.edges, identity.entityIdOf);

      const ctx = { graph, profiles: resolution.profiles, asOf: pack.asOf, pack };
      const statsByEntity = {};
      Object.keys(resolution.profiles).forEach((id) => {
        statsByEntity[id] = SOT.stats.compute(pack.id, resolution.profiles[id], ctx);
      });

      const tasks = SOT.tasks.generate(pack, resolution, identity, formatValue).map((t) =>
        Object.assign({}, t, { status: state.taskStatus[pack.id + '::' + t.id] || 'open' })
      );

      const role = pack.roles.find((r) => r.id === state.roleId) || pack.roles[0];
      const persona = pickPersona(pack, resolution, graph, role);
      const scope = computeScope(pack, resolution, graph, role, persona);

      const codeIndex = {};
      Object.keys(pack.codeRefs || {}).forEach((fieldKey) => {
        const [typeId, codeField] = pack.codeRefs[fieldKey];
        Object.values(resolution.profiles).forEach((p) => {
          if (p.type !== typeId) return;
          const code = p.get(codeField);
          if (code != null) codeIndex[typeId + '|' + code] = p.entity.id;
        });
      });

      view = {
        pack, policy, identity, graph, tasks, role, persona, scope, codeIndex,
        profiles: resolution.profiles,
        conflicts: resolution.conflicts,
        stats: statsByEntity,
        asOf: pack.asOf,
        summary: summarize(pack, resolution, identity, graph, scope),
        searchIndex: buildSearchIndex(pack, resolution, graph),
      };
      return view;
    }

    /* ------------------------------------------------------------ persona */

    function pickPersona(pack, resolution, graph, role) {
      const all = Object.values(resolution.profiles).filter((p) => p.type === 'staff');
      const byTitle = (re) => all.find((p) => re.test(p.get('jobTitle') || ''));
      if (role.id === 'physician') {
        const candidates = all.filter((p) => /Hospitalist|Attending Physician/.test(p.get('jobTitle') || ''));
        return candidates.sort((a, b) =>
          graph.neighbours(b.entity.id, 'care_team', { dir: 'in' }).length -
          graph.neighbours(a.entity.id, 'care_team', { dir: 'in' }).length)[0] || null;
      }
      if (role.id === 'nurse_manager') {
        const mgrs = all.filter((p) => /Nurse Manager/.test(p.get('jobTitle') || ''));
        return mgrs.find((p) => p.get('homeUnit') === '4W') || mgrs[0] || null;
      }
      if (role.id === 'exec') return byTitle(/Chief Operating Officer/) || null;
      if (role.id === 'workforce') return byTitle(/Workforce Systems/) || null;
      if (role.id === 'compliance') return byTitle(/Identity Governance/) || null;
      return null;
    }

    /* -------------------------------------------------------------- scope
     *
     * Which entities this role may open at all. Kept as explicit id sets so
     * the interface can never accidentally leak a patient into a count, a
     * search result or a related-items list.
     */
    function computeScope(pack, resolution, graph, role, persona) {
      const allowed = {};
      const all = (type) => Object.values(resolution.profiles).filter((p) => p.type === type).map((p) => p.entity.id);

      pack.entityTypes.forEach((t) => {
        const rule = (role.scopes && role.scopes[t.id]) || 'all';
        if (rule === 'all') { allowed[t.id] = null; return; }   // null = everything
        if (rule === 'none') { allowed[t.id] = new Set(); return; }
        allowed[t.id] = new Set();
      });

      if (!persona) return { allowed, rule: role.scopes || {} };

      const unitId = (() => {
        const n = graph.neighbour(persona.entity.id, 'assigned_to', { dir: 'out', at: pack.asOf });
        return n ? n.entity.id : null;
      })();

      const scopedEncounters = new Set();
      const scopedPatients = new Set();
      const scopedStaff = new Set();

      if ((role.scopes.encounter === 'unit' || role.scopes.patient === 'unit' || role.scopes.staff === 'unit') && unitId) {
        graph.neighbours(unitId, 'occurred_at', { dir: 'in' }).forEach((n) => scopedEncounters.add(n.entity.id));
        graph.neighbours(unitId, 'assigned_to', { dir: 'in' }).forEach((n) => scopedStaff.add(n.entity.id));
        scopedStaff.add(persona.entity.id);
      }
      if (role.scopes.encounter === 'care' || role.scopes.patient === 'care') {
        graph.neighbours(persona.entity.id, 'care_team', { dir: 'in' }).forEach((n) => scopedEncounters.add(n.entity.id));
        graph.neighbours(persona.entity.id, 'panel_of', { dir: 'in' }).forEach((n) => scopedPatients.add(n.entity.id));
      }
      scopedEncounters.forEach((eid) => {
        const p = graph.neighbour(eid, 'encounter_of', { dir: 'out' });
        if (p) scopedPatients.add(p.entity.id);
      });

      if (role.scopes.staff === 'unit') allowed.staff = scopedStaff;
      if (role.scopes.encounter === 'unit' || role.scopes.encounter === 'care') allowed.encounter = scopedEncounters;
      if (role.scopes.patient === 'unit' || role.scopes.patient === 'care') allowed.patient = scopedPatients;

      return { allowed, rule: role.scopes || {}, unitId };
    }

    function canOpen(id) {
      const p = view.profiles[id];
      if (!p) return false;
      const set = view.scope.allowed[p.type];
      return set === null || set === undefined ? true : set.has(id);
    }

    function visible(type) {
      const set = view.scope.allowed[type];
      const all = Object.values(view.profiles).filter((p) => p.type === type);
      if (set === null || set === undefined) return all;
      return all.filter((p) => set.has(p.entity.id));
    }

    /* ------------------------------------------------------------ summary */

    function summarize(pack, resolution, identity, graph, scope) {
      const visibleIds = (type) => {
        const set = scope.allowed[type];
        return Object.values(resolution.profiles)
          .filter((p) => p.type === type && (set === null || set === undefined || set.has(p.entity.id)))
          .map((p) => p.entity.id);
      };
      const counts = {};
      pack.entityTypes.forEach((t) => { counts[t.id] = visibleIds(t.id).length; });

      const inScope = new Set([].concat.apply([], pack.entityTypes.map((t) => visibleIds(t.id))));
      const conflicts = resolution.conflicts.filter((c) => inScope.has(c.entityId));
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
      const byKind = { divergence: 0, lag: 0, gap: 0 };
      conflicts.forEach((c) => { bySeverity[c.severity]++; byKind[c.kind]++; });

      const profiles = Object.values(resolution.profiles).filter((p) => inScope.has(p.entity.id));
      const alignment = profiles.length ? Math.round(profiles.reduce((s, p) => s + p.alignment, 0) / profiles.length) : 100;

      return {
        counts, conflicts: conflicts.length,
        actionable: conflicts.filter((c) => c.actionable).length,
        bySeverity, byKind, alignment,
        identity: identity.stats,
        inScope,
      };
    }

    /* ------------------------------------------------------------- search */

    function buildSearchIndex(pack, resolution, graph) {
      return Object.values(resolution.profiles).map((p) => {
        const type = pack.typeById[p.type];
        const subtitle = (type.subtitle || []).map((k) => p.get(k)).filter(Boolean).join(' · ');
        const terms = [p.name, subtitle]
          .concat((type.keyFacts || []).map((k) => p.get(k)))
          .filter((v) => v != null && typeof v !== 'object')
          .join(' ')
          .toLowerCase();
        return {
          id: p.entity.id, type: p.type, typeLabel: type.label, glyph: type.glyph,
          title: p.name, subtitle, terms, href: '#/e/' + p.entity.id,
        };
      });
    }

    /* ------------------------------------------------------------ actions */

    function emit() { recompute(); save(state); listeners.forEach((fn) => fn(view)); }

    const api = {
      get state() { return state; },
      get view() { return view || recompute(); },
      packs: Object.keys(packs).map((k) => ({ id: k, label: packs[k].label, tenantName: packs[k].tenantName, tagline: packs[k].tagline })),

      subscribe(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },

      signIn(roleId) { state.roleId = roleId; state.signedIn = true; emit(); },
      signOut() { state.signedIn = false; emit(); },
      setRole(roleId) { state.roleId = roleId; emit(); },
      setPack(packId) {
        if (!packs[packId]) return;
        state.packId = packId;
        const pack = preparePack(packId);
        state.roleId = pack.roles[0].id;
        emit();
      },

      setSystemOfRecord(field, systemId) {
        const pack = view.pack;
        const cur = (state.policies[pack.id] && state.policies[pack.id][field]) || pack.policy[field] || [];
        const next = [systemId].concat(cur.filter((s) => s !== systemId));
        state.policies[pack.id] = Object.assign({}, state.policies[pack.id], { [field]: next });
        emit();
      },
      resetPolicy() { delete state.policies[view.pack.id]; emit(); },
      policyChanged() {
        const o = state.policies[view.pack.id] || {};
        return Object.keys(o).filter((k) => o[k].join(',') !== (view.pack.policy[k] || []).join(','));
      },

      setTaskStatus(id, status) { state.taskStatus[view.pack.id + '::' + id] = status; emit(); },
      bulkTaskStatus(ids, status) { ids.forEach((id) => { state.taskStatus[view.pack.id + '::' + id] = status; }); emit(); },

      confirmLink(entityId, system, nativeId) {
        const e = view.identity.entityById[entityId];
        if (!e) return;
        const anchor = e.links.find((l) => l.method === 'anchor') || e.links[0];
        state.forcedLinks.push({ pack: view.pack.id, a: anchor.system + ':' + anchor.nativeId, b: system + ':' + nativeId });
        emit();
      },
      dismissRecord(system, nativeId) { state.dismissedKeys.push(view.pack.id + '::' + system + ':' + nativeId); emit(); },

      resetAll() {
        state.policies = {}; state.taskStatus = {}; state.forcedLinks = []; state.dismissedKeys = [];
        emit();
      },

      canOpen, visible, formatValue,
      /** A coded value that points at another entity, resolved to that entity. */
      resolveCode(fieldKey, value) {
        const ref = (view.pack.codeRefs || {})[fieldKey];
        if (!ref || value == null) return null;
        const id = view.codeIndex[ref[0] + '|' + value];
        return id && canOpen(id) ? view.profiles[id] : null;
      },
      canSee: (sensitivity) => SOT.schema.canSee(api.view.role, sensitivity),
      statsFor: (id) => view.stats[id] || [],
    };

    recompute();
    return api;
  }

  SOT.store = { create, formatValue };
})(window.SOT || (window.SOT = {}));
