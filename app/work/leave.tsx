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
  LEAVE_END, LEAVE_KINDS, LEAVE_START, alreadyBooked, buildLeaveEntry, isLeaveEntry, leaveActivityFor,
  parseLeaveDay, upcomingWorkingDays,
  type ExistingLeave, type LeaveKind, type OfficeActivity,
} from '@/domain/leaveBooking';
import { addDays, type ClockEntry } from '@/domain/clockOn';
import { dayName } from '@/domain/timesheet';
import { qldIsoDay } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, StatusPill, Txt } from '@/components/ui';
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
  const [day, setDay] = useState<string>();
  const [typed, setTyped] = useState('');
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
  const typedDay = useMemo(() => parseLeaveDay(typed), [typed]);
  const chosen = typedDay ?? day;

  /** Everything already on the calendar, the phone's and the office's, for the duplicate check. */
  const existing = useMemo<ExistingLeave[]>(
    () => [
      ...booked.filter((b) => !b.sentAt).map((b) => ({ date: b.date, activityName: b.activityName, where: 'phone' as const })),
      ...booked.filter((b) => b.sentAt).map((b) => ({ date: b.date, activityName: b.activityName, where: 'office' as const })),
      ...office,
    ],
    [booked, office],
  );

  const clash = chosen ? alreadyBooked(chosen, existing) : undefined;
  const inPast = Boolean(chosen && today && chosen < today);

  const book = async () => {
    if (!chosen || !activity) return;
    setBusy(true);
    try {
      const built = buildLeaveEntry({ id: newId(), employeeId, date: chosen, kind, activity, note });
      if ('refused' in built) {
        showAlert('Not booked', built.refused);
        return;
      }
      const entry = await insertClosedEntry(built.entry);
      const outcome = await queueClockEntry(entry);
      if (outcome.status === 'not-ready') {
        await deleteEntry(entry.id);
        showAlert('Not booked', outcome.why);
        return;
      }
      setTyped('');
      setDay(undefined);
      setNote('');
      await load();
      showAlert(
        'Booked',
        `${activity.name} on ${dayName(chosen)} ${formatAuDate(chosen)}, ${LEAVE_START} to ${LEAVE_END}, is going onto your Simpro schedule now. `
        + 'It is on Waiting to send until the office has it, and can be taken back from here until then.',
      );
    } catch (e) {
      showAlert('Not booked', describeActionFailure(e, 'booking the day'));
    } finally {
      setBusy(false);
    }
  };

  const takeBack = (entry: ClockEntry) => {
    showAlert(
      `Take back ${entry.activityName ?? 'this day'}?`,
      `${dayName(entry.date)} ${formatAuDate(entry.date)} comes off before it reaches the office.`,
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
                showAlert('Still booked', describeActionFailure(e, 'taking the day back'));
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

  return (
    <>
      <Stack.Screen options={{ title: 'Book leave' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Pick the day and it goes onto your own Simpro schedule as {LEAVE_START} to {LEAVE_END}, so the roster and
          Simpro Mobile both show it. No email, nobody re-keys it.
        </Txt>

        {failed ? <Banner tone="fail" title="Could not read your leave" body={failed} /> : null}

        {prefs && !employeeId ? (
          <Card onPress={() => router.push('/signin')}>
            <Txt weight="700">Sign in as yourself first</Txt>
            <Txt size="sm" tone="muted">A day off has to go on somebody’s schedule, and this phone is not yet anybody in Simpro.</Txt>
          </Card>
        ) : null}

        <H2>What kind</H2>
        <Rowed gap={2} wrap>
          {LEAVE_KINDS.map((k) => {
            const has = Boolean(leaveActivityFor(k, activities));
            return (
              <Chip
                key={k.id}
                label={has ? k.label : `${k.label} · not in Simpro`}
                selected={kindId === k.id}
                onPress={() => setKindId(k.id)}
              />
            );
          })}
        </Rowed>
        {activities.length === 0 ? (
          <Banner
            tone="warn"
            title="The office's activity list has not reached this phone yet"
            body="Leave is booked under the activity Simpro already has for it — Annual Leave, RDO, Sick — and those names come down with the sync. Sync once and they appear here."
          />
        ) : !activity ? (
          <Banner
            tone="warn"
            title={`Simpro has no activity for ${kind.label.toLowerCase()}`}
            body={`The office's list is: ${activities.map((a) => a.name).join(', ')}. Pick one of the kinds that is there, or ask the office to add this one.`}
          />
        ) : (
          <Txt size="sm" tone="faint">Goes on the schedule as “{activity.name}”.</Txt>
        )}

        <H2>Which day</H2>
        <Rowed gap={2} wrap>
          {days.map((d) => (
            <Chip
              key={d}
              label={`${dayName(d)} ${formatAuDate(d).slice(0, 5)}`}
              selected={chosen === d}
              onPress={() => { setTyped(''); setDay(d); }}
            />
          ))}
        </Rowed>
        <Field
          label="Or type a day"
          value={typed}
          onChangeText={setTyped}
          placeholder="7/10/2026"
          hint={typed.trim() && !typedDay ? 'Write it as day/month/year.' : 'For a day further out, or a weekend.'}
        />
        <Field label="A note for the office (optional)" value={note} onChangeText={setNote} placeholder="Back Monday" />

        {chosen ? (
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.space(2.5),
              backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: t.space(3),
            }}
          >
            <MaterialCommunityIcons name="calendar-check-outline" size={22} color={clash || inPast ? t.color.warn : t.color.accentText} />
            <Txt weight="700" style={{ flex: 1 }}>
              {clash ?? (inPast ? 'That day has already been. Leave in the past is for the office to fix.' : `${kind.label}, ${dayName(chosen)} ${formatAuDate(chosen)}, ${LEAVE_START}–${LEAVE_END}`)}
            </Txt>
          </View>
        ) : null}

        <Button
          title="Book it"
          onPress={() => { void book(); }}
          loading={busy}
          disabled={!chosen || !activity || !employeeId || Boolean(clash) || inPast}
          icon={<MaterialCommunityIcons name="calendar-plus" size={20} color={t.color.onAccent} />}
        />

        <H2>Coming up</H2>
        {upcoming.length === 0 ? (
          <EmptyState
          icon="beach" title="No leave booked" body="Anything booked from here, or already on your Simpro schedule, is listed here." />
        ) : (
          upcoming.map((row) => (
            <Card key={`${row.date}-${row.state}`}>
              <Rowed style={{ justifyContent: 'space-between' }} align="baseline">
                <Txt weight="700">{dayName(row.date)} {formatAuDate(row.date)}</Txt>
                <StatusPill
                  label={row.state === 'office' ? 'On Simpro' : row.state === 'sent' ? 'Sent' : 'Waiting to send'}
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
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>
                  The office holds this one now. To cancel it, the office takes it off the schedule.
                </Txt>
              ) : null}
            </Card>
          ))
        )}

        <Card>
          <Label>How this reaches Simpro</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            The day is queued like a clock-on and sent as an activity schedule on your own staff record. Before it is
            written the office is read first, so a day it already holds is never posted twice. It stays on Waiting to
            send until the office answers, and until then it can be taken back from here.
          </Txt>
        </Card>
      </Screen>
    </>
  );
}
