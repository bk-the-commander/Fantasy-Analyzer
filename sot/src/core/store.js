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
        audit: state.audit.slice(0, 120),
      }));
    } catch (e) { /* storage disabled — the app just forgets between reloads */ }
  }

  /** Values are stored raw; this is the engine-side rendering used in task text. */
  function formatValue(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (/At$|Date$|Expiry$|dob/i.test(field) && typeof value === 'number' && Math.abs(value) > 1e11)
      return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return String(value);
  }

  /* A little history so the log is not empty on first open. Anything the user
     does in this session is appended to the top of it. */
  function seedAudit() {
    const now = Date.now();
    const H = 3600000;
    return [
      { ts: now - 6 * H, actor: 'r.okafor@kalirislabs.example', tenant: 'health', action: 'policy.change',
        detail: 'Home unit → UKG Dimensions (was Workday)' },
      { ts: now - 27 * H, actor: 'system', tenant: 'freight', action: 'connector.degraded',
        detail: 'DOT Qualification File stopped responding' },
      { ts: now - 31 * H, actor: 'j.mensah@kalirislabs.example', tenant: 'edu', action: 'identity.confirm',
        detail: 'Campus Card credential linked to a faculty record' },
      { ts: now - 49 * H, actor: 'r.okafor@kalirislabs.example', tenant: 'wealth', action: 'tenant.provision',
        detail: 'Halyard Wealth Partners provisioned · 5 connectors' },
      { ts: now - 73 * H, actor: 'system', tenant: 'salon', action: 'sync.complete',
        detail: 'Initial load: 3,484 records across 5 connectors' },
    ];
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
      audit: saved.audit || seedAudit(),
      signedIn: false,
      owner: false,
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
    let platformCache = null;

    function audit(action, detail, tenant) {
      state.audit.unshift({ ts: Date.now(), actor: 'you', tenant: tenant || state.packId, action, detail });
      if (state.audit.length > 200) state.audit.length = 200;
    }

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

    /* --------------------------------------------------- structural roles
     *
     * The scope rules below have to work whether the pack calls its people
     * "staff", "personnel" or "drivers". Rather than hard-coding vocabulary,
     * derive the structural role of each entity type from the edges: the
     * worker type is whatever is assigned to a group over time, the client
     * type is whatever an event is about, and so on.
     */
    function shape(pack) {
      if (pack._shape) return pack._shape;
      const kind = (id) => (pack.typeById[id] || {}).kind;
      const groupType = (pack.entityTypes.find((t) => t.kind === 'group') || {}).id;
      const eventType = (pack.entityTypes.find((t) => t.kind === 'event') || {}).id;
      const assignEdge = pack.edgeTypes.find((e) => e.temporal && e.to === groupType && kind(e.from) === 'person');
      const workerType = assignEdge ? assignEdge.from : (pack.entityTypes.find((t) => t.kind === 'person') || {}).id;
      const eventWorkerEdge = pack.edgeTypes.find((e) => e.from === eventType && e.to === workerType);
      const eventClientEdge = pack.edgeTypes.find((e) => e.from === eventType && kind(e.to) === 'person' && e.to !== workerType);
      const clientType = eventClientEdge ? eventClientEdge.to : null;
      const eventGroupEdge = pack.edgeTypes.find((e) => e.from === eventType && e.to === groupType);
      const clientWorkerEdge = pack.edgeTypes.find((e) => e.from === clientType && e.to === workerType);
      pack._shape = { groupType, eventType, workerType, clientType, assignEdge, eventWorkerEdge, eventClientEdge, eventGroupEdge, clientWorkerEdge };
      return pack._shape;
    }

    /* ------------------------------------------------------------ persona */

    function pickPersona(pack, resolution, graph, role) {
      const sh = shape(pack);
      if (!sh.workerType) return null;
      const all = Object.values(resolution.profiles).filter((p) => p.type === sh.workerType);
      const rule = (pack.personaRules || {})[role.id];
      if (rule) {
        const field = rule.field || 'jobTitle';
        const re = rule.match ? new RegExp(rule.match) : (rule instanceof RegExp ? rule : new RegExp(rule));
        const matches = all.filter((p) => re.test(p.get(field) || ''));
        if (matches.length) {
          // Prefer whoever has the most attached to them — the busiest example
          // makes for the most useful demonstration of the role.
          return matches.sort((a, b) =>
            graph.edgesOf(b.entity.id).length - graph.edgesOf(a.entity.id).length)[0];
        }
      }
      return null;
    }

    /* -------------------------------------------------------------- scope
     *
     * Which entities this role may open at all, as explicit id sets so the
     * interface can never leak a record into a count, a search result or a
     * related-items list.
     *
     *   all    everything of that type
     *   none   nothing — the records are not in scope at all
     *   group  whatever hangs off the persona's current group
     *   book   whatever the persona personally handles
     */
    function computeScope(pack, resolution, graph, role, persona) {
      const sh = shape(pack);
      // Packs may phrase the same two rules in their own words.
      const norm = (r) => (r === 'unit' ? 'group' : r === 'care' ? 'book' : r || 'all');
      const scopes = {};
      Object.keys(role.scopes || {}).forEach((k) => { scopes[k] = norm(role.scopes[k]); });

      const allowed = {};
      pack.entityTypes.forEach((t) => {
        allowed[t.id] = (scopes[t.id] || 'all') === 'all' ? null : new Set();
      });
      if (!persona) return { allowed, rule: scopes };
      const groupId = sh.assignEdge
        ? (() => { const n = graph.neighbour(persona.entity.id, sh.assignEdge.id, { dir: 'out', at: pack.asOf }); return n ? n.entity.id : null; })()
        : null;

      const events = new Set();
      const clients = new Set();
      const workers = new Set([persona.entity.id]);

      const wantsGroup = Object.keys(scopes).some((k) => scopes[k] === 'group');
      if (wantsGroup && groupId) {
        if (sh.eventGroupEdge) graph.neighbours(groupId, sh.eventGroupEdge.id, { dir: 'in' }).forEach((n) => events.add(n.entity.id));
        if (sh.assignEdge) graph.neighbours(groupId, sh.assignEdge.id, { dir: 'in' }).forEach((n) => workers.add(n.entity.id));
      }
      const wantsBook = Object.keys(scopes).some((k) => scopes[k] === 'book');
      if (wantsBook) {
        if (sh.eventWorkerEdge) graph.neighbours(persona.entity.id, sh.eventWorkerEdge.id, { dir: 'in' }).forEach((n) => events.add(n.entity.id));
        if (sh.clientWorkerEdge) graph.neighbours(persona.entity.id, sh.clientWorkerEdge.id, { dir: 'in' }).forEach((n) => clients.add(n.entity.id));
      }
      if (sh.eventClientEdge) {
        events.forEach((eid) => {
          const c = graph.neighbour(eid, sh.eventClientEdge.id, { dir: 'out' });
          if (c) clients.add(c.entity.id);
        });
      }

      if (sh.workerType && (scopes[sh.workerType] === 'group' || scopes[sh.workerType] === 'book')) allowed[sh.workerType] = workers;
      if (sh.eventType && (scopes[sh.eventType] === 'group' || scopes[sh.eventType] === 'book')) allowed[sh.eventType] = events;
      if (sh.clientType && (scopes[sh.clientType] === 'group' || scopes[sh.clientType] === 'book')) allowed[sh.clientType] = clients;

      return { allowed, rule: scopes, groupId };
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

    function emit() { platformCache = null; recompute(); save(state); listeners.forEach((fn) => fn(view)); }

    /* ----------------------------------------------------------- platform
     *
     * The operator's view: every tenant on the instance, resolved through the
     * same engine. Statistics are skipped here — this is a control plane, not
     * a reporting surface, and running them for every tenant would cost more
     * than the page is worth.
     */
    function platform() {
      if (platformCache) return platformCache;
      const tenants = Object.keys(packs).map((id) => {
        const pack = preparePack(id);
        const policy = policyFor(pack);
        const identity = SOT.identity.resolveIdentities(pack, {
          forcedLinks: state.forcedLinks.filter((f) => f.pack === id),
          dismissedKeys: state.dismissedKeys.filter((k) => k.indexOf(id + '::') === 0).map((k) => k.split('::')[1]),
        });
        const resolution = SOT.resolve.resolveAll(pack, identity, policy, pack.asOf);
        const graph = SOT.graph.build(identity.entities, pack.edges, identity.entityIdOf);
        const profiles = Object.values(resolution.profiles);
        const counts = {};
        pack.entityTypes.forEach((t) => { counts[t.id] = profiles.filter((p) => p.type === t.id).length; });
        const degraded = pack.systems.filter((sy) => pack.syncState[sy.id].status !== 'healthy');
        const openTasks = SOT.tasks.generate(pack, resolution, identity, formatValue)
          .filter((t) => (state.taskStatus[id + '::' + t.id] || 'open') === 'open').length;
        return {
          id, label: pack.label, industry: pack.industry || '—', tenantName: pack.tenantName, tagline: pack.tagline,
          entities: identity.stats.entities, records: identity.stats.sourceRecords,
          edges: graph.edges.length, systems: pack.systems.length, degraded: degraded.length,
          findings: resolution.conflicts.length,
          actionable: resolution.conflicts.filter((c) => c.actionable).length,
          critical: resolution.conflicts.filter((c) => c.severity === 'critical').length,
          queue: identity.stats.needsReview, openTasks,
          alignment: profiles.length ? Math.round(profiles.reduce((a, b) => a + b.alignment, 0) / profiles.length) : 100,
          counts, entityTypes: pack.entityTypes, roles: pack.roles, fields: pack.fields.length,
          policyChanged: Object.keys(state.policies[id] || {}).length,
          syncState: pack.syncState, systemList: pack.systems, recordCounts: pack.recordCounts,
          generated: !!pack.industry && ['salon', 'edu', 'wealth', 'freight'].indexOf(id) >= 0,
        };
      });
      const totals = tenants.reduce((a, t) => ({
        entities: a.entities + t.entities, records: a.records + t.records, edges: a.edges + t.edges,
        systems: a.systems + t.systems, findings: a.findings + t.findings, queue: a.queue + t.queue,
        degraded: a.degraded + t.degraded, critical: a.critical + t.critical,
      }), { entities: 0, records: 0, edges: 0, systems: 0, findings: 0, queue: 0, degraded: 0, critical: 0 });
      platformCache = { tenants, totals };
      return platformCache;
    }

    const api = {
      get state() { return state; },
      get view() { return view || recompute(); },
      packs: Object.keys(packs).map((k) => ({ id: k, label: packs[k].label, tenantName: packs[k].tenantName, tagline: packs[k].tagline })),

      subscribe(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },

      signIn(roleId) {
        state.roleId = roleId; state.signedIn = true; state.owner = false;
        audit('session.start', 'Signed in as ' + roleId);
        emit();
      },
      signInOwner() {
        state.owner = true; state.signedIn = true;
        audit('session.start', 'Operator console opened', 'platform');
        emit();
      },
      signOut() { state.signedIn = false; state.owner = false; emit(); },
      setRole(roleId) { state.roleId = roleId; audit('session.role', 'Switched to ' + roleId); emit(); },
      platform,
      platformReady: () => !!platformCache,
      get audit() { return state.audit; },
      setPack(packId) {
        if (!packs[packId]) return;
        state.packId = packId;
        const pack = preparePack(packId);
        state.roleId = pack.roles[0].id;
        state.owner = false;
        audit('tenant.open', 'Opened ' + pack.tenantName, packId);
        emit();
      },

      setSystemOfRecord(field, systemId) {
        const pack = view.pack;
        const cur = (state.policies[pack.id] && state.policies[pack.id][field]) || pack.policy[field] || [];
        const next = [systemId].concat(cur.filter((s) => s !== systemId));
        state.policies[pack.id] = Object.assign({}, state.policies[pack.id], { [field]: next });
        audit('policy.change', field + ' → ' + pack.systemById[systemId].name);
        emit();
      },
      resetPolicy() { delete state.policies[view.pack.id]; audit('policy.reset', 'Restored default policy'); emit(); },
      policyChanged() {
        const o = state.policies[view.pack.id] || {};
        return Object.keys(o).filter((k) => o[k].join(',') !== (view.pack.policy[k] || []).join(','));
      },

      setTaskStatus(id, status) { state.taskStatus[view.pack.id + '::' + id] = status; audit('task.' + status, id); emit(); },
      bulkTaskStatus(ids, status) { ids.forEach((id) => { state.taskStatus[view.pack.id + '::' + id] = status; }); audit('task.bulk', ids.length + ' items → ' + status); emit(); },

      confirmLink(entityId, system, nativeId) {
        const e = view.identity.entityById[entityId];
        if (!e) return;
        const anchor = e.links.find((l) => l.method === 'anchor') || e.links[0];
        state.forcedLinks.push({ pack: view.pack.id, a: anchor.system + ':' + anchor.nativeId, b: system + ':' + nativeId });
        audit('identity.confirm', pack_(view).systemById[system].name + ' ' + nativeId + ' → ' + e.displayName);
        emit();
      },
      dismissRecord(system, nativeId) { state.dismissedKeys.push(view.pack.id + '::' + system + ':' + nativeId); audit('identity.dismiss', system + ' ' + nativeId); emit(); },

      resetAll() {
        state.policies = {}; state.taskStatus = {}; state.forcedLinks = []; state.dismissedKeys = [];
        audit('prototype.reset', 'All local changes cleared');
        emit();
      },

      canOpen, visible, formatValue,
      packFor: (id) => preparePack(id),
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

  const pack_ = (v) => v.pack;

  SOT.store = { create, formatValue };
})(window.SOT || (window.SOT = {}));
