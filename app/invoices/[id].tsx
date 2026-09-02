import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nowIso } from '@/db';
import { getInvoice, getJobFull, localJobId, type InvoiceRecord } from '@/db/mirrorRepo';
import type { SimproCostCenter } from '@/simpro/mirrorResources';
import { invoiceState, sellTotalLine } from '@/domain/jobPresentation';
import { qldIsoDay } from '@/domain/qldTime';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Card, Chip, H2, Rowed, Screen, StatTile, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * One invoice: what it bills, for whom, and where it stands.
 *
 * The cost centres shown under each job are the job's own, read from the
 * job mirror where the job has been opened on this phone. Simpro's invoice
 * record carries its own cost-centre breakdown, but the mirror does not
 * hold it, so the job's is the nearest true thing — and it says so.
 */

interface BilledJob {
  id: string;
  type?: string;
  description?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  /** Whether the job itself is on the phone, so the row can open it. */
  held: boolean;
  siteName?: string;
  title?: string;
  costCenters: SimproCostCenter[];
  detailSynced: boolean;
}

export default function InvoiceScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [jobs, setJobs] = useState<BilledJob[]>([]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      const inv = await getInvoice(id);
      if (cancelled) return;
      setInvoice(inv);
      setMissing(!inv);
      if (!inv) return;
      const billed = await Promise.all(inv.jobs.map(async (j): Promise<BilledJob> => {
        const full = await getJobFull(localJobId(j.id));
        return {
          ...j,
          held: !!full,
          siteName: full?.job.siteName,
          title: full?.job.title,
          costCenters: full ? full.sections.flatMap((s) => s.costCenters) : [],
          detailSynced: full?.detailSynced ?? false,
        };
      }));
      if (!cancelled) setJobs(billed);
    })();
    return () => { cancelled = true; };
  }, [id]));

  if (!invoice) {
    return (
      <RecordGate
        missing={missing}
        what="invoice"
        why="The phone holds the last two years of invoices from Simpro. This one is older than that, or has not come down yet."
      />
    );
  }

  const inv = invoice;
  const today = qldIsoDay(nowIso()) ?? '';
  const state = invoiceState(inv, today);
  const total = sellTotalLine(inv.totalExTaxCents, inv.totalIncTaxCents);

  return (
    <>
      <Stack.Screen options={{ title: `Invoice ${inv.externalId}` }} />
      <Screen>
        <Txt size="xl" weight="700">Invoice {inv.externalId}</Txt>
        <Rowed gap={1.5} wrap>
          <StatusPill label={state.label} tone={state.tone} />
          {inv.invoiceType ? <Chip label={inv.invoiceType} /> : null}
          {inv.stage ? <Chip label={inv.stage} /> : null}
          {inv.statusName && inv.statusName !== state.label ? <Chip label={inv.statusName} /> : null}
        </Rowed>

        <Rowed gap={2}>
          <StatTile label="Total inc GST" value={inv.totalIncTaxCents !== undefined ? formatCents(inv.totalIncTaxCents) : '—'} />
          <StatTile
            label="Balance due"
            value={inv.balanceDueCents !== undefined ? formatCents(inv.balanceDueCents) : inv.isPaid ? '$0.00' : '—'}
            tone={!inv.isPaid && (inv.balanceDueCents ?? 0) > 0 ? (state.tone === 'fail' ? 'fail' : 'warn') : 'default'}
          />
        </Rowed>

        <Card>
          <MetaRow
            label="Customer"
            value={inv.customerName ?? '—'}
            onPress={inv.customerExternalId ? () => router.push({ pathname: '/customer/[id]', params: { id: inv.customerExternalId! } }) : undefined}
          />
          {inv.orderNo ? <MetaRow label="Order no." value={inv.orderNo} mono /> : null}
          {inv.dateIssued ? <MetaRow label="Issued" value={formatAuDate(inv.dateIssued)} /> : null}
          {inv.dueDate ? <MetaRow label="Due" value={formatAuDate(inv.dueDate)} /> : null}
          {inv.datePaid ? <MetaRow label="Paid" value={formatAuDate(inv.datePaid)} /> : null}
          {inv.periodStart || inv.periodEnd ? (
            <MetaRow label="Period" value={[formatAuDate(inv.periodStart), formatAuDate(inv.periodEnd)].filter(Boolean).join(' – ')} />
          ) : null}
          {total ? <MetaRow label="Total" value={total} /> : null}
          {inv.amountAppliedCents !== undefined ? <MetaRow label="Paid so far" value={formatCents(inv.amountAppliedCents)} /> : null}
        </Card>

        {inv.description ? (
          <>
            <H2>Description</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{inv.description}</Txt></Card>
          </>
        ) : null}

        {inv.notes ? (
          <>
            <H2>Notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{inv.notes}</Txt></Card>
          </>
        ) : null}

        <H2>Jobs billed</H2>
        {jobs.length ? (
          jobs.map((j) => (
            <Card key={j.id} onPress={j.held ? () => router.push({ pathname: '/work/job/[id]', params: { id: localJobId(j.id) } }) : undefined}>
              <Rowed gap={3} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">Job {j.id}{j.siteName ? ` · ${j.siteName}` : ''}</Txt>
                  {j.title || j.description ? <Txt size="sm" tone="muted">{j.title ?? j.description}</Txt> : null}
                  {j.description && j.title && j.description !== j.title ? <Txt size="xs" tone="faint">{j.description}</Txt> : null}
                  {sellTotalLine(j.totalExTaxCents, j.totalIncTaxCents) ? (
                    <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>{sellTotalLine(j.totalExTaxCents, j.totalIncTaxCents)}</Txt>
                  ) : null}
                  {!j.held ? <Txt size="xs" tone="faint">This job is not on the phone yet.</Txt> : null}
                </View>
                {j.type ? <Chip label={j.type} /> : null}
                {j.held ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
              </Rowed>
              {j.held ? (
                <View style={{ marginTop: t.space(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border, paddingTop: t.space(2), gap: t.space(1.5) }}>
                  {j.costCenters.length ? (
                    j.costCenters.map((c) => (
                      <Rowed key={c.id} gap={2} align="flex-start">
                        <Txt size="sm" style={{ flex: 1 }}>{c.name || c.setupCostCenterName || 'Cost centre'}</Txt>
                        {c.totalExTaxCents !== undefined ? <Txt size="sm" weight="700">{formatCents(c.totalExTaxCents)}</Txt> : null}
                      </Rowed>
                    ))
                  ) : (
                    <Txt size="xs" tone="faint">
                      {j.detailSynced ? 'No cost centres on the job.' : 'The job’s cost centres have not been read yet — open the job with signal.'}
                    </Txt>
                  )}
                  {j.costCenters.length ? <Txt size="xs" tone="faint">The job’s cost centres, ex GST, as the phone holds them.</Txt> : null}
                </View>
              ) : null}
            </Card>
          ))
        ) : (
          <Txt size="sm" tone="faint">
            {inv.detailSyncedAt ? 'This invoice is not linked to a job.' : 'Which jobs this bills comes with the invoice record, on the next sync.'}
          </Txt>
        )}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
          Simpro invoice {inv.externalId}.{inv.dateModified ? ` Last changed at the office ${formatAuDate(inv.dateModified)}.` : ''}
        </Txt>
      </Screen>
    </>
  );
}

function MetaRow({ label, value, mono, onPress }: { label: string; value: string; mono?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space(3), minHeight: onPress ? 44 : undefined, paddingVertical: 4 }}>
      <Txt size="xs" tone="muted" weight="700" style={{ width: 96, textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 3 }}>{label}</Txt>
      <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'} mono={mono} style={{ flex: 1 }}>{value}</Txt>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} style={{ paddingTop: 2 }} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}
