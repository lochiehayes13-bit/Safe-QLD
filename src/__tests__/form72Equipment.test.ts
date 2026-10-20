/**
 * The gauge somebody retypes at a booster on every form.
 *
 * Part C is nine fields per instrument — serial, model, calibration date,
 * certificate, correction factor, dial size, digital reader, increments, and
 * which basis the date was accepted on. Three of them are chips: the company's
 * own flow meters, transcribed from their certificates, and its own pressure
 * gauge, whose serial is typed once and carried after that. Anything else, a
 * technician's own gauge or a borrowed one, was typed out in full at a booster
 * on every single form, where one mistyped serial number reads exactly like a
 * serial number and the form it is on gets signed.
 *
 * So the phone offers what it has already recorded. Read back off the forms
 * themselves rather than out of a new table, because what is wanted is
 * precisely what this technician typed last time — not a catalogue somebody
 * has to keep up to date.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createForm72, getForm72, linkForm72Job, recentTestDevices, recordForm72Attached, updateForm72 } from '@/db/form72Repo';
import {
  DEVICE_PRESETS, currentPresetDevice, devicePreset, offerableDevices, seedDevices, unusedDevicePresets,
} from '@/domain/form72Devices';
import {
  canIssue, citedDevicesText, defaultFlowRowDevices, deviceCitation, deviceInUse, emptyForm72, flowRowDevices,
  validateForm72, type Form72, type TestDevice,
} from '@/domain/form72';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';
import { codeOf } from './support/sourceCode';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

const GAUGE: TestDevice = {
  slot: 'Device/gauge 1',
  serialNumber: 'PG-442',
  dateCalibrated: '2026-01-14',
  calibrationCertificate: 'CAL-2026-0114',
  faceSize: '150',
  incrementsKpa: 20,
  kind: 'gauge',
};

/** A form on this phone, with equipment on it and a test date to order by. */
async function form(id: string, testDate: string, devices: TestDevice[]) {
  const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower' });
  await updateForm72(made.id, { testDate, devices });
  return made.id;
}

beforeEach(async () => {
  db = openMigrated();
  await db.runAsync(
    "INSERT INTO site (id,name,state,createdAt,updatedAt) VALUES ('s1','Fictional Tower','QLD','','')",
  );
});

afterEach(async () => { await db.closeAsync(); });

describe('what the phone remembers', () => {
  it('offers a gauge recorded on an earlier form, with everything that was on it', async () => {
    await form('a', '2026-03-14', [GAUGE]);
    const [first] = await recentTestDevices();
    expect(first?.device).toMatchObject({
      serialNumber: 'PG-442', dateCalibrated: '2026-01-14',
      calibrationCertificate: 'CAL-2026-0114', faceSize: '150', incrementsKpa: 20,
    });
  });

  it('drops the slot, because the slot belongs to the form it goes on', async () => {
    await form('a', '2026-03-14', [GAUGE]);
    const [first] = await recentTestDevices();
    expect(first?.device).not.toHaveProperty('slot');
  });

  it('says when it was last used, so a lapsed certificate is visible', async () => {
    await form('a', '2026-03-14', [GAUGE]);
    expect((await recentTestDevices())[0]?.lastUsed).toBe('2026-03-14');
  });

  it('keeps the most recent entry for a serial, not the first one found', async () => {
    // The instrument is the serial number. A gauge recertified since comes
    // back with the date it had on its last form, which is the honest answer.
    await form('old', '2025-06-02', [{ ...GAUGE, dateCalibrated: '2025-05-01' }]);
    await form('new', '2026-03-14', [GAUGE]);
    const all = await recentTestDevices();
    expect(all).toHaveLength(1);
    expect(all[0]?.device.dateCalibrated).toBe('2026-01-14');
    expect(all[0]?.lastUsed).toBe('2026-03-14');
  });

  it('matches a serial whatever case it was typed in', async () => {
    await form('a', '2026-03-14', [{ ...GAUGE, serialNumber: 'pg-442' }]);
    await form('b', '2026-04-14', [GAUGE]);
    expect(await recentTestDevices()).toHaveLength(1);
  });

  it('ignores an empty device row, which is what an unfilled slot is', async () => {
    await form('a', '2026-03-14', [{ slot: 'Device/gauge 1', serialNumber: '   ' }]);
    expect(await recentTestDevices()).toEqual([]);
  });

  it('is empty on a phone with no forms on it', async () => {
    expect(await recentTestDevices()).toEqual([]);
  });

  it('newest first, so the gauge in the van today is at the front', async () => {
    await form('a', '2026-01-02', [{ ...GAUGE, serialNumber: 'PG-100' }]);
    await form('b', '2026-05-02', [{ ...GAUGE, serialNumber: 'PG-200' }]);
    expect((await recentTestDevices()).map((r) => r.device.serialNumber)).toEqual(['PG-200', 'PG-100']);
  });

  it('survives a form whose equipment column cannot be read', async () => {
    // One unreadable form must not cost the whole list. That form still
    // reports its own fault when somebody opens it.
    await form('a', '2026-03-14', [GAUGE]);
    await db.runAsync("UPDATE form_72 SET devices = 'not json' WHERE id = (SELECT id FROM form_72 LIMIT 1)");
    expect((await recentTestDevices()).length).toBeGreaterThanOrEqual(0);
  });
});

