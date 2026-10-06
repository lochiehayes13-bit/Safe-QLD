import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createForm72 } from '@/db/form72Repo';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import { getSite } from '@/db/repo';
import { queryAssets } from '@/db/assetRepo';
import { nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { emptyForm72 } from '@/domain/form72';
import {
  form72FromJob, looksLikeHydrantWork, rankJobsForNewForm,
  type JobForForm,
} from '@/domain/form72FromJob';
import { applyForm72Prefill, form72FromAssets } from '@/domain/formsFromAssets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { loadPrefs } from '@/app-prefs';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, H2, Rowed, Screen, SearchBox, Segmented, Txt,
} from '@/components/ui';
import { showAlert } from '@/components/alert';

/**
 * Starting a Form 72 from the job it was done under.
 *
 * The slowest part of filling in a Form 72 was Part A, and none of it was a
 * measurement: the site, the address, the date, which test this is. All of that
 * is already on the job the technician has open, and typing it again is also
 * where the site name on a statutory document comes out different from the site
 * name on the job it was done under.
 *
 * So the form starts from a job. Tap it and everything the job can honestly
 * supply is filled in, the site's asset register fills the hydrant and valve
 * lists behind it, and the screen says — before the form is created — what was
 * filled, where each value came from, and what the job could not answer. That
 * last list is the point: a prefilled field reads exactly like a checked field,
 * and the only defence is telling the person who signs which is which.
 *
 * A site with no job still works. Plenty of this work is done without one, and
 * a technician who cannot raise a form because the office has not booked the
 * job yet will write it on paper.
 */

type Mode = 'today' | 'recent' | 'all';

