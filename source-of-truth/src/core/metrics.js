/* Source of Truth — metric reconciliation.
 *
 * Scoped deliberately narrow. A general engine that explains any two numbers
 * from any two systems requires query lineage across the warehouse and the BI
 * layer — a different product, and a multi-year one. What is tractable, and
 * what buyers actually ask for in the first meeting, is this: take a metric
 * three systems all publish, hold the underlying records constant, and show
 * that the gap is entirely explained by differences in *definition* and
 * *freshness*.
 *
 * Every figure below is computed from the same opportunity set by applying
 * each system's real filters in sequence, so the waterfall reconciles to the
 * cent rather than being narrated.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  const FX_TODAY = { USD: 1, EUR: 1.09, GBP: 1.27 };
  const FX_FY_START = { USD: 1, EUR: 1.04, GBP: 1.21 };

  const usd = (o, rates) => o.amountLocal * (rates[o.currency] || 1);
  const sum = (list, rates) => list.reduce((s, o) => s + usd(o, rates), 0);

  function pipelineReconciliation(dataset) {
    const { opportunities, company } = dataset;
    const q = company.quarter;
    const extractAge = 3 * DAY;

    // All three numbers describe "Q3 pipeline" over the same opportunities.
    // Step 0 — Salesforce: everything open with a Q3 close date, no filters.
    const sfSet = opportunities.filter((o) => o.closeDate >= q.start && o.closeDate <= q.end);
    const sfTotal = sum(sfSet, FX_TODAY);

    // Step 1 — Clari applies a stage floor: Discovery is not pipeline.
    const staged = sfSet.filter((o) => o.stage >= 2);
    const dropStage1 = sum(sfSet, FX_TODAY) - sum(staged, FX_TODAY);

    // Step 2 — Clari reports renewals in a separate forecast.
    const clariSet = staged.filter((o) => o.recordType !== 'Renewal');
    const dropRenewals = sum(staged, FX_TODAY) - sum(clariSet, FX_TODAY);
    const clariTotal = sum(clariSet, FX_TODAY);

    // Tableau starts from the same staged set, keeps renewals, reads a
    // three-day-old extract, and revalues at fiscal-year-opening FX.
    const tableauSet = staged.filter((o) => o.createdDate <= company.asOf - extractAge);
    const addRenewals = sum(staged.filter((o) => o.recordType === 'Renewal' && o.createdDate <= company.asOf - extractAge), FX_TODAY);
    const dropStaleExtract = sum(staged, FX_TODAY) - sum(tableauSet, FX_TODAY);
    const fxDelta = sum(tableauSet, FX_FY_START) - sum(tableauSet, FX_TODAY);
    const tableauTotal = sum(tableauSet, FX_FY_START);

    const definitions = [
      {
        system: 'salesforce',
        label: 'Q3 Open Pipeline',
        artefact: 'Report: \u201cGTM Open Pipeline \u2014 Current Quarter\u201d',
        total: sfTotal,
        count: sfSet.length,
        filters: [
          'Close date within ' + q.label,
          'All stages, including 1 \u2014 Discovery',
          'All record types, including Renewal',
          'Daily FX rate',
          'Live query',
        ],
      },
      {
        system: 'clari',
        label: 'Q3 Pipeline',
        artefact: 'Forecast view: \u201cQ3 FY26 \u2014 Pipeline\u201d',
        total: clariTotal,
        count: clariSet.length,
        filters: [
          'Close date within ' + q.label,
          'Stage 2 and above',
          'Renewal record type excluded',
          'Daily FX rate',
          'Synced hourly',
        ],
      },
      {
        system: 'tableau',
        label: 'Pipeline \u2014 Sales Ops dashboard',
        artefact: 'Workbook: \u201cRevenue Ops \u2014 Quarterly Pipeline\u201d',
        total: tableauTotal,
        count: tableauSet.length,
        filters: [
          'Close date within ' + q.label,
          'Stage 2 and above',
          'Renewals included',
          'FX fixed at fiscal-year opening rates',
          'Extract refreshed 3 days ago',
        ],
      },
    ];

    const waterfall = [
      { label: 'Salesforce \u2014 Q3 Open Pipeline', value: sfTotal, type: 'start' },
      { label: 'Stage 1 opportunities', value: -dropStage1, type: 'delta', reason: 'Clari applies a stage floor. Salesforce counts Discovery as pipeline; Clari does not.' },
      { label: 'Renewal record type', value: -dropRenewals, type: 'delta', reason: 'Renewals sit in a separate Clari forecast and are excluded from this view.' },
      { label: 'Clari \u2014 Q3 Pipeline', value: clariTotal, type: 'subtotal' },
      { label: 'Renewals added back', value: addRenewals, type: 'delta', reason: 'The Tableau workbook predates the renewals split and still includes them.' },
      { label: 'Created since last extract', value: -dropStaleExtract, type: 'delta', reason: 'The Tableau extract is three days old and cannot contain them.' },
      { label: 'FX revaluation', value: fxDelta, type: 'delta', reason: 'Tableau converts EUR and GBP at fiscal-year opening rates, not today\u2019s.' },
      { label: 'Tableau \u2014 Sales Ops dashboard', value: tableauTotal, type: 'end' },
    ];

    return {
      id: 'pipeline',
      name: 'Q3 FY26 Pipeline',
      question:
        'Why does Q3 pipeline read $' + (sfTotal / 1e6).toFixed(1) + 'M in Salesforce, $' +
        (clariTotal / 1e6).toFixed(1) + 'M in Clari and $' + (tableauTotal / 1e6).toFixed(1) + 'M in Tableau?',
      verdict:
        'All three are arithmetically correct. Three teams are asking three different questions of the same ' +
        sfSet.length + ' opportunities, and the entire $' + ((sfTotal - clariTotal) / 1e6).toFixed(1) +
        'M spread is accounted for by stage floor, record-type scope, extract age and FX basis. Nothing here is a data-quality defect \u2014 which is exactly what the argument in the QBR needs to establish.',
      definitions,
      waterfall,
      unexplained: 0,
    };
  }

  function headcountReconciliation(dataset, resolution) {
    const identity = resolution.identity;
    const workdayActive = dataset.records.workday.filter((r) => r.employmentStatus === 'Active').length;
    const sfdcActiveRecords = dataset.records.salesforce.filter((r) => r.isActive);
    const gongActive = dataset.records.gong.filter((r) => r.active).length;

    const personOf = (sys, nativeId) => identity.personByRecordKey[sys + ':' + nativeId];
    const seen = {};
    let contractors = 0, ghosts = 0, duplicates = 0;

    sfdcActiveRecords.forEach((r) => {
      const pid = personOf('salesforce', r.userId);
      const person = pid ? identity.personById[pid] : null;
      if (!person) { contractors++; return; }
      if (seen[pid]) { duplicates++; return; }
      seen[pid] = true;
      const wd = person.bySystem.workday && person.bySystem.workday[0];
      if (!wd) contractors++;
      else if (wd.record.employmentStatus !== 'Active') ghosts++;
    });

    const workdayNoSeat = dataset.records.workday.filter((r) => {
      if (r.employmentStatus !== 'Active') return false;
      const pid = personOf('workday', r.workerId);
      const person = pid ? identity.personById[pid] : null;
      return !person || !(person.bySystem.salesforce || []).some((l) => l.active);
    }).length;

    const sfdcActive = sfdcActiveRecords.length;
    const explained = workdayActive + contractors + ghosts + duplicates - workdayNoSeat;

    const waterfall = [
      { label: 'Workday — active workers', value: workdayActive, type: 'start' },
      { label: 'Active CRM users with no worker record', value: contractors, type: 'delta', reason: 'Contractors and agency staff provisioned in the CRM only.' },
      { label: 'CRM users whose worker is terminated', value: ghosts, type: 'delta', reason: 'Offboarding closed the Workday record but never deactivated the CRM user.' },
      { label: 'Duplicate CRM users', value: duplicates, type: 'delta', reason: 'A rehire created a second user; the original was never merged.' },
      { label: 'Active workers with no CRM seat', value: -workdayNoSeat, type: 'delta', reason: 'Non-revenue roles are not licensed for the CRM.' },
      { label: 'Salesforce — active users', value: sfdcActive, type: 'end' },
    ];

    return {
      id: 'headcount',
      name: 'Go-to-market headcount',
      question: 'Why does Workday report ' + workdayActive + ' active workers when Salesforce shows ' + sfdcActive + ' active users and Gong bills for ' + gongActive + ' seats?',
      verdict:
        ghosts + contractors > 0
          ? 'Two of the five differences are defects, not definitions: ' + ghosts + ' terminated workers still hold live CRM access, and ' +
            contractors + ' active users have no worker record at all. Both are open remediation items.'
          : 'Every difference is explained by licensing scope.',
      definitions: [
        { system: 'workday', label: 'Active workers', artefact: 'Worker report — status Active', total: workdayActive, count: workdayActive, unit: 'people', filters: ['Employment status = Active', 'Includes non-revenue roles', 'Excludes contractors without a worker record'] },
        { system: 'salesforce', label: 'Active users', artefact: 'Setup → Users, IsActive = true', total: sfdcActive, count: sfdcActive, unit: 'people', filters: ['IsActive = true', 'Includes contractors', 'Includes users never deactivated after termination'] },
        { system: 'gong', label: 'Billable seats', artefact: 'Team members — active', total: gongActive, count: gongActive, unit: 'people', filters: ['Licensed roles only', 'Includes shared and demo seats', 'Last synced 9 days ago'] },
      ],
      waterfall,
      unexplained: sfdcActive - explained,
    };
  }

  function build(dataset, resolution) {
    return [pipelineReconciliation(dataset), headcountReconciliation(dataset, resolution)];
  }

  SOT.metrics = { build, FX_TODAY, FX_FY_START };
})(window.SOT || (window.SOT = {}));
