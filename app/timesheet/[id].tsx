import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as MailComposer from 'expo-mail-composer';
import { getTimesheet, listTimesheets, saveTimesheet } from '@/db/timesheetRepo';
import { openJobPicks, type JobPick } from '@/db/opsRepo';
import {
  DEFAULT_EXTRAS, LEAVE_KINDS, LEAVE_LABEL, STANDARD_DAY_HOURS,
  blankEntry, copyDay, dayName, dayWorkedHours, entryHours, filterJobOptions, jobOptions,
  leaveOf, previousDayWithEntries, setLeave, timesheetTotals, toggleExtra, usualTimes, weekDates,
  type HourKind, type JobOption, type LeaveKind, type Timesheet, type TimesheetEntry,
} from '@/domain/timesheet';
import {
  TIMESHEET_INBOX, timesheetBody, timesheetNotReady, timesheetSubject,
} from '@/domain/timesheetEmail';
import { timesheetSheet, timesheetSummarySheet } from '@/export/safeqldForms';
import { formatAuDate } from '@/export/sheets';
import { shareFile, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { newId, nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { useTheme, type Theme } from '@/theme';
import { Button, Card, Chip, Rowed, Screen, Txt } from '@/components/ui';
import { ProgressRing, Reveal } from '@/components/motion';
import { RecordGate } from '@/components/RecordGate';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * The weekly timesheet, rebuilt around the day.
 *
 * The old screen laid out every payroll column on every row — three hour
 * buckets and five leave boxes — and asked the technician to be a payroll
 * clerk on a phone. This one thinks the way the day does: each day is either
 * a run of jobs with hours, or it is off. So a job is picked from a list of
 * the jobs they actually work, the hours default to the times they usually
 * start and finish, and a day off is one tap and one number rather than
 * finding the right box among five.
 *
 * The heavy things payroll still needs — overtime, the rate-card value — are
 * one tap away on the entry rather than in front of every entry. Everything
 * still lands in the same xlsx the office already reads.
 */
export default function TimesheetScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobPick[]>([]);
  const [history, setHistory] = useState<Timesheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<{ date: string } | null>(null);

  /*
   * One read, not three. The week, the job list and the history each used to be
   * their own `void promise.then(set)`, which meant a throw in any of them
   * landed nowhere — no sheet, no message, and the gate below still saying
   * "Loading…" because nothing had told it the read was over.
   */
  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [found, jobList, past] = await Promise.all([
        // Four columns of the open jobs, not four hundred whole job rows —
        // description, office notes, contact, contract and tags included —
        // read to offer a list of job numbers and site names and then have
        // every complete one thrown away.
        getTimesheet(id), openJobPicks(400), listTimesheets(),
      ]);
      setSheet(found);
      setMissing(!found);
      setJobs(jobList);
      setHistory(past);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this timesheet'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((next: Timesheet) => {
    setSheet(next);
    void saveTimesheet(next);
  }, []);

  const setEntries = useCallback((entries: TimesheetEntry[]) => {
    setSheet((prev) => {
      if (!prev) return prev;
      const next = { ...prev, entries };
      void saveTimesheet(next);
      return next;
    });
  }, []);

  const totals = useMemo(() => (sheet ? timesheetTotals(sheet) : null), [sheet]);
  const days = useMemo(() => (sheet ? weekDates(sheet.weekStarting) : []), [sheet]);
  const options = useMemo(
    () => jobOptions(history.filter((h) => h.id !== id), jobs.map((j) => ({
      externalId: j.externalId, siteName: j.siteName, status: j.status,
    }))),
    [history, jobs, id],
  );
  const times = useMemo(() => usualTimes(history), [history]);

  /** The tick boxes: the standard set, plus anything this person has added before. */
  const extraChoices = useMemo(() => {
    const used = new Set<string>();
    for (const h of history) for (const e of h.entries) for (const x of e.extras ?? []) used.add(x);
    const out = [...DEFAULT_EXTRAS];
    for (const x of used) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
    return out;
  }, [history]);

  // Every hook this screen has must run before the gate below: on the first
  // render there is no sheet yet, and a hook that only runs once the record
  // arrives changes the hook count between renders, which React answers by
  // throwing — a blank screen where the week should be.
  if (!sheet || !totals) return <RecordGate missing={missing} what="timesheet" failed={failed} onRetry={() => { void load(); }} />;

  const addJob = (date: string, opt: JobOption | null) => {
    const entry = blankEntry(newId(), date);
    entry.startTime = times.start;
    entry.finishTime = times.finish;
    if (opt) { entry.jobNumber = opt.jobNumber; entry.siteName = opt.siteName; entry.siteId = opt.siteId; }
    setEntries([...sheet.entries, entry]);
    setPicking(null);
  };

  const dupPrevious = (date: string) => {
    const from = previousDayWithEntries(sheet.entries, date);
    if (!from) { showAlert('Nothing to copy', 'No earlier day this week has any jobs on it yet.'); return; }
    const copied = copyDay(sheet.entries, from, date, newId);
    if (!copied.length) { showAlert('Nothing to copy', `${dayName(from)} is a day off, so there is nothing to bring across.`); return; }
    setEntries([...sheet.entries, ...copied]);
  };

  const emailSheet = async () => {
    const blocked = timesheetNotReady(sheet);
    if (blocked) { showAlert('Not ready to send', blocked); return; }
    setBusy(true);
    try {
      if (!(await MailComposer.isAvailableAsync())) {
        showAlert('No mail app set up', 'This phone has no email account configured. Use Export and attach the file yourself.');
        return;
      }
      const name = `Timesheet ${sheet.employeeName || ''} ${formatAuDate(sheet.weekStarting)}`.trim();
      const file = writeXlsx(name, [timesheetSheet(sheet), timesheetSummarySheet(sheet)]);
      const { status } = await MailComposer.composeAsync({
        recipients: [TIMESHEET_INBOX], subject: timesheetSubject(sheet), body: timesheetBody(sheet), attachments: [file.uri],
      });
      if (status === MailComposer.MailComposerStatus.SENT) {
        persist({ ...sheet, status: 'submitted' });
        showAlert('Sent', `Your week has gone to ${TIMESHEET_INBOX} and is marked submitted.`);
      } else {
        showAlert('Not sent', 'The email was not sent, so this sheet is still a draft. Nothing has gone to the office.');
      }
    } catch (e) {
      showAlert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportSheet = async () => {
    setBusy(true);
    try {
      const name = `Timesheet ${sheet.employeeName || ''} ${formatAuDate(sheet.weekStarting)}`.trim();
      const file = writeXlsx(name, [timesheetSheet(sheet), timesheetSummarySheet(sheet)]);
      const shared = await shareFile(file, 'Timesheet');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'timesheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not export', describeActionFailure(e, 'export this timesheet'));
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <Stack.Screen options={{ title: `Week of ${formatAuDate(sheet.weekStarting)}` }} />
      <Screen>
        <Reveal index={0}>
        <Card variant="raised" style={{ gap: t.space(1) }}>
          <Rowed gap={3}>
            <ProgressRing fraction={totals.grand / 38} size={72} stroke={8}>
              <Txt size="xs" weight="800" mono>{Math.round((totals.grand / 38) * 100)}%</Txt>
            </ProgressRing>
            <View style={{ flex: 1 }}>
              <Txt size="display" weight="800" style={{ letterSpacing: -1.4 }}>{totals.grand}<Txt size="lg" tone="muted" weight="700"> h</Txt></Txt>
              <Txt size="xs" tone="faint">of a 38 hour week</Txt>
            </View>
            <Chip label={sheet.status === 'submitted' ? 'Submitted' : 'Draft'} tone={sheet.status === 'submitted' ? 'pass' : 'warn'} />
          </Rowed>
          <Rowed gap={2} wrap>
            <Txt size="sm" tone="muted">{totals.worked} worked</Txt>
            {totals.ot ? <Txt size="sm" tone="warn">· {totals.ot} O/T</Txt> : null}
            {totals.dt ? <Txt size="sm" tone="warn">· {totals.dt} D/T</Txt> : null}
            {totals.grand - totals.worked ? <Txt size="sm" tone="muted">· {Math.round((totals.grand - totals.worked) * 100) / 100} leave</Txt> : null}
            {!sheet.employeeName.trim() ? <Txt size="sm" tone="fail">· no name set</Txt> : null}
          </Rowed>
        </Card>
        </Reveal>

        {days.map((date, i) => (
          <Reveal key={date} index={1 + i}>
          <DayCard
            date={date}
            entries={sheet.entries.filter((e) => e.date === date)}
            theme={t}
            extraChoices={extraChoices}
            onAdd={() => setPicking({ date })}
            onQuickAdd={() => addJob(date, null)}
            onDuplicate={() => dupPrevious(date)}
            onLeave={(kind, hours) => {
              const existing = sheet.entries.find((e) => e.date === date && leaveOf(e));
              if (existing) {
                setEntries(sheet.entries.map((e) => e.id === existing.id ? setLeave(e, kind, hours) : e));
              } else {
                setEntries([...sheet.entries, setLeave(blankEntry(newId(), date), kind, hours)]);
              }
            }}
            onChange={(entry) => setEntries(sheet.entries.map((e) => e.id === entry.id ? entry : e))}
            onRemove={(entryId) => setEntries(sheet.entries.filter((e) => e.id !== entryId))}
            canDuplicate={previousDayWithEntries(sheet.entries, date) !== null}
          />
          </Reveal>
        ))}

        <Card>
          <Txt size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: t.space(2) }}>Your details</Txt>
          <LabeledInput label="Name" value={sheet.employeeName} onChange={(v) => persist({ ...sheet, employeeName: v })} autoCapitalize="words" theme={t} />
          <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
            <View style={{ flex: 1 }}><LabeledInput label="Vehicle" value={sheet.vehicleRego} onChange={(v) => persist({ ...sheet, vehicleRego: v })} autoCapitalize="characters" theme={t} /></View>
            <View style={{ flex: 1 }}><LabeledInput label="Odometer" value={sheet.kilometerReading} onChange={(v) => persist({ ...sheet, kilometerReading: v })} keyboardType="numeric" theme={t} /></View>
          </Rowed>
        </Card>

        <Button title="Email to accounts" onPress={() => { void emailSheet(); }} loading={busy} icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />} />
        <Rowed gap={2}>
          <Button title="Export" variant="secondary" onPress={() => { void exportSheet(); }} loading={busy} style={{ flex: 1 }} />
          <Button
            title={sheet.status === 'submitted' ? 'Back to draft' : 'Mark submitted'}
            variant="ghost"
            onPress={() => persist({ ...sheet, status: sheet.status === 'submitted' ? 'draft' : 'submitted' })}
            style={{ flex: 1 }}
          />
        </Rowed>
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Goes to {TIMESHEET_INBOX} from your own mail app, so payroll can reply to you. Nothing is
          marked submitted until the mail app says it sent.
        </Txt>
      </Screen>

      <JobPicker
        visible={picking !== null}
        options={options}
        theme={t}
        onPick={(opt) => picking && addJob(picking.date, opt)}
        onBlank={() => picking && addJob(picking.date, null)}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function DayCard({
  date, entries, theme: t, extraChoices, onAdd, onQuickAdd, onDuplicate, onLeave, onChange, onRemove, canDuplicate,
}: {
  date: string; entries: TimesheetEntry[]; theme: Theme; extraChoices: string[];
  onAdd: () => void; onQuickAdd: () => void; onDuplicate: () => void;
  onLeave: (kind: LeaveKind, hours: number) => void;
  onChange: (entry: TimesheetEntry) => void; onRemove: (id: string) => void; canDuplicate: boolean;
}) {
  const leave = entries.map(leaveOf).find(Boolean) ?? null;
  const jobs = entries.filter((e) => !leaveOf(e));
  const worked = dayWorkedHours(entries, date);
  const isToday = date === (qldIsoDay(nowIso()) ?? '');

  return (
    <Card style={{ borderColor: isToday ? t.color.accent : t.color.border, borderWidth: isToday ? 2 : 1 }}>
      <Rowed gap={2}>
        <Txt weight="800" style={{ letterSpacing: -0.2 }}>{dayName(date)}</Txt>
        <Txt size="sm" tone="muted" style={{ flex: 1 }}>{formatAuDate(date)}</Txt>
        {worked > 0 ? <Chip label={`${worked} h`} tone="accent" /> : leave ? <Chip label={LEAVE_LABEL[leave.kind]} tone="warn" /> : null}
      </Rowed>

      {leave ? (
        <View style={{ marginTop: t.space(2.5), gap: t.space(2) }}>
          <LeavePicker date={date} selected={leave.kind} hours={leave.hours} onLeave={onLeave} theme={t} />
          <Pressable onPress={() => onLeave(leave.kind, 0)} hitSlop={6}>
            <Txt size="sm" tone="accent" weight="700">Actually, I worked — clear this</Txt>
          </Pressable>
        </View>
      ) : (
        <>
          {jobs.map((e) => (
            <JobEntry key={e.id} entry={e} theme={t} extraChoices={extraChoices} onChange={onChange} onRemove={() => onRemove(e.id)} />
          ))}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2), marginTop: t.space(2.5) }}>
            <TileButton icon="plus" label={jobs.length ? 'Add a job' : 'Add a job'} onPress={onAdd} theme={t} primary />
            {canDuplicate ? <TileButton icon="content-copy" label="Copy previous day" onPress={onDuplicate} theme={t} /> : null}
            {!jobs.length ? <LeaveButton onLeave={onLeave} theme={t} /> : null}
          </View>
        </>
      )}
    </Card>
  );
}

