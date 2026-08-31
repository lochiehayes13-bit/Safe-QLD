import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSite, listDefects } from '@/db/repo';
import { createPurchaseRequest, type PurchaseLine } from '@/db/opsRepo';
import {
  UNCOVERED_REASON, partsNeededFor, uncoveredDefects, type NeededPart,
} from '@/domain/partsNeeded';
import type { Defect, Site } from '@/domain/types';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import { DevicePicker } from '@/components/DevicePicker';
import {
  Banner, Button, Card, Chip, Field, H2, Rowed, Screen, Txt,
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

  const load = useCallback(async () => {
    if (!siteId) return;
    const [s, d] = await Promise.all([getSite(siteId), listDefects(siteId)]);
    setSite(s);
    setDefects(d.filter((x) => x.status === 'open'));
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
      const prefs = await loadPrefs();
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

  return (
    <>
      <Stack.Screen options={{ title: 'Parts needed' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Built from the coded defects open at {site?.name ?? 'this site'}. Quantities add up across defects that need
          the same thing. Labour is left out — it belongs on the quote, not on an order.
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
