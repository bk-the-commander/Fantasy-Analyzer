/* SOT — Health System vertical pack.
 *
 * Declares what exists in a hospital (staff, patients, units, facilities,
 * visits), which systems know about each of them, how they relate over time,
 * and what statistics each thing has. Then it fabricates a whole health system
 * to prove it.
 *
 * Everything is synthetic. The people, patients, medical record numbers,
 * diagnoses and visits are generated from a fixed seed and correspond to no
 * real person or organization. No live system is contacted anywhere in this
 * prototype.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  /* ------------------------------------------------------------- systems */

  const SYSTEMS = [
    { id: 'epic', name: 'Epic', category: 'EHR', deepLink: 'https://epic.stalwyn.example/hyperspace/{id}',
      syncCadence: 'Every 15 minutes', blurb: 'Charts, encounters, departments, provider records.' },
    { id: 'workday', name: 'Workday', category: 'HRIS', deepLink: 'https://wd5.myworkday.com/stalwyn/worker/{id}',
      syncCadence: 'Nightly, 02:00', blurb: 'Workers, positions, departments, employment status.' },
    { id: 'ukg', name: 'UKG Dimensions', category: 'Workforce', deepLink: 'https://stalwyn.ukg.example/people/{id}',
      syncCadence: 'Hourly', blurb: 'Scheduling, timekeeping, unit rosters, cost centres.' },
    { id: 'symplr', name: 'symplr', category: 'Credentialing', deepLink: 'https://credentialing.symplr.example/provider/{id}',
      syncCadence: 'Daily, 05:00', blurb: 'Licences, privileges, expirations, provider numbers.' },
    { id: 'waystar', name: 'Waystar', category: 'Revenue cycle', deepLink: 'https://waystar.example/accounts/{id}',
      syncCadence: 'Every 4 hours', blurb: 'Patient accounts, claims, payers, billed days.' },
    { id: 'lenel', name: 'Lenel OnGuard', category: 'Physical access', deepLink: 'https://security.stalwyn.example/badge/{id}',
      syncCadence: 'Every 30 minutes', blurb: 'Badges, door access levels, swipe history.' },
  ];

  /* -------------------------------------------------------- entity types */

  const ENTITY_TYPES = [
    { id: 'staff', label: 'Staff member', plural: 'Staff', kind: 'person', glyph: '◍',
      titleField: 'fullName', subtitle: ['jobTitle', 'credential'],
      masterSystems: ['workday'], expectedSystems: ['workday', 'epic'], requireMaster: true,
      keyFacts: ['credential', 'department', 'homeUnit', 'employmentType', 'employeeId', 'npi'] },
    { id: 'patient', label: 'Patient', plural: 'Patients', kind: 'person', glyph: '◎',
      titleField: 'fullName', subtitle: ['mrn'],
      masterSystems: ['epic'], expectedSystems: ['epic'], requireMaster: true,
      keyFacts: ['mrn', 'dob', 'sex', 'insurance', 'phone', 'patientStatus'] },
    { id: 'unit', label: 'Unit', plural: 'Units', kind: 'group', glyph: '▤',
      titleField: 'unitName', subtitle: ['unitType', 'serviceLine'],
      masterSystems: ['epic'], expectedSystems: ['epic'], requireMaster: true,
      keyFacts: ['unitCode', 'serviceLine', 'unitType', 'beds', 'costCenter'] },
    { id: 'facility', label: 'Facility', plural: 'Facilities', kind: 'place', glyph: '▣',
      titleField: 'facilityName', subtitle: ['facilityType', 'city'],
      masterSystems: ['epic'], expectedSystems: ['epic'], requireMaster: true,
      keyFacts: ['facilityCode', 'city', 'facilityType', 'licensedBeds'] },
    { id: 'encounter', label: 'Visit', plural: 'Visits', kind: 'event', glyph: '◷',
      titleField: 'encounterLabel', subtitle: ['encounterType', 'disposition'], dateField: 'admitAt',
      masterSystems: ['epic'], expectedSystems: ['epic'], requireMaster: true,
      keyFacts: ['encounterType', 'admitAt', 'dischargeAt', 'disposition', 'lengthOfDays', 'payer'] },
  ];

  /* ---------------------------------------------------------- edge types */

  const EDGE_TYPES = [
    { id: 'reports_to', label: 'Reports to', inverse: 'Direct reports', from: 'staff', to: 'staff', temporal: true },
    { id: 'assigned_to', label: 'Unit assignment', inverse: 'Staff roster', from: 'staff', to: 'unit', temporal: true },
    { id: 'privileged_at', label: 'Privileged at', inverse: 'Privileged staff', from: 'staff', to: 'facility', temporal: true },
    { id: 'part_of', label: 'Part of', inverse: 'Units', from: 'unit', to: 'facility', temporal: false },
    { id: 'encounter_of', label: 'Patient', inverse: 'Visit history', from: 'encounter', to: 'patient', temporal: false },
    { id: 'occurred_at', label: 'Unit', inverse: 'Visits', from: 'encounter', to: 'unit', temporal: false },
    { id: 'care_team', label: 'Care team', inverse: 'Visits attended', from: 'encounter', to: 'staff', temporal: false, roled: true },
    { id: 'panel_of', label: 'Primary provider', inverse: 'Patient panel', from: 'patient', to: 'staff', temporal: true },
  ];

  /* -------------------------------------------------------------- fields */

  const F = (entity, key, label, group, contributors, sensitivity, weight, tolerance, extra) =>
    Object.assign({ entity, key, label, group, contributors, sensitivity, weight, tolerance }, extra || {});

  const FIELDS = [
    // staff
    F('staff', 'fullName', 'Full name', 'identity', ['workday', 'epic', 'ukg', 'symplr', 'lenel'], 'public', 1, 7),
    F('staff', 'workEmail', 'Work email', 'identity', ['workday', 'epic'], 'public', 2, 7),
    F('staff', 'employeeId', 'Employee ID', 'identity', ['workday', 'ukg', 'lenel'], 'internal', 2, 30),
    F('staff', 'npi', 'NPI', 'identity', ['symplr', 'epic'], 'public', 3, 30,
      { impact: 'NPI is the join key between the chart and the claim. Missing it breaks provider-level reporting and billing attribution.' }),
    F('staff', 'jobTitle', 'Job title', 'role', ['workday', 'epic'], 'public', 2, 14),
    F('staff', 'credential', 'Credential', 'role', ['symplr', 'epic'], 'public', 3, 14,
      { impact: 'Credential drives what a person is permitted to do at the bedside and what the chart records them as.' }),
    F('staff', 'department', 'Department', 'role', ['workday'], 'internal', 3, 14),
    F('staff', 'homeUnit', 'Home unit', 'role', ['ukg', 'epic', 'workday'], 'internal', 4, 7,
      { impact: 'Rosters, staffing ratios and unit productivity all read the home unit. A mismatch mis-states the ward.' }),
    F('staff', 'employmentStatus', 'Employment status', 'identity', ['workday', 'epic', 'lenel'], 'internal', 5, 2,
      { impact: 'A terminated worker with live clinical access is an access-control incident, not a reporting nuisance.' }),
    F('staff', 'employmentType', 'Employment type', 'identity', ['workday'], 'internal', 2, 30),
    F('staff', 'hireDate', 'Start date', 'identity', ['workday'], 'internal', 1, 30),
    F('staff', 'licenseNumber', 'Licence number', 'credential', ['symplr'], 'internal', 3, 30),
    F('staff', 'licenseExpiry', 'Licence expires', 'credential', ['symplr'], 'internal', 5, 7,
      { impact: 'An expired licence means the person cannot legally practise. Scheduling them anyway is a regulatory finding.' }),
    F('staff', 'privilegeStatus', 'Privilege status', 'credential', ['symplr'], 'internal', 5, 7),
    F('staff', 'accessStatus', 'System access', 'access', ['epic', 'lenel'], 'internal', 4, 2),

    // patient
    F('patient', 'fullName', 'Legal name', 'identity', ['epic', 'waystar'], 'confidential', 3, 7),
    F('patient', 'mrn', 'MRN', 'identity', ['epic', 'waystar'], 'confidential', 4, 30),
    F('patient', 'dob', 'Date of birth', 'identity', ['epic', 'waystar'], 'protected', 5, 7,
      { impact: 'Date of birth is a patient-safety identifier. Two systems disagreeing is a wrong-patient risk and a claim denial.' }),
    F('patient', 'sex', 'Sex', 'identity', ['epic'], 'protected', 2, 30),
    F('patient', 'phone', 'Phone', 'contact', ['epic', 'waystar'], 'protected', 1, 14),
    F('patient', 'address', 'Address', 'contact', ['epic', 'waystar'], 'protected', 1, 14),
    F('patient', 'insurance', 'Insurance', 'coverage', ['waystar'], 'confidential', 2, 14),
    F('patient', 'patientStatus', 'Status', 'identity', ['epic'], 'confidential', 3, 7),

    // unit
    F('unit', 'unitName', 'Unit name', 'identity', ['epic', 'ukg', 'workday'], 'public', 2, 30),
    F('unit', 'unitCode', 'Unit code', 'identity', ['epic', 'ukg', 'workday'], 'public', 3, 30),
    F('unit', 'facilityCode', 'Facility', 'structure', ['epic'], 'public', 3, 30),
    F('unit', 'serviceLine', 'Service line', 'structure', ['epic'], 'public', 2, 30),
    F('unit', 'unitType', 'Unit type', 'structure', ['epic'], 'public', 1, 30),
    F('unit', 'beds', 'Staffed beds', 'structure', ['epic'], 'internal', 2, 30),
    F('unit', 'costCenter', 'Cost centre', 'structure', ['ukg', 'workday'], 'internal', 2, 30),

    // facility
    F('facility', 'facilityName', 'Facility name', 'identity', ['epic'], 'public', 2, 30),
    F('facility', 'facilityCode', 'Facility code', 'identity', ['epic'], 'public', 3, 30),
    F('facility', 'city', 'City', 'structure', ['epic'], 'public', 1, 30),
    F('facility', 'facilityType', 'Type', 'structure', ['epic'], 'public', 1, 30),
    F('facility', 'licensedBeds', 'Licensed beds', 'structure', ['epic'], 'public', 1, 30),

    // encounter
    F('encounter', 'encounterLabel', 'Visit', 'identity', ['epic'], 'confidential', 2, 30),
    F('encounter', 'encounterType', 'Visit type', 'identity', ['epic'], 'confidential', 2, 30),
    F('encounter', 'admitAt', 'Arrived', 'timing', ['epic'], 'confidential', 3, 30),
    F('encounter', 'dischargeAt', 'Departed', 'timing', ['epic'], 'confidential', 3, 30),
    F('encounter', 'disposition', 'Disposition', 'timing', ['epic'], 'confidential', 2, 30),
    F('encounter', 'lengthOfDays', 'Length of stay', 'timing', ['epic', 'waystar'], 'confidential', 4, 7,
      { impact: 'Clinical length of stay and billed days must agree or the claim is wrong in one direction or the other.' }),
    F('encounter', 'primaryDiagnosis', 'Primary diagnosis', 'clinical', ['epic'], 'protected', 3, 30),
    F('encounter', 'payer', 'Payer', 'coverage', ['waystar'], 'confidential', 2, 14),
    F('encounter', 'claimStatus', 'Claim status', 'coverage', ['waystar'], 'confidential', 2, 7),
  ];

  /* ------------------------------------------------------------- policy */

  const POLICY = {
    fullName: ['workday', 'epic', 'ukg', 'symplr', 'lenel', 'waystar'],
    workEmail: ['workday', 'epic'],
    employeeId: ['workday', 'ukg', 'lenel'],
    npi: ['symplr', 'epic'],
    jobTitle: ['workday', 'epic'],
    credential: ['symplr', 'epic'],
    department: ['workday'],
    homeUnit: ['ukg', 'epic', 'workday'],
    employmentStatus: ['workday', 'epic', 'lenel'],
    employmentType: ['workday'],
    hireDate: ['workday'],
    licenseNumber: ['symplr'],
    licenseExpiry: ['symplr'],
    privilegeStatus: ['symplr'],
    accessStatus: ['epic', 'lenel'],

    mrn: ['epic', 'waystar'],
    dob: ['epic', 'waystar'],
    sex: ['epic'],
    phone: ['epic', 'waystar'],
    address: ['epic', 'waystar'],
    insurance: ['waystar'],
    patientStatus: ['epic'],

    unitName: ['epic', 'ukg', 'workday'],
    unitCode: ['epic', 'ukg', 'workday'],
    facilityCode: ['epic'],
    serviceLine: ['epic'],
    unitType: ['epic'],
    beds: ['epic'],
    costCenter: ['workday', 'ukg'],

    facilityName: ['epic'],
    facilityCode2: ['epic'],
    city: ['epic'],
    facilityType: ['epic'],
    licensedBeds: ['epic'],

    encounterLabel: ['epic'],
    encounterType: ['epic'],
    admitAt: ['epic'],
    dischargeAt: ['epic'],
    disposition: ['epic'],
    lengthOfDays: ['epic', 'waystar'],
    primaryDiagnosis: ['epic'],
    payer: ['waystar'],
    claimStatus: ['waystar'],
  };

  const RATIONALE = {
    homeUnit: 'Scheduling owns where someone actually works this week. Workday holds the position’s department, which changes far more slowly.',
    employmentStatus: 'Termination is an HR event. Any other system claiming a terminated worker is active is an access problem, not a data problem.',
    credential: 'The credentialing system is the primary source; the EHR stores a display copy that is only as good as the last interface run.',
    dob: 'Registration in the EHR is the clinical source of truth. Billing records are keyed from it and drift when accounts are created manually.',
    lengthOfDays: 'Clinical discharge time defines the stay. Billed days are a claims construct and legitimately differ — but not silently.',
    npi: 'Provider numbers are issued and verified during credentialing. The EHR copy exists for convenience.',
  };

  /* --------------------------------------------------------------- roles */

  const ROLES = [
    { id: 'physician', name: 'Attending physician', persona: 'Hospitalist, Internal Medicine',
      maxSensitivity: 'protected', landing: '#/me',
      scopes: { staff: 'all', unit: 'all', facility: 'all', encounter: 'care', patient: 'care' },
      blurb: 'Their patients, their team, and the full clinical record for people in their care.' },
    { id: 'nurse_manager', name: 'Nurse manager', persona: 'Nurse Manager, 4 West',
      maxSensitivity: 'protected', landing: '#/me',
      scopes: { staff: 'unit', unit: 'all', facility: 'all', encounter: 'unit', patient: 'unit' },
      blurb: 'One ward: its roster, its visits and the patients currently on it.' },
    { id: 'exec', name: 'Operations executive', persona: 'Chief Operating Officer',
      maxSensitivity: 'confidential', landing: '#/dashboard',
      scopes: { staff: 'all', unit: 'all', facility: 'all', encounter: 'all', patient: 'all' },
      blurb: 'The whole system, with clinical detail redacted. Volumes, staffing and integrity.' },
    { id: 'workforce', name: 'Workforce operations', persona: 'Director, Workforce Systems',
      maxSensitivity: 'confidential', landing: '#/dashboard',
      scopes: { staff: 'all', unit: 'all', facility: 'all', encounter: 'none', patient: 'none' },
      blurb: 'Staff, credentials, rosters and access. Cannot open a patient at all.' },
    { id: 'compliance', name: 'Access & compliance', persona: 'Manager, Identity Governance',
      maxSensitivity: 'confidential', landing: '#/integrity',
      scopes: { staff: 'all', unit: 'all', facility: 'all', encounter: 'none', patient: 'none' },
      blurb: 'Who has access to what, which credentials lapsed, and which records disagree.' },
  ];

  const HIERARCHY = [
    { key: 'system', label: 'Health system', entity: null },
    { key: 'facilityCode', label: 'Facility', entity: 'unit' },
    { key: 'serviceLine', label: 'Service line', entity: 'unit' },
    { key: 'unitName', label: 'Unit', entity: 'unit' },
  ];

  /* ------------------------------------------------------------ the world */

  const FACILITIES = [
    { code: 'SARMC', name: 'St. Aldwyn Regional Medical Center', city: 'Aldwyn, OH', beds: 412, type: 'Acute care hospital' },
    { code: 'NGAC', name: 'Northgate Ambulatory Campus', city: 'Northgate, OH', beds: 0, type: 'Ambulatory campus' },
    { code: 'RVCH', name: 'Riverside Community Hospital', city: 'Riverside, OH', beds: 168, type: 'Community hospital' },
  ];

  const UNITS = [
    { code: '4W', name: '4 West Medical/Surgical', fac: 'SARMC', line: 'Medicine', beds: 32, type: 'Inpatient', nurses: 11, providers: 4 },
    { code: 'ICU', name: 'Medical Intensive Care', fac: 'SARMC', line: 'Critical Care', beds: 18, type: 'Inpatient', nurses: 10, providers: 4 },
    { code: 'ED', name: 'Emergency Department', fac: 'SARMC', line: 'Emergency', beds: 40, type: 'Emergency', nurses: 12, providers: 6 },
    { code: 'L&D', name: 'Labor & Delivery', fac: 'SARMC', line: "Women's Health", beds: 16, type: 'Inpatient', nurses: 8, providers: 3 },
    { code: 'OR', name: 'Perioperative Services', fac: 'SARMC', line: 'Surgery', beds: 14, type: 'Procedural', nurses: 9, providers: 5 },
    { code: 'ONC', name: 'Oncology Infusion', fac: 'SARMC', line: 'Oncology', beds: 20, type: 'Outpatient', nurses: 6, providers: 3 },
    { code: 'CARD', name: 'Cardiology Clinic', fac: 'NGAC', line: 'Cardiology', beds: 12, type: 'Clinic', nurses: 5, providers: 4 },
    { code: 'ORTH', name: 'Orthopedic Clinic', fac: 'NGAC', line: 'Surgery', beds: 10, type: 'Clinic', nurses: 4, providers: 3 },
    { code: 'IMG', name: 'Imaging & Radiology', fac: 'NGAC', line: 'Diagnostics', beds: 8, type: 'Procedural', nurses: 3, providers: 3 },
    { code: 'RVED', name: 'Riverside Emergency', fac: 'RVCH', line: 'Emergency', beds: 22, type: 'Emergency', nurses: 8, providers: 4 },
    { code: 'RVMS', name: 'Riverside Med/Surg', fac: 'RVCH', line: 'Medicine', beds: 26, type: 'Inpatient', nurses: 8, providers: 3 },
    { code: 'BH', name: 'Behavioral Health', fac: 'RVCH', line: 'Behavioral Health', beds: 18, type: 'Inpatient', nurses: 6, providers: 2 },
  ];

  const NURSE_TITLES = ['Registered Nurse II', 'Registered Nurse III', 'Charge Nurse', 'Clinical Nurse Specialist'];
  const PROVIDER_TITLES = ['Attending Physician', 'Hospitalist', 'Nurse Practitioner', 'Physician Assistant', 'Resident Physician'];
  const TECH_TITLES = ['Patient Care Technician', 'Radiologic Technologist', 'Surgical Technologist', 'Unit Secretary'];

  const DIAGNOSES = ['Community-acquired pneumonia','Congestive heart failure exacerbation','Acute appendicitis','Type 2 diabetes with hyperglycaemia','Chronic obstructive pulmonary disease exacerbation','Cellulitis of lower limb','Atrial fibrillation with rapid ventricular response','Acute kidney injury','Sepsis, unspecified organism','Fracture of femur','Normal spontaneous delivery','Chest pain, unspecified','Gastrointestinal haemorrhage','Ischaemic stroke','Major depressive disorder, recurrent'];
  const PAYERS = ['Meridian Health Plan', 'Statewide Medicaid', 'Federal Medicare', 'Cobalt Mutual', 'Self-pay', 'Ironclad Employee Plan'];
  const DISPOSITIONS = ['Discharged home', 'Discharged home with services', 'Transferred to skilled nursing', 'Left against medical advice', 'Admitted from ED'];

  function build(seed) {
    const rand = SOT.gen.mulberry32(seed == null ? 20260210 : seed);
    const h = SOT.gen.helpers(rand);
    const namer = SOT.gen.makeNamer(rand);
    const asOf = Date.parse('2026-02-10T14:20:00Z');

    const syncState = {
      epic: { lastSync: asOf - 9 * 60000, status: 'healthy' },
      workday: { lastSync: asOf - 11 * 3600000, status: 'healthy' },
      ukg: { lastSync: asOf - 38 * 60000, status: 'healthy' },
      symplr: { lastSync: asOf - 10 * 3600000, status: 'healthy' },
      waystar: { lastSync: asOf - 3 * 3600000, status: 'healthy' },
      lenel: { lastSync: asOf - 11 * DAY, status: 'degraded',
        message: 'Service account password expired on 30 Jan. 1,140 polls failed since.' },
    };
    const obs = (s) => syncState[s].lastSync;

    /* ---- internal roster, used only to generate records then discarded ---- */
    const staff = [];
    let sSeq = 0;
    function newStaff(spec) {
      sSeq++;
      const n = namer();
      const p = Object.assign({
        rid: 'r' + sSeq,
        name: n.full,
        email: (n.first + '.' + n.last).toLowerCase() + '@stalwyn.example',
        workerId: 'WD-2' + String(20000 + sSeq * 7).slice(-5),
        epicUserId: 'EPU' + String(41000 + sSeq * 3).slice(-5),
        ukgId: 'UKG' + String(70000 + sSeq * 11).slice(-5),
        badgeId: 'BDG-' + String(90000 + sSeq * 13).slice(-5),
        npi: null,
        status: 'Active',
        employmentType: 'Employee',
        hireDate: asOf - h.between(200, 4200) * DAY,
        terminationDate: null,
        licenseExpiry: asOf + h.between(60, 900) * DAY,
        privilege: 'Active',
        assignments: [],
      }, spec);
      staff.push(p);
      return p;
    }

    // Leadership
    const ceo = newStaff({ title: 'Chief Executive Officer', credential: 'MHA', dept: 'Administration', unit: null, kind: 'exec', managerRid: null });
    const coo = newStaff({ title: 'Chief Operating Officer', credential: 'MHA', dept: 'Administration', unit: null, kind: 'exec', managerRid: ceo.rid });
    const cno = newStaff({ title: 'Chief Nursing Officer', credential: 'RN, MSN', dept: 'Nursing Administration', unit: null, kind: 'exec', managerRid: coo.rid });
    const cmo = newStaff({ title: 'Chief Medical Officer', credential: 'MD', dept: 'Medical Staff', unit: null, kind: 'exec', managerRid: ceo.rid, npi: '1' + h.between(100000000, 999999999) });
    const workforceDir = newStaff({ title: 'Director, Workforce Systems', credential: 'SHRM-SCP', dept: 'Human Resources', unit: null, kind: 'admin', managerRid: coo.rid });
    const identityMgr = newStaff({ title: 'Manager, Identity Governance', credential: 'CISM', dept: 'Information Services', unit: null, kind: 'admin', managerRid: coo.rid });

    // Units: a nurse manager, a medical director, nurses, providers, techs
    const unitStaff = {};
    UNITS.forEach((u) => {
      const mgr = newStaff({
        title: 'Nurse Manager', credential: 'RN, BSN', dept: 'Nursing — ' + u.name, unit: u.code,
        kind: 'manager', managerRid: cno.rid, npi: '1' + h.between(100000000, 999999999),
      });
      const dir = newStaff({
        title: 'Medical Director', credential: 'MD', dept: u.line, unit: u.code, kind: 'provider',
        managerRid: cmo.rid, npi: '1' + h.between(100000000, 999999999),
      });
      const roster = { mgr, dir, nurses: [], providers: [dir], techs: [] };
      for (let i = 0; i < u.nurses; i++) {
        roster.nurses.push(newStaff({
          title: h.pick(NURSE_TITLES), credential: 'RN', dept: 'Nursing — ' + u.name, unit: u.code,
          kind: 'nurse', managerRid: mgr.rid, npi: '1' + h.between(100000000, 999999999),
        }));
      }
      for (let i = 0; i < u.providers - 1; i++) {
        const t = h.pick(PROVIDER_TITLES);
        roster.providers.push(newStaff({
          title: t, credential: t === 'Nurse Practitioner' ? 'NP' : t === 'Physician Assistant' ? 'PA-C' : 'MD',
          dept: u.line, unit: u.code, kind: 'provider', managerRid: dir.rid,
          npi: '1' + h.between(100000000, 999999999),
        }));
      }
      for (let i = 0; i < 2; i++) {
        roster.techs.push(newStaff({
          title: h.pick(TECH_TITLES), credential: 'CNA', dept: 'Nursing — ' + u.name, unit: u.code,
          kind: 'tech', managerRid: mgr.rid,
        }));
      }
      unitStaff[u.code] = roster;
    });

    const clinicalStaff = staff.filter((s) => s.unit);

    /* --------------------------------- deliberate, documented discrepancies */
    const notes = [];
    const note = (kind, who, detail) => notes.push({ kind, who, detail });

    // 1. Licence lapsed but still scheduled and still charting.
    const lapsed = h.shuffle(clinicalStaff.filter((s) => s.kind === 'nurse' || s.kind === 'provider')).slice(0, 3);
    lapsed.forEach((s) => {
      s.licenseExpiry = asOf - h.between(4, 40) * DAY;
      s.privilege = 'Expired';
      note('licence-lapsed', s.name, 'Licence expired but the person is still on the schedule and still has chart access.');
    });

    // 2. Terminated in Workday, still active in the EHR and on the door.
    const ghosts = h.shuffle(clinicalStaff.filter((s) => s.kind === 'nurse' || s.kind === 'tech')).slice(0, 2);
    ghosts.forEach((s) => {
      s.status = 'Terminated';
      s.terminationDate = asOf - h.between(20, 70) * DAY;
      s.epicStillActive = true;
      note('ghost-access', s.name, 'Terminated in Workday; Epic account and badge both still active.');
    });

    // 2b. Offboarded five days ago. The badge system has not been read since,
    //     so its disagreement is lag — it is behind, not wrong, and raising it
    //     as a defect would be noise.
    const recentlyLeft = h.shuffle(clinicalStaff.filter((s) => s.status === 'Active' && s.kind === 'tech')).slice(0, 2);
    recentlyLeft.forEach((s) => {
      s.status = 'Terminated';
      s.terminationDate = asOf - 5 * DAY;
      note('badge-lag', s.name, 'Left five days ago. Only the stalled badge connector still shows them active.');
    });

    // 3. Ward transfer four days ago: scheduling knows, HR has not caught up.
    const transferred = h.shuffle(clinicalStaff.filter((s) => s.kind === 'nurse' && s.status === 'Active')).slice(0, 5);
    transferred.forEach((s) => {
      const to = h.pick(UNITS.filter((u) => u.code !== s.unit));
      s.priorUnit = s.unit;
      s.unit = to.code;
      s.unitEffectiveFrom = asOf - 4 * DAY;
      s.workdayStillOldUnit = true;
      note('unit-transfer', s.name, 'Moved wards four days ago. Systems that have not re-read the record are behind, not wrong.');
    });

    // 4. Credential display copy in the EHR never updated after a promotion.
    const credDrift = h.shuffle(clinicalStaff.filter((s) => s.credential === 'RN')).slice(0, 6);
    credDrift.forEach((s) => {
      s.epicCredential = 'LPN';
      note('credential-drift', s.name, 'Epic still shows the credential this person held before qualifying.');
    });

    // 5. NPI missing from the EHR record.
    const npiGap = h.shuffle(clinicalStaff.filter((s) => s.npi)).slice(0, 5);
    npiGap.forEach((s) => { s.epicNoNpi = true; note('npi-gap', s.name, 'Provider number is blank on the Epic record.'); });

    // 6. Agency nurses: scheduled, badged, charting, no worker record at all.
    const agency = [];
    for (let i = 0; i < 3; i++) {
      const n = namer();
      const u = h.pick(UNITS);
      agency.push({
        name: n.full, email: (n.first + '.' + n.last).toLowerCase() + '@agency.example',
        epicUserId: 'EPU9' + String(100 + i), ukgId: 'UKG9' + String(100 + i), badgeId: 'BDG-99' + String(100 + i),
        unit: u.code, title: 'Registered Nurse (Agency)',
      });
      note('no-hr-record', n.full, 'Agency nurse with scheduling, badge and chart access but no Workday worker record.');
    }

    // 7. Future-dated leave — recorded, correctly not a conflict.
    const scheduledLeave = h.shuffle(clinicalStaff.filter((s) => s.status === 'Active')).slice(0, 3);
    scheduledLeave.forEach((s) => {
      s.scheduledStatus = { value: 'On leave', from: asOf + h.between(14, 40) * DAY };
      note('scheduled-change', s.name, 'Leave of absence begins next month. A future fact, not a discrepancy.');
    });

    /* ---------------------------------------------------------- patients */
    const patients = [];
    for (let i = 0; i < 92; i++) {
      const n = namer();
      const dob = Date.parse('1940-01-01') + Math.floor(rand() * (Date.parse('2012-01-01') - Date.parse('1940-01-01')));
      patients.push({
        rid: 'p' + i,
        mrn: 'MRN-' + String(400000 + i * 37).slice(-6),
        accountId: 'WS-' + String(880000 + i * 41).slice(-6),
        name: n.full,
        dob,
        sex: h.pick(['Female', 'Male']),
        phone: '(555) ' + h.between(200, 989) + '-' + String(h.between(1000, 9999)),
        address: h.between(12, 980) + ' ' + h.street() + ', ' + h.pick(['Aldwyn', 'Northgate', 'Riverside']) + ', OH',
        insurance: h.pick(PAYERS),
        status: 'Active',
      });
    }

    // 8. A duplicate medical record — the classic, and the expensive one.
    const dupe = patients[7];
    dupe.duplicate = { mrn: 'MRN-' + String(400000 + 9999).slice(-6), accountId: 'WS-' + String(889999).slice(-6) };
    note('duplicate-mrn', dupe.name, 'Two Epic medical record numbers share a name and date of birth. Chart is split across both.');

    // 9. Date of birth transposed in billing.
    const dobDrift = h.shuffle(patients).slice(0, 4);
    dobDrift.forEach((p) => {
      p.billingDob = p.dob + h.between(1, 3) * 365 * DAY;
      note('dob-mismatch', p.name, 'Registration and billing disagree on date of birth — a wrong-patient and claim-denial risk.');
    });

    // 10. Stale contact details in billing.
    h.shuffle(patients).slice(0, 6).forEach((p) => { p.billingPhone = '(555) ' + h.between(200, 989) + '-' + String(h.between(1000, 9999)); });

    /* -------------------------------------------------------- encounters */
    const encounters = [];
    let eSeq = 0;
    patients.forEach((p) => {
      const visits = h.between(1, 8);
      const panelUnit = h.pick(UNITS);
      for (let i = 0; i < visits; i++) {
        eSeq++;
        const u = h.chance(0.55) ? panelUnit : h.pick(UNITS);
        const roster = unitStaff[u.code];
        const admit = asOf - h.between(2, 700) * DAY - h.between(0, 20) * 3600000;
        const inpatient = u.type === 'Inpatient' || (u.type === 'Emergency' && h.chance(0.25));
        const losHours = inpatient ? h.between(20, 260) : h.between(1, 7);
        const discharge = admit + losHours * 3600000;
        if (discharge > asOf) continue;
        const attending = h.pick(roster.providers);
        const nurses = h.shuffle(roster.nurses).slice(0, h.between(1, 3));
        const tech = h.chance(0.5) ? h.pick(roster.techs) : null;
        encounters.push({
          csn: 'ENC-' + String(100000 + eSeq * 7).slice(-6),
          claimId: 'CLM-' + String(500000 + eSeq * 11).slice(-6),
          patientRid: p.rid,
          unit: u.code,
          fac: u.fac,
          type: inpatient ? 'Inpatient' : u.type === 'Emergency' ? 'Emergency' : u.type === 'Clinic' ? 'Clinic visit' : u.type === 'Procedural' ? 'Procedure' : 'Outpatient',
          admit,
          discharge,
          losDays: Math.max(1, Math.round((discharge - admit) / DAY)),
          disposition: h.pick(DISPOSITIONS),
          diagnosis: h.pick(DIAGNOSES),
          payer: p.insurance,
          claimStatus: h.pick(['Paid', 'Paid', 'Submitted', 'Denied', 'In review']),
          attendingRid: attending.rid,
          nurseRids: nurses.map((n) => n.rid),
          techRid: tech ? tech.rid : null,
        });
      }
    });

    // 11. Billed days disagree with the clinical stay.
    h.shuffle(encounters.filter((e) => e.type === 'Inpatient')).slice(0, 7).forEach((e) => {
      e.billedDays = e.losDays + h.pick([-1, 1, 2]);
      if (e.billedDays < 1) e.billedDays = e.losDays + 1;
      note('los-mismatch', e.csn, 'Clinical length of stay and billed days differ on the same visit.');
    });

    /* ----------------------------------------------------- emit records */
    const records = { epic: [], workday: [], ukg: [], symplr: [], waystar: [], lenel: [] };
    const staffByRid = Object.fromEntries(staff.map((s) => [s.rid, s]));
    const patientByRid = Object.fromEntries(patients.map((p) => [p.rid, p]));
    const unitByCode = Object.fromEntries(UNITS.map((u) => [u.code, u]));

    FACILITIES.forEach((f) =>
      records.epic.push({ _type: 'facility', facilityCode: f.code, name: f.name, city: f.city, licensedBeds: f.beds, facilityType: f.type, observedAt: obs('epic') })
    );

    UNITS.forEach((u) => {
      records.epic.push({ _type: 'unit', deptCode: u.code, deptName: u.name, facilityCode: u.fac, serviceLine: u.line, staffedBeds: u.beds, unitType: u.type, observedAt: obs('epic') });
      records.ukg.push({ _type: 'unit', costCenter: 'CC-' + u.code, unitCode: u.code, name: u.name, observedAt: obs('ukg') });
      records.workday.push({ _type: 'unit', departmentId: 'DEP-' + u.code, unitCode: u.code, name: u.name, costCenter: 'CC-' + u.code, observedAt: obs('workday') });
    });
    // 12. Scheduling and finance disagree on one cost centre.
    const ccDrift = records.ukg.find((r) => r._type === 'unit' && r.unitCode === 'ONC');
    if (ccDrift) { ccDrift.costCenter = 'CC-ONC2'; note('cost-centre', 'Oncology Infusion', 'Scheduling and finance carry different cost centres for the same unit.'); }

    staff.forEach((s) => {
      const mgr = s.managerRid ? staffByRid[s.managerRid] : null;
      records.workday.push({
        _type: 'staff', workerId: s.workerId, legalName: s.name, workEmail: s.email, jobTitle: s.title,
        department: s.dept, unitCode: s.workdayStillOldUnit ? s.priorUnit : s.unit,
        managerWorkerId: mgr ? mgr.workerId : null, employmentType: s.employmentType,
        employmentStatus: s.status, hireDate: s.hireDate, terminationDate: s.terminationDate,
        unitEffectiveFrom: s.workdayStillOldUnit ? s.hireDate : (s.unitEffectiveFrom || s.hireDate),
        scheduledChange: s.scheduledStatus ? { field: 'employmentStatus', value: s.scheduledStatus.value, effectiveFrom: s.scheduledStatus.from } : null,
        observedAt: obs('workday'),
      });

      if (s.status !== 'Terminated' || s.epicStillActive) {
        records.epic.push({
          _type: 'staff', userId: s.epicUserId, providerName: s.name, loginEmail: s.email,
          npi: s.epicNoNpi ? null : s.npi, epicTitle: s.title, credential: s.epicCredential || s.credential,
          primaryDeptCode: s.unit, employeeNumber: s.workerId, accountStatus: 'Active',
          lastChartAccess: asOf - h.between(0, 12) * DAY, observedAt: obs('epic'),
        });
      }

      if (s.unit) {
        records.ukg.push({
          _type: 'staff', personNumber: s.ukgId, displayName: s.name, employeeNumber: s.workerId,
          homeUnit: s.unit, homeCostCenter: 'CC-' + s.unit, jobCode: s.title, badgeId: s.badgeId,
          employmentStatus: s.status === 'Terminated' ? 'Inactive' : 'Active',
          scheduledHours: h.between(24, 40), observedAt: obs('ukg'),
        });
      }

      if (s.npi || s.credential === 'RN' || s.kind === 'provider' || s.kind === 'nurse' || s.kind === 'manager') {
        records.symplr.push({
          _type: 'staff', providerId: 'CR-' + String(7000 + parseInt(s.rid.slice(1), 10)), name: s.name,
          employeeNumber: s.workerId, npi: s.npi, credential: s.credential, licenseNumber: 'L' + h.between(100000, 999999),
          licenseExpiry: s.licenseExpiry, privilegeStatus: s.privilege,
          primaryFacility: s.unit ? unitByCode[s.unit].fac : 'SARMC', observedAt: obs('symplr'),
        });
      }

      records.lenel.push({
        _type: 'staff', badgeId: s.badgeId, holderName: s.name, employeeNumber: s.workerId,
        accessLevel: s.kind === 'exec' ? 'All areas' : s.unit ? unitByCode[s.unit].fac + ' — clinical' : 'Administration',
        badgeStatus: 'Active', lastSwipe: asOf - h.between(0, 26) * DAY, observedAt: obs('lenel'),
      });
    });

    agency.forEach((a) => {
      records.epic.push({ _type: 'staff', userId: a.epicUserId, providerName: a.name, loginEmail: a.email, npi: null,
        epicTitle: a.title, credential: 'RN', primaryDeptCode: a.unit, employeeNumber: null, accountStatus: 'Active',
        lastChartAccess: asOf - h.between(0, 4) * DAY, observedAt: obs('epic') });
      records.ukg.push({ _type: 'staff', personNumber: a.ukgId, displayName: a.name, employeeNumber: null,
        homeUnit: a.unit, homeCostCenter: 'CC-' + a.unit, jobCode: a.title, badgeId: a.badgeId,
        employmentStatus: 'Active', scheduledHours: 36, observedAt: obs('ukg') });
      records.lenel.push({ _type: 'staff', badgeId: a.badgeId, holderName: a.name, employeeNumber: null,
        accessLevel: unitByCode[a.unit].fac + ' — clinical', badgeStatus: 'Active',
        lastSwipe: asOf - h.between(0, 3) * DAY, observedAt: obs('lenel') });
    });

    // 12b. A rehire with two chart logins, both carrying the same worker
    //      number, so both resolve to one person and the duplicate surfaces.
    const rehire = clinicalStaff.find((s) => s.kind === 'provider' && s.status === 'Active' && !s.epicNoNpi);
    if (rehire) {
      records.epic.push({ _type: 'staff', userId: rehire.epicUserId + 'X', providerName: rehire.name,
        loginEmail: rehire.email.replace('@', '.prior@'), npi: rehire.npi, epicTitle: rehire.title,
        credential: rehire.credential, primaryDeptCode: rehire.unit, employeeNumber: rehire.workerId,
        accountStatus: 'Active', lastChartAccess: asOf - h.between(300, 700) * DAY, observedAt: obs('epic') });
      note('duplicate-account', rehire.name, 'Two active Epic logins share this worker number after a rehire.');
    }

    // 13. An orphaned shared login nobody owns.
    records.epic.push({ _type: 'staff', userId: 'EPU00099', providerName: 'ED Training Account', loginEmail: 'ed.training@stalwyn.example',
      npi: null, epicTitle: null, credential: null, primaryDeptCode: 'ED', employeeNumber: null,
      accountStatus: 'Active', lastChartAccess: asOf - 3 * DAY, observedAt: obs('epic') });
    note('orphan-account', 'ED Training Account', 'Shared Epic login with chart access and no owner.');

    patients.forEach((p) => {
      records.epic.push({ _type: 'patient', mrn: p.mrn, legalName: p.name, dob: p.dob, sex: p.sex,
        phone: p.phone, addressLine: p.address, patientStatus: p.status, observedAt: obs('epic') });
      records.waystar.push({ _type: 'patient', accountId: p.accountId, mrnRef: p.mrn, patientName: p.name,
        dateOfBirth: p.billingDob || p.dob, phone: p.billingPhone || p.phone, addressLine: p.address,
        insurancePlan: p.insurance, observedAt: obs('waystar') });
      if (p.duplicate) {
        records.epic.push({ _type: 'patient', mrn: p.duplicate.mrn, legalName: p.name, dob: p.dob, sex: p.sex,
          phone: p.phone, addressLine: p.address, patientStatus: 'Active', observedAt: obs('epic') });
      }
    });

    encounters.forEach((e) => {
      const p = patientByRid[e.patientRid];
      records.epic.push({ _type: 'encounter', csn: e.csn, patientMrn: p.mrn, deptCode: e.unit, facilityCode: e.fac,
        encounterType: e.type, admitAt: e.admit, dischargeAt: e.discharge, disposition: e.disposition,
        primaryDiagnosis: e.diagnosis, lengthOfDays: e.losDays, observedAt: obs('epic') });
      records.waystar.push({ _type: 'encounter', claimId: e.claimId, csnRef: e.csn, billedDays: e.billedDays || e.losDays,
        payer: e.payer, claimStatus: e.claimStatus, totalCharges: e.losDays * h.between(1800, 6400), observedAt: obs('waystar') });
    });

    /* ---------------------------------------------------------- the edges */
    const edges = [];
    const staffRef = (s) => ({ type: 'staff', sys: 'workday', id: s.workerId });
    const unitRef = (code) => ({ type: 'unit', sys: 'epic', id: code });
    const facRef = (code) => ({ type: 'facility', sys: 'epic', id: code });

    staff.forEach((s) => {
      if (s.managerRid) {
        edges.push({ type: 'reports_to', from: staffRef(s), to: staffRef(staffByRid[s.managerRid]),
          fromTs: s.hireDate, toTs: s.terminationDate, systemId: 'workday' });
      }
      if (s.unit) {
        // Prior wards are kept as closed intervals — this is what makes
        // "who used to work here" answerable at all.
        if (s.priorUnit) {
          edges.push({ type: 'assigned_to', from: staffRef(s), to: unitRef(s.priorUnit),
            fromTs: s.hireDate, toTs: s.unitEffectiveFrom, role: s.title, systemId: 'ukg' });
          edges.push({ type: 'assigned_to', from: staffRef(s), to: unitRef(s.unit),
            fromTs: s.unitEffectiveFrom, toTs: s.terminationDate, role: s.title, systemId: 'ukg' });
        } else {
          const rotated = h.chance(0.3);
          if (rotated) {
            const prior = h.pick(UNITS.filter((u) => u.code !== s.unit));
            const switchedAt = s.hireDate + Math.floor((asOf - s.hireDate) * (0.3 + rand() * 0.4));
            edges.push({ type: 'assigned_to', from: staffRef(s), to: unitRef(prior.code),
              fromTs: s.hireDate, toTs: switchedAt, role: s.title, systemId: 'ukg' });
            edges.push({ type: 'assigned_to', from: staffRef(s), to: unitRef(s.unit),
              fromTs: switchedAt, toTs: s.terminationDate, role: s.title, systemId: 'ukg' });
          } else {
            edges.push({ type: 'assigned_to', from: staffRef(s), to: unitRef(s.unit),
              fromTs: s.hireDate, toTs: s.terminationDate, role: s.title, systemId: 'ukg' });
          }
        }
        edges.push({ type: 'privileged_at', from: staffRef(s), to: facRef(unitByCode[s.unit].fac),
          fromTs: s.hireDate, toTs: s.privilege === 'Expired' ? s.licenseExpiry : s.terminationDate, systemId: 'symplr' });
      }
    });

    UNITS.forEach((u) => edges.push({ type: 'part_of', from: unitRef(u.code), to: facRef(u.fac), fromTs: null, toTs: null, systemId: 'epic' }));

    encounters.forEach((e) => {
      const encRef = { type: 'encounter', sys: 'epic', id: e.csn };
      edges.push({ type: 'encounter_of', from: encRef, to: { type: 'patient', sys: 'epic', id: patientByRid[e.patientRid].mrn }, systemId: 'epic' });
      edges.push({ type: 'occurred_at', from: encRef, to: unitRef(e.unit), systemId: 'epic' });
      edges.push({ type: 'care_team', from: encRef, to: staffRef(staffByRid[e.attendingRid]), role: 'Attending', systemId: 'epic' });
      e.nurseRids.forEach((rid) => edges.push({ type: 'care_team', from: encRef, to: staffRef(staffByRid[rid]), role: 'Nurse', systemId: 'epic' }));
      if (e.techRid) edges.push({ type: 'care_team', from: encRef, to: staffRef(staffByRid[e.techRid]), role: 'Technician', systemId: 'epic' });
    });

    // Primary care panels, including who the provider used to be.
    patients.forEach((p, i) => {
      const u = UNITS[i % UNITS.length];
      const providers = unitStaff[u.code].providers;
      const current = providers[i % providers.length];
      const pRef = { type: 'patient', sys: 'epic', id: p.mrn };
      if (h.chance(0.35) && providers.length > 1) {
        const previous = providers[(i + 1) % providers.length];
        const changed = asOf - h.between(60, 500) * DAY;
        edges.push({ type: 'panel_of', from: pRef, to: staffRef(previous), fromTs: changed - 700 * DAY, toTs: changed, systemId: 'epic' });
        edges.push({ type: 'panel_of', from: pRef, to: staffRef(current), fromTs: changed, toTs: null, systemId: 'epic' });
      } else {
        edges.push({ type: 'panel_of', from: pRef, to: staffRef(current), fromTs: asOf - h.between(200, 1400) * DAY, toTs: null, systemId: 'epic' });
      }
    });

    const recordCounts = {
      epic: records.epic.length + encounters.length * 12,
      workday: records.workday.length * 3,
      ukg: records.ukg.length * 26,
      symplr: records.symplr.length * 4,
      waystar: records.waystar.length * 3,
      lenel: records.lenel.length * 180,
    };

    return { records, edges, syncState, recordCounts, notes, asOf };
  }

  /* ------------------------------------------------------------ adapters */

  const N = () => SOT.schema.norm;

  const ADAPTERS = {
    epic: {
      collection: 'epic', effectiveDating: false,
      identity: (r) => {
        if (r._type === 'staff') return { nativeId: r.userId, name: r.providerName, detail: r.epicTitle || 'No title',
          active: r.accountStatus === 'Active', keys: { email: r.loginEmail, employeeId: r.employeeNumber, npi: r.npi, name: N().name(r.providerName) } };
        if (r._type === 'patient') return { nativeId: r.mrn, name: r.legalName, detail: 'MRN ' + r.mrn, active: true,
          keys: { mrn: r.mrn, nameDob: N().name(r.legalName) + '|' + r.dob } };
        if (r._type === 'unit') return { nativeId: r.deptCode, name: r.deptName, detail: r.serviceLine, active: true, keys: { code: r.deptCode } };
        if (r._type === 'facility') return { nativeId: r.facilityCode, name: r.name, detail: r.city, active: true, keys: { code: r.facilityCode } };
        if (r._type === 'encounter') return { nativeId: r.csn, name: r.encounterType + ' — ' + r.deptCode, detail: r.csn, active: true, keys: { code: r.csn } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        const a = (list) => list.map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'staff') return a([
          { field: 'fullName', value: r.providerName }, { field: 'workEmail', value: r.loginEmail },
          { field: 'employeeId', value: r.employeeNumber }, { field: 'npi', value: r.npi },
          { field: 'jobTitle', value: r.epicTitle }, { field: 'credential', value: r.credential },
          { field: 'homeUnit', value: r.primaryDeptCode },
          { field: 'employmentStatus', value: r.accountStatus === 'Active' ? 'Active' : 'Terminated' },
          { field: 'accessStatus', value: r.accountStatus },
        ]);
        if (r._type === 'patient') return a([
          { field: 'fullName', value: r.legalName }, { field: 'mrn', value: r.mrn }, { field: 'dob', value: r.dob },
          { field: 'sex', value: r.sex }, { field: 'phone', value: r.phone }, { field: 'address', value: r.addressLine },
          { field: 'patientStatus', value: r.patientStatus },
        ]);
        if (r._type === 'unit') return a([
          { field: 'unitName', value: r.deptName }, { field: 'unitCode', value: r.deptCode },
          { field: 'facilityCode', value: r.facilityCode }, { field: 'serviceLine', value: r.serviceLine },
          { field: 'unitType', value: r.unitType }, { field: 'beds', value: r.staffedBeds },
        ]);
        if (r._type === 'facility') return a([
          { field: 'facilityName', value: r.name }, { field: 'facilityCode', value: r.facilityCode },
          { field: 'city', value: r.city }, { field: 'facilityType', value: r.facilityType },
          { field: 'licensedBeds', value: r.licensedBeds },
        ]);
        if (r._type === 'encounter') return a([
          { field: 'encounterLabel', value: r.encounterType + ' · ' + new Date(r.admitAt).toISOString().slice(0, 10) },
          { field: 'encounterType', value: r.encounterType }, { field: 'admitAt', value: r.admitAt },
          { field: 'dischargeAt', value: r.dischargeAt }, { field: 'disposition', value: r.disposition },
          { field: 'primaryDiagnosis', value: r.primaryDiagnosis }, { field: 'lengthOfDays', value: r.lengthOfDays },
        ]);
        return [];
      },
    },

    workday: {
      collection: 'workday', effectiveDating: true,
      identity: (r) => {
        if (r._type === 'staff') return { nativeId: r.workerId, name: r.legalName, detail: r.jobTitle,
          active: r.employmentStatus === 'Active',
          keys: { employeeId: r.workerId, email: r.workEmail, name: N().name(r.legalName) } };
        if (r._type === 'unit') return { nativeId: r.departmentId, name: r.name, detail: r.costCenter, active: true, keys: { code: r.unitCode } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        if (r._type === 'staff') {
          const out = [
            { field: 'fullName', value: r.legalName, effectiveFrom: r.hireDate },
            { field: 'workEmail', value: r.workEmail, effectiveFrom: r.hireDate },
            { field: 'employeeId', value: r.workerId, effectiveFrom: r.hireDate },
            { field: 'jobTitle', value: r.jobTitle, effectiveFrom: r.hireDate },
            { field: 'department', value: r.department, effectiveFrom: r.hireDate },
            { field: 'homeUnit', value: r.unitCode, effectiveFrom: r.unitEffectiveFrom },
            { field: 'employmentType', value: r.employmentType, effectiveFrom: r.hireDate },
            { field: 'employmentStatus', value: r.employmentStatus, effectiveFrom: r.terminationDate || r.hireDate },
            { field: 'hireDate', value: r.hireDate, effectiveFrom: r.hireDate },
          ];
          if (r.scheduledChange)
            out.push({ field: r.scheduledChange.field, value: r.scheduledChange.value, effectiveFrom: r.scheduledChange.effectiveFrom, scheduled: true });
          return out.map((x) => Object.assign({ observedAt: t }, x));
        }
        if (r._type === 'unit') return [
          { field: 'unitName', value: r.name, observedAt: t, effectiveFrom: t },
          { field: 'unitCode', value: r.unitCode, observedAt: t, effectiveFrom: t },
          { field: 'costCenter', value: r.costCenter, observedAt: t, effectiveFrom: t },
        ];
        return [];
      },
    },

    ukg: {
      collection: 'ukg', effectiveDating: false,
      identity: (r) => {
        if (r._type === 'staff') return { nativeId: r.personNumber, name: r.displayName, detail: r.jobCode,
          active: r.employmentStatus === 'Active',
          keys: { employeeId: r.employeeNumber, badge: r.badgeId, nameGroup: N().name(r.displayName) + '|' + r.homeUnit, name: N().name(r.displayName) } };
        if (r._type === 'unit') return { nativeId: r.costCenter, name: r.name, detail: r.costCenter, active: true, keys: { code: r.unitCode } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        if (r._type === 'staff') return [
          { field: 'fullName', value: r.displayName }, { field: 'employeeId', value: r.employeeNumber },
          { field: 'homeUnit', value: r.homeUnit },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'unit') return [
          { field: 'unitName', value: r.name, observedAt: t, effectiveFrom: t },
          { field: 'unitCode', value: r.unitCode, observedAt: t, effectiveFrom: t },
          { field: 'costCenter', value: r.costCenter, observedAt: t, effectiveFrom: t },
        ];
        return [];
      },
    },

    symplr: {
      collection: 'symplr', effectiveDating: true,
      identity: (r) => ({ nativeId: r.providerId, name: r.name, detail: r.credential, active: true,
        keys: { employeeId: r.employeeNumber, npi: r.npi, name: N().name(r.name) } }),
      assertions: (r) => [
        { field: 'fullName', value: r.name }, { field: 'npi', value: r.npi }, { field: 'credential', value: r.credential },
        { field: 'licenseNumber', value: r.licenseNumber }, { field: 'licenseExpiry', value: r.licenseExpiry },
        { field: 'privilegeStatus', value: r.privilegeStatus },
      ].map((x) => Object.assign({ observedAt: r.observedAt, effectiveFrom: r.observedAt }, x)),
    },

    waystar: {
      collection: 'waystar', effectiveDating: false,
      identity: (r) => {
        if (r._type === 'patient') return { nativeId: r.accountId, name: r.patientName, detail: r.insurancePlan, active: true,
          keys: { mrn: r.mrnRef, nameDob: N().name(r.patientName) + '|' + r.dateOfBirth } };
        if (r._type === 'encounter') return { nativeId: r.claimId, name: 'Claim ' + r.claimId, detail: r.payer, active: true, keys: { code: r.csnRef } };
        return null;
      },
      assertions: (r) => {
        const t = r.observedAt;
        if (r._type === 'patient') return [
          { field: 'fullName', value: r.patientName }, { field: 'mrn', value: r.mrnRef }, { field: 'dob', value: r.dateOfBirth },
          { field: 'phone', value: r.phone }, { field: 'address', value: r.addressLine }, { field: 'insurance', value: r.insurancePlan },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        if (r._type === 'encounter') return [
          { field: 'lengthOfDays', value: r.billedDays }, { field: 'payer', value: r.payer }, { field: 'claimStatus', value: r.claimStatus },
        ].map((x) => Object.assign({ observedAt: t, effectiveFrom: t }, x));
        return [];
      },
    },

    lenel: {
      collection: 'lenel', effectiveDating: false,
      identity: (r) => ({ nativeId: r.badgeId, name: r.holderName, detail: r.accessLevel, active: r.badgeStatus === 'Active',
        keys: { employeeId: r.employeeNumber, badge: r.badgeId, name: N().name(r.holderName) } }),
      assertions: (r) => [
        { field: 'fullName', value: r.holderName }, { field: 'employeeId', value: r.employeeNumber },
        { field: 'employmentStatus', value: r.badgeStatus === 'Active' ? 'Active' : 'Terminated' },
        { field: 'accessStatus', value: r.badgeStatus },
      ].map((x) => Object.assign({ observedAt: r.observedAt, effectiveFrom: r.observedAt }, x)),
    },
  };

  SOT.packs = SOT.packs || {};
  SOT.packs.health = {
    id: 'health',
    label: 'Health system',
    industry: 'Healthcare',
    tenantName: 'St. Aldwyn Health',
    tagline: 'Three hospitals, six systems, one record of who is who.',
    systems: SYSTEMS,
    entityTypes: ENTITY_TYPES,
    edgeTypes: EDGE_TYPES,
    fields: FIELDS,
    policy: POLICY,
    rationale: RATIONALE,
    roles: ROLES,
    hierarchy: HIERARCHY,
    adapters: ADAPTERS,
    build,
    searchTypes: ['staff', 'patient', 'unit', 'facility', 'encounter'],
    personaRules: {
      physician: /Hospitalist|Attending Physician/,
      nurse_manager: /Nurse Manager/,
      exec: /Chief Operating Officer/,
      workforce: /Workforce Systems/,
      compliance: /Identity Governance/,
    },
    // A code in one record is a pointer to another entity. Declaring it here
    // turns "IMG" into a link to Imaging & Radiology everywhere it appears.
    codeRefs: { homeUnit: ['unit', 'unitCode'], facilityCode: ['facility', 'facilityCode'] },
  };
})(window.SOT || (window.SOT = {}));
