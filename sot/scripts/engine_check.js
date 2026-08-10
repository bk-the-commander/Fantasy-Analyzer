/* Runs the SOT engine headless and asserts its output.
 *
 * The engine has no DOM dependency by design, so it can be exercised in Node
 * exactly as it will later run on a server. If this goes quiet, the product is
 * broken regardless of how the interface looks.
 *
 *     node sot/scripts/engine_check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'src', 'core');
const FILES = [
  'schema.js', 'graph.js', 'identity.js', 'resolve.js', 'stats.js', 'tasks.js',
  'packs/common.js', 'packs/health.js', 'packs/defense.js', 'store.js',
];

const sandbox = { window: { localStorage: { getItem: () => null, setItem: () => {} } }, console };
vm.createContext(sandbox);
FILES.forEach((f) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return;
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
});

const SOT = sandbox.window.SOT;
const store = SOT.store.create();

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail ? '  — ' + detail : ''));
}

function report(store) {
  const v = store.view;
  console.log('\n=== ' + v.pack.label + ' — ' + v.pack.tenantName + ' ===');
  console.log('identity:', v.identity.stats);
  console.log('entities by type:', v.identity.stats.byType);
  console.log('edges:', v.graph.edges.length, 'dangling:', v.graph.dangling.length);
  console.log('conflicts:', v.conflicts.length, v.summary.byKind, v.summary.bySeverity);
  console.log('tasks:', v.tasks.length, '· alignment', v.summary.alignment + '%');
  return v;
}

/* ------------------------------------------------------------ health pack */
store.signIn('exec');
let v = report(store);

console.log('\n--- a clinician, walked through the graph ---');
const staff = Object.values(v.profiles).filter((p) => p.type === 'staff');
const busiest = staff
  .map((p) => ({ p, n: v.graph.neighbours(p.entity.id, 'care_team', { dir: 'in' }).length }))
  .sort((a, b) => b.n - a.n)[0].p;
const st = store.statsFor(busiest.entity.id);
console.log('  ' + busiest.name + ' — ' + busiest.get('jobTitle') + ' (' + busiest.get('credential') + ')');
console.log('  stats: ' + st.map((s) => s.label + '=' + s.value).join(', '));
const wards = v.graph.neighbours(busiest.entity.id, 'assigned_to', { dir: 'out' });
console.log('  wards: ' + wards.map((w) => v.profiles[w.entity.id].name + (w.edge.toTs ? ' (until ' + new Date(w.edge.toTs).toISOString().slice(0, 10) + ')' : ' (current)')).join('; '));

const someVisit = v.graph.neighbours(busiest.entity.id, 'care_team', { dir: 'in' })[0];
const visit = v.profiles[someVisit.entity.id];
const pat = v.graph.neighbour(visit.entity.id, 'encounter_of', { dir: 'out' });
const team = v.graph.neighbours(visit.entity.id, 'care_team', { dir: 'out' });
console.log('  a visit: ' + visit.name + ' → patient ' + v.profiles[pat.entity.id].name);
console.log('  care team: ' + team.map((t) => v.profiles[t.entity.id].name + ' (' + t.edge.role + ')').join(', '));

const ward = v.profiles[wards[wards.length - 1].entity.id];
const now = v.graph.neighbours(ward.entity.id, 'assigned_to', { dir: 'in', when: 'current', at: v.asOf });
const past = v.graph.neighbours(ward.entity.id, 'assigned_to', { dir: 'in', when: 'past', at: v.asOf });
console.log('  ward ' + ward.name + ': ' + now.length + ' assigned now, ' + past.length + ' previously');
console.log('  ward stats: ' + store.statsFor(ward.entity.id).map((s) => s.label + '=' + s.value).join(', '));

console.log('\n--- highest severity findings ---');
v.conflicts.slice(0, 6).forEach((c) => {
  console.log('  [' + c.severity + '/' + c.kind + '] ' + c.entityName + ' · ' + c.fieldLabel +
    ' → ' + JSON.stringify(store.formatValue(c.field, c.resolvedValue)) + ' (' + c.resolvedSystem + ')  vs ' +
    c.offenders.map((o) => o.systemId + '=' + (o.kind === 'gap' ? 'empty' : JSON.stringify(o.value)) + '/' + o.kind).join(', '));
});

console.log('\n--- role scoping ---');
['exec', 'physician', 'nurse_manager', 'workforce'].forEach((r) => {
  store.setRole(r);
  const s = store.view.summary;
  console.log('  ' + r.padEnd(14) + ' staff=' + String(s.counts.staff).padStart(4) +
    ' patients=' + String(s.counts.patient).padStart(4) + ' visits=' + String(s.counts.encounter).padStart(4) +
    '  persona=' + (store.view.persona ? store.view.persona.name : '—'));
});
store.setRole('exec');

