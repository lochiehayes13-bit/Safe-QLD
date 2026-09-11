/**
 * What to say when a read fails.
 *
 * Every screen in this app opens by reading something out of SQLite, and every
 * one of them was written as though that read always succeeds. It does not. A
 * phone that has run out of space, a database another process still has open, a
 * migration that stopped half way — each of those throws, and a throw inside an
 * `async` load called as `void load()` goes nowhere at all. The state the screen
 * was going to set is never set, so the record stays null, the spinner stays up
 * and the list stays empty. That last one is the dangerous shape: an empty list
 * under a heading like "Nothing lapsed" is not a blank screen, it is a wrong
 * answer about compliance, and it is indistinguishable from the true one.
 *
 * So the failure has to reach the screen, and it has to reach it in words. This
 * module is the words. It is deliberately pure — no database, no React, no
 * expo — because the one thing it must never do is fail while explaining a
 * failure.
 *
 * The rule it follows: name what could not be read, say what the device said,
 * and where the device said something a person can act on, say what to do. It
 * never swallows the original text. A technician reading "the database is
 * locked" can ring somebody who knows what that means; a technician reading
 * "Something went wrong" cannot, and neither can the person they ring.
 */

/**
 * A thrown value's message, however it was thrown.
 *
 * Repositories throw `Error`, the SQLite driver sometimes throws a bare string,
 * and a rejected promise can carry anything at all — including `undefined`,
 * which is what `throw undefined` and an aborted native call both produce.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return '';
}

/**
 * The advice that goes with a device message, where there is any.
 *
 * Matched on the substrings the SQLite and file-system layers actually produce,
 * lower-cased first because the driver is not consistent about capitals. Order
 * matters: "database or disk is full" also contains "database", so the specific
 * cases are tested before the general ones.
 */
function adviceFor(lower: string): string | undefined {
  if (/disk is full|no space|enospc|sqlite_full/.test(lower)) {
    return 'This device has run out of storage. Free some space — photos are usually the largest '
      + 'thing on a work phone — and try again. Nothing that was already saved has been lost.';
  }
  if (/database is locked|sqlite_busy|database table is locked/.test(lower)) {
    return 'Something else on the phone still has the database open. This usually clears on its '
      + 'own in a moment, so try again; if it does not, close the app fully and reopen it.';
  }
  if (/no such table|no such column|readonly database|file is not a database|malformed/.test(lower)) {
    return 'The app\'s own storage is not in the shape this build expects, which is not something '
      + 'to fix on site. Send this message to the office before doing more work in the app.';
  }
  if (/disk i\/o|sqlite_ioerr|input\/output error/.test(lower)) {
    return 'The phone could not read its own storage. Restart it and try again; if it keeps '
      + 'happening the handset needs looking at, not the app.';
  }
  if (/enoent|no such file|could not be found on disk/.test(lower)) {
    return 'A file this needed is not on the device any more. It may have been cleared to make '
      + 'room, in which case producing it again will rebuild it.';
  }
  if (/network|timed out|timeout|fetch failed|econnrefused|enotfound/.test(lower)) {
    return 'That step needed the office and could not reach it. Everything recorded on this phone '
      + 'is still here and still works offline.';
  }
  return undefined;
}

/**
 * The sentence a screen shows instead of a spinner that will never stop.
 *
 * `what` is what was being read, in a technician's words — "timesheet", "this
 * site's defects". It is written into the first line so the message says which
 * of the several reads on a screen gave up.
 */
export function describeLoadFailure(error: unknown, what: string): string {
  const message = messageOf(error);
  const opening = message
    ? `${capitalise(what)} could not be read: ${message}`
    : `${capitalise(what)} could not be read, and the device did not say why.`;
  const advice = adviceFor(message.toLowerCase());
  return advice ? `${opening}\n\n${advice}` : opening;
}

/**
 * The same sentence for something the technician asked the app to *do*.
 *
 * Reads and writes fail the same way and read very differently. "The timesheet
 * could not be read" is wrong when the read worked and it was writing the
 * spreadsheet that ran out of room, and a technician told the wrong one goes
 * looking in the wrong place. `what` is the action in a technician's words —
 * "export this timesheet", "create the test sheet" — and it is phrased as the
 * thing that did not happen, because that is what they were watching for.
 */
export function describeActionFailure(error: unknown, what: string): string {
  const message = messageOf(error);
  const opening = message
    ? `The app could not ${what}: ${message}`
    : `The app could not ${what}, and the device did not say why.`;
  const advice = adviceFor(message.toLowerCase());
  return advice ? `${opening}\n\n${advice}` : opening;
}

function capitalise(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return 'This';
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}
