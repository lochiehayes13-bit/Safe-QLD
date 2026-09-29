import { getDb, inTransaction, newId, nowIso } from './index';
import {
  addDays, startEntry as modelStart, stopEntry as modelStop, validateTimes,
  clockContentKey, type ClockEntry, type ClockStart,
} from '@/domain/clockOn';

/**
 * The clock entries on this phone.
 *
 * Every other v23 table mirrors a record the office owns; this one is the
 * other way round. An entry is made here, with a local id, and the office
 * hears of it when the queue sends it — so the row carries the send's
 * outcome (sentAt, simproUid, sendError) beside the block itself, and the
 * clock screen reads the state of a send off the row rather than off the
 * queue.
 *
 * The rules — one open entry, a split at midnight, what counts as a valid
 * edit — live in @/domain/clockOn and are applied here inside a transaction,
 * so two taps on On cannot open two entries between the read and the write.
 */

interface ClockRow {
  id: string;
  employeeExternalId: string | null;
  kind: string;
  jobExternalId: string | null;
  jobSectionExternalId: string | null;
  jobCostCenterExternalId: string | null;
  jobTitle: string | null;
  siteName: string | null;
  activityExternalId: string | null;
  activityName: string | null;
  date: string;
  startedAt: string;
  endedAt: string | null;
  scheduleRateId: string | null;
  scheduleRateName: string | null;
  note: string | null;
  sentAt: string | null;
  simproUid: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
}

const opt = (v: string | null): string | undefined => (v === null ? undefined : v);

function hydrate(r: ClockRow): ClockEntry {
  const kind = r.kind === 'travel' || r.kind === 'break' || r.kind === 'activity' ? r.kind : 'work';
  const entry: ClockEntry = {
    id: r.id,
    employeeExternalId: r.employeeExternalId ?? '',
    kind,
    date: r.date,
    startedAt: r.startedAt,
  };
  // Optional fields only where the row has them, so an entry read back
  // compares equal to the one the model built.
  const bag = entry as unknown as Record<string, unknown>;
  const set = (key: keyof ClockEntry, value: string | null) => {
    if (value !== null) bag[key] = value;
  };
  set('jobExternalId', r.jobExternalId);
  set('jobSectionExternalId', r.jobSectionExternalId);
  set('jobCostCenterExternalId', r.jobCostCenterExternalId);
  set('jobTitle', r.jobTitle);
  set('siteName', r.siteName);
  set('activityExternalId', r.activityExternalId);
  set('activityName', r.activityName);
  set('endedAt', r.endedAt);
  set('scheduleRateId', r.scheduleRateId);
  set('scheduleRateName', r.scheduleRateName);
  set('note', r.note);
  set('sentAt', r.sentAt);
  set('simproUid', r.simproUid);
  set('sendError', r.sendError);
  return entry;
}

const COLUMNS = `id, employeeExternalId, kind, jobExternalId, jobSectionExternalId, jobCostCenterExternalId, jobTitle, siteName,
  activityExternalId, activityName, date, startedAt, endedAt, scheduleRateId, scheduleRateName, note, sentAt, simproUid, sendError`;

