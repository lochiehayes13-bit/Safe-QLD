import {
  jobSummariesByExternalIds, listJobPage, listJobSummaries, listJobs, openJobPicks, workHubCounts,
} from '@/db/opsRepo';
import {
  customerStats, listInvoices, listJobsFor, listQuotePage, listQuotes, scheduledJobExternalIds, siteStats,
} from '@/db/mirrorRepo';
import { queryAssets } from '@/db/assetRepo';
import { listDefects, listSitePicks, listSiteSummaries, listSites } from '@/db/repo';
import { listScheduleFor } from '@/db/scheduleRepo';
import { listTimesheets } from '@/db/timesheetRepo';
import { applyJobFilter, applyQuoteFilter } from '@/domain/jobPresentation';
import { groupScheduleByDay, scheduleWindow } from '@/domain/myDay';
import { jobOptions } from '@/domain/timesheet';
import type { Timesheet } from '@/domain/timesheet';
import { ME, SCALE, TODAY, seedScale, type SeededScale } from './support/scaleSeed';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * How long a screen takes to open, on the office's real volumes.
 *
 * The owner's phone holds the whole company: 4,562 jobs, 3,059 sites, 12,568
 * assets, 2,482 customers, 970 quotes, 2,232 invoices and some thirty-one
 * thousand routine schedule rows. Every screen in this app was written and
 * tested against twenty rows, and several of them read everything and filter
 * in JavaScript. At twenty rows that is instant; at four and a half thousand
 * it is a technician watching a spinner every time they back out of a job,
 * which is what "the modules are broken" means.
 *
 * So this measures rather than argues. It seeds the volumes above and times
 * every read a screen makes when it opens, before and after the queries were
 * pushed into SQL, and prints the table.
 *
 * It is off by default: seeding fifty thousand rows takes a few seconds and
 * the numbers are a measurement, not an assertion — a slow machine must not
 * fail somebody's build. Run it with
 *
 *     SAFEQLD_SCALE=1 npx jest scale --silent=false
 *
 * **The numbers are this machine's.** A phone's SQLite is the same code on a
 * slower core with slower storage and a cold page cache; take every figure
 * here as the floor and expect a handset to be several times worse.
 */

const RUN = process.env.SAFEQLD_SCALE === '1';
const at = RUN ? describe : describe.skip;

let db: NodeSqliteDb;
let fixture: SeededScale;

