import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSiteSummaries, listDefects, defectsAwaitingNotice, type SiteSummary } from '@/db/repo';
import { listJobs, listImpairments, listPromises, pendingSyncCount, restockNeeded, impairmentElapsedMs, type ImpairmentRecord, type JobRecord, type Promise_ } from '@/db/opsRepo';
import { queryAssets, recurringFailures, type RecurringFailure } from '@/db/assetRepo';
import { lapsedEverywhere } from '@/db/routineRunRepo';
import type { Defect } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { useTheme, type Theme } from '@/theme';
import { Card, Chip, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Today — the technician's home.
 *
 * Ordered by what would ruin the day if missed: an open impairment has a legal
 * clock on it and comes first, then urgent work, then the next job, then the
 * things a person is expected to remember and shouldn't have to.
 */
export default function TodayScreen() {
  const t = useTheme();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [impairments, setImpairments] = useState<ImpairmentRecord[]>([]);
  const [promises, setPromises] = useState<Promise_[]>([]);
  const [restock, setRestock] = useState(0);
  const [pending, setPending] = useState(0);
  const [dueAssets, setDueAssets] = useState(0);
  const [recurring, setRecurring] = useState<RecurringFailure[]>([]);
  const [notices, setNotices] = useState<Defect[]>([]);
  const [lapsed, setLapsed] = useState(0);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [j, s, d, imp, pr, rs, pc, due, rec, nt, lap] = await Promise.all([
      listJobs({ limit: 50 }),
      listSiteSummaries(),
      listDefects(),
      listImpairments(true),
      listPromises(true),
      restockNeeded(),
      pendingSyncCount(),
      queryAssets({ dueBefore: today, limit: 500 }),
      recurringFailures(undefined, 3),
      defectsAwaitingNotice(),
      lapsedEverywhere(new Date().toISOString()),
    ]);
    setJobs(j); setSites(s); setDefects(d); setImpairments(imp);
    setPromises(pr); setRestock(rs.length); setPending(pc);
    setDueAssets(due.length); setRecurring(rec); setNotices(nt);
    setLapsed(lap.filter((x) => x.state === 'overdue').length);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openDefects = defects.filter((d) => d.status === 'open');
  const criticalDefects = openDefects.filter((d) => d.severity === 'critical');
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysJobs = jobs.filter((j) => j.scheduledFor?.slice(0, 10) === todayIso);
  const urgentJobs = jobs.filter((j) => j.priority === 'urgent' && j.status !== 'complete');
  const nextJob = todaysJobs.find((j) => j.status !== 'complete') ?? jobs.find((j) => j.status !== 'complete');

  return (
    <Screen>
      <Greeting />

      {impairments.map((imp) => <ImpairmentBanner key={imp.id} impairment={imp} />)}

      <Rowed gap={2} wrap>
        <Pill label="Urgent" value={urgentJobs.length} tone={urgentJobs.length ? 'fail' : 'muted'} onPress={() => router.push('/work/jobs')} />
        <Pill label="Open defects" value={openDefects.length} tone={criticalDefects.length ? 'fail' : openDefects.length ? 'warn' : 'muted'} onPress={() => router.push('/work/defects')} />
        <Pill label="Today" value={todaysJobs.length} tone={todaysJobs.length ? 'accent' : 'muted'} onPress={() => router.push('/work/jobs')} />
        <Pill label="Overdue" value={lapsed} tone={lapsed ? 'fail' : 'muted'} onPress={() => router.push('/work/due')} />
        <Pill label="Assets due" value={dueAssets} tone={dueAssets ? 'warn' : 'muted'} />
      </Rowed>

      {nextJob ? <NextJobCard job={nextJob} /> : null}

      {notices.length ? (
        <Card onPress={() => router.push({ pathname: '/work/notice/[id]', params: { id: notices[0]!.id } })}>
          <Rowed gap={3}>
            <MaterialCommunityIcons name="clock-alert-outline" size={22} color={t.color.fail} />
            <View style={{ flex: 1 }}>
              <Txt weight="700" tone="fail">
                {notices.length} critical defect notice{notices.length === 1 ? '' : 's'} not yet issued
              </Txt>
              <Txt size="sm" tone="muted" numberOfLines={2}>
                The occupier has to be given written notice within 24 hours of the maintenance.
              </Txt>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
          </Rowed>
        </Card>
      ) : null}

      {promises.length ? (
        <Card onPress={() => router.push('/work/promises')}>
          <Rowed gap={3}>
            <MaterialCommunityIcons name="hand-back-right-outline" size={22} color={t.color.warn} />
            <View style={{ flex: 1 }}>
              <Txt weight="700">{promises.length} thing{promises.length === 1 ? '' : 's'} you said you'd do</Txt>
              <Txt size="sm" tone="muted" numberOfLines={1}>{promises[0]!.what}</Txt>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
          </Rowed>
        </Card>
      ) : null}

      {recurring.length ? (
        <Card onPress={() => router.push('/work/recurring')}>
          <Rowed gap={3}>
            <MaterialCommunityIcons name="repeat-variant" size={22} color={t.color.warn} />
            <View style={{ flex: 1 }}>
              <Txt weight="700">{recurring.length} asset{recurring.length === 1 ? '' : 's'} failing repeatedly</Txt>
              <Txt size="sm" tone="muted" numberOfLines={1}>
                {recurring[0]!.assetName} has failed {recurring[0]!.failures} times — worth a root cause, not another swap.
              </Txt>
            </View>
          </Rowed>
        </Card>
      ) : null}

      <ActionGrid restock={restock} pending={pending} siteCount={sites.length} />

      {pending > 0 ? (
        <Rowed gap={2}>
          <MaterialCommunityIcons name="cloud-upload-outline" size={16} color={t.color.textFaint} />
          <Txt size="xs" tone="faint">{pending} record{pending === 1 ? '' : 's'} waiting to sync. Nothing is lost — they go up when you have signal.</Txt>
        </Rowed>
      ) : null}
    </Screen>
  );
}

function Greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Evening';
  return (
    <View style={{ gap: 2 }}>
      <Txt size="xs" tone="faint" weight="700" style={{ letterSpacing: 1.2 }}>SAFE QLD</Txt>
      <Txt size="display" weight="700" style={{ letterSpacing: -0.8 }}>{part}</Txt>
      <Txt tone="muted" size="sm">
        {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Txt>
    </View>
  );
}

function ImpairmentBanner({ impairment }: { impairment: ImpairmentRecord }) {
  const t = useTheme();
  const [, tick] = useState(0);

  // The clock is the point of this banner, so it has to actually move.
  React.useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);

  const ms = impairmentElapsedMs(impairment);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);

  return (
    <Pressable onPress={() => router.push({ pathname: '/impairment/[id]', params: { id: impairment.id } })}>
      <View
        style={{
          backgroundColor: t.color.failBg,
          borderRadius: t.radius.lg,
          borderLeftWidth: 4,
          borderLeftColor: t.color.fail,
          padding: t.space(4),
          gap: t.space(1),
        }}
      >
        <Rowed gap={2}>
          <MaterialCommunityIcons name="alert-octagon" size={20} color={t.color.fail} />
          <Txt weight="700" tone="fail">SYSTEM IMPAIRED</Txt>
        </Rowed>
        <Txt size="display" weight="700" mono tone="fail" style={{ letterSpacing: -1 }}>
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Txt>
        <Txt size="sm" tone="muted">{impairment.system}{impairment.scope ? ` — ${impairment.scope}` : ''}</Txt>
      </View>
    </Pressable>
  );
}

