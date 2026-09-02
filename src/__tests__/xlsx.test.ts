import { writeFileSync, mkdirSync, statSync } from 'fs';
import { buildXlsx, colName, safeSheetName, type Sheet } from '@/export/xlsx';
import { crc32, createZip, fromBase64, toBase64, utf8Bytes } from '@/export/zip';
import { readZip } from '@/parsers/zipRead';
import { baselineSheet, timesheetSheet, timesheetSummarySheet } from '@/export/safeqldForms';
import { emptyBaseline } from '@/domain/baseline';
import type { Timesheet } from '@/domain/timesheet';

const OUT = '/tmp/safeqld-xlsx-test';

/**
 * The workbook, read back through this app's own zip reader.
 *
 * A .xlsx is a zip of XML, and the only way to know what one says is to open
 * it. Three checks in here used to build a workbook and assert that it had a
 * non-zero length — under names that promised the escaping and the control
 * characters were handled. They passed on a writer with the escaping removed,
 * which is how a mutation sweep found two hundred and seventy-four surviving
 * mutants in a file that reads as thoroughly tested.
 *
 * That matters on this file in particular. Device labels come off customer
 * panels and contain whatever somebody typed into a panel twenty years ago; an
 * unescaped ampersand or a stray control character is a workbook Excel refuses
 * to open, handed to a client as the record of a service they paid for.
 */
function sheetXml(sheets: Sheet[], index = 1): string {
  const entry = readZip(buildXlsx(sheets)).find((e) => e.name === `xl/worksheets/sheet${index}.xml`);
  expect({ found: Boolean(entry) }).toEqual({ found: true });
  return Buffer.from(entry!.bytes).toString('utf8');
}

