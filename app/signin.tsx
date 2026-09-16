import React, { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { signInInBrowser, signInWithPassword } from '@/simpro/auth';
import { SimproNetworkError } from '@/simpro/client';
import { hasSignInApplication, signInConfigFromPrefs, simproConfigFromPrefs } from '@/simpro/config';
import { classifySignInRefusal, isSettingRefusal, redirectUri, type SignInRefusal } from '@/simpro/oauth';
import {
  completeSignIn, markSignInSkipped, noteWayRefused, refusedWays,
  type RefusedWays, type SignInOutcome, type SignInWay,
} from '@/simpro/signInFlow';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Sign in with your Simpro login.
 *
 * The same username and password as Simpro Mobile. It is not how a new phone
 * starts any more: signing in as a person needs an API application in Simpro
 * whose Authentication Method allows it, this office's is Client Credentials
 * — the setting that lets a phone reach Simpro with nobody logged in — and an
 * application set that way refuses every login by design. A screen that
 * cannot succeed is not a front door, so the staff list is, and this is
 * reached from Settings and from a line on it.
 *
 * What a login still buys, where the office has made a second application for
 * it, is a token of the person's own: what they write is theirs in Simpro
 * rather than the office's. So the form is here, in full, whenever the build
 * has an application that can serve it.
 *
 * The rest of the screen is for whoever sets that up. The Redirect URI is
 * printed rather than described because it differs between the web app and
 * the installed one, and an office that registers the wrong one gets a
 * refusal that reads like a wrong password.
 */
export default function SignInScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [refused, setRefused] = useState<RefusedWays>({ password: false, browser: false });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<SignInWay | null>(null);
  const [refusal, setRefusal] = useState<{ kind: SignInRefusal | 'offline'; message: string } | null>(null);

  useFocusEffect(useCallback(() => {
    void loadPrefs().then(async (held) => {
      setPrefs(held);
      setRefused(await refusedWays(signInConfigFromPrefs(held)));
    });
  }, []));

  // This screen can be the one the app opened on, in which case there is
  // nothing behind it to go back to and router.back() does nothing at all —
  // which reads as a sign-in that did not take.
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const finish = (outcome: SignInOutcome) => {
    if (outcome.identity) {
      showAlert(
        'Signed in',
        `Simpro says you are ${outcome.identity.name}. This phone is yours now, and your jobs are on their way down.`,
        [{ text: 'OK', onPress: leave }],
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
    // The login goes through whichever application can do logins; the staff
    // list, the identity and the sync that follows are the office's own.
    const asPerson = signInConfigFromPrefs(prefs);
    try {
      const who = kind === 'browser'
        ? await signInInBrowser(asPerson)
        : await signInWithPassword(asPerson, username, password);
      setPassword('');
      // It worked, so whatever the build refused before, it does not now.
      await noteWayRefused(asPerson, kind, false);
      setRefused((held) => ({ ...held, [kind]: false }));
      finish(await completeSignIn(config, who));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const classified = e instanceof SimproNetworkError ? 'offline' : classifySignInRefusal(message);
      setRefusal({ kind: classified, message });
      // A grant that is off, or a redirect that is not registered, refuses
      // every attempt the same way. Remembered so the next visit says so
      // before the password is typed again — but the form stays, because the
      // office may have fixed it since and nothing else would ever find out.
      if ((classified === 'grant' || classified === 'redirect') && isSettingRefusal(message)) {
        await noteWayRefused(asPerson, kind);
        setRefused((held) => ({ ...held, [kind]: true }));
      }
    } finally {
      setBusy(null);
    }
  };

  const pickInstead = async () => {
    await markSignInSkipped();
    router.replace('/whoami');
  };

  const notNow = async () => {
    await markSignInSkipped();
    leave();
  };

  // No second application means the office's own, which cannot sign anybody
  // in whatever they type. Said once, here, rather than after a round trip
  // that was never going to work.
  const canLogIn = prefs ? hasSignInApplication(prefs) : true;
  const where = redirectUri();

  return (
    <>
      <Stack.Screen options={{ title: 'Sign in to Simpro' }} />
      <Screen>
        {refusal ? <Refused refusal={refusal} where={where} onPick={() => { void pickInstead(); }} /> : null}

        {canLogIn ? (
          <>
            <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
              The same login as Simpro Mobile. The phone already talks to the office; this tells it
              whose phone it is, so what you write is yours in Simpro.
            </Txt>
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
              <View style={{ height: t.space(2) }} />
              <Button
                title="Use Simpro’s login page"
                variant="secondary"
                onPress={() => { void run('browser'); }}
                loading={busy === 'browser'}
                disabled={busy !== null}
              />
              {refused.password || refused.browser ? (
                <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 16 }}>
                  Simpro refused a sign-in on this build last time, over a setting on the API
                  application rather than anything anybody typed. Worth another go once the office
                  has changed it.
                </Txt>
              ) : null}
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                The password goes to Simpro once and is not kept. What is kept is the token Simpro
                hands back, in this phone’s keystore.
              </Txt>
            </Card>
            <Button
              title="Pick myself from the staff list instead"
              variant="secondary"
              onPress={() => { void pickInstead(); }}
              disabled={busy !== null}
            />
            <Txt size="xs" tone="faint" style={{ lineHeight: 17, marginTop: -t.space(2) }}>
              Needs no login at all, and what you write still goes up under your name. It is how the
              app opens; this screen is here for anyone who would rather sign in properly.
            </Txt>
            <Button title="Not now" variant="ghost" onPress={() => { void notNow(); }} disabled={busy !== null} />
          </>
        ) : (
          <Card>
            <Txt weight="800">This build cannot sign a person in</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 4, marginBottom: t.space(2.5) }}>
              The Simpro application this phone connects with is a Client Credentials one, which is
              what lets it reach the office with nobody logged in, and it refuses logins by design.
              Nothing you type here will get through it. Pick yourself from the staff list instead —
              what you write still goes up under your name.
            </Txt>
            <Button
              title="Pick myself from the staff list"
              onPress={() => { void pickInstead(); }}
              icon={<MaterialCommunityIcons name="account-check-outline" size={20} color={t.color.onAccent} />}
            />
          </Card>
        )}

        <ForTheOffice where={where} canLogIn={canLogIn} />
      </Screen>
    </>
  );
}

