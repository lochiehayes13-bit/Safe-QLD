import { buildXlsx, type Cell, type CellValue, type FormulaCell, type Row, type Sheet } from '@/export/xlsx';
import { timesheetGeometry, timesheetSheet, timesheetSummarySheet } from '@/export/safeqldForms';
import { readZip } from '@/parsers/zipRead';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/**
 * The workbook payroll is emailed, as a document rather than as a set of values.
 *
 * `safeqldForms.test.ts` holds what the numbers say. This holds the shape they
 * are said in: the width of every row, what each merge covers, where the pane
 * is frozen, and whether the thing fits on a sheet of A4. None of that changes
 * a figure and all of it decides whether the figure can be read — a fifteen
 * column timesheet printed at Excel's default runs off the right hand edge, and
 * the column that ends up alone on page two is COMMENTS, which is the column
 * every payroll query is about.
 */

const entry = (over: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: 'a', date: '2026-08-12', jobNumber: '43747', siteName: 'BRIC Housing Emsworth St',
  serviceReportNumber: '', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
  sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: '', ...over,
});

const timesheet = (entries: TimesheetEntry[]): Timesheet => ({
  id: 't1', employeeName: 'Lachlan Hayes', vehicleRego: 'ABC123', kilometerReading: '120450',
  weekStarting: '2026-08-12', entries, managerName: '', checkedBy: '', status: 'draft',
  createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
});

/** A formula cell reads back as "=…", which is how a person would see it. */
const value = (c: Cell | FormulaCell | CellValue): unknown => {
  if (c !== null && typeof c === 'object' && 'f' in c) return `=${c.f}`;
  return c !== null && typeof c === 'object' && 'v' in c ? c.v : c;
};

const styleOf = (c: Cell | FormulaCell | CellValue): string | undefined =>
  c !== null && typeof c === 'object' && 'style' in c ? c.style : undefined;

const rowNumberOf = (rows: Row[], test: (r: Row) => boolean): number => rows.findIndex(test) + 1;

const part = (sheets: Sheet[], name: string): string => {
  const found = readZip(buildXlsx(sheets)).find((e) => e.name === name);
  expect({ name, found: Boolean(found) }).toEqual({ name, found: true });
  return Buffer.from(found!.bytes).toString('utf8');
};

const worked = [
  entry({ id: 'a', hourKind: 'ord', startTime: '06:30', finishTime: '14:30' }),
  entry({ id: 'b', hourKind: 'ot', startTime: '17:30', finishTime: '20:45', comments: 'Shutdown MAINS & FIP cutover' }),
  entry({ id: 'c', date: '2026-08-13', hourKind: 'dt', startTime: '21:00', finishTime: '23:00' }),
];

// A1 notation, as the merge list is written in.
const MERGE = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/;
const columnOf = (letters: string): number =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

