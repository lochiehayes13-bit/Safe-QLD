/**
 * Which of Part C's three boxes a particular meter belongs under.
 *
 * The question is about the instrument, not the test, so it is answered once
 * per serial number and carried onto every later form that meter appears on.
 * Two things are worth proving: that the carry-forward only ever repeats an
 * answer somebody actually gave, and that it survives the SQL — because an
 * answer that is not stored means the technician is asked the same question on
 * every form, which is how a box ends up ticked two different ways on two
 * documents about one meter.
 *
 * Nothing in the app infers this box. Our own Flowtech certificates do not
 * name the measuring element and the manufacturer's service document names
 * only "mechanical parts" and an "electronic metering module", so the papers
 * support more than one of the department's three answers and settle none —
 * and a tick the app inferred prints identically to one a technician made
 * knowingly, on a page a licensee signs.
 */
import {
  deviceKindKey, forgetDeviceKind, getDeviceKind, getDeviceKinds, setDeviceKind,
} from '@/db/deviceKindRepo';
import { DEVICE_PRESETS } from '@/domain/form72Devices';
import { unTickedAnsweredKinds, type FlowDeviceKind, type TestDevice } from '@/domain/form72';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { MIGRATION_V36 } from '@/db/schemaV36';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

const meter = (serialNumber: string): TestDevice => ({
  slot: 'Device/gauge 1', serialNumber, kind: 'flow-meter',
});
const gauge = (serialNumber: string): TestDevice => ({
  slot: 'Device/gauge 2', serialNumber, kind: 'gauge',
});

describe('carrying an answer onto the next form', () => {
  const answered = (pairs: [string, FlowDeviceKind][]) => new Map(pairs);

  it('ticks the box for a meter somebody has answered for', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001')], [], answered([['SQF-001', 'electromagnetic']]),
    )).toEqual(['electromagnetic']);
  });

  it('ticks nothing for a meter nobody has answered for', () => {
    expect(unTickedAnsweredKinds([meter('SQF-009')], [], answered([]))).toEqual([]);
  });

  it('matches a serial typed in lower case, which is the same meter', () => {
    expect(unTickedAnsweredKinds(
      [meter('sqf-001')], [], answered([['SQF-001', 'mechanical']]),
    )).toEqual(['mechanical']);
  });

  it('does not tick a box twice', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001')], ['electromagnetic'], answered([['SQF-001', 'electromagnetic']]),
    )).toEqual([]);
  });

  it('ticks one box for two meters answered the same way', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001'), { ...meter('SQF-002'), slot: 'Device/gauge 2' }], [],
      answered([['SQF-001', 'mechanical'], ['SQF-002', 'mechanical']]),
    )).toEqual(['mechanical']);
  });

  it('ticks both where two meters on one form are genuinely different', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001'), { ...meter('ORI-1'), slot: 'Device/gauge 2' }], [],
      answered([['SQF-001', 'mechanical'], ['ORI-1', 'orifice']]),
    ).sort()).toEqual(['mechanical', 'orifice']);
  });

  it('ignores a pressure gauge, which is not a flow measuring device', () => {
    // Part C's three ticks are about the flow measuring device. A gauge answers
    // the rows below them, and an answer stored against its serial — from a
    // meter that once carried the same number — must not reach these boxes.
    expect(unTickedAnsweredKinds(
      [gauge('PG-1')], [], answered([['PG-1', 'mechanical']]),
    )).toEqual([]);
  });

  it('never takes a tick away', () => {
    /*
     * A kind ticked with nothing on file to account for it is a technician's
     * own answer, for a device Part C's four columns had no room for — the
     * department's own note says to put extra devices in the Notes section.
     * Removing it would erase an answer somebody gave.
     */
    expect(unTickedAnsweredKinds([meter('SQF-001')], ['orifice'], answered([]))).toEqual([]);
  });
});

describe('the serial a stored answer is keyed by', () => {
  it('ignores case and surrounding space, because that is the same meter', () => {
    expect(deviceKindKey('  sqf-001 ')).toBe('SQF-001');
  });

  it('reduces a device with no serial number to nothing to key on', () => {
    expect(deviceKindKey('   ')).toBe('');
  });
});

