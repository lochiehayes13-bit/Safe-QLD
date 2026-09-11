/**
 * "Send the queue in a moment."
 *
 * Every function that queues outbound work calls this, so a note goes up the
 * moment there is signal rather than with the next sync somebody remembers to
 * run. It lives apart from ./autoSync because ./sync is one of the callers
 * and ./autoSync imports ./sync — the direct import would close a cycle, and
 * this app's import graph is kept acyclic by a test for good reason.
 *
 * So the runner is handed in rather than imported. Until ./autoSync has
 * loaded and handed it over, a call here does nothing, which is the right
 * answer for a test that only wanted to see something queued.
 */

/** Long enough to fold a burst of queued items into one trip, short enough not to feel like waiting. */
export const FLUSH_DEBOUNCE_MS = 2_000;

let runner: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function setFlushRunner(fn: () => void): void {
  runner = fn;
}

export function flushSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runner?.();
  }, FLUSH_DEBOUNCE_MS);
}
