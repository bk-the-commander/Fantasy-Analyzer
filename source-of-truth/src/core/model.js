/* Source of Truth — domain model.
 *
 * Nothing here knows about the mock dataset. This file defines *what kinds of
 * things exist*: connected systems, the canonical field catalog, the levels an
 * organization can be sliced by, and the shape of an assertion.
 *
 * The single most important idea in the product lives here: we never store a
 * merged "golden record". We store immutable per-source assertions and compute
 * the resolved value at read time from a policy. Change the policy and every
 * answer in the application changes, with no migration and no re-sync.
 */
(function (SOT) {
  'use strict';

  /* ---------------------------------------------------------------- sources */

  const SYSTEMS = [
    {
      id: 'workday',
      name: 'Workday',
      category: 'HRIS',
      color: '#0b6ba8',
      idLabel: 'Worker ID',
      deepLink: 'https://wd5.myworkday.com/cobalt/d/inst/{id}/rel-task/2998$26923.htmld',
      syncCadence: 'Nightly, 02:00 UTC',
      blurb: 'Workers, positions, supervisory organizations, effective-dated changes.',
    },
    {
      id: 'salesforce',
      name: 'Salesforce',
      category: 'CRM',
      color: '#0d9dda',
      idLabel: 'User ID',
      deepLink: 'https://cobalt.lightning.force.com/lightning/setup/ManageUsers/page?address=%2F{id}',
      syncCadence: 'Every 15 minutes',
      blurb: 'Users, role hierarchy, territories, accounts, opportunities, quotas.',
    },
    {
      id: 'clari',
      name: 'Clari',
      category: 'Revenue',
      color: '#5b3df5',
      idLabel: 'User ID',
      deepLink: 'https://app.clari.com/admin/users/{id}',
      syncCadence: 'Hourly',
      blurb: 'Forecast hierarchy, quota, commit and best-case rollups.',
    },
    {
      id: 'gong',
      name: 'Gong',
      category: 'Revenue Intelligence',
      color: '#8b2fd6',
      idLabel: 'User ID',
      deepLink: 'https://us-1234.app.gong.io/company/team-members?user={id}',
      syncCadence: 'Every 6 hours',
      blurb: 'Seats, team membership, call and activity volume.',
    },
    {
      id: 'tps',
      name: 'Territory Planning',
      category: 'Planning',
      color: '#0f766e',
      idLabel: 'Assignment ID',
      deepLink: 'https://territories.cobaltsystems.example/assignments/{id}',
      syncCadence: 'Weekly, Sunday 23:00 UTC',
      blurb: 'Territory definitions, coverage models and assignment history.',
    },
    {
      id: 'tableau',
      name: 'Tableau',
      category: 'BI',
      color: '#e8762d',
      idLabel: 'Site User',
      deepLink: 'https://tableau.cobaltsystems.example/#/users/{id}',
      syncCadence: 'Nightly, 04:00 UTC',
      blurb: 'Published dashboards, extracts and their refresh state.',
    },
  ];

  const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));

  /* ------------------------------------------------------------ field catalog
   *
   * Every canonical field a person can have. `contributors` lists the systems
   * that are *expected* to carry the field — a linked system that is expected
   * and silent produces a Gap, which is a different problem from a Divergence.
   *
   * `sensitivity` drives redaction. `weight` drives the alignment score, so a
   * wrong manager costs more than a stale office location.
   */
  const FIELDS = [
    { key: 'fullName',         label: 'Full name',         group: 'identity', contributors: ['workday', 'salesforce', 'clari', 'gong'], sensitivity: 'public',     weight: 1, tolerance: 7 },
    { key: 'workEmail',        label: 'Work email',        group: 'identity', contributors: ['workday', 'salesforce', 'gong'],          sensitivity: 'public',     weight: 2, tolerance: 7 },
    { key: 'employeeId',       label: 'Employee ID',       group: 'identity', contributors: ['workday', 'salesforce'],                  sensitivity: 'internal',   weight: 2, tolerance: 30 },
    { key: 'workerType',       label: 'Worker type',       group: 'identity', contributors: ['workday'],                                sensitivity: 'internal',   weight: 2, tolerance: 30 },
    { key: 'employmentStatus', label: 'Employment status', group: 'identity', contributors: ['workday', 'salesforce', 'gong'],          sensitivity: 'internal',   weight: 5, tolerance: 2 },
    { key: 'startDate',        label: 'Start date',        group: 'identity', contributors: ['workday'],                                sensitivity: 'internal',   weight: 1, tolerance: 30 },
    { key: 'location',         label: 'Location',          group: 'identity', contributors: ['workday'],                                sensitivity: 'public',     weight: 1, tolerance: 30 },

    { key: 'jobTitle',         label: 'Job title',         group: 'org',      contributors: ['workday', 'salesforce'],                  sensitivity: 'public',     weight: 2, tolerance: 14 },
    { key: 'jobFamily',        label: 'Job family',        group: 'org',      contributors: ['workday'],                                sensitivity: 'internal',   weight: 1, tolerance: 30 },
    { key: 'positionId',       label: 'Position ID',       group: 'org',      contributors: ['workday', 'salesforce'],                  sensitivity: 'internal',   weight: 2, tolerance: 30 },
    { key: 'managerId',        label: 'Manager',           group: 'org',      contributors: ['workday', 'salesforce', 'clari'],         sensitivity: 'internal',   weight: 4, tolerance: 3 },
    { key: 'department',       label: 'Department',        group: 'org',      contributors: ['workday', 'clari'],                       sensitivity: 'internal',   weight: 3, tolerance: 14 },
    { key: 'costCenter',       label: 'Cost center',       group: 'org',      contributors: ['workday'],                                sensitivity: 'restricted', weight: 1, tolerance: 30 },
    { key: 'team',             label: 'Team',              group: 'org',      contributors: ['workday', 'clari', 'gong'],               sensitivity: 'internal',   weight: 2, tolerance: 14 },
    { key: 'businessUnit',     label: 'Business unit',     group: 'org',      contributors: ['workday'],                                sensitivity: 'public',     weight: 2, tolerance: 30 },
    { key: 'region',           label: 'Region',            group: 'org',      contributors: ['workday', 'tps'],                         sensitivity: 'public',     weight: 2, tolerance: 14 },

    { key: 'territory',        label: 'Territory',         group: 'gtm',      contributors: ['tps', 'salesforce', 'clari'],             sensitivity: 'internal',   weight: 4, tolerance: 7 },
    { key: 'salesRole',        label: 'Salesforce role',   group: 'gtm',      contributors: ['salesforce'],                             sensitivity: 'internal',   weight: 1, tolerance: 14 },
    { key: 'quota',            label: 'Annual quota',      group: 'gtm',      contributors: ['salesforce', 'clari'],                    sensitivity: 'restricted', weight: 4, tolerance: 7 },
    { key: 'segment',          label: 'Segment',           group: 'gtm',      contributors: ['salesforce', 'tps'],                      sensitivity: 'internal',   weight: 2, tolerance: 14 },
  ];

  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  /* -------------------------------------------------------- hierarchy levels
   *
   * Deliberately data, not code. A tenant defines its own ladder; the org
   * explorer walks whatever is configured here. Two companies with completely
   * different shapes are a configuration change, not a fork.
   */
  const DEFAULT_HIERARCHY = [
    { key: 'company',      label: 'Company',       source: 'derived' },
    { key: 'businessUnit', label: 'Business Unit', source: 'workday' },
    { key: 'region',       label: 'Region',        source: 'tps' },
    { key: 'segment',      label: 'Segment',       source: 'salesforce' },
    { key: 'team',         label: 'Team',          source: 'workday' },
  ];

  /* ------------------------------------------------------------------- roles
   *
   * Role-based views. `scope` decides which people you can see at all;
   * `maxSensitivity` decides which fields are legible once you can see them.
   * In production this is enforced server-side; here it shapes the UI so the
   * permission model is visible in the demo rather than implied.
   */
  const ROLES = [
    {
      id: 'exec',
      name: 'Executive',
      persona: 'Chief Revenue Officer',
      scope: 'all',
      maxSensitivity: 'restricted',
      landing: '#/dashboard',
      blurb: 'Whole-organization rollup with drill-down into any team.',
    },
    {
      id: 'revops',
      name: 'RevOps',
      persona: 'Director, Revenue Operations',
      scope: 'all',
      maxSensitivity: 'restricted',
      landing: '#/integrity',
      blurb: 'Territory, quota, ownership and cross-system reconciliation.',
    },
    {
      id: 'hr',
      name: 'People Operations',
      persona: 'HRIS Manager',
      scope: 'all',
      maxSensitivity: 'restricted',
      landing: '#/dashboard',
      blurb: 'Workers, positions, reporting lines and organizational change.',
    },
    {
      id: 'manager',
      name: 'Sales Manager',
      persona: 'Manager, Enterprise Sales',
      scope: 'org',
      maxSensitivity: 'internal',
      landing: '#/dashboard',
      blurb: 'Their own reporting line only. Compensation data is redacted.',
    },
  ];

  const SENSITIVITY_RANK = { public: 0, internal: 1, restricted: 2 };

  function canSee(role, sensitivity) {
    return SENSITIVITY_RANK[sensitivity] <= SENSITIVITY_RANK[role.maxSensitivity];
  }

  /* ------------------------------------------------------------- assertions */

  /**
   * An assertion is one system's claim about one field of one entity at one
   * point in time. It is append-only: we never update an assertion, we record
   * a newer one. That is what makes "why did this change?" answerable later.
   *
   * observedAt    — when we read it from the source system (sync freshness)
   * effectiveFrom — when the source says the fact became true (business time)
   *
   * Keeping those apart is the difference between a product and a noise
   * generator: a promotion effective next month is not a data conflict.
   */
  function assertion(entityId, field, value, systemId, observedAt, effectiveFrom, extra) {
    return Object.assign(
      {
        entityId,
        field,
        value,
        systemId,
        observedAt,
        effectiveFrom: effectiveFrom || observedAt,
        effectiveTo: null,
      },
      extra || {}
    );
  }

  const CONFLICT_KINDS = {
    divergence: {
      label: 'Divergence',
      blurb: 'Systems that are both current disagree on the value.',
    },
    lag: {
      label: 'Lag',
      blurb: 'A system is behind. Its value was correct when it was last read.',
    },
    gap: {
      label: 'Gap',
      blurb: 'A system that should carry this field has no value for it.',
    },
  };

  const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

  SOT.model = {
    SYSTEMS,
    SYSTEM_BY_ID,
    FIELDS,
    FIELD_BY_KEY,
    DEFAULT_HIERARCHY,
    ROLES,
    SENSITIVITY_RANK,
    CONFLICT_KINDS,
    SEVERITY_ORDER,
    canSee,
    assertion,
  };
})(window.SOT || (window.SOT = {}));
