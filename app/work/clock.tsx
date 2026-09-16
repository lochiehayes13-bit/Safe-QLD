import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { jobCount, jobSummariesByExternalIds, searchJobPicks, type JobPick } from '@/db/opsRepo';
import { listScheduleFor } from '@/db/scheduleRepo';
import { localJobId } from '@/db/mirrorRepo';
import {
  costCentresForJob, deleteEntry, listEntriesBetween, queueStatesFor, startEntry, stopOpenEntry, unsentEntries,
  updateEntryTimes, weekWindow, type CostCentreChoice, type QueueState,
} from '@/db/clockRepo';
import { listSetupActivities } from '@/db/moreRepo';
import {
  dayTotals, entrySpan, formatMinutes, openEntryOf, qldClock, qldInstant, sendReadiness, weekStartOf, weekTotals,
  type ClockEntry, type ClockKind, type ClockStart,
} from '@/domain/clockOn';
import { qldIsoDay } from '@/domain/qldTime';
import { whoseSchedule } from '@/domain/myDay';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { simproConfigFromPrefs } from '@/simpro/config';
import { syncJobDetail } from '@/simpro/sync';
import { queueClockEntry } from '@/simpro/outboundMore';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, SearchBox, StatTile, Txt,
} from '@/components/ui';

/**
 * Clock on.
 *
 * On when you start a job, Off when you finish, and the hours go to the
 * Simpro job the way Simpro Mobile's timesheet sends them: as a schedule
 * block on the job's cost centre, under this person's employee id. The
 * weekly timesheet (/work/timesheets) is the payroll sheet and stays as it
 * is; this is the live clock the office reads job hours from.
 *
 * Everything is written to the phone first and queued for the office; the
 * state of each send is on the entry, in the server's own words where it
 * refused one. An entry is queued the moment it closes, whichever button
 * closed it — Off, Switch job, an activity chip, Break — and a piece dated
 * yesterday after a midnight split is queued beside the one dated today.
 * What did not go stays on screen under "Not yet sent" until it does, so a
 * block from Tuesday that the office refused is not lost behind Wednesday.
 * Nothing here needs signal except the one case where a job has never had
 * its cost centres read, and that is said on screen when it cannot be done.
 *
 * The person is the Simpro employee in Settings. Without one there is no
 * Staff to put on the block, so On is off until they sign in or pick
 * themselves.
 */

/** An activity the chips offer: the office's own where synced, a plain name otherwise. */
interface ActivityChoice { name: string; kind: ClockKind; activityExternalId?: string }

/**
 * The activities offered while the office's own list is not on the phone.
 *
 * Until a sync has read Simpro's setup/activities these carry a name and no
 * Simpro id; the entry is kept and shown, and sending it waits for the id.
 * The words are the ones the crew already uses.
 */
const FALLBACK_ACTIVITIES: ActivityChoice[] = [
  { name: 'Travel', kind: 'travel' },
  { name: 'Meeting', kind: 'activity' },
  { name: 'Workshop', kind: 'activity' },
];

/**
 * The office's activities as chips, travel first.
 *
 * Travel is its own kind on the phone so the day can be totalled as work,
 * travel and the rest; in Simpro it is just one activity among the
 * thirteen, so it is found by name. Empty means nothing synced yet.
 */
function activityChoices(synced: readonly { id: string; name: string }[]): ActivityChoice[] {
  if (!synced.length) return FALLBACK_ACTIVITIES;
  const isTravel = (name: string) => /travel/i.test(name);
  return [...synced]
    .sort((a, b) => Number(isTravel(b.name)) - Number(isTravel(a.name)) || a.name.localeCompare(b.name))
    .map((a) => ({ name: a.name, kind: isTravel(a.name) ? 'travel' : 'activity', activityExternalId: a.id }));
}

/** A job with its cost centres decided, or the reason they could not be. */
interface CostCentreStep {
  job: JobPick;
  options: CostCentreChoice[];
  why?: string;
}

