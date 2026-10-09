import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ALL_TYPES,
  CONDITION_RULES,
  FIRE_CLASS_EXAMPLES,
  FIRE_CLASS_LABEL,
  PROFILES,
  QLD_LICENSING_NOTE,
  QLD_LICENSING_SOURCE,
  SUITABILITY_LABEL,
  adverseEnvironmentCaution,
  assessCondition,
  checkCharge,
  chargeTolerance,
  citeSources,
  classifyTypeText,
  formatAuDate,
  intervalsFor,
  isRefused,
  nextDue,
  pressureTestInterval,
  prohibitionLine,
  typesForClass,
  weighingIsPrimaryCheck,
  type ClassSuitability,
  type ConditionFinding,
  type ExtinguisherType,
  type FireClass,
  type ServiceActivity,
  type SourceId,
  type Suitability,
} from '@/domain/extinguisher';
import { qldDateOf } from '@/domain/measurementTrend';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Extinguishers on site.
 *
 * Forty-three per cent of the assets Safe QLD services are on this screen, and
 * the four questions a technician actually has in front of a bracket are the
 * four tabs: what is this thing and what must it never be pointed at, when is
 * the next test on it, is it still full, and does what I can see condemn it.
 *
 * Every figure shows where it came from, because the two things this screen is
 * most likely to be used for — telling a client their kitchen unit is the wrong
 * type, and telling them a cylinder is out of test — are both arguments, and an
 * argument needs a citation.
 */

type Mode = 'type' | 'due' | 'weight' | 'condition';

/**
 * Today, in Queensland.
 *
 * Slicing an ISO timestamp is the obvious way to do this and it is wrong here:
 * Brisbane is UTC+10 all year, so at seven in the morning on site the UTC date
 * is still yesterday. Every due state on this screen is a string comparison
 * against this date, so an hour of the working day where "today" is yesterday
 * reports an extinguisher that fell due this morning as upcoming.
 */
const todayInQld = (): string => qldDateOf(Date.now());

