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
import { needsSiteState } from '@/domain/deviceData';
import { loadPrefs } from '@/app-prefs';
import { everSynced } from '@/simpro/watermark';

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
      // Not "add a site first": on a device that has never been connected —
      // a browser, a new handset — the office's three thousand buildings are
      // one sync away, and telling somebody to type one in sends them the
      // wrong way. `needsSiteState` decides which of the two it is.
      const prefs = await loadPrefs();
      const words = needsSiteState(
        { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
        'Baseline data',
      );
      showAlert(words.title, words.body, words.action
        ? [{ text: words.action.label, onPress: () => router.push(words.action!.route) }, { text: 'Not now', style: 'cancel' }]
        : undefined);
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
