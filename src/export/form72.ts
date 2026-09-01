import {
  canIssue, elevationHeadKpa, frictionalLossKpa, overloadCheck, validateForm72,
  type BoosterTest, type FlowRow, type FlowTest, type Form72, type FormIssue, type PartResult,
  type SprinklerTestPoint, type TestDevice,
} from '@/domain/form72';
import { addQldBusinessDays } from '@/domain/occupierForm';
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
 * Two failures on paper are what shaped the rest of it.
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
 * Nothing here computes hydraulics of its own. The frictional loss and the
 * overload check come from domain/form72.ts, and where the readings do not
 * support them the page says so in words instead of printing a figure that
 * looks measured.
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

export const FORM_TITLE = 'Form 72 — Fire Hydrant and Sprinkler System';
export const FORM_SUBTITLE = 'Periodic Testing and Maintenance';

export const FORM_INTRO = 'This form is to be used for the purposes of maintenance to water-based '
  + 'fire safety installations, as required by the Queensland Development Code – Mandatory Part '
  + '(MP) 6.1, a building assessment provision under the Building Act 1975, s.30, and in accordance '
  + "with the 'Fire hydrant and sprinkler system commissioning and periodic maintenance procedure' "
  + '(the Relevant procedure). This form does not comprise all maintenance requirements; further '
  + 'testing is required in each case.';

export const PART_B_NOTE = 'Refer to the required pressure specification for periodic testing (as '
  + 'applicable) as per AS2419.1 or AS1851.';

export const PART_C_NOTE = 'If using more devices, provide details in the Notes section below or '
  + 'complete another form. The correction factor must be kPa or a percentage.';

export const PART_D_NOTE = 'This part relates to tests under Section 4 of AS1851. If pressure/flow '
  + 'rates do not meet the fire system design criteria and there are no on-site problems, contact '
  + 'the relevant water service provider. Record the pressure readings obtained during the hydrant '
  + 'system flow test below.';

export const PART_E_NOTE = 'This part relates to sections 10.4 and 10.5 of AS2419.1 and tests under '
  + 'Section 4 of AS1851. Record the pressure readings obtained during the pump appliance booster '
  + 'test below.';

export const PART_F_NOTE = 'Relevant required pressure specification in AS2118.1, AS2118.4 and AS2118.6.';

export const PART_G_NOTE = 'For sections 4.14 of AS2118.1-1999, 4 of AS2118.6-2012, 6.2 of '
  + 'AS2118.4-2012 and section 2 of AS1851. (1) For AS2118.1 and AS2118.6 systems, multiple testing '
  + 'points may be required. (2) For AS2118.4, a simulated running test may be required for systems '
  + 'without a flow measuring device. System test points shall be noted for each different system.';

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

/** The department's footer, verbatim, including the Crown copyright line. */
export const DEPARTMENT_NOTE = 'Note: Building owners/occupiers are responsible for ensuring their '
  + 'buildings continuously meet fire safety standards. Where a building owner/occupier becomes '
  + 'aware that their building does not meet the minimum requirements for water pressure required '
  + 'by any applicable standard under QDC MP 6.1, they should contact the Queensland Fire and '
  + "Emergency Service. Definitions: 'Maintenance test' means a test required under a maintenance "
  + "standard such as AS1851. 'Running test' means a two-inch waste test installed at the sprinkler "
  + 'control valve on older systems. © The State of Queensland (Department of Housing and Public '
  + 'Works) 2014.';

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
 */
export function qldCalendarDate(instant: string | undefined): string | undefined {
  if (!instant) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant.trim())) return instant.trim();
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return undefined;
  return new Date(t + 10 * 3_600_000).toISOString().slice(0, 10);
}

/** The flow rates printed down Part D of the department's form. */
export const STANDARD_FLOW_RATES_LPS = [5, 10, 15, 20, 30];

/**
 * The rows Part D prints.
 *
 * The department's table has five fixed rates, so all five are printed whether
 * or not they were run — a table that shows only the rates achieved reads as
 * though the others passed. Anything measured at a rate the form does not print
 * is kept and appended rather than dropped, because a reading taken on site is
 * never discarded to make a layout fit.
 */
