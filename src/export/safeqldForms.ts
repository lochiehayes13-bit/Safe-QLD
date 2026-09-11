import {
  CONFIRMATION_ITEMS,
  EQUIPMENT_ITEMS,
  zoneQtyTotal,
  type BaselineData,
} from '@/domain/baseline';
import {
  LEAVE_LABEL,
  dayName,
  entryHours,
  groupByDate,
  leaveOf,
  parseTime,
  type Timesheet,
  type TimesheetEntry,
} from '@/domain/timesheet';
import { qldIsoDay } from '@/domain/qldTime';
import { colName, excelDate, excelTime, type Cell, type CellStyle, type CellValue, type FormulaCell, type Row, type Sheet } from './xlsx';
import { formatAuDate } from './sheets';

/**
 * Exporters for Safe QLD's own forms.
 *
 * These reproduce the company templates row for row, including the yellow input
 * cells and the section bands, so what comes out of the app is the document the
 * office already files rather than something that merely resembles it.
 */

const COMPANY = 'SAFE QLD PTY LTD';

const band = (s: string): Cell => ({ v: s, style: 'section' });
const field = (s: string): Cell => ({ v: s, style: 'field' });
const input = (s: string | number | undefined): Cell => ({ v: s ?? '', style: 'input' });

// ---------------------------------------------------------------------------
// Baseline data
// ---------------------------------------------------------------------------

/**
 * Builds the baseline data sheet.
 *
 * Row positions follow the company template so a printed export lines up with
 * the paper form people are used to reading.
 */
export function baselineSheet(b: BaselineData): Sheet {
  const rows: Row[] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};

  /** Pushes a row and returns its 1-based number, for building merge refs. */
  const push = (r: Row): number => {
    rows.push(r);
    return rows.length;
  };
  /** Label spanning A:B with its value in C — the form's dominant row shape. */
  const labelled = (label: string, value: string | number | undefined): void => {
    const n = push([field(label), '', input(value)]);
    merges.push(`A${n}:B${n}`);
  };
  const section = (title: string): void => {
    push([]);
    const n = push([band(title), '', '']);
    merges.push(`A${n}:C${n}`);
    rowHeights[n] = 20;
  };

  const banner = push([{ v: COMPANY, style: 'banner' }, '', '']);
  merges.push(`A${banner}:C${banner}`);
  rowHeights[banner] = 24;

  const subtitle = push([{ v: 'TEST RESULTS, BASELINE DATA', style: 'title' }, '', '']);
  merges.push(`A${subtitle}:C${subtitle}`);

  const note = push([{ v: 'Fill the yellow cells. Tap a YES/NO cell and pick from the list.', style: 'muted' }, '', '']);
  merges.push(`A${note}:C${note}`);

  section('SYSTEM DETAILS');
  labelled('Name of premises', b.premisesName);
  labelled('Premises address', b.premisesAddress);
  labelled('New install or alteration', b.installType);
  labelled('Alteration details (if any)', b.alterationDetails);
  labelled('Type of system', b.systemType);
  labelled('OWS amplifier size and qty', b.owsAmplifier);
  labelled('Monitoring provider', b.monitoringProvider);

  section('OWS SPEAKER CIRCUITS');
  push([{ v: 'Zone', style: 'header' }, { v: 'Impedance (ohms)', style: 'header' }, { v: 'Load (W)', style: 'header' }]);
  for (const c of b.speakerCircuits) {
    push([field(String(c.zone)), input(c.impedanceOhms), input(c.loadW)]);
  }

  section('EQUIPMENT FITTED');
  for (const item of EQUIPMENT_ITEMS) {
    labelled(item, b.equipment[item] ?? '');
  }

  section('FDCIE READINGS');
  labelled('Full alarm current (A)', b.fullAlarmCurrentA);
  labelled('Quiescent current (A)', b.quiescentCurrentA);
  labelled('Primary power and source', b.primaryPowerV);
  labelled(
    'Battery type and capacity',
    [b.batteryVoltage ? `${b.batteryVoltage} V` : '', b.batteryAh ? `${b.batteryAh} Ah` : '', b.batteryStandbyHours ? `${b.batteryStandbyHours} hr` : '']
      .filter(Boolean)
      .join(' - '),
  );
  labelled('Battery manufacture date', formatAuDate(b.batteryManufactureDate));
  labelled('Battery install date', formatAuDate(b.batteryInstallDate));

  section('CONFIRMATIONS');
  for (const item of CONFIRMATION_ITEMS) {
    labelled(item, b.confirmations[item] ?? '');
  }

  section('ZONE TEST RESULTS');
  push([
    { v: 'Zone', style: 'header' },
    { v: 'Qty', style: 'header' },
    { v: 'Device types (e.g. 24 smoke, 3 heat A & Other)', style: 'header' },
  ]);
  for (const z of b.zoneResults) {
    push([field(String(z.zone)), input(z.qty), input(z.deviceTypes)]);
  }
  const total = zoneQtyTotal(b.zoneResults);
  push([{ v: 'Total', style: 'header' }, { v: total || '', style: 'header' }, '']);

  section('SIGN OFF');
  labelled('Tester name(s)', b.testerNames);
  labelled('Test date', formatAuDate(b.testDate));

  return {
    name: 'Baseline Data',
    rows,
    merges,
    rowHeights,
    colWidths: [46, 22, 44],
  };
}

