import { SimproClient, type SimproConfig } from './client';
import { SimproResources } from './resources';
import type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';
import { replaceScheduleWindow } from '@/db/scheduleRepo';
import type { ScheduleRecord } from '@/domain/clockOn';
import { scheduleWindow } from '@/domain/myDay';
import {
  SCHEDULE_BOOK_KIND, SCHEDULE_MOVE_KIND, buildBooking, buildMove, buildRemove, findAcceptedSchedule, findScheduleIn,
  heldForUndo, isScheduleKind, readScheduleChange, recordAlreadyAt, recordIsMine, schedulePath,
  type MovePayload, type RemovePayload,
} from '@/domain/scheduling';

/**
 * Sending schedule changes a technician makes on the phone: booking
 * themselves onto a job, moving a block, taking one off.
 *
 * The clock-on's hours go up as schedule blocks too, and live in
 * ./outboundMore; this module is for the blocks a person places on the
 * calendar ahead of time rather than the ones the clock records as they
 * happen. ./outboundMore hands any kind it does not know here before giving
 * up on it.
 *
 * Three things hold across every kind. **A change waits its minute.** Each
 * payload carries the instant before which it must not go, and until then
 * the row is answered `later` — left pending and untouched — so a slip can
 * be taken back by deleting the row. **The office is read before it is
 * written.** A booking looks for itself on the cost centre's day first, the
 * way the clock does, so a retry after an unread reply finds the block the
 * office took rather than posting it twice; a move or removal reads the
 * record it is about, and a record already where the move would put it is
 * `done` with nothing sent. A block the office has moved or taken off since
 * the phone last synced is left alone and said so — abandoned with the
 * reason, not closed quietly as done, because a person who asked for a move
 * and sees nothing on the calendar would otherwise not know why. The one
 * exception is a removal whose record the office answers 404 for: what was
 * asked for has happened, whoever did it. **Only your own.** The record
 * read back must still be this person's; one the office has since given to
 * somebody else is left alone, with the reason on the row.
 *
 * The POST is the one request tried on the live build (the clock's). The
 * PATCH and the DELETE are built as the documentation shows and have not
 * been tried; a refusal is thrown as the client's own error and reaches the
 * person in the server's words on Waiting to send.
 */

/** The reply to a schedule POST, as far as the send reads it: the id, if one came back. */
interface ScheduleReply { ID?: unknown }

/** A schedule record as the live build lists and returns one, as far as the send reads it. */
interface HeldRecord extends ScheduleRecord { IsLocked?: unknown }

const DAY_COLUMNS = 'ID,Staff,Date,Blocks';

/**
 * The schedule the office already holds for this booking, if it holds one:
 * the same read as the clock's, on the same collection the POST goes to.
 * Undefined for "not there"; throws where the read failed, and the caller
 * decides what that means.
 */
async function acceptedBookingId(path: string, body: { Staff: number; Date: string; Blocks: { StartTime: string; EndTime: string }[] }, client: SimproClient): Promise<string | undefined> {
  const { data } = await client.request<ScheduleRecord[] | undefined>('GET', path, {
    query: { Date: body.Date, columns: DAY_COLUMNS, pageSize: 250 },
  });
  return findAcceptedSchedule(Array.isArray(data) ? data : [], { path, body });
}

/** Whether a thrown error is the office saying the record is not there. */
function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404;
}

/**
 * The record's path relative to the company root, from the href the phone
 * holds or by finding the block on one of the job's cost centres.
 *
 * A block the phone knows only from the office's day list has no cost
 * centre path: the list carries the job and not the section. This person's
 * own blocks usually come with one from the timesheet read, and the screen
 * puts it on the payload; failing that the screen puts the job's cost
 * centres on, and the block is looked for on each, on its day. Not found on
 * any is the office having moved it since — `gone`, and the caller says so —
 * because a PATCH sent to a guessed path is a change to somebody else's
 * block.
 */
async function resolvePath(
  payload: MovePayload | RemovePayload,
  client: SimproClient,
): Promise<{ path: string } | { gone: true }> {
  if (payload.href) {
    const req = buildRemove(payload.href);
    return { path: req.path };
  }
  const day = 'from' in payload ? payload.from.date : payload.date;
  for (const cc of payload.costCentres ?? []) {
    if (!payload.jobId) break;
    const collection = `jobs/${payload.jobId}/sections/${cc.sectionId}/costCenters/${cc.costCenterId}/schedules/`;
    const { data } = await client.request<ScheduleRecord[] | undefined>('GET', collection, {
      query: { Date: day, columns: DAY_COLUMNS, pageSize: 250 },
    });
    if (findScheduleIn(Array.isArray(data) ? data : [], payload.scheduleId)) {
      return { path: schedulePath(payload.jobId, cc.sectionId, cc.costCenterId, payload.scheduleId) };
    }
  }
  return { gone: true };
}

