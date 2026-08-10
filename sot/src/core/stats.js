/* SOT — statistics.
 *
 * Every entity type carries its own metrics, computed by walking the graph
 * rather than read from a warehouse table. That matters for the product's
 * central promise: if you can click from a clinician to a ward to a visit to a
 * patient and back to a different clinician, then every one of those pages has
 * to be able to answer "and how is this one doing?" without a bespoke report
 * behind it.
 *
 * A stat is a pure function of (profile, context). Adding one is a few lines;
 * it appears on every page of that entity type immediately.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  /* Helpers shared by the health stats: the graph walks that keep coming up. */
  function encountersOfStaff(id, ctx) {
    return ctx.graph.neighbours(id, 'care_team', { dir: 'in' }).map((n) => ({ enc: ctx.profiles[n.entity.id], role: n.edge.role }));
  }
  function encountersOfPatient(id, ctx) {
    return ctx.graph.neighbours(id, 'encounter_of', { dir: 'in' }).map((n) => ctx.profiles[n.entity.id]);
  }
  function encountersOfUnit(id, ctx) {
    return ctx.graph.neighbours(id, 'occurred_at', { dir: 'in' }).map((n) => ctx.profiles[n.entity.id]);
  }
  function patientOf(encId, ctx) {
    const n = ctx.graph.neighbour(encId, 'encounter_of', { dir: 'out' });
    return n ? n.entity.id : null;
  }
  function within(encs, days, asOf) {
    return encs.filter((e) => e && e.get('admitAt') && asOf - e.get('admitAt') <= days * DAY);
  }
  /** Share of visits followed by another visit for the same patient inside 30 days. */
  function readmissionRate(encs, ctx) {
    const inpatient = encs.filter((e) => e && e.get('encounterType') === 'Inpatient');
    if (!inpatient.length) return null;
    let hits = 0;
    inpatient.forEach((e) => {
      const pid = patientOf(e.entity.id, ctx);
      if (!pid) return;
      const others = encountersOfPatient(pid, ctx);
      const discharge = e.get('dischargeAt');
      if (others.some((o) => o && o.entity.id !== e.entity.id && o.get('admitAt') > discharge && o.get('admitAt') - discharge <= 30 * DAY)) hits++;
    });
    return pct(hits, inpatient.length);
  }

  const HEALTH = {
    staff: [
      { id: 'visits90', label: 'Visits attended', hint: 'Last 90 days', fmt: 'int',
        calc: (p, ctx) => within(encountersOfStaff(p.entity.id, ctx).map((x) => x.enc), 90, ctx.asOf).length },
      { id: 'patients', label: 'Patients seen', hint: 'All time, distinct', fmt: 'int', sensitivity: 'confidential',
        calc: (p, ctx) => new Set(encountersOfStaff(p.entity.id, ctx).map((x) => patientOf(x.enc.entity.id, ctx)).filter(Boolean)).size },
      { id: 'panel', label: 'Panel size', hint: 'Patients where they are primary', fmt: 'int', sensitivity: 'confidential',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'panel_of', { dir: 'in', when: 'current', at: ctx.asOf }).length },
      { id: 'units', label: 'Wards worked', hint: 'Including previous assignments', fmt: 'int',
        calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'out' }).map((n) => n.entity.id)).size },
      { id: 'avgLos', label: 'Average stay', hint: 'Inpatient visits attended', fmt: 'days',
        calc: (p, ctx) => {
          const los = encountersOfStaff(p.entity.id, ctx)
            .map((x) => x.enc).filter((e) => e && e.get('encounterType') === 'Inpatient')
            .map((e) => e.get('lengthOfDays')).filter((v) => v != null);
          return los.length ? Number(mean(los).toFixed(1)) : null;
        } },
      { id: 'readmit', label: 'Readmission rate', hint: 'Within 30 days', fmt: 'pct', invert: true,
        calc: (p, ctx) => readmissionRate(encountersOfStaff(p.entity.id, ctx).map((x) => x.enc), ctx) },
      { id: 'tenure', label: 'Tenure', hint: 'Since start date', fmt: 'years',
        calc: (p, ctx) => (p.get('hireDate') ? Number(((ctx.asOf - p.get('hireDate')) / (365 * DAY)).toFixed(1)) : null) },
    ],

    patient: [
      { id: 'visits', label: 'Visits', hint: 'All time', fmt: 'int', sensitivity: 'protected',
        calc: (p, ctx) => encountersOfPatient(p.entity.id, ctx).length },
      { id: 'visits12', label: 'Visits', hint: 'Last 12 months', fmt: 'int', sensitivity: 'protected',
        calc: (p, ctx) => within(encountersOfPatient(p.entity.id, ctx), 365, ctx.asOf).length },
      { id: 'lastVisit', label: 'Last seen', hint: 'Most recent arrival', fmt: 'date', sensitivity: 'protected',
        calc: (p, ctx) => {
          const ds = encountersOfPatient(p.entity.id, ctx).map((e) => e && e.get('admitAt')).filter(Boolean);
          return ds.length ? Math.max.apply(null, ds) : null;
        } },
      { id: 'inpatientDays', label: 'Inpatient days', hint: 'All time', fmt: 'int', sensitivity: 'protected',
        calc: (p, ctx) => encountersOfPatient(p.entity.id, ctx)
          .filter((e) => e && e.get('encounterType') === 'Inpatient')
          .reduce((s, e) => s + (e.get('lengthOfDays') || 0), 0) },
      { id: 'clinicians', label: 'Clinicians involved', hint: 'Distinct, all visits', fmt: 'int', sensitivity: 'protected',
        calc: (p, ctx) => {
          const set = new Set();
          encountersOfPatient(p.entity.id, ctx).forEach((e) =>
            e && ctx.graph.neighbours(e.entity.id, 'care_team', { dir: 'out' }).forEach((n) => set.add(n.entity.id)));
          return set.size;
        } },
      { id: 'readmit', label: 'Readmissions', hint: 'Return within 30 days', fmt: 'int', invert: true, sensitivity: 'protected',
        calc: (p, ctx) => {
          const encs = encountersOfPatient(p.entity.id, ctx).filter(Boolean).sort((a, b) => a.get('admitAt') - b.get('admitAt'));
          let n = 0;
          for (let i = 1; i < encs.length; i++) {
            const prev = encs[i - 1].get('dischargeAt');
            if (prev && encs[i].get('admitAt') - prev <= 30 * DAY && encs[i - 1].get('encounterType') === 'Inpatient') n++;
          }
          return n;
        } },
    ],

    unit: [
      { id: 'visits90', label: 'Visits', hint: 'Last 90 days', fmt: 'int',
        calc: (p, ctx) => within(encountersOfUnit(p.entity.id, ctx), 90, ctx.asOf).length },
      { id: 'staffNow', label: 'Assigned staff', hint: 'Currently rostered', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: ctx.asOf }).length },
      { id: 'staffEver', label: 'Ever assigned', hint: 'Including past staff', fmt: 'int',
        calc: (p, ctx) => new Set(ctx.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in' }).map((n) => n.entity.id)).size },
      { id: 'avgLos', label: 'Average stay', hint: 'Inpatient visits on this unit', fmt: 'days',
        calc: (p, ctx) => {
          const los = encountersOfUnit(p.entity.id, ctx)
            .filter((e) => e && e.get('encounterType') === 'Inpatient')
            .map((e) => e.get('lengthOfDays')).filter((v) => v != null);
          return los.length ? Number(mean(los).toFixed(1)) : null;
        } },
      { id: 'readmit', label: 'Readmission rate', hint: 'Within 30 days', fmt: 'pct', invert: true,
        calc: (p, ctx) => readmissionRate(encountersOfUnit(p.entity.id, ctx), ctx) },
      { id: 'perBed', label: 'Visits per bed', hint: 'Last 90 days', fmt: 'ratio',
        calc: (p, ctx) => {
          const beds = p.get('beds');
          if (!beds) return null;
          return Number((within(encountersOfUnit(p.entity.id, ctx), 90, ctx.asOf).length / beds).toFixed(1));
        } },
    ],

    facility: [
      { id: 'units', label: 'Units', hint: 'Departments here', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'part_of', { dir: 'in' }).length },
      { id: 'staff', label: 'Privileged staff', hint: 'Currently privileged', fmt: 'int',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'privileged_at', { dir: 'in', when: 'current', at: ctx.asOf }).length },
      { id: 'visits90', label: 'Visits', hint: 'Last 90 days', fmt: 'int',
        calc: (p, ctx) => {
          let n = 0;
          ctx.graph.neighbours(p.entity.id, 'part_of', { dir: 'in' }).forEach((u) => {
            n += within(encountersOfUnit(u.entity.id, ctx), 90, ctx.asOf).length;
          });
          return n;
        } },
      { id: 'beds', label: 'Licensed beds', hint: 'As registered', fmt: 'int', calc: (p) => p.get('licensedBeds') },
    ],

    encounter: [
      { id: 'los', label: 'Length of stay', hint: 'Clinical', fmt: 'days', sensitivity: 'confidential',
        calc: (p) => p.get('lengthOfDays') },
      { id: 'team', label: 'Care team', hint: 'People who touched this visit', fmt: 'int', sensitivity: 'confidential',
        calc: (p, ctx) => ctx.graph.neighbours(p.entity.id, 'care_team', { dir: 'out' }).length },
      { id: 'sinceAdmit', label: 'Time since arrival', hint: 'From admission', fmt: 'daysAgo', sensitivity: 'confidential',
        calc: (p, ctx) => (p.get('admitAt') ? Math.round((ctx.asOf - p.get('admitAt')) / DAY) : null) },
    ],
  };

  const REGISTRY = { health: HEALTH };

  function forType(packId, typeId) {
    return (REGISTRY[packId] && REGISTRY[packId][typeId]) || [];
  }

  function compute(packId, profile, ctx) {
    return forType(packId, profile.type).map((s) => {
      let value = null;
      try { value = s.calc(profile, ctx); } catch (e) { value = null; }
      return { id: s.id, label: s.label, hint: s.hint, fmt: s.fmt, invert: !!s.invert, sensitivity: s.sensitivity || 'internal', value };
    });
  }

  SOT.stats = { REGISTRY, forType, compute, register: (packId, defs) => { REGISTRY[packId] = defs; } };
})(window.SOT || (window.SOT = {}));
