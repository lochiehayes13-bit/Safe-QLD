import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listRoutineRuns, type RoutineRun } from '@/db/routineRunRepo';
import { listSites } from '@/db/repo';
import {
  acceptedKeys, jobForRun, linkRunToJob, planForRun, recordAccepted, type RunPlan,
} from '@/db/outboundRepo';
import {
  PUSHED_TO_SIMPRO, WITHHELD_FROM_SIMPRO, isNoteItem,
  type OutboundAttachmentItem, type OutboundItem, type OutboundNoteItem,
} from '@/domain/outboundWork';
import { sendOutboundPlan, type SendOutcome, type SendReport } from '@/simpro/testResults';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { queueJobAttachment } from '@/simpro/sync';
import { photosWithSizes } from '@/simpro/attachmentFiles';
import { formatAuDate } from '@/export/sheets';
import { loadPrefs } from '@/app-prefs';
import { dismissSync, retrySync, unknownSync, type SyncEntry } from '@/db/opsRepo';
import { flushSoon } from '@/simpro/flushSoon';
import { markerFor } from '@/domain/queueKey';
import type { Site } from '@/domain/types';
import { formatBytes } from '@/share/pack';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, Field, H2, Label, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * Sending a finished service back to the office.
 *
 * The integration pulled sites, jobs and the rate card down and pushed nothing
 * up, so the one thing a technician actually produces — a completed service,
 * its results and the defects it raised — never left the phone. The office
 * found out when the paperwork arrived, which on a bad week is a fortnight, and
 * by then an invoice has gone out for a service that was nine assets short.
 *
 * This screen is the review before that goes out, and the review is the point
 * of it. Everything the mapping declined is on screen with the reason, because
 * a technician told "3 items queued" when there were four has been told nothing
 * useful. So is everything it deliberately never sends — money, job status,
 * the statutory forms — held as data rather than as a paragraph somebody has
 * to trust.
 *
 * Two things go out in two ways. The notes are posted while the technician
 * watches, because they want to see them land. The photographs are queued —
 * one job attachment each, named so the office can read them from the file
 * list — and go the moment there is signal, because a photograph is megabytes
 * and this screen is often opened in a basement.
 *
 * Nothing sends without a job linked. A guessed job number posts a service
 * against somebody else's work, and there is no undo for that in Simpro.
 */
