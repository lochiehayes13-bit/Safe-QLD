import type { SimproClient } from './client';
import {
  keysInNoteText, type OutboundItem, type OutboundJobNote, type OutboundPlan,
} from '@/domain/outboundWork';

/**
 * Sending a completed routine service to Simpro.
 *
 * The decisions all live in `@/domain/outboundWork`, which is pure and tested.
 * This file is the arm that reaches out: it takes a plan, posts each item in the
 * order the plan put them in, and reports what happened to each one. It holds no
 * judgement of its own beyond three things it is better placed to know than the
 * mapping is.
 *
 * **Critical first, and never blocked by the rest.** The plan orders critical
 * defect notices ahead of the service record and this sends in that order, so a
 * flat spot in the signal cannot leave a statutory notice sitting behind a
 * ninety-line summary.
 *
 * **A duplicate is checked for on the server, not just on the phone.** The queue
 * knows what this handset sent; it does not know what the handset it replaced
 * sent, and the risk lives in the office system. So before posting, the job's
 * existing notes are read and every Safe QLD reference marker in them is
 * collected. Anything already there is skipped without a request. Where the
 * notes cannot be read — a key without note permissions is ordinary — that is
 * reported as unavailable and the send goes ahead: refusing to push a service
 * record at all because a second-line check is unavailable would lose real work,
 * and the marker still lands so the next attempt can see it.
 *
 * **A 401 or 403 stops the run.** The queue's retry counts are for flat spots,
 * not for a permission that will not fix itself before somebody changes it in
 * Simpro.
 *
 * Nothing here writes to a job's own fields. Every call is an appended note, so
 * a phone that has been offline for a week cannot overwrite an edit made in the
 * office yesterday.
 *
 * The client is taken as the two calls this layer actually makes rather than as
 * the class. A real `SimproClient` satisfies it, and so does a stand-in — which
 * is what lets the send order, the duplicate skip and the stop-on-403 be tested
 * at all. Importing the class as a value would pull the platform keystore into
 * every test that touched this file, and under the node preset that is a suite
 * that cannot load.
 */

export interface SimproPoster {
  request: SimproClient['request'];
  listAll: SimproClient['listAll'];
}

/**
 * The HTTP status behind a failure, where there is one.
 *
 * Read off the error rather than tested with `instanceof SimproError`, for the
 * same reason the client is structural: the class cannot be imported as a value
 * here. SimproError carries `status`, so nothing is lost but the name.
 */