describe('which of them are worth offering on this form', () => {
  const bare = (serialNumber: string): Omit<TestDevice, 'slot'> => {
    const { slot: _slot, ...rest } = GAUGE;
    return { ...rest, serialNumber };
  };
  const remembered = (...serials: string[]) => serials.map((s) => ({ device: bare(s) }));

  it('leaves out an instrument already on the form', () => {
    /*
     * The same rule the preset chips follow. Adding it twice puts one meter in
     * two Part C columns and makes the form read as a test run with twice the
     * equipment it had.
     */
    const offered = offerableDevices(remembered('PG-442', 'PG-100'), [GAUGE]);
    expect(offered.map((o) => o.device.serialNumber)).toEqual(['PG-100']);
  });

  it('matches what is on the form by serial whatever the case', () => {
    expect(offerableDevices(remembered('pg-442'), [GAUGE])).toEqual([]);
  });

  it('leaves out the company’s own meters, which have their own chips', () => {
    /*
     * Offering a preset meter twice — once from its certificate and once from
     * however it happened to be typed last March — is two sources for one fact,
     * and they can disagree on a form somebody signs.
     */
    const preset = DEVICE_PRESETS[0]!.device.serialNumber;
    expect(offerableDevices(remembered(preset), [])).toEqual([]);
  });

  it('leaves out a remembered row with no serial at all', () => {
    expect(offerableDevices([{ device: bare('') }], [])).toEqual([]);
  });

  it('offers everything else', () => {
    expect(offerableDevices(remembered('PG-100', 'PG-200'), []).length).toBe(2);
  });
});

