import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import {
  CONDUITS,
  OUTLETS,
  REQUIREMENT_DISCLAIMER,
  REQUIREMENT_REFS,
  assessHydrant,
  conduitSpec,
  flowMeterToLpm,
  frictionLoss,
  headToKpa,
  isRefused,
  outletSpec,
  pitotFlow,
  projectAvailableFlow,
  projectResidualAtFlow,
  requiredBoostPressure,
  refToDuty,
  type ConduitId,
  type FlowUnit,
  type Issue,
  type OutletId,
  type RequirementRef,
} from '@/calc/hydrant';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Hydrant flow test.
 *
 * Laid out in the order the job actually happens: measure a flow, work out what
 * the supply will still give at the pressure the brigade needs, then check that
 * against the duty — and only then the losses that explain a marginal result.
 *
 * The measured flow carries forward between the tabs rather than being retyped,
 * because on site it is one number written once on the back of a glove and
 * transcribing it three times is where the digit gets dropped.
 *
 * Nothing on this screen picks a required duty by itself. The technician either
 * types the figures off the building's fire safety documents or chooses a
 * published reference, and whichever it is gets printed on the result.
 */

type Mode = 'flow' | 'supply' | 'duty' | 'losses';

/** The units a hydrant test rig is actually sold reading in. */
const METER_UNITS: { id: FlowUnit; label: string }[] = [
  { id: 'lps', label: 'L/s' },
  { id: 'lpm', label: 'L/min' },
  { id: 'm3h', label: 'm³/h' },
  { id: 'usgpm', label: 'US gpm' },
];

/**
 * A field's contents as a number, or NaN.
 *
 * parseFloat is not good enough here and the reason is worth stating: it reads
 * "1,200" as 1 and "65mm" as 65, so a thousands separator typed into a pressure
 * field silently becomes a pressure a thousand times too low, and every
 * calculation downstream answers confidently. Anything that is not entirely a
 * number is NaN, and every function in the calc module refuses a NaN.
 */
