/**
 * A site the office has raised no work against is still a site.
 *
 * Two screens searched the job table and advertised a site search. The Jobs
 * list's box says "Job number, site or customer" and answered "Nothing
 * matches" for a building that is on the phone — which reads as "that site is
 * not here". The timesheet's picker says "Job number, site or client" and its
 * own docblock promises "over every job, matching the job number, the site,
 * the client"; a site with no job returned nothing, and the only way on was
 * the free-text box, which writes a name and no site id, so the week's row was
 * never linked to a site record that exists.
 *
 * That is the owner's sentence failing outright — "every site appears in every
 * single module when searching a site, whether there's jobs available or not"
 * — in two modules where the site table was never consulted.
 */
import { createSite, listSiteSummaries } from '@/db/repo';
import { searchJobPicks, upsertJob } from '@/db/opsRepo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

beforeEach(async () => {
  db = openMigrated();
  // One site the office has work at, one it has never raised a job for.
  const busy = await createSite({ id: 'busy', name: 'Harbourline Apartments', suburb: 'Hamilton' });
  await createSite({ id: 'bare', name: 'Kingaroy Fire Station', suburb: 'Kingaroy', clientName: 'South Burnett Regional Council' });
  await upsertJob({
    id: 'j1', externalId: '43747', siteId: busy.id, siteName: busy.name,
    title: 'Six-monthly routine', status: 'scheduled',
  });
});

afterEach(async () => { await db.closeAsync(); });

describe('what the job search can and cannot answer', () => {
  it('finds nothing for a site with no job, which is the whole fault', async () => {
    expect(await searchJobPicks('Kingaroy', 60)).toEqual([]);
  });

  it('while the site search finds it on the same words', async () => {
    expect((await listSiteSummaries({ query: 'Kingaroy', limit: 20 })).rows.map((r) => r.id))
      .toEqual(['bare']);
  });

  it('and finds it by the client too, which the job table has no column for', async () => {
    expect((await listSiteSummaries({ query: 'South Burnett', limit: 20 })).rows.map((r) => r.id))
      .toEqual(['bare']);
  });
});

describe('the Jobs list offers the site it could not find a job for', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'app', 'work', 'jobs.tsx'), 'utf8');

  it('asks the site table when the jobs came back empty', () => {
    expect(source).toContain("listSiteSummaries({ query: term, limit: 5 })");
    // Only then: the ordinary search must not pay for this.
    expect(source).toContain('const worth = !!term && !shown.length && page !== null;');
  });

  it('says no job matched rather than nothing matched', () => {
    expect(source).toContain("title: 'No jobs match that'");
  });

  it('opens the site, which is the way through', () => {
    expect(source).toMatch(/pathname: '\/site\/\[id\]', params: \{ id: site\.id \}/);
  });
});

describe('the timesheet picker offers sites beside jobs', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'app', 'timesheet', '[id].tsx'), 'utf8');

  it('searches both', () => {
    expect(source).toContain('searchJobPicks(typed, 60),');
    expect(source).toContain('listSiteSummaries({ query: typed, limit: 20 }),');
  });

  it('carries the site id, so the row is linked to the record', () => {
    // The free-text box writes a name and no id, which is why a site that
    // exists ended up unlinked on the week.
    expect(source).toMatch(/siteId: site\.id,/);
  });

  it('does not offer a site a job already named', () => {
    expect(source).toContain('const named = new Set(jobs.map((j) => j.siteId).filter(Boolean));');
  });

  it('says what a site row is, rather than letting it read as a job with no number', () => {
    expect(source).toContain('A site on this phone — the office has no job against it');
  });
});
