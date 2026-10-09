import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getForm72, listForm72, type StoredForm72 } from '@/db/form72Repo';
import { hasHydrantInputs, hydrantInputsFrom } from '@/domain/form72Link';
import { formatAuDate } from '@/export/sheets';
import { describeLoadFailure } from '@/domain/loadFailure';
import {
  CONDUITS,
  OUTLETS,
  REQUIREMENT_DISCLAIMER,
  REQUIREMENT_REFS,
  TYPED_DUTY_SOURCE,
  assessHydrant,
  conduitSpec,
  dutyOrigin,
  flowMeterToLpm,
  frictionLoss,
  headToKpa,
  isRefused,
  outletSpec,
  pitotFlow,
  projectAvailableFlow,
  projectResidualAtFlow,
  requiredBoostPressure,
  refOrigin,
  type ConduitId,
  type DutyOrigin,
  type FlowUnit,
  type Issue,
  type OutletId,
  type RequirementRef,
} from '@/calc/hydrant';
import { readNumber, toggleSign } from '@/calc/fieldNumber';
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
const num = (s: string): number => readNumber(s) ?? Number.NaN;

/** "a, b and c". */
const listed = (items: string[]): string =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '');

export default function HydrantScreen() {
  const { form72: form72Param } = useLocalSearchParams<{ form72?: string }>();
  const [mode, setMode] = useState<Mode>('flow');
  /** Which Form 72 the figures came from, and what each figure was read out of. */
  const [loadedFrom, setLoadedFrom] = useState<{ form: StoredForm72; sources: string[] } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [forms, setForms] = useState<StoredForm72[]>([]);
  const [formsFailed, setFormsFailed] = useState<string | null>(null);

  // Flow measurement
  const [outlet, setOutlet] = useState<OutletId>('square-edged');
  const [diameter, setDiameter] = useState('65');
  const [pitot, setPitot] = useState('');
  const [metered, setMetered] = useState('');
  const [meterUnit, setMeterUnit] = useState<FlowUnit>('lps');

  // Supply curve
  const [staticKpa, setStaticKpa] = useState('');
  const [residualKpa, setResidualKpa] = useState('');
  const [targetKpa, setTargetKpa] = useState('');

  // Duty
  const [refId, setRefId] = useState<string | null>(null);
  /** The duty a loaded Form 72 filled in, cited while the fields still hold it. */
  const [formDuty, setFormDuty] = useState<DutyOrigin | null>(null);
  const [reqFlowLps, setReqFlowLps] = useState('');
  const [reqPressure, setReqPressure] = useState('');
  const [maxOutlet, setMaxOutlet] = useState('');
  const [maxStatic, setMaxStatic] = useState('');
  const [hydrantRef, setHydrantRef] = useState('');

  // Losses
  const [conduit, setConduit] = useState<ConduitId>('layflat-hose');
  const [runBore, setRunBore] = useState('65');
  const [runLength, setRunLength] = useState('');
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

  /**
   * Fills the tabs from a finished Form 72.
   *
   * The form's own parts are read — static from Part D, the residual and
   * the flow it was read at from the first Part D row, the duty and the
   * rise from Part E — and every figure lands in the box it belongs in, so
   * the Supply and Duty tabs answer straight away. Nothing the form does
   * not hold is touched: a box already typed stays typed.
   */
  const applyForm = useCallback((form: StoredForm72) => {
    const inputs = hydrantInputsFrom(form);
    if (!hasHydrantInputs(inputs)) {
      setLoadedFrom({ form, sources: ['No static, residual, flow or duty on this form yet.'] });
      return;
    }
    if (inputs.staticKpa !== undefined) setStaticKpa(String(inputs.staticKpa));
    if (inputs.residualKpa !== undefined) setResidualKpa(String(inputs.residualKpa));
    if (inputs.flowLpm !== undefined) { setMetered(String(inputs.flowLpm)); setMeterUnit('lpm'); }
    if (inputs.requiredLps !== undefined) { setReqFlowLps(String(inputs.requiredLps)); setRefId(null); }
    if (inputs.requiredKpa !== undefined) {
      setReqPressure(String(inputs.requiredKpa));
      setTargetKpa((prev) => (prev.trim() ? prev : String(inputs.requiredKpa)));
    }
    setFormDuty(
      inputs.requiredLps !== undefined && inputs.requiredKpa !== undefined
        ? {
          label: 'Form 72 Part E',
          requirementSource: `Form 72 Part E, ${form.siteName}${form.testDate ? `, ${formatAuDate(form.testDate)}` : ''}`,
          flowLps: inputs.requiredLps,
          pressureKpa: inputs.requiredKpa,
        }
        : null,
    );
    if (inputs.riseM !== undefined) setRiseM(String(inputs.riseM));
    if (inputs.hydrantRef) setHydrantRef(inputs.hydrantRef);
    setLoadedFrom({ form, sources: inputs.sources });
    setMode(inputs.residualKpa !== undefined ? 'supply' : 'duty');
    setChoosing(false);
  }, []);

  // Opened from a Form 72's own screen: fill straight away. A form that is
  // gone is said, not silently skipped.
  useEffect(() => {
    if (!form72Param) return;
    let live = true;
    void (async () => {
      try {
        const form = await getForm72(form72Param);
        if (!live) return;
        if (form) applyForm(form);
        else setFormsFailed('That Form 72 is no longer on this phone.');
      } catch (e) {
        if (live) setFormsFailed(describeLoadFailure(e, 'the Form 72'));
      }
    })();
    return () => { live = false; };
  }, [form72Param, applyForm]);

  const openChooser = async () => {
    setChoosing(true);
    setFormsFailed(null);
    try {
      setForms((await listForm72()).slice(0, 12));
    } catch (e) {
      setForms([]);
      setFormsFailed(describeLoadFailure(e, 'the Form 72s on this phone'));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Hydrant flow test' }} />
      <Screen>
        {loadedFrom ? (
          <Banner
            tone="info"
            title={`From Form 72: ${loadedFrom.form.siteName}${loadedFrom.form.testDate ? `, ${formatAuDate(loadedFrom.form.testDate)}` : ''}`}
            body={loadedFrom.sources.join('\n')}
          />
        ) : null}
        {formsFailed ? <Banner tone="fail" title="Could not read the form" body={formsFailed} /> : null}

        {choosing ? (
          <Card>
            <Label>Which Form 72</Label>
            {forms.length === 0 && !formsFailed ? (
              <Txt size="sm" tone="muted" style={{ marginTop: 6 }}>No Form 72s on this phone yet.</Txt>
            ) : null}
            {forms.map((f) => (
              <Pressable key={f.id} onPress={() => applyForm(f)} style={{ paddingVertical: 10 }} accessibilityRole="button">
                <Txt weight="700">{f.siteName}{f.systemLabel ? ` · ${f.systemLabel}` : ''}</Txt>
                <Txt size="sm" tone="muted">
                  {f.testDate ? formatAuDate(f.testDate) : 'No test date'} · {f.status === 'issued' ? 'issued' : 'draft'}
                  {f.jobExternalId ? ` · job ${f.jobExternalId}` : ''}
                </Txt>
              </Pressable>
            ))}
            <Rowed gap={2} style={{ marginTop: 8 }}>
              <Chip label="Close" onPress={() => setChoosing(false)} />
            </Rowed>
          </Card>
        ) : (
          <Rowed gap={2} wrap>
            <Chip label={loadedFrom ? 'Load a different Form 72' : 'Load from a Form 72'} onPress={() => { void openChooser(); }} />
          </Rowed>
        )}

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
            formDuty={formDuty}
            targetKpa={targetKpa}
            setTargetKpa={setTargetKpa}
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
        Pick the outlet type. It sets the coefficient.
      </Txt>

      {result === null ? (
        <ResultBlock label="Flow" value="—" unit="L/s" detail="Enter a pitot reading." />
      ) : isRefused(result) ? (
        <Banner tone="warn" title="Can't calculate the flow" body={result.reason} />
      ) : (
        <>
          <ResultBlock
            label="Flow at this outlet"
            value={result.flowLps.toFixed(2)}
            unit="L/s"
            detail="Q = 0.0666 × Cd × d² × √P (mm, kPa)"
          />
          <Rowed gap={2}>
            <StatTile label="L/min" value={result.flowLpm.toFixed(0)} />
            <StatTile label="Cd" value={result.coefficient} />
            <StatTile label="Velocity" value={`${result.velocityMs.toFixed(1)} m/s`} />
          </Rowed>
        </>
      )}

      {result && !isRefused(result) ? result.issues.map((i, n) => <IssueBanner key={n} issue={i} />) : null}

      <H2>Outlet type</H2>
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
        A metered flow overrides the pitot figure.
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
        hint="Match the unit on the rig."
      />
      {metered.trim() !== '' && meteredLpm === null ? (
        <Banner
          tone="warn"
          title="Can't use that meter reading"
          body="Enter a number; check the unit matches the gauge."
        />
      ) : null}
      {meteredLpm !== null && meteredLpm > 0 ? (
        <Txt size="xs" tone="faint">
          {(meteredLpm / 60).toFixed(2)} L/s · {meteredLpm.toFixed(0)} L/min. Used on the other tabs.
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
  const missing = [
    staticKpa.trim() === '' ? 'static' : null,
    residualKpa.trim() === '' ? 'residual' : null,
    targetKpa.trim() === '' ? 'target residual' : null,
  ].filter((m): m is string => m !== null);

  const projection = useMemo(() => {
    if (measuredFlowLpm === null) return null;
    if (staticKpa.trim() === '' || residualKpa.trim() === '' || targetKpa.trim() === '') return null;
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
        Flow available at the target pressure.
      </Txt>

      {measuredFlowLpm === null ? (
        <Banner
          tone="info"
          title="No measured flow yet"
          body="Enter a pitot reading or metered flow on the Flow tab."
        />
      ) : (
        <Txt size="xs" tone="faint">
          Using {(measuredFlowLpm / 60).toFixed(2)} L/s from the {flowSource}.
        </Txt>
      )}

      {projection === null ? (
        <ResultBlock
          label="Available flow"
          value="—"
          unit="L/s"
          detail={missing.length ? `Enter the ${listed(missing)}.` : undefined}
        />
      ) : isRefused(projection) ? (
        <Banner tone="warn" title="Can't project from this test" body={projection.reason} />
      ) : (
        <>
          <ResultBlock
            label={`Available at ${num(targetKpa).toFixed(0)} kPa`}
            value={projection.projectedFlowLps.toFixed(2)}
            unit="L/s"
            detail={`${projection.projectedFlowLpm.toFixed(0)} L/min · drawdown ${(projection.drawdownFraction * 100).toFixed(0)}% of static · Q × (Δ target ÷ Δ test)^0.54`}
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

      <H2>Readings</H2>
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
        hint="Usually the duty residual"
      />

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Pull pressure down 25%+. Under 5% won’t calculate.
      </Txt>
    </>
  );
}

// ---------------------------------------------------------------------------

function DutyView({
  refId,
  setRefId,
  formDuty,
  targetKpa,
  setTargetKpa,
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
  formDuty: DutyOrigin | null;
  targetKpa: string;
  setTargetKpa: (v: string) => void;
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
  const selectedOrigin = selected ? refOrigin(selected) : null;
  const origin = dutyOrigin(num(reqFlowLps), num(reqPressure), [selectedOrigin, formDuty]);
  const chosen = selected && origin === selectedOrigin ? selected : undefined;
  const editedAway = selected !== undefined && chosen === undefined;
  const dutyEntered = reqFlowLps.trim() !== '' && reqPressure.trim() !== '';

  const assessment = useMemo(() => {
    if (measuredFlowLpm === null || residualKpa.trim() === '' || !dutyEntered) return null;
    const source = origin?.requirementSource ?? TYPED_DUTY_SOURCE;
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
  }, [measuredFlowLpm, residualKpa, staticKpa, reqFlowLps, reqPressure, maxOutlet, maxStatic, hydrantRef, origin, dutyEntered]);

  /**
   * What the gauge will read at the hydrant when the duty flow is actually being
   * drawn — the question the brigade asks, and the other way of reading the same
   * curve the projection above uses.
   */
  const atDutyFlow = useMemo(() => {
    if (measuredFlowLpm === null || staticKpa.trim() === '' || residualKpa.trim() === '' || !dutyEntered) return null;
    return projectResidualAtFlow({
      staticKpa: num(staticKpa),
      residualKpa: num(residualKpa),
      measuredFlowLpm,
      targetFlowLpm: num(reqFlowLps) * 60,
    });
  }, [measuredFlowLpm, staticKpa, residualKpa, reqFlowLps, dutyEntered]);

  /** Selecting a published reference fills the duty fields; it never assesses on its own. */
  const applyRef = (ref: RequirementRef) => {
    setRefId(ref.id === refId ? null : ref.id);
    if (ref.id === refId) {
      // Unpicked: its figures go with it, so they are not recorded as typed.
      // A duty loaded from a Form 72 comes back.
      setReqFlowLps(formDuty ? String(formDuty.flowLps) : '');
      setReqPressure(formDuty ? String(formDuty.pressureKpa) : '');
      return;
    }
    if (ref.flowLps !== null) setReqFlowLps(String(ref.flowLps));
    setReqPressure(String(ref.pressureKpa));
    if (targetKpa.trim() === '') setTargetKpa(String(ref.pressureKpa));
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
          title="Not enough to assess"
          body={dutyEntered ? 'Needs flow and residual. Add static to project.' : 'Enter the duty below.'}
        />
      ) : isRefused(assessment) ? (
        <Banner tone="warn" title="Can't assess this test" body={assessment.reason} />
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
          {/* Where the duty came from is shown under the duty fields. */}
          {assessment.issues
            .filter((i) => i.title !== REQUIREMENT_DISCLAIMER)
            .map((i, n) => <IssueBanner key={n} issue={i} />)}
          {atDutyFlow && !isRefused(atDutyFlow)
            ? atDutyFlow.issues
                .filter((i) => i.level === 'error')
                .map((i, n) => <IssueBanner key={`f${n}`} issue={i} />)
            : null}
        </>
      )}

      <H2>Duty</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        From the building’s fire safety documents, or pick one.
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
            hint="Ceiling at no flow"
          />
        </View>
      </Rowed>
      {dutyEntered ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          {origin ? `From: ${origin.label}` : 'Typed in'}
        </Txt>
      ) : null}
      <Field label="Hydrant" value={hydrantRef} onChangeText={setHydrantRef} placeholder="HYD-14 level 8" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}>
        {minimums.map((r) => (
          <Chip key={r.id} label={r.label} selected={chosen?.id === r.id} onPress={() => applyRef(r)} />
        ))}
      </ScrollView>

      {editedAway ? (
        <Banner
          tone="info"
          title="Duty edited from the reference"
          body={`Recorded as typed, not as "${selected!.label}". Tap it to restore.`}
        />
      ) : null}

      <H2>Published ceilings</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Tap a ceiling to fill its field.
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
        Amber: the document doesn’t say flowing or static. Enter it yourself.
      </Txt>

      {chosen ? (
        <Card>
          <Label>{chosen.jurisdiction}</Label>
          <Txt size="sm" style={{ lineHeight: 19, marginTop: 4 }}>{chosen.scope}</Txt>
          {chosen.note ? <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>{chosen.note}</Txt> : null}
          <Divider />
          <SourceLine value={chosen.label} source={chosen.source} url={chosen.url} />
        </Card>
      ) : null}

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{REQUIREMENT_DISCLAIMER}. Not a design check.</Txt>
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

  const runEntered = runBore.trim() !== '' && runLength.trim() !== '';
  const loss = useMemo(
    () =>
      measuredFlowLpm === null || !runEntered
        ? null
        : frictionLoss({
            flowLpm: measuredFlowLpm,
            internalDiameterMm: num(runBore),
            lengthM: num(runLength),
            conduit,
          }),
    [measuredFlowLpm, runBore, runLength, conduit, runEntered],
  );

  const elevationKpa = riseM.trim() === '' ? null : headToKpa(num(riseM));

  const boost = useMemo(() => {
    if (riseM.trim() === '' || targetKpa.trim() === '' || loss === null || isRefused(loss)) return null;
    return requiredBoostPressure({
      requiredResidualKpa: num(targetKpa),
      elevationRiseM: num(riseM),
      frictionLossKpa: loss.pressureLossKpa,
    });
  }, [loss, riseM, targetKpa]);

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Hazen-Williams friction; 9.81 kPa per metre rise.
      </Txt>

      {measuredFlowLpm === null ? (
        <Banner tone="info" title="No flow entered" body="Enter a flow on the Flow tab." />
      ) : loss === null ? (
        <ResultBlock label="Friction loss over the run" value="—" unit="kPa" detail="Enter the bore and length." />
      ) : isRefused(loss) ? (
        <Banner tone="warn" title="Can't estimate friction loss" body={loss.reason} />
      ) : (
        <>
          <ResultBlock
            label="Friction loss over the run"
            value={loss.pressureLossKpa.toFixed(0)}
            unit="kPa"
            detail={`${loss.lossKpaPerM.toFixed(2)} kPa/m · ${loss.headLossM.toFixed(2)} m head · ${loss.velocityMs.toFixed(1)} m/s · C = ${loss.c}`}
          />
          {loss.issues.map((i, n) => <IssueBanner key={n} issue={i} />)}
        </>
      )}

      <H2>Run</H2>
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
          />
          {spec.note ? <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>{spec.note}</Txt> : null}
          <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: 6 }}>
            Uses the low C (more loss). A C in the design governs.
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
        Every 10 m of rise costs 98 kPa.
      </Txt>
      {/* The iPhone's decimal keypad has no minus key, so a basement gets its sign from the ± chip. */}
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field
            label="Hydrant above the source"
            value={riseM}
            onChangeText={setRiseM}
            keyboardType="decimal-pad"
            suffix="m"
            hint="Tap ± for a basement"
          />
        </View>
        <View style={{ marginTop: 26 }}>
          <Chip label="±" selected={riseM.trim().startsWith('-')} onPress={() => setRiseM(toggleSign(riseM))} />
        </View>
      </Rowed>
      {elevationKpa !== null ? (
        <Rowed gap={2}>
          <StatTile label="Static lift" value={`${elevationKpa.toFixed(0)} kPa`} />
          <StatTile label="Head" value={`${num(riseM).toFixed(1)} m`} />
        </Rowed>
      ) : null}

      {riseM.trim() !== '' && targetKpa.trim() === '' && loss !== null && !isRefused(loss) ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Set a target residual on the Supply tab for the booster pressure.
        </Txt>
      ) : null}

      {boost && isRefused(boost) ? (
        // Shown rather than swallowed. The target residual lives on the Supply
        // tab, so the reason this cannot be worked out is usually on a screen
        // the technician is not looking at.
        <Banner tone="warn" title="Can't work out the booster pressure" body={boost.reason} />
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
            Compare with the booster sign.
          </Txt>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/** A value and where it came from. Tap the source to open it. */
function SourceLine({
  value,
  source,
  url,
}: {
  value: string;
  source: string;
  url?: string;
}) {
  return (
    <View style={{ gap: 5, marginTop: 6 }}>
      <Txt weight="700">{value}</Txt>
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)} hitSlop={6} accessibilityRole="link">
          <Txt size="xs" tone="accent" style={{ lineHeight: 17 }}>{source}</Txt>
        </Pressable>
      ) : (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{source}</Txt>
      )}
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