describe('the equipment a new form starts with', () => {
  it('is the company\u2019s two meters and its gauge, in the department\u2019s first columns', async () => {
    const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower' });
    const back = await getForm72(made.id);
    expect(back!.devices.map((d) => [d.slot, d.serialNumber, d.presetId])).toEqual([
      ['Device/gauge 1', 'SQF-001', 'flowtech-sqf-001'],
      ['Device/gauge 2', 'SQF-002', 'flowtech-sqf-002'],
      ['Device/gauge 3', '', 'company-gauge'],
    ]);
    expect(back!.devices[0]).toMatchObject({
      kind: 'flow-meter', calibrationBasis: 'service-life', dateCalibrated: '2026-07-18',
      calibrationCertificate: 'CR-SQF-001-IN-01', issuedBy: 'Flowtech Water Meters',
    });
    // The gauge with the date it was calibrated when it was picked up, and
    // nothing the code does not know: no serial, no certificate.
    expect(back!.devices[2]).toEqual({
      slot: 'Device/gauge 3', serialNumber: '', kind: 'gauge', dateCalibrated: '2026-10-02',
      presetId: 'company-gauge',
    });
  });

  it('keeps equipment a caller passes, rather than adding the meters to it', async () => {
    const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower', parts: { devices: [GAUGE] } });
    expect((await getForm72(made.id))!.devices.map((d) => d.serialNumber)).toEqual(['PG-442']);
  });

  it('seeds nothing but the presets: a gauge typed by hand stays one tap away', () => {
    // PG-442 was typed into a column of its own, not the company gauge's, so
    // it carries no preset id and is not the company's gauge. It stays on the
    // "used before" list rather than being laid over the preset.
    const seeded = seedDevices([{ device: GAUGE }]);
    expect(seeded.map((d) => d.serialNumber)).toEqual(['SQF-001', 'SQF-002', '']);
    expect(seeded).toEqual(seedDevices());
  });

  it('carries a recertification this phone has seen onto the next form', async () => {
    // SQF-002 came back from a repair with a new certificate, and the
    // technician corrected that day's form. Every later form offered the
    // superseded certificate until this.
    const [, sqf002] = DEVICE_PRESETS;
    const recertified = {
      ...sqf002!.device, dateCalibrated: '2027-03-05', calibrationCertificate: 'CR-SQF-002-IN-02',
      correctionFactor: 'Meter error +0.10 %; correction −0.10 %',
    };
    await form('f1', '2027-03-05', [{ slot: 'Device/gauge 1', ...recertified }]);

    const remembered = await recentTestDevices();
    expect(currentPresetDevice(sqf002!, remembered)).toMatchObject({
      recertified: '2027-03-05',
      device: { dateCalibrated: '2027-03-05', calibrationCertificate: 'CR-SQF-002-IN-02', issuedBy: 'Flowtech Water Meters' },
    });
    // The other meter is untouched by it.
    expect(currentPresetDevice(DEVICE_PRESETS[0]!, remembered).recertified).toBeUndefined();

    const next = await createForm72({ siteId: 's1', siteName: 'Fictional Tower' });
    expect((await getForm72(next.id))!.devices[1]).toMatchObject({ serialNumber: 'SQF-002', calibrationCertificate: 'CR-SQF-002-IN-02' });
  });

  it('does not carry an older date back over the certificate in the code', async () => {
    const [sqf001] = DEVICE_PRESETS;
    await form('f1', '2026-01-01', [{ slot: 'Device/gauge 1', ...sqf001!.device, dateCalibrated: '2025-07-18' }]);
    expect(currentPresetDevice(sqf001!, await recentTestDevices()).device.dateCalibrated).toBe('2026-07-18');
  });
});

describe('the PDF on the job, as the form remembers it', () => {
  it('forgets the queued copy when the job changes, and keeps it when the job does not', async () => {
    const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower', jobExternalId: '9001' });
    await recordForm72Attached(made.id, '2026-10-02T04:14:00.000Z', 'row-1');
    expect(await getForm72(made.id)).toMatchObject({ attachedAt: '2026-10-02T04:14:00.000Z', attachmentQueueId: 'row-1' });

    await linkForm72Job(made.id, { externalId: '9001', title: 'Renamed' });
    expect((await getForm72(made.id))!.attachedAt).toBe('2026-10-02T04:14:00.000Z');

    await linkForm72Job(made.id, { externalId: '9002' });
    const moved = await getForm72(made.id);
    expect(moved!.attachedAt).toBeUndefined();
    expect(moved!.attachmentQueueId).toBeUndefined();

    await recordForm72Attached(made.id, '2026-10-03T04:14:00.000Z', 'row-2');
    await linkForm72Job(made.id, null);
    expect((await getForm72(made.id))!.attachedAt).toBeUndefined();
  });
});

/**
 * The company's pressure gauge, which is equipment like the meters now.
 *
 * Bought new and calibrated when it was picked up on 2 October 2026. Its
 * serial number and certificate reference are not in the code, so it goes on
 * a form with its date and a blank serial, and the serial typed on one form
 * is what every later form carries. Until then there is no serial to know it
 * by, so the column remembers which preset it came from.
 */
