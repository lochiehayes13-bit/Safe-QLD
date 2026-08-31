import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  appendixFFields,
  calculateBattery,
  FC_DEFAULT,
  L_DESIGN,
  L_IN_SERVICE,
  STANDARD_SLA_AH,
  type CalcMode,
  type Issue,
  type LoadItem,
} from '@/calc/battery';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * FIP standby battery calculator.
 *
 * The load schedule is the screen's centre of gravity rather than a pair of
 * total-current boxes: entering loads individually is what makes the standby
 * and alarm figures defensible, and it is the only way door holders and
 * brigade monitoring get counted correctly.
 */

let seq = 0;
const nextId = (): string => `load-${++seq}`;

/** Starting schedule — the lines that appear on nearly every job. */
function initialLoads(): LoadItem[] {
  return [
    { id: nextId(), label: 'Fire indicator panel', quantity: 1, standbyMa: 150, alarmMa: 250 },
    { id: nextId(), label: 'Detectors (loop)', quantity: 100, standbyMa: 0.33, alarmMa: 0.33 },
    { id: nextId(), label: 'Sounders / strobes', quantity: 0, standbyMa: 0, alarmMa: 15 },
    { id: nextId(), label: 'Alarm signalling equipment (ASE)', quantity: 1, standbyMa: 60, alarmMa: 100, isAse: true },
  ];
}

