/**
 * What stops a Form 72 being issued, and what the page prints instead of red.
 *
 * The rule under all of it: nothing that prints red on the department's form
 * may be issued, and nothing that is not an omission may print red. The
 * audit found both halves broken — an unsigned form issued and locked; a
 * flow meter on the form with no kind ticked; pressures in Part D with no
 * instrument named; Part G passed with no test point — and on the other side
 * a clean hydrostatic test printing "Not recorded" against a loss that was
 * nil, every empty Comments box in red, and every modern sprinkler system red
 * against a running test it does not have.
 */
import {
  DEPARTMENT_DEVICE_SLOTS, PART_D_ROWS, canIssue, defaultFlowRowDevices, deviceSlotName, emptyForm72,
  toggleTestedHydrant, validateForm72, type Form72, type TestDevice,
} from '@/domain/form72';
import { form72Html, type Form72DocumentInput } from '@/export/form72';

const NOW = '2026-07-03T00:00:00.000Z';

const meter = (serialNumber = 'SQF-001', over: Partial<TestDevice> = {}): TestDevice => ({
  slot: 'Device/gauge 1', serialNumber, kind: 'flow-meter', dateCalibrated: '2026-07-18',
  calibrationCertificate: `CR-${serialNumber}-IN-01`, calibrationBasis: 'service-life', ...over,
});
const gauge = (serialNumber = 'PG-7', over: Partial<TestDevice> = {}): TestDevice => ({
  slot: 'Device/gauge 2', serialNumber, kind: 'gauge', dateCalibrated: '2026-03-14', calibrationCertificate: 'CAL-0314', ...over,
});

/** A hydrant form with nothing blocking it, so each test can spoil one thing. */
const issuable = (over: Partial<Form72> = {}): Form72 => ({
  ...emptyForm72({ id: 'f1', siteId: 's1', siteName: 'Fictional Tower', contractor: 'A Contractor', now: NOW }),
  siteAddress: '12 Example Street, Ipswich QLD 4305',
  testDate: '2026-10-02',
  testTime: '09:30',
  maintenanceTest: {
    hydrantAnnual: true, hydrantFiveYear: false, sprinklerAnnual: false, sprinklerFiveYear: false,
    combinedAnnual: false, combinedFiveYear: false,
  },
  devices: [gauge()],
  flowDeviceKinds: ['orifice'],
  flowTest: {
    result: 'pass', hydrantLocations: ['Front fence'],
    rows: PART_D_ROWS.map((r) => (r.nozzleMm === 19 ? { ...r, devices: 'PG-7', hydrant1Kpa: 620 } : r)),
    achievedLps: 10, achievedKpa: 620,
  },
  systemResult: 'pass',
  criticalDefectsIdentified: false,
  repairsRequired: false,
  licenseeName: 'A Licensee',
  licenceNumber: 'QBCC 1234567',
  signature: 'data:image/png;base64,iVBORw0KGgo=',
  ...over,
});

const blocking = (form: Form72) => validateForm72(form).filter((i) => i.blocking).map((i) => `${i.part}: ${i.message}`);
const cautions = (form: Form72) => validateForm72(form).filter((i) => !i.blocking).map((i) => `${i.part}: ${i.message}`);

const doc = (over: Partial<Form72DocumentInput> = {}): Form72DocumentInput => ({
  form: issuable(), systemLabel: 'Towns Main System', generatedAt: '2026-10-06T02:00:00.000Z', ...over,
});
const flat = (html: string) => html.replace(/\s+/g, ' ');
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(to, start);
  return html.slice(start, end < 0 ? html.length : end);
}

describe('the fixture', () => {
  it('is issuable and clean, so every refusal and caution below is the one thing the test spoiled', () => {
    expect(blocking(issuable())).toEqual([]);
    expect(cautions(issuable())).toEqual([]);
  });

  it('is told before issue about the department\u2019s boxes that would print red', () => {
    expect(cautions(issuable({ siteAddress: undefined, testTime: undefined, devices: [gauge('PG-7', { calibrationCertificate: undefined })] })))
      .toEqual([
        'A: No site address. It prints as not recorded.',
        'A: No test time. It prints as not recorded.',
        expect.stringContaining('Device/gauge 2 (PG-7) has a calibration date and no certificate reference'),
      ]);
  });
});

describe('the declaration', () => {
  it('cannot be issued unsigned', () => {
    const form = issuable({ signature: undefined });
    expect(canIssue(form)).toBe(false);
    expect(blocking(form)).toEqual([expect.stringMatching(/^I: Not signed/)]);
    expect(blocking(issuable({ signature: '   ' }))).toHaveLength(1);
  });
});

