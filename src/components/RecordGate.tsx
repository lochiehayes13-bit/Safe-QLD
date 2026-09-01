import React from 'react';
import { router } from 'expo-router';
import { Button, EmptyState, Screen, Txt } from '@/components/ui';

/**
 * What a screen shows before its record arrives, and what it shows if it never does.
 *
 * Every record screen in this app opened with the same line: if the record is
 * null, show "Loading…". That is right for the second it takes to read a row,
 * and wrong for ever after — because a record that does not exist produces
 * exactly the same null. A technician following a link to a job somebody
 * deleted, or opening a shared pack that references a site this device does not
 * have, got a spinner that never resolved and no way to tell whether the app
 * was slow or broken.
 *
 * Two states, not one. Still loading says so; loaded-and-absent says the record
 * is not here, guesses at why in a sentence a technician can act on, and offers
 * the way back. The screens have to tell the two apart themselves — nothing here
 * can know — which is the point: a screen that cannot say whether it finished
 * looking has not finished looking.
 *
 * Deliberately not a timeout. "It has been four seconds so it is probably gone"
 * is a guess that is wrong on a cold database and right most other times, and a
 * wrong "this was deleted" is worse than a slow spinner.
 */
export function RecordGate({
  missing,
  what,
  why,
}: {
  /** True once the load finished and found nothing. False while it is still going. */
  missing: boolean;
  /** What was being opened, in a technician's words: "job", "service report". */
  what: string;
  /** Anything the screen knows about why, beyond the general case. */
  why?: string;
}) {
  if (!missing) {
    return (
      <Screen>
        <Txt tone="muted">Loading…</Txt>
      </Screen>
    );
  }

  return (
    <Screen>
      <EmptyState
        title={`That ${what} is not on this device`}
        body={why
          ?? `It may have been deleted, or the link may have come from a share pack or another `
            + `handset that has it and this one does not. Nothing has been lost here — there is `
            + `simply no ${what} with that reference to open.`}
        action={<Button title="Go back" onPress={() => router.back()} />}
      />
    </Screen>
  );
}
