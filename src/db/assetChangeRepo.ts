import { getDb, inTransaction, newId, nowIso } from './index';
import { enqueueSync } from './opsRepo';
import {
  isBeforeWindow, type AssetChangeKind, type AssetChangePayload, type AssetChangeState, type BuiltChange,
} from '@/domain/assetChanges';

/**
 * The phone's record of each register change it has asked the office for.
 *
 * A change is two rows: the sync_queue row the queue sends, and this one,
 * which knows the asset it belongs to, the moment before which it must not
 * go, and what became of it. The queue row can be forgotten from Waiting to
 * send; this row is what the asset screen still reads afterwards, so "did
 * that go?" has an answer beside the asset for as long as the asset is on
 * the phone.
 *
 * The undo is a delete. The queue never sends a row before its `notBefore`,
 * so a row still pending inside its window has not gone anywhere, and
 * deleting it is the whole of taking the change back. A row that is no
 * longer pending is refused: a run has claimed it, or it has been sent, or
 * refused, or is in doubt, and none of those can be taken back from here.
 * So is a row whose window has closed even while it is still pending — the
 * queue may send it at any moment now, and an undo it would win against is
 * not one to offer.
 */

export interface AssetChangeRow {
  id: string;
  assetId: string;
  assetExternalId?: string;
  kind: AssetChangeKind;
  payload: AssetChangePayload;
  queueRowId?: string;
  notBefore: string;
  createdAt: string;
  sentAt?: string;
  error?: string;
}

/** A change as the asset screen shows it: the row, and where it has got to. */
export interface AssetChangeView extends AssetChangeRow {
  state: AssetChangeState;
  /** The queue's last error, where the queue still has the row. */
  lastError?: string;
}

interface Row {
  id: string;
  assetId: string;
  assetExternalId: string | null;
  kind: string;
  payloadJson: string;
  queueRowId: string | null;
  notBefore: string;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
}

interface JoinedRow extends Row {
  queueStatus: string | null;
  queueError: string | null;
}

function hydrate(r: Row): AssetChangeRow {
  let payload: AssetChangePayload;
  try {
    payload = JSON.parse(r.payloadJson) as AssetChangePayload;
  } catch {
    payload = { kind: r.kind, assetId: r.assetId, changeNo: 0, notBefore: r.notBefore, label: '' } as AssetChangePayload;
  }
  return {
    id: r.id,
    assetId: r.assetId,
    assetExternalId: r.assetExternalId ?? undefined,
    kind: r.kind as AssetChangeKind,
    payload,
    queueRowId: r.queueRowId ?? undefined,
    notBefore: r.notBefore,
    createdAt: r.createdAt,
    sentAt: r.sentAt ?? undefined,
    error: r.error ?? undefined,
  };
}

/**
 * Where a change has got to, from its own row and the queue's.
 *
 * The queue row outranks this one while it exists, because the queue is
 * what moves. A change with no queue row and no sentAt was forgotten from
 * Waiting to send, and reads as refused with the reason this row kept.
 */
export function stateOf(
  row: Pick<AssetChangeRow, 'sentAt' | 'error' | 'notBefore'>,
  queue: { status: string | null; error: string | null } | undefined,
  now: string,
): AssetChangeState {
  if (row.sentAt) return 'sent';
  switch (queue?.status) {
    case 'pending': return isBeforeWindow(now, row.notBefore) ? 'undoable' : 'queued';
    // Claimed by a run this moment: past taking back, not yet answered.
    case 'sending': return 'queued';
    case 'sent': return 'sent';
    case 'unknown': return 'unknown';
    case 'failed': return 'failed';
    default: return row.error ? 'failed' : 'taken-back';
  }
}

/** The number the next change to this asset takes, so its key is new. */
export async function nextChangeNo(assetId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM asset_change WHERE assetId = ?', assetId);
  return (row?.n ?? 0) + 1;
}

/**
 * Queues a built change and records it.
 *
 * The queue de-duplicates on the content key, so the same change queued
 * twice by a double tap comes back as the row already there rather than a
 * second one.
 *
 * The two rows are written in one transaction, so a queue row never exists
 * without its change row. The send relies on that: a queue row it finds
 * with no change row beside it has been taken back, and is dropped.
 */
