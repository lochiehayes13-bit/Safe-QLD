import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSite, listDefects } from '@/db/repo';
import { createPurchaseRequest, type PurchaseLine } from '@/db/opsRepo';
import {
  UNCOVERED_REASON, labourNeededFor, partsNeededFor, totalLabourHours, uncoveredDefects,
  type NeededPart,
} from '@/domain/partsNeeded';
import type { Defect, Site } from '@/domain/types';
import { loadPrefs, DEFAULT_PREFS, type Prefs } from '@/app-prefs';
import type { StoredRateCard } from '@/db/rateCardRepo';
import { chargeForAttendance, effectiveRateCard, formatCents } from '@/domain/rates';
import { loadRateCard } from '@/db/rateCardRepo';
import { useTheme } from '@/theme';
import { DevicePicker } from '@/components/DevicePicker';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * Parts needed to clear a site's open defects.
 *
 * Every coded defect already carries its quote items, so the order follows from
 * the defect list rather than from someone reading it and remembering. Three
 * quantities of the same head become one line for three, not three lines.
 *
 * Labour never reaches this screen — a line priced in hours belongs on the
 * quote, and putting it on a purchase order produces a request the supplier
 * cannot fill.
 *
 * What the library cannot supply is the actual part number: "replacement
 * detector head" depends on the panel and the protocol. So each line can have a
 * catalogue part attached here, and any line left without one is shown as the
 * office's to resolve rather than quietly going out blank.
 */