async function writeEntry(db: Awaited<ReturnType<typeof getDb>>, e: ClockEntry, at: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO clock_entry (id, employeeExternalId, kind, jobExternalId, jobSectionExternalId, jobCostCenterExternalId,
       jobTitle, siteName, activityExternalId, activityName, date, startedAt, endedAt, scheduleRateId, scheduleRateName,
       note, sentAt, simproUid, sendError, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       employeeExternalId = excluded.employeeExternalId, kind = excluded.kind,
       jobExternalId = excluded.jobExternalId, jobSectionExternalId = excluded.jobSectionExternalId,
       jobCostCenterExternalId = excluded.jobCostCenterExternalId, jobTitle = excluded.jobTitle,
       siteName = excluded.siteName, activityExternalId = excluded.activityExternalId,
       activityName = excluded.activityName, date = excluded.date, startedAt = excluded.startedAt,
       endedAt = excluded.endedAt, scheduleRateId = excluded.scheduleRateId,
       scheduleRateName = excluded.scheduleRateName, note = excluded.note, sentAt = excluded.sentAt,
       simproUid = excluded.simproUid, sendError = excluded.sendError, updatedAt = excluded.updatedAt`,
    e.id, e.employeeExternalId, e.kind, e.jobExternalId ?? null, e.jobSectionExternalId ?? null,
    e.jobCostCenterExternalId ?? null, e.jobTitle ?? null, e.siteName ?? null, e.activityExternalId ?? null,
    e.activityName ?? null, e.date, e.startedAt, e.endedAt ?? null, e.scheduleRateId ?? null,
    e.scheduleRateName ?? null, e.note ?? null, e.sentAt ?? null, e.simproUid ?? null, e.sendError ?? null, at, at,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The entry running now, or none. There is at most one; the write path guarantees it. */
export async function openEntry(): Promise<ClockEntry | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<ClockRow>(
    `SELECT ${COLUMNS} FROM clock_entry WHERE endedAt IS NULL ORDER BY startedAt DESC LIMIT 1`,
  );
  return row ? hydrate(row) : undefined;
}

export async function getEntry(id: string): Promise<ClockEntry | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<ClockRow>(`SELECT ${COLUMNS} FROM clock_entry WHERE id = ?`, id);
  return row ? hydrate(row) : undefined;
}

export async function listEntriesForDay(day: string): Promise<ClockEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ClockRow>(
    `SELECT ${COLUMNS} FROM clock_entry WHERE date = ? ORDER BY startedAt, id`, day,
  );
  return rows.map(hydrate);
}

/** Entries on the Queensland days from `from` to `to`, both inclusive, oldest first. */
export async function listEntriesBetween(from: string, to: string): Promise<ClockEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ClockRow>(
    `SELECT ${COLUMNS} FROM clock_entry WHERE date >= ? AND date <= ? ORDER BY date, startedAt, id`, from, to,
  );
  return rows.map(hydrate);
}

/** Closed entries the office has not accepted, oldest first. Breaks are never sent, so they are not here. */
export async function unsentEntries(): Promise<ClockEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ClockRow>(
    `SELECT ${COLUMNS} FROM clock_entry
     WHERE sentAt IS NULL AND endedAt IS NOT NULL AND kind <> 'break'
     ORDER BY date, startedAt, id`,
  );
  return rows.map(hydrate);
}

/** The state of each entry's queue row, by entry id, for the send chip beside it. */
export interface QueueState {
  /** 'sending' is a row a run has claimed this moment; the screen treats it as pending. */
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
  lastError?: string;
}

export async function queueStatesFor(entryIds: readonly string[]): Promise<Map<string, QueueState>> {
  const out = new Map<string, QueueState>();
  if (!entryIds.length) return out;
  const db = await getDb();
  const keys = entryIds.map(clockContentKey);
  const rows = await db.getAllAsync<{ contentKey: string; status: QueueState['status']; lastError: string | null; createdAt: string }>(
    `SELECT contentKey, status, lastError, createdAt FROM sync_queue
     WHERE contentKey IN (${keys.map(() => '?').join(',')}) ORDER BY createdAt`,
    ...keys,
  );
  // Newest row wins: a failed row re-queued has a pending one after it.
  for (const r of rows) {
    const id = entryIds[keys.indexOf(r.contentKey)];
    if (id) out.set(id, { status: r.status, lastError: opt(r.lastError) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Clocks on, closing whatever was open at the same instant.
 *
 * One transaction around the read and both writes, so the "at most one open"
 * rule holds against a double tap. Returns the entry opened and every entry
 * closed to open it — one per day after a midnight split — because each of
 * those is a block the office is now owed, and a Switch job or an activity
 * chip is the only clock-off the old entry ever gets.
 */
export async function startEntry(input: ClockStart, at: string = nowIso()): Promise<{ opened: ClockEntry; closed: ClockEntry[] }> {
  const db = await getDb();
  let opened: ClockEntry | undefined;
  let closed: ClockEntry[] = [];
  await inTransaction(db, async () => {
    const open = await openEntry();
    const result = modelStart(open ? [open] : [], input, at, newId);
    for (const e of result.entries) await writeEntry(db, e, at);
    opened = result.opened;
    closed = result.closed;
  });
  return { opened: opened!, closed };
}

/**
 * Writes an entry that is already closed, without touching whatever is open.
 *
 * A day of leave is this: a block from seven to three on a day that has not
 * come yet, sent up as an activity schedule. It is not a clock-on — the
 * person is not starting anything now — so it must not close the entry they
 * are actually running, which `startEntry` would.
 */
export async function insertClosedEntry(entry: ClockEntry, at: string = nowIso()): Promise<ClockEntry> {
  if (!entry.endedAt) throw new Error('insertClosedEntry needs an entry with an end');
  const db = await getDb();
  await writeEntry(db, entry, at);
  return (await getEntry(entry.id))!;
}

/**
 * Clocks off. Returns every entry closed: empty when nothing was open, one
 * in the ordinary case, and one per day after a midnight split — the piece
 * dated yesterday is as much a send as the one dated today.
 */
export async function stopOpenEntry(at: string = nowIso()): Promise<ClockEntry[]> {
  const db = await getDb();
  let closed: ClockEntry[] = [];
  await inTransaction(db, async () => {
    const open = await openEntry();
    if (!open) return;
    const result = modelStop([open], at, newId);
    for (const e of result.entries) await writeEntry(db, e, at);
    closed = result.closed;
  });
  return closed;
}

/**
 * Changes an entry's times, within its day.
 *
 * Refused in the model's words rather than thrown, because every refusal
 * here is something a person typed. A sent entry is refused too: the
 * office already has the old block, and changing this copy would only
 * make the two disagree.
 */
export async function updateEntryTimes(
  id: string,
  startedAt: string,
  endedAt: string | undefined,
): Promise<{ ok: true; entry: ClockEntry } | { ok: false; why: string }> {
  const entry = await getEntry(id);
  if (!entry) return { ok: false, why: 'That entry is no longer here' };
  if (entry.sentAt) return { ok: false, why: 'Already sent to Simpro; change it there' };
  const why = validateTimes(entry, startedAt, endedAt);
  if (why) return { ok: false, why };
  const db = await getDb();
  const at = nowIso();
  // A running entry given an end is being stopped by hand; one being given
  // no end is not a shape this screen makes, but the model allows it.
  await db.runAsync(
    'UPDATE clock_entry SET startedAt = ?, endedAt = ?, sendError = NULL, updatedAt = ? WHERE id = ?',
    startedAt, endedAt ?? null, at, id,
  );
  return { ok: true, entry: (await getEntry(id))! };
}

/** Gone. A sent entry is refused for the same reason updateEntryTimes refuses it. */
export async function deleteEntry(id: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const entry = await getEntry(id);
  if (!entry) return { ok: true };
  if (entry.sentAt) return { ok: false, why: 'Already sent to Simpro; delete it there' };
  const db = await getDb();
  await db.runAsync('DELETE FROM clock_entry WHERE id = ?', id);
  return { ok: true };
}

/** The office accepted it. The uid is the schedule id it answered with, where it gave one. */
export async function markEntrySent(id: string, simproUid: string | undefined, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE clock_entry SET sentAt = ?, simproUid = ?, sendError = NULL, updatedAt = ? WHERE id = ?',
    at, simproUid ?? null, at, id,
  );
}

/** The office refused it, or it cannot go yet: the words are kept for the screen. */
export async function markEntrySendFailed(id: string, error: string, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE clock_entry SET sendError = ?, updatedAt = ? WHERE id = ?', error, at, id);
}

// ---------------------------------------------------------------------------
// The job's cost centres
// ---------------------------------------------------------------------------

export interface CostCentreChoice {
  sectionExternalId: string;
  sectionName: string;
  costCenterExternalId: string;
  name: string;
}

/**
 * The cost centres a job's hours can land on, in the office's order.
 *
 * Empty for a job whose children have never been read — the sync reads
 * them on demand — as well as for a job that truly has none; the caller
 * reads the detail first and asks again before deciding which.
 */
export async function costCentresForJob(jobExternalId: string): Promise<CostCentreChoice[]> {
  const db = await getDb();
  return db.getAllAsync<CostCentreChoice>(
    `SELECT s.externalId AS sectionExternalId, s.name AS sectionName,
            c.externalId AS costCenterExternalId, c.name AS name
     FROM job_cost_center c
     JOIN job j ON j.id = c.jobId
     JOIN job_section s ON s.jobId = c.jobId AND s.externalId = c.sectionExternalId
     WHERE j.externalId = ?
     ORDER BY s.displayOrder, c.displayOrder, c.externalId`,
    jobExternalId,
  );
}

/** The days of the week around `day`, for the week's read. */
export function weekWindow(weekStart: string): { from: string; to: string } {
  return { from: weekStart, to: addDays(weekStart, 6) };
}
