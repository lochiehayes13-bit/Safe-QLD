import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { qldIsoDay } from '@/domain/qldTime';
import type { DueState } from '@/domain/schedule';

/**
 * What a technician wants to know about a site before they go.
 *
 * Plan work used to lay out a month from routine due dates and asset
 * counts. That answers "what is due" and nothing else, and the questions
 * actually asked in the ute at seven in the morning are different: who did
 * this place last, how long did it take them, did they even clock on, how
 * much is there to walk, and has anyone told the client we are coming.
 *
 * This module assembles those facts from what the phone already holds, and
 * says plainly where it holds nothing. That last part matters more than it
 * sounds. The office's schedule mirror only reaches a week back and the
 * timesheet mirror only holds this phone's own hours, so "how long did the
 * last visit take" is often unanswerable from the phone — and a card that
 * printed "0 h" there would be read as "nobody clocked on", which is an
 * accusation. The card says "no hours held here" instead, and names what
 * would answer it.
 *
 * Pure: every input is a row shape the repository reads, so the assembly
 * is tested without a database.
 */

export interface LastJobRow {
  externalId: string;
  title: string;
  statusName?: string;
  status: string;
  completedDate?: string;
  completedAt?: string;
  jobType?: string;
  /** JSON of [{id, name}], as the mirror holds it. */
  techniciansJson?: string;
  technician?: string;
  scheduledFor?: string;
}

export interface HoursRow {
  /** Who, where the source names them. */
  staffName?: string;
  staffId?: string;
  date: string;
  hours: number;
  source: 'office-timesheet' | 'schedule' | 'phone-clock';
}

export interface RunRow {
  completedAt: string;
  technician?: string;
  routineLabel: string;
  checksPassed: number;
  checksFailed: number;
  checksNotTested: number;
  defectsRaised: number;
}

export interface DueRow {
  routineId: string;
  routineLabel: string;
  frequency: string;
  state: DueState;
  scheduledFor?: string;
  daysUntilDue?: number;
}

export interface NextJobRow {
  externalId: string;
  title: string;
  statusName?: string;
  /** A schedule block the office holds for it, where one is in the window. */
  scheduled?: { date: string; staffName?: string; startTime?: string; endTime?: string };
}

/**
 * What is still broken at a site, as the phone holds it.
 *
 * The one fact that changes what goes in the van, and the one the last visit's
 * numbers cannot give you: "3 defects raised last time" says nothing about
 * whether they were fixed the same afternoon or have been sitting since March.
 */
export interface OpenDefectRow {
  status: string;
  severity: string;
  raisedAt: string;
  location: string;
  description: string;
}

export interface SiteFactsInput {
  siteId: string;
  siteName: string;
  suburb?: string;
  lastJob?: LastJobRow;
  /** Hours held on the phone for the last job, any source. */
  hours: HoursRow[];
  lastRun?: RunRow;
  assetCounts: { system: string; count: number }[];
  openDefects: OpenDefectRow[];
  due: DueRow[];
  nextJob?: NextJobRow;
  contact?: { name?: string; phone?: string };
  today: string;
}

export interface SiteFacts {
  siteId: string;
  siteName: string;
  suburb?: string;
  /** The last Simpro job at the site, in words. */
  lastJob?: {
    jobNo: string;
    title: string;
    status: string;
    /** The office's completion day, or the phone's, or nothing. */
    finished?: string;
    who: string[];
    daysAgo?: number;
  };
  /** Hours on that job, where the phone holds any. */
  hours?: { total: number; byPerson: { name: string; hours: number }[]; source: HoursRow['source'] };
  /**
   * Whether anyone recorded time on the last job. `unknown` is the honest
   * answer when the phone holds no source that could say — never "no".
   */
  clockedOn: 'yes' | 'no' | 'unknown';
  /** Why clockedOn is what it is, in a sentence. */
  clockedOnNote: string;
  lastRun?: RunRow & { daysAgo?: number };
  /**
   * What is still open at the site, now.
   *
   * `oldestDays` is the number that makes a technician ring the office: a
   * defect open for four hundred days is a conversation, not a work order.
   * `worst` names one of them, because a count is an abstraction and a
   * location is a thing you can picture on the drive over.
   */
  open: {
    total: number;
    critical: number;
    oldestDays?: number;
    worst?: { location: string; description: string; days?: number; critical: boolean };
  };
  assets: { system: string; label: string; count: number }[];
  assetsTotal: number;
  /** Due and overdue routines first, then the nearest upcoming ones. */
  due: DueRow[];
  overdue: number;
  nextJob?: NextJobRow;
  /** Whether the next visit is on the office's calendar, only a job, or nothing. */
  lockedIn: 'booked' | 'job-only' | 'none';
  lockedInNote: string;
  contact?: { name?: string; phone?: string };
}

const DAY_MS = 86_400_000;

