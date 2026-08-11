/* SOT — schema primitives.
 *
 * Nothing in this file knows about hospitals, battalions or sales teams. It
 * defines the vocabulary every vertical is expressed in:
 *
 *   entity      a thing with an identity — a clinician, a patient, a ward, a
 *               visit, a squad, a territory. Every entity type is equal; there
 *               is no privileged "employee" object.
 *   assertion   one system's claim about one field of one entity, carrying
 *               both when we read it and when the source says it became true.
 *   edge        a typed, directional, *time-bounded* relationship between two
 *               entities.
 *
 * The time bounds on edges are the whole reason this product can answer "who
 * used to cover that territory" or "who was the nurse on that visit". A graph
 * of current-state pointers cannot answer either, and almost every system in a
 * customer's estate stores exactly that.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  /* ------------------------------------------------------------ sensitivity */

  const SENSITIVITY_RANK = { public: 0, internal: 1, confidential: 2, protected: 3 };

  // `protected` exists for clinical and personal data — PHI in a hospital,
  // personnel records in a defence context. It is the level that must never be
  // visible on a hunch, so roles opt into it explicitly.
  function canSee(role, sensitivity) {
    return SENSITIVITY_RANK[sensitivity] <= SENSITIVITY_RANK[role.maxSensitivity];
  }

  /* --------------------------------------------------------------- conflicts */

  const CONFLICT_KINDS = {
    divergence: { label: 'Divergence', blurb: 'Systems that have both been read recently disagree on the value.' },
    lag: { label: 'Lag', blurb: 'A system has not been read since the value changed. It is behind, not wrong.' },
    gap: { label: 'Gap', blurb: 'A system that should carry this field has no value for it.' },
  };

  const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

  /* ------------------------------------------------------------------ time */

  /** Is an interval open at `ts`? A null end means "still true". */
  function activeAt(from, to, ts) {
    if (from != null && ts < from) return false;
    if (to != null && ts > to) return false;
    return true;
  }

  function overlaps(aFrom, aTo, bFrom, bTo) {
    if (aTo != null && bFrom != null && aTo < bFrom) return false;
    if (bTo != null && aFrom != null && bTo < aFrom) return false;
    return true;
  }

  /* ------------------------------------------------------------- assertions */

  function assertion(entityId, field, value, systemId, observedAt, effectiveFrom, extra) {
    return Object.assign(
      { entityId, field, value, systemId, observedAt, effectiveFrom: effectiveFrom == null ? observedAt : effectiveFrom },
      extra || {}
    );
  }

  /* ------------------------------------------------ identity match strengths
   *
   * Shared across verticals: a national provider number and a medical record
   * number are different strings but the same *kind* of evidence — a strong
   * structural key. Name plus date of birth is the same kind of evidence in a
   * hospital as name plus unit is in a battalion: suggestive, not conclusive.
   */
  const KEY_STRENGTH = {
    code: { score: 0.99, label: 'Structural code matches exactly' },
    email: { score: 0.98, label: 'Work email matches exactly' },
    employeeId: { score: 0.97, label: 'Employee ID cross-referenced' },
    npi: { score: 0.96, label: 'National provider number matches' },
    mrn: { score: 0.95, label: 'Medical record number matches' },
    serviceNumber: { score: 0.96, label: 'Service number matches' },
    badge: { score: 0.92, label: 'Badge / credential number matches' },
    nameDob: { score: 0.72, label: 'Name and date of birth match; no shared identifier' },
    nameGroup: { score: 0.66, label: 'Name and assigned group match; no shared identifier' },
    name: { score: 0.45, label: 'Name matches; nothing else corroborates' },
    confirmed: { score: 1.0, label: 'Confirmed by a reviewer' },
  };

  const AUTO_LINK = 0.9;
  const REVIEW = 0.4;

  /* -------------------------------------------------------------- formatting */

  const norm = {
    text: (s) => (s == null ? '' : String(s).trim().toLowerCase()),
    name: (s) =>
      (s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\b(dr|mr|mrs|ms|prof|sgt|cpl|lt|capt|maj|col)\b\.?/g, '')
        .replace(/[^a-z ]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
  };

  SOT.schema = {
    DAY,
    SENSITIVITY_RANK,
    CONFLICT_KINDS,
    SEVERITY_ORDER,
    KEY_STRENGTH,
    AUTO_LINK,
    REVIEW,
    canSee,
    activeAt,
    overlaps,
    assertion,
    norm,
  };
})(window.SOT || (window.SOT = {}));
