/**
 * Schema v23 — the rest of Simpro, so the phone is the office system.
 *
 * v18 mirrored what a job holds and the quotes, invoices and customers
 * around it. What was still only in the office: the purchase orders raised
 * against a job, the suppliers they went to, the office's own catalogue,
 * the people at a site who are not the primary contact, the leads that
 * become quotes, the hours Simpro already holds against each employee, the
 * activities the office schedules that are not jobs, and the money that
 * came in against an invoice. This holds all of it, at list level, and the
 * hours a technician clocks on this phone before they reach the office.
 *
 * Three rules carried over from v18, and one new one.
 *
 * **Money is whole cents and the sell side only.** A purchase order's total
 * is what the company pays a supplier, which is a cost: the columns for it
 * do not exist here, and a purchase order on the phone is its lines,
 * quantities and status. A catalogue item carries its sell price and
 * nothing else about money. A payment is money that came in, and a credit
 * note is money handed back — both are sell-side and both are held.
 *
 * **Simpro's ids are the keys.** Every table here is a mirror of a record
 * the office owns, so the office's id is the primary key and a re-pull
 * updates rather than duplicates. Nothing here is created on the phone
 * except `clock_entry`, which has a local id because the office has not
 * heard of it yet.
 *
 * **Children are replaced whole.** A purchase order's lines are deleted and
 * rewritten in one transaction when the order is read, for the same reason
 * a job's sections are.
 *
 * **Hours from Simpro never carry a cost.** The timesheet rows the office
 * returns come with Cost, OverheadCost, TotalCost and a ScheduleRate. The
 * hours, the rate's name and the job are held; the three cost figures are
 * not read and have no column.
 */