describe('the company’s pressure gauge', () => {
  const COMPANY_GAUGE = devicePreset('company-gauge')!;
  const [SQF_001] = DEVICE_PRESETS;

  /** The gauge's column as a technician left it on an earlier form. */
  const typed = (over: Partial<Omit<TestDevice, 'slot'>> = {}): { device: Omit<TestDevice, 'slot'> } => ({
    device: {
      serialNumber: 'PG-0210', kind: 'gauge', dateCalibrated: '2026-10-02',
      calibrationCertificate: 'CAL-0210', faceSize: '100 mm', incrementsKpa: 20,
      presetId: 'company-gauge', ...over,
    },
  });

  it('is a gauge, calibrated on 2 October 2026, with no serial or certificate in the code', () => {
    expect(COMPANY_GAUGE).toMatchObject({ id: 'company-gauge', gauge: true });
    expect(COMPANY_GAUGE.device).toEqual({ serialNumber: '', kind: 'gauge', dateCalibrated: '2026-10-02' });
    // Last of the presets, so the meters keep the department's first columns.
    expect(DEVICE_PRESETS[DEVICE_PRESETS.length - 1]).toBe(COMPANY_GAUGE);
  });

  it('goes onto a new form in the third column, after the meters, carrying its preset id', () => {
    const seeded = seedDevices();
    expect(seeded.map((d) => [d.slot, d.presetId])).toEqual([
      ['Device/gauge 1', 'flowtech-sqf-001'],
      ['Device/gauge 2', 'flowtech-sqf-002'],
      ['Device/gauge 3', 'company-gauge'],
    ]);
    expect(seeded[2]).toEqual({
      slot: 'Device/gauge 3', serialNumber: '', kind: 'gauge', dateCalibrated: '2026-10-02',
      presetId: 'company-gauge',
    });
  });

  describe('what the next form carries', () => {
    it('is the serial and certificate typed on the last form it was on', () => {
      const current = currentPresetDevice(COMPANY_GAUGE, [typed()]);
      expect(current.device).toEqual({
        serialNumber: 'PG-0210', kind: 'gauge', dateCalibrated: '2026-10-02',
        calibrationCertificate: 'CAL-0210', faceSize: '100 mm', incrementsKpa: 20,
        presetId: 'company-gauge',
      });
      // The same date as the code's is not a recertification.
      expect(current.recertified).toBeUndefined();
    });

    it('takes the most recent form’s, which is the first remembered', () => {
      // A serial mistyped on an older form and corrected on a newer one: the
      // correction is what carries.
      const remembered = [typed({ serialNumber: 'PG-0211', calibrationCertificate: 'CAL-0211' }), typed()];
      expect(currentPresetDevice(COMPANY_GAUGE, remembered).device).toMatchObject({
        serialNumber: 'PG-0211', calibrationCertificate: 'CAL-0211',
      });
    });

    it('says it was recertified when the last form has a later date', () => {
      const current = currentPresetDevice(COMPANY_GAUGE, [
        typed({ dateCalibrated: '2027-09-30', calibrationCertificate: 'CAL-2027' }),
      ]);
      expect(current).toEqual({
        recertified: '2027-09-30',
        device: expect.objectContaining({
          serialNumber: 'PG-0210', dateCalibrated: '2027-09-30', calibrationCertificate: 'CAL-2027',
          presetId: 'company-gauge',
        }),
      });
    });

    it('carries a date corrected to an earlier one, as the certificate says', () => {
      // The supplier may have calibrated it before it was picked up; what
      // the technician typed off the certificate stands. Not a recertification.
      const current = currentPresetDevice(COMPANY_GAUGE, [typed({ dateCalibrated: '2026-09-30' })]);
      expect(current.device).toMatchObject({ serialNumber: 'PG-0210', dateCalibrated: '2026-09-30' });
      expect(current.recertified).toBeUndefined();
    });

    it('ignores a gauge typed in a column of its own, and the meters’ rows', () => {
      // Neither carries the company gauge's preset id, so neither is it.
      const { slot: _slot, ...byHand } = GAUGE;
      const meterRow = { device: { ...SQF_001!.device, presetId: SQF_001!.id, dateCalibrated: '2027-01-01' } };
      expect(currentPresetDevice(COMPANY_GAUGE, [{ device: byHand }, meterRow])).toEqual({
        device: { ...COMPANY_GAUGE.device, presetId: 'company-gauge' },
      });
    });

    it('reaches the next form through the phone’s own forms', async () => {
      const gaugeColumn = (serialNumber: string, calibrationCertificate: string): TestDevice => ({
        slot: 'Device/gauge 3', kind: 'gauge', dateCalibrated: '2026-10-02',
        serialNumber, calibrationCertificate, presetId: 'company-gauge',
      });
      await form('older', '2026-10-05', [gaugeColumn('PG-021O', 'CAL-0210')]);
      await form('newer', '2026-10-09', [gaugeColumn('PG-0210', 'CAL-0210')]);

      const next = await createForm72({ siteId: 's1', siteName: 'Fictional Tower' });
      expect((await getForm72(next.id))!.devices[2]).toEqual(gaugeColumn('PG-0210', 'CAL-0210'));
    });
  });

  describe('the meters, which keep their own rule', () => {
    it('are still found by serial, on a form from before preset ids', () => {
      // An older form's column has no preset id. The serial is the meter.
      const current = currentPresetDevice(SQF_001!, [{
        device: { ...SQF_001!.device, dateCalibrated: '2027-01-01', calibrationCertificate: 'CR-SQF-001-IN-02' },
      }]);
      expect(current).toEqual({
        recertified: '2027-01-01',
        device: expect.objectContaining({
          serialNumber: 'SQF-001', dateCalibrated: '2027-01-01', calibrationCertificate: 'CR-SQF-001-IN-02',
          presetId: 'flowtech-sqf-001',
        }),
      });
    });

    it('take nothing from a remembered row with the same certificate date', () => {
      // A meter's transcribed certificate stands until a later one is seen;
      // only the gauge carries whatever the last form said.
      const current = currentPresetDevice(SQF_001!, [{
        device: { ...SQF_001!.device, presetId: SQF_001!.id, calibrationCertificate: 'CR-TYPO' },
      }]);
      expect(current).toEqual({ device: { ...SQF_001!.device, presetId: 'flowtech-sqf-001' } });
    });
  });

  describe('the chip that adds it', () => {
    const ids = (devices: TestDevice[]) => unusedDevicePresets(devices).map((p) => p.id);

    it('is offered on a form with no company gauge column', () => {
      // A gauge typed by hand, and a column added by hand and left blank, are
      // not the company's gauge.
      const meters = seedDevices().filter((d) => d.kind === 'flow-meter');
      expect(ids([...meters, GAUGE, { slot: 'Device/gauge 4', serialNumber: '' }])).toEqual(['company-gauge']);
    });

    it('is not offered once its column is there, even before the serial is typed', () => {
      expect(ids(seedDevices())).toEqual([]);
      expect(ids([{ slot: 'Device/gauge 1', serialNumber: '', presetId: 'company-gauge' }]))
        .not.toContain('company-gauge');
      expect(ids([{ slot: 'Device/gauge 1', serialNumber: 'PG-0210', presetId: 'company-gauge' }]))
        .not.toContain('company-gauge');
    });

    it('leaves the remembered gauge off the "used before" list, because it has this chip', () => {
      // Two places to add one instrument, which can disagree.
      expect(offerableDevices([typed()], [])).toEqual([]);
      // The same serial typed into a column of its own is still offered: that
      // row does not say it is the company's gauge.
      const { presetId: _presetId, ...unclaimed } = typed().device;
      expect(offerableDevices([{ device: unclaimed }], [])).toHaveLength(1);
    });
  });

  describe('a freshly seeded form with pressures on it', () => {
    /** Complete but for Part C, which is as it was seeded. */
    const seededForm = (devices: TestDevice[]): Form72 => ({
      ...emptyForm72({
        id: 'f1', siteId: 's1', siteName: 'Fictional Tower', contractor: 'Safe QLD Pty Ltd',
        now: '2026-10-05T00:00:00.000Z',
      }),
      siteAddress: '1 Example Street, Ipswich QLD 4305',
      testDate: '2026-10-05',
      testTime: '09:30',
      maintenanceTest: {
        hydrantAnnual: true, hydrantFiveYear: false,
        sprinklerAnnual: false, sprinklerFiveYear: false,
        combinedAnnual: false, combinedFiveYear: false,
      },
      flowDeviceKinds: ['mechanical'],
      devices,
      flowTest: {
        result: 'pass', hydrantLocations: ['Booster', 'Roof'],
        rows: [{ rateLps: 10, devices: 'SQF-001, Device/gauge 3', hydrant1Kpa: 620 }],
      },
      systemResult: 'pass',
      criticalDefectsIdentified: false,
      repairsRequired: false,
      licenseeName: 'D. McKee',
      licenceNumber: '1310717',
      signature: 'data:image/png;base64,AAA',
    });
    const blocking = (form: Form72) => validateForm72(form).filter((i) => i.blocking).map((i) => i.message);
    const withSerial = () => seedDevices()
      .map((d) => (d.presetId === 'company-gauge' ? { ...d, serialNumber: 'PG-0210' } : d));

    it('cannot be issued until the gauge’s serial is typed', () => {
      const messages = blocking(seededForm(seedDevices()));
      expect(messages).toContainEqual(expect.stringContaining(
        'Device/gauge 3 has details recorded but no serial number',
      ));
      // Said once, in the serial's own words: the gauge is on the form, so
      // "lists only flow meters" would send the technician looking for it.
      expect(messages).not.toContainEqual(expect.stringContaining('Part C lists only flow meters'));
      expect(messages).not.toContainEqual(expect.stringContaining('Part C lists no test equipment'));
    });

    it('still asks for the gauge when it was taken off', () => {
      const meters = seedDevices().filter((d) => d.kind === 'flow-meter');
      expect(blocking(seededForm(meters))).toContainEqual(expect.stringContaining('Part C lists only flow meters'));
    });

    it('issues once it is, the gauge being the pressure instrument', () => {
      const form = seededForm(withSerial());
      expect(blocking(form)).toEqual([]);
      expect(canIssue(form)).toBe(true);
      // And Part D citing it by its column is not a reference to nothing.
      expect(validateForm72(form).map((i) => i.message))
        .not.toContainEqual(expect.stringContaining('Part C does not list'));
    });
  });
});

