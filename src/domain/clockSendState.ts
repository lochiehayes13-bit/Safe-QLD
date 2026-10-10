import { missingSimproIds, sendReadiness, type ClockEntry } from './clockOn';

/**
 * The chip beside a clock entry, and the line under it.
 *
 * Lifted out of the clock screen so the rules it adds can be tested. Two
 * kinds of gap stop an entry being sent, and they read differently:
 *
 * - No Simpro employee or no job on it. Nothing fills those in afterwards,
 *   so it says it can't be sent and the office needs the hours another way.
 * - No cost centre or no Simpro activity id. Those are filled in after a
 *   sync once the office has them (see reattachEntry in ./clockOn), or by
 *   the person picking a cost centre, so it says what it is waiting for.
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
 * Only the gaps nothing fills in: a missing employee or job.
 */
export function cannotSend(e: ClockEntry): string | undefined {
  if (e.kind === 'break' || e.sentAt) return undefined;
  if (!/^\d+$/.test(e.employeeExternalId.trim())) return 'No Simpro employee on this entry. Tell the office the hours.';
  if (e.kind === 'work' && !e.jobExternalId) return 'No job on this entry. Tell the office the hours.';
  return undefined;
}

/**
 * What an entry is waiting for before it can be sent, or nothing.
 *
 * A cost centre or an activity id the next sync or a pick can fill in. The
 * reason the last match wrote on the entry is the precise one ("Pick a cost
 * centre for job 9001"); without one, the gap is named.
 */
export function waitingFor(e: ClockEntry): string | undefined {
  if (cannotSend(e) || !missingSimproIds(e)) return undefined;
  if (e.sendError?.trim()) return e.sendError.trim();
  if (e.kind === 'work') return 'No cost centre on this job yet. Ask the office.';
  return 'Sends once Simpro activities sync.';
}

/** The chip and line for one entry, given its queue row if it has one. */
export function entrySendState(e: ClockEntry, q: EntryQueueState | undefined): EntrySendState {
  if (e.sentAt) return { label: 'Sent', tone: 'pass' };
  if (!e.endedAt) return { label: 'Running', tone: 'accent', words: cannotSend(e) ?? waitingFor(e) };
  if (q?.status === 'unknown') {
    return { label: 'Unsure', tone: 'warn', words: `No reply from Simpro. Check Waiting to send.${q.lastError ? ` ${q.lastError}` : ''}` };
  }
  if (q?.status === 'failed') return { label: 'Failed', tone: 'fail', words: q.lastError ?? e.sendError };
  if (q?.status === 'pending' || q?.status === 'sending') {
    return { label: q.lastError ? 'Retrying' : 'Queued', tone: 'accent', words: q.lastError };
  }
  if (e.kind === 'break') return { label: 'Break', tone: 'muted' };
  const never = cannotSend(e);
  if (never) return { label: "Can't send", tone: 'warn', words: never };
  const waiting = waitingFor(e);
  if (waiting) return { label: 'Waiting', tone: 'warn', words: waiting };
  if (e.sendError) return { label: 'Not sent', tone: 'fail', words: e.sendError };
  const ready = sendReadiness(e);
  if (!ready.ready) return { label: 'Not sent', tone: 'muted', words: ready.why };
  return { label: 'To send', tone: 'muted' };
}
