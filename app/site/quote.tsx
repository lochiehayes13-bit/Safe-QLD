import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getSite, listDefects } from '@/db/repo';
import { createQuote, nextQuoteSeq, setQuoteStatus } from '@/db/quoteRepo';
import { loadRateCard, type StoredRateCard } from '@/db/rateCardRepo';
import {
  DEFAULT_EXCLUSIONS, DEFAULT_VALIDITY_DAYS, UNPRICEABLE_REASON, buildQuoteLines,
  expiryFor, formatQuoteReference, lineAmountCents, quoteTotals, scopeLinesFor, weakestConfidence,
  type MaterialPrice, type PriceSource, type Quote, type QuoteLine,
} from '@/domain/quote';
import { effectiveRateCard, formatCents, parseCents, selectRate } from '@/domain/rates';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import { formatAuDate } from '@/export/sheets';
import { shareFile, writePdf } from '@/export/files';
import { DEFAULT_PREFS, loadPrefs, type Prefs } from '@/app-prefs';
import type { Defect, Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, Segmented,
  StatTile, Txt,
} from '@/components/ui';

/**
 * Building the quote that wins the rectification work.
 *
 * Every part of this already existed and none of it was joined up: the defects
 * carry their own coded quote lines, the rate card carries the hours, and the
 * priced version was being typed into an email on the drive home and lost.
 *
 * The screen is deliberately blunt about what it does not know. Nothing in the
 * app is told what a detector head sells for, so a material line stays unpriced
 * until someone types the figure, and an unpriced line is shown in red and
 * stated to be outside the total rather than quietly counted as nothing. The
 * same goes for a defect the library cannot price at all: it is listed under
 * the total so the client can be asked about it before the quote goes out,
 * instead of being discovered as free work on the day.
 */
