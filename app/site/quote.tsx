import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getSite, listDefects } from '@/db/repo';
import { createQuote, nextQuoteSeq, officeCataloguePrices, setQuoteStatus } from '@/db/quoteRepo';
import { searchCatalogItems, type CatalogItemRecord } from '@/db/moreRepo';
import { loadRateCard, type StoredRateCard } from '@/db/rateCardRepo';
import {
  DEFAULT_EXCLUSIONS, DEFAULT_VALIDITY_DAYS, UNPRICEABLE_REASON, buildQuoteLines, catalogueSource,
  expiryFor, formatQuoteReference, lineAmountCents, qldDate, quoteTotals, scopeLinesFor,
  usableSellCents,
  type MaterialPrice, type PriceSource, type Quote, type QuoteLine,
} from '@/domain/quote';
import { partsNeededFor } from '@/domain/partsNeeded';
import { effectiveRateCard, formatCents, parseCents, selectRate } from '@/domain/rates';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import { formatAuDate } from '@/export/sheets';
import { shareFile, writePdf } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { DEFAULT_PREFS, loadPrefs, type Prefs } from '@/app-prefs';
import type { Defect, Site } from '@/domain/types';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, SearchBox,
  Segmented, StatTile, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/**
 * Building the quote that wins the rectification work.
 *
 * Every part of this already existed and none of it was joined up: the defects
 * carry their own coded quote lines, the rate card carries the hours, and the
 * priced version was being typed into an email on the drive home and lost.
 *
 * The screen is deliberately blunt about what it does not know. A material
 * line is priced from the office catalogue's sell price where the catalogue
 * sells it by that name or the technician picks the item, or from a figure
 * typed here; with none of those it stays unpriced, is shown in red and is
 * stated to be outside the total rather than quietly counted as nothing. The
 * same goes for a defect the library cannot price at all: it is listed under
 * the total so the client can be asked about it before the quote goes out,
 * instead of being discovered as free work on the day.
 */

/**
 * A price typed here is marked low confidence on purpose.
 *
 * Nothing has checked it against a supplier price list, and the stored line
 * should be able to say that rather than presenting it like a catalogue price.
 * It is never printed on the client's copy.
 */
const ENTERED: PriceSource = { kind: 'entered', label: 'Typed on this quote', confidence: 'low' };

const priceKey = (description: string) => description.trim().toLowerCase();