function statusOf(e: unknown): number | undefined {
  const status = (e as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

export type SendStatus = 'sent' | 'skipped-duplicate' | 'failed' | 'not-attempted';

export interface SendOutcome {
  key: string;
  description: string;
  urgency: OutboundItem['urgency'];
  status: SendStatus;
  /** Present only on 'failed', in the words the caller should show a technician. */
  error?: string;
}

/**
 * Whether the server was asked what it already holds.
 *
 * Reported rather than assumed, because 'unavailable' and 'nothing found' look
 * identical from the outside and only one of them means a duplicate is unlikely.
 */
export type RemoteCheck = 'checked' | 'unavailable' | 'not-requested';

export interface SendReport {
  outcomes: SendOutcome[];
  sent: number;
  skipped: number;
  failed: number;
  notAttempted: number;
  remoteCheck: RemoteCheck;
  remoteCheckError?: string;
  /** Carried through from the plan so one screen can show sent and declined together. */
  declined: string[];
  cautions: string[];
}

export interface SendOptions {
  /**
   * Keys this app already knows the office accepted. Skipped without a request,
   * which is what makes a retry after a timeout safe.
   */
  alreadySent?: Iterable<string>;
  /** Read the job's notes first. On by default; off is for a caller that has just read them. */
  checkRemote?: boolean;
  /** How far back through a job's notes to look. A busy job accumulates hundreds. */
  maxNotesRead?: number;
}

/** Only what is read back; Simpro returns far more. */
interface RawJobNote {
  ID?: number;
  Subject?: string;
  Note?: string;
}

/**
 * Safe QLD reference markers already on a job in Simpro.
 *
 * Returns undefined — not an empty set — when the notes could not be read. The
 * difference matters: an empty set says "this service is not there", and
 * undefined says "nobody knows", and a caller that treats them alike will
 * eventually post a duplicate and call it certainty.
 */
export async function keysAlreadyOnJob(
  client: SimproPoster,
  jobId: string,
  maxNotesRead = 200,
): Promise<Set<string> | undefined> {
  try {
    const notes = await client.listAll<RawJobNote>(
      `jobs/${jobId}/notes/`, { columns: 'ID,Subject,Note' }, maxNotesRead,
    );
    const keys = new Set<string>();
    for (const note of notes) {
      for (const key of keysInNoteText(`${note.Subject ?? ''}\n${note.Note ?? ''}`)) keys.add(key);
    }
    return keys;
  } catch {
    return undefined;
  }
}

/** Posts one note. Mirrors the call in resources.addJobNote, which this cannot import. */
export async function postJobNote(client: SimproPoster, payload: OutboundJobNote): Promise<void> {
  await client.request('POST', `jobs/${payload.jobId}/notes/`, {
    body: { Subject: payload.subject, Note: payload.note },
  });
}

function describe(e: unknown): string {
  const status = statusOf(e);
  if (status === 403) {
    return 'This Simpro key is not permitted to add job notes. Note permissions are set per endpoint in Simpro.';
  }
  if (status === 401) return 'Simpro rejected the credentials. Check them in Settings.';
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sends a plan, in its own order, and says what became of every item.
 *
 * Items are never reordered here. The plan has already put the critical defect
 * notices first for a reason that outlives this function, and a send that sorted
 * by anything else — size, job, retry count — would quietly undo it.
 */
export async function sendOutboundPlan(
  client: SimproPoster,
  plan: OutboundPlan,
  options: SendOptions = {},
): Promise<SendReport> {
  const outcomes: SendOutcome[] = [];
  const report: SendReport = {
    outcomes,
    sent: 0,
    skipped: 0,
    failed: 0,
    notAttempted: 0,
    remoteCheck: 'not-requested',
    declined: plan.warnings.filter((w) => w.severity === 'declined').map((w) => w.message),
    cautions: plan.warnings.filter((w) => w.severity === 'caution').map((w) => w.message),
  };
  if (!plan.items.length) return report;

  const known = new Set(options.alreadySent ?? []);

  if (options.checkRemote !== false) {
    // Every item in a plan belongs to one job, but the jobs are read from the
    // items rather than assumed, so a future plan spanning two cannot half-check.
    const jobIds = [...new Set(plan.items.map((i) => i.payload.jobId))];
    let anyUnavailable = false;
    for (const jobId of jobIds) {
      const remote = await keysAlreadyOnJob(client, jobId, options.maxNotesRead);
      if (!remote) {
        anyUnavailable = true;
        continue;
      }
      for (const key of remote) known.add(key);
    }
    report.remoteCheck = anyUnavailable ? 'unavailable' : 'checked';
    if (anyUnavailable) {
      report.remoteCheckError = 'The job\'s existing notes could not be read, so a duplicate could not be ruled '
        + 'out from the server. The work was sent anyway rather than lost; check the job in Simpro.';
    }
  }

  let stopped = false;
  for (const item of plan.items) {
    if (stopped) {
      outcomes.push({ key: item.key, description: item.description, urgency: item.urgency, status: 'not-attempted' });
      report.notAttempted++;
      continue;
    }
    if (known.has(item.key)) {
      outcomes.push({ key: item.key, description: item.description, urgency: item.urgency, status: 'skipped-duplicate' });
      report.skipped++;
      continue;
    }
    try {
      await postJobNote(client, item.payload);
      // Recorded immediately so a second item carrying the same key — which
      // should not happen, but a plan is data and data is edited — cannot post
      // twice inside one run.
      known.add(item.key);
      outcomes.push({ key: item.key, description: item.description, urgency: item.urgency, status: 'sent' });
      report.sent++;
    } catch (e) {
      outcomes.push({
        key: item.key, description: item.description, urgency: item.urgency,
        status: 'failed', error: describe(e),
      });
      report.failed++;
      // A permission or credential failure will not fix itself before somebody
      // changes it in Simpro, so the rest of the queue is left alone rather than
      // burning its retry counts against it.
      const status = statusOf(e);
      if (status === 401 || status === 403) stopped = true;
    }
  }

  return report;
}

/**
 * The keys a report proves the office now holds.
 *
 * What the caller persists so the next attempt skips them. A failure contributes
 * nothing: an item that timed out may or may not have landed, and the marker on
 * the server is what settles it on the next run.
 */
export function acceptedKeys(report: SendReport): string[] {
  return report.outcomes
    .filter((o) => o.status === 'sent' || o.status === 'skipped-duplicate')
    .map((o) => o.key);
}
