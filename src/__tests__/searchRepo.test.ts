import { upsertJob } from '@/db/opsRepo';
import { createSite } from '@/db/repo';
import { localJobId, upsertCustomer, upsertInvoice, upsertQuote } from '@/db/mirrorRepo';
import { upsertCatalogItem, upsertContact, upsertLead, upsertVendor, upsertVendorOrder } from '@/db/moreRepo';
import { getSiteByExternalId, searchEverything, searchKind, searchableCount } from '@/db/searchRepo';
import { parseQuery } from '@/domain/search';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * Find-anything against the real schema on Node's SQLite.
 *
 * Every row goes in through the repository that owns it, so the columns the
 * search reads are the columns the sync writes. What is checked is the
 * thing a text reading of the SQL cannot see: that a number lands on the
 * record with that number ahead of the one that merely contains it, that a
 * phone typed with spaces finds the one the office typed with spaces, and
 * that every kind is asked with a LIMIT and nothing is read whole.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const AT = '2026-09-09T00:30:00.000Z';

/** A small office: one tower, one body corporate, a job, an order, a part, a person, an invoice, a quote, a lead, a supplier. */
async function seedOffice(): Promise<void> {
  await createSite({ id: 'site-1', name: 'Fictional Tower', address: '1 Fictional St', suburb: 'Brisbane', siteRef: 'FT-01', externalId: '3021', externalSource: 'simpro', contactMobile: '0400 000 000' });
  await createSite({ id: 'site-2', name: 'Fictional Depot', externalId: '3021', externalSource: 'register' });
  await upsertJob({
    id: localJobId('1001'), externalId: '1001', siteId: 'site-1', siteName: 'Fictional Tower', customerName: 'Fictional Body Corporate',
    customerExternalId: '812', title: 'Six monthly routine', stage: 'Pending', stageRaw: 'Pending', statusName: 'Booked',
    status: 'scheduled', scheduledFor: '2026-08-20', orderNo: 'PO-2002', dateModified: '2026-08-21T00:00:00.000Z',
  });
  await upsertJob({
    id: localJobId('2002'), externalId: '2002', siteId: 'site-1', siteName: 'Fictional Tower', customerName: 'Fictional Body Corporate',
    title: 'Detector swap', stage: 'Complete', stageRaw: 'Complete', status: 'complete', scheduledFor: '2026-07-01',
  });
  await upsertCustomer({
    id: '812', type: 'Company', name: 'Fictional Body Corporate', phone: '07 3000 0000', email: 'office@example.invalid',
    tags: [], sites: [{ id: '3021', name: 'Fictional Tower' }], contacts: [],
  }, AT);
  await upsertCustomer({ id: '1001', type: 'Individual', name: 'Fictional Person', tags: [], sites: [], contacts: [] }, AT);
  await upsertContact({
    id: '4001', givenName: 'Dana', familyName: 'Reyes', name: 'Dana Reyes', email: 'dana@example.invalid', cellPhone: '0400 111 222',
    position: 'Building manager', customers: [{ id: '812', name: 'Fictional Body Corporate' }], sites: [{ id: '3021', name: 'Fictional Tower' }],
  }, AT);
  await upsertQuote({
    id: '990', name: 'Detector replacement L2', customerId: '812', customerName: 'Fictional Body Corporate', siteId: '3021',
    siteName: 'Fictional Tower', stage: 'InProgress', status: 'Quote : Sent', dateIssued: '2026-08-01', isClosed: false,
    totalIncTaxCents: 264000, technicians: [], tags: [],
  }, 'site-1', AT);
  await upsertInvoice({
    id: '7001', customerId: '812', customerName: 'Fictional Body Corporate', jobs: [{ id: '1001' }], dateIssued: '2026-08-31',
    isPaid: false, orderNo: 'PO-2002', totalIncTaxCents: 167585, balanceDueCents: 167585,
  }, AT);
  await upsertVendorOrder({
    id: '5101', orderType: 'Catalogue', stage: 'Approved', statusName: 'Sent to supplier', vendorId: '77', vendorName: 'Fictional Fire Supplies',
    jobId: '1001', reference: 'Riser parts', dateIssued: '2026-08-20', archived: false,
  }, AT);
  await upsertCatalogItem({ id: '301', partNo: 'DET-OPT-1', name: 'Optical smoke detector', groupName: 'Detectors', sellExTaxCents: 8495, isInventory: true, isAsset: false, archived: false }, AT);
  await upsertCatalogItem({ id: '302', partNo: 'DET-OPT-10', name: 'Optical detector base', groupName: 'Detectors', isInventory: true, isAsset: false, archived: false }, AT);
  await upsertLead({ id: '61', name: 'Upgrade the panel', customerId: '812', customerName: 'Fictional Body Corporate', siteId: '3021', siteName: 'Fictional Tower', stage: 'Open', dateCreated: '2026-08-10', tags: [] }, AT);
  await upsertVendor({ id: '77', name: 'Fictional Fire Supplies', phone: '07 3000 1111', email: 'orders@example.invalid', address: { suburb: 'Yatala' }, archived: false }, AT);
}

