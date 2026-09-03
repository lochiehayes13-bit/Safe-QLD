import React from 'react';
import { router } from 'expo-router';
import { Button, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

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
 * Three states, not one. Still loading says so; loaded-and-absent says the
 * record is not here, guesses at why in a sentence a technician can act on, and
 * offers the way back; and the read having *failed* says that, which is the
 * state this gate was missing for as long as it has existed. A load written as
 * `void load()` throws into nothing — the record is never set, `missing` is
 * never set either, and the screen goes back to the endless spinner the gate
 * was built to abolish, this time with the failure invisible. So a screen has
 * to be able to say "I looked and could not", and that is `failed`.
 *
 * The screens have to tell the three apart themselves — nothing here can know —
 * which is the point: a screen that cannot say whether it finished looking has
 * not finished looking.
 *
 * Deliberately not a timeout. "It has been four seconds so it is probably gone"
 * is a guess that is wrong on a cold database and right most other times, and a
 * wrong "this was deleted" is worse than a slow spinner.
 */
export function RecordGate({
  missing,
  what,
  why,
  failed,
  onRetry,
}: {
  /** True once the load finished and found nothing. False while it is still going. */
  missing: boolean;
  /** What was being opened, in a technician's words: "job", "service report". */
  what: string;
  /** Anything the screen knows about why, beyond the general case. */
  why?: string;
  /**
   * Set when the read itself threw, to the sentence from `describeLoadFailure`.
   * Takes precedence over `missing`: a read that failed did not find nothing,
   * it found out nothing, and telling somebody their job was deleted because
   * the disk was full is the wrong answer twice over.
   */
  failed?: string | null;
  /** Runs the load again. Without it the failure state is a dead end. */
  onRetry?: () => void;
}) {
  if (failed) {
    return (
      <Screen>
        <EmptyState
          icon="database-alert-outline"
          title={`This ${what} could not be opened`}
          body={failed}
          action={
            <Rowed gap={2}>
              {onRetry ? <Button title="Try again" onPress={onRetry} /> : null}
              <Button title="Go back" variant="secondary" onPress={() => router.back()} />
            </Rowed>
          }
        />
      </Screen>
    );
  }

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
