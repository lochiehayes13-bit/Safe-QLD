import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { INSULATION_PRESETS } from '@/domain/cableTables';
import {
  DEFAULT_DROP_LIMIT_PERCENT, DEFAULT_OVERLOAD_RATIO, DERATING_KINDS, DERATING_LABEL, PHASE_LABEL,
  designCurrent, sizeCable,
  type CircuitPhase, type DeratingFactor, type DeratingKind,
  type SizedCandidate, type SizingResult,
} from '@/calc/cable';
import {
  candidateRowsFor, capacityColumns, deratingFor, describeColumn,
  type CapacityColumn, type WiringDerating,
} from '@/domain/wiringCables';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Field, H2, Label, ResultBlock,
  Rowed, Screen, SearchBox, Segmented, StatusPill, Txt,
} from '@/components/ui';

/**
 * Cable sizing — the four checks, on the standard's own figures.
 *
 * A cable is decided by four things and skipping any one of them puts an
 * undersized one in a wall: what it carries where it is actually installed,
 * what the load at the far end still sees, whether the protective device sits
 * between the load and the cable, and whether the conductor survives a fault
 * for as long as the device takes to clear it.
 *
 * Two decisions shape this screen.
 *
 * **Every rejected size is shown, with the check that stopped it.** Being told
 * "16 mm²" and nothing else leaves a designer unable to tell whether 10 mm²
 * missed on volt drop by a hair or was never close, and that difference is
 * what decides between shortening the run and buying bigger cable.
 *
 * **Every figure names its source.** The capacity numbers come from the
 * AS/NZS 3008.1.1 tables the app carries, and the answer prints the table,
 * the column and the page it was read from, because "16 mm²" with nothing
 * behind it is not something a designer can defend.
 *
 * The cable is chosen by column rather than by table, because a table is not
 * one answer. Table 4 alone holds twenty-seven arrangements — spaced in air,
 * touching, in conduit in a wall, buried direct, wrapped in insulation — and
 * the widest and narrowest of them differ by more than a factor of two.
 *
 * Nothing is worked out until the load and the run length are the
 * technician's own: a size shown off made-up figures is a size somebody
 * copies down.
 */
