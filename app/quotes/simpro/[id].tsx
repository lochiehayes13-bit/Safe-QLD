import React, { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { getQuoteFull, localJobId, type AttachmentRecord, type QuoteFull } from '@/db/mirrorRepo';
import { getJob } from '@/db/opsRepo';
import type { SimproCostCenter, SimproItem, SimproSection } from '@/simpro/mirrorResources';
import {
  attachmentIcon, contactActions, discountLabel, formatFileSize, formatQty, itemHeading, itemPrice, quoteState,
  relativeQldTime, sectionLineCount, sellTotalLine, stageLabel, statusSwatch, technicianLine,
} from '@/domain/jobPresentation';
import { qldMoment } from '@/domain/qldTime';
import { formatCents } from '@/domain/rates';
import { nowIso } from '@/db';
import { formatAuDate } from '@/export/sheets';
import { simproConfigFromPrefs } from '@/simpro/config';
import { syncQuoteDetail } from '@/simpro/sync';
import { describeOpenOutcome, openAttachment } from '@/services/simproAttachments';
import { useTheme } from '@/theme';
import { animateNextLayout } from '@/components/motion';
import { Button, Card, Chip, H2, Label, Rowed, Screen, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * One of the office's quotes, as the office holds it.
 *
 * The same shape as the job screen — the header, the sections and lines,
 * the notes, the files — because a quote is the job before it is a job.
 * Where it has become one, the job number leads and opens the job.
 *
 * Sell totals only. The mirror holds nothing else.
 */

type Refresh =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; partial: string[] }
  | { state: 'failed'; error: string };

export default function SimproQuoteScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [full, setFull] = useState<QuoteFull | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [jobHeld, setJobHeld] = useState(false);
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' });
  const [opening, setOpening] = useState<string | null>(null);
  const refreshing = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const f = await getQuoteFull(id);
      setFull(f);
      setMissing(!f);
      if (f?.quote.jobExternalId) setJobHeld(!!(await getJob(localJobId(f.quote.jobExternalId))));
      return f;
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this quote'));
    }
  }, [id]);

  const refreshFromOffice = useCallback(async (externalId: string) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setRefresh({ state: 'running' });
    try {
      const prefs = await loadPrefs();
      const outcome = await syncQuoteDetail(simproConfigFromPrefs(prefs), externalId);
      if (outcome.status === 'synced') {
        await load();
        setRefresh({ state: 'done', partial: outcome.partial });
      } else if (outcome.status === 'failed') {
        setRefresh({ state: 'failed', error: outcome.error });
      } else {
        setRefresh({ state: 'idle' });
      }
    } catch (e) {
      setRefresh({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      refreshing.current = false;
    }
  }, [load]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const f = await load();
      if (cancelled || !f) return;
      void refreshFromOffice(f.quote.externalId);
    })();
    return () => { cancelled = true; };
  }, [load, refreshFromOffice]));

  if (!full) return <RecordGate missing={missing} what="quote" failed={failed} onRetry={() => { void load(); }} />;

  const { quote: q } = full;
  const state = quoteState(q);
  const swatch = statusSwatch(q.statusColor, t.color.surface);
  const stage = stageLabel(q.stage);
  const sell = sellTotalLine(q.totalExTaxCents, q.totalIncTaxCents);
  const technicians = technicianLine(q.technicians);
  const contact = q.siteContact ?? q.customerContact;
  const contactWays = contactActions(contact);
  const now = nowIso();

  const open = async (a: AttachmentRecord) => {
    if (opening) return;
    setOpening(a.id);
    try {
      const outcome = await openAttachment({ kind: 'quote', externalId: q.externalId }, a);
      const words = describeOpenOutcome(outcome);
      if (words) showAlert(words.title, words.body);
      else await load();
    } catch (e) {
      // The spinner on the row stops either way; without this the tap simply
      // stopped meaning anything, which reads as the attachment being broken.
      showAlert('Could not open that attachment', describeActionFailure(e, 'open this attachment'));
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: `Quote ${q.externalId}` }} />
      <Screen>
        <Txt size="xl" weight="700">{q.name}</Txt>
        <Rowed gap={1.5} wrap>
          {swatch ? (
            <OfficePill label={state.label} fill={swatch.fill} outlined={swatch.outlined} />
          ) : (
            <StatusPill label={state.label} tone={state.tone} />
          )}
          {stage && stage !== state.label ? <Chip label={stage} /> : null}
          {q.customerStage && q.customerStage !== q.stage ? <Chip label={`Customer: ${q.customerStage}`} /> : null}
          {q.quoteType ? <Chip label={q.quoteType} /> : null}
        </Rowed>

        {q.jobExternalId ? (
          <Card
            // Only a tap target while the job is actually on the phone; a card
            // that opens "not on this device" is a dead end wearing a chevron.
            onPress={jobHeld ? () => router.push({ pathname: '/work/job/[id]', params: { id: localJobId(q.jobExternalId!) } }) : undefined}
          >
            <Rowed gap={3}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={24} color={t.color.pass} />
              <View style={{ flex: 1 }}>
                <Txt weight="700">Converted to job {q.jobExternalId}</Txt>
                <Txt size="sm" tone="muted">
                  {jobHeld ? 'Open the job for its lines, files and activity.' : 'The job is not on this phone yet; it comes with the next sync.'}
                </Txt>
              </View>
              {jobHeld ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
            </Rowed>
          </Card>
        ) : null}

        <Card>
          <MetaRow label="Quote no." value={`Q${q.externalId}`} mono />
          {q.orderNo ? <MetaRow label="Order no." value={q.orderNo} mono /> : null}
          {q.requestNo ? <MetaRow label="Request no." value={q.requestNo} mono /> : null}
          <MetaRow
            label="Customer"
            value={q.customerName ?? '—'}
            onPress={q.customerExternalId ? () => router.push({ pathname: '/customer/[id]', params: { id: q.customerExternalId! } }) : undefined}
          />
          {q.siteName ? (
            <MetaRow
              label="Site"
              value={q.siteName}
              hint={q.siteId ? undefined : 'Not matched to a site on this phone yet'}
              onPress={q.siteId ? () => router.push({ pathname: '/site/[id]', params: { id: q.siteId! } }) : undefined}
            />
          ) : null}
          {technicians ? <MetaRow label="Technicians" value={technicians} /> : null}
          {q.salesperson ? <MetaRow label="Salesperson" value={q.salesperson} /> : null}
          {q.projectManager ? <MetaRow label="Project manager" value={q.projectManager} /> : null}
          {q.dateIssued ? <MetaRow label="Issued" value={formatAuDate(q.dateIssued)} /> : null}
          {q.dateApproved ? <MetaRow label="Approved" value={formatAuDate(q.dateApproved)} /> : null}
          {q.dueDate ? <MetaRow label="Due" value={formatAuDate(q.dueDate)} /> : null}
          {q.validityDays !== undefined ? <MetaRow label="Valid for" value={`${q.validityDays} day${q.validityDays === 1 ? '' : 's'}`} /> : null}
          {sell ? <MetaRow label="Sell" value={sell} /> : null}
          {q.customerContract?.name || q.customerContract?.contractNo ? (
            <MetaRow label="Contract" value={[q.customerContract.name, q.customerContract.contractNo].filter(Boolean).join(' · ')} />
          ) : null}
          {q.tags.length ? (
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(2) }}>
              {q.tags.map((tag) => <Chip key={tag} label={tag} />)}
            </Rowed>
          ) : null}
        </Card>

        {contact ? (
          <Card>
            <Label>{q.siteContact ? 'Site contact' : 'Customer contact'}</Label>
            <Txt weight="700" style={{ marginTop: 4 }}>{contact.name || 'Unnamed contact'}</Txt>
            {contact.position ? <Txt size="sm" tone="muted">{contact.position}</Txt> : null}
            {contactWays.length ? (
              <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                {contactWays.map((w) => (
                  <Button
                    key={w.href}
                    title={w.label}
                    variant="secondary"
                    compact
                    icon={<MaterialCommunityIcons name={w.kind === 'email' ? 'email-outline' : w.kind === 'mobile' ? 'cellphone' : 'phone-outline'} size={18} color={t.color.text} />}
                    onPress={() => void Linking.openURL(w.href)}
                  />
                ))}
              </Rowed>
            ) : null}
          </Card>
        ) : null}

        {q.description ? (
          <>
            <H2>Description</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{q.description}</Txt></Card>
          </>
        ) : null}

        {q.notes ? (
          <>
            <H2>Office notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{q.notes}</Txt></Card>
          </>
        ) : null}

        <H2>Sections</H2>
        {full.sections.length ? (
          full.sections.map((s) => <SectionCard key={s.id} section={s} />)
        ) : (
          <NotYet synced={full.detailSynced} what="lines" none="The office has no sections or lines on this quote." />
        )}

        {full.notes.length ? (
          <>
            <H2>Notes</H2>
            {full.notes.map((n) => (
              <Card key={n.id}>
                {n.subject ? <Txt weight="700">{n.subject}</Txt> : null}
                {n.note ? <Txt size="sm" style={{ lineHeight: 20, marginTop: n.subject ? 4 : 0 }}>{n.note}</Txt> : null}
                <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>
                  {[n.createdBy, relativeQldTime(n.createdAt, now), n.visibleToCustomer ? 'Visible to customer' : undefined].filter(Boolean).join(' · ')}
                </Txt>
              </Card>
            ))}
          </>
        ) : null}

        <H2>Attachments</H2>
        {full.attachments.length ? (
          full.attachments.map((a) => (
            <Card key={a.id} onPress={() => void open(a)}>
              <Rowed gap={3}>
                <MaterialCommunityIcons name={attachmentIcon(a.mimeType, a.filename)} size={26} color={t.color.accentText} />
                <View style={{ flex: 1 }}>
                  <Txt weight="600" numberOfLines={2}>{a.filename}</Txt>
                  <Txt size="xs" tone="muted">
                    {[formatFileSize(a.sizeBytes), a.addedBy, a.dateAdded ? formatAuDate(a.dateAdded) : undefined, a.folder]
                      .filter(Boolean).join(' · ') || 'Details come with the file'}
                  </Txt>
                </View>
                {opening === a.id ? (
                  <Txt size="xs" tone="accent" weight="700">Fetching…</Txt>
                ) : a.localUri ? (
                  <Chip label="On phone" tone="pass" />
                ) : (
                  <MaterialCommunityIcons name="cloud-download-outline" size={20} color={t.color.textFaint} />
                )}
              </Rowed>
            </Card>
          ))
        ) : (
          <NotYet synced={full.detailSynced} what="files" none="Nothing is attached to this quote." />
        )}

        <View style={{ gap: 2 }}>
          {refresh.state === 'running' ? <Txt size="xs" tone="accent">Refreshing from Simpro…</Txt> : null}
          {refresh.state === 'done' && refresh.partial.length ? (
            <Txt size="xs" tone="warn">Refreshed, but the office would not hand over: {refresh.partial.join('; ')}</Txt>
          ) : null}
          {refresh.state === 'failed' ? (
            <Txt size="xs" tone="faint">Showing what the phone holds. Could not refresh: {refresh.error}</Txt>
          ) : null}
          <Txt size="xs" tone="faint">
            {q.detailSyncedAt
              ? `Office record as of ${qldMoment(q.detailSyncedAt) ?? q.detailSyncedAt}.`
              : 'The lines, notes and files under this quote have not been read yet. They come the first time it is opened with signal.'}
          </Txt>
        </View>
      </Screen>
    </>
  );
}

