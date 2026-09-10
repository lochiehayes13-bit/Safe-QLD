import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { clearDayDraft, draftIsCurrent, loadDayDraft, saveDayDraft } from '@/day-draft';
import { nowIso } from '@/db';
import { planCandidates, siteFacts, type PlanCandidate } from '@/db/siteHistoryRepo';
import { buildWorkPlan, planCoverage, type PlanCoverage } from '@/db/planRepo';
import { assetCountsBySystem } from '@/db/assetRepo';
import { costCentresForJob } from '@/db/clockRepo';
import { localJobId } from '@/db/mirrorRepo';
import { queueScheduleChange, undoScheduleChange } from '@/db/scheduleChangeRepo';
import { listScheduleFor } from '@/db/scheduleRepo';
import { simproConfigFromPrefs } from '@/simpro/config';
import { syncJobDetail } from '@/simpro/sync';
import { SCHEDULE_BOOK_KIND, notBeforeFrom } from '@/domain/scheduling';
import { addDays } from '@/domain/clockOn';
import { qldIsoDay } from '@/domain/qldTime';
import { assetsLine, lastServiceLine, type SiteFacts } from '@/domain/siteHistory';
import {
  DAY_END, DAY_START, bookingsFor, dayHeadline, layOutDay, moveStop, type BusyBlock, type DaySite,
} from '@/domain/dayBuilder';
import {
  CLUSTER_METHOD_LABEL, ESTIMATE_CAVEAT, UNPLANNABLE_REASON_LABEL, estimateVisitHours, formatHours, formatPlanDate,
  planHeadline, type PlannedDay, type PlannedVisit, type UnplannableReason, type WorkPlan,
} from '@/domain/workPlan';
import { FREQUENCY_LABEL, SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import { dayName } from '@/domain/timesheet';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, H2, Label, Rowed, Screen, SearchBox, Segmented, StatTile,
  StatusPill, Txt,
} from '@/components/ui';

/**
 * Plan work.
 *
 * Two questions, two modes. **Build a day** is the one asked in the ute at
 * seven in the morning: which sites, in what order, and what do I need to
 * know before I walk in. Each site carries the facts about the last time it
 * was serviced — who, when, how long they took and whether anyone recorded
 * hours at all, what is registered there, what is due, and whether the next
 * visit is on the office's calendar yet. Add sites to the day, drag the
 * order, and the day is laid out from seven as back-to-back blocks. Put it
 * on my Simpro schedule books every block that has a job under it, through
 * the same read-first, hold-a-minute path the calendar uses.
 *
 * **The month** is the office's question and the planner that answered it
 * before: routines due in a window, batched by suburb, sized from asset
 * counts, marked as estimates every time.
 *
 * Nothing here invents a job. A site with no open Simpro job is laid out so
 * the day's hours are honest and marked not bookable with the reason: the
 * office raises jobs, and a block posted against nothing is a block on
 * nothing.
 */

type Mode = 'day' | 'month';

