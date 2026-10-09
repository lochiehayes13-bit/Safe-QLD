import { sendReadiness, type ClockEntry } from './clockOn';

/**
 * The chip beside a clock entry, and the line under it.
 *
 * Lifted out of the clock screen so the rule it adds can be tested. An entry
 * clocked with no cost centre, no Simpro employee or no Simpro activity on it
 * can never be sent: nothing fills those in afterwards, and the send needs
 * all three. So it says that, rather than reading as if it were waiting its
 * turn.
 */

/** Where the entry's queue row stands. The shape of clockRepo's QueueState. */
export interface EntryQueueState {
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
  lastError?: string;
}

export type SendTone = 'pass' | 'fail' | 'warn' | 'muted' | 'accent';

export interface EntrySendState {
  label: string;
  tone: SendTone;
  words?: string;
}

/**
 * Why an entry can never be sent, or nothing when it can or still might.
 *
 * Only the gaps that stay gaps: a missing employee, job, cost centre or
 * activity id. A running entry, one under a minute, or one over midnight can
 * still be fixed on the phone and is left to sendReadiness.
 */
export function neverSendable(e: ClockEntry): string | undefined {
  if (e.kind === 'break') return undefined;
  if (!/^\d+$/.test(e.employeeExternalId.trim())) return "No Simpro employee on this entry, so it can't be sent. Tell the office the hours.";
  if (e.kind === 'work') {
    if (!e.jobExternalId) return "No job on this entry, so it can't be sent. Tell the office the hours.";
    if (!e.jobSectionExternalId || !e.jobCostCenterExternalId) {
      return "No cost centre on this job, so it can't be sent. Tell the office the hours.";
    }
    return undefined;
  }
  if (!e.activityExternalId) return "No Simpro activity on this entry, so it can't be sent. Tell the office the hours.";
  return undefined;
}

/** The chip and line for one entry, given its queue row if it has one. */
export function entrySendState(e: ClockEntry, q: EntryQueueState | undefined): EntrySendState {
  if (e.sentAt) return { label: 'Sent', tone: 'pass' };
  if (!e.endedAt) return { label: 'Running', tone: 'accent', words: neverSendable(e) };
  if (q?.status === 'unknown') {
    return { label: 'Unsure', tone: 'warn', words: `No reply from Simpro. Check Waiting to send.${q.lastError ? ` ${q.lastError}` : ''}` };
  }
  if (q?.status === 'failed') return { label: 'Failed', tone: 'fail', words: q.lastError ?? e.sendError };
  if (q?.status === 'pending' || q?.status === 'sending') {
    return { label: q.lastError ? 'Retrying' : 'Queued', tone: 'accent', words: q.lastError };
  }
  if (e.kind === 'break') return { label: 'Break', tone: 'muted' };
  const never = neverSendable(e);
  if (never) return { label: "Can't send", tone: 'warn', words: never };
  if (e.sendError) return { label: 'Not sent', tone: 'fail', words: e.sendError };
  const ready = sendReadiness(e);
  if (!ready.ready) return { label: 'Not sent', tone: 'muted', words: ready.why };
  return { label: 'To send', tone: 'muted' };
}
