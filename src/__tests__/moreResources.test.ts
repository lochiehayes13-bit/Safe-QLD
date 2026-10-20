import { SimproError, type SimproClient } from '@/simpro/client';
import {
  ACTIVITY_SCHEDULE_LIST_COLUMNS, CATALOG_LIST_COLUMNS, CONTACT_LIST_COLUMNS, CREDIT_NOTE_LIST_COLUMNS,
  CUSTOMER_PAYMENT_LIST_COLUMNS, LEAD_LIST_COLUMNS, MORE_PATHS, SimproMore, VENDOR_LIST_COLUMNS,
  VENDOR_ORDER_LINE_COLUMNS, VENDOR_ORDER_LIST_COLUMNS, addDays, instant, mapActivitySchedule, mapCatalogGroup,
  mapCatalogItem, mapContact, mapCreditNote, mapCustomerPayment, mapLead, mapSetupActivity, mapTimesheetRow,
  mapVendor, mapVendorOrder, mapVendorOrderLine, mergeVendorOrderLines, parseScheduleHref, timesheetWindow,
} from '@/simpro/moreResources';

/**
 * The v23 shapes, mapped from invented fixtures in the build's own shape.
 *
 * Two things matter above the rest. Nothing about cost survives mapping —
 * a purchase order's Totals, a line's Price, a catalogue item's TradePrice,
 * a timesheet row's Cost, a vendor's Banking — however it arrives, because
 * the raw types do not declare those fields and the mappers do not read
 * them; that is checked by name on every mapped object here. And the
 * quantities on a purchase order line come from its allocations, added up,
 * with a thin row leaving them undefined rather than zero.
 */

/**
 * The names that mean money the company paid. A cost centre is Simpro's
 * word for a bucket of work and carries no figure, and a sell price is the
 * one figure that is allowed across; both are let through by name.
 */
const COST = /cost(?!cent)|markup|margin|trade|base|banking|price|profit/i;
const ALLOWED = /costcenter|^sell/i;

/** Every key at every depth of an object. */
function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

const expectNoCostKeys = (mapped: unknown) => {
  const offending = keysDeep(mapped).filter((k) => COST.test(k) && !ALLOWED.test(k));
  expect(offending).toEqual([]);
};

