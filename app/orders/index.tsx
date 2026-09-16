import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { countVendorOrders, searchVendorOrders, type VendorOrderRecord } from '@/db/moreRepo';
import { officeEmptyState, type EmptyStateWords } from '@/domain/deviceData';
import { describeLoadFailure } from '@/domain/loadFailure';
import { contextId } from '@/domain/screenContext';
import { everSynced } from '@/simpro/watermark';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, SearchBox, Segmented, StatusPill, Txt } from '@/components/ui';

/**
 * Purchase orders, as the office raised them.
 *
 * What a technician wants from this list is "has the part for this job been
 * ordered, and has it arrived" — so the list leads with the open orders,
 * and opened from a job it shows only that job's, from a supplier only
 * theirs. The search takes the order number, the supplier, the reference
 * or the job number, and runs in the database rather than over the rows
 * on screen — as does Open, and the two chip counts, because an office
 * with more open orders than one page holds must not read "nothing on
 * order" off the page.
 *
 * No prices. A purchase order's totals are what the company pays, and that
 * column does not exist on the phone.
 */

/** How many orders the list reads at once; the search reaches past it. */
const PAGE = 200;

type Filter = 'open' | 'all';

/**
 * Still on its way: not archived, and not at a stage the office closes an
 * order under. The same rule as `openOnly` in searchVendorOrders, kept in
 * step by hand; this copy colours the row, the database's picks the rows.
 */
function orderIsOpen(o: Pick<VendorOrderRecord, 'archived' | 'stage'>): boolean {
  if (o.archived) return false;
  const stage = (o.stage ?? '').trim().toLowerCase();
  return !['complete', 'completed', 'archived', 'cancelled', 'canceled'].includes(stage);
}

export default function OrdersScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ jobExternalId?: string; vendorExternalId?: string; vendorName?: string; q?: string }>();
  const jobExternalId = contextId(params.jobExternalId);
  const vendorExternalId = contextId(params.vendorExternalId);
  const vendorName = contextId(params.vendorName);
  const [typed, setTyped] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<VendorOrderRecord[] | null>(null);
  const [counts, setCounts] = useState<{ open: number; all: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [empty, setEmpty] = useState<EmptyStateWords | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setQuery(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const scope = { jobExternalId, vendorExternalId };
      const [found, open, all] = await Promise.all([
        searchVendorOrders(query, { ...scope, openOnly: filter === 'open', limit: PAGE }),
        countVendorOrders(query, { ...scope, openOnly: true }),
        countVendorOrders(query, scope),
      ]);
      setRows(found);
      setCounts({ open, all });
      if (!all && !query.trim() && !jobExternalId && !vendorExternalId) {
        const prefs = await loadPrefs();
        setEmpty(officeEmptyState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'purchase orders',
        ));
      } else {
        setEmpty(null);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the purchase orders'));
    }
  }, [query, jobExternalId, vendorExternalId, filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = rows ?? [];

  const title = jobExternalId
    ? `Orders for job ${jobExternalId}`
    : vendorExternalId ? `Orders with ${vendorName ?? `supplier ${vendorExternalId}`}` : 'Purchase orders';

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={typed} onChange={setTyped} placeholder="Order number, supplier, reference or job" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[{ value: 'open', label: `Open${counts ? ` ${counts.open}` : ''}` }, { value: 'all', label: `All${counts ? ` ${counts.all}` : ''}` }]}
          />
          {rows && rows.length >= PAGE ? (
            <Txt size="xs" tone="faint">The newest {PAGE} shown. Search to reach an older one.</Txt>
          ) : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(o) => o.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={failed ? <Banner tone="fail" title="The orders could not be read" body={failed} /> : null}
          ListEmptyComponent={rows === null && !failed ? null : (
            empty ? (
              <EmptyState icon="cart-outline" title={empty.title} body={empty.body} />
            ) : (
              <EmptyState
                icon="cart-outline"
                title={query.trim()
                  ? 'Nothing matched'
                  : filter === 'open' ? 'Nothing on order' : jobExternalId ? 'No orders for this job' : vendorExternalId ? 'No orders with this supplier' : 'No purchase orders'}
                body={query.trim()
                  ? 'Try the order number on its own, or part of the supplier name.'
                  : filter === 'open'
                    ? 'All shows the completed and archived ones as well.'
                    : 'The office has raised no purchase order the phone knows of.'}
              />
            )
          )}
          renderItem={({ item, index }) => {
            const row = <OrderRow order={item} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function OrderRow({ order: o }: { order: VendorOrderRecord }) {
  const t = useTheme();
  const open = orderIsOpen(o);
  return (
    <Card onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1 }}>
          <Rowed gap={1.5}>
            <Txt size="xs" weight="800" mono>PO {o.id}</Txt>
            {o.jobId ? <Txt size="xs" tone="faint">· Job {o.jobId}</Txt> : null}
          </Rowed>
          <Txt weight="700" numberOfLines={1} style={{ marginTop: 3 }}>{o.vendorName ?? 'Supplier not named'}</Txt>
          {o.reference ? <Txt size="sm" tone="muted" numberOfLines={1}>{o.reference}</Txt> : null}
          <Txt size="xs" tone="faint">
            {[o.orderType, o.dateIssued ? `Issued ${formatAuDate(o.dateIssued)}` : undefined, o.dueDate ? `Due ${formatAuDate(o.dueDate)}` : undefined]
              .filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusPill label={o.statusName ?? o.stage ?? (open ? 'Open' : 'Closed')} tone={o.archived ? 'muted' : open ? 'info' : 'pass'} />
          {o.archived ? <Chip label="Archived" /> : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
