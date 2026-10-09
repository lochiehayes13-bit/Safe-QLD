import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createReport, listPanels, listReports, listSitePicks, type SitePick } from '@/db/repo';
import type { ServiceFrequency, ServiceReport } from '@/domain/types';
import { TEST_SHEET_FREQUENCIES, frequencyLabel, newTestSheetInput, sheetMatches } from '@/domain/testSheet';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Label, Rowed, Screen, SearchBox, Txt } from '@/components/ui';
import { SitePicker } from '@/components/SitePicker';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { needsSiteState } from '@/domain/deviceData';
import { loadPrefs } from '@/app-prefs';
import { everSynced } from '@/simpro/watermark';
import { showAlert } from '@/components/alert';

export default function ReportsScreen() {
  const t = useTheme();
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [sites, setSites] = useState<SitePick[]>([]);
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const [query, setQuery] = useState('');
  /** Choosing the site for a new sheet. */
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  /** The interval a sheet started from the picker opens with. It can be changed on the sheet. */
  const [frequency, setFrequency] = useState<ServiceFrequency>('annual');

  // An empty list here reads as "no sheets started". A read that threw has to
  // say so, or a technician looking for last week's sheet concludes it is gone.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const [r, s] = await Promise.all([listReports(), listSitePicks()]);
      setReports(r);
      setSites(s);
    } catch (e) {
      setReports([]);
      setFailed(describeLoadFailure(e, 'the test sheets'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(
    () => reports.filter((r) => sheetMatches(r, siteById.get(r.siteId), query)),
    [reports, siteById, query],
  );

  /** The sites of the latest sheets, offered first in the picker. */
  const recentSites = useMemo(() => [...new Set(reports.map((r) => r.siteId))].slice(0, 8), [reports]);

  const startFor = async (siteId: string) => {
    setStarting(true);
    try {
      const panels = await listPanels(siteId);
      const report = await createReport(newTestSheetInput({
        siteId,
        panelIds: panels.map((p) => p.id),
        today: qldIsoDay(nowIso()) ?? '',
        frequency,
      }));
      setPicking(false);
      router.push({ pathname: '/report/[id]', params: { id: report.id } });
    } catch (e) {
      showAlert('Test sheet not started', describeActionFailure(e, 'start the test sheet'));
    } finally {
      setStarting(false);
    }
  };

  const start = async () => {
    try {
      const all = await listSitePicks();
      setSites(all);
      if (!all.length) {
        const prefs = await loadPrefs();
        const words = needsSiteState(
          { held: 0, connected: Boolean(prefs.simproClientId && prefs.simproCompanyId), everSynced: await everSynced() },
          'A test sheet',
        );
        showAlert(words.title, words.body, words.action
          ? [{ text: words.action.label, onPress: () => router.push(words.action!.route) }, { text: 'Not now', style: 'cancel' }]
          : undefined);
        return;
      }
      if (all.length === 1) { await startFor(all[0]!.id); return; }
      setFrequency('annual');
      setPicking(true);
    } catch (e) {
      showAlert('Test sheet not started', describeActionFailure(e, 'read the sites'));
    }
  };

  if (picking) {
    return (
      <>
        <Stack.Screen options={{ title: 'Which site?' }} />
        <Screen>
          <Label>Frequency</Label>
          <Rowed gap={2} wrap>
            {TEST_SHEET_FREQUENCIES.map((f) => (
              <Chip key={f.value} label={f.label} selected={frequency === f.value} onPress={() => setFrequency(f.value)} />
            ))}
          </Rowed>
          <SitePicker sites={sites} suggested={recentSites} onChange={(siteId: string) => { void startFor(siteId); }} />
          <Button title="Cancel" variant="ghost" onPress={() => setPicking(false)} disabled={starting} />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Test sheets' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={(
            <View style={{ gap: t.space(3) }}>
              <Button
                title="Start test sheet"
                icon={<MaterialCommunityIcons name="plus" size={18} color={t.color.onAccent} />}
                onPress={() => { void start(); }}
                loading={starting}
              />
              {failed ? (
                <>
                  <Banner tone="fail" title="List not loaded" body={failed} />
                  <Button title="Try again" variant="secondary" onPress={() => { void load(); }} />
                </>
              ) : null}
              {reports.length ? (
                <SearchBox value={query} onChange={setQuery} placeholder="Site, suburb, job or technician" />
              ) : null}
            </View>
          )}
          ListEmptyComponent={failed ? null : reports.length ? (
            <EmptyState icon="magnify" title="Nothing matches" body="Try the site, suburb, job number or technician." />
          ) : (
            <EmptyState icon="clipboard-text-outline" title="No test sheets yet" body="Start one here or from a site." />
          )}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.id } })}>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700" numberOfLines={1}>{item.title}</Txt>
                  <Txt size="sm" tone="muted" numberOfLines={1}>{siteById.get(item.siteId)?.name ?? 'Unknown site'}</Txt>
                  <Txt size="sm" tone="faint">
                    {[
                      frequencyLabel(item.frequency),
                      formatAuDate(item.serviceDate),
                      item.jobNumber ? `Job ${item.jobNumber}` : '',
                      item.technicianName ?? '',
                    ].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
                <Chip label={item.status === 'complete' ? 'Complete' : 'Draft'} tone={item.status === 'complete' ? 'pass' : 'warn'} />
              </Rowed>
            </Card>
          )}
        />
      </Screen>
    </>
  );
}
