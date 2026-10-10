/**
 * The shape of the department's tables, which a substring fixture cannot see.
 *
 * form72Parity.test.ts proves every string the department prints is on the
 * page. It is blind to where: a row one column short of its table still
 * carries all its words, and renders as a borderless notch at the right-hand
 * edge of the page. That is what Part A had — Site name, Site address and
 * Contractor each one column short — on every Form 72 this app has printed,
 * and no amount of text assertion would have found it.
 *
 * So this counts. Every row of every table, against the widest row in that
 * table, on a filled form and an empty one.
 */
import { form72Html } from '@/export/form72';
import { emptyForm72, type Form72, type TestDevice } from '@/domain/form72';

const NOW = '2026-07-03T00:00:00.000Z';

const filled = (): Form72 => ({
  ...emptyForm72({ id: 'f1', siteId: 's1', siteName: 'Site', contractor: 'Safe QLD', now: NOW }),
  siteAddress: '12 Example Street, Ipswich QLD 4305',
  testDate: '2026-07-03',
  testTime: '09:30',
  maintenanceTest: {
    hydrantAnnual: true, hydrantFiveYear: false, sprinklerAnnual: true,
    sprinklerFiveYear: false, combinedAnnual: false, combinedFiveYear: false,
  },
  hydrostatic: {
    result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120,
    endPressureKpa: 1700, lossLpm: 0, comments: 'Held.',
  },
  flowDeviceKinds: ['mechanical', 'electromagnetic'],
  flowDeviceCalibrated: { mechanical: '2026-01-05', electromagnetic: '2026-01-05' },
  devices: [1, 2, 3, 4].map((n): TestDevice => ({
    slot: `Device/gauge ${n}`, serialNumber: `SQF-00${n}`, dateCalibrated: '2026-01-05',
    calibrationCertificate: `CR-00${n}`, faceSize: '100mm', digitalReader: true,
    incrementsKpa: 50, correctionFactor: '+10 kPa', model: 'Flowtech Omega',
  })),
  flowTest: {
    result: 'pass',
    hydrantLocations: ['Front boundary', 'Carpark', 'Level 3', 'Rear lane'],
    requiredLps: 16, requiredKpa: 700, staticPressureKpa: 900, pressureZone: 'Zone 1',
    onSitePumpSet: true, achievedLps: 20, achievedKpa: 750, comment: 'Made its duty.',
    rows: [
      ...[19, 22, 25].map((nozzleMm) => ({
        nozzleMm, devices: 'SQF-001',
        hydrant1Kpa: 600, hydrants12Kpa: 550, hydrants123Kpa: 500, hydrants1234Kpa: 450,
      })),
      ...[5, 10, 15, 20, 30].map((rateLps) => ({
        rateLps, devices: 'SQF-002',
        hydrant1Kpa: 600, hydrants12Kpa: 550, hydrants123Kpa: 500, hydrants1234Kpa: 450,
      })),
    ],
  },
  booster: {
    result: 'pass', hydrantLocations: 'Level 3 landing valve', highestHydrantAboveBoosterM: 12,
    requiredLps: 16, requiredKpa: 700, staticPressureKpa: 900, pumpInletKpa: 200,
    pumpDischargeKpa: 1200, boostPressureKpa: 1100, hydrantResidualKpa: 900, comments: 'Ran clean.',
  },
  sprinklerHydrostatic: { result: 'pass', pressureKpa: 1700, timeHeldMinutes: 120, comments: 'Held.' },
  sprinklerFlow: {
    result: 'pass', systemSpec: '540 L/min at 200 kPa', runningTestGaugeKpa: 800,
    testPoints: [1, 2].map((n) => ({
      location: `Control valve ${n}`, requiredFlowLpm: 540, resultFlowLpm: 560,
      requiredPressureKpa: 200, resultPressureKpa: 220,
      flowResult: 'pass' as const, pressureResult: 'pass' as const,
    })),
  },
  criticalDefectsIdentified: true,
  repairsRequired: false,
  systemResult: 'pass',
  owner: 'Baldwin Living',
  technician: 'C. Whitmore',
  defects: [{ description: 'Booster valve seized', critical: true }],
  licenseeName: 'D. McKee',
  licenceNumber: '1310717',
  licenseeReportNumber: 'R-2026-118',
});

