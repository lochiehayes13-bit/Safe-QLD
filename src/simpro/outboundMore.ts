import type { SimproClient } from './client';
import type { SimproResources } from './resources';

/**
 * Sending the newer kinds of field work to the office.
 *
 * ./sync's flushQueue sends the four original kinds — a job note, a purchase
 * order, an asset test, a photograph — and hands anything else here. Each
 * kind added since lands in this module: what the payload is, and the one
 * request that puts it in Simpro. The queue, the retries, the "did it arrive"
 * rules and the marker that stops a resend posting twice all stay in
 * flushQueue and ./sendOutcome; this module only knows how to send.
 *
 * A kind this module does not know is reported as such, and the queue closes
 * the row rather than retrying it forever, as it always has.
 */

export interface QueuedItem {
  id: string;
  kind: string;
  payload: unknown;
  /** The content key the queue de-duplicates on, where the kind has one. */
  contentKey?: string;
}

export interface SendDeps {
  client: SimproClient;
  api: SimproResources;
}

export type SendMoreOutcome =
  /** The request went out and the server said yes. */
  | { status: 'sent' }
  /** Nothing here sends this kind. */
  | { status: 'not-mine' };

/** The Simpro job an item is bound for, where it has one, for the failure rules. */
export function moreJobIdOf(kind: string, payload: unknown): string | undefined {
  void kind;
  const id = (payload as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'string' ? id : undefined;
}

export async function sendMore(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  void item;
  void deps;
  return { status: 'not-mine' };
}
