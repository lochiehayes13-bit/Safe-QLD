import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import {
  STANDARD_AREAS_MM2, minimumCableSize, voltageDrop, type Conductor,
} from '@/calc/electrical';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Cable volt drop.
 *
 * Answers the question that matters on a long sounder or loop run: will the
 * device at the far end still see enough voltage to operate in alarm.
 */
export default function VoltDropScreen() {
  const t = useTheme();
  const [volts, setVolts] = useState('24');
  const [amps, setAmps] = useState('0.5');
  const [length, setLength] = useState('100');
  const [area, setArea] = useState(1.5);
  const [minVolts, setMinVolts] = useState('18');
  const [conductor, setConductor] = useState<Conductor>('copper');
  const [circuit, setCircuit] = useState<'dc' | 'single-phase' | 'three-phase'>('dc');

  const result = useMemo(
    () =>
      voltageDrop({
        sourceVolts: parseFloat(volts) || 0,
        amps: parseFloat(amps) || 0,
        lengthM: parseFloat(length) || 0,
        areaMm2: area,
        conductor,
        circuit,
        minimumVolts: minVolts ? parseFloat(minVolts) : undefined,
      }),
    [volts, amps, length, area, conductor, circuit, minVolts],
  );

  const smallest = useMemo(
    () =>
      minVolts
        ? minimumCableSize({
            sourceVolts: parseFloat(volts) || 0,
            amps: parseFloat(amps) || 0,
            lengthM: parseFloat(length) || 0,
            conductor,
            circuit,
            minimumVolts: parseFloat(minVolts),
          })
        : null,
    [volts, amps, length, conductor, circuit, minVolts],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Cable volt drop' }} />
      <Screen>
        <ResultBlock
          label="Voltage at the device"
          value={result ? result.voltsAtLoad.toFixed(2) : '—'}
          unit="V"
          tone={result?.withinLimit === false ? 'fail' : 'accent'}
          detail={
            result
              ? `${result.dropVolts.toFixed(2)} V dropped over the run (${result.dropPercent.toFixed(1)}%), loop resistance ${result.resistanceOhms.toFixed(3)} Ω`
              : 'Enter the run details'
          }
        />

        {result?.withinLimit === false ? (
          <Banner
            tone="fail"
            title="Below the device minimum"
            body={`The device needs ${minVolts} V and would see ${result.voltsAtLoad.toFixed(2)} V. Shorten the run, increase the conductor size, or supply it locally.`}
          />
        ) : result?.withinLimit === true ? (
          <Banner
            tone="pass"
            title="Within limit"
            body={`Longest run at this size and load is about ${result.maxLengthM} m.`}
          />
        ) : null}

        {smallest !== null && smallest !== undefined && smallest !== area ? (
          <Banner
            tone="info"
            title={`${smallest} mm² is the smallest size that works`}
            body={smallest < area ? 'You could go smaller than currently selected.' : 'The selected size will not do it.'}
          />
        ) : null}

        <H2>The run</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Supply" value={volts} onChangeText={setVolts} keyboardType="decimal-pad" suffix="V" /></View>
          <View style={{ flex: 1 }}><Field label="Load" value={amps} onChangeText={setAmps} keyboardType="decimal-pad" suffix="A" /></View>
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Length (one way)" value={length} onChangeText={setLength} keyboardType="decimal-pad" suffix="m" /></View>
          <View style={{ flex: 1 }}><Field label="Device minimum" value={minVolts} onChangeText={setMinVolts} keyboardType="decimal-pad" suffix="V" /></View>
        </Rowed>

        <Label>Conductor size</Label>
        <Rowed gap={2} wrap>
          {STANDARD_AREAS_MM2.slice(0, 9).map((a) => (
            <Chip key={a} label={`${a}`} selected={area === a} onPress={() => setArea(a)} />
          ))}
        </Rowed>

        <Segmented
          value={conductor}
          onChange={setConductor}
          options={[{ value: 'copper', label: 'Copper' }, { value: 'aluminium', label: 'Aluminium' }]}
        />
        <Segmented
          value={circuit}
          onChange={setCircuit}
          options={[
            { value: 'dc', label: 'DC' },
            { value: 'single-phase', label: '1 phase' },
            { value: 'three-phase', label: '3 phase' },
          ]}
        />

        <Card>
          <Label>How this is worked out</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            Resistance is taken at 75 °C rather than the 20 °C bench figure, because a cable running warm has higher
            resistance and drops more volts — the cooler number would flatter the result.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            DC and single-phase runs count the length twice, because the current travels out and back. Forgetting that is
            what makes a long sounder circuit look fine on paper and fail on site.
          </Txt>
        </Card>
      </Screen>
    </>
  );
}
