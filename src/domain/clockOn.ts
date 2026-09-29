import { QLD_UTC_OFFSET_HOURS, qldIsoDay } from './qldTime';

/**
 * Clocking on and off.
 *
 * Simpro Mobile's timesheet is a button: On when you walk onto the job, Off
 * when you leave, and the hours land on the job's cost centre as a schedule
 * block. The weekly timesheet this app already has (./timesheet) is the
 * payroll sheet, filled in after the fact; this is the live one, and it is
 * what the office reads when it asks what a job cost in hours.
 *
 * Three rules shape everything below.
 *
 * **At most one entry is open.** A person is on one thing at a time, so
 * starting anything closes whatever was running at the same instant. That
 * makes "switch job" the same operation as "clock on", and it means the sum
 * of a day's entries can never exceed the day.
 *
 * **An entry belongs to one Queensland day.** A Simpro schedule has one Date
 * and blocks inside it, so an entry that ran past midnight cannot be one
 * schedule. It is split at the stroke of the Queensland midnight into two
 * entries — one per day — the moment it is stopped, and each is sent on its
 * own. The day is the Queensland day (see ./qldTime): at seven in the
 * morning the UTC day is still yesterday, and a block filed on yesterday's
 * date is wrong on every timesheet the office prints.
 *
 * **The send is idempotent by entry.** A schedule block carries no text, so
 * the marker the notes use (./queueKey) has nowhere to go. Instead the queue
 * keys on the entry's own id, and the entry row records when the office
 * accepted it; either alone stops a resend, and together they survive a
 * re-queue and a retry.
 *
 * Pure: instants in, instants out, no database and no clock of its own. The
 * repository and the screen hand in `now` and `newId`.
 */

export type ClockKind = 'work' | 'travel' | 'break' | 'activity';

export interface ClockEntry {
  id: string;
  /** Simpro's employee id, as the schedule's Staff. */
  employeeExternalId: string;
  kind: ClockKind;
  jobExternalId?: string;
  jobSectionExternalId?: string;
  jobCostCenterExternalId?: string;
  jobTitle?: string;
  siteName?: string;
  activityExternalId?: string;
  activityName?: string;
  /** The Queensland day the entry belongs to, yyyy-mm-dd. */
  date: string;
  /** ISO instants. `endedAt` absent is the entry running now. */
  startedAt: string;
  endedAt?: string;
  scheduleRateId?: string;
  scheduleRateName?: string;
  note?: string;
  /** When the office accepted it, and the schedule id it gave back. */
  sentAt?: string;
  simproUid?: string;
  /** The last refusal, in the server's words, or why it cannot be sent yet. */
  sendError?: string;
}

/** What a caller says about the thing being clocked onto; the model fills in the rest. */
export type ClockStart = Pick<
  ClockEntry,
  | 'employeeExternalId' | 'kind' | 'jobExternalId' | 'jobSectionExternalId' | 'jobCostCenterExternalId'
  | 'jobTitle' | 'siteName' | 'activityExternalId' | 'activityName' | 'scheduleRateId' | 'scheduleRateName' | 'note'
>;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * The longest an entry may run and still be believed.
 *
 * Eighteen hours is past any shift this company works. An entry longer than
 * that is somebody who forgot to clock off, and the honest thing is to refuse
 * the number and say so, not to post a nineteen-hour block to the job.
 */
export const MAX_ENTRY_MINUTES = 18 * 60;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ---------------------------------------------------------------------------
// Queensland clock arithmetic
// ---------------------------------------------------------------------------

/**
 * The wall-clock time of an instant in Queensland, as HH:MM.
 *
 * The same arithmetic as ./qldTime: add ten hours, read the UTC fields. No
 * timezone library, because Queensland has no daylight saving and a library
 * that applied one anyway would be a bug with a respectable name.
 */
