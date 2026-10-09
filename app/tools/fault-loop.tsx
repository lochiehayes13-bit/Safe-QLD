import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  CURVE_MULTIPLIER, PROTECTIVE_RATINGS_A, STANDARD_SIZES_MM2, adiabaticK, disconnects,
  faultLoop, maxLengthForDisconnection, minimumFaultSize, type ConductorMaterial,
} from '@/calc/cable';
import { readNumber } from '@/calc/fieldNumber';
import { INSULATION_PRESETS } from '@/domain/cableTables';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed,
  Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * Earth fault loop, disconnection, and the earth conductor.
 *
 * The check a long run fails silently. Everything else about the circuit is
 * right — the cable carries the load, the volt drop is inside the limit, the
 * breaker matches the cable — and an earth fault at the far end draws too
 * little current to move the magnetic element, so the device falls back to its
 * thermal curve and takes seconds instead of milliseconds. Nothing on site
 * looks wrong until somebody is holding the fault.
 *
 * None of this comes from a table. The maximum loop impedance figures people
 * look up are Uo ÷ (curve multiple × rating), which is computed here — so the
 * answer holds for whatever device, whatever supply voltage and whatever
 * conductor temperature are actually in front of you, rather than only for the
 * rows somebody tabulated. The earth conductor size is the adiabatic equation
 * with the constant derived from the metal's own properties.
 *
 * The number that matters when it fails is not "use a different breaker". It
 * is how much of this run can stay, so that is printed too.
 */
