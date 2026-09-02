import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listImpairments, impairmentElapsedMs, listJobs, type ImpairmentRecord } from '@/db/opsRepo';
import { defectsAwaitingNotice } from '@/db/repo';
import { listScheduleFor } from '@/db/scheduleRepo';
import { nowIso } from '@/db';
import type { Defect } from '@/domain/types';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import {
  MODULES, MODULE_GROUPS, moveShortcut, resolveShortcuts, toggleShortcut, type AppModule, type ModuleGroup,
} from '@/domain/modules';
import { groupScheduleByDay, scheduleWindow, whoseSchedule, type MyDayRow } from '@/domain/myDay';
import { useTheme, type Theme } from '@/theme';
import { Card, IconPlate, Rowed, Screen, SectionHeader, Txt } from '@/components/ui';
import { Bounce, Reveal, animateNextLayout } from '@/components/motion';
import { UpdateBanner } from '@/components/UpdateBanner';

/**
 * Home — the company hub.
 *
 * This screen used to be a dashboard: urgent jobs, open defects, overdue
 * routines, assets due, the next job. All of it true, none of it about the
 * person holding the phone. The app cannot tell a service technician from a
 * projects hand from an apprentice unless they have said who they are, so
 * the front page carries what is true for everybody: a question bar over
 * everything the app holds, a grid the technician builds and arranges, and
 * the rest of the app one tap down. Job management lives in the Work tab.
 *
 * Two exceptions, both because they are this person's: the jobs the office
 * has scheduled to them today, once the phone knows who they are; and the
 * legal clocks this phone started — an impairment declared here, and a
 * critical defect raised here whose notice has not gone out.
 */
export default function HomeScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [impairments, setImpairments] = useState<ImpairmentRecord[]>([]);
  const [notices, setNotices] = useState<Defect[]>([]);
  const [upNext, setUpNext] = useState<{ rows: MyDayRow[]; label: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [p, imp, nt] = await Promise.all([loadPrefs(), listImpairments(true), defectsAwaitingNotice()]);
    setPrefs(p);
    setImpairments(imp);
    setNotices(nt);
    // Today's scheduled blocks for this person, if the phone knows who that is.
    const who = whoseSchedule(p);
    if (!who) { setUpNext(null); return; }
    const now = nowIso();
    const window = scheduleWindow(now);
    const [rows, jobs] = await Promise.all([
      listScheduleFor({
        staffId: who.by === 'id' ? who.staffId : undefined,
        staffName: who.by === 'name' ? who.staffName : undefined,
        from: window.today, to: window.tomorrow,
      }),
      listJobs({ limit: 300 }),
    ]);
    const groups = groupScheduleByDay(rows, now, jobs.map((j) => ({
      id: j.id, externalId: j.externalId, siteName: j.siteName, title: j.title, address: j.address,
    })));
    setUpNext({ rows: groups.today.length ? groups.today : groups.tomorrow, label: groups.today.length ? 'Today' : 'Tomorrow' });
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shortcuts = useMemo(() => resolveShortcuts(prefs?.shortcuts ?? []), [prefs?.shortcuts]);

  const update = (next: string[]) => {
    if (!prefs) return;
    animateNextLayout();
    const merged = { ...prefs, shortcuts: next };
    setPrefs(merged);
    void savePrefs(merged);
  };

  return (
    <Screen>
      <Hero name={prefs?.technicianName ?? ''} />
      <AskBar />

      {impairments.map((imp) => <ImpairmentBanner key={imp.id} impairment={imp} />)}
      {notices.length ? <NoticeBanner notices={notices} /> : null}
      <UpdateBanner />

      {prefs && !prefs.technicianName.trim() ? <NamePrompt /> : null}
      {upNext && upNext.rows.length ? <UpNext label={upNext.label} rows={upNext.rows} /> : null}

      <SectionHeader
        title="Your modules"
        action={shortcuts.length ? (editing ? 'Done' : 'Arrange') : undefined}
        icon={editing ? 'check' : 'tune-variant'}
        onAction={() => { animateNextLayout(); setEditing((e) => !e); }}
      />
      {editing ? (
        <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: -t.space(1) }}>
          Arrows move a tile earlier or later. The cross takes it off; it stays in the list below.
        </Txt>
      ) : null}
      <ModuleGrid
        modules={shortcuts}
        editing={editing}
        onMove={(href, dir) => update(moveShortcut(prefs?.shortcuts ?? [], href, dir))}
        onRemove={(href) => update(toggleShortcut(prefs?.shortcuts ?? [], href))}
      />

      <SectionHeader title="Everything" />
      <GroupList />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

