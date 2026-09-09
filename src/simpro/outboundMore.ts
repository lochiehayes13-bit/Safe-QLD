import type { SimproClient } from './client';
import type { SimproResources } from './resources';
import { flushSoon } from './flushSoon';
import { enqueueSync } from '@/db/opsRepo';
import { getEntry, markEntrySendFailed, markEntrySent } from '@/db/clockRepo';
import {
  CLOCK_QUEUE_KIND, clockContentKey, clockPayload, findAcceptedSchedule, sendReadiness, toScheduleRequest,
  type ClockBlockPayload, type ClockEntry, type ScheduleRecord, type ScheduleRequest,
} from '@/domain/clockOn';

/**
 * Sending the newer kinds of field work to the office.
 *
 * ./sync's flushQueue sends the four original kinds — a job note, a purchase
 * order, an asset test, a photograph — and hands anything else here. Each
 * kind added since lands in this module: what the payload is, and the one
 * request that puts it in Simpro. The queue, the retries, the "did it arrive"
 * rules and the marker that stops a resend posting twice all stay in
 * flushQueue and ./sendOutcome; this module only knows how to send.
 *
 * A kind this module does not know is reported as such, and the queue closes
 * the row rather than retrying it forever, as it always has. Nothing here
 * throws for a row that was never sendable: that is reported as `abandon`,
 * because a throw would reach ./sendOutcome as "may have been posted" for a
 * block that never left the phone.
 *
 * The first kind here is the clock entry (@/domain/clockOn): a block of hours
 * on a job's cost centre, or on an activity. A schedule carries no text, so
 * the marker the notes use has nowhere to go, and three things stand in for
 * it. The queue row is keyed on the entry id, so a second queue of the same
 * entry is a duplicate before it is written. The send reads the entry back,
 * and an entry the office has accepted is not posted. And before the POST,
 * the send reads the schedules the office already holds for that day and
 * looks for this block — same staff, same date, same start and end — and
 * takes one it finds as the earlier acceptance. That last read is what makes
 * "send again" from Waiting to send safe after a reply that could not be
 * read: the block went, the office has it, and the retry finds it rather
 * than posting it twice. What is not guaranteed: when that read itself
 * fails, the POST goes ahead, and a block that did land in the seconds
 * before is then posted twice. A duplicate block is a thing the office can
 * see and delete; a block that never went is hours nobody is paid for.
 */

export interface QueuedItem {
  id: string;
  kind: string;
  payload: unknown;
  /** The content key the queue de-duplicates on, where the kind has one. */
  contentKey?: string;
}

export interface SendDeps {
  client: SimproClient;
  api: SimproResources;
}

export type SendMoreOutcome =
  /** The request went out and the server said yes. */
  | { status: 'sent' }
  /** Nothing to send: the entry is gone from the phone, or the office already holds it. The row is done. */
  | { status: 'done' }
  /** Nothing was sent and never will be from this row; the reason is for a person. */
  | { status: 'abandon'; reason: string }
  /** Nothing here sends this kind. */
  | { status: 'not-mine' };

