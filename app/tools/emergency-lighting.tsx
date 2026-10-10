import React, { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  BATTERY_DESIGN_LIFE_YEARS,
  KNOWN_CLASSIFICATIONS,
  MINIMUM_DURATION_MINUTES,
  OUTCOME_LABEL,
  SOURCES,
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
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Emergency lighting on site.
 *
 * A third of the assets Safe QLD services are these fittings, and the questions
 * a technician has at the top of the ladder are always the same four: did this
 * one pass, is that sign close enough to be read, is the battery old enough to
 * explain what I just saw, and is there anything like enough light in this
 * room. Each has its own tab, and each shows where its numbers came from.
 */

type Mode = 'discharge' | 'sign' | 'battery' | 'spacing';

export default function EmergencyLightingScreen() {
  const [mode, setMode] = useState<Mode>('discharge');
  // One install date for the whole screen. It is asked for on the discharge
  // tab, where it changes the advice, and on the battery tab, where it is the
  // whole answer; typed on either, it is the same date on both.
  const [installedOn, setInstalledOn] = useState('');

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
        {mode === 'discharge' ? <DischargeView installedOn={installedOn} setInstalledOn={setInstalledOn} /> : null}
        {mode === 'sign' ? <SignView /> : null}
        {mode === 'battery' ? <BatteryView installedOn={installedOn} setInstalledOn={setInstalledOn} /> : null}
        {mode === 'spacing' ? <SpacingView /> : null}
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

function DischargeView({
  installedOn,
  setInstalledOn,
}: {
  installedOn: string;
  setInstalledOn: (v: string) => void;
}) {
  const t = useTheme();
  const [achieved, setAchieved] = useState('');
  const [ending, setEnding] = useState<TestEnding>('extinguished');
  const [rated, setRated] = useState('');
  const [supply, setSupply] = useState<SupplyType>('single-point');
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('non-sustained');
  const [role, setRole] = useState<FittingRole>('emergency-luminaire');

  const entered = achieved.trim().length > 0 || ending === 'never-lit';

  const verdict = useMemo(
    () =>
      assessDischarge({
        achievedMinutes: ending === 'never-lit' ? 0 : num(achieved),
        ending,
        ratedMinutes: rated.trim() ? num(rated) : undefined,
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
      <Txt size="sm" tone="muted">Isolate supply, time it, record how it ended.</Txt>

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
              label={ending === 'extinguished' ? 'Lit for' : 'Stopped at'}
              value={achieved}
              onChangeText={setAchieved}
              keyboardType="decimal-pad"
              suffix="min"
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
              hint="Off the fitting label."
            />
          </View>
        </Rowed>
      ) : (
        <Banner tone="info" title="Check isolation" body="Check the circuit was actually isolated." />
      )}

      {!entered ? null : (
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

          {verdict.defectCode ? (
            <Card style={{ gap: t.space(1.5) }}>
              <Rowed gap={2}>
                <Chip label={verdict.defectCode} tone="fail" />
                <Txt size="sm" weight="700" style={{ flex: 1 }}>Defect to raise</Txt>
              </Rowed>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{verdict.rectification}</Txt>
              <Button
                title="Raise defect"
                variant="secondary"
                compact
                onPress={() =>
                  router.push({ pathname: '/work/defect/new', params: { code: verdict.defectCode ?? '' } })
                }
              />
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
        hint="Optional."
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

      <H2>Fitting type</H2>
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
        <Label>Test</Label>
        {profile.whatIsTested.map((line) => <Bullet key={line} text={line} />)}
        <Divider />
        <Label>If it fails</Label>
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
  const [height, setHeight] = useState('');
  const [illumination, setIllumination] = useState<SignIllumination>('internally-illuminated');
  const [distance, setDistance] = useState('');

  const sign = useMemo(
    () => exitSignViewingDistance({ pictogramHeightMm: num(height), illumination }),
    [height, illumination],
  );
  const placement = useMemo(
    () => (sign.known && distance.trim() ? checkSignPlacement(num(distance), sign) : undefined),
    [sign, distance],
  );

  return (
    <>
      <Txt size="sm" tone="muted">Measure the running-man symbol height only.</Txt>

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
        keyboardType="decimal-pad"
        suffix="mm"
      />

      {!height.trim() ? (
        <EmptyState icon="exit-run" title="Enter the pictogram height" body="Top to bottom of the running man." />
      ) : !sign.known ? (
        <>
          <Banner tone="warn" title="Can't calculate" body={sign.reason} />
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
            detail={sign.cappedBy ?? (sign.sourcesAgree ? undefined : 'Strictest published reading.')}
          />

          {!sign.sourcesAgree ? (
            <Card>
              <Label>Sources differ</Label>
              {sign.candidates.map((c) => (
                <View key={`${c.sourceId}-${c.maxViewingDistanceM}`} style={{ paddingVertical: t.space(1.5) }}>
                  <Txt size="md" weight="700" mono>{c.maxViewingDistanceM} m</Txt>
                  <Txt size="xs" tone="muted" style={{ marginTop: 3, lineHeight: 17 }}>
                    {c.reading} {SOURCES[c.sourceId].ref}
                  </Txt>
                </View>
              ))}
            </Card>
          ) : null}

          <Field
            label="Furthest viewing point"
            value={distance}
            onChangeText={setDistance}
            keyboardType="decimal-pad"
            suffix="m"
            hint="Along the path of travel."
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
                    : 'Between the published limits'
              }
              body={placement.reason ? `${placement.statement} ${placement.reason}` : placement.statement}
            />
          ) : null}

          <Card>
            <Label>Governing clause</Label>
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

function BatteryView({
  installedOn,
  setInstalledOn,
}: {
  installedOn: string;
  setInstalledOn: (v: string) => void;
}) {
  const [life, setLife] = useState('');

  const result = useMemo(
    () =>
      installedOn.trim()
        ? batteryAge({
            installedOn,
            at: new Date(),
            designLifeYears: life.trim() ? num(life) : undefined,
          })
        : undefined,
    [installedOn, life],
  );

  return (
    <>
      <Field
        label="Battery installed"
        value={installedOn}
        onChangeText={setInstalledOn}
        placeholder="d/m/yyyy"
        autoCapitalize="none"
        hint="Enter dates as d/m/yyyy."
      />
      <Field
        label="Design life"
        value={life}
        onChangeText={setLife}
        keyboardType="decimal-pad"
        suffix="years"
        placeholder={String(BATTERY_DESIGN_LIFE_YEARS)}
        hint="From the datasheet, if it gives one."
      />

      {!result ? (
        <EmptyState
          icon="calendar-edit" title="Enter the install date" body="From the fitting, battery label or register." />
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
              Generic {BATTERY_DESIGN_LIFE_YEARS}-year design life. Enter the datasheet figure if there is one.
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

const EDITIONS: { value: SpacingEdition; label: string }[] = [
  { value: '2005', label: 'AS/NZS 2293.1:2005' },
  { value: '2018', label: 'AS/NZS 2293.1:2018' },
];

function SpacingView() {
  const t = useTheme();
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [count, setCount] = useState('');
  // Nothing is picked for the technician. Class, height and edition all change
  // the answer, so each one is chosen before a count is shown.
  const [heightM, setHeightM] = useState<number | undefined>(undefined);
  const [classification, setClassification] = useState<string | undefined>(undefined);
  const [edition, setEdition] = useState<SpacingEdition | undefined>(undefined);

  const roomEntered = !!(length.trim() && width.trim() && count.trim());
  const picked = heightM !== undefined && classification !== undefined && edition !== undefined;
  const result = useMemo(
    () =>
      roomEntered && picked
        ? spacingSenseCheck({
            roomLengthM: num(length),
            roomWidthM: num(width),
            mountingHeightM: heightM!,
            classification: classification!,
            edition: edition!,
            installedCount: num(count),
          })
        : undefined,
    [roomEntered, picked, length, width, count, heightM, classification, edition],
  );

  return (
    <>
      <Banner tone="warn" title="Rough check only, not a lighting design" />

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

      <Label>Classification (datasheet)</Label>
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

      <Label>Edition</Label>
      <Rowed gap={2} wrap>
        {EDITIONS.map((e) => (
          <Chip key={e.value} label={e.label} selected={e.value === edition} onPress={() => setEdition(e.value)} />
        ))}
      </Rowed>
      <Txt size="xs" tone="faint">Pick the edition the building was designed to.</Txt>

      {!roomEntered ? (
        <EmptyState
          icon="floor-plan" title="Enter the room" body="Length, width and emergency lights in it. Not exit signs." />
      ) : !picked ? (
        <Txt size="sm" tone="muted">Pick the classification, mounting height and edition.</Txt>
      ) : result && !result.known ? (
        <>
          <Banner tone="warn" title="Can't calculate" body={result.reason} />
          <Card>
            <Label>What to do</Label>
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{result.whatToDo}</Txt>
          </Card>
        </>
      ) : result?.known ? (
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
            <Label>Notes</Label>
            <View style={{ marginTop: t.space(1) }}>
              {/* The first caveat is the "not a design" line, already the banner at the top. */}
              {result.caveats.slice(1).map((c) => <Bullet key={c} text={c} />)}
            </View>
          </Card>
          <SourceList ids={result.sourceIds} />
        </>
      ) : null}
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
    </Card>
  );
}