function JobEntry({
  entry, theme: t, extraChoices, onChange, onRemove,
}: { entry: TimesheetEntry; theme: Theme; extraChoices: string[]; onChange: (e: TimesheetEntry) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const hours = entryHours(entry);
  return (
    <View style={{ marginTop: t.space(3), paddingTop: t.space(3), borderTopWidth: 1, borderTopColor: t.color.border, gap: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700" numberOfLines={1}>{entry.siteName || entry.jobNumber || 'Untitled job'}</Txt>
          {entry.jobNumber && entry.siteName ? <Txt size="xs" tone="faint">Job {entry.jobNumber}</Txt> : null}
        </View>
        <Txt weight="800" tone={hours ? 'accent' : 'faint'} style={{ fontFamily: t.font.mono }}>{hours || '—'} h</Txt>
        <Pressable onPress={onRemove} hitSlop={10}><MaterialCommunityIcons name="close-circle-outline" size={22} color={t.color.textFaint} /></Pressable>
      </Rowed>

      <Rowed gap={2}>
        <TimeBox label="Start" value={entry.startTime} onChange={(v) => onChange({ ...entry, startTime: v })} theme={t} />
        <MaterialCommunityIcons name="arrow-right" size={18} color={t.color.textFaint} />
        <TimeBox label="Finish" value={entry.finishTime} onChange={(v) => onChange({ ...entry, finishTime: v })} theme={t} />
        {entry.hourKind !== 'ord' ? <Chip label={entry.hourKind === 'ot' ? 'O/T' : 'D/T'} tone="warn" /> : null}
      </Rowed>

      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={6}>
        <Rowed gap={1}>
          <Txt size="sm" tone="accent" weight="700">{open ? 'Fewer options' : 'Overtime, allowances, notes'}</Txt>
          <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.accentText} />
        </Rowed>
      </Pressable>

      {open ? (
        <View style={{ gap: t.space(2.5) }}>
          <View style={{ flexDirection: 'row', gap: t.space(2) }}>
            {(['ord', 'ot', 'dt'] as HourKind[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => onChange({ ...entry, hourKind: k })}
                style={{
                  flex: 1, minHeight: 44, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: entry.hourKind === k ? t.color.accent : t.color.surfaceAlt,
                }}
              >
                <Txt size="sm" weight="700" style={{ color: entry.hourKind === k ? t.color.onAccent : t.color.textMuted }}>
                  {k === 'ord' ? 'Ordinary' : k === 'ot' ? 'Overtime' : 'Double'}
                </Txt>
              </Pressable>
            ))}
          </View>

          <View style={{ gap: t.space(1.5) }}>
            <Txt size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Allowances</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
              {extraChoices.map((x) => {
                const on = (entry.extras ?? []).some((y) => y.toLowerCase() === x.toLowerCase());
                return <Chip key={x} label={x} selected={on} onPress={() => onChange(toggleExtra(entry, x))} />;
              })}
            </View>
          </View>

          <LabeledInput label="Report #" value={entry.serviceReportNumber} onChange={(v) => onChange({ ...entry, serviceReportNumber: v })} theme={t} />
          <LabeledInput label="Notes" value={entry.comments} onChange={(v) => onChange({ ...entry, comments: v })} placeholder="e.g. Shutdown MAINS & FIP cutover" theme={t} />
          <LabeledInput
            label="Hours override"
            value={entry.hoursOverride ?? ''}
            onChange={(v) => onChange({ ...entry, hoursOverride: v })}
            keyboardType="decimal-pad"
            placeholder="Only if the times do not tell the whole story"
            theme={t}
          />
        </View>
      ) : null}
    </View>
  );
}

function LeaveButton({ onLeave, theme: t }: { onLeave: (kind: LeaveKind, hours: number) => void; theme: Theme }) {
  const [open, setOpen] = useState(false);
  if (!open) return <TileButton icon="palm-tree" label="Day off" onPress={() => setOpen(true)} theme={t} />;
  return (
    <View style={{ width: '100%', gap: t.space(2) }}>
      <LeavePicker date="" selected={null} hours={STANDARD_DAY_HOURS} onLeave={(k, h) => { onLeave(k, h); setOpen(false); }} theme={t} />
    </View>
  );
}

function LeavePicker({
  selected, hours, onLeave, theme: t,
}: { date: string; selected: LeaveKind | null; hours: number; onLeave: (kind: LeaveKind, hours: number) => void; theme: Theme }) {
  const h = hours > 0 ? hours : STANDARD_DAY_HOURS;
  return (
    <View style={{ gap: t.space(2) }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2) }}>
        {LEAVE_KINDS.map((k) => (
          <Pressable
            key={k}
            onPress={() => onLeave(k, h)}
            style={{
              paddingHorizontal: t.space(3), minHeight: 44, borderRadius: t.radius.md, justifyContent: 'center',
              backgroundColor: selected === k ? t.color.warn : t.color.surfaceAlt,
              borderWidth: 1, borderColor: selected === k ? t.color.warn : t.color.border,
            }}
          >
            <Txt size="sm" weight="700" style={{ color: selected === k ? t.color.onAccent : t.color.textMuted }}>{LEAVE_LABEL[k]}</Txt>
          </Pressable>
        ))}
      </View>
      {selected ? (
        <Rowed gap={2}>
          <Txt size="sm" tone="muted">Hours</Txt>
          <Timeless value={String(hours)} onChange={(v) => { const n = parseFloat(v); onLeave(selected, Number.isFinite(n) ? n : 0); }} theme={t} />
          <Txt size="xs" tone="faint">a standard day is {STANDARD_DAY_HOURS}</Txt>
        </Rowed>
      ) : null}
    </View>
  );
}