export default function CableSizingScreen() {
  const t = useTheme();

  const [cores, setCores] = useState<string>('');
  const [insulation, setInsulation] = useState<string>('');
  const [columnId, setColumnId] = useState<string>('');
  const [arrangementQuery, setArrangementQuery] = useState('');

  // Derating from the standard: hundreds of conditions, so they are opened one
  // kind at a time and searched, rather than drawn as six hundred chips.
  const [openDerating, setOpenDerating] = useState<DeratingKind | null>(null);
  const [deratingQuery, setDeratingQuery] = useState('');
  const [chosenDerating, setChosenDerating] = useState<string[]>([]);

  const [amps, setAmps] = useState('');
  const [watts, setWatts] = useState('');
  const [length, setLength] = useState('');
  const [volts, setVolts] = useState('230');
  const [phase, setPhase] = useState<CircuitPhase>('single');
  const [powerFactor, setPowerFactor] = useState('1');
  const [limit, setLimit] = useState(String(DEFAULT_DROP_LIMIT_PERCENT));
  const [overload, setOverload] = useState(String(DEFAULT_OVERLOAD_RATIO));

  const [faultOn, setFaultOn] = useState(false);
  const [faultA, setFaultA] = useState('');
  const [clearingTime, setClearingTime] = useState('');
  const [startC, setStartC] = useState('');
  const [finalC, setFinalC] = useState('');

  // ---- The standard's own tables, narrowed the way a person narrows them ----

  const allColumns = useMemo(() => capacityColumns(), []);
  const coreOptions = useMemo(
    () => [...new Set(allColumns.map((c) => c.cores).filter(Boolean))],
    [allColumns],
  );
  const activeCores = cores || coreOptions[0] || '';
  const insulationOptions = useMemo(
    () => [...new Set(allColumns.filter((c) => c.cores === activeCores).map((c) => c.insulation).filter(Boolean))],
    [allColumns, activeCores],
  );
  const activeInsulation = insulation && insulationOptions.includes(insulation) ? insulation : (insulationOptions[0] ?? '');

  /** Every arrangement for the chosen cable, whatever the search box says. */
  const forCable = useMemo(
    () => allColumns.filter((c) => c.cores === activeCores && (!activeInsulation || c.insulation === activeInsulation)),
    [allColumns, activeCores, activeInsulation],
  );
  /**
   * The search narrows the list, never the choice. It used to narrow both, so
   * typing a word that matched nothing quietly swapped the cable being sized.
   */
  const arrangements = useMemo(() => {
    const q = arrangementQuery.trim().toLowerCase();
    return q ? forCable.filter((c) => describeColumn(c).toLowerCase().includes(q)) : forCable;
  }, [forCable, arrangementQuery]);
  const column: CapacityColumn | undefined = useMemo(
    () => forCable.find((c) => c.id === columnId) ?? forCable[0],
    [forCable, columnId],
  );
  const standard = useMemo(() => (column ? candidateRowsFor(column) : { rows: [], dropNote: '' }), [column]);
  const rows = standard.rows;

  /**
   * The design current.
   *
   * Typed straight in, or worked out from a load in watts — which is how it
   * arrives on a nameplate. The power factor goes into both: a 3 kW load at
   * 0.8 draws a quarter more current than the same load at unity, and it is
   * the current the cable feels.
   */
  const designCurrentA = useMemo(() => {
    const typed = parseFloat(amps);
    const w = parseFloat(watts);
    const v = parseFloat(volts);
    const pf = parseFloat(powerFactor);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(v) && v > 0) {
      return designCurrent(w, v, phase, Number.isFinite(pf) ? pf : 1) ?? 0;
    }
    return Number.isFinite(typed) ? typed : 0;
  }, [amps, watts, volts, phase, powerFactor]);

  const derating = useMemo<DeratingFactor[]>(
    () => DERATING_KINDS
      .flatMap((k) => deratingFor(k))
      .filter((f: WiringDerating) => chosenDerating.includes(f.id))
      .map((f) => ({ kind: f.kind, condition: f.condition, factor: f.factor, source: f.source })),
    [chosenDerating],
  );

  const lengthM = parseFloat(length);
  const supplyV = parseFloat(volts);
  const ready = Boolean(column) && rows.length > 0
    && designCurrentA > 0 && Number.isFinite(lengthM) && lengthM > 0 && Number.isFinite(supplyV) && supplyV > 0;

  const result = useMemo<SizingResult | null>(() => {
    if (!ready || !column) return null;
    const pf = parseFloat(powerFactor);
    const ratio = parseFloat(overload);
    const fault = {
      faultA: parseFloat(faultA),
      clearingTimeS: parseFloat(clearingTime),
      startC: parseFloat(startC),
      finalC: parseFloat(finalC),
    };
    const faultReady = faultOn && Object.values(fault).every(Number.isFinite) && fault.faultA > 0 && fault.clearingTimeS > 0;
    return sizeCable({
      designCurrentA,
      lengthM,
      supplyVolts: supplyV,
      phase,
      material: column.material,
      operatingC: column.operatingC,
      powerFactor: Number.isFinite(pf) ? pf : 1,
      limitPercent: parseFloat(limit) || DEFAULT_DROP_LIMIT_PERCENT,
      overloadRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_OVERLOAD_RATIO,
      derating,
      rows,
      fault: faultReady ? fault : undefined,
    });
  }, [
    ready, column, rows, designCurrentA, lengthM, supplyV, phase, powerFactor, limit, overload,
    derating, faultOn, faultA, clearingTime, startC, finalC,
  ]);

  const chosen = result?.chosen;
  const appliedFactor = derating.reduce((n, f) => n * f.factor, 1);

  return (
    <>
      <Stack.Screen options={{ title: 'Cable sizing' }} />
      <Screen>
        <ResultBlock
          label="Smallest size that passes"
          value={chosen ? `${chosen.row.areaMm2}` : '—'}
          unit={chosen ? 'mm²' : undefined}
          tone={chosen ? 'accent' : result ? 'fail' : 'muted'}
          detail={
            chosen
              ? `${chosen.protection.deviceRatingA} A device · carries ${chosen.capacityA} A here · ${chosen.drop?.dropPercent ?? '—'}% volt drop`
              : result?.refusal ?? 'Enter the load and run length.'
          }
        />

        {chosen && column ? (
          <Banner
            tone="pass"
            title={`${chosen.row.areaMm2} mm² ${column.insulation} ${column.material === 'aluminium' ? 'aluminium' : 'copper'}`}
            body={`${chosen.row.source}. Max run about ${chosen.drop?.maxLengthM ?? '—'} m at this load.`}
          />
        ) : result?.refusal ? (
          <Banner tone="fail" title="Nothing passed" body={result.refusal} />
        ) : null}

        {result?.derating.rejected.length ? (
          <Banner
            tone="warn"
            title="Derating factor ignored"
            body={result.derating.rejected.map((r) => `${r.factor.condition}: ${r.reason}`).join('\n')}
          />
        ) : null}

        <H2>Which cable</H2>
        <Label>Cable</Label>
        <Rowed gap={2} wrap>
          {coreOptions.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={activeCores === c}
              onPress={() => { setCores(c); setInsulation(''); setColumnId(''); }}
            />
          ))}
        </Rowed>

        {insulationOptions.length > 1 ? (
          <>
            <Label>Insulation</Label>
            <Rowed gap={2} wrap>
              {insulationOptions.map((i) => (
                <Chip
                  key={i}
                  label={shortInsulation(i)}
                  selected={activeInsulation === i}
                  onPress={() => { setInsulation(i); setColumnId(''); }}
                />
              ))}
            </Rowed>
          </>
        ) : null}

        <Label>Installed how</Label>
        {forCable.length > 6 ? (
          <SearchBox value={arrangementQuery} onChange={setArrangementQuery} placeholder="conduit, buried, touching, insulation" />
        ) : null}
        {arrangementQuery.trim() && !arrangements.length ? (
          <Txt size="sm" tone="muted">Nothing matches. Clear the search.</Txt>
        ) : null}
        {arrangements.slice(0, 24).map((c) => (
          <Card key={c.id} onPress={() => setColumnId(c.id)}>
            <Rowed align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt size="sm" weight={column?.id === c.id ? '700' : '400'}>
                  {c.installMethod}{c.conductorForm ? ` · ${c.conductorForm.toLowerCase()}` : ''}
                </Txt>
                <Txt size="xs" tone="faint">
                  {c.material === 'aluminium' ? 'Aluminium' : 'Copper'} · {c.sizes} sizes · {c.ref}
                </Txt>
              </View>
              {column?.id === c.id ? <StatusPill label="Using" tone="pass" /> : null}
            </Rowed>
          </Card>
        ))}
        {arrangements.length > 24 ? (
          <Txt size="xs" tone="faint">{arrangements.length - 24} more. Search to narrow.</Txt>
        ) : null}
        {column ? (
          <Txt size="sm" tone="faint" style={{ lineHeight: 18 }}>
            {rows.length} size{rows.length === 1 ? '' : 's'} · {column.operatingC} °C conductor
            {column.referenceAmbient ? ` · rated at ${column.referenceAmbient}` : ''}
            {'\n'}{column.source}
            {'\n'}{standard.dropNote}
          </Txt>
        ) : null}
        {column?.doubts.length ? (
          <Txt size="sm" tone="warn" style={{ lineHeight: 18 }}>Check the book: {column.doubts[0]}</Txt>
        ) : null}

        <H2>The load</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Current" value={amps} onChangeText={setAmps} keyboardType="decimal-pad" suffix="A" editable={!watts.trim()} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="or the load" value={watts} onChangeText={setWatts} keyboardType="decimal-pad" suffix="W" hint="Works out the current" />
          </View>
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}><Field label="Supply" value={volts} onChangeText={setVolts} keyboardType="decimal-pad" suffix="V" /></View>
          <View style={{ flex: 1 }}><Field label="Run, one way" value={length} onChangeText={setLength} keyboardType="decimal-pad" suffix="m" /></View>
        </Rowed>
        <Segmented
          value={phase}
          onChange={setPhase}
          options={(['dc', 'single', 'three'] as CircuitPhase[]).map((p) => ({ value: p, label: PHASE_LABEL[p] }))}
        />
        {phase !== 'dc' ? (
          <Field label="Power factor" value={powerFactor} onChangeText={setPowerFactor} keyboardType="decimal-pad" hint="1 for a heater, about 0.8 for a motor." />
        ) : null}
        {watts.trim() ? (
          <Txt size="sm" tone="muted">Drawing {designCurrentA.toFixed(1)} A at {PHASE_LABEL[phase].toLowerCase()}.</Txt>
        ) : null}

        <H2>Where it runs</H2>
        <Txt size="sm" tone="muted">Add derating for grouping, ambient or insulation.</Txt>

        {/*
          Six hundred conditions, opened one kind at a time. Drawn as chips
          they would be a wall nobody reads to the end of, and the
          condition a technician wants is found by typing the words on it —
          "6 circuits", "45", "buried" — rather than by scrolling.
        */}
        <Rowed gap={2} wrap>
          {DERATING_KINDS.filter((k) => deratingFor(k).length).map((k) => (
            <Chip
              key={k}
              label={DERATING_LABEL[k]}
              selected={openDerating === k}
              onPress={() => { setOpenDerating(openDerating === k ? null : k); setDeratingQuery(''); }}
            />
          ))}
        </Rowed>

        {openDerating ? (
          <Card>
            <Label>{DERATING_LABEL[openDerating]}</Label>
            <SearchBox value={deratingQuery} onChange={setDeratingQuery} placeholder="Search conditions" />
            {deratingFor(openDerating)
              .filter((f) => {
                const q = deratingQuery.trim().toLowerCase();
                return !q || f.condition.toLowerCase().includes(q);
              })
              .slice(0, 20)
              .map((f) => (
                <Card key={f.id} onPress={() => setChosenDerating(
                  chosenDerating.includes(f.id)
                    ? chosenDerating.filter((id) => id !== f.id)
                    : [...chosenDerating, f.id],
                )}
                >
                  <Rowed align="flex-start">
                    <View style={{ flex: 1 }}>
                      <Txt size="sm" weight={chosenDerating.includes(f.id) ? '700' : '400'} style={{ lineHeight: 18 }}>
                        {f.condition}
                      </Txt>
                      <Txt size="xs" tone="faint">{f.tableRef}</Txt>
                    </View>
                    <Txt size="lg" weight="700" tone={chosenDerating.includes(f.id) ? 'accent' : 'muted'}>
                      {f.factor}
                    </Txt>
                  </Rowed>
                </Card>
              ))}
          </Card>
        ) : null}

        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Combined factor {(result ? result.derating.factor : appliedFactor).toFixed(3)}
          {derating.length ? ` = ${derating.map((f) => `${f.factor}`).join(' × ')}` : ' (none)'}
        </Txt>
        {derating.length ? (
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            {derating.map((f) => f.condition).join('\n')}
          </Txt>
        ) : null}

        <H2>The limits</H2>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Volt drop limit" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" suffix="%" hint="For this job" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Overload ratio" value={overload} onChangeText={setOverload} keyboardType="decimal-pad" hint="1.45 for a breaker" />
          </View>
        </Rowed>

        <H2>Fault withstand</H2>
        <Segmented
          value={faultOn ? 'on' : 'off'}
          onChange={(v) => setFaultOn(v === 'on')}
          options={[{ value: 'off', label: 'Skip it' }, { value: 'on', label: 'Check it' }]}
        />
        {faultOn ? (
          <>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Fault current" value={faultA} onChangeText={setFaultA} keyboardType="decimal-pad" suffix="A" /></View>
              <View style={{ flex: 1 }}><Field label="Clearing time" value={clearingTime} onChangeText={setClearingTime} keyboardType="decimal-pad" suffix="s" /></View>
            </Rowed>
            <Label>Insulation temperatures</Label>
            <Rowed gap={2} wrap>
              {INSULATION_PRESETS.map((p) => (
                <Chip
                  key={p.id}
                  label={p.label}
                  selected={startC === String(p.operatingC - 5) && finalC === String(p.shortCircuitC)}
                  onPress={() => { setStartC(String(p.operatingC - 5)); setFinalC(String(p.shortCircuitC)); }}
                />
              ))}
            </Rowed>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}><Field label="Start" value={startC} onChangeText={setStartC} keyboardType="decimal-pad" suffix="°C" /></View>
              <View style={{ flex: 1 }}><Field label="Maximum" value={finalC} onChangeText={setFinalC} keyboardType="decimal-pad" suffix="°C" /></View>
            </Rowed>
            <Txt size="sm" tone="muted">
              {result?.k ? `k = ${result.k.toFixed(0)}` : 'Enter start and maximum temperatures.'}
            </Txt>
          </>
        ) : null}

        {result?.considered.length ? (
          <>
            <H2>Every size checked</H2>
            {result.considered.map((c) => <SizeRow key={c.row.areaMm2} sized={c} />)}
          </>
        ) : null}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>Figures: AS/NZS 3008.1.1:2009 incl. A1.</Txt>
        <Button title="Wiring rules tables" variant="ghost" onPress={() => router.push('/tools/wiring')} />
      </Screen>
    </>
  );
}

