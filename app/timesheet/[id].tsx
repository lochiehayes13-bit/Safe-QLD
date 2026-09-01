import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getTimesheet, saveTimesheet } from '@/db/timesheetRepo';
import { listSites } from '@/db/repo';
import {
  dayName, entryHours, groupByDate, timesheetTotals, validateTimesheet, weekDates,
  type HourKind, type Timesheet, type TimesheetEntry,
} from '@/domain/timesheet';
import { valueTimesheet } from '@/domain/timesheetValue';
import { effectiveRateCard, formatCents } from '@/domain/rates';
import { loadRateCard, type StoredRateCard } from '@/db/rateCardRepo';
import { loadPrefs, DEFAULT_PREFS, type Prefs } from '@/app-prefs';
import type { Site } from '@/domain/types';
import { timesheetSheet, timesheetSummarySheet } from '@/export/safeqldForms';
import { formatAuDate } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { newId } from '@/db';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * Weekly timesheet.
 *
 * Hours are derived from start and finish rather than typed, and the sheet
 * flags the things the office sends back — a malformed time, hours with no job
 * against them — before it is submitted rather than a week later.
 */
export default function TimesheetScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [busy, setBusy] = useState(false);
  const [showIssues, setShowIssues] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [card, setCard] = useState<StoredRateCard>({ rates: [], fees: [] });
  const [chargeAttendance, setChargeAttendance] = useState(false);
  const [showValue, setShowValue] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getTimesheet(id).then((found) => {
      setSheet(found);
      setMissing(!found);
    });
    void listSites().then(setSites);
    void loadPrefs().then(setPrefs);
    void loadRateCard().then(setCard);
  }, [id]);

  const update = useCallback((patch: Partial<Timesheet>) => {
    setSheet((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void saveTimesheet(next);
      return next;
    });
  }, []);

  const updateEntry = useCallback((entryId: string, patch: Partial<TimesheetEntry>) => {
    setSheet((prev) => {
      if (!prev) return prev;
      const next = { ...prev, entries: prev.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)) };
      void saveTimesheet(next);
      return next;
    });
  }, []);

  const totals = useMemo(() => (sheet ? timesheetTotals(sheet) : null), [sheet]);
  const issues = useMemo(() => (sheet ? validateTimesheet(sheet) : []), [sheet]);
  const days = useMemo(() => (sheet ? weekDates(sheet.weekStarting) : []), [sheet]);

  /**
   * The other side of the sheet: what the week's attendances are worth.
   *
   * A timesheet is a payroll document, so this is deliberately behind a tap and
   * labelled as an estimate. It exists because the figure otherwise arrives a
   * month later in the invoice run, by which time a week priced wrongly is
   * already history.
   */
  const value = useMemo(() => {
    if (!sheet) return null;
    const eff = effectiveRateCard(card, prefs);
    if (!eff.rates.length && !eff.fees.length) return null;
    return { ...valueTimesheet(sheet, { ...eff, chargeAttendance }), note: eff.note };
  }, [sheet, prefs, card, chargeAttendance]);

  const addEntry = (date: string) => {
    if (!sheet) return;
    const entry: TimesheetEntry = {
      id: newId(),
      date,
      jobNumber: '',
      siteName: '',
      serviceReportNumber: '',
      startTime: '',
      finishTime: '',
      hourKind: 'ord',
      sick: '',
      rdo: '',
      annual: '',
      lwop: '',
      comments: '',
    };
    update({ entries: [...sheet.entries, entry] });
  };

  const exportSheet = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const name = `Timesheet ${sheet.employeeName || ''} ${formatAuDate(sheet.weekStarting)}`.trim();
      const file = writeXlsx(name, [timesheetSheet(sheet), timesheetSummarySheet(sheet)]);
      await shareFile(file, 'Timesheet');
    } finally {
      setBusy(false);
    }
  };

  // `totals` is derived from the sheet, so a missing sheet is the only reason
  // both are absent — but a sheet that loaded with no derivable totals is a
  // different fault, and this does not claim the record is gone for it.
  if (!sheet) return <RecordGate missing={missing} what="timesheet" />;
  if (!totals) {
    return (
      <Screen>
        <Txt tone="muted">Working out the week&rsquo;s totals…</Txt>
      </Screen>
    );
  }

  const grouped = groupByDate(sheet.entries);
  const byDate = new Map(grouped.map((g) => [g.date, g.entries]));

  return (
    <>
      <Stack.Screen options={{ title: `Week of ${formatAuDate(sheet.weekStarting)}` }} />
      <Screen>
        <Rowed gap={2}>
          <StatTile label="Ordinary" value={totals.ord} />
          <StatTile label="Overtime" value={totals.ot} tone={totals.ot ? 'warn' : 'default'} />
          <StatTile label="Double" value={totals.dt} tone={totals.dt ? 'warn' : 'default'} />
          <StatTile label="Total" value={totals.grand} tone="accent" />
        </Rowed>

        {issues.length && showIssues ? (
          <Pressable onPress={() => setShowIssues(false)}>
            <Banner
              tone="warn"
              title={`${issues.length} thing${issues.length === 1 ? '' : 's'} to check before submitting`}
              body={issues.slice(0, 6).map((i) => i.message).join('\n')}
            />
          </Pressable>
        ) : null}

        <Card>
          <Field label="Employee" value={sheet.employeeName} onChangeText={(v) => update({ employeeName: v })} autoCapitalize="words" />
          <View style={{ height: t.space(2.5) }} />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field label="Vehicle rego" value={sheet.vehicleRego} onChangeText={(v) => update({ vehicleRego: v })} autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Kilometers" value={sheet.kilometerReading} onChangeText={(v) => update({ kilometerReading: v })} keyboardType="numeric" />
            </View>
          </Rowed>
        </Card>

        <H2>Days</H2>
        {days.map((date) => {
          const entries = byDate.get(date) ?? [];
          const dayTotal = entries.reduce((n, e) => n + entryHours(e), 0);
          return (
            <Card key={date}>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Rowed gap={2}>
                  <Txt weight="700">{dayName(date)}</Txt>
                  <Txt tone="muted" size="sm">{formatAuDate(date)}</Txt>
                </Rowed>
                {dayTotal > 0 ? <Chip label={`${dayTotal} h`} tone="accent" /> : null}
              </Rowed>

              {entries.map((e) => (
                <EntryEditor
                  key={e.id}
                  entry={e}
                  sites={sites}
                  onChange={(patch) => updateEntry(e.id, patch)}
                  onRemove={() => update({ entries: sheet.entries.filter((x) => x.id !== e.id) })}
                />
              ))}

              <Button
                title={entries.length ? 'Add another entry' : 'Add entry'}
                variant="ghost"
                compact
                onPress={() => addEntry(date)}
                style={{ marginTop: t.space(2) }}
              />
            </Card>
          );
        })}

        {value ? (
          <>
            <H2>What this week is worth</H2>
            <Card>
              {!showValue ? (
                <Button
                  title={`Price ${value.hours} hour${value.hours === 1 ? '' : 's'} at the rate card`}
                  variant="secondary"
                  onPress={() => setShowValue(true)}
                />
              ) : (
                <>
                  <Segmented
                    value={chargeAttendance ? 'callout' : 'contract'}
                    onChange={(v) => setChargeAttendance(v === 'callout')}
                    options={[
                      { value: 'contract', label: 'Contract visit' },
                      { value: 'callout', label: 'Chargeable callout' },
                    ]}
                  />
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                    {chargeAttendance
                      ? 'The attendance fee is charged once per visit and covers its stated minutes; only the time past that bills again.'
                      : 'Routine servicing under an agreement: hours only, no attendance fee.'}
                  </Txt>
                  <Divider />
                  {value.entries.map((v) => (
                    <Rowed key={v.entryId} style={{ justifyContent: 'space-between' }} align="flex-start">
                      <View style={{ flex: 1 }}>
                        <Txt size="sm">{v.siteName || v.jobNumber}</Txt>
                        <Txt size="xs" tone="faint">
                          {formatAuDate(v.date)} · {v.hours} hr{v.hours === 1 ? '' : 's'}
                          {v.band === 'after-hours' ? ' · after hours' : ''}
                        </Txt>
                      </View>
                      <Txt size="sm">{formatCents(v.charge.totalCents)}</Txt>
                    </Rowed>
                  ))}
                  <Divider />
                  <Rowed style={{ justifyContent: 'space-between' }}>
                    <Txt size="sm" tone="muted">Excluding GST</Txt>
                    <Txt size="sm" tone="muted">{formatCents(value.subtotalCents)}</Txt>
                  </Rowed>
                  <Rowed style={{ justifyContent: 'space-between', marginTop: t.space(1) }}>
                    <Txt size="sm" weight="700">Week, inc GST</Txt>
                    <Txt size="sm" weight="700">{formatCents(value.totalCents)}</Txt>
                  </Rowed>
                  {value.warnings.length ? (
                    <Txt size="xs" tone="warn" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                      {value.warnings.join(' ')}
                    </Txt>
                  ) : null}
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                    {value.note}
                  </Txt>
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                    An estimate, not an invoice. Variations, agreed caps
                    and what the contract already covers are not visible from a timesheet — the
                    office system raises the bill.
                  </Txt>
                </>
              )}
            </Card>
          </>
        ) : null}

        <H2>Sign off</H2>
        <Card>
          <Field label="Manager" value={sheet.managerName} onChangeText={(v) => update({ managerName: v })} autoCapitalize="words" />
          <View style={{ height: t.space(2.5) }} />
          <Field label="Checked by" value={sheet.checkedBy} onChangeText={(v) => update({ checkedBy: v })} autoCapitalize="words" />
        </Card>

        <Rowed gap={2}>
          <Button
            title={sheet.status === 'submitted' ? 'Mark as draft' : 'Mark submitted'}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => update({ status: sheet.status === 'submitted' ? 'draft' : 'submitted' })}
          />
          <Button title="Export" onPress={exportSheet} loading={busy} style={{ flex: 1 }} />
        </Rowed>

        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Hours come from the start and finish times. Enter an override only when the times do not tell the whole story.
        </Txt>
      </Screen>
    </>
  );
}

