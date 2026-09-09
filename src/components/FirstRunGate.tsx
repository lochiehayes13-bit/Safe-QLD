import { useEffect } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { loadPrefs } from '@/app-prefs';
import { firstRunStep } from '@/domain/firstRun';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { wasSignInSkipped } from '@/simpro/signInFlow';
import { isSignedIn } from '@/simpro/userSession';

/**
 * Opens the sign-in over the home screen on a phone that has never said
 * whose it is.
 *
 * Renders nothing. Mounted once by the root layout beside the sync driver,
 * and it decides once per launch: the answer lives in the preferences and
 * the keystore, and a person who has just pressed "Not now" must not be
 * asked again by the same process that took the answer. The decision itself
 * is in domain/firstRun, where it is tested.
 *
 * It waits for the navigator to exist. A push before the root navigator has
 * mounted is dropped on the floor by the router, silently, which would make
 * this gate look like it never fires on exactly the launch it is for.
 */

let asked = false;

export function FirstRunGate(): null {
  const navigation = useRootNavigationState();
  const ready = Boolean(navigation?.key);

  useEffect(() => {
    if (!ready || asked) return;
    asked = true;
    void (async () => {
      try {
        const prefs = await loadPrefs();
        const config = simproConfigFromPrefs(prefs);
        const [problem, signedIn, skipped] = await Promise.all([
          SimproClient.missingCredentials(config),
          isSignedIn(),
          wasSignInSkipped(),
        ]);
        const step = firstRunStep({
          connected: problem === null,
          signedIn,
          employeeId: prefs.simproEmployeeId,
          skippedSignIn: skipped,
        });
        if (step === 'signin') router.push('/signin');
      } catch {
        // A gate that cannot decide lets the app open. Settings still offers
        // the sign-in, and the home screen says when the phone is nobody's.
      }
    })();
  }, [ready]);

  return null;
}

/** Test-only: lets the gate ask again in the same process. */
export function resetFirstRunGate(): void {
  asked = false;
}