/** One size that was considered, and what happened to it. */
function SizeRow({ sized }: { sized: SizedCandidate }) {
  const t = useTheme();
  const failed = sized.failedOn;
  const why: Record<string, string> = {
    capacity: `only carries ${sized.capacityA} A here`,
    'volt drop': `${sized.drop?.dropPercent ?? '—'}% volt drop, over the limit`,
    protection: sized.protection.reason,
    fault: `below the ${sized.faultMinimumMm2} mm² the fault needs`,
  };

  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
        <Txt size="lg" weight="700">{sized.row.areaMm2} mm²</Txt>
        <StatusPill label={sized.passes ? 'Passes' : (failed ?? 'No')} tone={sized.passes ? 'pass' : 'fail'} />
      </Rowed>
      <Txt size="sm" tone={sized.passes ? 'muted' : 'fail'} style={{ marginTop: 2 }}>
        {sized.passes
          ? `${sized.capacityA} A here · ${sized.drop?.dropPercent ?? '—'}% drop · ${sized.protection.deviceRatingA} A device`
          : (failed ? why[failed] : 'no')}
      </Txt>
      {sized.drop?.resistanceOnly && !sized.drop.fromTable ? (
        <Txt size="sm" tone="faint" style={{ marginTop: t.space(1) }}>
          Volt drop excludes reactance at this size.
        </Txt>
      ) : null}
    </Card>
  );
}

/** A long insulation list cut at a whole name, so no type is shown half spelt. */
function shortInsulation(names: string): string {
  if (names.length <= 40) return names;
  const cut = names.lastIndexOf(',', 40);
  return cut > 0 ? `${names.slice(0, cut)}, …` : `${names.slice(0, 40)}…`;
}
