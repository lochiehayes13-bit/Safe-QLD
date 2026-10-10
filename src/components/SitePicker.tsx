import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { SitePick } from '@/db/repo';
import { useTheme } from '@/theme';
import { Card, Chip, Rowed, SearchBox, Txt } from '@/components/ui';
import { siteMatches } from '@/domain/siteSearch';
import { siteIsArchived } from '@/domain/siteNames';

/**
 * How many matches the picker draws, and how many it offers before anything is
 * typed.
 *
 * Named, and said on screen when it bites. Rows cut silently from a search are
 * the same fault as a list with no search: somebody types a client name, sees
 * thirty of their forty sites, and has no way of knowing the other ten exist.
 *
 * It was thirty, which is below the number of sites a single client on this
 * book has. The cut is cheap to raise — these rows are already in memory,
 * fetched by the screen that opened the picker — and a cut that bites is worth
 * avoiding even when it is disclosed, because the line under the list is read
 * by nobody who has already found what they wanted.
 */
const PICKER_MATCHES = 60;
const PICKER_SUGGESTIONS = 8;

/**
 * Picking one site out of three thousand.
 *
 * Two screens offered every site the phone holds as a horizontal strip of
 * chips. On a technician's phone with the office's whole book on it that is a
 * strip you scroll for a minute and give up on, and the site you want is
 * usually not the one nearest the left. Worse, both were feeding it from a
 * query that returns every column of every row — contacts, notes, timestamps
 * — to draw a name.
 *
 * So it is a search box over what a person actually has: what the building is
 * called, its address, suburb and postcode, the client, the office's reference
 * and the office's own site number. Which columns those are is decided in
 * src/domain/siteSearch.ts and not here, because four searches in this app
 * each had their own list and the differences were the bug.
 *
 * Nothing is listed until something is typed except the handful already in
 * front of them, because a list of three thousand is not an answer either.
 */
export function SitePicker({
  sites,
  value,
  onChange,
  label = 'Site',
  /** Shown first, before anything is typed: the sites this screen already knows about. */
  suggested = [],
}: {
  sites: readonly SitePick[];
  value?: string;
  onChange: (siteId: string) => void;
  label?: string;
  suggested?: readonly string[];
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');

  const chosen = useMemo(() => sites.find((s) => s.id === value), [sites, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const first = suggested
        .map((id) => sites.find((s) => s.id === id))
        .filter((s): s is SitePick => Boolean(s));
      return first.length ? first : sites.slice(0, PICKER_SUGGESTIONS);
    }
    /*
     * The same columns, and the same prefix rule for the office's number, as
     * the SQL searches use — src/domain/siteSearch.ts holds both. A picker
     * filtering rows it already has must not disagree with the screen that
     * fetched them.
     */
    return sites.filter((s) => siteMatches(s, query)).slice(0, PICKER_MATCHES);
  }, [sites, query, suggested]);

  return (
    <View style={{ gap: t.space(2) }}>
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Txt>

      {chosen ? (
        <Rowed align="center" gap={2}>
          <Chip label={chosen.name} selected onPress={() => setQuery('')} />
          <Txt size="sm" tone="muted" style={{ flex: 1 }}>
            {[chosen.suburb, chosen.clientName].filter(Boolean).join(' · ')}
          </Txt>
        </Rowed>
      ) : null}

      <SearchBox value={query} onChange={setQuery} placeholder="Name, suburb, client or site number" />

      {matches.length === 0 ? (
        <Txt size="sm" tone="muted">
          {sites.length ? 'Nothing matched. Try fewer letters, or the suburb.' : 'No sites on this phone yet — sync first.'}
        </Txt>
      ) : null}

      {/*
        * Said when it bites, because a silent cut is the same fault as no
        * search: somebody types a client name, sees thirty of their forty
        * sites, and has no way of knowing the other ten are there.
        */}
      {matches.length === PICKER_MATCHES ? (
        <Txt size="xs" tone="faint">
          First {PICKER_MATCHES} matches. Add the suburb or the client to narrow it.
        </Txt>
      ) : null}

      {matches.map((s) => (
        <Card key={s.id} onPress={() => { onChange(s.id); setQuery(''); }}>
          <Txt weight={value === s.id ? '700' : '600'}>{s.name}</Txt>
          <Txt size="sm" tone="muted">
            {[s.suburb, s.clientName, s.siteRef].filter(Boolean).join(' · ') || 'No suburb recorded'}
          </Txt>
          {/* Offered like any other site, and said so, because work does get
              done at a building after the office archives it. */}
          {siteIsArchived(s) ? <Txt size="xs" tone="warn">Archived in the office system</Txt> : null}
        </Card>
      ))}
    </View>
  );
}