export default function WorkPlanScreen() {
  const [mode, setMode] = useState<Mode>('day');
  return (
    <>
      <Stack.Screen options={{ title: 'Plan work' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[{ value: 'day', label: 'Build a day' }, { value: 'month', label: 'The month' }]}
        />
        {mode === 'day' ? <DayBuilder /> : <MonthPlanner />}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
// Build a day
// ---------------------------------------------------------------------------

interface Stop extends DaySite {
  facts?: SiteFacts;
}

function DayBuilder() {
  const t = useTheme();
  const today = qldIsoDay(nowIso()) ?? '';
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [date, setDate] = useState<string>(today);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PlanCandidate[]>([]);
  const [facts, setFacts] = useState<Record<string, SiteFacts | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<{ rowId: string; siteName: string; start: string; end: string; notBefore: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // What the office already has this person doing that day. The layout works
  // around it rather than over it.
  const [busy, setBusy] = useState<BusyBlock[]>([]);
  // Until the draft has been read, an empty day is "not loaded yet" rather
  // than "nothing on it", and writing an empty draft over a real one here is
  // exactly how the day would be lost a second time.
  const [draftLoaded, setDraftLoaded] = useState(false);

  const employeeId = prefs?.simproEmployeeId.trim() ?? '';
  const ownName = prefs?.technicianName ?? '';

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const p = await loadPrefs();
      setPrefs(p);
      setCandidates(await planCandidates(today, query));

      // The half-built day comes back. See @/day-draft: it is written to the
      // handset as it is edited, because a day is built between other things.
      const draft = await loadDayDraft();
      if (draftIsCurrent(draft, today) && draft) {
        setStops((current) => (current.length ? current : draft.stops.map((x) => ({ ...x }))));
        setDate((current) => (current === today ? draft.date : current));
      }
      setDraftLoaded(true);
    } catch (e) {
      setCandidates([]);
      setDraftLoaded(true);
      setFailed(describeLoadFailure(e, 'the sites'));
    }
  }, [today, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The draft follows the day, so switching to the month view and back, or
  // walking out to the Jobs tab, no longer throws it away.
  useEffect(() => {
    if (!draftLoaded) return;
    if (!stops.length) {
      void clearDayDraft();
      return;
    }
    void saveDayDraft({
      date,
      savedAt: nowIso(),
      stops: stops.map((s) => ({ siteId: s.siteId, siteName: s.siteName, estimateHours: s.estimateHours, job: s.job })),
    });
  }, [draftLoaded, date, stops]);

  /**
   * What the office already has booked for this person on the chosen day.
   *
   * Read every time the day changes. Without it the builder laid a fresh day
   * from seven o'clock over the top of the office's own blocks, and the
   * technician found out by being in two places at eight.
   */
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      if (!date || (!employeeId && !ownName)) {
        setBusy([]);
        return;
      }
      try {
        const blocks = await listScheduleFor({
          staffId: employeeId || undefined,
          staffName: employeeId ? undefined : ownName,
          from: date,
          to: date,
        });
        if (cancelled) return;
        setBusy(blocks
          .filter((b) => b.startTime && b.endTime)
          .map((b) => ({
            start: b.startTime!,
            end: b.endTime!,
            label: b.jobId ? `Job ${b.jobId}` : 'a block the office booked',
          })));
      } catch {
        // A calendar that will not read is not a reason to refuse to plan;
        // the banner below says the day was laid out without it.
        if (!cancelled) setBusy([]);
      }
    };
    void read();
    return () => { cancelled = true; };
  }, [date, employeeId, ownName]);

  // The undo minute is drawn as a countdown, so a stale button never lies.
  useEffect(() => {
    if (!booked.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [booked.length]);

  /** The facts for one site, read once and kept. */
  const showFacts = useCallback(async (siteId: string) => {
    setOpen((cur) => (cur === siteId ? null : siteId));
    if (facts[siteId] !== undefined) return;
    try {
      const f = await siteFacts(siteId, today, ownName);
      setFacts((m) => ({ ...m, [siteId]: f ?? null }));
    } catch (e) {
      setFacts((m) => ({ ...m, [siteId]: null }));
      setFailed(describeLoadFailure(e, 'that site'));
    }
  }, [facts, today, ownName]);

  /**
   * Adds a site to the day, sized from its register.
   *
   * The estimate is the month planner's: asset counts through the same
   * minutes-per-asset table, against the routines that are due there, or
   * an annual walk where nothing is. It is an estimate and the layout says
   * so; the technician can type over it.
   */
  const addSite = useCallback(async (c: PlanCandidate) => {
    if (stops.some((s) => s.siteId === c.siteId)) return;
    try {
      const counts = await assetCountsBySystem(c.siteId);
      const f = facts[c.siteId] ?? await siteFacts(c.siteId, today, ownName);
      const dueRoutines = (f?.due ?? [])
        .filter((d) => d.state === 'overdue' || d.state === 'due')
        .map((d) => SERVICE_ROUTINES.find((r) => r.id === d.routineId))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({ system: r.system, frequency: r.frequency }));
      const routines = dueRoutines.length ? dueRoutines : [{ system: 'detection', frequency: 'annual' as const }];
      const estimate = estimateVisitHours(counts.filter((x) => x.system !== 'unknown'), routines);
      setStops((s) => [...s, {
        siteId: c.siteId,
        siteName: c.siteName,
        estimateHours: estimate?.hours ?? 1.5,
        job: c.job ? { externalId: c.job.externalId, title: c.job.title } : undefined,
        facts: f ?? undefined,
      }]);
      if (f && facts[c.siteId] === undefined) setFacts((m) => ({ ...m, [c.siteId]: f }));
    } catch (e) {
      showAlert('Could not add that site', describeActionFailure(e, 'sizing the visit'));
    }
  }, [stops, facts, today, ownName]);

  const layout = useMemo(() => layOutDay(stops, { busy }), [stops, busy]);
  const days = useMemo(() => {
    const out: string[] = [];
    let d = today;
    while (out.length < 10 && d) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [today]);

  /**
   * Puts the day on the schedule.
   *
   * One booking per stop with a job, each through queueScheduleChange with
   * the cost centre read off the job's mirror — synced first where the
   * phone has never read the job's children. A job with several cost
   * centres is booked on the first and said so, because a day builder that
   * stopped to ask about each one would never finish; the block can be
   * moved on the calendar. Every block shares one undo moment.
   */
  const putOnSchedule = async () => {
    if (!prefs) return;
    setBooking(true);
    try {
      const plan = bookingsFor(layout, { employeeId, date, notBefore: notBeforeFrom(nowIso()) });
      const done: typeof booked = [];
      const problems: string[] = [];
      for (const p of plan.payloads) {
        let options = await costCentresForJob(p.jobId);
        if (!options.length) {
          await syncJobDetail(simproConfigFromPrefs(prefs), localJobId(p.jobId), { force: true });
          options = await costCentresForJob(p.jobId);
        }
        const cc = options[0];
        if (!cc) {
          problems.push(`${p.siteName ?? p.jobId}: Simpro lists no cost centre on job ${p.jobId}, so nothing could be booked on it.`);
          continue;
        }
        const r = await queueScheduleChange({
          kind: SCHEDULE_BOOK_KIND,
          payload: {
            employeeId: p.employeeId, jobId: p.jobId, sectionId: cc.sectionExternalId, costCenterId: cc.costCenterExternalId,
            date: p.date, start: p.start, end: p.end, siteName: p.siteName, notBefore: p.notBefore,
          },
        });
        if (r.duplicate) problems.push(`${p.siteName ?? p.jobId}: already on the queue (${r.state}).`);
        else done.push({ rowId: r.id, siteName: p.siteName ?? p.jobId, start: p.start, end: p.end, notBefore: p.notBefore });
        if (options.length > 1) problems.push(`${p.siteName ?? p.jobId}: booked on the first of ${options.length} cost centres (${cc.name}); move it on the calendar if that is the wrong one.`);
      }
      for (const s of plan.skipped) problems.push(`${s.stop.siteName}: ${s.why}`);
      setBooked(done);
      showAlert(
        done.length ? `${done.length} block${done.length === 1 ? '' : 's'} queued for ${dayName(date)} ${formatAuDate(date)}` : 'Nothing queued',
        [
          done.length ? 'They go to the office in a minute and show on Simpro Mobile for that day. Undo is below until then.' : '',
          ...problems,
        ].filter(Boolean).join('\n\n'),
      );
    } catch (e) {
      showAlert('Not booked', describeActionFailure(e, 'putting the day on the schedule'));
    } finally {
      setBooking(false);
    }
  };

  const undoAll = async () => {
    let taken = 0;
    for (const b of booked) {
      try {
        if (await undoScheduleChange(b.rowId)) taken += 1;
      } catch {
        // Counted below.
      }
    }
    setBooked([]);
    showAlert(taken === booked.length ? 'Taken back' : 'Some had already gone', `${taken} of ${booked.length} block${booked.length === 1 ? '' : 's'} came off before reaching the office.`);
  };

  const undoLeft = booked.length ? Math.max(0, Math.ceil((Date.parse(booked[0]!.notBefore) - now) / 1000)) : 0;

  return (
    <>
      {failed ? <Banner tone="fail" title="Could not read the sites" body={failed} /> : null}

      {prefs && !employeeId ? (
        <Card onPress={() => router.push('/signin')}>
          <Txt weight="700">Sign in as yourself to put a day on the schedule</Txt>
          <Txt size="sm" tone="muted">The day can still be built and read; booking it needs to know whose schedule it goes on.</Txt>
        </Card>
      ) : null}

      <H2>Which day</H2>
      <Rowed gap={2} wrap>
        {days.map((d) => (
          <Chip key={d} label={`${dayName(d)} ${formatAuDate(d).slice(0, 5)}`} selected={date === d} onPress={() => setDate(d)} />
        ))}
      </Rowed>

      {busy.length ? (
        <Banner
          tone="info"
          title={`${busy.length} block${busy.length === 1 ? '' : 's'} already on your calendar that day`}
          body={`${busy.map((b) => `${b.start}–${b.end} ${b.label}`).join('\n')}\n\nThe day below is laid out around them rather than over them.`}
        />
      ) : null}

      <Rowed style={{ justifyContent: 'space-between' }} align="center">
        <H2>{stops.length ? `Your day — ${dayHeadline(layout)}` : 'Your day'}</H2>
        {stops.length ? <Chip label="Start again" onPress={() => setStops([])} /> : null}
      </Rowed>
      {stops.length === 0 ? (
        <EmptyState title="Nothing on the day yet" body="Add sites from the list below. Each one is sized from its register and laid out from seven." />
      ) : (
        layout.stops.map((stop, i) => (
          <Card key={stop.siteId}>
            <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt weight="700">{stop.order}. {stop.siteName}</Txt>
                <Txt size="sm" tone="muted">{stop.start}–{stop.end} · about {stop.estimateHours} h{stop.travelMinutes ? ` · ${stop.travelMinutes} min travel` : ''}</Txt>
                <Txt size="sm" tone={stop.bookable ? 'muted' : 'warn'} style={{ marginTop: 2 }}>
                  {stop.bookable ? `Books onto job ${stop.job!.externalId}${stop.job!.title ? ` — ${stop.job!.title}` : ''}` : stop.why}
                </Txt>
                {stop.pushedBy ? (
                  <Txt size="xs" tone="accent" style={{ marginTop: 2 }}>
                    Moved to after {stop.pushedBy}, which the office already has you on.
                  </Txt>
                ) : null}
              </View>
              <StatusPill label={stop.bookable ? 'Bookable' : 'No job'} tone={stop.bookable ? 'pass' : 'warn'} />
            </Rowed>
            <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
              <Chip label="Earlier" onPress={() => setStops((s) => moveStop(s, i, -1))} />
              <Chip label="Later" onPress={() => setStops((s) => moveStop(s, i, 1))} />
              <Chip label="Shorter" onPress={() => setStops((s) => s.map((x, j) => (j === i ? { ...x, estimateHours: Math.max(0.25, x.estimateHours - 0.5) } : x)))} />
              <Chip label="Longer" onPress={() => setStops((s) => s.map((x, j) => (j === i ? { ...x, estimateHours: x.estimateHours + 0.5 } : x)))} />
              <Chip label="Remove" onPress={() => setStops((s) => s.filter((_, j) => j !== i))} />
            </Rowed>
          </Card>
        ))
      )}
      {stops.length ? (
        <>
          {layout.overrunHours ? (
            <Banner tone="warn" title={`${layout.overrunHours} h past the end of the shift`} body={`The shift is ${DAY_START} to ${DAY_END}. Take a site off, or accept the overtime — the estimates are estimates.`} />
          ) : null}
          <Button
            title="Put it on my Simpro schedule"
            loading={booking}
            disabled={!employeeId || !layout.stops.some((s) => s.bookable)}
            onPress={() => { void putOnSchedule(); }}
            icon={<MaterialCommunityIcons name="calendar-export" size={20} color={t.color.onAccent} />}
          />
          {booked.length && undoLeft > 0 ? (
            <Button title={`Undo all ${booked.length} — ${undoLeft}s`} variant="secondary" onPress={() => { void undoAll(); }} />
          ) : null}
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{ESTIMATE_CAVEAT}</Txt>
        </>
      ) : null}

      <H2>Sites</H2>
      <SearchBox value={query} onChange={setQuery} placeholder="A site, a suburb, an address" />
      {candidates.length === 0 ? (
        <EmptyState
          title={query ? 'Nothing matched' : 'Nothing due and no open jobs'}
          body={query ? 'Try fewer letters.' : 'Sites appear here when a routine is due or overdue, or the office has an open job at them. Search for any other site.'}
        />
      ) : (
        candidates.map((c) => {
          const f = facts[c.siteId];
          const onDay = stops.some((s) => s.siteId === c.siteId);
          return (
            <Card key={c.siteId} onPress={() => { void showFacts(c.siteId); }}>
              <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{c.siteName}</Txt>
                  <Txt size="sm" tone="muted">
                    {c.suburb ? `${c.suburb} · ` : ''}
                    {c.reason === 'overdue' ? `overdue${c.daysUntilDue !== undefined ? ` by ${Math.abs(c.daysUntilDue)} days` : ''}`
                      : c.reason === 'due' ? `due${c.daysUntilDue !== undefined ? ` in ${c.daysUntilDue} days` : ''}`
                        : c.reason === 'open-job' ? `open job ${c.job?.externalId}` : c.job ? `job ${c.job.externalId}` : 'no open job'}
                  </Txt>
                </View>
                <StatusPill
                  label={c.reason === 'overdue' ? 'Overdue' : c.reason === 'due' ? 'Due' : c.job ? 'Job' : 'No job'}
                  tone={c.reason === 'overdue' ? 'fail' : c.reason === 'due' ? 'warn' : c.job ? 'info' : 'muted'}
                />
              </Rowed>

              {open === c.siteId ? (
                <View style={{ marginTop: t.space(2.5) }}>
                  {f === undefined ? <Txt size="sm" tone="muted">Reading…</Txt> : f === null ? <Txt size="sm" tone="fail">Could not read this site.</Txt> : <FactsBody f={f} />}
                </View>
              ) : null}

              <Rowed gap={2} style={{ marginTop: t.space(2) }}>
                <Chip label={onDay ? 'On the day' : 'Add to my day'} selected={onDay} onPress={() => { if (!onDay) void addSite(c); }} />
                <Chip label={open === c.siteId ? 'Hide' : 'Last service'} onPress={() => { void showFacts(c.siteId); }} />
              </Rowed>
            </Card>
          );
        })
      )}
    </>
  );
}

/** The facts about a site, the way the question is asked in the ute. */
function FactsBody({ f }: { f: SiteFacts }) {
  const t = useTheme();
  const line = (label: string, value: string, tone: 'muted' | 'warn' | 'fail' | 'pass' = 'muted') => (
    <View style={{ marginTop: t.space(1.5) }}>
      <Label>{label}</Label>
      <Txt size="sm" tone={tone} style={{ lineHeight: 19 }}>{value}</Txt>
    </View>
  );
  return (
    <View>
      <Divider />
      {line('Last time', lastServiceLine(f))}
      {f.lastJob ? line('Who', f.lastJob.who.length ? f.lastJob.who.join(', ') : 'Nobody named on the job', f.lastJob.who.length ? 'muted' : 'warn') : null}
      {line('Hours', f.hours
        ? `${f.hours.total} h — ${f.hours.byPerson.map((p) => `${p.name} ${p.hours} h`).join(', ')} (${f.hours.source === 'office-timesheet' ? 'office timesheet' : f.hours.source === 'schedule' ? 'office schedule' : 'this phone’s clock'})`
        : f.clockedOnNote, f.hours ? 'muted' : 'warn')}
      {f.lastRun ? line('Last routine on this phone', `${f.lastRun.routineLabel}${f.lastRun.technician ? ` by ${f.lastRun.technician}` : ''}, ${f.lastRun.daysAgo ?? '?'} days ago — ${f.lastRun.checksPassed} passed, ${f.lastRun.checksFailed} failed, ${f.lastRun.checksNotTested} not tested, ${f.lastRun.defectsRaised} defect${f.lastRun.defectsRaised === 1 ? '' : 's'}`) : null}
      {line('On site', `${f.assetsTotal} asset${f.assetsTotal === 1 ? '' : 's'}: ${assetsLine(f)}`)}
      {f.due.length ? line('Due', f.due.slice(0, 4).map((d) => `${d.routineLabel} (${FREQUENCY_LABEL[d.frequency as keyof typeof FREQUENCY_LABEL] ?? d.frequency}) — ${d.state}${d.daysUntilDue !== undefined ? d.daysUntilDue < 0 ? `, ${Math.abs(d.daysUntilDue)} days over` : `, in ${d.daysUntilDue} days` : ''}`).join('\n'), f.overdue ? 'fail' : 'muted') : null}
      {line('Locked in', f.lockedInNote, f.lockedIn === 'booked' ? 'pass' : f.lockedIn === 'job-only' ? 'warn' : 'fail')}
      {f.contact ? line('Contact', `${f.contact.name ?? ''}${f.contact.name && f.contact.phone ? ' · ' : ''}${f.contact.phone ?? ''}`) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The month — the planner as it was
// ---------------------------------------------------------------------------

type MonthChoice = '0' | '1' | '2';
type TechChoice = '1' | '2' | '3' | '4';

function MonthPlanner() {
  const t = useTheme();
  const [month, setMonth] = useState<MonthChoice>('1');
  const [techs, setTechs] = useState<TechChoice>('2');
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [coverage, setCoverage] = useState<PlanCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkings, setShowWorkings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [built, cover] = await Promise.all([
        buildWorkPlan({ monthOffset: Number(month), technicians: Number(techs) }),
        planCoverage(),
      ]);
      setPlan(built);
      setCoverage(cover);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, techs]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const busyDays = plan?.days.filter((d) => d.visitCount > 0) ?? [];
  const quietDays = (plan?.days.length ?? 0) - busyDays.length;

  return (
    <>
      <Segmented
        value={month}
        onChange={setMonth}
        options={[
          { value: '0', label: 'This month' },
          { value: '1', label: 'Next month' },
          { value: '2', label: 'The one after' },
        ]}
      />
      <View style={{ gap: t.space(1.5) }}>
        <Label>Technicians available</Label>
        <Segmented
          value={techs}
          onChange={setTechs}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '4' },
          ]}
        />
      </View>

      {error ? <Banner tone="fail" title="The plan could not be built" body={error} /> : null}
      {loading && !plan ? <Card><Txt tone="muted">Working out the month…</Txt></Card> : null}

      {plan ? (
        <>
          <Card>
            <Txt weight="700" size="lg">{plan.window.label}</Txt>
            <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>{planHeadline(plan)}</Txt>
            <Rowed gap={2} style={{ marginTop: t.space(3) }}>
              <StatTile label="Visits" value={plan.summary.visits} />
              <StatTile label="Hours (est.)" value={plan.summary.estimatedHours} tone="accent" />
              <StatTile
                label="Load"
                value={`${Math.round(plan.summary.utilisation * 100)}%`}
                tone={plan.summary.utilisation > 0.95 ? 'fail' : plan.summary.utilisation > 0.8 ? 'warn' : 'default'}
              />
            </Rowed>
            <Rowed gap={2} style={{ marginTop: t.space(2) }}>
              <StatTile label="Working days" value={plan.summary.workingDays} />
              <StatTile label="Urgent" value={plan.summary.urgentVisits} tone={plan.summary.urgentVisits ? 'fail' : 'default'} />
              <StatTile label="Unplanned" value={plan.summary.unplanned} tone={plan.summary.unplanned ? 'warn' : 'default'} />
            </Rowed>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(2.5), lineHeight: 17 }}>{ESTIMATE_CAVEAT}</Txt>
          </Card>

          {plan.summary.urgentVisits ? (
            <Banner
              tone="fail"
              title={`${plan.summary.urgentVisits} visit${plan.summary.urgentVisits === 1 ? '' : 's'} already outside tolerance`}
              body="Placed on the earliest working day available and not batched by suburb. Being late costs more than the driving does."
            />
          ) : null}

          {coverage ? <CoverageNote coverage={coverage} /> : null}

          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <Button title={showWorkings ? 'Hide the reasoning' : 'How this was worked out'} variant="secondary" compact onPress={() => setShowWorkings((v) => !v)} />
            </View>
            <Button title="Rebuild" variant="ghost" compact onPress={() => void load()} />
          </Rowed>

          {showWorkings ? (
            <Card>
              {plan.notes.map((note) => (
                <Rowed key={note} gap={2} align="flex-start" style={{ marginBottom: t.space(2) }}>
                  <MaterialCommunityIcons name="information-outline" size={16} color={t.color.textFaint} />
                  <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{note}</Txt>
                </Rowed>
              ))}
              {plan.clusters.length ? (
                <>
                  <Divider />
                  <Label>How the work was grouped</Label>
                  {plan.clusters.map((cluster) => (
                    <View key={cluster.id} style={{ marginTop: t.space(2) }}>
                      <Rowed gap={2}>
                        <Txt size="sm" weight="700">{cluster.label}</Txt>
                        <Chip label={CLUSTER_METHOD_LABEL[cluster.method]} tone={cluster.method === 'locality' ? 'pass' : 'warn'} />
                      </Rowed>
                      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{cluster.basis}</Txt>
                    </View>
                  ))}
                </>
              ) : null}
            </Card>
          ) : null}

          {busyDays.length ? (
            <>
              <H2>The month</H2>
              {busyDays.map((day) => <DayCard key={day.date} day={day} />)}
              {quietDays ? (
                <Txt size="sm" tone="faint" style={{ lineHeight: 19 }}>
                  {quietDays} working day{quietDays === 1 ? '' : 's'} in {plan.window.label} carry no planned work.
                  That is capacity for project work, callouts and the sites listed below as unplanned.
                </Txt>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={`Nothing planned for ${plan.window.label}`}
              body={plan.summary.unplanned
                ? 'Everything due this window is in the list below, with the reason it could not be placed.'
                : 'Nothing falls due inside this window. Routines only plan once they have a service recorded to count from.'}
            />
          )}

          {plan.unplanned.length ? <UnplannedSection plan={plan} /> : null}
        </>
      ) : null}
    </>
  );
}

function CoverageNote({ coverage }: { coverage: PlanCoverage }) {
  const missingAssets = coverage.sites - coverage.sitesWithAssets;
  const missingLocality = coverage.sites - coverage.sitesWithLocality;
  if (!coverage.sites || (missingAssets <= 0 && missingLocality <= 0)) return null;
  const gaps = [
    missingAssets > 0 ? `${missingAssets} have no asset register, so a visit to them cannot be sized` : null,
    missingLocality > 0 ? `${missingLocality} have neither a suburb nor a postcode, so they cannot be batched` : null,
  ].filter(Boolean).join('. ');
  return (
    <Banner
      tone="warn"
      title={`Of ${coverage.sites} sites, ${Math.max(missingAssets, missingLocality)} are not fully plannable`}
      body={`${gaps}. Those sites are left out of the month rather than given an invented half day or an arbitrary `
        + `date, and they are listed below with the reason. A quiet month may only mean a thin register. `
        + `${coverage.routinesWithHistory} site-and-routine pairs have a service recorded to schedule from.`}
    />
  );
}

function DayCard({ day }: { day: PlannedDay }) {
  const t = useTheme();
  return (
    <Card>
      <Rowed style={{ justifyContent: 'space-between' }}>
        <Txt weight="700">{formatPlanDate(day.date)}</Txt>
        <Txt size="sm" tone="muted">{day.visitCount} visit{day.visitCount === 1 ? '' : 's'} · {formatHours(day.hours)} est.</Txt>
      </Rowed>
      {day.technicians.map((tech) => (
        <View key={tech.index} style={{ marginTop: t.space(2) }}>
          {day.technicians.length > 1 ? <Label>{tech.label}</Label> : null}
          {tech.visits.map((v) => <VisitRow key={`${v.siteId}-${v.date}`} visit={v} />)}
        </View>
      ))}
    </Card>
  );
}

function VisitRow({ visit }: { visit: PlannedVisit }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: t.space(1.5) }}>
      <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt size="sm" weight="700">{visit.siteName}</Txt>
          <Txt size="xs" tone="muted">{visit.routines.map((r) => `${r.routineLabel} (${FREQUENCY_LABEL[r.frequency]})`).join(' · ')}</Txt>
        </View>
        <Txt size="sm" tone={visit.urgent ? 'fail' : 'muted'}>{formatHours(visit.hours.hours)}{visit.urgent ? ' · late' : ''}</Txt>
      </Rowed>
    </View>
  );
}

function UnplannedSection({ plan }: { plan: WorkPlan }) {
  const t = useTheme();
  const byReason = new Map<UnplannableReason, typeof plan.unplanned>();
  for (const u of plan.unplanned) byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), u]);
  return (
    <>
      <H2>Could not be planned</H2>
      {[...byReason].map(([reason, items]) => (
        <Card key={reason}>
          <Txt weight="700">{UNPLANNABLE_REASON_LABEL[reason]}</Txt>
          {items.map((u, i) => (
            <View key={`${u.siteId}-${u.routineId ?? i}`} style={{ marginTop: t.space(1.5) }}>
              <Txt size="sm">{u.siteName ?? u.siteId}{u.routineLabel ? ` — ${u.routineLabel}` : ''}</Txt>
              <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{u.detail}</Txt>
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}
