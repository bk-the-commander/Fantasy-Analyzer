/* Source of Truth — application store.
 *
 * Holds the small amount of mutable state a user can change (policy, role,
 * task status, confirmed identity links) and re-runs the pipeline whenever any
 * of it changes:
 *
 *     source records → identities → assertions → policy → resolved truth
 *
 * The whole pipeline runs in a few milliseconds over this dataset, so the
 * application simply recomputes rather than maintaining caches. At real scale
 * the same functions run server-side against a warehouse, incrementally; the
 * shape of the computation does not change, which is the point of keeping the
 * engine free of UI and storage concerns.
 */
(function (SOT) {
  'use strict';

  const STORAGE_KEY = 'kaliris.sot.state.v1';

  function loadPersisted() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persist(state) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          policy: state.policy,
          roleId: state.roleId,
          taskStatus: state.taskStatus,
          forcedLinks: state.forcedLinks,
          dismissedKeys: state.dismissedKeys,
          hierarchy: state.hierarchy,
        })
      );
    } catch (e) {
      /* Private browsing, or an embedded frame with storage disabled. The app
         works fine without persistence; it just forgets between reloads. */
    }
  }

  function create() {
    const dataset = SOT.seed.build();
    const saved = loadPersisted() || {};

    const state = {
      dataset,
      policy: saved.policy || SOT.policy.clone(SOT.policy.DEFAULT_POLICY),
      roleId: saved.roleId || 'exec',
      taskStatus: saved.taskStatus || {},
      forcedLinks: saved.forcedLinks || [],
      dismissedKeys: saved.dismissedKeys || [],
      hierarchy: saved.hierarchy || dataset.hierarchy.map((h) => Object.assign({}, h)),
      signedIn: false,
    };

    const listeners = [];
    let view = null;

    function recompute() {
      const identity = SOT.identity.resolveIdentities(dataset, {
        forcedLinks: state.forcedLinks,
        dismissedKeys: state.dismissedKeys,
      });
      const resolution = SOT.resolve.resolveAll(dataset, identity, state.policy, dataset.company.asOf);
      resolution.identity = identity;

      const tasks = SOT.tasks.generate(resolution).map((t) =>
        Object.assign({}, t, { status: state.taskStatus[t.id] || 'open' })
      );
      const metrics = SOT.metrics.build(dataset, resolution);

      view = Object.assign(resolution, {
        dataset,
        tasks,
        metrics,
        searchIndex: buildSearchIndex(dataset, resolution),
        role: SOT.model.ROLES.find((r) => r.id === state.roleId),
        persona: choosePersona(resolution, state.roleId),
      });
      return view;
    }

    function emit() {
      recompute();
      persist(state);
      listeners.forEach((fn) => fn(view));
    }

    /* --------------------------------------------------------- persona ----
     * The Sales Manager role is scoped to one real person's reporting line, so
     * the permission model is demonstrable rather than described.
     */
    function choosePersona(resolution, roleId) {
      const people = Object.values(resolution.profiles);
      const find = (pred) => (people.find(pred) || {}).person;
      if (roleId === 'manager') {
        const mgr = people
          .filter((p) => /^Manager, Enterprise Sales/.test(p.get('jobTitle') || ''))
          .sort((a, b) => resolution.org.descendants(b.person.id).length - resolution.org.descendants(a.person.id).length)[0];
        return mgr ? mgr.person : null;
      }
      if (roleId === 'exec') return find((p) => (p.get('jobTitle') || '') === 'Chief Revenue Officer');
      if (roleId === 'revops') return find((p) => /Revenue Operations$/.test(p.get('jobTitle') || ''));
      return null; // People Operations is not modelled inside the GTM roster
    }

    function buildSearchIndex(dataset, resolution) {
      const rows = [];
      Object.values(resolution.profiles).forEach((p) => {
        rows.push({
          type: 'person',
          id: p.person.id,
          title: p.get('fullName') || p.person.displayName,
          subtitle: [p.get('jobTitle'), p.get('team')].filter(Boolean).join(' · '),
          meta: p.get('territory') || p.get('department') || '',
          terms: [
            p.person.displayName,
            p.get('workEmail'),
            p.get('jobTitle'),
            p.get('team'),
            p.get('department'),
            p.get('territory'),
            p.get('employeeId'),
            p.get('positionId'),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
          href: '#/person/' + p.person.id,
        });
      });

      const seenTeams = new Set();
      Object.values(resolution.profiles).forEach((p) => {
        const t = p.get('team');
        if (!t || seenTeams.has(t)) return;
        seenTeams.add(t);
        rows.push({
          type: 'team',
          id: t,
          title: t,
          subtitle: 'Team',
          meta: p.get('businessUnit') || '',
          terms: (t + ' ' + (p.get('businessUnit') || '')).toLowerCase(),
          href: '#/org?team=' + encodeURIComponent(t),
        });
      });

      Object.keys(resolution.stats.territoryCounts).forEach((t) => {
        rows.push({
          type: 'territory',
          id: t,
          title: t,
          subtitle: 'Territory · ' + resolution.stats.territoryCounts[t] + ' assigned',
          meta: '',
          terms: t.toLowerCase(),
          href: '#/org?territory=' + encodeURIComponent(t),
        });
      });

      dataset.accounts.forEach((a) => {
        rows.push({
          type: 'account',
          id: a.id,
          title: a.name,
          subtitle: 'Account · ' + a.segment,
          meta: '$' + Math.round(a.arr / 1000) + 'k ARR',
          terms: (a.name + ' ' + a.id).toLowerCase(),
          href: '#/account/' + a.id,
        });
      });

      return rows;
    }

    /* ------------------------------------------------------------ actions */

    const api = {
      get state() { return state; },
      get view() { return view || recompute(); },
      get dataset() { return dataset; },

      subscribe(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },

      signIn(roleId) { state.roleId = roleId; state.signedIn = true; emit(); },
      signOut() { state.signedIn = false; emit(); },
      setRole(roleId) { state.roleId = roleId; emit(); },

      setSystemOfRecord(field, systemId) { state.policy = SOT.policy.promote(state.policy, field, systemId); emit(); },
      setFieldOrder(field, order) { state.policy = Object.assign(SOT.policy.clone(state.policy), { [field]: order }); emit(); },
      resetPolicy() { state.policy = SOT.policy.clone(SOT.policy.DEFAULT_POLICY); emit(); },

      setTaskStatus(taskId, status) { state.taskStatus[taskId] = status; emit(); },
      bulkTaskStatus(ids, status) { ids.forEach((id) => { state.taskStatus[id] = status; }); emit(); },

      confirmLink(personId, system, nativeId) {
        const person = view.identity.personById[personId];
        if (!person) return;
        const anchor = person.links.find((l) => l.method === 'anchor') || person.links[0];
        state.forcedLinks.push({ a: anchor.system + ':' + anchor.nativeId, b: system + ':' + nativeId });
        emit();
      },
      dismissRecord(system, nativeId) {
        state.dismissedKeys.push(system + ':' + nativeId);
        emit();
      },

      renameHierarchyLevel(index, label) { state.hierarchy[index].label = label; emit(); },
      moveHierarchyLevel(index, delta) {
        const to = index + delta;
        if (to < 1 || to >= state.hierarchy.length) return; // Company stays at the root
        const [item] = state.hierarchy.splice(index, 1);
        state.hierarchy.splice(to, 0, item);
        emit();
      },
      removeHierarchyLevel(index) {
        if (index === 0 || state.hierarchy.length <= 2) return;
        state.hierarchy.splice(index, 1);
        emit();
      },
      addHierarchyLevel(level) { state.hierarchy.push(level); emit(); },

      resetAll() {
        state.policy = SOT.policy.clone(SOT.policy.DEFAULT_POLICY);
        state.taskStatus = {};
        state.forcedLinks = [];
        state.dismissedKeys = [];
        state.hierarchy = dataset.hierarchy.map((h) => Object.assign({}, h));
        emit();
      },

      /** People the signed-in role is permitted to see. */
      visiblePeople() {
        const v = api.view;
        const all = Object.values(v.profiles);
        if (v.role.scope === 'all' || !v.persona) return all;
        const allowed = new Set([v.persona.id].concat(v.org.descendants(v.persona.id)));
        return all.filter((p) => allowed.has(p.person.id));
      },

      canSee(sensitivity) { return SOT.model.canSee(api.view.role, sensitivity); },
    };

    recompute();
    return api;
  }

  SOT.store = { create };
})(window.SOT || (window.SOT = {}));
