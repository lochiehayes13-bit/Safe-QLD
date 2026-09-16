import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getVendorOrder, type VendorOrderFull } from '@/db/moreRepo';
import { getJob } from '@/db/opsRepo';
import { localJobId } from '@/db/mirrorRepo';
import { formatNumber } from '@/domain/jobPresentation';
import { describeLoadFailure } from '@/domain/loadFailure';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Card, Chip, H2, Rowed, Screen, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * One purchase order: who it went to, which job it is for, and what has
 * turned up.
 *
 * The lines carry an ordered and a received quantity and nothing else. The
 * phone never holds what the company paid for a part, so there is no price
 * column on the line and no total on the order — and that is not a gap in
 * the sync, it is the rule. What a technician needs from this screen is
 * "is the part here yet", and the received column answers it.
 */
export default function OrderScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<VendorOrderFull | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  // Whether the job it is for is on this phone, so the row can open it.
  const [jobHeld, setJobHeld] = useState(false);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      setFailed(null);
      try {
        const o = await getVendorOrder(id);
        if (cancelled) return;
        setOrder(o);
        setMissing(!o);
        if (o?.jobId) {
          const job = await getJob(localJobId(o.jobId));
          if (!cancelled) setJobHeld(!!job);
        }
      } catch (e) {
        if (!cancelled) setFailed(describeLoadFailure(e, 'this purchase order'));
      }
    })();
    return () => { cancelled = true; };
  }, [id, reloads]));

  if (!order) {
    return (
      <RecordGate
        missing={missing}
        what="purchase order"
        why="Purchase orders come down with a sync once Simpro is connected. This one is not on the phone yet, or the office has removed it."
        failed={failed}
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  }

  const o = order;
  const stage = (o.stage ?? '').trim().toLowerCase();
  const closed = o.archived || ['complete', 'completed', 'archived', 'cancelled', 'canceled'].includes(stage);
  const received = o.lines.reduce((n, l) => n + (l.qtyReceived ?? 0), 0);
  const ordered = o.lines.reduce((n, l) => n + (l.qtyOrdered ?? 0), 0);

  return (
    <>
      <Stack.Screen options={{ title: `PO ${o.id}` }} />
      <Screen>
        <Txt size="xl" weight="700">Purchase order {o.id}</Txt>
        <Rowed gap={1.5} wrap>
          <StatusPill label={o.statusName ?? o.stage ?? (closed ? 'Closed' : 'Open')} tone={o.archived ? 'muted' : closed ? 'pass' : 'info'} />
          {o.orderType ? <Chip label={o.orderType} /> : null}
          {o.stage && o.stage !== o.statusName ? <Chip label={o.stage} /> : null}
          {o.archived ? <Chip label="Archived" /> : null}
        </Rowed>

        <Card>
          <MetaRow
            label="Supplier"
            value={o.vendorName ?? '—'}
            onPress={o.vendorId ? () => router.push({ pathname: '/vendors/[id]', params: { id: o.vendorId! } }) : undefined}
          />
          <MetaRow
            label="Job"
            value={o.jobId ? `Job ${o.jobId}${jobHeld ? '' : ' — not on this phone yet'}` : 'Not for a job'}
            onPress={o.jobId && jobHeld ? () => router.push({ pathname: '/work/job/[id]', params: { id: localJobId(o.jobId!) } }) : undefined}
          />
          {o.reference ? <MetaRow label="Reference" value={o.reference} /> : null}
          {o.quoteNo ? <MetaRow label="Quote no." value={o.quoteNo} mono /> : null}
          {o.dateIssued ? <MetaRow label="Issued" value={formatAuDate(o.dateIssued)} /> : null}
          {o.dueDate ? <MetaRow label="Due" value={formatAuDate(o.dueDate)} /> : null}
          {o.assignedToName ? <MetaRow label="Assigned to" value={o.assignedToName} /> : null}
          {o.createdByName ? <MetaRow label="Raised by" value={o.createdByName} /> : null}
        </Card>

        {o.vendorNotes ? (
          <>
            <H2>Notes to the supplier</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{o.vendorNotes}</Txt></Card>
          </>
        ) : null}
        {o.privateNotes ? (
          <>
            <H2>Office notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{o.privateNotes}</Txt></Card>
          </>
        ) : null}

        <H2>Lines</H2>
        {o.lines.length ? (
          <>
            <Txt size="xs" tone="faint">
              {o.lines.length} line{o.lines.length === 1 ? '' : 's'} · {formatNumber(received)} of {formatNumber(ordered)} received
            </Txt>
            {o.lines.map((l) => {
              const got = l.qtyReceived ?? 0;
              const want = l.qtyOrdered ?? 0;
              const tone = want > 0 && got >= want ? 'pass' : got > 0 ? 'warn' : 'muted';
              return (
                <Card key={`${l.kind}-${l.id}`}>
                  <Rowed gap={3} align="flex-start">
                    <View style={{ flex: 1 }}>
                      {l.partNo ? <Txt mono size="sm" weight="700" tone="accent">{l.partNo}</Txt> : null}
                      <Txt weight="600">{l.description || (l.kind === 'oneOff' ? 'One-off item' : 'Catalogue item')}</Txt>
                      <Txt size="xs" tone="faint">
                        {[l.kind === 'oneOff' ? 'One-off' : 'Catalogue', l.dueDate ? `Due ${formatAuDate(l.dueDate)}` : undefined].filter(Boolean).join(' · ')}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Txt size="lg" weight="700" tone={tone}>{formatNumber(got)} / {formatNumber(want)}</Txt>
                      <Txt size="xs" tone="muted">received / ordered</Txt>
                    </View>
                  </Rowed>
                </Card>
              );
            })}
          </>
        ) : (
          <Txt size="sm" tone="faint">
            {o.detailSyncedAt
              ? 'The office has no lines on this order.'
              : 'The lines have not been read yet. They come down the next time the phone syncs with signal; orders against a job you have open are read first.'}
          </Txt>
        )}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
          Simpro purchase order {o.id}.{o.dateModified ? ` Last changed at the office ${formatAuDate(o.dateModified)}.` : ''} Quantities only — the phone holds no prices on an order.
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
