import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { listSiteSummaries, type SiteSummary } from '@/db/repo';
import { Card, Txt } from '@/components/ui';

/**
 * The way out of a module's dead end: the buildings the typed words match.
 *
 * A module searches its own rows. When it has none, "Nothing matches" is the
 * true answer about that module and the wrong answer to the question — the
 * site is on this phone, the sites tab finds it on the same words, and the
 * person is told they mistyped the name of a building they are standing in.
 * That is the owner's complaint in the module where it keeps recurring.
 *
 * This was written inline on the job list and then needed on the quote list,
 * which is exactly how this app came to have four site searches covering four
 * different sets of columns. One definition, used by both, because the
 * differences are the bug.
 */

/**
 * The sites the words match, looked for only when the module came up empty.
 *
 * `worth` is the module's own judgement: something was typed, the module's own
 * rows came back empty, and the module has finished loading. An ordinary search
 * that finds something costs nothing extra — this never runs.
 */
export function useSiteMisses(term: string, worth: boolean, limit = 5): SiteSummary[] {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  useEffect(() => {
    let live = true;
    const typed = term.trim();
    /*
     * Every write goes through the promise, including the clear. A setState in
     * the effect body is a second render on every keystroke for a list that is
     * usually empty, and react-hooks/set-state-in-effect is right about it.
     */
    void (async () => {
      const rows = typed && worth
        ? await listSiteSummaries({ query: typed, limit }).then((p) => p.rows).catch(() => [])
        : [];
      if (live) setSites(rows);
    })();
    return () => { live = false; };
  }, [term, worth, limit]);
  return sites;
}

/**
 * Those sites as rows that open them.
 *
 * Deliberately plain: this is a way out of an empty screen, not a second list
 * competing with the one the person asked for.
 */
export function SiteMissCards({ sites }: { sites: SiteSummary[] }) {
  return (
    <>
      {sites.map((site) => (
        <Card key={site.id} onPress={() => router.push({ pathname: '/site/[id]', params: { id: site.id } })}>
          <Txt weight="700">{site.name}</Txt>
          <Txt size="sm" tone="muted">
            {[site.suburb, site.clientName].filter(Boolean).join(' · ') || 'No suburb recorded'}
          </Txt>
        </Card>
      ))}
    </>
  );
}
