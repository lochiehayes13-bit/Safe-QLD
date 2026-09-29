import { SIMPRO_PATHS } from './mirrorResources';

/**
 * What to do with a queued send that failed.
 *
 * The queue's four answers — try again, give up, stop the run, ask a person —
 * were decided inline in flushQueue, which loads the file system and cannot
 * be tested. The decision is here on its own, with nothing but the error and
 * the item to go on, because each answer is a different kind of loss when it
 * is wrong: a retry that should have been a give-up re-sends a photograph
 * five times over mobile data; a give-up that should have been a retry
 * strands a note behind a problem the office fixes in a minute; an unknown
 * that should have been a retry parks a technician's work on a screen for a
 * person to adjudicate; and a retry that should have been an unknown posts a
 * vendor order twice.
 *
 * The error is read structurally rather than through `instanceof SimproError`
 * so this stays free of the client module and its keystore.
 */

export type SendFailure =
  /** Final: no retry can mend it. The row is marked failed with the reason. */
  | { outcome: 'abandon'; reason: string }
  /** The server answered and did not act; one of the five attempts is spent. */
  | { outcome: 'retry'; reason: string }
  /**
   * Nothing after this item will go either. The run stops, the row is left
   * pending with its attempts untouched, and the reason goes to Settings.
   */
  | { outcome: 'stop'; reason: string; why: 'credentials' | 'throttled' | 'configuration' | 'offline' }
  /** The request went out and no answer came back. A person decides. */
  | { outcome: 'unknown'; reason: string };

/**
 * The client's error classes, by name.
 *
 * `network` never reached Simpro: nothing was sent, so nothing can have been
 * acted on. `credentials` is the token server refusing the sign-in, the
 * client ID or the secret. `unreadable` is a 2xx whose body could not be
 * read — the server acted, and only a person can say whether to send again.
 * Anything else with the base name is the ordinary case: a status where the
 * server answered, none where the request was never built.
 */
type ErrorClass = 'plain' | 'network' | 'credentials' | 'unreadable';

const ERROR_CLASS_BY_NAME: Record<string, ErrorClass> = {
  SimproError: 'plain',
  SimproNetworkError: 'network',
  SimproCredentialsError: 'credentials',
  SimproUnreadableReply: 'unreadable',
};

interface ErrorShape {
  isSimpro: boolean;
  kind: ErrorClass;
  status?: number;
  path?: string;
  message: string;
}

function shape(e: unknown): ErrorShape {
  const rec = (typeof e === 'object' && e !== null ? e : {}) as { status?: unknown; path?: unknown; name?: unknown };
  const kind = e instanceof Error ? ERROR_CLASS_BY_NAME[e.name] : undefined;
  return {
    isSimpro: kind !== undefined,
    kind: kind ?? 'plain',
    status: typeof rec.status === 'number' ? rec.status : undefined,
    path: typeof rec.path === 'string' ? rec.path : undefined,
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Statuses that mean the body itself was refused: the same bytes will be refused again. */
const BODY_REFUSED = new Set([400, 413, 415, 422]);

/**
 * The answer for one item that threw while being sent.
 *
 * A SimproError with a status is the server answering, so it did not act
 * and the item can go again — except when the answer is about the body of a
 * photograph on the attachment endpoint itself, where the next attempt
 * re-reads, re-encodes and re-sends megabytes to be told the same thing. The
 * path is checked because the token endpoint answers 400 too, for a secret
 * the office has regenerated, and that is fixed in Settings rather than by
 * giving up on the photograph. 401 and 403 stop the run for the same reason
 * they always have; 429 stops it because the next item will be throttled
 * too; a SimproError with no status never made a request at all. Anything
 * else is an answer that never came.
 */
export function sendFailure(item: { kind: string; jobId?: string }, e: unknown): SendFailure {
  const err = shape(e);
  if (!err.isSimpro) return { outcome: 'unknown', reason: err.message };
  // Nothing was sent, so nothing to vouch for: the run stops and the row
  // waits, attempts untouched, exactly as it would had the read before the
  // loop caught it.
  if (err.kind === 'network') return { outcome: 'stop', why: 'offline', reason: err.message };
  // The token server refused the sign-in itself, whatever status it chose;
  // a 400 for a regenerated secret must not read as a refused photograph.
  if (err.kind === 'credentials') return { outcome: 'stop', why: 'credentials', reason: err.message };
  // A 2xx the phone could not read: the server acted. Never retried by the
  // app, for the same reason as a request that got no reply at all.
  if (err.kind === 'unreadable') return { outcome: 'unknown', reason: err.message };
  if (err.status === 401 || err.status === 403) return { outcome: 'stop', why: 'credentials', reason: err.message };
  if (err.status === 429) return { outcome: 'stop', why: 'throttled', reason: err.message };
  if (err.status === undefined) return { outcome: 'stop', why: 'configuration', reason: err.message };
  if (
    item.kind === 'attachment' && item.jobId && BODY_REFUSED.has(err.status)
    && err.path === SIMPRO_PATHS.jobAttachments(item.jobId)
  ) {
    return { outcome: 'abandon', reason: err.message };
  }
  return { outcome: 'retry', reason: err.message };
}

/**
 * Whether a read made before the queue is touched says the office cannot be
 * reached at all.
 *
 * flushQueue reads one small collection first, so a phone in a basement, a
 * missing secret or a regenerated one fails there — before any item is
 * sent — rather than on the first item, where a token that never came back
 * looked exactly like a request that never came back and filed the item,
 * and every one after it, as unknown. A server that answers anything else
 * (a key with no permission on that endpoint, say) is a server that can be
 * reached, and the queue goes ahead.
 */
export function reachabilityFailure(e: unknown): Extract<SendFailure, { outcome: 'stop' }> | undefined {
  const err = shape(e);
  if (!err.isSimpro || err.kind === 'network') {
    return { outcome: 'stop', why: 'offline', reason: `Simpro could not be reached, so nothing was sent: ${err.message}` };
  }
  if (err.kind === 'credentials') return { outcome: 'stop', why: 'credentials', reason: err.message };
  // A 2xx with an unreadable body is still a server that can be reached.
  if (err.kind === 'unreadable') return undefined;
  if (err.status === 401) return { outcome: 'stop', why: 'credentials', reason: err.message };
  if (err.status === 429) return { outcome: 'stop', why: 'throttled', reason: err.message };
  if (err.status === undefined) return { outcome: 'stop', why: 'configuration', reason: err.message };
  return undefined;
}
