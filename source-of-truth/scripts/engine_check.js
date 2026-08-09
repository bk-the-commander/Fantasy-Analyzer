/* Runs the engine headless and prints what it found.
 *
 * The engine has no DOM dependency by design, so it can be exercised in Node
 * exactly as it will later run on a server. If this script goes quiet, the
 * product's core is broken regardless of how the interface looks.
 *
 *     node source-of-truth/scripts/engine_check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = ['model', 'seed', 'adapters', 'identity', 'policy', 'resolve', 'tasks', 'metrics', 'store'];
const root = path.join(__dirname, '..', 'src', 'core');

const sandbox = { window: {}, console };
sandbox.localStorage = undefined;
sandbox.window.localStorage = {
  getItem: () => null,
  setItem: () => {},
};
vm.createContext(sandbox);
CORE.forEach((name) => {
  vm.runInContext(fs.readFileSync(path.join(root, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
});

const SOT = sandbox.window.SOT;
const store = SOT.store.create();
const v = store.view;
const money = (n) => '$' + (n / 1e6).toFixed(2) + 'M';

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail ? '  — ' + detail : ''));
}

console.log('\n=== identity ===');
console.log(v.identity.stats);
console.log('\n=== resolution ===');
console.log({
  people: v.stats.people,
  managers: v.stats.managers,
  departments: v.stats.departments,
  territories: v.stats.territories,
  conflicts: v.stats.conflicts,
  actionable: v.stats.actionable,
  avgAlignment: v.stats.avgAlignment,
  byKind: v.stats.byKind,
  bySeverity: v.stats.bySeverity,
});
console.log('\nconflicts by field:', v.stats.byField);
console.log('org roots:', v.org.roots.map((r) => v.profiles[r].get('fullName') + ' — ' + v.profiles[r].get('jobTitle')));
console.log('tasks:', v.tasks.length, 'search rows:', v.searchIndex.length);

console.log('\n=== sample conflicts ===');
v.conflicts.slice(0, 8).forEach((c) => {
  console.log(
    '  [' + c.severity + '/' + c.kind + '] ' + c.personName + ' · ' + c.fieldLabel +
      ' → ' + JSON.stringify(c.resolvedValue) + ' (' + c.resolvedSystem + ')  vs ' +
      c.offenders.map((o) => o.systemId + '=' + JSON.stringify(o.value) + '/' + o.kind).join(', ')
  );
});

console.log('\n=== metrics ===');
v.metrics.forEach((m) => {
  console.log('  ' + m.name + ': ' + m.question);
  m.waterfall.forEach((w) => {
    const n = m.id === 'pipeline' ? money(w.value) : String(w.value);
    console.log('      ' + (w.type === 'delta' ? '  ' : '') + w.label.padEnd(42) + n);
  });
  console.log('      unexplained residual: ' + m.unexplained);
});

console.log('\n=== policy sensitivity ===');
const before = v.stats.conflicts;
store.setSystemOfRecord('territory', 'salesforce');
const after = store.view.stats.conflicts;
console.log('  territory SoR: Territory Planning → Salesforce   conflicts ' + before + ' → ' + after);
store.resetPolicy();

console.log('\n=== assertions ===');
check('every person has a display name', Object.values(v.profiles).every((p) => !!p.get('fullName')));
check('org has a single root', v.org.roots.length === 1, v.org.roots.length + ' roots');
check('people discovered by resolution only', v.stats.people >= 80 && v.stats.people <= 100, String(v.stats.people));
check('lag is separated from divergence', v.stats.byKind.lag > 0 && v.stats.byKind.divergence > 0);
check('gaps detected', v.stats.byKind.gap > 0);
check('unmatched seats queued, not invented', v.identity.stats.needsReview > 0);
check('pipeline waterfall reconciles', Math.abs(v.metrics[0].unexplained) < 1);
check('headcount waterfall reconciles', v.metrics[1].unexplained === 0, 'residual ' + v.metrics[1].unexplained);
check('policy change moves the numbers', before !== after);
check('critical findings exist', v.stats.bySeverity.critical > 0);
check('no person conflicts with themselves as manager', Object.values(v.profiles).every((p) => p.get('managerId') !== p.person.id));
check('scheduled changes are not conflicts',
  Object.values(v.profiles).some((p) => p.scheduledChanges.length > 0) &&
  !v.conflicts.some((c) => c.offenders.some((o) => o.assertion && o.assertion.scheduled)));

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