/**
 * The settings in Simpro that decide whether any of this works, for whoever
 * has access to change them.
 *
 * It is at the bottom and it is small on purpose: it is the office's work,
 * not the technician's, and it used to be most of this screen.
 */
function ForTheOffice({ where, canLogIn }: { where: string; canLogIn: boolean }) {
  const t = useTheme();
  return (
    <Card>
      <Txt size="sm" weight="700">For the office</Txt>
      <Txt size="xs" tone="muted" style={{ lineHeight: 17, marginTop: 4, marginBottom: t.space(2.5) }}>
        {canLogIn
          ? 'Password sign-in needs the API application’s Authentication Method to allow it. Simpro’s own login page — which handles two-factor and single sign-on — needs an Authentication Method of Authorization Code and the Redirect URI below registered exactly as it reads.'
          : 'Logins need a second API application in Simpro, one whose Authentication Method allows them; the first stays as it is, because Client Credentials is what keeps the phone connected with nobody logged in. The second application’s ID and secret go in Settings under Simpro, and the Redirect URI below is registered on it exactly as it reads. From then on this screen works without anybody reinstalling.'}
      </Txt>
      <Txt size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: t.space(1.5) }}>
        Redirect URI for this app
      </Txt>
      <Rowed gap={2} align="flex-start">
        <Txt mono size="xs" style={{ flex: 1, lineHeight: 17 }}>{where}</Txt>
        <Chip label="Copy" onPress={() => { void Clipboard.setStringAsync(where); }} />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ lineHeight: 16, marginTop: t.space(1.5) }}>
        The web app and the installed app hand back to different addresses. Both can be registered on
        the same application, so signing in works either way.
      </Txt>
    </Card>
  );
}

/** Simpro’s refusal, as what to do about it. The server’s own words stay underneath for the office. */
function Refused({ refusal, where, onPick }: {
  refusal: { kind: SignInRefusal | 'offline'; message: string }; where: string; onPick: () => void;
}) {
  const words = (() => {
    switch (refusal.kind) {
      case 'password':
        return { title: 'That login was not accepted', body: 'Check the username and password — they are the ones you use for Simpro Mobile — and try again.', tone: 'fail' as const };
      case 'grant':
        return {
          title: 'This application does not allow password sign-in',
          body: 'Nothing is wrong with your login and trying again will not change it: the API application this phone connects with has an Authentication Method of Client Credentials. '
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
        return { title: 'Simpro could not be reached', body: 'No signal, or the office is unreachable right now. Nothing was sent. Try again with signal, or pick yourself from the staff list.', pick: true, tone: 'warn' as const };
      default:
        return { title: 'Simpro did not sign you in', body: 'The message underneath is Simpro’s own; the office will know what it means.', tone: 'fail' as const };
    }
  })();
  return (
    <View style={{ gap: 8 }}>
      <Banner tone={words.tone} title={words.title} body={words.body} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{refusal.message}</Txt>
      {words.pick ? <Button title="Pick myself from the staff list" variant="secondary" onPress={onPick} /> : null}
    </View>
  );
}
