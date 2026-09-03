import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  BATTERY_DESIGN_LIFE_YEARS,
  KNOWN_CLASSIFICATIONS,
  MINIMUM_DURATION_MINUTES,
  OUTCOME_LABEL,
  TABULATED_HEIGHTS_M,
  assessDischarge,
  batteryAdvice,
  batteryAge,
  checkSignPlacement,
  citeSources,
  classify,
  exitSignViewingDistance,
  formatAuDate,
  spacingSenseCheck,
  type DischargeOutcome,
  type FittingRole,
  type OperatingMode,
  type SignIllumination,
  type SourceId,
  type SpacingEdition,
  type SupplyType,
  type TestEnding,
} from '@/domain/emergencyLighting';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Emergency lighting on site.
 *
 * A third of the assets Safe QLD services are these fittings, and the questions
 * a technician has at the top of the ladder are always the same four: did this
 * one pass, is that sign close enough to be read, is the battery old enough to
 * explain what I just saw, and is there anything like enough light in this
 * room. Each has its own tab, and each shows where its numbers came from — the
 * point of this screen is that no figure appears on it without its source and
 * how much that source is worth.
 */

type Mode = 'discharge' | 'sign' | 'battery' | 'spacing';

export default function EmergencyLightingScreen() {
  const [mode, setMode] = useState<Mode>('discharge');

  return (
    <>
      <Stack.Screen options={{ title: 'Emergency lighting' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'discharge', label: 'Discharge' },
            { value: 'sign', label: 'Exit sign' },
            { value: 'battery', label: 'Battery' },
            { value: 'spacing', label: 'Spacing' },
          ]}
        />
        {mode === 'discharge' ? <DischargeView /> : null}
        {mode === 'sign' ? <SignView /> : null}
        {mode === 'battery' ? <BatteryView /> : null}
        {mode === 'spacing' ? <SpacingView /> : null}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
// Discharge test
// ---------------------------------------------------------------------------

/**
 * The tone each outcome is drawn in.
 *
 * Both "no verdict" outcomes are warnings rather than failures on purpose. A
 * test that was never finished must not look like a failed fitting, or the
 * technician will raise a defect; it must not look like a pass either, or the
 * fitting will be signed off untested.
 */
const OUTCOME_TONE: Record<DischargeOutcome, 'pass' | 'warn' | 'fail'> = {
  pass: 'pass',
  'marginal-pass': 'warn',
  'failed-early': 'fail',
  'no-illumination': 'fail',
  inconclusive: 'warn',
  unreadable: 'warn',
};

function DischargeView() {
  const t = useTheme();
  const [achieved, setAchieved] = useState('');
  const [ending, setEnding] = useState<TestEnding>('extinguished');
  const [rated, setRated] = useState('');
  const [installedOn, setInstalledOn] = useState('');
  const [supply, setSupply] = useState<SupplyType>('single-point');
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('non-sustained');
  const [role, setRole] = useState<FittingRole>('emergency-luminaire');

  const entered = achieved.trim().length > 0 || ending === 'never-lit';

  const verdict = useMemo(
    () =>
      assessDischarge({
        achievedMinutes: ending === 'never-lit' ? 0 : Number(achieved.trim()),
        ending,
        ratedMinutes: rated.trim() ? Number(rated.trim()) : undefined,
      }),
    [achieved, ending, rated],
  );

  const age = useMemo(
    () => (installedOn.trim() ? batteryAge({ installedOn, at: new Date() }) : undefined),
    [installedOn],
  );
  const advice = useMemo(() => batteryAdvice(verdict, age), [verdict, age]);
  const profile = useMemo(
    () => classify({ supply, mode: operatingMode, role }),
    [supply, operatingMode, role],
  );

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Remove normal supply, time how long the fitting stays lit, and record how the test ended. How it ended is what
        separates a pass from a test that was simply stopped.
      </Txt>

      <Segmented
        value={ending}
        onChange={setEnding}
        options={[
          { value: 'extinguished', label: 'Went out' },
          { value: 'still-lit', label: 'Still lit' },
          { value: 'never-lit', label: 'Never lit' },
        ]}
      />

      {ending !== 'never-lit' ? (
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field
              label={ending === 'extinguished' ? 'Illuminated for' : 'Test ended at'}
              value={achieved}
              onChangeText={setAchieved}
              keyboardType="decimal-pad"
              suffix="min"
              placeholder="90"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Rated duration"
              value={rated}
              onChangeText={setRated}
              keyboardType="numeric"
              suffix="min"
              placeholder={String(MINIMUM_DURATION_MINUTES)}
              hint="Off the fitting, if it says"
            />
          </View>
        </Rowed>
      ) : (
        <Banner
          tone="info"
          title="Confirm the supply was actually removed"
          body="Half the fittings recorded as never illuminating turn out to have been on a circuit that was never isolated. Check that before this becomes a defect."
        />
      )}

      {!entered ? (
        <EmptyState
          title="Enter the result"
          body="Minutes illuminated and how the test ended. Nothing is assumed from a blank."
        />
      ) : (
        <>
          <ResultBlock
            label="Verdict"
            value={OUTCOME_LABEL[verdict.outcome]}
            tone={OUTCOME_TONE[verdict.outcome]}
            detail={verdict.statement}
          />

          <Rowed gap={2}>
            <StatTile label="Required" value={`${verdict.requiredMinutes} min`} />
            <StatTile
              label="Achieved"
              value={verdict.achievedMinutes !== undefined ? `${verdict.achievedMinutes} min` : '—'}
            />
            <StatTile
              label="Of required"
              value={verdict.percentOfRequired !== undefined ? `${verdict.percentOfRequired}%` : '—'}
              tone={verdict.passed === false ? 'fail' : 'default'}
            />
          </Rowed>

          {verdict.reason ? <Banner tone="warn" title="No verdict" body={verdict.reason} /> : null}

          {!verdict.requiredFromRating && verdict.outcome !== 'unreadable' ? (
            <Banner
              tone="info"
              title={`Held to the ${MINIMUM_DURATION_MINUTES}-minute code minimum`}
              body="Either no rated duration was entered, or one below the code minimum was — a rating cannot lower what a fitting has to achieve. A fail against this is a fail on any rating; a pass only shows it met the floor."
            />
          ) : null}

          {verdict.defectCode ? (
            <Card>
              <Rowed gap={2}>
                <Chip label={verdict.defectCode} tone="fail" />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>Defect to raise</Txt>
              </Rowed>
              <Txt size="sm" tone="muted" style={{ marginTop: 6, lineHeight: 19 }}>{verdict.rectification}</Txt>
            </Card>
          ) : null}

          {verdict.notes.map((n) => (
            <Txt key={n} size="xs" tone="faint" style={{ lineHeight: 17 }}>{n}</Txt>
          ))}
        </>
      )}

      <H2>Battery</H2>
      <Field
        label="Battery installed"
        value={installedOn}
        onChangeText={setInstalledOn}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
        hint="Optional. Age changes what the test result means, and what to do about it."
      />
      {age && !age.known ? <Banner tone="warn" title="Date not read" body={`${age.reason} ${age.whatToDo}`} /> : null}
      {age?.known ? (
        <Card>
          <Txt size="sm" weight="600">{age.statement}</Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>{age.caveat}</Txt>
        </Card>
      ) : null}
      {entered ? (
        <Card>
          <Label>What to do</Label>
          <Txt size="sm" weight="700" style={{ marginTop: 4 }}>{advice.statement}</Txt>
          <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{advice.reasoning}</Txt>
        </Card>
      ) : null}

      <H2>What kind of fitting</H2>
      <Segmented
        value={supply}
        onChange={setSupply}
        options={[
          { value: 'single-point', label: 'Single point' },
          { value: 'centrally-supplied', label: 'Central' },
        ]}
      />
      <Segmented
        value={operatingMode}
        onChange={setOperatingMode}
        options={[
          { value: 'non-sustained', label: 'Non-sustained' },
          { value: 'sustained', label: 'Sustained' },
        ]}
      />
      <Segmented
        value={role}
        onChange={setRole}
        options={[
          { value: 'emergency-luminaire', label: 'Light' },
          { value: 'exit-sign', label: 'Sign' },
          { value: 'combined', label: 'Combined' },
        ]}
      />

      <Card>
        <Txt size="sm" weight="700">{profile.label}</Txt>
        <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
          <Chip
            label={profile.visibleFailureOnNormalSupply ? 'Failure visible on a walk-through' : 'Dark until the supply fails'}
            tone={profile.visibleFailureOnNormalSupply ? 'pass' : 'warn'}
          />
          {profile.commonModeFailureRisk ? <Chip label="One fault can be many fittings" tone="warn" /> : null}
        </Rowed>
        <Divider />
        <Label>Isolate at</Label>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{profile.isolationPoint}</Txt>
        <Divider />
        <Label>What is tested</Label>
        {profile.whatIsTested.map((line) => <Bullet key={line} text={line} />)}
        <Divider />
        <Label>How a failure is rectified</Label>
        {profile.howAFailureIsRectified.map((line) => <Bullet key={line} text={line} />)}
      </Card>
      {profile.cautions.map((c) => <Banner key={c} tone="warn" title="Watch this" body={c} />)}

      <SourceList ids={[...verdict.sourceIds, ...profile.sourceIds, ...(age?.known ? age.sourceIds : [])]} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Exit sign viewing distance
// ---------------------------------------------------------------------------

function SignView() {
  const t = useTheme();
  const [height, setHeight] = useState('150');
  const [illumination, setIllumination] = useState<SignIllumination>('internally-illuminated');
  const [distance, setDistance] = useState('');

  const sign = useMemo(
    () => exitSignViewingDistance({ pictogramHeightMm: Number(height.trim()), illumination }),
    [height, illumination],
  );
  const placement = useMemo(
    () => (sign.known && distance.trim() ? checkSignPlacement(Number(distance.trim()), sign) : undefined),
    [sign, distance],
  );

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Measure the green running-man element itself, top to bottom — not the housing and not the whole sign face.
        The answer comes off published bands, so a size between two of them reads as the smaller band rather than as a
        number in between.
      </Txt>

      <Segmented
        value={illumination}
        onChange={setIllumination}
        options={[
          { value: 'internally-illuminated', label: 'Internal' },
          { value: 'externally-illuminated', label: 'External' },
          { value: 'photoluminescent', label: 'Photolum.' },
        ]}
      />

      <Field
        label="Pictogram height"
        value={height}
        onChangeText={setHeight}
        keyboardType="numeric"
        suffix="mm"
        placeholder="150"
      />

      {!sign.known ? (
        <>
          <Banner tone="warn" title="This app will not answer that" body={sign.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{sign.whatToDo}</Txt>
          </Card>
          <SourceList ids={sign.sourceIds} />
        </>
      ) : (
        <>
          <ResultBlock
            label="Maximum viewing distance"
            value={String(sign.maxViewingDistanceM)}
            unit="m"
            tone={sign.sourcesAgree ? 'accent' : 'warn'}
            detail={
              sign.cappedBy
                ? sign.cappedBy
                : sign.sourcesAgree
                  ? 'Every publication consulted gives this figure for a pictorial element of this size.'
                  : 'The strictest of the readings below. A sign inside this is inside all of them.'
            }
          />

          <Card>
            <Label>Readings consulted</Label>
            {sign.candidates.map((c) => (
              <View key={`${c.sourceId}-${c.maxViewingDistanceM}`} style={{ paddingVertical: t.space(1.5) }}>
                <Rowed gap={2}>
                  <Txt size="md" weight="700" mono>{c.maxViewingDistanceM} m</Txt>
                  <Chip
                    label={`${c.confidence} confidence`}
                    tone={c.confidence === 'high' ? 'pass' : c.confidence === 'medium' ? 'accent' : 'warn'}
                  />
                </Rowed>
                <Txt size="xs" tone="muted" style={{ marginTop: 3, lineHeight: 17 }}>{c.reading}</Txt>
              </View>
            ))}
          </Card>

          <Field
            label="Furthest a person must read it from"
            value={distance}
            onChangeText={setDistance}
            keyboardType="decimal-pad"
            suffix="m"
            hint="Measured along the path of travel"
          />

          {placement && !placement.known ? (
            <Banner tone="warn" title="Not checked" body={`${placement.reason} ${placement.whatToDo}`} />
          ) : null}
          {placement?.known ? (
            <Banner
              tone={placement.verdict === 'within' ? 'pass' : placement.verdict === 'exceeds' ? 'fail' : 'warn'}
              title={
                placement.verdict === 'within'
                  ? 'Within the viewing distance'
                  : placement.verdict === 'exceeds'
                    ? 'Beyond the viewing distance'
                    : 'Cannot be called either way'
              }
              body={placement.reason ? `${placement.statement} ${placement.reason}` : placement.statement}
            />
          ) : null}

          <Card>
            <Label>What governs</Label>
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{sign.governing}</Txt>
          </Card>
          {sign.notes.map((n) => (
            <Txt key={n} size="xs" tone="faint" style={{ lineHeight: 17 }}>{n}</Txt>
          ))}
          <SourceList ids={sign.sourceIds} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Battery age
// ---------------------------------------------------------------------------

function BatteryView() {
  const [installedOn, setInstalledOn] = useState('');
  const [life, setLife] = useState('');

  const result = useMemo(
    () =>
      installedOn.trim()
        ? batteryAge({
            installedOn,
            at: new Date(),
            designLifeYears: life.trim() ? Number(life.trim()) : undefined,
          })
        : undefined,
    [installedOn, life],
  );

  return (
    <>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Dates are read d/m/yyyy. A date with the month first is rejected rather than guessed at.
      </Txt>

      <Field
        label="Battery installed"
        value={installedOn}
        onChangeText={setInstalledOn}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
      />
      <Field
        label="Design life"
        value={life}
        onChangeText={setLife}
        keyboardType="decimal-pad"
        suffix="years"
        placeholder={String(BATTERY_DESIGN_LIFE_YEARS)}
        hint="The manufacturer's own figure, where the datasheet gives one. Lithium iron phosphate packs are published well beyond four years."
      />

      {!result ? (
        <EmptyState title="Enter the install date" body="Off the fitting, the battery label, or the register." />
      ) : !result.known ? (
        <>
          <Banner tone="warn" title="Date not read" body={result.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{result.whatToDo}</Txt>
          </Card>
        </>
      ) : (
        <>
          <ResultBlock
            label="Age"
            value={String(result.ageYears)}
            unit="years"
            tone={result.pastDesignLife ? 'warn' : 'accent'}
            detail={result.statement}
          />
          <Rowed gap={2}>
            <StatTile label="Design life" value={`${result.designLifeYears} yr`} />
            <StatTile label="Reached" value={formatAuDate(result.expectedReplacementDate)} />
            <StatTile
              label="Remaining"
              value={result.pastDesignLife ? 'past' : `${result.yearsRemaining} yr`}
              tone={result.pastDesignLife ? 'warn' : 'default'}
            />
          </Rowed>
          <Banner tone="info" title="Age is not a defect" body={result.caveat} />
          {!result.designLifeFromManufacturer ? (
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Using the generic {BATTERY_DESIGN_LIFE_YEARS}-year design life for a self-contained emergency luminaire.
              Enter the manufacturer's own figure where the datasheet gives one.
            </Txt>
          ) : null}
          <SourceList ids={result.sourceIds} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Spacing sense-check
// ---------------------------------------------------------------------------

function SpacingView() {
  const t = useTheme();
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [count, setCount] = useState('');
  const [heightM, setHeightM] = useState(3);
  const [classification, setClassification] = useState<string>('D40');
  const [edition, setEdition] = useState<SpacingEdition>('2018');

  const ready = length.trim() && width.trim() && count.trim();
  const result = useMemo(
    () =>
      ready
        ? spacingSenseCheck({
            roomLengthM: Number(length.trim()),
            roomWidthM: Number(width.trim()),
            mountingHeightM: heightM,
            classification,
            edition,
            installedCount: Number(count.trim()),
          })
        : undefined,
    [ready, length, width, count, heightM, classification, edition],
  );

  return (
    <>
      <Banner
        tone="warn"
        title="A sense-check, not a design"
        body="This asks whether the number of fittings already in a room is anywhere near plausible. It is not a lighting design, it has no standing, and nothing may be added, moved or omitted on the strength of it."
      />

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Length" value={length} onChangeText={setLength} keyboardType="decimal-pad" suffix="m" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Width" value={width} onChangeText={setWidth} keyboardType="decimal-pad" suffix="m" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Fittings" value={count} onChangeText={setCount} keyboardType="numeric" />
        </View>
      </Rowed>

      <Label>Classification, off the datasheet</Label>
      <Rowed gap={2} wrap>
        {KNOWN_CLASSIFICATIONS.map((c) => (
          <Chip key={c} label={c} selected={c === classification} onPress={() => setClassification(c)} />
        ))}
      </Rowed>

      <Label>Mounting height</Label>
      <Rowed gap={2} wrap>
        {TABULATED_HEIGHTS_M.map((h) => (
          <Chip key={h} label={`${h} m`} selected={h === heightM} onPress={() => setHeightM(h)} />
        ))}
      </Rowed>

      <Segmented
        value={edition}
        onChange={setEdition}
        options={[
          { value: '2005', label: 'AS/NZS 2293.1:2005' },
          { value: '2018', label: 'AS/NZS 2293.1:2018' },
        ]}
      />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        The edition is never assumed. The two do not agree — a D80 fitting at 2.4 m may sit 22.0 m from the next one
        under the 2005 edition and only 13.2 m under 2018.
      </Txt>

      {!result ? (
        <EmptyState title="Enter the room" body="Length, width and how many emergency luminaires are in it. Exit signs on their own do not count." />
      ) : !result.known ? (
        <>
          <Banner tone="warn" title="This app will not answer that" body={result.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{result.whatToDo}</Txt>
          </Card>
        </>
      ) : (
        <>
          <ResultBlock
            label={result.plausible ? 'Plausible' : 'Looks short'}
            value={`${result.installedCount} of ${result.expectedMinimumCount}`}
            tone={result.plausible ? 'pass' : 'warn'}
            detail={result.statement}
          />
          <Rowed gap={2}>
            <StatTile label="Max spacing" value={`${result.maxSpacingM} m`} />
            <StatTile label="Grid" value={`${result.alongLength} × ${result.alongWidth}`} />
            <StatTile label="Each covers" value={`${result.areaPerFittingM2} m²`} />
          </Rowed>
          <Card>
            <Label>Read this before it goes anywhere</Label>
            <View style={{ marginTop: t.space(1) }}>
              {result.caveats.map((c) => <Bullet key={c} text={c} />)}
            </View>
          </Card>
          <SourceList ids={result.sourceIds} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Bullet({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Rowed gap={2} align="flex-start" style={{ paddingVertical: t.space(0.75) }}>
      <Txt size="sm" tone="faint">•</Txt>
      <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{text}</Txt>
    </Rowed>
  );
}

/**
 * Every source behind whatever is on screen, with its confidence.
 *
 * Shown rather than tucked into a comment because the difference between the
 * regulator's own published clause and a supplier's blog is exactly what a
 * technician needs before quoting a figure to a client.
 */
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
                <Chip
                  label={s.confidence}
                  tone={s.confidence === 'high' ? 'pass' : s.confidence === 'medium' ? 'accent' : 'warn'}
                />
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
            No text, table or schedule from AS/NZS 2293 is reproduced in this app. Clause and table numbers point at the
            office copy, which is what governs.
          </Txt>
        </Rowed>
      </Card>
    </>
  );
}
