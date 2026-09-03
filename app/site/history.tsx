import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { listRoutineRuns, type RoutineRun } from '@/db/routineRunRepo';
import { getSite } from '@/db/repo';
import { RUN_STATUS_LABEL, assessRunHistory, type RunStatus } from '@/domain/schedule';
import { FREQUENCY_LABEL, routineById, type Frequency } from '@/seed/serviceRoutines';
import { formatAuDate } from '@/export/sheets';
import type { Site } from '@/domain/types';
import {
  Banner, Card, Chip, Divider, EmptyState, H2, Rowed, Screen, Txt,
} from '@/components/ui';
import { describeLoadFailure } from '@/domain/loadFailure';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';

/**
 * What has actually been done at a site, and whether it was done on time.
 *
 * The app already records every routine run and already knows the schedule, so
 * this is the question those two answer together: not "when is the next one
 * due" but "has this site been serviced within tolerance, service after
 * service".
 *
 * Each run is measured against the date the schedule called for, never against
 * the service before it. Judged against the previous service, any amount of
 * accumulated drift looks compliant — every service is roughly a year after the
 * last one however far the whole sequence has slid. Judged against the anchor,
 * the drift shows.
 */

const TONE: Record<RunStatus, 'pass' | 'warn' | 'fail' | 'muted'> = {
  anchor: 'muted',
  'in-tolerance': 'pass',
  early: 'warn',
  late: 'fail',
  unknown: 'muted',
};

const SHORT: Record<RunStatus, string> = {
  anchor: 'First',
  'in-tolerance': 'On time',
  early: 'Early',
  late: 'Late',
  unknown: 'No window',
};

export default function SiteHistoryScreen() {
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);

  // "Nothing recorded here yet" reads as a site with no service history, which
  // is a very different thing from a history nobody could read.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    setFailed(null);
    try {
      const [s, r] = await Promise.all([getSite(siteId), listRoutineRuns(siteId)]);
      setSite(s);
      setRuns(r);
    } catch (e) {
      setRuns([]);
      setFailed(describeLoadFailure(e, "this site's service history"));
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Grouped by routine, because tolerance only means anything within one.
   *
   * A site's monthly and its annual have separate anchors and separate windows;
   * interleaving them and calling the earliest one the anchor would measure
   * every annual against a monthly schedule.
   */
  const byRoutine = useMemo(() => {
    const groups = new Map<string, RoutineRun[]>();
    for (const run of runs) {
      const list = groups.get(run.routineId) ?? [];
      list.push(run);
      groups.set(run.routineId, list);
    }
    return [...groups.entries()].map(([routineId, list]) => {
      const routine = routineById(routineId);
      const frequency = (routine?.frequency ?? list[0]!.frequency) as Frequency;
      const assessed = assessRunHistory(list, frequency);
      const byDate = new Map(list.map((r) => [r.completedAt, r]));
      return {
        routineId,
        label: routine?.label ?? list[0]!.routineLabel,
        frequency,
        // Newest first: the last service is the one being asked about.
        rows: [...assessed].reverse().map((a) => ({ ...a, run: byDate.get(a.completedAt) })),
        late: assessed.filter((a) => a.status === 'late').length,
      };
    });
  }, [runs]);

  const late = byRoutine.reduce((n, g) => n + g.late, 0);

  if (!siteId) return <ContextGate kind="site" what="every routine carried out" title="Service history" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Service history' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Every routine carried out at {site?.name ?? 'this site'}, measured against the date the
          schedule called for rather than against the service before it.
        </Txt>

        {failed ? (
          <Banner tone="fail" title="The history could not be read" body={failed} />
        ) : !runs.length ? (
          <EmptyState
            title="Nothing recorded here yet"
            body="A routine run from this app is recorded automatically. Services carried out before the app was in use are not here unless they were imported."
          />
        ) : null}

        {late ? (
          <Banner
            tone="warn"
            title={`${late} service${late === 1 ? '' : 's'} fell outside tolerance`}
            body={
              'Measured against the previous service each of these looks about right. They are only '
              + 'visible because every run is measured from the first service at this site, which is '
              + 'what stops drift accumulating unnoticed.'
            }
          />
        ) : null}

        {byRoutine.map((group) => (
          <View key={group.routineId}>
            <H2>{group.label}</H2>
            <Card>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Txt size="sm" tone="muted">{FREQUENCY_LABEL[group.frequency] ?? group.frequency}</Txt>
                <Txt size="sm" tone={group.late ? 'warn' : 'muted'}>
                  {group.rows.length} recorded{group.late ? `, ${group.late} late` : ''}
                </Txt>
              </Rowed>
              {group.rows.map((row, i) => (
                <View key={row.completedAt}>
                  {i > 0 ? <Divider /> : null}
                  <Rowed gap={2} align="flex-start" style={{ marginTop: i > 0 ? 0 : 10 }}>
                    <Chip label={SHORT[row.status]} tone={TONE[row.status]} />
                    <View style={{ flex: 1 }}>
                      <Txt size="sm">{formatAuDate(row.completedAt)}</Txt>
                      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                        {row.scheduledFor
                          ? `Due ${formatAuDate(row.scheduledFor)}${
                            row.daysFromScheduled
                              ? ` · ${Math.abs(row.daysFromScheduled)} day${
                                Math.abs(row.daysFromScheduled) === 1 ? '' : 's'
                              } ${row.daysFromScheduled > 0 ? 'later' : 'earlier'}`
                              : ' · on the day'
                          }`
                          : RUN_STATUS_LABEL[row.status]}
                      </Txt>
                      {row.run ? (
                        <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
                          {row.run.checksPassed} passed, {row.run.checksFailed} failed,{' '}
                          {row.run.checksNotTested} not tested
                          {row.run.defectsRaised
                            ? ` · ${row.run.defectsRaised} defect${row.run.defectsRaised === 1 ? '' : 's'} raised`
                            : ''}
                          {row.run.technician ? ` · ${row.run.technician}` : ''}
                        </Txt>
                      ) : null}
                    </View>
                  </Rowed>
                </View>
              ))}
            </Card>
          </View>
        ))}

        {runs.length ? (
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Tolerances come from the AS 1851 Section 6 schedule tables. A frequency with no table
            behind it says so rather than being given the nearest one — a quarterly routine measured
            against a yearly tolerance would report a compliance it has no basis for.
          </Txt>
        ) : null}
      </Screen>
    </>
  );
}
