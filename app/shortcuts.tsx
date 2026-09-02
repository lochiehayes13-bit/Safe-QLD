import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import {
  MODULE_GROUPS,
  moveShortcut,
  resolveShortcuts,
  searchModules,
  toggleShortcut,
  type AppModule,
} from '@/domain/modules';
import { useTheme } from '@/theme';
import { Card, H2, Label, Screen, Txt } from '@/components/ui';

/**
 * Choosing what sits on the home screen.
 *
 * There are seventy-nine screens in this app and no twelve of them are right
 * for everybody. A detection tech wants the resistor table and the dip switch
 * decoder; an extinguisher tech wants neither and wants the pressure test
 * dates. Both want their timesheet.
 *
 * Reordering is by arrows rather than by dragging. Drag-and-drop on a phone
 * needs a long press held steady, which is exactly what a gloved hand on a
 * ladder cannot do, and it fights the scroll view it lives in.
 */
export default function ShortcutsScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  const update = (shortcuts: string[]) => {
    if (!prefs) return;
    const next = { ...prefs, shortcuts };
    setPrefs(next);
    void savePrefs(next);
  };

  const chosen = useMemo(() => resolveShortcuts(prefs?.shortcuts ?? []), [prefs?.shortcuts]);
  const results = useMemo(() => searchModules(query), [query]);
  const pinned = new Set(prefs?.shortcuts ?? []);

  if (!prefs) {
    return (
      <>
        <Stack.Screen options={{ title: 'Home screen' }} />
        <Screen><Txt tone="muted">Reading your settings…</Txt></Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Home screen' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Pick what you actually use. What you choose here is what shows on the home screen, in this
          order. Nobody else's phone changes.
        </Txt>

        <H2>On your home screen</H2>
        {chosen.length === 0 ? (
          <Card><Txt tone="muted">Nothing pinned yet. Add something from below.</Txt></Card>
        ) : (
          <Card>
            {chosen.map((m, i) => (
              <View
                key={m.href}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.space(2.5),
                  paddingVertical: t.space(2),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.color.border,
                }}
              >
                <MaterialCommunityIcons name={m.icon as never} size={22} color={t.color.accentText} />
                <Txt style={{ flex: 1 }} numberOfLines={1}>{m.label}</Txt>
                <ArrowButton
                  icon="chevron-up"
                  disabled={i === 0}
                  onPress={() => update(moveShortcut(prefs.shortcuts, m.href, -1))}
                />
                <ArrowButton
                  icon="chevron-down"
                  disabled={i === chosen.length - 1}
                  onPress={() => update(moveShortcut(prefs.shortcuts, m.href, 1))}
                />
                <ArrowButton
                  icon="close"
                  tone="fail"
                  onPress={() => update(toggleShortcut(prefs.shortcuts, m.href))}
                />
              </View>
            ))}
          </Card>
        )}

        <H2>Everything else</H2>
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
            value={query}
            onChangeText={setQuery}
            placeholder="Search modules"
            placeholderTextColor={t.color.textFaint}
            style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md, paddingVertical: t.space(3) }}
          />
        </View>

        {MODULE_GROUPS.map((group) => {
          const inGroup = results.filter((m) => m.group === group);
          if (!inGroup.length) return null;
          return (
            <View key={group} style={{ gap: t.space(2) }}>
              <Label>{group}</Label>
              <Card>
                {inGroup.map((m, i) => (
                  <ModuleRow
                    key={m.href}
                    module={m}
                    first={i === 0}
                    pinned={pinned.has(m.href)}
                    onToggle={() => update(toggleShortcut(prefs.shortcuts, m.href))}
                  />
                ))}
              </Card>
            </View>
          );
        })}

        {results.length === 0 ? (
          <Card><Txt tone="muted">Nothing matches “{query}”.</Txt></Card>
        ) : null}
      </Screen>
    </>
  );
}

function ArrowButton({
  icon, onPress, disabled, tone,
}: { icon: string; onPress: () => void; disabled?: boolean; tone?: 'fail' }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      style={{
        width: 40, height: 40, borderRadius: t.radius.sm,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.color.surfaceAlt,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <MaterialCommunityIcons
        name={icon as never}
        size={20}
        color={tone === 'fail' ? t.color.fail : t.color.text}
      />
    </Pressable>
  );
}

/**
 * One module in the picker.
 *
 * The row opens the screen; the button on the right pins it. Both, rather than
 * pin-only, because this list is the only place in the app where every module
 * appears — making the home grid editable took five screens off the home screen
 * and this is where they went. A picker you can only pin from would mean
 * pinning something to look at it once.
 */
function ModuleRow({
  module: m, pinned, first, onToggle,
}: { module: AppModule; pinned: boolean; first: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.color.border,
        minHeight: 52,
      }}
    >
      <Pressable
        onPress={() => router.push(m.href as never)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.space(2.5), paddingVertical: t.space(2) }}
      >
        <MaterialCommunityIcons
          name={m.icon as never}
          size={22}
          color={pinned ? t.color.accentText : t.color.textMuted}
        />
        <Txt style={{ flex: 1 }} numberOfLines={1}>{m.label}</Txt>
      </Pressable>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={pinned ? `Remove ${m.label} from home` : `Add ${m.label} to home`}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <MaterialCommunityIcons
          name={pinned ? 'check-circle' : 'plus-circle-outline'}
          size={22}
          color={pinned ? t.color.pass : t.color.textFaint}
        />
      </Pressable>
    </View>
  );
}
