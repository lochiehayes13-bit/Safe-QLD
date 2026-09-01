import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ACTIVITIES_ARE_INDEPENDENT,
  ACTIVITY_LABEL,
  ACTIVITY_SPECS,
  AS1851_SECTION_NOT_ESTABLISHED,
  COMMON_HOSE_LENGTHS_M,
  DUE_STATE_LABEL,
  QLD_PRESCRIBED_NOTE,
  citeSources,
  coverage,
  estimateReels,
  isRefused,
  nextDue,
  publishedDuty,
  checkFlow,
  type ComponentCheck,
  type Confidence,
  type DueState,
  type HoseReelActivity,
  type Refused,
  type SourceId,
} from '@/domain/hoseReel';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Fire hose reels on site.
 *
 * Three questions, and they are the three a technician actually has standing in
 * front of a reel with a bucket and a flow meter.
 *
 *  - Does this reel reach the back of the room? A hose reel is the only asset
 *    on the book whose whole job is a distance, and nobody ever checks it
 *    because the reel is already on the wall.
 *  - Did it make its duty? With the duty entered rather than assumed — this
 *    screen will not put a number in that box on the technician's behalf.
 *  - When is the next one, and which one? The five-yearly and the six-monthly
 *    are separate and this screen keeps them separate on purpose.
 *
 * Every figure carries where it came from and how much that source is worth,
 * because the two things this screen produces — "your reel does not cover that
 * corner" and "your hose is out of test" — are both arguments, and an argument
 * needs a citation.
 */

type Mode = 'coverage' | 'flow' | 'due';

export default function HoseReelScreen() {
  const [mode, setMode] = useState<Mode>('coverage');

  return (
    <>
      <Stack.Screen options={{ title: 'Fire hose reels' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'coverage', label: 'Coverage' },
            { value: 'flow', label: 'Flow' },
            { value: 'due', label: 'Next due' },
          ]}
        />

        {mode === 'coverage' ? <CoverageView /> : null}
        {mode === 'flow' ? <FlowView /> : null}
        {mode === 'due' ? <DueView /> : null}
      </Screen>
    </>
  );
}

const CONFIDENCE_TONE = (c: Confidence): 'pass' | 'accent' | 'warn' =>
  c === 'high' ? 'pass' : c === 'medium' ? 'accent' : 'warn';

const num = (text: string): number => {
  const trimmed = text.trim();
  return trimmed ? Number(trimmed) : Number.NaN;
};

// ---------------------------------------------------------------------------
// Does it reach the back of the room
// ---------------------------------------------------------------------------