describe('Part C against the pressures the rest of the form records', () => {
  it('refuses a form with pressures in Parts B, D or E and no equipment at all', () => {
    const noKit = issuable({ devices: [], flowDeviceKinds: ['orifice'] });
    expect(blocking(noKit)).toEqual([expect.stringContaining('Part D records pressures and Part C lists no test equipment')]);

    const hydro = issuable({
      devices: [], flowTest: { result: 'na', hydrantLocations: [], rows: [] },
      hydrostatic: { result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700 },
    });
    expect(blocking(hydro)).toEqual([expect.stringContaining('Part B records pressures')]);

    const both = issuable({
      devices: [],
      hydrostatic: { result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700 },
    });
    expect(blocking(both)).toEqual([expect.stringContaining('Parts B, D record pressures')]);
  });

  it('does not ask for equipment where nothing was measured', () => {
    // A visit where every hydrant part is N/A: Part A cautions, Part C does not block.
    const form = issuable({
      devices: [], flowDeviceKinds: [],
      flowTest: { result: 'na', hydrantLocations: [], rows: [] },
      hydrostatic: { result: 'na' },
    });
    expect(blocking(form)).toEqual([]);
  });

  it('refuses a device card with no serial number, whether empty or half filled', () => {
    const stray = issuable({ devices: [gauge(), { slot: 'Device/gauge 2', serialNumber: '', kind: 'gauge' }] });
    expect(blocking(stray)).toEqual([expect.stringContaining('Device/gauge 2 is on the form with nothing on it')]);

    const started = issuable({ devices: [gauge(), { slot: 'Device/gauge 2', serialNumber: '', digitalReader: true }] });
    expect(blocking(started)).toEqual([expect.stringContaining('Device/gauge 2 has details recorded but no serial number')]);
  });

  it('refuses a flow meter whose kind is not ticked, and names the meter', () => {
    const form = issuable({ devices: [meter(), gauge()], flowDeviceKinds: [] });
    expect(blocking(form)).toEqual([expect.stringContaining('SQF-001 is a flow meter and none of Orifice / Mechanical / Electro magnetic is ticked')]);
    expect(blocking(issuable({ devices: [meter(), meter('SQF-002', { slot: 'Device/gauge 2' })], flowDeviceKinds: [] })))
      .toEqual([expect.stringContaining('SQF-001 and SQF-002 are flow meters')]);
    // Answered, and it is not asked again.
    expect(blocking(issuable({ devices: [meter(), gauge()], flowDeviceKinds: ['mechanical'] }))).toEqual([]);
  });

  it('refuses a flow test with no flow measuring device ticked, even with only a gauge on the form', () => {
    expect(blocking(issuable({ flowDeviceKinds: [] })))
      .toEqual([expect.stringContaining('Part D records a flow test and no flow measuring device is ticked')]);
  });

  it('cautions when the hydrant meters sit on a sprinkler-only test', () => {
    const form = issuable({
      maintenanceTest: {
        hydrantAnnual: false, hydrantFiveYear: false, sprinklerAnnual: true, sprinklerFiveYear: false,
        combinedAnnual: false, combinedFiveYear: false,
      },
      devices: [meter(), meter('SQF-002', { slot: 'Device/gauge 2' })],
      flowDeviceKinds: ['mechanical'],
      flowTest: { result: 'na', hydrantLocations: [], rows: [] },
      sprinklerHydrostatic: { result: 'pass', pressureKpa: 1400, timeHeldMinutes: 120 },
    });
    expect(cautions(form)).toEqual([expect.stringContaining('Part C lists the hydrant flow meters SQF-001 and SQF-002')]);
    expect(blocking(form)).toEqual([]);
  });
});

describe('Part D rows and the instrument that read them', () => {
  it('refuses a row with pressures and no device named', () => {
    const form = issuable({
      flowTest: {
        result: 'pass', hydrantLocations: ['Front fence'],
        rows: PART_D_ROWS.map((r) => (r.nozzleMm === 19 ? { ...r, devices: '', hydrant1Kpa: 620 } : r)),
      },
    });
    expect(blocking(form)).toEqual([expect.stringContaining('A row of the flow table (19 mm) has pressures recorded and no Part C device named')]);
  });

  it('knows the answer where the form has one instrument, or one already cited', () => {
    expect(defaultFlowRowDevices({ devices: [gauge()], flowTest: { rows: [] } })).toBe('PG-7');
    expect(defaultFlowRowDevices({ devices: [meter(), gauge()], flowTest: { rows: [] } })).toBeUndefined();
    expect(defaultFlowRowDevices({
      devices: [meter(), gauge()],
      flowTest: { rows: [{ nozzleMm: 19, devices: 'SQF-001', hydrant1Kpa: 600 }, { nozzleMm: 22, devices: 'SQF-001', hydrant1Kpa: 580 }] },
    })).toBe('SQF-001');
    // Two instruments cited is a question, not an answer.
    expect(defaultFlowRowDevices({
      devices: [meter(), gauge()],
      flowTest: { rows: [{ nozzleMm: 19, devices: 'SQF-001', hydrant1Kpa: 600 }, { nozzleMm: 22, devices: 'PG-7', hydrant1Kpa: 580 }] },
    })).toBeUndefined();
    // A row named but never run says nothing about what was used.
    expect(defaultFlowRowDevices({
      devices: [meter(), gauge()], flowTest: { rows: [{ nozzleMm: 19, devices: 'SQF-001' }] },
    })).toBeUndefined();
  });
});

