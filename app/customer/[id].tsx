import React, { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nowIso } from '@/db';
import {
  customerStats, getCustomer, listInvoices, listJobsFor, listQuotes,
  type CustomerRecord, type CustomerStats, type InvoiceRecord, type QuoteRecord,
} from '@/db/mirrorRepo';
import type { JobRecord } from '@/db/opsRepo';
import { listSites } from '@/db/repo';
import {
  contactActions, customerKindLabel, formatAddress, invoiceState, jobStatusWord, mailHref, mapHref, quoteState, telHref,
} from '@/domain/jobPresentation';
import { qldIsoDay } from '@/domain/qldTime';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, H2, Label, Rowed, Screen, SectionHeader, StatTile, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * A customer, as the office holds them.
 *
 * The id is Simpro's own customer number, which is what a job and a quote
 * carry, so this screen is one tap from either. What a technician wants on
 * arrival is here: who to ring, where they are, what they owe and what we
 * have done for them — and their sites, each opening the site on this phone
 * where the sync has matched it.
 *
 * Nothing commercial. Rates, credit terms and banking were never mirrored.
 */
export default function CustomerScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [siteIds, setSiteIds] = useState<Map<string, string>>(new Map());
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      const c = await getCustomer(id);
      if (cancelled) return;
      setCustomer(c);
      setMissing(!c);
      if (!c) return;
      const [s, sites, j, q, inv] = await Promise.all([
        customerStats(id),
        listSites(),
        listJobsFor({ customerExternalId: id, limit: 6 }),
        listQuotes({ customerExternalId: id, limit: 6 }),
        listInvoices({ customerExternalId: id, limit: 6 }),
      ]);
      if (cancelled) return;
      setStats(s);
      // The office's site number to the phone's site id, for the sites list.
      setSiteIds(new Map(sites.filter((x) => x.externalId).map((x) => [x.externalId!, x.id])));
      setJobs(j); setQuotes(q); setInvoices(inv);
    })();
    return () => { cancelled = true; };
  }, [id]));

  if (!customer) {
    return (
      <RecordGate
        missing={missing}
        what="customer"
        why="Customers come down with a sync once Simpro is connected. This one is not on the phone yet, or the office has removed it."
      />
    );
  }

  const c = customer;
  const today = qldIsoDay(nowIso()) ?? '';
  const address = formatAddress(c.address);
  const billing = formatAddress(c.billingAddress);
  const phone = telHref(c.phone);
  const altPhone = telHref(c.altPhone);
  const email = mailHref(c.email);
  const site = mapHref(address);

  return (
    <>
      <Stack.Screen options={{ title: c.name }} />
      <Screen>
        <Txt size="xl" weight="700">{c.name}</Txt>
        <Rowed gap={1.5} wrap>
          <Chip label={customerKindLabel(c.kind)} />
          {c.customerType ? <Chip label={c.customerType} /> : null}
          {c.customerGroup ? <Chip label={c.customerGroup} /> : null}
          {c.tags.map((tag) => <Chip key={tag} label={tag} />)}
          <Chip label={`#${c.externalId}`} />
        </Rowed>
        {c.archived ? (
          <Banner tone="warn" title="Archived in Simpro" body="The office has filed this customer away. Check before doing work under their name." />
        ) : null}

        <Card>
          <Label>Reach them</Label>
          <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
            {phone && c.phone ? <ActionRow icon="phone-outline" label={c.phone} onPress={() => void Linking.openURL(phone)} /> : null}
            {altPhone && c.altPhone ? <ActionRow icon="phone-outline" label={c.altPhone} sub="Alternate" onPress={() => void Linking.openURL(altPhone)} /> : null}
            {email && c.email ? <ActionRow icon="email-outline" label={c.email} onPress={() => void Linking.openURL(email)} /> : null}
            {c.website ? (
              <ActionRow
                icon="web"
                label={c.website}
                onPress={() => void Linking.openURL(/^https?:\/\//i.test(c.website!) ? c.website! : `https://${c.website}`)}
              />
            ) : null}
            {address ? <ActionRow icon="map-marker-outline" label={address} onPress={site ? () => void Linking.openURL(site) : undefined} /> : null}
            {billing && billing !== address ? <ActionRow icon="mailbox-outline" label={billing} sub="Billing" /> : null}
            {!phone && !email && !address ? (
              <Txt size="sm" tone="faint">
                {c.detailSyncedAt ? 'The office has no phone, email or address for them.' : 'Only the name has come down so far; the rest comes with the next full sync.'}
              </Txt>
            ) : null}
          </View>
        </Card>

        {c.notes ? (
          <Card>
            <Label>Office notes</Label>
            <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{c.notes}</Txt>
          </Card>
        ) : null}

        {stats ? (
          <>
            <Rowed gap={2}>
              <StatTile label="Jobs done" value={Math.max(0, stats.jobsTotal - stats.jobsOpen)} />
              <StatTile label="Open" value={stats.jobsOpen} tone={stats.jobsOpen ? 'warn' : 'default'} />
              <StatTile label="Open quotes" value={stats.quotesOpen} />
            </Rowed>
            <Rowed gap={2}>
              <StatTile label="Last job" value={stats.lastJobAt ? formatAuDate(stats.lastJobAt) : '—'} />
              <StatTile
                label="Unpaid"
                value={formatCents(stats.invoicesUnpaidCents)}
                tone={stats.invoicesUnpaidCents ? 'fail' : 'default'}
              />
            </Rowed>
          </>
        ) : null}

        <H2>Contacts</H2>
        {c.contacts.length ? (
          c.contacts.map((p, i) => {
            const ways = contactActions(p);
            return (
              <Card key={p.id ?? `${p.name}-${i}`}>
                <Txt weight="700">{p.name || 'Unnamed contact'}</Txt>
                {p.position ? <Txt size="sm" tone="muted">{p.position}</Txt> : null}
                {ways.length ? (
                  <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                    {ways.map((w) => (
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
            );
          })
        ) : (
          <Txt size="sm" tone="faint">
            {c.detailSyncedAt ? 'The office lists no contacts for this customer.' : 'Contacts come with the full customer record, on the next full sync.'}
          </Txt>
        )}

        <H2>Sites</H2>
        {c.sites.length ? (
          c.sites.map((s) => {
            const local = siteIds.get(s.id);
            return (
              <Card key={s.id} onPress={local ? () => router.push({ pathname: '/site/[id]', params: { id: local } }) : undefined}>
                <Rowed gap={3}>
                  <MaterialCommunityIcons name="office-building-outline" size={22} color={local ? t.color.accentText : t.color.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="600">{s.name}</Txt>
                    {!local ? <Txt size="xs" tone="faint">Not on this phone yet — it comes with the next site sync.</Txt> : null}
                  </View>
                  {local ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
                </Rowed>
              </Card>
            );
          })
        ) : (
          <Txt size="sm" tone="faint">
            {c.detailSyncedAt ? 'The office lists no sites under this customer.' : 'Sites come with the full customer record, on the next full sync.'}
          </Txt>
        )}

        <SectionHeader
          title="Jobs"
          action={jobs.length ? 'All' : undefined}
          onAction={() => router.push({ pathname: '/work/jobs', params: { customerId: c.externalId } })}
        />
        {jobs.length ? (
          jobs.map((j) => {
            const state = jobStatusWord(j);
            return (
              <Card key={j.id} onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: j.id } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700" numberOfLines={1}>{j.siteName}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={1}>{j.title}</Txt>
                    <Txt size="xs" tone="faint">
                      {[j.externalId ? `#${j.externalId}` : undefined, j.scheduledFor ? formatAuDate(j.scheduledFor) : undefined].filter(Boolean).join(' · ')}
                    </Txt>
                  </View>
                  <StatusPill label={state.label} tone={state.tone} />
                </Rowed>
              </Card>
            );
          })
        ) : (
          <Txt size="sm" tone="faint">No jobs for this customer are on the phone.</Txt>
        )}

        <SectionHeader
          title="Quotes"
          action={quotes.length ? 'All' : undefined}
          onAction={() => router.push({ pathname: '/quotes/simpro', params: { customerId: c.externalId } })}
        />
        {quotes.length ? (
          quotes.map((q) => {
            const state = quoteState(q);
            return (
              <Card key={q.externalId} onPress={() => router.push({ pathname: '/quotes/simpro/[id]', params: { id: q.externalId } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700" numberOfLines={1}>{q.siteName ?? q.name}</Txt>
                    <Txt size="sm" tone="muted" numberOfLines={1}>{q.name}</Txt>
                    <Txt size="xs" tone="faint">
                      {[`Q${q.externalId}`, q.dateIssued ? formatAuDate(q.dateIssued) : undefined, q.totalExTaxCents !== undefined ? `${formatCents(q.totalExTaxCents)} ex GST` : undefined].filter(Boolean).join(' · ')}
                    </Txt>
                  </View>
                  <StatusPill label={state.label} tone={state.tone} />
                </Rowed>
              </Card>
            );
          })
        ) : (
          <Txt size="sm" tone="faint">No Simpro quotes for this customer are on the phone.</Txt>
        )}

        <SectionHeader
          title="Invoices"
          action={invoices.length ? 'All' : undefined}
          onAction={() => router.push({ pathname: '/invoices', params: { customerId: c.externalId } })}
        />
        {invoices.length ? (
          invoices.map((inv) => {
            const state = invoiceState(inv, today);
            return (
              <Card key={inv.externalId} onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.externalId } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700">Invoice {inv.externalId}</Txt>
                    <Txt size="xs" tone="faint">
                      {[inv.dateIssued ? `Issued ${formatAuDate(inv.dateIssued)}` : undefined, inv.totalIncTaxCents !== undefined ? `${formatCents(inv.totalIncTaxCents)} inc GST` : undefined].filter(Boolean).join(' · ')}
                    </Txt>
                  </View>
                  <StatusPill label={state.label} tone={state.tone} />
                </Rowed>
              </Card>
            );
          })
        ) : (
          <Txt size="sm" tone="faint">No invoices for this customer in the two years the phone holds.</Txt>
        )}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
          Simpro customer {c.externalId}.{c.dateModified ? ` Last changed at the office ${formatAuDate(c.dateModified)}.` : ''}
        </Txt>
      </Screen>
    </>
  );
}

function ActionRow({
  icon, label, sub, onPress,
}: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; sub?: string; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <Rowed gap={3} style={{ minHeight: onPress ? 44 : undefined }}>
      <MaterialCommunityIcons name={icon} size={20} color={onPress ? t.color.accentText : t.color.textFaint} />
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'}>{label}</Txt>
        {sub ? <Txt size="xs" tone="faint">{sub}</Txt> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="open-in-new" size={16} color={t.color.textFaint} /> : null}
    </Rowed>
  );
  if (!onPress) return body;
  // A plain press target rather than a Button: the label is the number or
  // the address itself, and a filled button drawn around a street address
  // reads as a form field waiting to be typed in.
  return <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable>;
}
