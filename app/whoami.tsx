import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import { listEmployees, type EmployeeRecord } from '@/db/employeeRepo';
import { prefsForEmployee, prefsForNobody, searchEmployees } from '@/simpro/identity';
import { useTheme } from '@/theme';
import { Button, Card, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Who you are.
 *
 * The office's staff list, synced from Simpro, so a phone can say whose it
 * is without a login. Picking yourself seeds the name on reports where it
 * was blank and tells My day whose schedule to show. It is the fallback for
 * a phone that has not signed in, and the fix for a login Simpro could not
 * match to anyone.
 */
export default function WhoAmIScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [people, setPeople] = useState<EmployeeRecord[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => {
    void loadPrefs().then(setPrefs);
    void listEmployees({ includeArchived: true }).then(setPeople);
  }, []));

  const shown = useMemo(() => searchEmployees(people, query), [people, query]);
  const current = people.find((p) => p.id === prefs?.simproEmployeeId);

  const choose = async (e: EmployeeRecord | null) => {
    const p = await loadPrefs();
    const next = { ...p, ...(e ? prefsForEmployee(p, e) : prefsForNobody()) };
    await savePrefs(next);
    setPrefs(next);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Who you are' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={shown}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), gap: t.space(2), paddingBottom: t.space(20) }}
          ListHeaderComponent={(
            <View style={{ gap: t.space(3), marginBottom: t.space(2) }}>
              {prefs?.simproEmployeeId ? (
                <Card>
                  <Rowed gap={3}>
                    <MaterialCommunityIcons name="account-check-outline" size={22} color={t.color.pass} />
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{current?.name ?? prefs.technicianName ?? `Employee ${prefs.simproEmployeeId}`}</Txt>
                      <Txt size="xs" tone="muted">
                        {current?.archived ? 'This employee is archived in Simpro. Pick again.' : 'This phone is yours.'}
                      </Txt>
                    </View>
                    <Button title="Clear" variant="ghost" compact onPress={() => { void choose(null); }} />
                  </Rowed>
                </Card>
              ) : (
                <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
                  Tap your name. It goes on reports where the name is blank, and My day shows the jobs
                  the office has scheduled to you.
                </Txt>
              )}
              <View
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: t.space(2.5),
                  backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
                  borderRadius: t.radius.pill, paddingHorizontal: t.space(4), minHeight: t.touch,
                }}
              >
                <MaterialCommunityIcons name="magnify" size={20} color={t.color.textFaint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Name or position"
                  placeholderTextColor={t.color.textFaint}
                  autoCapitalize="none"
                  style={{ flex: 1, color: t.color.text, fontSize: t.font.size.md }}
                />
              </View>
              <Button title="Sign in with Simpro instead" variant="ghost" compact onPress={() => router.push('/signin')} />
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { void choose(item); }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: t.space(3),
                padding: t.space(3.5), minHeight: t.touch, borderRadius: t.radius.lg,
                backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface,
                borderWidth: 1, borderColor: item.id === prefs?.simproEmployeeId ? t.color.accent : t.color.border,
              })}
            >
              <MaterialCommunityIcons name="account-outline" size={22} color={t.color.accentText} />
              <View style={{ flex: 1 }}>
                <Txt weight="700">{item.name}</Txt>
                <Txt size="xs" tone="muted">{[item.position, item.email].filter(Boolean).join(' · ') || `Employee ${item.id}`}</Txt>
              </View>
              {item.id === prefs?.simproEmployeeId ? <MaterialCommunityIcons name="check" size={22} color={t.color.pass} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            people.length === 0 ? (
              <EmptyState
                title="No staff list on this phone yet"
                body="It comes down from Simpro with the next sync. Once the office connection is set up in Settings, it arrives on its own."
              />
            ) : (
              <EmptyState title="Nobody matches" body="Try fewer letters." />
            )
          }
        />
      </Screen>
    </>
  );
}
