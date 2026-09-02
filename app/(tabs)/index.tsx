import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listImpairments, impairmentElapsedMs, type ImpairmentRecord } from '@/db/opsRepo';
import { defectsAwaitingNotice } from '@/db/repo';
import type { Defect } from '@/domain/types';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import {
  MODULES, MODULE_GROUPS, moveShortcut, resolveShortcuts, toggleShortcut, type AppModule, type ModuleGroup,
} from '@/domain/modules';
import { useTheme, type Theme } from '@/theme';
import { Button, Card, Rowed, Screen, Txt } from '@/components/ui';
import { UpdateBanner } from '@/components/UpdateBanner';

/**
 * Home — the company hub.
 *
 * This screen used to be a dashboard: urgent jobs, open defects, overdue
 * routines, assets due, the next job. All of it true, none of it about the
 * person holding the phone. The app cannot tell a service technician from a
 * projects hand from an apprentice, because it does not know who is logged in
 * on the office system — so a front page built around one person's job list
 * was the wrong front page for everyone else, and it looked like a job
 * management tool when the point of the thing is that it is where the crew
 * learns and works.
 *
 * What is here now is true for everybody: a question bar over everything the
 * app holds, a grid the technician builds and arranges themselves, and the
 * rest of the app one tap down. Job management lives in the Work tab for
 * whoever wants it, and anyone who wants their jobs on the front page pins
 * them.
 *
 * The exceptions are the two things with a legal clock that this phone
 * started: an impairment declared here, and a critical defect raised here
 * whose written notice to the occupier has not gone out. Both stay in front
 * of the person until they are closed, whoever they are.
 */
