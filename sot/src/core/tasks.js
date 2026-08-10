/* SOT — remediation.
 *
 * A finding nobody owns is a report. Each actionable conflict becomes a
 * specific instruction — which system, which field, which value, why it
 * matters — routed to the team that can actually change it.
 *
 * Deliberately not write-back. Pushing corrections into a customer's EHR or
 * HRIS makes us liable for the state of a clinical record on day one, and no
 * hospital grants a new vendor that access anyway. Land the recommendation and
 * the audit trail first; earn write access later, if ever.
 */
(function (SOT) {
  'use strict';

  const OWNER_BY_FIELD = {
    licenseExpiry: 'Medical Staff Office',
    licenseNumber: 'Medical Staff Office',
    privilegeStatus: 'Medical Staff Office',
    credential: 'Medical Staff Office',
    npi: 'Medical Staff Office',
    employmentStatus: 'Identity Governance',
    accessStatus: 'Identity Governance',
    homeUnit: 'Workforce Operations',
    department: 'Workforce Operations',
    jobTitle: 'Workforce Operations',
    employeeId: 'Workforce Operations',
    dob: 'Health Information Management',
    mrn: 'Health Information Management',
    fullName: 'Health Information Management',
    phone: 'Patient Access',
    address: 'Patient Access',
    insurance: 'Revenue Cycle',
    lengthOfDays: 'Revenue Cycle',
    payer: 'Revenue Cycle',
    claimStatus: 'Revenue Cycle',
  };

  const OWNER_BY_ENTITY = {
    staff: 'Workforce Operations',
    patient: 'Health Information Management',
    unit: 'Workforce Operations',
    facility: 'Workforce Operations',
    encounter: 'Revenue Cycle',
  };

  function generate(pack, resolution, identity, fmtValue) {
    const sysName = (id) => pack.systemById[id].name;
    const tasks = [];

    resolution.conflicts.forEach((c) => {
      if (!c.actionable) return;
      const targets = c.offenders.filter((o) => o.kind !== 'lag').map((o) => o.systemId);
      const names = targets.map(sysName);
      const value = fmtValue(c.field, c.resolvedValue);
      tasks.push({
        id: 'T' + c.id.slice(1),
        conflictId: c.id,
        entityId: c.entityId,
        entityType: c.entityType,
        entityName: c.entityName,
        field: c.field,
        fieldLabel: c.fieldLabel,
        kind: c.kind,
        severity: c.severity,
        owner: OWNER_BY_FIELD[c.field] || OWNER_BY_ENTITY[c.entityType] || 'Data Governance',
        targets,
        title:
          (c.kind === 'gap' ? 'Populate ' : 'Correct ') + c.fieldLabel.toLowerCase() + ' in ' + names.join(' and '),
        instruction:
          (c.kind === 'gap'
            ? 'Write “' + value + '” to ' + c.fieldLabel.toLowerCase() + ' on the ' + names.join(' and ') + ' record. '
            : 'Set ' + c.fieldLabel.toLowerCase() + ' to “' + value + '” in ' + names.join(' and ') + '. ') +
          sysName(c.resolvedSystem) + ' is the system of record for this field.',
        impact: c.impact || 'Anything reading this field will disagree depending on which system it queries.',
        status: 'open',
      });
    });

    identity.unresolved.forEach((u, i) => {
      const s = u.suggestions[0];
      tasks.push({
        id: 'TID' + String(i + 1).padStart(3, '0'),
        conflictId: null,
        entityId: s ? s.entityId : null,
        entityType: u.entityType,
        entityName: u.name,
        field: 'identity',
        fieldLabel: 'Identity',
        kind: 'identity',
        severity: s ? 'medium' : 'high',
        owner: 'Identity Governance',
        targets: [u.system],
        title: s
          ? 'Confirm ' + sysName(u.system) + ' record belongs to ' + s.entityName
          : 'Identify unmatched ' + sysName(u.system) + ' record “' + u.name + '”',
        instruction: u.recommendation,
        impact: 'Until this is resolved its activity and access are attributed to nobody.',
        status: 'open',
      });
    });

    identity.entities.forEach((e) => {
      e.flags.forEach((f, i) => {
        tasks.push({
          id: 'TFL' + e.id.replace(/[^A-Za-z0-9]/g, '') + i,
          conflictId: null,
          entityId: e.id,
          entityType: e.type,
          entityName: e.displayName,
          field: 'identity',
          fieldLabel: 'Identity',
          kind: 'identity',
          severity: f.severity,
          owner: f.kind === 'duplicate-record' ? 'Health Information Management' : 'Identity Governance',
          targets: [f.system],
          title: f.label,
          instruction:
            f.kind === 'duplicate-record'
              ? 'Merge or retire the duplicate so this resolves to a single record per system.'
              : 'Confirm the engagement and create the missing record, or revoke the access it implies.',
          impact:
            f.kind === 'duplicate-record'
              ? 'A split record means half the history is invisible from either side of it.'
              : 'Access without an authoritative record sits outside joiner-mover-leaver, review and audit.',
          status: 'open',
        });
      });
    });

    const order = SOT.schema.SEVERITY_ORDER;
    tasks.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.entityName.localeCompare(b.entityName));
    return tasks;
  }

  SOT.tasks = { generate, OWNER_BY_FIELD };
})(window.SOT || (window.SOT = {}));
