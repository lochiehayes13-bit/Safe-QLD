import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { nowIso, newId } from '@/db';
import { deleteEntry, insertClosedEntry, listEntriesBetween } from '@/db/clockRepo';
import { listActivitySchedules, listSetupActivities } from '@/db/moreRepo';
import { queueClockEntry } from '@/simpro/outboundMore';
import {
  LEAVE_END, LEAVE_KINDS, LEAVE_START, buildLeaveEntry, isLeaveEntry, leaveActivityFor, upcomingWorkingDays,
  type ExistingLeave, type LeaveKind, type OfficeActivity,
} from '@/domain/leaveBooking';
import { planLeave, tapLeaveDay } from '@/domain/leaveRange';
import { addDays, type ClockEntry } from '@/domain/clockOn';
import { dayName } from '@/domain/timesheet';
import { qldIsoDay, typedDay } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Rowed, Screen, StatusPill, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Book leave.
 *
 * Pick a day and a kind, and the day goes onto this person's own Simpro
 * schedule as an activity block from seven to three — the same thing the
 * office used to type in after reading an email. Simpro Mobile shows it
 * for that day, the roster reads it, and nothing needs to be re-keyed.
 *
 * It is a clock entry underneath (see @/domain/leaveBooking), so it queues
 * like a clock-on, shows on Waiting to send until the office has it, and
 * can be taken back while it is still on the phone. Once the office holds
 * it, taking it off is the office's, and the screen says so rather than
 * pretending a delete here reaches the roster.
 *
 * The office's activities come from the sync. Until they have been read the
 * kinds show and none can be booked, with the reason: an id guessed here
 * would put the day on the schedule under the wrong heading, which is worse
 * than a screen that asks for a sync.
 */
