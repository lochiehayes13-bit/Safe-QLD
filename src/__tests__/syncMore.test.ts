import { SimproError, type SimproClient } from '@/simpro/client';
import { MORE_RESOURCES, MORE_STAGES, pullMore, type MoreSyncInput } from '@/simpro/syncMore';
import { readSyncState, writeSyncState } from '@/simpro/watermark';
import {
  getCatalogItem, getContact, getVendor, getVendorOrder, listCatalogGroups, listSetupActivities, listSimproTimesheets,
  searchCatalogItems, searchVendorOrders,
} from '@/db/moreRepo';
import { upsertJob } from '@/db/opsRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The rest of Simpro, pulled against a scripted client onto a real
 * migrated database.
 *
 * What these hold still is the shape of a stage rather than any one
 * resource: a stage that fails records its error and leaves every other
 * stage to run; a stage that failed does not move its watermark, and one
 * that did not write cleanly does not either; a thin read is a failed
 * stage rather than a blanked mirror; a full read prunes what the office
 * no longer has and an incremental read prunes nothing; the hours stage
 * asks for one person and skips itself with a note where the phone does
 * not know who that is.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const STARTED = '2026-09-09T00:30:00.000Z';

interface Call { path: string; query: Record<string, string | number> }

type Handler = (path: string, query: Record<string, string | number>) => unknown[];

/** A client that answers each path from a script, and records what it was asked. */
function fakeClient(handler: Handler): { client: SimproClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async listAllPaged<T>(path: string, query: Record<string, string | number> = {}, maxRecords = 5000) {
      calls.push({ path, query });
      const items = handler(path, query) as T[];
      return { items: items.slice(0, maxRecords), truncated: items.length > maxRecords };
    },
    async listAll<T>(path: string, query: Record<string, string | number> = {}) {
      calls.push({ path, query });
      return handler(path, query) as T[];
    },
    async request<T>(_method: string, path: string, options: { query?: Record<string, string | number> } = {}) {
      calls.push({ path, query: options.query ?? {} });
      return { data: handler(path, options.query ?? {}) as T, total: null };
    },
  };
  return { client: client as unknown as SimproClient, calls };
}

