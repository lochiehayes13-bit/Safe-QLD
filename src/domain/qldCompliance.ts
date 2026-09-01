/**
 * Queensland statutory compliance.
 *
 * There are two separate layers here and the app must not blur them:
 *
 *  - **AS 1851** is the technical method — what gets tested and how often. Its
 *    schedule tables are copyright Standards Australia, so this file carries
 *    item numbers, frequencies and tolerances but never the standard's own
 *    wording. The licence holder transcribes that from their purchased copy.
 *  - **The Building Fire Safety Regulation 2008 (Qld)** is the law. It dictates
 *    what a record of maintenance must state, what counts as a critical defect,
 *    and the clocks that start when one is found. This is what an inspector
 *    checks, and a form with perfect test results but no licence number fails
 *    it.
 *
 * The two definitions of "critical defect" are not identical, so both are
 * captured rather than one being inferred from the other.
 */

export type Frequency = 'monthly' | 'six-monthly' | 'yearly' | 'five-yearly' | 'ten-yearly';

export interface FrequencySpec {
  id: Frequency;
  label: string;
  /** Months between occurrences. */
  intervalMonths: number;
  /** Permitted variance either side of the scheduled date. */
  toleranceDays?: number;
  toleranceMonths?: number;
  /** True where the tolerance is counted in working days rather than calendar. */
  workingDays?: boolean;
  /** AS 1851 Section 6 schedule table, for reference not reproduction. */
  scheduleTable: string;
  appliesTo: string;
}

/**
 * Section 6 frequencies and tolerances.
 *
 * Section 6 has no three-monthly or two-yearly activities — a gap worth knowing
 * about, because scheduling software often invents them.
 */
export const SECTION_6_FREQUENCIES: FrequencySpec[] = [
  {
    id: 'monthly', label: 'Monthly', intervalMonths: 1,
    toleranceDays: 5, workingDays: true,
    scheduleTable: '6.4.1.2',
    appliesTo: 'All fire detection and alarm systems',
  },
  {
    id: 'six-monthly', label: 'Six-monthly', intervalMonths: 6,
    toleranceMonths: 1,
    scheduleTable: '6.4.1.3',
    appliesTo: 'Detection and control equipment of special hazard systems only',
  },
  {
    id: 'yearly', label: 'Yearly', intervalMonths: 12,
    toleranceMonths: 2,
    scheduleTable: '6.4.1.4',
    appliesTo: 'All fire detection and alarm systems',
  },
  {
    id: 'five-yearly', label: 'Five-yearly', intervalMonths: 60,
    toleranceMonths: 3,
    scheduleTable: '6.4.1.5',
    appliesTo: 'All fire detection and alarm systems',
  },
  {
    id: 'ten-yearly', label: 'Ten-yearly', intervalMonths: 120,
    toleranceMonths: 6,
    scheduleTable: '6.4.1.5 / Appendix G',
    appliesTo: 'In-situ sensitivity test of point smoke detectors',
  },
];

