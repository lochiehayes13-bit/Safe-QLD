import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { clearDayDraft, draftIsCurrent, loadDayDraft, saveDayDraft } from '@/day-draft';
import { nowIso } from '@/db';
import { planCandidates, siteFacts, type PlanCandidate } from '@/db/siteHistoryRepo';
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
import { assetsLine, lastServiceLine, openDefectsLine, type SiteFacts } from '@/domain/siteHistory';
import {
  DAY_END, bookingsFor, dayHeadline, layOutDay, moveStop, type BusyBlock, type DaySite,
} from '@/domain/dayBuilder';
import { estimateVisitHours } from '@/domain/workPlan';
import { FREQUENCY_LABEL, SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import { dayName } from '@/domain/timesheet';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, H2, Label, Rowed, Screen, SearchBox, StatusPill, Txt,
} from '@/components/ui';

/**
 * Plan work: build a day.
 *
 * The question asked in the ute at seven in the morning: which sites, in what
 * order, and what do I need to know before I walk in. Each site carries the
 * facts about the last time it was serviced — who, when, how long they took
 * and whether anyone recorded hours at all, what is registered there, what is
 * due, and whether the next visit is on the office's calendar yet. Add sites
 * to the day, drag the order, and the day is laid out from seven as
 * back-to-back blocks. Put it on my Simpro schedule books every block that
 * has a job under it, through the same read-first, hold-a-minute path the
 * calendar uses.
 *
 * Nothing here invents a job. A site with no open Simpro job is laid out so
 * the day's hours are honest and marked not bookable with the reason: the
 * office raises jobs, and a block posted against nothing is a block on
 * nothing.
 */
