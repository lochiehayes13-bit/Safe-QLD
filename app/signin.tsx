import React, { useCallback, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import { listEmployees } from '@/db/employeeRepo';
import { signInInBrowser, signInWithPassword } from '@/simpro/auth';
import { simproConfigFromPrefs } from '@/simpro/config';
import { prefsFromIdentity, resolveIdentity, type CurrentUser } from '@/simpro/identity';
import { REDIRECT_URI } from '@/simpro/oauth';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, Screen, Txt } from '@/components/ui';

/**
 * Sign in with your Simpro login.
 *
 * The same username and password as Simpro Mobile. Once signed in, the app
 * talks to Simpro as this person rather than as the office's shared key, so a
 * note written from a job is theirs in the office system, and the app knows
 * whose phone it is without anyone typing a name.
 *
 * The browser button is the one to press: it opens Simpro's own login page,
 * which is where two-factor and single sign-on live. The fields underneath
 * are for a build that has not enabled that, and the server's exact words are
 * shown when either is refused, because the words are what the office needs
 * to fix it.
 */
export default function SignInScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'browser' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  /**
   * Turns Simpro's answer to "who is this" into a chosen employee.
   *
   * A login that matches nobody on the synced staff list is still a login:
   * the person is signed in, and the picker is the way to say who they are.
   */
  const finish = async (who: CurrentUser | null) => {
    const employees = await listEmployees({ includeArchived: true });
    const identity = resolveIdentity({ currentUser: who, employees });
    const current = await loadPrefs();
    if (identity) {
      await savePrefs({ ...current, ...prefsFromIdentity(current, identity) });
      Alert.alert('Signed in', `Simpro says you are ${identity.name}. This phone is yours now.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }
    Alert.alert(
      'Signed in',
      who
        ? `Simpro says you are ${who.name ?? who.email ?? 'signed in'}, but that does not match anyone on the staff list this phone holds. Pick yourself from it.`
        : 'This build did not say who you are. Pick yourself from the staff list.',
      [{ text: 'Pick who I am', onPress: () => router.replace('/whoami') }],
    );
  };

  const run = async (kind: 'browser' | 'password') => {
    if (!prefs) return;
    setBusy(kind);
    setError(null);
    try {
      const config = simproConfigFromPrefs(prefs);
      const who = kind === 'browser'
        ? await signInInBrowser(config)
        : await signInWithPassword(config, username, password);
      setPassword('');
      await finish(who);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Sign in to Simpro' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          The same login as Simpro Mobile. Once you are signed in, notes you write from this app are
          yours in Simpro, and My day shows the jobs scheduled to you.
        </Txt>

        {error ? <Banner tone="fail" title="Simpro did not sign you in" body={error} /> : null}

        <Button
          title="Sign in with Simpro"
          onPress={() => { void run('browser'); }}
          loading={busy === 'browser'}
          disabled={busy === 'password'}
          icon={<MaterialCommunityIcons name="login" size={20} color={t.color.onAccent} />}
        />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Opens Simpro's own login page in your browser, which is where two-factor prompts work. The
          page hands the app a one-time code and closes.
        </Txt>

        <Card>
          <Txt weight="700" style={{ marginBottom: t.space(2.5) }}>Or with your username and password</Txt>
          <Field label="Simpro username" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="you@safeqld.com.au" keyboardType="email-address" />
          <View style={{ height: t.space(2.5) }} />
          <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: t.space(1.5) }}>Password</Txt>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Your Simpro password"
            placeholderTextColor={t.color.textFaint}
            style={{
              color: t.color.text, fontSize: t.font.size.md, backgroundColor: t.color.surfaceAlt,
              borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border,
              paddingHorizontal: t.space(3), minHeight: t.touch,
            }}
          />
          <View style={{ height: t.space(3) }} />
          <Button
            title="Sign in"
            variant="secondary"
            onPress={() => { void run('password'); }}
            loading={busy === 'password'}
            disabled={busy === 'browser' || !username.trim() || !password}
          />
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            The password goes to Simpro once and is not kept. What is kept is the token Simpro hands
            back, in this phone's keystore.
          </Txt>
        </Card>

        <Card>
          <Txt size="sm" weight="700">For the office</Txt>
          <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: 4 }}>
            The browser sign-in needs the Redirect URI on the API application in Simpro's setup to be
            exactly {REDIRECT_URI}. If a sign-in is refused, the message above carries Simpro's own words.
          </Txt>
        </Card>
      </Screen>
    </>
  );
}