export function flowTableRows(test: FlowTest): { row: FlowRow; standard: boolean }[] {
  const remaining = [...test.rows];
  const standard = STANDARD_FLOW_RATES_LPS.map((rateLps) => {
    const i = remaining.findIndex((r) => r.rateLps === rateLps);
    if (i < 0) return { row: { rateLps, devices: '' } as FlowRow, standard: true };
    const [row] = remaining.splice(i, 1);
    return { row: row!, standard: true };
  });
  const extra = remaining
    .slice()
    .sort((a, b) => a.rateLps - b.rateLps)
    .map((row) => ({ row, standard: false }));
  return [...standard, ...extra];
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

const kpa = (v: number | undefined): string | undefined => (v === undefined ? undefined : `${v} kPa`);

/** One tick box with its label beside it, as the form prints them. */
function tick(label: string, on: boolean): string {
  return `<span class="tick"><span class="cb${on ? ' on' : ''}">${on ? '&#10007;' : ''}</span>${esc(label)}</span>`;
}

/** The N/A / PASS / FAIL boxes that sit on the right of a part's dark band. */
function resultBoxes(result: string, options: { value: string; label: string }[]): string {
  return `<span class="results">${options
    .map((o) => `<span class="rl">${esc(o.label)}</span><span class="rb${o.value === result ? ' on' : ''}">${
      o.value === result ? '&#10007;' : ''}</span>`)
    .join('')}</span>`;
}

const RESULT_OPTIONS = [
  { value: 'na', label: 'N/A' },
  { value: 'pass', label: 'PASS' },
  { value: 'fail', label: 'FAIL' },
];

const FLOW_RESULT_OPTIONS = [
  { value: 'refer-to-report', label: 'Refer to Report' },
  { value: 'pass', label: 'PASS' },
  { value: 'fail', label: 'FAIL' },
];

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

function wide(label: string, value: string): string {
  return `<tr><td class="k">${esc(label)}</td><td class="v" colspan="3">${value}</td></tr>`;
}

// ---------------------------------------------------------------------------

function partA(form: Form72): string {
  const m = form.maintenanceTest;
  const grid = `<table class="mt">
    <tr><td></td><td class="mth">Annual</td><td class="mth">5 year</td></tr>
    <tr><td class="mtl">Fire Hydrant</td><td>${tick('', m.hydrantAnnual)}</td><td>${tick('', m.hydrantFiveYear)}</td></tr>
    <tr><td class="mtl">Fire Sprinkler</td><td>${tick('', m.sprinklerAnnual)}</td><td>${tick('', m.sprinklerFiveYear)}</td></tr>
    <tr><td class="mtl">Combined</td><td>${tick('', m.combinedAnnual)}</td><td>${tick('', m.combinedFiveYear)}</td></tr>
  </table>`;

  return `${band('Part A — Test details')}
  <table class="grid">
    ${wide('Site Name', cell(form.siteName, 'pass'))}
    ${wide('Site Address', cell(form.siteAddress, 'pass'))}
    ${wide('Contractor', cell(form.contractor, 'pass'))}
    ${pair(['Test Date', cell(formatAuDate(form.testDate), 'pass')], ['Time', cell(form.testTime, 'pass')])}
    ${wide('Maintenance Test', grid)}
  </table>`;
}

function partB(form: Form72): string {
  const h = form.hydrostatic;
  const r = h.result;
  return `${band('Part B — Hydrant Hydrostatic Test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_B_NOTE)}
  <table class="grid">
    ${pair(['Boost Pressure (kPa)', cell(h.boostPressureKpa, r)], ['Test Pressure (kPa)', cell(h.testPressureKpa, r)])}
    ${pair(['Duration of Test (mins)', cell(h.durationMinutes, r)], ['End of Test Pressure (kPa)', cell(h.endPressureKpa, r)])}
    ${wide('Loss (if any) (L/min)', cell(h.lossLpm, r))}
    ${wide('Comments', comment(h.comments, r))}
  </table>`;
}

/** The four columns the department's form prints, used when none are recorded. */
const DEFAULT_DEVICE_SLOTS = ['Device 1', 'Device 2', 'Gauge 1', 'Gauge 2'];

function partC(form: Form72, issues: FormIssue[]): string {
  const devices: TestDevice[] = form.devices.length
    ? form.devices
    : DEFAULT_DEVICE_SLOTS.map((slot) => ({ slot, serialNumber: '' }));

  // Every pressure on this form was read with this equipment, so the part is
  // rendered against the live result rather than N/A: a blank here is never
  // "not applicable".
  const c: PartResult = 'pass';
  const row = (label: string, get: (d: TestDevice) => string | number | undefined): string =>
    `<tr><td class="k">${esc(label)}</td>${devices
      .map((d) => `<td class="v">${cell(get(d), c)}</td>`).join('')}</tr>`;

  const kinds = form.flowDeviceKinds;
  const partCIssues = issues.filter((i) => i.part === 'C');

  return `${band('Part C — Hydrant Test Equipment / Pressure Gauges')}
  ${note(PART_C_NOTE)}
  <table class="grid">
    <tr><td class="k">Flow Measuring Device</td><td class="v" colspan="3">
      ${tick('Orifice', kinds.includes('orifice'))}
      ${tick('Mechanical', kinds.includes('mechanical'))}
      ${tick('Electromagnetic', kinds.includes('electromagnetic'))}
    </td></tr>
  </table>
  <div class="subnote">Part C not required for orifice testing.</div>
  <table class="grid devices">
    <tr><td class="k"></td>${devices.map((d) => `<td class="dh">${esc(d.slot)}</td>`).join('')}</tr>
    ${row('Serial number', (d) => d.serialNumber)}
    ${row('Date calibrated', (d) => formatAuDate(d.dateCalibrated))}
    ${row('Calibration Certificate', (d) => d.calibrationCertificate)}
    ${row('65/100/150 mm face', (d) => d.faceSize)}
    ${row('Digital reader', (d) => (d.digitalReader === undefined ? undefined : d.digitalReader ? 'Yes' : 'No'))}
    ${row('Increments (kPa)', (d) => d.incrementsKpa)}
  </table>
  ${partCIssues.length
    ? `<div class="issues"><b>Test equipment</b><ul>${partCIssues
      .map((i) => `<li${i.blocking ? ' class="blocking"' : ''}>${esc(i.message)}</li>`).join('')}</ul></div>`
    : ''}`;
}

function partD(form: Form72): string {
  const d = form.flowTest;
  const r = d.result;
  const loc = (n: number): string => cell(d.hydrantLocations[n - 1], r === 'na' ? 'na' : 'pass');
  const rows = flowTableRows(d);

  const table = `<table class="grid flow">
    <tr>
      <td class="dh">Size/flow rate</td><td class="dh">Device/gauge no.</td>
      <td class="dh">Hydrant 1 only (kPa)</td><td class="dh">Hydrants 1 &amp; 2 (kPa)</td>
      <td class="dh">Hydrants 1, 2 &amp; 3 (kPa)</td>
    </tr>
    ${rows.map(({ row, standard }) => {
    // A rate with nothing against it was not run, which is not the same thing
    // as a reading somebody forgot to write down. The department prints all
    // five rates whether or not the job needs them, so most forms legitimately
    // leave three of them alone — flagging those in red would train a reader to
    // ignore the flag on the row that matters.
    const untouched = !row.devices?.trim() && row.hydrant1Kpa === undefined
      && row.hydrants12Kpa === undefined && row.hydrants123Kpa === undefined;
    const c = (v: string | number | undefined): string =>
      (untouched ? '<span class="na">Not run</span>' : cell(v, r));
    return `<tr>
      <td class="k">${esc(row.rateLps)} L/s${standard ? '' : ' <span class="extra">added</span>'}</td>
      <td class="v">${c(row.devices)}</td>
      <td class="v">${c(row.hydrant1Kpa)}</td>
      <td class="v">${c(row.hydrants12Kpa)}</td>
      <td class="v">${c(row.hydrants123Kpa)}</td>
    </tr>`;
  }).join('')}
    <tr><td class="k">System achieved</td><td class="v" colspan="4">${cell(d.systemAchieved, r)}</td></tr>
  </table>`;

  const extras = rows.filter((x) => !x.standard);

  return `${band('Part D — Hydrant System Flow Test', resultBoxes(r, FLOW_RESULT_OPTIONS))}
  ${note(PART_D_NOTE)}
  ${r === 'na'
    // The department's Part D has no N/A box. Leaving all three unticked would
    // read as an unanswered part, so the reason is written out instead.
    ? '<div class="stated">Recorded as not applicable. Part D of the department\'s form carries no '
      + 'N/A box, so none of the three boxes above is ticked; this line says why.</div>'
    : ''}
  <table class="grid">
    ${pair(['Hydrant 1 Location', loc(1)], ['Hydrant 2 Location', loc(2)])}
    ${pair(['Hydrant 3 Location', loc(3)], ['Hydrant 4 Location', loc(4)])}
    ${pair(['Static Pressure', cell(kpa(d.staticPressureKpa), r)], ['Pressure Zone Number', cell(d.pressureZone, r)])}
    ${wide('On-site pump set installed', `${tick('Yes', d.onSitePumpSet === true)}${tick('No', d.onSitePumpSet === false)}${
  d.onSitePumpSet === undefined ? ' <span class="missing">Not answered</span>' : ''}`)}
    ${wide('Comment', comment(d.comment, r))}
  </table>
  ${table}
  ${extras.length
    ? `<div class="stated">${extras.length} flow rate${extras.length === 1 ? ' was' : 's were'} recorded `
      + `that the department's table does not print `
      + `(${esc(extras.map((x) => `${x.row.rateLps} L/s`).join(', '))}). `
      + `${extras.length === 1 ? 'It is' : 'They are'} shown above marked "added" rather than `
      + 'dropped to fit the printed layout.</div>'
    : ''}`;
}

function partE(form: Form72, input: Form72DocumentInput): string {
  const b = form.booster;
  const r = b.result;

  const loss = frictionalLossKpa(b);
  const gaps = frictionalLossGaps(b);
  const lossCell = loss !== undefined
    ? `${loss} kPa`
    : r === 'na' ? '<span class="na">N/A</span>' : '<span class="missing">Not calculated</span>';

  const head = b.highestHydrantAboveBoosterM !== undefined
    ? elevationHeadKpa(b.highestHydrantAboveBoosterM)
    : undefined;

  const working = loss !== undefined
    ? `Calculated: ${b.boostPressureKpa} kPa boost less ${head} kPa of elevation head over `
      + `${b.highestHydrantAboveBoosterM} m less ${b.hydrantResidualKpa} kPa residual at the hydrant.`
    : `Not calculated — this form does not record ${gaps.join(', ')}. A frictional loss worked out `
      + 'from an assumed figure is indistinguishable on the page from a measured one, and this form '
      + 'is signed.';

  const req = b.requiredLps !== undefined && b.requiredKpa !== undefined
    ? `${b.requiredLps} L/s @ ${b.requiredKpa} kPa`
    : undefined;

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

  return `${band('Part E — Pump Appliance Booster Test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_E_NOTE)}
  <table class="grid">
    ${pair(['Hydrant locations', cell(b.hydrantLocations, r)],
    ['Height of highest hydrant above booster (m)', cell(b.highestHydrantAboveBoosterM, r)])}
    ${pair(['System requirements (L/s @ kPa)', cell(req, r)], ['Static pressure (kPa)', cell(b.staticPressureKpa, r)])}
    ${pair(['Pump inlet pressure (kPa)', cell(b.pumpInletKpa, r)], ['Pump discharge pressure (kPa)', cell(b.pumpDischargeKpa, r)])}
    ${pair(['Boost pressure (kPa)', cell(b.boostPressureKpa, r)], ['Calculated frictional loss (kPa)', lossCell])}
    ${wide('Comments', comment(b.comments, r))}
  </table>
  ${r === 'na' ? '' : `<div class="stated">${esc(working)}</div>`}
  ${overloadBlock}`;
}

function partF(form: Form72): string {
  const f = form.sprinklerHydrostatic;
  const r = f.result;
  return `${band('Part F — Sprinkler Hydrostatic Test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_F_NOTE)}
  <table class="grid">
    ${pair(['Pressure (kPa)', cell(f.pressureKpa, r)], ['Time held (mins)', cell(f.timeHeldMinutes, r)])}
    ${wide('Comments', comment(f.comments, r))}
  </table>`;
}

function partG(form: Form72): string {
  const g = form.sprinklerFlow;
  const r = g.result;

  const outcomeBoxes = (o: 'pass' | 'fail' | undefined): string =>
    `${tick('Pass', o === 'pass')}${tick('Fail', o === 'fail')}${
      o === undefined && r !== 'na' ? ' <span class="missing">Not decided</span>' : ''}`;

  // The department prints two test points and its own note says multiple points
  // may be required — meaning one is often the right answer. An unused second
  // point says so, rather than showing four boxes flagged as missing readings.
  const unused = (p: SprinklerTestPoint | undefined): boolean => !p || (!p.location.trim()
    && p.requiredFlowLpm === undefined && p.resultFlowLpm === undefined
    && p.requiredPressureKpa === undefined && p.resultPressureKpa === undefined);

  const point = (n: number, p: SprinklerTestPoint | undefined): string => {
    const spare = unused(p);
    const c = (v: string | number | undefined): string =>
      (spare ? '<span class="na">Not used</span>' : cell(v, r));
    const boxes = (o: 'pass' | 'fail' | undefined): string => (spare
      ? `${tick('Pass', false)}${tick('Fail', false)}`
      : outcomeBoxes(o));
    return `
    <tr><td class="sub" colspan="4">Test Point ${n}</td></tr>
    ${wide('Location', c(p?.location))}
    <tr>
      <td class="k">Required flow rate (L/min)</td><td class="v">${c(p?.requiredFlowLpm)}</td>
      <td class="k">Result: ${c(p?.resultFlowLpm)}</td>
      <td class="v">${boxes(testPointOutcome(p?.requiredFlowLpm, p?.resultFlowLpm))}</td>
    </tr>
    <tr>
      <td class="k">Required pressure (kPa)</td><td class="v">${c(p?.requiredPressureKpa)}</td>
      <td class="k">Result: ${c(p?.resultPressureKpa)}</td>
      <td class="v">${boxes(testPointOutcome(p?.requiredPressureKpa, p?.resultPressureKpa))}</td>
    </tr>`;
  };

  const extra = g.testPoints.slice(2);

  // "Test Results l/m@kPa" sits opposite the block plan figure, so it is the
  // achieved pair for the same system. It is taken from test point 1 rather
  // than typed again, and left unanswered unless both halves were measured —
  // half a pair against a block plan figure invites the wrong comparison.
  const first = g.testPoints[0];
  const achieved = first?.resultFlowLpm !== undefined && first.resultPressureKpa !== undefined
    ? `${first.resultFlowLpm} l/m @ ${first.resultPressureKpa} kPa`
    : undefined;

  return `${band('Part G — Sprinkler System Flow Test', resultBoxes(r, RESULT_OPTIONS))}
  ${note(PART_G_NOTE)}
  <table class="grid">
    ${pair(['System Specs (block plan) l/m@kPa', cell(g.systemSpec, r)], ['Test Results l/m@kPa', cell(achieved, r)])}
    ${point(1, g.testPoints[0])}
    ${point(2, g.testPoints[1])}
    ${extra.map((p, i) => point(3 + i, p)).join('')}
    ${wide('Running Test — Installation gauge pressure (kPa)', cell(g.runningTestGaugeKpa, r))}
    ${wide('Comments', comment(g.comments, r))}
  </table>
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

  return `${band('Part H — Compliance')}
  <table class="grid">
    <tr><td class="k">Critical Defects Identified</td><td class="v" colspan="3">${
  yesNo(critical, 'Give owner/occupier a critical defect notice',
    'No action required in relation to critical defects at this time')}</td></tr>
    <tr><td class="k">Repairs/Corrective Actions</td><td class="v" colspan="3">${
  yesNo(repairs, "Attach details (incl. action and date taken) in Licensee's report",
    'No action required in relation to repairs/corrective actions at this time')}</td></tr>
    <tr><td class="k">System</td><td class="v" colspan="3">${
  tick('Pass', form.systemResult === 'pass')}${tick('Fail', form.systemResult === 'fail')}</td></tr>
    ${wide('System Notes', comment(form.systemNotes, form.systemResult))}
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

function partI(form: Form72): string {
  return `${band('Part I — Signature')}
  <div class="decl">${esc(DECLARATION)}</div>
  <table class="grid">
    ${pair(['Licensee Name', cell(form.licenseeName, 'pass')], ['Licensee Signature', cell(form.signature, 'pass')])}
    ${pair(['Licence No. (QBCC/PIC)', cell(form.licenceNumber, 'pass')],
    // Not every job has one, so its absence is answered rather than flagged.
    ['Licensee Report No.', form.licenseeReportNumber?.trim()
      ? esc(form.licenseeReportNumber) : '<span class="na">None</span>'])}
  </table>`;
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${CSS}</style></head><body>
  <div class="head">
    <div>
      <h1>${esc(FORM_TITLE)}</h1>
      <div class="sub">${esc(FORM_SUBTITLE)}</div>
    </div>
    <div class="right">${esc(FORM_VERSION)}${
  input.systemLabel?.trim() ? `<br />${esc(input.systemLabel)}` : ''}</div>
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

  ${partA(form)}
  ${partB(form)}
  ${partC(form, issues)}
  ${partD(form)}
  ${partE(form, input)}
  ${partF(form)}
  ${partG(form)}
  ${partH(form)}
  ${partI(form)}

  <div class="deptnote">${esc(DEPARTMENT_NOTE)}</div>

  ${issuable && input.status === 'draft' ? `<div class="caution">
    <b>Draft copy — this form has not been issued</b>
    Nothing on it is outstanding, but the app still holds it as a draft, which means it can still be
    edited. Issue it before it is given to anybody: a copy handed over now and the record kept
    afterwards can end up saying different things, and the occupier's copy is the one that counts.
  </div>` : ''}

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
       business days after the work, under QDC MP 6.1 acceptable solution A4(b), counted as
       ${esc(due.legalRef)} defines a business day.${
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
  </body></html>`;
}
