import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  PHASE_LABELS, assessDemand, checkDemandDraft, rebalanceSuggestion,
  type DemandBasis, type DemandPhase, type DemandRow,
} from '@/calc/maxDemand';
import { PROTECTIVE_RATINGS_A } from '@/calc/cable';
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

  const draft = useMemo(
    () => checkDemandDraft({
      label, connectedText: connected, wattsText: watts, voltsText: volts, basis, valueText: value, phase, source,
    }),
    [label, connected, watts, volts, basis, value, phase, source],
  );

  const result = useMemo(() => assessDemand(rows), [rows]);
  const move = useMemo(() => rebalanceSuggestion(result), [result]);

  /** The smallest device that carries the demand, as a sanity check on the main. */
  const mainRating = useMemo(
    () => PROTECTIVE_RATINGS_A.find((r) => r >= result.maximumDemandA) ?? null,
    [result.maximumDemandA],
  );

  const pickPhase = (p: DemandPhase) => {
    // A three-phase load's watts are worked at line volts.
    if (p === 'all' && volts.trim() === '230') setVolts('400');
    if (p !== 'all' && volts.trim() === '400') setVolts('230');
    setPhase(p);
  };

  const add = () => {
    if (!draft.row) return;
    setRows([...rows, { id: String(nextId), ...draft.row }]);
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
              ? `${PHASE_LABELS[result.worstPhase]} · ${result.connectedA.toFixed(1)} A connected · ${(result.diversity * 100).toFixed(0)}% diversity${mainRating ? ` · min. main ${mainRating} A` : ''}`
              : 'Add loads below.'
          }
        />

        {rows.length ? (
          <Rowed gap={2}>
            {(['a', 'b', 'c'] as const).map((p) => (
              <View key={p} style={{ flex: 1 }}>
                <StatTile
                  label={PHASE_LABELS[p]}
                  value={`${result.perPhaseA[p].toFixed(1)} A`}
                  tone={p === result.worstPhase && result.imbalancePercent > 0 ? 'warn' : 'default'}
                />
              </View>
            ))}
          </Rowed>
        ) : null}

        {result.warnings.length ? (
          <Banner
            tone="warn"
            title={result.warnings.length === 1 ? 'Row not counted' : 'Rows not counted'}
            body={result.warnings.join(' ')}
          />
        ) : null}

        {move ? (
          <Banner
            tone="info"
            title={`Move ${move.row.label} to ${PHASE_LABELS[move.to]}`}
            body={`Drops maximum demand from ${result.maximumDemandA.toFixed(1)} A to ${move.newMaximumA.toFixed(1)} A.`}
          />
        ) : rows.length && result.imbalancePercent > 20 ? (
          <Banner
            tone="warn"
            title={`${result.imbalancePercent.toFixed(0)}% out of balance`}
            body="No single move improves the balance."
          />
        ) : null}

        <H2>Add a load</H2>
        <Card style={{ gap: t.space(3) }}>
          <Field label="Load" value={label} onChangeText={setLabel} placeholder="e.g. Lighting, range, 10 A outlets" />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field label="Connected" value={connected} onChangeText={setConnected} keyboardType="decimal-pad" suffix="A" editable={!watts.trim()} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Or watts" value={watts} onChangeText={setWatts} keyboardType="decimal-pad" suffix="W" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={phase === 'all' ? 'Line volts' : 'Volts'} value={volts} onChangeText={setVolts} keyboardType="decimal-pad" suffix="V" />
            </View>
          </Rowed>
          {watts.trim() && draft.connectedA !== null ? (
            <Txt size="sm" tone="muted">{draft.connectedA.toFixed(1)} A connected.</Txt>
          ) : null}

          <Label>Allowance</Label>
          <Segmented
            value={basis}
            onChange={(b) => { setBasis(b); setValue(b === 'fraction' ? '1' : ''); }}
            options={[
              { value: 'fraction', label: 'Fraction' },
              { value: 'fixed', label: 'Fixed amps' },
            ]}
          />
          <Field
            label={basis === 'fraction' ? 'Fraction counted' : 'Demand'}
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            suffix={basis === 'fraction' ? '' : 'A'}
            hint={basis === 'fraction' ? '0.5 = half, 1 = all' : 'Amps from the table'}
          />
          {draft.valueProblem ? <Txt size="sm" tone="fail">{draft.valueProblem}</Txt> : null}

          <Label>Phase</Label>
          <Rowed gap={2} wrap>
            {(['a', 'b', 'c', 'all'] as DemandPhase[]).map((p) => (
              <Chip key={p} label={PHASE_LABELS[p]} selected={phase === p} onPress={() => pickPhase(p)} />
            ))}
          </Rowed>

          <Field
            label="Source"
            value={source}
            onChangeText={setSource}
            placeholder="e.g. AS/NZS 3000 Table C1"
          />

          <Button title="Add load" disabled={!draft.row} onPress={add} />
        </Card>

        <H2>Loads</H2>
        {rows.length === 0 ? (
          <EmptyState
            icon="playlist-plus"
            title="Nothing added"
            body="Add each load and its allowance."
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
                  ? `${(assessed.row.value * 100).toFixed(0)}% counted`
                  : 'fixed'}{' '}
                · {PHASE_LABELS[assessed.row.phase]}
              </Txt>
              {assessed.ignored ? <Txt size="sm" tone="fail" style={{ marginTop: 2 }}>Not counted: {assessed.ignored}.</Txt> : null}
              {assessed.row.source ? <Txt size="sm" tone="faint" style={{ marginTop: 2 }}>{assessed.row.source}</Txt> : null}
              <View style={{ height: t.space(2) }} />
              <Chip label="Remove" onPress={() => setRows(rows.filter((r) => r.id !== assessed.row.id))} />
            </Card>
          ))
        )}

        <Card>
          <Label>Allowances</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            AS/NZS 3000 Appendix C: Table C1 domestic, Table C2 non-domestic.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            Three-phase loads count in full on each phase. Maximum demand is the heaviest phase, not the average.
          </Txt>
          <View style={{ height: t.space(3) }} />
          <Rowed gap={2} wrap>
            <Button title="Wiring rules tables" variant="secondary" onPress={() => router.push('/tools/wiring')} />
            <Button title="Cable sizing" variant="secondary" onPress={() => router.push('/tools/cable')} />
          </Rowed>
        </Card>
      </Screen>
    </>
  );
}
