import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { jobCount, jobSummariesByExternalIds, searchJobPicks, type JobPick, type JobSummary } from '@/db/opsRepo';
import { listScheduleBetween, scheduleSyncedAt, type ScheduleRecord } from '@/db/scheduleRepo';
import { listPendingScheduleChanges, queueScheduleChange, undoScheduleChange, type DuplicateState } from '@/db/scheduleChangeRepo';
import { listEmployees, type EmployeeRecord } from '@/db/employeeRepo';
import { listSimproTimesheets } from '@/db/moreRepo';
import { costCentresForJob, type CostCentreChoice } from '@/db/clockRepo';
import { localJobId } from '@/db/mirrorRepo';
import { addDays, scheduleWindow } from '@/domain/myDay';
import {
  DEFAULT_END, DEFAULT_START, SCHEDULE_BOOK_KIND, SCHEDULE_MOVE_KIND, SCHEDULE_REMOVE_KIND,
  canChangeFromPhone, conflicts, dayColumns, heldForUndo, mergePending, normaliseClock,
  notBeforeFrom, parseSchedulePath, spanProblem, weekOf,
  type CalendarBlock, type CostCentreRef, type PendingScheduleChange, type SchedulePerson,
} from '@/domain/scheduling';
import { shortDay } from '@/domain/clockOn';
import { qldIsoDay, qldMoment } from '@/domain/qldTime';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { simproConfigFromPrefs } from '@/simpro/config';
import { syncJobDetail } from '@/simpro/sync';
import { refreshScheduleWindow } from '@/simpro/outboundSchedule';
import { flushSoon } from '@/simpro/flushSoon';
import { formatAuDate } from '@/export/sheets';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Field, H2, Rowed, Screen, SearchBox, Segmented, Txt,
} from '@/components/ui';

/**
 * The schedule.
 *
 * The office's calendar, as the sync holds it: a day with a column per
 * person, or a week, of everyone's blocks or only your own. And the three
 * things a technician may do to it from the phone — book themselves onto a
 * job, move one of their own blocks, take one off — each queued for the
 * office with a minute to take it back, and drawn on the calendar as queued
 * until the office has it. Other people's blocks are the office's to move;
 * here they are read only.
 *
 * Who you are is the Simpro employee in Settings. Without one there is
 * nothing to book, so the buttons wait until they sign in or pick
 * themselves, and the calendar shows everyone's day meanwhile.
 */

type ViewMode = 'day' | 'week';

/** A job with its cost centres decided, or the reason they could not be. */
interface CostCentreStep {
  job: JobPick;
  options: CostCentreChoice[];
  why?: string;
}

interface BookingForm {
  job: JobPick;
  costCentre: CostCentreChoice;
  date: string;
  start: string;
  end: string;
  why?: string;
}

interface MoveForm {
  block: CalendarBlock;
  date: string;
  start: string;
  end: string;
  why?: string;
}

/** The chip on a queued block: what the phone has done, is doing, or was refused. */
function pendingChip(b: CalendarBlock): { label: string; tone: 'accent' | 'warn' | 'fail' | 'pass' } | undefined {
  if (!b.pending) return undefined;
  const what = b.pending === SCHEDULE_BOOK_KIND ? 'Booking' : b.pending === SCHEDULE_MOVE_KIND ? 'Moving' : 'Removing';
  if (b.pendingState === 'failed') return { label: `${what} refused`, tone: 'fail' };
  if (b.pendingState === 'unknown') return { label: `${what} unsure`, tone: 'warn' };
  if (b.pendingState === 'sent') return { label: 'Sent', tone: 'pass' };
  if (b.pendingState === 'sending') return { label: 'Sending', tone: 'accent' };
  return { label: 'Queued', tone: 'accent' };
}

/** What to say when the same change is on the queue already: it depends how far it got. */
function duplicateNotice(what: string, state: DuplicateState): string {
  if (state === 'pending') return `That ${what} is already queued.`;
  if (state === 'unknown') return `That ${what} went to the office and got no reply. It is on Waiting to send.`;
  return `The office already has that ${what}.`;
}

/** Whether a change is still on its way: the rows the screen's clock watches. */
const inFlight = (c: PendingScheduleChange) => c.state === 'pending' || c.state === 'sending';

