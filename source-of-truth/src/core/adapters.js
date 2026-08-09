/* Source of Truth — source adapters.
 *
 * This is the integration seam. An adapter translates one vendor's schema into
 * two things the rest of the platform understands:
 *
 *   identity(record)   → the keys we can match a human being on
 *   assertions(record) → canonical field claims, with their timestamps
 *
 * Everything downstream — resolution, conflict detection, scoring, the whole
 * UI — is written against those two outputs and knows nothing about Workday or
 * Salesforce. Adding HubSpot or NetSuite later means writing one adapter of
 * about forty lines, not touching the engine.
 *
 * Replacing the mock data with real API calls also happens here and only here:
 * the fetch changes, the adapter's output shape does not.
 */
(function (SOT) {
  'use strict';

  // Manager fields point at another human, but each system names that human in
  // its own dialect. Adapters emit a reference; the resolver dereferences it
  // once identities exist.
  function ref(system, keyType, key) {
    return key == null ? null : { system, keyType, key };
  }

  const ADAPTERS = {
    workday: {
      system: 'workday',
      collection: 'workday',
      // Workday and the planning system record *when a fact became true*.
      // The CRM and the revenue tools only know what they hold right now.
      effectiveDating: true,
      identity: (r) => ({
        nativeId: r.workerId,
        email: r.workEmail,
        name: r.legalName,
        employeeRef: r.workerId,
        team: r.team,
        department: r.department,
        isAuthoritativeRoster: true,
        active: r.employmentStatus === 'Active',
        label: r.jobTitle,
      }),
      assertions: (r) => {
        const t = r.observedAt;
        const out = [
          { field: 'fullName', value: r.legalName, effectiveFrom: r.hireDate },
          { field: 'workEmail', value: r.workEmail, effectiveFrom: r.hireDate },
          { field: 'employeeId', value: r.workerId, effectiveFrom: r.hireDate },
          { field: 'workerType', value: r.workerType, effectiveFrom: r.hireDate },
          { field: 'employmentStatus', value: r.employmentStatus, effectiveFrom: r.terminationDate || r.hireDate },
          { field: 'startDate', value: r.hireDate, effectiveFrom: r.hireDate },
          { field: 'location', value: r.location, effectiveFrom: r.hireDate },
          { field: 'jobTitle', value: r.jobTitle, effectiveFrom: r.hireDate },
          { field: 'jobFamily', value: r.jobProfile, effectiveFrom: r.hireDate },
          { field: 'positionId', value: r.positionId, effectiveFrom: r.hireDate },
          { field: 'department', value: r.department, effectiveFrom: r.hireDate },
          { field: 'costCenter', value: r.costCenter, effectiveFrom: r.hireDate },
          { field: 'team', value: r.team, effectiveFrom: r.teamEffectiveFrom },
          { field: 'businessUnit', value: r.businessUnit, effectiveFrom: r.hireDate },
          { field: 'region', value: r.region, effectiveFrom: r.hireDate },
          { field: 'managerId', value: null, ref: ref('workday', 'employeeRef', r.managerWorkerId), effectiveFrom: r.managerEffectiveFrom },
        ];
        // Future-dated changes are recorded, not applied. A promotion that
        // starts on the first of next month is a fact about the future, and
        // reporting it as a conflict today is how these products lose trust.
        if (r.scheduledChange) {
          out.push({
            field: r.scheduledChange.field,
            value: r.scheduledChange.value,
            effectiveFrom: r.scheduledChange.effectiveFrom,
            scheduled: true,
          });
        }
        return out.map((a) => Object.assign({ observedAt: t }, a));
      },
    },

    salesforce: {
      system: 'salesforce',
      collection: 'salesforce',
      identity: (r) => ({
        nativeId: r.userId,
        email: r.email,
        name: r.name,
        employeeRef: r.employeeNumber,
        team: null,
        department: null,
        active: r.isActive,
        label: r.title,
      }),
      assertions: (r) => {
        const t = r.observedAt;
        return [
          { field: 'fullName', value: r.name },
          { field: 'workEmail', value: r.email },
          { field: 'employeeId', value: r.employeeNumber },
          { field: 'jobTitle', value: r.title },
          { field: 'positionId', value: r.positionId },
          { field: 'territory', value: r.territory },
          { field: 'segment', value: r.segment },
          { field: 'salesRole', value: r.userRoleName },
          { field: 'quota', value: r.quotaAnnual },
          { field: 'employmentStatus', value: r.isActive ? 'Active' : 'Terminated' },
          { field: 'managerId', value: null, ref: ref('salesforce', 'nativeId', r.managerUserId) },
        ].map((a) => Object.assign({ observedAt: t, effectiveFrom: t }, a));
      },
    },

    clari: {
      system: 'clari',
      collection: 'clari',
      identity: (r) => ({
        nativeId: r.userId,
        email: r.email,
        name: r.name,
        employeeRef: null,
        team: (r.forecastNode || '').split(' / ')[1] || null,
        department: r.department,
        active: true,
        label: r.forecastNode,
      }),
      assertions: (r) => {
        const t = r.observedAt;
        return [
          { field: 'fullName', value: r.name },
          { field: 'department', value: r.department },
          { field: 'team', value: (r.forecastNode || '').split(' / ')[1] || null },
          { field: 'territory', value: r.territory },
          { field: 'quota', value: r.quota },
          { field: 'managerId', value: null, ref: ref('clari', 'email', r.managerEmail) },
        ].map((a) => Object.assign({ observedAt: t, effectiveFrom: t }, a));
      },
    },

    gong: {
      system: 'gong',
      collection: 'gong',
      identity: (r) => ({
        nativeId: r.userId,
        email: r.emailAddress,
        name: r.name,
        employeeRef: null,
        team: r.teamName,
        department: null,
        active: r.active,
        label: r.title,
      }),
      assertions: (r) => {
        const t = r.observedAt;
        return [
          { field: 'fullName', value: r.name },
          { field: 'workEmail', value: r.emailAddress },
          { field: 'team', value: r.teamName === 'Unassigned' ? null : r.teamName },
          { field: 'employmentStatus', value: r.active ? 'Active' : 'Terminated' },
        ].map((a) => Object.assign({ observedAt: t, effectiveFrom: t }, a));
      },
    },

    tps: {
      system: 'tps',
      collection: 'tps',
      effectiveDating: true,
      identity: (r) => ({
        nativeId: r.assignmentId,
        email: r.assigneeEmail,
        name: r.assigneeName,
        employeeRef: null,
        team: null,
        department: null,
        active: true,
        label: r.territoryName,
      }),
      assertions: (r) => [
        { field: 'territory', value: r.territoryName, observedAt: r.observedAt, effectiveFrom: r.effectiveFrom },
        { field: 'segment', value: r.segment, observedAt: r.observedAt, effectiveFrom: r.effectiveFrom },
        { field: 'region', value: r.region, observedAt: r.observedAt, effectiveFrom: r.effectiveFrom },
      ],
    },

    tableau: {
      system: 'tableau',
      collection: 'tableau',
      identity: (r) => ({
        nativeId: r.siteUserId,
        email: r.email,
        name: r.name,
        employeeRef: null,
        team: null,
        department: null,
        active: true,
        label: r.siteRole,
      }),
      assertions: () => [],
    },
  };

  SOT.adapters = ADAPTERS;
})(window.SOT || (window.SOT = {}));
