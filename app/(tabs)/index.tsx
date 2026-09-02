import React, { useCallback, useMemo, useState } from 'react';
import { nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listSiteSummaries, listDefects, defectsAwaitingNotice, type SiteSummary } from '@/db/repo';
import { listJobs, listImpairments, listPromises, pendingSyncCount, restockNeeded, impairmentElapsedMs, type ImpairmentRecord, type JobRecord, type Promise_ } from '@/db/opsRepo';
import { queryAssets, recurringFailures, type RecurringFailure } from '@/db/assetRepo';
import { lapsedEverywhere } from '@/db/routineRunRepo';
import type { Defect } from '@/domain/types';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { resolveShortcuts, type AppModule } from '@/domain/modules';
import { readAllSyncState } from '@/simpro/watermark';
import { describeStaleness } from '@/simpro/incremental';
import { useTheme, type Theme } from '@/theme';
import { Card, Chip, Rowed, Screen, Txt } from '@/components/ui';
import { TextInput } from 'react-native';

/**
 * The question bar.
 *
 * A technician with a question is usually holding something in the other hand
 * and standing under the thing they are asking about. Making them find the
 * tools tab first is three taps they will not spend, so the whole library —
 * clause index, their own imported documents, the defect wording, the
 * calculators — opens from one line on the screen they are already on.
 */
function QuickAsk() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const go = () => {
    const query = q.trim();
    if (query.length < 2) return;
    router.push(`/library?q=${encodeURIComponent(query)}` as never);
    setQ('');
  };
  return (
    <Pressable onPress={() => router.push('/library' as never)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space(2.5),
          backgroundColor: t.color.surface,
          borderWidth: 1,
          borderColor: t.color.border,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.space(4),
          minHeight: t.touch,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={go}
          returnKeyType="search"
          placeholder="Ask anything — clauses, defects, a calculation"
          placeholderTextColor={t.color.textFaint}
          style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md, paddingVertical: t.space(3) }}
        />
      </View>
    </Pressable>
  );
}

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
  /*
   * Whether the first read has happened.
   *
   * Nought sites means one of two things and they need different screens: the
   * database has not been read yet, or it has and there is nothing in it. Both
   * were an empty list, so a fresh install and a slow first read looked the
   * same — and the fresh install is the one that needs to be told what to do.
   */
  const [loaded, setLoaded] = useState(false);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [impairments, setImpairments] = useState<ImpairmentRecord[]>([]);
  const [promises, setPromises] = useState<Promise_[]>([]);
  const [restock, setRestock] = useState(0);
  const [pending, setPending] = useState(0);
  const [dueAssets, setDueAssets] = useState(0);
  const [recurring, setRecurring] = useState<RecurringFailure[]>([]);
  const [notices, setNotices] = useState<Defect[]>([]);
  const [lapsed, setLapsed] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [shortcuts, setShortcuts] = useState<AppModule[]>([]);
  const [staleness, setStaleness] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The Queensland calendar day. Between midnight and 10am a UTC day is
    // yesterday's, and this company starts at seven.
    const today = qldIsoDay(nowIso()) ?? '';
    const [j, s, d, imp, pr, rs, pc, due, rec, nt, lap, allAssets, syncState, prefs] = await Promise.all([
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
      queryAssets({ limit: 100000 }),
      readAllSyncState(),
      loadPrefs(),
    ]);
    setJobs(j); setSites(s); setDefects(d); setImpairments(imp); setLoaded(true);
    setPromises(pr); setRestock(rs.length); setPending(pc);
    setDueAssets(due.length); setRecurring(rec); setNotices(nt);
    setLapsed(lap.filter((x) => x.state === 'overdue').length);
    setAssetCount(allAssets.length);
    setShortcuts(resolveShortcuts(prefs.shortcuts));
    /*
     * The oldest thing on the device decides how current it is.
     *
     * Sites can be an hour old and the asset register a fortnight, and it is
     * the fortnight that matters — a technician reading a due list does not
     * know which resource it came from. So the worst state wins, and anything
     * short of fresh is said out loud.
     */
    const now = new Date();
    const RANK = { never: 3, stale: 2, ageing: 1, fresh: 0 } as const;
    const worst = syncState
      .map((st) => describeStaleness(st, now))
      .sort((a, b) => RANK[b.state] - RANK[a.state])[0];
    setStaleness(!worst || worst.state === 'fresh' ? null : worst.label);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openDefects = defects.filter((d) => d.status === 'open');
  const criticalDefects = openDefects.filter((d) => d.severity === 'critical');
  const todayIso = qldIsoDay(nowIso()) ?? '';
  // Simpro's job date is an instant, so both sides are resolved the same way.
  // Sliced, this screen showed yesterday's jobs every morning until ten.
  const todaysJobs = jobs.filter((j) => qldIsoDay(j.scheduledFor ?? undefined) === todayIso);
  const urgentJobs = jobs.filter((j) => j.priority === 'urgent' && j.status !== 'complete');
  const nextJob = todaysJobs.find((j) => j.status !== 'complete') ?? jobs.find((j) => j.status !== 'complete');

  return (
    <Screen>
      <Greeting />
      <SystemBar sites={sites.length} assets={assetCount} pending={pending} staleness={staleness} />
      <QuickAsk />

      {impairments.map((imp) => <ImpairmentBanner key={imp.id} impairment={imp} />)}

      {loaded && !sites.length ? <FirstRun /> : null}

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

      <ActionGrid shortcuts={shortcuts} restock={restock} pending={pending} siteCount={sites.length} />

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
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Rowed gap={2}>
        <View style={{ width: 3, height: t.font.size.xs + 2, borderRadius: 2, backgroundColor: t.color.accent }} />
        <Txt size="xs" tone="accent" weight="800" style={{ letterSpacing: 2 }}>SAFE QLD</Txt>
      </Rowed>
      <Txt size="display" weight="800" style={{ letterSpacing: -1.2 }}>{part}</Txt>
      <Txt tone="muted" size="sm">
        {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Txt>
    </View>
  );
}