describe('zip primitives', () => {
  it('computes the standard CRC-32', () => {
    // Well-known check value for the ASCII string "123456789".
    expect(crc32(utf8Bytes('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('pads base64 correctly at every length remainder', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => i * 31));
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('writes a zip with the expected signatures', () => {
    const zip = createZip([{ name: 'a.txt', data: utf8Bytes('hello') }]);
    // Local file header, then an end-of-central-directory record.
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    const tail = zip.subarray(zip.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });

  it('produces byte-identical output for identical input', () => {
    const make = () => createZip([{ name: 'a.txt', data: utf8Bytes('deterministic') }]);
    expect(Array.from(make())).toEqual(Array.from(make()));
  });
});

describe('column names', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('maps index %i to %s', (i, expected) => {
    expect(colName(i)).toBe(expected);
  });
});

describe('sheet names', () => {
  it('strips characters Excel rejects', () => {
    expect(safeSheetName('Level 3 / Plant: Room', new Set())).toBe('Level 3   Plant  Room');
  });

  it('caps length at 31 characters', () => {
    expect(safeSheetName('x'.repeat(60), new Set())).toHaveLength(31);
  });

  it('de-duplicates collisions', () => {
    const taken = new Set<string>();
    expect(safeSheetName('Points', taken)).toBe('Points');
    expect(safeSheetName('Points', taken)).toBe('Points (2)');
    expect(safeSheetName('Points', taken)).toBe('Points (3)');
  });
});

describe('workbook generation', () => {
  const sheets: Sheet[] = [
    {
      name: 'Data',
      rows: [
        [{ v: 'Name', style: 'header' }, { v: 'Value', style: 'header' }],
        ['Ampersand & angle <brackets>', 42],
        ['Quotes "here"', true],
        ['', null],
      ],
      colWidths: [30, 12],
      freezeRows: 1,
      merges: ['A4:B4'],
    },
  ];

  it('emits a non-trivial zip', () => {
    const bytes = buildXlsx(sheets);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('is a zip carrying every part a spreadsheet reader needs', () => {
    /*
     * The parts, not the byte count. A workbook missing its content types or
     * its styles opens as a repair prompt or not at all, and the previous
     * check for this asserted `true`.
     */
    expect(readZip(buildXlsx(sheets)).map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes a number as a number and text as text', () => {
    // A figure stored as text cannot be summed, charted or compared, and every
    // measurement this app exports is a figure somebody works with.
    const xml = sheetXml([{ name: 'S', rows: [['Pressure', 812.5]] }]);
    expect(xml).toContain('<v>812.5</v>');
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Pressure</t></is></c>');
  });

  it('leaves an empty cell out rather than writing an empty one', () => {
    // An empty cell and a cell holding an empty string read differently to
    // anything that filters or counts.
    const xml = sheetXml([{ name: 'S', rows: [['a', '', null, 'd']] }]);
    expect(xml).toContain('r="A1"');
    expect(xml).toContain('r="D1"');
    expect(xml).not.toContain('r="B1"');
    expect(xml).not.toContain('r="C1"');
  });

  it('writes sample files a person can open by hand', () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/basic.xlsx`, buildXlsx(sheets));

    const baseline = emptyBaseline('site-1', 'bl-1', '2026-08-31T00:00:00.000Z');
    baseline.premisesName = 'BRIC Housing Emsworth St';
    baseline.systemType = 'Ampac FireFinder PLUS';
    baseline.quiescentCurrentA = '0.5';
    baseline.fullAlarmCurrentA = '0.8';
    baseline.batteryAh = '17';
    baseline.equipment['Warden phones'] = 'YES';
    baseline.confirmations['100% of the fire system tested'] = 'YES';
    baseline.zoneResults[0] = { zone: 1, qty: '24', deviceTypes: '24 smoke' };
    baseline.zoneResults[1] = { zone: 2, qty: '3', deviceTypes: '3 heat A & Other' };
    writeFileSync(`${OUT}/baseline.xlsx`, buildXlsx([baselineSheet(baseline)]));

    const ts: Timesheet = {
      id: 't1',
      employeeName: 'Lachlan Hayes',
      vehicleRego: 'ABC123',
      kilometerReading: '120450',
      weekStarting: '2026-08-12',
      entries: [
        {
          id: 'a', date: '2026-08-12', jobNumber: '43747', siteName: 'BRIC Housing Emsworth St',
          serviceReportNumber: '', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
          sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: '',
        },
        {
          id: 'b', date: '2026-08-12', jobNumber: '43747', siteName: 'BRIC Housing Emsworth St',
          serviceReportNumber: '', startTime: '17:30', finishTime: '20:45', hourKind: 'ot',
          sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: 'Shutdown MAINS & FIP Cutover',
        },
      ],
      managerName: '',
      checkedBy: '',
      status: 'draft',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    };
    writeFileSync(`${OUT}/timesheet.xlsx`, buildXlsx([timesheetSheet(ts), timesheetSummarySheet(ts)]));

    /*
     * Written for somebody to open, and checked here for the one thing a file
     * on disk cannot check itself: that each is a workbook rather than a
     * zero-length file left behind by a throw.
     */
    for (const name of ['basic', 'baseline', 'timesheet']) {
      expect({ name, ok: statSync(`${OUT}/${name}.xlsx`).size > 500 }).toEqual({ name, ok: true });
    }
  });

  it('escapes XML-hostile characters rather than corrupting the file', () => {
    /*
     * This asserted a non-zero byte length, under this name. Remove the
     * escaping and it still passed — and an unescaped ampersand in a device
     * label is a workbook Excel will not open.
     */
    const xml = sheetXml([{ name: 'S', rows: [[`a & b < c > d "e" f'g`]] }]);
    expect(xml).toContain('a &amp; b &lt; c &gt; d &quot;e&quot; f&apos;g');
    // And none of them survived raw into the document.
    const body = xml.slice(xml.indexOf('<sheetData>'));
    expect(body).not.toContain('a & b');
    expect(body).not.toContain('< c');
  });

  it('strips control characters Excel rejects', () => {
    // Excel does not open a file containing these, whatever they are escaped
    // to, so they are removed rather than encoded. Panels are full of them.
    const xml = sheetXml([{ name: 'S', rows: [[`bad\x07char\x1Fhere`]] }]);
    expect(xml).toContain('>badcharhere<');
    expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });

  it('keeps a tab and a newline, which are legal and meaningful', () => {
    // The strip has to be narrower than "control characters": a comment field
    // holding two lines is not corrupt, and flattening it loses what it said.
    const xml = sheetXml([{ name: 'S', rows: [['line one\nline two\tend']] }]);
    expect(xml).toContain('line one\nline two\tend');
  });
});

/**
 * The UTF-8 encoder that has never run.
 *
 * `utf8Bytes` uses TextEncoder where there is one and falls back to encoding by
 * hand. Hermes and Node both have TextEncoder, so the fallback has never
 * executed — not on a handset and not in this suite, which is exactly where a
 * surrogate-pair bug waits. It writes every filename in every zip and every
 * string in every workbook, so if it ever does run and gets a byte wrong, the
 * file is unreadable rather than slightly wrong.
 *
 * Checked against TextEncoder itself, because "agrees with the thing it stands
 * in for" is the whole specification.
 */
describe('encoding text without TextEncoder', () => {
  const withoutTextEncoder = <T>(fn: () => T): T => {
    const real = globalThis.TextEncoder;
    // @ts-expect-error deliberately removing it for the length of the call
    delete globalThis.TextEncoder;
    try {
      return fn();
    } finally {
      globalThis.TextEncoder = real;
    }
  };

  const both = (s: string): [number[], number[]] => {
    const reference = Array.from(new TextEncoder().encode(s));
    const fallback = Array.from(withoutTextEncoder(() => utf8Bytes(s)));
    return [fallback, reference];
  };

  it('is actually taking the fallback path', () => {
    // Otherwise every case below compares TextEncoder with itself and passes
    // for the rest of this repository's life.
    expect(withoutTextEncoder(() => typeof TextEncoder)).toBe('undefined');
    expect(typeof TextEncoder).toBe('function');
  });

  it('agrees on everything this app actually writes', () => {
    for (const s of [
      'Logan DC',
      'Level 3 / Plant Room',
      'café',                       // two-byte
      '— … ° ±',                    // the punctuation the documents emit
      '日本',                        // three-byte
      '🔥 a🔥b',                     // four-byte, and a pair between two letters
      'Ω≈ç√∫',
      '',
    ]) {
      const [fallback, reference] = both(s);
      expect([s, fallback]).toEqual([s, reference]);
    }
  });

  it('agrees on a surrogate that lost its other half', () => {
    /*
     * Not a character, and it has no UTF-8 encoding. Encoded literally it comes
     * out as ED A0 80 — the CESU-8 form, which strict readers reject — so one
     * stray half from a truncated panel label would make a whole workbook
     * unreadable rather than one cell wrong. TextEncoder substitutes U+FFFD.
     */
    for (const s of ['\uD800', 'x\uDC00y', 'a\uD83Db']) {
      const [fallback, reference] = both(s);
      expect([s, fallback]).toEqual([s, reference]);
    }
    expect(Array.from(withoutTextEncoder(() => utf8Bytes('\uD800')))).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('agrees at each width boundary', () => {
    // One code point either side of every change in encoded length.
    for (const cp of [0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff]) {
      const s = String.fromCodePoint(cp);
      const [fallback, reference] = both(s);
      expect([cp.toString(16), fallback]).toEqual([cp.toString(16), reference]);
    }
  });
});