export default function WorkPlanScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Plan work' }} />
      <Screen>
        <DayBuilder />
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
  /** How many sites the typed words match, which is not how many are drawn. */
  const [matching, setMatching] = useState(0);
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
      const page = await planCandidates(today, query);
      setCandidates(page.rows);
      setMatching(page.capped ? page.matching : 0);

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
      setMatching(0);
      setDraftLoaded(true);
      setFailed(describeLoadFailure(e, 'the sites'));
    }
  }, [today, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The draft follows the day, so walking out to the Jobs tab no longer
  // throws it away.
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
            label: b.jobId ? `Job ${b.jobId}` : 'Office booking',
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
          problems.push(`${p.siteName ?? p.jobId}: job ${p.jobId} has no cost centre. Not booked.`);
          continue;
        }
        const r = await queueScheduleChange({
          kind: SCHEDULE_BOOK_KIND,
          payload: {
            employeeId: p.employeeId, jobId: p.jobId, sectionId: cc.sectionExternalId, costCenterId: cc.costCenterExternalId,
            date: p.date, start: p.start, end: p.end, siteName: p.siteName, notBefore: p.notBefore,
          },
        });
        if (r.duplicate) problems.push(`${p.siteName ?? p.jobId}: already queued.`);
        else done.push({ rowId: r.id, siteName: p.siteName ?? p.jobId, start: p.start, end: p.end, notBefore: p.notBefore });
        if (options.length > 1) problems.push(`${p.siteName ?? p.jobId}: booked on ${cc.name}, 1 of ${options.length} cost centres. Move it on the calendar if wrong.`);
      }
      for (const s of plan.skipped) problems.push(`${s.stop.siteName}: ${s.why}`);
      setBooked(done);
      showAlert(
        done.length ? `${done.length} block${done.length === 1 ? '' : 's'} queued for ${dayName(date)} ${formatAuDate(date)}` : 'Nothing queued',
        [
          done.length ? 'Sending in a minute. Undo below.' : '',
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
    showAlert(taken === booked.length ? 'Undone' : 'Some already sent', `${taken} of ${booked.length} block${booked.length === 1 ? '' : 's'} taken back.`);
  };

  const undoLeft = booked.length ? Math.max(0, Math.ceil((Date.parse(booked[0]!.notBefore) - now) / 1000)) : 0;

  return (
    <>
      {failed ? <Banner tone="fail" title="Could not read the sites" body={failed} /> : null}

      {prefs && !employeeId ? (
        <Card onPress={() => router.push('/whoami')}>
          <Txt weight="700">Pick yourself to book a day</Txt>
          <Txt size="sm" tone="muted">You can still build the day.</Txt>
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
          title="Already booked that day"
          body={busy.map((b) => `${b.start}–${b.end} ${b.label}`).join('\n')}
        />
      ) : null}

      <Rowed style={{ justifyContent: 'space-between' }} align="center">
        <H2>Your day</H2>
        {stops.length ? <Chip label="Start again" onPress={() => setStops([])} /> : null}
      </Rowed>
      {stops.length ? <Txt size="sm" tone="muted">{dayHeadline(layout)}</Txt> : null}
      {stops.length === 0 ? (
        <EmptyState
          icon="calendar-blank-outline" title="Nothing on the day yet" body="Add sites from the list below." />
      ) : (
        layout.stops.map((stop, i) => (
          <Card key={stop.siteId}>
            <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
              <View style={{ flex: 1 }}>
                <Txt weight="700">{stop.order}. {stop.siteName}</Txt>
                <Txt size="sm" tone="muted">{stop.start}–{stop.end} · about {stop.estimateHours} h{stop.travelMinutes ? ` · ${stop.travelMinutes} min travel` : ''}</Txt>
                <Txt size="sm" tone={stop.bookable ? 'muted' : 'warn'} style={{ marginTop: 2 }}>
                  {stop.bookable ? `Job ${stop.job!.externalId}${stop.job!.title ? ` · ${stop.job!.title}` : ''}` : stop.why}
                </Txt>
                {stop.pushedBy ? (
                  <Txt size="xs" tone="accent" style={{ marginTop: 2 }}>
                    Moved after {stop.pushedBy} (already booked).
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
            <Banner tone="warn" title={`${layout.overrunHours} h past knock-off`} body={`Knock-off is ${DAY_END}. Drop a site?`} />
          ) : null}
          <Button
            title="Put it on my Simpro schedule"
            loading={booking}
            disabled={!employeeId || !layout.stops.some((s) => s.bookable)}
            onPress={() => { void putOnSchedule(); }}
            icon={<MaterialCommunityIcons name="calendar-export" size={20} color={t.color.onAccent} />}
          />
          {booked.length && undoLeft > 0 ? (
            <Button title={`Undo all ${booked.length} (${undoLeft}s)`} variant="secondary" onPress={() => { void undoAll(); }} />
          ) : null}
          <Txt size="xs" tone="faint">Times are estimates from the asset count.</Txt>
        </>
      ) : null}

      <H2>Sites</H2>
      <SearchBox value={query} onChange={setQuery} placeholder="Site, suburb or client" />
      {/*
        * Said when it bites. Sixty matches were drawn out of however many
        * there were, in silence, so a planner searching a big client saw an
        * arbitrary sixty of their sites and the empty state's "try fewer
        * letters" was the opposite of the advice they needed.
        */}
      {matching ? (
        <Txt size="xs" tone="faint">
          {`First ${candidates.length} of ${matching.toLocaleString()}. Add the suburb to narrow it.`}
        </Txt>
      ) : null}
      {candidates.length === 0 ? (
        <EmptyState
          icon="clipboard-list-outline"
          title={query ? 'No match' : 'Nothing due and no open jobs'}
          body={query ? 'Try the suburb.' : 'Due sites and open jobs show here. Search for others.'}
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
        ? `${f.hours.total} h: ${f.hours.byPerson.map((p) => `${p.name} ${p.hours} h`).join(', ')} (${f.hours.source === 'office-timesheet' ? 'office timesheet' : f.hours.source === 'schedule' ? 'office schedule' : 'this phone’s clock'})`
        : f.clockedOnNote, f.hours ? 'muted' : 'warn')}
      {f.lastRun ? line('Last routine on this phone', `${f.lastRun.routineLabel}${f.lastRun.technician ? ` by ${f.lastRun.technician}` : ''}, ${f.lastRun.daysAgo ?? '?'} days ago. ${f.lastRun.checksPassed} passed, ${f.lastRun.checksFailed} failed, ${f.lastRun.checksNotTested} not tested, ${f.lastRun.defectsRaised} defect${f.lastRun.defectsRaised === 1 ? '' : 's'}`) : null}
      {/*
        * What is still broken, as opposed to what the last visit raised.
        * "3 defects raised" against a routine says nothing about whether they
        * were fixed the same afternoon or have been sitting since March, and
        * that is the fact that decides what goes in the van.
        */}
      {f.open.total ? line(
        'Still open',
        [
          openDefectsLine(f),
          f.open.worst
            ? `Worst: ${f.open.worst.location || 'no location'}: ${f.open.worst.description}`
            : '',
        ].filter(Boolean).join('\n'),
        f.open.critical ? 'fail' : 'warn',
      ) : null}
      {line('On site', `${f.assetsTotal} asset${f.assetsTotal === 1 ? '' : 's'}: ${assetsLine(f)}`)}
      {f.due.length ? line('Due', f.due.slice(0, 4).map((d) => `${d.routineLabel} (${FREQUENCY_LABEL[d.frequency as keyof typeof FREQUENCY_LABEL] ?? d.frequency}): ${d.state}${d.daysUntilDue !== undefined ? d.daysUntilDue < 0 ? `, ${Math.abs(d.daysUntilDue)} days over` : `, in ${d.daysUntilDue} days` : ''}`).join('\n'), f.overdue ? 'fail' : 'muted') : null}
      {line('Locked in', f.lockedInNote, f.lockedIn === 'booked' ? 'pass' : f.lockedIn === 'job-only' ? 'warn' : 'fail')}
      {f.contact ? line('Contact', `${f.contact.name ?? ''}${f.contact.name && f.contact.phone ? ' · ' : ''}${f.contact.phone ?? ''}`) : null}
    </View>
  );
}