export function frequencySpec(id: Frequency): FrequencySpec | undefined {
  return SECTION_6_FREQUENCIES.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function parseDate(iso: string): Date | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + months);
  // Clamp when the target month is shorter: 31 Jan plus one month is 28 Feb,
  // not 3 March, which is what naive month arithmetic produces.
  if (out.getUTCDate() < day) out.setUTCDate(0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Adds working days, skipping weekends. Public holidays are not modelled. */
/**
 * Weekends only. Queensland public holidays are counted as working days here,
 * and that is a decision rather than an oversight — but not a settled one.
 *
 * This sets the monthly tolerance window, which AS 1851 table 6.4.1.2 gives in
 * working days. The app holds an authoritative Queensland public holiday table
 * appointed under the Holidays Act 1983, and `addQldBusinessDays` in
 * occupierForm.ts does exclude those days — but it counts a statutory clock
 * (the ten business days to give the Commissioner a copy), where "business
 * day" has a settled legal meaning. What a maintenance standard means by
 * "working day" is a different question, and reading it either way moves a
 * compliance boundary, so it is not one to answer quietly.
 *
 * What it costs: a monthly scheduled 10 April 2026 has its earliest permitted
 * day on Good Friday, because Good Friday and Easter Monday are both counted.
 * A holiday-aware reading would reach back two days further, and a service done
 * on 1 April would read as in tolerance instead of early.
 *
 * Pinned by test either way, so changing the reading is a visible change and
 * not a silent one.
 */
export function addWorkingDays(iso: string, days: number): string | null {
  const start = parseDate(iso);
  if (!start) return null;
  const out = new Date(start);
  let remaining = Math.abs(days);
  const step = days < 0 ? -1 : 1;
  while (remaining > 0) {
    out.setUTCDate(out.getUTCDate() + step);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return toIso(out);
}

/**
 * Working days from one date to another, negative when the target is in the
 * past. Weekends only; public holidays are not modelled, so treat the count as
 * the optimistic case rather than a guarantee.
 */
export function workingDaysBetween(fromIso: string, toIso: string): number | null {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (!from || !to) return null;
  const forward = to >= from;
  const [start, end] = forward ? [from, to] : [to, from];
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return forward ? count : -count;
}

/**
 * The scheduled date of the nth occurrence.
 *
 * Counted from the anchor — the initial scheduled activity — and never from the
 * last completion. Scheduling from completion lets drift accumulate: a service
 * done three weeks late becomes the new baseline, and the system reports
 * compliance while sliding steadily out of tolerance.
 */
export function scheduledDate(anchorIso: string, frequency: Frequency, occurrence: number): string | null {
  const spec = frequencySpec(frequency);
  const anchor = parseDate(anchorIso);
  if (!spec || !anchor || occurrence < 0) return null;
  return toIso(addMonths(anchor, spec.intervalMonths * occurrence));
}

export interface ToleranceWindow {
  scheduled: string;
  earliest: string;
  latest: string;
}

/** The permitted window around a scheduled date. */
export function toleranceWindow(scheduledIso: string, frequency: Frequency): ToleranceWindow | null {
  const spec = frequencySpec(frequency);
  const scheduled = parseDate(scheduledIso);
  if (!spec || !scheduled) return null;

  if (spec.workingDays && spec.toleranceDays !== undefined) {
    const earliest = addWorkingDays(scheduledIso, -spec.toleranceDays);
    const latest = addWorkingDays(scheduledIso, spec.toleranceDays);
    if (!earliest || !latest) return null;
    return { scheduled: scheduledIso, earliest, latest };
  }
  if (spec.toleranceMonths !== undefined) {
    return {
      scheduled: scheduledIso,
      earliest: toIso(addMonths(scheduled, -spec.toleranceMonths)),
      latest: toIso(addMonths(scheduled, spec.toleranceMonths)),
    };
  }
  if (spec.toleranceDays !== undefined) {
    return {
      scheduled: scheduledIso,
      earliest: toIso(addDays(scheduled, -spec.toleranceDays)),
      latest: toIso(addDays(scheduled, spec.toleranceDays)),
    };
  }
  return null;
}

export type ToleranceStatus = 'early' | 'in-tolerance' | 'late' | 'unknown';

/** Whether a service performed on a date falls inside its tolerance window. */
export function toleranceStatus(scheduledIso: string, performedIso: string, frequency: Frequency): ToleranceStatus {
  const window = toleranceWindow(scheduledIso, frequency);
  if (!window) return 'unknown';
  const performed = performedIso.slice(0, 10);
  if (performed < window.earliest) return 'early';
  if (performed > window.latest) return 'late';
  return 'in-tolerance';
}

// ---------------------------------------------------------------------------
// Defect classification
// ---------------------------------------------------------------------------

export type As1851Class = 'critical' | 'non-critical' | 'non-conformance';

export const AS1851_CLASS_LABEL: Record<As1851Class, string> = {
  critical: 'Critical defect',
  'non-critical': 'Non-critical defect',
  'non-conformance': 'Non-conformance',
};

/** Notification and rectification expectations by class. */
export const AS1851_CLASS_OBLIGATION: Record<As1851Class, { notify: string; rectify: string }> = {
  critical: {
    notify: 'Verbally to the responsible entity before leaving site, confirmed in writing within 24 hours.',
    rectify: 'With minimum delay.',
  },
  'non-critical': {
    notify: 'In writing to the responsible entity within one week.',
    rectify: 'As soon as practicable, and before the next yearly condition report.',
  },
  'non-conformance': {
    notify: 'In writing to the responsible entity within one week.',
    rectify: 'As soon as practicable, and before the next yearly condition report.',
  },
};

/**
 * The Queensland critical defect test.
 *
 * Both limbs must be true. It is deliberately not the same test as AS 1851's,
 * so the two are captured separately rather than one being derived from the
 * other — a defect can be an AS 1851 critical defect without meeting the
 * Queensland definition, and the statutory notice hangs on the Queensland one.
 */
export function isQldCriticalDefect(rendersInoperable: boolean, significantAdverseImpact: boolean): boolean {
  return rendersInoperable && significantAdverseImpact;
}

/** When the written critical defect notice is due to the occupier. */
export function criticalNoticeDueAt(maintenanceIso: string): string | null {
  const d = new Date(maintenanceIso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 24 * 3_600_000).toISOString();
}

/** When the occupier must have rectified, being one month from the maintenance. */
export function rectificationDueAt(maintenanceIso: string): string | null {
  const d = parseDate(maintenanceIso);
  return d ? toIso(addMonths(d, 1)) : null;
}

/** When a copy of the occupier statement is due to the Commissioner. */
export function commissionerCopyDueAt(statementIso: string): string | null {
  return addWorkingDays(statementIso, 10);
}

// ---------------------------------------------------------------------------
// Record of maintenance
// ---------------------------------------------------------------------------

/**
 * The fields a Queensland record of maintenance must state.
 *
 * This is the list an inspector works through, so it is modelled explicitly
 * rather than being assumed to fall out of a service report.
 */
export interface MaintenanceRecord {
  /** Description of the prescribed fire safety installation serviced. */
  installationDescription: string;
  technicianName: string;
  technicianLicenceNumber: string;
  /** Required only where the work was not done personally by a qualified person. */
  supervisorName?: string;
  supervisorLicenceNumber?: string;
  maintenanceDate: string;
  /** Brief description of the maintenance carried out. */
  maintenanceDescription: string;
  /** Explicit affirmation, not a silent default. */
  qdcCompliance: boolean;
  /** Whether the installation was considered to be in proper working order. */
  inProperWorkingOrder: boolean | null;
  correctiveActionRequired?: string;
  repairsMade?: { description: string; date: string }[];
  /**
   * A signed statement certifying the record is correct. Distinct from simply
   * recording the technician's name — the signature is its own legal element.
   */
  certificationSignature?: string;
  certifiedAt?: string;
  /** Which maintenance standard the installation is kept to. */
  appliedStandard?: string;
  /** Whether a hardcopy was left on site, which is required for all methods. */
  hardcopyLeftOnSite: boolean;
}

export interface ComplianceIssue {
  field: string;
  legalRef: string;
  message: string;
}

/**
 * Checks a record against the statutory field list.
 *
 * Returns what is missing rather than a pass/fail, because the useful output on
 * site is the list of things still to fill in.
 */
export function validateMaintenanceRecord(r: MaintenanceRecord): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const need = (ok: boolean, field: string, legalRef: string, message: string): void => {
    if (!ok) issues.push({ field, legalRef, message });
  };

  need(!!r.installationDescription.trim(), 'installationDescription', 's55(2)(a)',
    'Describe the installation the maintenance was carried out on.');
  need(!!r.technicianName.trim(), 'technicianName', 's55(2)(b)',
    'Name the person who carried out the maintenance.');
  need(!!r.technicianLicenceNumber.trim(), 'technicianLicenceNumber', 's55(2)(b)',
    'Record the licence number. A record without it does not satisfy the regulation.');
  need(!!r.maintenanceDate.trim(), 'maintenanceDate', 's55(2)(d)',
    'Record the date the maintenance was carried out.');
  need(!!r.maintenanceDescription.trim(), 'maintenanceDescription', 's55(2)(e)',
    'Briefly describe the maintenance carried out.');
  need(r.qdcCompliance, 'qdcCompliance', 's55(2)(f)',
    'The record must state the maintenance complied with QDC MP 6.1. This has to be affirmed, not assumed.');
  need(r.inProperWorkingOrder !== null, 'inProperWorkingOrder', 's55(2)(g)(i)',
    'State whether the installation was considered to be in proper working order.');
  need(!!r.certificationSignature, 'certificationSignature', 's55(3)(a)',
    'A signed certification that the record is correct is required, and is separate from recording your name.');

  // A supervisor is only named where the work was not done personally by a
  // qualified person, so it is checked as a pair rather than individually.
  if (r.supervisorName?.trim() && !r.supervisorLicenceNumber?.trim()) {
    issues.push({
      field: 'supervisorLicenceNumber', legalRef: 's55(2)(c)',
      message: 'A supervising qualified person is named, so their licence number is required too.',
    });
  }

  if (r.inProperWorkingOrder === false && !r.correctiveActionRequired?.trim()) {
    issues.push({
      field: 'correctiveActionRequired', legalRef: 's55(2)(g)(ii)',
      message: 'The installation is not in proper working order, so the corrective action required must be stated.',
    });
  }

  for (const [i, repair] of (r.repairsMade ?? []).entries()) {
    if (!repair.date?.trim()) {
      issues.push({
        field: `repairsMade[${i}].date`, legalRef: 's55(2)(g)(iii)',
        message: 'Repairs must be recorded with the date they were made.',
      });
    }
  }

  need(r.hardcopyLeftOnSite, 'hardcopyLeftOnSite', 'AS 1851 cl 1.16.2',
    'A hardcopy record has to be left on site, including where records are kept electronically.');

  return issues;
}

/** The certification wording a technician signs against. */
export const CERTIFICATION_STATEMENT =
  'I certify that the matters stated in this record of maintenance are correct.';

// ---------------------------------------------------------------------------
// Occupier statement
// ---------------------------------------------------------------------------

/** Prescribed installations, in the order the statement lists them. */
export const OCCUPIER_STATEMENT_INSTALLATIONS: string[] = [
  'Air handling systems',
  'Emergency lifts',
  'Emergency lighting',
  'Emergency power supply',
  'Emergency warning and intercommunication systems',
  'Exit signs',
  'Fire detection and alarm systems',
  'Fire doorsets',
  'Fire extinguishers',
  'Fire hose reels',
  'Fire hydrants (including boosters)',
  'Fire mains',
  'Fire shutters',
  'Other features',
  'Smoke and heat venting systems',
  'Smoke doorsets',
  'Smoke exhaust systems',
  'Solid core doors',
  'Special automatic fire suppression systems',
  'Sprinklers',
  'Stairwell pressurisation systems',
];

export interface OccupierStatementRow {
  installation: string;
  /** Whether the building has this installation at all. */
  present: boolean;
  /** The standard it is maintained to. */
  nominatedStandard?: string;
  criticalDefectNoticeGiven: boolean;
  rectifiedDate?: string;
}

/** What still has to happen before a statement can be lodged. */
export function occupierStatementIssues(rows: OccupierStatementRow[]): string[] {
  const issues: string[] = [];
  for (const row of rows) {
    if (!row.present) continue;
    if (!row.nominatedStandard?.trim()) {
      issues.push(`${row.installation}: no maintenance standard nominated.`);
    }
    if (row.criticalDefectNoticeGiven && !row.rectifiedDate?.trim()) {
      issues.push(`${row.installation}: critical defect notice given with no rectification date recorded.`);
    }
  }
  return issues;
}

/**
 * The prescribed installations each of our system kinds belongs to.
 *
 * The statement's list is fixed by regulation and does not line up with how a
 * technician thinks about a site: our "detection" covers both the detection
 * system and its exit signs on some jobs, and "passive" covers three separate
 * lines on the statement. Mapping only what is unambiguous means a prefill
 * proposes rather than asserts — the occupier still ticks the list.
 *
 * Kept here as a re-export because the table now has to answer for the asset
 * side and the register importer both, and a system left out of it silently
 * dropped a critical defect off a statement. It lives with the check that
 * catches that, in statementEvidence.ts, which also says why each unmapped
 * system is unmapped.
 */
export { SYSTEM_TO_INSTALLATION } from '@/domain/statementEvidence';

/**
 * How many working days remain to give the Commissioner a copy.
 *
 * Negative once the deadline has passed, so a caller can say "three days late"
 * with the same arithmetic it uses to say "three days left".
 */
export function commissionerDaysRemaining(signedIso: string, todayIso: string): number | null {
  const due = commissionerCopyDueAt(signedIso);
  if (!due) return null;
  return workingDaysBetween(todayIso, due);
}
