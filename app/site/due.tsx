import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { dueAtSite } from '@/db/routineRunRepo';
import { getSite } from '@/db/repo';
import { DUE_LABEL, type DueState, type RoutineDue } from '@/domain/schedule';
import { FREQUENCY_LABEL, routineById } from '@/seed/serviceRoutines';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { formatAuDate } from '@/export/sheets';
import type { Site } from '@/domain/types';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { describeLoadFailure } from '@/domain/loadFailure';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';

/**
 * What is due at this site.
 *
 * The question a technician and an office both ask first, and the app could not
 * answer it: it recorded that individual devices were tested and never that the
 * routine itself had been carried out.
 *
 * Every routine appears, including ones with no run recorded. A site that has
 * never had its annual is the case most worth seeing, and a list built only
 * from what has been done would leave exactly that out.
 */
const TONE: Record<DueState, 'fail' | 'warn' | 'pass' | 'default'> = {
  overdue: 'fail',
  due: 'warn',
  'never-done': 'warn',
  upcoming: 'default',
  'not-scheduled': 'default',
};

export default function SiteDueScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [items, setItems] = useState<RoutineDue[]>([]);
  const [loading, setLoading] = useState(true);
  // An empty list here reads as "this site is up to date", so a read that threw
  // has to say so rather than let silence answer for it.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Clearing the flag on the way out matters even though the gate below now
    // returns first: a loader that can leave its own spinner up for ever is the
    // trap this screen was, and leaving the shape behind invites it back.
    if (!siteId) { setLoading(false); return; }
    setLoading(true);
    setFailed(null);
    try {
      const [s, due] = await Promise.all([getSite(siteId), dueAtSite(siteId, nowIso())]);
      setSite(s);
      setItems(due);
    } catch (e) {
      setItems([]);
      setFailed(describeLoadFailure(e, "this site's schedule"));
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  const overdue = items.filter((i) => i.state === 'overdue').length;
  const dueNow = items.filter((i) => i.state === 'due').length;

  if (!siteId) return <ContextGate kind="site" what="what is due" title="What is due" />;

  return (
    <>
      <Stack.Screen options={{ title: 'What is due' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(3) }}>
          {failed ? <Banner tone="fail" title="What is due could not be read" body={failed} /> : null}
          {overdue || dueNow ? (
            <Banner
              tone={overdue ? 'fail' : 'warn'}
              title={
                overdue
                  ? `${overdue} routine${overdue === 1 ? '' : 's'} overdue at ${site?.name ?? 'this site'}`
                  : `${dueNow} routine${dueNow === 1 ? '' : 's'} due now`
              }
              body="Scheduling counts from the first service recorded here, not the last one — so a service carried out late does not push the next one back with it."
            />
          ) : null}
        </View>

        <FlatList
          data={items}
          keyExtractor={(i) => i.routineId}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={
            loading || failed ? null
              : <EmptyState title="No routines" body="No service routines are defined for this build." />
          }
          renderItem={({ item }) => <DueRow due={item} siteId={siteId} />}
        />
      </Screen>
    </>
  );
}

function DueRow({ due, siteId }: { due: RoutineDue; siteId?: string }) {
  const t = useTheme();
  const routine = routineById(due.routineId);
  if (!routine) return null;

  const days = due.daysUntilDue;
  const when =
    due.state === 'overdue' && days !== undefined
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past its window`
      : due.state === 'upcoming' && days !== undefined
        ? `in ${days} day${days === 1 ? '' : 's'}`
        : due.state === 'due'
          ? 'inside its tolerance window now'
          : null;

  return (
    <Card
      onPress={() =>
        router.push({ pathname: '/routine/run', params: { siteId: siteId ?? '', routineId: routine.id } })
      }
    >
      <Rowed align="flex-start" gap={2}>
        <View style={{ flex: 1 }}>
          <Txt weight="700">{routine.label}</Txt>
          <Txt size="sm" tone="muted">
            {SYSTEM_LABELS[routine.system]} · {FREQUENCY_LABEL[routine.frequency]}
          </Txt>
          {due.scheduledFor ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 3 }}>
              Due {formatAuDate(due.scheduledFor)}{when ? ` — ${when}` : ''}
            </Txt>
          ) : due.state === 'not-scheduled' ? (
            <Txt size="xs" tone="faint" style={{ marginTop: 3, lineHeight: 17 }}>
              No schedule table covers this frequency, so the app does not assert a due date for it.
            </Txt>
          ) : (
            <Txt size="sm" tone="warn" style={{ marginTop: 3 }}>
              No run recorded at this site.
            </Txt>
          )}
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            <Chip label={DUE_LABEL[due.state]} tone={TONE[due.state]} />
            {due.completedCount ? <Chip label={`${due.completedCount} recorded`} /> : null}
            {due.lastCompletedAt ? <Chip label={`Last ${formatAuDate(due.lastCompletedAt)}`} /> : null}
          </Rowed>
          {due.window ? (
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
              In tolerance {formatAuDate(due.window.earliest)} to {formatAuDate(due.window.latest)}
            </Txt>
          ) : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