describe('Part G', () => {
  const sprinkler = (over: Partial<Form72['sprinklerFlow']> = {}): Form72 => issuable({
    maintenanceTest: {
      hydrantAnnual: false, hydrantFiveYear: false, sprinklerAnnual: true, sprinklerFiveYear: false,
      combinedAnnual: false, combinedFiveYear: false,
    },
    devices: [], flowDeviceKinds: [],
    flowTest: { result: 'na', hydrantLocations: [], rows: [] },
    sprinklerFlow: {
      result: 'pass',
      testPoints: [{ location: 'Valve room', requiredFlowLpm: 540, resultFlowLpm: 560, requiredPressureKpa: 200, resultPressureKpa: 210 }],
      ...over,
    },
  });

  it('refuses a result with no test point behind it', () => {
    expect(blocking(sprinkler())).toEqual([]);
    expect(blocking(sprinkler({ testPoints: [] }))).toEqual([expect.stringContaining('Marked Pass with no test point recorded')]);
    expect(blocking(sprinkler({ testPoints: [{ location: '' }] }))).toHaveLength(1);
  });

  it('lets a system with no running test say so, and notices a reading against it', () => {
    expect(blocking(sprinkler({ noRunningTest: true }))).toEqual([]);
    expect(cautions(sprinkler({ noRunningTest: true, runningTestGaugeKpa: 300 })))
      .toEqual([expect.stringContaining('marked as not on this system and 300 kPa is recorded against it')]);
  });

  it('prints the answer in grey, the reading where there is one, and red only where neither', () => {
    const row = (form: Form72) => between(flat(form72Html(doc({ form }))), 'Installation gauge pressure:', '</tr>');
    expect(row(sprinkler({ noRunningTest: true }))).toContain('No running test on this system');
    expect(row(sprinkler({ runningTestGaugeKpa: 300 }))).toContain('300 <span class="u">kPa</span>');
    expect(row(sprinkler())).toContain('Not recorded');
  });

  it('prints an empty first test point on a live part in red, and an empty second one in grey', () => {
    const html = flat(form72Html(doc({ form: sprinkler({ testPoints: [] }) })));
    const first = between(html, 'Test point 1', 'Test point 2');
    expect(first).toContain('Not recorded');
    expect(first).not.toContain('Not used');
    const second = between(html, 'Test point 2', 'Running test');
    expect(second).toContain('Not used');
    expect(second).not.toContain('Not recorded');
  });
});

describe('what no longer prints red', () => {
  it('an empty Comments box, which is the ordinary state of a test that went to plan', () => {
    const html = flat(form72Html(doc({
      form: issuable({ hydrostatic: { result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700 } }),
    })));
    const comments = between(html, 'Comments:</td>', '</tr>');
    expect(comments).toContain('<span class="na">None</span>');
    expect(comments).not.toContain('missing');
  });

  it('a loss left blank where the pressure held, which the department labels "(if any)"', () => {
    const held = issuable({ hydrostatic: { result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700 } });
    expect(between(flat(form72Html(doc({ form: held }))), 'Loss (if any):', '</tr>')).toContain('<span class="na">Nil</span>');

    // The pressure fell: the blank is the omission the validation names.
    const fell = issuable({ hydrostatic: { result: 'fail', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1500 } });
    expect(between(flat(form72Html(doc({ form: fell }))), 'Loss (if any):', '</tr>')).toContain('Not recorded');

    // And a loss that was recorded prints as the figure.
    const some = issuable({ hydrostatic: { result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120, endPressureKpa: 1700, lossLpm: 0 } });
    expect(between(flat(form72Html(doc({ form: some }))), 'Loss (if any):', '</tr>')).toContain('0 <span class="u">L/min</span>');
  });

  it('a pressure zone nobody knows, printed where the department prints it', () => {
    const html = flat(form72Html(doc()));
    const head = between(html, '<table class="grid flow">', '</tr>');
    expect(head).toContain('Pressure zone number: <span class="dz"><span class="na">Not stated</span></span>');
    expect(head).toContain('Size/flow rate');
    // And not twice.
    expect(html.split('Pressure zone number').length).toBe(2);
  });

  it('a column somebody started keeps what they recorded, and is red only about the serial', () => {
    const html = flat(form72Html(doc({
      form: issuable({ devices: [gauge(), { slot: 'Device/gauge 2', serialNumber: '', digitalReader: true, faceSize: '100 mm' }] }),
    })));
    const partC = between(html, 'Device/gauge 2', 'Part D—');
    expect(between(partC, 'Serial number', '</tr>')).toContain('Not recorded');
    expect(between(partC, 'Digital reader', '</tr>')).toContain('Yes');
    expect(between(partC, '65/100/150 mm face', '</tr>')).toContain('100 mm');
  });
});