describe('a typed number', () => {
  it('lands on the record with that number first, ahead of the ones that only contain it', async () => {
    await seedOffice();
    const hits = await searchEverything('1001');
    // Job 1001 and customer 1001 are the exact matches; the job leads by kind.
    expect(hits.slice(0, 2).map((h) => [h.kind, h.number])).toEqual([['job', '1001'], ['customer', '1001']]);
    // The invoice that bills job 1001 and the order raised against it come after, not instead.
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(['invoice', 'order']));
    expect(hits.find((h) => h.kind === 'job')).toMatchObject({
      id: 'simpro-1001', route: '/work/job/[id]', params: { id: 'simpro-1001' },
      title: 'Job 1001 · Six monthly routine',
      subtitle: 'Fictional Tower · Fictional Body Corporate · Booked · Issued 20/08/2026',
    });
  });

  it('finds a job by the customer’s order number written on it', async () => {
    await seedOffice();
    const hits = await searchEverything('2002');
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(expect.arrayContaining(['job:simpro-2002', 'job:simpro-1001', 'invoice:7001']));
    // The job numbered 2002 leads the job that merely carries PO-2002.
    expect(hits[0]).toMatchObject({ kind: 'job', number: '2002' });
  });

  it('asks only the kind a prefix named', async () => {
    await seedOffice();
    expect((await searchEverything('inv 7001')).map((h) => h.kind)).toEqual(['invoice']);
    expect((await searchEverything('po 5101')).map((h) => `${h.kind}:${h.id}`)).toEqual(['order:5101']);
    expect((await searchEverything('quote 990')).map((h) => h.route)).toEqual(['/quotes/simpro/[id]']);
    // "inv 1001" is not invoice 1001 but it is the invoice for job 1001, which is the one being asked for.
    expect((await searchEverything('inv 1001')).map((h) => `${h.kind}:${h.id}`)).toEqual(['invoice:7001']);
    expect(await searchEverything('inv 9999')).toEqual([]);
  });
});

