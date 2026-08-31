import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { createTimesheet, listTimesheets } from '@/db/timesheetRepo';
import { timesheetTotals, type Timesheet } from '@/domain/timesheet';
import { loadPrefs } from '@/app-prefs';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/** Weekly timesheets, newest first. */
export default function TimesheetsScreen() {
  const t = useTheme();
  const [sheets, setSheets] = useState<Timesheet[]>([]);

  const load = useCallback(async () => setSheets(await listTimesheets()), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const startWeek = async () => {
    const prefs = await loadPrefs();
    // Weeks start on the Monday of the current week.
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));

    const sheet = await createTimesheet({
      weekStarting: monday.toISOString().slice(0, 10),
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
          ListHeaderComponent={<Button title="Start this week" onPress={startWeek} />}
          ListEmptyComponent={<EmptyState title="No timesheets yet" body="Start a week and fill it in as you go, rather than reconstructing it on Friday afternoon." />}
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