function CoverageView() {
  const t = useTheme();
  const [hoseText, setHoseText] = useState('36');
  const [areaText, setAreaText] = useState('');
  const [installedText, setInstalledText] = useState('');

  const hose = num(hoseText);
  const cover = useMemo(() => coverage(hose), [hose]);
  const area = num(areaText);
  const installed = num(installedText);

  const estimate = useMemo(
    () =>
      Number.isFinite(area) && area > 0
        ? estimateReels(area, hose, { installed: Number.isFinite(installed) ? installed : undefined })
        : undefined,
    [area, hose, installed],
  );

  return (
    <>
      <Field
        label="Hose length"
        value={hoseText}
        onChangeText={setHoseText}
        keyboardType="decimal-pad"
        suffix="m"
        hint="Measure what is actually on the reel. A cut-back hose is a coverage defect nobody has recorded."
      />

      <Rowed gap={2} wrap>
        {COMMON_HOSE_LENGTHS_M.map((m) => (
          <Chip
            key={m}
            label={`${m} m`}
            selected={hose === m}
            onPress={() => setHoseText(String(m))}
          />
        ))}
      </Rowed>

      {isRefused(cover) ? (
        <RefusalCard refusal={cover} />
      ) : (
        <>
          <ResultBlock
            label="Reach from the reel"
            value={String(cover.radiusM)}
            unit="m"
            tone={cover.overLength ? 'warn' : 'accent'}
            detail={`${cover.hoseLengthM} m of hose plus a ${cover.throwM} m hose stream off the nozzle.`}
          />

          {cover.overLength ? (
            <Banner
              tone="warn"
              title="Hose is over the maximum length"
              body={cover.notes.find((n) => n.includes('maximum'))}
            />
          ) : null}

          <Rowed gap={2}>
            <StatTile label="Bare floor" value={`${cover.discAreaM2} m²`} />
            <StatTile label="On a grid" value={`${cover.gridAreaM2} m²`} tone="accent" />
          </Rowed>
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            The first is π r² — one reel on an empty slab. The second is the largest square that fits inside that
            circle, which is what a reel is worth when it has to share a floor and leave no gap. Circles do not
            tessellate; using the first number to count reels comes up a third short.
          </Txt>

          <Divider />

          <H2>Sense-check a floor</H2>
          <Field
            label="Fire compartment floor area"
            value={areaText}
            onChangeText={setAreaText}
            keyboardType="decimal-pad"
            suffix="m²"
            hint="The compartment the reels serve, not the whole building."
          />
          <Field
            label="Reels installed (optional)"
            value={installedText}
            onChangeText={setInstalledText}
            keyboardType="numeric"
          />

          {estimate && !isRefused(estimate) ? (
            <>
              <Rowed gap={2}>
                <StatTile label="Bare-floor minimum" value={estimate.idealMinimum} />
                <StatTile label="Grid estimate" value={estimate.gridEstimate} tone="accent" />
              </Rowed>
              {estimate.shortfallStatement ? (
                <Banner tone="fail" title="Cannot reach the whole floor" body={estimate.shortfallStatement} />
              ) : null}
              <NoteList notes={estimate.notes} />
            </>
          ) : estimate && isRefused(estimate) ? (
            <RefusalCard refusal={estimate} />
          ) : (
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              Enter a floor area to bracket how many reels it takes. Both numbers are lower bounds and neither is a
              design.
            </Txt>
          )}

          <NoteList notes={cover.notes.filter((n) => !n.includes('maximum'))} />
          <SourceList ids={cover.sourceIds} />
        </>
      )}

      <Card style={{ gap: t.space(1) }}>
        <Rowed gap={2}>
          <MaterialCommunityIcons name="ruler" size={18} color={t.color.textMuted} />
          <Label>How the distance is actually measured</Label>
        </Rowed>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Along the floor, by the route the hose would take — not through the wall. Everything on this tab is a circle
          drawn on a bare slab, so it is optimistic wherever the building is not. Where a corner is marginal, run the
          hose to it.
        </Txt>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Did it make its duty
// ---------------------------------------------------------------------------

function FlowView() {
  const t = useTheme();
  const [flowText, setFlowText] = useState('');
  const [pressureText, setPressureText] = useState('');
  const [dutyFlowText, setDutyFlowText] = useState('');
  const [dutyPressureText, setDutyPressureText] = useState('');

  const published = publishedDuty(19);
  const dn25 = publishedDuty(25);

  const result = useMemo(
    () =>
      checkFlow({
        measuredFlowLitresPerMinute: num(flowText),
        measuredRunningPressureKpa: num(pressureText),
        dutyFlowLitresPerSecond: num(dutyFlowText),
        dutyPressureKpa: num(dutyPressureText),
      }),
    [flowText, pressureText, dutyFlowText, dutyPressureText],
  );

  return (
    <>
      <H2>The duty this reel has to meet</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Taken from the building’s baseline data, or from the office copy of AS 2441 Table 6.1 for the hose diameter
        fitted. This screen will not fill it in for you — a pass against an assumed duty is a tick with nothing behind
        it.
      </Txt>

      <Rowed gap={2}>
        <View style={{ flex: 1 }}>
          <Field
            label="Duty flow"
            value={dutyFlowText}
            onChangeText={setDutyFlowText}
            keyboardType="decimal-pad"
            suffix="L/s"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Duty pressure"
            value={dutyPressureText}
            onChangeText={setDutyPressureText}
            keyboardType="decimal-pad"
            suffix="kPa"
          />
        </View>
      </Rowed>

      {!isRefused(published) ? (
        <Card style={{ gap: t.space(1.5) }}>
          <Rowed gap={2}>
            <Chip label={published.confidence} tone={CONFIDENCE_TONE(published.confidence)} />
            <Txt size="sm" weight="700" style={{ flex: 1 }}>
              {published.nominalHoseDiameterMm} mm hose — {published.minimumFlowLitresPerSecond} L/s at{' '}
              {published.atInletPressureKpa} kPa
            </Txt>
          </Rowed>
          {published.disagreement ? (
            <Txt size="xs" tone="warn" style={{ lineHeight: 17 }}>{published.disagreement}</Txt>
          ) : null}
          <Chip
            label="Use this duty"
            tone="accent"
            onPress={() => {
              setDutyFlowText(String(published.minimumFlowLitresPerSecond));
              setDutyPressureText(String(published.atInletPressureKpa));
            }}
          />
        </Card>
      ) : null}

      {isRefused(dn25) ? (
        <Banner tone="info" title="No DN 25 duty is offered" body={`${dn25.reason} ${dn25.whatToDo}`} />
      ) : null}

      <Divider />

      <H2>What you measured</H2>
      <Rowed gap={2}>
        <View style={{ flex: 1 }}>
          <Field
            label="Flow at the nozzle"
            value={flowText}
            onChangeText={setFlowText}
            keyboardType="decimal-pad"
            suffix="L/min"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Running pressure"
            value={pressureText}
            onChangeText={setPressureText}
            keyboardType="decimal-pad"
            suffix="kPa"
          />
        </View>
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Hose fully run out, at the hydraulically most disadvantaged reel. Running pressure while water is flowing —
        static pressure with the nozzle shut proves nothing.
      </Txt>

      {isRefused(result) ? (
        <RefusalCard refusal={result} />
      ) : (
        <>
          <Banner
            tone={result.verdict === 'pass' ? 'pass' : result.verdict === 'fail' ? 'fail' : 'warn'}
            title={
              result.verdict === 'pass' ? 'Met the duty' : result.verdict === 'fail' ? 'Below the duty' : 'Not proved'
            }
            body={result.statement}
          />
          <Card>
            <ComponentRow check={result.flow} />
            <Divider />
            <ComponentRow check={result.pressure} />
          </Card>
          {result.measuredFlowLitresPerSecond !== undefined ? (
            <ResultBlock
              label="Measured flow in the unit the duty is published in"
              value={String(result.measuredFlowLitresPerSecond)}
              unit="L/s"
              tone={result.flow.verdict === 'fail' ? 'fail' : 'accent'}
              detail="Duties are published in litres per second and gauges read litres per minute. Getting the two the wrong way round is a factor of sixty."
            />
          ) : null}
          <NoteList notes={result.notes} />
          <SourceList ids={result.sourceIds} />
        </>
      )}
    </>
  );
}

function ComponentRow({ check }: { check: ComponentCheck }) {
  const t = useTheme();
  const tone =
    check.verdict === 'pass' ? 'pass' : check.verdict === 'fail' ? 'fail' : 'muted';
  const icon =
    check.verdict === 'pass'
      ? 'check-circle'
      : check.verdict === 'fail'
        ? 'close-octagon'
        : 'help-circle-outline';
  const colour =
    check.verdict === 'pass' ? t.color.pass : check.verdict === 'fail' ? t.color.fail : t.color.textFaint;

  return (
    <View style={{ paddingVertical: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        <MaterialCommunityIcons name={icon} size={20} color={colour} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt size="sm" weight="700">{check.label}</Txt>
          <Txt size="sm" tone={tone}>
            {check.measured === undefined
              ? 'Not measured'
              : `${check.measured} ${check.unit}`}
            {check.required !== undefined ? ` against ${check.required} ${check.unit}` : ' — no duty entered'}
            {check.margin !== undefined
              ? ` (${check.margin >= 0 ? '+' : ''}${check.margin} ${check.unit})`
              : ''}
          </Txt>
        </View>
      </Rowed>
    </View>
  );
}

// ---------------------------------------------------------------------------
// When is the next one, and which one
// ---------------------------------------------------------------------------

const DUE_TONE: Record<DueState, 'fail' | 'warn' | 'accent'> = {
  overdue: 'fail',
  due: 'warn',
  upcoming: 'accent',
};

function DueView() {
  const t = useTheme();
  const [activity, setActivity] = useState<HoseReelActivity>('six-monthly');
  const [commissioned, setCommissioned] = useState('');
  const [lastDone, setLastDone] = useState('');
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));

  const spec = ACTIVITY_SPECS[activity];
  const result = useMemo(
    () => nextDue({ activity, commissioned, lastDone, today }),
    [activity, commissioned, lastDone, today],
  );

  return (
    <>
      <Segmented
        value={activity}
        onChange={setActivity}
        options={[
          { value: 'six-monthly', label: ACTIVITY_LABEL['six-monthly'] },
          { value: 'five-yearly', label: ACTIVITY_LABEL['five-yearly'] },
        ]}
      />

      <Card style={{ gap: t.space(1.5) }}>
        <Label>{spec.label} — what it is for</Label>
        <Txt size="sm" style={{ lineHeight: 19 }}>{spec.purpose}</Txt>
        <Rowed gap={2} align="flex-start">
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={t.color.warn} style={{ marginTop: 2 }} />
          <Txt size="xs" tone="muted" style={{ flex: 1, lineHeight: 17 }}>{spec.doesNotCover}</Txt>
        </Rowed>
      </Card>

      <Field
        label="Commissioned"
        value={commissioned}
        onChangeText={setCommissioned}
        placeholder="1/6/2015, Jun-15 or 2015"
        autoCapitalize="none"
        hint="Off the commissioning tag on the reel. A month or a bare year is fine — it is carried as a month or a year and no day is invented."
      />
      <Field
        label={`Last ${spec.label.toLowerCase()}`}
        value={lastDone}
        onChangeText={setLastDone}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
        hint={`This activity only. A ${activity === 'six-monthly' ? 'five-yearly' : 'six-monthly'} date entered here would schedule the wrong routine.`}
      />
      <Field
        label="Today"
        value={today}
        onChangeText={setToday}
        placeholder="yyyy-mm-dd"
        autoCapitalize="none"
      />

      {isRefused(result) ? (
        <RefusalCard refusal={result} />
      ) : (
        <>
          <ResultBlock
            label={`Next ${spec.label.toLowerCase()} due`}
            value={result.due.label}
            tone={DUE_TONE[result.state]}
            detail={result.anchorNote}
          />

          <Rowed gap={2} wrap>
            <Chip label={DUE_STATE_LABEL[result.state]} tone={DUE_TONE[result.state]} />
            {!result.everRecorded ? <Chip label="Never recorded" tone="fail" /> : null}
            {result.missedOccurrences > 1 ? (
              <Chip label={`${result.missedOccurrences} outstanding`} tone="fail" />
            ) : null}
            <Chip label={`Anchored to ${result.anchoredTo.replace('-', ' ')}`} tone="muted" />
            <Chip label={result.confidence} tone={CONFIDENCE_TONE(result.confidence)} />
          </Rowed>

          <Rowed gap={2}>
            <StatTile
              label="Days"
              value={result.daysUntil.earliest}
              tone={result.daysUntil.earliest < 0 ? 'fail' : 'default'}
            />
            <StatTile label="Occurrence" value={result.occurrence} />
            <StatTile label="Interval" value={`${result.intervalMonths} mo`} />
          </Rowed>

          <NoteList notes={result.notes} />
          <SourceList ids={result.sourceIds} />
        </>
      )}

      <Banner tone="info" title="Two routines, two records" body={ACTIVITIES_ARE_INDEPENDENT} />
      <Banner tone="warn" title="Queensland" body={QLD_PRESCRIBED_NOTE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** A refusal is a result, not an error state, and it is rendered like one. */
function RefusalCard({ refusal }: { refusal: Refused }) {
  const t = useTheme();
  return (
    <Card style={{ gap: t.space(2) }}>
      <Rowed gap={2}>
        <MaterialCommunityIcons name="help-circle-outline" size={20} color={t.color.warn} />
        <Txt size="sm" weight="700" style={{ flex: 1 }}>This app will not answer that</Txt>
      </Rowed>
      <Txt size="sm" style={{ lineHeight: 19 }}>{refusal.reason}</Txt>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{refusal.whatToDo}</Txt>
      <SourceList ids={refusal.sourceIds} />
    </Card>
  );
}

function NoteList({ notes }: { notes: string[] }) {
  const t = useTheme();
  if (!notes.length) return null;
  return (
    <Card style={{ gap: t.space(2) }}>
      {notes.map((n, i) => (
        <Rowed key={i} gap={2} align="flex-start">
          <MaterialCommunityIcons name="circle-small" size={18} color={t.color.textFaint} style={{ marginTop: 1 }} />
          <Txt size="xs" tone="muted" style={{ flex: 1, lineHeight: 17 }}>{n}</Txt>
        </Rowed>
      ))}
    </Card>
  );
}

function SourceList({ ids }: { ids: SourceId[] }) {
  const t = useTheme();
  const sources = citeSources(ids);
  if (!sources.length) return null;
  return (
    <>
      <H2>Sources</H2>
      <Card>
        {sources.map((s, i) => (
          <View key={s.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ paddingVertical: t.space(1.5) }}>
              <Rowed gap={2}>
                <Chip label={s.confidence} tone={CONFIDENCE_TONE(s.confidence)} />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>{s.ref}</Txt>
              </Rowed>
              <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{s.what}</Txt>
              <Txt size="xs" tone="faint" style={{ marginTop: 3, lineHeight: 17 }}>{s.basis}</Txt>
              <Txt size="xs" tone="accent" mono style={{ marginTop: 3 }}>{s.url}</Txt>
            </View>
          </View>
        ))}
        <Divider />
        <Rowed gap={2} align="flex-start" style={{ paddingTop: t.space(1) }}>
          <MaterialCommunityIcons name="information-outline" size={16} color={t.color.textFaint} />
          <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>
            No text, table or schedule from AS 2441, AS/NZS 1221 or AS 1851 is reproduced in this app. Clause and table
            numbers point at the office copy, which is what governs. {AS1851_SECTION_NOT_ESTABLISHED}
          </Txt>
        </Rowed>
      </Card>
    </>
  );
}
