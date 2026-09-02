import {
  cents, customerDisplayName, mapAttachment, mapCustomer, mapInvoice, mapItem, mapJobDetail, mapJobRow, mapNote,
  mapQuoteDetail, mapQuoteRow, mapSection, mapCostCenter, mapSiteDetail, mapTask, mapTimeline,
  type RawCompany, type RawInvoice, type RawJobDetail, type RawJobRow, type RawQuoteDetail,
} from '@/simpro/mirrorResources';

/**
 * The mirror's mappers, against fixtures in the shapes the live build returns.
 *
 * Every fixture is invented — names, numbers, addresses — but each is in the
 * exact shape probed on the build, including the parts that must never
 * reach the phone: the `Totals` block on a job and a quote, `BasePrice` and
 * `Markup` on a catalog line, `Rates`, `Banking` and `AmountOwing` on a
 * customer. The mappers are typed not to see those fields; this is the
 * check that nothing leaks through anyway, by looking at the output for
 * their names.
 */

/** Anything in the output that names a cost, a markup, a margin or a bank is a leak. */
const FORBIDDEN = /Totals|BasePrice|Markup|Margin|MaterialsCost|ResourcesCost|Profit|Banking|AmountOwing|"Rates"|AccountNo|RoutingNo|CreditLimit/;

const money = { ExTax: 1523.5, Tax: 152.35, IncTax: 1675.85 };
const costBlock = {
  MaterialsCost: { Actual: 400, Committed: 0, Estimate: 380, Revised: 0, Revized: 0 },
  ResourcesCost: { Total: { Actual: 300 }, Labor: { Actual: 300 }, LaborHours: { Actual: 3.5 } },
  MaterialsMarkup: { Actual: 25 },
  GrossProfitLoss: { Actual: 800 },
  GrossMargin: { Actual: 52.5 },
  NettMargin: { Actual: 31 },
  InvoicedValue: 0,
};

const jobRow = (): RawJobRow => ({
  ID: 43747,
  Name: 'Six monthly routine',
  Description: '<div style="font-size: 10pt;">Six monthly service.</div><div><strong>Access:</strong> key in lockbox</div>',
  Customer: { ID: 812, Type: 'Company', CompanyName: 'Harbourline Body Corporate', GivenName: '', FamilyName: '' },
  Site: { ID: 3021, Name: 'Harbourline Apartments' },
  SiteContact: { ID: 55, GivenName: 'Dana', FamilyName: 'Reyes', Email: 'dana@example.invalid' },
  Stage: 'Progress',
  Status: { ID: 4, Name: 'In Progress', Color: '#f5a623' },
  Type: 'Service',
  DateIssued: '2026-08-28',
  DueDate: null,
  OrderNo: 'PO-7781',
  RequestNo: 'RQ-12',
  Tags: [],
  Total: money,
  DateModified: '2026-08-30T09:12:44+10:00',
  ProjectManager: null,
  Technicians: [{ ID: 12, Name: 'Sam Okafor', Type: 'employee', TypeId: 12 }, { ID: 15, Name: 'Lee Tran', Type: 'employee', TypeId: 15 }],
  CompletedDate: null,
  ConvertedFromQuote: 990,
});

