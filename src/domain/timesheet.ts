/**
 * Safe QLD weekly timesheet.
 *
 * Mirrors the company timesheet: a week of day rows carrying job number, site,
 * service report number, start and finish times, ordinary/overtime/double time
 * hours, leave columns and comments, then weekly totals and sign off.
 *
 * Hours are derived from start and finish rather than typed, because that is
 * the part people get wrong and the part the office queries.
 */

/**
 * `publicHoliday` is paid time not worked, like the others, but it is not leave
 * the employee elected to take and it is not deducted from any balance. It sits
 * here because the timesheet totals it the same way, not because it is leave.
 */
export type LeaveKind = 'sick' | 'rdo' | 'annual' | 'lwop' | 'publicHoliday';

export type HourKind = 'ord' | 'ot' | 'dt';

export interface TimesheetEntry {
  id: string;
  /** ISO date. */
  date: string;
  jobNumber: string;
  siteName: string;
  /** Link back to a site in the app, when the entry was picked rather than typed. */
  siteId?: string;
  serviceReportNumber: string;
  /** "HH:MM", 24 hour. */
  startTime: string;
  finishTime: string;
  /** Which bucket the worked hours fall into. */
  hourKind: HourKind;
  /** Manual override of the derived hours; blank means use the derived figure. */
  hoursOverride?: string;
  sick: string;
  rdo: string;
  annual: string;
  lwop: string;
  /** Hours paid for a public holiday not worked. */
  publicHoliday: string;
  comments: string;
}