describe('words, codes, phones and emails', () => {
  it('finds a site, a customer, a lead and a quote by a word in the name, and the tower opens by the phone’s own id', async () => {
    await seedOffice();
    const hits = await searchEverything('fictional tower');
    // Not the order: its supplier is "Fictional Fire Supplies", and every word has to land.
    expect(hits.map((h) => h.kind)).toEqual(['job', 'job', 'site', 'contact', 'quote', 'lead']);
    expect(hits.find((h) => h.kind === 'site')).toMatchObject({ id: 'site-1', params: { id: 'site-1' }, subtitle: '1 Fictional St, Brisbane · Ref FT-01' });
    // Open work ahead of finished work, as the job list orders it.
    expect(hits.slice(0, 2).map((h) => h.number)).toEqual(['1001', '2002']);
  });

  it('puts the exact part number ahead of the one it is a prefix of, and leads with the catalogue', async () => {
    await seedOffice();
    const hits = await searchEverything('DET-OPT-1');
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(['catalog:301', 'catalog:302']);
    expect(hits[0]).toMatchObject({ route: '/office-catalogue', params: { q: 'DET-OPT-1' }, subtitle: 'DET-OPT-1 · Detectors · $84.95 ex GST' });
  });

  it('finds whoever has a phone number, however the office spaced it', async () => {
    await seedOffice();
    expect((await searchEverything('0400111222')).map((h) => `${h.kind}:${h.id}`)).toEqual(['contact:4001']);
    expect((await searchEverything('3000 0000')).map((h) => `${h.kind}:${h.id}`)).toEqual(['customer:812']);
    expect((await searchEverything('(07) 3000 1111')).map((h) => `${h.kind}:${h.id}`)).toEqual(['vendor:77']);
    expect((await searchEverything('0400 000 000')).map((h) => `${h.kind}:${h.id}`)).toEqual(['site:site-1']);
    // Typed with the country code, or held with it: the two meet on the number itself.
    expect((await searchEverything('+61 400 000 000')).map((h) => `${h.kind}:${h.id}`)).toEqual(['site:site-1']);
    await upsertVendor({ id: '78', name: 'Fictional Cables', phone: '+61 400 111 222', archived: false }, AT);
    expect((await searchEverything('0400 111 222')).map((h) => `${h.kind}:${h.id}`)).toEqual(['contact:4001', 'vendor:78']);
  });

  it('finds whoever has an email, and asks nothing that has no email column', async () => {
    await seedOffice();
    const hits = await searchEverything('orders@example.invalid');
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(['vendor:77']);
    expect(await searchKind('invoice', parseQuery('orders@example.invalid'), 8)).toEqual([]);
  });

  it('returns nothing for a search too short to mean anything', async () => {
    await seedOffice();
    expect(await searchEverything('f')).toEqual([]);
    expect(await searchEverything('   ')).toEqual([]);
  });
});

describe('how it reads', () => {
  it('asks each kind once, with a LIMIT, and never reads a table whole', async () => {
    await seedOffice();
    db.statements.length = 0;
    await searchEverything('fictional', { limitPerKind: 3 });
    const selects = db.statements.filter((s) => /^\s*SELECT/i.test(s.sql));
    expect(selects).toHaveLength(10);
    for (const s of selects) {
      expect(s.sql).toMatch(/WHERE/);
      expect(s.sql).toMatch(/LIMIT \?$/);
      expect(s.params[s.params.length - 1]).toBe(3);
    }
  });

  it('caps each kind at the limit rather than the whole', async () => {
    await seedOffice();
    const hits = await searchEverything('fictional', { limitPerKind: 1 });
    const perKind = new Map<string, number>();
    for (const h of hits) perKind.set(h.kind, (perKind.get(h.kind) ?? 0) + 1);
    expect([...perKind.values()].every((n) => n === 1)).toBe(true);
    expect(perKind.get('job')).toBe(1);
  });

  it('counts what the phone holds, so an empty answer can say whether anything came down', async () => {
    expect(await searchableCount()).toBe(0);
    await seedOffice();
    expect(await searchableCount()).toBeGreaterThan(5);
  });
});

describe('the site behind the office’s site number', () => {
  it('marks the Simpro site as the exact one and not a register’s row that shares the number', async () => {
    await seedOffice();
    const hits = (await searchEverything('3021')).filter((h) => h.kind === 'site');
    expect(hits.map((h) => [h.id, h.number])).toEqual([['site-1', '3021'], ['site-2', undefined]]);
    expect(hits[0]).toMatchObject({ params: { id: 'site-1' } });
  });

  it('finds the Simpro site and not a register’s row that happens to share the number', async () => {
    await seedOffice();
    expect((await getSiteByExternalId('3021'))?.id).toBe('site-1');
    expect(await getSiteByExternalId('9999')).toBeNull();
    expect(await getSiteByExternalId('  ')).toBeNull();
  });
});
