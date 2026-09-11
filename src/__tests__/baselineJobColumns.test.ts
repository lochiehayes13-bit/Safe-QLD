import { createBaseline, getBaseline, saveBaseline } from '@/db/baselineRepo';
import { createSite } from '@/db/repo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The three columns that link a baseline record to its Simpro job.
 *
 * baselineRepo writes the whole record positionally off one COLUMNS list, and
 * the serialiser decided what to write by looking at the runtime type: a
 * string went in as itself, anything else went through JSON.stringify. That
 * was fine while every column was a TEXT NOT NULL the form always filled.
 *
 * The v28 job link is the first thing here that is legitimately absent, and
 * `JSON.stringify(undefined ?? null)` is not SQL NULL — it is the four-letter
 * string "null". Which is truthy. So a baseline nobody had linked to anything
 * came back claiming to be on a job called "null", the card offered to send
 * the workbook to it, and the attachment would have been queued against a job
 * id of "null".
 *
 * The bug is invisible from the type system, because the column's TypeScript
 * type is `string | undefined` either way.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

async function raw(id: string) {
  return db.getFirstAsync<{ jobExternalId: string | null; jobTitle: string | null; attachedAt: string | null }>(
    'SELECT jobExternalId, jobTitle, attachedAt FROM baseline WHERE id = ?',
    id,
  );
}

describe('a baseline that is not linked to a job', () => {
  it('stores real NULLs, not the string "null"', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);

    const row = await raw(b.id);
    expect(row?.jobExternalId).toBeNull();
    expect(row?.jobTitle).toBeNull();
    expect(row?.attachedAt).toBeNull();
  });

  it('still stores NULLs after the form has been saved', async () => {
    // saveBaseline writes the whole record on every keystroke, so this is the
    // path that actually runs — the create above happens once.
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({ ...b, premisesName: 'Fictional Tower' });

    const row = await raw(b.id);
    expect(row?.jobExternalId).toBeNull();
  });

  it('reads back as absent, so nothing offers to file it on a job', async () => {
    /*
     * The consequence, stated as the screen sees it. JobFileCard shows the
     * "linked to a job" half whenever jobExternalId is truthy, and "null" is.
     */
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({ ...b, premisesName: 'Fictional Tower' });

    const back = await getBaseline(b.id);
    expect(back?.jobExternalId).toBeFalsy();
    expect(back?.jobExternalId).not.toBe('null');
    expect(back?.jobTitle).not.toBe('null');
    expect(back?.attachedAt).not.toBe('null');
  });
});

describe('a baseline that is linked to a job', () => {
  it('round-trips the job, its title and when the workbook went', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({
      ...b,
      jobExternalId: '41207',
      jobTitle: 'Annual routine',
      attachedAt: '2026-09-10T00:00:00.000Z',
    });

    const back = await getBaseline(b.id);
    expect(back?.jobExternalId).toBe('41207');
    expect(back?.jobTitle).toBe('Annual routine');
    expect(back?.attachedAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('unlinks back to NULL rather than to an empty string', async () => {
    // The card's Unlink passes undefined. An empty string is truthy in SQL's
    // eyes for an index and reads as "linked to nothing", which is not a state.
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({ ...b, jobExternalId: '41207', jobTitle: 'Annual routine' });
    await saveBaseline({ ...b, jobExternalId: undefined, jobTitle: undefined });

    const row = await raw(b.id);
    expect(row?.jobExternalId).toBeNull();
    expect(row?.jobTitle).toBeNull();
  });

  it('keeps every other field intact while the job columns change', async () => {
    // The whole list is written positionally; a mistake in one entry shifts
    // every column after it.
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({
      ...b,
      premisesName: 'Fictional Tower',
      testerNames: 'Sam',
      testDate: '2026-09-10',
      jobExternalId: '41207',
    });

    const back = await getBaseline(b.id);
    expect(back?.premisesName).toBe('Fictional Tower');
    expect(back?.testerNames).toBe('Sam');
    expect(back?.testDate).toBe('2026-09-10');
    expect(back?.jobExternalId).toBe('41207');
    expect(Array.isArray(back?.zoneResults)).toBe(true);
  });
});

describe('a row written by the build that got this wrong', () => {
  it('reads back as absent rather than as a job called "null"', async () => {
    /*
     * Migrations here are append-only, so the rows already carrying the string
     * "null" cannot be rewritten. The read is where they get put right, and
     * this is the check that it stays that way.
     */
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await db.runAsync(
      "UPDATE baseline SET jobExternalId = 'null', jobTitle = 'null', attachedAt = 'null' WHERE id = ?",
      b.id,
    );

    const back = await getBaseline(b.id);
    expect(back?.jobExternalId).toBeUndefined();
    expect(back?.jobTitle).toBeUndefined();
    expect(back?.attachedAt).toBeUndefined();
  });

  it('does not swallow a job that is genuinely named null', async () => {
    // Simpro job numbers are numeric, so this cannot collide in practice —
    // but the check says out loud which string is being treated specially.
    const site = await createSite({ name: 'Fictional Tower' });
    const b = await createBaseline(site.id);
    await saveBaseline({ ...b, jobExternalId: '41207', jobTitle: 'Null Island annual' });

    const back = await getBaseline(b.id);
    expect(back?.jobTitle).toBe('Null Island annual');
  });
});
