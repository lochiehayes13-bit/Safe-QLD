import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { listJobs } from '@/db/opsRepo';
import { listScheduleFor, scheduleSyncedAt } from '@/db/scheduleRepo';
import {
  groupScheduleByDay, scheduleWindow, whoseSchedule, type MyDayGroups, type MyDayRow, type WhoseSchedule,
} from '@/domain/myDay';
import { qldMoment } from '@/domain/qldTime';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, H2, Rowed, Screen, Txt } from '@/components/ui';

/**
 * My day.
 *
 * The office's schedule, filtered to the person holding the phone: what is
 * on today, tomorrow, and the weeks ahead, each block opening the job where
 * the phone holds it. This is the one job list that belongs on a technician's
 * front page, because it is theirs — the general job list stays in the Work
 * tab for whoever wants it.
 */
export default function MyDayScreen() {
  const t = useTheme();
  const [who, setWho] = useState<WhoseSchedule | null | undefined>(undefined);
  const [groups, setGroups] = useState<MyDayGroups | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const [showEarlier, setShowEarlier] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const prefs = await loadPrefs();
      const w = whoseSchedule(prefs);
      const now = nowIso();
      if (!w) { if (!cancelled) { setWho(null); setGroups(null); } return; }
      const window = scheduleWindow(now);
      const [rows, jobs, synced] = await Promise.all([
        listScheduleFor({
          staffId: w.by === 'id' ? w.staffId : undefined,
          staffName: w.by === 'name' ? w.staffName : undefined,
          from: window.from, to: window.to,
        }),
        listJobs({ limit: 500 }),
        scheduleSyncedAt(),
      ]);
      if (cancelled) return;
      setWho(w);
      setAsOf(synced);
      setGroups(groupScheduleByDay(rows, now, jobs.map((j) => ({
        id: j.id, externalId: j.externalId, siteName: j.siteName, title: j.title, address: j.address,
      }))));
    })();
    return () => { cancelled = true; };
  }, []));

  if (who === undefined) {
    return (<><Stack.Screen options={{ title: 'My day' }} /><Screen><Txt tone="muted">Reading the schedule…</Txt></Screen></>);
  }

  if (who === null) {
    return (
      <>
        <Stack.Screen options={{ title: 'My day' }} />
        <Screen>
          <Card>
            <Txt weight="700">This phone does not know whose it is yet</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>
              Pick yourself from the staff list, or sign in with your Simpro login, and the jobs the
              office has scheduled to you show up here.
            </Txt>
            <View style={{ height: t.space(3) }} />
            <Button title="Pick who I am" onPress={() => router.push('/whoami')} />
          </Card>
        </Screen>
      </>
    );
  }

  const g = groups;
  return (
    <>
      <Stack.Screen options={{ title: 'My day' }} />
      <Screen>
        <Rowed gap={2}>
          <Txt size="sm" tone="muted" style={{ flex: 1 }}>
            Scheduled to {who.label}.{asOf ? ` Office schedule as of ${qldMoment(asOf) ?? asOf}.` : ' Nothing synced yet.'}
          </Txt>
          <Button title="Change" variant="ghost" compact onPress={() => router.push('/whoami')} />
        </Rowed>

        <H2>Today</H2>
        {g && g.today.length ? g.today.map((r) => <ScheduleRow key={r.schedule.id} row={r} />) : (
          <Card><Txt tone="muted">Nothing scheduled to you today{asOf ? '' : ' — or the schedule has not synced yet'}.</Txt></Card>
        )}

        <H2>Tomorrow</H2>
        {g && g.tomorrow.length ? g.tomorrow.map((r) => <ScheduleRow key={r.schedule.id} row={r} />) : (
          <Card><Txt tone="muted">Nothing scheduled to you tomorrow.</Txt></Card>
        )}

        {g && g.later.length ? (
          <>
            <H2>Coming up</H2>
            {g.later.map((r) => <ScheduleRow key={r.schedule.id} row={r} withDate />)}
          </>
        ) : null}

        {g && g.earlier.length ? (
          <>
            <Pressable onPress={() => setShowEarlier((v) => !v)} hitSlop={6}>
              <Rowed gap={1} style={{ marginTop: t.space(3) }}>
                <Txt size="sm" tone="accent" weight="700">
                  {showEarlier ? 'Hide' : 'Show'} the last week ({g.earlier.length})
                </Txt>
                <MaterialCommunityIcons name={showEarlier ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.accentText} />
              </Rowed>
            </Pressable>
            {showEarlier ? g.earlier.map((r) => <ScheduleRow key={r.schedule.id} row={r} withDate />) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

function ScheduleRow({ row, withDate }: { row: MyDayRow; withDate?: boolean }) {
  const t = useTheme();
  const s = row.schedule;
  const job = row.job;
  const time = s.startTime ? `${s.startTime}${s.endTime ? `–${s.endTime}` : ''}` : 'Any time';
  return (
    <Card onPress={job ? () => router.push({ pathname: '/work/job/[id]', params: { id: job.id } }) : undefined}>
      <Rowed gap={3} align="flex-start">
        <View style={{ minWidth: 92 }}>
          {withDate ? <Txt size="xs" tone="muted" weight="700">{formatAuDate(s.date)}</Txt> : null}
          <Txt weight="800" style={{ fontFamily: t.font.mono }}>{time}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="700" numberOfLines={2}>{job?.siteName ?? (s.jobId ? `Job ${s.jobId}` : s.type ?? 'Scheduled block')}</Txt>
          {job?.title ? <Txt size="sm" tone="muted" numberOfLines={1}>{job.title}</Txt> : null}
          {job?.address ? <Txt size="xs" tone="faint" numberOfLines={1}>{job.address}</Txt> : null}
          {!job && s.jobId ? (
            <Txt size="xs" tone="faint">Job {s.jobId} is not on this phone yet. It comes with the next sync.</Txt>
          ) : null}
        </View>
        {job ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : <Chip label={s.type ?? 'Block'} />}
      </Rowed>
    </Card>
  );
}