export default function NewForm72Screen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; jobId?: string }>();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<Mode>('today');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ job: JobSummary; lines: string[]; gaps: string[] } | null>(null);

  const today = qldIsoDay(nowIso()) ?? '';

  /*
   * Arrived from a job screen: that job is the one, so it is already chosen and
   * what it fills is already on screen. Walking somebody from a job they have
   * open back to a list to find it again is the detour this screen exists to
   * remove, and it was still there.
   */
  const autoPicked = useRef(false);

  /** What the job will fill, shown before anything is created. */
  const describeJob = useCallback(async (job: JobSummary) => {
    try {
      const prefs = await loadPrefs();
      const site = job.siteId ? await getSite(job.siteId) : null;
      const mapped = form72FromJob(toJobForForm(job), ownFrom(prefs), today, site);
      setPreview({ job, lines: mapped.filled, gaps: mapped.notFilled });
    } catch (e) {
      showAlert('Could not read the job', describeActionFailure(e, 'reading the job'));
    }
  }, [today]);

  const load = useCallback(async () => {
    try {
      // Every job, ranked here rather than by the query: "the one I am standing
      // on" is a different order from the job list's, and the filter the
      // technician wants is nearly always today.
      const page = await listJobPage({
        filter: 'all', today, siteId: params.siteId || undefined, limit: 400,
      });
      setJobs(page.rows);
      setLoadError(null);

      // The job we arrived from, chosen once. Done here rather than in an
      // effect watching the list, which would be a setState inside an effect
      // body and a cascading render for a thing that happens once.
      if (params.jobId && !autoPicked.current) {
        autoPicked.current = true;
        const found = page.rows.find((j) => j.id === params.jobId);
        if (found) await describeJob(found);
      }
    } catch (e) {
      setJobs([]);
      setLoadError(describeLoadFailure(e, 'the job list'));
    }
  }, [today, params.siteId, params.jobId, describeJob]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => {
    if (!jobs) return [];
    const q = typed.trim().toLowerCase();
    const matches = (j: JobSummary) => !q
      || [j.siteName, j.title, j.customerName, j.externalId, j.orderNo, j.address]
        .some((v) => v?.toLowerCase().includes(q));

    const inMode = (j: JobSummary) => {
      const day = j.scheduledFor?.slice(0, 10);
      if (mode === 'all') return true;
      if (mode === 'today') return day === today;
      // "Recent" is the write-up case: work done in the last fortnight that
      // somebody is turning into a document now.
      return !!day && day < today && day >= shiftDays(today, -14);
    };

    const pool = jobs.filter((j) => matches(j) && inMode(j));
    const ranked = rankJobsForNewForm(pool.map(toJobForForm), today);
    // Water-based fire work first inside the chosen filter. Everything stays on
    // the list — a hydrant test can be booked under a job called anything.
    const order = new Map(ranked.map((r, i) => [r.externalId ?? r.title, i]));
    return pool
      .slice()
      .sort((a, b) => {
        const fireA = looksLikeHydrantWork(toJobForForm(a)) ? 0 : 1;
        const fireB = looksLikeHydrantWork(toJobForForm(b)) ? 0 : 1;
        if (fireA !== fireB) return fireA - fireB;
        return (order.get(a.externalId ?? a.title) ?? 0) - (order.get(b.externalId ?? b.title) ?? 0);
      });
  }, [jobs, typed, mode, today]);


  const create = useCallback(async (job: JobSummary) => {
    /*
     * A form hangs off a site, not off a job.
     *
     * form_72.siteId is a foreign key onto site(id) with foreign keys on, so a
     * job the sync has not matched to a site on this phone cannot carry one —
     * and a synthetic id would fail the insert at the moment the technician
     * taps the button. Better to say so here, with the way round it.
     */
    if (!job.siteId) {
      showAlert(
        'This job has no site on the phone yet',
        'A Form 72 is filed against a site, and the office has not matched this job to one. '
        + 'Open the site from the site list and raise the form there — everything else still '
        + 'fills itself in, and the job can be linked to the form afterwards.',
      );
      return;
    }
    setCreating(job.id);
    try {
      const prefs = await loadPrefs();
      const site = job.siteId ? await getSite(job.siteId) : null;
      const mapped = form72FromJob(toJobForForm(job), ownFrom(prefs), today, site);

      /*
       * The register's hydrants, boosters, pumps, tanks and valve sets, laid
       * over the blank form the same way the per-site flow does it. Nothing the
       * register does not hold is invented, and a read failure costs the
       * prefill rather than the form.
       */
      let parts = {};
      try {
        const assets = await queryAssets({ siteId: job.siteId, limit: 5000 });
        const blank = emptyForm72({ id: '', siteId: job.siteId, siteName: mapped.siteName, now: '' });
        parts = applyForm72Prefill(blank, form72FromAssets(assets));
      } catch {
        parts = {};
      }

      const rec = await createForm72({
        siteId: job.siteId,
        siteName: mapped.siteName,
        siteAddress: mapped.siteAddress,
        contractor: mapped.contractor,
        licenseeName: mapped.licenseeName,
        licenceNumber: mapped.licenceNumber,
        testDate: mapped.testDate,
        jobExternalId: mapped.jobExternalId,
        jobTitle: mapped.jobTitle,
        parts: {
          ...parts,
          // After the register, so a grid read from the job's own words wins
          // over the blank one — and absent where the job did not say.
          ...(mapped.maintenanceTest ? { maintenanceTest: mapped.maintenanceTest } : {}),
          ...(mapped.technician ? { technician: mapped.technician } : {}),
        },
      });
      router.replace({ pathname: '/form72/[id]', params: { id: rec.id } });
    } catch (e) {
      showAlert('Could not start the form', describeActionFailure(e, 'starting the form'));
    } finally {
      setCreating(null);
    }
  }, [today]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Start a Form 72' }} />

      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Pick the job you did the test under. The site, the address, the date and — where the
          job says so — which maintenance test this is all fill themselves in, and the site&rsquo;s
          register fills the hydrant and valve lists behind them.
        </Txt>
      </Card>

      {loadError ? <Banner tone="warn" title="The job list did not load" body={loadError} /> : null}

      <SearchBox value={typed} onChange={setTyped} placeholder="Job number, site or customer" />
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'today' as const, label: 'Today' },
          { value: 'recent' as const, label: 'Last fortnight' },
          { value: 'all' as const, label: 'All' },
        ]}
      />

      {preview ? (
        <Card>
          <H2>{preview.job.siteName || preview.job.title}</H2>
          <Txt size="sm" tone="muted">{preview.job.title}</Txt>

          <Rowed gap={2} style={{ marginTop: t.space(2) }}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={t.color.pass} />
            <Txt weight="700" size="sm">This job fills in</Txt>
          </Rowed>
          {preview.lines.map((l) => (
            <Txt key={l} size="sm" tone="muted" style={{ lineHeight: 19 }}>{`• ${l}`}</Txt>
          ))}

          {preview.gaps.length ? (
            <>
              <Rowed gap={2} style={{ marginTop: t.space(2) }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={t.color.warn} />
                <Txt weight="700" size="sm">You still answer</Txt>
              </Rowed>
              {preview.gaps.map((l) => (
                <Txt key={l} size="sm" tone="muted" style={{ lineHeight: 19 }}>{`• ${l}`}</Txt>
              ))}
            </>
          ) : null}

          {!preview.job.siteId ? (
            <Banner
              tone="warn"
              title="This job has no site on the phone yet"
              body={'A Form 72 is filed against a site, and the office has not matched this job to '
                + 'one. Raise it from the site list instead; the job can be linked afterwards.'}
            />
          ) : null}

          <Rowed gap={2} style={{ marginTop: t.space(3) }}>
            <Button
              title="Start the form"
              style={{ flex: 1 }}
              disabled={!preview.job.siteId}
              loading={creating === preview.job.id}
              onPress={() => { void create(preview.job); }}
            />
            <Button title="Back" variant="secondary" onPress={() => setPreview(null)} />
          </Rowed>
        </Card>
      ) : (
        <>
          {jobs === null ? (
            <Card><Txt size="sm" tone="muted">Reading the job list…</Txt></Card>
          ) : !shown.length ? (
            <EmptyState
              icon="clipboard-text-off-outline"
              title={typed ? 'No job matches that' : 'No job on this filter'}
              body={'A form can also be raised against a site with no job on it — plenty of this work '
                + 'is done before the office books one.'}
            />
          ) : (
            shown.map((j) => {
              const fire = looksLikeHydrantWork(toJobForForm(j));
              const day = j.scheduledFor?.slice(0, 10);
              return (
                <Card key={j.id} onPress={() => { void describeJob(j); }}>
                  <Rowed gap={2} align="flex-start">
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{j.siteName || j.title}</Txt>
                      <Txt size="sm" tone="muted">{j.title}</Txt>
                      <Rowed gap={2} wrap style={{ marginTop: 2 }}>
                        {j.externalId ? <Txt size="xs" tone="faint">{`Job ${j.externalId}`}</Txt> : null}
                        {day ? <Txt size="xs" tone="faint">{formatAuDate(day)}</Txt> : null}
                        {j.customerName ? <Txt size="xs" tone="faint" numberOfLines={1}>{j.customerName}</Txt> : null}
                      </Rowed>
                    </View>
                    {fire ? <Chip label="Water based" tone="accent" /> : null}
                    {!j.siteId ? <Chip label="No site" tone="warn" /> : null}
                  </Rowed>
                </Card>
              );
            })
          )}

          <Card>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              No job for it? Open the site and raise the form there — the register still fills the
              hydrant and valve lists.
            </Txt>
            <Button
              title="Pick a site instead"
              variant="secondary"
              onPress={() => router.push('/sites')}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

/** The job row, as the mapping wants it. */
function toJobForForm(j: JobSummary): JobForForm {
  return {
    externalId: j.externalId,
    siteId: j.siteId,
    siteName: j.siteName,
    title: j.title,
    address: j.address,
    customerName: j.customerName,
    jobType: j.jobType,
    jobTypeRaw: j.jobTypeRaw,
    technician: j.technician,
    status: j.status,
    scheduledFor: j.scheduledFor,
    completedDate: j.completedDate,
    completedAt: j.completedAt,
  };
}

function ownFrom(prefs: { companyName: string; technicianName: string; technicianLicence: string }) {
  return {
    companyName: prefs.companyName,
    technicianName: prefs.technicianName,
    technicianLicence: prefs.technicianLicence,
  };
}

/** A day, n days from an ISO day. Plain arithmetic: no calendar rules apply here. */
function shiftDays(day: string, n: number): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at)) return day;
  return new Date(at + n * 86400000).toISOString().slice(0, 10);
}
