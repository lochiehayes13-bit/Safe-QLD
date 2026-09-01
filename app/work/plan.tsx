import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { buildWorkPlan, planCoverage, type PlanCoverage } from '@/db/planRepo';
import {
  CLUSTER_METHOD_LABEL,
  ESTIMATE_CAVEAT,
  UNPLANNABLE_REASON_LABEL,
  formatHours,
  planHeadline,
  type PlannedDay,
  type PlannedVisit,
  type UnplannableReason,
  type WorkPlan,
} from '@/domain/workPlan';
import { FREQUENCY_LABEL } from '@/seed/serviceRoutines';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, H2, Label, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * The month, laid out day by day.
 *
 * This is the office's core job and until now it did not exist: the app could
 * say what was due but not what next month looked like. Everything the planner
 * is unsure about is on the screen rather than buried, because a plan is acted
 * on by someone who was not there when it was made:
 *
 *  - Every hours figure is marked as an estimate, every time. They come from
 *    asset counts and a minutes-per-asset table built from experience, not from
 *    a standard, and a number that looks measured gets quoted to a client.
 *  - Each day says how it was grouped. A suburb is a strong grouping; a radius
 *    drawn around a coordinate is not, and the two are never shown as though
 *    they were the same thing.
 *  - Work that could not be planned is a section of this screen, not a silence.
 *    A site missing from the plan because nobody has registered its assets is
 *    the most important thing here — it is the one that goes unserviced.
 */
type MonthChoice = '0' | '1' | '2';
type TechChoice = '1' | '2' | '3' | '4';