export default function BatteryCalculatorScreen() {
  const t = useTheme();
  const [mode, setMode] = useState<CalcMode>('design');
  const [loads, setLoads] = useState<LoadItem[]>(initialLoads);
  const [monitored, setMonitored] = useState(true);
  const [alarmMinutes, setAlarmMinutes] = useState('30');
  const [ageing, setAgeing] = useState(L_DESIGN);
  const [installedAh, setInstalledAh] = useState('');
  const [panelMaxAh, setPanelMaxAh] = useState('');
  const [psuOutput, setPsuOutput] = useState('');
  const [psuCharge, setPsuCharge] = useState('');
  const [tempC, setTempC] = useState('');
  const [showWhy, setShowWhy] = useState(false);

  const result = useMemo(
    () =>
      calculateBattery({
        mode,
        loads,
        monitored,
        alarmHours: (parseFloat(alarmMinutes) || 30) / 60,
        deteriorationFactor: mode === 'design' ? L_DESIGN : ageing,
        capacityDerating: FC_DEFAULT,
        averageTempC: tempC ? parseFloat(tempC) : undefined,
        installedBatteryAh: installedAh ? parseFloat(installedAh) : undefined,
        panelMaxBatteryAh: panelMaxAh ? parseFloat(panelMaxAh) : undefined,
        psuOutputA: psuOutput ? parseFloat(psuOutput) : undefined,
        psuChargeCurrentA: psuCharge ? parseFloat(psuCharge) : undefined,
      }),
    [mode, loads, monitored, alarmMinutes, ageing, tempC, installedAh, panelMaxAh, psuOutput, psuCharge],
  );

  const update = (id: string, patch: Partial<LoadItem>) =>
    setLoads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  const infos = result.issues.filter((i) => i.level === 'info');

  return (
    <>
      <Stack.Screen options={{ title: 'FIP battery' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'design', label: 'Design / new' },
            { value: 'service', label: 'In service' },
          ]}
        />
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          {mode === 'design'
            ? 'Sizing a new battery. The deterioration factor is fixed at 1.25 — the reduced figure is a service-only allowance.'
            : 'Assessing a battery already installed. 1.1 may be used once it has been in service more than 12 months.'}
        </Txt>

        <ResultBlock
          label={mode === 'design' ? 'Specify battery' : 'Capacity required'}
          value={result.recommendedAh !== null ? String(result.recommendedAh) : result.requiredAh.toFixed(1)}
          unit="Ah"
          tone={errors.length ? 'fail' : 'accent'}
          detail={
            result.recommendedAh !== null
              ? `Calculated ${result.requiredAh.toFixed(2)} Ah, rounded up to the next standard size. 2 × 12 V ${result.recommendedAh} Ah in series.`
              : 'Beyond common battery sizes — expect a purpose-built set and separate cabinet.'
          }
        />

        <Rowed gap={2}>
          <MiniStat label="Standby" value={`${(result.quiescentA * 1000).toFixed(0)} mA`} />
          <MiniStat label="Alarm" value={`${(result.alarmA * 1000).toFixed(0)} mA`} />
          <MiniStat label="Standby time" value={`${result.standbyHours} h`} />
        </Rowed>

        {errors.map((i, n) => <IssueBanner key={`e${n}`} issue={i} />)}
        {warnings.map((i, n) => <IssueBanner key={`w${n}`} issue={i} />)}

        <H2>Standby period</H2>
        <Card>
          <Pressable onPress={() => setMonitored(true)} style={{ paddingVertical: t.space(2) }}>
            <Rowed gap={3}>
              <Radio on={monitored} />
              <View style={{ flex: 1 }}>
                <Txt weight="600">Fault signal continuously monitored — 24 h</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 18 }}>
                  The power supply failure signal is monitored on site or remotely. Typical of any brigade-monitored building.
                </Txt>
              </View>
            </Rowed>
          </Pressable>
          <Divider />
          <Pressable onPress={() => setMonitored(false)} style={{ paddingVertical: t.space(2) }}>
            <Rowed gap={3}>
              <Radio on={!monitored} />
              <View style={{ flex: 1 }}>
                <Txt weight="600">Not continuously monitored — 72 h</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 18 }}>
                  The base requirement. Roughly three times the battery — this is the assumption most often got wrong.
                </Txt>
              </View>
            </Rowed>
          </Pressable>
        </Card>

        <H2>Load schedule</H2>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Enter standby and alarm current separately for each line. Door holders draw in standby and drop out in alarm;
          detectors are in microamps at rest and milliamps in alarm.
        </Txt>

        {loads.map((l) => (
          <LoadRow
            key={l.id}
            load={l}
            onChange={(patch) => update(l.id, patch)}
            onRemove={() => setLoads((prev) => prev.filter((x) => x.id !== l.id))}
          />
        ))}

        <Rowed gap={2}>
          <Button
            title="Add load"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              setLoads((prev) => [...prev, { id: nextId(), label: '', quantity: 1, standbyMa: 0, alarmMa: 0 }])
            }
            icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
          />
          <Button
            title="Door holders"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              setLoads((prev) => [
                ...prev,
                { id: nextId(), label: 'Door holders', quantity: 1, standbyMa: 55, alarmMa: 0, note: 'Energised in standby, released in alarm' },
              ])
            }
          />
        </Rowed>

        <H2>Conditions</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Alarm time" value={alarmMinutes} onChangeText={setAlarmMinutes} keyboardType="numeric" suffix="min" />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Battery temp"
              value={tempC}
              onChangeText={setTempC}
              keyboardType="numeric"
              suffix="°C"
              hint="Formula valid 15–30 °C"
            />
          </View>
        </Rowed>

        {mode === 'service' ? (
          <>
            <Segmented
              value={String(ageing)}
              onChange={(v) => setAgeing(parseFloat(v))}
              options={[
                { value: String(L_DESIGN), label: 'New / under 12 mo (1.25)' },
                { value: String(L_IN_SERVICE), label: 'Over 12 months (1.1)' },
              ]}
            />
            <Field
              label="Installed battery"
              value={installedAh}
              onChangeText={setInstalledAh}
              keyboardType="numeric"
              suffix="Ah"
              hint="Nameplate capacity of the battery actually fitted"
            />
            {result.installedPasses !== undefined ? (
              <Banner
                tone={result.installedPasses ? 'pass' : 'fail'}
                title={result.installedPasses ? 'Installed battery is adequate' : 'Installed battery is undersized'}
                body={`${installedAh} Ah fitted against ${result.requiredAh.toFixed(2)} Ah required.`}
              />
            ) : null}
          </>
        ) : null}

        <H2>Panel and power supply</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Panel max battery" value={panelMaxAh} onChangeText={setPanelMaxAh} keyboardType="numeric" suffix="Ah" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="PSU output" value={psuOutput} onChangeText={setPsuOutput} keyboardType="decimal-pad" suffix="A" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Charge current" value={psuCharge} onChangeText={setPsuCharge} keyboardType="decimal-pad" suffix="A" />
          </View>
        </Rowed>

        {result.charger ? (
          <Card>
            <Label>Charger check</Label>
            <View style={{ gap: t.space(1.5), marginTop: t.space(2) }}>
              <CheckLine
                label="Restores 80% within 24 h"
                detail={`Needs at least ${result.charger.minimumChargeA.toFixed(2)} A`}
                state={result.charger.rechargeOk}
              />
              <CheckLine
                label="Charges while carrying the load"
                detail={`Needs at least ${result.charger.requiredContinuousA.toFixed(2)} A continuous`}
                state={result.charger.simultaneousOk}
              />
            </View>
          </Card>
        ) : null}

        <H2>Working</H2>
        <Card>
          <Txt mono size="sm" tone="muted" style={{ lineHeight: 21 }}>
            C20 = L × [(Iq × Tq) + Fc × (Ia × Ta)]
          </Txt>
          <Divider />
          <WorkingLine label="Standby term (Iq × Tq)" value={`${result.standbyAh.toFixed(3)} Ah`} />
          <WorkingLine label={`Alarm term (Fc=${FC_DEFAULT} × Ia × Ta)`} value={`${result.alarmAh.toFixed(3)} Ah`} />
          <WorkingLine label="Subtotal" value={`${result.subtotalAh.toFixed(3)} Ah`} />
          <WorkingLine label={`× L = ${mode === 'design' ? L_DESIGN : ageing}`} value={`${result.requiredAh.toFixed(2)} Ah`} strong />
        </Card>

        {result.effectiveDerating !== undefined ? (
          <>
            <Pressable onPress={() => setShowWhy((v) => !v)}>
              <Rowed gap={1}>
                <Txt size="sm" tone="accent" weight="700">
                  {showWhy ? 'Hide' : 'Why is the de-rating factor 2?'}
                </Txt>
                <MaterialCommunityIcons
                  name={showWhy ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={t.color.accentText}
                />
              </Rowed>
            </Pressable>
            {showWhy ? (
              <Card>
                <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
                  A lead-acid battery delivers less than its rated capacity when discharged quickly, so the alarm term is
                  de-rated. At {result.alarmCRate?.toFixed(3)}C this system would only need about{' '}
                  {result.effectiveDerating.toFixed(2)}× — the mandated factor of {FC_DEFAULT} is conservative here, and gets
                  closer to necessary on large occupant warning loads. Always size to {FC_DEFAULT}.
                </Txt>
              </Card>
            ) : null}
          </>
        ) : null}

        <H2>Baseline data</H2>
        <Card>
          <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2), lineHeight: 19 }}>
            The power supply items a commissioning record asks for, ready to transcribe.
          </Txt>
          {appendixFFields(result).map((f) => (
            <View key={f.item} style={{ paddingVertical: t.space(1.5) }}>
              <Txt size="xs" tone="faint" weight="700">{f.item}  {f.field}</Txt>
              <Txt size="sm" weight="600">{f.value}</Txt>
            </View>
          ))}
        </Card>

        {infos.map((i, n) => <IssueBanner key={`i${n}`} issue={i} />)}

        <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 4 }}>
          Standard battery sizes offered: {STANDARD_SLA_AH.join(', ')} Ah. Always confirm the result against the current
          standard and the panel manufacturer's own data before relying on it.
        </Txt>
      </Screen>
    </>
  );
}

