import {
  ATTACHMENT_LIST_COLUMNS, COMPANY_LIST_COLUMNS, INDIVIDUAL_LIST_COLUMNS,
  INVOICE_LIST_COLUMNS, JOB_LIST_COLUMNS, QUOTE_LIST_COLUMNS, TASK_LIST_COLUMNS,
} from '@/simpro/mirrorResources';
import {
  ACTIVITY_SCHEDULE_LIST_COLUMNS, CATALOG_GROUP_LIST_COLUMNS, CATALOG_LIST_COLUMNS, CONTACT_LIST_COLUMNS,
  CREDIT_NOTE_LIST_COLUMNS, CUSTOMER_PAYMENT_LIST_COLUMNS, LEAD_LIST_COLUMNS, SETUP_ACTIVITY_LIST_COLUMNS,
  VENDOR_LIST_COLUMNS, VENDOR_ORDER_LINE_COLUMNS, VENDOR_ORDER_LIST_COLUMNS,
} from '@/simpro/moreResources';
import { SCHEDULE_COLUMNS } from '@/simpro/resources';

/**
 * The column sets, pinned to what the office build was verified to accept.
 *
 * A `columns=` list is the one part of this app that cannot be checked by
 * reasoning about it. Simpro answers a name it does not know with
 *
 *   422 {"errors":[{"path":null,"message":"Invalid columns found.","value":"Job"}]}
 *
 * and refuses the whole request — so one wrong name does not degrade a
 * stage, it deletes it. Twice now a stage has been lost that way: `Email`
 * and `Phone` on employees, and `Job` on schedules, which took the diary
 * with it and, through it, the home screen's day and the job records the
 * sync reads ahead.
 *
 * Every list below was sent to the real build and answered 200. That is what
 * this test holds still. It will fail on any edit to a column set, which is
 * the point: the edit is fine, it just has to be run against the build
 * before the constant changes. `SAFEQLD_LIVE=<credentials> npx jest
 * src/__tests__/liveSync.test.ts` is the run that does it.
 *
 * Verified 3 September 2026 against safeqld.simprosuite.com, company 0;
 * the v23 sets (purchase orders and their lines, suppliers, the catalogue
 * and its groups, contacts, leads, activity schedules, the activity list,
 * payments and credit notes) verified 9 September 2026 against the same
 * build, each sent with pageSize=1 and answered 200, and each list also
 * seen to honour orderby=-DateModified and DateModified=gt(day) except the
 * two with no DateModified, catalogGroups and setup/activities.
 */

const VERIFIED: Record<string, string> = {
  jobs: 'ID,Name,Description,Customer,Site,SiteContact,Stage,Status,Type,DateIssued,DueDate,OrderNo,'
    + 'RequestNo,Tags,Total,DateModified,ProjectManager,Technicians,CompletedDate,ConvertedFromQuote',
  quotes: 'ID,Name,Description,Customer,Site,SiteContact,Stage,CustomerStage,Status,Type,DateIssued,'
    + 'DateApproved,DueDate,ValidityDays,OrderNo,RequestNo,IsClosed,JobNo,Total,DateModified,'
    + 'Technicians,Salesperson,ProjectManager,Tags',
  invoices: 'ID,Type,Customer,Jobs,DateIssued,Stage,Status,IsPaid,DatePaid,Total,DateModified,OrderNo',
  companies: 'ID,CompanyName,Phone,Email,Address,CustomerType,Archived,DateModified,Sites',
  individuals: 'ID,GivenName,FamilyName,Phone,Email,Address,CustomerType,Archived,DateModified,Sites',
  tasks: 'ID,Subject,AssignedTo,Assignees,CompletedBy,DueDate,PercentComplete,CreatedDate',
  attachments: 'ID,Filename,Folder,Public,MimeType,FileSizeBytes,DateAdded,AddedBy',
  schedules: 'ID,Type,Reference,Staff,Date,Blocks,Project',
  vendorOrders: 'ID,Type,Stage,Status,Vendor,AssignedTo,DateIssued,DueDate,Reference,QuoteNo,VendorNotes,'
    + 'PrivateNotes,CreatedBy,Archived,DateModified',
  vendorOrderLines: 'Catalog,DisplayOrder,DueDate,Notes,Allocations',
  vendors: 'ID,Name,Phone,Email,Website,Address,Archived,DateModified',
  catalogs: 'ID,PartNo,Name,Group,Archived,SellPrice,DateModified,Manufacturer,UPC,IsInventory,IsAsset',
  catalogGroups: 'ID,Name,ParentGroup',
  contacts: 'ID,Title,GivenName,FamilyName,Email,WorkPhone,CellPhone,AltPhone,Department,Position,Notes,'
    + 'DateModified,Customers,Sites',
  leads: 'ID,LeadName,Customer,Site,Stage,Status,FollowUpDate,DateCreated,Description,Notes,ProjectManager,'
    + 'Salesperson,Tags,DateModified',
  activitySchedules: 'ID,TotalHours,Notes,IsLocked,Staff,Date,Blocks,DateModified,Activity',
  setupActivities: 'ID,Name',
  customerPayments: 'ID,Payment,Notes,Invoices,Exported,DateModified',
  creditNotes: 'ID,Type,Customer,InvoiceNo,Jobs,DateIssued,Stage,Status,OrderNo,Description,Notes,Total,DateModified',
};