describe('the answer in the database', () => {
  let db: NodeSqliteDb;

  beforeEach(() => { db = openMigrated(); });
  afterEach(async () => { await db.closeAsync(); });

  it('is in the migration list in its own place', () => {
    expect(MIGRATIONS).toContain(MIGRATION_V36);
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('comes back as it went in, with who answered and when', async () => {
    const stored = await setDeviceKind({
      serialNumber: 'SQF-001', kind: 'electromagnetic',
      answeredBy: 'D. McKee', basis: 'Confirmed by Flowtech, 6 October 2026',
    });
    expect(stored).toMatchObject({
      serialNumber: 'SQF-001', kind: 'electromagnetic', answeredBy: 'D. McKee',
    });

    const back = await getDeviceKind('SQF-001');
    expect(back).toMatchObject({
      serialNumber: 'SQF-001', kind: 'electromagnetic', answeredBy: 'D. McKee',
      basis: 'Confirmed by Flowtech, 6 October 2026',
    });
    expect(back!.answeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('answers nothing for a meter nobody has answered for', async () => {
    expect(await getDeviceKind('SQF-404')).toBeUndefined();
  });

  it('finds it whatever case the serial is typed in', async () => {
    await setDeviceKind({ serialNumber: 'sqf-002', kind: 'mechanical' });
    expect((await getDeviceKind('SQF-002'))?.kind).toBe('mechanical');
  });

  it('replaces a wrong answer rather than keeping both', async () => {
    // A meter does not change what it is, so a second different answer means
    // the first was wrong. Two contradictory rows about one instrument would
    // leave the next form to pick between them.
    await setDeviceKind({ serialNumber: 'SQF-001', kind: 'mechanical', answeredBy: 'A' });
    await setDeviceKind({ serialNumber: 'SQF-001', kind: 'electromagnetic', answeredBy: 'B' });

    const back = await getDeviceKind('SQF-001');
    expect(back).toMatchObject({ kind: 'electromagnetic', answeredBy: 'B' });
  });

  it('refuses to store an answer about a device with no serial number', async () => {
    // Part C's blank rows start that way, and a row keyed on '' would answer
    // for every one of them at once.
    expect(await setDeviceKind({ serialNumber: '  ', kind: 'mechanical' })).toBeUndefined();
    expect(await getDeviceKind('')).toBeUndefined();
  });

  it('reads the several meters one Part C holds in one query', async () => {
    await setDeviceKind({ serialNumber: 'SQF-001', kind: 'mechanical' });
    await setDeviceKind({ serialNumber: 'SQF-002', kind: 'mechanical' });

    const all = await getDeviceKinds(['SQF-001', 'sqf-002', 'PG-1', '']);
    expect([...all.keys()].sort()).toEqual(['SQF-001', 'SQF-002']);
  });

  it('asks nothing of the database for a form with no identified devices', async () => {
    expect((await getDeviceKinds(['', '  '])).size).toBe(0);
  });

  it('forgets an answer somebody gave wrongly', async () => {
    await setDeviceKind({ serialNumber: 'SQF-001', kind: 'orifice' });
    await forgetDeviceKind('sqf-001');
    expect(await getDeviceKind('SQF-001')).toBeUndefined();
  });

  it('treats a kind it does not recognise as no answer at all', async () => {
    /*
     * It can only arrive from a hand-edited database or a newer build. Guessing
     * which of the department's three boxes it meant would put a tick on a
     * signed form from a value this build cannot read.
     */
    await db.runAsync(
      'INSERT INTO device_kind (serialNumber, kind, answeredAt) VALUES (?, ?, ?)',
      ['SQF-003', 'ultrasonic', '2026-10-06T00:00:00.000Z'],
    );
    expect(await getDeviceKind('SQF-003')).toBeUndefined();
    expect((await getDeviceKinds(['SQF-003'])).size).toBe(0);
  });

  it('round-trips into a tick on the next form', async () => {
    // The whole point, end to end: one technician answers, and the box on the
    // next form is already ticked.
    await setDeviceKind({ serialNumber: 'SQF-001', kind: 'mechanical', answeredBy: 'D. McKee' });

    const answers = await getDeviceKinds(['SQF-001']);
    const kinds = new Map([...answers].map(([serial, a]) => [serial, a.kind]));
    expect(unTickedAnsweredKinds([meter('SQF-001')], [], kinds)).toEqual(['mechanical']);
  });
});

describe('what our own meters claim, and what they do not', () => {
  it('ticks neither box for either Flowtech meter', () => {
    /*
     * Not an oversight, and not a thing to "finish" later. Neither the
     * calibration certificate nor Flowtech's own service document names the
     * measuring element, and what they do say points both ways: the warranted
     * media — quarry slurry, aggregate to 15 mm — suit an electromagnetic
     * meter, while "mechanical parts" with a 20-year design life, a battery
     * replaced once in ten years and "near equivalence of a Class 2 Water
     * Meter" suit a mechanical one.
     */
    for (const preset of DEVICE_PRESETS) {
      expect(preset.flowDeviceKind).toBeUndefined();
    }
  });

  it('says why, in enough words for somebody to answer it', () => {
    // A kind left off with no reason given looks on the screen exactly like a
    // question the app forgot to ask, and the technician scrolls past it. The
    // type makes the note mandatory when the kind is absent; this is about the
    // note being worth reading.
    for (const preset of DEVICE_PRESETS) {
      expect(preset.flowDeviceKindNote!.length).toBeGreaterThan(120);
      expect(preset.flowDeviceKindNote).toContain('yours');
    }
  });
});
