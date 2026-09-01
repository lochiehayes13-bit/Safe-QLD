import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DOOR_TYPES,
  FRL_ELEMENTS,
  GAP_LIMITS,
  SIGN_MIN_LETTER_HEIGHT_MM,
  SLIDING_FACE_ANY_POINT_MAX_MM,
  SOURCES,
  TAG_PARTICULARS,
  TAG_REQUIRED_FROM,
  TAG_REQUIRED_FROM_SUPERSEDED,
  UNSOURCED_GAPS,
  assessDoor,
  checkGap,
  citeSources,
  explainFrl,
  formatAuDate,
  latchingApplies,
  parseFrl,
  requiredSignWording,
  tagRequirement,
  type Confidence,
  type DoorOutcome,
  type DoorType,
  type FloorCovering,
  type FrameType,
  type GapPosition,
  type LeafAction,
  type ReleasePosition,
  type SealState,
  type SourceId,
  type TagState,
} from '@/domain/fireDoor';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Fire and smoke doors on site.
 *
 * A technician standing at a door in a stairwell has four questions and they
 * come in this order: what does the tag actually say, does this gap pass, did
 * it close and latch, and what do I write down. Each has a tab, and every
 * figure on this screen shows the clause it came from and how much that source
 * is worth — because the wrong answer here is not a wrong number, it is a
 * confident number with nothing behind it.
 *
 * The screen leans hard on the module's refusals rather than hiding them. Three
 * clearances have no sourced figure at all, and where you land on one this
 * screen says so in the same place it would otherwise have shown a verdict.
 */

type Mode = 'frl' | 'inspect' | 'gaps' | 'reference';

export default function FireDoorScreen() {
  const [mode, setMode] = useState<Mode>('frl');

  return (
    <>
      <Stack.Screen options={{ title: 'Fire and smoke doors' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'frl', label: 'FRL' },
            { value: 'inspect', label: 'Inspect' },
            { value: 'gaps', label: 'Gaps' },
            { value: 'reference', label: 'Reference' },
          ]}
        />
        {mode === 'frl' ? <FrlView /> : null}
        {mode === 'inspect' ? <InspectView /> : null}
        {mode === 'gaps' ? <GapView /> : null}
        {mode === 'reference' ? <ReferenceView /> : null}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const CONFIDENCE_TONE: Record<Confidence, 'pass' | 'warn' | 'fail'> = {
  high: 'pass',
  medium: 'warn',
  low: 'fail',
};

/** Every figure on this screen is shown with where it came from and what that is worth. */
function SourceList({ ids, title = 'Sources' }: { ids: SourceId[]; title?: string }) {
  const t = useTheme();
  const sources = citeSources(ids);
  if (sources.length === 0) return null;
  return (
    <Card>
      <Label>{title}</Label>
      <View style={{ gap: t.space(3), marginTop: t.space(2) }}>
        {sources.map((s) => (
          <View key={s.id} style={{ gap: 4 }}>
            <Rowed gap={2} wrap>
              <Chip label={s.confidence} tone={CONFIDENCE_TONE[s.confidence]} />
              <Txt size="sm" weight="700" style={{ flex: 1 }}>{s.ref}</Txt>
            </Rowed>
            <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{s.what}.</Txt>
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{s.basis}</Txt>
            <Txt size="xs" tone="accent" mono>{s.url}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

function YesNo({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: 'yes' | 'no' | 'unknown';
  onChange: (v: 'yes' | 'no' | 'unknown') => void;
  hint?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space(1.5) }}>
      <Label>{label}</Label>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'unknown', label: 'Not tested' },
        ]}
      />
      {hint ? <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{hint}</Txt> : null}
    </View>
  );
}

const asBool = (v: 'yes' | 'no' | 'unknown'): boolean | undefined =>
  v === 'unknown' ? undefined : v === 'yes';

/** "2, 2.5, 3" typed on a phone with one thumb, into millimetres. */
function readMeasurements(text: string): number[] {
  return text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => Number(p));
}

// ---------------------------------------------------------------------------
// FRL
// ---------------------------------------------------------------------------

