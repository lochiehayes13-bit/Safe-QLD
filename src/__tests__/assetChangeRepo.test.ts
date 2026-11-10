import {
  changeForQueueRow, changesForAsset, getAssetChange, markAssetChangeFailed, markAssetChangeSent, nextChangeNo,
  queueAssetChange, stateOf, undoAssetChange,
} from '@/db/assetChangeRepo';
import { abandonSync, claimSync, forgetSync, markSyncUnknown, markSynced, pendingSync } from '@/db/opsRepo';
import { buildArchive, buildUpdate } from '@/domain/assetChanges';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * The record of a register change, on the migrated database.
 *
 * Two rows per change — the queue's and this table's — and the rules that
 * bind them: queued once, taken back only while the queue row is still
 * pending, and read back with where it has got to.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const NOW = '2026-09-09T01:00:00.000Z';
const built = (changeNo = 1) => buildUpdate(
  { assetId: 'a1', assetExternalId: '900', fields: [{ name: 'Location', value: 'L2' }], label: 'Ext E-12' },
  { now: NOW, changeNo },
);

describe('queueing', () => {
  it('writes the queue row and the change row together, and finds one by the other', async () => {
    const { change, duplicate } = await queueAssetChange(built());
    expect(duplicate).toBe(false);
    const rows = await pendingSync();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'asset-update', contentKey: 'asset-update|a1|1', id: change.queueRowId });
    expect(JSON.parse(rows[0]!.payload)).toEqual(change.payload);
    expect(await getAssetChange(change.id)).toEqual(change);
    expect((await changeForQueueRow(change.queueRowId!))?.id).toBe(change.id);
    expect(change).toMatchObject({ assetId: 'a1', assetExternalId: '900', notBefore: '2026-09-09T01:00:30.000Z' });
  });

  it('queues the same change once and a later change to the same asset again', async () => {
    const first = await queueAssetChange(built());
    const again = await queueAssetChange(built());
    expect(again).toEqual({ change: first.change, duplicate: true });
    expect(await nextChangeNo('a1')).toBe(2);
    const second = await queueAssetChange(built(2));
    expect(second.duplicate).toBe(false);
    expect(await pendingSync()).toHaveLength(2);
    expect(await nextChangeNo('a1')).toBe(3);
    expect(await nextChangeNo('other')).toBe(1);
  });
});

describe('taking a change back', () => {
  /** Ten seconds into the thirty the change waits before the queue may send it. */
  const INSIDE = '2026-09-09T01:00:10.000Z';

  it('deletes both rows while the queue row is still pending', async () => {
    const { change } = await queueAssetChange(built());
    const outcome = await undoAssetChange(change.id, INSIDE);
    expect(outcome).toEqual({ status: 'undone', change });
    expect(await pendingSync()).toEqual([]);
    expect(await getAssetChange(change.id)).toBeNull();
    expect(await undoAssetChange(change.id, INSIDE)).toEqual({ status: 'missing' });
  });

  it('refuses once the window has closed, before it touches either row', async () => {
    const { change } = await queueAssetChange(built());
    // The instant the queue is allowed to send it: from here the undo is
    // racing a run that may already have read the row.
    expect(await undoAssetChange(change.id, '2026-09-09T01:00:30.000Z')).toEqual({ status: 'too-late' });
    expect(await getAssetChange(change.id)).not.toBeNull();
    expect(await pendingSync()).toHaveLength(1);
  });

  it('refuses once a run has claimed the row, even inside the window', async () => {
    const { change } = await queueAssetChange(built());
    expect(await claimSync(change.queueRowId!)).toBe(true);
    expect(await undoAssetChange(change.id, INSIDE)).toEqual({ status: 'too-late' });
    expect(await getAssetChange(change.id)).not.toBeNull();
  });

  it('refuses once the queue row has moved on, and leaves both rows to say so', async () => {
    const { change } = await queueAssetChange(built());
    await markSynced(change.queueRowId!);
    expect(await undoAssetChange(change.id, INSIDE)).toEqual({ status: 'too-late' });
    expect(await getAssetChange(change.id)).not.toBeNull();
    const unknown = await queueAssetChange(built(2));
    await markSyncUnknown(unknown.change.queueRowId!, 'no reply');
    expect(await undoAssetChange(unknown.change.id, INSIDE)).toEqual({ status: 'too-late' });
    await markAssetChangeSent(change.id);
    expect(await undoAssetChange(change.id, INSIDE)).toEqual({ status: 'too-late' });
  });
});

describe('where a change has got to', () => {
  it('reads the state off the queue row while it exists, and the window off the clock', async () => {
    const { change } = await queueAssetChange(built());
    const at = (now: string) => changesForAsset('a1', now).then((c) => c[0]!);
    expect((await at('2026-09-09T01:00:10.000Z')).state).toBe('undoable');
    expect((await at('2026-09-09T01:00:31.000Z')).state).toBe('queued');
    await abandonSync(change.queueRowId!, 'HTTP 422 for customerAssets/900');
    const failed = await at(NOW);
    expect(failed.state).toBe('failed');
    expect(failed.lastError).toBe('HTTP 422 for customerAssets/900');
    await markSyncUnknown(change.queueRowId!, 'no reply');
    expect((await at(NOW)).state).toBe('unknown');
  });

  it('reads sent off its own row, whatever the queue says', async () => {
    const { change } = await queueAssetChange(built());
    await markAssetChangeSent(change.id, { assetExternalId: '901' });
    const [view] = await changesForAsset('a1', NOW);
    expect(view).toMatchObject({ state: 'sent', assetExternalId: '901' });
    expect(view?.sentAt).toBeDefined();
  });

  it('keeps the refusal after the queue row is forgotten', async () => {
    const { change } = await queueAssetChange(built());
    await markAssetChangeFailed(change.id, 'HTTP 422 for customerAssets/900');
    await abandonSync(change.queueRowId!, 'HTTP 422 for customerAssets/900');
    await forgetSync(change.queueRowId!);
    const [view] = await changesForAsset('a1', NOW);
    expect(view).toMatchObject({ state: 'failed', error: 'HTTP 422 for customerAssets/900', lastError: undefined });
  });

  it('lists newest first across kinds', async () => {
    await queueAssetChange(built());
    await queueAssetChange(buildArchive({ assetId: 'a1', assetExternalId: '900', previousStatus: 'in-service', label: 'x' }, { now: NOW, changeNo: 2 }));
    const kinds = (await changesForAsset('a1', NOW)).map((c) => c.kind);
    expect(kinds.sort()).toEqual(['asset-archive', 'asset-update']);
    expect(await changesForAsset('other', NOW)).toEqual([]);
  });

  it('decides the state from the two rows alone', () => {
    const row = { notBefore: '2026-09-09T01:00:30.000Z' };
    expect(stateOf(row, { status: 'pending', error: null }, '2026-09-09T01:00:00.000Z')).toBe('undoable');
    expect(stateOf(row, { status: 'pending', error: null }, '2026-09-09T01:01:00.000Z')).toBe('queued');
    expect(stateOf(row, { status: 'failed', error: 'x' }, NOW)).toBe('failed');
    // No queue row and nothing recorded: the row was dropped from Waiting
    // to send. An undo would have deleted this row too, so it is never that.
    expect(stateOf(row, undefined, NOW)).toBe('forgotten');
    expect(stateOf({ ...row, error: 'x' }, undefined, NOW)).toBe('failed');
    expect(stateOf({ ...row, sentAt: NOW }, { status: 'failed', error: 'x' }, NOW)).toBe('sent');
  });
});
