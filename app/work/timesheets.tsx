import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { createTimesheet, listTimesheets, saveTimesheet } from '@/db/timesheetRepo';
import { copyForNextWeek, timesheetTotals, weekStartFor, type Timesheet } from '@/domain/timesheet';
import { loadPrefs } from '@/app-prefs';
import { qldIsoDay } from '@/domain/qldTime';
import { newId, nowIso } from '@/db';
import { addDays } from '@/domain/clockOn';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { Banner, Button, Card, Chip, EmptyState, H2, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Weekly timesheets, newest first.
 *
 * Three things this screen used to get wrong, all of which cost somebody a
 * Friday afternoon.
 *
 * It made a second sheet. "Start this week" created one unconditionally, so
 * tapping it on Thursday when Wednesday's sheet already existed produced an
 * empty duplicate for the same week — and the office received whichever one
 * happened to be emailed. It now opens the week that exists.
 *
 * It could not copy last week. `copyForNextWeek` was written and tested and
 * nothing called it, so every week was typed again from nothing even though
 * most technicians are at the same sites on the same days.
 *
 * And it could only ever make the current week. A sheet filled in on Monday
 * for the week that just closed had no way to exist, which is exactly when
 * most of them get filled in.
 */
export default function TimesheetsScreen() {
  const t = useTheme();
  const [sheets, setSheets] = useState<Timesheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickingWeek, setPickingWeek] = useState(false);

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

  // The start of the current Queensland pay week — Wednesday, see weekStartFor.
  // Built from the Queensland calendar day rather than the device clock: before
  // 10am a UTC day is still yesterday here. qldIsoDay only refuses an
  // unparseable instant, and nowIso() never is one.
  const todayIso = qldIsoDay(nowIso()) ?? '';
  const thisWeek = weekStartFor(todayIso);

  /** This week, then the four behind it, then the one ahead. */
  const weeks = useMemo(() => {
    if (!thisWeek) return [];
    const out = [thisWeek];
    for (let i = 1; i <= 4; i += 1) out.push(addDays(thisWeek, -7 * i));
    out.push(addDays(thisWeek, 7));
    return out;
  }, [thisWeek]);

  const byWeek = useMemo(() => new Map(sheets.map((s) => [s.weekStarting, s])), [sheets]);

  /**
   * Opens the week, making it only if it is not already there.
   *
   * The lookup is against the list this screen already holds rather than a
   * fresh read: two sheets for one week is the fault being fixed, and the
   * list was read on focus.
   */
  const openWeek = async (weekStarting: string) => {
    setPickingWeek(false);
    const existing = byWeek.get(weekStarting);
    if (existing) {
      router.push({ pathname: '/timesheet/[id]', params: { id: existing.id } });
      return;
    }
    setBusy(true);
    try {
      const prefs = await loadPrefs();
      const sheet = await createTimesheet({
        weekStarting,
        employeeName: prefs.technicianName,
        vehicleRego: prefs.vehicleRego,
      });
      router.push({ pathname: '/timesheet/[id]', params: { id: sheet.id } });
    } catch (e) {
      showAlert('Could not start the week', describeActionFailure(e, 'starting the week'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Last week again, as a starting point.
   *
   * Carries the jobs, the sites, the times, the hour kind and the allowances,
   * and carries none of the things that assert something happened — the
   * service report numbers, the leave hours, the overrides. Those are claims
   * about a week that has not been worked yet.
   */
  const copyLastWeek = async () => {
    if (!thisWeek) return;
    const previous = sheets.find((s) => s.weekStarting < thisWeek && s.entries.length);
    if (!previous) {
      showAlert('Nothing to copy', 'There is no earlier week on this phone with anything on it.');
      return;
    }
    setBusy(true);
    try {
      const prefs = await loadPrefs();
      const existing = byWeek.get(thisWeek);
      const entries = copyForNextWeek(previous, thisWeek, newId);
      if (existing) {
        if (existing.entries.length) {
          showAlert(
            'This week already has work on it',
            'Copying last week over the top would lose what is already here. Open the week and copy a day at a time instead.',
          );
          return;
        }
        await saveTimesheet({ ...existing, entries });
        router.push({ pathname: '/timesheet/[id]', params: { id: existing.id } });
        return;
      }
      const sheet = await createTimesheet({
        weekStarting: thisWeek,
        employeeName: prefs.technicianName,
        vehicleRego: prefs.vehicleRego,
        entries,
      });
      router.push({ pathname: '/timesheet/[id]', params: { id: sheet.id } });
    } catch (e) {
      showAlert('Could not copy it', describeActionFailure(e, 'copying last week'));
    } finally {
      setBusy(false);
    }
  };

  const currentSheet = thisWeek ? byWeek.get(thisWeek) : undefined;
  const canCopy = Boolean(thisWeek && sheets.some((s) => s.weekStarting < thisWeek && s.entries.length));

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
              <Button
                title={currentSheet ? 'Open this week' : 'Start this week'}
                loading={busy}
                onPress={() => { if (thisWeek) void openWeek(thisWeek); }}
              />
              {canCopy && (!currentSheet || currentSheet.entries.length === 0) ? (
                <Button title="Copy last week into this one" variant="secondary" onPress={() => { void copyLastWeek(); }} />
              ) : null}
              <Button
                title={pickingWeek ? 'Never mind' : 'Another week'}
                variant="ghost"
                onPress={() => setPickingWeek((p) => !p)}
              />
              {pickingWeek ? (
                <Card>
                  <Txt size="sm" tone="muted" style={{ marginBottom: t.space(2) }}>
                    Weeks run Wednesday to Tuesday. A week that already has a sheet opens it rather than starting a second one.
                  </Txt>
                  <Rowed gap={2} wrap>
                    {weeks.map((w) => (
                      <Chip
                        key={w}
                        label={`${formatAuDate(w)}${byWeek.has(w) ? ' ·' : ''}`}
                        selected={w === thisWeek}
                        onPress={() => { void openWeek(w); }}
                      />
                    ))}
                  </Rowed>
                </Card>
              ) : null}
              {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}
              {sheets.length ? <H2>Your weeks</H2> : null}
            </>
          )}
          ListEmptyComponent={failed ? null : <EmptyState icon="calendar-clock" title="No timesheets yet" body="Start a week and fill it in as you go, rather than reconstructing it on Friday afternoon." />}
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
