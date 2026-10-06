import {
  CALIBRATED_FLOW_DEVICE_KINDS, CALIBRATION_MONTHS, FLOW_DEVICE_LABEL,
  FLOW_ROW_GROUP_LABEL, FRICTIONAL_LOSS_TOLERANCE_KPA, PART_D_DEVICE_RATES_LPS, PART_D_ROWS,
  canIssue, elevationHeadKpa, flowCellState, flowDeviceCalibrationFrom, flowRowGroup,
  flowRowKey, flowRowLabel,
  flowRowLongLabel, flowRowUntouched, overloadCheck, resolveFrictionalLoss, validateForm72,
  type BoosterTest, type FlowRow, type FlowRowColumn, type FlowRowGroup, type FlowTest,
  type Form72, type FormDefect, type FormIssue, type PartResult, type SprinklerTestPoint,
  type TestDevice,
} from '@/domain/form72';
import { addQldBusinessDays } from '@/domain/occupierForm';
import { qldIsoDay } from '@/domain/qldTime';
import { letterheaded } from './letterhead';
import { formatAuDate } from './sheets';

/**
 * Form 72 as a page somebody signs.
 *
 * The department's form is the document a Queensland occupier is legally
 * entitled to receive, so this reproduces it part for part rather than
 * summarising it — same parts, same order, same field labels, same N/A / PASS /
 * FAIL boxes. Crown material published to be filled in and lodged may be
 * reproduced faithfully, which is what makes this different from an Australian
 * Standard: a technician handing over a "summary of the Form 72" has not
 * discharged QDC MP 6.1.
 *
 * Three failures on paper are what shaped the rest of it.
 *
 * The first is the blank. On a printed form a blank box is ambiguous — it may
 * mean N/A, or nobody looked, or the pen ran out — and by the time it is
 * queried the site is a year behind. So nothing here prints blank: a missing
 * reading inside a live part prints "Not recorded", and the same box inside a
 * part marked N/A prints "N/A". Both are answers. The blank is not.
 *
 * The second is the gauge. Every pressure on the page was read with the
 * equipment listed in Part C, and a gauge out of calibration makes all of them
 * unusable — a fact no reader of the paper can check, because the paper does
 * not hold the test date and the calibration date in the same place. The app
 * does. So a form with a stale gauge, or any other blocking defect, prints
 * stamped NOT FOR ISSUE with the reasons on its face, rather than printing
 * clean and being challenged in a year.
 *
 * The third is the clean draft. A form with nothing outstanding prints without
 * a mark on it, and at that point the only difference between it and the
 * statutory record is that a draft can still be edited. So where the caller
 * says which one it is holding, the page says so too: an occupier given a
 * draft, and a figure changed the day after, ends up holding a document that
 * disagrees with ours, which is the one thing the issued-form rule exists to
 * stop.
 *
 * Nothing here computes hydraulics of its own. The frictional loss and the
 * overload check come from domain/form72.ts, and where the readings do not
 * support them the page says so in words instead of printing a figure that
 * looks measured. The business days are counted by the app's Queensland
 * calendar, holidays and all, because the occupier statement counts the same
 * ten days and two answers from one job is how an office stops believing both.
 */

// ---------------------------------------------------------------------------
// The department's own words
// ---------------------------------------------------------------------------

/**
 * Where the wording below comes from, and how sure we are of it.
 *
 * Held as data rather than as a comment so the document itself can cite the
 * form it reproduces. A reader who thinks a line looks wrong needs the source,
 * not our assurance.
 */
export const FORM_72_SOURCES = [
  {
    fact: 'Form 72 — Fire Hydrant and Sprinkler System Periodic Testing and Maintenance, '
      + 'Version 1 – July 2014, Department of Housing and Public Works.',
    url: 'https://www.hpw.qld.gov.au/__data/assets/pdf_file/0026/9827/form72firehydranttestingandmaintenance.pdf',
    confidence: 'high',
  },
  {
    fact: 'QDC MP 6.1 A4(b): within 10 business days after completing the work, a copy of the form '
      + 'goes to the building occupier where the work was maintenance.',
    url: 'https://www.hpw.qld.gov.au/__data/assets/pdf_file/0017/4832/qdcmp6.1.pdf',
    confidence: 'high',
  },
  {
    fact: 'QDC MP 6.1 A5: the person who carried out the maintenance keeps a record of the form for '
      + 'at least 5 years after completing the work.',
    url: 'https://www.hpw.qld.gov.au/__data/assets/pdf_file/0017/4832/qdcmp6.1.pdf',
    confidence: 'high',
  },
  {
    fact: 'The Part I declaration wording. The signed copies Safe QLD holds clip the middle of the '
      + 'sentence at the page edge; a published transcription supplies it and matches both legible '
      + 'ends exactly.',
    url: 'https://docest.com/doc/530085/form-72-fire-hydrant-testing-and-maintenance',
    confidence: 'medium',
  },
  {
    // Printed on the page as a figure a reader may act on, so it is sourced in
    // the data like everything else. It is not on the department's form at all.
    fact: 'The pump overload check — 150% of duty flow at not less than 65% of duty pressure. Taken '
      + "from Safe QLD's own annual combined sprinkler and hydrant flow test certificate, which "
      + 'states the rule and works it as 16 L/s at 700 kPa giving 24 L/s at 455 kPa. The same '
      + 'certificate carries a second worked example at 560 kPa, which is 80% and disagrees with '
      + 'its own rule; 65% is used and the disagreement is reported rather than resolved quietly. '
      + 'The 150/65 pair is the ordinary fire pumpset acceptance point and is stated the same way '
      + 'in the NFPA 20 and NFPA 25 pump curve requirements.',
    url: 'https://www.nfpa.org/codes-and-standards/nfpa-20-standard-development/20',
    confidence: 'medium',
  },
  {
    fact: 'Business days are counted the way the Acts Interpretation Act 1954 (Qld) defines them, '
      + 'against the appointed Queensland public holidays — the same count and the same holiday '
      + 'table the occupier statement uses for its ten business days, so the app cannot give two '
      + 'answers to one question.',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/act-1954-003',
    confidence: 'high',
  },
] as const;

export const FORM_VERSION = 'Version 1 – July 2014';

export const FORM_TITLE = 'Form 72—fire hydrant and sprinkler system';
export const FORM_SUBTITLE = 'periodic testing and maintenance';

export const FORM_INTRO = 'This form is to be used for the purposes of maintenance to water based '
  + 'fire safety installations, as required by the Queensland Development Code – Mandatory Part '
  + '(MP) 6.1, which is a building assessment provision under the Building Act 1975, section 30. '
  + 'This form is also to be used in accordance with the \u2018Fire hydrant and sprinkler system '
  + 'commissioning and periodic maintenance procedure\u2019, defined in MP 6.1 as the \u2018Relevant '
  + 'procedure\u2019. Please note that this form does not comprise all maintenance requirements—this '
  + 'form is only for collecting results for maintenance for some sections of the Australian '
  + 'Standards referred to and in each case, further testing is required.';

export const PART_B_NOTE = 'Refer to the required pressure specification for periodic testing (as '
  + 'applicable) as per AS2419.1 or AS1851.';

export const PART_C_NOTE = 'If using more devices, provide details in the Notes section below or '
  + 'complete another form. The correction factor must be kPa or a percentage.';

export const PART_D_NOTE = 'This part relates to tests under Section 4 of AS1851. If pressure/flow '
  + 'rates do not meet the fire system design criteria and there are no on-site problems, contact '
  + 'the relevant water service provider to ascertain if there are any problems with the water '
  + 'system network. In the table below, please record the pressure readings obtained during the '
  + 'hydrant system flow test.';

export const PART_E_NOTE = 'This part relates to sections 10.4 and 10.5 of AS2419.1 and for tests '
  + 'under Section 4 of AS1851. If pressure/flow rates do not meet the fire system design criteria '
  + 'and there are no on-site problems, contact the relevant water service provider to ascertain if '
  + 'there are any problems with the water system network. In the table below, please record the '
  + 'pressure readings obtained during the pump appliance booster test.';

export const PART_F_NOTE = 'Relevant required pressure specification in AS2118.1, AS2118.4 and AS2118.6.';

export const PART_G_NOTE = 'This section is to be used for sections 4.14 of AS2118.1-1999, 4 of '
  + 'AS2118.6-2012 and 6.2 of AS2118.4-2012 and section 2 of AS1851. Notes: (1) For AS2118.1 and '
  + 'AS2118.6 systems, multiple testing points may be required. (2) For AS2118.4, a simulated '
  + 'running test may be required for systems without a flow measuring device, in which the test '
  + 'involves opening a valve to discharge a volume of water that is accepted as being in excess of '
  + 'the design flow. System test points shall be noted for each different system and its location '
  + 'and descriptor.';

/**
 * The Part I declaration.
 *
 * Reproduced whole. The two signed copies the company holds print this sentence
 * off the right edge of the page, so the middle of it is not legible in either;
 * a published transcription of the department's form supplies the missing span
 * and joins both legible ends without a seam, which is why it is used rather
 * than guessed at. The confidence is recorded in FORM_72_SOURCES because a
 * declaration is the one sentence on the page that a licensee is signing.
 */
export const DECLARATION = 'By signing this Form 72, I confirm that the information contained '
  + 'herein is correct to the best of my knowledge given the information available and that this '
  + 'Form 72 has been completed in accordance with the relevant standards, codes and regulations.';

/** The department's footer note, verbatim. */
export const DEPARTMENT_NOTE = 'Note: Building owners/occupiers are responsible for ensuring their '
  + 'buildings continuously meet fire safety standards. Where a building owner/occupier becomes '
  + 'aware that their building does not meet the minimum requirements for water pressure required '
  + 'by any standard applicable under the Queensland Development Code Mandatory Part 6.1 '
  + '(Maintenance of fire safety installations) the building owner/occupier should contact the '
  + 'Queensland Fire and Emergency Service.';

/**
 * The department's two definitions, verbatim.
 *
 * Their own paragraph on the published form, under its own arrow, rather than
 * a sentence tacked onto the end of the note above it. The two say different
 * things — one is an obligation on the owner, the other is what two words on
 * the form mean — and running them together made the second read as part of
 * the first.
 */