/**
 * The masthead.
 *
 * A dark ground with the flame on it, the greeting in the display face, and
 * the date. Warmer in the morning and cooler in the evening only in the
 * words; the colour stays the brand's, because a hub that changes colour
 * with the clock is a hub you cannot find at a glance.
 */
function Hero({ name }: { name: string }) {
  const t = useTheme();
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const first = name.trim().split(/\s+/)[0] ?? '';
  const date = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Reveal index={0} distance={8}>
      <LinearGradient
        colors={t.gradient.ground}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: t.radius.xl,
          padding: t.space(5),
          paddingBottom: t.space(6),
          borderWidth: 1,
          borderColor: t.color.border,
          overflow: 'hidden',
          ...t.shadow.card,
        }}
      >
        {/* The swoosh: a flame arc off the corner, the same mark as the icon. */}
        <LinearGradient
          colors={[t.color.accent, 'transparent'] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', right: -70, top: -70, width: 200, height: 200, borderRadius: 100, opacity: 0.35 }}
        />
        <Rowed gap={2}>
          <View style={{ width: 3, height: t.font.size.xs + 2, borderRadius: 2, backgroundColor: t.color.accent }} />
          <Txt size="xs" tone="accent" weight="800" style={{ letterSpacing: 2 }}>SAFE QLD</Txt>
        </Rowed>
        <Txt size="display" weight="800" style={{ letterSpacing: -1.4, marginTop: t.space(1) }} numberOfLines={1}>
          {first ? `${part}, ${first}` : part}
        </Txt>
        <Txt tone="muted" size="sm" weight="600">{date}</Txt>
      </LinearGradient>
    </Reveal>
  );
}

/**
 * The question bar.
 *
 * The one thing on this screen that is the same for everybody. It pulls up
 * over the masthead's bottom edge so the two read as one object, and it is
 * the biggest control on the page on purpose.
 */
const STARTERS = ['AS 1851 monthly', 'EOL values', 'Detector spacing', 'Defect wording', 'Hydrant flow', 'Battery sizing'];

function AskBar() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const go = (query: string) => {
    const text = query.trim();
    // Nothing typed opens the library to browse rather than doing nothing.
    if (text.length < 2) { router.push('/library'); return; }
    router.push(`/library?q=${encodeURIComponent(text)}` as never);
    setQ('');
  };
  return (
    <Reveal index={1} style={{ marginTop: -t.space(7), gap: t.space(2.5) }}>
      <View
        style={{
          backgroundColor: t.color.bgElevated,
          borderWidth: 2,
          borderColor: t.color.accent,
          borderRadius: t.radius.xl,
          padding: t.space(3),
          gap: t.space(2),
          ...t.shadow.glow,
        }}
      >
        <Rowed gap={3}>
          <IconPlate icon="magnify" size={46} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => go(q)}
            returnKeyType="search"
            placeholder="Ask anything"
            placeholderTextColor={t.color.textFaint}
            style={{ flex: 1, color: t.color.text, fontSize: t.font.size.lg, fontFamily: t.font.family('600'), paddingVertical: t.space(2) }}
          />
          <Bounce onPress={() => go(q)} haptic="light" scaleTo={0.9} accessibilityLabel="Search">
            <MaterialCommunityIcons name="arrow-right-circle" size={38} color={q.trim().length >= 2 ? t.color.accent : t.color.textFaint} />
          </Bounce>
        </Rowed>
        <Txt size="xs" tone="faint" style={{ paddingHorizontal: 2 }}>
          Clauses, defect wording, EOL values, calculators and your own documents. Works offline.
        </Txt>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
        {STARTERS.map((s) => (
          <Bounce key={s} onPress={() => go(s)} haptic="selection" scaleTo={0.94}>
            <View
              style={{
                paddingHorizontal: t.space(3.5), minHeight: 40, justifyContent: 'center',
                borderRadius: t.radius.pill, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
              }}
            >
              <Txt size="sm" weight="700">{s}</Txt>
            </View>
          </Bounce>
        ))}
      </ScrollView>
    </Reveal>
  );
}

