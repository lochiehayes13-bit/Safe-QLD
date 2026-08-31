import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  createCauseEffectRule, deleteCauseEffectRule, getSite, listCauseEffect, listPanels, listZones,
} from '@/db/repo';
import { newId } from '@/db';
import type { CauseEffectRule, CauseKind, CellState, EffectKind, Panel, Site, Zone } from '@/domain/types';
import { EFFECT_LABEL, causeEffectMatrixSheet } from '@/export/sheets';
import { causeEffectHtml } from '@/export/pdf';
import { shareFile, writePdf, writeXlsx } from '@/export/files';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * Cause and effect.
 *
 * The matrix is the deliverable, but the grid is unreadable on a phone, so the
 * screen edits by cause and exports the grid. Testing works the other way
 * round: pick a cause, the app tells you what should happen, and you confirm
 * what actually did — which is what makes it commissioning evidence rather
 * than a drawing.
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

type Mode = 'edit' | 'test';

export default function CauseEffectScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelId, setPanelId] = useState<string>();
  const [zones, setZones] = useState<Zone[]>([]);
  const [rules, setRules] = useState<CauseEffectRule[]>([]);
  const [mode, setMode] = useState<Mode>('edit');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    void Promise.all([getSite(siteId), listPanels(siteId)]).then(([s, p]) => {
      setSite(s);
      setPanels(p);
      setPanelId((cur) => cur ?? p[0]?.id);
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
        await shareFile(file, 'Cause and effect');
      } else {
        const file = writeXlsx(name, [causeEffectMatrixSheet(panel, rules)]);
        await shareFile(file, 'Cause and effect');
      }
    } finally {
      setBusy(false);
    }
  };

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

        <Segmented
          value={mode}
          onChange={setMode}
          options={[{ value: 'edit', label: 'Build' }, { value: 'test', label: 'Test' }]}
        />

        {mode === 'test' ? (
          <Banner
            tone="info"
            title="Expected versus actual"
            body="Pick a cause and the app lists what should happen. Confirming each effect as you see it is what turns a drawing into commissioning evidence."
          />
        ) : null}

        {rules.length ? (
          <Rowed gap={2}>
            <Button title="PDF matrix" style={{ flex: 1 }} onPress={() => exportMatrix('pdf')} loading={busy} />
            <Button title="Spreadsheet" variant="secondary" style={{ flex: 1 }} onPress={() => exportMatrix('xlsx')} loading={busy} />
          </Rowed>
        ) : null}

        {adding && panelId ? (
          <AddRule
            zones={zones}
            onCancel={() => setAdding(false)}
            onSave={async (rule) => {
              await createCauseEffectRule(panelId, rule);
              setAdding(false);
              void load();
            }}
          />
        ) : (
          <Button
            title="Add a cause"
            variant="secondary"
            onPress={() => setAdding(true)}
            icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
          />
        )}

        {rules.length ? (
          rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              mode={mode}
              onDelete={() => {
                Alert.alert('Remove this cause?', r.causeLabel, [
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
        ) : (
          <EmptyState
            title="No cause and effect recorded"
            body="Add each cause and the outputs it operates. The matrix exports as a landscape PDF or a spreadsheet."
          />
        )}
      </Screen>
    </>
  );
}

function RuleCard({ rule, mode, onDelete }: { rule: CauseEffectRule; mode: Mode; onDelete: () => void }) {
  const t = useTheme();
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

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
        {mode === 'edit' ? (
          <Pressable onPress={onDelete} hitSlop={10}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={t.color.textFaint} />
          </Pressable>
        ) : null}
      </Rowed>

      <Divider />
      <Label>{mode === 'test' ? 'Should happen' : 'Effects'}</Label>

      <View style={{ marginTop: t.space(2), gap: t.space(1.5) }}>
        {rule.effects.map((e) => {
          const ok = confirmed[e.id];
          return (
            <Pressable
              key={e.id}
              onPress={() => (mode === 'test' ? setConfirmed((p) => ({ ...p, [e.id]: !p[e.id] })) : undefined)}
            >
              <Rowed gap={2}>
                {mode === 'test' ? (
                  <MaterialCommunityIcons
                    name={ok ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                    size={20}
                    color={ok ? t.color.pass : t.color.textFaint}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={e.state === 'conditional' ? 'help-circle-outline' : 'arrow-right-thin'}
                    size={18}
                    color={e.state === 'conditional' ? t.color.warn : t.color.accentText}
                  />
                )}
                <Txt size="sm" style={{ flex: 1 }} weight={ok ? '700' : '400'}>
                  {e.effectLabel || EFFECT_LABEL[e.effectKind]}
                </Txt>
                {e.delaySeconds ? <Chip label={`${e.delaySeconds}s`} /> : null}
                {e.state === 'conditional' ? <Chip label="Conditional" tone="warn" /> : null}
              </Rowed>
            </Pressable>
          );
        })}
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
  const [effects, setEffects] = useState<EffectKind[]>(['occupant-warning', 'brigade-signal']);
  const [delays, setDelays] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const zone = useMemo(() => zones.find((z) => z.number === zoneNumber), [zones, zoneNumber]);

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
          <Label>Zone</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingTop: t.space(1.5) }}>
            {zones.slice(0, 60).map((z) => (
              <Chip key={z.id} label={`${z.number}`} selected={zoneNumber === z.number} onPress={() => setZoneNumber(z.number)} />
            ))}
          </ScrollView>
          {zone ? <Txt size="sm" tone="muted" style={{ marginTop: 6 }}>{zone.text}</Txt> : null}
        </>
      ) : null}

      <View style={{ height: t.space(2.5) }} />
      <Field
        label="Label"
        value={label}
        onChangeText={setLabel}
        placeholder={zone ? `Zone ${zone.number} — ${zone.text}` : 'How this cause reads on the matrix'}
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
          <Label>Delays (seconds, leave blank for none)</Label>
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