export default function WorkPlanScreen() {
  const t = useTheme();
  const [month, setMonth] = useState<MonthChoice>('1');
  const [techs, setTechs] = useState<TechChoice>('2');
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [coverage, setCoverage] = useState<PlanCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkings, setShowWorkings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [built, cover] = await Promise.all([
        buildWorkPlan({ monthOffset: Number(month), technicians: Number(techs) }),
        planCoverage(),
      ]);
      setPlan(built);
      setCoverage(cover);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, techs]);

  useEffect(() => { void load(); }, [load]);

  const busyDays = plan?.days.filter((d) => d.visitCount > 0) ?? [];
  const quietDays = (plan?.days.length ?? 0) - busyDays.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Work planner' }} />
      <Screen>
        <Segmented
          value={month}
          onChange={setMonth}
          options={[
            { value: '0', label: 'This month' },
            { value: '1', label: 'Next month' },
            { value: '2', label: 'The one after' },
          ]}
        />
        <View style={{ gap: t.space(1.5) }}>
          <Label>Technicians available</Label>
          <Segmented
            value={techs}
            onChange={setTechs}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ]}
          />
        </View>

        {error ? (
          <Banner tone="fail" title="The plan could not be built" body={error} />
        ) : null}

        {loading && !plan ? (
          <Card><Txt tone="muted">Working out the month…</Txt></Card>
        ) : null}

        {plan ? (
          <>
            <Card>
              <Txt weight="700" size="lg">{plan.window.label}</Txt>
              <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>{planHeadline(plan)}</Txt>
              <Rowed gap={2} style={{ marginTop: t.space(3) }}>
                <StatTile label="Visits" value={plan.summary.visits} />
                <StatTile label="Hours (est.)" value={plan.summary.estimatedHours} tone="accent" />
                <StatTile
                  label="Load"
                  value={`${Math.round(plan.summary.utilisation * 100)}%`}
                  tone={plan.summary.utilisation > 0.95 ? 'fail' : plan.summary.utilisation > 0.8 ? 'warn' : 'default'}
                />
              </Rowed>
              <Rowed gap={2} style={{ marginTop: t.space(2) }}>
                <StatTile label="Working days" value={plan.summary.workingDays} />
                <StatTile
                  label="Urgent"
                  value={plan.summary.urgentVisits}
                  tone={plan.summary.urgentVisits ? 'fail' : 'default'}
                />
                <StatTile
                  label="Unplanned"
                  value={plan.summary.unplanned}
                  tone={plan.summary.unplanned ? 'warn' : 'default'}
                />
              </Rowed>
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(2.5), lineHeight: 17 }}>
                {ESTIMATE_CAVEAT}
              </Txt>
            </Card>

            {plan.summary.urgentVisits ? (
              <Banner
                tone="fail"
                title={`${plan.summary.urgentVisits} visit${plan.summary.urgentVisits === 1 ? '' : 's'} already outside tolerance`}
                body="Placed on the earliest working day available and not batched by suburb. Being late costs more than the driving does."
              />
            ) : null}

            {coverage ? <CoverageNote coverage={coverage} /> : null}

            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <Button
                  title={showWorkings ? 'Hide the reasoning' : 'How this was worked out'}
                  variant="secondary"
                  compact
                  onPress={() => setShowWorkings((v) => !v)}
                />
              </View>
              <Button title="Rebuild" variant="ghost" compact onPress={() => void load()} />
            </Rowed>

            {showWorkings ? (
              <Card>
                {plan.notes.map((note) => (
                  <Rowed key={note} gap={2} align="flex-start" style={{ marginBottom: t.space(2) }}>
                    <MaterialCommunityIcons name="information-outline" size={16} color={t.color.textFaint} />
                    <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{note}</Txt>
                  </Rowed>
                ))}
                {plan.clusters.length ? (
                  <>
                    <Divider />
                    <Label>How the work was grouped</Label>
                    {plan.clusters.map((cluster) => (
                      <View key={cluster.id} style={{ marginTop: t.space(2) }}>
                        <Rowed gap={2}>
                          <Txt size="sm" weight="700">{cluster.label}</Txt>
                          <Chip
                            label={CLUSTER_METHOD_LABEL[cluster.method]}
                            tone={cluster.method === 'locality' ? 'pass' : 'warn'}
                          />
                        </Rowed>
                        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{cluster.basis}</Txt>
                      </View>
                    ))}
                  </>
                ) : null}
              </Card>
            ) : null}

            {busyDays.length ? (
              <>
                <H2>The month</H2>
                {busyDays.map((day) => <DayCard key={day.date} day={day} />)}
                {quietDays ? (
                  <Txt size="sm" tone="faint" style={{ lineHeight: 19 }}>
                    {quietDays} working day{quietDays === 1 ? '' : 's'} in {plan.window.label} carry no planned work.
                    That is capacity for project work, callouts and the sites listed below as unplanned.
                  </Txt>
                ) : null}
              </>
            ) : (
              <EmptyState
                title={`Nothing planned for ${plan.window.label}`}
                body={
                  plan.summary.unplanned
                    ? 'Everything due this window is in the list below, with the reason it could not be placed.'
                    : 'Nothing falls due inside this window. Routines only plan once they have a service recorded to count from.'
                }
              />
            )}

            {plan.unplanned.length ? <UnplannedSection plan={plan} /> : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

function CoverageNote({ coverage }: { coverage: PlanCoverage }) {
  const missingAssets = coverage.sites - coverage.sitesWithAssets;
  if (!coverage.sites || missingAssets <= 0) return null;
  return (
    <Banner
      tone="warn"
      title={`${missingAssets} of ${coverage.sites} sites have no asset register`}
      body="A visit to one of those cannot be sized, so it is left out of the plan rather than given an invented half day. A quiet month may only mean a thin register."
    />
  );
}

function DayCard({ day }: { day: PlannedDay }) {
  const t = useTheme();
  const tone = day.utilisation > 1 ? 'fail' : day.utilisation > 0.9 ? 'warn' : 'pass';

  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }}>
        <View>
          <Txt weight="700">{day.weekday} {day.dateAu}</Txt>
          <Txt size="xs" tone="faint">
            {day.clusterLabels.join(' · ') || 'No locality'}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt weight="700" tone={tone}>{formatHours(day.hours)}</Txt>
          <Txt size="xs" tone="faint">of {formatHours(day.capacityHours)} · estimated</Txt>
        </View>
      </Rowed>

      <LoadBar fraction={day.utilisation} tone={tone} />

      {day.technicians.filter((tech) => tech.visits.length).map((tech) => (
        <View key={tech.index} style={{ marginTop: t.space(3), gap: t.space(2) }}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Label>{tech.label}</Label>
            <Txt size="xs" tone="faint">{formatHours(tech.hours)} estimated</Txt>
          </Rowed>
          {tech.visits.map((visit) => <VisitRow key={visit.id} visit={visit} />)}
        </View>
      ))}
    </Card>
  );
}