// ---------------------------------------------------------------------------
// Timesheet
// ---------------------------------------------------------------------------

/** Fifteen columns, A to O. Payroll's template is the contract. */
const TIMESHEET_COLUMNS = 15;

/** The sheet name the summary's formulas point at. */
const TIMESHEET_SHEET = 'Timesheet';

/** Banner, title, the two detail rows, the spacer, and the two header tiers. */
const TIMESHEET_HEADER_ROWS = 7;

/** The columns the totals row adds up: the three worked, then the five leave. */
const SUMMED_COLUMNS = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] as const;

/**
 * Which rows of the timesheet hold the week.
 *
 * The summary quotes the timesheet's own cells rather than adding the week up a
 * second time, so the two sheets cannot disagree once somebody edits an hour in
 * the file — two different totals for one week in one workbook is what payroll
 * rings up about. That needs row numbers on both sides, and a row number
 * written down twice is one that drifts, so it is worked out here for both.
 *
 * A week with no entries at all has no data rows: `last` comes back before
 * `first`, which is the case the totals row writes a plain zero for rather than
 * summing over a range that runs backwards.
 */
export function timesheetGeometry(sheet: Timesheet): { first: number; last: number; totals: number } {
  const first = TIMESHEET_HEADER_ROWS + 1;
  const last = first + sheet.entries.length - 1;
  return { first, last, totals: last + 2 };
}

/**
 * A figure the spreadsheet can add up, or the words somebody typed.
 *
 * The leave columns are text on an entry, because they come off a phone
 * keyboard, and a number written into a text cell is not a number to SUM — the
 * totals under the five leave columns read zero however much leave was in them.
 * Anything that is not a plain figure is printed as it was written instead of
 * being dropped: "half day" in the sick column is somebody's pay, and a blank
 * cell is the one thing it must not become.
 */
function hoursCell(raw: string, style: CellStyle): Cell {
  const text = raw.trim();
  if (!text) return { v: '', style };
  return /^-?\d*\.?\d+$/.test(text) ? { v: parseFloat(text), style } : { v: text, style: 'cell' };
}

/**
 * A time of day as a time, so the column reads 06:30 and can be subtracted.
 *
 * What will not parse is printed as it was typed. A start written "6.30am" is
 * still the only record of when the technician got there.
 */
function timeCell(raw: string): Cell {
  const minutes = parseTime(raw);
  return minutes === null ? { v: raw.trim(), style: 'cell' } : { v: excelTime(minutes), style: 'time' };
}

/**
 * How tall a day row has to be to show what is in it.
 *
 * A wrapped cell in a file Excel did not write itself opens at the default row
 * height, so the second line of a comment sits behind the row below and nobody
 * reads it. The site name and the comments are the two that run long, and four
 * lines is as far as one row is allowed to push the rest of the week down.
 */
function dayRowHeight(siteName: string, comments: string): number {
  const lines = Math.max(1, Math.ceil(siteName.length / 28), Math.ceil(comments.length / 30));
  return 18 + 14 * (Math.min(lines, 4) - 1);
}

/** The worked hours on an entry, in the one column its rate is paid at. */
function workedCell(entry: TimesheetEntry, kind: TimesheetEntry['hourKind'], hours: number): Cell {
  return { v: entry.hourKind === kind && hours ? hours : '', style: 'hours' };
}