const blank = (): Form72 =>
  emptyForm72({ id: 'f2', siteId: 's1', siteName: '', contractor: '', now: NOW });

const render = (form: Form72): string =>
  form72Html({ form, systemLabel: 'Towns Main System', generatedAt: '2026-07-06T02:00:00.000Z' });

/**
 * Every table on the page, with each row's effective width.
 *
 * Effective, because a cell with a rowspan occupies columns in the rows below
 * it without appearing in their markup — Part A's "Test details" cell spans
 * two rows, so the second row legitimately carries one fewer cell. Counting
 * only the cells present would call that row short, and allowing any row to be
 * one short would swallow the very fault this test exists for: Part A's first
 * three rows were short by exactly one.
 *
 * So the carry is tracked. A row's width is the cells it holds plus the
 * columns spanning down into it, and then every row must reach the same total.
 */
function tableWidths(html: string): { index: number; widths: number[] }[] {
  const out: { index: number; widths: number[] }[] = [];
  // Innermost-first, so a nested table is measured as its own table and its
  // rows are not counted against the one holding it.
  const re = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/g;
  let rest = html;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const found: string[] = [];
    rest = rest.replace(re, (_whole, body: string) => { found.push(body); return '\u0000TABLE\u0000'; });
    if (!found.length) break;
    for (const body of found) {
      const rows = body.split('<tr').slice(1);
      /** How many columns are occupied by a cell spanning down, per row ahead. */
      const carry: number[] = [];
      const widths = rows.map((row, i) => {
        let here = 0;
        for (const cell of row.matchAll(/<t[dh]\b[^>]*>/g)) {
          const tag = cell[0];
          const cols = Number(/colspan="(\d+)"/.exec(tag)?.[1] ?? 1);
          const down = Number(/rowspan="(\d+)"/.exec(tag)?.[1] ?? 1);
          here += cols;
          for (let r = 1; r < down; r += 1) carry[i + r] = (carry[i + r] ?? 0) + cols;
        }
        return here + (carry[i] ?? 0);
      });
      if (widths.length) out.push({ index: out.length, widths });
    }
  }
  return out;
}

describe.each([['a filled form', filled()], ['an empty form', blank()]])(
  'every row reaches the edge of its table — %s',
  (_name, form) => {
    const html = render(form);
    const found = tableWidths(html);

    it('finds the document’s tables, so this is not passing on nothing', () => {
      expect(found.length).toBeGreaterThan(6);
    });

    it('has no row short of its table’s width', () => {
      /*
       * A row short of its table renders as a notch: the row's border stops
       * early and the page has a gap at its right edge. Invisible to any text
       * assertion and obvious on paper, which is the worst combination — Part
       * A printed three of them on every Form 72 this app ever produced.
       *
       * A rowspan is accounted for rather than allowed for. Allowing a row to
       * be one column short, which is what I first wrote, passes the fault.
       */
      for (const table of found) {
        const width = Math.max(...table.widths);
        for (const [row, w] of table.widths.entries()) {
          expect({ table: table.index, row, width: w, tableWidth: width })
            .toEqual({ table: table.index, row, width, tableWidth: width });
        }
      }
    });

    it('keeps Part A’s own rows at the table’s full width', () => {
      // The three that were short. Named, because they are the ones that
      // printed a notch on every form.
      const partA = html.slice(html.indexOf('Part A—Test details'), html.indexOf('Part B—Hydrant'));
      for (const label of ['Site name', 'Site address', 'Contractor']) {
        const row = partA.slice(partA.indexOf(`>${label}<`));
        expect({ label, span: /colspan="4"/.test(row.slice(0, 200)) })
          .toEqual({ label, span: true });
      }
    });
  },
);
