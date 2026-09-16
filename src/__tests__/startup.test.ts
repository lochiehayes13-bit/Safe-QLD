import { STARTUP_PATIENCE_MS, startupStalled } from '@/domain/startup';

/**
 * The app itself, before it has started.
 *
 * The root layout opens the database before anything renders, and it handled a
 * rejection but not a promise that never settles. On the browser build — how
 * this app reaches an iPhone — a page refused its own storage gets exactly
 * that: no error, nothing ever coming back, and an `ActivityIndicator` on an
 * otherwise empty page for the rest of the session. Proved by taking the SQLite
 * worker away in a browser: twenty seconds in, `document.body.innerText` was
 * still the empty string.
 */

describe('waiting for the database', () => {
  it('waits long enough not to accuse a slow phone', () => {
    // A cold open plus a migration on an old handset is a few seconds. Anything
    // under about ten would tell people their app is broken while it works.
    expect(STARTUP_PATIENCE_MS).toBeGreaterThanOrEqual(10_000);
    expect(STARTUP_PATIENCE_MS).toBeLessThanOrEqual(30_000);
  });

  it('says how long it has been, because that is the part that varies', () => {
    expect(startupStalled(12).body).toContain('it has been 12');
    expect(startupStalled(240).body).toContain('it has been 240');
  });

  it('never reads as less than a second, however it is rounded', () => {
    expect(startupStalled(0.2).body).toContain('it has been 1');
  });

  it('does not claim the database is broken', () => {
    /*
     * It may be about to open. Saying it has failed would send somebody to
     * clear the app's storage — which deletes the sites and reports on the
     * device — over a slow start.
     */
    const said = `${startupStalled(15).title} ${startupStalled(15).body}`;
    expect(said).not.toMatch(/failed|broken|corrupt/i);
    expect(said).toMatch(/still waiting/i);
  });

  it('names what a person can actually do about it', () => {
    const body = startupStalled(15).body;
    expect(body).toMatch(/close it fully/i);
    expect(body).toMatch(/private window/i);
  });
});
