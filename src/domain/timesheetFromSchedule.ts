import { blankEntry, dayName, type Timesheet, type TimesheetEntry } from './timesheet';
import type { ScheduleEntry } from './myDay';

/**
 * Filling a week of timesheet from the person's own Simpro schedule.
 *
 * A construction crew's week is already on the office's schedule, job by job
 * and hour by hour, and was typed again on Friday from memory. This turns the
 * schedule blocks the device has synced into timesheet entries, so the week is
 * one tap and a check rather than thirty fields. Service technicians, whose
 * day is rarely what was scheduled, keep filling theirs by hand; they choose.
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
 * Whether opening a week fills it from the schedule by itself.
 *
 * Only for someone who chose that, and only for a week nobody has touched: a
 * draft with nothing on it, never saved since it was made. A week somebody
 * cleared by hand stays cleared the next time it opens.
 */
export function fillsOnOpen(
  sheet: Pick<Timesheet, 'status' | 'entries' | 'createdAt' | 'updatedAt'>,
  pref: '' | TimesheetFill,
): boolean {
  return pref === 'schedule' && sheet.status === 'draft' && !sheet.entries.length && sheet.createdAt === sheet.updatedAt;
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

export interface ScheduleFill {
  /** The new entries, to add to the sheet's own. */
  entries: TimesheetEntry[];
  /** Days that were filled. */
  filled: string[];
  /** Days with schedule blocks that already had entries, so were left alone. */
  kept: string[];
  /** Days with a block that is not on a job (leave, training), left to the person. */
  activity: string[];
  /** Days filled from a block with no start or finish, whose times need typing. */
  untimed: string[];
}

/**
 * The entries a week's schedule blocks become.
 *
 * One entry per job block, in time order. Two blocks on the same job that run
 * end to start are one entry; a gap between them is not worked time, so two
 * blocks with a gap stay two entries. A block with no job is an activity —
 * leave, training, a toolbox day — and is named rather than guessed at.
 */
export function entriesFromSchedule(input: {
  week: readonly string[];
  blocks: readonly ScheduleEntry[];
  /** Site name, and the app's own site id where known, by Simpro job number. */
  sites: ReadonlyMap<string, { siteName: string; siteId?: string }>;
  existing: readonly TimesheetEntry[];
  newId: () => string;
}): ScheduleFill {
  const busy = new Set(input.existing.map((e) => e.date));
  const out: ScheduleFill = { entries: [], filled: [], kept: [], activity: [], untimed: [] };

  for (const date of input.week) {
    const day = input.blocks.filter((b) => b.date === date);
    if (!day.length) continue;
    if (busy.has(date)) {
      out.kept.push(date);
      continue;
    }
    if (day.some((b) => !b.jobId)) out.activity.push(date);

    const jobs = day
      .filter((b) => b.jobId)
      .map((b) => ({ jobId: b.jobId!, start: hhmm(b.startTime), end: hhmm(b.endTime) }))
      .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
    if (!jobs.length) continue;

    const merged: typeof jobs = [];
    for (const b of jobs) {
      const last = merged[merged.length - 1];
      if (last && last.jobId === b.jobId && last.end && last.end === b.start) last.end = b.end;
      else merged.push({ ...b });
    }

    for (const b of merged) {
      const entry = blankEntry(input.newId(), date);
      entry.jobNumber = b.jobId;
      const site = input.sites.get(b.jobId);
      entry.siteName = site?.siteName ?? '';
      if (site?.siteId) entry.siteId = site.siteId;
      entry.startTime = b.start;
      entry.finishTime = b.end;
      if (!b.start || !b.end) {
        if (!out.untimed.includes(date)) out.untimed.push(date);
      }
      out.entries.push(entry);
    }
    out.filled.push(date);
  }
  return out;
}

const days = (dates: readonly string[]): string => {
  const names = dates.map(dayName);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** What a fill did, in a line or two. */
export function fillSummary(fill: ScheduleFill): { title: string; body: string } {
  if (!fill.filled.length && !fill.kept.length && !fill.activity.length) {
    return { title: 'Nothing scheduled', body: 'Your Simpro schedule has nothing for this week.' };
  }
  const lines: string[] = [];
  if (fill.kept.length) lines.push(`${days(fill.kept)} already had entries, so ${fill.kept.length === 1 ? 'it was' : 'they were'} left.`);
  if (fill.activity.length) lines.push(`${days(fill.activity)}: leave or other activities. Add those yourself.`);
  if (fill.untimed.length) lines.push(`No times on ${days(fill.untimed)}. Add them.`);
  return {
    title: fill.filled.length ? `Filled ${days(fill.filled)}` : 'Nothing new to fill',
    body: [fill.filled.length ? 'Check the times before you send it.' : '', ...lines].filter(Boolean).join('\n'),
  };
}