/**
 * Builds the weekly timesheet sheet.
 *
 * Column order matches the company template: Date, Job #, Job/Site name,
 * Service report #, Start, Finish, ORD, O/T, D/T, then the leave columns —
 * sick, RDO, annual, LWOP, public holiday — and comments. Fifteen columns, A
 * to O, and every row here is written to that width so a value cannot drift
 * under the wrong heading: the public holiday hours once sat under COMMENTS
 * because the header row was a column short.
 *
 * It is also a sheet that gets printed. Fifteen columns are wider than A4
 * whichever way the page is turned, so the page is set up landscape and fitted
 * to one page across, and the two header tiers repeat at the top of page two —
 * a long week printed as a page of numbers under no headings, with the comments
 * stranded on a second sheet of paper, is the usual way a good export turns out
 * to be useless.
 */
export function timesheetSheet(sheet: Timesheet): Sheet {
  const rows: Row[] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};

  const push = (r: Row): number => {
    rows.push(r);
    return rows.length;
  };

  /**
   * A row of boxes, each spanning its own run of columns.
   *
   * Every cell in a run gets the style rather than only the first, because a
   * merged cell paints the fill and the border of each cell underneath it: the
   * yellow box stopped a third of the way across and the signature line ran out
   * before the page did. The merge itself only ever covers one box, so a label
   * cannot swallow the value beside it — the odometer reading disappeared for
   * exactly that reason, merged under its own heading.
   */
  const boxes = (spans: { from: number; to: number; v?: CellValue; style: CellStyle }[]): number => {
    const cells: Row = new Array(TIMESHEET_COLUMNS).fill('');
    for (const s of spans) {
      for (let i = s.from; i <= s.to; i += 1) cells[i] = { v: i === s.from ? (s.v ?? '') : '', style: s.style };
    }
    const n = push(cells);
    for (const s of spans) {
      if (s.to > s.from) merges.push(`${colName(s.from)}${n}:${colName(s.to)}${n}`);
    }
    return n;
  };

  const banner = boxes([{ from: 0, to: 14, v: COMPANY, style: 'banner' }]);
  rowHeights[banner] = 26;

  const title = boxes([{ from: 0, to: 14, v: 'WEEKLY TIMESHEET', style: 'title' }]);
  rowHeights[title] = 20;

  /** Label and box on the left, label and box on the right, flush to column O. */
  const detail = (left: [string, string], right: [string, string]): void => {
    const n = boxes([
      { from: 0, to: 1, v: left[0], style: 'field' },
      { from: 2, to: 5, v: left[1], style: 'input' },
      { from: 7, to: 9, v: right[0], style: 'field' },
      { from: 10, to: 14, v: right[1], style: 'input' },
    ]);
    rowHeights[n] = 18;
  };

  detail(['EMPLOYEE:', sheet.employeeName], ['WEEK STARTING:', formatAuDate(sheet.weekStarting)]);
  detail(['VEHICLE REGO.:', sheet.vehicleRego], ['KILOMETER READING:', sheet.kilometerReading]);

  push([]);

  // Two-tier header, matching the template's stacked labels.
  const h1 = push([
    { v: 'Date', style: 'header' },
    { v: 'JOB', style: 'header' },
    { v: 'JOB / SITE NAME', style: 'header' },
    { v: 'SERVICE', style: 'header' },
    { v: 'START', style: 'header' },
    { v: 'FINISH', style: 'header' },
    { v: 'TOTAL HOURS', style: 'header' },
    { v: '', style: 'header' },
    { v: '', style: 'header' },
    { v: 'OTHER LEAVE', style: 'header' },
    { v: '', style: 'header' },
    { v: '', style: 'header' },
    { v: '', style: 'header' },
    { v: '', style: 'header' },
    { v: 'COMMENTS', style: 'header' },
  ]);

  const h2 = push([
    { v: '', style: 'header' },
    { v: '#', style: 'header' },
    { v: '', style: 'header' },
    { v: 'REPORT #', style: 'header' },
    { v: 'TIME', style: 'header' },
    { v: 'TIME', style: 'header' },
    { v: 'ORD', style: 'header' },
    { v: 'O/T', style: 'header' },
    { v: 'D/T', style: 'header' },
    { v: 'SICK', style: 'header' },
    { v: 'RDO', style: 'header' },
    { v: 'ANNUAL', style: 'header' },
    { v: 'LWOP', style: 'header' },
    { v: 'PUB HOL', style: 'header' },
    { v: '', style: 'header' },
  ]);

  merges.push(`G${h1}:I${h1}`, `J${h1}:N${h1}`);
  // The headings with nothing stacked under them take both rows, rather than
  // sitting in the top one over an empty cell that reads as a missing label.
  merges.push(`A${h1}:A${h2}`, `C${h1}:C${h2}`, `O${h1}:O${h2}`);
  rowHeights[h1] = 18;
  rowHeights[h2] = 18;

  const firstDataRow = rows.length + 1;

  for (const group of groupByDate(sheet.entries)) {
    group.entries.forEach((e, i) => {
      const hours = entryHours(e);
      // The day name and date print once per day, on the first entry.
      const dateCell = i === 0 ? `${dayName(e.date)} ${formatAuDate(e.date)}` : '';
      // Extras go in with the comments rather than in columns of their own, so
      // the sheet keeps the shape payroll's template has.
      const comments = [...(e.extras ?? []), e.comments].filter((x) => x.trim()).join(' · ');
      const n = push([
        field(dateCell),
        { v: e.jobNumber, style: 'cell' },
        { v: e.siteName, style: 'cell' },
        { v: e.serviceReportNumber, style: 'cell' },
        timeCell(e.startTime),
        timeCell(e.finishTime),
        workedCell(e, 'ord', hours),
        workedCell(e, 'ot', hours),
        workedCell(e, 'dt', hours),
        hoursCell(e.sick, 'leave'),
        hoursCell(e.rdo, 'leave'),
        hoursCell(e.annual, 'leave'),
        hoursCell(e.lwop, 'leave'),
        hoursCell(e.publicHoliday, 'leave'),
        { v: comments, style: 'cell' },
      ]);
      rowHeights[n] = dayRowHeight(e.siteName, comments);
    });
  }

  const lastDataRow = rows.length;
  push([]);

  const totalRow = push([
    { v: '', style: 'total' },
    { v: '', style: 'total' },
    { v: 'TOTAL HOURS', style: 'totalLabel' },
    { v: '', style: 'totalLabel' },
    { v: '', style: 'totalLabel' },
    { v: '', style: 'totalLabel' },
    // Live formulas rather than baked values, so the sheet still adds up if
    // someone edits a cell after export.
    ...SUMMED_COLUMNS.map((col) =>
      lastDataRow >= firstDataRow
        ? ({ f: `SUM(${col}${firstDataRow}:${col}${lastDataRow})`, style: 'total' } as FormulaCell)
        : ({ v: 0, style: 'total' } as Cell),
    ),
    { v: '', style: 'total' },
  ]);
  merges.push(`C${totalRow}:F${totalRow}`);
  rowHeights[totalRow] = 20;

  push([]);

  const signOffBand = boxes([{ from: 0, to: 14, v: 'SIGN OFF', style: 'section' }]);
  rowHeights[signOffBand] = 20;

  /** Name on a line, date on a line. Both lines are there to be written on. */
  const signOff = (label: string, value: string): void => {
    const n = boxes([
      { from: 0, to: 1, v: label, style: 'field' },
      { from: 2, to: 7, v: value, style: 'rule' },
      { from: 8, to: 9, v: 'DATE:', style: 'field' },
      { from: 10, to: 14, style: 'rule' },
    ]);
    rowHeights[n] = 26;
  };

  signOff('EMPLOYEE:', sheet.employeeName);
  signOff('CHECKED BY:', sheet.checkedBy);
  signOff('MANAGER:', sheet.managerName);

  return {
    name: TIMESHEET_SHEET,
    rows,
    merges,
    rowHeights,
    colWidths: [16, 9, 30, 12, 8, 8, 7, 7, 7, 8, 8, 8, 8, 8, 32],
    // The headings, not the letterhead. Scrolling down a long week keeps the
    // columns named; the banner and the vehicle row go off the top, where they
    // are no use to anybody reading a row of figures.
    freezeRows: h2,
    page: {
      orientation: 'landscape',
      fitToWidth: 1,
      repeatRows: { from: h1, to: h2 },
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4 },
      centreHorizontally: true,
      footer: [sheet.employeeName.trim(), `week starting ${formatAuDate(sheet.weekStarting)}`]
        .filter(Boolean)
        .join(' — '),
    },
  };
}

