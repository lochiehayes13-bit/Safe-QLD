import React, { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { signInInBrowser, signInWithPassword } from '@/simpro/auth';
import { SimproNetworkError } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { REDIRECT_URI, classifySignInRefusal, type SignInRefusal } from '@/simpro/oauth';
import { completeSignIn, ensureEmployees, markSignInSkipped, type SignInOutcome } from '@/simpro/signInFlow';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Sign in with your Simpro login.
 *
 * The same username and password as Simpro Mobile, and the first thing a new
 * phone asks. The app is already connected to the office — it ships that way
 * — so the only thing it does not know is who is holding it, and this is
 * where it finds out. Once signed in, a note written from a job is this
 * person's in Simpro, My day shows their jobs, and the sync that brings those
 * jobs down starts the moment the sign-in lands.
 *
 * What Simpro says when it refuses is turned into what to do next rather
 * than shown as an OAuth error. A wrong password wants the field again. A
 * build that does not allow this way of signing in for the app wants the
 * staff list instead, which works without a login at all: the phone then
 * talks to Simpro as the office, with the person's name on what it writes.
 */
export default function SignInScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'browser' | 'skip' | null>(null);
  const [refusal, setRefusal] = useState<{ kind: SignInRefusal | 'offline'; message: string } | null>(null);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  const finish = (outcome: SignInOutcome) => {
    if (outcome.identity) {
      showAlert(
        'Signed in',
        `Simpro says you are ${outcome.identity.name}. This phone is yours now, and your jobs are on their way down.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
      return;
    }
    const said = outcome.who?.name ?? outcome.who?.email;
    showAlert(
      'Signed in',
      said
        ? `Simpro says you are ${said}, but that does not match anyone on the staff list. Pick yourself from it so My day knows whose day to show.`
        : 'Simpro did not say who you are. Pick yourself from the staff list so My day knows whose day to show.',
      [{ text: 'Pick who I am', onPress: () => router.replace('/whoami') }],
    );
  };

  const run = async (kind: 'password' | 'browser') => {
    if (!prefs) return;
    setBusy(kind);
    setRefusal(null);
    try {
      const config = simproConfigFromPrefs(prefs);
      const who = kind === 'browser'
        ? await signInInBrowser(config)
        : await signInWithPassword(config, username, password);
      setPassword('');
      finish(await completeSignIn(config, who));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRefusal({ kind: e instanceof SimproNetworkError ? 'offline' : classifySignInRefusal(message), message });
    } finally {
      setBusy(null);
    }
  };

  /** The way in that needs no login: the office's staff list, read now if the phone has not got it yet. */
  const pickInstead = async () => {
    if (!prefs) return;
    setBusy('skip');
    try {
      await ensureEmployees(simproConfigFromPrefs(prefs));
      await markSignInSkipped();
      router.replace('/whoami');
    } finally {
      setBusy(null);
    }
  };

  const notNow = async () => {
    await markSignInSkipped();
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Sign in to Simpro' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          The same login as Simpro Mobile. This phone is already connected to the office; signing in
          tells it whose phone it is, so My day shows your jobs and what you write is yours in Simpro.
        </Txt>

        {refusal ? <RefusalBanner refusal={refusal} onPickInstead={() => { void pickInstead(); }} /> : null}

        <Card>
          <Field label="Simpro username" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Your Simpro username" />
          <View style={{ height: t.space(2.5) }} />
          <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: t.space(1.5) }}>Password</Txt>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Your Simpro password"
            placeholderTextColor={t.color.textFaint}
            onSubmitEditing={() => { if (username.trim() && password) void run('password'); }}
            style={{
              color: t.color.text, fontSize: t.font.size.md, backgroundColor: t.color.surfaceAlt,
              borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border,
              paddingHorizontal: t.space(3), minHeight: t.touch,
            }}
          />
          <View style={{ height: t.space(3) }} />
          <Button
            title="Sign in"
            onPress={() => { void run('password'); }}
            loading={busy === 'password'}
            disabled={busy !== null || !username.trim() || !password}
            icon={<MaterialCommunityIcons name="login" size={20} color={t.color.onAccent} />}
          />
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            The password goes to Simpro once and is not kept. What is kept is the token Simpro hands
            back, in this phone's keystore.
          </Txt>
        </Card>

        <Button
          title="Not now"
          variant="ghost"
          onPress={() => { void notNow(); }}
          disabled={busy !== null}
        />
        <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: -t.space(2) }}>
          Everything still works. The phone talks to Simpro as the office until somebody signs in, and
          Settings has the sign-in whenever you want it.
        </Txt>

        <Card>
          <Txt size="sm" weight="700">Other ways in</Txt>
          <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: 4, marginBottom: t.space(2.5) }}>
            Simpro's own login page handles two-factor and single sign-on. It only works once the
            office has set the Redirect URI on the API application to exactly {REDIRECT_URI}.
          </Txt>
          <Button
            title="Use Simpro's login page"
            variant="secondary"
            onPress={() => { void run('browser'); }}
            loading={busy === 'browser'}
            disabled={busy !== null}
          />
          <View style={{ height: t.space(2) }} />
          <Button
            title="Pick myself from the staff list instead"
            variant="secondary"
            onPress={() => { void pickInstead(); }}
            loading={busy === 'skip'}
            disabled={busy !== null}
          />
        </Card>
      </Screen>
    </>
  );
}

/** Simpro's refusal, as what to do about it. The server's own words stay underneath for the office. */
function RefusalBanner({
  refusal, onPickInstead,
}: { refusal: { kind: SignInRefusal | 'offline'; message: string }; onPickInstead: () => void }) {
  const t = useTheme();
  const words = (() => {
    switch (refusal.kind) {
      case 'password':
        return { title: 'That login was not accepted', body: 'Check the username and password — they are the ones you use for Simpro Mobile — and try again.' };
      case 'grant':
        return {
          title: 'This build does not allow password sign-in for the app',
          body: 'Nothing is wrong with your login. The office can enable it on the API application in Simpro; until then, pick yourself from the staff list and everything works with your name on it.',
          pick: true,
        };
      case 'client':
        return { title: 'Simpro rejected the app itself', body: 'The office may have regenerated the client secret. A rotated secret can be pasted in Settings under Simpro.' };
      case 'redirect':
        return { title: 'The login page could not hand back to the app', body: `The Redirect URI on the API application in Simpro has to be exactly ${REDIRECT_URI}. Use the username and password above in the meantime.` };
      case 'offline':
        return { title: 'Simpro could not be reached', body: 'No signal, or the office is unreachable right now. Nothing was sent. Try again with signal, or pick yourself from the staff list if the phone already holds it.', pick: true };
      default:
        return { title: 'Simpro did not sign you in', body: 'The message underneath is Simpro\'s own; the office will know what it means.' };
    }
  })();
  return (
    <View style={{ gap: t.space(2) }}>
      <Banner tone="fail" title={words.title} body={words.body} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{refusal.message}</Txt>
      {words.pick ? <Button title="Pick myself from the staff list" variant="secondary" onPress={onPickInstead} /> : null}
    </View>
  );
}