export async function queueAssetChange(built: BuiltChange): Promise<{ change: AssetChangeRow; duplicate: boolean }> {
  const db = await getDb();
  let result: { change: AssetChangeRow; duplicate: boolean } | undefined;
  await inTransaction(db, async () => {
    const queued = await enqueueSync(built.kind, built.payload, { contentKey: built.contentKey });
    if (queued.duplicate) {
      const held = await changeForQueueRow(queued.id);
      if (held) { result = { change: held, duplicate: true }; return; }
    }
    const p = built.payload;
    const row: AssetChangeRow = {
      id: newId(),
      assetId: p.assetId,
      assetExternalId: 'assetExternalId' in p ? p.assetExternalId : undefined,
      kind: p.kind,
      payload: p,
      queueRowId: queued.id,
      notBefore: p.notBefore,
      createdAt: nowIso(),
    };
    await db.runAsync(
      `INSERT INTO asset_change (id,assetId,assetExternalId,kind,payloadJson,queueRowId,notBefore,createdAt)
       VALUES (?,?,?,?,?,?,?,?)`,
      row.id, row.assetId, row.assetExternalId ?? null, row.kind, JSON.stringify(row.payload),
      row.queueRowId ?? null, row.notBefore, row.createdAt,
    );
    result = { change: row, duplicate: false };
  });
  if (!result) throw new Error('The register change was not recorded.');
  return result;
}

export async function getAssetChange(id: string): Promise<AssetChangeRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM asset_change WHERE id = ?', id);
  return row ? hydrate(row) : null;
}

export async function changeForQueueRow(queueRowId: string): Promise<AssetChangeRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM asset_change WHERE queueRowId = ?', queueRowId);
  return row ? hydrate(row) : null;
}

/** Every change asked for on one asset, newest first, with where each has got to. */
export async function changesForAsset(assetId: string, now: string = nowIso()): Promise<AssetChangeView[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JoinedRow>(
    `SELECT c.*, q.status AS queueStatus, q.lastError AS queueError
     FROM asset_change c LEFT JOIN sync_queue q ON q.id = c.queueRowId
     WHERE c.assetId = ? ORDER BY c.createdAt DESC`,
    assetId,
  );
  return rows.map((r) => ({
    ...hydrate(r),
    state: stateOf({ sentAt: r.sentAt ?? undefined, error: r.error ?? undefined, notBefore: r.notBefore }, r.queueStatus === null ? undefined : { status: r.queueStatus, error: r.queueError }, now),
    lastError: r.queueError ?? undefined,
  }));
}

export type UndoOutcome =
  | { status: 'undone'; change: AssetChangeRow }
  /** Past its window, claimed, sent, refused, or in doubt: nothing here can take it back. */
  | { status: 'too-late' }
  | { status: 'missing' };

/**
 * Takes a change back.
 *
 * Refused outright once the window has closed, before anything is touched:
 * from that moment the queue is allowed to send the row, and an undo that
 * happened to beat it would leave the phone saying nothing went while the
 * run that had already read the row went on to send it. Inside the window
 * the queue row goes first, and only while it is still pending — the one
 * statement that decides the race between a person's tap and a run
 * claiming the row. Nothing deleted there means nothing to take back, and
 * this row is left to say what became of the change.
 *
 * `now` is a parameter for the tests; the screen passes nothing and the
 * clock is read here.
 */
export async function undoAssetChange(changeId: string, now: string = nowIso()): Promise<UndoOutcome> {
  const change = await getAssetChange(changeId);
  if (!change) return { status: 'missing' };
  if (change.sentAt || !change.queueRowId) return { status: 'too-late' };
  if (!isBeforeWindow(now, change.notBefore)) return { status: 'too-late' };
  const db = await getDb();
  const gone = await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'pending'", change.queueRowId);
  if (!gone.changes) return { status: 'too-late' };
  await db.runAsync('DELETE FROM asset_change WHERE id = ?', changeId);
  return { status: 'undone', change };
}

export async function markAssetChangeSent(id: string, patch: { assetExternalId?: string } = {}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE asset_change SET sentAt = ?, error = NULL, assetExternalId = COALESCE(?, assetExternalId) WHERE id = ?',
    nowIso(), patch.assetExternalId ?? null, id,
  );
}

export async function markAssetChangeFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE asset_change SET error = ? WHERE id = ?', error, id);
}