export function qldClock(iso: string): string | undefined {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const shifted = new Date(ms + QLD_UTC_OFFSET_HOURS * HOUR_MS);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/** The instant a Queensland day and clock time name, as ISO UTC. Undefined for a clock that is not one. */
export function qldInstant(day: string, clock: string): string | undefined {
  if (!CLOCK.test(clock.trim())) return undefined;
  if (!qldIsoDay(day)) return undefined;
  const ms = Date.parse(`${day}T${clock.trim()}:00+10:00`);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** The Queensland midnight that starts the day after `day`, as an instant. */
export function qldNextMidnight(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+10:00`) + 24 * HOUR_MS).toISOString();
}

/** yyyy-mm-dd plus a number of days, on the calendar. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * The Monday of the week a day falls in.
 *
 * Monday because the payroll week is Monday to Sunday, which is what the
 * weekly timesheet (./timesheet) already counts from; two weeks that start
 * on different days would never add up to each other.
 */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

export function openEntryOf(entries: readonly ClockEntry[]): ClockEntry | undefined {
  return entries.find((e) => !e.endedAt);
}

export interface StartResult {
  /** The list with the old entry closed (and split if it ran past midnight) and the new one opened. */
  entries: ClockEntry[];
  opened: ClockEntry;
  /**
   * Every entry closed by this start: none when nothing was running, one in
   * the ordinary case, one per day after a midnight split. A list rather
   * than the last piece, because each piece is its own send and the caller
   * queues them all — the one dated yesterday most of all.
   */
  closed: ClockEntry[];
}

/**
 * Opens an entry at `at`, closing whatever was open at the same instant.
 *
 * The same instant, so there is no gap and no overlap between the old block
 * and the new one: a technician who moves from one site's job to the next
 * without touching the phone in between is on one or the other, never
 * neither and never both.
 */
export function startEntry(
  entries: readonly ClockEntry[],
  input: ClockStart,
  at: string,
  newId: () => string,
): StartResult {
  const date = qldIsoDay(at);
  if (!date) throw new Error(`Cannot read the day out of "${at}".`);
  // The same id source for a piece the split makes, so a split piece and
  // an opened entry can never share an id.
  const stopped = stopEntry(entries, at, newId);
  const opened: ClockEntry = { ...stripUndefined(input), id: newId(), date, startedAt: at };
  return { entries: [...stopped.entries, opened], opened, closed: stopped.closed };
}

export interface StopResult {
  entries: ClockEntry[];
  /** Every entry closed: empty when nothing was open, one per day after a midnight split. */
  closed: ClockEntry[];
}

/**
 * Closes the open entry at `at`.
 *
 * An entry that ran past the Queensland midnight becomes two: see
 * splitAcrossMidnight. Nothing open is not an error — Off with nothing
 * running is the state the screen is already in.
 */
export function stopEntry(entries: readonly ClockEntry[], at: string, newId: () => string = () => `${at}-split`): StopResult {
  const open = openEntryOf(entries);
  if (!open) return { entries: [...entries], closed: [] };
  const pieces = splitAcrossMidnight({ ...open, endedAt: at }, newId);
  const rest = entries.filter((e) => e.id !== open.id);
  return { entries: [...rest, ...pieces], closed: pieces };
}

/** Clocking onto another job is clocking on; the name says what the button does. */
export function switchJob(
  entries: readonly ClockEntry[],
  input: Omit<ClockStart, 'kind'>,
  at: string,
  newId: () => string,
): StartResult {
  return startEntry(entries, { ...input, kind: 'work' }, at, newId);
}

/**
 * One entry per Queensland day.
 *
 * A closed entry whose end falls on a later day than its start is cut at
 * each midnight in between: the first piece keeps the id (so a queue row or
 * an edit that named it still finds it), the rest get new ids and the same
 * job. Each piece is then one schedule on one date, which is the only shape
 * Simpro's schedule takes. An open entry is returned as it is — there is
 * nothing to split until it stops.
 */
export function splitAcrossMidnight(entry: ClockEntry, newId: () => string): ClockEntry[] {
  if (!entry.endedAt) return [entry];
  const endDay = qldIsoDay(entry.endedAt);
  if (!endDay || endDay <= entry.date) return [entry];
  const pieces: ClockEntry[] = [];
  let cursor = entry;
  while (cursor.endedAt && (qldIsoDay(cursor.endedAt) ?? cursor.date) > cursor.date) {
    const midnight = qldNextMidnight(cursor.date);
    pieces.push({ ...cursor, endedAt: midnight });
    cursor = {
      ...cursor,
      id: newId(),
      date: addDays(cursor.date, 1),
      startedAt: midnight,
      // A new piece has not been sent, whatever the first one had recorded.
      sentAt: undefined,
      simproUid: undefined,
      sendError: undefined,
    };
  }
  pieces.push(cursor);
  return pieces;
}

// ---------------------------------------------------------------------------
// Minutes
// ---------------------------------------------------------------------------

export type Span =
  | { minutes: number; refused?: undefined }
  /** No number: the reason is the whole answer, and zero is what the totals count. */
  | { minutes: 0; refused: string };

/**
 * The whole minutes an entry ran, or why that cannot be said.
 *
 * Rounded, not truncated, so 7:00:29 to 7:59:31 is an hour and not
 * fifty-nine minutes; the office's own blocks are whole minutes too. An
 * open entry is measured to `now` where the caller has one, and refused
 * where it has not — a screen showing a live clock has a now, and a total
 * being filed does not want a running entry in it.
 */
export function entrySpan(entry: Pick<ClockEntry, 'startedAt' | 'endedAt'>, now?: string): Span {
  const end = entry.endedAt ?? now;
  if (!end) return { minutes: 0, refused: 'Still running' };
  const from = Date.parse(entry.startedAt);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { minutes: 0, refused: 'The times could not be read' };
  const minutes = Math.round((to - from) / MINUTE_MS);
  if (minutes < 0) return { minutes: 0, refused: 'Ends before it starts' };
  if (minutes > MAX_ENTRY_MINUTES) return { minutes: 0, refused: 'Longer than 18 hours: check the times' };
  return { minutes };
}

/** The minutes, and zero for an entry that refused. For a list; entrySpan for the reason. */
export function entryMinutes(entry: Pick<ClockEntry, 'startedAt' | 'endedAt'>, now?: string): number {
  return entrySpan(entry, now).minutes;
}

/** "1h 05m", "45m", "0m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return `${h}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * Whether a start and end can be saved on an entry, in the model's words.
 *
 * An edit has to keep the entry inside its day: the split at midnight
 * happens when an entry stops, and an edit that pushed the end into
 * tomorrow would make an entry no schedule can hold. Said here so the
 * screen and the repository refuse the same things.
 */
export function validateTimes(entry: Pick<ClockEntry, 'date'>, startedAt: string, endedAt?: string): string | undefined {
  if (qldIsoDay(startedAt) !== entry.date) return `Starts on a different day from ${entry.date}`;
  if (endedAt !== undefined) {
    if (qldIsoDay(endedAt) !== entry.date && endedAt !== qldNextMidnight(entry.date)) {
      return 'Ends after midnight: stop it at 23:59 and clock on again tomorrow';
    }
    const span = entrySpan({ startedAt, endedAt });
    if (span.refused) return span.refused;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface JobMinutes {
  jobExternalId: string;
  jobTitle?: string;
  siteName?: string;
  minutes: number;
}

export interface DayTotals {
  day: string;
  workMinutes: number;
  travelMinutes: number;
  breakMinutes: number;
  activityMinutes: number;
  byJob: JobMinutes[];
  /** Entries that gave no number, with the reason each. Listed, not hidden: a total that quietly left one out is wrong. */
  refused: { id: string; why: string }[];
}

/**
 * One day's hours by kind and by job.
 *
 * A break is counted and shown but never sent — Simpro has no break block;
 * a break is the gap between two work blocks, which is what the two entries
 * around it already say.
 */
export function dayTotals(entries: readonly ClockEntry[], day: string, now?: string): DayTotals {
  const totals: DayTotals = {
    day, workMinutes: 0, travelMinutes: 0, breakMinutes: 0, activityMinutes: 0, byJob: [], refused: [],
  };
  const jobs = new Map<string, JobMinutes>();
  for (const e of entries) {
    if (e.date !== day) continue;
    const span = entrySpan(e, now);
    if (span.refused) {
      totals.refused.push({ id: e.id, why: span.refused });
      continue;
    }
    if (e.kind === 'work') totals.workMinutes += span.minutes;
    else if (e.kind === 'travel') totals.travelMinutes += span.minutes;
    else if (e.kind === 'break') totals.breakMinutes += span.minutes;
    else totals.activityMinutes += span.minutes;
    if (e.kind === 'work' && e.jobExternalId) {
      const row = jobs.get(e.jobExternalId) ?? { jobExternalId: e.jobExternalId, jobTitle: e.jobTitle, siteName: e.siteName, minutes: 0 };
      row.minutes += span.minutes;
      jobs.set(e.jobExternalId, row);
    }
  }
  totals.byJob = [...jobs.values()].sort((a, b) => b.minutes - a.minutes || a.jobExternalId.localeCompare(b.jobExternalId));
  return totals;
}

export interface WeekTotals {
  weekStart: string;
  weekEnd: string;
  days: DayTotals[];
  workMinutes: number;
  travelMinutes: number;
  breakMinutes: number;
  activityMinutes: number;
  byJob: JobMinutes[];
}

/** The Monday-to-Sunday week around `day`, one DayTotals per day and the sums across them. */
export function weekTotals(entries: readonly ClockEntry[], day: string, now?: string): WeekTotals {
  const weekStart = weekStartOf(day);
  const days = Array.from({ length: 7 }, (_, i) => dayTotals(entries, addDays(weekStart, i), now));
  const jobs = new Map<string, JobMinutes>();
  for (const d of days) {
    for (const j of d.byJob) {
      const row = jobs.get(j.jobExternalId) ?? { ...j, minutes: 0 };
      row.minutes += j.minutes;
      jobs.set(j.jobExternalId, row);
    }
  }
  const sum = (key: 'workMinutes' | 'travelMinutes' | 'breakMinutes' | 'activityMinutes') =>
    days.reduce((n, d) => n + d[key], 0);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    days,
    workMinutes: sum('workMinutes'),
    travelMinutes: sum('travelMinutes'),
    breakMinutes: sum('breakMinutes'),
    activityMinutes: sum('activityMinutes'),
    byJob: [...jobs.values()].sort((a, b) => b.minutes - a.minutes || a.jobExternalId.localeCompare(b.jobExternalId)),
  };
}

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

/** The queue kind every clock entry goes out as. */
export const CLOCK_QUEUE_KIND = 'timesheet-block';

/** What the queue row carries: enough to find the entry again and name the job for the failure rules. */
export interface ClockBlockPayload {
  entryId: string;
  /** The Simpro job, where the entry is on one; the queue's failure rules name it. */
  jobId?: string;
  kind: ClockKind;
}

/**
 * The queue's content key for an entry: the kind and the entry's id.
 *
 * Not the content. An edit to the times must not make a second queue row
 * for the same block, and the id is what stays the same through an edit.
 * The row's sentAt is the other half of the guard (see sendReadiness).
 */
export function clockContentKey(entryId: string): string {
  return `${CLOCK_QUEUE_KIND}|${entryId}`;
}

export function clockPayload(entry: ClockEntry): ClockBlockPayload {
  return { entryId: entry.id, jobId: entry.jobExternalId, kind: entry.kind };
}

/** A schedule block as Simpro's POST takes it. */
export interface ScheduleBlock {
  StartTime: string;
  EndTime: string;
  ScheduleRate?: number;
}

export interface JobScheduleBody {
  Staff: number;
  Date: string;
  Blocks: ScheduleBlock[];
}

export interface ActivityScheduleBody extends JobScheduleBody {
  Activity: number;
  Notes?: string;
}

export interface ScheduleRequest {
  /** Relative to the company root: `jobs/…/schedules/` or `activitySchedules/`. */
  path: string;
  body: JobScheduleBody | ActivityScheduleBody;
}

export type Readiness = { ready: true } | { ready: false; why: string };

/**
 * Whether an entry can go to the office now, and if not, why in a word.
 *
 * Checked before queueing and again before sending, so the screen can say
 * "No cost centre on this job yet" beside the entry instead of the queue
 * finding out five retries later.
 */
export function sendReadiness(entry: ClockEntry): Readiness {
  if (entry.sentAt) return { ready: false, why: 'Already sent' };
  if (!entry.endedAt) return { ready: false, why: 'Still running' };
  if (entry.kind === 'break') return { ready: false, why: 'Breaks stay on the phone: Simpro reads the gap' };
  if (!/^\d+$/.test(entry.employeeExternalId.trim())) return { ready: false, why: 'No Simpro employee on this entry' };
  const span = entrySpan(entry);
  if (span.refused) return { ready: false, why: span.refused };
  if (span.minutes === 0) return { ready: false, why: 'Under a minute: nothing to send' };
  if (qldIsoDay(entry.endedAt) !== entry.date && entry.endedAt !== qldNextMidnight(entry.date)) {
    return { ready: false, why: 'Runs past midnight: split it first' };
  }
  if (entry.kind === 'work') {
    if (!entry.jobExternalId) return { ready: false, why: 'No job on this entry' };
    if (!entry.jobSectionExternalId || !entry.jobCostCenterExternalId) {
      return { ready: false, why: 'No cost centre on this job yet' };
    }
    return { ready: true };
  }
  if (!entry.activityExternalId) {
    return { ready: false, why: `No Simpro activity for ${entry.activityName ?? entry.kind}: sync the activity list first` };
  }
  return { ready: true };
}

/**
 * The one request that puts an entry in Simpro.
 *
 * A job entry is a schedule on the job's cost centre; travel and any other
 * activity is an activity schedule. Both are documented and neither POST
 * has been tried on the live build, so the body is built exactly as the
 * documentation shows and nothing more is guessed at. A block that ends at
 * the next midnight is written as ending at 23:59: every block the build
 * has ever answered with carries an HH:MM inside the day, and whether it
 * would take 24:00 is a guess this send does not make. The minute lost is
 * the price of a block the office is sure to accept, and the piece that
 * starts at 00:00 tomorrow is sent on its own.
 */
export function toScheduleRequest(entry: ClockEntry): ScheduleRequest {
  const readiness = sendReadiness(entry);
  if (!readiness.ready) throw new Error(`Cannot send this entry: ${readiness.why}.`);
  const end = entry.endedAt!;
  const block: ScheduleBlock = {
    StartTime: qldClock(entry.startedAt)!,
    EndTime: end === qldNextMidnight(entry.date) ? '23:59' : qldClock(end)!,
  };
  if (entry.scheduleRateId && /^\d+$/.test(entry.scheduleRateId)) block.ScheduleRate = Number(entry.scheduleRateId);
  const base: JobScheduleBody = { Staff: Number(entry.employeeExternalId), Date: entry.date, Blocks: [block] };
  if (entry.kind === 'work') {
    return {
      path: `jobs/${entry.jobExternalId}/sections/${entry.jobSectionExternalId}/costCenters/${entry.jobCostCenterExternalId}/schedules/`,
      body: base,
    };
  }
  const body: ActivityScheduleBody = { ...base, Activity: Number(entry.activityExternalId) };
  const notes = (entry.note ?? '').trim();
  if (notes) body.Notes = notes;
  return { path: 'activitySchedules/', body };
}

/** The same, named for what it returns. */
export const toScheduleBody = toScheduleRequest;

/**
 * A schedule as Simpro lists it, as far as the duplicate guard reads one.
 *
 * Read off the live build: the cost centre's `schedules/` and the
 * `activitySchedules/` list both carry `ID`, `Staff {ID, Name}`, `Date` and,
 * asked for by column, `Blocks [{StartTime, EndTime}]` in HH:MM.
 */
export interface ScheduleRecord {
  ID?: unknown;
  Staff?: { ID?: unknown } | null;
  Date?: unknown;
  Activity?: { ID?: unknown } | null;
  Blocks?: { StartTime?: unknown; EndTime?: unknown }[] | null;
}

/**
 * The id of a schedule the office already holds for this request, or none.
 *
 * Same staff, same date, and a block with the same start and end: that is
 * this block, whichever phone posted it. An activity request must also be
 * on the same activity — the same person cannot be in two places at once,
 * so a block at the same minutes on another activity is the office's
 * doing, not a copy of this one. Matched on what the POST sends, so an edit
 * to the times looks for the edited block and not the old one.
 */
export function findAcceptedSchedule(records: readonly ScheduleRecord[], request: ScheduleRequest): string | undefined {
  const want = request.body.Blocks[0];
  if (!want) return undefined;
  const activity = 'Activity' in request.body ? String(request.body.Activity) : undefined;
  for (const r of records) {
    if (r.ID === undefined || r.ID === null) continue;
    if (String(r.Staff?.ID) !== String(request.body.Staff)) continue;
    if (String(r.Date) !== request.body.Date) continue;
    if (activity !== undefined && r.Activity?.ID !== undefined && r.Activity?.ID !== null && String(r.Activity.ID) !== activity) continue;
    const hit = (r.Blocks ?? []).some((b) => b.StartTime === want.StartTime && b.EndTime === want.EndTime);
    if (hit) return String(r.ID);
  }
  return undefined;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep", from yyyy-mm-dd; the day as written where it is not one. */
export function shortDay(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? m[1]}`;
}

/**
 * One line naming an entry for a person: "Hours on job 1001, 07:00–09:30,
 * 8 Sep", or the activity's name in place of the job. For Waiting to send,
 * where a queue row otherwise shows only its kind.
 */
export function describeEntry(entry: ClockEntry): string {
  const what = entry.kind === 'work'
    ? `Hours on job ${entry.jobExternalId ?? '?'}`
    : entry.kind === 'break' ? 'Break' : (entry.activityName ?? (entry.kind === 'travel' ? 'Travel' : 'Activity'));
  const times = `${qldClock(entry.startedAt) ?? '?'}–${entry.endedAt ? (qldClock(entry.endedAt) ?? '?') : 'now'}`;
  return `${what}, ${times}, ${shortDay(entry.date)}`;
}

/** Drops undefined fields, so an entry compares equal to itself after a round trip through JSON. */
function stripUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out as T;
}
