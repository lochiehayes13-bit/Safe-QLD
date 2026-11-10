/**
 * What to say when the app has not started yet.
 *
 * The root layout opens and migrates the database before any screen renders, so
 * screens can assume a schema instead of each guarding for one. That is the
 * right trade and it has one failure the code did not cover: a `getDb()` that
 * neither resolves nor rejects. The layout handles a rejection — it says the
 * database could not be opened and what to do — but a promise that simply never
 * settles leaves the first `ActivityIndicator` on screen for ever, with no
 * text on the page at all. Not a slow start: a spinner, alone, permanently.
 *
 * It is not hypothetical on the build that reaches an iPhone. The web driver
 * runs SQLite in a worker over origin-private storage, and a browser that
 * refuses the page storage — a private window, a device with site data blocked,
 * a worker that will not start behind a proxy — gives exactly that: no error to
 * catch, and nothing that ever comes back.
 *
 * So there is a deadline, and this module is what it says when it passes. Note
 * what it deliberately does not say. It does not say the database is broken,
 * because it may be about to open; it does not stop waiting, so an app that was
 * merely slow still starts by itself; and it does not offer a "retry" that
 * would open a second connection to a database the first one may still be
 * holding. It says what is happening, how long it has been, and the two things
 * a person can actually do — which is the difference between a screen that is
 * failing and a screen that is failing silently.
 *
 * `RecordGate` refuses a timeout for the opposite case, and both are right: a
 * timeout there would assert that a record was deleted, which is a claim about
 * facts and can be wrong. This asserts only that time has passed.
 */

/**
 * How long the app may take to open its database before it says something.
 *
 * A cold database on an old handset that is also running a migration is a few
 * seconds; twelve is comfortably past that and still inside the time somebody
 * will sit and look at a phone before deciding it has hung.
 */
export const STARTUP_PATIENCE_MS = 12_000;

export interface StartupNotice {
  title: string;
  body: string;
}

/**
 * The notice under the spinner once the deadline has passed.
 *
 * `seconds` is how long it has actually been, because "it is taking a while" is
 * what an app says at four seconds and at four minutes, and the difference
 * between those is the whole of what somebody needs to know.
 */
export function startupStalled(seconds: number): StartupNotice {
  const waited = Math.max(1, Math.round(seconds));
  return {
    title: 'Still opening the database',
    body:
      `This normally takes a second or two, and it has been ${waited}. The app is still waiting `
      + 'and will start on its own if the storage comes back. If it does not: close it fully and '
      + 'open it again, and if you are in a browser, check that this site is allowed to store data '
      + '— a private window will not let it.',
  };
}