export default function OutboundScreen() {
  const t = useTheme();
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [sites, setSites] = useState<Map<string, Site>>(new Map());
  const [jobs, setJobs] = useState<Map<string, string>>(new Map());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);
  const [sending, setSending] = useState(false);
  /** Settings' "Send photos to Simpro attachments". Read with the runs, so a change there shows here on focus. */
  const [sendPhotos, setSendPhotos] = useState(true);
  // The job number as it is being typed. It links when the box is left, not
  // per keystroke: every character used to write the link and rebuild the plan.
  const [jobDraft, setJobDraft] = useState('');

  /*
   * Plans are read in the background, and only the last one asked for may
   * land. Opening a second run while the first is still being read, or
   * relinking twice in quick succession, otherwise left whichever plan
   * finished last on screen rather than whichever was asked for last.
   */
  const planRequest = useRef(0);
  const loadPlan = useCallback(async (run: RoutineRun) => {
    const request = ++planRequest.current;
    const site = sites.get(run.siteId);
    // The file system is looked up here and not in the repository, which has
    // to run under the test runner where expo-file-system does not load.
    const next = await planForRun(run, site?.name ?? 'Unknown site', { sendPhotos, photoSizes: photosWithSizes });
    if (planRequest.current === request) setPlan(next);
  }, [sites, sendPhotos]);

  const load = useCallback(async () => {
    const [r, s, keys, prefs] = await Promise.all([listRoutineRuns(undefined, 60), listSites(), acceptedKeys(), loadPrefs()]);
    setRuns(r);
    setSites(new Map(s.map((x) => [x.id, x])));
    setSent(new Set(keys));
    setSendPhotos(prefs.simproSendPhotos);
    const links = await Promise.all(r.map(async (run) => [run.id, await jobForRun(run.id)] as const));
    setJobs(new Map(links.filter((l): l is [string, string] => !!l[1])));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  /** Sends that went out and got no reply. A person decides these; see flushQueue. */
  const [unknown, setUnknown] = useState<SyncEntry[]>([]);
  useFocusEffect(useCallback(() => { void unknownSync().then(setUnknown); }, []));

  const openRun = useCallback(async (run: RoutineRun) => {
    if (open === run.id) { setOpen(null); setPlan(null); setReport(null); return; }
    setOpen(run.id);
    setReport(null);
    setPlan(null);
    setJobDraft(jobs.get(run.id) ?? '');
    await loadPlan(run);
  }, [open, jobs, loadPlan]);

  /** Writes the typed job number against the run and rebuilds the plan on it. */
  const linkJob = useCallback(async (run: RoutineRun) => {
    const value = jobDraft.trim();
    if (value === (jobs.get(run.id) ?? '')) return;
    setJobs((prev) => {
      const next = new Map(prev);
      if (value) next.set(run.id, value); else next.delete(run.id);
      return next;
    });
    await linkRunToJob(run.id, value);
    await loadPlan(run);
  }, [jobDraft, jobs, loadPlan]);

  const send = useCallback(async (run: RoutineRun) => {
    /*
     * The plan in state belongs to whichever run was opened last. Opening a
     * second run while the first is still loading would otherwise send one
     * run's results against the other's job, and there is no undo for that in
     * Simpro — so this refuses rather than guessing which one was meant.
     */
    if (!plan || plan.run.runId !== run.id) return;
    setSending(true);
    try {
      const prefs = await loadPrefs();
      if (!prefs.simproProxyUrl && !(await SimproClient.hasSecret())) {
        Alert.alert(
          'No Simpro credentials',
          'Set the client secret in Settings, or point the app at a proxy so the secret never sits '
          + 'on this handset at all.',
        );
        return;
      }
      const client = new SimproClient(simproConfigFromPrefs(prefs));
      // The photographs go to the queue, one row each; queueJobAttachment
      // asks for a flush itself, so they follow the notes up within seconds
      // where there is signal and wait where there is not.
      const result = await sendOutboundPlan(client, plan.plan, { alreadySent: sent, queueAttachment: queueJobAttachment });
      setReport(result);

      const jobId = jobs.get(run.id) ?? '';
      for (const outcome of result.outcomes) {
        if (outcome.status === 'sent' || outcome.status === 'skipped-duplicate') {
          await recordAccepted({
            key: outcome.key,
            jobId,
            description: outcome.description,
            urgency: outcome.urgency,
          });
        }
      }
      await load();
      await loadPlan(run);
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [plan, sent, jobs, load, loadPlan]);

  /*
   * Runs with no job linked. They are the ones that cannot go anywhere, and a
   * service sitting on a phone because nobody linked a job is exactly the one
   * the office never hears about.
   */
  const unlinked = useMemo(() => runs.filter((r) => !jobs.has(r.id)).length, [runs, jobs]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Send to the office' }} />

      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        A finished service and the defects it raised, pushed to the job in Simpro as notes, with each
        defect photograph filed as a job attachment. Nothing sends without a job linked, and everything
        held back is listed with the reason.
      </Txt>

      {unlinked ? (
        <Banner
          tone="warn"
          title={`${unlinked} recorded service${unlinked === 1 ? '' : 's'} with no job linked`}
          body="Nothing can be sent for these. A service sitting on a phone because nobody linked a job is the one the office never hears about."
        />
      ) : null}

      {!runs.length ? (
        <EmptyState
          title="No recorded services yet"
          body="Run a routine and record it, and it shows here ready to go to the office."
        />
      ) : null}

      {runs.map((run) => {
        const site = sites.get(run.siteId);
        const jobId = jobs.get(run.id) ?? '';
        const isOpen = open === run.id;
        return (
          <Card key={run.id}>
            <Rowed>
              <View style={{ flex: 1 }}>
                <Txt weight="700">{run.routineLabel}</Txt>
                <Txt size="sm" tone="muted">
                  {site?.name ?? 'Unknown site'} · {formatAuDate(run.completedAt)}
                </Txt>
              </View>
              <Chip
                label={jobId ? `Job ${jobId}` : 'No job'}
                tone={jobId ? 'accent' : 'warn'}
              />
            </Rowed>

            <Rowed gap={2} wrap>
              <Chip label={`${run.checksPassed} passed`} tone="pass" />
              {run.checksFailed ? <Chip label={`${run.checksFailed} failed`} tone="fail" /> : null}
              {run.checksNotTested ? <Chip label={`${run.checksNotTested} not tested`} tone="warn" /> : null}
              {run.defectsRaised ? <Chip label={`${run.defectsRaised} defects`} /> : null}
            </Rowed>

            <Button
              title={isOpen ? 'Hide' : 'Review what would be sent'}
              variant="secondary"
              compact
              onPress={() => void openRun(run)}
            />

            {isOpen ? (
              <View style={{ gap: t.space(2.5), marginTop: t.space(2) }}>
                <Divider />
                <Field
                  label="Simpro job"
                  value={jobDraft}
                  onChangeText={setJobDraft}
                  onBlur={() => void linkJob(run)}
                  placeholder="12345"
                  hint="Nothing sends without this. A guessed job number posts against somebody else's work."
                  keyboardType="numeric"
                />
                {jobDraft.trim() !== jobId ? (
                  <Button title="Link this job" variant="secondary" compact onPress={() => void linkJob(run)} />
                ) : null}

                {plan && plan.run.runId === run.id ? (
                  <PlanReview
                    plan={plan}
                    report={report}
                    sending={sending}
                    onSend={() => void send(run)}
                  />
                ) : (
                  <Txt size="sm" tone="muted">Reading the record…</Txt>
                )}
              </View>
            ) : null}
          </Card>
        );
      })}

      {unknown.length ? (
        <>
          <Divider />
          <H2>Sent, but no reply came</H2>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            The request went out and the connection dropped before Simpro answered. It may have
            landed. Sending again could post it twice, so the app will not; search Simpro for the
            reference below and decide.
          </Txt>
          {unknown.map((u) => (
            <Card key={u.id}>
              <Txt weight="700">{describeUnknown(u)}</Txt>
              <Txt size="xs" tone="muted">{formatAuDate(u.createdAt)}{u.lastError ? ` · ${u.lastError}` : ''}</Txt>
              {u.contentKey ? (
                <Txt size="xs" tone="faint" style={{ marginTop: 4 }} mono>Reference {markerFor(u.contentKey)}</Txt>
              ) : null}
              <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
                <Button
                  title="It is in Simpro"
                  variant="secondary"
                  compact
                  style={{ flex: 1 }}
                  onPress={() => { void dismissSync(u.id).then(() => unknownSync().then(setUnknown)); }}
                />
                <Button
                  title="Send again"
                  compact
                  style={{ flex: 1 }}
                  onPress={() => {
                    void retrySync(u.id).then(() => { flushSoon(); return unknownSync().then(setUnknown); });
                  }}
                />
              </Rowed>
            </Card>
          ))}
        </>
      ) : null}

      <Divider />
      <H2>What goes to the job</H2>
      {PUSHED_TO_SIMPRO.map((p) => (
        <Card key={p.what}>
          <Txt weight="600" size="sm">{p.what}</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{p.how}</Txt>
        </Card>
      ))}

      <Divider />
      <H2>Never sent, on purpose</H2>
      {WITHHELD_FROM_SIMPRO.map((w) => (
        <Card key={w.what}>
          <Txt weight="600" size="sm">{w.what}</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{w.why}</Txt>
        </Card>
      ))}
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}

/**
 * One line for a queued send nobody can vouch for.
 *
 * A photograph is named by its file, because that is what somebody searches
 * the job's attachments for; a note by its subject; an order by its lines. A
 * payload that will not parse still shows its kind rather than nothing.
 */
function describeUnknown(u: SyncEntry): string {
  try {
    const p = JSON.parse(u.payload) as { jobId?: string; subject?: string; filename?: string; lines?: unknown[] };
    switch (u.kind) {
      case 'job-note': return `Note on job ${p.jobId ?? '?'}: ${p.subject ?? ''}`;
      case 'attachment': return `Photo on job ${p.jobId ?? '?'}: ${p.filename ?? p.subject ?? ''}`;
      case 'purchase-order':
        return `Parts order${p.jobId ? ` for job ${p.jobId}` : ''}, ${Array.isArray(p.lines) ? p.lines.length : 0} lines`;
      default: return u.kind;
    }
  } catch {
    return u.kind;
  }
}

/**
 * What the mapping decided, before anybody presses send.
 *
 * Declined items come first. They are the ones a technician has to do something
 * about, and burying them under a list of what will go out is how a run gets
 * sent believing it was complete.
 */
function PlanReview({
  plan, report, sending, onSend,
}: {
  plan: RunPlan;
  report: SendReport | null;
  sending: boolean;
  onSend: () => void;
}) {
  const declined = plan.plan.warnings.filter((w) => w.severity === 'declined');
  const cautions = plan.plan.warnings.filter((w) => w.severity === 'caution');
  const { summary } = plan.plan;
  const notes = plan.plan.items.filter(isNoteItem).length;
  const photos = plan.plan.items.length - notes;

  return (
    <View style={{ gap: 10 }}>
      {declined.map((w, i) => (
        <Banner key={`d${i}`} tone="fail" title="Not being sent" body={w.message} />
      ))}
      {cautions.map((w, i) => (
        <Banner key={`c${i}`} tone="warn" title="Worth knowing" body={w.message} />
      ))}

      <Label>What the note will say</Label>
      <Rowed gap={2} wrap>
        <Chip label={`${summary.passed} passed`} tone="pass" />
        <Chip label={`${summary.failed} failed`} tone={summary.failed ? 'fail' : 'default'} />
        <Chip
          label={`${summary.notTested} not tested`}
          tone={summary.notTested ? 'warn' : 'default'}
        />
        {summary.criticalDefects ? (
          <Chip label={`${summary.criticalDefects} CRITICAL`} tone="fail" />
        ) : null}
        {summary.allAssetsTested ? <Chip label="Every asset tested" tone="pass" /> : null}
      </Rowed>

      {summary.notTestedReasons.length ? (
        <View style={{ gap: 3 }}>
          {summary.notTestedReasons.map((r, i) => (
            <Txt key={i} size="sm" tone={r.unrecorded ? 'warn' : 'muted'}>
              {r.count}× {r.reason}
            </Txt>
          ))}
        </View>
      ) : null}

      {plan.plan.items.map((item) => (
        <ItemCard key={item.key} item={item} />
      ))}

      {plan.plan.items.length ? (
        <Button
          title={sendTitle(notes, photos)}
          onPress={onSend}
          loading={sending}
        />
      ) : (
        <Txt size="sm" tone="muted">Nothing to send.</Txt>
      )}

      {report ? <SendResult report={report} /> : null}
    </View>
  );
}

/** "Send 2 notes and 3 photos" — the two are different acts, and the button says so. */
function sendTitle(notes: number, photos: number): string {
  const parts = [
    notes ? `${notes} note${notes === 1 ? '' : 's'}` : null,
    photos ? `${photos} photo${photos === 1 ? '' : 's'}` : null,
  ].filter((p): p is string => !!p);
  return `Send ${parts.join(' and ')}`;
}

function ItemCard({ item }: { item: OutboundItem }) {
  return isNoteItem(item) ? <NoteCard item={item} /> : <AttachmentCard item={item} />;
}

function NoteCard({ item }: { item: OutboundNoteItem }) {
  return (
    <Card>
      <Rowed>
        <View style={{ flex: 1 }}>
          <Txt size="sm" weight="600">{item.description}</Txt>
          <Txt size="xs" tone="faint" mono>{item.key}</Txt>
        </View>
        {item.urgency === 'critical' ? <Chip label="First" tone="fail" /> : null}
      </Rowed>
      {item.payload.truncated ? (
        <Txt size="xs" tone="warn">
          Shortened to fit: {item.payload.omittedChars} characters
          {item.payload.omittedSections.length ? ` (${item.payload.omittedSections.join(', ')})` : ''} are
          only in the full record, and the note says so.
        </Txt>
      ) : null}
      <Txt size="xs" tone="muted" style={{ lineHeight: 17 }} numberOfLines={8}>
        {item.payload.note}
      </Txt>
    </Card>
  );
}

/**
 * A photograph bound for the job's attachments.
 *
 * The file name is the whole point of the row: it is what the office sees in
 * the attachment list, so it is shown as it will be filed, with the size so
 * a technician on a thin signal knows what they are about to send.
 */
function AttachmentCard({ item }: { item: OutboundAttachmentItem }) {
  const { payload } = item;
  return (
    <Card>
      <Rowed gap={2} align="flex-start">
        <MaterialCommunityIcons name="image-outline" size={18} />
        <View style={{ flex: 1 }}>
          <Txt size="sm" weight="600">{payload.filename}</Txt>
          <Txt size="xs" tone="muted">{payload.subject}</Txt>
          <Txt size="xs" tone="faint" mono>{formatBytes(payload.sizeBytes)} · {payload.mimeType}</Txt>
        </View>
        <Chip label="Attachment" tone="accent" />
      </Rowed>
    </Card>
  );
}

function iconFor(status: SendOutcome['status']): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (status) {
    case 'sent': return 'check-circle-outline';
    case 'queued': return 'tray-arrow-up';
    case 'skipped-duplicate': return 'content-duplicate';
    case 'failed': return 'alert-circle-outline';
    default: return 'circle-outline';
  }
}

/**
 * What became of the send.
 *
 * The duplicate check is reported rather than assumed, because "the server said
 * it already has this" and "the server could not be asked" look identical from
 * the outside and only one of them means a duplicate is unlikely. Queued
 * photographs are counted apart from sent notes: one has landed and the other
 * is waiting for signal, and a technician about to leave site needs to know
 * which is which.
 */
function SendResult({ report }: { report: SendReport }) {
  const tone = report.failed ? 'fail' : report.sent || report.queued ? 'pass' : 'info';
  const title = [
    `${report.sent} sent`,
    report.queued ? `${report.queued} photo${report.queued === 1 ? '' : 's'} queued` : null,
    `${report.skipped} already there`,
    `${report.failed} failed`,
  ].filter((p): p is string => !!p).join(', ');
  return (
    <View style={{ gap: 8 }}>
      <Banner
        tone={tone}
        title={title}
        body={
          (report.remoteCheck === 'checked'
            ? "The job's existing notes were read first, so a service already reported from another handset was recognised."
            : report.remoteCheck === 'unavailable'
              ? `The job's notes could not be read (${report.remoteCheckError ?? 'no reason given'}), so a duplicate `
                + 'sent from a different handset would not have been caught. What this phone knows it sent was still skipped.'
              : 'The job\'s notes were not read on this send.')
          + (report.queued
            ? ' Queued photos upload the moment there is signal; Settings shows how many are still waiting.'
            : '')
        }
      />
      {report.outcomes.map((o) => (
        <Rowed key={o.key} gap={2}>
          <MaterialCommunityIcons name={iconFor(o.status)} size={16} />
          <View style={{ flex: 1 }}>
            <Txt size="sm">{o.description}</Txt>
            {o.error ? <Txt size="xs" tone={o.status === 'failed' ? 'fail' : 'warn'}>{o.error}</Txt> : null}
          </View>
        </Rowed>
      ))}
    </View>
  );
}
