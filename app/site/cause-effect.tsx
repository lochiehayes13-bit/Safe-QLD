import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  createCauseEffectRule, deleteCauseEffectRule, getSite, listCauseEffect, listPanels, listZones,
} from '@/db/repo';
import { newId } from '@/db';
import type { CauseEffectRule, CauseKind, CellState, EffectKind, Panel, Site, Zone } from '@/domain/types';
import { EFFECT_LABEL, causeEffectMatrixSheet } from '@/export/sheets';
import { causeEffectHtml } from '@/export/pdf';
import { shareFile, writePdf, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { useTheme } from '@/theme';
import { describeActionFailure } from '@/domain/loadFailure';
import { searchZones } from '@/domain/zonePick';
import {
  Button, Card, Chip, Divider, EmptyState, Field, Label, Rowed, Screen, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/**
 * Cause and effect.
 *
 * The matrix is the deliverable, but the grid is unreadable on a phone, so the
 * screen edits by cause and exports the grid.
 *
 * There was a Test mode here, a checklist of what each cause should operate.
 * Its ticks were never stored, so it was removed: the outcome of a test
 * belongs on the service report, where it is kept.
 */
const CAUSE_KINDS: { value: CauseKind; label: string }[] = [
  { value: 'zone-alarm', label: 'Zone alarm' },
  { value: 'point-alarm', label: 'Point alarm' },
  { value: 'mcp', label: 'Call point' },
  { value: 'sprinkler-flow', label: 'Sprinkler flow' },
  { value: 'aspirating-alert', label: 'ASD alert' },
  { value: 'aspirating-action', label: 'ASD action' },
  { value: 'aspirating-fire1', label: 'ASD fire 1' },
  { value: 'aspirating-fire2', label: 'ASD fire 2' },
  { value: 'gas-release', label: 'Gas release' },
  { value: 'fault', label: 'Fault' },
  { value: 'isolate', label: 'Isolate' },
  { value: 'manual', label: 'Manual' },
  { value: 'other', label: 'Other' },
];

const EFFECT_KINDS: EffectKind[] = [
  'occupant-warning', 'evacuation', 'sounders', 'strobes', 'brigade-signal',
  'ahu-shutdown', 'lift-homing', 'door-release', 'damper-close', 'gas-release',
  'smoke-control', 'pressurisation', 'plant-shutdown', 'relay-output', 'other',
];

export default function CauseEffectScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelId, setPanelId] = useState<string>();
  const [zones, setZones] = useState<Zone[]>([]);
  const [rules, setRules] = useState<CauseEffectRule[]>([]);
  // Whether the panels have been read, so "no panel" is not shown while they load.
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    void Promise.all([getSite(siteId), listPanels(siteId)]).then(([s, p]) => {
      setSite(s);
      setPanels(p);
      setPanelId((cur) => cur ?? p[0]?.id);
      setLoaded(true);
    });
  }, [siteId]);

  const load = useCallback(async () => {
    if (!panelId) return;
    const [r, z] = await Promise.all([listCauseEffect(panelId), listZones(panelId, false)]);
    setRules(r);
    setZones(z);
  }, [panelId]);

  useEffect(() => { void load(); }, [load]);

  const panel = panels.find((p) => p.id === panelId);

  const exportMatrix = async (kind: 'pdf' | 'xlsx') => {
    if (!panel || !site) return;
    setBusy(true);
    try {
      const name = `Cause and Effect - ${site.name} ${panel.name}`;
      if (kind === 'pdf') {
        const html = causeEffectHtml(panel, rules, site.name, new Date().toISOString());
        const file = await writePdf(name, html);
        const shared = await shareFile(file, 'Cause and effect');
        if (!shared) {
          const notice = notSharedNotice(file.name, 'matrix');
          showAlert(notice.title, notice.body);
        }
      } else {
        const file = writeXlsx(name, [causeEffectMatrixSheet(panel, rules)]);
        const shared = await shareFile(file, 'Cause and effect');
        if (!shared) {
          const notice = notSharedNotice(file.name, 'matrix');
          showAlert(notice.title, notice.body);
        }
      }
    } catch (e) {
      showAlert('Could not export', describeActionFailure(e, 'export the matrix'));
    } finally {
      setBusy(false);
    }
  };

  if (!siteId) return <ContextGate kind="site" what="the cause and effect matrix" title="Cause &amp; effect" backTo="/site/cause-effect" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Cause & effect' }} />
      <Screen>
        {panels.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
            {panels.map((p) => (
              <Chip key={p.id} label={p.name} selected={panelId === p.id} onPress={() => setPanelId(p.id)} />
            ))}
          </ScrollView>
        ) : null}

        {/*
          * A site with no panel has nothing to write a rule against. Said
          * with the way to fix it, rather than offering "Add a cause" and
          * swallowing the press.
          */}
        {loaded && !panelId ? (
          <EmptyState
            icon="alarm-light-outline"
            title="No panel at this site"
            body="Import the panel config first."
            action={(
              <Button
                title="Import config"
                onPress={() => router.push('/config')}
              />
            )}
          />
        ) : null}

        {rules.length ? (
          <Rowed gap={2}>
            <Button title="PDF matrix" style={{ flex: 1 }} onPress={() => exportMatrix('pdf')} loading={busy} />
            <Button title="Spreadsheet" variant="secondary" style={{ flex: 1 }} onPress={() => exportMatrix('xlsx')} loading={busy} />
          </Rowed>
        ) : null}

        {panelId && adding ? (
          <AddRule
            zones={zones}
            onCancel={() => setAdding(false)}
            onSave={async (rule) => {
              try {
                await createCauseEffectRule(panelId, rule);
                setAdding(false);
                void load();
              } catch (e) {
                showAlert('Not saved', describeActionFailure(e, 'save the cause'));
              }
            }}
          />
        ) : null}
        {panelId && !adding ? (
          <Button
            title="Add a cause"
            variant="secondary"
            onPress={() => setAdding(true)}
            icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
          />
        ) : null}

        {rules.length ? (
          rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              onDelete={() => {
                showAlert('Remove this cause?', r.causeLabel, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => { await deleteCauseEffectRule(r.id); void load(); },
                  },
                ]);
              }}
            />
          ))
        ) : panelId ? (
          <EmptyState
            icon="sitemap-outline"
            title="No causes yet"
            body="Add each cause and the outputs it operates."
          />
        ) : null}
      </Screen>
    </>
  );
}