export default function SiteQuoteScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);

  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [card, setCard] = useState<StoredRateCard>({ rates: [], fees: [] });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [excluded, setExcluded] = useState<Record<string, true>>({});
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  /** Sell prices the office catalogue holds under a material line's own name. */
  const [catalogue, setCatalogue] = useState<MaterialPrice[]>([]);
  /** Catalogue items the technician picked for a line, by the line's description. */
  const [picked, setPicked] = useState<Record<string, { cents: number; source: PriceSource }>>({});
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [discountText, setDiscountText] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [validityText, setValidityText] = useState(String(DEFAULT_VALIDITY_DAYS));
  const [hoursBand, setHoursBand] = useState<'normal' | 'after-hours'>('normal');
  const [contactName, setContactName] = useState('');
  const [scopeNote, setScopeNote] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The quote as it was saved, kept beside the one on screen.
   *
   * The document a client signs has to carry the number the office will invoice
   * against and the date the price holds good until, and neither exists until
   * the quote is saved. Printing the preview after issuing produced a PDF
   * stamped "draft" with an empty quotation number on the acceptance block.
   *
   * The signature is what the screen looked like when it was saved. If anything
   * has moved since, the saved quote is no longer what is on screen and the
   * preview is printed instead — it is honest about being a draft, where a
   * numbered document showing different figures would not be.
   */
  const [saved, setSaved] = useState<{ quote: Quote; signature: string } | null>(null);

  const load = useCallback(async () => {
    if (!siteId) { setLoading(false); return; }
    setLoading(true);
    setFailed(null);
    let open: Defect[] = [];
    try {
      const [s, d, p, c] = await Promise.all([
        getSite(siteId), listDefects(siteId, 'open'), loadPrefs(), loadRateCard(),
      ]);
      setSite(s);
      setDefects(d);
      setPrefs(p);
      setCard(c);
      open = d;
    } catch (e) {
      // Without this the screen priced a quote off an empty defect list and
      // said the site had nothing outstanding, which is a document going to a
      // client with work missing from it.
      setDefects([]);
      setFailed(describeLoadFailure(e, "this site's open defects"));
    } finally {
      setLoading(false);
    }
    // The catalogue's sell prices for the materials these defects call for,
    // read on their own: a catalogue that has never synced leaves the lines to
    // be priced by hand, and is no reason to stop the quote being built.
    try {
      setCatalogue(open.length ? await officeCataloguePrices(partsNeededFor(open).map((x) => x.description)) : []);
    } catch {
      setCatalogue([]);
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
    if (!rate) {
      // A card with rates on it but none for these hours is a different fix
      // from no card at all, so the two are told apart.
      const band = hoursBand === 'after-hours' ? 'after-hours' : 'normal hours';
      return {
        rate: undefined,
        source: undefined,
        missing: eff.rates.length
          ? `No ${band} labour rate on the rate card.`
          : 'No labour rate set. Add one in Settings.',
      };
    }
    const source: PriceSource = eff.rateSource === 'office'
      ? {
        kind: 'office',
        label: `Office rate card${card.pulledAt ? `, synced ${formatAuDate(card.pulledAt)}` : ''}`,
        confidence: 'high',
      }
      : { kind: 'settings', label: 'Charge-out rate in Settings', confidence: 'medium' };
    return { rate, source, missing: undefined };
  }, [card, prefs, hoursBand, site?.clientName]);

  /**
   * What each material line is priced at.
   *
   * A figure in the price box wins: it is either one the technician typed or
   * the sell price of the catalogue item they picked, and the source says
   * which. A blank box takes the catalogue's own price where it sells the item
   * under the line's name. Text the box cannot read leaves the line unpriced
   * rather than falling back, so a typo is never quietly replaced.
   */
  const materialPrices = useMemo<MaterialPrice[]>(() => {
    const out: MaterialPrice[] = [];
    const typed = new Set<string>();
    for (const [description, raw] of Object.entries(priceText)) {
      if (!raw.trim()) continue;
      typed.add(priceKey(description));
      const cents = parseCents(raw);
      // parseCents refuses what it cannot read rather than returning zero, and
      // an unreadable figure leaves the line unpriced rather than free.
      if (cents === undefined || cents <= 0) continue;
      const pick = picked[description];
      out.push({ description, unitCents: cents, source: pick && pick.cents === cents ? pick.source : ENTERED });
    }
    for (const price of catalogue) {
      if (!typed.has(priceKey(price.description))) out.push(price);
    }
    return out;
  }, [priceText, picked, catalogue]);

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

  // The scope is part of the quote, so it is saved with it and a reprint
  // prints the same lines the client was sent.
  const scope = useMemo(() => scopeLinesFor(chosen), [chosen]);

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
    scope,
    scopeNote: scopeNote.trim() || undefined,
    exclusions: [...DEFAULT_EXCLUSIONS],
    taxRate: 0.1,
    createdAt: '',
    updatedAt: '',
  }), [siteId, site, contactName, prefs.technicianName, validityDays, discountCents, discountReason,
    built.lines, built.unpriceable, scope, scopeNote]);

  const totals = useMemo(() => quoteTotals(draft), [draft]);

  const signature = useMemo(() => JSON.stringify({
    lines: draft.lines,
    unpriceable: draft.unpriceable,
    scope: draft.scope,
    discountCents: draft.discountCents,
    discountReason: draft.discountReason,
    validityDays: draft.validityDays,
    contactName: draft.contactName,
    scopeNote: draft.scopeNote,
  }), [draft]);
  const printable = saved && saved.signature === signature ? saved.quote : draft;

  const warnings = useMemo(() => {
    // The build's own refusals first: a price or a rate that was offered and
    // not used looks identical to one nobody supplied unless it says so.
    const out = [...built.warnings, ...totals.warnings];
    if (!labour.rate && built.lines.some((l) => l.section === 'labour')) {
      out.push(`${labour.missing ?? 'No labour rate.'} The hours are unpriced.`);
    }
    if (discountUnreadable) {
      out.push('Discount not read, so nothing is taken off. Enter it like 250 or 250.00.');
    }
    if (validityDays === undefined) {
      out.push('Enter the validity in whole days before issuing.');
    }
    if (!site?.clientName) {
      out.push('No client name on this site.');
    }
    return out;
  }, [totals.warnings, built.warnings, labour, built.lines, discountUnreadable, validityDays,
    site?.clientName]);

  const save = async (issue: boolean) => {
    if (!siteId) return;
    if (!site) {
      // Silently doing nothing on a press reads as a broken button, and the
      // technician presses it again on the way out of the plant room.
      showAlert('Site not loaded', 'Go back and open the site again.');
      return;
    }
    if (!built.lines.length) {
      showAlert('Nothing to quote', 'Tick at least one defect with priced work.');
      return;
    }
    if (issue && validityDays === undefined) {
      showAlert('Validity', 'Enter the validity in whole days before issuing.');
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
      setSaved({ quote, signature });

      showAlert(
        issue ? 'Quote issued' : 'Draft saved',
        [
          quote.reference ? `Number ${quote.reference}.` : 'No number yet. The office will assign one.',
          `${formatCents(totals.totalCents)} including GST.`,
          quote.expiresAt ? `Valid until ${formatAuDate(quote.expiresAt)}.` : null,
          totals.incomplete ? 'Some work is unpriced. See the warnings.' : null,
        ].filter(Boolean).join('\n\n'),
      );
    } catch (e) {
      showAlert('Could not save the quote', describeActionFailure(e, 'save the quote'));
    } finally {
      setBusy(false);
    }
  };

  const makePdf = async () => {
    if (!site) {
      showAlert('Site not loaded', 'Go back and open the site again.');
      return;
    }
    setBusy(true);
    try {
      // The scope rides on the quote itself, so the saved quote and the
      // preview print the same lines without being handed them here.
      const html = quoteDocumentHtml({
        quote: printable,
        companyName: prefs.companyName,
        asAt: new Date().toISOString(),
      });
      // The Queensland date in the file name, not the UTC one: a quote made at
      // eight on a Brisbane morning would otherwise file under yesterday.
      const day = qldDate(new Date().toISOString()) ?? '';
      const file = await writePdf(`Quote ${printable.reference || site.name} ${day}`.trim(), html);
      const shared = await shareFile(file, 'Quotation');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'quote');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not make the PDF', describeActionFailure(e, 'make the quote PDF'));
    } finally {
      setBusy(false);
    }
  };

  /** Takes a catalogue item's sell price for a line, and says so on the line. */
  const pick = (description: string, item: CatalogItemRecord) => {
    const cents = usableSellCents(item);
    if (cents === undefined) return;
    setPicked((prev) => ({ ...prev, [description]: { cents, source: catalogueSource(item) } }));
    setPriceText((prev) => ({ ...prev, [description]: (cents / 100).toFixed(2) }));
    setPickingFor(null);
  };

  const materials = built.lines.filter((l) => l.section === 'materials');
  const labourLines = built.lines.filter((l) => l.section === 'labour');

  /** The line under a material's price box: its price and source, or what to do. */
  const materialNote = (l: QuoteLine): { text: string; tone: 'fail' | 'faint' } => {
    const raw = (priceText[l.description] ?? '').trim();
    if (l.unitCents === undefined) {
      return raw
        ? { text: 'Price not read. Enter it like 89.50.', tone: 'fail' }
        : { text: 'Enter a price or it stays off the total.', tone: 'fail' };
    }
    const from = l.source?.kind === 'catalogue' ? l.source.label : 'Typed price';
    return { text: `${formatCents(l.unitCents)} each · ${from}`, tone: 'faint' };
  };

  const priceRow = (l: QuoteLine) => {
    const amount = lineAmountCents(l);
    const note = l.section === 'materials' ? materialNote(l) : undefined;
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
        {note ? (
          <>
            <Rowed gap={2} align="flex-end">
              <View style={{ width: 130 }}>
                <Field
                  label="Unit price ex GST"
                  value={priceText[l.description] ?? ''}
                  onChangeText={(v) => setPriceText((prev) => ({ ...prev, [l.description]: v }))}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              <Button
                title={pickingFor === l.description ? 'Close' : 'Catalogue'}
                variant="secondary"
                compact
                onPress={() => setPickingFor(pickingFor === l.description ? null : l.description)}
              />
            </Rowed>
            <Txt size="xs" tone={note.tone} style={{ lineHeight: 16 }}>{note.text}</Txt>
            {pickingFor === l.description ? (
              <CataloguePicker onPick={(item) => pick(l.description, item)} />
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  // Said "No site" with nothing to press, which is a dead end for anybody who
  // reached this from search rather than from a site. See ContextGate.
  if (!siteId) return <ContextGate kind="site" what="a quote priced from the open defects" title="Quote" backTo="/site/quote" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Client quote' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Priced from the open defects at {site?.name ?? 'this site'}.
        </Txt>

        {failed ? (
          <Banner tone="fail" title="Could not read the defects" body={failed} />
        ) : loading ? null : !defects.length ? (
          <EmptyState
            icon="alert-circle-check-outline"
            title="No open defects"
            body="Nothing to quote at this site."
          />
        ) : null}

        {defects.length ? (
          <>
            <H2>Defects to quote</H2>
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
                {labour.rate && labour.source
                  ? `${labour.rate.name}, ${formatCents(labour.rate.sellCentsPerHour)}/hr. ${labour.source.label}.`
                  : labour.missing}
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
                Estimated hours from the defect library.
              </Txt>
            </Card>
          </>
        ) : null}

        {built.lines.length ? (
          <>
            <H2>Totals</H2>
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
            </Card>

            <Card>
              <Rowed gap={2} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Field
                    label="Discount ex GST"
                    value={discountText}
                    onChangeText={setDiscountText}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
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
                placeholder="Client contact"
              />
              <Field
                label="Note on the scope"
                value={scopeNote}
                onChangeText={setScopeNote}
                placeholder="Printed under the scope"
                multiline
              />
              <Label>
                {validityDays !== undefined
                  ? `Issued today, valid until ${formatAuDate(expiryFor(new Date().toISOString(), validityDays))}.`
                  : 'Enter the validity in whole days.'}
              </Label>
            </Card>
          </>
        ) : null}

        {built.unpriceable.length ? (
          <>
            <H2>Not on this quote</H2>
            <Banner
              tone="warn"
              title={`${built.unpriceable.length} defect${built.unpriceable.length === 1 ? '' : 's'} not priced`}
              body="Listed on the PDF as not included."
            />
            {built.unpriceable.map((u) => (
              <Rowed key={u.defectId} gap={2} align="flex-start">
                <Chip label={u.defectCode ?? 'free text'} tone="warn" />
                <View style={{ flex: 1 }}>
                  <Txt size="sm">{u.location ? `${u.location}: ` : ''}{u.description}</Txt>
                  <Txt size="xs" tone="muted" style={{ lineHeight: 16 }}>{UNPRICEABLE_REASON[u.reason]}</Txt>
                </View>
              </Rowed>
            ))}
          </>
        ) : null}

        {warnings.length ? (
          <>
            <H2>Check before sending</H2>
            {warnings.map((w, i) => (
              <Banner key={i} tone="warn" title="Check this" body={w} />
            ))}
          </>
        ) : null}

        {built.lines.length ? (
          <>
            <H2>Issue it</H2>
            <Button title="PDF" onPress={makePdf} loading={busy} />
            <Button title="Save draft" variant="secondary" onPress={() => void save(false)} loading={busy} />
            <Button title="Save and issue" variant="secondary" onPress={() => void save(true)} loading={busy} />
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              {printable === draft
                ? 'PDF prints a draft. Save to number it. Issuing locks it.'
                : `PDF prints ${printable.reference || 'the saved quote'}. Any change prints a draft.`}
            </Txt>
          </>
        ) : null}
      </Screen>
    </>
  );
}

/**
 * Finding the office catalogue item a material line is quoted at.
 *
 * The library names the work ("Replacement detector head") rather than the
 * part, because the right head depends on the panel. The technician knows
 * which one; this finds it in the synced Simpro catalogue and the line takes
 * its sell price. An item the office has no sell price for is listed but
 * cannot be picked, so it is never quoted at nothing.
 */
function CataloguePicker({ onPick }: { onPick: (item: CatalogItemRecord) => void }) {
  const t = useTheme();
  const [typed, setTyped] = useState('');
  // What came back, kept with the words it answers, so "not in the catalogue"
  // is never shown under a search that has not finished yet.
  const [found, setFound] = useState<{ term: string; rows: CatalogItemRecord[]; failed: string | null } | null>(null);
  const term = typed.trim();

  useEffect(() => {
    if (term.length < 2) return undefined;
    let cancelled = false;
    // The same 200ms the quote list waits, so a search is not run per keystroke.
    const h = setTimeout(() => {
      searchCatalogItems(term, { limit: 8 })
        .then((rows) => { if (!cancelled) setFound({ term, rows, failed: null }); })
        .catch((e: unknown) => {
          if (!cancelled) setFound({ term, rows: [], failed: describeLoadFailure(e, 'the office catalogue') });
        });
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [term]);

  const shown = term.length >= 2 ? found : null;
  const results = shown?.rows ?? [];
  const failed = shown?.failed ?? null;
  const searched = shown !== null && shown.term === term;

  return (
    <View style={{ gap: t.space(1.5) }}>
      <SearchBox value={typed} onChange={setTyped} placeholder="Part number or name" />
      {failed ? <Txt size="xs" tone="fail">{failed}</Txt> : null}
      {searched && !results.length && !failed ? (
        <Txt size="xs" tone="muted">Not in the office catalogue.</Txt>
      ) : null}
      {results.map((item) => {
        const cents = usableSellCents(item);
        return (
          <Pressable
            key={item.id}
            disabled={cents === undefined}
            onPress={() => onPick(item)}
            style={{
              padding: t.space(2.5), borderRadius: t.radius.md, borderWidth: 1,
              borderColor: t.color.border, backgroundColor: t.color.surface,
            }}
          >
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt size="sm" weight="600">{item.name}</Txt>
                {item.partNo ? <Txt size="xs" tone="faint">{item.partNo}</Txt> : null}
              </View>
              <Txt size="sm" weight="700" tone={cents === undefined ? 'faint' : 'default'}>
                {cents === undefined ? 'No sell price' : formatCents(cents)}
              </Txt>
            </Rowed>
          </Pressable>
        );
      })}
    </View>
  );
}
