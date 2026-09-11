import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  CURVE_MULTIPLIER, PROTECTIVE_RATINGS_A, STANDARD_SIZES_MM2, adiabaticK, disconnects,
  faultLoop, maxLengthForDisconnection, minimumFaultSize, type ConductorMaterial,
} from '@/calc/cable';
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

  const [supplyOhms, setSupplyOhms] = useState('0.35');
  const [length, setLength] = useState('40');
  const [activeMm2, setActiveMm2] = useState(2.5);
  const [earthMm2, setEarthMm2] = useState(2.5);
  const [material, setMaterial] = useState<ConductorMaterial>('copper');
  const [operatingC, setOperatingC] = useState('75');
  const [phaseVolts, setPhaseVolts] = useState('230');

  const [deviceRatingA, setDeviceRatingA] = useState(20);
  const [curve, setCurve] = useState<'B' | 'C' | 'D'>('C');
  const [multiplier, setMultiplier] = useState(String(CURVE_MULTIPLIER.C));

  const [clearingTime, setClearingTime] = useState('0.4');
  const [startC, setStartC] = useState('70');
  const [finalC, setFinalC] = useState('160');

  const run = useMemo(() => ({
    supplyOhms: parseFloat(supplyOhms) || 0,
    lengthM: parseFloat(length) || 0,
    activeMm2,
    earthMm2,
    material,
    operatingC: parseFloat(operatingC) || 75,
    phaseVolts: parseFloat(phaseVolts) || 0,
  }), [supplyOhms, length, activeMm2, earthMm2, material, operatingC, phaseVolts]);

  const loop = useMemo(() => faultLoop(run), [run]);

  const trip = useMemo(() => {
    const m = parseFloat(multiplier);
    if (!loop || !Number.isFinite(m)) return null;
    return disconnects({
      faultCurrentA: loop.faultCurrentA,
      deviceRatingA,
      multiplier: m,
      phaseVolts: run.phaseVolts,
    });
  }, [loop, deviceRatingA, multiplier, run.phaseVolts]);

  const maxLength = useMemo(() => {
    const m = parseFloat(multiplier);
    if (!Number.isFinite(m)) return null;
    return maxLengthForDisconnection({ ...run, deviceRatingA, multiplier: m });
  }, [run, deviceRatingA, multiplier]);

  const k = useMemo(() => adiabaticK(material, parseFloat(startC), parseFloat(finalC)), [material, startC, finalC]);

  const earthNeeded = useMemo(() => {
    if (!loop || k === null) return null;
    return minimumFaultSize({
      faultA: loop.faultCurrentA,
      clearingTimeS: parseFloat(clearingTime) || 0,
      k,
    });
  }, [loop, k, clearingTime]);

  const earthTooSmall = earthNeeded !== null && earthMm2 < earthNeeded.minimumAreaMm2;

  return (
    <>
      <Stack.Screen options={{ title: 'Fault loop and earthing' }} />
      <Screen>
        <ResultBlock
          label="Earth fault loop impedance"
          value={loop ? loop.totalOhms.toFixed(3) : '—'}
          unit="Ω"
          tone={trip?.ok === false ? 'fail' : 'accent'}
          detail={
            loop
              ? `${loop.faultCurrentA} A of fault current · ${loop.circuitOhms.toFixed(3)} Ω of it is the run, ${run.supplyOhms.toFixed(3)} Ω the supply`
              : 'Enter the supply impedance and the run'
          }
        />

        {trip ? (
          <Banner
            tone={trip.ok ? 'pass' : 'fail'}
            title={trip.ok ? `Disconnects, with ${trip.marginPercent.toFixed(0)}% to spare` : 'Will not disconnect at once'}
            body={
              trip.ok
                ? `${trip.reason} The loop could be as high as ${trip.maxLoopOhms} Ω and still clear.`
                : `${trip.reason} The loop has to be under ${trip.maxLoopOhms} Ω${maxLength !== null ? `, which is ${maxLength} m of this cable` : ''}.`
            }
          />
        ) : null}

        {trip?.ok && maxLength !== null ? (
          <Txt size="sm" tone="muted">
            The run could be {maxLength} m before this device stops seeing enough fault current.
          </Txt>
        ) : null}

        <H2>The supply and the run</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Supply impedance" value={supplyOhms} onChangeText={setSupplyOhms} keyboardType="decimal-pad" suffix="Ω" hint="Ze, from the authority or measured at the origin" />
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
            <Field label="Conductor runs at" value={operatingC} onChangeText={setOperatingC} keyboardType="decimal-pad" suffix="°C" hint="Not 20 — a warm conductor passes less fault current" />
          </View>
        </Rowed>

        <Label>Active</Label>
        <Rowed gap={2} wrap>
          {STANDARD_SIZES_MM2.slice(0, 10).map((s) => (
            <Chip key={s} label={`${s}`} selected={activeMm2 === s} onPress={() => setActiveMm2(s)} />
          ))}
        </Rowed>
        <Label>Earth</Label>
        <Rowed gap={2} wrap>
          {STANDARD_SIZES_MM2.slice(0, 10).map((s) => (
            <Chip key={s} label={`${s}`} selected={earthMm2 === s} onPress={() => setEarthMm2(s)} />
          ))}
        </Rowed>
        {earthMm2 < activeMm2 ? (
          <Txt size="sm" tone="muted">
            A reduced earth is the larger half of the loop, and assuming it matched the active is how this check gets
            passed when it should not be.
          </Txt>
        ) : null}

        <Segmented
          value={material}
          onChange={setMaterial}
          options={[{ value: 'copper', label: 'Copper' }, { value: 'aluminium', label: 'Aluminium' }]}
        />

        <H2>The protective device</H2>
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
          hint={`Type ${curve} off the breaker's own datasheet. A fuse or a motor-rated device is neither.`}
        />

        <H2>The earth conductor</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Clearing time" value={clearingTime} onChangeText={setClearingTime} keyboardType="decimal-pad" suffix="s" hint="What the device's curve gives at this fault current" />
          </View>
        </Rowed>
        <Label>Insulation</Label>
        <Rowed gap={2} wrap>
          {INSULATION_PRESETS.map((p) => (
            <Chip
              key={p.id}
              label={p.label}
              selected={finalC === String(p.shortCircuitC)}
              onPress={() => { setStartC(String(p.operatingC - 5)); setFinalC(String(p.shortCircuitC)); }}
            />
          ))}
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="At the start" value={startC} onChangeText={setStartC} keyboardType="decimal-pad" suffix="°C" /></View>
          <View style={{ flex: 1 }}><Field label="Highest allowed" value={finalC} onChangeText={setFinalC} keyboardType="decimal-pad" suffix="°C" /></View>
        </Rowed>

        {earthNeeded ? (
          <Banner
            tone={earthTooSmall ? 'fail' : 'pass'}
            title={
              earthTooSmall
                ? `The earth has to be at least ${earthNeeded.standardAreaMm2 ?? earthNeeded.minimumAreaMm2} mm²`
                : `${earthMm2} mm² earth survives the fault`
            }
            body={`S = I√t ÷ k works out at ${earthNeeded.minimumAreaMm2} mm², with k of ${k?.toFixed(0)} derived from the conductor's own resistivity and heat capacity.`}
          />
        ) : null}

        <Card>
          <Label>Where these numbers come from</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            Nothing here is looked up. A maximum loop impedance is the supply voltage divided by the current the device
            needs to trip at once — which is exactly how the printed figures are worked out — so this answer holds for
            whatever device and whatever supply are in front of you rather than only for the rows somebody tabulated.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            The loop is worked at the conductor&rsquo;s operating temperature, not at 20 °C. A warm conductor has more
            resistance and passes less fault current, so working it cold produces a circuit that disconnects on paper.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Button title="Cable sizing" variant="secondary" onPress={() => router.push('/tools/cable')} />
        </Card>
      </Screen>
    </>
  );
}
