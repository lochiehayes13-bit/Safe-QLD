import { qldIsoDay } from './qldTime';

/**
 * A technician's own day, out of the office's schedule.
 *
 * The sync holds every schedule block in a window around today, for every
 * member of staff. This picks out the ones that belong to the person holding
 * the phone and lays them out the way they are asked about: what is on
 * today, what is on tomorrow, and what is further out. Pure, so the rules
 * about which day a block falls on — the ones that go wrong before ten in the
 * morning — are tested rather than trusted.
 */

/** How far either side of today the sync reads schedules. A week back, three weeks ahead. */
export const SCHEDULE_DAYS_BACK = 7;
export const SCHEDULE_DAYS_AHEAD = 21;

const DAY_MS = 86_400_000;

/** A calendar day moved by whole days. Date-only in, date-only out. */
export function addDays(day: string, n: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return new Date(ms + n * DAY_MS).toISOString().slice(0, 10);
}

export interface ScheduleWindow {
  today: string;
  tomorrow: string;
  from: string;
  to: string;
}

/**
 * The days the schedule sync covers, counted from the Queensland day.
 *
 * Counted from the Queensland day and not the UTC one, because at half past
 * seven on a Brisbane morning the UTC day is still yesterday — and a window
 * anchored there would call this morning's first job "tomorrow" until ten.
 */
export function scheduleWindow(nowIso: string): ScheduleWindow {
  const today = qldIsoDay(nowIso);
  if (!today) throw new Error(`Cannot read the day out of "${nowIso}".`);
  return {
    today,
    tomorrow: addDays(today, 1),
    from: addDays(today, -SCHEDULE_DAYS_BACK),
    to: addDays(today, SCHEDULE_DAYS_AHEAD),
  };
}

/** A schedule block as the sync stores it. Times are Simpro's own clock strings, e.g. "07:30". */
export interface ScheduleEntry {
  id: string;
  jobId?: string;
  staffId?: string;
  staffName?: string;
  /** The calendar day Simpro scheduled it on, yyyy-mm-dd. */
  date: string;
  startTime?: string;
  endTime?: string;
  type?: string;
}

/** The little a day view needs to know about a job held on the device. */
export interface HeldJob {
  id: string;
  externalId?: string;
  siteName: string;
  title: string;
  address?: string;
}

export interface MyDayRow {
  schedule: ScheduleEntry;
  /** The job on this device, where the sync has it. Absent means the number is all there is to show. */
  job?: HeldJob;
}

export interface MyDayGroups {
  today: MyDayRow[];
  tomorrow: MyDayRow[];
  later: MyDayRow[];
  /** Days already gone, still inside the synced window. Kept so a missed block is visible, not silently dropped. */
  earlier: MyDayRow[];
  todayIso: string;
}

/**
 * Lays schedule blocks out by day, each with its job where the phone has it.
 *
 * A block whose job is not held locally still lists. The schedule is the
 * office's statement of where this person should be, and dropping a row
 * because the job sync has not caught up would hide exactly the appointment
 * they most need to know about.
 */
export function groupScheduleByDay(
  rows: readonly ScheduleEntry[],
  nowIso: string,
  jobs: readonly HeldJob[],
): MyDayGroups {
  const { today, tomorrow } = scheduleWindow(nowIso);

  // Two ways to find a job: the external id the sync stamps, and the local
  // id it derives from the same number. Either alone would be enough today;
  // both are checked so a job added by hand with the office number still joins.
  const byExternal = new Map<string, HeldJob>();
  const byLocal = new Map<string, HeldJob>();
  for (const job of jobs) {
    if (job.externalId) byExternal.set(job.externalId, job);
    byLocal.set(job.id, job);
  }

  const groups: MyDayGroups = { today: [], tomorrow: [], later: [], earlier: [], todayIso: today };
  for (const schedule of [...rows].sort(byDayThenTime)) {
    const job = schedule.jobId
      ? (byExternal.get(schedule.jobId) ?? byLocal.get(`simpro-${schedule.jobId}`))
      : undefined;
    const row: MyDayRow = job ? { schedule, job } : { schedule };
    // Simpro's schedule date is already a calendar day; qldIsoDay leaves it be
    // and only steps in if a full instant ever arrives in the field.
    const day = qldIsoDay(schedule.date) ?? schedule.date;
    if (day === today) groups.today.push(row);
    else if (day === tomorrow) groups.tomorrow.push(row);
    else if (day < today) groups.earlier.push(row);
    else groups.later.push(row);
  }
  return groups;
}

function byDayThenTime(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  // Blocks with no start time sort after the timed ones, not among them.
  const ta = a.startTime ?? '~';
  const tb = b.startTime ?? '~';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The preferences that say who this phone belongs to. A structural subset of Prefs. */
export interface WhoPrefs {
  simproEmployeeId: string;
  technicianName: string;
}

export type WhoseSchedule =
  | { by: 'id'; staffId: string; label: string }
  | { by: 'name'; staffName: string; label: string };

/**
 * How to pick this person's blocks out of everyone's.
 *
 * By employee id when one has been chosen or signed in, because the id is the
 * office's own key and survives a rename. By the display name otherwise,
 * which works on every phone that has had a name typed into Settings and is
 * the whole of what the app knew about its holder before this. Null when
 * there is neither — the screen then says so and points at the picker rather
 * than showing an empty day as though nothing were on.
 */
export function whoseSchedule(prefs: WhoPrefs): WhoseSchedule | null {
  const id = prefs.simproEmployeeId.trim();
  const name = prefs.technicianName.trim();
  if (id) return { by: 'id', staffId: id, label: name ? `${name} (employee ${id})` : `employee ${id}` };
  if (name) return { by: 'name', staffName: name, label: `the name "${name}"` };
  return null;
}
