import { useEffect } from 'react';
import { Platform } from 'react-native';
import { applyConnection } from '@/simpro/applyConnection';
import { linkWithoutConnection, readConnectLink } from '@/simpro/connectLink';
import { showAlert } from '@/components/alert';

/**
 * Takes the office connection out of the link the app was opened with.
 *
 * Renders nothing. Mounted once by the root layout, after the database is
 * open, and does something on exactly one kind of start: a browser opened on
 * a link somebody was sent. Every other start reads the address, finds no
 * connection in it, and stops.
 *
 * Why it exists: a browser that has never been connected holds nothing at
 * all — no sites, no jobs, no diary — and the office key is what turns it
 * into the app. The key is not in the published files and must not be: this
 * repository is public and the built app is served to anyone who finds the
 * address. In a link it goes only to the people it is sent to.
 *
 * The address bar is rewritten the moment the link has been read, so the key
 * is not left in the bar to be screenshotted, read over a shoulder, or
 * carried into a bookmark or a shared tab. `replaceState` rather than a
 * navigation, so the back button does not go back to the link.
 */
export function ConnectLinkDriver(): null {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void (async () => {
      try {
        const href = typeof window === 'undefined' ? '' : window.location.href;
        const connection = readConnectLink(href);
        if (!connection) return;
        // Cleared first. If storing it fails the key is still off the
        // address bar, and Settings will say the connection is not set.
        window.history.replaceState(null, '', linkWithoutConnection(href));
        await applyConnection(connection);
        showAlert(
          'Connected to the office',
          'This browser now has the office key. Open Settings and press Sync to bring the sites, '
          + 'jobs and assets down — it takes a few minutes the first time, and after that everything '
          + 'works with no signal at all.',
        );
      } catch {
        showAlert(
          'That link could not be read',
          'The connection in it did not come through. Ask for the link again, or type the office '
          + 'key into Settings by hand.',
        );
      }
    })();
  }, []);
  return null;
}
