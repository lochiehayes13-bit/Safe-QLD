import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  VESDA_ACCESSORIES,
  VESDA_MODELS,
  VESDA_PSUS,
  calculateVesda,
  type VesdaDetectorSelection,
} from '@/calc/vesda';
import type { Issue } from '@/calc/battery';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * VESDA battery calculator.
 *
 * The aspirator setting is a required, prominent choice — it is the single
 * biggest lever in the calculation, and a tool that quietly assumes the lowest
 * setting will undersize most real installations.
 */

let seq = 0;

export default function VesdaScreen() {
  const t = useTheme();
  const [detectors, setDetectors] = useState<(VesdaDetectorSelection & { key: string })[]>([
    { key: `d${++seq}`, modelId: 'vep-a00-p', setting: 1, quantity: 1, accessoryIds: [] },
  ]);
  const [monitored, setMonitored] = useState(false);
  const [alarmMinutes, setAlarmMinutes] = useState('30');
  const [psuId, setPsuId] = useState<string | undefined>(undefined);

  const result = useMemo(
    () =>
      calculateVesda({
        detectors,
        monitored,
        alarmHours: (parseFloat(alarmMinutes) || 30) / 60,
        psuId,
      }),
    [detectors, monitored, alarmMinutes, psuId],
  );

  const update = (key: string, patch: Partial<VesdaDetectorSelection>) =>
    setDetectors((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const errors = result.issues.filter((i) => i.level === 'error');
  const others = result.issues.filter((i) => i.level !== 'error');

  return (
    <>
      <Stack.Screen options={{ title: 'VESDA battery' }} />
      <Screen>
        <ResultBlock
          label="Specify battery"
          value={result.recommendedAh !== null ? String(result.recommendedAh) : result.requiredAh.toFixed(1)}
          unit="Ah"
          tone={errors.length ? 'fail' : 'accent'}
          detail={`Calculated ${result.requiredAh.toFixed(2)} Ah · standby ${(result.quiescentA * 1000).toFixed(0)} mA over ${result.standbyHours} h`}
        />

        <Banner
          tone="info"
          title="Standby dominates on aspirating detection"
          body={`The aspirator runs continuously, so alarm current sits only a few percent above standby. Here the standby term is ${((result.standbyAh / result.subtotalAh) * 100).toFixed(0)}% of the total — unlike a conventional panel, where sounders dominate.`}
        />

        {errors.map((i, n) => <IssueBanner key={`e${n}`} issue={i} />)}

        <H2>Detectors</H2>
        {detectors.map((d) => (
          <DetectorRow
            key={d.key}
            sel={d}
            onChange={(patch) => update(d.key, patch)}
            onRemove={() => setDetectors((prev) => prev.filter((x) => x.key !== d.key))}
            canRemove={detectors.length > 1}
          />
        ))}
        <Button
          title="Add detector"
          variant="secondary"
          onPress={() =>
            setDetectors((prev) => [...prev, { key: `d${++seq}`, modelId: 'vep-a00-p', setting: 1, quantity: 1, accessoryIds: [] }])
          }
          icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
        />

        <H2>Standby period</H2>
        <Segmented
          value={monitored ? 'yes' : 'no'}
          onChange={(v) => setMonitored(v === 'yes')}
          options={[
            { value: 'no', label: 'Not monitored — 72 h' },
            { value: 'yes', label: 'Monitored — 24 h' },
          ]}
        />
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          24 h applies only where the supply produces a power-supply-failure signal that is continuously monitored. Marketing
          figures generally assume it; the standard does not.
        </Txt>

        <Field label="Alarm time" value={alarmMinutes} onChangeText={setAlarmMinutes} keyboardType="numeric" suffix="min" />

        <H2>Power supply</H2>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
          <Chip label="None" selected={!psuId} onPress={() => setPsuId(undefined)} />
          {VESDA_PSUS.map((p) => (
            <Chip key={p.id} label={p.model} selected={psuId === p.id} onPress={() => setPsuId(p.id)} />
          ))}
        </ScrollView>

        {result.psuUtilisation !== undefined ? (
          <Card>
            <Label>Continuous supply load</Label>
            <Rowed gap={2} align="baseline" style={{ marginTop: 4 }}>
              <Txt size="xxl" weight="700" tone={result.psuUtilisation > 1 ? 'fail' : result.psuUtilisation > 0.8 ? 'warn' : 'pass'}>
                {(result.psuUtilisation * 100).toFixed(0)}%
              </Txt>
              <Txt tone="muted" size="sm">of {result.psuModel}</Txt>
            </Rowed>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.color.surfaceAlt, marginTop: t.space(2), overflow: 'hidden' }}>
              <View
                style={{
                  width: `${Math.min(100, result.psuUtilisation * 100)}%`,
                  height: '100%',
                  backgroundColor:
                    result.psuUtilisation > 1 ? t.color.fail : result.psuUtilisation > 0.8 ? t.color.warn : t.color.pass,
                }}
              />
            </View>
          </Card>
        ) : null}

        {others.map((i, n) => <IssueBanner key={`o${n}`} issue={i} />)}

        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          VESDA-E figures are published in watts and converted at 24 V. Only aspirator settings the manufacturer publishes are
          offered — consumption does not rise linearly, so intermediate settings are not interpolated.
        </Txt>
      </Screen>
    </>
  );
}