function LoadBar({ fraction, tone }: { fraction: number; tone: 'pass' | 'warn' | 'fail' }) {
  const t = useTheme();
  const colour = { pass: t.color.pass, warn: t.color.warn, fail: t.color.fail }[tone];
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: t.color.surfaceAlt,
        marginTop: t.space(2),
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
          height: 6,
          backgroundColor: colour,
        }}
      />
    </View>
  );
}

function VisitRow({ visit }: { visit: PlannedVisit }) {
  const t = useTheme();
  return (
    <Card
      style={{ backgroundColor: t.color.surfaceAlt }}
      onPress={() => router.push({ pathname: '/site/[id]', params: { id: visit.siteId } })}
    >
      <Rowed align="flex-start" gap={2}>
        <MaterialCommunityIcons
          name={visit.urgent ? 'alert-decagram-outline' : 'map-marker-outline'}
          size={20}
          color={visit.urgent ? t.color.fail : t.color.textFaint}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{visit.siteName}</Txt>
          <Txt size="sm" tone="muted">
            {visit.routines.map((r) => r.routineLabel ?? `${FREQUENCY_LABEL[r.frequency]} ${r.system}`).join(' · ')}
          </Txt>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            {visit.urgent ? <Chip label="Outside tolerance" tone="fail" /> : null}
            <Chip label={`≈ ${formatHours(visit.hours.hours)} est.`} />
            <Chip label={visit.clusterLabel} tone={visit.clusterMethod === 'locality' ? 'default' : 'warn'} />
            {visit.daysOfMargin !== undefined && visit.daysOfMargin >= 0 ? (
              <Chip
                label={`${visit.daysOfMargin} day${visit.daysOfMargin === 1 ? '' : 's'} of margin`}
                tone={visit.daysOfMargin < 5 ? 'warn' : 'default'}
              />
            ) : null}
            {visit.hours.partial ? <Chip label="Estimate incomplete" tone="warn" /> : null}
          </Rowed>
          {visit.hours.partial ? (
            <Txt size="xs" tone="warn" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
              Not counted in the estimate: {visit.hours.notCosted.join(', ')}. The real visit is longer than this.
            </Txt>
          ) : null}
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
            {visit.hours.basis.join(' · ')}
          </Txt>
        </View>
      </Rowed>
    </Card>
  );
}

function UnplannedSection({ plan }: { plan: WorkPlan }) {
  const t = useTheme();
  const byReason = new Map<UnplannableReason, typeof plan.unplanned>();
  for (const item of plan.unplanned) {
    byReason.set(item.reason, [...(byReason.get(item.reason) ?? []), item]);
  }

  return (
    <>
      <H2>Not planned</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Everything due that could not be placed, with the reason. This list is the point of the screen as much as the
        month is — work that quietly falls out of a plan is work nobody does.
      </Txt>
      {[...byReason.entries()].map(([reason, items]) => (
        <Card key={reason}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <Txt weight="700">{UNPLANNABLE_REASON_LABEL[reason]}</Txt>
            <Chip label={String(items.length)} tone="warn" />
          </Rowed>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
            {items[0]?.detail}
          </Txt>
          <Divider />
          {items.slice(0, 25).map((item) => (
            <Rowed key={`${item.siteId}:${item.routineId}`} gap={2} align="flex-start" style={{ marginTop: t.space(1.5) }}>
              <View style={{ flex: 1 }}>
                <Txt size="sm" weight="600">{item.siteName ?? item.siteId}</Txt>
                <Txt size="xs" tone="muted">
                  {item.routineLabel ?? item.routineId} · {FREQUENCY_LABEL[item.frequency]}
                  {item.latestSafeDate ? ` · in tolerance until ${item.latestSafeDate.slice(8, 10)}/${item.latestSafeDate.slice(5, 7)}/${item.latestSafeDate.slice(0, 4)}` : ''}
                </Txt>
              </View>
            </Rowed>
          ))}
          {items.length > 25 ? (
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
              and {items.length - 25} more.
            </Txt>
          ) : null}
        </Card>
      ))}
    </>
  );
}