function FrlView() {
  const t = useTheme();
  const [text, setText] = useState('');
  const [schedule, setSchedule] = useState('');

  const result = useMemo(() => parseFrl(text), [text]);
  const entered = text.trim().length > 0;

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Read it off the tag on the hinge stile of the leaf, not off the register. Three grading periods in a fixed
        order, and the order is the part people get wrong.
      </Txt>

      <Field
        label="FRL on the tag"
        value={text}
        onChangeText={setText}
        placeholder="-/60/30"
        autoCapitalize="characters"
        hint="A leading FRL, spare spaces and a backslash are all read; anything else is refused rather than repaired."
      />

      {!entered ? (
        <EmptyState
          title="Type what the tag says"
          body="Exactly what is stamped on it. Nothing here is inferred from a blank, and a two-element shorthand is not accepted as an FRL."
        />
      ) : result.ok ? (
        <>
          <ResultBlock
            label="Fire resistance level"
            value={result.normalised}
            tone="accent"
            detail={`Read with ${result.confidence} confidence.`}
          />

          <Card>
            <Label>What each position means</Label>
            <View style={{ gap: t.space(3), marginTop: t.space(2) }}>
              {explainFrl(result.frl).map((line) => (
                <View key={line.element} style={{ gap: 3 }}>
                  <Rowed gap={2}>
                    <Chip
                      label={`Position ${line.position}`}
                      tone={line.minutes === undefined ? 'muted' : 'accent'}
                    />
                    <Txt size="sm" weight="700" style={{ flex: 1 }}>
                      {line.label}
                      {line.minutes === undefined ? ' — no requirement' : ` — ${line.minutes} min`}
                    </Txt>
                  </Rowed>
                  <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{line.text}</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                    {FRL_ELEMENTS[line.position - 1]!.failureLooksLike}
                  </Txt>
                </View>
              ))}
            </View>
          </Card>

          {result.notes.map((n) => (
            <Banner key={n} tone="warn" title="Worth a second look" body={n} />
          ))}
        </>
      ) : (
        <>
          <Banner tone="fail" title="Not read" body={result.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" style={{ marginTop: 6, lineHeight: 19 }}>{result.whatToDo}</Txt>
          </Card>
          {result.candidates.length > 0 ? (
            <Card>
              <Label>Plausible, unproven</Label>
              <Txt size="xs" tone="faint" style={{ marginTop: 6, lineHeight: 17 }}>
                Shown so you know what to check for. This is not the answer and must not go on a schedule as one.
              </Txt>
              <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
                {result.candidates.map((c) => (
                  <View key={c.normalised} style={{ gap: 3 }}>
                    <Txt size="lg" weight="700" mono tone="warn">{c.normalised}</Txt>
                    <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{c.reading}</Txt>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      )}

      <H2>Against the schedule</H2>
      <Field
        label="FRL on the register"
        value={schedule}
        onChangeText={setSchedule}
        placeholder="-/60/30"
        autoCapitalize="characters"
        hint="Optional. A tag that disagrees with the register is either a wrong record or a changed door."
      />
      {entered && schedule.trim() ? <ScheduleComparison tag={text} schedule={schedule} /> : null}

      <SourceList ids={result.sourceIds} />
    </>
  );
}

function ScheduleComparison({ tag, schedule }: { tag: string; schedule: string }) {
  const a = useMemo(() => {
    // Imported lazily through the module's own comparator so the screen never
    // implements its own idea of when two FRLs agree.
    const { compareFrl } = require('@/domain/fireDoor') as typeof import('@/domain/fireDoor');
    return compareFrl(tag, schedule);
  }, [tag, schedule]);
  const tone = a.result === 'match' ? 'pass' : a.result === 'differs' ? 'fail' : 'warn';
  const title = a.result === 'match' ? 'Tag and schedule agree'
    : a.result === 'differs' ? 'Tag and schedule disagree'
      : 'Cannot be compared';
  return <Banner tone={tone} title={title} body={a.statement} />;
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

const OUTCOME_TONE: Record<DoorOutcome, 'pass' | 'warn' | 'fail'> = {
  pass: 'pass',
  fail: 'fail',
  // Both of these are warnings and neither is a failure. An unverified door
  // must not look like a defective one, or a technician raises a defect against
  // a door that works; it must not look like a pass either.
  unverifiable: 'warn',
  'not-assessed': 'warn',
};

const OUTCOME_LABEL: Record<DoorOutcome, string> = {
  pass: 'Pass',
  fail: 'Fail',
  unverifiable: 'Unverified',
  'not-assessed': 'Not assessed',
};

const CHECK_TONE = {
  pass: 'pass',
  fail: 'fail',
  'no-verdict': 'warn',
  'not-applicable': 'muted',
} as const;

const RELEASE_LABEL: Record<ReleasePosition, string> = {
  'fully-open': 'Fully open',
  intermediate: 'Part open',
  'small-opening': 'Just off the stop',
};

function InspectView() {
  const t = useTheme();
  const [doorType, setDoorType] = useState<DoorType>('fire');
  const [leafAction, setLeafAction] = useState<LeafAction>('side-hung');
  const [released, setReleased] = useState<ReleasePosition[]>([]);
  const [closedFully, setClosedFully] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [latched, setLatched] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [heldOpen, setHeldOpen] = useState<'none' | 'wedge' | 'approved-device'>('none');
  const [holdOpenReleased, setHoldOpenReleased] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [seals, setSeals] = useState<SealState>('not-checked');
  const [tagState, setTagState] = useState<TagState>('present');
  const [frameTagState, setFrameTagState] = useState<TagState>('present');
  const [tagFrl, setTagFrl] = useState('');
  const [scheduleFrl, setScheduleFrl] = useState('');
  const [approvedOn, setApprovedOn] = useState('');

  const profile = DOOR_TYPES[doorType];
  const latching = latchingApplies(doorType, leafAction);

  const toggleRelease = (p: ReleasePosition) =>
    setReleased((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const verdict = useMemo(
    () =>
      assessDoor({
        assetId: 'this door',
        doorType,
        leafAction,
        frame: 'rebated',
        scheduleFrl: scheduleFrl.trim() || undefined,
        closing: {
          doorType,
          leafAction,
          releasedFrom: released,
          closedFully: asBool(closedFully),
          latched: latching.applies ? asBool(latched) : undefined,
          heldOpenBy: heldOpen === 'none' ? 'none' : heldOpen,
          holdOpenReleasedOnAlarm: heldOpen === 'approved-device' ? asBool(holdOpenReleased) : undefined,
        },
        smokeSeals: profile.needsSmokeSeals ? seals : undefined,
        tag: profile.hasTag
          ? {
            leaf: {
              state: tagState,
              particulars: tagState === 'present' ? { frl: tagFrl.trim() || undefined } : undefined,
            },
            frame: { state: frameTagState },
            scheduleFrl: scheduleFrl.trim() || undefined,
            buildingApprovedOn: approvedOn.trim() || undefined,
          }
          : undefined,
      }),
    [
      doorType, leafAction, released, closedFully, latched, heldOpen, holdOpenReleased,
      seals, tagState, frameTagState, tagFrl, scheduleFrl, approvedOn, latching.applies,
      profile.hasTag, profile.needsSmokeSeals,
    ],
  );

  return (
    <>
      <Segmented
        value={doorType}
        onChange={setDoorType}
        options={[
          { value: 'fire', label: 'Fire' },
          { value: 'smoke', label: 'Smoke' },
          { value: 'fire-and-smoke', label: 'Both' },
        ]}
      />
      <Segmented
        value={leafAction}
        onChange={setLeafAction}
        options={[
          { value: 'side-hung', label: 'Side hung' },
          { value: 'double-acting', label: 'Double acting' },
          { value: 'sliding', label: 'Sliding' },
        ]}
      />

      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{profile.purpose}</Txt>

      <Banner
        tone={latching.isFailure ? 'warn' : 'info'}
        title={latching.applies
          ? latching.isFailure ? 'Latching is a failure here, not an observation' : 'Latching is not a defect here'
          : 'This leaf has no latch to test'}
        body={latching.reason}
      />

      <H2>Closing</H2>
      <Label>Released from</Label>
      <Rowed gap={2} wrap>
        {(['fully-open', 'intermediate', 'small-opening'] as ReleasePosition[]).map((p) => (
          <Chip
            key={p}
            label={RELEASE_LABEL[p]}
            tone={released.includes(p) ? 'accent' : 'muted'}
            selected={released.includes(p)}
            onPress={() => toggleRelease(p)}
          />
        ))}
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        A closer with a weak final snap shuts a door from wide open on momentum and leaves it short from part open,
        which is where a door is actually let go of. One position is not the check.
      </Txt>

      <YesNo label="Came fully to the closed position" value={closedFully} onChange={setClosedFully} />
      {latching.applies ? (
        <YesNo
          label="Latch engaged"
          value={latched}
          onChange={setLatched}
          hint="Push the closed leaf. If it moves off the stop, it has not latched."
        />
      ) : null}

      <Label>Found held open by</Label>
      <Segmented
        value={heldOpen}
        onChange={setHeldOpen}
        options={[
          { value: 'none', label: 'Nothing' },
          { value: 'approved-device', label: 'Hold-open device' },
          { value: 'wedge', label: 'Wedge or chock' },
        ]}
      />
      {heldOpen === 'approved-device' ? (
        <YesNo label="Released on alarm" value={holdOpenReleased} onChange={setHoldOpenReleased} />
      ) : null}

      {profile.needsSmokeSeals ? (
        <>
          <H2>Smoke seals</H2>
          <Segmented
            value={seals}
            onChange={setSeals}
            options={[
              { value: 'intact', label: 'Intact' },
              { value: 'damaged', label: 'Damaged' },
              { value: 'missing', label: 'Missing' },
              { value: 'not-checked', label: 'Not checked' },
            ]}
          />
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Continuous, in contact along their length, not painted, not worn flat. A seal that is not touching is not
            a seal, and this is the check a walk-past always passes.
          </Txt>
        </>
      ) : null}

      {profile.hasTag ? (
        <>
          <H2>Identification</H2>
          <Label>Tag on the leaf</Label>
          <Segmented
            value={tagState}
            onChange={setTagState}
            options={[
              { value: 'present', label: 'Readable' },
              { value: 'illegible', label: 'Illegible' },
              { value: 'missing', label: 'Missing' },
            ]}
          />
          <Label>Matching tag on the frame</Label>
          <Segmented
            value={frameTagState}
            onChange={setFrameTagState}
            options={[
              { value: 'present', label: 'Readable' },
              { value: 'illegible', label: 'Illegible' },
              { value: 'missing', label: 'Missing' },
            ]}
          />
          {tagState === 'present' ? (
            <Field
              label="FRL on the tag"
              value={tagFrl}
              onChangeText={setTagFrl}
              placeholder="-/60/30"
              autoCapitalize="characters"
            />
          ) : null}
          <Field
            label="FRL on the register"
            value={scheduleFrl}
            onChangeText={setScheduleFrl}
            placeholder="-/60/30"
            autoCapitalize="characters"
          />
          <Field
            label="Building approved"
            value={approvedOn}
            onChangeText={setApprovedOn}
            placeholder="d/m/yyyy"
            autoCapitalize="none"
            hint="Decides whether a tag was required at all. Left blank, this app will not assume a modern building."
          />
        </>
      ) : null}

      <H2>Verdict</H2>
      <ResultBlock
        label="This door"
        value={OUTCOME_LABEL[verdict.outcome]}
        tone={OUTCOME_TONE[verdict.outcome]}
        detail={verdict.statement}
      />
      {verdict.reason ? (
        <Banner
          tone="warn"
          title={verdict.outcome === 'unverifiable' ? 'Not a pass' : 'No result'}
          body={verdict.reason}
        />
      ) : null}

      <Rowed gap={2}>
        <StatTile label="Failed" value={verdict.failedChecks.length} tone={verdict.failedChecks.length ? 'fail' : 'default'} />
        <StatTile
          label="No result"
          value={verdict.checksWithoutVerdict.length}
          tone={verdict.checksWithoutVerdict.length ? 'warn' : 'default'}
        />
        <StatTile
          label="Identified"
          value={verdict.identified === undefined ? 'n/a' : verdict.identified ? 'Yes' : 'No'}
          tone={verdict.identified === false ? 'warn' : 'default'}
        />
      </Rowed>

      <Card>
        <Label>Checks</Label>
        <View style={{ gap: t.space(3), marginTop: t.space(2) }}>
          {verdict.checks.map((c) => (
            <View key={c.id} style={{ gap: 4 }}>
              <Rowed gap={2} wrap>
                <Chip label={c.result.replace('-', ' ')} tone={CHECK_TONE[c.result]} />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>{c.label}</Txt>
                {c.defectCode ? <Chip label={c.defectCode} tone="fail" /> : null}
              </Rowed>
              <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{c.statement}</Txt>
              {c.meaning ? <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{c.meaning}</Txt> : null}
            </View>
          ))}
        </View>
      </Card>

      {verdict.notes.length > 0 ? (
        <Card>
          <Label>Notes</Label>
          <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
            {verdict.notes.map((n) => (
              <Txt key={n} size="xs" tone="faint" style={{ lineHeight: 17 }}>{n}</Txt>
            ))}
          </View>
        </Card>
      ) : null}

      <SourceList ids={verdict.sourceIds} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

const POSITION_LABEL: Record<GapPosition, string> = {
  head: 'Head',
  stile: 'Stile',
  'meeting-stile': 'Meeting stile',
  floor: 'Floor',
  'sliding-face': 'Sliding face',
  'sliding-overlap': 'Sliding overlap',
};

function GapView() {
  const t = useTheme();
  const [position, setPosition] = useState<GapPosition>('stile');
  const [doorType, setDoorType] = useState<DoorType>('fire');
  const [leafAction, setLeafAction] = useState<LeafAction>('side-hung');
  const [frame, setFrame] = useState<FrameType>('rebated');
  const [covering, setCovering] = useState<FloorCovering>('unknown');
  const [text, setText] = useState('');

  const readings = useMemo(() => readMeasurements(text), [text]);
  const result = useMemo(
    () => checkGap({
      position,
      readingsMm: readings,
      doorType,
      leafAction,
      frame,
      floorCovering: covering,
      meetingStile: position === 'meeting-stile',
    }),
    [position, readings, doorType, leafAction, frame, covering],
  );

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        “Three around and ten under” is right for exactly one configuration. This makes you say which one you are in,
        and refuses where no figure can be sourced for it.
      </Txt>

      <Label>Where</Label>
      <Rowed gap={2} wrap>
        {(Object.keys(POSITION_LABEL) as GapPosition[]).map((p) => (
          <Chip
            key={p}
            label={POSITION_LABEL[p]}
            tone={position === p ? 'accent' : 'muted'}
            selected={position === p}
            onPress={() => setPosition(p)}
          />
        ))}
      </Rowed>

      <Segmented
        value={doorType}
        onChange={setDoorType}
        options={[
          { value: 'fire', label: 'Fire' },
          { value: 'smoke', label: 'Smoke' },
          { value: 'fire-and-smoke', label: 'Both' },
        ]}
      />
      <Segmented
        value={leafAction}
        onChange={setLeafAction}
        options={[
          { value: 'side-hung', label: 'Side hung' },
          { value: 'double-acting', label: 'Double acting' },
          { value: 'sliding', label: 'Sliding' },
        ]}
      />

      {position === 'head' || position === 'stile' ? (
        <>
          <Label>Frame</Label>
          <Segmented
            value={frame}
            onChange={setFrame}
            options={[
              { value: 'rebated', label: 'Rebated' },
              { value: 'not-rebated', label: 'Not rebated' },
              { value: 'unknown', label: 'Not looked' },
            ]}
          />
        </>
      ) : null}

      {position === 'floor' ? (
        <>
          <Label>Under the leaf</Label>
          <Segmented
            value={covering}
            onChange={setCovering}
            options={[
              { value: 'none', label: 'Bare sill' },
              { value: 'combustible', label: 'Carpet' },
              { value: 'carpet-pending', label: 'Carpet to come' },
              { value: 'unknown', label: 'Not looked' },
            ]}
          />
        </>
      ) : null}

      <Field
        label="Readings"
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        suffix="mm"
        placeholder="2, 2.5, 3"
        hint="Every reading along that edge, separated by commas. A mean cannot be taken from one."
      />

      {readings.length === 0 ? (
        <EmptyState
          title="Enter the measurements"
          body="All of them. The limits that apply here are written against a mean, not against the worst point you found."
        />
      ) : result.known ? (
        <>
          <ResultBlock
            label={result.limit.basis === 'minimum' ? 'Least overlap' : result.limit.basis === 'mean' ? 'Mean' : 'Worst point'}
            value={String(result.valueMm)}
            unit="mm"
            tone={result.within ? 'pass' : 'fail'}
            detail={result.statement}
          />
          <Card>
            <Rowed gap={2} wrap>
              <Chip label={result.within ? 'Within' : 'Outside'} tone={result.within ? 'pass' : 'fail'} />
              <Chip label={result.confidence} tone={CONFIDENCE_TONE[result.confidence]} />
              {result.defectCode ? <Chip label={result.defectCode} tone="fail" /> : null}
            </Rowed>
            <Txt size="sm" weight="700" style={{ marginTop: t.space(2) }}>{result.limit.label}</Txt>
            <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{result.limit.measuredAt}</Txt>
            <Txt size="xs" tone="accent" style={{ marginTop: 4 }}>{result.limit.clause}</Txt>
            {result.limit.note ? (
              <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>{result.limit.note}</Txt>
            ) : null}
            <Divider />
            <Txt size="xs" tone="faint">
              {result.readingsMm.length} reading{result.readingsMm.length === 1 ? '' : 's'}, worst {result.worstMm} mm.
            </Txt>
          </Card>
          {result.notes.map((n) => (
            <Txt key={n} size="xs" tone="faint" style={{ lineHeight: 17 }}>{n}</Txt>
          ))}
          <SourceList ids={result.sourceIds} />
        </>
      ) : (
        <>
          <Banner tone="warn" title="No limit this app can source" body={result.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" style={{ marginTop: 6, lineHeight: 19 }}>{result.whatToDo}</Txt>
            <Divider />
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Record the measurement anyway. It is evidence even without a limit to hold it to, and it is what the
              certifier will ask for.
            </Txt>
          </Card>
          <SourceList ids={result.sourceIds} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------

function ReferenceView() {
  const t = useTheme();
  const [approvedOn, setApprovedOn] = useState('');
  const requirement = useMemo(
    () => tagRequirement({ buildingApprovedOn: approvedOn.trim() || undefined }),
    [approvedOn],
  );
  const sign = requiredSignWording({ era: 'current', heldOpenByDevice: false });

  return (
    <>
      <H2>What the tag has to establish</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        A doorset without a readable tag may be working perfectly and still cannot be proved to be the door the
        schedule describes. Each particular closes off a different way that can go wrong.
      </Txt>
      <Card>
        <View style={{ gap: t.space(3) }}>
          {TAG_PARTICULARS.map((p) => (
            <View key={p.key} style={{ gap: 3 }}>
              <Rowed gap={2}>
                <MaterialCommunityIcons name="tag-outline" size={16} color={t.color.textMuted} />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>{p.label}</Txt>
              </Rowed>
              <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{p.establishes}</Txt>
            </View>
          ))}
        </View>
      </Card>

      <H2>Was a tag required at all</H2>
      <Field
        label="Building approved"
        value={approvedOn}
        onChangeText={setApprovedOn}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
      />
      <Banner
        tone={requirement.required === true ? 'info' : requirement.required === false ? 'pass' : 'warn'}
        title={requirement.required === true ? 'Tags required'
          : requirement.required === false ? 'Tags not required at approval' : 'Cannot be answered'}
        body={requirement.whatToDo ? `${requirement.reason} ${requirement.whatToDo}` : requirement.reason}
      />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Queensland publishes this date two ways. The current Queensland Fire Department information sheet gives{' '}
        {formatAuDate(TAG_REQUIRED_FROM)}; the superseded 2012 QFRS fire door FAQ gives{' '}
        {formatAuDate(TAG_REQUIRED_FROM_SUPERSEDED)}. For an approval between them this app refuses rather than
        choosing between two Crown publications.
      </Txt>

      <H2>Door types</H2>
      {(Object.values(DOOR_TYPES)).map((profile) => (
        <Card key={profile.id}>
          <Txt size="sm" weight="700">{profile.label}</Txt>
          <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{profile.purpose}</Txt>
          <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
            <Chip label={profile.hasFrl ? 'Has an FRL' : 'No FRL'} tone={profile.hasFrl ? 'accent' : 'muted'} />
            <Chip label={profile.hasTag ? 'Tagged' : 'No tag'} tone={profile.hasTag ? 'accent' : 'muted'} />
            <Chip
              label={profile.needsSmokeSeals ? 'Smoke seals' : 'No seals required'}
              tone={profile.needsSmokeSeals ? 'accent' : 'muted'}
            />
          </Rowed>
          <Divider />
          <Label>Fails on</Label>
          <View style={{ gap: 4, marginTop: 6 }}>
            {profile.failsOn.map((f) => (
              <Txt key={f} size="xs" tone="muted" style={{ lineHeight: 17 }}>• {f}</Txt>
            ))}
          </View>
        </Card>
      ))}

      <H2>Sourced clearances</H2>
      <Card>
        <View style={{ gap: t.space(3) }}>
          {GAP_LIMITS.map((limit) => (
            <View key={limit.position} style={{ gap: 3 }}>
              <Rowed gap={2} wrap>
                <Chip label={limit.confidence} tone={CONFIDENCE_TONE[limit.confidence]} />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>{limit.label}</Txt>
              </Rowed>
              <Txt size="sm" mono tone="accent">
                {limit.minMm !== undefined && limit.maxMm !== undefined
                  ? `${limit.minMm}–${limit.maxMm} mm`
                  : limit.minMm !== undefined
                    ? `not less than ${limit.minMm} mm`
                    : `not more than ${limit.maxMm} mm`}
                {limit.basis === 'mean' ? ' (mean)' : limit.basis === 'minimum' ? ' (minimum)' : ' (any point)'}
              </Txt>
              <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>{limit.measuredAt}</Txt>
              <Txt size="xs" tone="faint">{limit.clause}</Txt>
            </View>
          ))}
          <Divider />
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            A sliding face clearance also has a {SLIDING_FACE_ANY_POINT_MAX_MM} mm ceiling at any single point, and a
            required sign is in capital letters at least {SIGN_MIN_LETTER_HEIGHT_MM} mm high contrasting with its
            background{'known' in sign ? '' : ` — currently “${sign.wording.replace(/\n/g, ' / ')}” under ${sign.clause}`}.
          </Txt>
        </View>
      </Card>

      <H2>Where this app has no figure</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Every one of these has a number that circulates on site. None of them has a number that can be sourced, and a
        clearance in a report is a figure a client spends money against.
      </Txt>
      {Object.entries(UNSOURCED_GAPS).map(([key, gap]) => (
        <Card key={key}>
          <Rowed gap={2}>
            <MaterialCommunityIcons name="help-circle-outline" size={16} color={t.color.warn} />
            <Txt size="sm" weight="700" style={{ flex: 1 }}>{gap.what}</Txt>
          </Rowed>
          <Txt size="xs" tone="muted" style={{ marginTop: 6, lineHeight: 17 }}>{gap.why}</Txt>
          <Txt size="xs" tone="accent" style={{ marginTop: 6, lineHeight: 17 }}>{gap.whatToDo}</Txt>
        </Card>
      ))}

      <H2>Everything this screen relies on</H2>
      <SourceList ids={Object.keys(SOURCES) as SourceId[]} title="Sources, with what each is worth" />
    </>
  );
}
