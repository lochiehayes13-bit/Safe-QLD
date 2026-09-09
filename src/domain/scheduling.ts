import { findAcceptedSchedule, shortDay, weekStartOf, type ScheduleRecord } from './clockOn';
import { addDays, type ScheduleEntry } from './myDay';
import { qldIsoDay } from './qldTime';

/**
 * Scheduling from the phone.
 *
 * The office's calendar is the `schedule` table: every block for every
 * member of staff, a week back and three ahead. This lays it out the way a
 * technician reads it — a day with a column per person, a week of their own
 * — and builds the three changes a person may make to it from the phone:
 * booking themselves onto a job, moving one of their own blocks, taking one
 * off. Each change is one request to Simpro, built exactly as the API
 * documents it, queued for the office and drawn on the calendar as queued
 * until the office has it.
 *
 * One rule shapes the changes: **only your own blocks move from the phone.**
 * The office books and moves everybody else, and a phone that could drag a
 * colleague's day about would be a phone the office could not trust the
 * calendar to. So a change names the employee it is for, and the send checks
 * the block still belongs to them before touching it.
 *
 * Pure: blocks and days in, layouts and requests out. The repository and the
 * screen hand in the rows and the clock.
 */

export const SCHEDULE_BOOK_KIND = 'schedule-book';
export const SCHEDULE_MOVE_KIND = 'schedule-move';
export const SCHEDULE_REMOVE_KIND = 'schedule-remove';
export const SCHEDULE_KINDS = [SCHEDULE_BOOK_KIND, SCHEDULE_MOVE_KIND, SCHEDULE_REMOVE_KIND] as const;
export type ScheduleChangeKind = (typeof SCHEDULE_KINDS)[number];

export function isScheduleKind(kind: string): kind is ScheduleChangeKind {
  return (SCHEDULE_KINDS as readonly string[]).includes(kind);
}

/**
 * How long a change waits on the phone before it goes, so a slip can be
 * taken back. A minute: long enough to notice the wrong day, short enough
 * that the office sees the booking while it still matters.
 */
export const SCHEDULE_UNDO_MS = 60_000;

/** The usual day: on site at seven, off at half past three. */
export const DEFAULT_START = '07:00';
export const DEFAULT_END = '15:30';

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is an HH:MM clock, 24 hour. */
export function isClock(s: string): boolean {
  return CLOCK.test(s.trim());
}