export const MIGRATION_V23 = `
/* ---------------------------------------------------------------- purchase orders */

CREATE TABLE IF NOT EXISTS vendor_order (
  externalId              TEXT PRIMARY KEY NOT NULL,
  /* Simpro's Type: Catalogue, Service, and so on. */
  orderType               TEXT,
  stage                   TEXT,
  statusId                TEXT,
  statusName              TEXT,
  vendorExternalId        TEXT,
  vendorName              TEXT,
  /* AssignedTo on the record: the job, its section and the job cost centre the order is for. */
  jobExternalId           TEXT,
  jobSectionExternalId    TEXT,
  jobCostCenterExternalId TEXT,
  assignedToName          TEXT,
  reference               TEXT,
  quoteNo                 TEXT,
  dateIssued              TEXT,
  dueDate                 TEXT,
  /* Plain text; the office's HTML is stripped on the way in. */
  vendorNotes             TEXT,
  privateNotes            TEXT,
  createdByName           TEXT,
  archived                INTEGER NOT NULL DEFAULT 0,
  dateModified            TEXT,
  /* When the lines below were last read. Null: never. */
  detailSyncedAt          TEXT,
  syncedAt                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_order_job ON vendor_order(jobExternalId);
CREATE INDEX IF NOT EXISTS idx_vendor_order_vendor ON vendor_order(vendorExternalId);
CREATE INDEX IF NOT EXISTS idx_vendor_order_modified ON vendor_order(dateModified);
CREATE INDEX IF NOT EXISTS idx_vendor_order_stage ON vendor_order(stage, dateIssued);

/* The lines on an order: what was asked for and how much has arrived. No prices. */
CREATE TABLE IF NOT EXISTS vendor_order_line (
  orderExternalId    TEXT NOT NULL REFERENCES vendor_order(externalId) ON DELETE CASCADE,
  /* catalog or oneOff, since the two families share ids. */
  kind               TEXT NOT NULL,
  externalId         TEXT NOT NULL,
  catalogExternalId  TEXT,
  partNo             TEXT,
  description        TEXT NOT NULL DEFAULT '',
  qtyOrdered         REAL,
  qtyReceived        REAL,
  dueDate            TEXT,
  PRIMARY KEY (orderExternalId, kind, externalId)
);

/* --------------------------------------------------------------------- vendors */

CREATE TABLE IF NOT EXISTS vendor (
  externalId    TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT,
  email         TEXT,
  website       TEXT,
  address       TEXT,
  suburb        TEXT,
  state         TEXT,
  postcode      TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  dateModified  TEXT,
  syncedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_name ON vendor(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_vendor_modified ON vendor(dateModified);

/* ------------------------------------------------------------- the office catalogue */

/* The office's own catalogue, distinct from the supplier catalogue the app
   ships (catalogue_item): this is what a line on a job or an order is made
   from, with the office's own id. Sell price only. */
CREATE TABLE IF NOT EXISTS catalog_item (
  externalId       TEXT PRIMARY KEY NOT NULL,
  partNo           TEXT,
  name             TEXT NOT NULL DEFAULT '',
  groupExternalId  TEXT,
  groupName        TEXT,
  parentGroupName  TEXT,
  manufacturer     TEXT,
  upc              TEXT,
  sellExTaxCents   INTEGER,
  isInventory      INTEGER NOT NULL DEFAULT 0,
  isAsset          INTEGER NOT NULL DEFAULT 0,
  archived         INTEGER NOT NULL DEFAULT 0,
  dateModified     TEXT,
  syncedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_item_part ON catalog_item(partNo COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_catalog_item_name ON catalog_item(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_catalog_item_group ON catalog_item(groupExternalId);
CREATE INDEX IF NOT EXISTS idx_catalog_item_modified ON catalog_item(dateModified);

CREATE TABLE IF NOT EXISTS catalog_group (
  externalId        TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  parentExternalId  TEXT,
  parentName        TEXT,
  syncedAt          TEXT NOT NULL
);

/* -------------------------------------------------------------------- contacts */

/* Everyone the office has a name and a number for, with the customers and
   sites they belong to as JSON lists of {id, name}. */
CREATE TABLE IF NOT EXISTS contact (
  externalId     TEXT PRIMARY KEY NOT NULL,
  title          TEXT,
  givenName      TEXT,
  familyName     TEXT,
  /* Given and family together, for the list and the search. */
  name           TEXT NOT NULL DEFAULT '',
  email          TEXT,
  workPhone      TEXT,
  cellPhone      TEXT,
  altPhone       TEXT,
  department     TEXT,
  position       TEXT,
  notes          TEXT,
  customersJson  TEXT NOT NULL DEFAULT '[]',
  sitesJson      TEXT NOT NULL DEFAULT '[]',
  dateModified   TEXT,
  syncedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_name ON contact(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_contact_modified ON contact(dateModified);

/* ----------------------------------------------------------------------- leads */

CREATE TABLE IF NOT EXISTS lead (
  externalId          TEXT PRIMARY KEY NOT NULL,
  name                TEXT NOT NULL DEFAULT '',
  customerExternalId  TEXT,
  customerName        TEXT,
  siteExternalId      TEXT,
  siteName            TEXT,
  stage               TEXT,
  statusName          TEXT,
  followUpDate        TEXT,
  dateCreated         TEXT,
  descriptionText     TEXT,
  notesText           TEXT,
  projectManager      TEXT,
  salesperson         TEXT,
  tagsJson            TEXT,
  dateModified        TEXT,
  syncedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_customer ON lead(customerExternalId);
CREATE INDEX IF NOT EXISTS idx_lead_site ON lead(siteExternalId);
CREATE INDEX IF NOT EXISTS idx_lead_stage ON lead(stage, dateCreated);

/* --------------------------------------------------- hours the office already holds */

/* One row per block Simpro reports on an employee's timesheet. The uid is
   Simpro's own. The reference is "job-costcentre" for a job block and the
   activity id for an activity block; both are also split out. Cost,
   OverheadCost and TotalCost are on the record and are not read. */
CREATE TABLE IF NOT EXISTS simpro_timesheet (
  uid                      TEXT PRIMARY KEY NOT NULL,
  employeeExternalId       TEXT NOT NULL,
  scheduleType             TEXT,
  reference                TEXT,
  jobExternalId            TEXT,
  jobCostCenterExternalId  TEXT,
  activityExternalId       TEXT,
  /* The schedule record's own path, which is what an update or a delete addresses. */
  href                     TEXT,
  date                     TEXT NOT NULL,
  startTime                TEXT,
  endTime                  TEXT,
  totalHours               REAL,
  scheduleRateId           TEXT,
  scheduleRateName         TEXT,
  syncedAt                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_simpro_timesheet_employee ON simpro_timesheet(employeeExternalId, date);
CREATE INDEX IF NOT EXISTS idx_simpro_timesheet_job ON simpro_timesheet(jobExternalId);

/* ------------------------------------------------------------ activities and leave */

/* Leave, meetings, workshop days: the office's schedule that is not a job. */
CREATE TABLE IF NOT EXISTS activity_schedule (
  externalId          TEXT PRIMARY KEY NOT NULL,
  staffId             TEXT,
  staffName           TEXT,
  date                TEXT NOT NULL,
  totalHours          REAL,
  notes               TEXT,
  activityExternalId  TEXT,
  activityName        TEXT,
  /* [{startTime, endTime, hours, rateName}] */
  blocksJson          TEXT NOT NULL DEFAULT '[]',
  isLocked            INTEGER NOT NULL DEFAULT 0,
  dateModified        TEXT,
  syncedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_schedule_staff ON activity_schedule(staffId, date);
CREATE INDEX IF NOT EXISTS idx_activity_schedule_date ON activity_schedule(date);

CREATE TABLE IF NOT EXISTS setup_activity (
  externalId  TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  syncedAt    TEXT NOT NULL
);

/* ------------------------------------------------------------- money that came in */

CREATE TABLE IF NOT EXISTS customer_payment (
  externalId     TEXT PRIMARY KEY NOT NULL,
  paymentMethod  TEXT,
  status         TEXT,
  date           TEXT,
  notes          TEXT,
  totalCents     INTEGER,
  exported       INTEGER NOT NULL DEFAULT 0,
  dateModified   TEXT,
  syncedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_payment_date ON customer_payment(date);
CREATE INDEX IF NOT EXISTS idx_customer_payment_modified ON customer_payment(dateModified);

/* One payment can settle several invoices. */
CREATE TABLE IF NOT EXISTS customer_payment_invoice (
  paymentExternalId   TEXT NOT NULL REFERENCES customer_payment(externalId) ON DELETE CASCADE,
  invoiceExternalId   TEXT NOT NULL,
  customerExternalId  TEXT,
  customerName        TEXT,
  amountCents         INTEGER,
  PRIMARY KEY (paymentExternalId, invoiceExternalId)
);
CREATE INDEX IF NOT EXISTS idx_customer_payment_invoice_invoice ON customer_payment_invoice(invoiceExternalId);

CREATE TABLE IF NOT EXISTS credit_note (
  externalId          TEXT PRIMARY KEY NOT NULL,
  /* Simpro's Type: Void, Refund, and so on. */
  creditType          TEXT,
  invoiceExternalId   TEXT,
  customerExternalId  TEXT,
  customerName        TEXT,
  stage               TEXT,
  statusName          TEXT,
  dateIssued          TEXT,
  orderNo             TEXT,
  descriptionText     TEXT,
  notesText           TEXT,
  totalExTaxCents     INTEGER,
  totalIncTaxCents    INTEGER,
  /* [{id, siteName}] */
  jobsJson            TEXT NOT NULL DEFAULT '[]',
  dateModified        TEXT,
  syncedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_note_invoice ON credit_note(invoiceExternalId);
CREATE INDEX IF NOT EXISTS idx_credit_note_customer ON credit_note(customerExternalId);
CREATE INDEX IF NOT EXISTS idx_credit_note_modified ON credit_note(dateModified);

/* ------------------------------------------------ hours clocked on this phone */

/* A block of time a technician is on, or was on, before the office has it.
   Local id because the office has not heard of it yet; simproUid once it has.
   endedAt null is the block that is running now — there is at most one. */
CREATE TABLE IF NOT EXISTS clock_entry (
  id                       TEXT PRIMARY KEY NOT NULL,
  employeeExternalId       TEXT,
  /* 'work', 'travel', 'break' or 'activity'. */
  kind                     TEXT NOT NULL,
  jobExternalId            TEXT,
  jobSectionExternalId     TEXT,
  jobCostCenterExternalId  TEXT,
  jobTitle                 TEXT,
  siteName                 TEXT,
  activityExternalId       TEXT,
  activityName             TEXT,
  /* The Queensland day the block belongs to, yyyy-mm-dd. */
  date                     TEXT NOT NULL,
  startedAt                TEXT NOT NULL,
  endedAt                  TEXT,
  scheduleRateId           TEXT,
  scheduleRateName         TEXT,
  note                     TEXT,
  /* When the office accepted it, and what it called it. */
  sentAt                   TEXT,
  simproUid                TEXT,
  sendError                TEXT,
  createdAt                TEXT NOT NULL,
  updatedAt                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clock_entry_day ON clock_entry(date, startedAt);
CREATE INDEX IF NOT EXISTS idx_clock_entry_job ON clock_entry(jobExternalId);
`;
