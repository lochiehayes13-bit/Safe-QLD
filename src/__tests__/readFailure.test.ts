import { dueAtSite, lapsedEverywhere } from '@/db/routineRunRepo';
import { listDefects } from '@/db/repo';
import { describeLoadFailure } from '@/domain/loadFailure';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * A read that fails, run against the real schema on Node's SQLite.
 *
 * The screens now catch what their reads throw and put it on the page. That is
 * only worth anything if a repository read really does throw where the screen
 * assumes it does — a catch around something that always resolves is dead code
 * that looks like a fix, and this repository has been bitten by exactly that
 * shape before.
 *
 * So the failure is produced the way the phone produces it, by taking the
 * storage out from under the query rather than by mocking a rejection: the
 * table a screen reads is dropped, which is what a half-run migration and a
 * database written by a newer build both look like from here. Then the message
 * that comes back is run through the words the screen shows, to check the
 * technician gets the device's own sentence and not "undefined".
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

describe('a repository read with its table gone', () => {
  it('rejects rather than answering with an empty list', async () => {
    /*
     * This is the whole point. An empty list from `lapsedEverywhere` is the
     * office being told every site is inside its window; if a broken read
     * produced one, the screen would say so in good faith. It has to throw.
     */
    await db.execAsync('DROP TABLE routine_run');
    await expect(lapsedEverywhere('2026-09-03T00:00:00.000Z')).rejects.toThrow();
    await expect(dueAtSite('site-1', '2026-09-03T00:00:00.000Z')).rejects.toThrow();
  });

  it('throws a message a technician can be shown', async () => {
    await db.execAsync('DROP TABLE defect');
    const said = await listDefects().then(() => 'resolved', (e: unknown) => describeLoadFailure(e, "this site's defects"));
    expect(said).toContain("This site's defects could not be read");
    // The driver's own words, kept: "no such table: defect" is what tells
    // anybody looking at it that this is not a data problem.
    expect(said).toMatch(/no such table/i);
    expect(said).toMatch(/not in the shape this build expects/);
  });

  it('answers normally while the table is there, so the check above means something', async () => {
    await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES ('site-1','Harbourline','','')");
    await expect(listDefects()).resolves.toEqual([]);
    await expect(lapsedEverywhere('2026-09-03T00:00:00.000Z')).resolves.toEqual([]);
    // Every routine the build defines, none of them ever run here.
    expect((await dueAtSite('site-1', '2026-09-03T00:00:00.000Z')).length).toBeGreaterThan(0);
  });
});
