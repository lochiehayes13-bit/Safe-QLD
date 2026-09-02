import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { loadPrefs } from '@/app-prefs';
import { runAutoSync } from '@/simpro/autoSync';
import { networkLooksOnline } from '@/simpro/autoSyncPolicy';
import { registerAutoSyncTask, unregisterAutoSyncTask } from '@/simpro/autoSyncTask';

/**
 * Wires the automatic sync to the moments it should run.
 *
 * Renders nothing. Mounted once by the root layout after the database is
 * open, so nothing here has to guard for a schema that is not there yet.
 *
 * The moments: the app opening, the app coming back to the front, and signal
 * coming back — a technician walking up out of a plant room is the moment a
 * morning's notes can finally go. The background task covers the phone
 * sitting in the van between jobs; importing it is what defines it.
 */
export function AutoSyncDriver(): null {
  useEffect(() => {
    void runAutoSync('launch');
    void reconcileTask();

    let removeAppState = () => {};
    try {
      const sub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;
        void runAutoSync('foreground');
        // The preference may have changed while the app was open, and the
        // system drops a registration whose task it could not find.
        void reconcileTask();
      });
      removeAppState = () => sub.remove();
    } catch {
      // Without AppState there is still launch, signal and the background task.
    }

    let removeNetwork = () => {};
    try {
      // Null until the first reading, so a listener that fires "connected" on
      // attach is not mistaken for signal coming back.
      let wasOnline: boolean | null = null;
      void Network.getNetworkStateAsync()
        .then((state) => {
          if (wasOnline === null) wasOnline = networkLooksOnline(state);
        })
        .catch(() => {});
      const sub = Network.addNetworkStateListener((state) => {
        const online = networkLooksOnline(state);
        if (online && wasOnline === false) void runAutoSync('online');
        wasOnline = online;
      });
      removeNetwork = () => sub.remove();
    } catch {
      // No network events on this platform; the other moments still apply.
    }

    return () => {
      removeAppState();
      removeNetwork();
    };
  }, []);

  return null;
}

/** Matches the background task's registration to the preference. Never throws. */
async function reconcileTask(): Promise<void> {
  try {
    const prefs = await loadPrefs();
    if (prefs.autoSync) await registerAutoSyncTask();
    else await unregisterAutoSyncTask();
  } catch {
    // Both calls swallow their own failures; this catches loadPrefs, which
    // already falls back to defaults and should not throw either.
  }
}