export default function SiteQuoteScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();

  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [card, setCard] = useState<StoredRateCard>({ rates: [], fees: [] });
  const [loading, setLoading] = useState(true);

  const [excluded, setExcluded] = useState<Record<string, true>>({});
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [discountText, setDiscountText] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [validityText, setValidityText] = useState(String(DEFAULT_VALIDITY_DAYS));
  const [hoursBand, setHoursBand] = useState<'normal' | 'after-hours'>('normal');
  const [contactName, setContactName] = useState('');
  const [scopeNote, setScopeNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const [s, d, p, c] = await Promise.all([
        getSite(siteId), listDefects(siteId, 'open'), loadPrefs(), loadRateCard(),
      ]);
      setSite(s);
      setDefects(d);
      setPrefs(p);
      setCard(c);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  const chosen = useMemo(() => defects.filter((d) => !excluded[d.id]), [defects, excluded]);

  /**
   * The rate the labour goes on at, and where it came from.
   *
   * No rate means no rate. The alternative — quoting the hours at nothing — is
   * a document that offers a day's work free, so the lines come out unpriced
   * and the screen says why.
   */
  const labour = useMemo(() => {
    const eff = effectiveRateCard(card, prefs);
    const rate = selectRate(eff.rates, {
      hours: hoursBand,
      kind: 'labour',
      customerName: site?.clientName,
    });
    if (!rate) return { rate: undefined, source: undefined, note: eff.note };
    const source: PriceSource = eff.rateSource === 'office'
      ? {
        kind: 'office',
        label: `Safe QLD rate card, pulled from the office system${
          card.pulledAt ? ` on ${formatAuDate(card.pulledAt)}` : ''}`,
        confidence: 'high',
      }
      : {
        kind: 'settings',
        label: 'Charge-out rate held in this app’s Settings',
        confidence: 'medium',
      };
    return { rate, source, note: eff.note };
  }, [card, prefs, hoursBand, site?.clientName]);

  /**
   * A price typed here is marked low confidence on purpose.
   *
   * Nothing has checked it against a supplier price list — it is what the
   * technician remembered or looked up on a phone, and the quote should be able
   * to say that rather than presenting it like a rate off the card.
   */
  const enteredSource: PriceSource = useMemo(() => ({
    kind: 'entered',
    label: `Price entered on this quote${prefs.technicianName ? ` by ${prefs.technicianName}` : ''}`,
    confidence: 'low',
  }), [prefs.technicianName]);

  const materialPrices = useMemo<MaterialPrice[]>(() => {
    const out: MaterialPrice[] = [];
    for (const [description, raw] of Object.entries(priceText)) {
      const cents = parseCents(raw);
      // parseCents refuses what it cannot read rather than returning zero, and
      // an unreadable figure leaves the line unpriced rather than free.
      if (cents === undefined || cents <= 0) continue;
      out.push({ description, unitCents: cents, source: enteredSource });
    }
    return out;
  }, [priceText, enteredSource]);

  const built = useMemo(() => buildQuoteLines({
    defects: chosen,
    materialPrices,
    labourRate: labour.rate,
    labourRateSource: labour.source,
  }), [chosen, materialPrices, labour.rate, labour.source]);

  const discountCents = useMemo(() => {
    const trimmed = discountText.trim();
    if (!trimmed) return 0;
    return parseCents(trimmed) ?? 0;
  }, [discountText]);
  const discountUnreadable = discountText.trim().length > 0 && parseCents(discountText.trim()) === undefined;

  const validityDays = useMemo(() => {
    const n = Number(validityText.trim());
    return Number.isInteger(n) && n >= 1 ? n : undefined;
  }, [validityText]);

  const draft = useMemo<Quote>(() => ({
    id: 'preview',
    siteId: siteId ?? '',
    reference: '',
    clientName: site?.clientName ?? '',
    siteName: site?.name ?? '',
    siteAddress: [site?.address, site?.suburb, site?.state, site?.postcode].filter(Boolean).join(' '),
    contactName: contactName.trim() || undefined,
    jobReference: site?.siteRef,
    preparedBy: prefs.technicianName,
    status: 'draft',
    validityDays: validityDays ?? DEFAULT_VALIDITY_DAYS,
    discountCents,
    discountReason: discountReason.trim() || undefined,
    lines: built.lines,
    unpriceable: built.unpriceable,
    scopeNote: scopeNote.trim() || undefined,
    exclusions: [...DEFAULT_EXCLUSIONS],
    taxRate: 0.1,
    createdAt: '',
    updatedAt: '',
  }), [siteId, site, contactName, prefs.technicianName, validityDays, discountCents, discountReason,
    built.lines, built.unpriceable, scopeNote]);

  const totals = useMemo(() => quoteTotals(draft), [draft]);
  const confidence = weakestConfidence(built.lines);

  const warnings = useMemo(() => {
    const out = [...totals.warnings];
    if (!labour.rate && built.lines.some((l) => l.section === 'labour')) {
      out.push(`${labour.note} The hours are on the quote but not priced.`);
    }
    if (discountUnreadable) {
      out.push('The discount could not be read, so nothing has been taken off. Enter it like 250 or $250.00.');
    }
    if (validityDays === undefined) {
      out.push('The validity has to be a whole number of days of at least one, so this quote cannot be issued yet.');
    }
    if (!site?.clientName) {
      out.push('This site has no client name against it, so the quote has nobody to be addressed to.');
    }
    return out;
  }, [totals.warnings, labour, built.lines, discountUnreadable, validityDays, site?.clientName]);

  const save = async (issue: boolean) => {
    if (!site || !siteId) return;
    if (!built.lines.length) {
      Alert.alert('Nothing to quote', 'Tick at least one defect that carries priced work.');
      return;
    }
    if (issue && validityDays === undefined) {
      Alert.alert('Validity', 'Set the validity to a whole number of days before issuing.');
      return;
    }

    setBusy(true);
    try {
      const seq = await nextQuoteSeq(siteId);
      const reference = formatQuoteReference(site.siteRef || site.name, seq, new Date().toISOString());
      // The preview carries a placeholder id and no timestamps; the repository
      // owns all three, so they are left off rather than overwritten here.
      const { id: _previewId, createdAt: _created, updatedAt: _updated, ...fields } = draft;
      let quote = await createQuote({
        ...fields,
        siteId,
        // A reference that could not be built is left blank for the office to
        // assign rather than filled with something that looks like a number.
        reference: reference ?? '',
      });
      if (issue) quote = await setQuoteStatus(quote.id, 'issued');

      Alert.alert(
        issue ? 'Quote issued' : 'Draft saved',
        [
          quote.reference ? `Number ${quote.reference}.` : 'No number could be built — the office will assign one.',
          `${formatCents(totals.totalCents)} including GST.`,
          quote.expiresAt ? `Holds good until ${formatAuDate(quote.expiresAt)}.` : null,
          totals.incomplete ? 'Some work on this site is not covered by it — see the warnings.' : null,
        ].filter(Boolean).join('\n\n'),
      );
      await load();
    } catch (e) {
      Alert.alert('Could not save the quote', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const makePdf = async () => {
    if (!site) return;
    setBusy(true);
    try {
      const html = quoteDocumentHtml({
        quote: draft,
        companyName: prefs.companyName,
        scopeItems: scopeLinesFor(chosen),
        asAt: new Date().toISOString(),
      });
      const file = await writePdf(`Quote ${site.name} ${new Date().toISOString().slice(0, 10)}`, html);
      const shared = await shareFile(file, 'Quotation');
      if (!shared) Alert.alert('Saved', `Written to ${file.name}. Sharing is not available on this device.`);
    } catch (e) {
      Alert.alert('Could not produce the quote', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const materials = built.lines.filter((l) => l.section === 'materials');
  const labourLines = built.lines.filter((l) => l.section === 'labour');

  const priceRow = (l: QuoteLine) => {
    const amount = lineAmountCents(l);
    return (
      <View key={l.id} style={{ gap: t.space(1.5) }}>
        <Rowed align="flex-start" gap={2}>
          <View style={{ flex: 1 }}>
            <Txt weight="700">{l.description}</Txt>
            <Txt size="xs" tone="muted">
              {l.quantity} {l.unit} · {l.defectCount} defect{l.defectCount === 1 ? '' : 's'}
              {l.fromCodes.length ? ` · ${l.fromCodes.join(', ')}` : ''}
            </Txt>
          </View>
          <Txt weight="700" tone={amount === undefined ? 'fail' : 'default'}>
            {amount === undefined ? 'Not priced' : formatCents(amount)}
          </Txt>
        </Rowed>
        {l.section === 'materials' ? (
          <Rowed gap={2} align="flex-end">
            <View style={{ width: 130 }}>
              <Field
                label="Unit price ex GST"
                value={priceText[l.description] ?? ''}
                onChangeText={(v) => setPriceText((prev) => ({ ...prev, [l.description]: v }))}
                placeholder="$0.00"
                keyboardType="numeric"
              />
            </View>
            {l.unitCents === undefined ? (
              <Txt size="xs" tone="fail" style={{ flex: 1, lineHeight: 16 }}>
                Nothing in the app knows what this sells for. Left blank it stays off the total —
                it is never quoted at nothing.
              </Txt>
            ) : (
              <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 16 }}>
                {formatCents(l.unitCents)} each · typed on this quote, not from the rate card.
              </Txt>
            )}
          </Rowed>
        ) : null}
      </View>
    );
  };

  if (!siteId) {
    return (
      <>
        <Stack.Screen options={{ title: 'Quote' }} />
        <Screen>
          <EmptyState title="No site" body="Open a quote from a site so it knows whose defects to price." />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Client quote' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Priced from the open defects at {site?.name ?? 'this site'}. Materials and labour are quoted
          separately, GST is worked once on the subtotal, and anything nobody has priced is shown as
          unpriced rather than free.
        </Txt>

        {loading ? null : !defects.length ? (
          <EmptyState
            title="No open defects"
            body="There is nothing outstanding at this site to quote for."
          />
        ) : null}

        {defects.length ? (
          <>
            <H2>What goes on the quote</H2>
            {defects.map((d) => {
              const on = !excluded[d.id];
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setExcluded((prev) => {
                    const next = { ...prev };
                    if (on) next[d.id] = true;
                    else delete next[d.id];
                    return next;
                  })}
                >
                  <Card>
                    <Rowed align="flex-start" gap={2}>
                      <View style={{ flex: 1 }}>
                        <Txt weight="700">{d.location || 'Unlocated'}</Txt>
                        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{d.description}</Txt>
                        {d.defectCode ? <Txt size="xs" tone="faint">{d.defectCode}</Txt> : null}
                      </View>
                      <Chip label={on ? 'On quote' : 'Off'} tone={on ? 'pass' : 'muted'} selected={on} />
                    </Rowed>
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {built.lines.length ? (
          <>
            <H2>Labour rate</H2>
            <Card>
              <Segmented
                value={hoursBand}
                onChange={setHoursBand}
                options={[
                  { value: 'normal', label: 'Normal hours' },
                  { value: 'after-hours', label: 'After hours' },
                ]}
              />
              <Txt size="xs" tone={labour.rate ? 'faint' : 'warn'} style={{ marginTop: t.space(2), lineHeight: 16 }}>
                {labour.rate
                  ? `${labour.rate.name} at ${formatCents(labour.rate.sellCentsPerHour)} an hour. ${labour.note}`
                  : `${labour.note} The hours below are not priced.`}
              </Txt>
            </Card>
          </>
        ) : null}

        {materials.length ? (
          <>
            <H2>Materials</H2>
            <Card>
              {materials.map((l, i) => (
                <View key={l.id}>
                  {i ? <Divider /> : null}
                  {priceRow(l)}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {labourLines.length ? (
          <>
            <H2>Labour</H2>
            <Card>
              {labourLines.map((l, i) => (
                <View key={l.id}>
                  {i ? <Divider /> : null}
                  {priceRow(l)}
                </View>
              ))}
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                Hours come from the defect library, not from time recorded on site. They are an
                estimate for quoting and are not a timesheet.
              </Txt>
            </Card>
          </>
        ) : null}

        {built.lines.length ? (
          <>
            <H2>The money</H2>
            <Card>
              <Rowed gap={2}>
                <StatTile label="Materials" value={formatCents(totals.materialsCents)} />
                <StatTile label="Labour" value={formatCents(totals.labourCents)} />
              </Rowed>
              <Divider />
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Txt size="sm">Subtotal ex GST</Txt>
                <Txt size="sm">{formatCents(totals.subtotalCents)}</Txt>
              </Rowed>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Txt size="sm">GST</Txt>
                <Txt size="sm">{formatCents(totals.gstCents)}</Txt>
              </Rowed>
              <Rowed style={{ justifyContent: 'space-between', marginTop: t.space(1) }}>
                <Txt weight="700">Total inc GST</Txt>
                <Txt weight="700" tone={totals.incomplete ? 'warn' : 'accent'}>
                  {formatCents(totals.totalCents)}
                </Txt>
              </Rowed>
              {confidence ? (
                <Txt size="xs" tone={confidence === 'high' ? 'faint' : 'warn'} style={{ marginTop: t.space(2), lineHeight: 16 }}>
                  {confidence === 'high'
                    ? 'Every figure here came off the office rate card.'
                    : 'Some figures here were typed on this quote rather than taken from the rate card.'}
                </Txt>
              ) : null}
            </Card>

            <Card>
              <Rowed gap={2} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Field
                    label="Discount ex GST"
                    value={discountText}
                    onChangeText={setDiscountText}
                    placeholder="$0.00"
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Valid for (days)"
                    value={validityText}
                    onChangeText={setValidityText}
                    keyboardType="numeric"
                  />
                </View>
              </Rowed>
              <Field
                label="Reason for the discount"
                value={discountReason}
                onChangeText={setDiscountReason}
                placeholder="Shown on the quote"
              />
              <Field
                label="Attention"
                value={contactName}
                onChangeText={setContactName}
                placeholder="Who at the client this goes to"
              />
              <Field
                label="Note on the scope"
                value={scopeNote}
                onChangeText={setScopeNote}
                placeholder="Anything the client should read before the price"
                multiline
              />
              <Label>
                {validityDays !== undefined
                  ? `Issued today it holds good until ${formatAuDate(expiryFor(new Date().toISOString(), validityDays))}.`
                  : 'Set a whole number of days before issuing.'}
              </Label>
            </Card>
          </>
        ) : null}

        {built.unpriceable.length ? (
          <>
            <H2>Not covered by this quote</H2>
            <Banner
              tone="warn"
              title={`${built.unpriceable.length} defect${built.unpriceable.length === 1 ? '' : 's'} priced at nothing`}
              body="Listed on the document too, so the quote cannot be mistaken for the whole job."
            />
            {built.unpriceable.map((u) => (
              <Rowed key={u.defectId} gap={2} align="flex-start">
                <Chip label={u.defectCode ?? 'free text'} tone="warn" />
                <View style={{ flex: 1 }}>
                  <Txt size="sm">{u.location ? `${u.location} — ` : ''}{u.description}</Txt>
                  <Txt size="xs" tone="muted" style={{ lineHeight: 16 }}>{UNPRICEABLE_REASON[u.reason]}</Txt>
                </View>
              </Rowed>
            ))}
          </>
        ) : null}

        {warnings.length ? (
          <>
            <H2>Before this goes out</H2>
            {warnings.map((w, i) => (
              <Banner key={i} tone="warn" title="Check this" body={w} />
            ))}
          </>
        ) : null}

        {built.lines.length ? (
          <>
            <H2>Issue it</H2>
            <Button title="Produce the PDF" onPress={makePdf} loading={busy} />
            <Button title="Save as a draft" variant="secondary" onPress={() => void save(false)} loading={busy} />
            <Button title="Save and issue" variant="secondary" onPress={() => void save(true)} loading={busy} />
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Issuing starts the clock on the price and locks the quote. Anything that changes after
              that is a new quote with its own number — the client is holding this one.
            </Txt>
          </>
        ) : null}
      </Screen>
    </>
  );
}
