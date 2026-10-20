import { upsertJob } from '@/db/opsRepo';
import {
  countVendorOrders, getCatalogItem, getContact, getCreditNote, getCustomerPayment, getLead, getVendor, getVendorOrder,
  listActivitySchedules, listCatalogGroups, listContactsForCustomer, listContactsForSite, listCreditNotesForCustomer,
  listCreditNotesForInvoice, listLeads, listPaymentsForCustomer, listPaymentsForInvoice, listSetupActivities,
  listSimproTimesheets, listSimproTimesheetsForJob, listVendorOrdersForJob, pruneActivitySchedulesNotSyncedAt,
  pruneCatalogItemsNotSyncedAt, pruneContactsNotSyncedAt, pruneCreditNotesNotSyncedAt, pruneCustomerPaymentsNotSyncedAt,
  pruneLeadsNotSyncedAt, pruneVendorOrdersNotSyncedAt, pruneVendorsNotSyncedAt, replaceCatalogGroups,
  replaceSetupActivities, replaceSimproTimesheets, replaceVendorOrderLines, searchCatalogItems, searchContacts,
  searchVendorOrders, searchVendors, upsertActivitySchedule, upsertCatalogItem, upsertContact, upsertCreditNote,
  upsertCustomerPayment, upsertLead, upsertVendor, upsertVendorOrder, vendorOrdersWantingLines,
} from '@/db/moreRepo';
import type {
  SimproActivitySchedule, SimproCatalogItem, SimproCreditNote, SimproCustomerPayment, SimproLead,
  SimproOfficeContact, SimproTimesheetRow, SimproVendor, SimproVendorOrder,
} from '@/simpro/moreResources';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The v23 repository, run against the schema on Node's SQLite.
 *
 * What the SQL-as-text check in schema.test cannot see: a replace that
 * leaves a line from last week beside this week's, a prune after a full
 * pull that takes a row the pull did write, a search that matches the
 * wrong contact because the site id is a prefix of another's, a window
 * replace that reaches outside its window. Those only show when the
 * statements run.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const AT = '2026-09-09T00:30:00.000Z';
const LATER = '2026-09-09T01:30:00.000Z';

const order = (over: Partial<SimproVendorOrder> = {}): SimproVendorOrder => ({
  DateModified: '2026-08-21T09:12:44+10:00',
  id: '5101', orderType: 'Catalogue', stage: 'Approved', statusName: 'Sent to supplier',
  vendorId: '77', vendorName: 'Fictional Fire Supplies', jobId: '1001', jobSectionId: '2001', jobCostCenterId: '9901',
  reference: 'Riser parts', dateIssued: '2026-08-20', archived: false,
  ...over,
});

const vendor = (over: Partial<SimproVendor> = {}): SimproVendor => ({
  DateModified: '2026-08-01T08:00:00+10:00', id: '77', name: 'Fictional Fire Supplies', phone: '07 3000 0000',
  email: 'orders@example.invalid', address: { address: '1 Depot St', suburb: 'Yatala', state: 'QLD', postcode: '4207' },
  archived: false, ...over,
});

const item = (over: Partial<SimproCatalogItem> = {}): SimproCatalogItem => ({
  DateModified: '2026-07-01T10:00:00+10:00', id: '301', partNo: 'DET-OPT-1', name: 'Optical smoke detector',
  groupId: '7', groupName: 'Detectors', parentGroupName: 'Detection', sellExTaxCents: 8495,
  isInventory: true, isAsset: false, archived: false, ...over,
});

const contact = (over: Partial<SimproOfficeContact> = {}): SimproOfficeContact => ({
  DateModified: '2026-08-02T08:00:00+10:00', id: '4001', givenName: 'Dana', familyName: 'Reyes', name: 'Dana Reyes',
  email: 'dana@example.invalid', cellPhone: '0400 000 000', position: 'Building manager',
  customers: [{ id: '812', name: 'Fictional Body Corporate' }], sites: [{ id: '3021', name: 'Fictional Tower' }],
  ...over,
});

const lead = (over: Partial<SimproLead> = {}): SimproLead => ({
  DateModified: '2026-08-11T09:00:00+10:00', id: '61', name: 'Upgrade the panel', customerId: '812',
  customerName: 'Fictional Body Corporate', siteId: '3021', siteName: 'Fictional Tower', stage: 'Open',
  dateCreated: '2026-08-10', tags: ['Strata'], ...over,
});

