import {
  causeEffectMatrixSheet, checkSheet, defectSheet, pointSheet, reportCoverSheet,
  testResultSheet, zoneSheet, type ReportBundle,
} from '@/export/sheets';
import type {
  CauseEffectRule, CheckRow, Defect, Panel, Point, ServiceReport, Site, TestResult, TestRow, Zone,
} from '@/domain/types';

/**
 * The workbook a client is sent.
 *
 * These builders had no tests at all, which is how both of the faults below
 * survived: neither throws, neither looks wrong in the code, and both are
 * statements about coverage on a document that records statutory maintenance.
 *
 * The app is careful about this everywhere else. "Not tested" is a distinct
 * result with a required reason, because an inaccessible device is the
 * commonest real outcome on an annual — calling one a pass hides a coverage
 * gap and calling it a failure invents a defect that is not there. The routine
 * service report counts them apart so its summary cannot claim a coverage its
 * pages do not show. The spreadsheet did neither.
 */

const site: Site = {
  id: 's1', name: 'An Example Building', address: '12 Example Street', suburb: 'Ipswich',
  state: 'QLD', postcode: '4305', clientName: 'Example Body Corporate',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const report: ServiceReport = {
  id: 'r1', siteId: 's1', title: 'Annual service', frequency: 'annual',
  serviceDate: '2026-07-03', technicianName: 'A Technician', status: 'draft',
  createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
};

const testRow = (result: TestResult, over: Partial<TestRow> = {}): TestRow => ({
  id: `t-${result}-${over.sortIndex ?? 0}`, reportId: 'r1', deviceText: 'PLANT ROOM',
  deviceType: 'smoke-photo', result, sortIndex: 0, ...over,
});

const bundle = (rows: TestRow[], defects: Defect[] = []): ReportBundle => ({
  site, report, testRows: rows, checkRows: [], defects,
});

/** The value in the cell beside a label on the summary sheet. */
const beside = (sheet: { rows: unknown[][] }, label: string): unknown => {
  const row = sheet.rows.find((r) => {
    const first = r[0] as { v?: unknown } | undefined;
    return first && typeof first === 'object' && first.v === label;
  });
  return row?.[1];
};

describe('the summary sheet on a service record', () => {
  const rows = [
    testRow('pass', { sortIndex: 1 }), testRow('pass', { sortIndex: 2 }),
    testRow('fail', { sortIndex: 3 }),
    testRow('na', { sortIndex: 4 }),
    testRow('untested', { sortIndex: 5 }), testRow('untested', { sortIndex: 6 }),
  ];

  it('does not count a device nobody tested as tested', () => {
    /*
     * The line read "Devices tested" and carried every row on the report. Six
     * devices with two of them inaccessible is three tested — two passes and a
     * failure — and the sheet said six.
     */
    const s = reportCoverSheet(bundle(rows));
    expect(beside(s, 'Devices tested')).toBe(3);
    expect(beside(s, 'Devices on this report')).toBe(6);
  });

  it('gives every outcome its own line, so the two totals reconcile', () => {
    // Somebody adding up the parts has to arrive at the whole, or the sheet is
    // asking to be argued with.
    const s = reportCoverSheet(bundle(rows));
    const n = (label: string) => {
      const cell = beside(s, label) as number | { v: number };
      return typeof cell === 'number' ? cell : cell.v;
    };
    expect(n('Pass') + n('Fail') + n('Not applicable') + n('Not tested'))
      .toBe(beside(s, 'Devices on this report'));
    expect(n('Not tested')).toBe(2);
    expect(n('Not applicable')).toBe(1);
  });

  it('marks the not-tested count so it is not read past', () => {
    const s = reportCoverSheet(bundle(rows));
    expect(beside(s, 'Not tested')).toMatchObject({ v: 2, style: 'warn' });
    // And is plain where there are none to notice.
    const clean = reportCoverSheet(bundle([testRow('pass')]));
    expect(beside(clean, 'Not tested')).toMatchObject({ v: 0, style: 'default' });
  });

  it('counts the critical defects apart from the rest', () => {
    /*
     * The figure on this sheet that decides whether anybody reads the rest of
     * it. A critical defect obliges a written notice to the occupier within
     * twenty-four hours and rectification within a month; a non-critical one
     * obliges neither, and the summary is where the difference is first seen.
     */
    const defect = (severity: Defect['severity'], id: string): Defect => ({
      id, siteId: 's1', location: 'Level 2', description: 'x', severity,
      status: 'open', raisedAt: '2026-07-03T00:00:00.000Z', photos: [],
    });
    const s = reportCoverSheet(bundle(rows, [
      defect('critical', 'd1'), defect('non-critical', 'd2'), defect('critical', 'd3'),
    ]));
    expect(beside(s, 'Defects raised')).toBe(3);
    expect(beside(s, 'Critical defects')).toMatchObject({ v: 2 });
  });

  it('carries the site and the service as written', () => {
    const s = reportCoverSheet(bundle(rows));
    expect(beside(s, 'Site')).toBe('An Example Building');
    expect(beside(s, 'Client')).toBe('Example Body Corporate');
    // Australian order, from the Queensland day.
    expect(beside(s, 'Service date')).toBe('03/07/2026');
  });
});

describe('the result column on the test sheet', () => {
  it('says NOT TESTED rather than leaving the cell empty', () => {
    /*
     * The one thing it must not be. This sheet carries an autofilter: filter
     * the Result column to Pass and Fail, and blank cells disappear from the
     * count without anybody deciding they should. A coverage gap that vanishes
     * when somebody sorts the spreadsheet is worse than one printed in red.
     */
    const s = testResultSheet([testRow('untested')]);
    expect(s.rows[1]![7]).toMatchObject({ v: 'NOT TESTED', style: 'warn' });
  });

  it('still says what the other three are', () => {
    const s = testResultSheet([testRow('pass'), testRow('fail'), testRow('na')]);
    expect(s.rows[1]![7]).toMatchObject({ v: 'Pass', style: 'pass' });
    expect(s.rows[2]![7]).toMatchObject({ v: 'FAIL', style: 'fail' });
    expect(s.rows[3]![7]).toMatchObject({ v: 'N/A', style: 'warn' });
  });

  it('numbers the rows and keeps the header frozen for a long sheet', () => {
    const s = testResultSheet([testRow('pass'), testRow('pass')]);
    expect(s.rows[1]![0]).toBe(1);
    expect(s.rows[2]![0]).toBe(2);
    expect(s.freezeRows).toBe(1);
    expect(s.autoFilter).toBe(true);
  });

  it('leaves an unknown address blank rather than printing a partial one', () => {
    const s = testResultSheet([testRow('pass', { loopNumber: 1, address: 7 })]);
    expect(s.rows[1]![1]).toBe('L1.007');
    expect(testResultSheet([testRow('pass')]).rows[1]![1]).toBe('');
  });

  it('needs both halves of a loop address before it prints one', () => {
    /*
     * A loop with no address is half an address, and "L1.undefined" on a test
     * sheet is worse than a blank: it looks like a device somebody could go and
     * find. The point reference is used instead where there is one.
     */
    expect(testResultSheet([testRow('pass', { loopNumber: 1 })]).rows[1]![1]).toBe('');
    expect(testResultSheet([testRow('pass', { loopNumber: 1, pointRef: '0.4.O1' })]).rows[1]![1])
      .toBe('0.4.O1');
    // An address with no loop is still an address, and panel points have one.
    expect(testResultSheet([testRow('pass', { address: 7 })]).rows[1]![1]).toBe('7');
  });
});

describe('the panel check sheet', () => {
  const check = (result: TestResult): CheckRow => ({
    id: 'c1', reportId: 'r1', section: 'Batteries', label: 'Terminal voltage',
    result, value: '27.2', unit: 'V', sortIndex: 0,
  });

  it('reads a not-done check the same way a not-done device reads', () => {
    // The same rule, on the half of the report that is not a device. A blank
    // here is a check nobody can tell was skipped.
    expect(checkSheet([check('untested')]).rows[1]![2]).toMatchObject({ v: 'NOT TESTED' });
  });

  it('keeps the measured value and its unit apart', () => {
    // A value with its unit glued on cannot be charted or compared, and these
    // are the readings the trend screen exists for.
    const s = checkSheet([check('pass')]);
    expect(s.rows[1]![3]).toBe('27.2');
    expect(s.rows[1]![4]).toBe('V');
  });
});

describe('the defect sheet', () => {
  const defect = (over: Partial<Defect> = {}): Defect => ({
    id: 'd1', siteId: 's1', location: 'Level 2 lift lobby', description: 'Detector missing',
    severity: 'critical', status: 'open', raisedAt: '2026-07-02T22:30:00.000Z', photos: [],
    ...over,
  });

  it('shouts about a critical defect rather than listing it like any other', () => {
    const s = defectSheet([defect()]);
    expect(s.rows[1]![0]).toMatchObject({ v: 'CRITICAL', style: 'fail' });
    expect(defectSheet([defect({ severity: 'non-critical' })]).rows[1]![0])
      .toMatchObject({ v: 'Non-critical', style: 'warn' });
  });

  it('dates a defect by the Queensland day it was raised', () => {
    // 22:30 UTC is half past eight the next morning in Brisbane, and both
    // statutory clocks run from the day on this row.
    expect(defectSheet([defect()]).rows[1]![4]).toBe('03/07/2026');
  });

  it('leaves the rectified column empty for one still open', () => {
    // Not a date, and not a word that could be read as one.
    expect(defectSheet([defect()]).rows[1]![5]).toBe('');
  });
});

describe('the zone and point sheets', () => {
  const panel: Panel = {
    id: 'p1', siteId: 's1', name: 'FIP', brand: 'ampac', source: 'config-import',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const zone = (over: Partial<Zone> = {}): Zone => ({
    id: 'z1', panelId: 'p1', number: 1, text: 'GROUND FLOOR', unused: false, ...over,
  });
  const point = (over: Partial<Point> = {}): Point => ({
    id: 'pt1', panelId: 'p1', text: 'PLANT ROOM', deviceType: 'smoke-photo', unused: false, ...over,
  });

  it('says which zones and points are not in use rather than hiding them', () => {
    /*
     * An unused address is not the same as one that is not there. A zone chart
     * that quietly omits them cannot be checked against the panel, which is the
     * only reason to produce one.
     */
    expect(zoneSheet(panel, [zone({ unused: true })]).rows[1]!.slice(-1)[0])
      .toMatchObject({ v: 'Unused' });
    expect(zoneSheet(panel, [zone()]).rows[1]!.slice(-1)[0]).toBe('In use');
    expect(pointSheet(panel, [point({ unused: true })]).rows[1]!.slice(-1)[0])
      .toMatchObject({ v: 'Unused' });
  });
});

/**
 * The cause and effect matrix.
 *
 * It is the document somebody checks a commissioned panel against, so a cell
 * that says the wrong thing describes a building that does not exist. The two
 * marks are not interchangeable: X is an effect that operates, C is one that
 * operates only under a condition written somewhere else, and reading a C as an
 * X is reading a conditional evacuation as an unconditional one.
 */
describe('the cause and effect matrix', () => {
  const panel: Panel = {
    id: 'p1', siteId: 's1', name: 'FIP', brand: 'ampac', source: 'config-import',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const rule = (state: 'operates' | 'conditional' | 'not-linked', delaySeconds?: number): CauseEffectRule => ({
    id: 'r1', panelId: 'p1', causeLabel: 'Zone 12 Alarm', causeKind: 'zone-alarm', causeZoneNumber: 12,
    effects: [{ id: 'e1', effectLabel: 'Evacuation', effectKind: 'evacuation', state, delaySeconds }],
  });

  it('tells an unconditional effect from a conditional one', () => {
    const operates = causeEffectMatrixSheet(panel, [rule('operates')]);
    expect(operates.rows[1]!.slice(-1)[0]).toMatchObject({ v: 'X', style: 'pass' });
    const conditional = causeEffectMatrixSheet(panel, [rule('conditional')]);
    expect(conditional.rows[1]!.slice(-1)[0]).toMatchObject({ v: 'C', style: 'warn' });
  });

  it('puts the delay in the cell, because a delay is part of the effect', () => {
    const s = causeEffectMatrixSheet(panel, [rule('operates', 30)]);
    expect(s.rows[1]!.slice(-1)[0]).toMatchObject({ v: 'X 30s' });
  });

  it('leaves a cell empty where the cause does not drive the effect', () => {
    const s = causeEffectMatrixSheet(panel, [rule('not-linked')]);
    expect(s.rows[1]!.slice(-1)[0]).toBe('');
  });

  it('says what the marks mean on the sheet itself', () => {
    // The matrix is read away from this app, by somebody who has not been told.
    const s = causeEffectMatrixSheet(panel, [rule('operates')]);
    const legend = JSON.stringify(s.rows.slice(-1));
    expect(legend).toContain('X = operates');
    expect(legend).toContain('C = conditional');
  });
});
