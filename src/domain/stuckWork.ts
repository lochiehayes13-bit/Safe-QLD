import { qldMoment } from '@/domain/qldTime';

/**
 * Work that left a technician's hands and never arrived.
 *
 * Everything this app sends to the office goes through a queue, and the queue
 * is right to exist: a pump room has no signal, and a defect written down there
 * has to survive the drive out. What the queue does not do is speak. An item
 * that has failed sits in it; an item that went out and got no reply sits in
 * it; and an item queued on a Tuesday in a basement, on a phone that has not
 * had a working connection since, sits in it too. None of that reaches the
 * technician, who has done the work, watched the app say "on the way to the
 * office", and has no reason to look again.
 *
 * The home screen is where they would look, so this is what it says there. The
 * three states are deliberately not collapsed into a count, because they need
 * different things:
 *
 * - **Failed** is the office refusing it. Somebody has to look.
 * - **Unknown** is a send with no reply. It may be in Simpro twice or not at
 *   all, and only a person reading Simpro can say which — so it is never
 *   retried on its own.
 * - **Waiting too long** is not a failure at all. Nothing is wrong with the
 *   item; the phone has not been able to reach the office since it was made,
 *   and after a day that stops being normal.
 *
 * A queue with items in it from this morning is not stuck and says nothing.
 * The whole value of this strip is that it is silent when things are working.
 */

export interface QueueItem {
  createdAt: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
  kind?: string;
}

/**
 * How long a pending item may sit before it is worth mentioning.
 *
 * A day. Shorter and it fires on every technician who spends a morning in a
 * carpark, which teaches them to ignore it; much longer and a week's work can
 * quietly not arrive. It is the phone's own clock either way, so the figure
 * cannot be exact and does not need to be.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface StuckWork {
  failed: number;
  unknown: number;
  /** Pending, and queued more than STALE_AFTER_MS ago. */
  waiting: number;
  /** The oldest thing that is stuck, whichever kind it is. */
  oldestAt?: string;
  /** True where there is nothing to say. */
  clear: boolean;
}

export function assessQueue(
  items: readonly QueueItem[],
  attachments: { pending: number; unknown: number; failed: number } | undefined,
  now: string,
): StuckWork {
  const asAt = Date.parse(now);
  let failed = 0;
  let unknown = 0;
  let waiting = 0;
  let oldest: number | undefined;

  const note = (at: string) => {
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return;
    if (oldest === undefined || t < oldest) oldest = t;
  };

  for (const item of items) {
    if (item.status === 'failed') { failed += 1; note(item.createdAt); continue; }
    if (item.status === 'unknown') { unknown += 1; note(item.createdAt); continue; }
    if (item.status !== 'pending') continue;
    const made = Date.parse(item.createdAt);
    /*
     * A createdAt that will not parse is treated as stale rather than ignored.
     * A row this app cannot date is a row it cannot vouch for, and the safe
     * direction is to put it in front of somebody.
     */
    if (!Number.isFinite(made) || (Number.isFinite(asAt) && asAt - made > STALE_AFTER_MS)) {
      waiting += 1;
      note(item.createdAt);
    }
  }

  /*
   * Attachments are counted but not dated. They live in their own table with
   * its own summary, which gives totals rather than rows — and a photograph
   * that will not upload is the same problem to a technician as a note that
   * will not send, so it belongs in the same sentence.
   */
  failed += attachments?.failed ?? 0;
  unknown += attachments?.unknown ?? 0;

  return {
    failed,
    unknown,
    waiting,
    oldestAt: oldest === undefined ? undefined : new Date(oldest).toISOString(),
    clear: failed === 0 && unknown === 0 && waiting === 0,
  };
}

export interface StuckWords {
  title: string;
  body: string;
  tone: 'fail' | 'warn';
}

/**
 * The strip's words.
 *
 * Written to be read by somebody who is not going to open the outbound screen
 * unless this sentence makes them: what is stuck, since when, and what it
 * means for them. "3 items in the queue" makes nobody do anything.
 */
export function stuckWords(s: StuckWork): StuckWords | undefined {
  if (s.clear) return undefined;

  const parts: string[] = [];
  if (s.failed) parts.push(`${s.failed} ${s.failed === 1 ? 'thing the office refused' : 'things the office refused'}`);
  if (s.unknown) parts.push(`${s.unknown} the phone cannot vouch for`);
  if (s.waiting) parts.push(`${s.waiting} still waiting to go`);

  const since = s.oldestAt ? qldMoment(s.oldestAt) : undefined;
  const worst = s.failed > 0 ? 'fail' : 'warn';

  return {
    tone: worst,
    title: s.failed
      ? 'Work has not reached the office'
      : 'Work is still waiting to reach the office',
    body: [
      `${parts.join(', ')}.`,
      since ? `The oldest has been sitting since ${since}.` : '',
      s.failed
        ? 'It is not in Simpro. Open Waiting to send and either fix it or say what happened.'
        : s.unknown
          ? 'A send that got no reply may be in Simpro twice or not at all, and only a person reading Simpro can tell. Open Waiting to send.'
          : 'The phone has not been able to reach the office since. Check the connection, then open Waiting to send.',
    ].filter(Boolean).join(' '),
  };
}
