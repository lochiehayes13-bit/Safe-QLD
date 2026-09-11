import React from 'react';
import { Stack, router } from 'expo-router';
import { Button, EmptyState, Screen } from '@/components/ui';
import { missingContext, type ContextKind } from '@/domain/screenContext';

/**
 * What a screen shows when it needs a record and was not given one.
 *
 * The companion to RecordGate. That one answers "the record you asked for is
 * not here"; this one answers the question before it, "you did not ask for a
 * record at all" — which is what happens when one of these screens is reached
 * from search, from a hub row, or from a link saved before the site was
 * deleted. See `src/domain/screenContext.ts` for what each of them used to do
 * instead, and why an empty list was the worse of the two failures.
 *
 * It carries its own `Stack.Screen` title because the screens that use it
 * return before theirs, and a bare header with nothing under it is the exact
 * page this is here to stop.
 */
export function ContextGate({
  kind,
  what,
  title,
}: {
  /** The record the screen is about. */
  kind: ContextKind;
  /** What the screen would have shown, in a technician's words. */
  what: string;
  /** The screen's own header title, so the page still says where it is. */
  title: string;
}) {
  const missing = missingContext(kind, what);
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen>
        <EmptyState
          icon="map-marker-question-outline"
          title={missing.title}
          body={missing.body}
          action={<Button title={missing.actionLabel} onPress={() => router.push(missing.actionRoute as never)} />}
        />
      </Screen>
    </>
  );
}