describe('a job row', () => {
  it('maps the verified column set', () => {
    const j = mapJobRow(jobRow());
    expect(j).toMatchObject({
      DateModified: '2026-08-30T09:12:44+10:00',
      id: '43747',
      title: 'Six monthly routine',
      description: 'Six monthly service.\nAccess: key in lockbox',
      customerId: '812',
      customerName: 'Harbourline Body Corporate',
      customerType: 'Company',
      siteId: '3021',
      siteName: 'Harbourline Apartments',
      siteContact: { id: '55', name: 'Dana Reyes', email: 'dana@example.invalid' },
      stage: 'Progress',
      status: 'In Progress',
      statusColor: '#f5a623',
      issuedAt: '2026-08-28',
      dueAt: undefined,
      type: 'Service',
      orderNo: 'PO-7781',
      requestNo: 'RQ-12',
      tags: [],
      technicians: [{ id: '12', name: 'Sam Okafor' }, { id: '15', name: 'Lee Tran' }],
      totalExTaxCents: 152350,
      totalIncTaxCents: 167585,
      completedDate: undefined,
      convertedFromQuoteId: '990',
    });
  });

  it('falls back to the description for a title and reads a person customer by name', () => {
    const j = mapJobRow({ ...jobRow(), Name: '', Customer: { ID: 9, Type: 'Individual', GivenName: 'Ari', FamilyName: 'Nolan' } });
    expect(j.title).toBe('Six monthly service.');
    expect(j.customerName).toBe('Ari Nolan');
    expect(customerDisplayName(undefined)).toBeUndefined();
  });

  it('reads a quote link given as an object', () => {
    expect(mapJobRow({ ...jobRow(), ConvertedFromQuote: { ID: 77 } }).convertedFromQuoteId).toBe('77');
    expect(mapJobRow({ ...jobRow(), ConvertedFromQuote: null }).convertedFromQuoteId).toBeUndefined();
  });
});