const ACTUAL: Record<string, string> = {
  jobs: JOB_LIST_COLUMNS,
  quotes: QUOTE_LIST_COLUMNS,
  invoices: INVOICE_LIST_COLUMNS,
  companies: COMPANY_LIST_COLUMNS,
  individuals: INDIVIDUAL_LIST_COLUMNS,
  tasks: TASK_LIST_COLUMNS,
  attachments: ATTACHMENT_LIST_COLUMNS,
  schedules: SCHEDULE_COLUMNS,
  vendorOrders: VENDOR_ORDER_LIST_COLUMNS,
  vendorOrderLines: VENDOR_ORDER_LINE_COLUMNS,
  vendors: VENDOR_LIST_COLUMNS,
  catalogs: CATALOG_LIST_COLUMNS,
  catalogGroups: CATALOG_GROUP_LIST_COLUMNS,
  contacts: CONTACT_LIST_COLUMNS,
  leads: LEAD_LIST_COLUMNS,
  activitySchedules: ACTIVITY_SCHEDULE_LIST_COLUMNS,
  setupActivities: SETUP_ACTIVITY_LIST_COLUMNS,
  customerPayments: CUSTOMER_PAYMENT_LIST_COLUMNS,
  creditNotes: CREDIT_NOTE_LIST_COLUMNS,
};

describe('the columns each endpoint is asked for', () => {
  for (const [endpoint, verified] of Object.entries(VERIFIED)) {
    it(`${endpoint} asks for exactly what the build answered 200 to`, () => {
      expect(ACTUAL[endpoint]).toBe(verified);
    });
  }

  it('never asks for a name the build has refused', () => {
    // Each of these was sent and refused. They are easy to reach for again,
    // because every one of them is the obvious name for something that does
    // exist: a schedule does belong to a job, an employee does have an email.
    const refused: [string, string[]][] = [
      ['schedules', ['Job', 'ScheduleRate', 'Archived', 'Customer', 'Site', 'Status']],
      // The job is inside AssignedTo on this list.
      ['vendorOrders', ['Job']],
      // A line has no id of its own and no quantity column: the quantities
      // are on its Allocations, and every name for them was refused in one
      // reply that listed them all. (Price was never asked for: it is cost.)
      ['vendorOrderLines', ['ID', 'Quantity', 'Qty', 'Received', 'QtyReceived', 'ReceivedQty', 'Description', 'Status',
        'Ordered', 'QuantityReceived', 'Total', 'Cost']],
    ];
    for (const [endpoint, names] of refused) {
      const asked = ACTUAL[endpoint]!.split(',');
      for (const name of names) expect(asked).not.toContain(name);
    }
  });

  it('asks for no column that names a cost, a markup or a margin', () => {
    // The standing rule for this mirror: sell prices reach the phone, what
    // the work cost the company does not. A column set is where that would
    // be undone quietly, one plausible name at a time.
    // SellPrice is the one price that may cross; a catalogue item's
    // TradePrice, and a purchase order line's Price, may not.
    const forbidden = /Cost|Markup|Margin|Profit|Banking|AmountOwing|Rates|CreditLimit|BasePrice|TradePrice|^Price$|Totals/i;
    for (const [endpoint, columns] of Object.entries(ACTUAL)) {
      const offending = columns.split(',').filter((c) => forbidden.test(c));
      expect({ endpoint, offending }).toEqual({ endpoint, offending: [] });
    }
  });

  it('always asks for the record’s own id', () => {
    for (const [endpoint, columns] of Object.entries(ACTUAL)) {
      // The one list on the build whose rows have no ID column: a purchase
      // order's lines are named by their catalogue item, and asking for ID
      // is refused (see the refused list above).
      if (endpoint === 'vendorOrderLines') continue;
      expect({ endpoint, hasId: columns.split(',').includes('ID') }).toEqual({ endpoint, hasId: true });
    }
  });
});