export default function ExtinguisherScreen() {
  const [mode, setMode] = useState<Mode>('type');
  const [type, setType] = useState<ExtinguisherType>('dry-chemical-abe');

  return (
    <>
      <Stack.Screen options={{ title: 'Extinguishers' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'type', label: 'Type' },
            { value: 'due', label: 'Next due' },
            { value: 'weight', label: 'Weight' },
            { value: 'condition', label: 'Condition' },
          ]}
        />

        <TypePicker value={type} onChange={setType} />

        {mode === 'type' ? <TypeView type={type} /> : null}
        {mode === 'due' ? <DueView type={type} /> : null}
        {mode === 'weight' ? <WeightView type={type} /> : null}
        {mode === 'condition' ? <ConditionView type={type} /> : null}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
// The type, its classes and its prohibitions
// ---------------------------------------------------------------------------

/**
 * The type is picked once and every tab uses it.
 *
 * Deliberately at the top of all three tabs rather than inside one. The
 * intervals, the tolerance and the prohibitions all hang off it, and a screen
 * where the answer silently belongs to a different extinguisher than the one in
 * the technician's hand is worse than no screen.
 */
function TypePicker({
  value,
  onChange,
}: {
  value: ExtinguisherType;
  onChange: (t: ExtinguisherType) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space(1.5) }}>
      <Label>Extinguisher type</Label>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.space(2), paddingRight: t.space(4) }}
      >
        {ALL_TYPES.map((id) => (
          <Chip
            key={id}
            label={PROFILES[id].shortLabel}
            selected={id === value}
            tone={PROFILES[id].withdrawn ? 'fail' : 'default'}
            onPress={() => onChange(id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Rated is not a pass and prohibited is not merely "no". The colours say so. */
const SUITABILITY_TONE: Record<Suitability, 'pass' | 'warn' | 'fail' | 'muted'> = {
  rated: 'pass',
  conditional: 'warn',
  unrated: 'muted',
  prohibited: 'fail',
};

/** A field's text, read as a number only when it is used. Blank is not zero. */
const num = (text: string): number => {
  const trimmed = text.trim();
  return trimmed ? Number(trimmed) : Number.NaN;
};

function TypeView({ type }: { type: ExtinguisherType }) {
  const t = useTheme();
  const profile = PROFILES[type];
  const intervals = intervalsFor(type);
  const pressure = pressureTestInterval(type);
  const [typeText, setTypeText] = useState('');

  const guess = useMemo(() => (typeText.trim() ? classifyTypeText(typeText) : undefined), [typeText]);

  const sourceIds: SourceId[] = [
    ...profile.sourceIds,
    ...profile.classes.flatMap((c) => c.sourceIds),
    ...intervals.flatMap((i) => i.sourceIds),
    ...QLD_LICENSING_SOURCE,
  ];

  return (
    <>
      {profile.withdrawn ? (
        <Banner tone="fail" title="Not lawful to keep in service" body={profile.withdrawn.statement} />
      ) : null}

      <ResultBlock
        label={profile.label}
        value={profile.colourBand.split('—')[0]!.trim()}
        tone={profile.withdrawn ? 'fail' : 'accent'}
        detail={`${profile.agent}. ${profile.standardPart ? `Specified in ${profile.standardPart}. ` : ''}${prohibitionLine(type)}`}
      />

      <H2>Fire classes</H2>
      <Card>
        {profile.classes.map((entry, i) => (
          <View key={entry.fireClass}>
            {i > 0 ? <Divider /> : null}
            <ClassRow entry={entry} />
          </View>
        ))}
      </Card>

      <H2>Handling</H2>
      <Card>
        {profile.handlingCautions.map((c) => (
          <Bullet key={c} text={c} />
        ))}
        <Divider />
        <Bullet
          text={
            weighingIsPrimaryCheck(type)
              ? 'No gauge. Only weighing proves it full.'
              : profile.hasPressureGauge === null
                ? 'Gauge depends on the model. Check whether it has one.'
                : 'Gauge fitted. Weigh it too if the gauge looks doubtful; a leaked unit topped up with air still reads green.'
          }
        />
      </Card>

      <H2>Intervals</H2>
      {intervals.map((spec) => (
        <Card key={spec.activity}>
          <Rowed gap={2}>
            <Txt size="lg" weight="700" style={{ flex: 1 }}>{spec.label}</Txt>
            <Chip label={`${spec.intervalMonths} months`} tone="accent" />
          </Rowed>
          <View style={{ marginTop: t.space(1.5) }}>
            {spec.what.map((w) => (
              <Bullet key={w} text={w} />
            ))}
          </View>
          {spec.dispute ? (
            <View style={{ marginTop: t.space(2) }}>
              <Banner tone="warn" title="Sources differ" body={spec.dispute} />
            </View>
          ) : null}
        </Card>
      ))}

      <Card>
        <Label>Pressure test</Label>
        <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>
          {pressure.intervalMonths} months from the manufacture date on the cylinder, not the last service.{' '}
          {pressure.note}
        </Txt>
      </Card>

      <Banner tone="info" title="Adverse environment" body={adverseEnvironmentCaution().statement} />

      <H2>Selecting for a risk</H2>
      <Card>
        {(['A', 'B', 'C', 'D', 'E', 'F'] as FireClass[]).map((fireClass, i) => {
          const options = typesForClass(fireClass);
          return (
            <View key={fireClass}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: t.space(1.5) }}>
                <Txt size="sm" weight="700">{FIRE_CLASS_LABEL[fireClass]}</Txt>
                <Txt size="xs" tone="faint" style={{ marginTop: 2, lineHeight: 17 }}>
                  {FIRE_CLASS_EXAMPLES[fireClass]}
                </Txt>
                <Txt size="xs" tone={options.length ? 'accent' : 'warn'} weight="700" style={{ marginTop: 4 }}>
                  {options.length
                    ? `Rated: ${options.map((o) => PROFILES[o].shortLabel).join(', ')}`
                    : 'Nothing here is rated for it. Use a purpose-made agent.'}
                </Txt>
              </View>
            </View>
          );
        })}
      </Card>

      <H2>Read a register entry</H2>
      <Field
        label="Register type"
        value={typeText}
        onChangeText={setTypeText}
        placeholder="9.0kg ABE"
        autoCapitalize="characters"
        hint="Paste the register entry."
      />
      {guess ? (
        isRefused(guess) ? (
          <Banner tone="warn" title="Not enough to classify it" body={`${guess.reason} ${guess.whatToDo}`} />
        ) : (
          <Banner
            tone="pass"
            title={PROFILES[guess.type].label}
            body={`Matched "${guess.matched}". ${prohibitionLine(guess.type)}`}
          />
        )
      ) : null}

      <Banner tone="info" title="Queensland licensing" body={QLD_LICENSING_NOTE} />

      <SourceList ids={sourceIds} />
    </>
  );
}

function ClassRow({ entry }: { entry: ClassSuitability }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        <MaterialCommunityIcons
          name={
            entry.suitability === 'rated'
              ? 'check-circle'
              : entry.suitability === 'prohibited'
                ? 'close-octagon'
                : entry.suitability === 'conditional'
                  ? 'alert-circle'
                  : 'minus-circle-outline'
          }
          size={20}
          color={
            entry.suitability === 'rated'
              ? t.color.pass
              : entry.suitability === 'prohibited'
                ? t.color.fail
                : entry.suitability === 'conditional'
                  ? t.color.warn
                  : t.color.textFaint
          }
          style={{ marginTop: 1 }}
        />
        <View style={{ flex: 1 }}>
          <Txt size="sm" weight="700">{FIRE_CLASS_LABEL[entry.fireClass]}</Txt>
          <Txt size="xs" tone={SUITABILITY_TONE[entry.suitability]} weight="700" style={{ marginTop: 2 }}>
            {SUITABILITY_LABEL[entry.suitability]}
          </Txt>
          {entry.consequence ? (
            <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{entry.consequence}</Txt>
          ) : null}
          {entry.dispute ? (
            <Txt size="xs" tone="warn" style={{ marginTop: 4, lineHeight: 17 }}>Sources differ: {entry.dispute}</Txt>
          ) : null}
        </View>
      </Rowed>
    </View>
  );
}

// ---------------------------------------------------------------------------
// When is the next one due
// ---------------------------------------------------------------------------

const ACTIVITIES: { value: ServiceActivity; label: string }[] = [
  { value: 'six-monthly', label: '6-monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'five-yearly', label: '5-yearly' },
];

function DueView({ type }: { type: ExtinguisherType }) {
  const t = useTheme();
  const [activity, setActivity] = useState<ServiceActivity>('five-yearly');
  const [manufactured, setManufactured] = useState('');
  const [lastDone, setLastDone] = useState('');

  const today = useMemo(() => todayInQld(), []);
  const entered = manufactured.trim().length > 0 || lastDone.trim().length > 0;

  const result = useMemo(
    () =>
      entered
        ? nextDue({
            activity,
            type,
            manufactured: manufactured.trim() || undefined,
            lastDone: lastDone.trim() || undefined,
            today,
          })
        : undefined,
    [activity, type, manufactured, lastDone, today, entered],
  );

  return (
    <>
      <Segmented value={activity} onChange={setActivity} options={ACTIVITIES} />

      <Field
        label="Date of manufacture"
        value={manufactured}
        onChangeText={setManufactured}
        placeholder="1/6/2015"
        hint="Stamped on the cylinder."
      />
      <Field
        label="Last done"
        value={lastDone}
        onChangeText={setLastDone}
        placeholder="Jun-25"
        hint="Day, month or year."
      />

      {!entered ? (
        <EmptyState
          icon="calendar-edit"
          title="Enter a date"
          body="Enter the manufacture date on the cylinder."
        />
      ) : isRefused(result!) ? (
        <Banner tone="warn" title="Can't calculate" body={`${result!.reason} ${result!.whatToDo}`} />
      ) : (
        <>
          <ResultBlock
            label={`Next ${ACTIVITIES.find((a) => a.value === activity)!.label.toLowerCase()} due`}
            value={result!.due.label}
            tone={result!.state === 'overdue' ? 'fail' : result!.state === 'due' ? 'warn' : 'accent'}
            detail={
              result!.due.precision === 'day'
                ? `${result!.state === 'overdue' ? `${Math.abs(result!.daysUntil.latest)} days late` : `${result!.daysUntil.earliest} days away`} · ${result!.anchorNote}`
                : `Due within this ${result!.due.precision === 'month' ? 'month' : 'year'}, not on a set day. ${result!.anchorNote}`
            }
          />

          <Rowed gap={2}>
            <StatTile
              label="State"
              value={result!.state === 'overdue' ? 'Overdue' : result!.state === 'due' ? 'Due now' : 'Upcoming'}
              tone={result!.state === 'overdue' ? 'fail' : result!.state === 'due' ? 'warn' : 'pass'}
            />
            <StatTile label="Occurrence" value={result!.occurrence} />
            <StatTile
              label="Missed"
              value={result!.missedOccurrences}
              tone={result!.missedOccurrences > 1 ? 'fail' : 'default'}
            />
          </Rowed>

          <Card>
            <Label>Window</Label>
            <View style={{ marginTop: t.space(1.5), gap: t.space(1) }}>
              <WorkingLine label="Earliest" value={formatAuDate(result!.due.earliest)} />
              <WorkingLine label="Latest" value={formatAuDate(result!.due.latest)} />
              <WorkingLine label="Interval" value={`${result!.intervalMonths} months`} />
            </View>
          </Card>

          <Card>
            {result!.notes.map((n) => (
              <Bullet key={n} text={n} />
            ))}
          </Card>

          <SourceList ids={result!.sourceIds} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Is it still full
// ---------------------------------------------------------------------------

function WeightView({ type }: { type: ExtinguisherType }) {
  const t = useTheme();
  const [plateTolerance, setPlateTolerance] = useState('');
  const [tare, setTare] = useState('');
  const [gross, setGross] = useState('');
  const [nominal, setNominal] = useState('');

  // The plate figure comes first and nothing is judged without it. No
  // tolerance is held for any type, so every type gets its verdict from the
  // figure on its own plate, and none gets one before that is entered.
  const plateEntered = plateTolerance.trim().length > 0;
  const tolerance = useMemo(
    () => (plateEntered ? chargeTolerance(type, num(plateTolerance)) : undefined),
    [type, plateTolerance, plateEntered],
  );

  const weighed = tare.trim().length > 0 && gross.trim().length > 0;

  const result = useMemo(
    () =>
      plateEntered && weighed
        ? checkCharge({
            type,
            tareGrams: num(tare),
            grossGrams: num(gross),
            nominalChargeGrams: nominal.trim() ? num(nominal) : undefined,
            manufacturerTolerancePercent: num(plateTolerance),
          })
        : undefined,
    [type, tare, gross, nominal, plateTolerance, plateEntered, weighed],
  );

  // Three answers, not two. Where the profile does not know whether this type
  // carries a gauge, saying "the gauge is the primary check" is a confident
  // instruction about a cylinder that may not have one.
  const primary = weighingIsPrimaryCheck(type);

  return (
    <>
      <Banner
        tone={primary === false ? 'info' : 'warn'}
        title={
          primary === true
            ? 'Weighing is the only check'
            : primary === false
              ? 'The gauge is the main check'
              : 'Gauge depends on the model'
        }
        body={
          primary === true
            ? 'No pressure gauge on a CO₂ unit. Only the weight shows it is full.'
            : primary === false
              ? 'Weigh it as well: a leaked unit topped up with air still reads green.'
              : 'Check whether it has a gauge.'
        }
      />

      <Field
        label="Plate tolerance"
        value={plateTolerance}
        onChangeText={setPlateTolerance}
        keyboardType="decimal-pad"
        suffix="% of charge"
        hint="Off the extinguisher's plate."
      />
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Tare" value={tare} onChangeText={setTare} keyboardType="numeric" suffix="g" hint="Stamped on it" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Gross" value={gross} onChangeText={setGross} keyboardType="numeric" suffix="g" hint="On the scales" />
        </View>
      </Rowed>
      <Field
        label="Nominal charge"
        value={nominal}
        onChangeText={setNominal}
        keyboardType="numeric"
        suffix="g"
        hint="Off the label."
      />

      {!plateEntered ? (
        <EmptyState icon="scale" title="Enter the plate tolerance" body="No verdict without it." />
      ) : tolerance && isRefused(tolerance) ? (
        <Banner tone="warn" title="Check the tolerance" body={`${tolerance.reason} ${tolerance.whatToDo}`} />
      ) : !weighed ? (
        <EmptyState icon="scale" title="Weigh it" body="Tare and gross, both in grams." />
      ) : isRefused(result!) ? (
        <Banner tone="fail" title="No verdict" body={`${result!.reason} ${result!.whatToDo}`} />
      ) : (
        <>
          <ResultBlock
            label="Charge held"
            value={String(result!.actualChargeGrams)}
            unit="g"
            tone={result!.state === 'within-tolerance' ? 'pass' : 'fail'}
            detail={result!.statement}
          />
          <Rowed gap={2}>
            <StatTile label="Expected" value={`${result!.expectedChargeGrams} g`} />
            <StatTile
              label="Difference"
              value={`${result!.differenceGrams > 0 ? '+' : ''}${result!.differenceGrams} g`}
              tone={result!.state === 'within-tolerance' ? 'pass' : 'fail'}
            />
            <StatTile
              label="Off nominal"
              value={`${result!.differencePercent > 0 ? '+' : ''}${result!.differencePercent}%`}
              tone={result!.state === 'within-tolerance' ? 'pass' : 'fail'}
            />
          </Rowed>
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{result!.toleranceCaveat}</Txt>
        </>
      )}

      <View style={{ height: t.space(2) }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Does what I can see condemn it
// ---------------------------------------------------------------------------

const INSPECTED: { value: 'yes' | 'no' | ''; label: string }[] = [
  { value: 'yes', label: 'Inspected' },
  { value: 'no', label: 'Not inspected' },
];

/**
 * The condemn-or-repair decision, made in front of the bracket.
 *
 * This is the tab the module's condemnation rules exist for, and the reason it
 * is a tab rather than a paragraph is that the answer a technician most needs
 * is the one no screen wants to give: "undetermined". Pitting depth and dent
 * severity are judgements, an uninspected asset is not a clean one, and both
 * come back here as a question rather than a tick — which is the whole point of
 * having the rules in the app instead of in somebody's head on a Friday.
 */
function ConditionView({ type }: { type: ExtinguisherType }) {
  const t = useTheme();
  // Nothing is assumed: no verdict shows until the technician says whether the
  // unit was inspected.
  const [inspected, setInspected] = useState<'yes' | 'no' | ''>('');
  const [ticked, setTicked] = useState<ConditionFinding[]>([]);

  const rules = Object.values(CONDITION_RULES);
  const toggle = (id: ConditionFinding) =>
    setTicked((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  const assessment = useMemo(
    () => assessCondition({ type, findings: ticked, inspected: inspected === 'yes' }),
    [type, ticked, inspected],
  );

  const tone = assessment.verdict === 'condemn' ? 'fail' : assessment.verdict === 'serviceable' ? 'pass' : 'warn';

  return (
    <>
      <Segmented value={inspected} onChange={setInspected} options={INSPECTED} />

      {!inspected ? (
        <Txt size="sm" tone="muted">Pick inspected or not, then tick what you found.</Txt>
      ) : (
        <ResultBlock
          label="Verdict"
          value={
            assessment.verdict === 'condemn'
              ? 'Condemn'
              : assessment.verdict === 'serviceable'
                ? 'Serviceable'
                : 'Undetermined'
          }
          tone={tone}
          detail={assessment.statement}
        />
      )}

      {inspected && assessment.needsJudgement.length ? (
        <Banner tone="warn" title="Decide these on site" body="Photograph it and record the decision." />
      ) : null}

      <H2>What was found</H2>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(1.5) }}>
          {rules.map((rule) => (
            <Chip
              key={rule.id}
              label={rule.label}
              selected={ticked.includes(rule.id)}
              tone={rule.outcome === 'condemn' ? 'fail' : rule.outcome === 'judgement' ? 'warn' : 'accent'}
              onPress={() => toggle(rule.id)}
            />
          ))}
        </View>
        <Divider />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Red condemns it, amber is a call on site, blue is a repairable defect.
        </Txt>
      </Card>

      {[...assessment.condemning, ...assessment.needsJudgement, ...assessment.repairable].map((rule) => (
        <Card key={rule.id}>
          <Rowed gap={2}>
            <Txt size="sm" weight="700" style={{ flex: 1 }}>{rule.label}</Txt>
            <Chip
              label={rule.outcome === 'condemn' ? 'Condemn' : rule.outcome === 'judgement' ? 'Judgement' : 'Repairable'}
              tone={rule.outcome === 'condemn' ? 'fail' : rule.outcome === 'judgement' ? 'warn' : 'accent'}
            />
          </Rowed>
          <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{rule.reason}</Txt>
          <Txt size="xs" tone="accent" style={{ marginTop: 4, lineHeight: 17 }}>{rule.action}</Txt>
        </Card>
      ))}

      {assessment.unrecognised.length ? (
        <Banner
          tone="warn"
          title="No rule for this"
          body={`${assessment.unrecognised.join(', ')}. Decide on site.`}
        />
      ) : null}

      {inspected ? <SourceList ids={assessment.sourceIds} /> : null}
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

function WorkingLine({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <Rowed style={{ justifyContent: 'space-between', paddingVertical: t.space(0.5) }}>
      <Txt size="sm" tone="muted">{label}</Txt>
      <Txt size="sm" mono>{value}</Txt>
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