export const DEPARTMENT_DEFINITIONS = 'Definitions → \u201cMaintenance test\u201d means a test that '
  + 'is required under a maintenance standard such as AS1851. \u201cRunning test\u201d means a two '
  + 'inch waste test installed at the sprinkler control valve on older systems.';

/**
 * The privacy and right-to-information notices, and the Crown copyright line.
 *
 * Printed because they are part of the published form, and because they are the
 * part an occupier is entitled to read: they say what the information on the
 * page may be used for and who it may be given to. A reproduction that drops
 * them hands somebody a document that collects their details and does not tell
 * them that.
 */
export const DEPARTMENT_PRIVACY = 'Privacy: The information on this form is collected for purposes '
  + 'related to monitoring compliance under the Plumbing and Drainage Act 2002, the Building Act '
  + '1975 and the Building Fire Safety Regulation 2008 (\u201clegislation\u201d). This information '
  + 'may be '
  + 'stored in the department\u2019s database and may be used for statistical research, information '
  + 'provision and evaluation of Plumbing Industry Council and state government services. Your '
  + 'personal information may be disclosed to other government agencies, local government '
  + 'authorities and third parties for purposes related to this application. Except for these '
  + 'circumstances, personal information will only be disclosed to third parties with your consent '
  + 'or in accordance with the Information Privacy Act 2009.';

export const DEPARTMENT_RTI = 'RTI: The information collected on this form will be retained as '
  + 'required by the Public Records Act 2002 and other relevant Acts and regulations, and is '
  + 'subject to the Right to Information regime established by the Right to Information Act 2009. '
  + 'If you have any further questions regarding your privacy, please email Building Codes '
  + 'Queensland on buildingcodes@qld.gov.au. © The State of Queensland (Department of Housing and '
  + 'Public Works) 2014. Published by the Queensland Government July 2014, 41 George Street, '
  + 'Brisbane QLD 4000.';

/** The department's own imprint, bottom left of each printed page. */
export const DEPARTMENT_IMPRINT = 'Building Codes Queensland\nDepartment of Housing and Public Works';

/** MP 6.1 A4(b) — business days, so weekends do not count. */
export const OCCUPIER_COPY_BUSINESS_DAYS = 10;

/** MP 6.1 A5 — how long the person who did the work keeps their own copy. */
export const TESTER_RETENTION_YEARS = 5;

// ---------------------------------------------------------------------------
// Small pieces of arithmetic the page needs
// ---------------------------------------------------------------------------

/**
 * When the occupier's copy is due, and what the count could not account for.
 *
 * Business days, not calendar days, and counted from the test date rather than
 * from the day the form was typed up: MP 6.1 starts the clock at completion of
 * the work.
 *
 * The count is the app's own Queensland one, holidays and all. A weekends-only
 * count was the obvious approach and it is wrong here for a reason that has
 * nothing to do with accuracy: the occupier statement counts its ten business
 * days against the appointed holidays, this form counts the same ten days under
 * MP 6.1, and two different answers to "ten business days after the work" on
 * two documents from the same job is how an office stops believing either. It
 * also refuses outside the years whose holidays Queensland has actually
 * appointed, rather than returning a date that assumes next decade's.
 */
export interface OccupierCopyDue {
  /** The date the copy is due, absent when it cannot be known. */
  date?: string;
  /** Why there is no date. Present exactly when date is absent. */
  reason?: string;
  /** Public holidays skipped, so the document can show its working. */
  holidaysApplied: string[];
  /** What the count could not account for, in the count's own words. */
  caveats: string[];
  /** The definition the count is made under. */
  legalRef?: string;
}

export function occupierCopyDue(testDate: string | undefined): OccupierCopyDue {
  if (!testDate) {
    return {
      holidaysApplied: [],
      caveats: [],
      reason: 'The form has no test date, and the ten business days run from the day the work was '
        + 'completed.',
    };
  }
  const count = addQldBusinessDays(testDate.slice(0, 10), OCCUPIER_COPY_BUSINESS_DAYS);
  return {
    date: count.date,
    reason: count.reason,
    holidaysApplied: count.holidaysApplied.map((h) => `${h.name} ${formatAuDate(h.date)}`),
    caveats: count.caveats,
    legalRef: count.legalRef,
  };
}

/**
 * The due date on its own, for a list that has room for a date and nothing
 * else. The reasons live on occupierCopyDue, and a screen that shows this
 * without them must treat an absent date as "cannot be given" rather than as
 * "no deadline".
 */
export function occupierCopyDueBy(testDate: string | undefined): string | undefined {
  return occupierCopyDue(testDate).date;
}

/**
 * When the tester's own copy may finally be destroyed under MP 6.1 A5.
 *
 * A test on 29 February lands on a date five years later that does not exist,
 * and JavaScript rolls it forward to 1 March. That is left alone deliberately:
 * the obligation is to keep the record for *at least* five years, so a day long
 * is safe and a day short is not.
 */