export default function HomeScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [impairments, setImpairments] = useState<ImpairmentRecord[]>([]);
  const [notices, setNotices] = useState<Defect[]>([]);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [p, imp, nt] = await Promise.all([loadPrefs(), listImpairments(true), defectsAwaitingNotice()]);
    setPrefs(p);
    setImpairments(imp);
    setNotices(nt);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shortcuts = useMemo(() => resolveShortcuts(prefs?.shortcuts ?? []), [prefs?.shortcuts]);

  const update = (next: string[]) => {
    if (!prefs) return;
    const merged = { ...prefs, shortcuts: next };
    setPrefs(merged);
    void savePrefs(merged);
  };

  return (
    <Screen>
      <Masthead name={prefs?.technicianName ?? ''} />
      <AskBar />

      {impairments.map((imp) => <ImpairmentBanner key={imp.id} impairment={imp} />)}
      {notices.length ? <NoticeBanner notices={notices} /> : null}
      <UpdateBanner />

      {prefs && !prefs.technicianName.trim() ? <NamePrompt /> : null}

      <SectionHeader
        title="Your modules"
        action={shortcuts.length ? (editing ? 'Done' : 'Arrange') : undefined}
        onAction={() => setEditing((e) => !e)}
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

function Masthead({ name }: { name: string }) {
  const t = useTheme();
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const first = name.trim().split(/\s+/)[0] ?? '';
  return (
    <View style={{ gap: 2 }}>
      <Rowed gap={2}>
        <View style={{ width: 3, height: t.font.size.xs + 2, borderRadius: 2, backgroundColor: t.color.accent }} />
        <Txt size="xs" tone="accent" weight="800" style={{ letterSpacing: 2 }}>SAFE QLD</Txt>
      </Rowed>
      <Txt size="display" weight="800" style={{ letterSpacing: -1.2 }} numberOfLines={1}>
        {first ? `${part}, ${first}` : part}
      </Txt>
      <Txt tone="muted" size="sm">
        {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Txt>
    </View>
  );
}

/**
 * The question bar.
 *
 * The one thing on this screen that is the same for everybody. A technician
 * with a question is holding something in the other hand and standing under
 * the thing they are asking about, so the whole library — the clause index,
 * their own imported documents, the defect wording, the EOL tables, the
 * calculators — opens from one line on the screen they are already on. It is
 * the biggest thing here on purpose.
 */
const STARTERS = [
  'AS 1851 monthly',
  'EOL values',
  'Detector spacing',
  'Defect wording',
  'Hydrant flow',
  'Battery sizing',
];

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
    <View style={{ gap: t.space(2.5) }}>
      <View
        style={{
          backgroundColor: t.color.surface,
          borderWidth: 2,
          borderColor: t.color.accent,
          borderRadius: t.radius.xl,
          padding: t.space(3),
          gap: t.space(2),
          shadowColor: t.color.accent,
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Rowed gap={3}>
          <View
            style={{
              width: 48, height: 48, borderRadius: t.radius.md,
              backgroundColor: t.color.accentBg, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="magnify" size={26} color={t.color.accentText} />
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => go(q)}
            returnKeyType="search"
            placeholder="Ask anything"
            placeholderTextColor={t.color.textFaint}
            style={{ flex: 1, color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600', paddingVertical: t.space(2) }}
          />
          <Pressable onPress={() => go(q)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Search">
            <MaterialCommunityIcons name="arrow-right-circle" size={36} color={q.trim().length >= 2 ? t.color.accent : t.color.textFaint} />
          </Pressable>
        </Rowed>
        <Txt size="xs" tone="faint" style={{ paddingHorizontal: 2 }}>
          Clauses, defect wording, EOL values, calculators and your own documents. Works offline.
        </Txt>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
        {STARTERS.map((s) => (
          <Pressable
            key={s}
            onPress={() => go(s)}
            style={({ pressed }) => ({
              paddingHorizontal: t.space(3.5),
              minHeight: 40,
              justifyContent: 'center',
              borderRadius: t.radius.pill,
              backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface,
              borderWidth: 1,
              borderColor: t.color.border,
            })}
          >
            <Txt size="sm" weight="600">{s}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2.5), marginTop: t.space(3) }}>
      <View style={{ width: 4, height: t.font.size.lg, borderRadius: 2, backgroundColor: t.color.accent }} />
      <Txt size="lg" weight="800" style={{ letterSpacing: -0.2, flex: 1 }}>{title}</Txt>
      {action && onAction ? (
        <Button title={action} variant="ghost" compact onPress={onAction} icon={<MaterialCommunityIcons name={action === 'Done' ? 'check' : 'tune-variant'} size={18} color={t.color.accentText} />} />
      ) : null}
    </View>
  );
}

/**
 * Why there is a name prompt and no "import your register" prompt.
 *
 * The old first-run card told a fresh phone to import an asset register. That
 * is the office's job and it now happens on its own over the air. The one
 * thing the phone still needs from its owner is a name, because a timesheet,
 * a question to the office or a leave request with no name on it cannot be
 * filed against anyone.
 */
function NamePrompt() {
  const t = useTheme();
  return (
    <Card onPress={() => router.push('/settings')}>
      <Rowed gap={3}>
        <View style={{ width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: t.color.accentBg, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="account-edit-outline" size={22} color={t.color.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="700">Put your name on this phone</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Timesheets, questions and leave requests go out under it. One field, once.
          </Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
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
          <Txt weight="700" tone="fail">SYSTEM IMPAIRED — DECLARED ON THIS PHONE</Txt>
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
 * the person who found the defect is the one who knows. Shown in the same
 * register as the impairment clock because it is the same kind of thing.
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
          <Txt weight="700" tone="fail" style={{ flex: 1 }}>
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
 * Two rather than three because each tile now says what it is for, and a
 * blurb at three across is a blurb nobody can read. Reordering is by arrows
 * shown in arrange mode rather than by dragging: drag-and-drop needs a long
 * press held steady inside a scroll view, which is exactly what a gloved hand
 * on a ladder cannot do.
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
        <ModuleTile
          key={m.href}
          module={m}
          theme={t}
          editing={editing}
          first={i === 0}
          last={i === modules.length - 1}
          onMove={(d) => onMove(m.href, d)}
          onRemove={() => onRemove(m.href)}
        />
      ))}
      <AddTile theme={t} empty={modules.length === 0} />
    </View>
  );
}

function ModuleTile({ module: m, theme: t, editing, first, last, onMove, onRemove }: {
  module: AppModule; theme: Theme; editing: boolean; first: boolean; last: boolean;
  onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
  return (
    <Pressable
      onPress={editing ? undefined : () => router.push(m.href as never)}
      accessibilityRole="button"
      accessibilityLabel={m.label}
      style={({ pressed }) => ({
        width: '48%',
        flexGrow: 1,
        minHeight: 138,
        backgroundColor: pressed && !editing ? t.color.surfaceAlt : t.color.surface,
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: editing ? t.color.accent : t.color.border,
        padding: t.space(3.5),
        gap: t.space(2),
        justifyContent: 'space-between',
      })}
    >
      <View
        style={{
          width: 48, height: 48, borderRadius: t.radius.md,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.color.accentBg,
        }}
      >
        <MaterialCommunityIcons name={m.icon as never} size={26} color={t.color.accentText} />
      </View>
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
    </Pressable>
  );
}

function EditButton({ icon, onPress, disabled, tone, theme: t, label }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void; disabled?: boolean; tone?: 'fail'; theme: Theme; label: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 40, height: 40, borderRadius: t.radius.sm,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: tone === 'fail' ? t.color.failBg : t.color.surfaceAlt,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <MaterialCommunityIcons name={icon} size={22} color={tone === 'fail' ? t.color.fail : t.color.text} />
    </Pressable>
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
    <Pressable
      onPress={() => router.push('/shortcuts')}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width: empty ? '100%' : '48%',
        flexGrow: 1,
        minHeight: empty ? 96 : 138,
        borderRadius: t.radius.lg,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: pressed ? t.color.accent : t.color.borderStrong,
        padding: t.space(3.5),
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space(1.5),
      })}
    >
      <MaterialCommunityIcons name="plus-circle-outline" size={30} color={t.color.accentText} />
      <Txt weight="700" style={{ textAlign: 'center' }}>{empty ? 'Nothing here yet. Add your first module' : 'Add a module'}</Txt>
      <Txt size="xs" tone="muted" style={{ textAlign: 'center' }}>
        {MODULES.length} to choose from
      </Txt>
    </Pressable>
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
  'Admin': 'Settings and importing files.',
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
        <Pressable
          key={group}
          onPress={() => router.push({ pathname: '/shortcuts', params: { group } })}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space(3),
            paddingHorizontal: t.space(4),
            paddingVertical: t.space(3),
            minHeight: 64,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: t.color.border,
            backgroundColor: pressed ? t.color.surfaceAlt : 'transparent',
          })}
        >
          <View style={{ width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name={GROUP_ICON[group]} size={22} color={t.color.accentText} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Rowed gap={2}>
              <Txt weight="700">{group}</Txt>
              <Txt size="xs" tone="faint" weight="700">{counts.get(group) ?? 0}</Txt>
            </Rowed>
            <Txt size="xs" tone="muted" numberOfLines={1}>{GROUP_BLURB[group]}</Txt>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
        </Pressable>
      ))}
    </Card>
  );
}
