import type { SimproClient } from './client';
import type { SimproResources } from './resources';
import { flushSoon } from './flushSoon';
import { sendAssetChange } from './outboundAssets';
import { sendScheduleChange } from './outboundSchedule';
import type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';
import { SIMPRO_PATHS } from './mirrorResources';
import {
  JOB_MATERIAL_KIND, JOB_SIGNOFF_KIND, JOB_STATUS_KIND,
  type JobMaterialPayload, type JobSignoffPayload, type JobStatusPayload,
} from '@/domain/jobActions';
import { hasMarker } from '@/domain/queueKey';
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

/* The contract lives in ./outboundKinds so the register and calendar
   modules can share it without importing this one; re-exported here for
   the callers that always read it from here. */
export type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';

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

// ---------------------------------------------------------------------------
// The job card: status, materials, sign-off
// ---------------------------------------------------------------------------

/**
 * The three things a technician does to a job from the card, sent.
 *
 * Each has a read before the write, because each is a POST or a PATCH the
 * office cannot tell a retry from: a status is read and not patched when
 * the job already wears it; a line is read and not posted when the cost
 * centre already holds one like it from the last hour; a sign-off note is
 * read and not posted when the job's notes already carry its marker. Where
 * the read itself fails the write goes ahead, for the reason the clock
 * entry gives above: a duplicate is a thing the office can see and delete,
 * and a line or a status that never went is not.
 *
 * None of the three bodies has been tried on the live build; each is the
 * documented shape, with the key names confirmed by reading the same
 * collections with GET on 2026-09-09. A refusal reaches the person in the
 * server's words on Waiting to send.
 */

/** A job as `jobs/{id}?columns=ID,Status` answers it on the live build. */
interface JobStatusReply { ID?: unknown; Status?: { ID?: unknown; Name?: unknown } | null }

