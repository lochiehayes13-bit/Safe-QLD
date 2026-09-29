import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { SitePick } from '@/db/repo';
import { useTheme } from '@/theme';
import { Card, Chip, Rowed, SearchBox, Txt } from '@/components/ui';

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
 * So it is a search box over the four things a person actually knows about a
 * site: what it is called, the suburb, the client, and the office's own
 * reference. Nothing is listed until something is typed except the handful
 * already in front of them, because a list of three thousand is not an
 * answer either.
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
      return first.length ? first : sites.slice(0, 8);
    }
    return sites
      .filter((s) => [s.name, s.suburb, s.clientName, s.siteRef, s.address]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)))
      .slice(0, 30);
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

      <SearchBox value={query} onChange={setQuery} placeholder="Name, suburb, client or the office's reference" />

      {matches.length === 0 ? (
        <Txt size="sm" tone="muted">
          {sites.length ? 'Nothing matched. Try fewer letters, or the suburb.' : 'No sites on this phone yet — sync first.'}
        </Txt>
      ) : null}

      {matches.map((s) => (
        <Card key={s.id} onPress={() => { onChange(s.id); setQuery(''); }}>
          <Txt weight={value === s.id ? '700' : '600'}>{s.name}</Txt>
          <Txt size="sm" tone="muted">
            {[s.suburb, s.clientName, s.siteRef].filter(Boolean).join(' · ') || 'No suburb recorded'}
          </Txt>
        </Card>
      ))}
    </View>
  );
}