function RuleCard({ rule, onDelete }: { rule: CauseEffectRule; onDelete: () => void }) {
  const t = useTheme();

  return (
    <Card>
      <Rowed align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700">{rule.causeLabel}</Txt>
          <Txt size="sm" tone="muted">
            {CAUSE_KINDS.find((c) => c.value === rule.causeKind)?.label ?? rule.causeKind}
            {rule.causeZoneNumber !== undefined && rule.causeZoneNumber !== null ? ` · Zone ${rule.causeZoneNumber}` : ''}
          </Txt>
        </View>
        <Pressable onPress={onDelete} hitSlop={10}>
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={t.color.textFaint} />
        </Pressable>
      </Rowed>

      <Divider />
      <Label>Effects</Label>

      <View style={{ marginTop: t.space(2), gap: t.space(1.5) }}>
        {rule.effects.map((e) => (
          <Rowed key={e.id} gap={2}>
            <MaterialCommunityIcons
              name={e.state === 'conditional' ? 'help-circle-outline' : 'arrow-right-thin'}
              size={18}
              color={e.state === 'conditional' ? t.color.warn : t.color.accentText}
            />
            <Txt size="sm" style={{ flex: 1 }}>
              {e.effectLabel || EFFECT_LABEL[e.effectKind]}
            </Txt>
            {e.delaySeconds ? <Chip label={`${e.delaySeconds}s`} /> : null}
            {e.state === 'conditional' ? <Chip label="Conditional" tone="warn" /> : null}
          </Rowed>
        ))}
      </View>

      {rule.sourceLogic ? (
        <>
          <Divider />
          <Label>Panel logic</Label>
          <Txt size="xs" mono tone="muted" style={{ marginTop: 4 }}>{rule.sourceLogic}</Txt>
        </>
      ) : null}
      {rule.notes ? <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>{rule.notes}</Txt> : null}
    </Card>
  );
}

/** How many zones the picker draws at once. Where it cuts, it says so. */
const ZONE_ROWS = 8;