export default function ScheduleScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ book?: string; day?: string }>();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [view, setView] = useState<ViewMode>('day');
  const [day, setDay] = useState<string>(() => {
    const asked = typeof params.day === 'string' ? params.day : undefined;
    return asked && qldIsoDay(asked) ? asked : (qldIsoDay(nowIso()) ?? '1970-01-05');
  });
  const [onlyMe, setOnlyMe] = useState(true);
  const [blocks, setBlocks] = useState<ScheduleRecord[]>([]);
  const [people, setPeople] = useState<EmployeeRecord[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobSummary>>(new Map());
  const [pending, setPending] = useState<PendingScheduleChange[]>([]);
  /** This person's own blocks' record paths, from the timesheet the office lists them in. */
  const [hrefs, setHrefs] = useState<Map<string, string>>(new Map());
  const [synced, setSynced] = useState<{ from: string; to: string } | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const [held, setHeld] = useState(0);
  const [scheduledToday, setScheduledToday] = useState<JobPick[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(nowIso());
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<CostCentreStep | null>(null);
  const [booking, setBooking] = useState<BookingForm | null>(null);
  const [moving, setMoving] = useState<MoveForm | null>(null);
  // "Me" is the default once the phone knows who you are; decided once, so
  // a person who switched to Everyone is not switched back on every focus.
  const decidedFilter = useRef(false);
  const openedForBooking = useRef(false);

  const employeeId = prefs?.simproEmployeeId.trim() ?? '';
  const today = qldIsoDay(now) ?? day;

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const p = await loadPrefs();
      setPrefs(p);
      const me = p.simproEmployeeId.trim();
      if (!decidedFilter.current) {
        setOnlyMe(!!me);
        decidedFilter.current = true;
      }
      const at = nowIso();
      setNow(at);
      const w = scheduleWindow(at);
      setSynced({ from: w.from, to: w.to });
      const [rows, staff, changes, syncedAt, count] = await Promise.all([
        listScheduleBetween(w.from, w.to),
        listEmployees(),
        listPendingScheduleChanges(),
        scheduleSyncedAt(),
        jobCount(),
      ]);
      setBlocks(rows);
      setPeople(staff);
      setPending(changes);
      setAsOf(syncedAt);
      setHeld(count);
      const jobIds = new Set<string>();
      for (const r of rows) if (r.jobId) jobIds.add(r.jobId);
      for (const c of changes) if (c.payload.jobId) jobIds.add(c.payload.jobId);
      const summaries = await jobSummariesByExternalIds([...jobIds]);
      const byExternal = new Map<string, JobSummary>();
      for (const j of summaries) if (j.externalId) byExternal.set(j.externalId, j);
      setJobs(byExternal);
      if (me) {
        // The timesheet read holds this person's own blocks with their full
        // paths; a block's path is what a move or removal is sent to.
        const sheets = await listSimproTimesheets({ employeeId: me, from: w.from, to: w.to });
        const paths = new Map<string, string>();
        for (const s of sheets) {
          const parsed = s.href ? parseSchedulePath(s.href) : undefined;
          if (parsed && s.href) paths.set(parsed.scheduleId, s.href);
        }
        setHrefs(paths);
        const mine = rows.filter((r) => r.staffId === me && r.date === w.today && r.jobId);
        const picks = await jobSummariesByExternalIds(mine.map((r) => r.jobId!));
        setScheduledToday(picks.map((j) => ({ externalId: j.externalId, siteName: j.siteName, siteId: j.siteId, status: j.status, customerName: j.customerName, title: j.title })));
      } else {
        setHrefs(new Map());
        setScheduledToday([]);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the schedule'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Opened from "Book me on": straight to the picker, once.
  useEffect(() => {
    if (params.book && prefs && employeeId && !openedForBooking.current) {
      openedForBooking.current = true;
      setPicking(true);
    }
  }, [params.book, prefs, employeeId]);

  /**
   * One tick of the screen's clock, while a change of its own is on its way.
   *
   * A queued change waits its minute before it goes, and the queue runs on
   * its own timetable; so the moment a minute is up the queue is asked to go
   * from here, and Undo leaves the block on the same tick, not half a second
   * after the sender may have claimed the row. Then the queue is read again:
   * a row that has just been sent is the office's, and the office's calendar
   * is read once, now, so the block turns from Sent to the office's own in
   * seconds rather than at the next sync.
   */
  const tick = useCallback(async (before: PendingScheduleChange[], last: string) => {
    const at = nowIso();
    setNow(at);
    if (before.some((c) => c.state === 'pending' && heldForUndo(c.payload.notBefore, last) && !heldForUndo(c.payload.notBefore, at))) flushSoon();
    try {
      const after = await listPendingScheduleChanges(at);
      const watched = new Set(before.filter(inFlight).map((c) => c.queueRowId));
      const landed = after.some((c) => c.state === 'sent' && watched.has(c.queueRowId));
      if (!landed) { setPending(after); return; }
      if (prefs) {
        try {
          await refreshScheduleWindow(simproConfigFromPrefs(prefs), at);
        } catch {
          // The office could not be read just now; the sync's own read, with
          // its fallback, catches up, and the block stays marked Sent till then.
        }
      }
      await load();
    } catch {
      // The queue could not be read; the next focus reads it again.
    }
  }, [prefs, load]);

  useEffect(() => {
    const watched = pending.filter(inFlight);
    if (!watched.length) return undefined;
    const untilClose = watched
      .filter((c) => heldForUndo(c.payload.notBefore, now))
      .map((c) => Date.parse(c.payload.notBefore) - Date.parse(now));
    // The next tick is when a minute closes, or a few seconds on, to catch the send.
    const delay = Math.max(100, Math.min(untilClose.length ? Math.min(...untilClose) : Infinity, 3000));
    const timer = setTimeout(() => { void tick(pending, now); }, delay);
    return () => clearTimeout(timer);
  }, [pending, now, tick]);

  const activePeople = useMemo<SchedulePerson[]>(() => people.map((p) => ({ id: p.id, name: p.name })), [people]);
  const calendar = useMemo(() => mergePending(blocks, pending, activePeople, asOf ?? undefined), [blocks, pending, activePeople, asOf]);
  const myBlocks = useMemo(() => calendar.filter((b) => employeeId && b.staffId === employeeId), [calendar, employeeId]);
  const visible = onlyMe && employeeId ? myBlocks : calendar;
  const week = useMemo(() => weekOf(day), [day]);
  const columns = useMemo(() => {
    const cols = onlyMe && employeeId
      ? [{ id: employeeId, name: prefs?.technicianName.trim() || people.find((p) => p.id === employeeId)?.name || `Employee ${employeeId}` }]
      : activePeople;
    return dayColumns(visible, day, cols);
  }, [visible, day, onlyMe, employeeId, prefs, people, activePeople]);
  const outsideWindow = synced ? day < synced.from || day > synced.to : false;

  const openJob = (jobId: string | undefined) => {
    if (!jobId) return;
    const job = jobs.get(jobId);
    if (job) router.push({ pathname: '/work/job/[id]', params: { id: job.id } });
    else if (jobs.size || held) router.push({ pathname: '/work/job/[id]', params: { id: localJobId(jobId) } });
    else setNotice(`Job ${jobId} is not on this phone yet. It comes with the next sync.`);
  };

  /**
   * A job picked: which cost centre is the booking on? One needs no
   * question. None known means the job's children have never been read, so
   * they are read now; a job that still has none cannot be booked — the
   * POST needs a cost centre — and says so.
   */
  const chooseJob = async (job: JobPick) => {
    if (!job.externalId) return;
    setNotice(null);
    setBusy(true);
    try {
      let options = await costCentresForJob(job.externalId);
      let why: string | undefined;
      if (!options.length) {
        if (!prefs) throw new Error('Settings have not loaded yet.');
        const outcome = await syncJobDetail(simproConfigFromPrefs(prefs), localJobId(job.externalId), { force: true });
        options = await costCentresForJob(job.externalId);
        if (!options.length) {
          why = outcome.status === 'failed'
            ? `The job's cost centres could not be read: ${outcome.error}`
            : outcome.status === 'missing' || outcome.status === 'not-simpro'
              ? 'This job is not held from Simpro, so there is no cost centre to book onto.'
              : 'Simpro lists no cost centre on this job, and a booking has to go on one. Ask the office to add one.';
        }
      }
      setPicking(false);
      if (options.length === 1 && !why) {
        setStep(null);
        setBooking({ job, costCentre: options[0]!, date: day, start: DEFAULT_START, end: DEFAULT_END });
        return;
      }
      setStep({ job, options, why });
    } catch (e) {
      setNotice(describeActionFailure(e, 'read the job'));
    } finally {
      setBusy(false);
    }
  };

  const queueBooking = async (form: BookingForm) => {
    setBusy(true);
    try {
      const start = normaliseClock(form.start)!;
      const end = normaliseClock(form.end)!;
      const r = await queueScheduleChange({
        kind: SCHEDULE_BOOK_KIND,
        payload: {
          employeeId, jobId: form.job.externalId!, sectionId: form.costCentre.sectionExternalId,
          costCenterId: form.costCentre.costCenterExternalId, date: form.date, start, end,
          siteName: form.job.siteName, notBefore: notBeforeFrom(nowIso()),
        },
      });
      setBooking(null);
      setNotice(r.duplicate ? duplicateNotice('booking', r.state) : 'Queued. It goes to the office in a minute; Undo is on the block until then.');
      await load();
    } catch (e) {
      setNotice(describeActionFailure(e, 'queue the booking'));
    } finally {
      setBusy(false);
    }
  };

  const confirmBooking = () => {
    if (!booking) return;
    const start = normaliseClock(booking.start);
    const end = normaliseClock(booking.end);
    const problem = spanProblem({ date: booking.date.trim(), start: start ?? '', end: end ?? '' });
    if (problem) { setBooking({ ...booking, why: problem }); return; }
    const form = { ...booking, date: booking.date.trim(), start: start!, end: end!, why: undefined };
    const clash = conflicts(myBlocks, { date: form.date, start: form.start, end: form.end });
    const words = `Job ${form.job.externalId}${form.job.siteName ? ` · ${form.job.siteName}` : ''}, ${form.start}–${form.end}, ${shortDay(form.date)}.`;
    const warning = clash.length
      ? ` You are already booked ${clash.map((c) => `${c.startTime}–${c.endTime} on ${c.jobId ? `job ${c.jobId}` : (c.type ?? 'a block')}`).join(', ')} that day.`
      : '';
    showAlert(clash.length ? 'Book over another block?' : 'Book me on?', `${words}${warning} It goes to the office in a minute.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: clash.length ? 'Book anyway' : 'Book', onPress: () => { void queueBooking(form); } },
    ]);
  };

  /**
   * The path a move or removal is sent to. This person's own blocks come
   * with one from the timesheet read; failing that the job's cost centres
   * go on the payload and the send finds the block on one of them. A block
   * with neither cannot be changed from the phone, and that is said rather
   * than guessed at.
   */
  const pathFor = async (block: CalendarBlock): Promise<{ href?: string; costCentres?: CostCentreRef[] } | { why: string }> => {
    const href = hrefs.get(block.id);
    if (href) return { href };
    if (!block.jobId) return { why: 'This block is not on a job, so the phone has no path to change it by. Ask the office.' };
    let options = await costCentresForJob(block.jobId);
    if (!options.length && prefs) {
      await syncJobDetail(simproConfigFromPrefs(prefs), localJobId(block.jobId), { force: true });
      options = await costCentresForJob(block.jobId);
    }
    if (!options.length) {
      return { why: `The phone does not hold job ${block.jobId}'s cost centres, so it cannot tell Simpro which block to change. Sync, or ask the office.` };
    }
    return { costCentres: options.map((c) => ({ sectionId: c.sectionExternalId, costCenterId: c.costCenterExternalId })) };
  };

  const startMove = (block: CalendarBlock) => {
    const allowed = canChangeFromPhone(block, employeeId);
    if (!allowed.ok) { setNotice(allowed.why); return; }
    setMoving({ block, date: block.date, start: block.startTime ?? DEFAULT_START, end: block.endTime ?? DEFAULT_END });
  };

  const queueMove = async (form: MoveForm) => {
    setBusy(true);
    try {
      const where = await pathFor(form.block);
      if ('why' in where) { setMoving({ ...form, why: where.why }); return; }
      const r = await queueScheduleChange({
        kind: SCHEDULE_MOVE_KIND,
        payload: {
          employeeId, scheduleId: form.block.id, jobId: form.block.jobId, ...where,
          date: form.date, start: form.start, end: form.end,
          from: { date: form.block.date, start: form.block.startTime, end: form.block.endTime },
          siteName: jobs.get(form.block.jobId ?? '')?.siteName, notBefore: notBeforeFrom(nowIso()),
        },
      });
      setMoving(null);
      setNotice(r.duplicate ? duplicateNotice('move', r.state) : 'Queued. It goes to the office in a minute; Undo is on the block until then.');
      await load();
    } catch (e) {
      setMoving({ ...form, why: describeActionFailure(e, 'queue the move') });
    } finally {
      setBusy(false);
    }
  };

  const confirmMove = () => {
    if (!moving) return;
    const start = normaliseClock(moving.start);
    const end = normaliseClock(moving.end);
    const problem = spanProblem({ date: moving.date.trim(), start: start ?? '', end: end ?? '' });
    if (problem) { setMoving({ ...moving, why: problem }); return; }
    const form = { ...moving, date: moving.date.trim(), start: start!, end: end!, why: undefined };
    if (form.date === form.block.date && form.start === form.block.startTime && form.end === form.block.endTime) {
      setMoving({ ...form, why: 'That is where it already is.' });
      return;
    }
    const clash = conflicts(myBlocks, { id: form.block.id, date: form.date, start: form.start, end: form.end });
    const warning = clash.length
      ? ` You are already booked ${clash.map((c) => `${c.startTime}–${c.endTime}`).join(', ')} that day.`
      : '';
    showAlert('Move this block?', `To ${form.start}–${form.end}, ${shortDay(form.date)}.${warning} The office sees it in a minute.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: clash.length ? 'Move anyway' : 'Move', onPress: () => { void queueMove(form); } },
    ]);
  };

  const queueRemove = async (block: CalendarBlock) => {
    setBusy(true);
    try {
      const where = await pathFor(block);
      if ('why' in where) { setNotice(where.why); return; }
      const r = await queueScheduleChange({
        kind: SCHEDULE_REMOVE_KIND,
        payload: {
          employeeId, scheduleId: block.id, jobId: block.jobId, ...where,
          date: block.date, start: block.startTime, end: block.endTime,
          siteName: jobs.get(block.jobId ?? '')?.siteName, notBefore: notBeforeFrom(nowIso()),
        },
      });
      setNotice(r.duplicate ? duplicateNotice('removal', r.state) : 'Queued. It goes to the office in a minute; Undo is on the block until then.');
      await load();
    } catch (e) {
      setNotice(describeActionFailure(e, 'queue the removal'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (block: CalendarBlock) => {
    const allowed = canChangeFromPhone(block, employeeId);
    if (!allowed.ok) { setNotice(allowed.why); return; }
    const what = block.jobId ? `job ${block.jobId}` : (block.type ?? 'this block');
    showAlert('Take yourself off?', `${what}, ${block.startTime ?? '?'}–${block.endTime ?? '?'}, ${shortDay(block.date)}. The office sees it in a minute.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void queueRemove(block); } },
    ]);
  };

  const undo = async (block: CalendarBlock) => {
    if (!block.queueRowId) return;
    setBusy(true);
    try {
      const taken = await undoScheduleChange(block.queueRowId);
      setNotice(taken ? 'Taken back. Nothing went to the office.' : 'Too late to take back here: its minute is up and it is being sent, or it is on Waiting to send.');
      await load();
    } catch (e) {
      setNotice(describeActionFailure(e, 'take the change back'));
    } finally {
      setBusy(false);
    }
  };

  /** One block on the calendar, with what can be done to it. */
  const renderBlock = (b: CalendarBlock, options: { withName?: boolean; withDate?: boolean } = {}) => {
    const job = b.jobId ? jobs.get(b.jobId) : undefined;
    const chip = pendingChip(b);
    const mine = !!employeeId && b.staffId === employeeId;
    const canUndo = !!b.queueRowId && b.pendingState === 'pending' && pending.some((c) => c.queueRowId === b.queueRowId && heldForUndo(c.payload.notBefore, now));
    const time = b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ''}` : 'Any time';
    const title = job?.siteName ?? (b.jobId ? `Job ${b.jobId}` : (b.type ?? 'Block'));
    return (
      <Card key={b.id} onPress={b.jobId ? () => openJob(b.jobId) : undefined}>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <Rowed gap={2} wrap>
              {options.withDate ? <Txt size="xs" tone="muted" weight="700">{formatAuDate(b.date)}</Txt> : null}
              <Txt weight="800" mono>{time}</Txt>
              {options.withName && b.staffName ? <Txt size="sm" tone="muted">{b.staffName}</Txt> : null}
            </Rowed>
            <Txt weight="700" numberOfLines={2}>{title}</Txt>
            {job?.title ? <Txt size="sm" tone="muted" numberOfLines={1}>{job.title}</Txt> : null}
            {b.jobId && !job ? <Txt size="xs" tone="faint">Job {b.jobId} is not on this phone yet.</Txt> : null}
            {b.movedFrom ? (
              <Txt size="xs" tone="faint">
                Moving from {b.movedFrom.start ? `${b.movedFrom.start}–${b.movedFrom.end ?? '?'}, ` : ''}{shortDay(b.movedFrom.date)}
              </Txt>
            ) : null}
            {b.pending === SCHEDULE_REMOVE_KIND && b.pendingState !== 'sent' ? <Txt size="xs" tone="faint">Coming off once the office has it.</Txt> : null}
            {b.pendingState === 'sent' ? <Txt size="xs" tone="faint">The office has it. The calendar shows its own copy after the next read.</Txt> : null}
            {b.pendingError ? <Txt size="sm" tone={b.pendingState === 'failed' ? 'fail' : 'warn'}>{b.pendingError}</Txt> : null}
          </View>
          {chip ? <Chip label={chip.label} tone={chip.tone} /> : (b.type && b.type.toLowerCase() !== 'job' ? <Chip label={b.type} /> : null)}
        </Rowed>
        {mine ? (
          <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
            {canUndo ? <Button title="Undo" variant="secondary" compact disabled={busy} onPress={() => { void undo(b); }} /> : null}
            {b.pendingState === 'failed' || b.pendingState === 'unknown' ? (
              <Button title="Waiting to send" variant="ghost" compact onPress={() => router.push('/work/outbound')} />
            ) : null}
            {!b.pending ? (
              <>
                <Button title="Move" variant="ghost" compact disabled={busy} onPress={() => startMove(b)} />
                <Button title="Remove" variant="ghost" compact disabled={busy} onPress={() => remove(b)} />
              </>
            ) : null}
          </Rowed>
        ) : null}
      </Card>
    );
  };

  const dayLabel = day === today ? `Today, ${formatAuDate(day)}` : day === addDays(today, 1) ? `Tomorrow, ${formatAuDate(day)}` : formatAuDate(day);

  return (
    <>
      <Stack.Screen options={{ title: 'Schedule' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="The schedule could not be read" body={failed} /> : null}
        {notice ? <Banner tone={/could not|cannot|Too late|refused/i.test(notice) ? 'warn' : 'info'} title={notice} /> : null}

        {prefs && !employeeId ? (
          <Card>
            <Banner
              tone="warn"
              title="Who are you in Simpro?"
              body="Booking yourself on, or moving a block, needs your Simpro employee, and this phone does not know which one you are yet. The calendar still shows everyone."
            />
            <Rowed gap={2} style={{ marginTop: t.space(3) }}>
              <Button title="Sign in" onPress={() => router.push('/signin')} />
              <Button title="Pick who I am" variant="secondary" onPress={() => router.push('/whoami')} />
            </Rowed>
          </Card>
        ) : null}

        <Segmented<ViewMode>
          options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
          value={view}
          onChange={setView}
        />

        <Rowed gap={2} style={{ justifyContent: 'space-between' }}>
          <Button title="" variant="ghost" compact onPress={() => setDay(addDays(day, view === 'day' ? -1 : -7))}
            icon={<MaterialCommunityIcons name="chevron-left" size={22} color={t.color.accentText} />} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Txt weight="700">{view === 'day' ? dayLabel : `Week of ${formatAuDate(week.start)}`}</Txt>
            {day !== today ? (
              <Button title="Today" variant="ghost" compact onPress={() => setDay(today)} />
            ) : null}
          </View>
          <Button title="" variant="ghost" compact onPress={() => setDay(addDays(day, view === 'day' ? 1 : 7))}
            icon={<MaterialCommunityIcons name="chevron-right" size={22} color={t.color.accentText} />} />
        </Rowed>

        <Rowed gap={2} wrap>
          <Chip label="Me" selected={onlyMe && !!employeeId} onPress={employeeId ? () => setOnlyMe(true) : undefined} />
          <Chip label="Everyone" selected={!onlyMe || !employeeId} onPress={() => setOnlyMe(false)} />
          <View style={{ flex: 1 }} />
          <Button
            title="Book me on"
            compact
            disabled={busy || !employeeId}
            onPress={() => { setPicking(true); setStep(null); setBooking(null); setMoving(null); }}
            icon={<MaterialCommunityIcons name="calendar-plus" size={18} color="#fff" />}
          />
        </Rowed>

        <Txt size="xs" tone="faint">
          {asOf ? `Office schedule as of ${qldMoment(asOf) ?? asOf}.` : 'The office schedule has not synced yet.'}
          {outsideWindow ? ` ${formatAuDate(day)} is outside the days the sync reads (a week back, three ahead).` : ''}
        </Txt>

        {picking ? (
          <JobPicker
            scheduled={scheduledToday}
            held={held}
            busy={busy}
            onPick={(job) => { void chooseJob(job); }}
            onClose={() => { setPicking(false); setStep(null); }}
          />
        ) : null}

        {step ? (
          <Card>
            <Txt weight="700">Job {step.job.externalId}{step.job.siteName ? ` · ${step.job.siteName}` : ''}</Txt>
            {step.why ? (
              <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
                <Banner tone="warn" title="No cost centre to book onto" body={step.why} />
                <Button title="Close" variant="ghost" compact onPress={() => setStep(null)} />
              </View>
            ) : (
              <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
                <Txt size="sm" tone="muted">Which cost centre is the booking on?</Txt>
                {step.options.map((c) => (
                  <Card
                    key={`${c.sectionExternalId}-${c.costCenterExternalId}`}
                    onPress={() => {
                      setBooking({ job: step.job, costCentre: c, date: day, start: DEFAULT_START, end: DEFAULT_END });
                      setStep(null);
                    }}
                  >
                    <Txt weight="600">{c.name}</Txt>
                    <Txt size="sm" tone="muted">{c.sectionName}</Txt>
                  </Card>
                ))}
              </View>
            )}
          </Card>
        ) : null}

        {booking ? (
          <Card variant="raised">
            <Txt weight="700">Book me on job {booking.job.externalId}{booking.job.siteName ? ` · ${booking.job.siteName}` : ''}</Txt>
            <Txt size="sm" tone="muted">{booking.costCentre.name} · {booking.costCentre.sectionName}</Txt>
            <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
              <Field label="Date" value={booking.date} onChangeText={(v) => setBooking({ ...booking, date: v, why: undefined })} placeholder="yyyy-mm-dd" />
              <Rowed gap={2} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Field label="Start" value={booking.start} onChangeText={(v) => setBooking({ ...booking, start: v, why: undefined })} placeholder={DEFAULT_START} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="End" value={booking.end} onChangeText={(v) => setBooking({ ...booking, end: v, why: undefined })} placeholder={DEFAULT_END} keyboardType="numeric" />
                </View>
              </Rowed>
              {booking.why ? <Txt size="sm" tone="fail">{booking.why}</Txt> : null}
              <Rowed gap={2}>
                <Button title="Book" disabled={busy} onPress={confirmBooking} />
                <Button title="Cancel" variant="ghost" onPress={() => setBooking(null)} />
              </Rowed>
            </View>
          </Card>
        ) : null}

        {moving ? (
          <Card variant="raised">
            <Txt weight="700">Move {moving.block.jobId ? `job ${moving.block.jobId}` : (moving.block.type ?? 'block')}</Txt>
            <Txt size="sm" tone="muted">Now {moving.block.startTime ?? '?'}–{moving.block.endTime ?? '?'}, {shortDay(moving.block.date)}</Txt>
            <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
              <Field label="Date" value={moving.date} onChangeText={(v) => setMoving({ ...moving, date: v, why: undefined })} placeholder="yyyy-mm-dd" />
              <Rowed gap={2} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Field label="Start" value={moving.start} onChangeText={(v) => setMoving({ ...moving, start: v, why: undefined })} placeholder={DEFAULT_START} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="End" value={moving.end} onChangeText={(v) => setMoving({ ...moving, end: v, why: undefined })} placeholder={DEFAULT_END} keyboardType="numeric" />
                </View>
              </Rowed>
              {moving.why ? <Txt size="sm" tone="fail">{moving.why}</Txt> : null}
              <Rowed gap={2}>
                <Button title="Move" disabled={busy} onPress={confirmMove} />
                <Button title="Cancel" variant="ghost" onPress={() => setMoving(null)} />
              </Rowed>
            </View>
          </Card>
        ) : null}

        {view === 'day' ? (
          columns.length === 1 ? (
            <>
              <H2>{columns[0]!.staffName}</H2>
              {columns[0]!.blocks.length
                ? columns[0]!.blocks.map((b) => renderBlock(b as CalendarBlock))
                : <Card><Txt tone="muted">Nothing booked {onlyMe && employeeId ? 'to you ' : ''}on {formatAuDate(day)}.</Txt></Card>}
            </>
          ) : columns.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: t.space(2), paddingBottom: t.space(2) }}>
              {columns.map((col) => (
                <View key={col.staffId ?? col.staffName} style={{ width: 240, gap: t.space(2) }}>
                  <Rowed gap={1}>
                    <Txt weight="700" numberOfLines={1} style={{ flex: 1 }}>{col.staffName}</Txt>
                    {col.staffId && col.staffId === employeeId ? <Chip label="Me" tone="accent" /> : null}
                  </Rowed>
                  {col.blocks.length
                    ? col.blocks.map((b) => renderBlock(b as CalendarBlock))
                    : <Card><Txt size="sm" tone="faint">Nothing booked.</Txt></Card>}
                </View>
              ))}
            </ScrollView>
          ) : (
            <Card><Txt tone="muted">{held ? 'No staff list on this phone yet: run a sync in Settings.' : 'Nothing on this phone yet: run a sync in Settings first.'}</Txt></Card>
          )
        ) : (
          week.days.map((d) => {
            const onDay = visible.filter((b) => b.date === d);
            return (
              <View key={d} style={{ gap: t.space(2) }}>
                <Rowed gap={2} style={{ justifyContent: 'space-between' }}>
                  <H2>{d === today ? `Today, ${formatAuDate(d)}` : formatAuDate(d)}</H2>
                  <Button title="Day" variant="ghost" compact onPress={() => { setDay(d); setView('day'); }} />
                </Rowed>
                {onDay.length
                  ? onDay.map((b) => renderBlock(b, { withName: !(onlyMe && employeeId) }))
                  : <Card><Txt size="sm" tone="faint">Nothing booked{onlyMe && employeeId ? ' to you' : ''}.</Txt></Card>}
              </View>
            );
          })
        )}

        <Txt size="sm" tone="faint">
          Bookings, moves and removals go to Simpro as schedule blocks under your employee, a minute after you queue them. Only your own blocks can be changed from here; the office moves everyone else's. Anything refused shows the office's words on the block and on Waiting to send.
        </Txt>
      </Screen>
    </>
  );
}

/**
 * Which job.
 *
 * Today's booked jobs first, because a booking is usually the next day of
 * the job you are on, then a search over every job the phone holds — the
 * same search the clock and the timesheet use, by number, site, customer or
 * title. The clock's picker, copied: two screens sharing a component would
 * be right, and the moment one of them needs a different first line it
 * would be wrong again.
 */
function JobPicker({
  scheduled, held, busy, onPick, onClose,
}: {
  scheduled: JobPick[];
  held: number;
  busy: boolean;
  onPick: (job: JobPick) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<JobPick[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);

  // A search per keystroke would fight the keyboard, and one that lands
  // after the next would show the wrong answer: wait for a pause, drop a
  // stale reply.
  useEffect(() => {
    const typed = q.trim();
    if (!typed) { setFound(null); setSearching(false); setSearchFailed(null); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchFailed(null);
        try {
          const rows = await searchJobPicks(typed, 40);
          if (current) setFound(rows.filter((r) => r.externalId));
        } catch (e) {
          if (current) { setFound([]); setSearchFailed(describeLoadFailure(e, 'the job search')); }
        } finally {
          if (current) setSearching(false);
        }
      })();
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [q]);

  const list = found ?? scheduled;
  return (
    <Card>
      <Rowed gap={2} style={{ justifyContent: 'space-between' }}>
        <Txt weight="700">Which job?</Txt>
        <Button title="Close" variant="ghost" compact onPress={onClose} />
      </Rowed>
      <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
        <SearchBox value={q} onChange={setQ} placeholder="Job number, site or customer" />
        {searching ? <Txt size="sm" tone="muted">Looking…</Txt> : null}
        {searchFailed ? <Banner tone="fail" title="The search could not run" body={searchFailed} /> : null}
        {!found && scheduled.length ? <Txt size="sm" tone="muted">Booked to you today</Txt> : null}
        {!found && !scheduled.length ? (
          <Txt size="sm" tone="muted">
            {held ? 'Nothing booked to you today. Search for the job.' : 'No jobs on this phone yet. Run a sync in Settings first.'}
          </Txt>
        ) : null}
        {found && !found.length && !searching && !searchFailed ? <Txt size="sm" tone="muted">No job matches that.</Txt> : null}
        {list.map((job) => (
          <Card key={job.externalId ?? job.siteName ?? ''} onPress={busy ? undefined : () => onPick(job)}>
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <Txt weight="600">Job {job.externalId}{job.siteName ? ` · ${job.siteName}` : ''}</Txt>
                <Txt size="sm" tone="muted" numberOfLines={1}>{[job.customerName, job.title].filter(Boolean).join(' · ')}</Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
            </Rowed>
          </Card>
        ))}
      </View>
    </Card>
  );
}