describe('a job record', () => {
  const detail: RawJobDetail & { Totals: unknown } = {
    ...jobRow(),
    Notes: '<div>Panel is on level 1.<br>Ask for Dana.</div>',
    CustomerContract: { ID: 31, Name: 'Harbourline annual', ContractNo: 'C-31', StartDate: '2026-01-01', EndDate: '2026-12-31' },
    CustomerContact: { ID: 60, GivenName: 'Pat', FamilyName: 'Singh', Email: 'pat@example.invalid' },
    Technician: { ID: 12, Name: 'Sam Okafor', Type: 'employee', TypeId: 12 },
    Salesperson: null,
    DueTime: null,
    IsVariation: false,
    Totals: costBlock,
  };

  it('adds the notes, the contract and the contact', () => {
    const j = mapJobDetail(detail);
    expect(j.notes).toBe('Panel is on level 1.\nAsk for Dana.');
    expect(j.customerContract).toEqual({ id: '31', name: 'Harbourline annual', contractNo: 'C-31', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(j.customerContact).toMatchObject({ id: '60', name: 'Pat Singh' });
    expect(j.technician).toEqual({ id: '12', name: 'Sam Okafor' });
    expect(j.isVariation).toBe(false);
  });

  it('drops the Totals block whole — cost and margin never reach the phone', () => {
    const out = JSON.stringify(mapJobDetail(detail));
    expect(out).not.toMatch(FORBIDDEN);
    expect(out).toContain('152350');
  });
});

describe('sections, cost centres and lines', () => {
  it('maps a catalog line without its base price or markup', () => {
    const line = mapItem('catalog', {
      ID: 501,
      Catalog: { ID: 9001, PartNo: 'SD-OPT-01', Name: 'Optical smoke detector' },
      BillableStatus: 'Billable',
      BasePrice: 41.2,
      Markup: 35,
      Discount: 0,
      SellPrice: { ExTax: 55.62, IncTax: 61.18, ExDiscountExTax: 55.62, ExDiscountIncTax: 61.18 },
      Total: { Qty: 3, Amount: { ExTax: 166.86, IncTax: 183.55 } },
    } as Parameters<typeof mapItem>[1]);
    expect(line).toEqual({
      id: '501',
      kind: 'catalog',
      description: 'Optical smoke detector',
      partNo: 'SD-OPT-01',
      catalogId: '9001',
      qty: 3,
      unitSellExTaxCents: 5562,
      unitSellIncTaxCents: 6118,
      sellExTaxCents: 16686,
      sellIncTaxCents: 18355,
      billableStatus: 'Billable',
      discountPercent: 0,
    });
    expect(JSON.stringify(line)).not.toMatch(FORBIDDEN);
  });

  it('maps the other four families from where each keeps its name', () => {
    const base = { SellPrice: { ExTax: 10, IncTax: 11 }, Total: { Qty: 2, Amount: { ExTax: 20, IncTax: 22 } } };
    expect(mapItem('oneOff', { ID: 1, Type: 'Labor', Description: 'Site attendance', ...base })).toMatchObject({
      kind: 'oneOff', description: 'Site attendance', qty: 2, sellExTaxCents: 2000,
    });
    expect(mapItem('labor', { ID: 2, LaborRate: { ID: 3, Name: 'Standard hourly' }, ...base })).toMatchObject({
      kind: 'labor', description: 'Standard hourly', qty: 2,
    });
    expect(mapItem('prebuild', { ID: 3, Prebuild: { ID: 4, PartNo: 'PB-9', Name: 'Detector replacement kit' }, ...base })).toMatchObject({
      kind: 'prebuild', description: 'Detector replacement kit', partNo: 'PB-9', catalogId: '4',
    });
    expect(mapItem('serviceFee', { ID: 4, ServiceFee: { ID: 5, Name: 'Call-out' }, ...base })).toMatchObject({
      kind: 'serviceFee', description: 'Call-out',
    });
    // A line with nothing to name it still maps rather than throwing.
    expect(mapItem('oneOff', {})).toMatchObject({ id: '', description: '', qty: 0 });
  });

  it('maps a section and a cost centre with the sell total only', () => {
    const cc = mapCostCenter({
      ID: 77, CostCenter: { ID: 3, Name: 'Fire Service' }, JobID: 43747, Name: 'Fire Service', DisplayOrder: 1,
      Total: { ExTax: 500, Tax: 50, IncTax: 550, TaxCode: { ID: 1, Code: 'GST', Type: 'Sales', Rate: 10 } },
      Claimed: null, PercentComplete: 40,
    } as Parameters<typeof mapCostCenter>[0], [mapItem('oneOff', { ID: 1, Description: 'x' })]);
    expect(cc).toMatchObject({
      id: '77', name: 'Fire Service', setupCostCenterId: '3', setupCostCenterName: 'Fire Service',
      displayOrder: 1, totalExTaxCents: 50000, totalIncTaxCents: 55000, percentComplete: 40,
    });
    expect(cc.items).toHaveLength(1);
    const s = mapSection({ ID: 5, Name: 'Section 1', Description: '', DisplayOrder: 0 }, [cc]);
    expect(s).toMatchObject({ id: '5', name: 'Section 1', description: undefined, displayOrder: 0 });
    expect(s.costCenters[0]?.id).toBe('77');
  });
});

describe('notes, attachments, the timeline and tasks', () => {
  it('maps a note with its visibility and reference', () => {
    expect(mapNote({
      ID: 12, Subject: 'Access', Note: '<p>Key in lockbox</p>', Visibility: { Customer: false, Admin: true },
      Reference: { Type: 'Job', Number: '43747', Text: 'Job 43747' }, DateCreated: '2026-08-29T08:00:00+10:00',
      CreatedBy: { ID: 12, Name: 'Sam Okafor', Type: 'employee', TypeId: 12 },
    })).toEqual({
      id: '12', subject: 'Access', note: 'Key in lockbox', createdAt: '2026-08-29T08:00:00+10:00', createdBy: 'Sam Okafor',
      visibleToCustomer: false, referenceType: 'Job', referenceNumber: '43747',
    });
    expect(mapNote({ ID: 1 }).visibleToCustomer).toBeUndefined();
  });

  it('maps an attachment from the thin list and from the record', () => {
    expect(mapAttachment({ ID: 'a1b2', Filename: 'panel.jpg' })).toMatchObject({ id: 'a1b2', filename: 'panel.jpg', mimeType: undefined });
    expect(mapAttachment({
      ID: 'a1b2', Filename: 'panel.jpg', Folder: null, Public: true, Email: false, MimeType: 'image/jpeg', FileSizeBytes: 20480,
      DateAdded: '2026-08-29 08:00:00+10', AddedBy: { ID: 12, Name: 'Sam Okafor', Type: 'employee', TypeId: 12 }, Base64Data: 'AAAA',
    })).toEqual({
      id: 'a1b2', filename: 'panel.jpg', folder: undefined, mimeType: 'image/jpeg', sizeBytes: 20480,
      dateAdded: '2026-08-29 08:00:00+10', addedBy: 'Sam Okafor', public: true, base64Data: 'AAAA',
    });
  });

  it('maps the activity feed', () => {
    expect(mapTimeline({
      Type: 'Mobile Status', Message: 'Status changed to <b>In Progress</b>',
      Staff: { ID: 12, Name: 'Sam Okafor', Type: 'employee', TypeId: 12 }, Date: '2026-08-30T07:31:00+10:00',
    })).toEqual({ type: 'Mobile Status', message: 'Status changed to In Progress', staffId: '12', staffName: 'Sam Okafor', at: '2026-08-30T07:31:00+10:00' });
  });

  it('maps a task, reading the percentage the build sends as a string', () => {
    expect(mapTask({
      ID: 3, Subject: 'Chase PO', AssignedTo: { ID: 2, Name: 'Office', Type: 'employee', TypeId: 2 },
      Assignees: [{ ID: 2, Name: 'Office' }, { ID: 12, Name: 'Sam Okafor' }], CompletedBy: null,
      DueDate: '2026-09-05', PercentComplete: '', CreatedDate: '2026-08-30',
    })).toEqual({
      id: '3', subject: 'Chase PO', assignedTo: 'Office', assignees: ['Office', 'Sam Okafor'], completedBy: undefined,
      dueDate: '2026-09-05', percentComplete: undefined, createdDate: '2026-08-30',
    });
  });
});

describe('a quote', () => {
  const quote = (): RawQuoteDetail & { Totals: unknown } => ({
    ID: 990,
    Name: 'Detector replacement L2',
    Description: '<div>Replace 12 detectors</div>',
    Customer: { ID: 812, Type: 'Company', CompanyName: 'Harbourline Body Corporate' },
    CustomerContract: { ID: 31, Name: 'Harbourline annual', ContractNo: 'C-31', StartDate: '2026-01-01', EndDate: '2026-12-31' },
    CustomerContact: { ID: 60, GivenName: 'Pat', FamilyName: 'Singh', Email: 'pat@example.invalid' },
    Site: { ID: 3021, Name: 'Harbourline Apartments' },
    SiteContact: null,
    Notes: '',
    Type: 'Service',
    Salesperson: { ID: 2, Name: 'Jo Marsh', Type: 'employee', TypeId: 2 },
    ProjectManager: null,
    Technicians: [],
    DateIssued: '2026-08-01',
    DateApproved: '',
    DueDate: null,
    ValidityDays: 30,
    OrderNo: '',
    RequestNo: '',
    IsClosed: false,
    Stage: 'InProgress',
    CustomerStage: 'Pending',
    JobNo: null,
    LinkedJobID: null,
    Total: { ExTax: 2400, Tax: 240, IncTax: 2640 },
    Totals: costBlock,
    Status: { ID: 7, Name: 'Quote : Sent', Color: '#2a9d8f' },
    Tags: [],
    DateModified: '2026-08-02T10:00:00+10:00',
  });

  it('maps the list row and the record, dropping Totals', () => {
    const row = mapQuoteRow(quote());
    expect(row).toMatchObject({
      id: '990', name: 'Detector replacement L2', description: 'Replace 12 detectors', customerId: '812',
      siteId: '3021', stage: 'InProgress', customerStage: 'Pending', status: 'Quote : Sent', statusColor: '#2a9d8f',
      dateIssued: '2026-08-01', dateApproved: undefined, validityDays: 30, isClosed: false, jobId: undefined,
      totalExTaxCents: 240000, totalIncTaxCents: 264000, salesperson: 'Jo Marsh', technicians: [], tags: [],
    });
    const detail = mapQuoteDetail(quote());
    expect(detail.customerContract?.contractNo).toBe('C-31');
    expect(detail.customerContact?.name).toBe('Pat Singh');
    expect(detail.notes).toBeUndefined();
    expect(JSON.stringify(detail)).not.toMatch(FORBIDDEN);
  });

  it('reads the job a converted quote became from either field', () => {
    expect(mapQuoteRow({ ...quote(), JobNo: 43747 }).jobId).toBe('43747');
    expect(mapQuoteDetail({ ...quote(), LinkedJobID: 43748 }).jobId).toBe('43748');
  });
});

describe('an invoice', () => {
  const invoice = (): RawInvoice => ({
    ID: 7001,
    Type: 'TaxInvoice',
    Customer: { ID: 812, Type: 'Company', CompanyName: 'Harbourline Body Corporate' },
    Jobs: [{ ID: 43747, Type: 'Service', Description: 'Six monthly', Total: { ExTax: 1523.5, Tax: 152.35, IncTax: 1675.85 } }],
    DateIssued: '2026-08-31',
    Period: { StartDate: '2026-08-01', EndDate: '2026-08-31' },
    PaymentTerms: { Days: 30, Type: 'Days', DueDate: '2026-09-30' },
    Stage: 'Approved',
    Status: { ID: 3, Name: 'Invoice : Sent' },
    Description: '',
    Notes: 'Thank you',
    OrderNo: 'PO-7781',
    Total: { ExTax: 1523.5, IncTax: 1675.85, Tax: 152.35, AmountApplied: 0, BalanceDue: 1675.85 },
    IsPaid: false,
    DatePaid: '',
    DateModified: '2026-08-31T16:00:00+10:00',
  });

  it('maps the list columns, the balance and the jobs it bills', () => {
    expect(mapInvoice(invoice())).toEqual({
      DateModified: '2026-08-31T16:00:00+10:00',
      id: '7001', type: 'TaxInvoice', customerId: '812', customerName: 'Harbourline Body Corporate',
      jobs: [{ id: '43747', type: 'Service', description: 'Six monthly', totalExTaxCents: 152350, totalIncTaxCents: 167585 }],
      dateIssued: '2026-08-31', stage: 'Approved', status: 'Invoice : Sent', isPaid: false, datePaid: undefined,
      dueDate: '2026-09-30', orderNo: 'PO-7781', description: undefined, notes: 'Thank you',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      totalExTaxCents: 152350, totalIncTaxCents: 167585, amountAppliedCents: 0, balanceDueCents: 167585,
    });
  });
});

describe('a customer company', () => {
  const company = (): RawCompany & { Rates: unknown; Banking: unknown; AmountOwing: number } => ({
    ID: 812,
    Type: 'Company',
    CompanyName: 'Harbourline Body Corporate',
    Phone: '07 3000 0000',
    AltPhone: '',
    Address: { Address: '1 Quay St', City: 'Brisbane', State: 'QLD', PostalCode: '4000', Country: 'Australia' },
    BillingAddress: { Address: 'PO Box 9', City: 'Brisbane', State: 'QLD', PostalCode: '4001', Country: 'Australia' },
    CustomerType: 'Body Corporate',
    Tags: [{ ID: 1, Name: 'Strata' }],
    AmountOwing: 1675.85,
    Rates: { DiscountFee: 0, ServiceFee: { ID: 1, Name: 'Standard' }, Material: { PricingTier: { ID: 1, Name: 'Tier 1', DefaultMarkup: 35 }, Markup: 35 } },
    Profile: { Notes: '<p>Call before attending</p>', CustomerGroup: { ID: 4, Name: 'Strata' } },
    Banking: { AccountName: 'x', RoutingNo: '000-000', AccountNo: '000000', PaymentTerms: { Days: 30, Type: 'Days' }, CreditLimit: 5000, OnStop: false },
    Archived: false,
    Sites: [{ ID: 3021, Name: 'Harbourline Apartments' }],
    Contacts: [{ ID: 60, GivenName: 'Pat', FamilyName: 'Singh', Email: 'pat@example.invalid', WorkPhone: '', CellPhone: '0400 000 000', Position: 'Manager' }],
    Email: 'office@example.invalid',
    DateModified: '2026-07-10T09:00:00+10:00',
  });

  it('maps the record and drops Rates, Banking and AmountOwing', () => {
    const c = mapCustomer(company());
    expect(c).toMatchObject({
      id: '812', type: 'Company', name: 'Harbourline Body Corporate', phone: '07 3000 0000', altPhone: undefined,
      email: 'office@example.invalid',
      address: { address: '1 Quay St', suburb: 'Brisbane', state: 'QLD', postcode: '4000', country: 'Australia' },
      billingAddress: { address: 'PO Box 9', suburb: 'Brisbane', state: 'QLD', postcode: '4001', country: 'Australia' },
      customerType: 'Body Corporate', customerGroup: 'Strata', archived: false, notes: 'Call before attending',
      tags: ['Strata'], sites: [{ id: '3021', name: 'Harbourline Apartments' }],
      contacts: [{ id: '60', name: 'Pat Singh', email: 'pat@example.invalid', mobile: '0400 000 000', position: 'Manager' }],
      DateModified: '2026-07-10T09:00:00+10:00',
    });
    expect(JSON.stringify(c)).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(c)).not.toContain('1675.85');
  });

  it('maps an individual by given and family name', () => {
    const c = mapCustomer({ ID: 3, Type: 'Individual', GivenName: 'Ari', FamilyName: 'Nolan' });
    expect(c).toMatchObject({ id: '3', type: 'Individual', name: 'Ari Nolan', sites: [], contacts: [], archived: false });
  });
});

describe('a site record', () => {
  it('adds the notes, the zone and the customers the list does not carry', () => {
    expect(mapSiteDetail({
      ID: 3021, Name: 'Harbourline Apartments',
      Address: { Address: '1 Quay St', City: 'Brisbane', State: 'QLD', PostalCode: '4000', Country: 'Australia' },
      PrimaryContact: { Title: 'Ms', GivenName: 'Dana', FamilyName: 'Reyes', Email: 'dana@example.invalid', WorkPhone: '07 3000 0001', CellPhone: '', Position: 'Manager' },
      PublicNotes: 'Park in visitor bay 3', PrivateNotes: '<b>Gate code</b> 1234', Zone: null,
      Customers: [{ ID: 812, Type: 'Company', CompanyName: 'Harbourline Body Corporate' }],
      Archived: false, DateModified: '2026-07-10T09:00:00+10:00',
    })).toEqual({
      DateModified: '2026-07-10T09:00:00+10:00',
      id: '3021', name: 'Harbourline Apartments',
      address: { address: '1 Quay St', suburb: 'Brisbane', state: 'QLD', postcode: '4000', country: 'Australia' },
      primaryContact: { id: undefined, name: 'Dana Reyes', email: 'dana@example.invalid', workPhone: '07 3000 0001', mobile: undefined, position: 'Manager' },
      publicNotes: 'Park in visitor bay 3', privateNotes: 'Gate code 1234', zone: undefined,
      customers: [{ id: '812', name: 'Harbourline Body Corporate', type: 'Company' }],
      archived: false,
    });
  });
});

describe('cents', () => {
  it('rounds the floats the build sends and reads a quoted number', () => {
    expect(cents(27.290000000000003)).toBe(2729);
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents('1,523.50')).toBe(152350);
    expect(cents(0)).toBe(0);
    expect(cents(null)).toBeUndefined();
    expect(cents('')).toBeUndefined();
    expect(cents('n/a')).toBeUndefined();
  });
});