/** The Simpro job an item is bound for, where it has one, for the failure rules. */
export function moreJobIdOf(kind: string, payload: unknown): string | undefined {
  void kind;
  const id = (payload as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Queues a clock entry for the office, and asks for the queue to be sent.
 *
 * Not sent directly: the phone may be in a basement, and the queue is what
 * carries work through that. An entry that cannot go yet — no cost centre
 * on the job, still running, a break — is not queued at all; the reason is
 * written on the entry for the screen to show, and it is queued once the
 * entry has been fixed. Returns what happened, in a word.
 */
export async function queueClockEntry(
  entry: ClockEntry,
): Promise<{ status: 'queued' } | { status: 'duplicate' } | { status: 'not-ready'; why: string }> {
  const readiness = sendReadiness(entry);
  if (!readiness.ready) {
    await markEntrySendFailed(entry.id, readiness.why);
    return { status: 'not-ready', why: readiness.why };
  }
  const row = await enqueueSync(CLOCK_QUEUE_KIND, clockPayload(entry), { contentKey: clockContentKey(entry.id) });
  if (row.duplicate) return { status: 'duplicate' };
  flushSoon();
  return { status: 'queued' };
}

/** The reply to a schedule POST, as far as the send reads it: the id, if one came back. */
interface ScheduleReply { ID?: unknown }

/**
 * The schedule the office already holds for this block, if it holds one.
 *
 * The same collection the POST goes to, read with GET: the cost centre's
 * own `schedules/` for a job block, `activitySchedules/` for an activity.
 * Both honour `Date=` on the live build and both list `Staff` and, asked
 * for by column, `Blocks`, so one day's read is a handful of rows. The
 * columns differ by path because a column the list does not have is a 422
 * for the whole read: `Activity` is on the activity list only. One page of
 * 250 rather than every page: a day of one person on one cost centre is a
 * few rows, and a day of every activity in the company is well under that;
 * a page that was full would be a company this is not written for.
 * Undefined for "not there"; throws where the read failed, and the caller
 * decides what that means.
 */
async function acceptedScheduleId(request: ScheduleRequest, client: SimproClient): Promise<string | undefined> {
  const columns = 'Activity' in request.body ? 'ID,Staff,Date,Blocks,Activity' : 'ID,Staff,Date,Blocks';
  const { data } = await client.request<ScheduleRecord[] | undefined>('GET', request.path, {
    query: { Date: request.body.Date, columns, pageSize: 250 },
  });
  return findAcceptedSchedule(Array.isArray(data) ? data : [], request);
}

/**
 * Posts one clock entry.
 *
 * The entry is read afresh rather than trusted from the payload, so an edit
 * made between queueing and sending is what goes, and so an entry the
 * office already accepted is not sent again. An entry that has been deleted
 * from the phone has nothing to send, and neither has one the office turns
 * out to hold already: both are `done`. An entry that cannot go as it is —
 * a shape the screen never queues, since it checks first — is `abandon`,
 * with the reason on the entry and on the row, and nothing sent.
 *
 * The request itself is the one function in @/domain/clockOn, built as the
 * documentation shows; the POST has not been tried on the live build, so a
 * refusal is thrown as the client's own error and reaches the person in the
 * server's words, on the entry and on Waiting to send.
 */
async function sendClockEntry(payload: ClockBlockPayload, client: SimproClient): Promise<SendMoreOutcome> {
  const entry = await getEntry(payload.entryId);
  if (!entry) return { status: 'done' };
  if (entry.sentAt) return { status: 'done' };
  const readiness = sendReadiness(entry);
  if (!readiness.ready) {
    await markEntrySendFailed(entry.id, readiness.why);
    return { status: 'abandon', reason: `Nothing was sent: ${readiness.why}.` };
  }
  const request = toScheduleRequest(entry);
  try {
    // Is it there already? A retry after a reply that could not be read,
    // or a person's "send again", finds the block the office took the
    // first time and stops here. Where the read itself fails the POST goes
    // ahead regardless: a duplicate block is recoverable, and a block held
    // back on the phone until a read succeeds is not.
    let held: string | undefined;
    try {
      held = await acceptedScheduleId(request, client);
    } catch {
      held = undefined;
    }
    if (held !== undefined) {
      await markEntrySent(entry.id, held);
      return { status: 'done' };
    }
    const reply = await client.request<ScheduleReply>('POST', request.path, { body: request.body });
    const id = reply.data && typeof reply.data === 'object' ? reply.data.ID : undefined;
    await markEntrySent(entry.id, id === undefined || id === null ? undefined : String(id));
    return { status: 'sent' };
  } catch (e) {
    // The words go on the entry so the clock screen can show them beside
    // the block; the error itself goes on to the queue's rules untouched.
    await markEntrySendFailed(entry.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function sendMore(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  if (item.kind === CLOCK_QUEUE_KIND) {
    const payload = item.payload as ClockBlockPayload | null;
    if (!payload || typeof payload.entryId !== 'string') {
      return { status: 'abandon', reason: 'The queued clock entry names no entry, so nothing was sent.' };
    }
    return sendClockEntry(payload, deps.client);
  }
  return { status: 'not-mine' };
}
