import {
  ATTACHMENT_LIST_COLUMNS, COMPANY_LIST_COLUMNS, INDIVIDUAL_LIST_COLUMNS,
  INVOICE_LIST_COLUMNS, JOB_LIST_COLUMNS, QUOTE_LIST_COLUMNS, TASK_LIST_COLUMNS,
} from '@/simpro/mirrorResources';
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
 * Verified 3 September 2026 against safeqld.simprosuite.com, company 0.
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
    const forbidden = /Cost|Markup|Margin|Profit|Banking|AmountOwing|Rates|CreditLimit|BasePrice/i;
    for (const [endpoint, columns] of Object.entries(ACTUAL)) {
      const offending = columns.split(',').filter((c) => forbidden.test(c));
      expect({ endpoint, offending }).toEqual({ endpoint, offending: [] });
    }
  });

  it('always asks for the record’s own id', () => {
    for (const [endpoint, columns] of Object.entries(ACTUAL)) {
      expect({ endpoint, hasId: columns.split(',').includes('ID') }).toEqual({ endpoint, hasId: true });
    }
  });
});