function OfficePill({ label, fill, outlined }: { label: string; fill: string; outlined: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: t.space(2.5), paddingVertical: t.space(1.5),
        borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt,
        borderWidth: 1, borderColor: outlined ? t.color.borderStrong : fill,
      }}
    >
      <View
        style={{
          width: 10, height: 10, borderRadius: 5, backgroundColor: fill,
          borderWidth: outlined ? StyleSheet.hairlineWidth : 0, borderColor: t.color.textMuted,
        }}
      />
      <Txt size="xs" weight="800">{label}</Txt>
    </View>
  );
}

function MetaRow({ label, value, hint, mono, onPress }: { label: string; value: string; hint?: string; mono?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space(3), minHeight: onPress ? 44 : undefined, paddingVertical: 4 }}>
      <Txt size="xs" tone="muted" weight="700" style={{ width: 96, textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 3 }}>{label}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'} mono={mono}>{value}</Txt>
        {hint ? <Txt size="xs" tone="faint">{hint}</Txt> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} style={{ paddingTop: 2 }} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}

function NotYet({ synced, what, none }: { synced: boolean; what: string; none: string }) {
  if (!synced) {
    return (
      <Txt size="sm" tone="faint" style={{ lineHeight: 19 }}>
        The {what} have not been read from the office yet — they come the first time this quote is opened with signal.
      </Txt>
    );
  }
  return none ? <Txt size="sm" tone="faint">{none}</Txt> : null;
}