function daysBetween(fromDay: string | undefined, today: string): number | undefined {
  if (!fromDay) return undefined;
  const a = Date.parse(`${fromDay.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.round((b - a) / DAY_MS);
}

/** The names on a job, from the mirror's JSON or the plain column. */
export function techniciansOf(job: Pick<LastJobRow, 'techniciansJson' | 'technician'>): string[] {
  const out: string[] = [];
  if (job.techniciansJson) {
    try {
      const parsed: unknown = JSON.parse(job.techniciansJson);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          const name = p && typeof p === 'object' ? (p as { name?: unknown }).name : undefined;
          if (typeof name === 'string' && name.trim()) out.push(name.trim());
        }
      }
    } catch {
      // Not JSON: fall through to the plain column.
    }
  }
  if (!out.length && job.technician?.trim()) out.push(job.technician.trim());
  return out;
}

const DUE_ORDER: Record<DueState, number> = { overdue: 0, due: 1, upcoming: 2, 'never-done': 3, 'not-scheduled': 4 };

/**
 * Assembles the facts.
 *
 * The rule throughout is that an absence is said, not zeroed. A job with no
 * technician names is "nobody named on it"; hours the phone does not hold
 * are "not held here"; and a site with no job at all is not "unbooked" but
 * "no job", because the fix for each is different.
 */
export function buildSiteFacts(input: SiteFactsInput): SiteFacts {
  const job = input.lastJob;
  // A Simpro completion instant is UTC; the day the job ended is the Queensland one.
  const finished = job?.completedDate ?? qldIsoDay(job?.completedAt);

  const byPerson = new Map<string, number>();
  let total = 0;
  let source: HoursRow['source'] | undefined;
  for (const h of input.hours) {
    if (!Number.isFinite(h.hours) || h.hours <= 0) continue;
    const name = h.staffName?.trim() || (h.source === 'phone-clock' ? 'This phone' : 'Unnamed');
    byPerson.set(name, (byPerson.get(name) ?? 0) + h.hours);
    total += h.hours;
    // Office sources outrank the phone's own clock when both are present.
    if (!source || (source === 'phone-clock' && h.source !== 'phone-clock')) source = h.source;
  }
  const hours = total > 0 && source
    ? { total: Math.round(total * 4) / 4, byPerson: [...byPerson].map(([name, hrs]) => ({ name, hours: Math.round(hrs * 4) / 4 })), source }
    : undefined;

  let clockedOn: SiteFacts['clockedOn'] = 'unknown';
  let clockedOnNote: string;
  if (!job) {
    clockedOnNote = 'No Simpro job at this site on the phone, so there is nothing to have clocked onto.';
  } else if (hours) {
    clockedOn = 'yes';
    clockedOnNote = `${hours.total} h recorded on job ${job.externalId}${hours.byPerson.length ? ` by ${hours.byPerson.map((p) => p.name).join(', ')}` : ''}.`;
  } else if (input.hours.length === 0 && job.status === 'complete') {
    // The phone looked and found nothing. Whether that is "nobody clocked
    // on" or "the office's hours are outside what this phone mirrors"
    // depends on the source's reach, which the caller knows and we do not —
    // so it is unknown with the reason, never no.
    clockedOnNote = `No hours for job ${job.externalId} are held on this phone. The office's timesheet for that job would say; the phone only mirrors its own hours and the last week of the schedule.`;
  } else {
    clockedOnNote = `Job ${job.externalId} is ${job.statusName ?? job.status}; no hours held here yet.`;
  }

  const assets = input.assetCounts
    .filter((c) => c.count > 0)
    .map((c) => ({ system: c.system, label: SYSTEM_LABELS[c.system as keyof typeof SYSTEM_LABELS] ?? (c.system === 'unknown' ? 'Unclassified' : c.system), count: c.count }))
    .sort((a, b) => b.count - a.count);
  const assetsTotal = assets.reduce((n, a) => n + a.count, 0);

  const due = [...input.due]
    .filter((d) => d.state !== 'not-scheduled')
    .sort((a, b) => DUE_ORDER[a.state] - DUE_ORDER[b.state] || (a.daysUntilDue ?? 9e9) - (b.daysUntilDue ?? 9e9));
  const overdue = due.filter((d) => d.state === 'overdue').length;

  /*
   * What is still open, now — not what the last visit raised.
   *
   * "3 defects raised last time" says nothing about whether they were fixed
   * the same afternoon or have been sitting since March, and those are
   * different days' work. The oldest one is the number that makes somebody
   * ring the office; the worst one is named because a count is an abstraction
   * and a location is something you can picture on the drive over.
   */
  const openRows = input.openDefects.filter((d) => d.status === 'open');
  const withDays = openRows.map((d) => ({
    ...d,
    critical: d.severity === 'critical',
    days: daysBetween(qldIsoDay(d.raisedAt), input.today),
  }));
  // Critical first, then oldest. That is the order somebody would read them in.
  const ranked = [...withDays].sort((a, b) => (
    Number(b.critical) - Number(a.critical) || (b.days ?? -1) - (a.days ?? -1)
  ));
  const worstRow = ranked[0];
  const open: SiteFacts['open'] = {
    total: openRows.length,
    critical: withDays.filter((d) => d.critical).length,
    oldestDays: withDays.reduce<number | undefined>(
      (max, d) => (d.days === undefined ? max : Math.max(max ?? 0, d.days)),
      undefined,
    ),
    worst: worstRow ? {
      location: worstRow.location,
      description: worstRow.description,
      days: worstRow.days,
      critical: worstRow.critical,
    } : undefined,
  };

  let lockedIn: SiteFacts['lockedIn'] = 'none';
  let lockedInNote: string;
  if (input.nextJob?.scheduled) {
    lockedIn = 'booked';
    const s = input.nextJob.scheduled;
    lockedInNote = `Job ${input.nextJob.externalId} is on the calendar for ${s.date}${s.staffName ? ` (${s.staffName})` : ''}${s.startTime ? `, ${s.startTime}${s.endTime ? `–${s.endTime}` : ''}` : ''}.`;
  } else if (input.nextJob) {
    lockedIn = 'job-only';
    lockedInNote = `Job ${input.nextJob.externalId} exists${input.nextJob.statusName ? ` (${input.nextJob.statusName})` : ''} but nothing is on the calendar for it yet. Booking it here puts it there.`;
  } else {
    lockedInNote = 'No open Simpro job at this site. A day here cannot go on the schedule until the office raises one.';
  }

  return {
    siteId: input.siteId,
    siteName: input.siteName,
    suburb: input.suburb,
    lastJob: job ? {
      jobNo: job.externalId,
      title: job.title,
      status: job.statusName ?? job.status,
      finished,
      who: techniciansOf(job),
      daysAgo: daysBetween(finished, input.today),
    } : undefined,
    hours,
    clockedOn,
    clockedOnNote,
    lastRun: input.lastRun ? { ...input.lastRun, daysAgo: daysBetween(qldIsoDay(input.lastRun.completedAt), input.today) } : undefined,
    open,
    assets,
    assetsTotal,
    due,
    overdue,
    nextJob: input.nextJob,
    lockedIn,
    lockedInNote,
    contact: input.contact,
  };
}