export default function BookLeaveScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [activities, setActivities] = useState<OfficeActivity[]>([]);
  const [kindId, setKindId] = useState<LeaveKind['id']>('annual');
  // The first and last day as typed, dd/mm/yyyy. The day chips write here too.
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [note, setNote] = useState('');
  const [booked, setBooked] = useState<ClockEntry[]>([]);
  const [office, setOffice] = useState<ExistingLeave[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = qldIsoDay(nowIso()) ?? '';
  const employeeId = prefs?.simproEmployeeId.trim() ?? '';

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const p = await loadPrefs();
      setPrefs(p);
      const synced = await listSetupActivities();
      setActivities(synced.map((a) => ({ id: a.id, name: a.name })));
      if (today) {
        const horizon = addDays(today, 120);
        const mine = (await listEntriesBetween(today, horizon)).filter(isLeaveEntry);
        setBooked(mine);
        const staff = p.simproEmployeeId.trim();
        if (staff) {
          const held = await listActivitySchedules({ staffId: staff, from: today, to: horizon });
          setOffice(held
            .filter((h) => LEAVE_KINDS.some((k) => k.match.test(h.activityName ?? '')))
            .map((h) => ({ date: h.date, activityName: h.activityName ?? undefined, where: 'office' as const })));
        }
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'your leave'));
    }
  }, [today]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const kind = useMemo(() => LEAVE_KINDS.find((k) => k.id === kindId)!, [kindId]);
  const activity = useMemo(() => leaveActivityFor(kind, activities), [kind, activities]);
  const days = useMemo(() => upcomingWorkingDays(today || '2000-01-01', 3), [today]);
  const from = useMemo(() => typedDay(fromText), [fromText]);
  const to = useMemo(() => typedDay(toText), [toText]);

  /** Everything already on the calendar, the phone's and the office's, for the clash check. */
  const existing = useMemo<ExistingLeave[]>(
    () => [
      ...booked.filter((b) => !b.sentAt).map((b) => ({ date: b.date, activityName: b.activityName, where: 'phone' as const })),
      ...booked.filter((b) => b.sentAt).map((b) => ({ date: b.date, activityName: b.activityName, where: 'office' as const })),
      ...office,
    ],
    [booked, office],
  );

  const plan = useMemo(
    () => (from ? planLeave({ from, to: toText.trim() ? to ?? from : undefined }, today, existing) : undefined),
    [from, to, toText, today, existing],
  );
  const toUnreadable = Boolean(toText.trim() && !to);

  const tapDay = (d: string) => {
    const next = tapLeaveDay({ from, to }, d);
    setFromText(next.from ? formatAuDate(next.from) : '');
    setToText(next.to ? formatAuDate(next.to) : '');
  };
  const picked = (d: string) => Boolean(from && d >= from && d <= (to && to > from ? to : from));
  const named = (d: string) => `${dayName(d)} ${formatAuDate(d)}`;

  const book = async () => {
    if (!plan || plan.refused || !activity) return;
    const wanted = plan.book;
    const done: string[] = [];
    const missed: { day: string; why: string }[] = [];
    setBusy(true);
    try {
      for (const d of wanted) {
        const built = buildLeaveEntry({ id: newId(), employeeId, date: d, kind, activity, note });
        if ('refused' in built) { missed.push({ day: d, why: built.refused }); continue; }
        const entry = await insertClosedEntry(built.entry);
        const outcome = await queueClockEntry(entry);
        if (outcome.status === 'not-ready') {
          await deleteEntry(entry.id);
          missed.push({ day: d, why: outcome.why });
          continue;
        }
        done.push(d);
      }
    } catch (e) {
      const why = describeActionFailure(e, 'book the leave');
      for (const d of wanted) if (!done.includes(d) && !missed.some((m) => m.day === d)) missed.push({ day: d, why });
    } finally {
      setBusy(false);
    }
    if (done.length) {
      setFromText('');
      setToText('');
      setNote('');
    }
    await load();

    const span = done.length === 1 ? named(done[0]!) : `${named(done[0] ?? '')} to ${named(done[done.length - 1] ?? '')}, ${done.length} days`;
    const whys = [...new Set(missed.map((m) => m.why))].join(' ');
    if (!done.length) {
      showAlert('Not booked', whys);
    } else if (missed.length) {
      showAlert('Partly booked', `Booked ${done.length} of ${wanted.length} days. Not booked: ${missed.map((m) => named(m.day)).join(', ')}. ${whys}`);
    } else {
      showAlert('Booked', `${activity.name}, ${span}, ${LEAVE_START} to ${LEAVE_END}. Sends to Simpro when there's signal. You can take it back here until then.`);
    }
  };

  const takeBack = (entry: ClockEntry) => {
    showAlert(
      `Take back ${entry.activityName ?? 'this day'}?`,
      `${named(entry.date)} won't be sent.`,
      [
        { text: 'Keep it' },
        {
          text: 'Take it back',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const r = await deleteEntry(entry.id);
                if (!r.ok) showAlert('Still booked', r.why);
                await load();
              } catch (e) {
                showAlert('Still booked', describeActionFailure(e, 'take the day back'));
              }
            })();
          },
        },
      ],
    );
  };

  const upcoming = useMemo(() => {
    const rows: { date: string; name: string; state: 'waiting' | 'sent' | 'office'; entry?: ClockEntry }[] = [];
    for (const b of booked) rows.push({ date: b.date, name: b.activityName ?? 'Leave', state: b.sentAt ? 'sent' : 'waiting', entry: b });
    for (const o of office) {
      if (!rows.some((r) => r.date === o.date)) rows.push({ date: o.date, name: o.activityName ?? 'Leave', state: 'office' });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [booked, office]);

  const summary = (() => {
    if (!plan || !from) return null;
    if (plan.refused) return plan.refused;
    const last = to && to > from ? to : from;
    const span = last === from ? named(from) : `${named(from)} to ${named(last)}, ${plan.book.length} ${plan.book.length === 1 ? 'day' : 'days'}`;
    return `${kind.label}, ${span}, ${LEAVE_START}–${LEAVE_END}`;
  })();

  return (
    <>
      <Stack.Screen options={{ title: 'Book leave' }} />
      <Screen>
        <Txt size="sm" tone="muted">Leave goes on your Simpro schedule, {LEAVE_START} to {LEAVE_END} each day.</Txt>

        {failed ? <Banner tone="fail" title="Couldn't load your leave" body={failed} /> : null}

        {prefs && !employeeId ? (
          <Card onPress={() => router.push('/whoami')}>
            <Txt weight="700">Pick yourself first</Txt>
            <Txt size="sm" tone="muted">Tap to pick from the staff list.</Txt>
          </Card>
        ) : null}

        <H2>Kind of leave</H2>
        <Rowed gap={2} wrap>
          {LEAVE_KINDS.map((k) => {
            const has = Boolean(leaveActivityFor(k, activities));
            return (
              <Chip
                key={k.id}
                label={has || !activities.length ? k.label : `${k.label} · not in Simpro`}
                selected={kindId === k.id}
                onPress={() => setKindId(k.id)}
              />
            );
          })}
        </Rowed>
        {activities.length === 0 ? (
          <Banner tone="warn" title="Leave types not synced yet" body="Run a sync in Settings, then book." />
        ) : !activity ? (
          <Banner
            tone="warn"
            title={`No ${kind.label.toLowerCase()} activity in Simpro`}
            body="Pick another kind, or ask the office to add it."
          />
        ) : (
          <Txt size="sm" tone="faint">Booked as “{activity.name}”.</Txt>
        )}

        <H2>Which days</H2>
        <Txt size="sm" tone="muted">Tap a day, or a first and last day for a run. Weekends are skipped.</Txt>
        <Rowed gap={2} wrap>
          {days.map((d) => (
            <Chip
              key={d}
              label={`${dayName(d)} ${formatAuDate(d).slice(0, 5)}`}
              selected={picked(d)}
              onPress={() => tapDay(d)}
            />
          ))}
        </Rowed>
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field
              label="From"
              value={fromText}
              onChangeText={setFromText}
              placeholder="dd/mm/yyyy"
              hint={fromText.trim() && !from ? 'Write it as dd/mm/yyyy.' : undefined}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="To"
              value={toText}
              onChangeText={setToText}
              placeholder="Same day"
              hint={toUnreadable ? 'Write it as dd/mm/yyyy.' : undefined}
            />
          </View>
        </Rowed>
        <Field label="Note for the office (optional)" value={note} onChangeText={setNote} placeholder="Back Monday" />

        {summary ? (
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2.5),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: t.space(3),
            }}
          >
            <MaterialCommunityIcons name="calendar-check-outline" size={22} color={plan?.refused ? t.color.warn : t.color.accentText} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt weight="700">{summary}</Txt>
              {!plan?.refused && plan?.skipped.length ? (
                <Txt size="sm" tone="warn">Already booked, left out: {plan.skipped.map(named).join(', ')}.</Txt>
              ) : null}
            </View>
          </View>
        ) : null}

        <Button
          title={plan && !plan.refused && plan.book.length > 1 ? `Book ${plan.book.length} days` : 'Book it'}
          onPress={() => { void book(); }}
          loading={busy}
          disabled={!plan || Boolean(plan.refused) || toUnreadable || !activity || !employeeId}
          icon={<MaterialCommunityIcons name="calendar-plus" size={20} color={t.color.onAccent} />}
        />

        <H2>Coming up</H2>
        {upcoming.length === 0 ? (
          <EmptyState icon="beach" title="No leave booked" body="Leave booked here or in Simpro shows here." />
        ) : (
          upcoming.map((row) => (
            <Card key={`${row.date}-${row.state}`}>
              <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
                <Txt weight="700">{named(row.date)}</Txt>
                <StatusPill
                  label={row.state === 'office' ? 'In Simpro' : row.state === 'sent' ? 'Sent' : 'Waiting to send'}
                  tone={row.state === 'waiting' ? 'warn' : 'pass'}
                />
              </Rowed>
              <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
                {row.name}{row.entry ? ` · ${LEAVE_START}–${LEAVE_END}` : ''}
                {row.entry?.sendError ? ` · ${row.entry.sendError}` : ''}
              </Txt>
              {row.entry && !row.entry.sentAt ? (
                <>
                  <Divider />
                  <Chip label="Take it back" onPress={() => takeBack(row.entry!)} />
                </>
              ) : row.state !== 'waiting' ? (
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>In Simpro now. Ask the office to cancel it.</Txt>
              ) : null}
            </Card>
          ))
        )}
      </Screen>
    </>
  );
}
