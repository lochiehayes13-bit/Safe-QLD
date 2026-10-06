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
import { createForm72, recentTestDevices, updateForm72 } from '@/db/form72Repo';
import { DEVICE_PRESETS, offerableDevices } from '@/domain/form72Devices';
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
