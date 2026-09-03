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
  /**
   * Things that happened on the entry that are not hours: a call-out, travel,
   * a meal allowance, being on call. Free labels rather than fixed columns,
   * because every crew has a different list and payroll reads them as words
   * either way. Absent on sheets saved by older builds; see hydrateEntry.
   */
  extras?: string[];
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
  // Built on UTC so a date-only string reads as the same weekday on every
  // device, rather than shifting on a phone east or west of Greenwich.
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : (DAY_NAMES[d.getUTCDay()] ?? '');
}

/** The seven ISO dates of the week beginning on the given date. */
export function weekDates(weekStarting: string): string[] {
  // All UTC. The old version built the start date at local midnight and then
  // read the days back with toISOString(), which is UTC — so on a Brisbane
  // phone every date on the sheet came out a day early. A timesheet is a
  // calendar of days, not instants, so it is computed in one zone throughout.
  const start = new Date(`${weekStarting}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
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
      extras: [...(e.extras ?? [])],
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

// ---------------------------------------------------------------------------
// The simple view of an entry
//
// Payroll's sheet has five leave columns and three hour columns, and the first
// version of the screen showed all eight on every row. Nobody has a day that
// is both annual leave and overtime. So the screen thinks in two shapes — a
// job with hours, or a day off of one kind — and these helpers translate.
// ---------------------------------------------------------------------------

export const LEAVE_LABEL: Record<LeaveKind, string> = {
  annual: 'Annual leave',
  sick: 'Sick',
  rdo: 'RDO',
  publicHoliday: 'Public holiday',
  lwop: 'Unpaid leave',
};

export const LEAVE_KINDS: readonly LeaveKind[] = ['annual', 'sick', 'rdo', 'publicHoliday', 'lwop'];

/** A standard day, for a day off. */
export const STANDARD_DAY_HOURS = 7.6;

/** The leave on an entry, if it is a day off rather than a job. */
export function leaveOf(entry: TimesheetEntry): { kind: LeaveKind; hours: number } | null {
  for (const kind of LEAVE_KINDS) {
    const v = parseFloat(entry[kind]);
    if (Number.isFinite(v) && v > 0) return { kind, hours: v };
  }
  return null;
}

/** Makes an entry a day off of one kind, clearing every other leave column and the times. */
export function setLeave(entry: TimesheetEntry, kind: LeaveKind, hours: number): TimesheetEntry {
  const next: TimesheetEntry = {
    ...entry,
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '',
    startTime: '', finishTime: '', hoursOverride: undefined,
  };
  next[kind] = hours > 0 ? String(hours) : '';
  return next;
}

/** A blank entry for a date, shaped so every text field is a string. */
export function blankEntry(id: string, date: string): TimesheetEntry {
  return {
    id, date,
    jobNumber: '', siteName: '', serviceReportNumber: '',
    startTime: '', finishTime: '', hourKind: 'ord',
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '',
    comments: '', extras: [],
  };
}

/**
 * The extras a technician can tick without typing.
 *
 * A starting list, not the list: the screen lets anyone add a label, and the
 * ones they add are offered again next time.
 */
export const DEFAULT_EXTRAS: readonly string[] = [
  'Call-out', 'Travel', 'Meal allowance', 'On call', 'Site allowance',
];

/** Toggles a label on an entry, preserving order of first use. */
export function toggleExtra(entry: TimesheetEntry, label: string): TimesheetEntry {
  const current = entry.extras ?? [];
  const clean = label.trim();
  if (!clean) return entry;
  const has = current.some((x) => x.toLowerCase() === clean.toLowerCase());
  return {
    ...entry,
    extras: has ? current.filter((x) => x.toLowerCase() !== clean.toLowerCase()) : [...current, clean],
  };
}

/** Worked hours on a date, leave excluded. */
export function dayWorkedHours(entries: TimesheetEntry[], date: string): number {
  const total = entries.filter((e) => e.date === date).reduce((n, e) => n + entryHours(e), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Yesterday's shape, on today.
 *
 * The same rule as copying a week: jobs, sites, times, the ordinary/overtime
 * choice and the extras carry over, because that is the shape of the day.
 * The service report number, the comments and any leave do not, because each
 * of those asserts something happened, and it has not happened yet today.
 */
export function copyDay(
  entries: TimesheetEntry[], fromDate: string, toDate: string, newId: () => string,
): TimesheetEntry[] {
  return entries
    .filter((e) => e.date === fromDate && !leaveOf(e))
    .map((e) => ({
      ...blankEntry(newId(), toDate),
      jobNumber: e.jobNumber,
      siteName: e.siteName,
      siteId: e.siteId,
      startTime: e.startTime,
      finishTime: e.finishTime,
      hourKind: e.hourKind,
      extras: [...(e.extras ?? [])],
    }));
}

/** The nearest earlier date in the week that has at least one entry, or null. */
export function previousDayWithEntries(entries: TimesheetEntry[], date: string): string | null {
  const dates = [...new Set(entries.map((e) => e.date))].filter((d) => d < date).sort();
  return dates.length ? dates[dates.length - 1]! : null;
}

export interface JobOption {
  jobNumber: string;
  siteName: string;
  siteId?: string;
  /** The client, where the office knows it: Simpro's own search leads with it. */
  customerName?: string;
  /** Where the option came from, so the list can say. */
  source: 'recent' | 'simpro';
}

/**
 * The jobs offered when adding an entry.
 *
 * What the technician typed on recent sheets comes first, most recent first,
 * because the job they are on this week is very likely the job they were on
 * last week. The office's open jobs follow. Deduplicated on the job number,
 * or on the site name where there is no number.
 */
export function jobOptions(
  recentSheets: Timesheet[],
  simproJobs: { externalId?: string; siteName: string; siteId?: string; status: string; customerName?: string }[],
  limit = 200,
): JobOption[] {
  const out: JobOption[] = [];
  const seen = new Set<string>();
  const keyOf = (jobNumber: string, siteName: string) =>
    (jobNumber.trim() || `site:${siteName.trim().toLowerCase()}`);

  const sheets = [...recentSheets].sort((a, b) => b.weekStarting.localeCompare(a.weekStarting));
  for (const sheet of sheets) {
    const entries = [...sheet.entries].sort((a, b) => b.date.localeCompare(a.date));
    for (const e of entries) {
      if (leaveOf(e)) continue;
      if (!e.jobNumber.trim() && !e.siteName.trim()) continue;
      const key = keyOf(e.jobNumber, e.siteName);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ jobNumber: e.jobNumber.trim(), siteName: e.siteName.trim(), siteId: e.siteId, source: 'recent' });
    }
  }
  for (const j of simproJobs) {
    if (j.status === 'complete') continue;
    const number = (j.externalId ?? '').trim();
    if (!number) continue;
    const key = keyOf(number, j.siteName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ jobNumber: number, siteName: j.siteName, siteId: j.siteId, customerName: j.customerName, source: 'simpro' });
  }
  return out.slice(0, limit);
}

/** Case-insensitive filter of job options by number or site. */
/**
 * Narrowing the offered list to what was typed.
 *
 * Matches the client as well as the job number and the site, because that is
 * what a technician types: they know they were at the YMCA, not that it was
 * job 44432. Only ever used on the handful of options the screen already
 * holds — searching the whole book is the database's job, not this one's.
 */
export function filterJobOptions(options: JobOption[], query: string): JobOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => (
    o.jobNumber.toLowerCase().includes(q)
    || o.siteName.toLowerCase().includes(q)
    || (o.customerName ?? '').toLowerCase().includes(q)
  ));
}

/**
 * One list from two sources, without the same job twice.
 *
 * The days a person has already worked come from their own timesheets and the
 * rest from the office's jobs; a job in both is theirs, and keeps the "you
 * worked this recently" line that makes it recognisable.
 */
export function mergeJobOptions(recent: JobOption[], found: JobOption[], limit = 60): JobOption[] {
  const out: JobOption[] = [];
  const seen = new Set<string>();
  for (const option of [...recent, ...found]) {
    const key = option.jobNumber.trim() || `site:${option.siteName.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The start and finish this technician usually works.
 *
 * The most common pair on recent sheets, so a new entry opens with the right
 * times already in it and most days are a tap rather than four digits twice.
 * Falls back to the company's ordinary day.
 */
export function usualTimes(recentSheets: Timesheet[]): { start: string; finish: string } {
  const counts = new Map<string, number>();
  for (const sheet of recentSheets) {
    for (const e of sheet.entries) {
      if (!e.startTime.trim() || !e.finishTime.trim() || parseTime(e.startTime) === null || parseTime(e.finishTime) === null) continue;
      const key = `${e.startTime.trim()}|${e.finishTime.trim()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount) { best = key; bestCount = n; }
  }
  if (!best) return { start: '06:30', finish: '14:30' };
  const [start, finish] = best.split('|');
  return { start: start!, finish: finish! };
}

/**
 * Every text field on an entry, so a sheet written by an older build still
 * loads with all of them present.
 *
 * The entries column is JSON and is read back with a cast, which asserts a
 * shape rather than checking one. A field added later is simply absent from
 * every row already saved, and `undefined` bound into a text input turns a
 * controlled field uncontrolled — the box silently stops accepting what is
 * typed into it. Lives here rather than in the repository so it can be tested
 * without a database.
 */
const ENTRY_TEXT_FIELDS = [
  'date', 'jobNumber', 'siteName', 'serviceReportNumber', 'startTime', 'finishTime',
  'sick', 'rdo', 'annual', 'lwop', 'publicHoliday', 'comments',
] as const;

export function hydrateEntry(raw: Partial<TimesheetEntry>, newId: () => string): TimesheetEntry {
  const entry = { ...raw } as Record<string, unknown>;
  for (const field of ENTRY_TEXT_FIELDS) {
    if (typeof entry[field] !== 'string') entry[field] = '';
  }
  if (entry.hourKind !== 'ord' && entry.hourKind !== 'ot' && entry.hourKind !== 'dt') {
    entry.hourKind = 'ord';
  }
  if (!Array.isArray(entry.extras)) entry.extras = [];
  else entry.extras = (entry.extras as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (typeof entry.id !== 'string' || !entry.id) entry.id = newId();
  return entry as unknown as TimesheetEntry;
}
