/* Source of Truth — resolution policy.
 *
 * The policy is the product's opinion made editable. For each canonical field
 * it holds an ordered list of systems: the first one with a current value wins,
 * the rest become corroboration or conflict.
 *
 * Because nothing merged is ever persisted, editing this list re-answers every
 * question in the application immediately — org chart, profiles, discrepancy
 * counts, remediation tasks. That is the whole architectural bet: truth is a
 * function of policy over assertions, not a table someone wrote to.
 */
(function (SOT) {
  'use strict';

  const DEFAULT_POLICY = {
    fullName:         ['workday', 'salesforce', 'clari', 'gong'],
    workEmail:        ['workday', 'salesforce', 'gong'],
    employeeId:       ['workday', 'salesforce'],
    workerType:       ['workday'],
    employmentStatus: ['workday', 'salesforce', 'gong'],
    startDate:        ['workday'],
    location:         ['workday', 'salesforce'],

    jobTitle:         ['workday', 'salesforce'],
    jobFamily:        ['workday'],
    positionId:       ['workday', 'salesforce'],
    managerId:        ['workday', 'salesforce', 'clari'],
    department:       ['workday', 'clari'],
    costCenter:       ['workday'],
    team:             ['workday', 'clari', 'gong'],
    businessUnit:     ['workday'],
    region:           ['workday', 'tps'],

    territory:        ['tps', 'salesforce', 'clari'],
    salesRole:        ['salesforce'],
    quota:            ['salesforce', 'clari'],
    segment:          ['salesforce', 'tps'],
  };

  const RATIONALE = {
    managerId: 'Workday holds the approved supervisory organization. CRM hierarchies are edited ad hoc for visibility and routinely drift.',
    territory: 'Territory Planning owns coverage. Salesforce reflects it, but reps and admins can overwrite the field directly.',
    quota: 'Quota is contractual. Salesforce carries the signed number; Clari carries a planning figure that changes during the quarter.',
    employmentStatus: 'Termination is an HR event. Any other system claiming a terminated worker is active is an access-control problem.',
    positionId: 'Positions exist in Workday. Salesforce stores a copy that is only as good as the last integration run.',
    department: 'Workday owns the cost-bearing department. Clari forecast nodes are a reporting convenience that drifts from it.',
  };

  function clone(policy) {
    const out = {};
    Object.keys(policy).forEach((k) => { out[k] = policy[k].slice(); });
    return out;
  }

  function systemOfRecord(policy, field) {
    const order = policy[field];
    return order && order.length ? order[0] : null;
  }

  /** Move a system to the front of a field's order, keeping the rest stable. */
  function promote(policy, field, systemId) {
    const next = clone(policy);
    const order = next[field] || [];
    next[field] = [systemId].concat(order.filter((s) => s !== systemId));
    return next;
  }

  function isDefault(policy) {
    return Object.keys(DEFAULT_POLICY).every(
      (k) => (policy[k] || []).join(',') === DEFAULT_POLICY[k].join(',')
    );
  }

  function diff(policy) {
    return Object.keys(DEFAULT_POLICY)
      .filter((k) => (policy[k] || []).join(',') !== DEFAULT_POLICY[k].join(','))
      .map((k) => ({ field: k, from: DEFAULT_POLICY[k], to: policy[k] }));
  }

  SOT.policy = { DEFAULT_POLICY, RATIONALE, clone, promote, systemOfRecord, isDefault, diff };
})(window.SOT || (window.SOT = {}));