export default function FaultLoopScreen() {
  const t = useTheme();

  const [supplyOhms, setSupplyOhms] = useState('');
  const [length, setLength] = useState('');
  const [activeMm2, setActiveMm2] = useState(2.5);
  const [earthMm2, setEarthMm2] = useState(2.5);
  const [material, setMaterial] = useState<ConductorMaterial>('copper');
  const [operatingC, setOperatingC] = useState('75');
  const [phaseVolts, setPhaseVolts] = useState('230');

  const [deviceRatingA, setDeviceRatingA] = useState(20);
  const [curve, setCurve] = useState<'B' | 'C' | 'D'>('C');
  const [multiplier, setMultiplier] = useState(String(CURVE_MULTIPLIER.C));

  const [clearingTime, setClearingTime] = useState('0.4');
  const [insulation, setInsulation] = useState<string | null>('v75');
  const [startC, setStartC] = useState('70');
  const [finalC, setFinalC] = useState('160');

  /** Everything about the run except its length, or null until each figure is entered. */
  const base = useMemo(() => {
    const supply = readNumber(supplyOhms);
    const operating = readNumber(operatingC);
    const volts = readNumber(phaseVolts);
    if (supply === undefined || operating === undefined || volts === undefined) return null;
    return { supplyOhms: supply, activeMm2, earthMm2, material, operatingC: operating, phaseVolts: volts };
  }, [supplyOhms, operatingC, phaseVolts, activeMm2, earthMm2, material]);

  const lengthM = readNumber(length);
  const mult = readNumber(multiplier);

  const loop = useMemo(
    () => (base && lengthM !== undefined ? faultLoop({ ...base, lengthM }) : null),
    [base, lengthM],
  );

  const trip = useMemo(() => {
    if (!loop || !base || mult === undefined) return null;
    return disconnects({
      faultCurrentA: loop.faultCurrentA,
      deviceRatingA,
      multiplier: mult,
      phaseVolts: base.phaseVolts,
    });
  }, [loop, base, deviceRatingA, mult]);

  const maxLength = useMemo(() => {
    if (!base || mult === undefined) return null;
    return maxLengthForDisconnection({ ...base, deviceRatingA, multiplier: mult });
  }, [base, deviceRatingA, mult]);

  const k = useMemo(
    () => adiabaticK(material, readNumber(startC) ?? Number.NaN, readNumber(finalC) ?? Number.NaN),
    [material, startC, finalC],
  );

  const earthNeeded = useMemo(() => {
    const clearing = readNumber(clearingTime);
    if (!loop || k === null || clearing === undefined) return null;
    return minimumFaultSize({ faultA: loop.faultCurrentA, clearingTimeS: clearing, k });
  }, [loop, k, clearingTime]);

  const earthTooSmall = earthNeeded !== null && earthMm2 < earthNeeded.minimumAreaMm2;

  const maxRunLine =
    maxLength === null ? '' : maxLength > 0 ? ` Max run for this device: ${maxLength} m.` : ' Ze alone is over that.';

  return (
    <>
      <Stack.Screen options={{ title: 'Fault loop' }} />
      <Screen>
        <ResultBlock
          label="Earth fault loop impedance"
          value={loop ? loop.totalOhms.toFixed(3) : '—'}
          unit="Ω"
          tone={trip?.ok === false ? 'fail' : 'accent'}
          detail={
            loop && base
              ? `${Math.round(loop.faultCurrentA)} A fault · run ${loop.circuitOhms.toFixed(3)} Ω · supply ${base.supplyOhms.toFixed(3)} Ω`
              : 'Enter the supply and the run.'
          }
        />

        {trip && loop ? (
          <Banner
            tone={trip.ok ? 'pass' : 'fail'}
            title={trip.ok ? `Trips at once, ${trip.marginPercent.toFixed(0)}% margin` : "Won't trip at once"}
            body={`${Math.round(loop.faultCurrentA)} A fault, ${trip.tripCurrentA} A needed. Zs max ${trip.maxLoopOhms} Ω.${maxRunLine}`}
          />
        ) : null}

        <H2>Supply and run</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Supply impedance" value={supplyOhms} onChangeText={setSupplyOhms} keyboardType="decimal-pad" suffix="Ω" hint="Ze, from the network or measured at the origin" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Voltage to earth" value={phaseVolts} onChangeText={setPhaseVolts} keyboardType="decimal-pad" suffix="V" />
          </View>
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Run, one way" value={length} onChangeText={setLength} keyboardType="decimal-pad" suffix="m" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Conductor runs at" value={operatingC} onChangeText={setOperatingC} keyboardType="decimal-pad" suffix="°C" hint="Operating temperature, not 20 °C" />
          </View>
        </Rowed>

        <Label>Active (mm²)</Label>
        <Rowed gap={2} wrap>
          {STANDARD_SIZES_MM2.slice(0, 10).map((s) => (
            <Chip key={s} label={`${s}`} selected={activeMm2 === s} onPress={() => setActiveMm2(s)} />
          ))}
        </Rowed>
        <Label>Earth (mm²)</Label>
        <Rowed gap={2} wrap>
          {STANDARD_SIZES_MM2.slice(0, 10).map((s) => (
            <Chip key={s} label={`${s}`} selected={earthMm2 === s} onPress={() => setEarthMm2(s)} />
          ))}
        </Rowed>
        {earthMm2 < activeMm2 ? (
          <Txt size="sm" tone="muted">A reduced earth raises the loop impedance.</Txt>
        ) : null}

        <Segmented
          value={material}
          onChange={setMaterial}
          options={[{ value: 'copper', label: 'Copper' }, { value: 'aluminium', label: 'Aluminium' }]}
        />

        <H2>Protective device</H2>
        <Rowed gap={2} wrap>
          {PROTECTIVE_RATINGS_A.slice(0, 11).map((r) => (
            <Chip key={r} label={`${r} A`} selected={deviceRatingA === r} onPress={() => setDeviceRatingA(r)} />
          ))}
        </Rowed>
        <Label>Tripping curve</Label>
        <Rowed gap={2} wrap>
          {(['B', 'C', 'D'] as const).map((c) => (
            <Chip
              key={c}
              label={`Type ${c} · ${CURVE_MULTIPLIER[c]}×`}
              selected={curve === c}
              onPress={() => { setCurve(c); setMultiplier(String(CURVE_MULTIPLIER[c])); }}
            />
          ))}
        </Rowed>
        <Field
          label="Trips instantly at"
          value={multiplier}
          onChangeText={setMultiplier}
          keyboardType="decimal-pad"
          suffix="× rating"
          hint="From the breaker datasheet."
        />

        <H2>Earth conductor</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Clearing time" value={clearingTime} onChangeText={setClearingTime} keyboardType="decimal-pad" suffix="s" hint="From the device curve at this fault current" />
          </View>
        </Rowed>
        <Label>Insulation</Label>
        <Rowed gap={2} wrap>
          {INSULATION_PRESETS.map((p) => (
            <Chip
              key={p.id}
              label={p.label}
              selected={insulation === p.id}
              onPress={() => {
                setInsulation(p.id);
                setStartC(String(p.operatingC - 5));
                setFinalC(String(p.shortCircuitC));
              }}
            />
          ))}
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field
              label="Initial temp"
              value={startC}
              onChangeText={(v) => { setStartC(v); setInsulation(null); }}
              keyboardType="decimal-pad"
              suffix="°C"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Final temp"
              value={finalC}
              onChangeText={(v) => { setFinalC(v); setInsulation(null); }}
              keyboardType="decimal-pad"
              suffix="°C"
            />
          </View>
        </Rowed>

        {earthNeeded ? (
          <Banner
            tone={earthTooSmall ? 'fail' : 'pass'}
            title={
              earthTooSmall
                ? `Earth must be at least ${earthNeeded.standardAreaMm2 ?? earthNeeded.minimumAreaMm2} mm²`
                : `${earthMm2} mm² earth withstands the fault`
            }
            body={`S = I√t ÷ k = ${earthNeeded.minimumAreaMm2} mm² (k = ${k?.toFixed(0)}).`}
          />
        ) : null}

        <Card>
          <Label>Basis</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            Zs max = Uo ÷ (trip multiple × rating), worked at the operating temperature.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            B 5, C 10 and D 20 are the IEC 60898 upper limits. AS/NZS 3000 Table 8.1 uses 4, 7.5 and 12.5.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Button title="Cable sizing" variant="secondary" onPress={() => router.push('/tools/cable')} />
        </Card>
      </Screen>
    </>
  );
}
