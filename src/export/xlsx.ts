import { createZip, toBase64, utf8Bytes, type ZipEntry } from './zip';

/**
 * Minimal XLSX (SpreadsheetML) writer.
 *
 * Supports what a fire service report actually needs: multiple sheets, a bold
 * frozen header row, column widths, text/number/date cells, live formulas,
 * coloured pass/fail cells and page setup for the forms that get printed.
 * Strings are written inline, which skips the shared-string table at a small
 * size cost and a large simplicity win.
 */

export type CellValue = string | number | boolean | null | undefined;

export type CellStyle =
  | 'default' | 'header' | 'title' | 'pass' | 'fail' | 'warn' | 'muted' | 'mono'
  /** Yellow input cell, matching the "fill the yellow cells" convention. */
  | 'input'
  /** Section band heading. */
  | 'section'
  /** Field label in the left column. */
  | 'field'
  /** Company name banner. */
  | 'banner'
  /** Bordered data cell, wrapping whatever text is in it. */
  | 'cell'
  /** Hours, to two decimals. */
  | 'hours'
  /** Hours in a leave column, tinted so it reads as not-worked at a glance. */
  | 'leave'
  /** A time of day, as hh:mm. */
  | 'time'
  /** A date, as dd/mm/yyyy. */
  | 'date'
  /** A figure on a totals row. */
  | 'total'
  /** The label on a totals row. */
  | 'totalLabel'
  /** A line to sign or write on. */
  | 'rule';

export interface Cell {
  v: CellValue;
  style?: CellStyle;
}

/**
 * A live formula, written without the leading "=".
 *
 * A formula handed over as the string "=SUM(G7:G12)" is text whatever it
 * says: the totals row on the timesheet showed the formula's letters and added
 * nothing up. The workbook is marked for a full calculation on load, so a
 * reader works the figure out itself — and `v` caches the answer beside the
 * formula for every reader that will not.
 */
export interface FormulaCell {
  f: string;
  style?: CellStyle;
  /**
   * The answer, cached beside the formula.
   *
   * Optional, and worth giving. A formula alone is a cell with no value in the
   * file: Excel works it out on load and shows it, but anything that reads the
   * workbook without a calculation engine — a script, a viewer, a mail client's
   * preview — finds nothing there. An emailed timesheet whose every figure is
   * a formula is a workbook that contains no numbers, which is not what payroll
   * was sent.
   *
   * It stays live. The cached value is what a reader sees until it recalculates,
   * and `fullCalcOnLoad` means Excel recalculates immediately, so an edited cell
   * still moves the total.
   */
  v?: number;
}

export type Row = (CellValue | Cell | FormulaCell)[];

/**
 * How a sheet prints.
 *
 * A form that goes to the office on paper is not laid out until this is set.
 * Fifteen columns of timesheet are wider than A4 whichever way the page is
 * turned, and Excel's default is to print what fits and push the rest onto a
 * second sheet of paper with no headings on it — the comments column stranded
 * on page two is the usual result, and it is the one column a payroll query is
 * always about. Paper is A4 throughout, because that is what the office has.
 */
export interface PageSetup {
  orientation?: 'portrait' | 'landscape';
  /** Scale the columns down to this many pages across. Height runs as long as it needs. */
  fitToWidth?: number;
  /** 1-based inclusive rows repeated at the top of every printed page. */
  repeatRows?: { from: number; to: number };
  /** Margins in inches. */
  margins?: { left: number; right: number; top: number; bottom: number };
  /** Centre the block left to right, so a narrow form is not pinned to the margin. */
  centreHorizontally?: boolean;
  /**
   * Left-hand footer text. The page count goes on the right.
   *
   * An ampersand starts a field code in a footer, so one cannot survive in the
   * text and is dropped.
   */
  footer?: string;
}

export interface Sheet {
  name: string;
  rows: Row[];
  /** Column widths in character units. */
  colWidths?: number[];
  /** Rows to freeze at the top. Usually 1. */
  freezeRows?: number;
  /** Turn on autofilter over the header row. */
  autoFilter?: boolean;
  /** Merged ranges in A1 notation, e.g. "A2:C2". */
  merges?: string[];
  /** Row heights in points, keyed by 1-based row number. */
  rowHeights?: Record<number, number>;
  /** How the sheet prints, for the ones that get printed. */
  page?: PageSetup;
}

