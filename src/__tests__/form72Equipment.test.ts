/**
 * The gauge somebody retypes at a booster on every form.
 *
 * Part C is nine fields per instrument — serial, model, calibration date,
 * certificate, correction factor, dial size, digital reader, increments, and
 * which basis the date was accepted on. Two of them are chips, because they
 * are the company's own flow meters transcribed from their certificates. The
 * pressure gauge never is: a technician's own, or a borrowed one, typed out in
 * full at a booster on every single form, where one mistyped serial number
 * reads exactly like a serial number and the form it is on gets signed.
 *
 * So the phone offers what it has already recorded. Read back off the forms
 * themselves rather than out of a new table, because what is wanted is
 * precisely what this technician typed last time — not a catalogue somebody
 * has to keep up to date.
 */
import { createForm72, getForm72, linkForm72Job, recentTestDevices, recordForm72Attached, updateForm72 } from '@/db/form72Repo';
import { DEVICE_PRESETS, currentPresetDevice, offerableDevices, seedDevices } from '@/domain/form72Devices';
import type { TestDevice } from '@/domain/form72';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

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
  it('is the company\u2019s two meters, in the department\u2019s first columns, with their certificates', async () => {
    const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower' });
    const back = await getForm72(made.id);
    expect(back!.devices.map((d) => [d.slot, d.serialNumber])).toEqual([
      ['Device/gauge 1', 'SQF-001'], ['Device/gauge 2', 'SQF-002'],
    ]);
    expect(back!.devices[0]).toMatchObject({
      kind: 'flow-meter', calibrationBasis: 'service-life', dateCalibrated: '2026-07-18',
      calibrationCertificate: 'CR-SQF-001-IN-01', issuedBy: 'Flowtech Water Meters',
    });
  });

  it('keeps equipment a caller passes, rather than adding the meters to it', async () => {
    const made = await createForm72({ siteId: 's1', siteName: 'Fictional Tower', parts: { devices: [GAUGE] } });
    expect((await getForm72(made.id))!.devices.map((d) => d.serialNumber)).toEqual(['PG-442']);
  });

  it('seeds nothing but the presets: the gauge stays one tap away', () => {
    expect(seedDevices([{ device: GAUGE }]).map((d) => d.serialNumber)).toEqual(['SQF-001', 'SQF-002']);
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
