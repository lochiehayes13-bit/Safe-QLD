import {
  SIGNED_REFUSAL, createSwms, deleteSwms, getSwms, linkSwmsJob, listSwms, recordSwmsAttached,
  signSwms, swmsForDay, templatesFor, updateSwms,
} from '@/db/swmsRepo';
import { SWMS_TEMPLATES } from '@/seed/swms';
import { mergeSwms } from '@/domain/swms';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * Storing a statement, on the migrated database.
 *
 * The rules themselves are checked in swms.test; this checks that the row
 * survives SQLite unchanged, that the permits the chosen statements require
 * are on the record from the start rather than appearing at the sign-off, and
 * that a signed statement stops being editable while still being fileable.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const FIRST = SWMS_TEMPLATES[0]!;
const DATE = '2026-09-10';

/** A record with everything its statements need, so signing is the only step left. */
async function readyRecord(templateIds: string[] = [FIRST.id]) {
  const merged = mergeSwms(templateIds.map((id) => SWMS_TEMPLATES.find((t) => t.id === id)!).filter(Boolean));
  const made = await createSwms({ templateIds, date: DATE, siteName: 'Fictional Tower', title: 'Today' });
  await updateSwms(made.id, {
    answers: Object.fromEntries(merged.prompts.map((p) => [p, 'Answered'])),
    ticked: merged.steps.map((s) => s.key),
    ppeChecked: [...merged.ppe],
    permits: merged.permits.map((p) => ({ permit: p, held: true, reference: 'P-1' })),
    workers: [{ name: 'Sam', signature: 'data:image/svg+xml;base64,AAA', signedAt: '2026-09-10T21:00:00.000Z' }],
    supervisor: 'Alex',
  });
  return made.id;
}

describe('a statement on the database', () => {
  it('ships statements to build one from', () => {
    // A vacuous pass in every test below if the seed were empty.
    expect(SWMS_TEMPLATES.length).toBeGreaterThan(3);
    expect(FIRST.steps.length).toBeGreaterThan(2);
  });

  it('round-trips every list through SQLite', async () => {
    const made = await createSwms({
      templateIds: [FIRST.id],
      date: DATE,
      siteId: 'site-1',
      siteName: 'Fictional Tower',
      jobExternalId: '1001',
      jobTitle: 'Annual routine',
      supervisor: 'Alex',
      supervisorPhone: '07 0000 0000',
      workers: [{ name: 'Sam', licence: 'FPL-1' }],
      notes: 'Second crew arriving after lunch',
    });
    expect(await getSwms(made.id)).toEqual(made);

    await updateSwms(made.id, {
      answers: { 'Where is the nearest extinguisher?': 'By the lift lobby' },
      addedHazards: [{ hazard: 'Scaffold overhead', control: 'Worked outside the drop zone' }],
      ticked: ['x#0'],
    });
    const read = await getSwms(made.id);
    expect(read?.answers).toEqual({ 'Where is the nearest extinguisher?': 'By the lift lobby' });
    expect(read?.addedHazards).toEqual([{ hazard: 'Scaffold overhead', control: 'Worked outside the drop zone' }]);
    expect(read?.ticked).toEqual(['x#0']);
  });

  it('puts every permit the work needs on the record before anybody starts', async () => {
    const withPermits = SWMS_TEMPLATES.find((t) => t.permits.length > 0);
    if (!withPermits) return;
    const made = await createSwms({ templateIds: [withPermits.id], date: DATE, siteName: 'Fictional Tower' });
    expect(made.permits.map((p) => p.permit)).toEqual(withPermits.permits);
    expect(made.permits.every((p) => !p.held)).toBe(true);
  });

  it('resolves the statements a stored record was built from', async () => {
    const made = await createSwms({ templateIds: [FIRST.id, 'not-a-statement'], date: DATE, siteName: 'X' });
    // An id the library no longer holds is dropped rather than crashing the
    // screen — the rest of the statement is still the crew's document.
    expect(templatesFor(made).map((t) => t.id)).toEqual([FIRST.id]);
  });

  it('lists newest first, and finds the one already covering a day', async () => {
    const a = await createSwms({ templateIds: [FIRST.id], date: '2026-09-08', siteId: 's1', siteName: 'A' });
    const b = await createSwms({ templateIds: [FIRST.id], date: '2026-09-10', siteId: 's1', siteName: 'A' });
    await createSwms({ templateIds: [FIRST.id], date: '2026-09-09', siteId: 's2', siteName: 'B' });

    expect((await listSwms()).map((r) => r.date)).toEqual(['2026-09-10', '2026-09-09', '2026-09-08']);
    expect((await listSwms({ siteId: 's1' })).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await swmsForDay('2026-09-10', 's1'))?.id).toBe(b.id);
    expect(await swmsForDay('2026-09-10', 's2')).toBeNull();
  });
});

describe('signing', () => {
  it('refuses, in the sentence the screen would use, until it is complete', async () => {
    const made = await createSwms({ templateIds: [FIRST.id], date: DATE, siteName: 'Fictional Tower' });
    await expect(signSwms(made.id)).rejects.toThrow(/not read|Not answered|Nobody has signed|No /);
    expect((await getSwms(made.id))?.status).toBe('draft');
  });

  it('signs a complete one and stamps when', async () => {
    const id = await readyRecord();
    const signed = await signSwms(id, '2026-09-10T22:00:00.000Z');
    expect(signed.status).toBe('signed');
    expect(signed.signedAt).toBe('2026-09-10T22:00:00.000Z');
    expect((await getSwms(id))?.status).toBe('signed');
  });

  it('is idempotent, so a double tap does not restamp the time', async () => {
    const id = await readyRecord();
    const first = await signSwms(id, '2026-09-10T22:00:00.000Z');
    const again = await signSwms(id, '2026-09-10T23:00:00.000Z');
    expect(again.signedAt).toBe(first.signedAt);
  });

  it('stops being editable, and says why', async () => {
    const id = await readyRecord();
    await signSwms(id);
    await expect(updateSwms(id, { notes: 'changed my mind' })).rejects.toThrow(SIGNED_REFUSAL);
    await expect(deleteSwms(id)).rejects.toThrow(SIGNED_REFUSAL);
  });

  it('can still be filed after signing, because filing changes nothing on the page', async () => {
    const id = await readyRecord();
    await signSwms(id);
    await linkSwmsJob(id, { externalId: '2002', title: 'Callout' });
    await recordSwmsAttached(id, '2026-09-10T23:30:00.000Z');
    const read = await getSwms(id);
    expect(read).toMatchObject({ jobExternalId: '2002', jobTitle: 'Callout', attachedAt: '2026-09-10T23:30:00.000Z', status: 'signed' });

    await linkSwmsJob(id, null);
    expect((await getSwms(id))?.jobExternalId).toBeUndefined();
  });

  it('deletes a draft', async () => {
    const made = await createSwms({ templateIds: [FIRST.id], date: DATE, siteName: 'X' });
    await deleteSwms(made.id);
    expect(await getSwms(made.id)).toBeNull();
  });

  it('says the record is gone rather than throwing something a screen cannot print', async () => {
    await expect(signSwms('nope')).rejects.toThrow('That statement no longer exists.');
    await expect(updateSwms('nope', { notes: 'x' })).rejects.toThrow('That statement no longer exists.');
    await expect(linkSwmsJob('nope', null)).rejects.toThrow('That statement no longer exists.');
  });
});
