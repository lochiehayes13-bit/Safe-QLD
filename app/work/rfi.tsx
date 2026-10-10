import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs, type Prefs } from '@/app-prefs';
import { jobSummariesByExternalIds, openJobPicks, type JobPick } from '@/db/opsRepo';
import {
  informationBody, informationNotReady, informationSubject, requestJobFromRoute, withPickedJob,
  type InformationRequest,
} from '@/domain/requests';
import { queueJobNote } from '@/simpro/sync';
import { sendMail } from '@/export/mail';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Field, Screen, Segmented, Txt } from '@/components/ui';
import { JobPicker } from '@/components/JobPicker';
import { showAlert } from '@/components/alert';
import { describeActionFailure } from '@/domain/loadFailure';

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
  const fromRoute = requestJobFromRoute(params);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [jobNumber, setJobNumber] = useState(fromRoute.jobNumber);
  const [siteName, setSiteName] = useState(fromRoute.siteName);
  const [question, setQuestion] = useState('');
  const [blocking, setBlocking] = useState<'no' | 'yes'>('no');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [openJobs, setOpenJobs] = useState<JobPick[]>([]);

  useFocusEffect(useCallback(() => { void loadPrefs().then(setPrefs); }, []));

  /*
   * The job and site the route carries, whenever they change: the job screen
   * opens this with both, and a second job opened over the first brings its
   * own. Taken during render rather than in an effect, so the boxes never
   * show the previous job for a frame.
   */
  const routeKey = `${fromRoute.jobNumber}|${fromRoute.siteName}`;
  const [takenRoute, setTakenRoute] = useState(routeKey);
  if (routeKey !== takenRoute) {
    setTakenRoute(routeKey);
    if (fromRoute.jobNumber || fromRoute.siteName) {
      setJobNumber(fromRoute.jobNumber);
      setSiteName(fromRoute.siteName);
    }
  }

  // A job number on its own takes its site from the job on the phone. A
  // failed lookup leaves the site box for the technician to fill.
  useEffect(() => {
    if (!fromRoute.jobNumber || fromRoute.siteName) return undefined;
    let live = true;
    void jobSummariesByExternalIds([fromRoute.jobNumber])
      .then(([job]) => {
        // Only into an empty box: anything typed or picked meanwhile stands.
        if (live && job?.siteName) setSiteName((typed) => (typed.trim() ? typed : job.siteName));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [fromRoute.jobNumber, fromRoute.siteName]);

  // The open jobs are read before the picker opens, so a read that fails is
  // said as a failure rather than shown as an empty list.
  const openPicker = async () => {
    try {
      setOpenJobs(await openJobPicks(40));
      setPicking(true);
    } catch (e) {
      showAlert("Couldn't load the jobs", describeActionFailure(e, 'reading the jobs'));
    }
  };

  const takeJob = (pick: JobPick) => {
    const next = withPickedJob({ jobNumber, siteName }, pick);
    setJobNumber(next.jobNumber);
    setSiteName(next.siteName);
    setPicking(false);
  };

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
    const to = prefs.supervisorEmail.trim();
    if (!to) {
      showAlert('No supervisor address', 'Add it in Settings.');
      return;
    }
    setBusy(true);
    try {
      const outcome = await sendMail({
        to,
        subject: informationSubject(r),
        body: informationBody(r),
      });

      if (outcome === 'no-mail-app') {
        showAlert('No mail app set up', 'Add an email account to this phone, then try again.');
        return;
      }
      if (outcome === 'not-sent') {
        showAlert('Not sent', "The email wasn't sent. Try again.");
        return;
      }

      /*
       * Onto the job as well, so the question and its answer are on the record
       * the office works from, not only in one person's inbox.
       *
       * The note is queued on `handed-over` too, which is every question asked
       * from a browser. A browser cannot say whether the draft was sent, and
       * treating "cannot say" as "not sent" is what this screen used to do —
       * the mail app had the question open and the job got nothing. A note on
       * the job is the durable half, and a duplicate note is a smaller fault
       * than a question the office never sees.
       */
      const job = jobNumber.trim();
      if (job) {
        await queueJobNote({
          jobId: job,
          subject: r.blocking ? 'Held up — question to the office' : 'Question to the office',
          note: informationBody(r),
        });
      }

      const noted = job ? ` Queued as a note on job ${job}.` : '';
      showAlert(
        outcome === 'sent' ? 'Sent' : 'Draft opened',
        outcome === 'sent'
          ? `Gone to ${to}.${noted}`
          : `Your email to ${to} is ready. Tap Send in your mail app.${noted}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      showAlert("Couldn't send", describeActionFailure(e, 'sending the question'));
    } finally {
      setBusy(false);
    }
  };

  const supervisor = prefs?.supervisorEmail.trim();

  return (
    <>
      <Stack.Screen options={{ title: 'Ask the office' }} />
      <Screen>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          {supervisor ? `Goes to ${supervisor}.` : 'Add the supervisor address in Settings first.'}
        </Txt>

        {prefs && !prefs.technicianName.trim() ? (
          <Card onPress={() => router.push('/settings')}>
            <Txt weight="700">Set your name first</Txt>
            <Txt size="sm" tone="muted">Tap to add it in Settings.</Txt>
          </Card>
        ) : null}

        <Card>
          <Segmented
            options={[{ value: 'no', label: 'Can wait' }, { value: 'yes', label: 'Held up now' }]}
            value={blocking}
            onChange={setBlocking}
          />
          {blocking === 'yes' ? (
            <View style={{ marginTop: t.space(2.5) }}>
              <Banner tone="warn" title="Work is stopped" body="Marked HELD UP in the subject line." />
            </View>
          ) : null}
        </Card>

        <Card>
          {picking ? (
            <JobPicker
              suggested={openJobs}
              suggestedLabel="Open jobs"
              emptyWhenNoneSuggested="No open jobs. Search by number, site or customer."
              emptyWhenNothingOnDevice="No jobs on this phone yet. Type the number below."
              onPick={takeJob}
              onClose={() => setPicking(false)}
            />
          ) : (
            <Button
              title={jobNumber.trim() ? 'Change job' : 'Pick a job'}
              variant="secondary"
              icon={<MaterialCommunityIcons name="clipboard-list-outline" size={18} color={t.color.accentText} />}
              onPress={() => { void openPicker(); }}
            />
          )}
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Job number"
            value={jobNumber}
            onChangeText={setJobNumber}
            keyboardType="numeric"
            placeholder="Optional"
            hint={jobNumber.trim() ? 'Also noted on the job in Simpro.' : 'Not in the list? Type the number.'}
          />
          <View style={{ height: t.space(2.5) }} />
          <Field label="Site" value={siteName} onChangeText={setSiteName} placeholder="Where you are" autoCapitalize="words" />
          <View style={{ height: t.space(2.5) }} />
          <Field
            label="Your question"
            value={question}
            onChangeText={setQuestion}
            multiline
            placeholder="Who has the key to the riser?"
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
