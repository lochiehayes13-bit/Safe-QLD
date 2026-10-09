import {
  STANDARD_DAY_HOURS, blankEntry, dayName, setLeave,
  type HourKind, type LeaveKind, type Timesheet, type TimesheetEntry,
} from './timesheet';
import { LEAVE_KINDS as BOOKABLE_LEAVE, type LeaveKindId } from './leaveBooking';
import type { ScheduleEntry } from './myDay';

/**
 * Filling a week of timesheet from the person's own Simpro schedule.
 *
 * A construction crew's week is already on the office's schedule, job by job
 * and hour by hour, and was typed again on Friday from memory. This turns the
 * blocks the device has synced into timesheet entries, so the week is one tap
 * and a check rather than thirty fields. Service technicians, whose day is
 * rarely what was scheduled, keep filling theirs by hand; they choose.
 *
 * Nothing here overwrites: a day that already has anything on it is left as
 * it is, so a fill can be run again after a sync without undoing a correction.
 */

/** How a person's weeks are filled: from their schedule, or typed. Empty until they say. */
export type TimesheetFill = 'schedule' | 'manual';

/**
 * A first guess at which kind of worker someone is, from their Simpro position.
 *
 * Only a guess, used to suggest an answer the person then confirms: positions
 * are typed by the office and read however the office reads them.
 */
export function fillFromPosition(position: string | undefined): TimesheetFill | undefined {
  const p = position?.toLowerCase() ?? '';
  if (!p.trim()) return undefined;
  if (/construct|install|project|fitter|foreman|labour/.test(p)) return 'schedule';
  if (/service|maint|inspect|technician/.test(p)) return 'manual';
  return undefined;
}

/**
 * How this person's weeks are filled, from what they have already told the app.
 *
 * Their own answer first. Then the trade they picked in Settings, which is the
 * same question asked another way: a construction phone fills from the
 * schedule, a service phone is typed. Undefined where neither says, which is
 * when the timesheet asks.
 */
export function fillModeFor(prefs: { timesheetFill: '' | TimesheetFill; tradeStream: string }): TimesheetFill | undefined {
  if (prefs.timesheetFill) return prefs.timesheetFill;
  if (prefs.tradeStream === 'construction') return 'schedule';
  if (prefs.tradeStream === 'service') return 'manual';
  return undefined;
}

/**
 * Whether opening a week fills its empty days by itself.
 *
 * Only for someone filling from the schedule, and only a draft. Which days is
 * decided per day: up to today, empty, and never filled before (see
 * `entriesFromSchedule`'s `skip`), so a day somebody cleared stays cleared.
 */
export function fillsOnOpen(sheet: Pick<Timesheet, 'status'>, mode: TimesheetFill | undefined): boolean {
  return mode === 'schedule' && sheet.status === 'draft';
}

/**
 * The days a phone has filled from the schedule, kept so a day is filled once.
 *
 * Held as dates rather than per sheet because a person has one sheet a week.
 * Anything older than ten weeks is dropped: no draft lives that long.
 */
export function rememberFilled(previous: readonly string[], filled: readonly string[], today: string): string[] {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - 70 * 86_400_000;
  const keep = new Set<string>();
  for (const d of [...previous, ...filled]) {
    const ms = Date.parse(`${d}T00:00:00Z`);
    if (Number.isFinite(ms) && ms >= cutoff) keep.add(d);
  }
  return [...keep].sort();
}

/** One block of work or activity, from whichever source the device holds. */
export interface WorkBlock {
  date: string;
  jobId?: string;
  /** The activity's name, for a block that is not on a job, where it is known. */
  activityName?: string;
  startTime?: string;
  endTime?: string;
  /** Hours Simpro puts on the block, used where there are no times. */
  hours?: number;
  /** Simpro's schedule rate, e.g. "Overtime". */
  rateName?: string;
}

/**
 * Blocks from the person's own Simpro timesheet, one row per block.
 *
 * The better source: each block is its own row, so a split day keeps its
 * lunch gap, and the rate is named.
 */