/** The chip beside an entry: what the office has, is getting, or refused. */
function sendState(e: ClockEntry, q: QueueState | undefined): { label: string; tone: 'pass' | 'fail' | 'warn' | 'muted' | 'accent'; words?: string } {
  if (e.sentAt) return { label: 'Sent', tone: 'pass' };
  if (!e.endedAt) return { label: 'Running', tone: 'accent' };
  if (q?.status === 'unknown') return { label: 'Unsure', tone: 'warn', words: `No reply came back. Check Waiting to send.${q.lastError ? ` ${q.lastError}` : ''}` };
  if (q?.status === 'failed') return { label: 'Failed', tone: 'fail', words: q.lastError ?? e.sendError };
  if (q?.status === 'pending' || q?.status === 'sending') return { label: q.lastError ? 'Retrying' : 'Queued', tone: 'accent', words: q.lastError };
  if (e.sendError) return { label: 'Not sent', tone: 'fail', words: e.sendError };
  const ready = sendReadiness(e);
  if (!ready.ready) return { label: e.kind === 'break' ? 'Break' : 'Not sent', tone: 'muted', words: e.kind === 'break' ? undefined : ready.why };
  return { label: 'To send', tone: 'muted' };
}

function entryTitle(e: ClockEntry): string {
  if (e.kind === 'work') return [e.jobExternalId ? `Job ${e.jobExternalId}` : 'Job', e.siteName].filter(Boolean).join(' · ');
  if (e.kind === 'break') return 'Break';
  return e.activityName ?? (e.kind === 'travel' ? 'Travel' : 'Activity');
}

