import React, { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { signInInBrowser, signInWithPassword } from '@/simpro/auth';
import { SimproNetworkError } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { classifySignInRefusal, isSettingRefusal, redirectUri, type SignInRefusal } from '@/simpro/oauth';
import {
  completeSignIn, ensureEmployees, markSignInSkipped, noteWayRefused, refusedWays,
  type RefusedWays, type SignInOutcome, type SignInWay,
} from '@/simpro/signInFlow';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';
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
 * Both ways of signing in as yourself depend on a setting on the office's API
 * application in Simpro: the password grant has to be allowed, and the
 * browser's redirect has to be registered. Where one of them is not, Simpro
 * refuses every attempt at it, and no amount of retyping a password changes
 * that. So a refusal is remembered for this build, and the screen stops
 * leading with a wall: the staff list comes first, which needs no login at
 * all, and the refused way moves down to "Other ways in" with what the
 * office would have to change to make it work. Nothing here is red — a
 * setting the technician cannot see is not their mistake.
 */
export default function SignInScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [refused, setRefused] = useState<RefusedWays>({ password: false, browser: false });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'browser' | 'skip' | null>(null);
  const [refusal, setRefusal] = useState<{ kind: SignInRefusal | 'offline'; message: string } | null>(null);
  /** Set by "Try it anyway", so a way the office has since enabled can be used without a reinstall. */
  const [insist, setInsist] = useState<SignInWay | null>(null);

  useFocusEffect(useCallback(() => {
    void loadPrefs().then(async (held) => {
      setPrefs(held);
      setRefused(await refusedWays(simproConfigFromPrefs(held)));
    });
  }, []));

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

  const run = async (kind: SignInWay) => {
    if (!prefs) return;
    setBusy(kind);
    setRefusal(null);
    const config = simproConfigFromPrefs(prefs);
    try {
      const who = kind === 'browser'
        ? await signInInBrowser(config)
        : await signInWithPassword(config, username, password);
      setPassword('');
      // It worked, so whatever the build refused before, it does not now.
      await noteWayRefused(config, kind, false);
      setRefused((held) => ({ ...held, [kind]: false }));
      finish(await completeSignIn(config, who));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const classified = e instanceof SimproNetworkError ? 'offline' : classifySignInRefusal(message);
      setRefusal({ kind: classified, message });
      // A grant that is off, or a redirect that is not registered, refuses
      // every attempt the same way. Remembered so the next visit to this
      // screen does not start with it.
      if ((classified === 'grant' || classified === 'redirect') && isSettingRefusal(message)) {
        await noteWayRefused(config, kind);
        setRefused((held) => ({ ...held, [kind]: true }));
        setInsist(null);
      }
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

  const passwordOff = refused.password && insist !== 'password';
  const browserOff = refused.browser && insist !== 'browser';
  const where = redirectUri();

  return (
    <>
      <Stack.Screen options={{ title: 'Sign in to Simpro' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          The same login as Simpro Mobile. This phone is already connected to the office; signing in
          tells it whose phone it is, so My day shows your jobs and what you write is yours in Simpro.
        </Txt>

        {refusal ? <RefusalBanner refusal={refusal} where={where} onPickInstead={() => { void pickInstead(); }} /> : null}

        {passwordOff ? (
          <StaffListCard
            busy={busy === 'skip'}
            disabled={busy !== null}
            onPick={() => { void pickInstead(); }}
            why={'This office\'s Simpro application does not allow password sign-in, so the staff list is the way in. '
              + 'What you write still goes up under your name.'}
          />
        ) : (
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
        )}

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

          {passwordOff ? (
            <>
              <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: 4, marginBottom: t.space(2) }}>
                Password sign-in needs the Password Credentials grant switched on for this app's API
                application in Simpro. Once the office has done it, this works without reinstalling.
              </Txt>
              <Button
                title="Try a password sign-in anyway"
                variant="secondary"
                onPress={() => { setInsist('password'); setRefusal(null); }}
                disabled={busy !== null}
              />
              <View style={{ height: t.space(2) }} />
            </>
          ) : null}

          <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: 4, marginBottom: t.space(2) }}>
            Simpro's own login page handles two-factor and single sign-on. It needs the Redirect URI
            below registered on the API application, exactly as it reads.
          </Txt>
          <RedirectRow where={where} />
          <View style={{ height: t.space(2.5) }} />
          <Button
            title={browserOff ? 'Try Simpro\'s login page again' : 'Use Simpro\'s login page'}
            variant="secondary"
            onPress={() => { setInsist('browser'); void run('browser'); }}
            loading={busy === 'browser'}
            disabled={busy !== null}
          />
          {browserOff ? (
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
              Simpro refused this last time because that address is not registered. Worth another go
              once the office has added it.
            </Txt>
          ) : null}

          {passwordOff ? null : (
            <>
              <View style={{ height: t.space(2) }} />
              <Button
                title="Pick myself from the staff list instead"
                variant="secondary"
                onPress={() => { void pickInstead(); }}
                loading={busy === 'skip'}
                disabled={busy !== null}
              />
            </>
          )}
        </Card>
      </Screen>
    </>
  );
}