const hours = (over: Partial<SimproTimesheetRow> = {}): SimproTimesheetRow => ({
  uid: 'T1', employeeId: '17', scheduleType: 'Job', reference: '1001-9901', jobId: '1001', jobCostCenterId: '9901',
  date: '2026-09-02', startTime: '07:00', endTime: '11:30', totalHours: 4.5, scheduleRateName: 'Standard', ...over,
});

const activity = (over: Partial<SimproActivitySchedule> = {}): SimproActivitySchedule => ({
  DateModified: '2026-08-30T10:00:00+10:00', id: '88', staffId: '17', staffName: 'Sam Okafor', date: '2026-09-15',
  totalHours: 8, activityId: '5', activityName: 'Leave', blocks: [{ startTime: '07:00', endTime: '15:00', hours: 8, rateName: 'Standard' }],
  isLocked: false, ...over,
});

const payment = (over: Partial<SimproCustomerPayment> = {}): SimproCustomerPayment => ({
  DateModified: '2026-08-28T15:00:00+10:00', id: '9001', paymentMethod: 'EFT', status: 'Cleared', date: '2026-08-28',
  totalCents: 16515, exported: true,
  invoices: [
    { invoiceId: '7001', customerId: '812', customerName: 'Fictional Body Corporate', amountCents: 11010 },
    { invoiceId: '7002', customerId: '812', customerName: 'Fictional Body Corporate', amountCents: 5505 },
  ],
  ...over,
});

const creditNote = (over: Partial<SimproCreditNote> = {}): SimproCreditNote => ({
  DateModified: '2026-08-29T09:00:00+10:00', id: '501', creditType: 'Refund', invoiceId: '7001', customerId: '812',
  customerName: 'Fictional Body Corporate', stage: 'Approved', status: 'Issued', dateIssued: '2026-08-29',
  totalExTaxCents: 10000, totalIncTaxCents: 11000, jobs: [{ id: '1001', siteName: 'Fictional Tower' }], ...over,
});

