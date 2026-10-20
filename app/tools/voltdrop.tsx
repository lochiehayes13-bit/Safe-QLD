import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { STANDARD_AREAS_MM2, type Conductor } from '@/calc/electrical';
import {
  BLANK_VOLT_DROP, anyTyped, readVoltDrop, type Circuit, type VoltDropFields,
} from '@/calc/voltdropEntry';
import { useTheme } from '@/theme';
import { Banner, Button, Chip, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, Txt } from '@/components/ui';

/**
 * Cable volt drop.
 *
 * Answers the question that matters on a long sounder or loop run: will the
 * device at the far end still see enough voltage to operate in alarm. Opens
 * blank, and gives no verdict until the technician's own figures are in.
 */
export default function VoltDropScreen() {
  const t = useTheme();
  const [fields, setFields] = useState<VoltDropFields>(BLANK_VOLT_DROP);
  const [area, setArea] = useState(1.5);
  const [conductor, setConductor] = useState<Conductor>('copper');
  const [circuit, setCircuit] = useState<Circuit>('dc');

  const set = (key: keyof VoltDropFields) => (text: string) => setFields((f) => ({ ...f, [key]: text }));

  const reading = useMemo(
    () => readVoltDrop(fields, { areaMm2: area, conductor, circuit }),
    [fields, area, conductor, circuit],
  );
  const result = reading.kind === 'result' ? reading.result : null;
  const minimum = reading.kind === 'result' ? reading.minimumVolts : undefined;
  const smallest = reading.kind === 'result' ? reading.smallestMm2 : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Volt drop' }} />
      <Screen>
        <ResultBlock
          label="Volts at the device"
          value={result ? result.voltsAtLoad.toFixed(2) : '—'}
          unit="V"
          tone={result?.withinLimit === false ? 'fail' : 'accent'}
          detail={
            result
              ? `${result.dropVolts.toFixed(2)} V drop (${result.dropPercent.toFixed(1)}%) · loop ${result.resistanceOhms.toFixed(3)} Ω`
              : 'Enter supply, load and length.'
          }
        />

        {reading.kind === 'check' ? (
          <Banner tone="warn" title="Check the figures" body={reading.problem} />
        ) : null}

        {result && minimum !== undefined ? (
          result.withinLimit === false ? (
            <Banner
              tone="fail"
              title="Below the device minimum"
              body={`Needs ${minimum} V, gets ${result.voltsAtLoad.toFixed(2)} V. Shorten the run, go up a size or supply it locally.`}
            />
          ) : (
            <Banner
              tone="pass"
              title="Within limit"
              body={`Longest run at this size and load: about ${result.maxLengthM} m.`}
            />
          )
        ) : null}

        {result && minimum !== undefined ? (
          smallest === null ? (
            <Banner tone="warn" title="No listed size works" body="Shorten the run or supply it locally." />
          ) : smallest !== undefined && smallest !== area ? (
            <Banner
              tone="info"
              title={`Smallest that works: ${smallest} mm²`}
              body={smallest < area ? 'Smaller than selected.' : 'Selected size is too small.'}
            />
          ) : null
        ) : null}

        <H2>The run</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Supply" value={fields.supply} onChangeText={set('supply')} keyboardType="decimal-pad" suffix="V" /></View>
          <View style={{ flex: 1 }}><Field label="Load" value={fields.load} onChangeText={set('load')} keyboardType="decimal-pad" suffix="A" /></View>
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Length (one way)" value={fields.length} onChangeText={set('length')} keyboardType="decimal-pad" suffix="m" /></View>
          <View style={{ flex: 1 }}><Field label="Device minimum" value={fields.minimum} onChangeText={set('minimum')} keyboardType="decimal-pad" suffix="V" /></View>
        </Rowed>
        {anyTyped(fields) ? (
          <Button title="Clear" variant="ghost" compact onPress={() => setFields(BLANK_VOLT_DROP)} />
        ) : null}

        <Label>Conductor size (mm²)</Label>
        <Rowed gap={2} wrap>
          {STANDARD_AREAS_MM2.map((a) => (
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

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 17 }}>
          Resistance at 75 °C. DC and 1 phase count the run out and back.
        </Txt>
      </Screen>
    </>
  );
}
