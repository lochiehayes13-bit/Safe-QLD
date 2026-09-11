import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  BARRIERS,
  CALCULATION_BASIS,
  INTELLIGIBILITY_CLAUSE,
  INTELLIGIBILITY_NOTE,
  NOT_AN_ACOUSTIC_ASSESSMENT,
  OCCUPANCY_LABEL,
  QFES_CONCESSION_POSITION,
  REVERBERANT_LIMIT,
  SOU_DOOR_CONCESSIONS,
  SPACE_LABEL,
  SPL_REQUIREMENTS,
  addLevels,
  coverageVerdict,
  maxDistanceForLevel,
  removeAmbient,
  requiredRatedDb,
  sourceList,
  type Confidence,
  type OccupancyKind,
  type SpaceKind,
} from '@/calc/spl';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Sound pressure level for occupant warning.
 *
 * The EWIS annual routine asks for a sound pressure level and gives a
 * technician nothing to check the reading against. This screen is that check,
 * and it is built to be honest about being an estimate: the assumption it runs
 * on is printed above the answer rather than buried at the bottom, the
 * threshold it judges against carries its own confidence, and every figure
 * names where it came from.
 *
 * Three separate jobs, because they are used at different moments. The coverage
 * verdict is the one used standing in the room. Adding sources is the one used
 * when someone proposes a second sounder as the fix. Working the signal back
 * out of a meter reading is the one used after the measurement, and it is the
 * one that quietly changes results — a meter running with the alarm on already
 * contains the ambient.
 */

type Mode = 'coverage' | 'add' | 'meter';

const TONE_FOR: Record<Confidence, 'pass' | 'warn' | 'fail'> = {
  high: 'pass', medium: 'warn', low: 'warn',
};

const SPACES: SpaceKind[] = ['enclosed-room', 'corridor', 'open-plan', 'outdoors'];