/**
 * The address Simpro has to be told to hand back to, with a tap to copy it.
 *
 * Shown rather than described because it is different on the web app and the
 * installed one — a phone's is the app's own scheme, a browser's is the page
 * it is running on — and an office typing the wrong one gets exactly the
 * refusal this screen is trying to explain.
 */
function RedirectRow({ where }: { where: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space(1.5) }}>
      <Txt size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
        Redirect URI for this app
      </Txt>
      <Rowed gap={2} align="flex-start">
        <Txt mono size="xs" style={{ flex: 1, lineHeight: 17 }}>{where}</Txt>
        <Chip label="Copy" onPress={() => { void Clipboard.setStringAsync(where); }} />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
        The web app and the installed app hand back to different addresses. Both can be registered on
        the same API application, so signing in works either way.
      </Txt>
    </View>
  );
}

/** The staff list offered as the way in rather than as a consolation. */
function StaffListCard({ busy, disabled, onPick, why }: {
  busy: boolean; disabled: boolean; onPick: () => void; why: string;
}) {
  const t = useTheme();
  return (
    <Card>
      <Txt weight="800">Say who you are</Txt>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 4, marginBottom: t.space(2.5) }}>{why}</Txt>
      <Button
        title="Pick myself from the staff list"
        onPress={onPick}
        loading={busy}
        disabled={disabled}
        icon={<MaterialCommunityIcons name="account-check-outline" size={20} color={t.color.onAccent} />}
      />
    </Card>
  );
}

/** Simpro's refusal, as what to do about it. The server's own words stay underneath for the office. */
function RefusalBanner({
  refusal, where, onPickInstead,
}: { refusal: { kind: SignInRefusal | 'offline'; message: string }; where: string; onPickInstead: () => void }) {
  const t = useTheme();
  const words = (() => {
    switch (refusal.kind) {
      case 'password':
        return { title: 'That login was not accepted', body: 'Check the username and password — they are the ones you use for Simpro Mobile — and try again.', tone: 'fail' as const };
      case 'grant':
        return {
          title: 'This office\'s Simpro app does not allow password sign-in',
          body: 'Nothing is wrong with your login, and trying again will not change it: the Password Credentials grant is switched off on the API application in Simpro. '
            + 'Pick yourself from the staff list and everything works with your name on it.',
          pick: true,
          tone: 'warn' as const,
        };
      case 'client':
        return { title: 'Simpro rejected the app itself', body: 'The office may have regenerated the client secret. A rotated secret can be pasted in Settings under Simpro.', tone: 'fail' as const };
      case 'redirect':
        return {
          title: 'Simpro has no address to hand this app back to',
          body: `The Redirect URI on the API application has to include exactly ${where}. Until the office adds it, the login page cannot come back here — `
            + 'pick yourself from the staff list instead, which needs no login at all.',
          pick: true,
          tone: 'warn' as const,
        };
      case 'offline':
        return { title: 'Simpro could not be reached', body: 'No signal, or the office is unreachable right now. Nothing was sent. Try again with signal, or pick yourself from the staff list if the phone already holds it.', pick: true, tone: 'warn' as const };
      default:
        return { title: 'Simpro did not sign you in', body: 'The message underneath is Simpro\'s own; the office will know what it means.', tone: 'fail' as const };
    }
  })();
  return (
    <View style={{ gap: t.space(2) }}>
      <Banner tone={words.tone} title={words.title} body={words.body} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{refusal.message}</Txt>
      {words.pick ? <Button title="Pick myself from the staff list" variant="secondary" onPress={onPickInstead} /> : null}
    </View>
  );
}
