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
