import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import {
  SUGGESTION_KINDS, suggestionBody, suggestionNotReady, suggestionSubject,
  type Suggestion, type SuggestionKind,
} from '@/domain/suggestions';
import { useTheme } from '@/theme';
import { Button, Card, Field, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

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
      showAlert('Nowhere to send it', 'Set the suggestions address in Settings first.');
      return;
    }
    setBusy(true);
    try {
      if (!(await MailComposer.isAvailableAsync())) {
        showAlert('No mail app set up', 'This phone has no email account configured, so the suggestion cannot be sent from here.');
        return;
      }
      const { status } = await MailComposer.composeAsync({
        recipients: [prefs.suggestionsEmail.trim()],
        subject: suggestionSubject(s),
        body: suggestionBody(s),
      });
      if (status === MailComposer.MailComposerStatus.SENT) {
        showAlert('Sent', 'Thanks. When it turns into a change, the new build lands at the same download link.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        showAlert('Not sent', 'The email was not sent, so nobody has seen it yet.');
      }
    } catch (e) {
      showAlert('Could not send', e instanceof Error ? e.message : String(e));
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
          <Txt weight="800" size="lg" style={{ letterSpacing: -0.3 }}>This app is built from what you send here.</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            An idea, a screen that is wrong, a table that is missing a value, a form we should have.
            It goes to {prefs?.suggestionsEmail || 'the suggestions address in Settings'} and gets read by the
            person who builds this. You will see it in a later build at the same download link.
          </Txt>
        </View>

        {prefs && !prefs.technicianName.trim() ? (
          <Card onPress={() => router.push('/settings')}>
            <Txt weight="700">Set your name first</Txt>
            <Txt size="sm" tone="muted">So whoever reads it can come back and ask you what you meant.</Txt>
          </Card>
        ) : null}

        <Card>
          <Segmented options={SUGGESTION_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
        </Card>

        <Card>
          <Field label="Where in the app" value={screen} onChangeText={setScreen} placeholder="Timesheet, resistor values, the home screen…" autoCapitalize="sentences" />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label={kind === 'problem' ? 'What happened, and what you expected' : kind === 'information' ? 'What should be in here' : 'Your idea'}
            value={text}
            onChangeText={setText}
            multiline
            placeholder={kind === 'problem'
              ? 'I tapped Send and it said sent, but accounts never got it.'
              : kind === 'information'
                ? 'The EOL table is missing the Ampac LoopSense value — it is 3k3.'
                : 'A button on a job that texts the client I am ten minutes away.'}
          />
        </Card>

        <Button
          title="Send it"
          onPress={() => { void send(); }}
          loading={busy}
          icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />}
        />
      </Screen>
    </>
  );
}
