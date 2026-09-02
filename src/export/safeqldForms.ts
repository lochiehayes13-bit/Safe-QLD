import {
  CONFIRMATION_ITEMS,
  EQUIPMENT_ITEMS,
  zoneQtyTotal,
  type BaselineData,
} from '@/domain/baseline';
import {
  dayName,
  entryHours,
  groupByDate,
  timesheetTotals,
  type Timesheet,
} from '@/domain/timesheet';
import type { Cell, Row, Sheet } from './xlsx';
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

/**
 * Builds the weekly timesheet sheet.
 *
 * Column order matches the company template: Date, Job #, Job/Site name,
 * Service report #, Start, Finish, ORD, O/T, D/T, then the leave columns and
 * comments.
 */
export function timesheetSheet(sheet: Timesheet): Sheet {
  const rows: Row[] = [];
  const merges: string[] = [];
  const totals = timesheetTotals(sheet);

  const push = (r: Row): number => {
    rows.push(r);
    return rows.length;
  };

  const banner = push([{ v: COMPANY, style: 'banner' }, '', '', '', '', '', '', '', '', '', '', '', '', '']);
  merges.push(`A${banner}:E${banner}`);

  const header = push([
    '', '', '',
    field('VEHICLE REGO.:'), input(sheet.vehicleRego), '',
    '', field('KILOMETER READING:'), input(sheet.kilometerReading),
    '', '', '', '', '',
  ]);
  merges.push(`H${header}:I${header}`);

  const nameRow = push(['', '', '', field('EMPLOYEE:'), input(sheet.employeeName), '', '', '', '', '', '', '', '', '']);
  merges.push(`E${nameRow}:G${nameRow}`);

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
    { v: 'COMMENTS', style: 'header' },
  ]);
  merges.push(`G${h1}:I${h1}`, `J${h1}:M${h1}`);

  push([
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
    { v: '', style: 'header' },
  ]);

  const firstDataRow = rows.length + 1;

  for (const group of groupByDate(sheet.entries)) {
    group.entries.forEach((e, i) => {
      const hours = entryHours(e);
      // The day name and date print once per day, on the first entry.
      const dateCell = i === 0 ? `${dayName(e.date)} ${formatAuDate(e.date)}` : '';
      push([
        field(dateCell),
        input(e.jobNumber),
        input(e.siteName),
        input(e.serviceReportNumber),
        input(e.startTime),
        input(e.finishTime),
        input(e.hourKind === 'ord' && hours ? hours : ''),
        input(e.hourKind === 'ot' && hours ? hours : ''),
        input(e.hourKind === 'dt' && hours ? hours : ''),
        input(e.sick),
        input(e.rdo),
        input(e.annual),
        input(e.lwop),
        input(e.publicHoliday),
        input(e.comments),
      ]);
    });
  }

  const lastDataRow = rows.length;
  push([]);

  const totalRow = push([
    '', '',
    { v: 'TOTAL HOURS', style: 'header' },
    '',
    '',
    '',
    // Live formulas rather than baked values, so the sheet still adds up if
    // someone edits a cell after export.
    ...(['G', 'H', 'I', 'J', 'K', 'L', 'M'] as const).map((col) =>
      lastDataRow >= firstDataRow
        ? ({ v: `=SUM(${col}${firstDataRow}:${col}${lastDataRow})`, style: 'header' } as Cell)
        : ({ v: 0, style: 'header' } as Cell),
    ),
    '',
  ]);
  void totalRow;

  push([]);
  push([field('SIGN OFF:')]);
  const signRow = push([
    '', field('EMPLOYEE:'), input(sheet.employeeName), '', '', '',
    field('CHECKED BY:'), input(sheet.checkedBy), '', '', '', '', '', '',
  ]);
  void signRow;
  push(['', '', field('MANAGER:'), input(sheet.managerName), '', '', '', '', '', '', '', '', '', '']);

  return {
    name: 'Timesheet',
    rows,
    merges,
    colWidths: [18, 12, 40, 14, 10, 10, 8, 8, 8, 8, 8, 9, 8, 46],
    rowHeights: { [h1]: 18 },
  };
}

/** Totals block appended to a timesheet export as a second sheet. */
export function timesheetSummarySheet(sheet: Timesheet): Sheet {
  const t = timesheetTotals(sheet);
  const rows: Row[] = [
    [{ v: 'WEEK SUMMARY', style: 'title' }, ''],
    [],
    [field('Employee'), input(sheet.employeeName)],
    [field('Week starting'), input(formatAuDate(sheet.weekStarting))],
    [field('Vehicle rego'), input(sheet.vehicleRego)],
    [field('Kilometer reading'), input(sheet.kilometerReading)],
    [],
    [{ v: 'Ordinary', style: 'header' }, t.ord],
    [{ v: 'Overtime', style: 'header' }, t.ot],
    [{ v: 'Double time', style: 'header' }, t.dt],
    [{ v: 'Worked total', style: 'header' }, t.worked],
    [],
    [{ v: 'Sick', style: 'header' }, t.sick],
    [{ v: 'RDO', style: 'header' }, t.rdo],
    [{ v: 'Annual', style: 'header' }, t.annual],
    [{ v: 'LWOP', style: 'header' }, t.lwop],
    [{ v: 'Public holiday', style: 'header' }, t.publicHoliday],
    [],
    [{ v: 'Grand total', style: 'header' }, { v: t.grand, style: 'header' }],
  ];
  return { name: 'Summary', rows, colWidths: [24, 18] };
}
