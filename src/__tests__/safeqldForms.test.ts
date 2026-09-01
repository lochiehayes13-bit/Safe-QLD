import { baselineSheet, timesheetSheet } from '@/export/safeqldForms';
import { emptyBaseline } from '@/domain/baseline';
import type { Cell, CellValue, Row } from '@/export/xlsx';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/**
 * The two forms the company fills in by hand.
 *
 * Both had a hundred per cent statement coverage and no assertions at all —
 * the only test touching them writes sample files to disk for somebody to open.
 * So every line ran and nothing checked what came out, which is the same shape
 * as the workbook writer's `expect(true).toBe(true)`.
 *
 * One of them decides what a person is paid.
 */

const value = (c: Cell | CellValue): unknown =>
  (c !== null && typeof c === 'object' && 'v' in c ? c.v : c);

const flat = (rows: Row[]): unknown[][] => rows.map((r) => r.map(value));

const entry = (over: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: 'a', date: '2026-08-12', jobNumber: '43747', siteName: 'BRIC Housing Emsworth St',
  serviceReportNumber: '', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
  sick: '', rdo: '', annual: '', lwop: '', comments: '', ...over,
});

const timesheet = (entries: TimesheetEntry[]): Timesheet => ({
  id: 't1', employeeName: 'Lachlan Hayes', vehicleRego: 'ABC123', kilometerReading: '120450',
  weekStarting: '2026-08-12', entries, managerName: '', checkedBy: '', status: 'draft',
  createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
});

/** Columns G, H and I: ordinary, overtime, double time. */
const HOURS = [6, 7, 8] as const;

describe('the hours on a timesheet', () => {
  const worked = [
    entry({ id: 'a', hourKind: 'ord', startTime: '06:30', finishTime: '14:30' }),
    entry({ id: 'b', hourKind: 'ot', startTime: '17:30', finishTime: '20:45' }),
    entry({ id: 'c', hourKind: 'dt', startTime: '21:00', finishTime: '23:00' }),
  ];

  it('puts each shift in the column its rate is paid at, and nowhere else', () => {
    /*
     * Eight hours appearing in the overtime column is not a display bug, it is
     * a person paid the wrong amount. Each row is checked across all three so a
     * value cannot be right in one place and also present in another.
     */
    const rows = flat(timesheetSheet(timesheet(worked)).rows)
      .filter((r) => HOURS.some((c) => typeof r[c] === 'number'));

    expect(rows.map((r) => HOURS.map((c) => r[c]))).toEqual([
      [8, '', ''],
      ['', 3.25, ''],
      ['', '', 2],
    ]);
  });

  it('totals exactly the rows the shifts are on', () => {
    /*
     * The totals are live formulas rather than baked numbers, so the sheet
     * still adds up when somebody edits a cell. That makes the range the whole
     * of the correctness: a SUM one row short silently drops a shift, and
     * nothing on the page looks wrong.
     *
     * The expected range is read off the sheet rather than written down, so
     * this keeps holding when the header block above it changes height.
     */
    const rows = flat(timesheetSheet(timesheet(worked)).rows);
    const dataRows = rows
      .map((r, i) => (HOURS.some((c) => typeof r[c] === 'number') ? i + 1 : 0))
      .filter(Boolean);
    const totals = rows.find((r) => String(r[HOURS[0]]).startsWith('=SUM'))!;

    expect(dataRows).toHaveLength(3);
    const first = dataRows[0];
    const last = dataRows[dataRows.length - 1];
    expect(totals[HOURS[0]]).toBe(`=SUM(G${first}:G${last})`);
    expect(totals[HOURS[1]]).toBe(`=SUM(H${first}:H${last})`);
    expect(totals[HOURS[2]]).toBe(`=SUM(I${first}:I${last})`);
  });

  it('totals a single shift over its own row rather than a wider guess', () => {
    const rows = flat(timesheetSheet(timesheet([entry()])).rows);
    const dataRow = rows.findIndex((r) => typeof r[HOURS[0]] === 'number') + 1;
    const totals = rows.find((r) => String(r[HOURS[0]]).startsWith('=SUM'))!;
    expect(totals[HOURS[0]]).toBe(`=SUM(G${dataRow}:G${dataRow})`);
  });

  it('writes a zero rather than a formula over nothing', () => {
    /*
     * A week with no entries. `=SUM(G7:G6)` is a range that runs backwards and
     * a spreadsheet shows it as an error, on a form that goes to payroll — so
     * the empty week is a plain zero.
     */
    const totals = flat(timesheetSheet(timesheet([])).rows)
      .find((r) => r[2] === 'TOTAL HOURS' && r[0] === '')!;
    expect(HOURS.map((c) => totals[c])).toEqual([0, 0, 0]);
    expect(JSON.stringify(totals)).not.toContain('SUM');
  });

  it('dates the first shift of a day and not the ones after it', () => {
    // Reading down a column of the same date three times is how a duplicated
    // row gets missed.
    const rows = flat(timesheetSheet(timesheet(worked)).rows)
      .filter((r) => r[1] === '43747');
    expect(rows.map((r) => r[0])).toEqual(['Wed 12/08/2026', '', '']);
  });
});

describe('the baseline data form', () => {
  const sheet = (b = emptyBaseline('s1', 'b1', '2026-08-31T00:00:00.000Z')) => flat(baselineSheet(b).rows);

  it('leaves an unanswered item blank rather than printing undefined', () => {
    /*
     * The equipment and confirmation lists are fixed, and a technician fills in
     * what applies. Every one of them is unanswered on a fresh baseline, and
     * that is the ordinary state of the form rather than an edge case.
     */
    const rows = sheet();
    expect(JSON.stringify(rows)).not.toContain('undefined');
    const warden = rows.find((r) => String(r[0]).includes('Warden phones'))!;
    expect(warden[2]).toBe('');
  });

  it('says only what was recorded about the battery', () => {
    // The three parts are joined with a separator, and a part nobody wrote
    // must not leave a stray "V" or a dangling dash behind it.
    const b = emptyBaseline('s1', 'b1', '2026-08-31T00:00:00.000Z');
    b.batteryVoltage = '';
    b.batteryStandbyHours = '';
    b.batteryAh = '17';
    const line = sheet(b).find((r) => String(r[0]).includes('Battery type'))!;
    expect(line[2]).toBe('17 Ah');
  });

  it('joins the parts that are there', () => {
    const b = emptyBaseline('s1', 'b1', '2026-08-31T00:00:00.000Z');
    b.batteryAh = '17';
    expect(sheet(b).find((r) => String(r[0]).includes('Battery type'))![2]).toBe('24 V - 17 Ah - 24 hr');
  });

  it('leaves the zone total blank rather than claiming a count of zero', () => {
    /*
     * A blank total is a form nobody has filled in yet. A printed 0 is a
     * statement that the panel has no devices on it, which is a different
     * thing to hand somebody.
     */
    const rows = sheet();
    const total = rows.find((r) => r[0] === 'Total')!;
    expect(total[1]).toBe('');
  });

  it('adds up the zones that were counted', () => {
    const b = emptyBaseline('s1', 'b1', '2026-08-31T00:00:00.000Z');
    b.zoneResults[0] = { zone: 1, qty: '24', deviceTypes: '24 smoke' };
    b.zoneResults[1] = { zone: 2, qty: '3', deviceTypes: '3 heat A & Other' };
    expect(sheet(b).find((r) => r[0] === 'Total')![1]).toBe(27);
  });
});