export default function ClockScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  /** Closed, unsent, and not today's: today's are in the day's list already. */
  const [unsent, setUnsent] = useState<ClockEntry[]>([]);
  const [queue, setQueue] = useState<Map<string, QueueState>>(new Map());
  const [scheduled, setScheduled] = useState<JobPick[]>([]);
  const [activities, setActivities] = useState<ActivityChoice[]>(FALLBACK_ACTIVITIES);
  const [held, setHeld] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(nowIso());
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<CostCentreStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; start: string; end: string; why?: string } | null>(null);

  // `now` is always an instant this screen wrote, so the day always reads;
  // the fallback is a Monday so the week arithmetic never sees an empty day.
  const today = qldIsoDay(now) ?? '1970-01-05';
  const open = useMemo(() => openEntryOf(entries), [entries]);
  const employeeId = prefs?.simproEmployeeId.trim() ?? '';

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const p = await loadPrefs();
      setPrefs(p);
      const at = nowIso();
      setNow(at);
      const day = qldIsoDay(at);
      if (!day) throw new Error(`Cannot read the day out of "${at}".`);
      const window = weekWindow(weekStartOf(day));
      const rows = await listEntriesBetween(window.from, window.to);
      setEntries(rows);
      const owed = (await unsentEntries()).filter((e) => e.date !== day);
      setUnsent(owed);
      setQueue(await queueStatesFor([...rows, ...owed].map((r) => r.id)));
      setHeld(await jobCount());
      setActivities(activityChoices(await listSetupActivities()));
      // The jobs the office booked this person onto today, so the picker
      // starts with them rather than a search box.
      const who = whoseSchedule(p);
      if (who) {
        const blocks = await listScheduleFor({
          staffId: who.by === 'id' ? who.staffId : undefined,
          staffName: who.by === 'name' ? who.staffName : undefined,
          from: day, to: day,
        });
        const jobs = await jobSummariesByExternalIds(blocks.map((b) => b.jobId).filter((id): id is string => !!id));
        setScheduled(jobs.map((j) => ({ externalId: j.externalId, siteName: j.siteName, siteId: j.siteId, status: j.status, customerName: j.customerName, title: j.title })));
      } else {
        setScheduled([]);
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the clock'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The running entry's clock, once a second while one is running.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => setNow(nowIso()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const dayT = useMemo(() => dayTotals(entries, today, now), [entries, today, now]);
  const weekT = useMemo(() => weekTotals(entries, today, now), [entries, today, now]);
  const todays = useMemo(() => entries.filter((e) => e.date === today), [entries, today]);

  /**
   * Straight to the office, where it can go: the moment an entry closes is
   * the moment the block is whole, and the one a technician expects it to
   * leave on. Every closed piece, because a split at midnight makes two
   * and the one dated yesterday is owed just the same. A piece that cannot
   * go is left with its reason on it, under Not yet sent.
   */
  const queueClosed = async (closed: ClockEntry[]) => {
    for (const e of closed) {
      if (sendReadiness(e).ready) await queueClockEntry(e);
    }
  };

  const clockOn = async (input: Omit<ClockStart, 'employeeExternalId'>) => {
    setNotice(null);
    setBusy(true);
    try {
      const { closed } = await startEntry({ ...input, employeeExternalId: employeeId });
      setPicking(false);
      setStep(null);
      await load();
      // Switch job, a chip or Break is the only Off the old entry gets.
      if (closed.length) {
        await queueClosed(closed);
        await load();
      }
    } catch (e) {
      setNotice(describeActionFailure(e, 'clock on'));
    } finally {
      setBusy(false);
    }
  };

  const clockOff = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const closed = await stopOpenEntry();
      await load();
      if (closed.length) {
        await queueClosed(closed);
        await load();
      }
    } catch (e) {
      setNotice(describeActionFailure(e, 'clock off'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * A job picked: which cost centre do the hours go on?
   *
   * One cost centre needs no question. None known means the job's children
   * have never been read, so they are read now; a job that still has none
   * after that can be clocked onto anyway, and the send waits until the
   * office gives it one.
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
              ? 'This job is not held from Simpro, so it has no cost centre to put hours on.'
              : 'Simpro lists no cost centre on this job. The hours will wait on the phone until the office adds one.';
        }
      }
      if (options.length === 1 && !why) {
        const only = options[0]!;
        await clockOn({
          kind: 'work', jobExternalId: job.externalId, jobSectionExternalId: only.sectionExternalId,
          jobCostCenterExternalId: only.costCenterExternalId, jobTitle: job.title, siteName: job.siteName,
        });
        return;
      }
      setStep({ job, options, why });
    } catch (e) {
      setNotice(describeActionFailure(e, 'read the job'));
    } finally {
      setBusy(false);
    }
  };

  const send = async (e: ClockEntry) => {
    setNotice(null);
    setBusy(true);
    try {
      const r = await queueClockEntry(e);
      if (r.status === 'not-ready') setNotice(`Not sent: ${r.why}.`);
      // The queue holds one row per entry while one is pending or in doubt,
      // so a second press has nothing to add and says so rather than nothing.
      if (r.status === 'duplicate') {
        setNotice(queue.get(e.id)?.status === 'unknown' ? 'Already on Waiting to send: decide it there.' : 'Already queued.');
      }
      await load();
    } catch (err) {
      setNotice(describeActionFailure(err, 'queue the hours'));
    } finally {
      setBusy(false);
    }
  };

  const sendToday = async () => {
    setNotice(null);
    setBusy(true);
    try {
      let queued = 0;
      let held = 0;
      for (const e of todays) {
        const q = queue.get(e.id)?.status;
        if (q === 'pending' || q === 'sending' || q === 'unknown') continue;
        if (!sendReadiness(e).ready) continue;
        const r = await queueClockEntry(e);
        if (r.status === 'queued') queued++;
        else if (r.status === 'not-ready') held++;
      }
      setNotice(queued ? `${queued} queued for the office.${held ? ` ${held} held back, see each entry.` : ''}` : 'Nothing to send today.');
      await load();
    } catch (err) {
      setNotice(describeActionFailure(err, 'queue the hours'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    // The entry may be one of today's or one owed from an earlier day.
    const entry = entries.find((e) => e.id === editing.id) ?? unsent.find((e) => e.id === editing.id);
    if (!entry) { setEditing(null); return; }
    const startedAt = qldInstant(entry.date, editing.start);
    const endedAt = editing.end.trim() ? qldInstant(entry.date, editing.end) : undefined;
    if (!startedAt || (editing.end.trim() && !endedAt)) {
      setEditing({ ...editing, why: 'Times are HH:MM, 24 hour: 07:30, 16:00.' });
      return;
    }
    // A running entry keeps running: only its start can move.
    setBusy(true);
    try {
      const r = await updateEntryTimes(entry.id, startedAt, entry.endedAt ? endedAt : undefined);
      if (!r.ok) { setEditing({ ...editing, why: r.why }); return; }
      setEditing(null);
      await load();
    } catch (e) {
      setEditing({ ...editing, why: describeActionFailure(e, 'save the times') });
    } finally {
      setBusy(false);
    }
  };

  const remove = (e: ClockEntry) => {
    showAlert('Delete this entry?', `${entryTitle(e)}, ${qldClock(e.startedAt)}–${e.endedAt ? qldClock(e.endedAt) : 'now'}. It has not been sent.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const r = await deleteEntry(e.id);
              if (!r.ok) setNotice(r.why);
              await load();
            } catch (err) {
              setNotice(describeActionFailure(err, 'delete the entry'));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  /** One entry's card: the block, its send state, and what can still be done to it. */
  const renderEntry = (e: ClockEntry) => {
    const state = sendState(e, queue.get(e.id));
    const span = entrySpan(e, now);
    const isEditing = editing?.id === e.id;
    return (
      <Card key={e.id}>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <Txt weight="600" numberOfLines={2}>{entryTitle(e)}</Txt>
            {e.jobTitle ? <Txt size="sm" tone="muted" numberOfLines={1}>{e.jobTitle}</Txt> : null}
            <Txt size="sm" tone="muted">
              {qldClock(e.startedAt)}–{e.endedAt ? qldClock(e.endedAt) : 'now'} · {span.refused ?? formatMinutes(span.minutes)}
            </Txt>
          </View>
          <Chip label={state.label} tone={state.tone} />
        </Rowed>
        {state.words ? <Txt size="sm" tone={state.tone === 'fail' ? 'fail' : 'muted'} style={{ marginTop: t.space(1.5) }}>{state.words}</Txt> : null}
        {e.simproUid ? <Txt size="xs" tone="faint" style={{ marginTop: 2 }}>Simpro schedule {e.simproUid}</Txt> : null}
        {isEditing && editing ? (
          <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label="Start" value={editing.start} onChangeText={(v) => setEditing({ ...editing, start: v, why: undefined })} placeholder="07:30" keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="End" value={editing.end} onChangeText={(v) => setEditing({ ...editing, end: v, why: undefined })} placeholder={e.endedAt ? '16:00' : 'running'} keyboardType="numeric" editable={!!e.endedAt} />
              </View>
            </Rowed>
            {editing.why ? <Txt size="sm" tone="fail">{editing.why}</Txt> : null}
            <Rowed gap={2}>
              <Button title="Save" compact disabled={busy} onPress={() => { void saveEdit(); }} />
              <Button title="Cancel" variant="ghost" compact onPress={() => setEditing(null)} />
            </Rowed>
          </View>
        ) : e.sentAt ? null : queue.get(e.id)?.status === 'unknown' ? (
          // Neither edit nor delete while nobody can say whether the block
          // went: an edit here and a Send again there would post the block
          // twice with different times. Waiting to send decides it first.
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>Decide this one on Waiting to send before changing it.</Txt>
        ) : (
          <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
            <Button title="Edit" variant="ghost" compact disabled={busy} onPress={() => setEditing({ id: e.id, start: qldClock(e.startedAt) ?? '', end: e.endedAt ? qldClock(e.endedAt) ?? '' : '' })} />
            <Button title="Delete" variant="ghost" compact disabled={busy} onPress={() => remove(e)} />
            {/* Not while it is queued, and not while nobody can say whether it went: that one is decided on Waiting to send. */}
            {e.endedAt && sendReadiness(e).ready && !['pending', 'sending', 'unknown'].includes(queue.get(e.id)?.status ?? '') ? (
              <Button title={queue.get(e.id) ? 'Send again' : 'Send'} variant="secondary" compact disabled={busy} onPress={() => { void send(e); }} />
            ) : null}
          </Rowed>
        )}
      </Card>
    );
  };

  const runningMinutes = open ? entrySpan(open, now) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Clock on' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="The clock could not be read" body={failed} /> : null}
        {notice ? <Banner tone={/could not|Not sent/.test(notice) ? 'warn' : 'info'} title={notice} /> : null}

        {prefs && !employeeId ? (
          <Card>
            <Banner
              tone="warn"
              title="Who are you in Simpro?"
              body="Hours go on a Simpro job under an employee, and this phone does not know which one yet. Sign in with your Simpro login, or pick yourself from the staff list."
            />
            <Rowed gap={2} style={{ marginTop: t.space(3) }}>
              <Button title="Sign in" onPress={() => router.push('/signin')} />
              <Button title="Pick who I am" variant="secondary" onPress={() => router.push('/whoami')} />
            </Rowed>
          </Card>
        ) : null}

        {/* The control. */}
        <Card variant="raised">
          {open ? (
            <View style={{ gap: t.space(2) }}>
              <Rowed gap={2}>
                <Chip label="On" tone="pass" />
                <Txt weight="700" style={{ flex: 1 }} numberOfLines={2}>{entryTitle(open)}</Txt>
              </Rowed>
              {open.jobTitle ? <Txt size="sm" tone="muted" numberOfLines={2}>{open.jobTitle}</Txt> : null}
              <Txt size="display" weight="800" mono style={{ letterSpacing: -1 }}>
                {runningMinutes?.refused ? '--:--' : formatMinutes(runningMinutes?.minutes ?? 0)}
              </Txt>
              <Txt size="sm" tone="muted">Since {qldClock(open.startedAt)}{runningMinutes?.refused ? ` · ${runningMinutes.refused}` : ''}</Txt>
              <Rowed gap={2} wrap>
                <Button title="Off" variant="danger" disabled={busy} onPress={() => { void clockOff(); }}
                  icon={<MaterialCommunityIcons name="timer-off-outline" size={18} color="#fff" />} />
                <Button title="Switch job" variant="secondary" disabled={busy || !employeeId} onPress={() => { setPicking(true); setStep(null); }} />
              </Rowed>
            </View>
          ) : (
            <View style={{ gap: t.space(2) }}>
              <Rowed gap={2}>
                <Chip label="Off" tone="muted" />
                <Txt tone="muted" style={{ flex: 1 }}>Nothing running</Txt>
              </Rowed>
              <Button
                title="On"
                disabled={busy || !employeeId}
                onPress={() => { setPicking(true); setStep(null); }}
                icon={<MaterialCommunityIcons name="timer-play-outline" size={18} color="#fff" />}
              />
            </View>
          )}
          <Rowed gap={2} wrap style={{ marginTop: t.space(3) }}>
            {activities.map((a) => (
              <Chip
                key={a.activityExternalId ?? a.name}
                label={a.name}
                selected={open?.kind === a.kind && open?.activityName === a.name}
                onPress={busy || !employeeId ? undefined : () => { void clockOn({ kind: a.kind, activityName: a.name, activityExternalId: a.activityExternalId }); }}
              />
            ))}
            <Chip
              label="Break"
              selected={open?.kind === 'break'}
              onPress={busy || !employeeId ? undefined : () => { void clockOn({ kind: 'break' }); }}
            />
          </Rowed>
        </Card>

        {picking ? (
          <JobPicker
            scheduled={scheduled}
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
                <Banner tone="warn" title="No cost centre to put the hours on" body={step.why} />
                <Button
                  title="Clock on to the job anyway"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => { void clockOn({ kind: 'work', jobExternalId: step.job.externalId ?? undefined, jobTitle: step.job.title, siteName: step.job.siteName }); }}
                />
              </View>
            ) : (
              <View style={{ gap: t.space(2), marginTop: t.space(2) }}>
                <Txt size="sm" tone="muted">Which cost centre are the hours on?</Txt>
                {step.options.map((c) => (
                  <Card
                    key={`${c.sectionExternalId}-${c.costCenterExternalId}`}
                    onPress={() => {
                      void clockOn({
                        kind: 'work', jobExternalId: step.job.externalId ?? undefined, jobSectionExternalId: c.sectionExternalId,
                        jobCostCenterExternalId: c.costCenterExternalId, jobTitle: step.job.title, siteName: step.job.siteName,
                      });
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

        {/* Today. */}
        <Rowed gap={2} align="flex-start" style={{ justifyContent: 'space-between' }}>
          <H2>Today</H2>
          <Button title="Send today to Simpro" variant="ghost" compact disabled={busy || !todays.length} onPress={() => { void sendToday(); }} />
        </Rowed>
        <Rowed gap={2} wrap>
          <StatTile label="On the tools" value={formatMinutes(dayT.workMinutes)} />
          <StatTile label="Travel" value={formatMinutes(dayT.travelMinutes)} />
          <StatTile label="Breaks" value={formatMinutes(dayT.breakMinutes)} />
        </Rowed>
        {dayT.refused.length ? (
          <Txt size="sm" tone="warn">{dayT.refused.length} {dayT.refused.length === 1 ? 'entry is' : 'entries are'} left out of the total: {dayT.refused.map((r) => r.why).join('; ')}.</Txt>
        ) : null}

        {!todays.length ? (
          <Card><Txt tone="muted">Nothing clocked today. Press On when you start.</Txt></Card>
        ) : todays.map(renderEntry)}

        {/* Owed from earlier days. */}
        {unsent.length ? (
          <>
            <H2>Not yet sent</H2>
            <Txt size="sm" tone="muted">Earlier days the office does not have yet. Each says why, and can be sent from here.</Txt>
            {unsent.map(renderEntry)}
          </>
        ) : null}

        {/* The week. */}
        <H2>This week</H2>
        <Txt size="sm" tone="muted">Monday {weekT.weekStart} to Sunday {weekT.weekEnd}</Txt>
        <Rowed gap={2} wrap>
          <StatTile label="On the tools" value={formatMinutes(weekT.workMinutes)} />
          <StatTile label="Travel" value={formatMinutes(weekT.travelMinutes)} />
          <StatTile label="Other" value={formatMinutes(weekT.activityMinutes)} />
        </Rowed>
        {weekT.byJob.length ? (
          <Card>
            {weekT.byJob.map((j, i) => (
              <View key={j.jobExternalId}>
                {i ? <Divider /> : null}
                <Rowed gap={2} style={{ paddingVertical: t.space(1.5) }}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="600">Job {j.jobExternalId}{j.siteName ? ` · ${j.siteName}` : ''}</Txt>
                    {j.jobTitle ? <Txt size="sm" tone="muted" numberOfLines={1}>{j.jobTitle}</Txt> : null}
                  </View>
                  <Txt weight="700" mono>{formatMinutes(j.minutes)}</Txt>
                </Rowed>
              </View>
            ))}
          </Card>
        ) : null}
        <Txt size="sm" tone="faint">
          Hours are sent as schedule blocks on the job's cost centre, under your Simpro employee. Breaks stay on the phone. Anything refused shows the office's words on the entry and on Waiting to send.
        </Txt>
      </Screen>
    </>
  );
}

/**
 * Which job.
 *
 * Today's booked jobs first, because that is what a technician is usually
 * clocking onto, then a search over every job the phone holds — the same
 * search the timesheet uses, by number, site, customer or title.
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