describe('the timesheet as fifteen columns', () => {
  it('writes every row to the full width, or leaves it genuinely empty', () => {
    /*
     * The public holiday hours once sat under COMMENTS because a header row was
     * a column short, and the sign-off row after it was one cell wide. Counting
     * the widths that appear at all says it in one assertion: fifteen, or
     * nothing. A spacer row is the only row allowed to be neither.
     */
    const cases: [string, Timesheet][] = [
      ['an empty week', timesheet([])],
      ['one shift', timesheet([entry()])],
      ['a worked week', timesheet(worked)],
      ['a week of leave', timesheet([entry({ startTime: '', finishTime: '', annual: '7.6' })])],
    ];
    for (const [name, sheet] of cases) {
      const widths = [...new Set(timesheetSheet(sheet).rows.map((r) => r.length))].sort((a, b) => a - b);
      expect({ name, widths }).toEqual({ name, widths: [0, 15] });
    }
  });

  it('never merges a label over the value beside it', () => {
    /*
     * The odometer reading vanished. KILOMETER READING: sat in H and the
     * reading in I, and the row merged H:I — a merged range shows the top left
     * cell and nothing else, so the heading ate the number underneath it. It
     * printed as a form with a blank where the reading goes, which reads as a
     * technician who did not fill it in.
     */
    const sheet = timesheetSheet(timesheet(worked));
    const hidden: string[] = [];
    for (const ref of sheet.merges ?? []) {
      const m = ref.match(MERGE);
      expect({ ref, parsed: Boolean(m) }).toEqual({ ref, parsed: true });
      const [c1, r1, c2, r2] = [columnOf(m![1]!), Number(m![2]), columnOf(m![3]!), Number(m![4])];
      expect({ ref, insideTheSheet: r2 <= sheet.rows.length && c2 < 15 }).toEqual({ ref, insideTheSheet: true });
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          if (r === r1 && c === c1) continue;
          const covered = value(sheet.rows[r - 1]?.[c]);
          if (covered !== '' && covered !== undefined) hidden.push(`${ref} hides ${covered}`);
        }
      }
    }
    expect(hidden).toEqual([]);
  });

  it('paints every cell of a merged box, not just the corner it is anchored on', () => {
    // A merged cell draws the fill and the border of each cell under it. Style
    // only the first and the yellow box stops a third of the way across.
    const sheet = timesheetSheet(timesheet(worked));
    const ragged: string[] = [];
    for (const ref of sheet.merges ?? []) {
      const m = ref.match(MERGE)!;
      const [c1, r1, c2] = [columnOf(m[1]!), Number(m[2]), columnOf(m[3]!)];
      if (Number(m[4]) !== r1) continue;
      const anchor = styleOf(sheet.rows[r1 - 1]?.[c1]);
      for (let c = c1; c <= c2; c += 1) {
        if (styleOf(sheet.rows[r1 - 1]?.[c]) !== anchor) ragged.push(`${ref} at column ${c}`);
      }
    }
    expect(ragged).toEqual([]);
  });

  it('freezes under the second tier of the header, not under the letterhead', () => {
    /*
     * Nothing was frozen at all. A banner, a title and two detail rows sit
     * above the headings now, so freezing the first row would hold the company
     * name on screen and let the column names scroll away — which is the state
     * a long week is read in.
     */
    const sheet = timesheetSheet(timesheet(worked));
    const tier1 = rowNumberOf(sheet.rows, (r) => value(r[0]) === 'Date');
    const tier2 = rowNumberOf(sheet.rows, (r) => value(r[6]) === 'ORD');

    expect(tier2).toBe(tier1 + 1);
    expect(sheet.freezeRows).toBe(tier2);
    expect(sheet.page?.repeatRows).toEqual({ from: tier1, to: tier2 });
  });

  it('sets the page up to print on A4 rather than across two of them', () => {
    const page = timesheetSheet(timesheet(worked)).page!;
    expect({ orientation: page.orientation, fitToWidth: page.fitToWidth }).toEqual({
      orientation: 'landscape',
      fitToWidth: 1,
    });
    expect(page.footer).toContain('Lachlan Hayes');
  });

  it('keeps the columns narrow enough that fitting them to the page is still legible', () => {
    /*
     * Fit-to-width will shrink anything. The comments column was 46 characters
     * wide on a sheet already 215 wide, which fits on A4 at about two thirds
     * size — legible on a screen and not on paper. Around 180 character units
     * is a page at roughly 80%, which is where this has to stay.
     */
    const widths = timesheetSheet(timesheet(worked)).colWidths!;
    expect(widths).toHaveLength(15);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(190);
  });

  it('gives a row with a long comment the height to show it', () => {
    // A wrapped cell in a generated file opens at the default height, so the
    // rest of the comment sits behind the row below.
    const long = timesheetSheet(timesheet([entry({ comments: 'Isolated block C '.repeat(8) })]));
    const short = timesheetSheet(timesheet([entry({ siteName: 'Logan DC', comments: 'Done' })]));
    const at = (s: Sheet) => s.rowHeights![rowNumberOf(s.rows, (r) => value(r[1]) === '43747')]!;

    expect(at(short)).toBe(18);
    expect(at(long)).toBeGreaterThan(at(short));
  });
});