export function testerCopyKeepUntil(testDate: string | undefined): string | undefined {
  if (!testDate) return undefined;
  const d = new Date(`${testDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCFullYear(d.getUTCFullYear() + TESTER_RETENTION_YEARS);
  return d.toISOString().slice(0, 10);
}

/**
 * The Queensland calendar date of an instant.
 *
 * Slicing the first ten characters off a timestamp is the obvious approach and
 * it dates the document a day early: a form produced at eight on a Brisbane
 * morning was stamped at 22:00 the previous day in UTC. Queensland is UTC+10
 * all year, with no daylight saving to allow for.
 *
 * One implementation, in qldTime.ts. This was a fifth copy of the same ten
 * hours; it read "1/9/2026" as the ninth of January, on a form whose dates are
 * the ones a certifier reads.
 */
export function qldCalendarDate(instant: string | undefined): string | undefined {
  return qldIsoDay(instant);
}

/** The metered flow rates printed down Part D of the department's form. */
export const STANDARD_FLOW_RATES_LPS: readonly number[] = PART_D_DEVICE_RATES_LPS;

/** Where an unprinted row sorts: nozzles first by bore, then rates. */
function flowRowSort(row: FlowRow): number {
  if (row.nozzleMm !== undefined) return row.nozzleMm;
  if (row.rateLps !== undefined) return 1000 + row.rateLps;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * The rows Part D prints.
 *
 * The department's table has eight fixed lines — three nozzle bores and five
 * metered duties — so all eight are printed whether or not they were run. A
 * table that shows only the lines with readings on them reads as though the
 * others passed.
 *
 * Anything measured on a line the form does not print is kept and appended
 * rather than dropped, because a reading taken on site is never discarded to
 * make a layout fit.
 */
export function flowTableRows(test: FlowTest): { row: FlowRow; standard: boolean }[] {
  const remaining = [...test.rows];
  const standard = PART_D_ROWS.map((printed) => {
    const key = flowRowKey(printed);
    const i = remaining.findIndex((r) => flowRowKey(r) === key);
    if (i < 0) return { row: { ...printed }, standard: true };
    const [row] = remaining.splice(i, 1);
    return { row: row!, standard: true };
  });

  const extra = remaining
    .slice()
    .sort((a, b) => flowRowSort(a) - flowRowSort(b))
    .map((row) => ({ row, standard: false }));

  /*
   * An added row belongs at the end of its own group, not after all eight.
   *
   * Collected at the bottom, a 22 mm nozzle reading sat under "Other portable
   * testing devices" — below the five metered rates — which is a different
   * claim about what the technician measured. So each added row goes after the
   * printed rows of its own kind, where the group heading above it is the right
   * one. A row the model cannot identify still goes last, because there is no
   * group it belongs to.
   */
  const out: { row: FlowRow; standard: boolean }[] = [];
  for (const group of ['nozzle', 'device'] as const) {
    out.push(...standard.filter((x) => flowRowGroup(x.row) === group));
    out.push(...extra.filter((x) => flowRowGroup(x.row) === group));
  }
  out.push(...extra.filter((x) => flowRowGroup(x.row) === 'unidentified'));
  return out;
}

/**
 * Part G's per-line Pass / Fail box.
 *
 * Derived rather than typed, because the form asks for the required figure and
 * the result on the same line and then asks the technician to decide — which is
 * a subtraction done on a ladder. Undefined when either figure is missing: a
 * result with nothing to compare it against is not a pass.
 */
export function testPointOutcome(required?: number, result?: number): 'pass' | 'fail' | undefined {
  if (required === undefined || result === undefined) return undefined;
  return result + 1e-9 >= required ? 'pass' : 'fail';
}

/**
 * What Part E is missing before a frictional loss can be given.
 *
 * The calculation itself lives in the domain and returns undefined when it
 * cannot be done. This says which reading was absent, because "cannot be
 * calculated" on its own sends a technician back to the site to work out what
 * to measure.
 */
export function frictionalLossGaps(b: BoosterTest): string[] {
  const gaps: string[] = [];
  if (b.boostPressureKpa === undefined) gaps.push('the boost pressure');
  if (b.highestHydrantAboveBoosterM === undefined) gaps.push('the height of the highest hydrant above the booster');
  if (b.hydrantResidualKpa === undefined) gaps.push('the residual pressure at the hydrant');
  return gaps;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface Form72DocumentInput {
  form: Form72;
  /**
   * The system descriptor the department's form carries in its top right
   * corner: "Towns Main System", "Boosted Hydrant System". One site commonly
   * needs a form for each, and without it two forms for the same site on the
   * same day are indistinguishable.
   */
  systemLabel?: string;
  companyName?: string;
  /** ISO timestamp the document was produced, for the Safe QLD footer. */
  generatedAt: string;
  /**
   * Whether the app holds this form as issued, and when.
   *
   * A form with nothing blocking it prints clean, and a clean print of a draft
   * is indistinguishable from the statutory record — which matters because a
   * draft is still editable. Hand that PDF to an occupier, change a figure the
   * next day, and their copy and ours no longer say the same thing, which is
   * the single thing the issued-form rule exists to prevent. So the page says
   * which one it is. Absent means the caller did not say, and the page claims
   * neither rather than inventing an answer.
   */
  status?: 'draft' | 'issued';
  /** ISO timestamp the form was issued, where it has been. */
  issuedAt?: string;
  /**
   * A pump run at overload, where one was done.
   *
   * The department's form has no box for it — it records the duty in Part E and
   * stops there. Safe QLD's own flow test certificate requires 150% of duty
   * flow at 65% of duty pressure, so where the run was made the figures are
   * carried here and the check is answered instead of merely stated.
   */
  overload?: { flowLps: number; pressureKpa: number };
}

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A free-text box.
 *
 * The technician's own line breaks survive and everything else is escaped. A
 * comment reflowed into one paragraph loses its second point, which on this
 * form is routinely the one that matters — "held pressure" followed by "weep at
 * the level 3 landing valve".
 */
function comment(text: string | undefined, part: PartResult | 'refer-to-report'): string {
  if (!text?.trim()) return cell(undefined, part);
  return esc(text).replace(/\n/g, '<br />');
}

/**
 * A value cell.
 *
 * A missing reading is never blank. Inside a part the technician marked N/A it
 * prints N/A, and inside a live part it prints "Not recorded" — which is the
 * sentence somebody has to answer for, rather than a gap nobody notices.
 */
function cell(value: string | number | undefined | null, part: PartResult | 'refer-to-report'): string {
  if (value === undefined || value === null || value === '') {
    return part === 'na'
      ? '<span class="na">N/A</span>'
      : '<span class="missing">Not recorded</span>';
  }
  return esc(value);
}

/** One tick box with its label beside it, as the form prints them. */
function tick(label: string, on: boolean): string {
  return `<span class="tick"><span class="cb${on ? ' on' : ''}">${on ? '&#10007;' : ''}</span>${esc(label)}</span>`;
}

/**
 * The result boxes on the right of a part's dark band.
 *
 * The department prints PASS and FAIL and nothing else on Parts B, D, E and F.
 * Every other box in that band is Safe QLD's, and each one is marked, because
 * the band is the first place a reader's eye lands and an extra box there reads
 * as the department's.
 *
 * They are kept rather than dropped. N/A is the answer a technician actually
 * has for a part the job did not cover, and the alternative — three unticked
 * boxes — is indistinguishable from a part nobody filled in, which is the
 * ambiguity this whole document exists to remove.
 */
function resultBoxes(result: string, options: ResultOption[]): string {
  return `<span class="results">${options
    .map((o) => `<span class="rl">${esc(o.label)}${o.added ? '<sup>+</sup>' : ''}</span><span class="rb${
      o.value === result ? ' on' : ''}">${o.value === result ? '&#10007;' : ''}</span>`)
    .join('')}</span>`;
}

interface ResultOption {
  value: string;
  label: string;
  /** True for a box the department's form does not print. */
  added?: boolean;
}

const RESULT_OPTIONS: ResultOption[] = [
  { value: 'na', label: 'N/A', added: true },
  { value: 'pass', label: 'PASS' },
  { value: 'fail', label: 'FAIL' },
];

const FLOW_RESULT_OPTIONS: ResultOption[] = [
  { value: 'refer-to-report', label: 'Refer to Report', added: true },
  { value: 'pass', label: 'PASS' },
  { value: 'fail', label: 'FAIL' },
];

/** Part G is banded with no result boxes at all, so every one of ours is added. */
const PART_G_RESULT_OPTIONS: ResultOption[] = RESULT_OPTIONS.map((o) => ({ ...o, added: true }));

/** What the <sup>+</sup> on a band box means, said once at the foot of the page. */
export const ADDED_BOX_NOTE = 'A result box marked + is not on the department\'s form. '
  + 'The department prints PASS and FAIL; N/A is recorded here because a part the job did '
  + 'not cover is an answer, and three empty boxes are indistinguishable from a part nobody '
  + 'filled in. Part D\'s \u201cRefer to Report\u201d is recorded for the same reason.';

function band(title: string, boxes?: string): string {
  return `<div class="band"><span class="bandtitle">${esc(title)}</span>${boxes ?? ''}</div>`;
}

function note(text: string): string {
  return `<div class="note">${esc(text)}</div>`;
}

/** A row of one or two label/value pairs, which is how the form is laid out. */
function pair(a: [string, string], b?: [string, string]): string {
  if (!b) {
    return `<tr><td class="k">${esc(a[0])}</td><td class="v" colspan="3">${a[1]}</td></tr>`;
  }
  return `<tr><td class="k">${esc(a[0])}</td><td class="v">${a[1]}</td>`
    + `<td class="k">${esc(b[0])}</td><td class="v">${b[1]}</td></tr>`;
}

/**
 * A label across the first column and its value across the rest.
 *
 * The label is markup rather than escaped text, so a row the app added can
 * carry its "added" marker. Every label passed here is written in this file;
 * none of them comes off a form.
 */
/**
 * A reading in its own cell with its unit in the next one.
 *
 * How the department prints every pressure: "Boost pressure | ___ | kPa". The
 * app put the unit in the label — "Boost pressure (kPa)" — which reads fine and
 * is not what the form says, and more to the point it attached a unit to
 * "Not recorded" and to "N/A", so a box nobody filled carried a kPa. The unit
 * goes with the number and nothing else.
 */
function reading(
  value: number | string | undefined,
  unit: string,
  part: PartResult | 'refer-to-report',
): string {
  const has = value !== undefined && value !== null && value !== '';
  return `${cell(value, part)}${has ? ` <span class="u">${esc(unit)}</span>` : ''}`;
}

/**
 * The department's "___ L/s at ___ kPa" field, which is one field of two boxes.
 *
 * Half of it filled in has to print as half of it filled in — collapsing the
 * pair to "Not recorded" threw away a flow somebody had recorded — and the
 * half that is missing uses the page's own word for a missing reading rather
 * than a sentence of its own.
 */
function atPair(
  lps: number | undefined,
  kpa: number | undefined,
  part: PartResult | 'refer-to-report',
): string {
  if (lps === undefined && kpa === undefined) {
    return part === 'na' ? '<span class="na">N/A</span>' : '<span class="missing">Not recorded</span>';
  }
  const half = (v: number | undefined, unit: string): string => (v === undefined
    ? '<span class="missing">Not recorded</span>'
    : `${v} <span class="u">${unit}</span>`);
  return `${half(lps, 'L/s')} at ${half(kpa, 'kPa')}`;
}

function wide(label: string, value: string): string {
  return `<tr><td class="k">${label}</td><td class="v" colspan="3">${value}</td></tr>`;
}

// ---------------------------------------------------------------------------

function partA(form: Form72): string {
  const m = form.maintenanceTest;
  const grid = `<table class="mt">
    <tr><td></td><td class="mth">Annual</td><td class="mth">5 year</td></tr>
    <tr><td class="mtl">fire hydrant</td><td>${tick('', m.hydrantAnnual)}</td><td>${tick('', m.hydrantFiveYear)}</td></tr>
    <tr><td class="mtl">fire sprinkler</td><td>${tick('', m.sprinklerAnnual)}</td><td>${tick('', m.sprinklerFiveYear)}</td></tr>
    <tr><td class="mtl">combined</td><td>${tick('', m.combinedAnnual)}</td><td>${tick('', m.combinedFiveYear)}</td></tr>
  </table>`;

  /*
   * The department's own shape for the bottom of Part A.
   *
   * A "Test details" cell down the left spanning three rows — the test date,
   * the maintenance test grid and the time — with the date and the grid on one
   * line and the time below. The app printed no such cell, labelled the grid
   * row "Maintenance test" where the department labels the group, and put Time
   * beside the date instead of under it.
   */
  return `${band('Part A—Test details')}
  <table class="grid">
    ${wide('Site name', cell(form.siteName, 'pass'))}
    ${wide('Site address', cell(form.siteAddress, 'pass'))}
    ${wide('Contractor', cell(form.contractor, 'pass'))}
    <tr>
      <td class="grp" rowspan="2">Test details</td>
      <td class="k">Test date:</td><td class="v">${cell(formatAuDate(form.testDate), 'pass')}</td>
      <td class="k">Maintenance test:</td><td class="v">${grid}</td>
    </tr>
    <tr>
      <td class="k">Time:</td><td class="v" colspan="3">${cell(form.testTime, 'pass')}</td>
    </tr>
  </table>`;
}

function partB(form: Form72): string {
  const h = form.hydrostatic;
  const r = h.result;
  return `${band('Part B—Hydrant hydrostatic test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_B_NOTE)}
  ${/*
     * The department's Part B is two data rows, not three: boost and test
     * pressure on the first, then duration, end-of-test pressure and the loss
     * together on the second. The app put the loss on a row of its own, which
     * reads as a row the form does not have.
     */''}
  <table class="grid b">
    <tr>
      <td class="k">Boost pressure</td><td class="v">${reading(h.boostPressureKpa, 'kPa', r)}</td>
      <td class="k" colspan="2">Test pressure</td><td class="v" colspan="2">${reading(h.testPressureKpa, 'kPa', r)}</td>
    </tr>
    <tr>
      <td class="k">Duration of test</td><td class="v">${reading(h.durationMinutes, 'mins', r)}</td>
      <td class="k">End of test pressure</td><td class="v">${reading(h.endPressureKpa, 'kPa', r)}</td>
      <td class="k">Loss (if any):</td><td class="v">${reading(h.lossLpm, 'L/min', r)}</td>
    </tr>
    <tr><td class="k">Comments:</td><td class="v" colspan="5">${comment(h.comments, r)}</td></tr>
  </table>`;
}

/**
 * The four column heads the department prints across Part C.
 *
 * "Device/gauge 1" through "Device/gauge 4", in those words. The app used to
 * print "Device 1, Device 2, Gauge 1, Gauge 2", which reads as a form with two
 * device columns and two gauge columns — a shape the department's form does not
 * have, and one that tells a technician with three gauges that the third has
 * nowhere to go.
 */
export const DEPARTMENT_DEVICE_SLOTS = [
  'Device/gauge 1', 'Device/gauge 2', 'Device/gauge 3', 'Device/gauge 4',
] as const;

function partC(form: Form72, issues: FormIssue[]): string {
  // The department's four columns, filled by whatever the form holds. A column
  // nobody used prints as the department's empty column rather than being
  // dropped, and a fifth device the technician really did use is appended — the
  // part's own note says to describe further devices rather than leaving them
  // off, and a column is a better place for one than a sentence.
  const held = form.devices;
  const columns: { head: string; named?: string; device: TestDevice }[] = [
    ...DEPARTMENT_DEVICE_SLOTS.map((head, i) => {
      const device = held[i] ?? { slot: head, serialNumber: '' };
      // The department's head always prints. A slot the technician named
      // something else prints under it rather than replacing it — the head is
      // the department's label and the name is theirs, and a reader has to be
      // able to tell which is which.
      const own = device.slot?.trim();
      return { head, named: own && own !== head ? own : undefined, device };
    }),
    ...held.slice(DEPARTMENT_DEVICE_SLOTS.length).map((device) => ({
      head: device.slot?.trim() || 'Further device',
      named: undefined,
      device,
    })),
  ];
  const devices: TestDevice[] = columns.map((c2) => c2.device);

  // Every pressure on this form was read with this equipment, so the part is
  // rendered against the live result rather than N/A: a blank here is never
  // "not applicable".
  const c: PartResult = 'pass';
  // The label is markup rather than text, because one row carries an "added"
  // marker. Every label here is written in this file, none comes from a form.
  /*
   * A column nobody used is unused, not a column of missing readings.
   *
   * The department prints four and most hydrant tests use one or two, so three
   * columns of red "Not recorded" was the usual state of this part — red on
   * every row of every form, which is red a reader learns to ignore. The same
   * judgement deviceCalibration already makes: no serial number means an empty
   * slot on the form rather than a device somebody failed to describe.
   */
  const unused = (d: TestDevice): boolean => !d.serialNumber.trim();

  const row = (
    label: string,
    get: (d: TestDevice) => string | number | undefined,
    skip?: (d: TestDevice) => string | undefined,
  ): string =>
    `<tr><td class="k">${label}</td>${devices
      .map((d) => `<td class="v">${
        unused(d) ? '<span class="na">Not used</span>' : skip?.(d) ?? cell(get(d), c)
      }</td>`).join('')}</tr>`;

  /** A row that describes a gauge dial, answered on a device that has none. */
  const gaugeOnly = (d: TestDevice): string | undefined => (
    d.kind === 'flow-meter' ? '<span class="na">N/A for a flow meter</span>' : undefined
  );

  const kinds = form.flowDeviceKinds;
  const fromColumns = flowDeviceCalibrationFrom(form);
  const partCIssues = issues.filter((i) => i.part === 'C');

  return `${band('Part C—Hydrant test equipment/pressure gauges')}
  ${note(PART_C_NOTE)}
  <table class="grid">
    <tr><td class="k">Flow measuring device</td><td class="v" colspan="3">
      ${tick(FLOW_DEVICE_LABEL.orifice, kinds.includes('orifice'))}
      ${tick(FLOW_DEVICE_LABEL.mechanical, kinds.includes('mechanical'))}
      ${tick(FLOW_DEVICE_LABEL.electromagnetic, kinds.includes('electromagnetic'))}
      ${kinds.length === 0 ? '<span class="missing">Not answered</span>' : ''}
    </td></tr>
    ${/*
       * The two "Calibrated: __/__/__" fields the department prints on this
       * line. They sit beside the note that Part C is not required for orifice
       * testing, which is what identifies them: they are the calibration of the
       * mechanical and the electromagnetic device, the two kinds that have one.
       * The app printed neither, so a technician filling our page had nowhere
       * to put a date the paper asks for twice.
       */''}
    <tr>
      <td class="k" colspan="2">Part C not required for orifice testing</td>
      ${CALIBRATED_FLOW_DEVICE_KINDS.map((kind) => `<td class="v">${
  esc(FLOW_DEVICE_LABEL[kind])} calibrated: ${
  form.flowDeviceCalibrated?.[kind]?.trim()
    ? esc(formatAuDate(form.flowDeviceCalibrated[kind]))
    : !kinds.includes(kind)
      ? '<span class="na">Not used</span>'
      : fromColumns
        // Read off the equipment list below, which asks for the same date. It
        // says so: a figure in one of the department's boxes that nobody typed
        // has to carry where it came from.
        ? `${esc(formatAuDate(fromColumns.date))} <span class="extra">from ${esc(fromColumns.from)}</span>`
        : '<span class="missing">Not recorded</span>'
}</td>`).join('')}
    </tr>
  </table>
  <table class="grid devices">
    <tr><td class="k"></td>${columns.map((col, i) => `<td class="dh">${esc(col.head)}${
  i >= DEPARTMENT_DEVICE_SLOTS.length ? ' <span class="extra">added</span>' : ''}${
  col.named ? `<br /><span class="extra">${esc(col.named)}</span>` : ''}</td>`).join('')}</tr>
    ${/*
       * The one row where a blank is the point. A column with a device on it
       * and no serial number is a column somebody started, and that is the
       * cell to be red about — so this row is not softened by `unused`.
       */''}
    <tr><td class="k">Serial number</td>${columns.map((col, i) => `<td class="v">${
  col.device.serialNumber.trim()
    ? esc(col.device.serialNumber)
    : i < held.length
      ? '<span class="missing">Not recorded</span>'
      : '<span class="na">Not used</span>'
}</td>`).join('')}</tr>
    ${row('Date calibrated', (d) => formatAuDate(d.dateCalibrated))}
    ${row('Correction certificate', (d) => d.calibrationCertificate)}
    ${/*
       * Not one of the department's six rows.
       *
       * Part C's own note says the correction factor must be kPa or a
       * percentage, and the printed grid has nowhere to put one — it has a
       * "Correction certificate" row and that is a document reference, not a
       * figure. So the row exists, because every pressure on the page is wrong
       * by that factor until it is applied, and it is marked as ours so a
       * reader is never shown an added row as the department's.
       */
  row('Correction factor (kPa or %) <span class="extra">added</span>', (d) => d.correctionFactor)}
    ${/*
       * Two rows that describe a dial.
       *
       * A flow meter has no 100 mm face and no kPa increment, and printing
       * "Not recorded" in red against them says a measurement is missing when
       * the measurement does not exist. A device recorded as a meter answers
       * them "N/A for a flow meter" instead, which is an answer rather than an
       * omission — the same distinction the rest of this page is built on.
       */''}
    ${row('65/100/150 mm face', (d) => d.faceSize, gaugeOnly)}
    ${row('Digital reader', (d) => (d.digitalReader === undefined ? undefined : d.digitalReader ? 'Yes' : 'No'))}
    ${row('Increments (kPa)', (d) => d.incrementsKpa, gaugeOnly)}
    ${/*
       * Also ours. The department's grid prints a calibration date and leaves
       * the reader to know the interval; one of Safe QLD's two flow meters is
       * certified for its service life rather than for twelve months, and a
       * reader comparing that date with the test date would otherwise conclude
       * the meter was a year out. So the basis each device was accepted on
       * prints beside the date that was accepted.
       */
  row('Calibration basis <span class="extra">added</span>',
    (d) => (!d.serialNumber.trim() ? undefined
      : d.calibrationBasis === 'service-life'
        // The manufacturer's claim, with the conditions it carries. Printed
        // unconditionally it reads as a guarantee, and both conditions are
        // things only the person holding the meter can answer.
        ? "Manufacturer certifies for the device's service life, absent fault or damage, "
          + 'unless an authority stipulates recertification'
        : `${CALIBRATION_MONTHS} month interval`))}
  </table>
  ${partCIssues.length
    ? `<div class="issues"><b>Test equipment</b><ul>${partCIssues
      .map((i) => `<li${i.blocking ? ' class="blocking"' : ''}>${esc(i.message)}</li>`).join('')}</ul></div>`
    : ''}`;
}

/**
 * How many hydrant locations the readings actually depend on.
 *
 * The department prints four location fields and its flow table proves one,
 * two, three or four hydrants at a time. A test run on two hydrants has no
 * third location to give, and calling that a missing reading is the same
 * mistake as flagging the flow rates nobody ran: it puts red on the page where
 * nothing is wrong, and a reader who learns to skip red will skip the row that
 * matters.
 *
 * A location the readings *do* depend on is a different thing. Pressures in the
 * "Hydrants 1, 2 and 3" column with no third hydrant named is a gap somebody
 * has to answer for, and it stays red.
 */
/** The four hydrant location fields the department prints in Part D. */
export const PART_D_LOCATION_SLOTS = 4;

export function hydrantLocationsNeeded(test: FlowTest): number {
  let needed = 0;
  for (const row of test.rows) {
    if (row.hydrants1234Kpa !== undefined) needed = Math.max(needed, 4);
    else if (row.hydrants123Kpa !== undefined) needed = Math.max(needed, 3);
    else if (row.hydrants12Kpa !== undefined) needed = Math.max(needed, 2);
    else if (row.hydrant1Kpa !== undefined) needed = Math.max(needed, 1);
  }
  return needed;
}

function partD(form: Form72): string {
  const d = form.flowTest;
  const r = d.result;
  const needed = hydrantLocationsNeeded(d);
  const loc = (n: number): string => {
    const value = d.hydrantLocations[n - 1];
    if (value?.trim()) return esc(value);
    if (r === 'na') return '<span class="na">N/A</span>';
    return n <= needed
      ? '<span class="missing">Not recorded</span>'
      : '<span class="na">Not used</span>';
  };
  const rows = flowTableRows(d);

  /*
   * "System requirements ___ L/s at ___ kPa" is one field on the department's
   * form, so it prints as one — and half of it filled in prints as half of it
   * filled in, rather than as a pair somebody could read as complete.
   */
  const requirement = atPair(d.requiredLps, d.requiredKpa, r);

  // The achieved pair, with the free-text line kept for forms signed before
  // the two numbers existed.
  const achieved = d.achievedLps !== undefined || d.achievedKpa !== undefined
    ? atPair(d.achievedLps, d.achievedKpa, r)
    : cell(d.systemAchieved, r);

  /*
   * The department's grouped first column.
   *
   * Two headings down the left — "Nozzles" over the three bores, "Other
   * portable testing devices" over the five metered rates — each spanning its
   * rows, with the size in the column beside it. Printed flat, with the group
   * repeated on every row, the table reads as eight unrelated lines and a
   * reader has to know that "19 mm" is a nozzle bore and "100 mm" on the page
   * above was a gauge face.
   */
  const groupSpans: { group: FlowRowGroup; from: number; count: number; standard: boolean }[] = [];
  rows.forEach(({ row, standard }, i) => {
    const group = flowRowGroup(row);
    const last = groupSpans[groupSpans.length - 1];
    /*
     * A row the department does not print gets its own group cell.
     *
     * Merged into the span above it, a 25 L/s reading sat under "Other portable
     * testing devices" as though the department printed a 25 L/s line — the
     * "added" marker on the row label was the only thing saying otherwise, and
     * it is three columns away from the heading doing the implying.
     */
    const joins = last
      && last.group === group
      && last.standard === standard
      && last.from + last.count === i;
    if (joins) last.count += 1;
    else groupSpans.push({ group, from: i, count: 1, standard });
  });
  const spanAt = new Map(groupSpans.map((sp) => [sp.from, sp]));

  const table = `<table class="grid flow">
    <tr>
      <td class="dh" colspan="2">Size/flow rate</td><td class="dh">Device/gauge no. (Part C)</td>
      <td class="dh">Hydrant 1 only</td><td class="dh">Hydrants 1 and 2</td>
      <td class="dh">Hydrants 1, 2 and 3</td><td class="dh">Hydrants 1, 2, 3 and 4</td>
    </tr>
    ${rows.map(({ row, standard }, i) => {
    // A line with nothing against it was not run, which is not the same thing
    // as a reading somebody forgot to write down. The department prints all
    // eight lines whether or not the job needs them, so most forms legitimately
    // leave most of them alone — flagging those in red would train a reader to
    // ignore the flag on the row that matters.
    const untouched = flowRowUntouched(row);
    const devicesCell = untouched
      ? (r === 'na' ? '<span class="na">N/A</span>' : '<span class="na">Not run</span>')
      : cell(row.devices, r);

    /*
     * Three states per cell, not two.
     *
     * A reading prints with its unit. A cell to the right of the last reading
     * in its row was not run — a 19 mm nozzle proved at one hydrant is an
     * ordinary complete test, and red in its other three columns is the same
     * mistake as flagging the rates nobody ran. A cell with readings on both
     * sides of it is a genuine gap and stays red.
     *
     * The unit goes with the number. "Not recorded kPa" was what printing it
     * unconditionally produced.
     */
    const pressure = (column: FlowRowColumn): string => {
      switch (flowCellState(row, column)) {
        case 'read': return `${esc(row[column])} <span class="u">kPa</span>`;
        case 'not-run': return r === 'na'
          ? '<span class="na">N/A</span>'
          : '<span class="na">Not run</span>';
        default: return '<span class="missing">Not recorded</span>';
      }
    };

    const sp = spanAt.get(i);
    return `<tr>
      ${sp ? `<td class="grp" rowspan="${sp.count}">${esc(FLOW_ROW_GROUP_LABEL[sp.group])}${
  sp.standard ? '' : ' <span class="extra">added</span>'}</td>` : ''}
      <td class="k">${esc(flowRowLabel(row))}${standard ? '' : ' <span class="extra">added</span>'}</td>
      <td class="v">${devicesCell}</td>
      <td class="v">${pressure('hydrant1Kpa')}</td>
      <td class="v">${pressure('hydrants12Kpa')}</td>
      <td class="v">${pressure('hydrants123Kpa')}</td>
      <td class="v">${pressure('hydrants1234Kpa')}</td>
    </tr>`;
  }).join('')}
    <tr><td class="k" colspan="2">System achieved:</td><td class="v" colspan="5">${achieved}</td></tr>
  </table>`;

  const extras = rows.filter((x) => !x.standard);

  // The register prefills every hydrant on the site and the department prints
  // four fields. A fifth location that was typed or prefilled is listed here
  // rather than dropped — the same treatment as a flow rate the table has no
  // row for, and for the same reason: a reader cannot query what the page does
  // not mention.
  const spareLocations = d.hydrantLocations
    .slice(PART_D_LOCATION_SLOTS)
    .filter((x) => x.trim());

  return `${band('Part D—Hydrant system flow test', resultBoxes(r, FLOW_RESULT_OPTIONS))}
  ${note(PART_D_NOTE)}
  ${r === 'na'
    // The department's Part D has no N/A box. Leaving all three unticked would
    // read as an unanswered part, so the reason is written out instead.
    ? '<div class="stated">Recorded as not applicable. Part D of the department\'s form carries no '
      + 'N/A box, so none of the three boxes above is ticked; this line says why.</div>'
    : ''}
  <table class="grid">
    ${/*
       * One and three on the first line, two and four on the second.
       *
       * That is how the department lays them out — the four fields run down the
       * two columns rather than across the rows — and somebody comparing our
       * page against theirs field by field should find them in the same places.
       */''}
    ${pair(['Hydrant 1 location', loc(1)], ['Hydrant 3 location', loc(3)])}
    ${pair(['Hydrant 2 location', loc(2)], ['Hydrant 4 location', loc(4)])}
    ${pair(
    ['System requirements', requirement],
    ['Static pressure', reading(d.staticPressureKpa, 'kPa', r)],
  )}
    ${pair(
    ['On-site pump set installed', `${tick('Yes', d.onSitePumpSet === true)}${tick('No', d.onSitePumpSet === false)}${
      d.onSitePumpSet === undefined
        // An N/A part answers its boxes N/A, like every other box on it; only a
        // live part with the question skipped is an omission.
        ? r === 'na' ? ' <span class="na">N/A</span>' : ' <span class="missing">Not answered</span>'
        : ''}`],
    ['Pressure zone number:', cell(d.pressureZone, r)],
  )}
    ${/*
       * Ours. Parts B, E, F and G carry a Comments field and Part D does not —
       * the department's Part D ends at the pressure zone number. It is kept
       * because a flow test that did not make its duty needs a sentence
       * somewhere, and marked because it is not one of their boxes.
       */''}
    ${wide('Comment <span class="extra">added</span>', comment(d.comment, r))}
  </table>
  ${table}
  ${spareLocations.length
    ? `<div class="stated">${spareLocations.length} further hydrant location${
      spareLocations.length === 1 ? ' is' : 's are'} recorded against this test than the `
      + `department's form prints fields for (${esc(spareLocations.join('; '))}). `
      + `${spareLocations.length === 1 ? 'It is' : 'They are'} listed here rather than dropped; the `
      + 'four fields above are the ones the pressure columns refer to.</div>'
    : ''}
  ${extras.length
    ? `<div class="stated">${extras.length} flow rate${extras.length === 1 ? ' was' : 's were'} recorded `
      + `that the department's table does not print `
      + `(${esc(extras.map((x) => flowRowLongLabel(x.row)).join(', '))}). `
      + `${extras.length === 1 ? 'It is' : 'They are'} shown above marked "added" rather than `
      + 'dropped to fit the printed layout.</div>'
    : ''}`;
}

function partE(form: Form72, input: Form72DocumentInput): string {
  const b = form.booster;
  const r = b.result;

  const loss = resolveFrictionalLoss(b);
  const gaps = frictionalLossGaps(b);
  const lossCell = loss.kpa !== undefined
    ? `${loss.kpa} kPa${loss.source === 'stated' ? ' <span class="extra">(stated)</span>' : ''}`
    : r === 'na' ? '<span class="na">N/A</span>' : '<span class="missing">Not calculated</span>';

  const head = b.highestHydrantAboveBoosterM !== undefined
    ? elevationHeadKpa(b.highestHydrantAboveBoosterM)
    : undefined;

  // The form's own box says "calculated frictional loss", and two things can
  // fill it: the subtraction this app does from three readings, or a figure the
  // technician worked out and typed. The calculated one wins where it exists,
  // because it carries its working onto the page — but the one it beat is
  // printed too wherever the two disagree. A silent override is the worst of
  // the three outcomes: the licensee signs a number they did not arrive at and
  // cannot see was changed.
  const working = loss.source === 'calculated'
    ? `Calculated: ${b.boostPressureKpa} kPa boost less ${head} kPa of elevation head over `
      + `${b.highestHydrantAboveBoosterM} m less ${b.hydrantResidualKpa} kPa residual at the hydrant.`
    : loss.source === 'stated'
      ? `Stated by the technician as ${loss.kpa} kPa. It is not calculated here — this form does not `
        + `record ${gaps.join(', ')} — so the figure stands on whoever typed it rather than on `
        + 'readings this document holds.'
      : `Not calculated — this form does not record ${gaps.join(', ')}. A frictional loss worked out `
        + 'from an assumed figure is indistinguishable on the page from a measured one, and this form '
        + 'is signed.';

  const lossConflict = loss.disagreesWithKpa !== undefined
    ? `<div class="stated fail"><b>Frictional loss — two different figures.</b> The readings give `
      + `${esc(loss.kpa)} kPa; ${esc(loss.disagreesWithKpa)} kPa was entered as the stated loss. `
      + 'The calculated figure is printed above because the page can show its working. More than '
      + `${FRICTIONAL_LOSS_TOLERANCE_KPA} kPa apart is not rounding, so one of the two is wrong and `
      + 'the licensee is the one who can say which.</div>'
    : '';

  /*
   * "System requirements ___ L/s at ___ kPa" is one field, and half of it
   * filled in must print as half of it filled in. Requiring both collapsed a
   * flow somebody had recorded into "Not recorded" for the pair — the same
   * mistake Part D's requirement had, in the part the overload check is worked
   * out from.
   */
  const req = atPair(b.requiredLps, b.requiredKpa, r);

  const check = b.requiredLps !== undefined && b.requiredKpa !== undefined
    ? overloadCheck(b.requiredLps, b.requiredKpa, input.overload)
    : undefined;

  let overloadBlock = '';
  if (r === 'na' && input.overload) {
    // The run is stored beside the parts, so an N/A booster part would
    // otherwise drop a reading somebody took on site off the page entirely.
    overloadBlock = '<div class="stated"><b>150% overload check</b> — an overload run is recorded '
      + `against this form (${esc(input.overload.flowLps)} L/s at ${esc(input.overload.pressureKpa)} `
      + 'kPa) while Part E is marked not applicable. One of the two is wrong, and the reading is '
      + 'shown rather than discarded.</div>';
  } else if (r !== 'na') {
    if (!check) {
      overloadBlock = '<div class="stated"><b>150% overload check</b> — cannot be stated. Part E does '
        + 'not record the system requirement as a flow and a pressure, and the check is a percentage '
        + 'of both.</div>';
    } else if (check.achieved === undefined) {
      overloadBlock = `<div class="stated"><b>150% overload check</b> — ${esc(check.note)} No overload `
        + 'run is recorded on this form, so the requirement is stated rather than answered.</div>';
    } else if (check.achieved) {
      overloadBlock = `<div class="stated pass"><b>150% overload check — achieved.</b> ${esc(check.note)} `
        + `Measured ${esc(input.overload?.flowLps)} L/s at ${esc(input.overload?.pressureKpa)} kPa.</div>`;
    } else {
      overloadBlock = `<div class="stated fail"><b>150% overload check — not achieved.</b> ${esc(check.note)}`
        + `${check.shortfallKpa !== undefined
          ? ` Measured ${esc(input.overload?.pressureKpa)} kPa, short by ${check.shortfallKpa} kPa.` : ''}</div>`;
    }
  }

  return `${band('Part E—Pump appliance booster test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_E_NOTE)}
  <table class="grid">
    ${pair(['Hydrant locations', cell(b.hydrantLocations, r)],
    ['Height of highest hydrant above booster', reading(b.highestHydrantAboveBoosterM, 'm', r)])}
    ${pair(['System requirements', req], ['Static pressure', reading(b.staticPressureKpa, 'kPa', r)])}
    ${pair(['Pump inlet pressure', reading(b.pumpInletKpa, 'kPa', r)], ['Pump discharge pressure', reading(b.pumpDischargeKpa, 'kPa', r)])}
    ${pair(['Boost pressure', reading(b.boostPressureKpa, 'kPa', r)], ['Calculated frictional loss', lossCell])}
    ${/*
       * Ours, and it had to be printed.
       *
       * The department asks for a calculated frictional loss and gives no box
       * for the residual it is calculated from. The working beside the figure
       * cited a number — "less 900 kPa residual at the hydrant" — that appeared
       * nowhere else on the page, so a reader could not check the subtraction
       * they were being shown. Now they can.
       */''}
    ${wide('Residual at the hydrant <span class="extra">added</span>', reading(b.hydrantResidualKpa, 'kPa', r))}
    ${wide('Comments:', comment(b.comments, r))}
  </table>
  ${r === 'na' ? '' : `<div class="stated">${esc(working)}</div>`}
  ${lossConflict}
  ${overloadBlock}
  ${/*
     * One line, where the added blocks are, saying whose they are. The boxed
     * notes down this page carry working and checks the department's form has
     * no room for, and a reader has to be able to tell them from its text.
     */''}
  ${r === 'na' && !input.overload ? '' : '<div class="subnote">The boxed notes above are not part of '
    + "the department's form: they are the working behind the frictional loss and the 150% overload "
    + 'check, which Form 72 has no field for.</div>'}`;
}

function partF(form: Form72): string {
  const f = form.sprinklerHydrostatic;
  const r = f.result;
  return `${band('Part F—Sprinkler hydrostatic test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_F_NOTE)}
  <table class="grid">
    ${pair(['Pressure', reading(f.pressureKpa, 'kPa', r)], ['Time held', reading(f.timeHeldMinutes, 'mins', r)])}
    ${wide('Comments:', comment(f.comments, r))}
  </table>`;
}

function partG(form: Form72): string {
  const g = form.sprinklerFlow;
  const r = g.result;

  const outcomeBoxes = (o: 'pass' | 'fail' | undefined): string =>
    `${tick('Pass', o === 'pass')}${tick('Fail', o === 'fail')}${
      o !== undefined ? ''
        // Undecided on a live part is an omission; on an N/A part it is the
        // answer. Printing neither left two empty boxes and no word on the one
        // part of this form whose Pass and Fail boxes are the department's own.
        : r === 'na' ? ' <span class="na">N/A</span>' : ' <span class="missing">Not decided</span>'}`;

  // The department prints two test points and its own note says multiple points
  // may be required — meaning one is often the right answer. An unused second
  // point says so, rather than showing four boxes flagged as missing readings.
  const unused = (p: SprinklerTestPoint | undefined): boolean => !p || (!p.location.trim()
    && p.requiredFlowLpm === undefined && p.resultFlowLpm === undefined
    && p.requiredPressureKpa === undefined && p.resultPressureKpa === undefined);

  // Each of the department's two lines carries its own Pass / Fail boxes, and
  // the technician ticks them on site. The app can also work the comparison out
  // of the two figures beside the boxes, and the two answers are not the same
  // claim: 540 L/min required and 538 achieved is a fail by subtraction and may
  // be a pass inside the standard's tolerance, which only the licensee can say.
  // So the tick is what prints, the subtraction is the cross-check, and a
  // disagreement is written out under the table rather than resolved here.
  const disagreements: string[] = [];

  const point = (n: number, p: SprinklerTestPoint | undefined, extraPoint = false): string => {
    const spare = unused(p);
    const c = (v: string | number | undefined): string =>
      (spare ? '<span class="na">Not used</span>' : cell(v, r));
    const line = (
      what: string,
      typed: 'pass' | 'fail' | undefined,
      required: number | undefined,
      result: number | undefined,
    ): string => {
      /*
       * An unused point's result cell gets the same word as the rest of its
       * row. The department's two boxes still print, both unticked — never a
       * tick the technician did not make — with the row's own answer beside
       * them, because two empty boxes and no word is exactly the blank this
       * page exists to remove. `c` rather than a literal, so this cell can
       * never say something different from the five beside it.
       */
      if (spare) return `${tick('Pass', false)}${tick('Fail', false)} ${c(undefined)}`;
      const derived = testPointOutcome(required, result);
      if (typed !== undefined && derived !== undefined && typed !== derived) {
        disagreements.push(
          `Test point ${n} ${what} is ticked ${typed === 'pass' ? 'Pass' : 'Fail'} against `
          + `${result} of ${required} required, which reads ${derived === 'pass' ? 'Pass' : 'Fail'} `
          + 'on the figures alone.',
        );
      }
      // The derived answer fills the boxes only where nobody ticked them, so a
      // reader is never shown a tick the technician did not make.
      return `${outcomeBoxes(typed ?? derived)}${
        typed === undefined && derived !== undefined ? ' <span class="extra">from the figures</span>' : ''}`;
    };
    return `
    ${/*
       * The department prints three rows per test point, not four: the point
       * and its location share the first one. A sub-header of its own followed
       * by a Location row is a row the form does not have.
       */''}
    <tr>
      <td class="sub">Test point ${n}${extraPoint ? ' <span class="extra">added</span>' : ''}</td>
      <td class="k">Location</td><td class="v" colspan="2">${c(p?.location)}</td>
    </tr>
    ${/*
       * The department's order on each of these two lines is: the requirement,
       * then the Pass and Fail boxes, then what was achieved. Ours put the
       * achieved value before the boxes, which reads as a box ticked about the
       * figure to its left rather than about the one to its right.
       */''}
    <tr>
      <td class="k">Required flow rate</td><td class="v">${spare ? c(undefined) : reading(p?.requiredFlowLpm, 'L/min', r)}</td>
      <td class="v">${line('flow', p?.flowResult, p?.requiredFlowLpm, p?.resultFlowLpm)}</td>
      <td class="v">${c(p?.resultFlowLpm)}${p?.resultFlowLpm !== undefined ? ' <span class="u">L/min</span>' : ''}</td>
    </tr>
    <tr>
      <td class="k">Required pressure</td><td class="v">${spare ? c(undefined) : reading(p?.requiredPressureKpa, 'kPa', r)}</td>
      <td class="v">${line('pressure', p?.pressureResult, p?.requiredPressureKpa, p?.resultPressureKpa)}</td>
      <td class="v">${c(p?.resultPressureKpa)}${p?.resultPressureKpa !== undefined ? ' <span class="u">kPa</span>' : ''}</td>
    </tr>`;
  };

  const extra = g.testPoints.slice(2);

  // "Test Results l/m@kPa" sits opposite the block plan figure, so it is the
  // achieved pair for the same system. It is taken from test point 1 rather
  // than typed again, and left unanswered unless both halves were measured —
  // half a pair against a block plan figure invites the wrong comparison.
  const first = g.testPoints[0];
  const achievedFrom = first?.resultFlowLpm !== undefined && first.resultPressureKpa !== undefined
    ? `${first.resultFlowLpm} L/min at ${first.resultPressureKpa} kPa`
    : undefined;
  /*
   * The department's box has no field of its own behind it: this pair is test
   * point 1's measured result, read off the line below rather than typed
   * again. It says so, for the reason the derived Pass/Fail boxes below say so
   * — a reader must never be shown a figure in one of the department's boxes
   * that the licensee did not write.
   */
  const achieved = achievedFrom !== undefined
    ? `${esc(achievedFrom)} <span class="extra">from test point 1</span>`
    : cell(undefined, r);

  // Built before the table string so the rows have run and filled it.
  const rows = `
    ${point(1, g.testPoints[0])}
    ${point(2, g.testPoints[1])}
    ${extra.map((p, i) => point(3 + i, p, true)).join('')}`;

  /*
   * Part G is the one part the department bands with no result boxes at all.
   * Its Pass and Fail boxes are on each test point's two lines, not on the
   * part. So all three boxes here are Safe QLD's, and all three say so.
   */
  return `${band('Part G—Sprinkler system flow test', resultBoxes(r, PART_G_RESULT_OPTIONS))}
  ${note(PART_G_NOTE)}
  <table class="grid">
    ${pair(['System specifications (block plan):', cell(g.systemSpec, r)], ['Test results:', achieved])}
    ${rows}
    <tr>
      <td class="k">Running test</td>
      <td class="k" colspan="2">Installation gauge pressure:</td>
      <td class="v">${reading(g.runningTestGaugeKpa, 'kPa', r)}</td>
    </tr>
    ${wide('Comments:', comment(g.comments, r))}
  </table>
  ${disagreements.length
    ? `<div class="stated fail"><b>Ticked result against the figures.</b> ${
      esc(disagreements.join(' '))} The tick is what prints — a reading inside the standard's `
      + 'tolerance is a pass the subtraction cannot see — but the two are shown apart rather than '
      + 'one being quietly replaced by the other.</div>'
    : ''}
  ${extra.length
    ? `<div class="stated">${extra.length} further test point${extra.length === 1 ? '' : 's'} recorded. `
      + "The department's form prints two; the rest are added above rather than left off.</div>"
    : ''}`;
}

function partH(form: Form72): string {
  const critical = form.criticalDefectsIdentified;
  const repairs = form.repairsRequired;

  const yesNo = (
    value: boolean | undefined,
    yes: string,
    no: string,
  ): string => `<div class="yn">${tick('Yes', value === true)}<span class="ynt">${esc(yes)}</span></div>`
    + `<div class="yn">${tick('No', value === false)}<span class="ynt">${esc(no)}</span></div>`
    + (value === undefined ? '<div class="missing">Not answered</div>' : '');

  return `${band('Part H—Compliance')}
  <table class="grid">
    <tr><td class="k">Critical defects identified</td><td class="v" colspan="3">${
  yesNo(critical, 'Give owner/occupier a critical defect notice',
    'No action required in relation to critical defects at this time')}</td></tr>
    <tr><td class="k">Repairs/corrective actions taken</td><td class="v" colspan="3">${
  yesNo(repairs, "Attach details (including action and date taken) as part of Licensee's report",
    'No action required in relation to repairs/corrective actions at this time')}</td></tr>
    <tr><td class="k">System</td><td class="v" colspan="3">${
  tick('Pass', form.systemResult === 'pass')}${tick('Fail', form.systemResult === 'fail')}</td></tr>
    ${/*
       * Not one of the department's rows. Part H prints the System Pass/Fail
       * pair and nothing else; the note is where the app keeps what the
       * technician wrote about the result, so it says it is ours.
       */''}
    ${wide('System notes: <span class="extra">added</span>', comment(form.systemNotes, form.systemResult))}
  </table>
  ${form.systemResult === 'na'
    // The department's System row carries Pass and Fail and nothing else. An
    // N/A box added here would be Safe QLD's box printed inside the
    // department's part, where a reader has no way to tell the two apart — so
    // neither box is ticked and the reason is written out, as in Part D.
    ? '<div class="stated">Recorded as not applicable. The department\'s System row carries only '
      + 'Pass and Fail, so neither is ticked; this line says why, rather than a box being added to '
      + 'the department\'s form.</div>'
    : ''}`;
}

/**
 * The signature, as a signature.
 *
 * It is stored as a data URI, and the page printed it through the ordinary
 * cell renderer — which escapes it and lays it out as text. A signed form came
 * out with "data:image/png;base64,iVBORw0KG..." in the box where the signature
 * belongs, which is the one field on the document that cannot be a string.
 */
function signatureCell(signature: string | undefined): string {
  const v = signature?.trim();
  if (!v) return '<span class="missing">Not signed</span>';
  if (!/^data:image\//.test(v)) {
    // Something else was stored there. Printed as written rather than dropped
    // — a typed name in the signature box is a fact about the document.
    return esc(v);
  }
  return `<img class="sig" src="${esc(v)}" alt="Licensee signature" />`;
}

function partI(form: Form72): string {
  return `${band('Part I—Signature')}
  <div class="decl">${esc(DECLARATION)}</div>
  <table class="grid sig">
    ${pair(['Licensee name', cell(form.licenseeName, 'pass')], ['Licensee signature', signatureCell(form.signature)])}
    ${pair(['Licence no. (QBCC/PIC)', cell(form.licenceNumber, 'pass')],
    // Not every job has one, so its absence is answered rather than flagged.
    ['Licensee report no.', form.licenseeReportNumber?.trim()
      ? esc(form.licenseeReportNumber) : '<span class="na">None</span>'])}
  </table>`;
}

/**
 * The attachment page, after Part I.
 *
 * Everything on it is a fact about the test that the department's form has no
 * box for, and that is exactly why it prints here rather than inside a part.
 * A reader has to be able to tell the department's form from what Safe QLD
 * added to it — a line inserted into Part A would be indistinguishable from the
 * department's own, and the first person to notice would be whoever is
 * challenging the document.
 *
 * Part H sends repair details to "the Licensee's report", a separate document
 * that routinely does not travel with the form. The defect list is that
 * attachment, bound to the form that records the defects.
 *
 * The whole section is left off a form that holds none of it, so a test where
 * nobody typed any of these fields prints as the department's form and nothing
 * else.
 */
function attachment(form: Form72): string {
  const held: [string, string | undefined][] = [
    ['Building owner', form.owner],
    ['Owner contact', form.ownerContact],
    ['Building classification (BCA class)', form.buildingClassification],
    ['Technician who carried out the work', form.technician],
    ['Qualification / licence held', form.qualification],
  ];
  const filled = held.filter(([, v]) => v?.trim());
  const defects = form.defects.filter((d) => d.description.trim() || d.critical);

  if (!filled.length && !defects.length) return '';

  const criticals = defects.filter((d) => d.critical).length;

  const defectRow = (d: FormDefect, n: number): string => `
    <tr>
      <td class="k">${n}</td>
      <td class="v" colspan="2">${d.description.trim()
    ? esc(d.description)
    : '<span class="missing">No description recorded</span>'}</td>
      <td class="v">${tick('Critical', d.critical)}</td>
    </tr>`;

  // Its own page. The separation between the department's form and what Safe
  // QLD added to it is the whole point of this section, and a page break is the
  // one way of saying it that survives being printed and photocopied.
  return `<div class="attachpage">
  ${band('Attachment — not part of the department\'s form')}
  ${note('Facts about this test that Form 72 has no field for, and the defect list Part H refers to '
    + "the licensee's report. Added to the department's form, not written into it.")}
  ${filled.length
    ? `<table class="grid">
    ${filled.map(([label, value]) => wide(label, esc(value))).join('')}
  </table>`
    : ''}
  ${defects.length
    ? `<table class="grid">
    <tr><td class="dh">#</td><td class="dh" colspan="2">Defect</td><td class="dh">Critical</td></tr>
    ${defects.map((d, i) => defectRow(d, i + 1)).join('')}
  </table>
  <div class="stated">${defects.length} defect${defects.length === 1 ? '' : 's'} recorded${
  criticals
    ? `, ${criticals} of them critical. A critical defect obliges the owner or occupier to be given `
      + 'a critical defect notice — Part H above is where that obligation is answered.'
    : ', none of them critical.'}</div>`
    : `<div class="stated">No defects were recorded against this test.${
      form.repairsRequired === true
        ? ' Part H says repairs or corrective actions are required, so the details are in the '
          + "licensee's report rather than here."
        : ''}</div>`}
  </div>`;
}

const CSS = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm 10mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5px; color: #1b1b1b; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          background: #1F3864; color: #fff; padding: 10px 12px; }
  .head h1 { font-size: 16px; margin: 0; letter-spacing: -0.2px; }
  .head .sub { font-size: 11px; font-weight: 700; margin-top: 2px; }
  .head .right { text-align: right; font-size: 8.5px; line-height: 1.5; }
  /* Ours, and shaped so it cannot be mistaken for the department's masthead. */
  .ourstrip { display: flex; gap: 10px; align-items: baseline; padding: 0 2px 5px;
              font-size: 8px; color: #444; }
  .ourstrip .who { font-weight: 700; color: #1b1b1b; letter-spacing: 0.3px; }
  .ourstrip .what { font-weight: 700; color: #1F3864; }
  .ourstrip .ver { margin-left: auto; color: #666; }
  .intro { background: #EDF0F7; border: 1px solid #C7CEE0; border-top: none;
           padding: 7px 9px; font-size: 8px; line-height: 1.45; }
  .band { background: #1F3864; color: #fff; padding: 6px 10px; margin-top: 12px;
          display: flex; justify-content: space-between; align-items: center; }
  .bandtitle { font-size: 11px; font-weight: 700; }
  .results { font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px; }
  .rl { margin-left: 10px; margin-right: 4px; }
  .rb { display: inline-block; width: 11px; height: 11px; border: 1px solid #fff; background: #fff;
        color: #1F3864; text-align: center; line-height: 11px; font-size: 9px; vertical-align: -1px; }
  .rb.on { background: #fff; }
  .note { background: #F5F6FA; border: 1px solid #D5D8E4; border-top: none;
          padding: 5px 9px; font-size: 7.5px; line-height: 1.45; color: #333; }
  .subnote { padding: 3px 2px; font-size: 7.5px; color: #444; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.grid td { border: 1px solid #8C8C8C; padding: 4px 6px; vertical-align: top; }
  td.k { background: #F2F2F2; font-weight: 700; width: 24%; }
  td.v { width: 26%; }
  td.dh { background: #D6DCE8; font-weight: 700; font-size: 8.5px; }
  td.sub { background: #D6DCE8; font-weight: 700; }
  table.flow td { width: auto; }
  table.devices td.k { width: 22%; }
  .tick { margin-right: 14px; white-space: nowrap; }
  .cb { display: inline-block; width: 11px; height: 11px; border: 1px solid #333; background: #fff;
        text-align: center; line-height: 11px; font-size: 9px; margin-right: 4px; vertical-align: -1px; }
  .cb.on { font-weight: 700; }
  .yn { margin-bottom: 2px; }
  .ynt { color: #333; }
  .na { color: #666; font-style: italic; }
  .missing { color: #B00020; font-style: italic; }
  .extra { color: #666; font-style: italic; font-size: 7.5px; }
  .mt { border-collapse: collapse; }
  .mt td { padding: 1px 8px 1px 0; border: none; }
  .mth { font-weight: 700; }
  .mtl { padding-right: 12px; }
  .stated { border-left: 3px solid #1F3864; background: #F5F6FA; padding: 5px 8px; margin-top: 5px;
            font-size: 8px; line-height: 1.5; }
  .stated.pass { border-left-color: #1E7B34; }
  .stated.fail { border-left-color: #B00020; }
  .decl { padding: 6px 2px; font-size: 8.5px; line-height: 1.5; }
  /* Part I only. Every other part uses a bare table.grid and some of them — Part
     E's flow table on a six-hydrant site — are taller than a page, so they have
     to be allowed to break. The signature grid is the one that must not: the
     swoosh and the entity line under it take roughly 40mm off the tail of the
     last sheet now, which is enough to leave the licensee's name on one page and
     the signature box on the next. A form whose signature is on a sheet of its
     own is the argument an occupier's solicitor makes in a year's time. */
  table.grid.sig { page-break-inside: avoid; }
  .issues { border: 1px solid #D5D8E4; background: #FAFAFC; padding: 6px 9px; margin-top: 5px;
            font-size: 8px; line-height: 1.5; }
  .issues ul { margin: 3px 0 0; padding-left: 16px; }
  .issues li.blocking { color: #B00020; font-weight: 700; }
  .stamp { border: 2px solid #B00020; background: #FDF2F2; padding: 8px 10px; margin-top: 10px; }
  .stamp h2 { color: #B00020; font-size: 12px; margin: 0 0 3px; letter-spacing: 0.4px; }
  .stamp ul { margin: 4px 0 0; padding-left: 16px; font-size: 8.5px; line-height: 1.5; }
  .caution { border: 1px solid #C9A227; background: #FFFBEA; padding: 7px 10px; margin-top: 8px;
             font-size: 8.5px; line-height: 1.5; }
  .caution b { display: block; margin-bottom: 2px; }
  .deptnote { border: 1px solid #8C8C8C; background: #F2F2F2; padding: 6px 9px; margin-top: 10px;
              font-size: 7.5px; line-height: 1.5; }
  .ours { margin-top: 10px; padding-top: 6px; border-top: 1px dashed #8C8C8C;
          font-size: 7.5px; line-height: 1.55; color: #444; }
  .ours b { color: #1b1b1b; }
  .attachpage { page-break-before: always; break-before: page; }
  img.sig { max-height: 42px; max-width: 100%; display: block; }
  .results sup { font-size: 7px; vertical-align: super; opacity: 0.85; }
  td.grp { background: #F2F2F2; font-weight: 700; width: 11%; vertical-align: middle; }
  table.b td.k { width: auto; }
  table.b td.v { width: auto; }
  .u { color: #666; font-size: 7px; }
  .deptfine { border: 1px solid #D5D8E4; background: #FAFAFC; padding: 5px 9px; margin-top: 5px;
              font-size: 6.5px; line-height: 1.5; color: #333; }
  .imprint { margin-top: 6px; font-size: 7.5px; font-weight: 700; line-height: 1.4; color: #1F3864; }
`;

/**
 * The whole form.
 *
 * Prints in draft when anything blocking is outstanding. It is deliberately not
 * a refusal to render — a technician standing at a booster needs to see what
 * the form will look like — but it cannot be handed over as the statutory
 * document while it is stamped, and it says which parts are why.
 */
export function form72Html(input: Form72DocumentInput): string {
  const { form } = input;
  const issues = validateForm72(form);
  const blocking = issues.filter((i) => i.blocking);
  const cautions = issues.filter((i) => !i.blocking);
  const issuable = canIssue(form);

  const due = occupierCopyDue(form.testDate);
  const keepUntil = testerCopyKeepUntil(form.testDate);
  const company = input.companyName?.trim() || 'Safe QLD Fire Protection';
  const generatedOn = qldCalendarDate(input.generatedAt);

  // The company mark, and why this form gets only half of it.
  //
  // Every other document the app prints wears the full letterhead: the band at
  // the top, the swoosh and the entity line at the bottom. This one must not.
  // The `.head` block below is the department's own full-width head, reproduced
  // because MP 6.1 is discharged by the department's form and not by a summary
  // of it, and a Safe QLD band stacked above it gives the reader two mastheads
  // and no way to tell whose document it is. Worse, it reads as though the
  // company has altered a form the regulator prescribes.
  //
  // So `masthead: false`, which is the escape hatch `letterheaded` exists to
  // offer, and the foot alone. The swoosh lands after DEPARTMENT_NOTE and after
  // the dashed `.ours` block that already says "Not part of the department's
  // form", so it reads as the producer's mark on a reproduced form rather than
  // as part of the form. The entity line that comes with it is the reason to
  // keep the foot at all: a statutory record leaving this company without its
  // legal name and ABN on the page is its own problem.
  //
  // CSS's own @page at the top of this file stays where it is. `letterheaded`
  // puts its default page box in ahead of the caller's stylesheet, so the
  // form's `12mm 10mm` is the later declaration and wins — which is the whole
  // point of the split, and the reason nothing here passes a `page` option.
  return letterheaded({
    title: FORM_TITLE,
    css: CSS,
    masthead: false,
    body: `
  ${/*
     * Our strip, above the department's form rather than inside its header.
     *
     * The system descriptor had to go somewhere. It is not on the department's
     * form, and it is the one thing that tells two forms for the same site on
     * the same day apart, so it cannot be dropped — but marked "added" inside
     * the reproduced header it still left a reader comparing the two documents
     * finding an extra line in the department's own masthead.
     *
     * Above it, in a strip that is visibly not the form, both hold: the
     * reproduced header is the title and nothing else, exactly as published,
     * and the descriptor is the first thing anybody reads. The same strip
     * carries the version, which the department prints at the foot and this
     * document also prints there — here it is for finding the right form, not
     * for reproducing the published one.
     */''}
  ${input.systemLabel?.trim() ? `<div class="ourstrip">
    <span class="who">${esc(company)}</span>
    ${input.systemLabel?.trim() ? `<span class="what">${esc(input.systemLabel)}</span>` : ''}
    <span class="ver">${esc(FORM_VERSION)}</span>
  </div>` : ''}
  <div class="head">
    <div>
      <h1>${esc(FORM_TITLE)}</h1>
      <div class="sub">${esc(FORM_SUBTITLE)}</div>
    </div>
  </div>
  <div class="intro">${esc(FORM_INTRO)}</div>

  ${issuable ? '' : `<div class="stamp">
    <h2>DRAFT — NOT FOR ISSUE</h2>
    <div>This form is not complete enough to be given to an occupier or relied on as a record under
      QDC MP 6.1. ${blocking.length} matter${blocking.length === 1 ? '' : 's'} must be resolved
      first:</div>
    <ul>${blocking.map((i) => `<li>Part ${esc(i.part)} — ${esc(i.message)}</li>`).join('')}</ul>
  </div>`}

  ${cautions.length ? `<div class="caution"><b>Check before issue</b><ul>${
  cautions.map((i) => `<li>Part ${esc(i.part)} — ${esc(i.message)}</li>`).join('')}</ul></div>` : ''}

  ${issuable && input.status === 'draft' ? `<div class="caution">
    <b>Draft copy — this form has not been issued</b>
    Nothing on it is outstanding, but the app still holds it as a draft, which means it can still be
    edited. Issue it before it is given to anybody: a copy handed over now and the record kept
    afterwards can end up saying different things, and the occupier's copy is the one that counts.
  </div>` : ''}

  ${partA(form)}
  ${partB(form)}
  ${partC(form, issues)}
  ${partD(form)}
  ${partE(form, input)}
  ${partF(form)}
  ${partG(form)}
  ${partH(form)}
  ${partI(form)}
  ${attachment(form)}

  <div class="subnote">${esc(ADDED_BOX_NOTE)}</div>
  <div class="deptnote">${esc(DEPARTMENT_NOTE)}</div>
  <div class="deptnote">${esc(DEPARTMENT_DEFINITIONS)}</div>
  <div class="deptfine">${esc(DEPARTMENT_PRIVACY)}</div>
  <div class="deptfine">${esc(DEPARTMENT_RTI)}</div>
  ${/*
     * The department prints the version at the foot of the page above its own
     * imprint, not at the head. It is in our header too, because the header is
     * where somebody looks for which form this is — but the published position
     * is the one a side-by-side comparison checks.
     */''}
  <div class="imprint">${esc(FORM_VERSION)}<br />${
  esc(DEPARTMENT_IMPRINT).replace(/\n/g, '<br />')}</div>

  <div class="ours">
    <b>Not part of the department's form.</b>
    Produced by ${esc(company)} from the readings recorded on site${
  generatedOn ? `, ${esc(formatAuDate(generatedOn))}` : ''}.
    ${input.status === 'issued'
    ? `Issued${input.issuedAt ? ` ${esc(formatAuDate(qldCalendarDate(input.issuedAt)))}` : ''}, and
       held unaltered since.`
    : ''}
    ${due.date
    ? `A copy is due to the building occupier by ${esc(formatAuDate(due.date))} — ${OCCUPIER_COPY_BUSINESS_DAYS}
       business days after the work, under QDC MP 6.1 acceptable solution A4(b), counted under
       ${esc(due.legalRef)}.${
  due.holidaysApplied.length
    ? ` Public holidays passed over: ${esc(due.holidaysApplied.join('; '))}.`
    : ' No public holiday falls inside that count.'} ${esc(due.caveats.join(' '))}`
    : `The date a copy is due to the occupier cannot be given. ${esc(due.reason)}`}
    ${keepUntil
    ? `The person who carried out the maintenance keeps a record of this form until at least
       ${esc(formatAuDate(keepUntil))} — ${TESTER_RETENTION_YEARS} years, under MP 6.1 acceptable
       solution A5.`
    : ''}
    The department's form and MP 6.1 are published at hpw.qld.gov.au.
  </div>
  `,
  });
}
