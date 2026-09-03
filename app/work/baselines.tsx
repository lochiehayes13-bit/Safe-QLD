import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { createBaseline, listBaselines } from '@/db/baselineRepo';
import { listSites } from '@/db/repo';
import { completeness, type BaselineData } from '@/domain/baseline';
import type { Site } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/** Baseline data records across every site. */
export default function BaselinesScreen() {
  const t = useTheme();
  const [records, setRecords] = useState<BaselineData[]>([]);
  const [sites, setSites] = useState<Map<string, Site>>(new Map());

  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [b, s] = await Promise.all([listBaselines(), listSites()]);
      setRecords(b);
      setSites(new Map(s.map((x) => [x.id, x])));
    } catch (e) {
      setRecords([]);
      setFailed(describeLoadFailure(e, 'the baseline records on this device'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    const all = await listSites();
    if (!all.length) {
      showAlert('No sites yet', 'Add a site first — baseline data belongs to a building.');
      return;
    }
    if (all.length === 1) {
      const rec = await createBaseline(all[0]!.id);
      router.push({ pathname: '/baseline/[id]', params: { id: rec.id } });
      return;
    }
    showAlert('Pick a site', 'Open the site and start baseline data from there.');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Baseline data' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={(
            <>
              <Button title="New baseline record" onPress={create} />
              {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
            </>
          )}
          ListEmptyComponent={failed ? null : (
            <EmptyState
              title="No baseline data yet"
              body="Baseline data records what the system looked like when it was commissioned, so later services have something to test against."
            />
          )}
          renderItem={({ item }) => {
            const c = completeness(item);
            return (
              <Card onPress={() => router.push({ pathname: '/baseline/[id]', params: { id: item.id } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700" numberOfLines={1}>{item.premisesName || sites.get(item.siteId)?.name || 'Untitled'}</Txt>
                    <Txt size="sm" tone="muted">{item.systemType || 'System not recorded'}</Txt>
                    <Txt size="sm" tone="faint">{formatAuDate(item.testDate)}</Txt>
                  </View>
                  <Chip
                    label={`${Math.round(c.fraction * 100)}%`}
                    tone={c.fraction === 1 ? 'pass' : c.fraction > 0.5 ? 'warn' : 'default'}
                  />
                </Rowed>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.color.surfaceAlt, marginTop: t.space(2), overflow: 'hidden' }}>
                  <View style={{ width: `${c.fraction * 100}%`, height: '100%', backgroundColor: c.fraction === 1 ? t.color.pass : t.color.accent }} />
                </View>
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