/** The record as the office holds it now, or undefined when it is gone. Throws for any other refusal. */
async function readRecord(path: string, client: SimproClient): Promise<HeldRecord | undefined> {
  try {
    const { data } = await client.request<HeldRecord | undefined>('GET', path);
    return data && typeof data === 'object' ? data : undefined;
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** The one reason a held record cannot be changed from here, or nothing. */
function recordProblem(record: HeldRecord, employeeId: string): string | undefined {
  if (!recordIsMine(record, employeeId)) {
    return 'The office has given this block to somebody else since, so it was left alone. The office moves other people\'s blocks.';
  }
  if (record.IsLocked === true) return 'The office has locked this block, so it cannot be changed from the phone.';
  return undefined;
}

/** Said of a block the office no longer has where the phone last saw it. */
const MOVED_SINCE = 'The office has moved or removed this block since the phone last synced, so it was left alone. Check the calendar after the next sync.';

export async function sendScheduleChange(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  if (!isScheduleKind(item.kind)) return { status: 'not-mine' };
  const read = readScheduleChange(item.kind, item.payload);
  if ('error' in read) return { status: 'abandon', reason: `Nothing was sent: ${read.error}` };
  // Its minute is not up: the row waits, untouched, and undo can still delete it.
  if (heldForUndo(read.payload.notBefore, new Date().toISOString())) return { status: 'later' };
  const { client } = deps;

  if (read.kind === SCHEDULE_BOOK_KIND) {
    const p = read.payload;
    const request = buildBooking({
      employeeId: p.employeeId, jobExternalId: p.jobId, sectionId: p.sectionId, costCenterId: p.costCenterId,
      date: p.date, start: p.start, end: p.end,
    });
    // Is it there already? Where the read itself fails the POST goes ahead
    // regardless: a duplicate block is a thing the office can see and
    // delete, and a booking held back on the phone until a read succeeds
    // is a technician the office does not know is coming.
    let held: string | undefined;
    try {
      held = await acceptedBookingId(request.path, request.body, client);
    } catch {
      held = undefined;
    }
    if (held !== undefined) return { status: 'done' };
    await client.request<ScheduleReply>('POST', request.path, { body: request.body });
    return { status: 'sent' };
  }

  const p = read.payload;
  const where = await resolvePath(p, client);
  if ('gone' in where) return { status: 'abandon', reason: MOVED_SINCE };
  const record = await readRecord(where.path, client);
  // A removal of a record that is already gone has happened; a move of one
  // has not, and cannot.
  if (!record) return read.kind === SCHEDULE_MOVE_KIND ? { status: 'abandon', reason: MOVED_SINCE } : { status: 'done' };
  const problem = recordProblem(record, p.employeeId);
  if (problem) return { status: 'abandon', reason: `Nothing was sent: ${problem}` };

  if (read.kind === SCHEDULE_MOVE_KIND) {
    const move = read.payload;
    if (recordAlreadyAt(record, move.date, move.start, move.end)) return { status: 'done' };
    // PATCH as documented: the record's path, the new Date and Blocks. Not
    // tried on the live build.
    const request = buildMove(where.path, move.date, move.start, move.end);
    await client.request('PATCH', request.path, { body: request.body });
    return { status: 'sent' };
  }

  // DELETE as documented: the record's path, no body. Not tried on the live build.
  const request = buildRemove(where.path);
  await client.request('DELETE', request.path);
  return { status: 'sent' };
}

/**
 * Reads the office's calendar for the sync's window and replaces the
 * phone's copy, the way the sync does on its own schedule.
 *
 * For the screen, once a change of its own has gone: the block the person
 * just booked is the office's from that moment, and the half hour until the
 * next sync is a long time to look at a "Sent" chip. One read, the same one
 * the sync makes; a build that refuses the date filter throws the client's
 * own error, and the screen leaves it to the sync's fallback rather than
 * repeating it here.
 */
export async function refreshScheduleWindow(config: SimproConfig, nowIso = new Date().toISOString()): Promise<number> {
  return pullScheduleWindow(new SimproResources(new SimproClient(config)), nowIso);
}

/** The read and the replace, with the office handed in: the seam the test drives. */
export async function pullScheduleWindow(api: Pick<SimproResources, 'schedulesBetween'>, nowIso: string): Promise<number> {
  const window = scheduleWindow(nowIso);
  const blocks = await api.schedulesBetween(window.from, window.to);
  return replaceScheduleWindow(window.from, window.to, blocks);
}
