import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { jobSummariesByExternalIds } from '@/db/opsRepo';
import { listScheduleFor, scheduleSyncedAt } from '@/db/scheduleRepo';
import {
  groupScheduleByDay, scheduleWindow, whoseSchedule, type MyDayGroups, type MyDayRow, type WhoseSchedule,
} from '@/domain/myDay';
import { syncedLine, whoName } from '@/domain/dayHeader';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, H2, Rowed, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { runAutoSync } from '@/simpro/autoSync';
import { jobNotHereWords } from '@/domain/syncWords';
import { describeLoadFailure } from '@/domain/loadFailure';

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
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<MyDayGroups | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const [showEarlier, setShowEarlier] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /** One read of the schedule. `live` says whether the screen still wants the answer. */
  const read = useCallback(async (live: () => boolean) => {
    setFailed(null);
    try {
      const prefs = await loadPrefs();
      const w = whoseSchedule(prefs);
      const now = nowIso();
      if (!w) { if (live()) { setWho(null); setGroups(null); } return; }
      const window = scheduleWindow(now);
      const [rows, synced] = await Promise.all([
        listScheduleFor({
          staffId: w.by === 'id' ? w.staffId : undefined,
          staffName: w.by === 'name' ? w.staffName : undefined,
          from: window.from, to: window.to,
        }),
        scheduleSyncedAt(),
      ]);
      if (!live()) return;
      /*
       * The jobs this schedule actually names, asked for by their ids.
       *
       * It used to read the first five hundred job rows and match the schedule
       * against those. On this owner's phone there are four and a half
       * thousand jobs and around seven hundred open, ordered open-first by the
       * date the office raised them — so a block whose job sat past the five
       * hundredth row found no match, and the row printed "Job 1515 is not on
       * this phone yet — tap to sync" and offered a sync. The job was on the
       * phone the whole time. Being told to fix something that is not broken,
       * by a button that cannot fix it, is worse than being told nothing.
       *
       * The home screen has always done it this way
       * (app/(tabs)/index.tsx, jobSummariesByExternalIds) and so does Today's
       * run. This screen was the one reading a window.
       */
      const jobs = await jobSummariesByExternalIds(
        rows.map((r) => r.jobId).filter((id): id is string => !!id),
      );
      if (!live()) return;
      setWho(w);
      setName(whoName(w, prefs.technicianName));
      setAsOf(synced);
      setGroups(groupScheduleByDay(rows, now, jobs.map((j) => ({
        id: j.id, externalId: j.externalId, siteName: j.siteName, title: j.title, address: j.address,
      }))));
    } catch (e) {
      if (live()) setFailed(describeLoadFailure(e, 'your schedule'));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void read(() => !cancelled);
    return () => { cancelled = true; };
  }, [read]));

  if (failed) {
    return (
      <>
        <Stack.Screen options={{ title: 'My day' }} />
        <Screen>
          <EmptyState
            icon="calendar-alert"
            title="Couldn't load your schedule"
            body={failed}
            action={<Button title="Try again" onPress={() => { void read(() => true); }} />}
          />
        </Screen>
      </>
    );
  }

  if (who === undefined) {
    return (<><Stack.Screen options={{ title: 'My day' }} /><Screen><Txt tone="muted">Loading your schedule…</Txt></Screen></>);
  }

  if (who === null) {
    return (
      <>
        <Stack.Screen options={{ title: 'My day' }} />
        <Screen>
          <Card>
            <Txt weight="700">Who are you?</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>
              Pick yourself from the staff list to see your jobs.
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
          <View style={{ flex: 1 }}>
            <Txt weight="700">{name}</Txt>
            <Txt size="sm" tone="muted">{syncedLine(asOf, nowIso())}</Txt>
          </View>
          <Button title="Change" variant="ghost" compact onPress={() => router.push('/whoami')} />
        </Rowed>
        {/* The team's calendar, and the shortest way onto it: the same screen, opened at the picker. */}
        <Rowed gap={2} wrap>
          <Button title="Schedule" variant="secondary" compact onPress={() => router.push('/work/schedule')}
            icon={<MaterialCommunityIcons name="calendar-month-outline" size={18} color={t.color.accentText} />} />
          <Button title="Book me on" compact onPress={() => router.push({ pathname: '/work/schedule', params: { book: '1' } })}
            icon={<MaterialCommunityIcons name="calendar-plus" size={18} color={t.color.onAccent} />} />
        </Rowed>

        <H2>Today</H2>
        {g && g.today.length ? g.today.map((r) => <ScheduleRow key={r.schedule.id} row={r} />) : (
          <Card><Txt tone="muted">Nothing scheduled today.</Txt></Card>
        )}

        <H2>Tomorrow</H2>
        {g && g.tomorrow.length ? g.tomorrow.map((r) => <ScheduleRow key={r.schedule.id} row={r} />) : (
          <Card><Txt tone="muted">Nothing scheduled tomorrow.</Txt></Card>
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
    <Card
      onPress={job
        ? () => router.push({ pathname: '/work/job/[id]', params: { id: job.id } })
        : () => {
          // Inert rows read as a broken app. The remedy for a job that has not
          // come down is a sync, so the row offers one.
          const said = jobNotHereWords(s.jobId ?? undefined);
          showAlert(said.title, said.body, s.jobId
            ? [
              { text: 'Not now', style: 'cancel' },
              { text: 'Sync now', onPress: () => { void runAutoSync('foreground'); } },
            ]
            : undefined);
        }}
    >
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
            <Txt size="xs" tone="faint">Job {s.jobId} not synced yet. Tap to sync.</Txt>
          ) : null}
        </View>
        {job ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : <Chip label={s.type ?? 'Block'} />}
      </Rowed>
    </Card>
  );
}