/**
 * Part D's "Device/gauge used (Part C)", which offered only columns with a
 * serial. The gauge, seeded with its serial still to type, never appeared, so
 * the two flow meters were all a row could cite.
 */
describe('what a Part D row can cite', () => {
  it('resolves the gauge by its column name before its serial is typed', () => {
    const devices = seedDevices();
    const { known, unknown } = flowRowDevices({ rateLps: 20, devices: 'SQF-001, Device/gauge 3' }, devices);
    expect(known).toEqual([devices[0], devices[2]]);
    expect(unknown).toEqual([]);
  });

  it('still resolves the column name once the serial is typed', () => {
    const devices = seedDevices().map((d) => (d.presetId === 'company-gauge' ? { ...d, serialNumber: 'PG-0210' } : d));
    expect(flowRowDevices({ rateLps: 20, devices: 'device/gauge 3' }, devices).known).toEqual([devices[2]]);
  });

  it('resolves every name the picker writes for "All devices" back to its own column', () => {
    // The picker names a column by its serial, or by its slot where the
    // serial is still blank (the screen's pickable list).
    const devices = seedDevices();
    const names = devices.map((d) => d.serialNumber.trim() || d.slot.trim());
    expect(names).toEqual(['SQF-001', 'SQF-002', 'Device/gauge 3']);
    const { known, unknown } = flowRowDevices({ rateLps: 20, devices: [...names, 'Pitot 1'].join(', ') }, devices);
    expect(known).toEqual(devices);
    expect(unknown).toEqual(['Pitot 1']);
  });
});

