import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { autonomyHours, power } from '@/calc/electrical';
import { readNumber } from '@/calc/fieldNumber';
import { OHMS_FIELDS, filledFields, solveFromLatest, touchField, type OhmsField } from '@/calc/ohmsEntry';
import { formatValue } from '@/calc/units';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

const FIELD_LABEL: Record<OhmsField, string> = { volts: 'Volts', amps: 'Amps', ohms: 'Ohms', watts: 'Watts' };
const FIELD_UNIT: Record<OhmsField, string> = { volts: 'V', amps: 'A', ohms: 'Ω', watts: 'W' };
const BLANK: Record<OhmsField, string> = { volts: '', amps: '', ohms: '', watts: '' };

/** Ohm's law, power and battery runtime. */
export default function OhmsScreen() {
  const t = useTheme();
  const [texts, setTexts] = useState<Record<OhmsField, string>>(BLANK);
  const [order, setOrder] = useState<OhmsField[]>([]);

  const [pVolts, setPVolts] = useState('');
  const [pAmps, setPAmps] = useState('');
  const [pf, setPf] = useState('1');
  const [phase, setPhase] = useState<'single' | 'three'>('single');

  const [capAh, setCapAh] = useState('');
  const [loadA, setLoadA] = useState('');

  const edit = (field: OhmsField) => (text: string) => {
    setTexts((prev) => ({ ...prev, [field]: text }));
    setOrder((prev) => touchField(prev, field));
  };

  const filled = useMemo(() => filledFields(texts, order), [texts, order]);
  const ohmsResult = useMemo(() => solveFromLatest(texts, order), [texts, order]);
  const usedPair = OHMS_FIELDS.filter((f) => filled.slice(0, 2).includes(f));
  const anyTyped = OHMS_FIELDS.some((f) => texts[f].trim());

  const powerResult = useMemo(() => {
    const v = readNumber(pVolts);
    const a = readNumber(pAmps);
    if (v === undefined || a === undefined) return undefined;
    return power({ volts: v, amps: a, powerFactor: readNumber(pf), phase });
  }, [pVolts, pAmps, pf, phase]);

  const runtime = useMemo(() => {
    const cap = readNumber(capAh);
    const load = readNumber(loadA);
    return cap === undefined || load === undefined ? null : autonomyHours(cap, load);
  }, [capAh, loadA]);

  return (
    <>
      <Stack.Screen options={{ title: "Ohm's law" }} />
      <Screen>
        <H2>{"Ohm's law"}</H2>
        <Txt size="sm" tone="muted">Enter any two.</Txt>
        <Rowed gap={2} align="flex-start">
          {(['volts', 'amps'] as const).map((f) => (
            <View key={f} style={{ flex: 1 }}>
              <Field label={FIELD_LABEL[f]} value={texts[f]} onChangeText={edit(f)} keyboardType="decimal-pad" suffix={FIELD_UNIT[f]} />
            </View>
          ))}
        </Rowed>
        <Rowed gap={2} align="flex-start">
          {(['ohms', 'watts'] as const).map((f) => (
            <View key={f} style={{ flex: 1 }}>
              <Field label={FIELD_LABEL[f]} value={texts[f]} onChangeText={edit(f)} keyboardType="decimal-pad" suffix={FIELD_UNIT[f]} />
            </View>
          ))}
        </Rowed>

        {ohmsResult ? (
          <Card>
            <Label>From {usedPair.map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')}</Label>
            <View style={{ marginTop: t.space(2), gap: t.space(1) }}>
              <Row label="Volts" value={`${formatValue(ohmsResult.volts)} V`} />
              <Row label="Amps" value={`${formatValue(ohmsResult.amps)} A`} />
              <Row label="Ohms" value={`${formatValue(ohmsResult.ohms)} Ω`} />
              <Row label="Watts" value={`${formatValue(ohmsResult.watts)} W`} />
            </View>
          </Card>
        ) : filled.length >= 2 ? (
          <Banner tone="warn" title="Check the values" body="Zero or negative values won't solve." />
        ) : null}
        {anyTyped ? (
          <Button
            title="Clear"
            variant="ghost"
            compact
            onPress={() => { setTexts(BLANK); setOrder([]); }}
          />
        ) : null}

        <H2>Power</H2>
        <Segmented
          value={phase}
          onChange={setPhase}
          options={[{ value: 'single', label: 'Single phase' }, { value: 'three', label: 'Three phase' }]}
        />
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field
              label={phase === 'three' ? 'Line volts' : 'Volts'}
              value={pVolts}
              onChangeText={setPVolts}
              keyboardType="decimal-pad"
              suffix="V"
            />
          </View>
          <View style={{ flex: 1 }}><Field label="Amps" value={pAmps} onChangeText={setPAmps} keyboardType="decimal-pad" suffix="A" /></View>
          <View style={{ flex: 1 }}><Field label="PF" value={pf} onChangeText={setPf} keyboardType="decimal-pad" /></View>
        </Rowed>
        {powerResult === null ? (
          <Banner tone="warn" title="Check the power factor" body="Between 0 and 1." />
        ) : (
          <ResultBlock
            label="Real power"
            value={powerResult ? formatValue(powerResult.kw) : '—'}
            unit="kW"
            detail={powerResult ? `${formatValue(powerResult.kva)} kVA apparent · ${formatValue(powerResult.watts)} W` : undefined}
          />
        )}

        <H2>Battery runtime</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Capacity" value={capAh} onChangeText={setCapAh} keyboardType="decimal-pad" suffix="Ah" /></View>
          <View style={{ flex: 1 }}><Field label="Load" value={loadA} onChangeText={setLoadA} keyboardType="decimal-pad" suffix="A" /></View>
        </Rowed>
        <ResultBlock
          label="Approximate runtime"
          value={runtime !== null ? runtime.toFixed(1) : '—'}
          unit="hours"
          detail="Capacity ÷ load, no de-rating. Rough guide only."
        />
        <Button title="FIP battery" variant="secondary" onPress={() => router.push('/tools/battery')} />
      </Screen>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Rowed style={{ justifyContent: 'space-between' }}>
      <Txt size="sm" tone="muted">{label}</Txt>
      <Txt size="sm" mono weight="700">{value}</Txt>
    </Rowed>
  );
}