function AddRule({
  zones, onCancel, onSave,
}: {
  zones: Zone[];
  onCancel: () => void;
  onSave: (rule: Omit<CauseEffectRule, 'id' | 'panelId'>) => Promise<void>;
}) {
  const t = useTheme();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CauseKind>('zone-alarm');
  const [zoneNumber, setZoneNumber] = useState<number>();
  const [zoneQuery, setZoneQuery] = useState('');
  const [effects, setEffects] = useState<EffectKind[]>(['occupant-warning', 'brigade-signal']);
  const [delays, setDelays] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const zone = useMemo(() => zones.find((z) => z.number === zoneNumber), [zones, zoneNumber]);
  const found = useMemo(() => searchZones(zones, zoneQuery, ZONE_ROWS), [zones, zoneQuery]);

  const save = () => {
    const finalLabel = label.trim() || (zone ? `Zone ${zone.number} — ${zone.text}` : 'Cause');
    void onSave({
      causeLabel: finalLabel,
      causeKind: kind,
      causeZoneNumber: zoneNumber,
      notes: notes.trim() || undefined,
      effects: effects.map((k) => ({
        id: newId(),
        effectLabel: EFFECT_LABEL[k],
        effectKind: k,
        delaySeconds: delays[k] ? parseInt(delays[k]!, 10) : undefined,
        state: 'operates' as CellState,
      })),
    });
  };

  return (
    <Card>
      <Label>New cause</Label>

      <View style={{ height: t.space(2) }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
        {CAUSE_KINDS.map((c) => (
          <Chip key={c.value} label={c.label} selected={kind === c.value} onPress={() => setKind(c.value)} />
        ))}
      </ScrollView>

      {kind === 'zone-alarm' && zones.length ? (
        <>
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Zone"
            value={zoneQuery}
            onChangeText={setZoneQuery}
            placeholder="Number or name"
            autoCapitalize="none"
          />
          <View style={{ marginTop: t.space(1) }}>
            {found.rows.map((z) => {
              const picked = zoneNumber === z.number;
              return (
                <Pressable
                  key={z.id}
                  onPress={() => setZoneNumber(picked ? undefined : z.number)}
                  style={{ minHeight: 40, justifyContent: 'center' }}
                >
                  <Rowed gap={2}>
                    <Txt mono size="sm" tone="accent" weight="700" style={{ minWidth: 40 }}>{z.number}</Txt>
                    <Txt size="sm" style={{ flex: 1 }} numberOfLines={1} weight={picked ? '700' : '400'}>
                      {z.text || 'No text'}
                    </Txt>
                    <MaterialCommunityIcons
                      name={picked ? 'check-circle' : 'circle-outline'}
                      size={18}
                      color={picked ? t.color.accent : t.color.textFaint}
                    />
                  </Rowed>
                </Pressable>
              );
            })}
            {found.matching === 0 ? <Txt size="sm" tone="faint">No zone matches.</Txt> : null}
            {found.matching > found.rows.length ? (
              <Txt size="xs" tone="faint">
                First {found.rows.length} of {found.matching}. Search to narrow.
              </Txt>
            ) : null}
          </View>
          {zone ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 6 }}>
              Picked: zone {zone.number}{zone.text ? `, ${zone.text}` : ''}
            </Txt>
          ) : null}
        </>
      ) : null}

      <View style={{ height: t.space(2.5) }} />
      <Field
        label="Label"
        value={label}
        onChangeText={setLabel}
        placeholder={zone ? `Zone ${zone.number} — ${zone.text}` : 'As it reads on the matrix'}
      />

      <View style={{ height: t.space(2.5) }} />
      <Label>Effects</Label>
      <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
        {EFFECT_KINDS.map((k) => (
          <Chip
            key={k}
            label={EFFECT_LABEL[k]}
            selected={effects.includes(k)}
            onPress={() => setEffects((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}
          />
        ))}
      </Rowed>

      {effects.length ? (
        <View style={{ marginTop: t.space(2.5), gap: t.space(2) }}>
          <Label>Delays (seconds)</Label>
          {effects.map((k) => (
            <Rowed key={k} gap={2} align="center">
              <Txt size="sm" style={{ flex: 1 }}>{EFFECT_LABEL[k]}</Txt>
              <View style={{ width: 96 }}>
                <Field
                  label=""
                  value={delays[k] ?? ''}
                  onChangeText={(v) => setDelays((p) => ({ ...p, [k]: v }))}
                  keyboardType="numeric"
                  suffix="s"
                />
              </View>
            </Rowed>
          ))}
        </View>
      ) : null}

      <View style={{ height: t.space(2.5) }} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

      <View style={{ height: t.space(3) }} />
      <Rowed gap={2}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onCancel} />
        <Button title="Add" style={{ flex: 1 }} onPress={save} disabled={!effects.length} />
      </Rowed>
    </Card>
  );
}
