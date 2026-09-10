import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { candidateRows, listCableTables, listDeratingEntries } from '@/db/cableRepo';
import type { CableTable, DeratingEntry } from '@/domain/cableTables';
import { INSULATION_PRESETS } from '@/domain/cableTables';
import {
  DEFAULT_DROP_LIMIT_PERCENT, DEFAULT_OVERLOAD_RATIO, PHASE_LABEL, designCurrent, sizeCable,
  type CandidateRow, type CircuitPhase, type DeratingFactor, type DeratingKind,
  type SizedCandidate, type SizingResult,
} from '@/calc/cable';
import { describeLoadFailure } from '@/domain/loadFailure';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock,
  Rowed, Screen, Segmented, StatusPill, Txt,
} from '@/components/ui';

/**
 * Cable sizing — the four checks, on the office's own figures.
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
 * **Every figure names its source.** The capacity numbers are the office's
 * own, loaded from their licensed copy or a manufacturer's catalogue; the app
 * carries none. So the answer prints where each one came from, and a phone
 * with no tables loaded says exactly that instead of producing a confident
 * size out of nothing.
 */
export default function CableSizingScreen() {
  const t = useTheme();

  const [tables, setTables] = useState<CableTable[]>([]);
  const [entries, setEntries] = useState<DeratingEntry[]>([]);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [tableId, setTableId] = useState<string>();
  const [failed, setFailed] = useState<string | null>(null);

  const [amps, setAmps] = useState('20');
  const [watts, setWatts] = useState('');
  const [length, setLength] = useState('30');
  const [volts, setVolts] = useState('230');
  const [phase, setPhase] = useState<CircuitPhase>('single');
  const [powerFactor, setPowerFactor] = useState('1');
  const [limit, setLimit] = useState(String(DEFAULT_DROP_LIMIT_PERCENT));
  const [overload, setOverload] = useState(String(DEFAULT_OVERLOAD_RATIO));
  const [chosenDerating, setChosenDerating] = useState<string[]>([]);

  const [faultOn, setFaultOn] = useState(false);
  const [faultA, setFaultA] = useState('6000');
  const [clearingTime, setClearingTime] = useState('0.1');
  const [startC, setStartC] = useState('70');
  const [finalC, setFinalC] = useState('160');

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [ts, ds] = await Promise.all([listCableTables(), listDeratingEntries()]);
      setTables(ts);
      setEntries(ds);
      setTableId((current) => (current && ts.some((x) => x.id === current) ? current : ts[0]?.id));
    } catch (e) {
      setTables([]);
      setEntries([]);
      setFailed(describeLoadFailure(e, 'the cable tables on this device'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** The chosen table's sizes, reloaded whenever the table changes. */
  const loadRows = useCallback(async () => {
    if (!tableId) {
      setRows([]);
      return;
    }
    try {
      setRows(await candidateRows(tableId));
    } catch (e) {
      setRows([]);
      setFailed(describeLoadFailure(e, 'the sizes in that table'));
    }
  }, [tableId]);

  useFocusEffect(useCallback(() => { void loadRows(); }, [loadRows]));

  const table = useMemo(() => tables.find((x) => x.id === tableId), [tables, tableId]);

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
    () => entries
      .filter((e) => chosenDerating.includes(e.id))
      .map((e) => ({ kind: e.kind as DeratingKind, condition: e.condition, factor: e.factor, source: e.source })),
    [entries, chosenDerating],
  );

  const result = useMemo<SizingResult | null>(() => {
    if (!table) return null;
    const pf = parseFloat(powerFactor);
    const ratio = parseFloat(overload);
    const start = parseFloat(startC);
    const final = parseFloat(finalC);
    return sizeCable({
      designCurrentA,
      lengthM: parseFloat(length) || 0,
      supplyVolts: parseFloat(volts) || 0,
      phase,
      material: table.material,
      operatingC: table.operatingC,
      powerFactor: Number.isFinite(pf) ? pf : 1,
      limitPercent: parseFloat(limit) || DEFAULT_DROP_LIMIT_PERCENT,
      overloadRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_OVERLOAD_RATIO,
      derating,
      rows,
      fault: faultOn && Number.isFinite(start) && Number.isFinite(final)
        ? { faultA: parseFloat(faultA) || 0, clearingTimeS: parseFloat(clearingTime) || 0, startC: start, finalC: final }
        : undefined,
    });
  }, [
    table, rows, designCurrentA, length, volts, phase, powerFactor, limit, overload,
    derating, faultOn, faultA, clearingTime, startC, finalC,
  ]);

  const chosen = result?.chosen;

  return (
    <>
      <Stack.Screen options={{ title: 'Cable sizing' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="Could not read the tables" body={failed} /> : null}

        {tables.length === 0 ? (
          <>
            <EmptyState
              title="No cable tables loaded here yet"
              body="This calculator runs off tables the office has loaded — a manufacturer's catalogue, or a newer edition than the one that ships. The standard's own tables are already on the phone and can be read straight from the book: open the wiring rules tables."
            />
            <Button title="Wiring rules tables" onPress={() => router.push('/tools/wiring')} />
            <Button title="Load your own table" variant="secondary" onPress={() => router.push('/tools/cable-tables')} />
          </>
        ) : (
          <>
            <ResultBlock
              label="Smallest size that passes every check"
              value={chosen ? `${chosen.row.areaMm2}` : '—'}
              unit={chosen ? 'mm²' : undefined}
              tone={chosen ? 'accent' : 'fail'}
              detail={
                chosen
                  ? `${chosen.protection.deviceRatingA} A device · carries ${chosen.capacityA} A here · ${chosen.drop?.dropPercent ?? '—'}% volt drop`
                  : result?.refusal ?? 'Pick a table and enter the run.'
              }
            />

            {chosen ? (
              <Banner
                tone="pass"
                title={`${chosen.row.areaMm2} mm² ${table?.insulation ?? ''} ${table?.material === 'aluminium' ? 'aluminium' : 'copper'}`}
                body={`Read from ${chosen.row.source}. Longest run at this size and load is about ${chosen.drop?.maxLengthM ?? '—'} m.`}
              />
            ) : result?.refusal ? (
              <Banner tone="fail" title="Nothing passed" body={result.refusal} />
            ) : null}

            {result?.derating.rejected.length ? (
              <Banner
                tone="warn"
                title="A derating factor was thrown out"
                body={result.derating.rejected.map((r) => `${r.factor.condition}: ${r.reason}`).join(' · ')}
              />
            ) : null}

            <H2>Which cable</H2>
            <Rowed gap={2} wrap>
              {tables.map((x) => (
                <Chip key={x.id} label={x.label} selected={tableId === x.id} onPress={() => setTableId(x.id)} />
              ))}
            </Rowed>
            {table ? (
              <Txt size="sm" tone="faint">
                {rows.length} size{rows.length === 1 ? '' : 's'} · {table.operatingC} °C conductor · {table.source}
              </Txt>
            ) : null}

            <H2>The load</H2>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label="Current" value={amps} onChangeText={setAmps} keyboardType="decimal-pad" suffix="A" editable={!watts.trim()} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="or the load" value={watts} onChangeText={setWatts} keyboardType="decimal-pad" suffix="W" hint="Fills the current in" />
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
              <Field label="Power factor" value={powerFactor} onChangeText={setPowerFactor} keyboardType="decimal-pad" hint="cos φ of the load. 1 for a heater, about 0.8 for a motor." />
            ) : null}
            {watts.trim() ? (
              <Txt size="sm" tone="muted">Drawing {designCurrentA.toFixed(1)} A at {PHASE_LABEL[phase].toLowerCase()}.</Txt>
            ) : null}

            <H2>Where it runs</H2>
            {entries.length === 0 ? (
              <Card>
                <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
                  No derating factors loaded, so this is being sized as though the cable were in free air at the
                  temperature its table assumes. Load the factors from your own copy and they are offered here.
                </Txt>
                <View style={{ height: t.space(3) }} />
                <Button title="Load derating factors" variant="secondary" compact onPress={() => router.push('/tools/cable-tables')} />
              </Card>
            ) : (
              <>
                <Rowed gap={2} wrap>
                  {entries.map((e) => (
                    <Chip
                      key={e.id}
                      label={`${e.condition} · ${e.factor}`}
                      selected={chosenDerating.includes(e.id)}
                      onPress={() => setChosenDerating(
                        chosenDerating.includes(e.id)
                          ? chosenDerating.filter((id) => id !== e.id)
                          : [...chosenDerating, e.id],
                      )}
                    />
                  ))}
                </Rowed>
                <Txt size="sm" tone="muted">
                  Combined factor {result ? result.derating.factor.toFixed(3) : '1.000'}
                  {result?.derating.applied.length ? ` — ${result.derating.applied.map((f) => f.condition).join(' × ')}` : ' — nothing derating it'}
                </Txt>
              </>
            )}

            <H2>The limits</H2>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label="Volt drop limit" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" suffix="%" hint="What this job is held to" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Device overload ratio" value={overload} onChangeText={setOverload} keyboardType="decimal-pad" hint="1.45 for a breaker; a fuse differs" />
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
                      selected={startC === String(p.operatingC - 5) || finalC === String(p.shortCircuitC)}
                      onPress={() => { setStartC(String(p.operatingC - 5)); setFinalC(String(p.shortCircuitC)); }}
                    />
                  ))}
                </Rowed>
                <Rowed gap={2} align="flex-start">
                  <View style={{ flex: 1 }}><Field label="At the start" value={startC} onChangeText={setStartC} keyboardType="decimal-pad" suffix="°C" /></View>
                  <View style={{ flex: 1 }}><Field label="Highest allowed" value={finalC} onChangeText={setFinalC} keyboardType="decimal-pad" suffix="°C" /></View>
                </Rowed>
                <Txt size="sm" tone="muted">
                  {result?.k
                    ? `k works out at ${result.k.toFixed(0)}, from the conductor's own resistivity and heat capacity — not looked up.`
                    : 'Enter two temperatures the conductor actually goes between.'}
                </Txt>
              </>
            ) : null}

            {result?.considered.length ? (
              <>
                <H2>Every size, and what stopped it</H2>
                {result.considered.map((c) => <SizeRow key={c.row.areaMm2} sized={c} />)}
              </>
            ) : null}

            <Card>
              <Label>What this carries and what it does not</Label>
              <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
                The capacity figures are yours, from the table named above. Everything worked from them is computed here:
                resistance at the conductor&rsquo;s operating temperature rather than at bench temperature, the reactive part of
                the volt drop wherever your table gives a reactance, and the short-circuit constant derived from the
                metal&rsquo;s own properties.
              </Txt>
              <Divider />
              <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
                Where your table gives a mV/A·m figure it is used instead of the computed one, because it accounts for
                stranding and lay-up that a nominal cross-section does not. The volt drop tool next door is for 24 V fire
                circuits and holds a flat 75 °C figure; the two differ by under 2 %, with that one on the conservative side.
              </Txt>
              <View style={{ height: t.space(3) }} />
              <Button title="Wiring rules tables" variant="secondary" onPress={() => router.push('/tools/wiring')} />
              <Button title="Cable tables" variant="ghost" onPress={() => router.push('/tools/cable-tables')} />
            </Card>
          </>
        )}
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
          Volt drop is resistance only — no reactance figure in your table for this size.
        </Txt>
      ) : null}
    </Card>
  );
}
