/**
 * What to say on a device that holds nothing yet.
 *
 * Every list in this app opens the same way: read the rows, and if there are
 * none, say so. That was written for a phone somebody had already connected to
 * the office, where "No sites yet — add a site first" is true and useful.
 *
 * It is neither on a device that has simply never been connected. Open the web
 * app in a browser, or a fresh install on a new handset, and every screen says
 * some version of "add one first" — the timesheet's job picker says nothing
 * matches, the baseline record refuses because there is no building, the map
 * has no pins — and all of it reads as an app that does not work. The office's
 * three thousand sites and four and a half thousand jobs are one sync away,
 * and nothing on screen says so.
 *
 * So the empty state asks a different question first: does this device hold
 * anything at all, and does it know how to reach the office? The answer
 * decides whether the right words are "connect this device", "sync", or the
 * ordinary "add one".
 *
 * Pure on purpose: the screens pass in what they counted.
 */

export interface DeviceDataState {
  /** Rows of the thing the screen lists — sites, jobs, assets. */
  held: number;
  /** Whether the office connection has been set up on this device at all. */
  connected: boolean;
  /** Whether anything has ever been pulled from the office onto this device. */
  everSynced: boolean;
}

export interface EmptyStateWords {
  title: string;
  body: string;
  /** The one thing worth doing, where there is one. */
  action?: { label: string; route: '/settings' | '/site/new' };
}

/**
 * The empty state for a list of the office's own records — sites, jobs,
 * customers, quotes, invoices, assets.
 *
 * `what` names them in the plural, as the sentence would read it: "sites",
 * "jobs on this device".
 */
export function officeEmptyState(state: DeviceDataState, what: string): EmptyStateWords {
  if (state.held > 0) {
    return { title: `Nothing matched`, body: `No ${what} here match what you typed.` };
  }
  if (!state.connected) {
    return {
      title: 'This device is not connected yet',
      body:
        `The office's ${what} live in Simpro, and nothing has been pulled onto this device. `
        + 'Connect it once in Settings and everything comes down — on a phone, in a browser, '
        + 'wherever this is open.',
      action: { label: 'Connect to the office', route: '/settings' },
    };
  }
  if (!state.everSynced) {
    return {
      title: 'Nothing has come down yet',
      body:
        `This device knows how to reach the office but has not pulled the ${what} yet. `
        + 'Sync from Settings, or leave it a few minutes on a connection and it will do it itself.',
      action: { label: 'Open Settings', route: '/settings' },
    };
  }
  return {
    title: `No ${what} yet`,
    body: `The office has no ${what} for this device, or the last sync brought none down.`,
    action: { label: 'Open Settings', route: '/settings' },
  };
}

/**
 * The empty state for something the technician makes here rather than the
 * office sends — a baseline record, a report, a form — which needs a building
 * to belong to.
 *
 * The distinction matters: telling somebody to add a site by hand, on a device
 * that is one sync away from three thousand of them, is telling them to do the
 * wrong thing.
 */
export function needsSiteState(state: DeviceDataState, what: string): EmptyStateWords {
  if (state.held > 0) return { title: 'Pick a site', body: `${what} belongs to a building — choose which one.` };
  if (!state.connected) {
    return {
      title: 'No sites on this device yet',
      body:
        `${what} belongs to a building, and this device has none. Connect it to the office in `
        + 'Settings to bring the sites down, or add one by hand if this is somewhere new.',
      action: { label: 'Connect to the office', route: '/settings' },
    };
  }
  return {
    title: 'No sites on this device yet',
    body:
      `${what} belongs to a building. Sync from Settings to bring the office's sites down, or add `
      + 'one by hand if this is somewhere new.',
    action: { label: 'Add a site', route: '/site/new' },
  };
}