export default function SitePartsScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [chosen, setChosen] = useState<Record<string, { partNumber: string; label: string }>>({});
  const [adjusted, setAdjusted] = useState<Record<string, string>>({});
  const [supplier, setSupplier] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [card, setCard] = useState<StoredRateCard>({ rates: [], fees: [] });

  const load = useCallback(async () => {
    if (!siteId) return;
    const [s, d, p, c] = await Promise.all([
      getSite(siteId), listDefects(siteId), loadPrefs(), loadRateCard(),
    ]);
    setSite(s);
    setDefects(d.filter((x) => x.status === 'open'));
    setPrefs(p);
    setCard(c);
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  const parts = useMemo(() => partsNeededFor(defects), [defects]);
  const uncovered = useMemo(() => uncoveredDefects(defects), [defects]);

  const keyOf = (p: NeededPart) => `${p.description}|${p.unit}`;
  const qtyOf = (p: NeededPart) => {
    const raw = adjusted[keyOf(p)];
    if (raw === undefined) return p.quantity;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const unresolved = parts.filter((p) => !chosen[keyOf(p)] && qtyOf(p) > 0).length;

  const raise = async () => {
    if (!site) return;
    const lines: PurchaseLine[] = parts
      .filter((p) => qtyOf(p) > 0)
      .map((p) => {
        const pick = chosen[keyOf(p)];
        return {
          // No part number is a real state, not an empty string standing in for
          // one. The office sees the description and picks.
          partNumber: pick?.partNumber ?? '',
          description: pick ? `${p.description} — ${pick.label}` : p.description,
          quantity: qtyOf(p),
          note: `${p.defectCount} defect${p.defectCount === 1 ? '' : 's'}: ${p.fromCodes.join(', ')}`,
        };
      });

    if (!lines.length) {
      Alert.alert('Nothing to order', 'Every line is set to zero.');
      return;
    }

    setSaving(true);
    try {
      await createPurchaseRequest({
        siteId: site.id,
        supplier: supplier.trim() || undefined,
        requestedBy: prefs.technicianName || undefined,
        lines,
        notes: `Raised from ${defects.length} open defect${defects.length === 1 ? '' : 's'} at ${site.name}.`,
      });
      Alert.alert(
        'Request raised',
        [
          `${lines.length} line${lines.length === 1 ? '' : 's'} saved as a draft.`,
          unresolved ? `${unresolved} without a part number for the office to resolve.` : null,
          'Submit it from Work → Purchase requests when you are ready.',
        ].filter(Boolean).join('\n\n'),
      );
      router.push('/work/purchases');
    } catch (e) {
      Alert.alert('Could not raise the request', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const labour = useMemo(() => labourNeededFor(defects), [defects]);

  /**
   * What the labour is worth, when rates have been set.
   *
   * Priced as ordinary hours with no attendance fee: this is rectification work
   * quoted ahead of a visit, not an attendance being billed, and adding a
   * call-out fee to a quote for work not yet scheduled would overstate it.
   */
  const quote = useMemo(() => {
    const hours = totalLabourHours(defects);
    const eff = effectiveRateCard(card, prefs);
    if (!hours || !eff.rates.some((r) => r.hours === 'normal' && r.kind === 'labour')) return null;
    return {
      charge: chargeForAttendance({
        minutesOnSite: Math.round(hours * 60),
        hours: 'normal',
        rates: eff.rates,
        fees: [],
        chargeAttendance: false,
      }),
      note: eff.note,
    };
  }, [defects, prefs, card]);

  return (
    <>
      <Stack.Screen options={{ title: 'Parts needed' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Built from the coded defects open at {site?.name ?? 'this site'}. Quantities add up across defects that need
          the same thing. Labour is left out of the order — it belongs on the quote, and is summarised below.
        </Txt>

        {!parts.length ? (
          <Banner
            tone={defects.length ? 'info' : 'pass'}
            title={defects.length ? 'Nothing to order' : 'No open defects'}
            body={
              defects.length
                ? 'The open defects here need labour only, or were raised as free text with no coded parts list behind them.'
                : 'Nothing is outstanding at this site.'
            }
          />
        ) : null}

        {parts.map((p) => {
          const k = keyOf(p);
          const pick = chosen[k];
          return (
            <Card key={k}>
              <Rowed align="flex-start" gap={2}>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{p.description}</Txt>
                  <Txt size="sm" tone="muted">
                    {p.defectCount} defect{p.defectCount === 1 ? '' : 's'} · {p.fromCodes.join(', ')}
                  </Txt>
                </View>
                <Chip label={`${qtyOf(p)} ${p.unit}`} tone={qtyOf(p) ? 'default' : 'warn'} />
              </Rowed>

              <Rowed gap={2} style={{ marginTop: t.space(2.5) }} align="flex-end">
                <View style={{ width: 96 }}>
                  <Field
                    label="Quantity"
                    value={adjusted[k] ?? String(p.quantity)}
                    onChangeText={(v) => setAdjusted((prev) => ({ ...prev, [k]: v }))}
                    keyboardType="numeric"
                  />
                </View>
                <Button
                  title={pick ? 'Change part' : 'Attach a part'}
                  variant="secondary"
                  compact
                  onPress={() => setPicking(k)}
                  style={{ flex: 1 }}
                />
              </Rowed>

              {pick ? (
                <Pressable onPress={() => setChosen((prev) => {
                  const next = { ...prev };
                  delete next[k];
                  return next;
                })}>
                  <Rowed gap={2} align="center" style={{ marginTop: t.space(2) }}>
                    <MaterialCommunityIcons name="tag-outline" size={16} color={t.color.accent} />
                    <Txt size="sm" tone="accent" style={{ flex: 1 }}>{pick.partNumber} — {pick.label}</Txt>
                    <MaterialCommunityIcons name="close" size={16} color={t.color.textFaint} />
                  </Rowed>
                </Pressable>
              ) : (
                <Txt size="xs" tone="warn" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                  No part number yet. The right one depends on the panel and protocol, so either attach it here or the
                  office resolves it from the description.
                </Txt>
              )}
            </Card>
          );
        })}

        {uncovered.length ? (
          <>
            <H2>Not covered by this order</H2>
            <Banner
              tone="warn"
              title={`${uncovered.length} open defect${uncovered.length === 1 ? '' : 's'} contributed nothing`}
              body="Listed so the order is not mistaken for the whole job."
            />
            {Object.entries(
              uncovered.reduce<Record<string, number>>((acc, u) => {
                acc[u.reason] = (acc[u.reason] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([reason, count]) => (
              <Rowed key={reason} gap={2} align="flex-start">
                <Chip label={String(count)} tone="warn" />
                <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>
                  {UNCOVERED_REASON[reason as keyof typeof UNCOVERED_REASON]}
                </Txt>
              </Rowed>
            ))}
          </>
        ) : null}

        {parts.length ? (
          <>
            <H2>Raise the request</H2>
            <Card>
              <Field
                label="Supplier"
                value={supplier}
                onChangeText={setSupplier}
                placeholder="Leave blank for the office to choose"
              />
            </Card>
            <Button title="Raise a purchase request" onPress={raise} loading={saving} />
            {unresolved ? (
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                {unresolved} line{unresolved === 1 ? '' : 's'} will go out without a part number.
              </Txt>
            ) : null}
          </>
        ) : null}

        {labour.length ? (
          <>
            <H2>Labour on this work</H2>
            <Card>
              {labour.map((l) => (
                <Rowed key={l.description} style={{ justifyContent: 'space-between' }}>
                  <Txt size="sm" style={{ flex: 1 }}>{l.description}</Txt>
                  <Txt size="sm" tone="muted">
                    {l.hours} hr{l.hours === 1 ? '' : 's'} · {l.defectCount} defect{l.defectCount === 1 ? '' : 's'}
                  </Txt>
                </Rowed>
              ))}
              <Divider />
              {quote ? (
                <>
                  {quote.charge.lines.map((line, i) => (
                    <Rowed key={i} style={{ justifyContent: 'space-between' }}>
                      <Txt size="sm" style={{ flex: 1 }}>{line.label}</Txt>
                      <Txt size="sm">{formatCents(line.amountCents)}</Txt>
                    </Rowed>
                  ))}
                  <Rowed style={{ justifyContent: 'space-between', marginTop: t.space(1) }}>
                    <Txt size="sm" weight="700">Labour, inc GST</Txt>
                    <Txt size="sm" weight="700">{formatCents(quote.charge.totalCents)}</Txt>
                  </Rowed>
                  {quote.charge.warnings.length ? (
                    <Txt size="xs" tone="warn" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                      {quote.charge.warnings.join(' ')}
                    </Txt>
                  ) : null}
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                    {quote.note}
                  </Txt>
                </>
              ) : (
                // Quoting at nothing is worse than not quoting: a zero total
                // reads as a price.
                <Txt size="xs" tone="warn" style={{ lineHeight: 16 }}>
                  No charge-out rates are set, so this is hours only. Add them in Settings and the
                  labour is priced here.
                </Txt>
              )}
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                Hours come from the defect library, not from time recorded on site. They are an
                estimate for quoting and are not a timesheet.
              </Txt>
            </Card>
          </>
        ) : null}

        {picking ? (
          <DevicePicker
            visible
            onClose={() => setPicking(null)}
            onPick={(item) => {
              setChosen((prev) => ({
                ...prev,
                [picking]: { partNumber: item.partNumber, label: item.name },
              }));
              setPicking(null);
            }}
          />
        ) : null}
      </Screen>
    </>
  );
}
