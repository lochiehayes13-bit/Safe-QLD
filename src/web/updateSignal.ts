/**
 * How the page's service worker tells the app a newer build is ready.
 *
 * The registration script in `scripts/webServiceWorker.js` runs in the head of
 * the document, before any of this bundle exists. It cannot import anything
 * and nothing can import it — it is a string of old-dialect JavaScript written
 * into the HTML at build time. So the two halves talk through the window: a
 * flag the script sets, an event it fires, and a function it leaves behind for
 * the app to call when somebody taps.
 *
 * Three names, agreed in two places, is exactly the kind of thing that drifts
 * the day one of them is renamed. `src/__tests__/webShell.test.ts` reads the
 * generated script and fails if these names are not the ones in it.
 *
 * Everything here is written for a browser that may refuse any of it. A page
 * with no service worker support, a registration the browser declined, a
 * profile where session storage throws — each of those ends with `updateReady`
 * returning false forever, which is the app exactly as it behaved before any
 * of this existed: online, current whenever it is reloaded by hand.
 */

/** Set on `window` the moment a newer build is waiting, for a listener that mounted late. */
export const UPDATE_READY_FLAG = '__safeqldUpdateReady';

/** Fired on `window` at the same moment, for one that was already there. */
export const UPDATE_READY_EVENT = 'safeqld:update-ready';

/** Left on `window` by the registration script: takes the waiting build and reloads. */
export const APPLY_UPDATE_FUNCTION = '__safeqldApplyUpdate';

type UpdateWindow = Window & {
  [UPDATE_READY_FLAG]?: boolean;
  [APPLY_UPDATE_FUNCTION]?: () => void;
};

function browserWindow(): UpdateWindow | null {
  return typeof window === 'undefined' ? null : (window as UpdateWindow);
}

/** Whether a newer build is waiting right now. */
export function updateReady(): boolean {
  return browserWindow()?.[UPDATE_READY_FLAG] === true;
}

/**
 * Calls back when a newer build becomes ready, and returns the unsubscribe.
 *
 * Fires immediately where one is already waiting, so a component that mounts
 * after the news does not have to check separately.
 */
export function onUpdateReady(listener: () => void): () => void {
  const w = browserWindow();
  if (!w) return () => {};
  if (updateReady()) listener();
  w.addEventListener(UPDATE_READY_EVENT, listener);
  return () => w.removeEventListener(UPDATE_READY_EVENT, listener);
}

/**
 * Takes the waiting build. The page reloads itself a moment later.
 *
 * Answers false where there is nothing to take or the script never ran, so the
 * caller can say so rather than showing a button that does nothing.
 */
export function applyUpdate(): boolean {
  const apply = browserWindow()?.[APPLY_UPDATE_FUNCTION];
  if (typeof apply !== 'function') return false;
  apply();
  return true;
}