/**
 * What the device is actually holding, in one line.
 *
 * The screen was full of things needing attention and said nothing about
 * whether the copy underneath them was current. This app works offline, so
 * every number on this page is a snapshot of whenever there was last a signal
 * — and a technician trusting a stale register walks past equipment. The counts
 * are set in the monospaced face on purpose: they are readouts, not prose, and
 * they line up as they change.
 */
function SystemBar({
  sites, assets, pending, staleness,
}: { sites: number; assets: number; pending: number; staleness: string | null }) {
  const t = useTheme();
  const fresh = staleness === null;
  const cell = (label: string, value: string, tone?: string) => (
    <View key={label} style={{ flex: 1, gap: 2 }}>
      <Txt size="xs" tone="faint" weight="700" style={{ letterSpacing: 1 }}>{label}</Txt>
      <Txt weight="800" style={{ fontFamily: t.font.mono, color: tone ?? t.color.text, fontSize: t.font.size.md }}>
        {value}
      </Txt>
    </View>
  );
  return (
    <Pressable onPress={() => router.push('/settings' as never)}>
      <View
        style={{
          backgroundColor: t.color.bgElevated,
          borderRadius: t.radius.lg,
          borderWidth: 1,
          borderColor: t.color.border,
          borderLeftWidth: 3,
          borderLeftColor: fresh ? t.color.accent : t.color.warn,
          padding: t.space(3.5),
          gap: t.space(2.5),
        }}
      >
        <Rowed gap={2}>
          <View
            style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: fresh ? t.color.pass : t.color.warn,
            }}
          />
          <Txt size="xs" weight="700" tone={fresh ? 'pass' : 'warn'} style={{ letterSpacing: 0.8, flex: 1 }}>
            {fresh ? 'OFFICE DATA CURRENT' : (staleness ?? '').toUpperCase()}
          </Txt>
          <MaterialCommunityIcons name="chevron-right" size={16} color={t.color.textFaint} />
        </Rowed>
        <Rowed gap={2}>
          {cell('SITES', sites.toLocaleString('en-AU'))}
          {cell('ASSETS', assets.toLocaleString('en-AU'))}
          {cell('TO SEND', String(pending), pending ? t.color.warn : undefined)}
        </Rowed>
      </View>
    </Pressable>
  );
}

