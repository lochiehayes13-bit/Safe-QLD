import { getDb, nowIso } from './index';
import { enqueueSync, type SyncEntry } from './opsRepo';
import { flushSoon } from '@/simpro/flushSoon';
import { scheduleWindow } from '@/domain/myDay';
import {
  SCHEDULE_KINDS, heldForUndo, isScheduleKind, readScheduleChange, scheduleContentKey,
  type PendingScheduleChange, type PendingState, type ScheduleChangePayload,
} from '@/domain/scheduling';

/**
 * The schedule changes this phone has queued and the office does not have
 * yet.
 *
 * Not a table of its own: the queue rows are the record. A change is a
 * queue row from the moment it is made until the office takes it, and a
 * second copy of that in another table would have to be kept in step with
 * every outcome the queue can reach — sent, refused, in doubt, forgotten —
 * or the calendar would draw a block the office refused as still on its
 * way. So the calendar reads the queue, filtered to the three schedule
 * kinds, and draws what it finds: pending as queued, in doubt as unsure,
 * refused with the office's words, and sent as sent until the office's own
 * read of the calendar shows the block where it went.
 *
 * Undo is the one thing that is not a queue outcome. A change still inside
 * its minute has not gone anywhere, so taking it back is deleting the row —
 * and only a pending row, because a row the send has claimed is the
 * queue's to decide.
 */

/** The state of the row a change was found to duplicate. */
export type DuplicateState = Exclude<PendingState, 'failed'>;

export type QueueScheduleOutcome =
  | { id: string; duplicate: false }
  /** The same change is on the queue already: `state` says how far it got. */
  | { id: string; duplicate: true; state: DuplicateState };

/**
 * Queues one change, once, and asks for the queue to go.
 *
 * The queue keeps a sent row's key taken, which is right for a note and
 * wrong for a booking: the office may have taken the block off since, and
 * the person putting it back is a new booking, not the old one twice. So a
 * key that clashes with a sent row is queued again under the key with that
 * row's id on the end; the send reads the office first anyway, and finds
 * the block there if it never left. A clash with a row still pending, being
 * sent or in doubt is a duplicate, and says which.
 */
export async function queueScheduleChange(change: ScheduleChangePayload): Promise<QueueScheduleOutcome> {
  const db = await getDb();
  let key = scheduleContentKey(change);
  // One suffix per sent row: the third booking of the same block clashes
  // with the second's key too, and goes on with both ids.
  for (;;) {
    const row = await enqueueSync(change.kind, change.payload, { contentKey: key });
    if (!row.duplicate) {
      flushSoon();
      return { id: row.id, duplicate: false };
    }
    const existing = await db.getFirstAsync<{ status: SyncEntry['status'] }>('SELECT status FROM sync_queue WHERE id = ?', row.id);
    const state: DuplicateState = existing?.status === 'sending' ? 'sending'
      : existing?.status === 'sent' ? 'sent'
        : existing?.status === 'unknown' ? 'unknown'
          : 'pending';
    if (state !== 'sent') return { id: row.id, duplicate: true, state };
    key = `${key}|${row.id}`;
  }
}

/**
 * Every schedule change on the queue the calendar should draw, in the
 * order they were made: pending, being sent, in doubt, refused, and sent
 * inside the calendar's own window — a sent booking stays a block until the
 * office's read shows it there, rather than vanishing for the half hour
 * until the next sync. A sent row older than the window's first day is the
 * office's long since, and left out.
 *
 * Rows whose payload will not read are skipped here: nothing to draw
 * without a day, and Waiting to send lists them with the reason.
 */
export async function listPendingScheduleChanges(now = nowIso()): Promise<PendingScheduleChange[]> {
  const db = await getDb();
  const since = scheduleWindow(now).from;
  const rows = await db.getAllAsync<SyncEntry>(
    `SELECT * FROM sync_queue
      WHERE kind IN (?, ?, ?)
        AND (status IN ('pending', 'sending', 'unknown', 'failed') OR (status = 'sent' AND createdAt >= ?))
      ORDER BY createdAt`,
    ...SCHEDULE_KINDS, since,
  );
  const out: PendingScheduleChange[] = [];
  for (const row of rows) {
    if (!isScheduleKind(row.kind)) continue;
    const read = readScheduleChange(row.kind, parsePayload(row.payload));
    if ('error' in read) continue;
    out.push({
      queueRowId: row.id, kind: read.kind, payload: read.payload, state: row.status,
      lastError: row.lastError ?? undefined, createdAt: row.createdAt,
    });
  }
  return out;
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Takes a change back. True when the row was still pending, inside its
 * minute, and is now gone; false otherwise — the minute is up, the send
 * has claimed the row, or it is on Waiting to send — in which case the
 * queue is where it is decided.
 *
 * The minute is checked here and not only on the screen because the screen's
 * clock is the last tick, and a tap at the end of the minute would otherwise
 * delete a row the sender is about to claim, or has claimed. The DELETE's
 * own guard is what the claim races; the check before it is what keeps the
 * two from ever wanting the same row.
 *
 * `now` is a parameter for the tests; the calendar passes nothing and the
 * clock is read here.
 */
export async function undoScheduleChange(queueRowId: string, now: string = nowIso()): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload: string; status: string }>('SELECT payload, status FROM sync_queue WHERE id = ?', queueRowId);
  if (!row || row.status !== 'pending') return false;
  const payload = parsePayload(row.payload) as { notBefore?: unknown } | null;
  if (typeof payload?.notBefore !== 'string' || !heldForUndo(payload.notBefore, now)) return false;
  const result = await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'pending'", queueRowId);
  return result.changes > 0;
}