function LoadRow({
  load,
  onChange,
  onRemove,
}: {
  load: LoadItem;
  onChange: (patch: Partial<LoadItem>) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  return (
    <Card>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Load" value={load.label} onChangeText={(v) => onChange({ label: v })} placeholder="Description" />
        </View>
        <Pressable onPress={onRemove} hitSlop={10} style={{ paddingTop: 22 }}>
          <MaterialCommunityIcons name="close-circle-outline" size={22} color={t.color.textFaint} />
        </Pressable>
      </Rowed>
      <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
        <View style={{ flex: 0.8 }}>
          <Field
            label="Qty"
            value={String(load.quantity)}
            onChangeText={(v) => onChange({ quantity: parseFloat(v) || 0 })}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1.1 }}>
          <Field
            label="Standby"
            value={String(load.standbyMa)}
            onChangeText={(v) => onChange({ standbyMa: parseFloat(v) || 0 })}
            keyboardType="decimal-pad"
            suffix="mA"
          />
        </View>
        <View style={{ flex: 1.1 }}>
          <Field
            label="Alarm"
            value={String(load.alarmMa)}
            onChangeText={(v) => onChange({ alarmMa: parseFloat(v) || 0 })}
            keyboardType="decimal-pad"
            suffix="mA"
          />
        </View>
      </Rowed>
      {load.note ? <Txt size="xs" tone="faint" style={{ marginTop: 6 }}>{load.note}</Txt> : null}
      <Txt size="xs" tone="faint" style={{ marginTop: 6 }}>
        Subtotal {(load.quantity * load.standbyMa).toFixed(1)} mA standby · {(load.quantity * load.alarmMa).toFixed(1)} mA alarm
      </Txt>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.color.surface,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.color.border,
        padding: t.space(2.5),
      }}
    >
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Txt>
      <Txt size="lg" weight="700">{value}</Txt>
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: on ? t.color.accent : t.color.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
      }}
    >
      {on ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.color.accent }} /> : null}
    </View>
  );
}

function CheckLine({ label, detail, state }: { label: string; detail: string; state: boolean | null }) {
  const t = useTheme();
  const icon = state === null ? 'help-circle-outline' : state ? 'check-circle' : 'alert-circle';
  const colour = state === null ? t.color.textFaint : state ? t.color.pass : t.color.fail;
  return (
    <Rowed gap={2} align="flex-start">
      <MaterialCommunityIcons name={icon} size={18} color={colour} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight="600">{label}</Txt>
        <Txt size="xs" tone="muted">{state === null ? 'Enter the supply figures to check' : detail}</Txt>
      </View>
    </Rowed>
  );
}

function WorkingLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(1) }}>
      <Txt size="sm" tone={strong ? 'default' : 'muted'} weight={strong ? '700' : '400'}>{label}</Txt>
      <Txt size="sm" mono weight={strong ? '700' : '400'}>{value}</Txt>
    </Rowed>
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
