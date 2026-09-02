import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nowIso } from '@/db';
import { getCustomer, listInvoices, listJobsFor, type InvoiceRecord } from '@/db/mirrorRepo';
import { getSite } from '@/db/repo';
import { invoiceMatchesQuery, invoiceState, orderInvoices } from '@/domain/jobPresentation';
import { qldIsoDay } from '@/domain/qldTime';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Reveal } from '@/components/motion';
import { Card, EmptyState, Rowed, Screen, Segmented, StatTile, StatusPill, Txt } from '@/components/ui';

/**
 * The office's invoices, unpaid first.
 *
 * Two years of them, which is what the mirror keeps. Opened from a job it
 * shows the invoices that bill that job; from a customer, theirs; from a
 * site, the invoices against every job at the site. The figures are sell
 * totals and what is still owed — never a cost.
 */
export default function InvoicesScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; customerId?: string; jobExternalId?: string }>();
  const [invoices, setInvoices] = useState<InvoiceRecord[] | null>(null);
  const [filter, setFilter] = useState<'unpaid' | 'all'>('unpaid');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | undefined>(undefined);

  const today = qldIsoDay(nowIso()) ?? '';

  const load = useCallback(async () => {
    if (params.jobExternalId) {
      setInvoices(await listInvoices({ jobExternalId: params.jobExternalId, limit: 500 }));
      setScope(`for job ${params.jobExternalId}`);
    } else if (params.customerId) {
      const [rows, customer] = await Promise.all([
        listInvoices({ customerExternalId: params.customerId, limit: 2000 }),
        getCustomer(params.customerId),
      ]);
      setInvoices(rows);
      setScope(customer ? `for ${customer.name}` : 'for this customer');
    } else if (params.siteId) {
      // The mirror links an invoice to its jobs, and a job to its site, so a
      // site's invoices are the ones billing any of its jobs.
      const [jobs, all, site] = await Promise.all([
        listJobsFor({ siteId: params.siteId, limit: 5000 }),
        listInvoices({ limit: 10000 }),
        getSite(params.siteId),
      ]);
      const ids = new Set(jobs.map((j) => j.externalId).filter((x): x is string => !!x));
      setInvoices(all.filter((inv) => inv.jobs.some((j) => ids.has(j.id))));
      setScope(site ? `at ${site.name}` : 'at this site');
    } else {
      setInvoices(await listInvoices({ limit: 10000 }));
      setScope(undefined);
    }
  }, [params.siteId, params.customerId, params.jobExternalId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => {
    const rows = (invoices ?? []).filter((inv) => (filter === 'all' || !inv.isPaid) && invoiceMatchesQuery(inv, query));
    return orderInvoices(rows);
  }, [invoices, filter, query]);

  const unpaid = (invoices ?? []).filter((inv) => !inv.isPaid);
  const owed = unpaid.reduce((n, inv) => n + (inv.balanceDueCents ?? inv.totalIncTaxCents ?? 0), 0);
  const overdue = unpaid.filter((inv) => inv.dueDate && inv.dueDate < today).length;

  const empty = (() => {
    if (invoices === null) return null;
    if (!invoices.length) {
      return {
        title: scope ? `No invoices ${scope}` : 'No invoices on this phone yet',
        body: 'The last two years of invoices come down with a sync once Simpro is connected in Settings.',
      };
    }
    if (query.trim()) return { title: 'Nothing matches', body: 'Try the invoice number, the job number it bills, or part of the customer.' };
    if (filter === 'unpaid') return { title: 'Nothing unpaid', body: 'Every invoice the phone holds has been paid.' };
    return { title: 'No invoices', body: '' };
  })();

  return (
    <>
      <Stack.Screen options={{ title: scope ? `Invoices ${scope}` : 'Invoices' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
          <SearchBox value={query} onChange={setQuery} placeholder="Invoice, job number or customer" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[{ value: 'unpaid', label: 'Unpaid' }, { value: 'all', label: 'All' }]}
          />
          {invoices ? (
            <Rowed gap={2}>
              <StatTile label="Unpaid" value={unpaid.length} tone={unpaid.length ? 'warn' : 'muted'} />
              <StatTile label="Overdue" value={overdue} tone={overdue ? 'fail' : 'muted'} />
              <StatTile label="Owed" value={formatCents(owed)} tone={owed ? 'default' : 'muted'} />
            </Rowed>
          ) : null}
        </View>
        <FlatList
          data={shown}
          keyExtractor={(inv) => inv.externalId}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          ListEmptyComponent={empty ? <EmptyState title={empty.title} body={empty.body} icon="receipt-text-outline" /> : null}
          renderItem={({ item, index }) => {
            const row = <InvoiceRow invoice={item} today={today} />;
            return index < 12 ? <Reveal index={index}>{row}</Reveal> : row;
          }}
        />
      </Screen>
    </>
  );
}

function InvoiceRow({ invoice: inv, today }: { invoice: InvoiceRecord; today: string }) {
  const state = invoiceState(inv, today);
  const jobs = inv.jobs.map((j) => `#${j.id}`).join(', ');
  return (
    <Card onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.externalId } })}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1 }}>
          <Txt weight="700">Invoice {inv.externalId}</Txt>
          {inv.customerName ? <Txt size="sm" tone="muted" numberOfLines={1}>{inv.customerName}</Txt> : null}
          <Txt size="xs" tone="faint" numberOfLines={1}>
            {[inv.dateIssued ? `Issued ${formatAuDate(inv.dateIssued)}` : undefined, jobs ? `Job${inv.jobs.length === 1 ? '' : 's'} ${jobs}` : undefined, inv.orderNo ? `PO ${inv.orderNo}` : undefined]
              .filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {inv.totalIncTaxCents !== undefined ? <Txt weight="700">{formatCents(inv.totalIncTaxCents)}</Txt> : null}
          {!inv.isPaid && inv.balanceDueCents !== undefined && inv.balanceDueCents !== inv.totalIncTaxCents ? (
            <Txt size="xs" tone="muted">{formatCents(inv.balanceDueCents)} owing</Txt>
          ) : null}
          <StatusPill label={state.label} tone={state.tone} />
        </View>
      </Rowed>
    </Card>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: t.space(2),
        backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.color.border,
        paddingHorizontal: t.space(3), minHeight: t.touch,
      }}
    >
      <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.color.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md, minHeight: t.touch }}
      />
      {value ? (
        <MaterialCommunityIcons name="close-circle" size={20} color={t.color.textFaint} onPress={() => onChange('')} />
      ) : null}
    </View>
  );
}
