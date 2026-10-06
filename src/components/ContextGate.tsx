import React, { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { Button, EmptyState, Screen, Txt } from '@/components/ui';
import { SitePicker } from '@/components/SitePicker';
import { listSitePicks, type SitePick } from '@/db/repo';
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
 *
 * **Picking in place, where the screen can say where to come back to.** The
 * one button used to push the sites tab. The site is findable there — the
 * whole table, the shared search, the cap announced — but every row on it
 * opens `/site/[id]`, so the module the person tapped is lost and they land on
 * the hub to hunt for it among sixteen tiles. That is not a rare path: the
 * standards library alone pushes these routes without a site more than two
 * hundred times, and the gate's own note names pinned tiles and search as the
 * other two ways in. So a screen that passes `backTo` gets a picker here and
 * is reopened with the site on it. Without `backTo` the button stands, which
 * is what the configuration and asset gates still use.
 */
export function ContextGate({
  kind,
  what,
  title,
  backTo,
}: {
  /** The record the screen is about. */
  kind: ContextKind;
  /** What the screen would have shown, in a technician's words. */
  what: string;
  /** The screen's own header title, so the page still says where it is. */
  title: string;
  /**
   * This screen's own pathname. Given it, a site gate picks here and reopens
   * the screen rather than sending somebody to the site hub to start again.
   */
  backTo?: string;
}) {
  const missing = missingContext(kind, what);
  const pickHere = kind === 'site' && !!backTo;
  const [sites, setSites] = useState<SitePick[] | null>(null);

  useEffect(() => {
    if (!pickHere) return undefined;
    let live = true;
    void (async () => {
      const rows = await listSitePicks().catch(() => null);
      if (live) setSites(rows);
    })();
    return () => { live = false; };
  }, [pickHere]);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen>
        <EmptyState
          icon="map-marker-question-outline"
          title={missing.title}
          body={missing.body}
          action={pickHere ? undefined : (
            <Button title={missing.actionLabel} onPress={() => router.push(missing.actionRoute as never)} />
          )}
        />
        {pickHere ? (
          sites === null ? (
            <Txt size="sm" tone="muted">Reading the site list…</Txt>
          ) : (
            <SitePicker
              sites={sites}
              label="Pick the site"
              onChange={(siteId) => router.replace({ pathname: backTo!, params: { siteId } } as never)}
            />
          )
        ) : null}
      </Screen>
    </>
  );
}
