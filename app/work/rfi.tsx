import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import {
  informationBody, informationNotReady, informationSubject, type InformationRequest,
} from '@/domain/requests';
import { queueJobNote } from '@/simpro/sync';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, Screen, Segmented, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Ask the office.
 *
 * Today this is a phone call from a roof to whoever answers, or a text that
 * nobody can find again on Thursday. Here it is an email with the job and the
 * site in the subject, so the answer can be filed against the work — and when
 * a job number is given, the question is also queued as a note on that job in
 * Simpro, so the office sees it where they already look.
 *
 * "Held up" is a switch rather than a priority list because there are only two
 * states that matter to the person reading: someone is standing still, or
 * they are not.
 */
export default function RequestInformationScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ job?: string; site?: string }>();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [jobNumber, setJobNumber] = useState(params.job ?? '');
  const [siteName, setSiteName] = useState(params.site ?? '');
  const [question, setQuestion] = useState('');
  const [blocking, setBlocking] = useState<'no' | 'yes'>('no');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  const request = (): InformationRequest => ({
    technicianName: prefs?.technicianName ?? '',
    jobNumber,
    siteName,
    question,
    blocking: blocking === 'yes',
  });

  const send = async () => {
    if (!prefs) return;
    const r = request();
    const blocked = informationNotReady(r);
    if (blocked) {
      showAlert('Not ready to send', blocked);
      return;
    }
    if (!prefs.supervisorEmail.trim()) {
      showAlert('No supervisor address', 'Set where questions go in Settings first.');
      return;
    }
    setBusy(true);
    try {
      if (!(await MailComposer.isAvailableAsync())) {
        showAlert('No mail app set up', 'This phone has no email account configured, so the question cannot be sent from here.');
        return;
      }
      const { status } = await MailComposer.composeAsync({
        recipients: [prefs.supervisorEmail.trim()],
        subject: informationSubject(r),
        body: informationBody(r),
      });
      if (status !== MailComposer.MailComposerStatus.SENT) {
        showAlert('Not sent', 'The email was not sent. Nothing has reached the office.');
        return;
      }
      // Onto the job as well, so the question and its answer are on the record
      // the office works from, not only in one person's inbox.
      const job = jobNumber.trim();
      if (job) {
        await queueJobNote({
          jobId: job,
          subject: r.blocking ? 'Held up — question to the office' : 'Question to the office',
          note: informationBody(r),
        });
      }
      showAlert(
        'Sent',
        job
          ? `Your question has gone to ${prefs.supervisorEmail} and will be noted on job ${job} in Simpro.`
          : `Your question has gone to ${prefs.supervisorEmail}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      showAlert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Ask the office' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          Goes to {prefs?.supervisorEmail || 'the supervisor address in Settings'} with the job and
          site in the subject, so the answer can be filed against the work.
        </Txt>

        {prefs && !prefs.technicianName.trim() ? (
          <Card onPress={() => router.push('/settings')}>
            <Txt weight="700">Set your name first</Txt>
            <Txt size="sm" tone="muted">The office needs to know who is asking. One field in Settings.</Txt>
          </Card>
        ) : null}

        <Card>
          <Segmented
            options={[{ value: 'no', label: 'Can wait' }, { value: 'yes', label: 'Held up right now' }]}
            value={blocking}
            onChange={setBlocking}
          />
          {blocking === 'yes' ? (
            <View style={{ marginTop: t.space(2.5) }}>
              <Banner tone="warn" title="Work is stopped" body="The subject line will say HELD UP and the first line of the email says work has stopped, so it gets read first." />
            </View>
          ) : null}
        </Card>

        <Card>
          <Field label="Job number" value={jobNumber} onChangeText={setJobNumber} keyboardType="numeric" placeholder="Simpro job, if there is one" hint="With a job number the question is also noted on the job in Simpro." />
          <View style={{ height: t.space(2.5) }} />
          <Field label="Site" value={siteName} onChangeText={setSiteName} placeholder="Where you are" autoCapitalize="words" />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Your question"
            value={question}
            onChangeText={setQuestion}
            multiline
            placeholder="Who holds the key to the riser? Is the panel on this job a swap or a repair? Which cost centre does the extra detector go to?"
          />
        </Card>

        <Button
          title="Send to the office"
          onPress={() => { void send(); }}
          loading={busy}
          icon={<MaterialCommunityIcons name="send-outline" size={20} color={t.color.onAccent} />}
        />
      </Screen>
    </>
  );
}