describe('what the cells hold', () => {
  const sheet = timesheetSheet(timesheet([
    entry({ sick: '3.8', publicHoliday: '7.60', comments: 'Show day' }),
  ]));
  const data = sheet.rows.find((r) => value(r[1]) === '43747')!;

  it('writes leave as a figure, because the totals row adds it up', () => {
    /*
     * Leave is typed on a phone and lives on an entry as a string. Written out
     * as text it is not a number to SUM, and the totals under all five leave
     * columns read zero however much leave was in them — on the row payroll
     * reads the week off.
     */
    expect(value(data[9])).toBe(3.8);
    expect(value(data[13])).toBe(7.6);
    expect(styleOf(data[13])).toBe('leave');
  });

  it('marks the leave columns apart from the worked ones', () => {
    // Five leave columns and three worked ones, in the same eight characters of
    // width, under a header that spans both. A tint is what separates them at a
    // glance on a printed page.
    expect([6, 7, 8].map((c) => styleOf(data[c]))).toEqual(['hours', 'hours', 'hours']);
    expect([9, 10, 11, 12, 13].map((c) => styleOf(data[c]))).toEqual(Array(5).fill('leave'));
  });

  it('writes a start and a finish as times of day', () => {
    // 06:30 as text sorts next to 6.30am and subtracts from nothing.
    expect(data[4]).toEqual({ v: 390 / 1440, style: 'time' });
    expect(data[5]).toEqual({ v: 870 / 1440, style: 'time' });
  });

  it('prints a time or a figure it cannot read as the words somebody typed', () => {
    /*
     * A blank cell is the one thing these must not become. "6.30am" is still
     * the only record of when the technician arrived, and "half day" in the
     * sick column is somebody's pay.
     */
    const odd = timesheetSheet(timesheet([entry({ startTime: '6.30am', sick: 'half day' })]));
    const row = odd.rows.find((r) => value(r[1]) === '43747')!;
    expect(value(row[4])).toBe('6.30am');
    expect(value(row[9])).toBe('half day');
  });

  it('leaves an empty time and an empty leave column empty', () => {
    const blank = timesheetSheet(timesheet([entry({ startTime: '', finishTime: '', annual: '7.6' })]));
    const row = blank.rows.find((r) => value(r[1]) === '43747')!;
    expect([value(row[4]), value(row[5]), value(row[9])]).toEqual(['', '', '']);
  });
});