/** Blank stays blank. A missing input has to refuse, not default to zero. */
function num(v: string): number {
  const trimmed = v.trim();
  if (!trimmed) return Number.NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

export default function SplScreen() {
  const [mode, setMode] = useState<Mode>('coverage');

  return (
    <>
      <Stack.Screen options={{ title: 'Sound pressure level' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'coverage', label: 'Coverage' },
            { value: 'add', label: 'Add sources' },
            { value: 'meter', label: 'From a meter' },
          ]}
        />

        {mode === 'coverage' ? <CoverageView /> : null}
        {mode === 'add' ? <AddView /> : null}
        {mode === 'meter' ? <MeterView /> : null}

        <Assumptions />
        <Sources />
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function CoverageView() {
  const t = useTheme();
  const [ratedDb, setRatedDb] = useState('100');
  const [referenceDistanceM, setReferenceDistanceM] = useState('1');
  const [distanceM, setDistanceM] = useState('8');
  const [ambientDb, setAmbientDb] = useState('45');
  const [requiredMarginDb, setRequiredMarginDb] = useState('10');
  const [occupancy, setOccupancy] = useState<OccupancyKind>('non-sleeping');
  const [space, setSpace] = useState<SpaceKind>('enclosed-room');
  const [barrierIds, setBarrierIds] = useState<string[]>([]);

  const result = useMemo(
    () =>
      coverageVerdict({
        ratedDb: num(ratedDb),
        referenceDistanceM: num(referenceDistanceM),
        distanceM: num(distanceM),
        ambientDb: num(ambientDb),
        requiredMarginDb: num(requiredMarginDb),
        occupancy,
        space,
        barrierIds,
      }),
    [ratedDb, referenceDistanceM, distanceM, ambientDb, requiredMarginDb, occupancy, space, barrierIds],
  );

  const requirement = SPL_REQUIREMENTS[occupancy];

  // Taken off the verdict rather than added up again here. A second copy of the
  // barrier arithmetic is a second place for it to disagree, and the copy that
  // was here fell back to zero for an id it did not recognise — the one thing
  // the module refuses to do.
  const barrierLoss = result.ok ? result.barrierLossDb : 0;

  // What a device would have to be rated at to fix a failing room, and how far
  // the one already there actually reaches. Both are the next question after a
  // fail, so neither is hidden behind another screen.
  //
  // Reach carries the barriers with it. A closed door costs the same 20 dB at
  // every distance, so it comes off the rating — leave it out and this card
  // says the sounder reaches 17.8 m directly underneath a banner saying the
  // bedhead is short at 8 m, and the technician believes the reassuring one.
  const reach = result.ok
    ? maxDistanceForLevel(num(ratedDb) - barrierLoss, num(referenceDistanceM), result.bindingThresholdDb)
    : undefined;
  const needed = result.ok
    ? requiredRatedDb(result.bindingThresholdDb, num(referenceDistanceM), num(distanceM), barrierLoss)
    : undefined;

  return (
    <>
      {result.ok ? (
        <ResultBlock
          label="Estimated at the listening position"
          value={result.signalDb.toFixed(1)}
          unit="dB(A)"
          tone={result.verdict === 'pass' ? 'pass' : 'fail'}
          detail={
            `Pass mark ${result.bindingThresholdDb.toFixed(1)} dB(A) · `
            + `${result.headroomDb >= 0 ? 'headroom' : 'short by'} ${Math.abs(result.headroomDb).toFixed(1)} dB`
          }
        />
      ) : (
        <ResultBlock label="Estimated at the listening position" value="—" unit="dB(A)" tone="muted" detail={result.error} />
      )}

      {!result.ok ? <Banner tone="warn" title="Not enough to answer with" body={result.error} /> : null}

      {result.ok ? (
        <>
          <Banner
            tone={result.verdict === 'pass' ? 'pass' : 'fail'}
            title={
              result.verdict === 'pass'
                ? `Arithmetic does not rule this out — ${result.headroomDb.toFixed(1)} dB in hand`
                : result.tooLoud
                  ? 'Fails for being too loud'
                  : `Short by ${Math.abs(result.headroomDb).toFixed(1)} dB`
            }
            body={result.bindingReason}
          />

          <Rowed gap={2}>
            <StatTile label="Signal alone" value={`${result.signalDb.toFixed(1)}`} tone={result.verdict === 'pass' ? 'pass' : 'fail'} />
            <StatTile label="Over ambient" value={`${result.marginDb.toFixed(1)}`} />
          </Rowed>
          <Rowed gap={2}>
            <StatTile label="Meter would read" value={`${result.measuredDb.toFixed(1)}`} />
            <StatTile label="Barrier loss" value={result.barrierLossDb ? `−${result.barrierLossDb.toFixed(0)}` : '—'} />
          </Rowed>

          <Card>
            <Label>The two thresholds</Label>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1) }}>
              A {requirement.label.toLowerCase()} has a floor of {requirement.minimumDb.value} dB(A) and, on top of
              that, has to sit {requirement.marginAboveAmbientDb?.value ?? '?'} dB over the ambient. The higher of the
              two decides. Here that is {result.bindingThresholdDb.toFixed(1)} dB(A).
            </Txt>
            {requirement.maximumDb ? (
              <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
                There is a ceiling as well, at {requirement.maximumDb.value} dB(A). A signal loud enough to hurt drives
                people away from it.
              </Txt>
            ) : null}
            <Divider />
            <Rowed gap={2} wrap>
              {requirement.clauses.map((c) => (
                <Chip key={`${c.standard}${c.clause}`} label={`${c.standard} cl ${c.clause}`} tone={TONE_FOR[c.numberConfidence]} />
              ))}
              <Chip label={`${requirement.minimumDb.confidence} confidence`} tone={TONE_FOR[requirement.minimumDb.confidence]} />
            </Rowed>
            {/* A clause number is a fact like any other. The one nothing public
                confirms says so here rather than being cited as if it were settled. */}
            {requirement.clauses.filter((c) => c.numberConfidence !== 'high' && c.note).map((c) => (
              <Txt key={`${c.standard}${c.clause}note`} size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(1.5) }}>
                {c.standard} cl {c.clause}: {c.note}
              </Txt>
            ))}
            <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
              {requirement.measurementPoint}
            </Txt>
          </Card>

          {result.verdict === 'fail' && !result.tooLoud ? (
            <Card>
              <Label>What would fix it</Label>
              {needed !== undefined ? (
                <Txt size="sm" style={{ lineHeight: 19, marginTop: t.space(1) }}>
                  A device rated {needed.toFixed(1)} dB(A) at {num(referenceDistanceM)} m would reach the pass mark from
                  where this one is{barrierLoss ? `, allowing for ${barrierLoss} dB of barrier loss` : ''}.
                </Txt>
              ) : null}
              {reach !== undefined ? (
                <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
                  The device already there reaches the pass mark out to about {reach.toFixed(1)} m in free field
                  {barrierLoss ? ` through ${barrierLoss} dB of barrier` : ''} — the listening position is{' '}
                  {num(distanceM)} m away.
                </Txt>
              ) : (
                <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
                  This device does not reach the pass mark at any distance{barrierLoss ? ' through the barriers set' : ''},
                  not even at the point it was rated at. There is no spacing that fixes it.
                </Txt>
              )}
              <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
                Adding a second identical device at the same point buys 3 dB, not double. Ten of them buy 10 dB.
              </Txt>
            </Card>
          ) : null}
        </>
      ) : null}

      <H2>The device</H2>
      <Field
        label="Rated output"
        value={ratedDb}
        onChangeText={setRatedDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint="Off the datasheet, not off a meter."
      />
      <Field
        label="Distance the rating was taken at"
        value={referenceDistanceM}
        onChangeText={setReferenceDistanceM}
        keyboardType="decimal-pad"
        suffix="m"
        hint="Usually 1 m. Some loudspeakers publish at 3 m — reading that as 1 m overstates every level by nearly 10 dB."
      />

      <H2>The position</H2>
      <Field label="Distance to the listener" value={distanceM} onChangeText={setDistanceM} keyboardType="decimal-pad" suffix="m" />
      <Field
        label="Measured ambient"
        value={ambientDb}
        onChangeText={setAmbientDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint={`Alarm silent, averaged over about ${requirement.ambientAveragingSeconds?.value ?? 60} s. A peak reading sets a pass mark the room can never meet.`}
      />
      <Field
        label="Margin you are holding it to"
        value={requiredMarginDb}
        onChangeText={setRequiredMarginDb}
        keyboardType="decimal-pad"
        suffix="dB over ambient"
        hint="Yours to set. Nothing is applied by default — the published figure is unverified here and should not become a pass mark nobody chose."
      />

      <H2>Occupancy</H2>
      <Segmented
        value={occupancy}
        onChange={setOccupancy}
        options={[
          { value: 'non-sleeping', label: OCCUPANCY_LABEL['non-sleeping'] },
          { value: 'sleeping', label: OCCUPANCY_LABEL.sleeping },
        ]}
      />

      <Label>Kind of space</Label>
      <Rowed gap={2} wrap>
        {SPACES.map((s) => (
          <Chip key={s} label={SPACE_LABEL[s]} selected={space === s} onPress={() => setSpace(s)} />
        ))}
      </Rowed>

      <Label>Barriers on the path</Label>
      <Rowed gap={2} wrap>
        {BARRIERS.map((b) => {
          const on = barrierIds.includes(b.id);
          return (
            <Chip
              key={b.id}
              label={`${b.label} −${b.lossDb.value} dB`}
              selected={on}
              onPress={() => setBarrierIds((prev) => (on ? prev.filter((x) => x !== b.id) : [...prev, b.id]))}
            />
          );
        })}
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Nothing is offered for a wall, a floor, glazing or a shutter, because no source was found for one. Measure
        through it instead of guessing.
      </Txt>

      {result.ok && result.cautions.length ? (
        <Card>
          <Label>Read this before you write the number down</Label>
          {result.cautions.map((c, i) => (
            <Rowed key={i} gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color={t.color.textFaint} style={{ marginTop: 2 }} />
              <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{c}</Txt>
            </Rowed>
          ))}
        </Card>
      ) : null}

      <Banner tone="warn" title="This is a sense-check, not an acoustic assessment" body={NOT_AN_ACOUSTIC_ASSESSMENT} />
    </>
  );
}