/**
 * The office's schedule for this person, today, in a strip.
 *
 * The one job list that belongs on a front page, because it is theirs. Up to
 * three blocks; the rest is one tap away on My day.
 */
function UpNext({ label, rows }: { label: string; rows: MyDayRow[] }) {
  const t = useTheme();
  const shown = rows.slice(0, 3);
  return (
    <Reveal index={2}>
      <Card variant="raised" style={{ padding: t.space(3.5), gap: t.space(2) }}>
        <Rowed gap={2}>
          <IconPlate icon="calendar-account" size={36} />
          <Txt weight="800" style={{ flex: 1, letterSpacing: -0.2 }}>{label} for you</Txt>
          <Bounce onPress={() => router.push('/work/my-day')} haptic="selection">
            <Txt size="sm" tone="accent" weight="800">My day</Txt>
          </Bounce>
        </Rowed>
        {shown.map((r) => (
          <Bounce
            key={r.schedule.id}
            onPress={r.job ? () => router.push({ pathname: '/work/job/[id]', params: { id: r.job!.id } }) : undefined}
            haptic="light"
            scaleTo={0.98}
          >
            <Rowed gap={3} style={{ paddingVertical: t.space(1.5), borderTopWidth: 1, borderTopColor: t.color.border }}>
              <Txt weight="800" mono size="sm" style={{ minWidth: 88 }}>
                {r.schedule.startTime ? `${r.schedule.startTime}${r.schedule.endTime ? `–${r.schedule.endTime}` : ''}` : 'Any time'}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt weight="700" numberOfLines={1}>{r.job?.siteName ?? (r.schedule.jobId ? `Job ${r.schedule.jobId}` : r.schedule.type ?? 'Scheduled')}</Txt>
                {r.job?.title ? <Txt size="xs" tone="muted" numberOfLines={1}>{r.job.title}</Txt> : null}
              </View>
              {r.job ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
            </Rowed>
          </Bounce>
        ))}
        {rows.length > 3 ? <Txt size="xs" tone="faint">and {rows.length - 3} more on My day</Txt> : null}
      </Card>
    </Reveal>
  );
}

/**
 * Why there is a name prompt and no "import your register" prompt.
 *
 * The office data comes down on its own now. The one thing the phone still
 * needs from its owner is who they are, because a timesheet, a question to
 * the office or a leave request with no name on it cannot be filed.
 */
function NamePrompt() {
  const t = useTheme();
  return (
    <Reveal index={2}>
      <Card onPress={() => router.push('/settings')} variant="raised">
        <Rowed gap={3}>
          <IconPlate icon="account-edit-outline" size={44} muted />
          <View style={{ flex: 1 }}>
            <Txt weight="800">Put your name on this phone</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              Timesheets, questions and leave requests go out under it. One field, once.
            </Txt>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
        </Rowed>
      </Card>
    </Reveal>
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
          <Txt weight="800" tone="fail">SYSTEM IMPAIRED — DECLARED ON THIS PHONE</Txt>
        </Rowed>
        <Txt size="display" weight="700" mono tone="fail" style={{ letterSpacing: -1 }}>
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Txt>
        <Txt size="sm" tone="muted">{impairment.system}{impairment.scope ? ` — ${impairment.scope}` : ''}</Txt>
      </View>
    </Pressable>
  );
}

/**
 * A critical defect raised on this phone whose notice has not been issued.
 *
 * The occupier is owed written notice within 24 hours of the maintenance, and
 * the person who found the defect is the one who knows.
 */
function NoticeBanner({ notices }: { notices: Defect[] }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => router.push({ pathname: '/work/notice/[id]', params: { id: notices[0]!.id } })}>
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
          <MaterialCommunityIcons name="clock-alert-outline" size={20} color={t.color.fail} />
          <Txt weight="800" tone="fail" style={{ flex: 1 }}>
            {notices.length} CRITICAL DEFECT NOTICE{notices.length === 1 ? '' : 'S'} NOT YET ISSUED
          </Txt>
          <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.fail} />
        </Rowed>
        <Txt size="sm" tone="muted">
          Raised on this phone. The occupier has to be given written notice within 24 hours.
        </Txt>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The grid