console.log('\n--- policy is a lever ---');
const before = store.view.summary.conflicts;
store.setSystemOfRecord('homeUnit', 'workday');
const after = store.view.summary.conflicts;
let moved = 0;
Object.values(store.view.profiles).forEach((p) => {
  if (p.type !== 'staff') return;
  const now2 = p.get('homeUnit');
  const was = v.profiles[p.entity.id] && v.profiles[p.entity.id].get('homeUnit');
  if (now2 !== was) moved++;
});
console.log('  home unit: UKG → Workday   findings ' + before + ' → ' + after + ', resolved answers changed for ' + moved + ' staff');
store.resetPolicy();

/* ----------------------------------------------------------- second pack */
if (store.packs.length > 1) {
  const other = store.packs.find((p) => p.id !== 'health');
  store.setPack(other.id);
  report(store);
  const t = store.view.pack.entityTypes[0];
  console.log('  sample ' + t.plural.toLowerCase() + ': ' +
    store.visible(t.id).slice(0, 3).map((p) => p.name).join(', '));
  store.setPack('health');
  store.signIn('exec');
}

/* ---------------------------------------------------------------- checks */
console.log('\n=== assertions ===');
v = store.view;
check('every entity has a name', Object.values(v.profiles).every((p) => !!p.name));
check('all five entity types resolved', v.pack.entityTypes.every((t) => v.identity.stats.byType[t.id] > 0),
  JSON.stringify(v.identity.stats.byType));
check('no dangling edges', v.graph.dangling.length === 0, v.graph.dangling.length + ' dropped');
check('edges are bidirectional', (() => {
  const e = v.graph.edges.find((x) => x.type === 'care_team');
  const fwd = v.graph.neighbours(e.from, 'care_team', { dir: 'out' }).some((n) => n.entity.id === e.to);
  const back = v.graph.neighbours(e.to, 'care_team', { dir: 'in' }).some((n) => n.entity.id === e.from);
  return fwd && back;
})());
check('historical assignments exist', v.graph.edges.some((e) => e.type === 'assigned_to' && e.toTs !== null));
check('past roster is queryable', Object.values(v.profiles).some((p) =>
  p.type === 'unit' && v.graph.neighbours(p.entity.id, 'assigned_to', { dir: 'in', when: 'past', at: v.asOf }).length > 0));
check('lag separated from divergence', v.summary.byKind.lag > 0 && v.summary.byKind.divergence > 0, JSON.stringify(v.summary.byKind));
check('gaps detected', v.summary.byKind.gap > 0);
check('critical findings exist', v.summary.bySeverity.critical > 0);
check('identity queue is populated, not guessed', v.identity.stats.needsReview > 0);
check('duplicate record detected', v.identity.entities.some((e) => e.flags.some((f) => f.kind === 'duplicate-record')));
check('staff with no HR record flagged', v.identity.entities.some((e) => e.flags.some((f) => f.kind === 'missing-system')));
check('scheduled changes are not conflicts',
  Object.values(v.profiles).some((p) => p.scheduled.length > 0) &&
  !v.conflicts.some((c) => c.offenders.some((o) => o.assertion && o.assertion.scheduled)));
check('stats compute for every type', v.pack.entityTypes.every((t) => {
  const p = Object.values(v.profiles).find((x) => x.type === t.id);
  return p && store.statsFor(p.entity.id).length > 0;
}));
check('a patient can be traced to their clinicians', (() => {
  const pt = Object.values(v.profiles).find((p) => p.type === 'patient' &&
    v.graph.neighbours(p.entity.id, 'encounter_of', { dir: 'in' }).length > 1);
  if (!pt) return false;
  const encs = v.graph.neighbours(pt.entity.id, 'encounter_of', { dir: 'in' });
  return encs.some((e) => v.graph.neighbours(e.entity.id, 'care_team', { dir: 'out' }).length > 0);
})());
check('workforce role cannot open a patient', (() => {
  store.setRole('workforce');
  const anyPatient = Object.values(store.view.profiles).find((p) => p.type === 'patient');
  const ok = !store.canOpen(anyPatient.entity.id) && store.view.summary.counts.patient === 0;
  store.setRole('exec');
  return ok;
})());
check('nurse manager sees a subset of staff', (() => {
  store.setRole('nurse_manager');
  const n = store.view.summary.counts.staff;
  const all = Object.values(store.view.profiles).filter((p) => p.type === 'staff').length;
  store.setRole('exec');
  return n > 0 && n < all;
})());
check('policy change moves resolved answers', moved > 0, moved + ' staff');

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