describe('the page order and the sheet', () => {
  it('prints the department’s closing notes and imprint before the attachment, not under its band', () => {
    const html = form72Html(doc({ form: issuable({ owner: 'An Owner', defects: [] }) }));
    const imprint = html.indexOf('<div class="imprint">');
    const attachment = html.indexOf('Attachment — not part of the department');
    const privacy = html.indexOf('Privacy:');
    expect(attachment).toBeGreaterThan(0);
    expect(imprint).toBeLessThan(attachment);
    expect(privacy).toBeLessThan(attachment);
    // Ours still follows the attachment.
    expect(html.indexOf('Not part of the department\'s form.</b>')).toBeGreaterThan(attachment);
  });

  it('keeps the flow table whole and with the grid above it, and lets the tick grid print bare', () => {
    const html = form72Html(doc());
    // The rule lives on a div, because Chromium's print engine does not
    // reliably honour break-inside on a table: Part D's grid split after its
    // first row with the rule on the table itself.
    expect(html).toMatch(/div\.whole \{ break-inside: avoid; page-break-inside: avoid; \}/);
    expect(html).toMatch(/\.keep \{ break-after: avoid; page-break-after: avoid; \}/);
    // Parts B, D, F, G, H and the signature grid are each wrapped whole.
    expect((html.match(/<div class="whole">/g) ?? []).length).toBe(6);
    // Part D's two tables share one wrapper, so the flow table cannot part from its grid.
    const partD = between(html, 'Part D—Hydrant system flow test', 'Part E—');
    expect(partD.indexOf('<div class="whole">')).toBeLessThan(partD.indexOf('Hydrant 1 location'));
    expect(partD.indexOf('</div>', partD.indexOf('<div class="whole">'))).toBeGreaterThan(partD.indexOf('System achieved'));
    expect(html).toMatch(/table\.grid table\.mt td \{[^}]*border: none/);
    expect(html).toMatch(/table\.devices \{ table-layout: fixed; \}/);
  });
});

describe('the column names', () => {
  it('hands out the first free department name, and never renumbers', () => {
    expect(deviceSlotName([])).toBe(DEPARTMENT_DEVICE_SLOTS[0]);
    expect(deviceSlotName([{ slot: 'Device/gauge 2', serialNumber: 'x' }])).toBe('Device/gauge 1');
    expect(deviceSlotName(DEPARTMENT_DEVICE_SLOTS.map((slot) => ({ slot, serialNumber: 'x' })))).toBe('Device/gauge 5');
  });
});

describe('picking the hydrants the flow test ran on', () => {
  it('numbers them in the order they are tapped', () => {
    let held: string[] = [];
    held = toggleTestedHydrant(held, 'Booster (H1)');
    held = toggleTestedHydrant(held, 'Level 3 east (H4)');
    expect(held).toEqual(['Booster (H1)', 'Level 3 east (H4)']);
  });

  it('leaves a hole when one is taken off, so the readings under it keep their number', () => {
    const held = toggleTestedHydrant(['A', 'B', 'C'], 'B');
    expect(held).toEqual(['A', '', 'C']);
    // The next pick fills the hole rather than becoming hydrant 4.
    expect(toggleTestedHydrant(held, 'D')).toEqual(['A', 'D', 'C']);
  });

  it('drops a trailing blank, so taking off the last leaves nothing behind', () => {
    expect(toggleTestedHydrant(['A', 'B'], 'B')).toEqual(['A']);
    expect(toggleTestedHydrant(['A'], 'A')).toEqual([]);
  });

  it('matches a typed name with stray spaces, and ignores an empty one', () => {
    expect(toggleTestedHydrant([' A '], 'A')).toEqual([]);
    expect(toggleTestedHydrant(['A'], '  ')).toEqual(['A']);
  });
});