/**
 * The technician's own grid, two across.
 *
 * Two rather than three because each tile says what it is for, and a blurb
 * at three across is a blurb nobody can read. Reordering is by arrows shown
 * in arrange mode rather than by dragging: drag-and-drop needs a long press
 * held steady inside a scroll view, which is exactly what a gloved hand on a
 * ladder cannot do. The tiles cascade in on arrival and slide when moved.
 */
function ModuleGrid({ modules, editing, onMove, onRemove }: {
  modules: AppModule[];
  editing: boolean;
  onMove: (href: string, direction: -1 | 1) => void;
  onRemove: (href: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(2.5) }}>
      {modules.map((m, i) => (
        <Reveal key={m.href} index={3 + i} style={{ width: '48%', flexGrow: 1 }}>
          <ModuleTile
            module={m}
            theme={t}
            editing={editing}
            first={i === 0}
            last={i === modules.length - 1}
            onMove={(d) => onMove(m.href, d)}
            onRemove={() => onRemove(m.href)}
          />
        </Reveal>
      ))}
      <Reveal index={3 + modules.length} style={{ width: modules.length === 0 ? '100%' : '48%', flexGrow: 1 }}>
        <AddTile theme={t} empty={modules.length === 0} />
      </Reveal>
    </View>
  );
}