function NextJobCard({ job }: { job: JobRecord }) {
  const t = useTheme();
  return (
    <Card onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: job.id } })}>
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
        Next job
      </Txt>
      <Txt size="xl" weight="700" style={{ marginTop: 4 }} numberOfLines={2}>{job.siteName}</Txt>
      <Txt tone="muted" numberOfLines={1}>{job.title}</Txt>
      {job.address ? <Txt size="sm" tone="faint" numberOfLines={1}>{job.address}</Txt> : null}
      <Rowed gap={2} wrap style={{ marginTop: t.space(2.5) }}>
        {job.priority === 'urgent' ? <Chip label="Urgent" tone="fail" /> : null}
        {job.jobType ? <Chip label={job.jobType} /> : null}
        {job.scheduledFor ? <Chip label={formatAuDate(job.scheduledFor)} /> : null}
        <Chip label={job.status === 'in-progress' ? 'In progress' : 'Scheduled'} tone={job.status === 'in-progress' ? 'pass' : 'default'} />
      </Rowed>
    </Card>
  );
}

interface Action {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  href: string;
  badge?: number;
  tone?: 'fail' | 'warn';
}

function ActionGrid({ restock, pending, siteCount }: { restock: number; pending: number; siteCount: number }) {
  const t = useTheme();
  const actions: Action[] = [
    { label: 'My jobs', icon: 'clipboard-list-outline', href: '/work/jobs' },
    { label: 'Sites', icon: 'office-building-marker-outline', href: '/sites', badge: siteCount },
    { label: 'Find asset', icon: 'magnify-scan', href: '/assets/find' },
    { label: 'Raise defect', icon: 'alert-plus-outline', href: '/work/defect/new' },
    { label: 'Impairment', icon: 'alert-octagon-outline', href: '/impairment/new', tone: 'fail' },
    { label: 'Calculators', icon: 'calculator-variant-outline', href: '/tools' },
    { label: 'Parts', icon: 'package-variant-closed', href: '/catalogue' },
    { label: 'Van stock', icon: 'van-utility', href: '/work/stock', badge: restock, tone: restock ? 'warn' : undefined },
    { label: 'Timesheet', icon: 'calendar-clock-outline', href: '/work/timesheets' },
    { label: 'Reports', icon: 'file-document-outline', href: '/work/reports' },
    { label: 'Knowledge', icon: 'lightbulb-on-outline', href: '/work/knowledge' },
    { label: 'Settings', icon: 'cog-outline', href: '/settings' },
  ];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2.5) }}>
      {actions.map((a) => (
        <ActionTile key={a.href} action={a} theme={t} />
      ))}
    </View>
  );
}

