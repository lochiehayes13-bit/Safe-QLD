import React, { useCallback, useEffect, useState } from 'react';
import { formatAuDate } from '@/export/sheets';
import { FlatList, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { coverageGaps, queryAssets, type CoverageGap } from '@/db/assetRepo';
import { assetTypeById } from '@/seed/assetTypes';
import { siteCoverageGaps, type SiteCoverageGap } from '@/domain/serviceCoverage';
import { useTheme } from '@/theme';
import { Banner, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * What did not get tested, and why.
 *
 * A failure raises a defect and a pass closes the item; an inaccessible device
 * does neither, and quietly leaves a hole in the year's coverage that nobody
 * chases. This is that hole. It is deliberately not a defect list — nothing
 * here is known to be faulty, which is exactly the problem.
 *
 * An asset leaves this list the moment it is actually tested, so it reflects
 * what is outstanding now rather than everything that was ever skipped.
 */
export default function CoverageScreen() {
  const t = useTheme();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  /*
   * A different kind of hole, and a quieter one. The list above is assets
   * somebody tried to test and could not reach. This is assets of a type no
   * routine in the app names at all — never attempted, so they produce no
   * result of any kind and cannot appear above however long they sit there.
   */
  const [unserviced, setUnserviced] = useState<SiteCoverageGap[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [found, assets] = await Promise.all([
        coverageGaps(siteId),
        siteId ? queryAssets({ siteId, limit: 10000 }) : queryAssets({ limit: 10000 }),
      ]);
      setGaps(found);
      setUnserviced(siteCoverageGaps(assets));
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  const repeated = gaps.filter((g) => g.attempts > 1).length;

  return (
    <>
      <Stack.Screen options={{ title: 'Not tested' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(3) }}>
          {gaps.length ? (
            <Banner
              tone={repeated ? 'fail' : 'warn'}
              title={`${gaps.length} asset${gaps.length === 1 ? '' : 's'} still untested`}
              body={
                repeated
                  ? `${repeated} of these have been skipped more than once. A device that cannot be reached two visits running is an access problem to raise with the occupier, not a scheduling one.`
                  : 'These were attempted and could not be tested. None of them is known to be faulty — that is what makes the gap worth closing.'
              }
            />
          ) : null}

          {unserviced.length ? (
            <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
              <Banner
                tone="fail"
                title={`${unserviced.reduce((n, g) => n + g.count, 0)} assets no routine will ever pick up`}
                body={'These are not overdue and they are not inaccessible — no routine in the app '
                  + 'names their type, so running one never visits them. They produce no result at '
                  + 'all, which is why they cannot appear in the list below.'}
              />
              {unserviced.map((g) => (
                <Card key={g.type.id}>
                  <Rowed gap={2}>
                    <MaterialCommunityIcons
                      name={g.type.icon as never}
                      size={20}
                      color={t.color.fail}
                    />
                    <View style={{ flex: 1 }}>
                      <Txt weight="600">{g.count}× {g.type.label}</Txt>
                      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{g.because}</Txt>
                    </View>
                  </Rowed>
                </Card>
              ))}
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                The app does not invent a check for these. The procedures live in AS 1851, which it
                does not reproduce — and an invented check on a service sheet is worse than a stated
                gap, because one gets chased and the other gets signed.
              </Txt>
            </View>
          ) : null}
        </View>

        <FlatList
          data={gaps}
          keyExtractor={(g) => g.assetId}
          contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20), gap: t.space(2) }}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title="Nothing outstanding"
                body="Every asset that was attempted has since been tested. Assets of a type no routine names are listed above instead, because they are never attempted at all."
              />
            )
          }
          renderItem={({ item }) => <GapRow gap={item} />}
        />
      </Screen>
    </>
  );
}

function GapRow({ gap }: { gap: CoverageGap }) {
  const t = useTheme();
  const type = assetTypeById(gap.assetTypeId);
  const where = [gap.level, gap.room].filter(Boolean).join(' · ');
  // The summary is written as "<check> — not tested: <reason>", so the reason
  // is the useful half to lead with.
  const reason = gap.reason.split('not tested:').pop()?.trim() || gap.reason;

  return (
    <Card onPress={() => router.push({ pathname: '/assets/[id]', params: { id: gap.assetId } })}>
      <Rowed align="flex-start" gap={2}>
        <MaterialCommunityIcons name="help-circle-outline" size={20} color={t.color.warn} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{gap.assetName}</Txt>
          <Txt size="sm" tone="muted">
            {[type?.label, gap.assetCode, where].filter(Boolean).join(' · ')}
          </Txt>
          <Txt size="sm" tone="warn" style={{ marginTop: 3, lineHeight: 19 }}>{reason}</Txt>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            <Chip label={formatAuDate(gap.occurredAt)} />
            {gap.attempts > 1 ? <Chip label={`${gap.attempts} attempts`} tone="fail" /> : null}
          </Rowed>
        </View>
      </Rowed>
    </Card>
  );
}