function EntryEditor({
  entry,
  sites,
  onChange,
  onRemove,
}: {
  entry: TimesheetEntry;
  sites: Site[];
  onChange: (patch: Partial<TimesheetEntry>) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hours = entryHours(entry);

  // Sites the tech already has in the app, so the name matches the report.
  const suggestions = useMemo(() => {
    const q = entry.siteName.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return sites.filter((s) => s.name.toLowerCase().includes(q) && s.name !== entry.siteName).slice(0, 4);
  }, [entry.siteName, sites]);

  return (
    <View
      style={{
        marginTop: t.space(3),
        paddingTop: t.space(3),
        borderTopWidth: 1,
        borderTopColor: t.color.border,
        gap: t.space(2.5),
      }}
    >
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Job / site name" value={entry.siteName} onChangeText={(v) => onChange({ siteName: v, siteId: undefined })} />
        </View>
        <Pressable onPress={onRemove} hitSlop={10} style={{ paddingTop: 24 }}>
          <MaterialCommunityIcons name="close-circle-outline" size={20} color={t.color.textFaint} />
        </Pressable>
      </Rowed>

      {suggestions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          {suggestions.map((s) => (
            <Chip key={s.id} label={s.name} onPress={() => onChange({ siteName: s.name, siteId: s.id })} />
          ))}
        </ScrollView>
      ) : null}

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Job #" value={entry.jobNumber} onChangeText={(v) => onChange({ jobNumber: v })} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Report #" value={entry.serviceReportNumber} onChangeText={(v) => onChange({ serviceReportNumber: v })} />
        </View>
      </Rowed>

      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Field label="Start" value={entry.startTime} onChangeText={(v) => onChange({ startTime: v })} placeholder="06:30" keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Finish" value={entry.finishTime} onChangeText={(v) => onChange({ finishTime: v })} placeholder="14:30" keyboardType="numeric" />
        </View>
        <View style={{ flex: 0.9, alignItems: 'center', paddingTop: 22 }}>
          <Txt size="xl" weight="700" tone={hours ? 'accent' : 'faint'}>{hours || '—'}</Txt>
          <Txt size="xs" tone="faint">hours</Txt>
        </View>
      </Rowed>

      <Segmented
        value={entry.hourKind}
        onChange={(v) => onChange({ hourKind: v as HourKind })}
        options={[
          { value: 'ord', label: 'Ordinary' },
          { value: 'ot', label: 'Overtime' },
          { value: 'dt', label: 'Double time' },
        ]}
      />

      <Field label="Comments" value={entry.comments} onChangeText={(v) => onChange({ comments: v })} placeholder="e.g. Shutdown MAINS & FIP cutover" />

      <Pressable onPress={() => setExpanded((v) => !v)}>
        <Rowed gap={1}>
          <Txt size="sm" tone="accent" weight="700">{expanded ? 'Hide leave and override' : 'Leave and override'}</Txt>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.accentText} />
        </Rowed>
      </Pressable>

      {expanded ? (
        <>
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}><Field label="Sick" value={entry.sick} onChangeText={(v) => onChange({ sick: v })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field label="RDO" value={entry.rdo} onChangeText={(v) => onChange({ rdo: v })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Annual" value={entry.annual} onChangeText={(v) => onChange({ annual: v })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field label="LWOP" value={entry.lwop} onChangeText={(v) => onChange({ lwop: v })} keyboardType="decimal-pad" /></View>
          </Rowed>
          <Field
            label="Hours override"
            value={entry.hoursOverride ?? ''}
            onChangeText={(v) => onChange({ hoursOverride: v })}
            keyboardType="decimal-pad"
            hint="Leave blank to use the hours derived from start and finish"
          />
        </>
      ) : null}
    </View>
  );
}