/** "7:00" and "0700" become "07:00"; anything that is not a clock comes back undefined. */
export function normaliseClock(s: string): string | undefined {
  const t = s.trim();
  if (CLOCK.test(t)) return t;
  const loose = /^(\d{1,2}):?(\d{2})$/.exec(t);
  if (!loose) return undefined;
  const hh = Number(loose[1]);
  const mm = Number(loose[2]);
  if (hh > 23 || mm > 59) return undefined;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A person as the day's columns know them: the employee list, or a name off a block. */
export interface SchedulePerson {
  id?: string;
  name: string;
}

export interface DayColumn {
  /** The employee id where the blocks or the staff list carry one. */
  staffId?: string;
  staffName: string;
  blocks: ScheduleEntry[];
}

/**
 * One day laid out by person, one column each, in name order.
 *
 * Everyone on the staff list gets a column, empty or not — a day with nobody
 * in the workshop column says something a list of blocks does not. A block
 * whose staff is not on the list still gets a column of its own, under the
 * name on the block, because the block is the office's word and the staff
 * list may be a sync behind. Blocks with nobody on them at all go last,
 * under "Unassigned".
 */
export function dayColumns(
  blocks: readonly ScheduleEntry[],
  day: string,
  people: readonly SchedulePerson[] = [],
): DayColumn[] {
  const byId = new Map<string, DayColumn>();
  const byName = new Map<string, DayColumn>();
  const columns: DayColumn[] = [];
  const column = (id: string | undefined, name: string | undefined): DayColumn => {
    if (id && byId.has(id)) return byId.get(id)!;
    const key = (name ?? '').trim().toLowerCase();
    if (!id && key && byName.has(key)) return byName.get(key)!;
    const col: DayColumn = { staffId: id, staffName: (name ?? '').trim() || (id ? `Employee ${id}` : 'Unassigned'), blocks: [] };
    if (id) byId.set(id, col);
    if (key) byName.set(key, col);
    columns.push(col);
    return col;
  };
  for (const p of people) column(p.id, p.name);
  for (const b of blocks) {
    if ((qldIsoDay(b.date) ?? b.date) !== day) continue;
    column(b.staffId, b.staffName).blocks.push(b);
  }
  for (const col of columns) col.blocks.sort(byTime);
  const unassigned = columns.filter((c) => !c.staffId && c.staffName === 'Unassigned');
  return [
    ...columns.filter((c) => !unassigned.includes(c)).sort((a, b) => a.staffName.localeCompare(b.staffName)),
    ...unassigned,
  ];
}

export interface Week {
  /** Monday. */
  start: string;
  /** Sunday. */
  end: string;
  days: string[];
}

/** The Monday-to-Sunday week a day falls in, as the payroll week already counts it. */
export function weekOf(day: string): Week {
  const start = weekStartOf(day);
  return { start, end: addDays(start, 6), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}

function byTime(a: ScheduleEntry, b: ScheduleEntry): number {
  const ta = a.startTime ?? '~';
  const tb = b.startTime ?? '~';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/** Where a block would go: a day and a span inside it. */
export interface Candidate {
  /** The block being moved, so it does not conflict with itself. */
  id?: string;
  date: string;
  start: string;
  end: string;
}

/**
 * The blocks of `mine` a candidate overlaps.
 *
 * Same day and the spans cross: a block ending at 12:00 and one starting at
 * 12:00 do not overlap, which is how the office books a morning and an
 * afternoon. A block with no times cannot be checked and is left out — the
 * office's all-day markers carry times on this build, so there is nothing
 * to guess at. A warning, not a refusal: Simpro takes a double booking, and
 * so does a technician who knows the second job is a ten-minute drop-in.
 */
export function conflicts(mine: readonly ScheduleEntry[], candidate: Candidate): ScheduleEntry[] {
  return mine.filter((b) => {
    if (candidate.id !== undefined && b.id === candidate.id) return false;
    if ((qldIsoDay(b.date) ?? b.date) !== candidate.date) return false;
    if (!b.startTime || !b.endTime) return false;
    return b.startTime < candidate.end && candidate.start < b.endTime;
  }).sort(byTime);
}

/** Why a day and span cannot be booked, in a word, or nothing when they can. */
export function spanProblem(c: { date: string; start: string; end: string }): string | undefined {
  if (!DAY.test(c.date) || !qldIsoDay(c.date)) return 'The date is yyyy-mm-dd.';
  if (!isClock(c.start) || !isClock(c.end)) return 'Times are HH:MM, 24 hour: 07:00, 15:30.';
  if (c.end <= c.start) return 'The block ends before it starts.';
  return undefined;
}

// ---------------------------------------------------------------------------
// The requests
// ---------------------------------------------------------------------------

/** A schedule block as the office's POST and PATCH take it. */
export interface BlockBody { StartTime: string; EndTime: string }

export interface BookRequest {
  method: 'POST';
  /** Relative to the company root, trailing slash: the cost centre's own collection. */
  path: string;
  body: { Staff: number; Date: string; Blocks: BlockBody[] };
}

export interface MoveRequest {
  method: 'PATCH';
  /** Relative to the company root, no trailing slash: the record itself. */
  path: string;
  body: { Date: string; Blocks: BlockBody[] };
}

export interface RemoveRequest {
  method: 'DELETE';
  path: string;
}

export interface BookingInput {
  employeeId: string;
  jobExternalId: string;
  sectionId: string;
  costCenterId: string;
  date: string;
  start: string;
  end: string;
}

/**
 * The POST that books a person onto a job: one schedule on the job's cost
 * centre, with one block. The same request the clock sends its hours as,
 * which is the one schedule POST tried on the live build.
 */
export function buildBooking(input: BookingInput): BookRequest {
  const problem = spanProblem(input);
  if (problem) throw new Error(`Cannot book this: ${problem}`);
  if (!/^\d+$/.test(input.employeeId.trim())) throw new Error('Cannot book this: no Simpro employee to book.');
  return {
    method: 'POST',
    path: `jobs/${input.jobExternalId}/sections/${input.sectionId}/costCenters/${input.costCenterId}/schedules/`,
    body: {
      Staff: Number(input.employeeId.trim()),
      Date: input.date,
      Blocks: [{ StartTime: input.start.trim(), EndTime: input.end.trim() }],
    },
  };
}

/**
 * The PATCH that moves a block: the record's own path, a new date and
 * blocks. Documented, not tried on the live build; the send says so where
 * the office refuses it, in the office's words.
 */
export function buildMove(href: string, date: string, start: string, end: string): MoveRequest {
  const problem = spanProblem({ date, start, end });
  if (problem) throw new Error(`Cannot move this: ${problem}`);
  const path = relativeSchedulePath(href);
  if (!path) throw new Error(`Cannot move this: "${href}" is not a job schedule path.`);
  return { method: 'PATCH', path, body: { Date: date, Blocks: [{ StartTime: start.trim(), EndTime: end.trim() }] } };
}

/** The DELETE that takes a block off. Documented, not tried on the live build. */
export function buildRemove(href: string): RemoveRequest {
  const path = relativeSchedulePath(href);
  if (!path) throw new Error(`Cannot remove this: "${href}" is not a job schedule path.`);
  return { method: 'DELETE', path };
}

const SCHEDULE_PATH = /jobs\/(\d+)\/sections\/(\d+)\/costCenters\/(\d+)\/schedules\/(\d+)\/?$/;

/**
 * A job schedule's path relative to the company root, from the href Simpro
 * hands out (`/api/v1.0/companies/0/jobs/…/schedules/12`) or from one
 * already relative. No trailing slash: the client's record paths have none.
 * Undefined for anything that is not a job schedule — an activity block
 * lives elsewhere, and this never guesses a path to send a DELETE to.
 */
export function relativeSchedulePath(href: string): string | undefined {
  const m = SCHEDULE_PATH.exec(href.trim());
  if (!m) return undefined;
  return `jobs/${m[1]}/sections/${m[2]}/costCenters/${m[3]}/schedules/${m[4]}`;
}

/** The ids inside a schedule href, where it is one. */
export function parseSchedulePath(href: string): { jobId: string; sectionId: string; costCenterId: string; scheduleId: string } | undefined {
  const m = SCHEDULE_PATH.exec(href.trim());
  if (!m) return undefined;
  return { jobId: m[1]!, sectionId: m[2]!, costCenterId: m[3]!, scheduleId: m[4]! };
}

/** The href for a schedule the phone has found the cost centre of. */
export function schedulePath(jobId: string, sectionId: string, costCenterId: string, scheduleId: string): string {
  return `jobs/${jobId}/sections/${sectionId}/costCenters/${costCenterId}/schedules/${scheduleId}`;
}

// ---------------------------------------------------------------------------
// The queue rows
// ---------------------------------------------------------------------------

/** A cost centre a block might be on, for a send that has to find the block's path first. */
export interface CostCentreRef { sectionId: string; costCenterId: string }

export interface BookPayload {
  employeeId: string;
  jobId: string;
  sectionId: string;
  costCenterId: string;
  date: string;
  start: string;
  end: string;
  /** For the calendar and Waiting to send; never sent. */
  siteName?: string;
  /** The instant before which the send answers "later", so the change can be taken back. */
  notBefore: string;
}

export interface MovePayload {
  employeeId: string;
  scheduleId: string;
  jobId?: string;
  /**
   * The block's own path where the phone holds it (from the timesheet the
   * office already lists this person's blocks in). Absent, the send finds
   * the block on one of `costCentres` by date.
   */
  href?: string;
  costCentres?: CostCentreRef[];
  date: string;
  start: string;
  end: string;
  /** Where it was, for the words and for drawing the old place as moving. */
  from: { date: string; start?: string; end?: string };
  siteName?: string;
  notBefore: string;
}

export interface RemovePayload {
  employeeId: string;
  scheduleId: string;
  jobId?: string;
  href?: string;
  costCentres?: CostCentreRef[];
  date: string;
  start?: string;
  end?: string;
  siteName?: string;
  notBefore: string;
}

export type ScheduleChangePayload =
  | { kind: typeof SCHEDULE_BOOK_KIND; payload: BookPayload }
  | { kind: typeof SCHEDULE_MOVE_KIND; payload: MovePayload }
  | { kind: typeof SCHEDULE_REMOVE_KIND; payload: RemovePayload };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * A queued payload read back, or the reason it cannot be sent.
 *
 * Read structurally rather than trusted: a row written by an older build,
 * or edited by hand, must be refused with words rather than sent with
 * undefined in the path.
 */
export function readScheduleChange(kind: string, payload: unknown): ScheduleChangePayload | { error: string } {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (!isScheduleKind(kind)) return { error: `"${kind}" is not a schedule change.` };
  if (!isStr(p.employeeId) || !/^\d+$/.test(p.employeeId.trim())) return { error: 'The change names no Simpro employee.' };
  if (!isStr(p.notBefore)) return { error: 'The change has no send time.' };
  // A send time that will not parse is never "held", so the row would go the
  // moment it was queued, with no minute to take it back.
  if (!Number.isFinite(Date.parse(p.notBefore))) return { error: `The change's send time "${p.notBefore}" will not read.` };
  if (kind === SCHEDULE_BOOK_KIND) {
    if (!isStr(p.jobId) || !isStr(p.sectionId) || !isStr(p.costCenterId)) return { error: 'The booking names no cost centre to go on.' };
    if (!isStr(p.date) || !isStr(p.start) || !isStr(p.end)) return { error: 'The booking has no day or times.' };
    const problem = spanProblem({ date: p.date, start: p.start, end: p.end });
    if (problem) return { error: problem };
    return { kind, payload: p as unknown as BookPayload };
  }
  if (!isStr(p.scheduleId)) return { error: 'The change names no schedule block.' };
  if (!isStr(p.href) && !(Array.isArray(p.costCentres) && p.costCentres.length)) {
    return { error: 'The block has no cost centre path on the phone, so it cannot be changed from here.' };
  }
  // A path that is not a job schedule's is refused here, not at the send: an
  // activity block's href would otherwise sit on the queue until the sender
  // threw on it.
  if (isStr(p.href) && !relativeSchedulePath(p.href)) {
    return { error: `The block's path "${p.href.trim()}" is not a job schedule path, so it cannot be changed from here.` };
  }
  if (!isStr(p.date)) return { error: 'The change has no day.' };
  if (kind === SCHEDULE_MOVE_KIND) {
    if (!isStr(p.start) || !isStr(p.end)) return { error: 'The move has no times.' };
    const problem = spanProblem({ date: p.date, start: p.start, end: p.end });
    if (problem) return { error: problem };
    return { kind, payload: p as unknown as MovePayload };
  }
  return { kind, payload: p as unknown as RemovePayload };
}

/**
 * The queue's content key for a change: the kind and what it does, not the
 * words around it.
 *
 * A booking is the same booking when it puts the same person on the same
 * cost centre at the same time, whichever screen queued it. A move is keyed
 * on the block and where it is going, so a second move of the same block to
 * a different time is a new row — and the first, still pending, is the one
 * to undo. A remove is the block: there is only one way to take it off.
 */
export function scheduleContentKey(change: ScheduleChangePayload): string {
  switch (change.kind) {
    case SCHEDULE_BOOK_KIND: {
      const p = change.payload;
      return `${change.kind}|${p.employeeId}|${p.jobId}/${p.sectionId}/${p.costCenterId}|${p.date}|${p.start}-${p.end}`;
    }
    case SCHEDULE_MOVE_KIND: {
      const p = change.payload;
      return `${change.kind}|${p.scheduleId}|${p.date}|${p.start}-${p.end}`;
    }
    case SCHEDULE_REMOVE_KIND:
      return `${change.kind}|${change.payload.scheduleId}`;
  }
}

/** The instant a change may go: now plus the undo window. */
export function notBeforeFrom(nowIso: string, undoMs = SCHEDULE_UNDO_MS): string {
  return new Date(Date.parse(nowIso) + undoMs).toISOString();
}

/** True while the change is still inside its undo window. */
export function heldForUndo(notBefore: string, nowIso: string): boolean {
  const at = Date.parse(notBefore);
  return Number.isFinite(at) && at > Date.parse(nowIso);
}

/**
 * One line naming a change for a person: "Book me on job 1001, 07:00–15:30,
 * 8 Sep". For the calendar's queued blocks and for Waiting to send, where a
 * queue row otherwise shows only its kind. A payload that will not read
 * still says what kind it was.
 */
export function describeScheduleChange(kind: string, payload: unknown): string {
  const read = readScheduleChange(kind, payload);
  if ('error' in read) return `${kindLabel(kind)} (${read.error})`;
  const p = read.payload;
  const job = p.jobId ? `job ${p.jobId}${p.siteName ? ` · ${p.siteName}` : ''}` : (p.siteName ?? 'a block');
  if (read.kind === SCHEDULE_BOOK_KIND) {
    return `Book me on ${job}, ${p.start}–${p.end}, ${shortDay(p.date)}`;
  }
  if (read.kind === SCHEDULE_MOVE_KIND) {
    const from = read.payload.from;
    const was = from.start && from.end ? `${from.start}–${from.end}, ${shortDay(from.date)}` : shortDay(from.date);
    return `Move my block on ${job} from ${was} to ${p.start}–${p.end}, ${shortDay(p.date)}`;
  }
  const times = p.start && p.end ? `${p.start}–${p.end}, ` : '';
  return `Take me off ${job}, ${times}${shortDay(p.date)}`;
}

function kindLabel(kind: string): string {
  if (kind === SCHEDULE_BOOK_KIND) return 'Booking';
  if (kind === SCHEDULE_MOVE_KIND) return 'Move';
  if (kind === SCHEDULE_REMOVE_KIND) return 'Remove';
  return kind;
}

// ---------------------------------------------------------------------------
// Whose block
// ---------------------------------------------------------------------------

export type ChangeAllowed = { ok: true } | { ok: false; why: string };

/**
 * Whether a block may be moved or removed from this phone.
 *
 * Yours, by employee id: the office moves everyone else's. A block with no
 * staff on it is nobody's from the phone. And only a job block — leave,
 * training and the other activity blocks live on another path the phone
 * does not change; the office does those.
 */
export function canChangeFromPhone(block: ScheduleEntry, employeeId: string): ChangeAllowed {
  const me = employeeId.trim();
  if (!me) return { ok: false, why: 'This phone does not know who you are in Simpro yet.' };
  if (!block.staffId) return { ok: false, why: 'This block has nobody on it; the office decides those.' };
  if (block.staffId !== me) return { ok: false, why: `This block is ${block.staffName ?? 'somebody else'}'s. The office moves other people's blocks.` };
  if (block.type && block.type.trim().toLowerCase() !== 'job') {
    return { ok: false, why: `${block.type} blocks are changed in Simpro, not from the phone.` };
  }
  return { ok: true };
}

/** Whether a listed record is still this person's, for the send's own check. */
export function recordIsMine(record: ScheduleRecord, employeeId: string): boolean {
  return String(record.Staff?.ID ?? '') === employeeId.trim();
}

/** Whether a record already sits where a move would put it: nothing to send. */
export function recordAlreadyAt(record: ScheduleRecord, date: string, start: string, end: string): boolean {
  if (String(record.Date ?? '') !== date) return false;
  const blocks = record.Blocks ?? [];
  return blocks.length === 1 && blocks[0]!.StartTime === start && blocks[0]!.EndTime === end;
}

/** The id of the schedule in a cost centre's day that is this block, or none. */
export function findScheduleIn(records: readonly ScheduleRecord[], scheduleId: string): boolean {
  return records.some((r) => r.ID !== undefined && r.ID !== null && String(r.ID) === scheduleId);
}

/** The read-before-write for a booking, the clock's rule reused: same staff, same date, same block. */
export { findAcceptedSchedule };

// ---------------------------------------------------------------------------
// Drawing what is queued
// ---------------------------------------------------------------------------

/**
 * Where a change is on the queue. `sending` is a row a run has claimed —
 * seconds, usually; `sent` is one the office has, kept on the calendar
 * until the next read of the office's blocks shows it there, so a booking
 * does not vanish for the half hour between the send and the sync.
 */
export type PendingState = 'pending' | 'sending' | 'sent' | 'unknown' | 'failed';

/** A queued change as the calendar draws it. */
export interface PendingScheduleChange {
  /** The queue row, which is what undo deletes. */
  queueRowId: string;
  kind: ScheduleChangeKind;
  payload: BookPayload | MovePayload | RemovePayload;
  state: PendingState;
  lastError?: string;
  createdAt: string;
}

/** A block on the calendar, with what the phone has queued against it. */
export interface CalendarBlock extends ScheduleEntry {
  /** What is queued: a booking not yet sent, a move, a removal. Absent for the office's own block. */
  pending?: ScheduleChangeKind;
  pendingState?: PendingState;
  pendingError?: string;
  queueRowId?: string;
  /** For a move: where the office still has it. */
  movedFrom?: { date: string; start?: string; end?: string };
}

/**
 * The office's blocks with the phone's queued changes drawn over them.
 *
 * A booking not yet sent is a block of its own, marked queued, so the day
 * shows what was just done rather than nothing until the next sync. A move
 * puts the block where it is going and remembers where it was; a removal
 * leaves the block in place, marked, because until the office has taken it
 * the block is still where the office expects the person to be. The
 * office's own row wins once the sync has it: a booking the office holds
 * at the same place is not drawn twice, and a sent change whose block the
 * office now shows at the destination, or no longer lists, leaves no mark.
 */
export function mergePending(
  blocks: readonly ScheduleEntry[],
  pending: readonly PendingScheduleChange[],
  people: readonly SchedulePerson[] = [],
): CalendarBlock[] {
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name;
  const out: CalendarBlock[] = blocks.map((b) => ({ ...b }));
  for (const change of pending) {
    const p = change.payload;
    const mark = { pending: change.kind, pendingState: change.state, pendingError: change.lastError, queueRowId: change.queueRowId };
    if (change.kind === SCHEDULE_BOOK_KIND) {
      const book = p as BookPayload;
      const samePlace = (b: CalendarBlock) => b.staffId === book.employeeId && b.date === book.date
        && b.startTime === book.start && b.endTime === book.end && (b.jobId ?? '') === book.jobId;
      if (out.some((b) => samePlace(b) && !b.pending)) continue;
      // The same booking queued again after the first was sent — the office
      // took it off and the person put it back — is one block, the newer row.
      const earlier = out.findIndex((b) => samePlace(b) && b.pending === SCHEDULE_BOOK_KIND);
      if (earlier >= 0) out.splice(earlier, 1);
      out.push({
        id: `queued-${change.queueRowId}`, jobId: book.jobId, staffId: book.employeeId, staffName: nameOf(book.employeeId),
        date: book.date, startTime: book.start, endTime: book.end, type: 'Job', ...mark,
      });
      continue;
    }
    const target = out.find((b) => b.id === (p as MovePayload | RemovePayload).scheduleId);
    if (!target) continue;
    if (change.kind === SCHEDULE_MOVE_KIND) {
      const move = p as MovePayload;
      // The office already has it there: the sync caught up and the row is on its way out.
      if (target.date === move.date && target.startTime === move.start && target.endTime === move.end) continue;
      Object.assign(target, mark, { movedFrom: { date: target.date, start: target.startTime, end: target.endTime }, date: move.date, startTime: move.start, endTime: move.end });
    } else {
      Object.assign(target, mark);
    }
  }
  return out;
}

/** A calendar block's own span, as a candidate for the conflict check. */
export function asCandidate(block: ScheduleEntry): Candidate | undefined {
  if (!block.startTime || !block.endTime) return undefined;
  return { id: block.id, date: block.date, start: block.startTime, end: block.endTime };
}