describe('a purchase order', () => {
  const raw = {
    ID: 5101, Type: 'Catalogue', Stage: 'Approved', Status: { ID: 3, Name: 'Sent to supplier' },
    Vendor: { ID: 77, Name: 'Fictional Fire Supplies' },
    AssignedTo: { ID: 9901, CostCenter: { ID: 12, Name: 'Fire Detection' }, Name: 'Fire Detection', Job: 1001, Section: 2001 },
    DateIssued: '2026-08-20', DueDate: null, Reference: 'Riser parts', QuoteNo: 'Q-77',
    VendorNotes: '<p>Deliver to <b>Fictional Tower</b></p>', PrivateNotes: '', CreatedBy: { ID: 4, Name: 'Office Admin', Type: 'employee', TypeId: 4 },
    Archived: false, DateModified: '2026-08-21T09:12:44+10:00',
    // Cost, on the record: never declared, never read.
    Totals: { ExTax: 1234.5, IncTax: 1357.95 }, Freight: { ExTax: 10, IncTax: 11 },
  };

  it('maps the job, section and cost centre out of AssignedTo', () => {
    const o = mapVendorOrder(raw);
    expect(o).toMatchObject({
      id: '5101', orderType: 'Catalogue', stage: 'Approved', statusId: '3', statusName: 'Sent to supplier',
      vendorId: '77', vendorName: 'Fictional Fire Supplies', jobId: '1001', jobSectionId: '2001', jobCostCenterId: '9901',
      assignedToName: 'Fire Detection', reference: 'Riser parts', quoteNo: 'Q-77', dateIssued: '2026-08-20',
      vendorNotes: 'Deliver to Fictional Tower', createdByName: 'Office Admin', archived: false,
      DateModified: '2026-08-21T09:12:44+10:00',
    });
    expect(o.dueDate).toBeUndefined();
    expect(o.privateNotes).toBeUndefined();
  });

  it('carries no total, no freight and nothing else about money', () => {
    const o = mapVendorOrder(raw);
    expectNoCostKeys(o);
    expect(Object.keys(o).some((k) => /total/i.test(k))).toBe(false);
  });

  it('adds a line’s quantities up across its allocations and never reads its price', () => {
    const line = mapVendorOrderLine({
      Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Optical smoke detector' }, DisplayOrder: 1, DueDate: null, Notes: '',
      Allocations: [
        { AssignedTo: { ID: 9901, Job: 1001 }, Quantity: { Received: 4, Total: 6 }, DueDate: '2026-08-28' } as never,
        { AssignedTo: { ID: 9902, Job: 1001 }, Quantity: { Received: 0, Total: 2 } } as never,
      ],
      ...({ Price: 41.5 } as object),
    });
    expect(line).toEqual({
      kind: 'catalog', id: '301', catalogId: '301', partNo: 'DET-OPT-1', description: 'Optical smoke detector',
      qtyOrdered: 8, qtyReceived: 4, dueDate: '2026-08-28',
    });
    expectNoCostKeys(line);
  });

  it('leaves the quantities undefined on a thin row rather than writing zero', () => {
    const line = mapVendorOrderLine({ Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Optical smoke detector' }, DueDate: null, Notes: '' });
    expect(line.qtyOrdered).toBeUndefined();
    expect(line.qtyReceived).toBeUndefined();
  });

  it('folds two lines for the same part into one, since the part is the line’s only key', () => {
    const merged = mergeVendorOrderLines([
      { kind: 'catalog', id: '301', description: 'Detector', qtyOrdered: 2, qtyReceived: 1 },
      { kind: 'catalog', id: '301', description: 'Detector', qtyOrdered: 3 },
      { kind: 'catalog', id: '302', description: 'Base', qtyOrdered: 5, qtyReceived: 5 },
      { kind: 'catalog', id: '', description: 'nothing' },
    ]);
    expect(merged).toEqual([
      { kind: 'catalog', id: '301', description: 'Detector', qtyOrdered: 5, qtyReceived: 1, dueDate: undefined },
      { kind: 'catalog', id: '302', description: 'Base', qtyOrdered: 5, qtyReceived: 5 },
    ]);
  });
});

describe('a supplier', () => {
  it('keeps the contact details and the address and nothing about its bank', () => {
    const v = mapVendor({
      ID: 77, Name: 'Fictional Fire Supplies', Phone: '07 3000 0000', Email: 'orders@example.invalid', Website: 'example.invalid',
      Address: { Address: '1 Depot St', City: 'Yatala', State: 'QLD', PostalCode: '4207', Country: 'Australia' },
      Archived: false, DateModified: '2026-08-01T08:00:00+10:00',
      ...({ Banking: { AccountName: 'x', AccountNo: '1' } } as object),
    });
    expect(v).toMatchObject({ id: '77', name: 'Fictional Fire Supplies', address: { suburb: 'Yatala', postcode: '4207' }, archived: false });
    expectNoCostKeys(v);
  });
});

describe('the catalogue', () => {
  it('maps an item with its sell price in whole cents and no trade price', () => {
    const c = mapCatalogItem({
      ID: 301, PartNo: 'DET-OPT-1', Name: 'Optical smoke detector', Group: { ID: 7, Name: 'Detectors', ParentGroup: { ID: 1, Name: 'Detection' } },
      Archived: false, SellPrice: 84.95, DateModified: '2026-07-01T10:00:00+10:00', Manufacturer: 'Fictional Detectors', UPC: '0000000000000',
      IsInventory: true, IsAsset: false,
      ...({ TradePrice: 40, BasePrice: 38.2, Markup: 120 } as object),
    });
    expect(c).toMatchObject({
      id: '301', partNo: 'DET-OPT-1', name: 'Optical smoke detector', groupId: '7', groupName: 'Detectors', parentGroupName: 'Detection',
      manufacturer: 'Fictional Detectors', sellExTaxCents: 8495, isInventory: true, isAsset: false, archived: false,
    });
    expectNoCostKeys(c);
  });

  it('maps a group and its parent', () => {
    expect(mapCatalogGroup({ ID: 7, Name: 'Detectors', ParentGroup: { ID: 1, Name: 'Detection' } }))
      .toEqual({ id: '7', name: 'Detectors', parentId: '1', parentName: 'Detection' });
    expect(mapCatalogGroup({ ID: 1, Name: 'Detection', ParentGroup: null })).toEqual({ id: '1', name: 'Detection', parentId: undefined, parentName: undefined });
  });
});

describe('a contact', () => {
  it('joins the name and keeps the customers and sites as refs', () => {
    const c = mapContact({
      ID: 4001, Title: 'Ms', GivenName: 'Dana', FamilyName: 'Reyes', Email: 'dana@example.invalid', WorkPhone: '07 3000 0001',
      CellPhone: '0400 000 000', AltPhone: '', Department: 'Facilities', Position: 'Building manager', Notes: 'Call before <b>7am</b>',
      DateModified: '2026-08-02T08:00:00+10:00', Customers: [{ ID: 812, CompanyName: 'Fictional Body Corporate' }], Sites: [{ ID: 3021, Name: 'Fictional Tower' }],
    });
    expect(c).toMatchObject({
      id: '4001', name: 'Dana Reyes', givenName: 'Dana', familyName: 'Reyes', position: 'Building manager', notes: 'Call before 7am',
      customers: [{ id: '812', name: 'Fictional Body Corporate' }], sites: [{ id: '3021', name: 'Fictional Tower' }],
    });
    expect(c.altPhone).toBeUndefined();
  });
});

describe('a lead', () => {
  it('reads the empty objects the build sends for a status or salesperson it does not have', () => {
    const l = mapLead({
      ID: 61, LeadName: 'Upgrade the panel', Customer: { ID: 812, Type: 'Company', CompanyName: 'Fictional Body Corporate' },
      Site: { ID: 3021, Name: 'Fictional Tower' }, Stage: 'Open', Status: {}, FollowUpDate: null, DateCreated: '2026-08-10',
      Description: '<p>Replace the <i>old</i> panel</p>', Notes: '', ProjectManager: { ID: 4, Name: 'Office Admin' }, Salesperson: {},
      Tags: [{ ID: 1, Name: 'Strata' }], DateModified: '2026-08-11T09:00:00+10:00',
      ...({ Forecast: { EstimatedPrice: 1, Probability: 50 } } as object),
    });
    expect(l).toMatchObject({
      id: '61', name: 'Upgrade the panel', customerId: '812', customerName: 'Fictional Body Corporate', siteId: '3021', siteName: 'Fictional Tower',
      stage: 'Open', description: 'Replace the old panel', projectManager: 'Office Admin', tags: ['Strata'],
    });
    expect(l.status).toBeUndefined();
    expect(l.salesperson).toBeUndefined();
    expect(l.followUpDate).toBeUndefined();
    expect(keysDeep(l).some((k) => /forecast|estimatedprice/i.test(k))).toBe(false);
  });
});

describe('an employee’s hours from the office', () => {
  it('reads the job, section and cost centre out of the schedule’s own path', () => {
    expect(parseScheduleHref('/api/v1.0/companies/0/jobs/1001/sections/2001/costCenters/9901/schedules/70001'))
      .toEqual({ jobId: '1001', sectionId: '2001', costCenterId: '9901', scheduleId: '70001' });
    expect(parseScheduleHref('/api/v1.0/companies/0/activitySchedules/5')).toBeUndefined();
    expect(parseScheduleHref(undefined)).toBeUndefined();
  });

  it('maps a job block, and never its cost', () => {
    const t = mapTimesheetRow({
      UID: 'A1B2C3D4E5F6G', ScheduleType: 'Job', Reference: '1001-9901',
      _href: '/api/v1.0/companies/0/jobs/1001/sections/2001/costCenters/9901/schedules/70001',
      Date: '2026-09-02', StartTime: '07:00', EndTime: '11:30', TotalHrs: 4.5, ScheduleRate: { ID: 2, Name: 'Standard' }, EmployeeID: 17,
      ...({ Cost: 180, OverheadCost: 20, TotalCost: 200 } as object),
    });
    expect(t).toEqual({
      uid: 'A1B2C3D4E5F6G', employeeId: '17', scheduleType: 'Job', reference: '1001-9901', jobId: '1001', jobCostCenterId: '9901',
      activityId: undefined, href: '/api/v1.0/companies/0/jobs/1001/sections/2001/costCenters/9901/schedules/70001',
      date: '2026-09-02', startTime: '07:00', endTime: '11:30', totalHours: 4.5, scheduleRateId: '2', scheduleRateName: 'Standard',
    });
    expectNoCostKeys(t);
  });

  it('falls back to splitting the reference when there is no path', () => {
    const t = mapTimesheetRow({ UID: 'X', ScheduleType: 'Job', Reference: '1001-9901', Date: '2026-09-02', EmployeeID: 17 });
    expect(t).toMatchObject({ jobId: '1001', jobCostCenterId: '9901' });
  });

  it('reads an activity block’s reference as the activity', () => {
    const t = mapTimesheetRow({ UID: 'Y', ScheduleType: 'Activity', Reference: 5, Date: '2026-09-03', TotalHrs: 8, EmployeeID: 17 });
    expect(t).toMatchObject({ activityId: '5', totalHours: 8 });
    expect(t.jobId).toBeUndefined();
  });

  it('holds eight weeks back and two ahead on the Queensland calendar', () => {
    // 23:30 UTC on the 8th is the 9th in Brisbane, so the window is built from the 9th.
    expect(timesheetWindow('2026-09-08T23:30:00.000Z')).toEqual({ from: '2026-07-15', to: '2026-09-23' });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('an activity schedule', () => {
  it('keeps the blocks with their hours and rate names', () => {
    const a = mapActivitySchedule({
      ID: 88, TotalHours: 8, Notes: 'Annual leave', IsLocked: false, Staff: { ID: 17, Name: 'Sam Okafor' }, Date: '2026-09-15',
      Blocks: [{ Hrs: 8, StartTime: '07:00', ISO8601StartTime: '2026-09-15T07:00:00+10:00', EndTime: '15:00', ISO8601EndTime: '2026-09-15T15:00:00+10:00', ScheduleRate: { ID: 2, Name: 'Standard' } }],
      DateModified: '2026-08-30T10:00:00+10:00', Activity: { ID: 5, Name: 'Leave' },
    });
    expect(a).toMatchObject({
      id: '88', staffId: '17', staffName: 'Sam Okafor', date: '2026-09-15', totalHours: 8, notes: 'Annual leave', activityId: '5', activityName: 'Leave',
      blocks: [{ startTime: '07:00', endTime: '15:00', hours: 8, rateName: 'Standard' }], isLocked: false,
    });
    expect(mapSetupActivity({ ID: 5, Name: 'Leave' })).toEqual({ id: '5', name: 'Leave' });
  });
});

describe('a payment', () => {
  it('adds up the amounts applied to its invoices, in cents', () => {
    const p = mapCustomerPayment({
      ID: 9001, Payment: { PaymentMethod: { ID: 1, Name: 'EFT' }, Status: 'Cleared', Date: '2026-08-28', CheckNo: '', Details: '' },
      Notes: '', Exported: true, DateModified: '2026-08-28T15:00:00+10:00',
      Invoices: [
        { Invoice: { ID: 7001, Customer: { ID: 812, Type: 'Company', CompanyName: 'Fictional Body Corporate' } }, Amount: 110.1 },
        { Invoice: { ID: 7002, Customer: { ID: 812, Type: 'Company', CompanyName: 'Fictional Body Corporate' } }, Amount: 55.05 },
      ],
    });
    expect(p).toMatchObject({
      id: '9001', paymentMethod: 'EFT', status: 'Cleared', date: '2026-08-28', exported: true, totalCents: 16515,
      invoices: [
        { invoiceId: '7001', customerId: '812', customerName: 'Fictional Body Corporate', amountCents: 11010 },
        { invoiceId: '7002', customerId: '812', customerName: 'Fictional Body Corporate', amountCents: 5505 },
      ],
    });
    expect(p.notes).toBeUndefined();
  });

  it('has no total where no amount was applied', () => {
    expect(mapCustomerPayment({ ID: 9002, Invoices: [] }).totalCents).toBeUndefined();
  });
});

describe('a credit note', () => {
  it('keeps the sell-side total and the jobs it credits', () => {
    const n = mapCreditNote({
      ID: 501, Type: 'Refund', Customer: { ID: 812, CompanyName: 'Fictional Body Corporate' }, InvoiceNo: 7001,
      Jobs: [{ ID: 1001, Site: { ID: 3021, Name: 'Fictional Tower' } }], DateIssued: '2026-08-29', Stage: 'Approved',
      Status: { ID: 2, Name: 'Issued' }, OrderNo: 'PO-1', Description: '<p>Credit for the <b>callout</b></p>', Notes: '',
      Total: { ExTax: 100, Tax: 10, IncTax: 110 }, DateModified: '2026-08-29T09:00:00+10:00',
    });
    expect(n).toMatchObject({
      id: '501', creditType: 'Refund', invoiceId: '7001', customerId: '812', customerName: 'Fictional Body Corporate', stage: 'Approved',
      status: 'Issued', dateIssued: '2026-08-29', orderNo: 'PO-1', description: 'Credit for the callout',
      totalExTaxCents: 10000, totalIncTaxCents: 11000, jobs: [{ id: '1001', siteName: 'Fictional Tower' }],
    });
    expectNoCostKeys(n);
  });
});

describe('instants', () => {
  it('normalises the space-and-two-digit-offset form and leaves ISO alone', () => {
    expect(instant('2026-08-30 09:12:44+10')).toBe('2026-08-30T09:12:44+10:00');
    expect(instant('2026-08-30T09:12:44+10:00')).toBe('2026-08-30T09:12:44+10:00');
    expect(instant('2026-08-30')).toBe('2026-08-30');
    expect(instant('')).toBeUndefined();
  });
});

describe('paths and column sets', () => {
  it('give a collection a trailing slash and a record none', () => {
    expect(MORE_PATHS.vendorOrders()).toBe('vendorOrders/');
    expect(MORE_PATHS.vendorOrder('5101')).toBe('vendorOrders/5101');
    expect(MORE_PATHS.vendorOrderCatalogs('5101')).toBe('vendorOrders/5101/catalogs/');
    expect(MORE_PATHS.setupActivities()).toBe('setup/activities/');
    expect(MORE_PATHS.creditNote('501')).toBe('creditNotes/501');
  });

  it('ask for no column that names a cost, and always for the id', () => {
    const sets = [
      VENDOR_ORDER_LIST_COLUMNS, VENDOR_LIST_COLUMNS, CATALOG_LIST_COLUMNS, CONTACT_LIST_COLUMNS, LEAD_LIST_COLUMNS,
      ACTIVITY_SCHEDULE_LIST_COLUMNS, CUSTOMER_PAYMENT_LIST_COLUMNS, CREDIT_NOTE_LIST_COLUMNS,
    ];
    for (const set of sets) {
      expect(set.split(',')).toContain('ID');
      expect(set.split(',').filter((c) => /Cost|Markup|Margin|Totals|TradePrice|BasePrice|Banking|Price/.test(c) && c !== 'SellPrice')).toEqual([]);
    }
    // The line list has no ID column to ask for; it asks for the quantities and not the price.
    expect(VENDOR_ORDER_LINE_COLUMNS.split(',')).toContain('Allocations');
    expect(VENDOR_ORDER_LINE_COLUMNS.split(',')).not.toContain('Price');
  });
});

// ---------------------------------------------------------------------------
// The reads, against a scripted client.
// ---------------------------------------------------------------------------

interface Call { path: string; query: Record<string, string | number> }

function fakeClient(handler: (path: string, query: Record<string, string | number>) => unknown[]): { client: SimproClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async listAllPaged<T>(path: string, query: Record<string, string | number> = {}) {
      calls.push({ path, query });
      return { items: handler(path, query) as T[], truncated: false };
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

describe('SimproMore', () => {
  it('reads a list newest change first with its column set', async () => {
    const { client, calls } = fakeClient(() => [{ ID: 77, Name: 'Fictional Fire Supplies' }]);
    const read = await new SimproMore(client).vendorsPaged({ DateModified: 'gt(2026-08-01)' });
    expect(read.items[0]).toMatchObject({ id: '77', name: 'Fictional Fire Supplies' });
    expect(calls[0]).toEqual({ path: 'vendors/', query: { columns: VENDOR_LIST_COLUMNS, orderby: '-DateModified', DateModified: 'gt(2026-08-01)' } });
  });

  it('falls back to the thin list on a refused column set and says so in the server’s words', async () => {
    const { client, calls } = fakeClient((_path, query) => {
      if (query.columns) throw new SimproError('Simpro returned HTTP 422. Invalid columns found. Sites', 422);
      return [{ ID: 4001, GivenName: 'Dana', FamilyName: 'Reyes' }];
    });
    const read = await new SimproMore(client).contactsPaged();
    expect(read.items[0]).toMatchObject({ id: '4001', name: 'Dana Reyes' });
    expect(read.columnsRejected).toMatch(/Invalid columns/);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.query.columns).toBeUndefined();
  });

  it('does not swallow any other failure as a column refusal', async () => {
    const { client } = fakeClient(() => { throw new SimproError('No permission', 403); });
    await expect(new SimproMore(client).leadsPaged()).rejects.toThrow(/No permission/);
  });

  it('reads one employee’s hours in one request with the window the build understands', async () => {
    // timesheets/ ignores paging and answers the whole window every time, so
    // a paged read would take the same rows twice. It is asked once, with
    // StartDate and EndDate, which are the two names the build honours.
    const { client, calls } = fakeClient(() => [
      { UID: 'A', ScheduleType: 'Job', Reference: '1001-9901', Date: '2026-09-02', TotalHrs: 4, EmployeeID: 17 },
      { UID: '', Date: '2026-09-02' },
    ]);
    const rows = await new SimproMore(client).timesheets({ employeeId: '17', from: '2026-07-15', to: '2026-09-23' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uid: 'A', jobId: '1001', jobCostCenterId: '9901' });
    expect(calls).toEqual([{ path: 'timesheets/', query: { EmployeeID: '17', StartDate: '2026-07-15', EndDate: '2026-09-23' } }]);
  });

  it('reads an order’s lines with the quantities column and folds them by part', async () => {
    const { client, calls } = fakeClient(() => [
      { Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Detector' }, Allocations: [{ Quantity: { Received: 1, Total: 2 } }] },
      { Catalog: { ID: 301, PartNo: 'DET-OPT-1', Name: 'Detector' }, Allocations: [{ Quantity: { Received: 0, Total: 3 } }] },
    ]);
    const read = await new SimproMore(client).vendorOrderLines('5101');
    expect(read.items).toEqual([{ kind: 'catalog', id: '301', catalogId: '301', partNo: 'DET-OPT-1', description: 'Detector', qtyOrdered: 5, qtyReceived: 1, dueDate: undefined }]);
    expect(calls[0]).toEqual({ path: 'vendorOrders/5101/catalogs/', query: { columns: VENDOR_ORDER_LINE_COLUMNS } });
  });
});