const num = (s: string): number => (/^-?\d*\.?\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

export default function HydrantScreen() {
  const [mode, setMode] = useState<Mode>('flow');

  // Flow measurement
  const [outlet, setOutlet] = useState<OutletId>('square-edged');
  const [diameter, setDiameter] = useState('65');
  const [pitot, setPitot] = useState('');
  const [metered, setMetered] = useState('');
  const [meterUnit, setMeterUnit] = useState<FlowUnit>('lps');

  // Supply curve
  const [staticKpa, setStaticKpa] = useState('');
  const [residualKpa, setResidualKpa] = useState('');
  const [targetKpa, setTargetKpa] = useState('350');

  // Duty
  const [refId, setRefId] = useState<string | null>(null);
  const [reqFlowLps, setReqFlowLps] = useState('10');
  const [reqPressure, setReqPressure] = useState('350');
  const [maxOutlet, setMaxOutlet] = useState('');
  const [maxStatic, setMaxStatic] = useState('');
  const [hydrantRef, setHydrantRef] = useState('');

  // Losses
  const [conduit, setConduit] = useState<ConduitId>('layflat-hose');
  const [runBore, setRunBore] = useState('65');
  const [runLength, setRunLength] = useState('30');
  const [riseM, setRiseM] = useState('');

  const pitotResult = useMemo(
    () =>
      pitot.trim() === ''
        ? null
        : pitotFlow({ pitotKpa: num(pitot), outletDiameterMm: num(diameter), outlet }),
    [pitot, diameter, outlet],
  );

  /**
   * The flow every later tab works from.
   *
   * A metered reading wins over a pitot calculation when both are present — a
   * meter is measured and a pitot flow is inferred, and preferring the inference
   * would throw away the better number.
   */
  const measuredFlowLpm = useMemo(() => {
    // flowMeterToLpm rather than a multiplication here: it is the function that
    // knows which units are held and returns nothing for one that is not, and a
    // rig bought from a US supplier reads gpm.
    const metric = metered.trim() === '' ? null : flowMeterToLpm(num(metered), meterUnit);
    if (metric !== null && metric > 0) return metric;
    if (pitotResult && !isRefused(pitotResult)) return pitotResult.flowLpm;
    return null;
  }, [metered, meterUnit, pitotResult]);

  const meteredLpm = metered.trim() === '' ? null : flowMeterToLpm(num(metered), meterUnit);
  const flowSource = meteredLpm !== null && meteredLpm > 0 ? 'flow meter' : 'pitot reading';

  return (
    <>
      <Stack.Screen options={{ title: 'Hydrant flow test' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'flow', label: 'Flow' },
            { value: 'supply', label: 'Supply' },
            { value: 'duty', label: 'Duty' },
            { value: 'losses', label: 'Losses' },
          ]}
        />

        {mode === 'flow' ? (
          <FlowView
            outlet={outlet}
            setOutlet={setOutlet}
            diameter={diameter}
            setDiameter={setDiameter}
            pitot={pitot}
            setPitot={setPitot}
            metered={metered}
            setMetered={setMetered}
            meterUnit={meterUnit}
            setMeterUnit={setMeterUnit}
            meteredLpm={meteredLpm}
            result={pitotResult}
          />
        ) : null}

        {mode === 'supply' ? (
          <SupplyView
            staticKpa={staticKpa}
            setStaticKpa={setStaticKpa}
            residualKpa={residualKpa}
            setResidualKpa={setResidualKpa}
            targetKpa={targetKpa}
            setTargetKpa={setTargetKpa}
            measuredFlowLpm={measuredFlowLpm}
            flowSource={flowSource}
          />
        ) : null}

        {mode === 'duty' ? (
          <DutyView
            refId={refId}
            setRefId={setRefId}
            reqFlowLps={reqFlowLps}
            setReqFlowLps={setReqFlowLps}
            reqPressure={reqPressure}
            setReqPressure={setReqPressure}
            maxOutlet={maxOutlet}
            setMaxOutlet={setMaxOutlet}
            maxStatic={maxStatic}
            setMaxStatic={setMaxStatic}
            hydrantRef={hydrantRef}
            setHydrantRef={setHydrantRef}
            staticKpa={staticKpa}
            residualKpa={residualKpa}
            measuredFlowLpm={measuredFlowLpm}
          />
        ) : null}

        {mode === 'losses' ? (
          <LossesView
            conduit={conduit}
            setConduit={setConduit}
            runBore={runBore}
            setRunBore={setRunBore}
            runLength={runLength}
            setRunLength={setRunLength}
            riseM={riseM}
            setRiseM={setRiseM}
            measuredFlowLpm={measuredFlowLpm}
            targetKpa={targetKpa}
          />
        ) : null}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function FlowView({
  outlet,
  setOutlet,
  diameter,
  setDiameter,
  pitot,
  setPitot,
  metered,
  setMetered,
  meterUnit,
  setMeterUnit,
  meteredLpm,
  result,
}: {
  outlet: OutletId;
  setOutlet: (v: OutletId) => void;
  diameter: string;
  setDiameter: (v: string) => void;
  pitot: string;
  setPitot: (v: string) => void;
  metered: string;
  setMetered: (v: string) => void;
  meterUnit: FlowUnit;
  setMeterUnit: (v: FlowUnit) => void;
  meteredLpm: number | null;
  result: ReturnType<typeof pitotFlow> | null;
}) {
  const t = useTheme();
  const spec = outletSpec(outlet);

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Q = 0.0666 × Cd × d² × √P, with d in mm and P in kPa. The coefficient depends on what the water leaves
        through, and it is the largest single error in a hydrant test — a bare outlet flowed as a nozzle reads 21% high.
      </Txt>

      {result === null ? (
        <ResultBlock label="Flow" value="—" unit="L/s" detail="Enter a pitot reading to calculate the flow." />
      ) : isRefused(result) ? (
        <Banner tone="warn" title="Cannot calculate this flow" body={result.reason} />
      ) : (
        <>
          <ResultBlock
            label="Flow at this outlet"
            value={result.flowLps.toFixed(2)}
            unit="L/s"
            detail={`${result.flowLpm.toFixed(0)} L/min  ·  ${result.velocityMs.toFixed(1)} m/s at the outlet  ·  Cd ${result.coefficient}`}
          />
          <Rowed gap={2}>
            <StatTile label="L/min" value={result.flowLpm.toFixed(0)} />
            <StatTile label="Cd" value={result.coefficient} />
            <StatTile label="Velocity" value={`${result.velocityMs.toFixed(1)} m/s`} />
          </Rowed>
        </>
      )}

      {result && !isRefused(result) ? result.issues.map((i, n) => <IssueBanner key={n} issue={i} />) : null}

      <H2>What the water leaves through</H2>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {OUTLETS.map((o) => (
          <Chip key={o.id} label={o.label} selected={outlet === o.id} onPress={() => setOutlet(o.id)} />
        ))}
      </ScrollView>

      {spec ? (
        <Card>
          <Label>Look for</Label>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 4 }}>{spec.geometry}</Txt>
          <Divider />
          <SourceLine
            value={spec.coefficient === null ? 'No coefficient' : `Cd ${spec.coefficient}`}
            source={spec.source}
            url={spec.url}
            confidence={spec.confidence}
          />
          {spec.note ? (
            <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>{spec.note}</Txt>
          ) : null}
        </Card>
      ) : null}

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field
            label="Outlet bore"
            value={diameter}
            onChangeText={setDiameter}
            keyboardType="decimal-pad"
            suffix="mm"
            hint="Nozzle tip, not the hose"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Pitot reading" value={pitot} onChangeText={setPitot} keyboardType="decimal-pad" suffix="kPa" />
        </View>
      </Rowed>

      <H2>Or a metered flow</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        A flow meter or a standpipe with a calibrated K-factor is the better measurement — nothing to judge by eye.
        A reading here overrides the pitot calculation everywhere else on this screen.
      </Txt>
      <Rowed gap={2}>
        {METER_UNITS.map((u) => (
          <Chip key={u.id} label={u.label} selected={meterUnit === u.id} onPress={() => setMeterUnit(u.id)} />
        ))}
      </Rowed>
      <Field
        label="Metered flow"
        value={metered}
        onChangeText={setMetered}
        keyboardType="decimal-pad"
        suffix={METER_UNITS.find((u) => u.id === meterUnit)?.label}
        hint="Set the unit the rig reads in — an imported rig reads US gallons a minute"
      />
      {metered.trim() !== '' && meteredLpm === null ? (
        <Banner
          tone="warn"
          title="That meter reading cannot be used"
          body="Enter it as a number, and check the unit above matches the face of the gauge. A gpm reading treated as L/min turns a comfortable pass into a fail nobody on site can explain."
        />
      ) : null}
      {meteredLpm !== null && meteredLpm > 0 ? (
        <Txt size="xs" tone="faint">
          {(meteredLpm / 60).toFixed(2)} L/s · {meteredLpm.toFixed(0)} L/min. This is what the other tabs will use.
        </Txt>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function SupplyView({
  staticKpa,
  setStaticKpa,
  residualKpa,
  setResidualKpa,
  targetKpa,
  setTargetKpa,
  measuredFlowLpm,
  flowSource,
}: {
  staticKpa: string;
  setStaticKpa: (v: string) => void;
  residualKpa: string;
  setResidualKpa: (v: string) => void;
  targetKpa: string;
  setTargetKpa: (v: string) => void;
  measuredFlowLpm: number | null;
  flowSource: string;
}) {
  const projection = useMemo(() => {
    if (measuredFlowLpm === null) return null;
    if (staticKpa.trim() === '' || residualKpa.trim() === '') return null;
    return projectAvailableFlow({
      staticKpa: num(staticKpa),
      residualKpa: num(residualKpa),
      measuredFlowLpm,
      targetResidualKpa: num(targetKpa),
    });
  }, [staticKpa, residualKpa, targetKpa, measuredFlowLpm]);

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Q at the target = Q measured × (Δ target ÷ Δ measured)^0.54. This is the question a hydrant test actually
        answers: how much water is still there once the pressure is pulled down to what the brigade needs.
      </Txt>

      {measuredFlowLpm === null ? (
        <Banner
          tone="info"
          title="No measured flow yet"
          body="Go back to the Flow tab and enter a pitot reading or a metered flow. The projection needs a flow and the pressure it was measured at."
        />
      ) : (
        <Txt size="xs" tone="faint">
          Using {(measuredFlowLpm / 60).toFixed(2)} L/s from the {flowSource}.
        </Txt>
      )}

      {projection === null ? (
        <ResultBlock label="Available flow" value="—" unit="L/s" detail="Enter the static and residual pressures." />
      ) : isRefused(projection) ? (
        <Banner tone="warn" title="Cannot project from this test" body={projection.reason} />
      ) : (
        <>
          <ResultBlock
            label={`Available at ${num(targetKpa).toFixed(0)} kPa`}
            value={projection.projectedFlowLps.toFixed(2)}
            unit="L/s"
            detail={`${projection.projectedFlowLpm.toFixed(0)} L/min  ·  drawdown ${projection.measuredDrawdownKpa.toFixed(0)} kPa (${(projection.drawdownFraction * 100).toFixed(0)}% of static)`}
          />
          <Rowed gap={2}>
            <StatTile label="Δ measured" value={`${projection.measuredDrawdownKpa.toFixed(0)} kPa`} />
            <StatTile label="Δ target" value={`${projection.targetDrawdownKpa.toFixed(0)} kPa`} />
            <StatTile
              label="Basis"
              value={projection.extrapolating ? 'Extrapolated' : 'Interpolated'}
              tone={projection.extrapolating ? 'warn' : 'pass'}
            />
          </Rowed>
          {projection.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
        </>
      )}

      <H2>The two readings</H2>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field
            label="Static"
            value={staticKpa}
            onChangeText={setStaticKpa}
            keyboardType="decimal-pad"
            suffix="kPa"
            hint="Nothing flowing"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Residual"
            value={residualKpa}
            onChangeText={setResidualKpa}
            keyboardType="decimal-pad"
            suffix="kPa"
            hint="Same gauge, flowing"
          />
        </View>
      </Rowed>
      <Field
        label="Target residual"
        value={targetKpa}
        onChangeText={setTargetKpa}
        keyboardType="decimal-pad"
        suffix="kPa"
        hint="The pressure the answer is wanted at"
      />

      <Card>
        <Label>Why the drawdown matters</Label>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 6 }}>
          The projection is a curve through two points. If the residual barely moved, those points sit on top of each
          other and the curve swings on a needle's width — at zero drawdown the answer is arithmetically infinite.
          Aim to pull the pressure down at least a quarter. Below 5% this screen will not answer at all.
        </Txt>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function DutyView({
  refId,
  setRefId,
  reqFlowLps,
  setReqFlowLps,
  reqPressure,
  setReqPressure,
  maxOutlet,
  setMaxOutlet,
  maxStatic,
  setMaxStatic,
  hydrantRef,
  setHydrantRef,
  staticKpa,
  residualKpa,
  measuredFlowLpm,
}: {
  refId: string | null;
  setRefId: (v: string | null) => void;
  reqFlowLps: string;
  setReqFlowLps: (v: string) => void;
  reqPressure: string;
  setReqPressure: (v: string) => void;
  maxOutlet: string;
  setMaxOutlet: (v: string) => void;
  maxStatic: string;
  setMaxStatic: (v: string) => void;
  hydrantRef: string;
  setHydrantRef: (v: string) => void;
  staticKpa: string;
  residualKpa: string;
  measuredFlowLpm: number | null;
}) {
  const t = useTheme();
  const minimums = REQUIREMENT_REFS.filter((r) => r.kind === 'minimum' && r.flowLps !== null);
  const maximums = REQUIREMENT_REFS.filter((r) => r.kind === 'maximum');
  const selected = refId ? REQUIREMENT_REFS.find((r) => r.id === refId) : undefined;

  /**
   * A reference is cited only while the fields still hold its own figures.
   *
   * Picking "10 L/s at 350 kPa" and then typing 5 into the flow field leaves a
   * result that reads "measured against the Queensland attack figure" and was
   * measured against something else. The reference is dropped the moment the
   * duty is edited away from it, and the screen says so rather than letting the
   * chip sit there looking authoritative.
   */
  const chosen =
    selected && selected.flowLps === num(reqFlowLps) && selected.pressureKpa === num(reqPressure)
      ? selected
      : undefined;
  const editedAway = selected !== undefined && chosen === undefined;

  const assessment = useMemo(() => {
    if (measuredFlowLpm === null || residualKpa.trim() === '') return null;
    const source = chosen
      ? (refToDuty(chosen)?.requirementSource ?? '')
      : 'Entered by the technician from the building’s fire safety documents';
    return assessHydrant({
      requiredFlowLpm: num(reqFlowLps) * 60,
      requiredResidualKpa: num(reqPressure),
      requirementSource: source,
      measuredFlowLpm,
      measuredResidualKpa: num(residualKpa),
      staticKpa: staticKpa.trim() === '' ? undefined : num(staticKpa),
      maxOutletKpa: maxOutlet.trim() === '' ? undefined : num(maxOutlet),
      maxStaticKpa: maxStatic.trim() === '' ? undefined : num(maxStatic),
      hydrantRef: hydrantRef.trim() === '' ? undefined : hydrantRef.trim(),
    });
  }, [measuredFlowLpm, residualKpa, staticKpa, reqFlowLps, reqPressure, maxOutlet, maxStatic, hydrantRef, chosen]);

  /**
   * What the gauge will read at the hydrant when the duty flow is actually being
   * drawn — the question the brigade asks, and the other way of reading the same
   * curve the projection above uses.
   */
  const atDutyFlow = useMemo(() => {
    if (measuredFlowLpm === null || staticKpa.trim() === '' || residualKpa.trim() === '') return null;
    return projectResidualAtFlow({
      staticKpa: num(staticKpa),
      residualKpa: num(residualKpa),
      measuredFlowLpm,
      targetFlowLpm: num(reqFlowLps) * 60,
    });
  }, [measuredFlowLpm, staticKpa, residualKpa, reqFlowLps]);

  /** Selecting a published reference fills the duty fields; it never assesses on its own. */
  const applyRef = (ref: RequirementRef) => {
    setRefId(ref.id === refId ? null : ref.id);
    if (ref.id === refId) return;
    if (ref.flowLps !== null) setReqFlowLps(String(ref.flowLps));
    setReqPressure(String(ref.pressureKpa));
  };

  /**
   * A published ceiling fills the field it belongs in, and only that one. Where
   * the source does not say which state of the system it was written for, it
   * fills neither — the technician reads the document and decides.
   */
  const applyCeiling = (ref: RequirementRef) => {
    if (ref.appliesAt === 'no-flow') setMaxStatic(String(ref.pressureKpa));
    if (ref.appliesAt === 'design-flow') setMaxOutlet(String(ref.pressureKpa));
  };

  return (
    <>
      {assessment === null ? (
        <Banner
          tone="info"
          title="Not enough entered to assess"
          body="A measured flow (Flow tab) and the residual pressure it was measured at (Supply tab) are the minimum. Add the static as well and a shortfall can be projected rather than guessed."
        />
      ) : isRefused(assessment) ? (
        <Banner tone="warn" title="Cannot assess this test" body={assessment.reason} />
      ) : (
        <>
          <ResultBlock
            label="Assessment"
            value={
              assessment.verdict === 'pass' ? 'PASS' : assessment.verdict === 'fail' ? 'FAIL' : 'INCONCLUSIVE'
            }
            tone={assessment.verdict === 'pass' ? 'pass' : assessment.verdict === 'fail' ? 'fail' : 'warn'}
            detail={assessment.summary}
          />
          <Rowed gap={2}>
            <StatTile
              label="At required kPa"
              value={
                assessment.availableAtRequiredKpa === null
                  ? '—'
                  : // On a demonstrated duty this is the flow that was actually run,
                    // which is a floor and not the most the supply would have given.
                    `${assessment.demonstrated ? '≥ ' : ''}${(assessment.availableAtRequiredKpa / 60).toFixed(2)} L/s`
              }
            />
            <StatTile
              label="Flow margin"
              value={assessment.flowMarginLpm === null ? '—' : `${(assessment.flowMarginLpm / 60).toFixed(2)} L/s`}
              tone={assessment.flowMarginLpm !== null && assessment.flowMarginLpm < 0 ? 'fail' : 'pass'}
            />
            <StatTile
              label="Pressure margin"
              value={`${assessment.pressureMarginKpa.toFixed(0)} kPa`}
              tone={assessment.pressureMarginKpa < 0 ? 'fail' : 'pass'}
            />
          </Rowed>
          {atDutyFlow && !isRefused(atDutyFlow) ? (
            <Rowed gap={2}>
              <StatTile
                label={`Residual at ${num(reqFlowLps).toFixed(1)} L/s`}
                value={`${atDutyFlow.residualKpa.toFixed(0)} kPa`}
                tone={atDutyFlow.residualKpa >= num(reqPressure) ? 'pass' : 'fail'}
              />
            </Rowed>
          ) : null}
          {assessment.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
          {atDutyFlow && !isRefused(atDutyFlow)
            ? atDutyFlow.issues
                .filter((i) => i.level === 'error')
                .map((i, n) => <IssueBanner key={`f${n}`} issue={i} />)
            : null}
        </>
      )}

      <H2>What is it being checked against?</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Type the figures off the building's fire safety documents. The references below are published regulator
        figures offered as a starting point — each says where it came from and where it applies.
      </Txt>

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Required flow" value={reqFlowLps} onChangeText={setReqFlowLps} keyboardType="decimal-pad" suffix="L/s" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="At residual" value={reqPressure} onChangeText={setReqPressure} keyboardType="decimal-pad" suffix="kPa" />
        </View>
      </Rowed>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field
            label="Maximum flowing"
            value={maxOutlet}
            onChangeText={setMaxOutlet}
            keyboardType="decimal-pad"
            suffix="kPa"
            hint="Ceiling at the outlet under flow"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Maximum static"
            value={maxStatic}
            onChangeText={setMaxStatic}
            keyboardType="decimal-pad"
            suffix="kPa"
            hint="Ceiling at no flow — a different figure"
          />
        </View>
      </Rowed>
      <Field label="Hydrant" value={hydrantRef} onChangeText={setHydrantRef} placeholder="HYD-14 level 8" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {minimums.map((r) => (
          <Chip key={r.id} label={r.label} selected={chosen?.id === r.id} onPress={() => applyRef(r)} />
        ))}
      </ScrollView>

      {editedAway ? (
        <Banner
          tone="info"
          title="The duty no longer matches the reference that was picked"
          body={`The figures have been edited away from "${selected!.label}", so the result is recorded as entered by the technician rather than measured against that document. Tap it again to go back to its numbers.`}
        />
      ) : null}

      <H2>Published ceilings</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Too much pressure is a defect in the other direction — nobody can hold the hose. These fill the field they were
        written for, and the two are not the same number.
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {maximums.map((r) => (
          <Chip
            key={r.id}
            label={`${r.label} · ${r.jurisdiction}`}
            tone={r.appliesAt === 'unstated' ? 'warn' : 'default'}
            onPress={() => applyCeiling(r)}
          />
        ))}
      </ScrollView>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        A ceiling marked in amber does not say in its own document whether it was written for the flowing or the
        no-flow reading, so tapping it fills nothing. Read the document and put the figure in the right field.
      </Txt>

      {chosen ? (
        <Card>
          <Label>{chosen.jurisdiction}</Label>
          <Txt size="sm" style={{ lineHeight: 19, marginTop: 4 }}>{chosen.scope}</Txt>
          {chosen.note ? <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>{chosen.note}</Txt> : null}
          <Divider />
          <SourceLine value={chosen.label} source={chosen.source} url={chosen.url} confidence={chosen.confidence} />
        </Card>
      ) : null}

      <Banner tone="warn" title="This checks against what it was told" body={REQUIREMENT_DISCLAIMER} />
    </>
  );
}

// ---------------------------------------------------------------------------

function LossesView({
  conduit,
  setConduit,
  runBore,
  setRunBore,
  runLength,
  setRunLength,
  riseM,
  setRiseM,
  measuredFlowLpm,
  targetKpa,
}: {
  conduit: ConduitId;
  setConduit: (v: ConduitId) => void;
  runBore: string;
  setRunBore: (v: string) => void;
  runLength: string;
  setRunLength: (v: string) => void;
  riseM: string;
  setRiseM: (v: string) => void;
  measuredFlowLpm: number | null;
  targetKpa: string;
}) {
  const t = useTheme();
  const spec = conduitSpec(conduit);

  const loss = useMemo(
    () =>
      measuredFlowLpm === null
        ? null
        : frictionLoss({
            flowLpm: measuredFlowLpm,
            internalDiameterMm: num(runBore),
            lengthM: num(runLength),
            conduit,
          }),
    [measuredFlowLpm, runBore, runLength, conduit],
  );

  const elevationKpa = riseM.trim() === '' ? null : headToKpa(num(riseM));

  const boost = useMemo(() => {
    if (riseM.trim() === '' || loss === null || isRefused(loss)) return null;
    return requiredBoostPressure({
      requiredResidualKpa: num(targetKpa),
      elevationRiseM: num(riseM),
      frictionLossKpa: loss.pressureLossKpa,
    });
  }, [loss, riseM, targetKpa]);

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Hazen-Williams, because it is what the hydraulic calculations behind the building's design used — a figure
        from here can be compared with them without a translation step. Elevation is at 9.80665 kPa per metre.
      </Txt>

      {measuredFlowLpm === null ? (
        <Banner tone="info" title="No flow entered" body="Friction loss depends on the flow. Enter one on the Flow tab." />
      ) : loss === null ? null : isRefused(loss) ? (
        <Banner tone="warn" title="Cannot estimate friction loss" body={loss.reason} />
      ) : (
        <>
          <ResultBlock
            label="Friction loss over the run"
            value={loss.pressureLossKpa.toFixed(0)}
            unit="kPa"
            detail={`${loss.lossKpaPerM.toFixed(2)} kPa/m  ·  ${loss.headLossM.toFixed(2)} m head  ·  ${loss.velocityMs.toFixed(1)} m/s  ·  C = ${loss.c}`}
          />
          {loss.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
        </>
      )}

      <H2>The run</H2>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {CONDUITS.map((c) => (
          <Chip key={c.id} label={c.label} selected={conduit === c.id} onPress={() => setConduit(c.id)} />
        ))}
      </ScrollView>

      {spec ? (
        <Card>
          <SourceLine
            value={spec.cLow === spec.cHigh ? `C = ${spec.cLow}` : `C = ${spec.cLow}–${spec.cHigh}, using ${spec.cLow}`}
            source={spec.source}
            url={spec.url}
            confidence={spec.confidence}
          />
          {spec.note ? <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>{spec.note}</Txt> : null}
          <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>
            The low end of the range is applied, because it gives the greater loss. Where the design nominates a C
            value, that one governs.
          </Txt>
        </Card>
      ) : null}

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Internal bore" value={runBore} onChangeText={setRunBore} keyboardType="decimal-pad" suffix="mm" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Length" value={runLength} onChangeText={setRunLength} keyboardType="decimal-pad" suffix="m" />
        </View>
      </Rowed>

      <H2>Elevation</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        A hydrant three storeys up is the binding case on most jobs, and the reason has nothing to do with the pump:
        ten metres of rise costs 98 kPa before a drop of water has moved.
      </Txt>
      <Field
        label="Hydrant above the source"
        value={riseM}
        onChangeText={setRiseM}
        keyboardType="decimal-pad"
        suffix="m"
        hint="Negative for a basement"
      />
      {elevationKpa !== null ? (
        <Rowed gap={2}>
          <StatTile label="Static lift" value={`${elevationKpa.toFixed(0)} kPa`} />
          <StatTile label="Head" value={`${num(riseM).toFixed(1)} m`} />
        </Rowed>
      ) : null}

      {boost && isRefused(boost) ? (
        // Shown rather than swallowed. The target residual lives on the Supply
        // tab, so the reason this cannot be worked out is usually on a screen
        // the technician is not looking at.
        <Banner tone="warn" title="Cannot work out what the booster needs" body={boost.reason} />
      ) : null}

      {boost && !isRefused(boost) ? (
        <>
          <H2>Pressure needed at the booster</H2>
          <ResultBlock
            label={`For ${num(targetKpa).toFixed(0)} kPa at this hydrant`}
            value={boost.requiredAtBoosterKpa.toFixed(0)}
            unit="kPa"
            detail={`${num(targetKpa).toFixed(0)} kPa residual + ${boost.elevationLossKpa.toFixed(0)} kPa lift + ${boost.frictionLossKpa.toFixed(0)} kPa friction`}
          />
          {boost.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Compare this with the boost pressure on the sign. The sign was calculated for the building as designed,
            and a later riser extension or a moved test point makes it wrong.
          </Txt>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/** A value with where it came from and how much to trust it, in one line. */
function SourceLine({
  value,
  source,
  url,
  confidence,
}: {
  value: string;
  source: string;
  url?: string;
  confidence: 'high' | 'medium' | 'low';
}) {
  const tone = confidence === 'high' ? 'pass' : confidence === 'medium' ? 'muted' : 'warn';
  return (
    <View style={{ gap: 5, marginTop: 6 }}>
      <Rowed gap={2} wrap>
        <Txt weight="700">{value}</Txt>
        <Chip label={`${confidence} confidence`} tone={tone} />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{source}</Txt>
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)} hitSlop={6}>
          <Txt size="xs" tone="accent" style={{ lineHeight: 17 }}>{url}</Txt>
        </Pressable>
      ) : null}
    </View>
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
