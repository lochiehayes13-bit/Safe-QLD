import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import type { EmployeeRecord } from '@/db/employeeRepo';
import { describeLoadFailure } from '@/domain/loadFailure';
import { hasSignInApplication, simproConfigFromPrefs } from '@/simpro/config';
import { prefsForEmployee, prefsForNobody, searchEmployees } from '@/simpro/identity';
import { loadStaffList, markSignInSkipped } from '@/simpro/signInFlow';
import { useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Who you are.
 *
 * The office's staff list, synced from Simpro, so a phone can say whose it
 * is without a login. Picking yourself seeds the name on reports where it
 * was blank and tells My day whose schedule to show. On a build whose Simpro
 * application cannot sign a person in — which is this office's — it is not
 * the fallback, it is the front door: the first-run gate opens this screen.
 *
 * Which is why it reads the list itself rather than showing whatever the last
 * sync happened to leave behind. A phone installed ten minutes ago has no
 * employee rows, and what this screen used to say to the person holding it
 * was that the list would come down with the next sync — true, six minutes
 * away, and no use at all to somebody standing in a plant room being asked
 * who they are. It is one request and a few dozen rows, so it is made here,
 * with the spinner and the failure that go with any request.
 */
export default function WhoAmIScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [people, setPeople] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setFailed(null);
    setLoading(true);
    try {
      const held = await loadPrefs();
      setPrefs(held);
      const list = await loadStaffList(simproConfigFromPrefs(held));
      setPeople(list.people);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'the staff list'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => searchEmployees(people, query), [people, query]);
  const current = people.find((p) => p.id === prefs?.simproEmployeeId);
  const canSignIn = prefs ? hasSignInApplication(prefs) : true;

  const choose = async (e: EmployeeRecord | null) => {
    const p = await loadPrefs();
    const next = { ...p, ...(e ? prefsForEmployee(p, e) : prefsForNobody()) };
    await savePrefs(next);
    setPrefs(next);
    // Clearing is done in order to pick again, so it stays on the list.
    // Picking is the end of the job: back to whatever opened this, or to the
    // home screen when the first-run gate opened it and there is nothing
    // behind it. Either way the next thing on screen is the app, not this.
    if (!e) return;
    await markSignInSkipped();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /**
   * Leave without picking.
   *
   * The first-run gate opens this screen over the home screen, and a question
   * that cannot be answered "not now" is one it asks again on every launch
   * until somebody gives in. The same flag the sign-in screen set is set
   * here, so the gate takes this for an answer. Everything still works: the
   * phone talks to Simpro as the office, the home screen says when it is
   * nobody's, and Settings has this screen whenever they want it.
   */
  const notNow = async () => {
    await markSignInSkipped();
    if (router.canGoBack()) router.back();
    else router.replace('/');
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
              {canSignIn ? (
                <Button title="Sign in with Simpro instead" variant="ghost" compact onPress={() => router.push('/signin')} />
              ) : (
                <Rowed gap={2}>
                  <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 16 }}>
                    Simpro logins are off on this build. Your name here does the same job.
                  </Txt>
                  <Chip label="Why" onPress={() => router.push('/signin')} />
                </Rowed>
              )}
              {prefs?.simproEmployeeId ? null : (
                <Button title="Not now" variant="ghost" compact onPress={() => { void notNow(); }} />
              )}
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
          ListEmptyComponent={<Nobody
            loading={loading}
            failed={failed}
            held={people.length}
            searching={Boolean(query.trim())}
            onRetry={() => { void load(); }}
          />}
        />
      </Screen>
    </>
  );
}

/**
 * The four things an empty list can mean, told apart.
 *
 * They used to be two, and the one that mattered was missing: a read that
 * failed looked exactly like an office with nobody on it, and both of them
 * read as "wait for the sync".
 */
function Nobody({ loading, failed, held, searching, onRetry }: {
  loading: boolean; failed: string | null; held: number; searching: boolean; onRetry: () => void;
}) {
  const t = useTheme();
  if (failed) {
    return (
      <EmptyState
        icon="cloud-off-outline"
        title="The staff list could not be read"
        body={failed}
        action={<Button title="Try again" onPress={onRetry} />}
      />
    );
  }
  if (loading && !held) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: t.space(12), gap: t.space(3) }}>
        <ActivityIndicator color={t.color.accent} size="large" />
        <Txt tone="muted">Getting the staff list from Simpro.</Txt>
      </View>
    );
  }
  if (!held) {
    return (
      <EmptyState
        icon="account-group-outline"
        title="Nobody on the staff list"
        body="Simpro answered, and there is no employee on the office’s list to pick. That is the office’s list in Simpro, not this phone."
        action={<Button title="Try again" variant="secondary" onPress={onRetry} />}
      />
    );
  }
  if (searching) return <EmptyState icon="account-search-outline" title="Nobody matches" body="Try fewer letters." />;
  // Not a search that found nothing: searchEmployees drops archived rows
  // before the query is applied, so a list of nothing but archived people
  // arrives here having been typed at by nobody.
  return (
    <EmptyState
      icon="account-off-outline"
      title="Everyone on the list is archived"
      body="Simpro answered with a staff list, and every person on it is archived. Somebody in the office has to un-archive whoever is still working here."
    />
  );
}
