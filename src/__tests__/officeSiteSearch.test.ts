/**
 * Three office modules that could not be searched by the building.
 *
 * Each of them prints the site on its own rows and could not match it, which
 * is the owner's sentence failing in a module where the link was already
 * there — not a missing join, a search that never used one.
 *
 * Invoices: the word clause reached the invoice number, the customer, the
 * order number, the description and the numbers of the jobs billed, and never
 * the site. A technician looking at an invoice whose detail screen prints
 * "Job 43747 · Barren Heights Tower" could not find it again by typing the
 * building. The siteId filter beside it already walked invoice_job to job to
 * reach exactly that.
 *
 * Contacts: every row prints the sites and customers the person belongs to,
 * and the per-word clause matched the name, the email, three phones, the
 * position and the department. The global Find-anything box has never had the
 * gap — searchRepo lists sitesJson and customersJson among the contact kind's
 * text columns — so two boxes over one table disagreed.
 */
import { createSite } from '@/db/repo';
import { upsertJob } from '@/db/opsRepo';
import { listInvoices, upsertInvoice } from '@/db/mirrorRepo';
import { searchContacts, upsertContact } from '@/db/moreRepo';
import { invoiceMatchesQuery } from '@/domain/jobPresentation';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

beforeEach(async () => {
  db = openMigrated();
  await createSite({ id: 'tower', name: 'Barren Heights Tower', suburb: 'Spring Hill' });
  await upsertJob({
    id: 'j1', externalId: '43747', siteId: 'tower', siteName: 'Barren Heights Tower',
    title: 'Six-monthly routine', status: 'complete',
  });
});

afterEach(async () => { await db.closeAsync(); });

describe('finding an invoice by the building it is about', () => {
  beforeEach(async () => {
    await upsertInvoice({
      id: 'INV-900', customerName: 'A Body Corporate', isPaid: false,
      dateIssued: '2026-09-02', jobs: [{ id: '43747' }],
    } as never, '2026-09-02T00:00:00.000Z');
  });

  it('finds it by the site name', async () => {
    expect((await listInvoices({ query: 'Barren Heights' })).map((i) => i.externalId))
      .toEqual(['INV-900']);
  });

  it('finds it by the suburb, which only the site table knows', async () => {
    expect((await listInvoices({ query: 'Spring Hill' })).map((i) => i.externalId))
      .toEqual(['INV-900']);
  });

  it('still finds it by everything it always did', async () => {
    for (const q of ['INV-900', 'Body Corporate', '43747']) {
      expect({ q, found: (await listInvoices({ query: q })).map((i) => i.externalId) })
        .toEqual({ q, found: ['INV-900'] });
    }
  });

  it('answers nothing for a building it is not about', async () => {
    expect(await listInvoices({ query: 'Kingaroy' })).toEqual([]);
  });

  it('carries the site onto the invoice, so the list can show it', async () => {
    const [inv] = await listInvoices({ query: 'INV-900' });
    expect(inv?.jobs[0]?.siteName).toBe('Barren Heights Tower');
  });

  it('and the screen’s own filter sees the same thing the query did', () => {
    /*
     * This runs over the rows the SQL search already narrowed, so once that
     * learned to match a site, a filter that could not would have thrown the
     * rows away again. On the unpaid tab, read without the words, it is the
     * only search there is.
     */
    const inv = {
      externalId: 'INV-900', customerName: 'A Body Corporate',
      jobs: [{ id: '43747', siteName: 'Barren Heights Tower' }],
    };
    expect(invoiceMatchesQuery(inv, 'Barren Heights')).toBe(true);
    expect(invoiceMatchesQuery(inv, 'Kingaroy')).toBe(false);
  });
});

describe('finding a contact by the site printed on their own row', () => {
  beforeEach(async () => {
    await upsertContact({
      id: 'c1', name: 'Dale Whitmore', email: 'dale@example.com',
      sites: [{ id: '8812', name: 'Barren Heights Tower' }],
      customers: [{ id: '812', name: 'A Body Corporate' }],
    } as never, '2026-09-02T00:00:00.000Z');
  });

  it('matches the site the row prints', async () => {
    expect((await searchContacts('Barren Heights')).map((c) => c.id)).toEqual(['c1']);
  });

  it('matches the customer the row prints', async () => {
    expect((await searchContacts('Body Corporate')).map((c) => c.id)).toEqual(['c1']);
  });

  it('still matches the person, which always worked', async () => {
    expect((await searchContacts('Whitmore')).map((c) => c.id)).toEqual(['c1']);
  });

  it('answers nobody for a site they are not on', async () => {
    expect(await searchContacts('Kingaroy')).toEqual([]);
  });

  it('needs every word to land, so two unrelated words match nobody', async () => {
    expect(await searchContacts('Whitmore Kingaroy')).toEqual([]);
  });
});
