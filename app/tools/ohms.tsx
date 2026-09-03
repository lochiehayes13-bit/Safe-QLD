import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { autonomyHours, currentForLoad, power, solveOhms } from '@/calc/electrical';
import { useTheme } from '@/theme';
import { Banner, Card, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/** Ohm's law, power and battery runtime — the arithmetic that turns up daily. */
export default function OhmsScreen() {
  const t = useTheme();
  const [volts, setVolts] = useState('24');
  const [amps, setAmps] = useState('0.5');
  const [ohms, setOhms] = useState('');
  const [watts, setWatts] = useState('');

  const [pVolts, setPVolts] = useState('240');
  const [pAmps, setPAmps] = useState('10');
  const [pf, setPf] = useState('1');
  const [phase, setPhase] = useState<'single' | 'three'>('single');

  const [capAh, setCapAh] = useState('17');
  const [loadA, setLoadA] = useState('0.5');

  const num = (s: string): number | undefined => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : undefined;
  };

  const ohmsResult = useMemo(
    () => solveOhms({ volts: num(volts), amps: num(amps), ohms: num(ohms), watts: num(watts) }),
    [volts, amps, ohms, watts],
  );

  const powerResult = useMemo(
    () => power({ volts: num(pVolts) ?? 0, amps: num(pAmps) ?? 0, powerFactor: num(pf), phase }),
    [pVolts, pAmps, pf, phase],
  );

  const runtime = useMemo(() => autonomyHours(num(capAh) ?? 0, num(loadA) ?? 0), [capAh, loadA]);

  return (
    <>
      <Stack.Screen options={{ title: 'Electrical' }} />
      <Screen>
        <H2>Ohm's law</H2>
        <Txt size="sm" tone="muted">Fill any two. The rest follow.</Txt>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Volts" value={volts} onChangeText={setVolts} keyboardType="decimal-pad" suffix="V" /></View>
          <View style={{ flex: 1 }}><Field label="Amps" value={amps} onChangeText={setAmps} keyboardType="decimal-pad" suffix="A" /></View>
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Resistance" value={ohms} onChangeText={setOhms} keyboardType="decimal-pad" suffix="Ω" /></View>
          <View style={{ flex: 1 }}><Field label="Power" value={watts} onChangeText={setWatts} keyboardType="decimal-pad" suffix="W" /></View>
        </Rowed>

        {ohmsResult ? (
          <Card>
            <Label>From {ohmsResult.derivedFrom}</Label>
            <View style={{ marginTop: t.space(2), gap: t.space(1) }}>
              <Row label="Voltage" value={`${ohmsResult.volts.toFixed(3)} V`} />
              <Row label="Current" value={`${ohmsResult.amps.toFixed(4)} A`} />
              <Row label="Resistance" value={`${ohmsResult.ohms.toFixed(3)} Ω`} />
              <Row label="Power" value={`${ohmsResult.watts.toFixed(3)} W`} />
            </View>
          </Card>
        ) : (
          <Banner tone="info" title="Enter two values" body="Any two of volts, amps, resistance or power determine the other two." />
        )}

        <H2>Power</H2>
        <Segmented
          value={phase}
          onChange={setPhase}
          options={[{ value: 'single', label: 'Single phase' }, { value: 'three', label: 'Three phase' }]}
        />
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Volts" value={pVolts} onChangeText={setPVolts} keyboardType="decimal-pad" suffix="V" /></View>
          <View style={{ flex: 1 }}><Field label="Amps" value={pAmps} onChangeText={setPAmps} keyboardType="decimal-pad" suffix="A" /></View>
          <View style={{ flex: 1 }}><Field label="PF" value={pf} onChangeText={setPf} keyboardType="decimal-pad" /></View>
        </Rowed>
        {powerResult ? (
          <ResultBlock
            label="Real power"
            value={powerResult.kw.toFixed(3)}
            unit="kW"
            detail={`${powerResult.kva.toFixed(3)} kVA apparent · ${powerResult.watts.toFixed(0)} W`}
          />
        ) : (
          <Banner tone="warn" title="Check the inputs" body="Power factor has to be between 0 and 1." />
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
          detail="Plain capacity divided by load. This is a rough guide, not a design figure — sizing a standby battery needs the de-rating the battery calculator applies."
        />
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