// ---------------------------------------------------------------------------

let addSeq = 0;

function AddView() {
  const t = useTheme();
  const [levels, setLevels] = useState<{ key: string; value: string }[]>([
    { key: `l${++addSeq}`, value: '85' },
    { key: `l${++addSeq}`, value: '85' },
  ]);

  // A field with something unreadable in it stops the sum. Filtering it out
  // would drop a device the technician said was there and print a total that
  // looks finished — the quiet kind of wrong answer, because nothing on screen
  // would say a source went missing.
  const entered = levels.map((l, i) => ({ n: i + 1, raw: l.value.trim() })).filter((l) => l.raw !== '');
  const unreadable = entered.filter((l) => !Number.isFinite(Number(l.raw)));
  const blanks = levels.length - entered.length;
  const parsed = entered.filter((l) => Number.isFinite(Number(l.raw))).map((l) => Number(l.raw));
  const total = unreadable.length ? undefined : addLevels(parsed);
  const arithmetic = parsed.reduce((a, b) => a + b, 0);

  const detail = unreadable.length
    ? `Source ${unreadable.map((l) => l.n).join(', ')} is not a level this can read. Nothing is combined until it `
      + 'is — a source that cannot be read is not a source of zero.'
    : total === undefined
      ? 'Enter at least one level. An empty list is not 0 dB — 0 dB is roughly the threshold of hearing, not silence.'
      : `Adding them as ordinary numbers would give ${arithmetic.toFixed(1)}, which is not a sound pressure level at `
        + `all.${blanks ? ` ${blanks} empty ${blanks === 1 ? 'field is' : 'fields are'} not counted.` : ''}`;

  return (
    <>
      <ResultBlock
        label="Combined level"
        value={total === undefined ? '—' : total.toFixed(1)}
        unit="dB(A)"
        tone={total === undefined ? 'muted' : 'accent'}
        detail={detail}
      />

      {unreadable.length ? (
        <Banner tone="warn" title="A source cannot be read" body={detail} />
      ) : null}

      <Banner
        tone="info"
        title="Decibels do not add"
        body={
          'Two 85 dB sources in the same place make 88 dB, not 170. Doubling the number of identical sources buys '
          + '3 dB every time, so ten of them buy 10 dB. A source 30 dB down adds nothing a meter can see. This is why '
          + '"put another sounder in" is a much weaker fix than it sounds when a room is 13 dB short.'
        }
      />

      {levels.map((l, i) => (
        <Rowed key={l.key} gap={2}>
          <View style={{ flex: 1 }}>
            <Field
              label={`Source ${i + 1} at the listening position`}
              value={l.value}
              onChangeText={(v) => setLevels((prev) => prev.map((x) => (x.key === l.key ? { ...x, value: v } : x)))}
              keyboardType="decimal-pad"
              suffix="dB(A)"
            />
          </View>
          {levels.length > 1 ? (
            <Pressable onPress={() => setLevels((prev) => prev.filter((x) => x.key !== l.key))} hitSlop={10} style={{ marginTop: t.space(4) }}>
              <MaterialCommunityIcons name="close-circle-outline" size={20} color={t.color.textFaint} />
            </Pressable>
          ) : null}
        </Rowed>
      ))}

      <Button
        title="Add a source"
        variant="secondary"
        onPress={() => setLevels((prev) => [...prev, { key: `l${++addSeq}`, value: '85' }])}
        icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
      />

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Levels here are what each source produces at the listening position, not what each is rated at. Use the coverage
        tab to bring a rated output down to a distance first.
      </Txt>
    </>
  );
}