export function blocksFromTimesheet(
  rows: readonly {
    date: string; jobId?: string; activityId?: string; startTime?: string; endTime?: string;
    totalHours?: number; scheduleRateName?: string;
  }[],
  activityNames: ReadonlyMap<string, string>,
): WorkBlock[] {
  return rows.map((r) => ({
    date: r.date,
    jobId: r.jobId || undefined,
    activityName: r.jobId ? undefined : (r.activityId ? activityNames.get(r.activityId) : undefined),
    startTime: r.startTime,
    endTime: r.endTime,
    hours: r.totalHours,
    rateName: r.scheduleRateName,
  }));
}

/** Blocks from the office's schedule, where the person's own timesheet has none. */
export function blocksFromSchedule(rows: readonly ScheduleEntry[]): WorkBlock[] {
  return rows.map((r) => ({ date: r.date, jobId: r.jobId || undefined, startTime: r.startTime, endTime: r.endTime }));
}

/** "07:00" out of the times Simpro writes ("7:00", "07:00:00"), or blank when there is none. */
function hhmm(time: string | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time?.trim() ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** The bucket a Simpro schedule rate's hours go in. Ordinary unless the name says otherwise. */
export function rateKind(rateName: string | undefined): HourKind {
  const n = rateName?.toLowerCase() ?? '';
  if (/double|(^|[^\d.])x?\s*2\.0(?!\d)|\bx\s*2(?![\d.])/.test(n)) return 'dt';
  if (/overtime|time and a half|(^|[^\d.])1\.5(?!\d)/.test(n)) return 'ot';
  return 'ord';
}

const SHEET_COLUMN: Record<LeaveKindId, LeaveKind> = { annual: 'annual', rdo: 'rdo', sick: 'sick', unpaid: 'lwop' };

/** The timesheet's leave column for an activity, by its name, or undefined where it is not leave. */
export function leaveColumn(activityName: string | undefined): LeaveKind | undefined {
  const name = activityName?.trim() ?? '';
  if (!name) return undefined;
  if (/public holiday/i.test(name)) return 'publicHoliday';
  const kind = BOOKABLE_LEAVE.find((k) => k.match.test(name));
  return kind ? SHEET_COLUMN[kind.id] : undefined;
}

const minutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function blockHours(b: WorkBlock): number {
  const s = hhmm(b.startTime);
  const e = hhmm(b.endTime);
  if (s && e && minutes(e) > minutes(s)) return (minutes(e) - minutes(s)) / 60;
  return b.hours && b.hours > 0 ? b.hours : 0;
}

export interface ScheduleFill {
  /** The new entries, to add to the sheet's own. */
  entries: TimesheetEntry[];
  /** Days that were filled. */
  filled: string[];
  /** Days with blocks that already had entries, so were left alone. */
  kept: string[];
  /** Activities that are not leave (training, a toolbox day), left to the person, with their names. */
  activity: { date: string; name?: string }[];
  /** Days filled from a block with no start or finish, whose times need typing. */
  untimed: string[];
  /** Days after today with something booked, filled once they have happened. */
  later: string[];
  /** Days where two different jobs overlap, which cannot both have been worked. */
  clash: string[];
}

/**
 * The entries a week's blocks become.
 *
 * One entry per job and rate, in time order. Blocks of the same job that
 * overlap or touch are one entry — a booked block and the block clocking on
 * wrote are the same hours, not twice them — and a gap between two blocks is
 * not worked time, so blocks with a gap stay two entries. A leave block fills
 * its leave column; any other activity is named rather than guessed at.
 *
 * Days after `upTo` are not filled: the schedule for them is a plan, and a
 * plan written into a sheet stops hearing about the office's changes. Days in
 * `skip` were filled before and are left, filled or since cleared.
 */
export function entriesFromSchedule(input: {
  week: readonly string[];
  blocks: readonly WorkBlock[];
  /** Site name, and the app's own site id where known, by Simpro job number. */
  sites: ReadonlyMap<string, { siteName: string; siteId?: string }>;
  existing: readonly TimesheetEntry[];
  newId: () => string;
  /** The last day to fill, normally today. Absent fills the whole week. */
  upTo?: string;
  skip?: ReadonlySet<string>;
}): ScheduleFill {
  const busy = new Set(input.existing.map((e) => e.date));
  const out: ScheduleFill = { entries: [], filled: [], kept: [], activity: [], untimed: [], later: [], clash: [] };

  for (const date of input.week) {
    const day = input.blocks.filter((b) => b.date === date);
    if (!day.length) continue;
    if (input.upTo && date > input.upTo) {
      out.later.push(date);
      continue;
    }
    if (input.skip?.has(date)) continue;
    if (busy.has(date)) {
      out.kept.push(date);
      continue;
    }

    const made: TimesheetEntry[] = [];

    // Leave, summed by column: two half-day blocks of annual leave are one day's.
    const leave = new Map<LeaveKind, number>();
    for (const b of day.filter((x) => !x.jobId)) {
      const column = leaveColumn(b.activityName);
      if (column) leave.set(column, (leave.get(column) ?? 0) + (blockHours(b) || STANDARD_DAY_HOURS));
      else out.activity.push({ date, name: b.activityName });
    }
    for (const [column, hours] of leave) {
      made.push(setLeave(blankEntry(input.newId(), date), column, Math.round(hours * 100) / 100));
    }

    // Work, as spans per job and rate.
    const spans = day
      .filter((b) => b.jobId)
      .map((b) => ({ jobId: b.jobId!, kind: rateKind(b.rateName), start: hhmm(b.startTime), end: hhmm(b.endTime) }))
      .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
    const merged: typeof spans = [];
    for (const s of spans) {
      const same = merged.find((m) => m.jobId === s.jobId && m.kind === s.kind
        && m.start && m.end && s.start && s.end && s.start <= m.end && s.end >= m.start);
      if (same) {
        if (s.end > same.end) same.end = s.end;
        if (s.start < same.start) same.start = s.start;
      } else {
        merged.push({ ...s });
      }
    }
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i]!;
        const b = merged[j]!;
        if (a.jobId !== b.jobId && a.start && a.end && b.start && b.end && b.start < a.end && b.end > a.start) {
          if (!out.clash.includes(date)) out.clash.push(date);
        }
      }
    }
    for (const s of merged) {
      const entry = blankEntry(input.newId(), date);
      entry.jobNumber = s.jobId;
      const site = input.sites.get(s.jobId);
      entry.siteName = site?.siteName ?? '';
      if (site?.siteId) entry.siteId = site.siteId;
      entry.startTime = s.start;
      entry.finishTime = s.end;
      entry.hourKind = s.kind;
      if ((!s.start || !s.end) && !out.untimed.includes(date)) out.untimed.push(date);
      made.push(entry);
    }

    if (made.length) {
      out.entries.push(...made);
      out.filled.push(date);
    }
  }
  return out;
}