describe('purchase orders', () => {
  it('round-trips an order and replaces its lines whole', async () => {
    await upsertVendorOrder(order(), AT);
    await replaceVendorOrderLines('5101', [
      { kind: 'catalog', id: '301', catalogId: '301', partNo: 'DET-OPT-1', description: 'Detector', qtyOrdered: 8, qtyReceived: 4 },
      { kind: 'catalog', id: '302', catalogId: '302', partNo: 'BASE-1', description: 'Base', qtyOrdered: 8 },
    ], AT);
    const got = await getVendorOrder('5101');
    expect(got).toMatchObject({
      id: '5101', jobId: '1001', jobCostCenterId: '9901', vendorName: 'Fictional Fire Supplies', archived: false,
      dateModified: '2026-08-21T09:12:44+10:00', detailSyncedAt: AT, syncedAt: AT,
    });
    expect(got!.lines.map((l) => l.id)).toEqual(['301', '302']);
    expect(got!.lines[0]).toMatchObject({ qtyOrdered: 8, qtyReceived: 4 });

    // The office removed the base from the order: it leaves the phone.
    await replaceVendorOrderLines('5101', [{ kind: 'catalog', id: '301', description: 'Detector', qtyOrdered: 8, qtyReceived: 8 }], LATER);
    const again = await getVendorOrder('5101');
    expect(again!.lines).toHaveLength(1);
    expect(again!.lines[0]!.qtyReceived).toBe(8);
    expect(again!.detailSyncedAt).toBe(LATER);
  });

  it('keeps the lines through a list-level re-pull, since the list does not carry them', async () => {
    await upsertVendorOrder(order(), AT);
    await replaceVendorOrderLines('5101', [{ kind: 'catalog', id: '301', description: 'Detector', qtyOrdered: 1 }], AT);
    await upsertVendorOrder(order({ stage: 'Complete' }), LATER);
    const got = await getVendorOrder('5101');
    expect(got!.stage).toBe('Complete');
    expect(got!.lines).toHaveLength(1);
    expect(got!.detailSyncedAt).toBe(AT);
  });

  it('lists a job’s orders, and searches by number, reference and supplier', async () => {
    await upsertVendorOrder(order(), AT);
    await upsertVendorOrder(order({ id: '5102', jobId: '1002', reference: 'Pump seals', vendorId: '78', vendorName: 'Fictional Pumps', dateIssued: '2026-08-22' }), AT);
    await upsertVendorOrder(order({ id: '5103', jobId: undefined, reference: 'Stock', archived: true }), AT);
    expect((await listVendorOrdersForJob('1001')).map((o) => o.id)).toEqual(['5101']);
    expect((await searchVendorOrders('pump')).map((o) => o.id)).toEqual(['5102']);
    expect((await searchVendorOrders('#5103')).map((o) => o.id)).toEqual(['5103']);
    expect((await searchVendorOrders('riser', { jobExternalId: '1002' })).map((o) => o.id)).toEqual([]);
    // Newest issued first, archived last.
    expect((await searchVendorOrders('')).map((o) => o.id)).toEqual(['5102', '5101', '5103']);
    // The supplier's own page asks by id, not by the name on the row.
    expect((await searchVendorOrders('', { vendorExternalId: '77' })).map((o) => o.id)).toEqual(['5101', '5103']);
    expect(await countVendorOrders('', { vendorExternalId: '77' })).toBe(2);
  });

  it('picks the open orders in the database, so a page of closed ones cannot hide an open one past it', async () => {
    await upsertVendorOrder(order(), AT);
    await upsertVendorOrder(order({ id: '5102', stage: 'Complete', dateIssued: '2026-08-22' }), AT);
    await upsertVendorOrder(order({ id: '5103', stage: ' CANCELLED ', dateIssued: '2026-08-23' }), AT);
    await upsertVendorOrder(order({ id: '5104', stage: 'Approved', dateIssued: '2026-08-24', archived: true }), AT);
    await upsertVendorOrder(order({ id: '5105', stage: undefined, dateIssued: '2026-08-25' }), AT);
    // The open one is the oldest; a list capped at the newest three would never reach it.
    expect((await searchVendorOrders('', { openOnly: true, limit: 3 })).map((o) => o.id)).toEqual(['5105', '5101']);
    expect((await searchVendorOrders('', { limit: 3 })).map((o) => o.id)).toEqual(['5105', '5103', '5102']);
    // The chip counts come from the same WHERE, past any page.
    expect(await countVendorOrders('')).toBe(5);
    expect(await countVendorOrders('', { openOnly: true })).toBe(2);
    expect(await countVendorOrders('riser', { openOnly: true, jobExternalId: '1001' })).toBe(2);
    expect(await countVendorOrders('', { openOnly: true, vendorExternalId: '78' })).toBe(0);
  });

  it('wants the lines of orders the office changed lately or against a held job, not read since, capped', async () => {
    await upsertJob({ id: 'simpro-1002', externalId: '1002', siteName: 'Fictional Tower', title: 'Pump service', status: 'scheduled' });
    // Changed this week: wanted.
    await upsertVendorOrder(order({ id: '1', DateModified: '2026-09-05T09:00:00+10:00', jobId: '5000' }), AT);
    // Old and not against a held job: not wanted.
    await upsertVendorOrder(order({ id: '2', DateModified: '2026-01-05T09:00:00+10:00', jobId: '5000' }), AT);
    // Old but against a job the phone holds: wanted.
    await upsertVendorOrder(order({ id: '3', DateModified: '2026-01-05T09:00:00+10:00', jobId: '1002' }), AT);
    // Changed this week, read a minute ago: fresh, not wanted.
    await upsertVendorOrder(order({ id: '4', DateModified: '2026-09-06T09:00:00+10:00', jobId: '5000' }), AT);
    await replaceVendorOrderLines('4', [], '2026-09-09T00:29:00.000Z');
    // Read before the office last touched it: wanted again.
    await upsertVendorOrder(order({ id: '5', DateModified: '2026-09-07T09:00:00+10:00', jobId: '5000' }), AT);
    await replaceVendorOrderLines('5', [], '2026-08-01T00:00:00.000Z');
    // Archived: never.
    await upsertVendorOrder(order({ id: '6', DateModified: '2026-09-08T09:00:00+10:00', archived: true }), AT);
    // Touched by the office at nine this morning Brisbane time, which is
    // eleven last night in UTC, and read half an hour after that: not
    // wanted. As text the office's stamp sorts after the read's, which
    // is the comparison that had every morning's orders read again all day.
    await upsertVendorOrder(order({ id: '7', DateModified: '2026-09-09T09:00:00+10:00', jobId: '5000' }), AT);
    await replaceVendorOrderLines('7', [], '2026-09-08T23:30:00.000Z');

    const wanted = await vendorOrdersWantingLines({ modifiedSince: '2026-07-11', freshAfter: '2026-09-09T00:15:00.000Z', limit: 60 });
    expect(wanted).toEqual(['5', '1', '3']);
    expect(await vendorOrdersWantingLines({ modifiedSince: '2026-07-11', freshAfter: '2026-09-09T00:15:00.000Z', limit: 2 })).toEqual(['5', '1']);
  });

  it('prunes what a full pull did not see, lines included', async () => {
    await upsertVendorOrder(order({ id: '5101' }), AT);
    await replaceVendorOrderLines('5101', [{ kind: 'catalog', id: '301', description: 'Detector' }], AT);
    await upsertVendorOrder(order({ id: '5102' }), AT);
    await upsertVendorOrder(order({ id: '5102' }), LATER);
    expect(await pruneVendorOrdersNotSyncedAt(LATER)).toBe(1);
    expect(await getVendorOrder('5101')).toBeNull();
    expect(await db.getFirstAsync('SELECT 1 AS x FROM vendor_order_line WHERE orderExternalId = ?', '5101')).toBeNull();
    expect(await getVendorOrder('5102')).not.toBeNull();
  });
});