/** One line for a list row: the last visit, in the fewest words that are still true. */
export function lastServiceLine(f: SiteFacts): string {
  if (f.lastJob) {
    const who = f.lastJob.who.length ? f.lastJob.who.join(', ') : 'nobody named';
    const when = f.lastJob.daysAgo !== undefined
      ? f.lastJob.daysAgo === 0 ? 'today' : f.lastJob.daysAgo === 1 ? 'yesterday' : `${f.lastJob.daysAgo} days ago`
      : f.lastJob.finished ?? 'date unknown';
    const hrs = f.hours ? `, ${f.hours.total} h` : '';
    return `Last job ${f.lastJob.jobNo} — ${who}, ${when}${hrs}`;
  }
  if (f.lastRun) {
    const when = f.lastRun.daysAgo !== undefined ? `${f.lastRun.daysAgo} days ago` : (qldIsoDay(f.lastRun.completedAt) ?? 'a while ago');
    return `Last service ${when}${f.lastRun.technician ? ` by ${f.lastRun.technician}` : ''} — ${f.lastRun.routineLabel}`;
  }
  return 'No service recorded on this phone';
}

/**
 * What is still open, in one line for a list row.
 *
 * Empty where nothing is, because "0 defects outstanding" on three hundred
 * rows is a column of noise that hides the four rows that matter.
 */
export function openDefectsLine(f: SiteFacts): string {
  const { total, critical, oldestDays } = f.open;
  if (!total) return '';
  const head = critical
    ? `${critical} critical of ${total} still open`
    : `${total} defect${total === 1 ? '' : 's'} still open`;
  if (oldestDays === undefined) return head;
  // Under a fortnight is last visit's work; a year is a conversation.
  const age = oldestDays >= 365
    ? `oldest ${Math.floor(oldestDays / 365)} year${oldestDays >= 730 ? 's' : ''} old`
    : oldestDays >= 60
      ? `oldest ${Math.floor(oldestDays / 30)} months old`
      : `oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'} old`;
  return `${head}, ${age}`;
}

/** "3 detection, 12 extinguishers, 2 hydrants" */
export function assetsLine(f: SiteFacts): string {
  if (!f.assets.length) return 'No assets registered';
  return f.assets.slice(0, 4).map((a) => `${a.count} ${a.label.toLowerCase()}`).join(', ') + (f.assets.length > 4 ? ', …' : '');
}