function JobPicker({
  visible, options, theme: t, onPick, onBlank, onClose,
}: {
  visible: boolean; options: JobOption[]; theme: Theme;
  onPick: (opt: JobOption) => void; onBlank: () => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => filterJobOptions(options, q), [options, q]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: t.color.bg }}>
        <Rowed gap={2} style={{ padding: t.space(4), paddingBottom: t.space(2) }}>
          <Txt size="xl" weight="800" style={{ flex: 1 }}>Pick a job</Txt>
          <Pressable onPress={onClose} hitSlop={10}><MaterialCommunityIcons name="close" size={26} color={t.color.textMuted} /></Pressable>
        </Rowed>
        <View style={{ paddingHorizontal: t.space(4) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2), backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.pill, paddingHorizontal: t.space(4), minHeight: t.touch }}>
            <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
            <TextInput value={q} onChangeText={setQ} placeholder="Job number or site" placeholderTextColor={t.color.textFaint} autoFocus style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }} />
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: t.space(4), gap: t.space(2) }}>
          <Pressable onPress={onBlank} style={{ padding: t.space(3.5), borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, borderStyle: 'dashed' }}>
            <Txt weight="700">Type it myself</Txt>
            <Txt size="xs" tone="muted">A job that is not in this list yet</Txt>
          </Pressable>
          {filtered.map((o) => (
            <Pressable
              key={`${o.source}:${o.jobNumber}:${o.siteName}`}
              onPress={() => onPick(o)}
              style={({ pressed }) => ({ padding: t.space(3.5), borderRadius: t.radius.lg, backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface, borderWidth: 1, borderColor: t.color.border })}
            >
              <Rowed gap={2}>
                <View style={{ flex: 1 }}>
                  <Txt weight="700" numberOfLines={1}>{o.siteName || `Job ${o.jobNumber}`}</Txt>
                  <Txt size="xs" tone="faint">{o.jobNumber ? `Job ${o.jobNumber}` : 'No job number'} · {o.source === 'recent' ? 'you worked this recently' : 'open in Simpro'}</Txt>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
              </Rowed>
            </Pressable>
          ))}
          {filtered.length === 0 ? <Txt tone="muted" style={{ textAlign: 'center', marginTop: t.space(4) }}>Nothing matches. Tap “Type it myself”.</Txt> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small inputs

function LabeledInput({
  label, value, onChange, placeholder, keyboardType, autoCapitalize, theme: t,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'; autoCapitalize?: 'none' | 'words' | 'characters'; theme: Theme;
}) {
  return (
    <View style={{ gap: t.space(1) }}>
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.color.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={{ color: t.color.text, fontSize: t.font.size.md, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, paddingHorizontal: t.space(3), minHeight: t.touch }}
      />
    </View>
  );
}

function TimeBox({ label, value, onChange, theme: t }: { label: string; value: string; onChange: (v: string) => void; theme: Theme }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt size="xs" tone="faint" weight="700">{label}</Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="06:30"
        placeholderTextColor={t.color.textFaint}
        keyboardType="default"
        style={{ color: t.color.text, fontSize: t.font.size.lg, fontFamily: t.font.mono, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, paddingHorizontal: t.space(3), minHeight: 52, textAlign: 'center' }}
      />
    </View>
  );
}

function Timeless({ value, onChange, theme: t }: { value: string; onChange: (v: string) => void; theme: Theme }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      keyboardType="decimal-pad"
      style={{ color: t.color.text, fontSize: t.font.size.lg, fontFamily: t.font.mono, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, paddingHorizontal: t.space(3), minHeight: 48, minWidth: 80, textAlign: 'center' }}
    />
  );
}

function TileButton({ icon, label, onPress, theme: t, primary }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void; theme: Theme; primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: t.space(2),
        paddingHorizontal: t.space(3.5), minHeight: 48, borderRadius: t.radius.md,
        backgroundColor: primary ? t.color.accent : pressed ? t.color.surfaceAlt : t.color.surface,
        borderWidth: primary ? 0 : 1, borderColor: t.color.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon} size={20} color={primary ? t.color.onAccent : t.color.accentText} />
      <Txt weight="700" style={{ color: primary ? t.color.onAccent : t.color.text }}>{label}</Txt>
    </Pressable>
  );
}