/** Milliseconds for one call, as the median of a few, so one stall does not read as the cost. */
async function timed(runs: number, work: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    await work();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

const table: { read: string; ms: number; rows: number }[] = [];

async function measure(read: string, work: () => Promise<{ length: number } | unknown>): Promise<void> {
  let rows = 0;
  const ms = await timed(5, async () => {
    const out = await work();
    rows = Array.isArray(out) ? out.length : 1;
  });
  table.push({ read, ms, rows });
}

at('the reads a screen makes, at the office\'s volumes', () => {
  beforeAll(() => {
    db = openMigrated();
    const started = Date.now();
    fixture = seedScale(db);
    // eslint-disable-next-line no-console
    console.log(`seeded ${SCALE.jobs} jobs, ${SCALE.sites} sites, ${SCALE.assets} assets in ${Date.now() - started} ms`);
  }, 300_000);

  afterAll(async () => {
    const width = Math.max(...table.map((r) => r.read.length));
    const lines = table.map((r) => `${r.read.padEnd(width)}  ${r.ms.toFixed(1).padStart(9)} ms  ${String(r.rows).padStart(6)} rows`);
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);
    await db.closeAsync();
  });

  it('the job list, as it was: every row read, then filtered in JavaScript', async () => {
    const scheduledToday = new Set(await scheduledJobExternalIds({ from: TODAY, to: TODAY }));
    const who = { by: 'id' as const, staffId: ME.id, staffName: ME.name, label: ME.name };
    await measure('jobs.tsx  listJobSummaries({ limit: 6000 })', () => listJobSummaries({ limit: 6000 }));
    const all = await listJobSummaries({ limit: 6000 });
    for (const filter of ['open', 'mine', 'today', 'all'] as const) {
      await measure(`jobs.tsx  applyJobFilter '${filter}' in memory`, async () =>
        applyJobFilter(all, { filter, today: TODAY, who, scheduledToday, query: '' }));
    }
    await measure('jobs.tsx  applyJobFilter search in memory', async () =>
      applyJobFilter(all, { filter: 'all', today: TODAY, who, scheduledToday, query: fixture.searchTerm }));
    await measure('jobs.tsx  scheduledJobExternalIds(today)', () => scheduledJobExternalIds({ from: TODAY, to: TODAY }));
    expect(all.length).toBe(SCALE.jobs);
  }, 300_000);

  it('the job list opened from a site or a customer', async () => {
    await measure('jobs.tsx  listJobsFor({ siteId, limit: 2000 })', () => listJobsFor({ siteId: fixture.siteId, limit: 2000 }));
    await measure('jobs.tsx  listJobsFor({ customer, limit: 2000 })', () =>
      listJobsFor({ customerExternalId: fixture.customerExternalId, limit: 2000 }));
  }, 300_000);

  it('the sites tab and the site pickers', async () => {
    // The site list as it was written, run verbatim, so the before and the
    // after are the same question asked of the same rows.
    await measure('sites.tsx  listSiteSummaries() as it was', async () => db.getAllAsync(`
      SELECT s.*,
        (SELECT COUNT(*) FROM panel p WHERE p.siteId = s.id) AS panelCount,
        (SELECT COUNT(*) FROM point pt JOIN panel p2 ON pt.panelId = p2.id WHERE p2.siteId = s.id) AS pointCount,
        (SELECT COUNT(*) FROM defect d WHERE d.siteId = s.id AND d.status = 'open') AS openDefects
      FROM site s
      ORDER BY s.name COLLATE NOCASE`));
    await measure('site picker  listSites()', () => listSites());
  }, 300_000);

  it('the asset register and universal find', async () => {
    await measure('site/assets.tsx  queryAssets({ siteId, limit: 2000 })', () =>
      queryAssets({ siteId: fixture.bigSiteId, limit: 2000 }));
    await measure('assets/find.tsx  queryAssets({ search, limit: 40 })', () => queryAssets({ search: 'SN12', limit: 40 }));
  }, 300_000);

  it('invoices, quotes and defects', async () => {
    await measure('invoices/index.tsx  listInvoices({ unpaid, 500 })', () => listInvoices({ unpaidOnly: true, limit: 500 }));
    await measure('invoices/index.tsx  listInvoices({ limit: 500 })', () => listInvoices({ limit: 500 }));
    await measure('quotes/simpro.tsx  listQuotes({ limit: 5000 })', () => listQuotes({ limit: 5000 }));
    const quotes = await listQuotes({ limit: 5000 });
    await measure('quotes/simpro.tsx  applyQuoteFilter in memory', async () => applyQuoteFilter(quotes, 'open', ''));
    await measure('work/defects.tsx  listDefects()', () => listDefects());
  }, 300_000);

  it('the home hub and the counts on a customer or site card', async () => {
    const window = scheduleWindow(`${TODAY}T00:30:00.000Z`);
    await measure('(tabs)/index.tsx  listScheduleFor(2 days)', () =>
      listScheduleFor({ staffId: ME.id, from: window.today, to: window.tomorrow }));
    await measure('(tabs)/index.tsx  listJobs({ limit: 300 })', () => listJobs({ limit: 300 }));
    const rows = await listScheduleFor({ staffId: ME.id, from: window.today, to: window.tomorrow });
    const jobs = await listJobs({ limit: 300 });
    await measure('(tabs)/index.tsx  groupScheduleByDay in memory', async () =>
      groupScheduleByDay(rows, `${TODAY}T00:30:00.000Z`, jobs.map((j) => ({
        id: j.id, externalId: j.externalId, siteName: j.siteName, title: j.title, address: j.address,
      }))));
    await measure('(tabs)/work.tsx  listJobs({ limit: 500 })', () => listJobs({ limit: 500 }));
    await measure('customer/[id].tsx  customerStats()', () => customerStats(fixture.customerExternalId));
    await measure('site/[id].tsx  siteStats()', () => siteStats(fixture.siteId));
  }, 300_000);

  it('and the same screens, with the reads pushed into the database', async () => {
    const who = { by: 'id' as const, staffId: ME.id, label: ME.name };
    for (const filter of ['open', 'mine', 'today', 'all'] as const) {
      await measure(`AFTER jobs.tsx  listJobPage '${filter}'`, async () =>
        (await listJobPage({ filter, today: TODAY, who, limit: 300 })).rows);
    }
    await measure('AFTER jobs.tsx  listJobPage search', async () =>
      (await listJobPage({ filter: 'all', today: TODAY, who, query: fixture.searchTerm, limit: 300 })).rows);
    await measure('AFTER jobs.tsx  listJobPage siteId', async () =>
      (await listJobPage({ filter: 'all', today: TODAY, siteId: fixture.siteId, limit: 300 })).rows);
    await measure('AFTER sites.tsx  listSiteSummaries page', async () => (await listSiteSummaries({ limit: 300 })).rows);
    await measure('AFTER sites.tsx  listSiteSummaries search', async () =>
      (await listSiteSummaries({ query: 'Newstead', limit: 300 })).rows);
    await measure('AFTER site picker  listSitePicks()', () => listSitePicks());
    await measure('AFTER quotes/simpro.tsx  listQuotePage', async () =>
      (await listQuotePage({ filter: 'open', limit: 300 })).rows);
    await measure('AFTER work/defects.tsx  listDefects(open, 301)', () => listDefects(undefined, 'open', 301));
    await measure('AFTER (tabs)/work.tsx  workHubCounts()', () => workHubCounts());
    await measure('AFTER (tabs)/index.tsx  jobSummariesByExternalIds', async () => {
      const window = scheduleWindow(`${TODAY}T00:30:00.000Z`);
      const rows = await listScheduleFor({ staffId: ME.id, from: window.today, to: window.tomorrow });
      return jobSummariesByExternalIds(rows.map((r) => r.jobId).filter((id): id is string => !!id));
    });
    await measure('AFTER timesheet/[id].tsx  openJobPicks(400)', () => openJobPicks(400));
  }, 300_000);

  it("the timesheet's job picker", async () => {
    await measure('timesheet/[id].tsx  listJobs({ limit: 400 })', () => listJobs({ limit: 400 }));
    const jobs = await listJobs({ limit: 400 });
    const history = (await listTimesheets()) as unknown as Timesheet[];
    await measure('timesheet/[id].tsx  jobOptions in memory', async () =>
      jobOptions(history, jobs.map((j) => ({ externalId: j.externalId, siteName: j.siteName, siteId: j.siteId, status: j.status }))));
  }, 300_000);
});
