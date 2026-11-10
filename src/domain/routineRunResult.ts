/**
 * What a routine run makes of its answers.
 *
 * Kept apart from the run screen so the rules can be tested: an asset is
 * answered check by check, but its result on the register is one word, and
 * that word has to come from every check, not from whichever was saved last.
 */

export type CheckVerdict = 'pass' | 'fail' | 'na' | 'not-tested';

/**
 * One asset's result from all of its checks in the run.
 *
 * Any fail is a fail. N/A says nothing about the asset, and a check that could
 * not be carried out is recorded as its own gap, so neither counts. With no
 * pass and no fail there is no result, and the asset keeps the one it had.
 */
export function assetResult(verdicts: readonly (CheckVerdict | undefined)[]): 'pass' | 'fail' | undefined {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('pass')) return 'pass';
  return undefined;
}

const WRITE_ORDER: Record<CheckVerdict, number> = { 'not-tested': 0, na: 1, pass: 2, fail: 3 };

/**
 * An asset's checks in the order their events are written: the one that
 * decides its result last.
 *
 * Every event in a run carries the same instant, and the send to the office
 * takes an asset's latest event as its result. Writing a failure last keeps a
 * failed asset from being sent as a pass. Stable, so checks of the same kind
 * keep the routine's order.
 */
export function decidingLast<T extends { verdict: CheckVerdict }>(checks: readonly T[]): T[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => WRITE_ORDER[a.c.verdict] - WRITE_ORDER[b.c.verdict] || a.i - b.i)
    .map(({ c }) => c);
}

export interface RecordedRun {
  /** Checks answered pass, fail or N/A, system checks included. */
  checks: number;
  /** Assets that failed at least one check. */
  assetsFailed: number;
  defects: number;
  /** Checks recorded as not tested, with a reason. */
  notTested: number;
  /** The office's job the defects were queued to, when there was exactly one. */
  job?: string;
  /** Defect notes on the job: queued now or already there. */
  onJob: number;
  /** Defect notes that would not queue. */
  notQueued: number;
  /** Whether any defect raised is critical, which also needs its written notice. */
  critical: boolean;
  /** Why there was no job: the site's jobs could not be read, or how many are open. */
  jobsUnreadable: boolean;
  openJobs: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The words once a run is recorded: what was saved, and where the defects went. */
export function recordedMessage(r: RecordedRun): string {
  const counts = [
    plural(r.checks, 'check'),
    r.assetsFailed ? `${plural(r.assetsFailed, 'asset')} failed` : undefined,
    r.defects ? plural(r.defects, 'defect') : undefined,
    r.notTested ? `${r.notTested} not tested` : undefined,
  ].filter(Boolean).join(', ');
  const lines = [`Recorded ${counts}.`];

  if (r.defects) {
    if (r.job) {
      if (r.onJob) lines.push(`Defects queued to job ${r.job}.`);
      if (r.notQueued) lines.push(`${plural(r.notQueued, 'defect')} didn't queue. Ring the office.`);
      if (r.critical) lines.push('Send the critical defect notice from Waiting to send.');
    } else if (r.jobsUnreadable) {
      lines.push("Couldn't read this site's jobs. Send it from Waiting to send.");
    } else if (r.openJobs > 1) {
      lines.push(`${r.openJobs} open jobs here. Pick one on Waiting to send.`);
    } else {
      lines.push('No open job here. Ring the office with the defects.');
    }
  }
  return lines.join('\n\n');
}