/**
 * The week at a glance, as the second sheet of the workbook.
 *
 * Every figure on it is a reference to the timesheet's own totals row rather
 * than a second addition of the same week, so editing an hour on the timesheet
 * moves the summary with it. The version that wrote the numbers out would have
 * disagreed with the sheet beside it from the first correction onwards.
 *
 * It was a column of labels and a column of numbers. What payroll actually has
 * to find is on it now: which day the hours were worked on and where, and the
 * allowances that are otherwise buried in the comments column and get paid only
 * if somebody reads all fifteen of them.
 */
export function timesheetSummarySheet(sheet: Timesheet): Sheet {
  const { first, totals } = timesheetGeometry(sheet);
  const rows: Row[] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};

  const push = (r: Row): number => {
    rows.push(r);
    return rows.length;
  };
  /** Label in A, box across B and C. */
  const detail = (label: string, value: CellValue, style: CellStyle = 'input'): void => {
    const n = push([field(label), { v: value, style }, { v: '', style }]);
    merges.push(`B${n}:C${n}`);
  };
  const section = (heading: string): void => {
    push([]);
    const n = push([band(heading), { v: '', style: 'section' }, { v: '', style: 'section' }]);
    merges.push(`A${n}:C${n}`);
    rowHeights[n] = 20;
  };
  /** A figure quoted from the timesheet's totals row, with the column it came from. */
  const quoted = (label: string, column: string): number => push([
    field(label),
    { f: `${TIMESHEET_SHEET}!${column}${totals}`, style: 'hours' },
    { v: `Timesheet column ${column}`, style: 'muted' },
  ]);

  const banner = push([{ v: COMPANY, style: 'banner' }, { v: '', style: 'banner' }, { v: '', style: 'banner' }]);
  merges.push(`A${banner}:C${banner}`);
  rowHeights[banner] = 26;
  const title = push([{ v: 'WEEK SUMMARY', style: 'title' }, '', '']);
  merges.push(`A${title}:C${title}`);

  push([]);
  detail('Employee', sheet.employeeName);
  const weekDay = excelDate(qldIsoDay(sheet.weekStarting));
  if (weekDay === undefined) detail('Week starting', formatAuDate(sheet.weekStarting));
  else detail('Week starting', weekDay, 'date');
  detail('Vehicle rego', sheet.vehicleRego);
  detail('Kilometer reading', sheet.kilometerReading);

  const days = groupByDate(sheet.entries);
  detail('Days on the sheet', days.length, 'cell');

  section('WORKED');
  const ord = quoted('Ordinary', 'G');
  quoted('Overtime', 'H');
  const dt = quoted('Double time', 'I');
  const worked = push([
    { v: 'Worked total', style: 'totalLabel' },
    { f: `SUM(B${ord}:B${dt})`, style: 'total' },
    { v: '', style: 'total' },
  ]);

  section('LEAVE AND PUBLIC HOLIDAYS');
  const sick = quoted('Sick', 'J');
  quoted('RDO', 'K');
  quoted('Annual', 'L');
  quoted('Unpaid (LWOP)', 'M');
  const pubHol = quoted('Public holiday', 'N');
  const leave = push([
    { v: 'Leave total', style: 'totalLabel' },
    { f: `SUM(B${sick}:B${pubHol})`, style: 'total' },
    { v: '', style: 'total' },
  ]);

  push([]);
  const grand = push([
    { v: 'PAID TOTAL', style: 'totalLabel' },
    { f: `B${worked}+B${leave}`, style: 'total' },
    { v: '', style: 'total' },
  ]);
  rowHeights[grand] = 20;

  const extras = new Map<string, number>();
  for (const e of sheet.entries) {
    for (const label of e.extras ?? []) {
      const clean = label.trim();
      if (clean) extras.set(clean, (extras.get(clean) ?? 0) + 1);
    }
  }
  if (extras.size) {
    section('ALLOWANCES AND EXTRAS');
    push([{ v: 'What', style: 'header' }, { v: 'Days', style: 'header' }, { v: '', style: 'header' }]);
    for (const [label, count] of [...extras].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      push([{ v: label, style: 'cell' }, { v: count, style: 'cell' }, { v: '', style: 'cell' }]);
    }
  }

  if (days.length) {
    section('DAY BY DAY');
    push([{ v: 'Day', style: 'header' }, { v: 'Paid hours', style: 'header' }, { v: 'Where', style: 'header' }]);
    let at = first;
    for (const group of days) {
      const from = at;
      const to = at + group.entries.length - 1;
      at = to + 1;
      push([
        field(`${dayName(group.date)} ${formatAuDate(group.date)}`),
        { f: `SUM(${TIMESHEET_SHEET}!G${from}:N${to})`, style: 'hours' },
        { v: dayNote(group.entries), style: 'cell' },
      ]);
    }
  }

  return { name: 'Summary', rows, merges, rowHeights, colWidths: [26, 12, 46] };
}

/** Where the day was spent: the sites worked, or the kind of day off it was. */
function dayNote(entries: TimesheetEntry[]): string {
  const sites = entries.map((e) => e.siteName.trim()).filter(Boolean);
  const leave = entries.map((e) => leaveOf(e)).map((l) => (l ? LEAVE_LABEL[l.kind] : '')).filter(Boolean);
  return [...new Set([...sites, ...leave])].join(', ');
}
