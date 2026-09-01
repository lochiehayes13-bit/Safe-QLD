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
  frictionLoss,
  headToKpa,
  isRefused,
  outletSpec,
  pitotFlow,
  projectAvailableFlow,
  requiredBoostPressure,
  refToDuty,
  type ConduitId,
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

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : Number.NaN;
};

export default function HydrantScreen() {
  const [mode, setMode] = useState<Mode>('flow');

  // Flow measurement
  const [outlet, setOutlet] = useState<OutletId>('square-edged');
  const [diameter, setDiameter] = useState('65');
  const [pitot, setPitot] = useState('');
  const [meteredLps, setMeteredLps] = useState('');

  // Supply curve
  const [staticKpa, setStaticKpa] = useState('');
  const [residualKpa, setResidualKpa] = useState('');
  const [targetKpa, setTargetKpa] = useState('350');

  // Duty
  const [refId, setRefId] = useState<string | null>(null);
  const [reqFlowLps, setReqFlowLps] = useState('10');
  const [reqPressure, setReqPressure] = useState('350');
  const [maxOutlet, setMaxOutlet] = useState('');
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
    const metered = num(meteredLps);
    if (Number.isFinite(metered) && metered > 0) return metered * 60;
    if (pitotResult && !isRefused(pitotResult)) return pitotResult.flowLpm;
    return null;
  }, [meteredLps, pitotResult]);

  const flowSource = num(meteredLps) > 0 ? 'flow meter' : 'pitot reading';

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
            meteredLps={meteredLps}
            setMeteredLps={setMeteredLps}
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
  meteredLps,
  setMeteredLps,
  result,
}: {
  outlet: OutletId;
  setOutlet: (v: OutletId) => void;
  diameter: string;
  setDiameter: (v: string) => void;
  pitot: string;
  setPitot: (v: string) => void;
  meteredLps: string;
  setMeteredLps: (v: string) => void;
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
      <Field label="Metered flow" value={meteredLps} onChangeText={setMeteredLps} keyboardType="decimal-pad" suffix="L/s" />
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
  hydrantRef: string;
  setHydrantRef: (v: string) => void;
  staticKpa: string;
  residualKpa: string;
  measuredFlowLpm: number | null;
}) {
  const t = useTheme();
  const minimums = REQUIREMENT_REFS.filter((r) => r.kind === 'minimum' && r.flowLps !== null);
  const chosen = refId ? REQUIREMENT_REFS.find((r) => r.id === refId) : undefined;

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
      hydrantRef: hydrantRef.trim() === '' ? undefined : hydrantRef.trim(),
    });
  }, [measuredFlowLpm, residualKpa, staticKpa, reqFlowLps, reqPressure, maxOutlet, hydrantRef, chosen]);

  /** Selecting a published reference fills the duty fields; it never assesses on its own. */
  const applyRef = (ref: RequirementRef) => {
    setRefId(ref.id === refId ? null : ref.id);
    if (ref.id === refId) return;
    if (ref.flowLps !== null) setReqFlowLps(String(ref.flowLps));
    setReqPressure(String(ref.pressureKpa));
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
              value={assessment.availableAtRequiredKpa === null ? '—' : `${(assessment.availableAtRequiredKpa / 60).toFixed(2)} L/s`}
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
          {assessment.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
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
            label="Maximum outlet"
            value={maxOutlet}
            onChangeText={setMaxOutlet}
            keyboardType="decimal-pad"
            suffix="kPa"
            hint="Optional ceiling — too much is a defect too"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Hydrant" value={hydrantRef} onChangeText={setHydrantRef} placeholder="HYD-14 level 8" />
        </View>
      </Rowed>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {minimums.map((r) => (
          <Chip key={r.id} label={r.label} selected={refId === r.id} onPress={() => applyRef(r)} />
        ))}
      </ScrollView>

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
    if (elevationKpa === null || loss === null || isRefused(loss)) return null;
    return requiredBoostPressure({
      requiredResidualKpa: num(targetKpa),
      elevationRiseM: num(riseM),
      frictionLossKpa: loss.pressureLossKpa,
    });
  }, [elevationKpa, loss, riseM, targetKpa]);

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
