import { useEffect } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { loadPrefs, patchPrefs } from '@/app-prefs';
import { listEmployees } from '@/db/employeeRepo';
import { firstRunStep } from '@/domain/firstRun';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { repairPick } from '@/simpro/identity';
import { wasSignInSkipped } from '@/simpro/signInFlow';
import { isSignedIn } from '@/simpro/userSession';

/**
 * Opens the way in over the home screen on a phone that has never said whose
 * it is.
 *
 * Renders nothing. Mounted once by the root layout beside the sync driver,
 * and it decides once per launch: the answer lives in the preferences and
 * the keystore, and a person who has just pressed "Not now" must not be
 * asked again by the same process that took the answer. The decision itself
 * is in domain/firstRun, where it is tested. What it opens is the staff
 * list: a password box is not the first thing a technician should meet, and
 * on this office's build it is one that cannot succeed.
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

        /*
         * Put a lost pick back before deciding whether to ask for one.
         *
         * Two screens used to write the whole settings blob back from a copy
         * read earlier, so a pick made in one could be undone by a save in the
         * other. Those are patches now and it cannot happen again — but every
         * phone that already lost one would be met by this gate asking the
         * question a second time, and the answer is sitting on the phone: the
         * name on the reports. Adopted only where it names exactly one person
         * who works here. The staff list is whatever the last sync left; no
         * request is made, because a gate must not wait on the network.
         */
        const repair = repairPick(prefs, await listEmployees({ includeArchived: true }));
        if (repair) await patchPrefs(repair);

        const step = firstRunStep({
          connected: problem === null,
          signedIn,
          employeeId: repair?.simproEmployeeId ?? prefs.simproEmployeeId,
          skippedSignIn: skipped,
        });
        if (step === 'whoami') router.push('/whoami');
      } catch {
        // A gate that cannot decide lets the app open. Settings still offers
        // both ways in, and the home screen says when the phone is nobody's.
      }
    })();
  }, [ready]);

  return null;
}

/** Test-only: lets the gate ask again in the same process. */
export function resetFirstRunGate(): void {
  asked = false;
}