describe('suppliers', () => {
  it('round-trips, searches and prunes', async () => {
    await upsertVendor(vendor(), AT);
    await upsertVendor(vendor({ id: '78', name: 'Fictional Pumps', archived: true }), AT);
    expect(await getVendor('77')).toMatchObject({ name: 'Fictional Fire Supplies', address: { suburb: 'Yatala' }, archived: false, syncedAt: AT });
    expect((await searchVendors('pumps')).map((v) => v.id)).toEqual(['78']);
    expect((await searchVendors('fictional')).map((v) => v.id)).toEqual(['77', '78']);
    await upsertVendor(vendor(), LATER);
    expect(await pruneVendorsNotSyncedAt(LATER)).toBe(1);
    expect(await getVendor('78')).toBeNull();
  });
});

describe('the catalogue', () => {
  it('finds a part by number ahead of one by name, within a group, and prunes', async () => {
    await upsertCatalogItem(item(), AT);
    await upsertCatalogItem(item({ id: '302', partNo: 'BASE-OPT', name: 'Base for DET-OPT-1', sellExTaxCents: 1250 }), AT);
    await upsertCatalogItem(item({ id: '303', partNo: 'PUMP-1', name: 'Jacking pump', groupId: '9', groupName: 'Pumps' }), AT);
    expect((await searchCatalogItems('DET-OPT-1')).map((c) => c.id)).toEqual(['301', '302']);
    expect((await searchCatalogItems('opt', { groupId: '7' })).map((c) => c.id)).toEqual(['302', '301']);
    expect((await searchCatalogItems('jacking pump')).map((c) => c.id)).toEqual(['303']);
    // A parent group reaches the parts filed under its children, and a part filed in the parent itself.
    await replaceCatalogGroups([
      { id: '1', name: 'Detection' }, { id: '7', name: 'Detectors', parentId: '1', parentName: 'Detection' },
      { id: '2', name: 'Hydraulics' }, { id: '9', name: 'Pumps', parentId: '2', parentName: 'Hydraulics' },
    ], AT);
    await upsertCatalogItem(item({ id: '304', partNo: 'SND-1', name: 'Sounder', groupId: '1', groupName: 'Detection', parentGroupName: undefined }), AT);
    expect((await searchCatalogItems('', { parentGroupId: '1' })).map((c) => c.id)).toEqual(['302', '301', '304']);
    expect((await searchCatalogItems('', { parentGroupId: '2' })).map((c) => c.id)).toEqual(['303']);
    expect((await searchCatalogItems('opt', { parentGroupId: '2' })).map((c) => c.id)).toEqual([]);
    expect(await getCatalogItem('301')).toMatchObject({ sellExTaxCents: 8495, isInventory: true, parentGroupName: 'Detection' });
    await upsertCatalogItem(item(), LATER);
    // 302, 303 and 304 were not in the later read; the detector was.
    expect(await pruneCatalogItemsNotSyncedAt(LATER)).toBe(3);
  });

  it('replaces the groups whole', async () => {
    await replaceCatalogGroups([{ id: '1', name: 'Detection' }, { id: '7', name: 'Detectors', parentId: '1', parentName: 'Detection' }], AT);
    await replaceCatalogGroups([{ id: '1', name: 'Detection' }, { id: '8', name: 'Bases', parentId: '1', parentName: 'Detection' }], LATER);
    expect((await listCatalogGroups()).map((g) => g.id)).toEqual(['1', '8']);
  });
});

