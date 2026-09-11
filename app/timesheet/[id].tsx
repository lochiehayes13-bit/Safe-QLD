import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as MailComposer from 'expo-mail-composer';
import { getTimesheet, listTimesheets, saveTimesheet } from '@/db/timesheetRepo';
import { jobCount, openJobPicks, searchJobPicks, type JobPick } from '@/db/opsRepo';
import { deleteEntry, insertClosedEntry, listEntriesBetween } from '@/db/clockRepo';
import { listSetupActivities } from '@/db/moreRepo';
import { queueClockEntry } from '@/simpro/outboundMore';
import {
  bookableLeaveKind, buildLeaveEntry, isLeaveEntry, leaveActivityFor, leaveKind as leaveKindById,
  type OfficeActivity,
} from '@/domain/leaveBooking';
import { loadPrefs } from '@/app-prefs';
import {
  DEFAULT_EXTRAS, LEAVE_KINDS, LEAVE_LABEL, STANDARD_DAY_HOURS,
  blankEntry, copyDay, dayName, dayWorkedHours, entryHours, filterJobOptions, jobOptions, mergeJobOptions,
  isWeekendDay, leaveOf, nextTimesFor, previousDayWithEntries, setLeave, timesheetTotals, toggleExtra, usualTimes,
  weekDates,
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
import { BOARD_MAX, gridColumns, gridItemWidth, pageLayout } from '@/domain/layout';
import { useTheme, type Theme } from '@/theme';
import { Button, Card, Chip, Rowed, Screen, Txt } from '@/components/ui';
import { ProgressRing, Reveal } from '@/components/motion';
import { RecordGate } from '@/components/RecordGate';
import { useRecordPatch } from '@/hooks/useRecordPatch';
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
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobPick[]>([]);
  const [history, setHistory] = useState<Timesheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<{ date: string } | null>(null);
  /**
   * The width the week of cards is actually handed, once it has been laid out.
   *
   * Zero until the first layout, which is one frame of the window-derived
   * guess and then the truth. Set from onLayout — an event, not a render — so
   * it is a setState the linter is happy with and a measurement that includes
   * whatever the scroller took for itself.
   */
  const [measured, setMeasured] = useState(0);
  const [heldJobs, setHeldJobs] = useState<number | null>(null);
  // The days off already on this person's Simpro schedule, and the office's
  // own activity names to book against. Without both, a day marked off on the
  // sheet is a day the office never hears about.
  const [leaveDays, setLeaveDays] = useState<string[]>([]);
  const [activities, setActivities] = useState<OfficeActivity[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [bookingLeave, setBookingLeave] = useState(false);

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
      const [found, jobList, past, jobsHeld] = await Promise.all([
        // Four columns of the open jobs, not four hundred whole job rows —
        // description, office notes, contact, contract and tags included —
        // read to offer a list of job numbers and site names and then have
        // every complete one thrown away.
        getTimesheet(id), openJobPicks(400), listTimesheets(),
        // How many jobs this device holds at all, so the picker can tell a
        // search that found nothing from a device that has never been
        // connected to the office — which is most of a first run, and reads
        // as the app being broken when it says "nothing matches".
        jobCount(),
      ]);
      setSheet(found);
      setMissing(!found);
      setJobs(jobList);
      setHistory(past);
      setHeldJobs(jobsHeld);

      // What the office already holds for the days on this sheet, so a day
      // marked off here is not booked onto the schedule twice.
      const week = found ? weekDates(found.weekStarting) : [];
      const [prefs, synced] = await Promise.all([loadPrefs(), listSetupActivities()]);
      setEmployeeId(prefs.simproEmployeeId.trim());
      setActivities(synced.map((a) => ({ id: a.id, name: a.name })));
      if (week.length) {
        const booked = (await listEntriesBetween(week[0]!, week[week.length - 1]!)).filter(isLeaveEntry);
        setLeaveDays(booked.map((e) => e.date));
      } else {
        setLeaveDays([]);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this timesheet'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * The days off on this sheet that the office's calendar has never heard of.
   *
   * A public holiday is not among them: nobody applies for Anzac Day, and
   * booking one as leave would have it counted twice. A day already on the
   * schedule drops off the list the moment it is booked.
   */
  const unbookedLeave = useMemo(() => {
    if (!sheet) return [];
    const out: { date: string; activity: OfficeActivity; kindId: string }[] = [];
    for (const e of sheet.entries) {
      const leave = leaveOf(e);
      if (!leave) continue;
      if (leaveDays.includes(e.date)) continue;
      const kind = bookableLeaveKind(leave.kind);
      if (!kind) continue;
      const activity = leaveActivityFor(kind, activities);
      if (!activity) continue;
      if (out.some((x) => x.date === e.date)) continue;
      out.push({ date: e.date, activity, kindId: kind.id });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [sheet, leaveDays, activities]);

  /**
   * Books them, one at a time, and says what happened.
   *
   * The same path the leave screen uses — a closed clock entry queued to the
   * office's activity schedule — so there is one way a day off reaches Simpro
   * rather than two that disagree. A day the office refuses is taken back off
   * the phone rather than left looking booked.
   */
  const bookLeaveDays = async () => {
    if (!unbookedLeave.length) return;
    if (!employeeId) {
      showAlert(
        'Not signed in as yourself',
        'Booking a day off needs to know whose Simpro schedule it goes on. Sign in from Settings, then try again.',
      );
      return;
    }
    setBookingLeave(true);
    const done: string[] = [];
    const refused: string[] = [];
    try {
      for (const day of unbookedLeave) {
        const kind = leaveKindById(day.kindId);
        if (!kind) continue;
        const built = buildLeaveEntry({ id: newId(), employeeId, date: day.date, kind, activity: day.activity });
        if ('refused' in built) {
          refused.push(`${dayName(day.date)}: ${built.refused}`);
          continue;
        }
        const entry = await insertClosedEntry(built.entry);
        const outcome = await queueClockEntry(entry);
        if (outcome.status === 'not-ready') {
          await deleteEntry(entry.id);
          refused.push(`${dayName(day.date)}: ${outcome.why}`);
          continue;
        }
        done.push(`${dayName(day.date)} ${formatAuDate(day.date)} — ${day.activity.name}`);
      }
      await load();
      showAlert(
        done.length ? `${done.length} day${done.length === 1 ? '' : 's'} on the way to Simpro` : 'Nothing booked',
        [done.join('\n'), refused.length ? `Not booked:\n${refused.join('\n')}` : ''].filter(Boolean).join('\n\n'),
      );
    } catch (e) {
      showAlert('Not booked', describeActionFailure(e, 'booking the days off'));
    } finally {
      setBookingLeave(false);
    }
  };

  const persist = useRecordPatch<Timesheet>({
    record: sheet,
    setRecord: setSheet,
    write: (next) => saveTimesheet(next),
    what: 'timesheet',
    reload: load,
  });

  const setEntries = useCallback((entries: TimesheetEntry[]) => {
    void persist({ entries });
  }, [persist]);

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
    // Including this sheet: an allowance typed on Wednesday has to still be a
    // chip on Thursday, and the history read does not include the week being
    // edited.
    for (const e of sheet?.entries ?? []) for (const x of e.extras ?? []) used.add(x);
    const out = [...DEFAULT_EXTRAS];
    for (const x of used) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
    return out;
  }, [history, sheet]);

  // Every hook this screen has must run before the gate below: on the first
  // render there is no sheet yet, and a hook that only runs once the record
  // arrives changes the hook count between renders, which React answers by
  // throwing — a blank screen where the week should be.
  if (!sheet || !totals) return <RecordGate missing={missing} what="timesheet" failed={failed} onRetry={() => { void load(); }} />;

  /*
   * The week is seven days of the same shape, which is a grid rather than a
   * scroll. On a phone the grid is one column and the screen is what it always
   * was; on a tablet or a browser window the same seven cards sit two, three or
   * four across, and the sheet stops being two metres of column with the
   * payroll figures somewhere in the middle of it.
   *
   * The room to lay them out in is measured, not worked out from the window.
   * Deriving it lost the scroller's own scrollbar — about fifteen points on a
   * desktop browser — and fifteen points is the difference between four cards
   * across and three with a hand's width of empty ground down the side.
   */
  const gap = t.space(3);
  const page = pageLayout(width, BOARD_MAX);
  const room = measured > 0 ? measured : page.content - t.space(4) * 2;
  const columns = page.band === 'phone' ? 1 : gridColumns(room, { min: DAY_CARD_MIN, gap });
  const dayWidth = columns === 1 ? ('100%' as const) : gridItemWidth(room, columns, gap);
  // Wide enough to stand the summary and the paperwork side by side, which is
  // where a desktop expects them: at the top, not under a week of cards.
  const spread = page.band !== 'phone';

  const addJob = (date: string, opt: JobOption | null) => {
    const entry = blankEntry(newId(), date);
    // The first job of a day opens at the usual times; a later one opens when
    // the last one finished, because nobody works two jobs 06:30 to 14:30.
    const opening = nextTimesFor(sheet.entries, date, times);
    entry.startTime = opening.start;
    entry.finishTime = opening.finish;
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
        void persist({ status: 'submitted' });
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


  const summary = (
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
  );

  const notBooked = unbookedLeave.length ? (
    <Card>
      <Txt weight="700">
        {unbookedLeave.length} day{unbookedLeave.length === 1 ? '' : 's'} off on this sheet the office cannot see
      </Txt>
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
        {unbookedLeave.map((l) => `${dayName(l.date)} ${formatAuDate(l.date)} — ${l.activity.name}`).join('\n')}
      </Txt>
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>
        Marking a day off here puts the hours on your pay. It does not put the day on your Simpro schedule, so
        the person building next week’s run still has you available.
      </Txt>
      <Button
        title="Put them on my Simpro schedule"
        variant="secondary"
        loading={bookingLeave}
        onPress={() => { void bookLeaveDays(); }}
        style={{ marginTop: t.space(3) }}
      />
    </Card>
  ) : null;

  const week = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {days.map((date, i) => {
        const onDay = sheet.entries.filter((e) => e.date === date);
        return (
          <Reveal key={date} index={1 + i} style={{ width: dayWidth }}>
            <DayCard
              date={date}
              entries={onDay}
              theme={t}
              extraChoices={extraChoices}
              quiet={isWeekendDay(date) && onDay.length === 0}
              grid={columns > 1}
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
        );
      })}
    </View>
  );

  const yourDetails = (
    <Card>
      <Txt size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: t.space(2) }}>Your details</Txt>
      <LabeledInput label="Name" value={sheet.employeeName} onChange={(v) => void persist({ employeeName: v })} autoCapitalize="words" theme={t} />
      <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
        <View style={{ flex: 1 }}><LabeledInput label="Vehicle" value={sheet.vehicleRego} onChange={(v) => void persist({ vehicleRego: v })} autoCapitalize="characters" theme={t} /></View>
        <View style={{ flex: 1 }}><LabeledInput label="Odometer" value={sheet.kilometerReading} onChange={(v) => void persist({ kilometerReading: v })} keyboardType="numeric" theme={t} /></View>
      </Rowed>
    </Card>
  );

  const sendIt = (
    <View style={{ gap: t.space(3) }}>
      <Button title="Email to accounts" onPress={() => { void emailSheet(); }} loading={busy} icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />} />
      <Rowed gap={2}>
        <Button title="Export" variant="secondary" onPress={() => { void exportSheet(); }} loading={busy} style={{ flex: 1 }} />
        <Button
          title={sheet.status === 'submitted' ? 'Back to draft' : 'Mark submitted'}
          variant="ghost"
          onPress={() => void persist({ status: sheet.status === 'submitted' ? 'draft' : 'submitted' })}
          style={{ flex: 1 }}
        />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Goes to {TIMESHEET_INBOX} from your own mail app, so payroll can reply to you. Nothing is
        marked submitted until the mail app says it sent.
      </Txt>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `Week of ${formatAuDate(sheet.weekStarting)}` }} />
      <Screen wide>
        {spread ? (
          <Rowed gap={3} align="flex-start">
            <Reveal index={0} style={{ flex: 1 }}>{summary}</Reveal>
            <View style={{ flex: 1, gap: t.space(3) }}>
              {yourDetails}
              {sendIt}
            </View>
          </Rowed>
        ) : (
          <Reveal index={0}>{summary}</Reveal>
        )}

        {notBooked}

        <View onLayout={(e) => setMeasured(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
          {week}
        </View>

        {spread ? null : (
          <>
            {yourDetails}
            {sendIt}
          </>
        )}
      </Screen>

      <JobPicker
        visible={picking !== null}
        options={options}
        held={heldJobs}
        theme={t}
        onPick={(opt) => picking && addJob(picking.date, opt)}
        onBlank={() => picking && addJob(picking.date, null)}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The narrowest a day card gets before the week drops a column.
 *
 * A job row is a site name, a start, a finish and the hours. Under about this
 * the times wrap onto a line of their own and a Tuesday stops looking like the
 * Wednesday beside it.
 */
const DAY_CARD_MIN = 300;

function DayCard({
  date, entries, theme: t, extraChoices, quiet, grid, onAdd, onQuickAdd, onDuplicate, onLeave, onChange, onRemove, canDuplicate,
}: {
  date: string; entries: TimesheetEntry[]; theme: Theme; extraChoices: string[];
  /** A weekend with nothing on it: the same day, drawn as one row instead of a page. */
  quiet?: boolean;
  /** Laid out beside other days rather than under them. */
  grid?: boolean;
  onAdd: () => void; onQuickAdd: () => void; onDuplicate: () => void;
  onLeave: (kind: LeaveKind, hours: number) => void;
  onChange: (entry: TimesheetEntry) => void; onRemove: (id: string) => void; canDuplicate: boolean;
}) {
  const leave = entries.map(leaveOf).find(Boolean) ?? null;
  const jobs = entries.filter((e) => !leaveOf(e));
  const worked = dayWorkedHours(entries, date);
  const isToday = date === (qldIsoDay(nowIso()) ?? '');
  const shell: ViewStyle = {
    borderColor: isToday ? t.color.accent : t.color.border,
    borderWidth: isToday ? 2 : 1,
    // Side by side, a row of cards is as tall as the tallest one in it. Filling
    // that height keeps the row a row rather than a set of steps.
    ...(grid ? { flex: 1 } : null),
  };

  /*
   * Saturday and Sunday used to be a dashed line that became a day when it was
   * tapped, which put a day of the week behind a gesture nobody is told about.
   * The objection that produced it is real — a full card for each of two empty
   * days is what made the sheet a long scroll — so this is a card one row high
   * instead: the day, and the two things anyone ever does to a weekend. Nothing
   * to discover, and hours go on it in one tap.
   */
  if (quiet) {
    return (
      <Card style={{ ...shell, padding: t.space(3) }}>
        <Rowed gap={2} wrap>
          <View style={{ flex: 1, minWidth: 92 }}>
            <Txt weight="800" tone="muted" style={{ letterSpacing: -0.2 }}>{dayName(date)}</Txt>
            <Txt size="xs" tone="faint">{formatAuDate(date)}</Txt>
          </View>
          <Chip label="Add a job" onPress={onAdd} />
          <LeaveButton onLeave={onLeave} theme={t} compact />
        </Rowed>
      </Card>
    );
  }

  return (
    <Card style={shell}>
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
            <TileButton icon="plus" label="Add a job" onPress={onAdd} theme={t} primary />
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
  // The allowance a technician has that nobody wrote down. Typing one adds it
  // to this entry and, because the chips are built from what has been used
  // before, it is a chip from then on.
  const [newExtra, setNewExtra] = useState('');
  const [addingExtra, setAddingExtra] = useState(false);
  const hours = entryHours(entry);
  return (
    <View style={{ marginTop: t.space(3), paddingTop: t.space(3), borderTopWidth: 1, borderTopColor: t.color.border, gap: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        {/*
          * The row's own name, typed rather than read.
          *
          * It fills itself in from the job picker, and most rows are a site.
          * Plenty are not: a day of SERVICE, a day in the workshop, a
          * call-out with no job number yet. Those rows read "Untitled job" on
          * a sheet somebody signs, and the only way to say otherwise was to
          * pick a job that was not the work.
          */}
        <View style={{ flex: 1, gap: 2 }}>
          <TextInput
            value={entry.siteName}
            onChangeText={(v) => onChange({ ...entry, siteName: v })}
            placeholder="Untitled job"
            placeholderTextColor={t.color.textFaint}
            style={{
              color: t.color.text, fontSize: t.font.size.md, fontWeight: '700',
              paddingVertical: 2, paddingHorizontal: 0, minHeight: 28,
            }}
          />
          {entry.jobNumber ? <Txt size="xs" tone="faint">Job {entry.jobNumber}</Txt> : null}
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
              <Chip label={addingExtra ? 'Never mind' : '+ Another'} onPress={() => { setAddingExtra((a) => !a); setNewExtra(''); }} />
            </View>
            {addingExtra ? (
              <View style={{ gap: t.space(1.5) }}>
                <LabeledInput
                  label="What is it called"
                  value={newExtra}
                  onChange={setNewExtra}
                  placeholder="Confined space, standby, meal"
                  theme={t}
                />
                <Chip
                  label="Add it"
                  selected={Boolean(newExtra.trim())}
                  onPress={() => {
                    const label = newExtra.trim();
                    if (!label) return;
                    onChange(toggleExtra(entry, label));
                    setNewExtra('');
                    setAddingExtra(false);
                  }}
                />
              </View>
            ) : null}
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

function LeaveButton({ onLeave, theme: t, compact }: { onLeave: (kind: LeaveKind, hours: number) => void; theme: Theme; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return compact
      ? <Chip label="Day off" onPress={() => setOpen(true)} />
      : <TileButton icon="palm-tree" label="Day off" onPress={() => setOpen(true)} theme={t} />;
  }
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

/**
 * Picking the job an hour was worked on.
 *
 * This used to hold a list and filter it in the screen — and the list was the
 * first sixty open jobs, so typing a client's name found nothing unless that
 * client happened to be among the sixty. On a phone holding four and a half
 * thousand jobs that is a search that mostly says no, which is exactly what
 * the office system does not do.
 *
 * So anything typed goes to the database, over every job, matching the job
 * number, the site, the client, the office's order number and the title. The
 * days already worked are still offered first and still say so; they come from
 * this person's own timesheets, which the database does not know about.
 */
function JobPicker({
  visible, options, held, theme: t, onPick, onBlank, onClose,
}: {
  visible: boolean; options: JobOption[]; held: number | null; theme: Theme;
  onPick: (opt: JobOption) => void; onBlank: () => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<JobOption[] | null>(null);
  const [searching, setSearching] = useState(false);

  // A search per keystroke over four thousand rows would fight the keyboard,
  // and a search that lands after the next one would show the wrong answer —
  // so it waits for a pause, and a stale reply is dropped.
  useEffect(() => {
    const typed = q.trim();
    if (!typed) { setFound(null); setSearching(false); return; }
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        // The spinner goes up with the search rather than with the keystroke:
        // it belongs to the read, and so does turning it off again, which is
        // what keeps "Looking…" from being left on screen by a read that
        // failed.
        setSearching(true);
        try {
          const rows = await searchJobPicks(typed, 60);
          if (!current) return;
          setFound(rows.filter((r) => r.externalId).map((r) => ({
            jobNumber: r.externalId ?? '',
            siteName: r.siteName ?? '',
            siteId: r.siteId,
            customerName: r.customerName,
            source: 'simpro' as const,
          })));
        } catch {
          // A search that could not run is not a job that does not exist, so
          // the list empties and the line below says what to do about it —
          // "Type it myself" is always there and always works.
          if (current) setFound([]);
        } finally {
          if (current) setSearching(false);
        }
      })();
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [q]);

  const filtered = useMemo(
    () => mergeJobOptions(filterJobOptions(options, q), found ?? []),
    [options, q, found],
  );
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
            <TextInput value={q} onChangeText={setQ} placeholder="Job number, site or client" placeholderTextColor={t.color.textFaint} autoFocus style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }} />
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
                  {o.customerName ? <Txt size="xs" tone="muted" numberOfLines={1}>{o.customerName}</Txt> : null}
                  <Txt size="xs" tone="faint">{o.jobNumber ? `Job ${o.jobNumber}` : 'No job number'} · {o.source === 'recent' ? 'you worked this recently' : 'from the office'}</Txt>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
              </Rowed>
            </Pressable>
          ))}
          {filtered.length === 0 ? (
            <Txt tone="muted" style={{ textAlign: 'center', marginTop: t.space(4) }}>
              {searching
                ? 'Looking…'
                : held === 0
                  ? 'This device has no jobs on it yet. Connect to the office in Settings, or tap “Type it myself”.'
                  : 'Nothing matches. Tap “Type it myself”.'}
            </Txt>
          ) : null}
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
