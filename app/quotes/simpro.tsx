import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getCustomer, listQuotes, type QuoteRecord } from '@/db/mirrorRepo';
import { getSite } from '@/db/repo';
import { applyQuoteFilter, quoteState, statusSwatch, sumExTax, type QuoteListFilter } from '@/domain/jobPresentation';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Card, EmptyState, Rowed, Screen, SearchBox, Segmented, StatTile, Txt } from '@/components/ui';

/**
 * The office's quotes.
 *
 * A second source beside the quotes raised on this phone, not a replacement
 * for them: those are priced off the rate card here, these are priced by the
 * office in Simpro. The switch at the top is the same on both screens so
 * they read as two halves of one list.
 *
 * Totals shown are sell totals. The mirror holds no cost, so nothing here
 * could show a margin.
 */
export default function SimproQuotesScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; customerId?: string }>();
  const [quotes, setQuotes] = useState<QuoteRecord[] | null>(null);
  const [filter, setFilter] = useState<QuoteListFilter>('open');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (params.siteId) {
      const [rows, site] = await Promise.all([listQuotes({ siteId: params.siteId, limit: 2000 }), getSite(params.siteId)]);
      setQuotes(rows);
      setScope(site ? `at ${site.name}` : 'at this site');
    } else if (params.customerId) {
      const [rows, customer] = await Promise.all([
        listQuotes({ customerExternalId: params.customerId, limit: 2000 }),
        getCustomer(params.customerId),
      ]);
      setQuotes(rows);
      setScope(customer ? `for ${customer.name}` : 'for this customer');
    } else {
      setQuotes(await listQuotes({ limit: 5000 }));
      setScope(undefined);
    }
  }, [params.siteId, params.customerId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => applyQuoteFilter(quotes ?? [], filter, query), [quotes, filter, query]);
  const value = sumExTax(shown);

  const empty = (() => {
    if (quotes === null) return null;
    if (!quotes.length) {
      return {
        title: scope ? `No Simpro quotes ${scope}` : 'No Simpro quotes on this phone yet',
        body: 'Quotes come down with a sync once Simpro is connected in Settings. Quotes raised on this phone are under Ours.',
      };
    }
    if (query.trim()) return { title: 'Nothing matches', body: 'Try the quote number, the job number it became, or part of the site or customer.' };
    return { title: `No ${FILTER_WORD[filter]} quotes`, body: '' };
  })();

  return (
    <>
      <Stack.Screen options={{ title: scope ? `Simpro quotes ${scope}` : 'Quotes' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          {!scope ? (
            <Segmented
              value="simpro"
              onChange={(v) => { if (v === 'ours') router.replace('/quotes'); }}
              options={[{ value: 'ours', label: 'Ours on this phone' }, { value: 'simpro', label: 'Simpro' }]}
            />
          ) : null}
          <SearchBox value={query} onChange={setQuery} placeholder="Quote number, site, customer or job" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'approved', label: 'Approved' },
              { value: 'converted', label: 'Jobs' },
              { value: 'closed', label: 'Closed' },
              { value: 'all', label: 'All' },
            ]}
          />
          {quotes ? (
            <Rowed gap={2}>
              <StatTile label="Shown" value={shown.length} />
              <StatTile label="Value ex GST" value={formatCents(value)} tone={value ? 'default' : 'muted'} />
            </Rowed>
          ) : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(q) => q.externalId}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={empty ? <EmptyState title={empty.title} body={empty.body} icon="file-sign" /> : null}
          renderItem={({ item, index }) => {
            const row = <QuoteRow quote={item} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

const FILTER_WORD: Record<QuoteListFilter, string> = {
  open: 'open', approved: 'approved', converted: 'converted', closed: 'closed', all: '',
};

function QuoteRow({ quote: q }: { quote: QuoteRecord }) {
  const t = useTheme();
  const state = quoteState(q);
  const swatch = statusSwatch(q.statusColor, t.color.surface);
  const tone = { pass: t.color.pass, fail: t.color.fail, warn: t.color.warn, info: t.color.info, muted: t.color.textMuted }[state.tone];
  return (
    <Card onPress={() => router.push({ pathname: '/quotes/simpro/[id]', params: { id: q.externalId } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1 }}>
          <Rowed gap={1.5}>
            <View
              style={{
                width: 10, height: 10, borderRadius: 5, backgroundColor: swatch?.fill ?? tone,
                borderWidth: swatch?.outlined ? StyleSheet.hairlineWidth : 0, borderColor: t.color.textMuted,
              }}
            />
            <Txt size="xs" weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{state.label}</Txt>
            <Txt size="xs" tone="faint" mono>· Q{q.externalId}</Txt>
          </Rowed>
          <Txt weight="700" numberOfLines={1} style={{ marginTop: 3 }}>{q.siteName ?? q.name}</Txt>
          <Txt size="sm" tone="muted" numberOfLines={1}>{q.name}</Txt>
          {q.customerName ? <Txt size="sm" tone="faint" numberOfLines={1}>{q.customerName}</Txt> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {q.totalExTaxCents !== undefined ? <Txt weight="700">{formatCents(q.totalExTaxCents)}</Txt> : null}
          {q.dateIssued ? <Txt size="xs" tone="muted">Issued {formatAuDate(q.dateIssued)}</Txt> : null}
          {q.dueDate && !q.isClosed ? <Txt size="xs" tone="warn">Due {formatAuDate(q.dueDate)}</Txt> : null}
        </View>
      </Rowed>
    </Card>
  );
}