describe('the Part D picker, as the screen draws it', () => {
  /*
   * No React renderer in this suite, so the claim is held against the
   * screen's code, comments stripped so a note cannot stand in for a chip.
   */
  const code = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8'));
  const start = code.indexOf('Device/gauge used (Part C)');
  const picker = code.slice(start, code.indexOf('placeholder="Or type it"', start));

  it('is found, so the claims below are about it', () => {
    expect(start).toBeGreaterThan(-1);
    expect(picker.length).toBeGreaterThan(0);
  });

  it('lists every Part C column in use, by serial or else by its column name', () => {
    expect(code).toMatch(
      /const pickable = form\.devices\s*\.filter\(deviceInUse\)\s*\.map\(\(device\) => \(\{ device, name: deviceCitation\(device\) \}\)\)/,
    );
    expect(picker).toContain('pickable.map(');
    // Not only the columns with a serial, which is what left the gauge out.
    expect(picker).not.toContain('form.devices.filter((d) => d.serialNumber.trim())');
  });

  it('offers "All devices" where there are two or more columns', () => {
    expect(picker).toContain('label="All devices"');
    expect(picker).toMatch(/pickable\.length > 1 \?/);
  });

  it('selects every column, or clears them, and keeps a typed name either way', () => {
    expect(picker).toMatch(
      /devices: \[\.\.\.\(all \? \[\] : pickable\.map\(\(p\) => p\.name\)\), \.\.\.cited\.unknown\]\.join\(', '\)/,
    );
    expect(picker).toMatch(/const all = pickable\.every\(\(p\) => cited\.known\.includes\(p\.device\)\)/);
  });
});

