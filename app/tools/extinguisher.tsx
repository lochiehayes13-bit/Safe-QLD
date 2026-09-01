import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
  intervalsFor,
  isRefused,
  nextDue,
  pressureTestInterval,
  prohibitionLine,
  typesForClass,
  weighingIsPrimaryCheck,
  type ClassSuitability,
  type ConditionFinding,
  type Confidence,
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
 * Every figure shows where it came from and how much that source is worth,
 * because the two things this screen is most likely to be used for — telling a
 * client their kitchen unit is the wrong type, and telling them a cylinder is
 * out of test — are both arguments, and an argument needs a citation.
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

const CONFIDENCE_TONE = (c: Confidence): 'pass' | 'accent' | 'warn' =>
  c === 'high' ? 'pass' : c === 'medium' ? 'accent' : 'warn';

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
              ? 'No pressure gauge. Weighing is the only evidence this one is full.'
              : profile.hasPressureGauge === null
                ? 'Whether this one carries a gauge depends on the model. Look before deciding how to check it.'
                : 'Pressure gauge fitted. Weigh it as well where the gauge is doubtful — a leaked unit re-pressurised with air still reads in the green.'
          }
        />
      </Card>

      <H2>Intervals</H2>
      {intervals.map((spec) => (
        <Card key={spec.activity}>
          <Rowed gap={2}>
            <Txt size="lg" weight="700" style={{ flex: 1 }}>{spec.label}</Txt>
            <Chip label={`${spec.intervalMonths} months`} tone="accent" />
            <Chip label={spec.confidence} tone={CONFIDENCE_TONE(spec.confidence)} />
          </Rowed>
          <View style={{ marginTop: t.space(1.5) }}>
            {spec.what.map((w) => (
              <Bullet key={w} text={w} />
            ))}
          </View>
          {spec.dispute ? (
            <View style={{ marginTop: t.space(2) }}>
              <Banner tone="warn" title="The sources disagree" body={spec.dispute} />
            </View>
          ) : null}
        </Card>
      ))}

      <Card>
        <Label>Pressure test</Label>
        <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>
          {pressure.intervalMonths} months, counted from the date of manufacture stamped on the cylinder and never from
          the last service. {pressure.note}
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
                    : 'Nothing in this list is rated for it. A purpose-made agent is required.'}
                </Txt>
              </View>
            </View>
          );
        })}
      </Card>

      <H2>Read a register descriptor</H2>
      <Field
        label="Extinguisher type cell"
        value={typeText}
        onChangeText={setTypeText}
        placeholder="9.0kg ABE"
        autoCapitalize="characters"
        hint="Paste what the register says and see whether it is enough to identify the asset."
      />
      {guess ? (
        isRefused(guess) ? (
          <Banner tone="warn" title="Not enough to classify it" body={`${guess.reason} ${guess.whatToDo}`} />
        ) : (
          <Banner
            tone="pass"
            title={PROFILES[guess.type].label}
            body={`Matched on "${guess.matched}" — ${guess.confidence} confidence. ${prohibitionLine(guess.type)}`}
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
            <Txt size="xs" tone="warn" style={{ marginTop: 4, lineHeight: 17 }}>Sources disagree: {entry.dispute}</Txt>
          ) : null}
        </View>
        <Chip label={entry.confidence} tone={CONFIDENCE_TONE(entry.confidence)} />
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
        hint="Stamped on the cylinder. This is the anchor — the schedule counts from here, not from the last service."
      />
      <Field
        label="Last done"
        value={lastDone}
        onChangeText={setLastDone}
        placeholder="Jun-25"
        hint='Day, month or year — whatever the record actually says. "Jun-25" is read as a month and stays a month.'
      />

      {!entered ? (
        <EmptyState
          title="Enter a date"
          body="The date stamped on the cylinder is the one that matters. Without it the schedule can only be counted forward from the last service, which carries any lateness with it."
        />
      ) : isRefused(result!) ? (
        <Banner tone="warn" title="Cannot be worked out" body={`${result!.reason} ${result!.whatToDo}`} />
      ) : (
        <>
          <ResultBlock
            label={`Next ${ACTIVITIES.find((a) => a.value === activity)!.label.toLowerCase()} due`}
            value={result!.due.label}
            tone={result!.state === 'overdue' ? 'fail' : result!.state === 'due' ? 'warn' : 'accent'}
            detail={
              result!.due.precision === 'day'
                ? `${result!.state === 'overdue' ? `${Math.abs(result!.daysUntil.latest)} days late` : `${result!.daysUntil.earliest} days away`} · ${result!.anchorNote}`
                : `Due within this ${result!.due.precision === 'month' ? 'month' : 'year'}, not on a particular day. ${result!.anchorNote}`
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

          {result!.anchoredTo === 'last-service' ? (
            <Banner
              tone="warn"
              title="Counted from the last service, not the cylinder"
              body="No date of manufacture was readable, so any lateness already in this record is carried forward. Read the stamp off the base or the neck and enter it."
            />
          ) : null}

          <Card>
            <Label>Window</Label>
            <View style={{ marginTop: t.space(1.5), gap: t.space(1) }}>
              <WorkingLine label="Earliest it could fall" value={result!.due.earliest} />
              <WorkingLine label="Latest it could fall" value={result!.due.latest} />
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
  const [tare, setTare] = useState('');
  const [gross, setGross] = useState('');
  const [nominal, setNominal] = useState('');
  const [plateTolerance, setPlateTolerance] = useState('');

  const tolerance = useMemo(
    () => chargeTolerance(type, plateTolerance.trim() ? Number(plateTolerance.trim()) : undefined),
    [type, plateTolerance],
  );

  const entered = tare.trim().length > 0 && gross.trim().length > 0;

  const result = useMemo(
    () =>
      entered
        ? checkCharge({
            type,
            tareGrams: Math.round(Number(tare.trim())),
            grossGrams: Math.round(Number(gross.trim())),
            nominalChargeGrams: nominal.trim() ? Math.round(Number(nominal.trim())) : undefined,
            manufacturerTolerancePercent: plateTolerance.trim() ? Number(plateTolerance.trim()) : undefined,
          })
        : undefined,
    [type, tare, gross, nominal, plateTolerance, entered],
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
            ? 'The scale is the only check on this type'
            : primary === false
              ? 'The gauge is the primary check on this type'
              : 'Whether this one has a gauge depends on the model'
        }
        body={
          primary === true
            ? 'A carbon dioxide extinguisher carries no pressure gauge. Nothing but the mass says whether it is full.'
            : primary === false
              ? 'This type has a gauge. Weighing is a second opinion on it, and worth taking — a unit that leaked and was re-pressurised with air still reads in the green.'
              : 'Look at the unit before deciding how to check it. This app does not know whether this type carries a gauge, and will not assume one is there.'
        }
      />

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Tare" value={tare} onChangeText={setTare} keyboardType="numeric" suffix="g" hint="Empty mass, stamped" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Gross" value={gross} onChangeText={setGross} keyboardType="numeric" suffix="g" hint="On the scales now" />
        </View>
      </Rowed>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Nominal charge" value={nominal} onChangeText={setNominal} keyboardType="numeric" suffix="g" hint="Off the label" />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Plate tolerance"
            value={plateTolerance}
            onChangeText={setPlateTolerance}
            keyboardType="decimal-pad"
            suffix="%"
            hint="If the label states one"
          />
        </View>
      </Rowed>

      {isRefused(tolerance) ? (
        <Banner tone="warn" title="No tolerance held for this type" body={`${tolerance.reason} ${tolerance.whatToDo}`} />
      ) : (
        <Card>
          <Rowed gap={2}>
            <Label>Tolerance applied</Label>
            <Chip label={tolerance.confidence} tone={CONFIDENCE_TONE(tolerance.confidence)} />
          </Rowed>
          <Txt size="xl" weight="700" style={{ marginTop: 4 }}>±{tolerance.percentOfCharge}% of charge</Txt>
          <Txt size="xs" tone={tolerance.origin === 'manufacturer-plate' ? 'accent' : 'muted'} weight="700" style={{ marginTop: 4 }}>
            {tolerance.origin === 'manufacturer-plate'
              ? "Read off this extinguisher's plate — the figure that governs"
              : 'Held by this app, and not an Australian figure'}
          </Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>{tolerance.caveat}</Txt>
        </Card>
      )}

      {!entered ? (
        <EmptyState
          title="Weigh it"
          body="Tare off the stamping, gross off the scales, both in grams. A kilogram figure entered here reads as a very light extinguisher."
        />
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
          <Card>
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{result!.toleranceCaveat}</Txt>
          </Card>
          <SourceList ids={result!.sourceIds} />
        </>
      )}

      <View style={{ height: t.space(2) }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Does what I can see condemn it
// ---------------------------------------------------------------------------

const INSPECTED: { value: 'yes' | 'no'; label: string }[] = [
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
  const [inspected, setInspected] = useState<'yes' | 'no'>('yes');
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

      {assessment.needsJudgement.length ? (
        <Banner
          tone="warn"
          title="A person has to decide these"
          body="This app will not settle them from a checkbox. Decide on site, photograph it, and record the decision against the asset."
        />
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
          Red condemns the asset, amber is a judgement nobody can make from a form, blue is a defect the body survives.
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
            <Chip label={rule.confidence} tone={CONFIDENCE_TONE(rule.confidence)} />
          </Rowed>
          <Txt size="xs" tone="muted" style={{ marginTop: 4, lineHeight: 17 }}>{rule.reason}</Txt>
          <Txt size="xs" tone="accent" style={{ marginTop: 4, lineHeight: 17 }}>{rule.action}</Txt>
        </Card>
      ))}

      {assessment.unrecognised.length ? (
        <Banner
          tone="warn"
          title="A finding with no rule behind it"
          body={`${assessment.unrecognised.join(', ')}. It has not been dropped — the asset is undetermined until a person rules on it and the finding is added to the rules.`}
        />
      ) : null}

      <SourceList ids={assessment.sourceIds} />
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

/**
 * Every source behind whatever is on screen, with its confidence.
 *
 * Shown rather than tucked into a comment, and for a specific reason on this
 * screen: the two figures most likely to be quoted off it — the carbon dioxide
 * pressure test interval and the charge tolerance — are the two this app is
 * least sure of. A technician who reads "low" beside them will go and check,
 * which is the whole intent.
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
            No text, table or schedule from AS 1851 or AS/NZS 1841 is reproduced in this app. Clause, table and part
            numbers point at the office copy, which is what governs.
          </Txt>
        </Rowed>
      </Card>
    </>
  );
}
