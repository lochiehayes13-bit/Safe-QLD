import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  BARRIERS,
  CALCULATION_BASIS,
  INTELLIGIBILITY_NOTE,
  NOT_AN_ACOUSTIC_ASSESSMENT,
  OCCUPANCY_LABEL,
  QFES_CONCESSION_POSITION,
  SOU_DOOR_CONCESSIONS,
  SPACE_LABEL,
  SPL_REQUIREMENTS,
  SPL_SOURCE_NOTE,
  addLevels,
  coverageVerdict,
  maxDistanceForLevel,
  removeAmbient,
  requiredRatedDb,
  type OccupancyKind,
  type SpaceKind,
} from '@/calc/spl';
import { readNumber } from '@/calc/fieldNumber';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Sound pressure level for occupant warning.
 *
 * The EWIS annual routine asks for a sound pressure level and gives a
 * technician nothing to check the reading against. This screen is that check,
 * and it is built to be honest about being an estimate: the assumption it runs
 * on and the clause the pass mark comes from are printed with the answer.
 *
 * Three separate jobs, because they are used at different moments. The coverage
 * verdict is the one used standing in the room. Adding sources is the one used
 * when someone proposes a second sounder as the fix. Working the signal back
 * out of a meter reading is the one used after the measurement, and it is the
 * one that quietly changes results — a meter running with the alarm on already
 * contains the ambient.
 */

type Mode = 'coverage' | 'add' | 'meter';

const SPACES: SpaceKind[] = ['enclosed-room', 'corridor', 'open-plan', 'outdoors'];

