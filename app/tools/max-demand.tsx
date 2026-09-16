import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  PHASE_LABELS, assessDemand, rebalanceSuggestion,
  type DemandBasis, type DemandPhase, type DemandRow,
} from '@/calc/maxDemand';
import { PROTECTIVE_RATINGS_A, designCurrent } from '@/calc/cable';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock,
  Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Maximum demand.
 *
 * The figure that sizes the main, the main switch and the supply, and the one
 * most often arrived at by adding up every nameplate in the building and then
 * quietly halving it.
 *
 * The per-load allowances — how much of a range counts, what a lighting
 * circuit is assessed at, how socket outlets diversify — come from the
 * maximum demand table in the designer's own copy of the Wiring Rules, and
 * they are not in this app. Each row carries where its assessment came from,
 * so the working reads back.
 *
 * What this does is the arithmetic around them, and the arithmetic has one
 * failure that matters more than the rest: dividing a three-phase total by
 * three. A supply is sized on its worst phase, an installation with everything
 * on one of them has a maximum demand three times what the average suggests,
 * and the mistake runs in the direction that trips a main on the first hot
 * afternoon. So this counts per phase and says which one is heaviest — and
 * where moving one load would actually lower the answer, it says which load
 * and which phase.
 */
export default function MaxDemandScreen() {
  const t = useTheme();

  const [rows, setRows] = useState<DemandRow[]>([]);
  const [nextId, setNextId] = useState(1);

  const [label, setLabel] = useState('');
  const [connected, setConnected] = useState('');
  const [watts, setWatts] = useState('');
  const [volts, setVolts] = useState('230');
  const [basis, setBasis] = useState<DemandBasis>('fraction');
  const [value, setValue] = useState('1');
  const [phase, setPhase] = useState<DemandPhase>('a');
  const [source, setSource] = useState('');

  const connectedA = useMemo(() => {
    const w = parseFloat(watts);
    const v = parseFloat(volts);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(v) && v > 0) {
      return designCurrent(w, v, phase === 'all' ? 'three' : 'single') ?? 0;
    }
    return parseFloat(connected) || 0;
  }, [watts, volts, connected, phase]);

  const result = useMemo(() => assessDemand(rows), [rows]);
  const move = useMemo(() => rebalanceSuggestion(result), [result]);

  /** The smallest device that carries the demand, as a sanity check on the main. */
  const mainRating = useMemo(
    () => PROTECTIVE_RATINGS_A.find((r) => r >= result.maximumDemandA) ?? null,
    [result.maximumDemandA],
  );

  const add = () => {
    const v = parseFloat(value);
    if (!label.trim() || connectedA <= 0 || !Number.isFinite(v)) return;
    setRows([...rows, {
      id: String(nextId),
      label: label.trim(),
      connectedA,
      basis,
      value: v,
      phase,
      source: source.trim() || undefined,
    }]);
    setNextId(nextId + 1);
    setLabel('');
    setConnected('');
    setWatts('');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Maximum demand' }} />
      <Screen>
        <ResultBlock
          label="Maximum demand"
          value={rows.length ? result.maximumDemandA.toFixed(1) : '—'}
          unit="A"
          detail={
            rows.length
              ? `On ${PHASE_LABELS[result.worstPhase].toLowerCase()} · ${result.connectedA.toFixed(1)} A connected, so ${(result.diversity * 100).toFixed(0)}% diversity${mainRating ? ` · a ${mainRating} A main carries it` : ''}`
              : 'Add the load groups and their assessments'
          }
        />

        {rows.length ? (
          <Rowed gap={2}>
            {(['a', 'b', 'c'] as const).map((p) => (
              <View key={p} style={{ flex: 1 }}>
                <StatTile
                  label={`Phase ${p.toUpperCase()}`}
                  value={`${result.perPhaseA[p].toFixed(1)} A`}
                  tone={p === result.worstPhase && result.imbalancePercent > 0 ? 'warn' : 'default'}
                />
              </View>
            ))}
          </Rowed>
        ) : null}

        {result.warnings.length ? (
          <Banner tone="warn" title="Something could not be used" body={result.warnings.join(' ')} />
        ) : null}

        {move ? (
          <Banner
            tone="info"
            title={`Move ${move.row.label} to ${PHASE_LABELS[move.to].toLowerCase()}`}
            body={`That takes the maximum demand from ${result.maximumDemandA.toFixed(1)} A to ${move.newMaximumA.toFixed(1)} A. Twenty minutes with a screwdriver rather than a supply upgrade.`}
          />
        ) : rows.length && result.imbalancePercent > 20 ? (
          <Banner
            tone="warn"
            title={`${result.imbalancePercent.toFixed(0)}% out of balance`}
            body="Nothing single-phase on the heaviest phase would help by moving — the imbalance is in the loads themselves."
          />
        ) : null}

        <H2>Add a load group</H2>
        <Card>
          <Field label="What it is" value={label} onChangeText={setLabel} placeholder="Lighting, range, 10 A socket outlets" />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field label="Connected" value={connected} onChangeText={setConnected} keyboardType="decimal-pad" suffix="A" editable={!watts.trim()} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="or the load" value={watts} onChangeText={setWatts} keyboardType="decimal-pad" suffix="W" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="at" value={volts} onChangeText={setVolts} keyboardType="decimal-pad" suffix="V" />
            </View>
          </Rowed>
          {watts.trim() ? <Txt size="sm" tone="muted">{connectedA.toFixed(1)} A connected.</Txt> : null}

          <Label>How it is assessed</Label>
          <Segmented
            value={basis}
            onChange={(b) => { setBasis(b); setValue(b === 'fraction' ? '1' : ''); }}
            options={[
              { value: 'fraction', label: 'Some of it' },
              { value: 'fixed', label: 'A fixed figure' },
            ]}
          />
          <Field
            label={basis === 'fraction' ? 'How much counts' : 'Demand'}
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            suffix={basis === 'fraction' ? '' : 'A'}
            hint={basis === 'fraction' ? '0.5 for half of it, 1 for all of it' : 'The amps your table gives outright'}
          />

          <Label>Which phase</Label>
          <Rowed gap={2} wrap>
            {(['a', 'b', 'c', 'all'] as DemandPhase[]).map((p) => (
              <Chip key={p} label={PHASE_LABELS[p]} selected={phase === p} onPress={() => setPhase(p)} />
            ))}
          </Rowed>

          <Field
            label="Read from"
            value={source}
            onChangeText={setSource}
            placeholder="Our copy, the maximum demand table"
            hint="So the working reads back in six months"
          />

          <View style={{ height: t.space(3) }} />
          <Button title="Add it" disabled={!label.trim() || connectedA <= 0} onPress={add} />
        </Card>

        <H2>{rows.length ? `${rows.length} load group${rows.length === 1 ? '' : 's'}` : 'Nothing on the board yet'}</H2>
        {rows.length === 0 ? (
          <EmptyState
          icon="playlist-plus"
            title="Nothing added"
            body="Each row is a group of loads and the assessment applied to it. The assessments come from the maximum demand table in your own copy — this does the arithmetic around them, per phase."
          />
        ) : (
          result.rows.map((assessed) => (
            <Card key={assessed.row.id}>
              <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
                <Txt weight="700">{assessed.row.label}</Txt>
                <Txt size="lg" weight="700" tone={assessed.ignored ? 'fail' : 'accent'}>
                  {assessed.ignored ? '—' : `${assessed.demandA.toFixed(1)} A`}
                </Txt>
              </Rowed>
              <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
                {assessed.row.connectedA.toFixed(1)} A connected ·{' '}
                {assessed.row.basis === 'fraction'
                  ? `${(assessed.row.value * 100).toFixed(0)}% of it`
                  : 'assessed outright'}{' '}
                · {PHASE_LABELS[assessed.row.phase].toLowerCase()}
              </Txt>
              {assessed.ignored ? <Txt size="sm" tone="fail" style={{ marginTop: 2 }}>Not counted — {assessed.ignored}.</Txt> : null}
              {assessed.row.source ? <Txt size="sm" tone="faint" style={{ marginTop: 2 }}>{assessed.row.source}</Txt> : null}
              <View style={{ height: t.space(2) }} />
              <Chip label="Remove" onPress={() => setRows(rows.filter((r) => r.id !== assessed.row.id))} />
            </Card>
          ))
        )}

        <Card>
          <Label>What this does and does not decide</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            The per-load allowances are yours, from the maximum demand table in your own copy of the Wiring Rules. They
            are not in this app, for the same reason the capacity tables are not.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            A balanced three-phase load counts in full on each phase rather than a third on each, because that is the
            current the phase actually carries. And the total is the heaviest phase, never the average — the supply is
            sized on its worst phase, and averaging is the mistake that trips a main on the first hot afternoon.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Button title="Size the cable for it" variant="secondary" onPress={() => router.push('/tools/cable')} />
        </Card>
      </Screen>
    </>
  );
}
