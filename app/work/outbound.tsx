import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listRoutineRuns, type RoutineRun } from '@/db/routineRunRepo';
import { listSites } from '@/db/repo';
import {
  acceptedKeys, jobForRun, linkRunToJob, planForRun, recordAccepted, type RunPlan,
} from '@/db/outboundRepo';
import { WITHHELD_FROM_SIMPRO, type OutboundItem } from '@/domain/outboundWork';
import { sendOutboundPlan, type SendReport } from '@/simpro/testResults';
import { SimproClient } from '@/simpro/client';
import { loadPrefs } from '@/app-prefs';
import type { Site } from '@/domain/types';
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
 * useful. So is everything it deliberately never sends — money, photographs,
 * job status, the statutory forms — held as data rather than as a paragraph
 * somebody has to trust.
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

  const load = useCallback(async () => {
    const [r, s, keys] = await Promise.all([listRoutineRuns(undefined, 60), listSites(), acceptedKeys()]);
    setRuns(r);
    setSites(new Map(s.map((x) => [x.id, x])));
    setSent(new Set(keys));
    const links = await Promise.all(r.map(async (run) => [run.id, await jobForRun(run.id)] as const));
    setJobs(new Map(links.filter((l): l is [string, string] => !!l[1])));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openRun = useCallback(async (run: RoutineRun) => {
    if (open === run.id) { setOpen(null); setPlan(null); setReport(null); return; }
    setOpen(run.id);
    setReport(null);
    const site = sites.get(run.siteId);
    setPlan(await planForRun(run, site?.name ?? 'Unknown site'));
  }, [open, sites]);

  const setJob = useCallback(async (run: RoutineRun, value: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      if (value.trim()) next.set(run.id, value.trim()); else next.delete(run.id);
      return next;
    });
    await linkRunToJob(run.id, value);
    const site = sites.get(run.siteId);
    setPlan(await planForRun(run, site?.name ?? 'Unknown site'));
  }, [sites]);

  const send = useCallback(async (run: RoutineRun) => {
    if (!plan) return;
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
      const client = new SimproClient({
        buildDomain: prefs.simproDomain,
        companyId: prefs.simproCompanyId,
        clientId: prefs.simproClientId,
        proxyUrl: prefs.simproProxyUrl || undefined,
      });
      const result = await sendOutboundPlan(client, plan.plan, { alreadySent: sent });
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
      const site = sites.get(run.siteId);
      setPlan(await planForRun(run, site?.name ?? 'Unknown site'));
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [plan, sent, jobs, load, sites]);

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
        A finished service and the defects it raised, pushed to the job in Simpro as notes. Nothing
        sends without a job linked, and everything held back is listed with the reason.
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
                  {site?.name ?? 'Unknown site'} · {auDate(run.completedAt)}
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
                  value={jobId}
                  onChangeText={(v) => void setJob(run, v)}
                  placeholder="12345"
                  hint="Nothing sends without this. A guessed job number posts against somebody else's work."
                  keyboardType="numeric"
                />

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
          title={`Send ${plan.plan.items.length} item${plan.plan.items.length === 1 ? '' : 's'}`}
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

function ItemCard({ item }: { item: OutboundItem }) {
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
 * What became of the send.
 *
 * The duplicate check is reported rather than assumed, because "the server said
 * it already has this" and "the server could not be asked" look identical from
 * the outside and only one of them means a duplicate is unlikely.
 */
function SendResult({ report }: { report: SendReport }) {
  const tone = report.failed ? 'fail' : report.sent ? 'pass' : 'info';
  return (
    <View style={{ gap: 8 }}>
      <Banner
        tone={tone}
        title={`${report.sent} sent, ${report.skipped} already there, ${report.failed} failed`}
        body={
          report.remoteCheck === 'checked'
            ? "The job's existing notes were read first, so a service already reported from another handset was recognised."
            : report.remoteCheck === 'unavailable'
              ? `The job's notes could not be read (${report.remoteCheckError ?? 'no reason given'}), so a duplicate `
                + 'sent from a different handset would not have been caught. What this phone knows it sent was still skipped.'
              : 'The job\'s notes were not read on this send.'
        }
      />
      {report.outcomes.map((o) => (
        <Rowed key={o.key} gap={2}>
          <MaterialCommunityIcons
            name={o.status === 'sent' ? 'check-circle-outline'
              : o.status === 'skipped-duplicate' ? 'content-duplicate'
                : o.status === 'failed' ? 'alert-circle-outline' : 'circle-outline'}
            size={16}
          />
          <View style={{ flex: 1 }}>
            <Txt size="sm">{o.description}</Txt>
            {o.error ? <Txt size="xs" tone="fail">{o.error}</Txt> : null}
          </View>
        </Rowed>
      ))}
    </View>
  );
}

const auDate = (iso?: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