describe('contacts', () => {
  it('finds the people at a site and at a customer by the id inside the list column, exactly', async () => {
    await upsertContact(contact(), AT);
    await upsertContact(contact({ id: '4002', givenName: 'Lee', familyName: 'Park', name: 'Lee Park', sites: [{ id: '30210', name: 'Other Tower' }], customers: [] }), AT);
    await upsertContact(contact({ id: '4003', givenName: 'Ana', familyName: 'Costa', name: 'Ana Costa', sites: [{ id: '3021', name: 'Fictional Tower' }, { id: '5', name: 'Depot' }], customers: [{ id: '8120', name: 'Another' }] }), AT);
    // 3021 must not match 30210.
    expect((await listContactsForSite('3021')).map((c) => c.id)).toEqual(['4003', '4001']);
    expect((await listContactsForCustomer('812')).map((c) => c.id)).toEqual(['4001']);
    expect((await searchContacts('reyes')).map((c) => c.id)).toEqual(['4001']);
    expect((await searchContacts('0400', { siteExternalId: '3021' })).map((c) => c.id)).toEqual(['4003', '4001']);
    expect(await getContact('4001')).toMatchObject({ name: 'Dana Reyes', sites: [{ id: '3021', name: 'Fictional Tower' }] });
    await upsertContact(contact(), LATER);
    expect(await pruneContactsNotSyncedAt(LATER)).toBe(2);
  });
});

describe('leads', () => {
  it('lists by stage and words, newest created first', async () => {
    await upsertLead(lead(), AT);
    await upsertLead(lead({ id: '62', name: 'Sprinkler audit', stage: 'Won', dateCreated: '2026-08-12', customerName: 'Another Owner', siteName: 'Other Tower' }), AT);
    expect((await listLeads()).map((l) => l.id)).toEqual(['62', '61']);
    expect((await listLeads({ stage: 'open' })).map((l) => l.id)).toEqual(['61']);
    expect((await listLeads({ query: 'fictional tower' })).map((l) => l.id)).toEqual(['61']);
    expect(await getLead('61')).toMatchObject({ tags: ['Strata'], customerId: '812' });
    await upsertLead(lead(), LATER);
    expect(await pruneLeadsNotSyncedAt(LATER)).toBe(1);
  });
});

describe('the hours the office holds', () => {
  it('replaces one employee’s window and nothing outside it', async () => {
    await replaceSimproTimesheets({ employeeId: '17', from: '2026-09-01', to: '2026-09-07' }, [hours(), hours({ uid: 'T2', date: '2026-09-03' })], AT);
    // Another employee, and a day outside the window, both untouched by the replace below.
    await replaceSimproTimesheets({ employeeId: '18', from: '2026-09-01', to: '2026-09-07' }, [hours({ uid: 'T9', employeeId: '18' })], AT);
    await replaceSimproTimesheets({ employeeId: '17', from: '2026-08-01', to: '2026-08-07' }, [hours({ uid: 'T0', date: '2026-08-03' })], AT);

    // The office dropped T2 and moved T1's hours.
    await replaceSimproTimesheets({ employeeId: '17', from: '2026-09-01', to: '2026-09-07' }, [hours({ totalHours: 5 })], LATER);
    const mine = await listSimproTimesheets({ employeeId: '17', from: '2026-08-01', to: '2026-09-30' });
    expect(mine.map((t) => [t.uid, t.totalHours])).toEqual([['T0', 4.5], ['T1', 5]]);
    expect((await listSimproTimesheets({ employeeId: '18', from: '2026-09-01', to: '2026-09-07' })).map((t) => t.uid)).toEqual(['T9']);
    expect((await listSimproTimesheetsForJob('1001')).map((t) => t.uid)).toEqual(['T0', 'T1', 'T9']);
  });
});

