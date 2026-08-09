/* Source of Truth — remediation.
 *
 * Detection alone is a report. The product converts each actionable conflict
 * into a specific instruction — which system, which field, which value, and
 * the evidence behind it — that a named team can act on and close out.
 *
 * Deliberately *not* write-back. Pushing corrections into a customer's Workday
 * makes us liable for the state of their HRIS on day one, and no buyer grants
 * that access to a new vendor anyway. Land the recommendation and the audit
 * trail first; earn write access later.
 */
(function (SOT) {
  'use strict';

  const OWNER_BY_GROUP = {
    identity: 'People Operations',
    org: 'People Operations',
    gtm: 'Revenue Operations',
  };

  function fmt(v, field) {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'quota') return '$' + Number(v).toLocaleString('en-US');
    if (field === 'managerId') return v;
    if (field === 'startDate') return new Date(v).toISOString().slice(0, 10);
    return String(v);
  }

  function describe(conflict, resolution) {
    const sysName = (id) => SOT.model.SYSTEM_BY_ID[id].name;
    const nameOf = (v) =>
      conflict.field === 'managerId' && resolution.profiles[v] ? resolution.profiles[v].person.displayName : fmt(v, conflict.field);

    const targets = conflict.offenders.filter((o) => o.kind !== 'lag');
    const targetNames = targets.map((o) => sysName(o.systemId));
    const sor = sysName(conflict.resolvedSystem);
    const value = nameOf(conflict.resolvedValue);

    if (conflict.kind === 'gap') {
      return {
        title: 'Populate ' + conflict.fieldLabel.toLowerCase() + ' in ' + targetNames.join(' and '),
        instruction:
          'Write "' + value + '" to ' + conflict.fieldLabel.toLowerCase() + ' on the ' + targetNames.join(' and ') +
          ' record. ' + sor + ' is the system of record for this field and already holds the value.',
      };
    }
    return {
      title: 'Correct ' + conflict.fieldLabel.toLowerCase() + ' in ' + targetNames.join(' and '),
      instruction:
        'Set ' + conflict.fieldLabel.toLowerCase() + ' to "' + value + '" in ' + targetNames.join(' and ') +
        '. ' + sor + ' is the system of record and reports ' +
        (conflict.field === 'managerId' ? 'this reporting line' : 'this value') + '; the other systems drifted.',
    };
  }

  function impactOf(conflict) {
    switch (conflict.field) {
      case 'employmentStatus':
        return 'Active licences and CRM access for a worker who has left. Security exposure and recoverable spend.';
      case 'territory':
        return 'Commission and quota credit route on territory. A mismatch pays the wrong rep or nobody.';
      case 'quota':
        return 'Attainment, forecast rollup and commission all read quota. The two figures cannot both be right.';
      case 'managerId':
        return 'Approvals, forecast rollup and every org-based report follow the reporting line.';
      case 'department':
        return 'Departmental rollups and cost allocation diverge from the general ledger.';
      case 'positionId':
        return 'Position ID is the join key between HR and revenue reporting. Without it, headcount reconciliation fails.';
      default:
        return 'Reports built on this field will disagree depending on which system they query.';
    }
  }

  function generate(resolution) {
    const tasks = [];
    resolution.conflicts.forEach((c) => {
      if (!c.actionable) return;
      const d = describe(c, resolution);
      tasks.push({
        id: 'T' + c.id.slice(1),
        conflictId: c.id,
        personId: c.personId,
        personName: c.personName,
        field: c.field,
        fieldLabel: c.fieldLabel,
        kind: c.kind,
        severity: c.severity,
        owner: c.field === 'employmentStatus' ? 'People Operations' : OWNER_BY_GROUP[c.group],
        targets: c.offenders.filter((o) => o.kind !== 'lag').map((o) => o.systemId),
        title: d.title,
        instruction: d.instruction,
        impact: impactOf(c),
        status: 'open',
      });
    });

    // Identity problems are remediation work too, and they outrank field-level
    // conflicts: an unmatched seat means every other answer about that person
    // is missing a source.
    resolution.identity.unresolved.forEach((u, i) => {
      tasks.push({
        id: 'TID' + String(i + 1).padStart(3, '0'),
        conflictId: null,
        personId: u.suggestions.length ? u.suggestions[0].personId : null,
        personName: u.name,
        field: 'identity',
        fieldLabel: 'Identity',
        kind: 'identity',
        severity: u.suggestions.length ? 'medium' : 'high',
        owner: 'Revenue Operations',
        targets: [u.system],
        title: u.suggestions.length
          ? 'Confirm ' + SOT.model.SYSTEM_BY_ID[u.system].name + ' seat belongs to ' + u.suggestions[0].personName
          : 'Identify unmatched ' + SOT.model.SYSTEM_BY_ID[u.system].name + ' seat "' + u.name + '"',
        instruction: u.recommendation,
        impact: 'Until this seat is resolved, its activity and cost are attributed to nobody.',
        status: 'open',
      });
    });

    resolution.identity.people.forEach((p) => {
      p.flags.forEach((f, i) => {
        tasks.push({
          id: 'TFL' + p.id.replace(/[^A-Z0-9]/gi, '') + i,
          conflictId: null,
          personId: p.id,
          personName: p.displayName,
          field: 'identity',
          fieldLabel: 'Identity',
          kind: 'identity',
          severity: f.severity,
          owner: f.kind === 'no-hr-record' ? 'People Operations' : 'Revenue Operations',
          targets: [f.system],
          title: f.label,
          instruction:
            f.kind === 'duplicate-source-record'
              ? 'Deactivate or merge the stale record so this person resolves to a single seat per system.'
              : 'Confirm engagement type and create the corresponding worker record, or revoke access.',
          impact:
            f.kind === 'duplicate-source-record'
              ? 'Duplicate seats double-count activity and can split ownership of the same accounts.'
              : 'A person with system access and no HR record sits outside offboarding, review and audit.',
          status: 'open',
        });
      });
    });

    const order = SOT.model.SEVERITY_ORDER;
    tasks.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.personName.localeCompare(b.personName));
    return tasks;
  }

  SOT.tasks = { generate, describe, impactOf, OWNER_BY_GROUP };
})(window.SOT || (window.SOT = {}));