describe('a meter column given another serial', () => {
  const [SQF_001, SQF_002] = DEVICE_PRESETS;

  it('is not carried back as the company meter on the next form', () => {
    // SQF-002 away for service; a hire meter typed over its card. That card
    // kept the preset id, and the next form must still start with SQF-002.
    const hire = { device: { ...SQF_002!.device, presetId: SQF_002!.id, serialNumber: 'HM-77', dateCalibrated: '2026-09-01' } };
    expect(currentPresetDevice(SQF_002!, [hire]).device.serialNumber).toBe('SQF-002');
    expect(currentPresetDevice(SQF_002!, [hire]).recertified).toBeUndefined();
  });

  it('leaves the company meter on offer and the hire meter on the used-before list', () => {
    const onForm: TestDevice[] = [{ slot: 'Device/gauge 2', ...SQF_002!.device, presetId: SQF_002!.id, serialNumber: 'HM-77' }];
    expect(unusedDevicePresets(onForm).map((p) => p.id)).toContain(SQF_002!.id);
    const remembered = [{ device: { ...SQF_002!.device, presetId: SQF_002!.id, serialNumber: 'HM-77' } }];
    expect(offerableDevices(remembered, []).map((r) => r.device.serialNumber)).toEqual(['HM-77']);
    expect(SQF_001!.device.serialNumber).toBe('SQF-001');
  });

  it('drops the preset id on the screen when the serial is changed', () => {
    const code = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8'));
    const at = code.indexOf('const setDevice = (i: number, p: Partial<TestDevice>)');
    const body = code.slice(at, code.indexOf('});', at) + 3);
    expect(body).toContain('delete next.presetId');
    expect(body).toContain('from?.device.serialNumber');
  });
});

describe('Part D, citing a column before and after its serial is typed', () => {
  const columns = (serial: string): TestDevice[] => [
    ...seedDevices().slice(0, 2),
    { ...seedDevices()[2]!, serialNumber: serial },
  ];

  it('prints the serial once there is one, whichever way the row named it', () => {
    const row = { devices: 'SQF-001, Device/gauge 3' };
    expect(citedDevicesText(row, columns(''))).toBe('SQF-001, Device/gauge 3');
    expect(citedDevicesText(row, columns('PG-0210'))).toBe('SQF-001, PG-0210');
    expect(citedDevicesText({ devices: 'SQF-001, Device/gauge 3, pg-0210' }, columns('PG-0210'))).toBe('SQF-001, PG-0210');
    expect(citedDevicesText({ devices: 'SQF-001, Borrowed 9' }, columns('PG-0210'))).toBe('SQF-001, Borrowed 9');
  });

  it('reads two rows naming the gauge two ways as the same pattern', () => {
    const form = {
      devices: columns('PG-0210'),
      flowTest: {
        rows: [
          { rateLps: 10, devices: 'SQF-001, Device/gauge 3', hydrant1Kpa: 600 },
          { rateLps: 20, devices: 'SQF-001, PG-0210', hydrant1Kpa: 550 },
        ],
      },
    } as unknown as Parameters<typeof defaultFlowRowDevices>[0];
    expect(defaultFlowRowDevices(form)).toBe('SQF-001, PG-0210');
  });

  it('does not name the meter alone when the gauge is on the form waiting for its serial', () => {
    const form = {
      devices: [seedDevices()[0]!, seedDevices()[2]!],
      flowTest: { rows: [] },
    } as unknown as Parameters<typeof defaultFlowRowDevices>[0];
    expect(defaultFlowRowDevices(form)).toBeUndefined();
  });

  it('counts an empty column added by hand as nothing', () => {
    expect(deviceInUse({ slot: 'Device/gauge 4', serialNumber: '' })).toBe(false);
    expect(deviceInUse(seedDevices()[2]!)).toBe(true);
    expect(deviceCitation(seedDevices()[2]!)).toBe('Device/gauge 3');
  });

  it('takes a chip off by every name that means its column', () => {
    const code = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8'));
    expect(code).toContain('devices: on ? withoutDevice(r.devices, d) : toggleNamed(r.devices, name)');
    const at = code.indexOf('function withoutDevice(');
    expect(code.slice(at, at + 400)).toContain('[d.serialNumber.trim(), d.slot.trim()]');
  });
});

describe('a gauge from the used-before list, on a form waiting for ours', () => {
  it('fills the waiting column rather than adding one beside it', () => {
    const code = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8'));
    expect(code).toContain("devices.findIndex((d) => d.presetId === COMPANY_GAUGE_ID && !d.serialNumber.trim())");
    expect(code).toContain('{ ...d, ...r.device, slot: d.slot, presetId: COMPANY_GAUGE_ID }');
  });
});