function ModuleTile({ module: m, theme: t, editing, first, last, onMove, onRemove }: {
  module: AppModule; theme: Theme; editing: boolean; first: boolean; last: boolean;
  onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
  return (
    <Bounce onPress={editing ? undefined : () => router.push(m.href as never)} haptic="light" scaleTo={0.97} accessibilityLabel={m.label}>
      <View
        style={{
          minHeight: 142,
          backgroundColor: t.color.surface,
          borderRadius: t.radius.lg,
          borderWidth: 1,
          borderColor: editing ? t.color.accent : t.color.border,
          padding: t.space(3.5),
          gap: t.space(2),
          justifyContent: 'space-between',
          ...t.shadow.card,
        }}
      >
        <IconPlate icon={m.icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']} size={48} />
        <View style={{ gap: 3 }}>
          <Txt weight="800" style={{ letterSpacing: -0.2 }} numberOfLines={1}>{m.label}</Txt>
          <Txt size="xs" tone="muted" style={{ lineHeight: 16 }} numberOfLines={2}>{m.blurb}</Txt>
        </View>
        {editing ? (
          <View style={{ flexDirection: 'row', gap: t.space(1.5), marginTop: t.space(0.5) }}>
            <EditButton icon="chevron-left" disabled={first} onPress={() => onMove(-1)} theme={t} label={`Move ${m.label} earlier`} />
            <EditButton icon="chevron-right" disabled={last} onPress={() => onMove(1)} theme={t} label={`Move ${m.label} later`} />
            <View style={{ flex: 1 }} />
            <EditButton icon="close" tone="fail" onPress={onRemove} theme={t} label={`Remove ${m.label} from home`} />
          </View>
        ) : null}
      </View>
    </Bounce>
  );
}

function EditButton({ icon, onPress, disabled, tone, theme: t, label }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void; disabled?: boolean; tone?: 'fail'; theme: Theme; label: string;
}) {
  return (
    <Bounce onPress={onPress} disabled={disabled} haptic="selection" scaleTo={0.9} accessibilityLabel={label}>
      <View
        style={{
          width: 40, height: 40, borderRadius: t.radius.sm,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: tone === 'fail' ? t.color.failBg : t.color.surfaceAlt,
          opacity: disabled ? 0.3 : 1,
        }}
      >
        <MaterialCommunityIcons name={icon} size={22} color={tone === 'fail' ? t.color.fail : t.color.text} />
      </View>
    </Bounce>
  );
}

/**
 * The tile that is always there.
 *
 * A grid you cannot obviously add to is a grid nobody adds to. This one sits
 * at the end whatever the grid holds, and on an empty grid it is the whole
 * grid and says so.
 */
function AddTile({ theme: t, empty }: { theme: Theme; empty: boolean }) {
  return (
    <Bounce onPress={() => router.push('/shortcuts')} haptic="light" scaleTo={0.97}>
      <View
        style={{
          minHeight: empty ? 96 : 142,
          borderRadius: t.radius.lg,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: t.color.borderStrong,
          padding: t.space(3.5),
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space(1.5),
        }}
      >
        <IconPlate icon="plus" size={40} muted />
        <Txt weight="800" style={{ textAlign: 'center' }}>{empty ? 'Nothing here yet. Add your first module' : 'Add a module'}</Txt>
        <Txt size="xs" tone="muted" style={{ textAlign: 'center' }}>{MODULES.length} to choose from</Txt>
      </View>
    </Bounce>
  );
}

// ---------------------------------------------------------------------------
// Everything else

const GROUP_ICON: Record<ModuleGroup, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  'Every day': 'calendar-today',
  'Learn': 'school-outline',
  'Calculators': 'calculator-variant-outline',
  'On site': 'hard-hat',
  'Forms and records': 'file-document-multiple-outline',
  'Jobs and planning': 'clipboard-list-outline',
  'Admin': 'cog-outline',
};

const GROUP_BLURB: Record<ModuleGroup, string> = {
  'Every day': 'Timesheet, ask the office, leave, the map, suggestions.',
  'Learn': 'The standards, the law, defect wording, the routines.',
  'Calculators': 'Resistors, EOL, batteries, volt drop, flow, sound, doors.',
  'On site': 'Sites, assets, tags, routines, defects, stock, parts.',
  'Forms and records': 'Reports, Form 72, occupier statements, baselines, labels.',
  'Jobs and planning': 'Jobs, the run, what is due, promises, the month.',
  'Admin': 'Settings, sign in, who you are, importing files.',
};

/**
 * The rest of the app, by group.
 *
 * A row per group rather than every module, because there are fifty and the
 * point of the home screen is that it is not a list of fifty things. Each row
 * opens the picker on that group, where every module can be opened or pinned.
 */
function GroupList() {
  const t = useTheme();
  const counts = useMemo(() => {
    const c = new Map<ModuleGroup, number>();
    for (const m of MODULES) c.set(m.group, (c.get(m.group) ?? 0) + 1);
    return c;
  }, []);
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {MODULE_GROUPS.map((group, i) => (
        <Bounce
          key={group}
          onPress={() => router.push({ pathname: '/shortcuts', params: { group } })}
          haptic="selection"
          scaleTo={0.99}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space(3),
              paddingHorizontal: t.space(4),
              paddingVertical: t.space(3),
              minHeight: 64,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.color.border,
            }}
          >
            <IconPlate icon={GROUP_ICON[group]} size={40} muted />
            <View style={{ flex: 1, gap: 2 }}>
              <Rowed gap={2}>
                <Txt weight="800">{group}</Txt>
                <Txt size="xs" tone="faint" weight="800">{counts.get(group) ?? 0}</Txt>
              </Rowed>
              <Txt size="xs" tone="muted" numberOfLines={1}>{GROUP_BLURB[group]}</Txt>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
          </View>
        </Bounce>
      ))}
    </Card>
  );
}
