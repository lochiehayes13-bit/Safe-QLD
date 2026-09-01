import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { lapsedEverywhere, type SiteDue } from '@/db/routineRunRepo';
import { DUE_LABEL } from '@/domain/schedule';
import { FREQUENCY_LABEL, routineById } from '@/seed/serviceRoutines';
import { SYSTEM_LABELS } from '@/seed/assetTypes';
import { formatAuDate } from '@/export/sheets';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Everything that has lapsed, across every site.
 *
 * The office's version of the question a technician asks per site. It shows
 * only routines with a history that has since lapsed: a site that has never had
 * a given routine recorded would otherwise contribute a row per routine, which
 * across a book of sites buries the handful that genuinely went overdue. Those
 * still appear on the site's own list, where they mean something — and the
 * empty state says so rather than letting silence read as compliance.
 */
export default function LapsedScreen() {
  const t = useTheme();
  const [items, setItems] = useState<SiteDue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await lapsedEverywhere(nowIso()));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const overdue = items.filter((i) => i.state === 'overdue').length;

  return (
    <>
      <Stack.Screen options={{ title: 'Overdue and due' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(3) }}>
          {items.length ? (
            <Banner
              tone={overdue ? 'fail' : 'warn'}
              title={
                overdue
                  ? `${overdue} routine${overdue === 1 ? '' : 's'} past their tolerance window`
                  : `${items.length} routine${items.length === 1 ? '' : 's'} due now`
              }
              body="Counted from the first service recorded at each site, so a service carried out late does not push the next one back with it."
            />
          ) : null}
        </View>

        <FlatList
          data={items}
          keyExtractor={(i) => `${i.siteId}:${i.routineId}`}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title="Nothing lapsed"
                body="No routine with a recorded history has gone past its window. This does not cover routines never recorded at a site — those are on each site's own due list, and a site with no history at all will look quiet here."
              />
            )
          }
          renderItem={({ item }) => <LapsedRow due={item} />}
        />
      </Screen>
    </>
  );
}

function LapsedRow({ due }: { due: SiteDue }) {
  const t = useTheme();
  const routine = routineById(due.routineId);
  if (!routine) return null;

  const days = due.daysUntilDue;

  return (
    <Card
      onPress={() =>
        router.push({ pathname: '/routine/run', params: { siteId: due.siteId, routineId: routine.id } })
      }
    >
      <Rowed align="flex-start" gap={2}>
        <View style={{ flex: 1 }}>
          <Txt weight="700">{due.siteName}</Txt>
          <Txt size="sm" tone="muted">{routine.label}</Txt>
          <Txt size="sm" tone="muted">
            {SYSTEM_LABELS[routine.system]} · {FREQUENCY_LABEL[routine.frequency]}
          </Txt>
          {due.scheduledFor ? (
            <Txt size="sm" tone={due.state === 'overdue' ? 'fail' : 'warn'} style={{ marginTop: 3 }}>
              Due {formatAuDate(due.scheduledFor)}
              {due.state === 'overdue' && days !== undefined
                ? ` — ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past its window`
                : ''}
            </Txt>
          ) : null}
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            <Chip label={DUE_LABEL[due.state]} tone={due.state === 'overdue' ? 'fail' : 'warn'} />
            {due.lastCompletedAt ? <Chip label={`Last ${formatAuDate(due.lastCompletedAt)}`} /> : null}
          </Rowed>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