const days = (dates: readonly string[]): string => {
  const names = dates.map(dayName);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** What a fill did, in a line or two. */
export function fillSummary(fill: ScheduleFill): { title: string; body: string } {
  if (!fill.filled.length && !fill.kept.length && !fill.activity.length && !fill.later.length) {
    return { title: 'Nothing scheduled', body: 'Your Simpro schedule has nothing for this week yet.' };
  }
  const lines: string[] = [];
  if (fill.clash.length) lines.push(`${days(fill.clash)}: two jobs at the same time. Fix the times.`);
  if (fill.untimed.length) lines.push(`No times on ${days(fill.untimed)}. Add them.`);
  if (fill.kept.length) lines.push(`${days(fill.kept)} already had entries, so ${fill.kept.length === 1 ? 'it was' : 'they were'} left.`);
  for (const a of fill.activity) lines.push(`${dayName(a.date)}: ${a.name ?? 'not on a job'}. Add it yourself.`);
  if (fill.later.length) lines.push(`${days(fill.later)} will fill once ${fill.later.length === 1 ? "it's" : "they're"} done.`);
  return {
    title: fill.filled.length ? `Filled ${days(fill.filled)}` : 'Nothing new to fill',
    body: [fill.filled.length ? 'Check the times before you send it.' : '', ...lines].filter(Boolean).join('\n'),
  };
}