// Style indices must match the order written in buildStyles().
const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  header: 1,
  title: 2,
  pass: 3,
  fail: 4,
  warn: 5,
  muted: 6,
  mono: 7,
  input: 8,
  section: 9,
  field: 10,
  banner: 11,
  cell: 12,
  hours: 13,
  leave: 14,
  time: 15,
  date: 16,
  total: 17,
  totalLabel: 18,
  rule: 19,
};

/**
 * Excel's serial number for a calendar day.
 *
 * A date written as text cannot be sorted, filtered or subtracted from another
 * one, and "12/08/2026" in a column that payroll sorts puts August after
 * December. Day zero is 30 December 1899, which absorbs Excel's belief that
 * 1900 was a leap year.
 */
export function excelDate(isoDay: string | undefined): number | undefined {
  if (!isoDay || !/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return undefined;
  const ms = Date.parse(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(ms)) return undefined;
  return Math.round(ms / 86400000) + 25569;
}

/** A time of day as Excel holds one: the fraction of a day it falls at. */
export function excelTime(minutesSinceMidnight: number): number {
  return minutesSinceMidnight / 1440;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters Excel rejects outright.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 0-based column index to spreadsheet letters: 0 -> A, 26 -> AA. */
export function colName(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function normaliseCell(c: CellValue | Cell | FormulaCell): Cell | FormulaCell {
  if (c !== null && typeof c === 'object' && ('v' in c || 'f' in c)) return c;
  return { v: c as CellValue };
}

/**
 * Excel caps sheet names at 31 characters and forbids : \ / ? * [ ].
 * Names must also be unique, so collisions get a numeric suffix.
 */
export function safeSheetName(name: string, taken: Set<string>): string {
  let base = (name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** A sheet name as a formula refers to it: quoted unless it is a bare word. */
function sheetRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function buildSheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  let maxCols = 0;

  sheet.rows.forEach((row, r) => {
    maxCols = Math.max(maxCols, row.length);
    const height = sheet.rowHeights?.[r + 1];
    const cells: string[] = [];
    row.forEach((raw, c) => {
      const cell = normaliseCell(raw);
      const ref = `${colName(c)}${r + 1}`;
      const s = cell.style ? STYLE_INDEX[cell.style] : 0;
      const sAttr = s ? ` s="${s}"` : '';
      if ('f' in cell) {
        if (!cell.f.trim()) return;
        const cached = typeof cell.v === 'number' && Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : '';
        cells.push(`<c r="${ref}"${sAttr}><f>${esc(cell.f)}</f>${cached}</c>`);
        return;
      }
      const v = cell.v;
      if (v === null || v === undefined || v === '') {
        /*
         * A blank cell that was given a style is still written, as a cell with
         * a style and no value. Dropping it drops the style with it: the
         * yellow box on a field nobody filled in came out white, the border
         * round the timesheet grid stopped at the last cell anybody had typed
         * in, and a merged box was only coloured as far as its first cell.
         * A blank with no style is left out as before — an empty cell and a
         * cell holding an empty string read differently to anything counting.
         */
        if (s) cells.push(`<c r="${ref}"${sAttr}/>`);
        return;
      }
      if (typeof v === 'number' && Number.isFinite(v)) {
        cells.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
      } else if (typeof v === 'boolean') {
        cells.push(`<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`);
      }
    });
    const heightAttr = height ? ` ht="${height}" customHeight="1"` : '';
    rows.push(`<row r="${r + 1}"${heightAttr}>${cells.join('')}</row>`);
  });

  const cols = sheet.colWidths?.length
    ? `<cols>${sheet.colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const freeze = sheet.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${
        sheet.freezeRows + 1
      }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '';

  const lastRow = Math.max(1, sheet.rows.length);
  const lastCol = colName(Math.max(0, maxCols - 1));
  const filter = sheet.autoFilter && sheet.rows.length > 1 ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : '';

  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${esc(ref)}"/>`)
        .join('')}</mergeCells>`
    : '';

  const page = sheet.page;
  // fitToWidth is ignored unless the sheet says it is fitting to a page, and
  // sheetPr is the first thing in a worksheet.
  const sheetPr = page?.fitToWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
  const printOptions = page?.centreHorizontally ? '<printOptions horizontalCentered="1"/>' : '';
  const m = page?.margins;
  const margins = page
    ? `<pageMargins left="${m?.left ?? 0.7}" right="${m?.right ?? 0.7}" top="${m?.top ?? 0.75}" bottom="${
        m?.bottom ?? 0.75
      }" header="0.3" footer="0.3"/>`
    : '';
  // paperSize 9 is A4.
  const pageSetup = page
    ? `<pageSetup paperSize="9" orientation="${page.orientation ?? 'portrait'}"${
        page.fitToWidth ? ` fitToWidth="${page.fitToWidth}" fitToHeight="0"` : ''
      }/>`
    : '';
  const footer = page?.footer
    ? `<headerFooter><oddFooter>${esc(`&L${page.footer.replace(/&/g, '')}&RPage &P of &N`)}</oddFooter></headerFooter>`
    : '';

  /*
   * Element order is the schema's, not a preference: autoFilter before
   * mergeCells, then the print block. A worksheet whose children are out of
   * order opens as a repair prompt, which on this app's output means a
   * technician's report or somebody's pay.
   */
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetPr}${freeze}${cols}<sheetData>${rows.join(
    '',
  )}</sheetData>${filter}${merges}${printOptions}${margins}${pageSetup}${footer}</worksheet>`;
}

function buildStyles(): string {
  // fonts: 0 default, 1 bold, 2 title, 3 muted, 4 mono
  // fills: 0 none, 1 gray125 (required), 2 header, 3 pass, 4 fail, 5 warn
  // Number formats 164 up are this file's own; everything below is built in,
  // and 2 is the "0.00" that keeps an hour reading as an hour.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="hh:mm"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
</numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/></font>
<font><sz val="10"/><name val="Consolas"/></font>
<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FFC00000"/><name val="Calibri"/></font>
</fonts>
<fills count="9">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF333F50"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD4EDDA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CD"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC00000"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="medium"><color rgb="FF333F50"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF808080"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="2" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="2" fontId="1" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="bottom"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

/** Builds the raw .xlsx bytes for the given sheets. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, taken) }));

  const sheetEntries = named.map((s, i) => ({
    id: i + 1,
    rid: `rId${i + 1}`,
    file: `xl/worksheets/sheet${i + 1}.xml`,
    name: s.name,
    xml: buildSheetXml(s),
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetEntries
  .map(
    (s) =>
      `<Override PartName="/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  /*
   * Repeating the headings on page two is a workbook-level defined name, not a
   * sheet setting, which is why it is built here rather than beside the rest of
   * the page setup. Without it page two of a long week is fifteen unlabelled
   * columns of numbers.
   */
  const printTitles = named
    .map((s, i) => {
      const repeat = s.page?.repeatRows;
      if (!repeat) return '';
      return `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(sheetRef(s.name))}!$${repeat.from}:$${
        repeat.to
      }</definedName>`;
    })
    .filter(Boolean);
  const definedNames = printTitles.length ? `<definedNames>${printTitles.join('')}</definedNames>` : '';

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries
    .map((s) => `<sheet name="${esc(s.name)}" sheetId="${s.id}" r:id="${s.rid}"/>`)
    .join('')}</sheets>
${definedNames}
<calcPr fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetEntries
  .map(
    (s) =>
      `<Relationship Id="${s.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: utf8Bytes(contentTypes) },
    { name: '_rels/.rels', data: utf8Bytes(rootRels) },
    { name: 'xl/workbook.xml', data: utf8Bytes(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8Bytes(workbookRels) },
    { name: 'xl/styles.xml', data: utf8Bytes(buildStyles()) },
    ...sheetEntries.map((s) => ({ name: s.file, data: utf8Bytes(s.xml) })),
  ];

  return createZip(entries);
}

/** Convenience wrapper: workbook straight to base64 for expo-file-system. */
export function buildXlsxBase64(sheets: Sheet[]): string {
  return toBase64(buildXlsx(sheets));
}
