import type { SimproClient } from './client';
import type { SimproResources } from './resources';

/**
 * What every sender of queued field work agrees on.
 *
 * The queue in ./sync hands anything it does not send itself to
 * ./outboundMore, which sends the clock's hours and then asks the register
 * module and the calendar module in turn. Three modules, one contract, so
 * it lives on its own: a module that imported the contract from the one
 * that calls it would import its way back to itself, and this app's import
 * graph is kept acyclic by a test for good reason.
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
  /** Nothing to send: the entry is gone from the phone, or the office already holds it. The row is done. */
  | { status: 'done' }
  /** Nothing was sent and never will be from this row; the reason is for a person. */
  | { status: 'abandon'; reason: string }
  /**
   * Not yet: the row stays pending, untouched, for a later run. For a
   * change that carries a moment to take it back before it goes.
   */
  | { status: 'later' }
  /** Nothing here sends this kind. */
  | { status: 'not-mine' };
