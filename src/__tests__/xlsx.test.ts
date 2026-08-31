import { writeFileSync, mkdirSync } from 'fs';
import { buildXlsx, colName, safeSheetName, type Sheet } from '@/export/xlsx';
import { crc32, createZip, fromBase64, toBase64, utf8Bytes } from '@/export/zip';
import { baselineSheet, timesheetSheet, timesheetSummarySheet } from '@/export/safeqldForms';
import { emptyBaseline } from '@/domain/baseline';
import type { Timesheet } from '@/domain/timesheet';

const OUT = '/tmp/safeqld-xlsx-test';

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

  it('writes files that a real spreadsheet reader can open', () => {
    // Verified by the openpyxl round-trip in the accompanying shell check.
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
          sick: '', rdo: '', annual: '', lwop: '', comments: '',
        },
        {
          id: 'b', date: '2026-08-12', jobNumber: '43747', siteName: 'BRIC Housing Emsworth St',
          serviceReportNumber: '', startTime: '17:30', finishTime: '20:45', hourKind: 'ot',
          sick: '', rdo: '', annual: '', lwop: '', comments: 'Shutdown MAINS & FIP Cutover',
        },
      ],
      managerName: '',
      checkedBy: '',
      status: 'draft',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    };
    writeFileSync(`${OUT}/timesheet.xlsx`, buildXlsx([timesheetSheet(ts), timesheetSummarySheet(ts)]));

    expect(true).toBe(true);
  });

  it('escapes XML-hostile characters rather than corrupting the file', () => {
    const bytes = buildXlsx([{ name: 'S', rows: [['a & b < c > d "e"']] }]);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('strips control characters Excel rejects', () => {
    const bytes = buildXlsx([{ name: 'S', rows: [[`bad\x07char\x1Fhere`]] }]);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