function ActionTile({ action, theme: t }: { action: Action; theme: Theme }) {
  const tint = action.tone === 'fail' ? t.color.fail : action.tone === 'warn' ? t.color.warn : t.color.accentText;
  return (
    <Pressable
      onPress={() => router.push(action.href as never)}
      style={({ pressed }) => ({
        // Three across on a phone, with the row gap accounted for.
        width: '31%',
        aspectRatio: 1,
        backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface,
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: t.color.border,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space(1.5),
        padding: t.space(2),
      })}
    >
      <View>
        <MaterialCommunityIcons name={action.icon} size={26} color={tint} />
        {action.badge ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              right: -12,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 5,
              backgroundColor: action.tone === 'warn' ? t.color.warn : t.color.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt size="xs" weight="700" style={{ color: '#fff', fontSize: 10 }}>{action.badge}</Txt>
          </View>
        ) : null}
      </View>
      <Txt size="xs" weight="600" style={{ textAlign: 'center' }} numberOfLines={2}>{action.label}</Txt>
    </Pressable>
  );
}

function Pill({ label, value, tone, onPress }: { label: string; value: number; tone: 'fail' | 'warn' | 'accent' | 'muted'; onPress?: () => void }) {
  const t = useTheme();
  const colour = { fail: t.color.fail, warn: t.color.warn, accent: t.color.accentText, muted: t.color.textFaint }[tone];
  const bg = { fail: t.color.failBg, warn: t.color.warnBg, accent: t.color.infoBg, muted: t.color.surfaceAlt }[tone];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow: 1,
        minWidth: '22%',
        backgroundColor: bg,
        borderRadius: t.radius.md,
        paddingVertical: t.space(2.5),
        paddingHorizontal: t.space(2),
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Txt size="xxl" weight="700" style={{ color: colour }}>{value}</Txt>
      <Txt size="xs" tone="muted" weight="600" numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}
