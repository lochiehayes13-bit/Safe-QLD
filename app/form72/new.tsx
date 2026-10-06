import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createForm72 } from '@/db/form72Repo';
import { getJob, listJobPage, type JobSummary } from '@/db/opsRepo';
import { getSite, listSitePicks, type SitePick } from '@/db/repo';
import { SitePicker } from '@/components/SitePicker';
import { queryAssets } from '@/db/assetRepo';
import { nowIso } from '@/db';
import { qldIsoDay } from '@/domain/qldTime';
import { emptyForm72 } from '@/domain/form72';
import {
  form72FromJob, looksLikeHydrantWork, rankJobsForNewForm,
  type Form72FromJob, type JobForForm,
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

/**
 * How many jobs the list draws. Where it cuts, the line under it says so.
 *
 * It was four hundred, and the search ran over those four hundred rather than
 * over the books — so the number was not a drawing limit, it was the limit of
 * what could be found. Now the search is the query and this is only how many
 * rows reach the screen.
 */
const PAGE = 100;

export default function NewForm72Screen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; jobId?: string }>();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [typed, setTyped] = useState('');
  /** The search is a query now, so it waits for the typing to stop. */
  const [debounced, setDebounced] = useState('');
  const [mode, setMode] = useState<Mode>('today');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  /** How many jobs the tab and the search match, which is not how many fit. */
  const [matching, setMatching] = useState(0);
  /*
   * Starting from a site instead of a job.
   *
   * This screen is where /site/form72 redirects when it is opened with no
   * site — from the home screen, or a pinned tile — and it was a job picker
   * and nothing else. So a site with no job could not start a Form 72 from
   * the one screen that exists to start them, and plenty of this work is
   * done before the office books anything. The empty state even said so and
   * offered no way to do it.
   *
   * It routes to /site/form72 rather than creating the form here, because
   * that screen already does it properly — the register prefill, the address
   * as the form prints it, and the job auto-link where the site happens to
   * have exactly one open job. A second create path would be a second thing
   * to keep right.
   */
  const [bySite, setBySite] = useState(false);
  const [sites, setSites] = useState<SitePick[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  /*
   * The job, and the mapping the technician was shown for it.
   *
   * The mapping is held rather than recomputed when they tap Create, because
   * the two computations could disagree and one of the ways they disagreed
   * mattered: `today` below is read on every render, so a preview seen at
   * 23:59 and created at 00:00 wrote a form dated the next day — a different
   * test date from the one on screen, on a document whose notice and retention
   * clocks run from it. What was consented to is what gets written.
   */
  const [preview, setPreview] = useState<{
    job: JobSummary; mapped: Form72FromJob; lines: string[]; gaps: string[];
  } | null>(null);

  const today = qldIsoDay(nowIso()) ?? '';

  // The search waits for the typing to stop, because every keystroke is now a
  // statement rather than a pass over an array already in memory.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(typed), 200);
    return () => clearTimeout(h);
  }, [typed]);

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
      setPreview({ job, mapped, lines: mapped.filled, gaps: mapped.notFilled });
    } catch (e) {
      showAlert('Could not read the job', describeActionFailure(e, 'reading the job'));
    }
  }, [today]);

  /*
   * The tab, as a window on the day the office raised the job.
   *
   * "Raised today" is exactly that and nothing else, which is why it is a day
   * window rather than the repository's own `today` filter — that one also
   * takes in whatever the schedule has booked for today, which is a different
   * and larger set than the label promises.
   */
  const window = useMemo(() => {
    if (mode === 'today') return { dayFrom: today, dayTo: today };
    // The write-up case: a job raised in the last fortnight that somebody is
    // turning into a document now. Raised, not done — see the note by the
    // tabs. The job list has no date for when work happened.
    if (mode === 'recent') return { dayFrom: shiftDays(today, -14), dayTo: shiftDays(today, -1) };
    return {};
  }, [mode, today]);

  const load = useCallback(async () => {
    try {
      /*
       * The search, the tab and the cap are the query.
       *
       * This read four hundred jobs once and then did all three in JavaScript.
       * On this owner's phone there are 4,562 of them, so typing a job number
       * searched the four hundred the window happened to hold — a job raised
       * yesterday was unreachable while the screen said "search if yours is
       * not here", which is the worst way to be wrong: the instruction that
       * cannot work is the one on screen. The job list itself has worked this
       * way since listJobPage existed; this screen was still on the window.
       */
      const page = await listJobPage({
        filter: 'all',
        today,
        query: debounced.trim() || undefined,
        siteId: params.siteId || undefined,
        ...window,
        limit: PAGE,
      });
      setJobs(page.rows);
      setMatching(page.matching);
      // Whether there are more jobs than the page took. The repository has
      // always said so and this screen threw it away, so a technician
      // searching for a job past the four-hundredth got an empty list with
      // nothing to say the list had ended rather than the job not existing.
      setCapped(page.capped);
      setLoadError(null);
    } catch (e) {
      setJobs([]);
      setMatching(0);
      setLoadError(describeLoadFailure(e, 'the job list'));
    }
  }, [today, debounced, params.siteId, window]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /*
   * The job we arrived from, read by its own id rather than looked for in the
   * list. It used to be found in the page, which worked only while the page
   * was everything — now that the tab and the search narrow it, a job opened
   * from its own screen would not be in the rows and the preview would
   * silently not appear.
   */
  useFocusEffect(useCallback(() => {
    if (!params.jobId || autoPicked.current) return;
    autoPicked.current = true;
    void (async () => {
      const job = await getJob(params.jobId!);
      if (job) await describeJob(job);
    })();
  }, [params.jobId, describeJob]));

  const openBySite = useCallback(async () => {
    setBySite(true);
    if (sites.length) return;
    try {
      setSites(await listSitePicks());
    } catch (e) {
      showAlert('Could not read the site list', describeActionFailure(e, 'read the site list'));
    }
  }, [sites.length]);

  const shown = useMemo(() => {
    if (!jobs) return [];
    // The filtering is the query's now. What is left here is the order, which
    // is this screen's own: "the one I am standing on" is not the job list's
    // order, and water-based fire work comes first inside whatever tab is on.
    const pool = jobs;
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
  }, [jobs, today]);


  const create = useCallback(async (job: JobSummary, mapped: Form72FromJob) => {
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
  }, []);

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

      <SearchBox value={typed} onChange={setTyped} placeholder="Job number, site, suburb, client or customer" />
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'today' as const, label: 'Raised today' },
          { value: 'recent' as const, label: 'Last fortnight' },
          { value: 'all' as const, label: 'All' },
        ]}
      />
      {/*
        * "Raised", not "scheduled" — because the date these filter on is the
        * date the office raised the job in Simpro, and Simpro's job payload
        * carries no schedule at all (the bookings are their own resource). The
        * tab said "Today", so a technician standing on site looking for the
        * job they are there to do found it only if the office happened to
        * raise it that morning, and had no way to know why it was missing.
        * Honest labels and the search box are a better answer than a filter
        * that quietly means something else.
        */}
      <Txt size="xs" tone="faint">
        {/*
          * The two numbers, because they answer different questions: how many
          * are drawn, and how many there are. It used to say "the list is
          * windowed, so search if yours is not here" while the search ran over
          * that same window — advice that could not work. The search is the
          * query now, so the sentence is true.
          */}
        {capped
          ? `First ${shown.length} of ${matching.toLocaleString()} — add the site or the customer to narrow it.`
          : `${matching.toLocaleString()} job${matching === 1 ? '' : 's'}${
            mode === 'all' ? '' : ', by the date the office raised it — the only date Simpro gives us'}`}
      </Txt>

      {bySite ? (
        <Card>
          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <H2>Which site?</H2>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                The form opens with the site&rsquo;s register already on it. A job can be linked to it
                afterwards.
              </Txt>
            </View>
          </Rowed>
          <SitePicker
            sites={sites}
            onChange={(id: string) => {
              setBySite(false);
              router.push({ pathname: '/site/form72', params: { siteId: id } });
            }}
          />
          <Button title="Back to the job list" variant="ghost" onPress={() => setBySite(false)} />
        </Card>
      ) : preview ? (
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
              onPress={() => { void create(preview.job, preview.mapped); }}
            />
            <Button title="Back" variant="secondary" onPress={() => setPreview(null)} />
          </Rowed>
        </Card>
      ) : (
        <>
          {jobs === null ? (
            <Card><Txt size="sm" tone="muted">Reading the job list…</Txt></Card>
          ) : !shown.length ? (
            <>
              <EmptyState
                icon="clipboard-text-off-outline"
                title={typed ? 'No job matches that' : 'No job on this filter'}
                body={'A form can also be raised against a site with no job on it — plenty of this '
                  + 'work is done before the office books one.'}
              />
              {/* It said that and offered no way to do it, which is the dead
                  end this button is. */}
              <Button title="Pick a site instead" onPress={() => { void openBySite(); }} />
            </>
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
    issuedOn: j.scheduledFor,
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