describe('activities', () => {
  it('lists a window for everyone or one person, and replaces the activity list whole', async () => {
    await upsertActivitySchedule(activity(), AT);
    await upsertActivitySchedule(activity({ id: '89', staffId: '18', staffName: 'Ali Novak', date: '2026-09-16' }), AT);
    await upsertActivitySchedule(activity({ id: '90', date: '2026-10-01' }), AT);
    expect((await listActivitySchedules({ from: '2026-09-01', to: '2026-09-30' })).map((a) => a.id)).toEqual(['88', '89']);
    expect((await listActivitySchedules({ staffId: '17', from: '2026-09-01', to: '2026-12-31' })).map((a) => a.id)).toEqual(['88', '90']);
    expect((await listActivitySchedules({ from: '2026-09-15', to: '2026-09-15' }))[0]!.blocks).toEqual([{ startTime: '07:00', endTime: '15:00', hours: 8, rateName: 'Standard' }]);
    await upsertActivitySchedule(activity(), LATER);
    expect(await pruneActivitySchedulesNotSyncedAt(LATER)).toBe(2);

    await replaceSetupActivities([{ id: '5', name: 'Leave' }, { id: '6', name: 'Workshop' }], AT);
    await replaceSetupActivities([{ id: '5', name: 'Annual leave' }], LATER);
    expect(await listSetupActivities()).toEqual([{ id: '5', name: 'Annual leave' }]);
  });
});

describe('payments', () => {
  it('finds a payment by the invoice it settles and by the customer, invoices replaced whole', async () => {
    await upsertCustomerPayment(payment(), AT);
    await upsertCustomerPayment(payment({ id: '9002', date: '2026-08-30', invoices: [{ invoiceId: '7003', customerId: '900', customerName: 'Someone Else', amountCents: 100 }] }), AT);
    expect((await listPaymentsForInvoice('7002')).map((p) => p.id)).toEqual(['9001']);
    expect((await listPaymentsForCustomer('812')).map((p) => p.id)).toEqual(['9001']);
    expect(await getCustomerPayment('9001')).toMatchObject({ totalCents: 16515, invoices: [{ invoiceId: '7001', amountCents: 11010 }, { invoiceId: '7002', amountCents: 5505 }] });
    // Re-applied to one invoice only.
    await upsertCustomerPayment(payment({ invoices: [{ invoiceId: '7001', customerId: '812', amountCents: 16515 }] }), LATER);
    expect((await listPaymentsForInvoice('7002'))).toEqual([]);
    expect(await pruneCustomerPaymentsNotSyncedAt(LATER)).toBe(1);
    expect(await getCustomerPayment('9002')).toBeNull();
    expect(await db.getFirstAsync('SELECT 1 AS x FROM customer_payment_invoice WHERE paymentExternalId = ?', '9002')).toBeNull();
  });
});

describe('credit notes', () => {
  it('finds a credit note by invoice and by customer, and prunes', async () => {
    await upsertCreditNote(creditNote(), AT);
    await upsertCreditNote(creditNote({ id: '502', invoiceId: '7005', customerId: '900', dateIssued: '2026-09-01' }), AT);
    expect((await listCreditNotesForInvoice('7001')).map((n) => n.id)).toEqual(['501']);
    expect((await listCreditNotesForCustomer('812')).map((n) => n.id)).toEqual(['501']);
    expect(await getCreditNote('501')).toMatchObject({ totalIncTaxCents: 11000, jobs: [{ id: '1001', siteName: 'Fictional Tower' }], status: 'Issued' });
    await upsertCreditNote(creditNote(), LATER);
    expect(await pruneCreditNotesNotSyncedAt(LATER)).toBe(1);
  });
});