function DetectorRow({
  sel,
  onChange,
  onRemove,
  canRemove,
}: {
  sel: VesdaDetectorSelection;
  onChange: (patch: Partial<VesdaDetectorSelection>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTheme();
  const model = VESDA_MODELS.find((m) => m.id === sel.modelId);
  const settings = model?.variants.map((v) => v.setting) ?? [];

  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }}>
        <Label>Detector</Label>
        {canRemove ? (
          <Pressable onPress={onRemove} hitSlop={10}>
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={t.color.textFaint} />
          </Pressable>
        ) : null}
      </Rowed>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingVertical: t.space(2) }}>
        {VESDA_MODELS.map((m) => (
          <Chip
            key={m.id}
            label={m.model.replace('VESDA-E ', '')}
            selected={sel.modelId === m.id}
            onPress={() => {
              // Settings differ per model, so reset to the first published one.
              const first = m.variants[0]?.setting ?? 1;
              onChange({ modelId: m.id, setting: first });
            }}
          />
        ))}
      </ScrollView>
      {model ? <Txt size="xs" tone="faint">{model.description}{model.note ? ` · ${model.note}` : ''}</Txt> : null}

      <Divider />
      <Label>Aspirator setting</Label>
      <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
        {settings.map((s) => (
          <Chip key={String(s)} label={s === 'fixed' ? 'Fixed' : `Setting ${s}`} selected={sel.setting === s} onPress={() => onChange({ setting: s })} />
        ))}
      </Rowed>

      <View style={{ marginTop: t.space(2) }}>
        <Field
          label="Quantity"
          value={String(sel.quantity)}
          onChangeText={(v) => onChange({ quantity: parseInt(v, 10) || 0 })}
          keyboardType="numeric"
        />
      </View>

      {model && !model.displayIncluded ? (
        <>
          <Divider />
          <Label>Accessories</Label>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            {VESDA_ACCESSORIES.map((a) => {
              const on = sel.accessoryIds?.includes(a.id) ?? false;
              return (
                <Chip
                  key={a.id}
                  label={a.label}
                  selected={on}
                  onPress={() =>
                    onChange({
                      accessoryIds: on
                        ? (sel.accessoryIds ?? []).filter((x) => x !== a.id)
                        : [...(sel.accessoryIds ?? []), a.id],
                    })
                  }
                />
              );
            })}
          </Rowed>
        </>
      ) : null}
    </Card>
  );
}

function IssueBanner({ issue }: { issue: Issue }) {
  return (
    <Banner
      tone={issue.level === 'error' ? 'fail' : issue.level === 'warning' ? 'warn' : 'info'}
      title={issue.title}
      body={issue.detail}
    />
  );
}