export interface Timesheet {
  id: string;
  employeeName: string;
  vehicleRego: string;
  kilometerReading: string;
  /** ISO date of the first day of the week the sheet covers. */
  weekStarting: string;
  entries: TimesheetEntry[];
  employeeSignature?: string;
  managerName: string;
  checkedBy: string;
  status: 'draft' | 'submitted';
  createdAt: string;
  updatedAt: string;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** Parses "HH:MM" to minutes since midnight, or null when unparseable. */
export function parseTime(s: string): number | null {
  const m = s.trim().match(HHMM);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Hours worked between start and finish.
 *
 * A finish earlier than the start is treated as running past midnight, which
 * happens often enough on after-hours cutovers to be worth handling rather than
 * returning a negative.
 */
export function entryHours(entry: TimesheetEntry): number {
  if (entry.hoursOverride?.trim()) {
    const v = parseFloat(entry.hoursOverride);
    return Number.isFinite(v) ? v : 0;
  }
  const start = parseTime(entry.startTime);
  const finish = parseTime(entry.finishTime);
  if (start === null || finish === null) return 0;
  const span = finish >= start ? finish - start : finish + 24 * 60 - start;
  return Math.round((span / 60) * 100) / 100;
}

export interface TimesheetTotals {
  ord: number;
  ot: number;
  dt: number;
  sick: number;
  rdo: number;
  annual: number;
  lwop: number;
  publicHoliday: number;
  /** Worked hours only — ordinary plus overtime plus double time. */
  worked: number;
  /** Worked hours plus every leave category. */
  grand: number;
}

function num(s: string): number {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

export function timesheetTotals(sheet: Timesheet): TimesheetTotals {
  const t: TimesheetTotals = { ord: 0, ot: 0, dt: 0, sick: 0, rdo: 0, annual: 0, lwop: 0, publicHoliday: 0, worked: 0, grand: 0 };
  for (const e of sheet.entries) {
    const h = entryHours(e);
    t[e.hourKind] += h;
    t.sick += num(e.sick);
    t.rdo += num(e.rdo);
    t.annual += num(e.annual);
    t.lwop += num(e.lwop);
    t.publicHoliday += num(e.publicHoliday);
  }
  t.worked = t.ord + t.ot + t.dt;
  t.grand = t.worked + t.sick + t.rdo + t.annual + t.lwop + t.publicHoliday;
  for (const k of Object.keys(t) as (keyof TimesheetTotals)[]) {
    t[k] = Math.round(t[k] * 100) / 100;
  }
  return t;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short weekday name for an ISO date, as the sheet prints it. */
export function dayName(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : (DAY_NAMES[d.getDay()] ?? '');
}

/** The seven ISO dates of the week beginning on the given date. */
export function weekDates(weekStarting: string): string[] {
  const start = new Date(`${weekStarting}T00:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Entries grouped by date, in date order, for rendering day blocks. */
export function groupByDate(entries: TimesheetEntry[]): { date: string; entries: TimesheetEntry[] }[] {
  const map = new Map<string, TimesheetEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, es]) => ({ date, entries: es }));
}

export interface TimesheetIssue {
  entryId?: string;
  message: string;
}

/**
 * Checks the sheet for the things the office sends back.
 *
 * Reporting these on the phone before submission is the whole point — a query
 * a week later costs far more than a warning now.
 */
export function validateTimesheet(sheet: Timesheet): TimesheetIssue[] {
  const issues: TimesheetIssue[] = [];

  if (!sheet.employeeName.trim()) issues.push({ message: 'Employee name is blank.' });

  for (const e of sheet.entries) {
    const hasTimes = !!e.startTime.trim() && !!e.finishTime.trim();
    const hasLeave = [e.sick, e.rdo, e.annual, e.lwop, e.publicHoliday].some((v) => num(v) > 0);

    if (!hasTimes && !hasLeave && !e.hoursOverride?.trim()) {
      issues.push({ entryId: e.id, message: `${e.date}: no times, hours or leave recorded.` });
      continue;
    }

    if (e.startTime.trim() && parseTime(e.startTime) === null) {
      issues.push({ entryId: e.id, message: `${e.date}: start time "${e.startTime}" is not in HH:MM.` });
    }
    if (e.finishTime.trim() && parseTime(e.finishTime) === null) {
      issues.push({ entryId: e.id, message: `${e.date}: finish time "${e.finishTime}" is not in HH:MM.` });
    }

    const hours = entryHours(e);
    if (hours > 16) {
      issues.push({ entryId: e.id, message: `${e.date}: ${hours} hours in one entry — check the times.` });
    }
    if (hasTimes && hours === 0) {
      issues.push({ entryId: e.id, message: `${e.date}: start and finish are the same.` });
    }
    if (hasTimes && !e.siteName.trim() && !hasLeave) {
      issues.push({ entryId: e.id, message: `${e.date}: hours recorded with no job or site name.` });
    }
  }

  return issues;
}

/**
 * Last week's shape, ready to be this week's sheet.
 *
 * Most weeks are the same shape: the same run of sites on the same days at
 * roughly the same hours. Retyping that from scratch every Monday is how
 * timesheets end up reconstructed on Friday from memory, which is when the
 * hours stop being accurate.
 *
 * What carries over is the SHAPE — days, jobs, sites, usual start and finish.
 * What never carries over is anything that asserts something happened:
 *
 *  - leave, sick, RDO, public holiday. Copying last week's annual leave into
 *    this week claims a day off nobody took.
 *  - the service report number, which belongs to one visit and one only.
 *  - comments, which described last week's work.
 *
 * Dates are advanced by exactly seven days so a Tuesday stays a Tuesday.
 */
export function copyForNextWeek(previous: Timesheet, weekStarting: string, newId: () => string): TimesheetEntry[] {
  const shift = Date.parse(`${weekStarting}T00:00:00Z`) - Date.parse(`${previous.weekStarting}T00:00:00Z`);
  if (!Number.isFinite(shift)) return [];

  return previous.entries.map((e) => {
    const then = Date.parse(`${e.date}T00:00:00Z`);
    const date = Number.isFinite(then)
      ? new Date(then + shift).toISOString().slice(0, 10)
      : e.date;
    return {
      id: newId(),
      date,
      jobNumber: e.jobNumber,
      siteName: e.siteName,
      siteId: e.siteId,
      startTime: e.startTime,
      finishTime: e.finishTime,
      hourKind: e.hourKind,
      // Everything below asserts something happened. None of it did, yet.
      serviceReportNumber: '',
      hoursOverride: undefined,
      sick: '',
      rdo: '',
      annual: '',
      lwop: '',
      publicHoliday: '',
      comments: '',
    };
  });
}
