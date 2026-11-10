import React, { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
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
  type DueState,
  type HoseReelActivity,
  type Refused,
  type SourceId,
} from '@/domain/hoseReel';
import { qldIsoDay } from '@/domain/qldTime';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
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
 * Every figure carries where it came from, because the two things this screen
 * produces — "your reel does not cover that corner" and "your hose is out of
 * test" — are both arguments, and an argument needs a citation.
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

/** A field's text, read as a number only when it is used. Blank is not zero. */
const num = (text: string): number => {
  const trimmed = text.trim();
  return trimmed ? Number(trimmed) : Number.NaN;
};

// ---------------------------------------------------------------------------
// Does it reach the back of the room
// ---------------------------------------------------------------------------

function CoverageView() {
  const t = useTheme();
  const [hoseText, setHoseText] = useState('');
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
        hint="Measure the hose on the reel."
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

      {!hoseText.trim() ? (
        <Txt size="sm" tone="muted">Enter the hose length.</Txt>
      ) : isRefused(cover) ? (
        <RefusalCard refusal={cover} />
      ) : (
        <>
          <ResultBlock
            label="Reach from the reel"
            value={String(cover.radiusM)}
            unit="m"
            tone={cover.overLength ? 'warn' : 'accent'}
            detail={`${cover.hoseLengthM} m hose plus ${cover.throwM} m stream.`}
          />

          {cover.overLength ? (
            <Banner
              tone="warn"
              title="Over the maximum length"
              body={cover.notes.find((n) => n.includes('maximum'))}
            />
          ) : null}

          <Rowed gap={2}>
            <StatTile label="Bare floor" value={`${cover.discAreaM2} m²`} />
            <StatTile label="On a grid" value={`${cover.gridAreaM2} m²`} tone="accent" />
          </Rowed>
          <Txt size="xs" tone="faint">Use the grid figure to count reels.</Txt>

          <Divider />

          <H2>Reels for a floor</H2>
          <Field
            label="Compartment floor area"
            value={areaText}
            onChangeText={setAreaText}
            keyboardType="decimal-pad"
            suffix="m²"
            hint="The fire compartment the reels serve."
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
              {/* The coverage notes are already listed below; only what the estimate adds goes here. */}
              <NoteList notes={estimate.notes.filter((n) => !cover.notes.includes(n))} />
            </>
          ) : estimate && isRefused(estimate) ? (
            <RefusalCard refusal={estimate} />
          ) : (
            <Txt size="sm" tone="muted">Enter floor area for a reel estimate.</Txt>
          )}

          <NoteList notes={cover.notes.filter((n) => !n.includes('maximum'))} />
          <SourceList ids={cover.sourceIds} />
        </>
      )}

      <Card style={{ gap: t.space(1) }}>
        <Rowed gap={2}>
          <MaterialCommunityIcons name="ruler" size={18} color={t.color.textMuted} />
          <Label>Measuring reach</Label>
        </Rowed>
        <Txt size="sm" tone="muted">Measure along the hose path. If marginal, run it out.</Txt>
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

  const entered = [flowText, pressureText, dutyFlowText, dutyPressureText].some((v) => v.trim().length > 0);
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
      <H2>Duty</H2>
      <Txt size="sm" tone="muted">From the baseline data or AS 2441 Table 6.1.</Txt>

      <Rowed gap={2} align="flex-start">
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
          <Txt size="sm" weight="700">
            {published.nominalHoseDiameterMm} mm hose: {published.minimumFlowLitresPerSecond} L/s at{' '}
            {published.atInletPressureKpa} kPa
          </Txt>
          <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{published.pressureMeasuredAt}</Txt>
          {published.disagreement ? (
            <Txt size="xs" tone="warn" style={{ lineHeight: 17 }}>{published.disagreement}</Txt>
          ) : null}
          <Button
            title="Use this duty"
            variant="secondary"
            compact
            onPress={() => {
              setDutyFlowText(String(published.minimumFlowLitresPerSecond));
              setDutyPressureText(String(published.atInletPressureKpa));
            }}
          />
        </Card>
      ) : null}

      {isRefused(dn25) ? <Banner tone="info" title="25 mm hose" body={`${dn25.reason} ${dn25.whatToDo}`} /> : null}

      <Divider />

      <H2>Readings</H2>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field
            label="Flow at nozzle"
            value={flowText}
            onChangeText={setFlowText}
            keyboardType="decimal-pad"
            suffix="L/min"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Pressure at reel inlet"
            value={pressureText}
            onChangeText={setPressureText}
            keyboardType="decimal-pad"
            suffix="kPa"
          />
        </View>
      </Rowed>
      <Txt size="xs" tone="faint">Hose run out, water flowing, gauge at reel inlet.</Txt>

      {!entered ? (
        <Txt size="sm" tone="muted">Enter the duty and your readings.</Txt>
      ) : isRefused(result) ? (
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
              label="Measured flow (L/s)"
              value={String(result.measuredFlowLitresPerSecond)}
              unit="L/s"
              tone={result.flow.verdict === 'fail' ? 'fail' : 'accent'}
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
            {check.required !== undefined ? ` against ${check.required} ${check.unit}` : ' · no duty entered'}
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
  // The Queensland date, not the UTC one. toISOString() is UTC, and Queensland
  // runs ten hours ahead of it: from two in the afternoon until midnight the
  // UTC date is still yesterday, so a reel that came due today would read as
  // upcoming for the second half of every working day.
  const today = useMemo(() => qldIsoDay(new Date().toISOString()) ?? '', []);

  const spec = ACTIVITY_SPECS[activity];
  const entered = commissioned.trim().length > 0 || lastDone.trim().length > 0;
  const result = useMemo(
    () => nextDue({ activity, commissioned, lastDone, today }),
    [activity, commissioned, lastDone, today],
  );
  const other = activity === 'five-yearly' ? 'six-monthly' : 'five-yearly';

  return (
    <>
      <Segmented
        value={activity}
        onChange={setActivity}
        options={(Object.keys(ACTIVITY_SPECS) as HoseReelActivity[])
          .sort((a, b) => ACTIVITY_SPECS[a].intervalMonths - ACTIVITY_SPECS[b].intervalMonths)
          .map((a) => ({ value: a, label: ACTIVITY_LABEL[a] }))}
      />

      <Card style={{ gap: t.space(1.5) }}>
        <Label>{spec.label}</Label>
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
        hint="From the reel tag. Month or year is fine."
      />
      <Field
        label={`Last ${spec.label.toLowerCase()}`}
        value={lastDone}
        onChangeText={setLastDone}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
        hint={`This routine only, not the ${other}.`}
      />

      {!entered ? (
        <Txt size="sm" tone="muted">Enter the commissioning date or the last service.</Txt>
      ) : isRefused(result) ? (
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
        <Txt size="sm" weight="700" style={{ flex: 1 }}>{"Can't calculate"}</Txt>
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

/** Each source on one line, and the line opens it. */
function SourceList({ ids }: { ids: SourceId[] }) {
  const t = useTheme();
  const sources = citeSources(ids);
  if (!sources.length) return null;
  return (
    <Card style={{ gap: t.space(0.5) }}>
      <Label>Sources</Label>
      {sources.map((s) => (
        <Pressable
          key={s.id}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(s.url).catch(() => undefined)}
          hitSlop={6}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Rowed gap={2}>
            <Txt size="sm" tone="accent" style={{ flex: 1, lineHeight: 19 }}>{s.ref}</Txt>
            <MaterialCommunityIcons name="open-in-new" size={16} color={t.color.accentText} />
          </Rowed>
        </Pressable>
      ))}
      {ids.includes('as1851') ? <Txt size="xs" tone="faint">{AS1851_SECTION_NOT_ESTABLISHED}</Txt> : null}
    </Card>
  );
}
