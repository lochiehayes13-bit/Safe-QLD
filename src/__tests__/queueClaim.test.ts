import { claimSync, enqueueSync, pendingSync, recoverSending, releaseSync } from '@/db/opsRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * A row is sent only by the run that wins it.
 *
 * The queue used to be a snapshot walked from memory, with nothing on a
 * row saying a run had reached it. A change taken back with a thirty-second
 * undo — its row deleted while a run was still on the rows ahead — was sent
 * anyway when the run got to it, and the phone said nothing had gone. The
 * claim is what an undo now races, and an undo that deletes a pending row
 * wins against any run that has not claimed it.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

describe('claiming a queued row', () => {
  it('is won once, and a second claim finds it taken', async () => {
    const { id } = await enqueueSync('job-note', { jobId: '1001', subject: 's', note: 'n' });
    expect(await claimSync(id)).toBe(true);
    expect(await claimSync(id)).toBe(false);
    // Claimed is not pending: the next run's snapshot does not pick it up.
    expect(await pendingSync()).toEqual([]);
  });

  it('is lost to an undo that deleted the row first', async () => {
    const { id } = await enqueueSync('asset-update', { assetId: 'a1', notBefore: '2026-09-09T00:00:30.000Z' });
    // The undo: the same DELETE the register and calendar undos run.
    const gone = await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'pending'", id);
    expect(gone.changes).toBe(1);
    expect(await claimSync(id)).toBe(false);
  });

  it('cannot be undone once claimed', async () => {
    const { id } = await enqueueSync('asset-update', { assetId: 'a1', notBefore: '2026-09-09T00:00:30.000Z' });
    expect(await claimSync(id)).toBe(true);
    const gone = await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'pending'", id);
    expect(gone.changes).toBe(0);
  });

  it('goes back to pending when the sender says not yet', async () => {
    const { id } = await enqueueSync('asset-update', { assetId: 'a1', notBefore: '2099-01-01T00:00:00.000Z' });
    expect(await claimSync(id)).toBe(true);
    await releaseSync(id);
    expect((await pendingSync()).map((r) => r.id)).toEqual([id]);
    // And an undo in that window still wins.
    const gone = await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'pending'", id);
    expect(gone.changes).toBe(1);
  });

  it('is put back by the next run when the app died mid-send', async () => {
    const { id } = await enqueueSync('job-note', { jobId: '1001', subject: 's', note: 'n' });
    await claimSync(id);
    expect(await recoverSending()).toBe(1);
    expect((await pendingSync()).map((r) => r.id)).toEqual([id]);
    // A row that finished normally is not touched.
    expect(await recoverSending()).toBe(0);
  });

  it('still counts as queued for the duplicate check while it is being sent', async () => {
    const first = await enqueueSync('job-note', { jobId: '1001', subject: 's', note: 'n' });
    await claimSync(first.id);
    const again = await enqueueSync('job-note', { jobId: '1001', subject: 's', note: 'n' });
    expect(again).toEqual({ id: first.id, duplicate: true });
  });
});
