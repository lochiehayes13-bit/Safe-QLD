import { qldIsoDay } from '@/domain/qldTime';

/**
 * The customer's job number for a service report.
 *
 * Their own report leads with it — "CUSTOMER JOB NO. 42823" across the top of
 * page one — and it is what the office files the document by. This app syncs
 * jobs from Simpro with those numbers on them, the report type has carried a
 * `jobNumber` field from the start, and the renderer prints it. The only thing
 * that builds a report never supplied one, so every report this app has
 * produced went out with no job number on it.
 *
 * ---
 *
 * The number is worked out rather than asked for, because a technician sharing
 * a report from a plant room should not have to remember a five-digit number
 * from the office system. But a site can have several jobs in a month, and
 * putting the wrong number on a service report files it against somebody else's
 * work — which is the same failure the Simpro push refuses to risk.
 *
 * So: exactly one job at this site in the window gets its number on the report.
 * More than one and the report goes out without one, and the caller is told
 * which candidates there were, because silence would read as "this site has no
 * job" rather than "this app would have had to guess".
 */

export interface ReportJobCandidate {
  /** The number the office system knows this job by. */
  externalId?: string;
  siteId?: string;
  /** When the job was scheduled — an instant, as Simpro issues it. */
  scheduledFor?: string;
  completedAt?: string;
  title?: string;
}

export interface ReportJobMatch {
  jobNumber?: string;
  /**
   * Why the report has no number when a job was there to take one from.
   *
   * Absent where no job matched at all — that is an ordinary state and needs no
   * explanation.
   */
  reason?: string;
}

/** The day a job belongs to: when it was finished, else when it was scheduled. */
function jobDay(job: ReportJobCandidate): string | undefined {
  return qldIsoDay(job.completedAt) ?? qldIsoDay(job.scheduledFor);
}

export function jobNumberForReport(
  jobs: readonly ReportJobCandidate[],
  window: { siteId: string; from: string; to: string },
): ReportJobMatch {
  const from = qldIsoDay(window.from);
  const to = qldIsoDay(window.to);
  if (!from || !to) return {};

  const numbers = new Set<string>();
  for (const job of jobs) {
    if (job.siteId !== window.siteId) continue;
    const number = job.externalId?.trim();
    if (!number) continue;
    const day = jobDay(job);
    // A job with no date at all cannot be placed in the window. Counting it
    // would let a job from two years ago put its number on this month's report.
    if (!day || day < from || day > to) continue;
    numbers.add(number);
  }

  const found = [...numbers];
  if (found.length === 1) return { jobNumber: found[0] };
  if (found.length > 1) {
    return {
      reason: `${found.length} jobs at this site in the period (${found.sort().join(', ')}), so no `
        + 'job number is printed rather than guessing which one this service belongs to.',
    };
  }
  return {};
}

/**
 * The job to offer a test sheet being filled in today.
 *
 * The routine report above looks back over a window at work already done. A
 * test sheet is being written now, on site, and the question is simpler: is
 * there one open job here today? The office's job status is what says open —
 * a job the office has completed, invoiced or archived is not the one being
 * worked, however recently it was scheduled.
 *
 * Offered rather than applied. The number goes on the report only when the
 * technician accepts it, because the same refusal applies as above: a wrong
 * number files this service against somebody else's work.
 */
export interface OpenJobCandidate extends ReportJobCandidate {
  /** The app's status: 'complete' is finished work, anything else is open. */
  status?: string;
  /** The office's customer id, so the customer can be looked up once the job is accepted. */
  customerExternalId?: string;
  /** The app's own id for the job, so the caller can read the rest of it. */
  id?: string;
}

export interface JobOffer {
  jobNumber?: string;
  /** The job the number came from, for the caller to read its customer and contact. */
  job?: OpenJobCandidate;
  /**
   * Why this one: scheduled here today, or the only open job at the site
   * when nothing is scheduled today.
   */
  basis?: 'today' | 'only-open';
  /** Why nothing is offered when there were jobs to choose from. */
  reason?: string;
}

export function jobToOffer(
  jobs: readonly OpenJobCandidate[],
  where: { siteId: string; today: string },
): JobOffer {
  const today = qldIsoDay(where.today);
  if (!today) return {};

  const open = new Map<string, OpenJobCandidate>();
  for (const job of jobs) {
    if (job.siteId !== where.siteId || job.status === 'complete') continue;
    const number = job.externalId?.trim();
    if (!number || open.has(number)) continue;
    open.set(number, job);
  }

  const scheduledToday = [...open.values()].filter((j) => qldIsoDay(j.scheduledFor) === today);
  if (scheduledToday.length === 1) {
    return { jobNumber: scheduledToday[0]!.externalId!.trim(), job: scheduledToday[0], basis: 'today' };
  }
  if (scheduledToday.length > 1) {
    const numbers = scheduledToday.map((j) => j.externalId!.trim()).sort();
    return {
      reason: `${numbers.length} jobs are scheduled at this site today (${numbers.join(', ')}). Type the one this `
        + 'sheet belongs to rather than have the app guess.',
    };
  }

  if (open.size === 1) {
    const [number, job] = [...open.entries()][0]!;
    return { jobNumber: number, job, basis: 'only-open' };
  }
  if (open.size > 1) {
    const numbers = [...open.keys()].sort();
    return {
      reason: `Nothing is scheduled here today and ${numbers.length} jobs are open at this site `
        + `(${numbers.join(', ')}). Type the one this sheet belongs to.`,
    };
  }
  return {};
}