/** Every path answered with a plausible row, so a pull with nothing scripted against it is clean. */
const everything: Handler = (path) => {
  switch (path) {
    case 'vendorOrders/': return [{
      ID: 5101, Type: 'Catalogue', Stage: 'Approved', Status: { ID: 3, Name: 'Sent' }, Vendor: { ID: 77, Name: 'Fictional Fire Supplies' },
      AssignedTo: { ID: 9901, CostCenter: { ID: 12, Name: 'Detection' }, Name: 'Detection', Job: 1001, Section: 2001 },
      DateIssued: '2026-08-20', Reference: 'Riser parts', Archived: false, DateModified: '2026-09-05T09:12:44+10:00',
      Totals: { ExTax: 100, IncTax: 110 },
    }];
    case 'vendorOrders/5101/catalogs/': return [
      { Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Detector' }, Allocations: [{ Quantity: { Received: 1, Total: 4 } }], Price: 10 },
    ];
    case 'vendors/': return [
      { ID: 77, Name: 'Fictional Fire Supplies', Archived: false, DateModified: '2026-08-01T08:00:00+10:00' },
      { ID: 79, Name: 'Fictional Extinguishers', Archived: false, DateModified: '2026-07-01T08:00:00+10:00' },
    ];
    case 'catalogs/': return [{ ID: 301, PartNo: 'DET-OPT-1', Name: 'Detector', Group: { ID: 7, Name: 'Detectors' }, SellPrice: 84.95, TradePrice: 40, Archived: false, DateModified: '2026-07-01T10:00:00+10:00' }];
    case 'catalogGroups/': return [{ ID: 7, Name: 'Detectors', ParentGroup: null }];
    case 'contacts/': return [{ ID: 4001, GivenName: 'Dana', FamilyName: 'Reyes', Sites: [{ ID: 3021, Name: 'Fictional Tower' }], DateModified: '2026-08-02T08:00:00+10:00' }];
    case 'leads/': return [{ ID: 61, LeadName: 'Upgrade the panel', Stage: 'Open', Status: {}, DateModified: '2026-08-11T09:00:00+10:00' }];
    case 'timesheets/': return [
      { UID: 'T1', ScheduleType: 'Job', Reference: '1001-9901', Date: '2026-09-02', TotalHrs: 4.5, EmployeeID: 17, Cost: 180 },
    ];
    case 'activitySchedules/': return [{ ID: 88, Staff: { ID: 17, Name: 'Sam Okafor' }, Date: '2026-09-15', TotalHours: 8, Activity: { ID: 5, Name: 'Leave' }, Blocks: [], DateModified: '2026-08-30T10:00:00+10:00' }];
    case 'setup/activities/': return [{ ID: 5, Name: 'Leave' }];
    case 'customerPayments/': return [{ ID: 9001, Payment: { PaymentMethod: { ID: 1, Name: 'EFT' }, Status: 'Cleared', Date: '2026-08-28' }, Invoices: [{ Invoice: { ID: 7001, Customer: { ID: 812, CompanyName: 'Fictional Body Corporate' } }, Amount: 110.1 }], Exported: true, DateModified: '2026-08-28T15:00:00+10:00' }];
    case 'creditNotes/': return [{ ID: 501, Type: 'Refund', Customer: { ID: 812, CompanyName: 'Fictional Body Corporate' }, InvoiceNo: 7001, Total: { ExTax: 100, IncTax: 110 }, DateIssued: '2026-08-29', DateModified: '2026-08-29T09:00:00+10:00' }];
    default: throw new Error(`unscripted path ${path}`);
  }
};

function input(client: SimproClient, over: Partial<MoreSyncInput> = {}): MoreSyncInput & { stages: string[] } {
  const stages: string[] = [];
  return {
    client, force: false, startedAt: STARTED, staffId: '17',
    progress: (stage, done, total) => { if (total === undefined) stages.push(`${done}:${stage}`); },
    stages,
    ...over,
  };
}

describe('a clean pull', () => {
  it('reads every resource, writes it, and moves every watermark', async () => {
    const { client, calls } = fakeClient(everything);
    const inp = input(client);
    const result = await pullMore(inp);

    expect(result.errors).toEqual([]);
    expect(result.counts).toEqual({
      vendorOrders: 1, vendors: 2, catalogs: 1, contacts: 1, leads: 1, timesheets: 1, activities: 1, payments: 1, creditNotes: 1,
    });
    for (const resource of MORE_RESOURCES) {
      const state = await readSyncState(resource);
      expect({ resource, synced: state.lastSyncedAt, mode: state.mode }).toEqual({ resource, synced: STARTED, mode: 'full' });
    }
    // The office's own stamp anchors the next pull, not the phone's clock.
    expect((await readSyncState('vendorOrders')).lastChangeSeenAt).toBe('2026-09-04T23:12:44.000Z');
    // Nine stages, numbered from zero, in order.
    expect(inp.stages).toHaveLength(MORE_STAGES);
    expect(inp.stages[0]).toBe('0:Reading purchase orders');
    expect(inp.stages[8]).toBe('8:Reading credit notes');

    // And the rows are there, without their cost.
    expect(await getVendorOrder('5101')).toMatchObject({ jobId: '1001', lines: [{ id: '301', qtyOrdered: 4, qtyReceived: 1 }] });
    expect(await getVendor('77')).toMatchObject({ name: 'Fictional Fire Supplies' });
    expect(await getCatalogItem('301')).toMatchObject({ sellExTaxCents: 8495 });
    expect(await listCatalogGroups()).toEqual([{ id: '7', name: 'Detectors', parentId: undefined, parentName: undefined }]);
    expect(await getContact('4001')).toMatchObject({ name: 'Dana Reyes' });
    expect(await listSetupActivities()).toEqual([{ id: '5', name: 'Leave' }]);
    expect((await listSimproTimesheets({ employeeId: '17', from: '2026-09-01', to: '2026-09-30' })).map((t) => t.uid)).toEqual(['T1']);
    const row = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM simpro_timesheet WHERE uid = ?', 'T1');
    expect(Object.keys(row!).filter((k) => /cost/i.test(k) && !/costcenter/i.test(k))).toEqual([]);

    // The hours were asked for by employee and window, once.
    const hours = calls.filter((c) => c.path === 'timesheets/');
    expect(hours).toHaveLength(1);
    expect(hours[0]!.query).toEqual({ EmployeeID: '17', StartDate: '2026-07-15', EndDate: '2026-09-23' });
  });

  it('asks for only what changed once it has a watermark, and prunes nothing on that read', async () => {
    await pullMore(input(fakeClient(everything).client));
    const { client, calls } = fakeClient((path, query) => {
      if (path === 'vendors/') {
        // The office changed one supplier; the other two are still there, unchanged.
        return query.DateModified ? [{ ID: 78, Name: 'Fictional Pumps', DateModified: '2026-09-08T08:00:00+10:00' }] : everything(path, query);
      }
      if (path === 'vendorOrders/' && query.DateModified) return [];
      return everything(path, query);
    });
    const result = await pullMore(input(client, { startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(result.errors).toEqual([]);
    expect(result.modes.vendors).toBe('incremental');
    // The newest supplier stamp seen was 08:00 on 1 August, Brisbane time, which is 22:00 UTC on 31 July; ten minutes of overlap keeps the day.
    expect(calls.find((c) => c.path === 'vendors/')!.query.DateModified).toBe('gt(2026-07-31)');
    expect(await getVendor('77')).not.toBeNull();
    expect(await getVendor('78')).not.toBeNull();
    expect(await getVendor('79')).not.toBeNull();
    // An incremental read of nothing keeps the mark exactly where it was.
    expect((await readSyncState('vendorOrders')).lastChangeSeenAt).toBe('2026-09-04T23:12:44.000Z');
    expect((await readSyncState('vendors')).lastChangeSeenAt).toBe('2026-09-07T22:00:00.000Z');
  });

  it('prunes nothing on a filtered read the count heuristic calls full', async () => {
    /*
     * Two suppliers on the phone. The office touches both in one day, so
     * the filtered read comes back with two rows, which is as many as the
     * last whole read saw, and assessIncremental fairly guesses the filter
     * was ignored. It was not: a third supplier, untouched, was never in
     * the reply. Pruning on that guess deleted it. The plan asked for a
     * slice, so nothing is pruned, whatever the guess.
     */
    await pullMore(input(fakeClient((path, query) => (path === 'vendors/' ? [
      { ID: 77, Name: 'Fictional Fire Supplies', DateModified: '2026-08-01T08:00:00+10:00' },
      { ID: 79, Name: 'Fictional Extinguishers', DateModified: '2026-07-01T08:00:00+10:00' },
      { ID: 80, Name: 'Fictional Hoses', DateModified: '2026-06-01T08:00:00+10:00' },
    ] : everything(path, query))).client));
    expect((await readSyncState('vendors')).lastRecordCount).toBe(3);

    const { client } = fakeClient((path, query) => {
      if (path === 'vendors/' && query.DateModified) {
        return [
          { ID: 77, Name: 'Fictional Fire Supplies', DateModified: '2026-09-08T08:00:00+10:00' },
          { ID: 79, Name: 'Fictional Extinguishers', DateModified: '2026-09-08T08:30:00+10:00' },
          { ID: 81, Name: 'Fictional Pumps', DateModified: '2026-09-08T09:00:00+10:00' },
        ];
      }
      if (query.DateModified) return [];
      return everything(path, query);
    });
    const result = await pullMore(input(client, { startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(result.errors).toEqual([]);
    // The guess is recorded honestly...
    expect(result.modes.vendors).toBe('full');
    // ...and the supplier the reply never mentioned is still here.
    expect(await getVendor('80')).not.toBeNull();
    expect(await getVendor('81')).not.toBeNull();
  });

  it('prunes what a full read no longer returned', async () => {
    await pullMore(input(fakeClient(everything).client));
    const { client } = fakeClient((path, query) => (path === 'catalogs/' ? [{ ID: 302, PartNo: 'BASE-1', Name: 'Base', DateModified: '2026-09-01T10:00:00+10:00' }] : everything(path, query)));
    const result = await pullMore(input(client, { force: true, startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(result.errors).toEqual([]);
    expect((await searchCatalogItems('')).map((c) => c.id)).toEqual(['302']);
  });
});

describe('a stage that fails', () => {
  it('fails alone, keeps its watermark, and every other stage still runs', async () => {
    await writeSyncState({ resource: 'contacts', lastSyncedAt: '2026-09-01T00:00:00.000Z', lastChangeSeenAt: '2026-09-01T00:00:00.000Z', lastRecordCount: 5, mode: 'full' }, '2026-09-01T00:00:00.000Z');
    const { client } = fakeClient((path, query) => {
      if (path === 'contacts/') throw new SimproError('Simpro returned HTTP 403 for contacts/.', 403);
      return everything(path, query);
    });
    const result = await pullMore(input(client));
    expect(result.errors).toEqual(['No permission to read contacts. Simpro sets API permissions per endpoint.']);
    expect(result.counts.contacts).toBeUndefined();
    expect(result.counts.leads).toBe(1);
    expect(result.counts.creditNotes).toBe(1);
    const contacts = await readSyncState('contacts');
    expect(contacts.lastSyncedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(contacts.lastChangeSeenAt).toBe('2026-09-01T00:00:00.000Z');
    expect((await readSyncState('leads')).lastSyncedAt).toBe(STARTED);
  });

  it('treats a refused column set as a failed stage rather than writing the thin list over the mirror', async () => {
    const { client } = fakeClient((path, query) => {
      if (path === 'leads/' && query.columns) throw new SimproError('Simpro returned HTTP 422. Invalid columns found. Salesperson', 422);
      if (path === 'leads/') return [{ ID: 61 }];
      return everything(path, query);
    });
    const result = await pullMore(input(client));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/refused the leads column set/);
    expect(result.errors[0]).toMatch(/Invalid columns found/);
    expect(await db.getFirstAsync('SELECT 1 AS x FROM lead')).toBeNull();
    expect((await readSyncState('leads')).lastSyncedAt).toBeUndefined();
  });

  it('does not move the watermark when a row failed to write, and prunes nothing', async () => {
    await pullMore(input(fakeClient(everything).client));
    const { client } = fakeClient((path, query) => (path === 'vendors/'
      ? [
        { ID: 77, Name: 'Fictional Fire Supplies', DateModified: '2026-09-08T08:00:00+10:00' },
        { ID: 78, Name: 'Fictional Pumps', DateModified: '2026-09-08T08:00:00+10:00' },
      ]
      : everything(path, query)));
    // The mapper never produces a row the table refuses, so the table is
    // made to refuse one: what matters is what the stage does when a write
    // throws, whatever the cause.
    await db.execAsync("CREATE TRIGGER refuse_vendor BEFORE INSERT ON vendor WHEN NEW.externalId = '78' BEGIN SELECT RAISE(ABORT, 'refused'); END");
    const before = await readSyncState('vendors');
    const result = await pullMore(input(client, { force: true, startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(result.errors.some((e) => /suppliers 78: .*refused/.test(e))).toBe(true);
    // The other supplier in the page still landed.
    expect((await getVendor('77'))!.syncedAt).toBe('2026-09-09T02:00:00.000Z');
    const after = await readSyncState('vendors');
    expect(after.lastSyncedAt).toBe(before.lastSyncedAt);
    expect(after.lastChangeSeenAt).toBe(before.lastChangeSeenAt);
  });

  it('writes no lines from a thin line read, and keeps the ones it had', async () => {
    // Lines read whole last run, with their quantities.
    await pullMore(input(fakeClient(everything).client));
    expect((await getVendorOrder('5101'))!.lines[0]).toMatchObject({ qtyOrdered: 4 });
    // This run the build refuses the line column set: the thin list has
    // the parts and no counts, and must not replace what was read whole.
    const { client } = fakeClient((path, query) => {
      if (path === 'vendorOrders/5101/catalogs/' && query.columns) throw new SimproError('Simpro returned HTTP 422. Invalid columns found. Allocations', 422);
      if (path === 'vendorOrders/5101/catalogs/') return [{ Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Detector' } }];
      // The office touched the order after last run's read, so its lines are wanted again.
      if (path === 'vendorOrders/') return everything(path, query).map((o) => ({ ...(o as object), DateModified: '2026-09-09T11:00:00+10:00' }));
      return everything(path, query);
    });
    const result = await pullMore(input(client, { startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(result.errors).toEqual([]);
    expect(result.notes.some((n) => /refused the purchase order line column set/.test(n))).toBe(true);
    const order = await getVendorOrder('5101');
    expect(order!.lines[0]).toMatchObject({ qtyOrdered: 4, qtyReceived: 1 });
    expect(order!.detailSyncedAt).toBe(STARTED);
  });

  it('notes, rather than fails, an order whose lines could not be read', async () => {
    const { client } = fakeClient((path, query) => {
      if (path === 'vendorOrders/5101/catalogs/') throw new SimproError('Simpro returned HTTP 500 for vendorOrders/5101/catalogs/.', 500);
      return everything(path, query);
    });
    const result = await pullMore(input(client));
    expect(result.errors).toEqual([]);
    expect(result.notes.some((n) => /1 of 1 purchase orders could not have their lines read/.test(n))).toBe(true);
    expect((await readSyncState('vendorOrders')).lastSyncedAt).toBe(STARTED);
    expect((await getVendorOrder('5101'))!.detailSyncedAt).toBeUndefined();
  });
});

describe('the hours stage', () => {
  it('skips itself with a note when the phone does not know whose it is', async () => {
    const { client, calls } = fakeClient(everything);
    const result = await pullMore(input(client, { staffId: undefined }));
    expect(result.errors).toEqual([]);
    expect(result.counts.timesheets).toBeUndefined();
    expect(result.notes.some((n) => /does not know whose it is/.test(n))).toBe(true);
    expect(calls.some((c) => c.path === 'timesheets/')).toBe(false);
    expect((await readSyncState('timesheets')).lastSyncedAt).toBeUndefined();
    // Everything after it still ran.
    expect(result.counts.activities).toBe(1);
  });

  it('replaces the window whole: a block the office deleted leaves the phone', async () => {
    await pullMore(input(fakeClient(everything).client));
    const { client } = fakeClient((path, query) => (path === 'timesheets/' ? [] : everything(path, query)));
    await pullMore(input(client, { startedAt: '2026-09-09T02:00:00.000Z' }));
    expect(await listSimproTimesheets({ employeeId: '17', from: '2026-07-01', to: '2026-09-30' })).toEqual([]);
  });
});

describe('purchase order lines', () => {
  it('are read for the orders the office changed lately or against a held job, and not for the rest', async () => {
    await upsertJob({ id: 'simpro-1002', externalId: '1002', siteName: 'Fictional Tower', title: 'Pump service', status: 'scheduled' });
    const { client, calls } = fakeClient((path, query) => {
      if (path === 'vendorOrders/') return [
        { ID: 1, AssignedTo: { Job: 5000 }, Archived: false, DateModified: '2026-09-05T09:00:00+10:00' },
        { ID: 2, AssignedTo: { Job: 5000 }, Archived: false, DateModified: '2026-01-05T09:00:00+10:00' },
        { ID: 3, AssignedTo: { Job: 1002 }, Archived: false, DateModified: '2026-01-05T09:00:00+10:00' },
      ];
      if (/^vendorOrders\/\d+\/catalogs\/$/.test(path)) return [];
      return everything(path, query);
    });
    const result = await pullMore(input(client));
    expect(result.errors).toEqual([]);
    const lineReads = calls.filter((c) => /^vendorOrders\/\d+\/catalogs\/$/.test(c.path)).map((c) => c.path);
    expect(lineReads).toEqual(['vendorOrders/1/catalogs/', 'vendorOrders/3/catalogs/']);
    expect((await searchVendorOrders('')).map((o) => [o.id, o.detailSyncedAt !== undefined])).toEqual([['3', true], ['2', false], ['1', true]]);

    // Read again a minute later: nothing has changed, so nothing is re-read.
    calls.length = 0;
    await pullMore(input(client, { startedAt: '2026-09-09T00:31:00.000Z' }));
    expect(calls.filter((c) => /^vendorOrders\/\d+\/catalogs\/$/.test(c.path))).toEqual([]);
  });
});