/** Blank stays blank. A missing input has to refuse, not default to zero. */
function num(v: string): number {
  return readNumber(v) ?? Number.NaN;
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

        <Notes />
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function CoverageView() {
  const t = useTheme();
  const [ratedDb, setRatedDb] = useState('');
  const [referenceDistanceM, setReferenceDistanceM] = useState('1');
  const [distanceM, setDistanceM] = useState('');
  const [ambientDb, setAmbientDb] = useState('');
  const [requiredMarginDb, setRequiredMarginDb] = useState(
    String(SPL_REQUIREMENTS['non-sleeping'].marginAboveAmbientDb?.value ?? 10),
  );
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
          label="At the listener"
          value={result.signalDb.toFixed(1)}
          unit="dB(A)"
          tone={result.verdict === 'pass' ? 'pass' : 'fail'}
          detail={`Pass mark ${result.bindingThresholdDb.toFixed(1)} dB(A)`}
        />
      ) : (
        <ResultBlock label="At the listener" value="—" unit="dB(A)" tone="muted" detail={result.error} />
      )}

      {result.ok ? (
        <>
          <Banner
            tone={result.verdict === 'pass' ? 'pass' : 'fail'}
            title={
              result.verdict === 'pass'
                ? `Pass, ${result.headroomDb.toFixed(1)} dB spare`
                : result.tooLoud
                  ? 'Too loud'
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

          {result.verdict === 'fail' && !result.tooLoud ? (
            <Card>
              <Label>To fix it</Label>
              {needed !== undefined ? (
                <Txt size="sm" style={{ lineHeight: 19, marginTop: t.space(1) }}>
                  Needs a device rated {needed.toFixed(1)} dB(A) at {num(referenceDistanceM)} m
                  {barrierLoss ? `, allowing ${barrierLoss} dB barrier loss` : ''}.
                </Txt>
              ) : null}
              <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
                {reach !== undefined
                  ? `This one reaches the pass mark out to ${reach.toFixed(1)} m${barrierLoss ? ' through the barriers' : ''}. The listener is at ${num(distanceM)} m.`
                  : 'This one does not reach the pass mark at any distance.'}
              </Txt>
              <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>
                A second identical device adds 3 dB, not double.
              </Txt>
            </Card>
          ) : null}
        </>
      ) : null}

      <H2>Device</H2>
      <Field
        label="Rated output"
        value={ratedDb}
        onChangeText={setRatedDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint="From the datasheet."
      />
      <Field
        label="Rated at"
        value={referenceDistanceM}
        onChangeText={setReferenceDistanceM}
        keyboardType="decimal-pad"
        suffix="m"
        hint="Usually 1 m. Some datasheets quote 3 m."
      />

      <H2>Listening position</H2>
      <Field label="Distance from device" value={distanceM} onChangeText={setDistanceM} keyboardType="decimal-pad" suffix="m" />
      <Field
        label="Ambient"
        value={ambientDb}
        onChangeText={setAmbientDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint={`Alarm off, averaged over ${requirement.ambientAveragingSeconds?.value ?? 60} s.`}
      />
      <Field
        label="Margin over ambient"
        value={requiredMarginDb}
        onChangeText={setRequiredMarginDb}
        keyboardType="decimal-pad"
        suffix="dB"
        hint={`Usually ${requirement.marginAboveAmbientDb?.value ?? 10} dB over ambient.`}
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

      <Label>Space</Label>
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
        For walls or glazing, measure instead.
      </Txt>

      {result.ok && result.cautions.length ? (
        <Card>
          <Label>Before recording</Label>
          {result.cautions.map((c, i) => (
            <Rowed key={i} gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color={t.color.textFaint} style={{ marginTop: 2 }} />
              <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{c}</Txt>
            </Rowed>
          ))}
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

let addSeq = 0;

function AddView() {
  const t = useTheme();
  const [levels, setLevels] = useState<{ key: string; value: string }[]>([
    { key: `l${++addSeq}`, value: '' },
    { key: `l${++addSeq}`, value: '' },
  ]);

  // A field with something unreadable in it stops the sum. Filtering it out
  // would drop a device the technician said was there and print a total that
  // looks finished — the quiet kind of wrong answer, because nothing on screen
  // would say a source went missing.
  const entered = levels
    .map((l, i) => ({ n: i + 1, raw: l.value.trim(), db: readNumber(l.value) }))
    .filter((l) => l.raw !== '');
  const unreadable = entered.filter((l) => l.db === undefined);
  const blanks = levels.length - entered.length;
  const parsed = entered.flatMap((l) => (l.db === undefined ? [] : [l.db]));
  const total = unreadable.length ? undefined : addLevels(parsed);

  const detail = unreadable.length
    ? `Source ${unreadable.map((l) => l.n).join(', ')} is not a number.`
    : total === undefined
      ? 'Enter at least one level.'
      : blanks
        ? `${blanks} blank ${blanks === 1 ? 'field' : 'fields'} not counted.`
        : undefined;

  return (
    <>
      <ResultBlock
        label="Combined level"
        value={total === undefined ? '—' : total.toFixed(1)}
        unit="dB(A)"
        tone={total === undefined ? 'muted' : 'accent'}
        detail={detail}
      />

      <Banner tone="info" title="Decibels do not add" body="Two 85 dB sources make 88 dB." />

      {levels.map((l, i) => (
        <Rowed key={l.key} gap={2}>
          <View style={{ flex: 1 }}>
            <Field
              label={`Source ${i + 1}`}
              value={l.value}
              onChangeText={(v) => setLevels((prev) => prev.map((x) => (x.key === l.key ? { ...x, value: v } : x)))}
              keyboardType="decimal-pad"
              suffix="dB(A)"
            />
          </View>
          {levels.length > 1 ? (
            <Pressable
              onPress={() => setLevels((prev) => prev.filter((x) => x.key !== l.key))}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove source ${i + 1}`}
              style={{ marginTop: t.space(4) }}
            >
              <MaterialCommunityIcons name="close-circle-outline" size={20} color={t.color.textFaint} />
            </Pressable>
          ) : null}
        </Rowed>
      ))}

      <Button
        title="Add a source"
        variant="secondary"
        onPress={() => setLevels((prev) => [...prev, { key: `l${++addSeq}`, value: '' }])}
        icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.text} />}
      />

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Enter each level at the listener, not its rating.
      </Txt>
    </>
  );
}

// ---------------------------------------------------------------------------

function MeterView() {
  const [totalDb, setTotalDb] = useState('');
  const [ambientDb, setAmbientDb] = useState('');

  const total = num(totalDb);
  const ambient = num(ambientDb);
  const result = removeAmbient(total, ambient);
  const bothEntered = Number.isFinite(total) && Number.isFinite(ambient);

  return (
    <>
      <ResultBlock
        label="Alarm signal alone"
        value={result.ok && result.db !== undefined ? result.db.toFixed(1) : '—'}
        unit="dB(A)"
        tone={result.ok ? 'accent' : 'muted'}
        detail={
          result.ok && result.db !== undefined
            ? `${(result.db - ambient).toFixed(1)} dB over ambient, not ${(total - ambient).toFixed(1)}.`
            : bothEntered ? undefined : result.error
        }
      />

      {!result.ok && bothEntered ? <Banner tone="warn" title="Re-check the readings" body={result.error} /> : null}
      {result.caution ? <Banner tone="warn" title="Close to the ambient" body={result.caution} /> : null}

      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Removes ambient from the alarm reading.
      </Txt>

      <Field label="Alarm on" value={totalDb} onChangeText={setTotalDb} keyboardType="decimal-pad" suffix="dB(A)" />
      <Field
        label="Ambient, alarm off"
        value={ambientDb}
        onChangeText={setAmbientDb}
        keyboardType="decimal-pad"
        suffix="dB(A)"
        hint="Same point, same meter, averaged."
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function Notes() {
  const t = useTheme();
  return (
    <>
      <Card>
        <Label>Unit door readings</Label>
        {SOU_DOOR_CONCESSIONS.map((c) => (
          <Txt key={c.id} size="sm" style={{ lineHeight: 19, marginTop: t.space(1.5) }}>
            {c.label}: {c.atDoorDb.value} dB(A) at the door.
          </Txt>
        ))}
        <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(2) }}>{QFES_CONCESSION_POSITION}</Txt>
      </Card>

      <Card>
        <Label>{NOT_AN_ACOUSTIC_ASSESSMENT}</Label>
        {[SPL_SOURCE_NOTE, CALCULATION_BASIS, INTELLIGIBILITY_NOTE].map((line) => (
          <Txt key={line} size="xs" tone="faint" style={{ lineHeight: 17, marginTop: t.space(1.5) }}>{line}</Txt>
        ))}
      </Card>
    </>
  );
}
