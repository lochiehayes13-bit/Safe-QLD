import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import {
  SUGGESTION_KINDS, suggestionBody, suggestionNotReady, suggestionSubject,
  type Suggestion, type SuggestionKind,
} from '@/domain/suggestions';
import { sendMail } from '@/export/mail';
import { useTheme } from '@/theme';
import { Button, Card, Field, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { describeActionFailure } from '@/domain/loadFailure';

/**
 * Suggest a change.
 *
 * The app cannot rewrite itself on the phone in front of you, and it should
 * not: a change nobody has read is how a fire app ends up wrong. What it can
 * do is make the distance between "this is stupid" and "somebody knows this
 * is stupid" one screen. Every suggestion goes out as an email with a fixed
 * subject tag, which is a shape a person can filter on and a script can act
 * on. A new build with the change in it lands at the same download link.
 */
export default function SuggestScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ screen?: string }>();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [kind, setKind] = useState<SuggestionKind>('idea');
  const [screen, setScreen] = useState(params.screen ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  const suggestion = (): Suggestion => ({
    technicianName: prefs?.technicianName ?? '',
    kind,
    screen,
    text,
    appVersion: Constants.expoConfig?.version ?? '',
  });

  const send = async () => {
    if (!prefs) return;
    const s = suggestion();
    const blocked = suggestionNotReady(s);
    if (blocked) {
      showAlert('Not ready to send', blocked);
      return;
    }
    if (!prefs.suggestionsEmail.trim()) {
      showAlert('No address set', 'Add the suggestions address in Settings.');
      return;
    }
    setBusy(true);
    try {
      const outcome = await sendMail({
        to: prefs.suggestionsEmail.trim(),
        subject: suggestionSubject(s),
        body: suggestionBody(s),
      });

      if (outcome === 'no-mail-app') {
        showAlert('No mail app set up', 'Add an email account to this phone, then try again.');
      } else if (outcome === 'sent') {
        showAlert('Sent', `Thanks. It's gone to ${prefs.suggestionsEmail.trim()}.`, [{ text: 'OK', onPress: () => router.back() }]);
      } else if (outcome === 'handed-over') {
        // A browser hands the draft to a mail client and never hears back, so
        // this says what actually happened rather than thanking somebody for
        // an email still sitting unsent in another window.
        showAlert('Draft opened', `Your email to ${prefs.suggestionsEmail.trim()} is ready. Tap Send in your mail app.`, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        showAlert('Not sent', "The email wasn't sent. Try again.");
      }
    } catch (e) {
      showAlert("Couldn't send", describeActionFailure(e, 'sending the suggestion'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Suggest a change' }} />
      <Screen>
        <View
          style={{
            backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.lg, padding: t.space(4),
            borderLeftWidth: 3, borderLeftColor: t.color.accent, gap: t.space(1),
          }}
        >
          <Txt weight="800" size="lg" style={{ letterSpacing: -0.3 }}>What should change?</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            An idea, something wrong, a missing value or a form we need.
          </Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            {prefs?.suggestionsEmail.trim() ? `Goes to ${prefs.suggestionsEmail.trim()}.` : 'Add the suggestions address in Settings first.'}
          </Txt>
        </View>

        {prefs && !prefs.technicianName.trim() ? (
          <Card onPress={() => router.push('/settings')}>
            <Txt weight="700">Set your name first</Txt>
            <Txt size="sm" tone="muted">Tap to add it in Settings.</Txt>
          </Card>
        ) : null}

        <Card>
          <Segmented options={SUGGESTION_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
        </Card>

        <Card>
          <Field label="Where in the app" value={screen} onChangeText={setScreen} placeholder="Timesheet, resistor values, the home screen…" autoCapitalize="sentences" />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label={kind === 'problem' ? 'What went wrong?' : kind === 'information' ? "What's missing?" : 'Your idea'}
            value={text}
            onChangeText={setText}
            multiline
            placeholder={kind === 'problem'
              ? 'I tapped Send and it said sent, but accounts never got it.'
              : kind === 'information'
                ? 'The EOL table needs the Ampac LoopSense value.'
                : 'A button on a job that texts the client I am ten minutes away.'}
          />
        </Card>

        <Button
          title="Send"
          onPress={() => { void send(); }}
          loading={busy}
          icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />}
        />
      </Screen>
    </>
  );
}
