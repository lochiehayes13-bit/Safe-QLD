import React from 'react';

/**
 * "A newer version is ready", on a phone: nothing.
 *
 * The Android build updates by installing a package over itself, which is the
 * home screen's `UpdateBanner`. Only a browser updates by loading the page
 * again, so only the browser half of this pair draws anything — see
 * ./NewVersionStrip.web.tsx.
 *
 * It is a pair rather than a `Platform.OS` check inside one file because that
 * is how this app splits a platform, and because the browser half has to
 * import `@/web/updateSignal`, which reads `window`. A file the phone never
 * evaluates cannot go looking for a window that is not there.
 */
export function NewVersionStrip(): React.ReactElement | null {
  return null;
}