// ---------------------------------------------------------------------------

function MeterView() {
  const [totalDb, setTotalDb] = useState('75.4');
  const [ambientDb, setAmbientDb] = useState('65');

  const result = removeAmbient(num(totalDb), num(ambientDb));
  const naive = num(totalDb) - num(ambientDb);

  return (
    <>
      <ResultBlock
        label="Warning signal on its own"
        value={result.ok && result.db !== undefined ? result.db.toFixed(1) : '—'}
        unit="dB(A)"
        tone={result.ok ? 'accent' : 'muted'}
        detail={
          result.ok && result.db !== undefined
            ? `Over ambient by ${(result.db - num(ambientDb)).toFixed(1)} dB — not the ${naive.toFixed(1)} dB the two readings differ by.`
            : result.error
        }
      />

      {!result.ok ? <Banner tone="warn" title="Cannot be worked out from these two readings" body={result.error} /> : null}
      {result.caution ? <Banner tone="warn" title="Close to the ambient" body={result.caution} /> : null}

      <Banner
        tone="info"
        title="The reading already contains the ambient"
        body={
          'A meter running while the alarm sounds measures the signal and the room together, so subtracting the two '
          + 'readings arithmetically overstates the margin. A total exactly 10 dB above ambient is a signal only 9.5 dB '
          + 'above it — and where the requirement is 10 dB, that half-decibel is the result.'
        }
      />

      <Field label="With the alarm running" value={totalDb} onChangeText={setTotalDb} keyboardType="decimal-pad" suffix="dB(A)" />
      <Field
        label="Ambient, alarm silent"
        value={ambientDb}
        onChangeText={setAmbientDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint="Same point, same meter, averaged rather than peak."
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function Assumptions() {
  const t = useTheme();
  return (
    <>
      <H2>What this assumes</H2>
      <Card>
        <Label>Free field, point source</Label>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1) }}>{CALCULATION_BASIS}</Txt>
        <Divider />
        <Label>Where it stops being valid</Label>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1) }}>{REVERBERANT_LIMIT}</Txt>
        <Divider />
        <Label>Level is not intelligibility</Label>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1) }}>{INTELLIGIBILITY_NOTE}</Txt>
        <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
          <Chip label={`${INTELLIGIBILITY_CLAUSE.standard} cl ${INTELLIGIBILITY_CLAUSE.clause}`} />
        </Rowed>
      </Card>

      <Card>
        <Label>Units — measuring at the door instead of the bedhead</Label>
        {SOU_DOOR_CONCESSIONS.map((c) => (
          <Txt key={c.id} size="sm" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
            {c.label}: {c.atDoorDb.value} dB(A) at the unit door, in place of a reading inside it.
          </Txt>
        ))}
        <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(2) }}>{QFES_CONCESSION_POSITION}</Txt>
      </Card>
    </>
  );
}

function Sources() {
  const t = useTheme();
  const rows = useMemo(() => sourceList(), []);

  return (
    <>
      <H2>Where every figure came from</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Australian Standards are licensed per copy, so no clause text is held in this app. What is held is clause
        numbers, the publisher’s own page, and figures as understood from public sources — which is why most of the
        thresholds below are marked low confidence. Check them against your licensed copy before any of them goes into
        a report.
      </Txt>
      {rows.map((r, i) => (
        <Card key={i}>
          <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
            <Txt size="sm" weight="700" style={{ flex: 1 }}>{r.fact}</Txt>
            <Chip label={r.confidence} tone={TONE_FOR[r.confidence]} />
          </Rowed>
          <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: t.space(1.5) }}>{r.source}</Txt>
          <Txt size="xs" tone="faint" mono style={{ lineHeight: 16, marginTop: 4 }} numberOfLines={2}>{r.url}</Txt>
        </Card>
      ))}
    </>
  );
}
