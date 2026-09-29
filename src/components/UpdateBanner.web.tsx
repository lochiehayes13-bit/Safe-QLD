import React from 'react';

/**
 * The home screen's "new build available" card, in a browser: nothing.
 *
 * The phone's version offers an Android package to download and install over
 * the app. In a browser that offer is nonsense — there is nothing to install a
 * package into — and it was being made: the home screen in Chrome carried "New
 * build available · about 64.3 MB", a sixty-four megabyte file a desktop
 * cannot use and an iPhone cannot either, which is the whole reason the web
 * build exists.
 *
 * Worse than useless, it was misleading. The page making that offer was itself
 * a build behind, so the one update it could not mention was the one that
 * would have fixed it.
 *
 * A browser updates by loading the page again. That is `NewVersionStrip`,
 * which mounts in the root layout rather than here — the home screen is one
 * tab of six, and somebody who opens straight into Work would never see it.
 *
 * Returning null rather than deleting the mount site keeps the home screen one
 * file for both platforms, the way `files.ts` and `mail.ts` already are.
 */
export function UpdateBanner(): React.ReactElement | null {
  return null;
}