/**
 * What to do on a phone with nothing in it yet.
 *
 * A fresh install shows a grid of thirteen tiles and a row of noughts, which is
 * correct and says nothing. The two things that turn it into somebody's round
 * were written down in RUNNING.md, on a computer, which is not where the person
 * holding the phone is.
 *
 * It goes as soon as there is a site, so it costs nothing after the first day —
 * and it is deliberately two steps rather than a tour, because the second one
 * is the one that matters and a list of six would bury it.
 */
function FirstRun() {
  const t = useTheme();
  return (
    <Card>
      <Rowed gap={2} align="center">
        <MaterialCommunityIcons name="flag-outline" size={18} color={t.color.accentText} />
        <Txt weight="700" style={{ flex: 1 }}>Nothing on this device yet</Txt>
      </Rowed>
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>
        Two things get it to look like your round. Neither needs signal.
      </Txt>
      <View style={{ height: t.space(2) }} />
      <Card onPress={() => router.push('/settings')}>
        <Txt size="sm" weight="700">1 · Say who you are</Txt>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Your name and licence number prefill every report, Form 72 and timesheet. Two minutes
          here saves retyping them on every job.
        </Txt>
      </Card>
      <View style={{ height: t.space(2) }} />
      <Card onPress={() => router.push('/import')}>
        <Txt size="sm" weight="700">2 · Import your register</Txt>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Sites, assets and their service history from a register export. The column-mapping step
          shows what it read before anything is written, and it reports rows it could not read
          rather than dropping them.
        </Txt>
      </Card>
      <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
        Everything else already works — the calculators, the standards library and the whole
        reference need no account, no key and no signal. This notice goes when the first site
        arrives.
      </Txt>
    </Card>
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

/**
 * The technician's own grid.
 *
 * This used to be a fixed twelve, which is somebody else's guess at what
 * matters and wrong for almost everyone: the detection tech wants the resistor
 * table, the extinguisher tech wants none of that, and both want their
 * timesheet. The list now comes from their own preferences, and the last tile
 * is always the way to change it — a grid you cannot obviously edit is a grid
 * nobody edits.
 *
 * Badges stay here rather than in the module catalogue, because a count is
 * live state and the catalogue is static data.
 */
function ActionGrid({ shortcuts, restock, pending, siteCount }: {
  shortcuts: AppModule[]; restock: number; pending: number; siteCount: number;
}) {
  const t = useTheme();
  const badges: Record<string, { badge?: number; tone?: 'fail' | 'warn' }> = {
    '/sites': { badge: siteCount },
    '/work/stock': { badge: restock, tone: restock ? 'warn' : undefined },
    '/work/outbound': { badge: pending, tone: pending ? 'warn' : undefined },
    '/impairment/new': { tone: 'fail' },
    '/work/defect/new': { tone: 'fail' },
  };

  const actions: Action[] = shortcuts.map((m) => ({
    label: m.label,
    icon: m.icon as Action['icon'],
    href: m.href,
    ...badges[m.href],
  }));

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2.5) }}>
      {actions.map((a) => (
        <ActionTile key={a.href} action={a} theme={t} />
      ))}
      <ActionTile
        action={{ label: 'Edit home', icon: 'view-grid-plus-outline', href: '/shortcuts' }}
        theme={t}
      />
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
      <View
        style={{
          width: 44, height: 44, borderRadius: t.radius.md,
          alignItems: 'center', justifyContent: 'center',
          // A tinted plate behind the glyph, so a grid of twelve reads as
          // twelve controls rather than twelve pictures on a flat card.
          backgroundColor: action.tone === 'fail' ? t.color.failBg
            : action.tone === 'warn' ? t.color.warnBg
            : t.color.surfaceAlt,
        }}
      >
        <MaterialCommunityIcons name={action.icon} size={24} color={tint} />
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
        // Three across, so the five of these wrap to 3 + 2 rather than 4 and a
        // lone one stretched across a whole row looking like a mistake.
        minWidth: '30%',
        backgroundColor: bg,
        borderRadius: t.radius.md,
        paddingVertical: t.space(2.5),
        paddingHorizontal: t.space(2),
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Txt weight="800" style={{ color: colour, fontFamily: t.font.mono, fontSize: t.font.size.xxl }}>{value}</Txt>
      <Txt size="xs" tone="muted" weight="700" numberOfLines={1} style={{ letterSpacing: 0.4 }}>{label}</Txt>
    </Pressable>
  );
}
