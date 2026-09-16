import { upsertJob } from '@/db/opsRepo';
import { listInvoices, listJobsFor, upsertInvoice } from '@/db/mirrorRepo';
import { jobNumberForReport } from '@/domain/reportJobMatch';
import type { SimproInvoice } from '@/simpro/mirrorResources';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * What the screens read, run against the schema on Node's SQLite.
 *
 * Two screens read a bounded set from the repository and then filter it in
 * memory. That is fine while the bound contains what the screen wants and
 * quietly wrong once it does not: the phone now holds every job on the
 * books, so "the first five hundred jobs" is the five hundred oldest, and a
 * service report at a site with one job issued this fortnight went out
 * with no job number and no word about why. These tests pin the reads the
 * screens make to what the screens mean.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

async function site(id: string, name: string): Promise<void> {
  await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES (?,?,'','')", id, name);
}

const AT = '2026-09-02T00:30:00.000Z';

describe("the service report's job number", () => {
  it("comes from the site's own jobs, however many jobs the phone holds", async () => {
    await site('site-1', 'Harbourline Apartments');
    await site('site-2', 'Somewhere Else');
    // Six hundred stale open jobs elsewhere, issued years ago: more than the
    // five hundred the report used to look through, and every one of them
    // older than this site's job.
    for (let i = 0; i < 600; i++) {
      await upsertJob({
        id: `simpro-${1000 + i}`, externalId: String(1000 + i), siteId: 'site-2', siteName: 'Somewhere Else',
        title: 'Old job', stage: 'Pending', status: 'scheduled', scheduledFor: '2021-03-04', dateModified: '2021-03-04T09:00:00+10:00',
      });
    }
    await upsertJob({
      id: 'simpro-43747', externalId: '43747', siteId: 'site-1', siteName: 'Harbourline Apartments',
      title: 'Six monthly routine', stage: 'Progress', status: 'scheduled', scheduledFor: '2026-08-28',
      dateModified: '2026-08-30T09:12:44+10:00',
    });

    const window = { siteId: 'site-1', from: '2026-08-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' };
    const candidates = await listJobsFor({ siteId: 'site-1', limit: 500 });
    expect(candidates.map((j) => j.externalId)).toEqual(['43747']);
    expect(jobNumberForReport(candidates, window)).toEqual({ jobNumber: '43747' });
  });
});

describe("a site's invoices", () => {
  const invoice = (over: Partial<SimproInvoice> = {}): SimproInvoice => ({
    id: '7001', customerId: '812', customerName: 'Harbourline Body Corporate', jobs: [{ id: '43747' }],
    dateIssued: '2026-08-29', isPaid: false, totalExTaxCents: 152350, totalIncTaxCents: 167585,
    ...over,
  });

  it('are the ones billing any job at the site, joined in SQL rather than read whole', async () => {
    await site('site-1', 'Harbourline Apartments');
    await site('site-2', 'Somewhere Else');
    await upsertJob({ id: 'simpro-43747', externalId: '43747', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Routine', stage: 'Progress', status: 'scheduled' });
    await upsertJob({ id: 'simpro-43748', externalId: '43748', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Callout', stage: 'Complete', status: 'complete' });
    await upsertJob({ id: 'simpro-50001', externalId: '50001', siteId: 'site-2', siteName: 'Somewhere Else', title: 'Routine', stage: 'Progress', status: 'scheduled' });

    await upsertInvoice(invoice({ id: '7001', jobs: [{ id: '43747' }] }), AT);
    await upsertInvoice(invoice({ id: '7002', jobs: [{ id: '50001' }], isPaid: true }), AT);
    // Bills two jobs at the site: one invoice, not two rows.
    await upsertInvoice(invoice({ id: '7003', jobs: [{ id: '43747' }, { id: '43748' }], dateIssued: '2026-08-30' }), AT);
    // Bills a job at each site: on the site's list once.
    await upsertInvoice(invoice({ id: '7004', jobs: [{ id: '43748' }, { id: '50001' }], dateIssued: '2026-08-31' }), AT);

    expect((await listInvoices({ siteId: 'site-1' })).map((i) => i.externalId)).toEqual(['7004', '7003', '7001']);
    expect((await listInvoices({ siteId: 'site-2' })).map((i) => i.externalId)).toEqual(['7004', '7002']);
    expect(await listInvoices({ siteId: 'site-none' })).toEqual([]);
    expect((await listInvoices({ siteId: 'site-1', unpaidOnly: true, limit: 1 })).map((i) => i.externalId)).toEqual(['7004']);
  });
});
