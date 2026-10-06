import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { createBaseline, listBaselines } from '@/db/baselineRepo';
import { listSitePicks, type SitePick } from '@/db/repo';
import { SitePicker } from '@/components/SitePicker';
import { completeness, type BaselineData } from '@/domain/baseline';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { needsSiteState } from '@/domain/deviceData';
import { loadPrefs } from '@/app-prefs';
import { everSynced } from '@/simpro/watermark';

/** Baseline data records across every site. */
export default function BaselinesScreen() {
  const t = useTheme();
  const [records, setRecords] = useState<BaselineData[]>([]);
  const [sites, setSites] = useState<Map<string, SitePick>>(new Map());

  const [failed, setFailed] = useState<string | null>(null);
  /** The sites to choose from, while a choice is being made. */
  const [picking, setPicking] = useState<SitePick[] | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [b, s] = await Promise.all([listBaselines(), listSitePicks()]);
      setRecords(b);
      setSites(new Map(s.map((x) => [x.id, x])));
    } catch (e) {
      setRecords([]);
      setFailed(describeLoadFailure(e, 'the baseline records on this device'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    const all = await listSitePicks();
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
    /*
     * Offered, not deferred.
     *
     * This said "Open the site and start baseline data from there" — a screen
     * that has the whole site list in hand telling somebody to go and find the
     * site themselves. It is the owner's ask in miniature: the site is right
     * here and the module would not give it to you.
     */
    setPicking(all);
  };

  /*
   * Choosing which site, when more than one could be meant.
   *
   * Its own view rather than a modal, because this screen is a FlatList and a
   * picker inside a list header is a picker that scrolls away while you are
   * reading it. The same SitePicker the rest of the app uses, so the search
   * covers everything a site search covers.
   */
  if (picking) {
    return (
      <>
        <Stack.Screen options={{ title: 'Which site?' }} />
        <Screen>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Baseline data records what a system read when it was known good, so later tests have
            something to be compared against. Pick the building this one is for.
          </Txt>
          <SitePicker
            sites={picking}
            onChange={(siteId: string) => {
              setPicking(null);
              void (async () => {
                try {
                  const rec = await createBaseline(siteId);
                  router.push({ pathname: '/baseline/[id]', params: { id: rec.id } });
                } catch (e) {
                  showAlert('Could not start it', describeActionFailure(e, 'start a baseline record'));
                }
              })();
            }}
          />
          <Button title="Never mind" variant="ghost" onPress={() => setPicking(null)} />
        </Screen>
      </>
    );
  }

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
          icon="file-table-outline"
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