describe('the summary and the timesheet as one workbook', () => {
  const entriesOf = (n: number): TimesheetEntry[] =>
    Array.from({ length: n }, (_, i) => entry({ id: `e${i}`, date: i < 2 ? '2026-08-12' : '2026-08-13' }));

  it('knows which row the totals land on, whatever the week holds', () => {
    /*
     * The summary quotes the timesheet's cells by row number. Worked out in one
     * place and used in two, so the only way it can be wrong is if the row
     * block above the data changes height — which is what this reads back off
     * the built sheet.
     */
    for (const n of [0, 1, 3, 9]) {
      const sheet = timesheet(entriesOf(n));
      const built = timesheetSheet(sheet);
      const totalsRow = rowNumberOf(built.rows, (r) => value(r[2]) === 'TOTAL HOURS' && value(r[0]) === '');
      const firstData = rowNumberOf(built.rows, (r) => value(r[1]) === '43747');

      expect({ n, totals: timesheetGeometry(sheet).totals }).toEqual({ n, totals: totalsRow });
      if (n > 0) expect({ n, first: timesheetGeometry(sheet).first }).toEqual({ n, first: firstData });
    }
  });

  it('reads its figures off the timesheet rather than adding the week up twice', () => {
    // Two totals for one week in one workbook is the thing that gets queried.
    const sheet = timesheet(worked);
    const { totals } = timesheetGeometry(sheet);
    const rows = timesheetSummarySheet(sheet).rows;
    const at = (label: string) => value(rows.find((r) => value(r[0]) === label)![1]);

    expect(at('Ordinary')).toBe(`=Timesheet!G${totals}`);
    expect(at('Double time')).toBe(`=Timesheet!I${totals}`);
    expect(at('Public holiday')).toBe(`=Timesheet!N${totals}`);
    expect(at('Worked total')).toMatch(/^=SUM\(B\d+:B\d+\)$/);
    expect(at('PAID TOTAL')).toMatch(/^=B\d+\+B\d+$/);
  });

  it('breaks the week down by day over each day’s own rows', () => {
    const sheet = timesheet(worked);
    const rows = timesheetSummarySheet(sheet).rows;
    const days = rows.filter((r) => String(value(r[1])).startsWith('=SUM(Timesheet!'));
    const { first } = timesheetGeometry(sheet);

    // Two entries on the Wednesday, one on the Thursday, in that order.
    expect(days.map((r) => [value(r[0]), value(r[1])])).toEqual([
      ['Wed 12/08/2026', `=SUM(Timesheet!G${first}:N${first + 1})`],
      ['Thu 13/08/2026', `=SUM(Timesheet!G${first + 2}:N${first + 2})`],
    ]);
    expect(value(days[0]![2])).toBe('BRIC Housing Emsworth St');
  });

  it('names a day off by what kind of day off it was', () => {
    const off = timesheet([entry({ siteName: '', startTime: '', finishTime: '', annual: '7.6' })]);
    const rows = timesheetSummarySheet(off).rows;
    expect(value(rows.find((r) => String(value(r[0])).startsWith('Wed'))![2])).toBe('Annual leave');
  });

  it('counts the allowances out of the comments column', () => {
    /*
     * Extras are written in with the comments, because payroll's template has
     * no column for them. Read down fifteen columns of a long week they get
     * missed, and an allowance that is missed is not paid.
     */
    const sheet = timesheet([
      entry({ id: 'a', extras: ['Call-out', 'Meal allowance'] }),
      entry({ id: 'b', date: '2026-08-13', extras: ['Meal allowance'] }),
    ]);
    const rows = timesheetSummarySheet(sheet).rows;
    const at = (label: string) => value(rows.find((r) => value(r[0]) === label)![1]);

    expect(at('Meal allowance')).toBe(2);
    expect(at('Call-out')).toBe(1);
  });

  it('says nothing about allowances on a week that had none', () => {
    const rows = timesheetSummarySheet(timesheet(worked)).rows;
    expect(JSON.stringify(rows)).not.toContain('ALLOWANCES');
  });

  it('still makes a sheet out of a week with nothing on it', () => {
    const sheet = timesheetSummarySheet(timesheet([]));
    expect(JSON.stringify(sheet.rows)).not.toContain('DAY BY DAY');
    expect(sheet.rows.some((r) => value(r[0]) === 'PAID TOTAL')).toBe(true);
  });
});

