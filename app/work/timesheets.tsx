import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { createTimesheet, listTimesheets } from '@/db/timesheetRepo';
import { timesheetTotals, type Timesheet } from '@/domain/timesheet';
import { loadPrefs } from '@/app-prefs';
import { qldIsoDay } from '@/domain/qldTime';
import { nowIso } from '@/db';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';
import { describeLoadFailure } from '@/domain/loadFailure';

/** Weekly timesheets, newest first. */
export default function TimesheetsScreen() {
  const t = useTheme();
  const [sheets, setSheets] = useState<Timesheet[]>([]);

  // A week that will not load is a week somebody re-enters from memory, so the
  // empty state is withheld until the read has actually answered.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setSheets(await listTimesheets());
    } catch (e) {
      setSheets([]);
      setFailed(describeLoadFailure(e, 'your timesheets'));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const startWeek = async () => {
    const prefs = await loadPrefs();
    // The Monday of the current Queensland week. Built from the Queensland
    // calendar day rather than the device clock: before 10am a UTC day is
    // still yesterday here, and a week that starts on Sunday reads as wrong.
    // qldIsoDay only refuses an unparseable instant, and nowIso() never is one.
    const todayIso = qldIsoDay(nowIso());
    if (!todayIso) return;
    const noon = new Date(`${todayIso}T12:00:00Z`);
    const weekday = noon.getUTCDay();
    noon.setUTCDate(noon.getUTCDate() - ((weekday + 6) % 7));
    const monday = noon.toISOString().slice(0, 10);

    const sheet = await createTimesheet({
      weekStarting: monday,
      employeeName: prefs.technicianName,
      vehicleRego: prefs.vehicleRego,
    });
    router.push({ pathname: '/timesheet/[id]', params: { id: sheet.id } });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Timesheets' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={sheets}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(20) }}
          ListHeaderComponent={(
            <>
              <Button title="Start this week" onPress={startWeek} />
              {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
            </>
          )}
          ListEmptyComponent={failed ? null : <EmptyState title="No timesheets yet" body="Start a week and fill it in as you go, rather than reconstructing it on Friday afternoon." />}
          renderItem={({ item }) => {
            const totals = timesheetTotals(item);
            return (
              <Card onPress={() => router.push({ pathname: '/timesheet/[id]', params: { id: item.id } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700">Week of {formatAuDate(item.weekStarting)}</Txt>
                    <Txt size="sm" tone="muted">{item.employeeName || 'No name set'}</Txt>
                    <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
                      <Chip label={`${totals.ord} ord`} />
                      {totals.ot ? <Chip label={`${totals.ot} O/T`} tone="warn" /> : null}
                      {totals.dt ? <Chip label={`${totals.dt} D/T`} tone="warn" /> : null}
                      <Chip label={`${totals.grand} total`} tone="accent" />
                    </Rowed>
                  </View>
                  <Chip label={item.status === 'submitted' ? 'Submitted' : 'Draft'} tone={item.status === 'submitted' ? 'pass' : 'warn'} />
                </Rowed>
              </Card>
            );
          }}
        />
      </Screen>
    </>
  );
}