function SectionCard({ section }: { section: SimproSection }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const lines = sectionLineCount(section);
  const total = section.costCenters.reduce((n, c) => n + (c.totalExTaxCents ?? 0), 0);
  const anyTotal = section.costCenters.some((c) => c.totalExTaxCents !== undefined);
  return (
    <Card onPress={() => { animateNextLayout(); setOpen((v) => !v); }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700">{section.name || 'Unnamed section'}</Txt>
          <Txt size="sm" tone="muted">
            {section.costCenters.length} cost centre{section.costCenters.length === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
            {anyTotal ? ` · ${formatCents(total)} ex GST` : ''}
          </Txt>
          {section.description && open ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{section.description}</Txt>
          ) : null}
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={t.color.textFaint} />
      </Rowed>
      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
          {section.costCenters.map((c) => <CostCenterBlock key={c.id} costCenter={c} />)}
        </View>
      ) : null}
    </Card>
  );
}

function CostCenterBlock({ costCenter: c }: { costCenter: SimproCostCenter }) {
  const t = useTheme();
  const total = sellTotalLine(c.totalExTaxCents, c.totalIncTaxCents);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border, paddingTop: t.space(3), gap: t.space(2) }}>
      <View>
        <Txt weight="700" size="sm">{c.name || c.setupCostCenterName || 'Cost centre'}</Txt>
        {total ? <Txt size="xs" tone="muted">{total}</Txt> : null}
      </View>
      {c.items.length ? c.items.map((it) => <ItemRow key={`${it.kind}-${it.id}`} item={it} />) : (
        <Txt size="xs" tone="faint">No lines under this cost centre.</Txt>
      )}
    </View>
  );
}

function ItemRow({ item }: { item: SimproItem }) {
  const t = useTheme();
  const price = itemPrice(item);
  return (
    <View style={{ flexDirection: 'row', gap: t.space(2), alignItems: 'flex-start' }}>
      <Txt size="sm" weight="700" mono style={{ minWidth: 52, textAlign: 'right' }}>{formatQty(item)}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm">{itemHeading(item)}</Txt>
        <Txt size="xs" tone="faint">
          {[item.partNo && item.partNo !== item.description ? item.partNo : undefined, price.unit, item.billableStatus, discountLabel(item)]
            .filter(Boolean).join(' · ')}
        </Txt>
      </View>
      {price.line ? <Txt size="sm" weight="700">{price.line}</Txt> : null}
    </View>
  );
}