function isJobId(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

async function sendJobStatus(payload: JobStatusPayload, client: SimproClient): Promise<SendMoreOutcome> {
  if (!isJobId(payload.jobId) || !isJobId(payload.statusId)) {
    return { status: 'abandon', reason: 'The queued status change names no job or no status, so nothing was sent.' };
  }
  const path = SIMPRO_PATHS.job(payload.jobId);
  try {
    const { data } = await client.request<JobStatusReply | undefined>('GET', path, { query: { columns: 'ID,Status' } });
    const held = data && typeof data === 'object' ? data.Status?.ID : undefined;
    if (held !== undefined && held !== null && String(held) === payload.statusId) return { status: 'done' };
  } catch {
    // The PATCH is idempotent: patching a status the job already wears
    // changes nothing, so a read that failed costs only the request.
  }
  await client.request('PATCH', path, { body: { Status: Number(payload.statusId) } });
  return { status: 'sent' };
}

/** A line as the cost centre's `catalogs/` or `oneOffs/` list it: the part or the words, the count, and when. */
interface HeldLine {
  ID?: unknown;
  Catalog?: { ID?: unknown } | null;
  Description?: unknown;
  Total?: { Qty?: unknown } | null;
  DateModified?: unknown;
}

/** How far back a matching line on the cost centre counts as this one. */
const MATERIAL_GUARD_MS = 60 * 60 * 1000;

/**
 * Lines this run has posted, as `path#id`.
 *
 * The guard below asks "did an earlier try of this row already land?" and
 * reads the answer off the office's list. A line this run posted a moment
 * ago answers yes to that question wrongly: two separate lines for the same
 * part — one added in the morning, one after lunch, both waiting for signal
 * — flush together, and the second reads the first as its own earlier try
 * and is closed without being sent, so the job is billed one battery
 * instead of two. A line this run made itself is therefore not evidence,
 * and is skipped.
 *
 * Not kept across a restart, on purpose: a row whose reply was never read
 * has no id here either way, which is the case the guard exists for.
 */
const postedLines = new Set<string>();

/**
 * Whether the cost centre already holds this line from the last hour.
 *
 * The same part (or the same words) with the same quantity, modified in the
 * hour before the send, is taken as this line having landed on an earlier
 * try. The limit of that: a technician who adds two of the same part an
 * hour apart, each sent while online, gets both; one who adds them twenty
 * minutes apart gets one, and sees the second closed as already there on
 * Waiting to send. A line the office added itself in that hour reads the
 * same way. A held line with no DateModified cannot be placed in time and
 * does not count, so a list that will not give the column posts rather than
 * skips. A line this run posted is not counted at all — see `postedLines`.
 */
export function materialAlreadyHeld(
  held: readonly HeldLine[],
  payload: JobMaterialPayload,
  now: number,
  path = '',
): boolean {
  const description = payload.description.trim().toLowerCase();
  return held.some((line) => {
    if (line.ID !== undefined && line.ID !== null && postedLines.has(`${path}#${String(line.ID)}`)) return false;
    const qty = Number(line.Total?.Qty);
    if (!Number.isFinite(qty) || qty !== payload.qty) return false;
    const modified = typeof line.DateModified === 'string' ? Date.parse(line.DateModified) : NaN;
    if (!Number.isFinite(modified) || now - modified > MATERIAL_GUARD_MS || modified - now > MATERIAL_GUARD_MS) return false;
    if (payload.kind === 'catalog') {
      const id = line.Catalog?.ID;
      return id !== undefined && id !== null && String(id) === payload.catalogId;
    }
    return typeof line.Description === 'string' && line.Description.trim().toLowerCase() === description;
  });
}

async function sendJobMaterial(payload: JobMaterialPayload, client: SimproClient): Promise<SendMoreOutcome> {
  if (!isJobId(payload.jobId) || !isJobId(payload.sectionId) || !isJobId(payload.costCenterId)) {
    return { status: 'abandon', reason: 'The queued line names no job or no cost centre, so nothing was sent.' };
  }
  if (!(typeof payload.qty === 'number' && payload.qty > 0)) {
    return { status: 'abandon', reason: 'The queued line has no quantity, so nothing was sent.' };
  }
  const kind = payload.kind === 'oneOff' ? 'oneOff' : 'catalog';
  if (kind === 'catalog' && !isJobId(payload.catalogId)) {
    return { status: 'abandon', reason: 'The queued line names no catalogue item, so nothing was sent.' };
  }
  if (kind === 'oneOff' && !(typeof payload.description === 'string' && payload.description.trim())) {
    return { status: 'abandon', reason: 'The queued one-off line has no description, so nothing was sent.' };
  }
  const path = SIMPRO_PATHS.jobItems(payload.jobId, payload.sectionId, payload.costCenterId, kind);
  try {
    // One page of 250: a cost centre with more lines than that is a project
    // this card is not written for. The columns are the ones the guard reads.
    const columns = kind === 'catalog' ? 'ID,Catalog,Total,DateModified' : 'ID,Description,Total,DateModified';
    const { data } = await client.request<HeldLine[] | undefined>('GET', path, { query: { columns, pageSize: 250 } });
    if (materialAlreadyHeld(Array.isArray(data) ? data : [], payload, Date.now(), path)) return { status: 'done' };
  } catch {
    // Read failed: post, for the reason given above.
  }
  const body = kind === 'catalog'
    ? { Catalog: Number(payload.catalogId), Qty: payload.qty }
    : { Description: payload.description.trim(), Qty: payload.qty };
  const reply = await client.request<{ ID?: unknown } | undefined>('POST', path, { body });
  const id = reply.data && typeof reply.data === 'object' ? (reply.data as { ID?: unknown }).ID : undefined;
  if (id !== undefined && id !== null) postedLines.add(`${path}#${String(id)}`);
  return { status: 'sent' };
}

/** A note as `jobs/{id}/notes/` lists it, the two columns the guard reads. */
interface HeldNote { ID?: unknown; Note?: unknown }

async function sendJobSignoff(payload: JobSignoffPayload, deps: SendDeps): Promise<SendMoreOutcome> {
  if (!isJobId(payload.jobId) || typeof payload.note !== 'string' || !payload.note.trim()) {
    return { status: 'abandon', reason: 'The queued sign-off names no job or has no note, so nothing was sent.' };
  }
  if (isJobId(payload.noteKey)) {
    try {
      const { data } = await deps.client.request<HeldNote[] | undefined>('GET', SIMPRO_PATHS.jobNotes(payload.jobId), {
        query: { columns: 'ID,Note', pageSize: 250 },
      });
      const notes = Array.isArray(data) ? data : [];
      if (notes.some((n) => typeof n.Note === 'string' && hasMarker(n.Note, payload.noteKey))) return { status: 'done' };
    } catch {
      // Read failed: post. The marker in the note is what lets a person
      // find the duplicate, and the sign-off itself is what the office
      // invoices on.
    }
  }
  // The signature file is queued alongside as an ordinary attachment row;
  // this is only the note that names who signed and where the file is.
  await deps.api.addJobNote(payload.jobId, typeof payload.subject === 'string' ? payload.subject : 'Signed off', payload.note);
  return { status: 'sent' };
}

export async function sendMore(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  if (item.kind === CLOCK_QUEUE_KIND) {
    const payload = item.payload as ClockBlockPayload | null;
    if (!payload || typeof payload.entryId !== 'string') {
      return { status: 'abandon', reason: 'The queued clock entry names no entry, so nothing was sent.' };
    }
    return sendClockEntry(payload, deps.client);
  }
  if (item.kind === JOB_STATUS_KIND) return sendJobStatus((item.payload ?? {}) as JobStatusPayload, deps.client);
  if (item.kind === JOB_MATERIAL_KIND) return sendJobMaterial((item.payload ?? {}) as JobMaterialPayload, deps.client);
  if (item.kind === JOB_SIGNOFF_KIND) return sendJobSignoff((item.payload ?? {}) as JobSignoffPayload, deps);
  // The register and the calendar have modules of their own; each is asked
  // in turn before the kind is given up on.
  const asset = await sendAssetChange(item, deps);
  if (asset.status !== 'not-mine') return asset;
  const schedule = await sendScheduleChange(item, deps);
  if (schedule.status !== 'not-mine') return schedule;
  return { status: 'not-mine' };
}
