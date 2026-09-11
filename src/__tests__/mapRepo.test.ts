import { upsertJob } from '@/db/opsRepo';
import { upsertCustomer, upsertInvoice, upsertQuote } from '@/db/mirrorRepo';
import { listMatchCustomers, loadMapData } from '@/db/mapRepo';
import { readAllPositions } from '@/db/geocodeRepo';
import { siteAddressKey } from '@/geo/geocodeKey';
import { buildPins, filterPins, PIN_KINDS, type PinKind } from '@/domain/mapPins';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The map's read, run against the schema on Node's SQLite.
 *
 * One site with a job on now, a job invoiced last month and an open quote has
 * to come back with all three on it, and a site with nothing but 2025's
 * history has to come back plain. The aggregates are joined rather than
 * looked up per site, and the join is the thing that goes wrong quietly — a
 * bare column beside two MAXes, an invoice counted once per job it bills.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const NOW = Date.parse('2026-09-02T02:00:00.000Z');
const AT = '2026-09-02T00:30:00.000Z';

async function seedSite(id: string, name: string, fields: Record<string, string | null> = {}): Promise<void> {
  const cols = ['id', 'name', 'createdAt', 'updatedAt', ...Object.keys(fields)];
  await db.runAsync(
    `INSERT INTO site (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    id, name, AT, AT, ...Object.values(fields),
  );
}

/** A schedule block: the office's booking of a job number on a day. Made-up staff. */
async function seedBlock(id: string, jobId: string, date: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO schedule (id, jobId, staffId, staffName, date, startTime, endTime, type, syncedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, jobId, '7', 'Sam Tech', date, '07:30', '11:30', 'Job', AT,
  );
}

const HARBOURLINE = {
  address: '12 Example St', suburb: 'Springfield', state: 'QLD', postcode: '4300',
  clientName: 'Harbourline Body Corporate', contactName: 'Dana Reyes', contactMobile: '0400 000 000',
};

async function seedEverything(): Promise<void> {
  await seedSite('site-1', 'Harbourline Apartments', HARBOURLINE);
  await seedSite('site-2', 'Depot Nine');
  await seedSite('site-3', 'Nowhere Yet', { address: '1 Unknown Rd', suburb: 'Elsewhere' });

  await db.runAsync(
    "INSERT INTO geocode (key, latitude, longitude, source, attemptedAt, failed) VALUES (?, -27.6, 152.9, 'device', ?, 0)",
    siteAddressKey(HARBOURLINE), AT,
  );

  // A job on now, from the office.
  await upsertJob({
    id: 'simpro-1001', externalId: '1001', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Six monthly routine',
    stage: 'Progress', stageRaw: 'Progress', status: 'scheduled', scheduledFor: '2026-08-28',
    customerExternalId: '812', customerName: 'Harbourline Body Corporate', dateModified: '2026-08-30T09:12:44+10:00',
  });
  // One invoiced last month.
  await upsertJob({
    id: 'simpro-1002', externalId: '1002', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Annual service',
    stage: 'Invoiced', stageRaw: 'Invoiced', status: 'complete', scheduledFor: '2026-07-20', completedDate: '2026-08-01',
    customerExternalId: '812', customerName: 'Harbourline Body Corporate', dateModified: '2026-08-02T09:00:00+10:00',
  });
  // And one from an earlier customer, long finished.
  await upsertJob({
    id: 'simpro-1003', externalId: '1003', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Old callout',
    stage: 'Invoiced', stageRaw: 'Invoiced', status: 'complete', scheduledFor: '2025-01-01', completedDate: '2025-01-10',
    customerExternalId: '700', customerName: 'Previous Owner', dateModified: '2025-01-12T09:00:00+10:00',
  });
  // A job raised on the phone with its own coordinates, at a site with no address.
  await upsertJob({
    id: 'local-4', siteId: 'site-2', siteName: 'Depot Nine', title: 'Callout', status: 'in-progress',
    latitude: -27.9, longitude: 153.3,
  });
  // One the office issued last week and has booked for next week. The
  // booking is on the schedule, against the job number, not on the job.
  await upsertJob({
    id: 'simpro-1004', externalId: '1004', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Hydrant flow test',
    stage: 'Pending', stageRaw: 'Pending', status: 'scheduled', scheduledFor: '2026-08-25',
    customerExternalId: '812', customerName: 'Harbourline Body Corporate', dateModified: '2026-08-26T09:00:00+10:00',
  });
  await seedBlock('blk-1', '1004', '2026-09-12');
  await seedBlock('blk-2', '1004', '2026-09-10');
  // A block already behind us says nothing about where the job is going.
  await seedBlock('blk-3', '1001', '2026-08-30');

  await upsertInvoice({
    id: '9001', customerId: '812', customerName: 'Harbourline Body Corporate', jobs: [{ id: '1002' }, { id: '1001' }],
    dateIssued: '2026-08-05', isPaid: false, balanceDueCents: 15000, totalIncTaxCents: 15000,
  }, AT);
  await upsertInvoice({
    id: '9000', customerId: '700', jobs: [{ id: '1003' }], dateIssued: '2025-01-15', isPaid: true, balanceDueCents: 0,
  }, AT);

  await upsertQuote({ id: '555', name: 'Sprinkler upgrade', isClosed: false, siteId: '3021', tags: [], technicians: [], customerId: '812' }, 'site-1', AT);
  await upsertQuote({ id: '556', name: 'Converted already', isClosed: false, jobId: '1001', siteId: '3021', tags: [], technicians: [] }, 'site-1', AT);
  await upsertQuote({ id: '557', name: 'Closed', isClosed: true, siteId: '3021', tags: [], technicians: [] }, 'site-1', AT);

  await upsertCustomer({
    id: '812', type: 'Company', name: 'Harbourline Body Corporate', archived: false, tags: [], sites: [], contacts: [],
    address: { address: '1 Fictional Pde', suburb: 'Portside', state: 'QLD', postcode: '4000' },
  }, AT);
  await upsertCustomer({ id: '700', type: 'Company', name: 'Previous Owner', archived: true, tags: [], sites: [], contacts: [] }, AT);
}

describe('the map read', () => {
  it('bounds the recent window on the Queensland calendar', async () => {
    const data = await loadMapData(NOW);
    expect(data.sinceDay).toBe('2026-06-04');
    expect(data.loadedAt).toBe(NOW);
  });

  it('positions a site from the geocode cache first, then from a job, and leaves the rest unlocated', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    expect(data.positions.get('site-1')).toEqual({ latitude: -27.6, longitude: 152.9 });
    expect(data.positions.get('site-2')).toEqual({ latitude: -27.9, longitude: 153.3 });
    expect(data.positions.has('site-3')).toBe(false);
    expect(await readAllPositions()).toEqual(new Map([[siteAddressKey(HARBOURLINE), { latitude: -27.6, longitude: 152.9 }]]));
  });

  it('carries the counts, the latest customer and the last invoice on each site', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    const site = data.sites.find((s) => s.id === 'site-1')!;
    expect(site).toMatchObject({
      name: 'Harbourline Apartments',
      address: '12 Example St',
      suburb: 'Springfield',
      clientName: 'Harbourline Body Corporate',
      contactName: 'Dana Reyes',
      contactMobile: '0400 000 000',
      jobsTotal: 4,
      lastJobAt: '2026-08-28',
      quotesOpen: 1,
      invoicesRecent: 1,
      lastInvoicedAt: '2026-08-05',
      // The customer off the latest job, not the earlier owner.
      customerExternalId: '812',
      customerName: 'Harbourline Body Corporate',
    });
    const depot = data.sites.find((s) => s.id === 'site-2')!;
    expect(depot).toMatchObject({ jobsTotal: 1, quotesOpen: 0, invoicesRecent: 0 });
    expect(depot.lastInvoicedAt).toBeUndefined();
    expect(depot.customerExternalId).toBeUndefined();
  });

  it('reads only the jobs that can colour a dot', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    expect(data.jobs.map((j) => j.id).sort()).toEqual(['local-4', 'simpro-1001', 'simpro-1002', 'simpro-1004']);
    const invoiced = data.jobs.find((j) => j.id === 'simpro-1002')!;
    expect(invoiced).toMatchObject({ externalId: '1002', stage: 'Invoiced', status: 'complete', completedDate: '2026-08-01' });
  });

  it('carries the earliest booking from today on, off the schedule, and not one behind us', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    // Two blocks ahead: the sooner one is the booking. The issue date stays
    // where it was, for the site's last-job figure.
    expect(data.jobs.find((j) => j.id === 'simpro-1004')).toMatchObject({ scheduledFor: '2026-08-25', scheduledDay: '2026-09-10' });
    // A block last week is not a booking, and a job with none has none.
    expect(data.jobs.find((j) => j.id === 'simpro-1001')?.scheduledDay).toBeUndefined();
    expect(data.jobs.find((j) => j.id === 'local-4')?.scheduledDay).toBeUndefined();
  });

  it('counts "today" on the Queensland calendar when reading the bookings', async () => {
    await seedSite('site-1', 'Harbourline Apartments', HARBOURLINE);
    await db.runAsync(
      "INSERT INTO geocode (key, latitude, longitude, source, attemptedAt, failed) VALUES (?, -27.6, 152.9, 'device', ?, 0)",
      siteAddressKey(HARBOURLINE), AT,
    );
    await upsertJob({
      id: 'simpro-1005', externalId: '1005', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Routine',
      stage: 'Pending', stageRaw: 'Pending', status: 'scheduled', scheduledFor: '2026-08-25',
    });
    await seedBlock('blk-a', '1005', '2026-09-02');
    await seedBlock('blk-b', '1005', '2026-09-03');
    const pinAt = async (now: number) => {
      const data = await loadMapData(now);
      return { day: data.jobs[0]?.scheduledDay, kind: buildPins({ sites: data.sites, jobs: data.jobs, positions: data.positions, now }).pins[0]?.kind };
    };
    // Six in the morning on 2 September in Brisbane is still 1 September in
    // UTC; the block on the 2nd is today's, and the job is on now.
    expect(await pinAt(Date.parse('2026-09-01T20:00:00.000Z'))).toEqual({ day: '2026-09-02', kind: 'open' });
    // Half past midnight on the 3rd, Brisbane: the 2nd is behind us and the
    // 3rd is today's booking, so the job is still on now rather than upcoming.
    expect(await pinAt(Date.parse('2026-09-02T14:30:00.000Z'))).toEqual({ day: '2026-09-03', kind: 'open' });
    // And from the 4th the job has no booking the phone knows about.
    expect(await pinAt(Date.parse('2026-09-03T14:30:00.000Z'))).toEqual({ day: undefined, kind: 'open' });
  });

  it('reads only the open quotes with a local site', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    expect(data.quotes).toEqual([{
      externalId: '555', siteId: 'site-1', name: 'Sprinkler upgrade', isClosed: false, jobExternalId: undefined, dateIssued: undefined,
    }]);
  });

  it('yields the right pin kinds and counts through the pin builder', async () => {
    await seedEverything();
    const data = await loadMapData(NOW);
    const built = buildPins({ sites: data.sites, jobs: data.jobs, quotes: data.quotes, positions: data.positions, now: data.loadedAt });
    expect(built.unlocated).toBe(1);
    const byId = new Map(built.pins.map((p) => [p.siteId, p]));
    expect(byId.get('site-1')?.kinds).toEqual(['open', 'upcoming', 'recent', 'quote', 'site']);
    expect(byId.get('site-1')?.refs).toEqual(['1001', '1004', '1002', '555']);
    // The booked job's line carries the day it is booked for, not the day
    // the office issued it.
    expect(byId.get('site-1')?.lines).toEqual([
      'Six monthly routine · 28/08/2026',
      'Hydrant flow test · 10/09/2026',
      'Annual service · 01/08/2026',
    ]);
    expect(byId.get('site-2')?.kinds).toEqual(['open', 'site']);
    expect(built.counts).toEqual({ open: 2, upcoming: 1, recent: 1, quote: 1, site: 2 });
    // And a job number finds its site.
    const all = new Set<PinKind>(PIN_KINDS);
    expect(filterPins(built.pins, { kinds: all, query: '1002' }).map((p) => p.siteId)).toEqual(['site-1']);
  });

  it('counts an invoice once however many of the site’s jobs it bills', async () => {
    await seedEverything();
    // 9001 bills both 1001 and 1002, which are both on site-1.
    const data = await loadMapData(NOW);
    expect(data.sites.find((s) => s.id === 'site-1')?.invoicesRecent).toBe(1);
  });

  it('lists the current customers for the matcher, with their address', async () => {
    await seedEverything();
    expect(await listMatchCustomers()).toEqual([{
      externalId: '812', name: 'Harbourline Body Corporate', address: '1 Fictional Pde', suburb: 'Portside', postcode: '4000',
    }]);
  });

  it('never reads an asset', async () => {
    await seedEverything();
    await loadMapData(NOW);
    await listMatchCustomers();
    expect(db.statements.filter((s) => /\basset\b/i.test(s.sql))).toEqual([]);
  });
});