describe('the file Excel opens', () => {
  const book = () => [timesheetSheet(timesheet(worked)), timesheetSummarySheet(timesheet(worked))];

  it('repeats the two header rows at the top of page two', () => {
    /*
     * Print titles are a workbook defined name, not a sheet setting. Without
     * one, page two of a long week is fifteen unlabelled columns of figures.
     */
    const workbook = part(book(), 'xl/workbook.xml');
    expect(workbook).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Timesheet!$6:$7</definedName>');
    // And only for the sheet that asked: the summary prints on one page.
    expect(workbook.match(/Print_Titles/g)).toHaveLength(1);
  });

  it('writes the print block, in the order the schema puts it in', () => {
    /*
     * A worksheet whose children are out of order opens as a repair prompt.
     * mergeCells was written before autoFilter, which is the wrong way round —
     * no sheet had both until now, so nothing ever proved it.
     */
    const xml = part([{
      name: 'S',
      rows: [['a', 'b'], ['c', 'd']],
      freezeRows: 1,
      autoFilter: true,
      merges: ['A2:B2'],
      page: { orientation: 'landscape', fitToWidth: 1, repeatRows: { from: 1, to: 1 }, footer: 'x' },
    }], 'xl/worksheets/sheet1.xml');

    const order = ['<sheetPr>', '<sheetViews>', '<sheetData>', '<autoFilter', '<mergeCells', '<pageMargins', '<pageSetup', '<headerFooter>'];
    expect(order.map((tag) => xml.indexOf(tag)).filter((i) => i < 0)).toEqual([]);
    expect(order.map((tag) => xml.indexOf(tag))).toEqual([...order.map((tag) => xml.indexOf(tag))].sort((a, b) => a - b));
    expect(xml).toContain('paperSize="9"');
    expect(xml).toContain('fitToWidth="1" fitToHeight="0"');
  });

  it('writes a spacer as a row that is there and empty', () => {
    /*
     * Every merge on the sheet is an absolute reference. A blank row dropped
     * rather than written would pull every row after it up one and leave the
     * merges pointing at the wrong things.
     */
    const xml = part([{ name: 'S', rows: [['a'], [], ['b']] }], 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<row r="2"></row>');
    expect(xml).toContain('<row r="3"><c r="A3"');
  });

  it('has a style for every style the sheets ask for', () => {
    /*
     * Styles are referenced by their index in a table written by hand in
     * another function. An index past the end of that table is a number format
     * Excel picks for itself, or a file it will not open at all.
     */
    const styles = part(book(), 'xl/styles.xml');
    const declared = Number(styles.match(/<cellXfs count="(\d+)"/)![1]);
    const block = styles.slice(styles.indexOf('<cellXfs'), styles.indexOf('</cellXfs>'));
    expect(block.match(/<xf /g)).toHaveLength(declared);

    for (const index of [1, 2]) {
      const used = [...part(book(), `xl/worksheets/sheet${index}.xml`).matchAll(/ s="(\d+)"/g)].map((m) => Number(m[1]));
      expect({ index, past: used.filter((s) => s >= declared) }).toEqual({ index, past: [] });
      expect({ index, uses: used.length > 0 }).toEqual({ index, uses: true });
    }
  });

  it('declares the number formats the hours, times and dates are written in', () => {
    // An hour in a cell formatted as text is not an hour, and it was: every
    // value on the sheet went out in the yellow input style, which is text.
    const styles = part(book(), 'xl/styles.xml');
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="hh:mm"/>');
    expect(styles).toContain('<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>');
    expect(styles).toContain('numFmtId="2"');
  });

  it('is a workbook of a reasonable size with both sheets in it', () => {
    const names = readZip(buildXlsx(book())).map((e) => e.name);
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/worksheets/sheet2.xml');
  });
});

describe('a workbook that contains numbers', () => {
  /*
   * The fault this pins: every figure on both sheets became a cross-sheet
   * formula, and a FormulaCell writes no value of its own. Excel works them
   * out on load and shows them, so the sheet looked right to anybody who
   * opened it in Excel — and the file itself held no number anywhere. Payroll
   * does not only open these in Excel. A preview pane, a script, a reader
   * pulling the hours into another system: all of them find empty cells.
   */
  const sheet = timesheet([
    entry({ date: '2026-08-12', hourKind: 'ord', startTime: '06:30', finishTime: '14:30' }),
    entry({ date: '2026-08-13', hourKind: 'ot', startTime: '17:30', finishTime: '20:45' }),
    entry({ date: '2026-08-14', sick: '7.6' }),
  ]);

  it('caches the answer beside every formula on the summary', () => {
    for (const row of timesheetSummarySheet(sheet).rows) {
      for (const cell of row) {
        if (cell !== null && typeof cell === 'object' && 'f' in cell) {
          expect(typeof (cell as FormulaCell).v).toBe('number');
        }
      }
    }
  });

  it('writes that answer into the file, beside the formula and not instead of it', () => {
    const xml = part([timesheetSheet(sheet), timesheetSummarySheet(sheet)], 'xl/worksheets/sheet2.xml');
    // <f>…</f><v>8</v>, in that order: the formula stays live and the value is
    // what a reader without a calculation engine gets.
    const formulas = [...xml.matchAll(/<f>([^<]*)<\/f>(<v>[^<]*<\/v>)?/g)];
    expect(formulas.length).toBeGreaterThan(5);
    for (const [, f, cached] of formulas) expect({ f, cached: Boolean(cached) }).toEqual({ f, cached: true });
  });

  it('does not write an empty value element for a formula with no answer to cache', () => {
    const xml = part([{ name: 'X', rows: [[{ f: 'NOW()' } as FormulaCell]] }], 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<f>NOW()</f></c>');
    expect(xml).not.toContain('<v></v>');
  });
});
