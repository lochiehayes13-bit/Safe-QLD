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
import { describeLoadFailure } from '@/domain/loadFailure';

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
  /*
   * A read that threw used to leave this list empty under "Nothing lapsed",
   * which is not a blank screen — it is the app telling an office that every
   * site is inside its window when it has no idea. The failure is on the screen
   * now, and the empty state is withheld until there is an answer to give.
   */
  const [failed, setFailed] = useState<string | null>(null);
  /*
   * The counts off the whole book, not off the page.
   *
   * The banner used to count the already-cut array, so a book with two
   * hundred and ten lapsed routines announced "200 routines past their
   * tolerance window" as a fact. The number a person acts on has to be the
   * truth about the work, not about the list.
   */
  const [counts, setCounts] = useState<{ overdue: number; due: number; capped: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const page = await lapsedEverywhere(nowIso());
      setItems(page.rows);
      setCounts(page);
    } catch (e) {
      setItems([]);
      setCounts(null);
      setFailed(describeLoadFailure(e, 'what has lapsed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const overdue = counts?.overdue ?? 0;
  const due = counts?.due ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Overdue and due' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(3) }}>
          {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
          {items.length ? (
            <Banner
              tone={overdue ? 'fail' : 'warn'}
              title={
                overdue
                  ? `${overdue} routine${overdue === 1 ? '' : 's'} past their tolerance window`
                  : `${due} routine${due === 1 ? '' : 's'} due now`
              }
              body={'Counted from the first service recorded at each site, so a service carried out late does not '
                + 'push the next one back with it.'
                + (counts?.capped
                  ? ` The ${(overdue + due).toLocaleString()} are counted in full; the ${items.length} most urgent are listed.`
                  : '')}
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
            loading || failed ? null : (
              <EmptyState
          icon="calendar-check-outline"
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
