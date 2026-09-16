/**
 * The background sync, in a browser, where there is not one.
 *
 * The counterpart to ./autoSyncTask, split by filename the way the file and
 * mail layers are. It registers nothing, and that is the honest answer rather
 * than a gap: `expo-background-task` is a wrapper around iOS's
 * BGTaskScheduler and Android's WorkManager, and a web page has neither. The
 * nearest thing a browser offers is the Periodic Background Sync API, which
 * ships in Chrome only, only for an installed app, and only after the browser
 * has decided the site is used often enough — so an app that relied on it
 * would be silently unsynced on every iPhone, which is most of the people this
 * build exists for.
 *
 * What the web build does instead is real and is already wired: AutoSyncDriver
 * runs the same policy on a timer for as long as the tab is open, and browsers
 * keep a background tab's timers running — throttled to about once a minute,
 * which is well inside the five-minute tick. So a phone with the app open in
 * the background does keep syncing, and the rolling re-read in
 * ./autoSyncPolicy gets its slices from exactly those quiet ticks.
 *
 * A closed tab syncs nothing, and `backgroundSyncNote` says so on the settings
 * screen rather than leaving a switch that reads as more than it is.
 */

export const AUTO_SYNC_TASK = 'safeqld.autosync';

/** Unused here; kept so both halves offer the screens the same names. */
export const AUTO_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

/**
 * Nothing to register, and no error either.
 *
 * Returning a problem string would put a warning on the settings screen of
 * every browser, for a thing the browser was never going to do. The note
 * below is where that is said once, in a sentence.
 */
export async function registerAutoSyncTask(): Promise<string | null> {
  return null;
}

export async function unregisterAutoSyncTask(): Promise<void> {
  // Nothing was registered.
}

/** What the settings screen says about syncing while the app is not in front. */
export function backgroundSyncNote(): string {
  return 'In a browser this keeps running while the tab is open, including in the background. '
    + 'Close the tab and it stops until you open it again — install the app to the home screen '
    + 'and it keeps the tab alive longer.';
}
