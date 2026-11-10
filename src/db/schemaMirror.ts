/**
 * Schema v18 — the Simpro mirror: what a job actually holds, and the quotes,
 * invoices, customers and tasks around it.
 *
 * Until now a job on the phone was a title, a stage and two dates. The office
 * system holds an order number, a status with a colour, the technicians it
 * was booked to, the sections and cost centres and the lines under them, the
 * notes, the attachments, the activity feed, the invoices it went out on —
 * and a technician opening the job saw none of it. These tables hold that,
 * within what a phone should: every job, quote, invoice and customer at list
 * level, and the children of a job only once somebody opens it or is booked
 * to it.
 *
 * Three decisions to know about.
 *
 * **Money is whole cents, and only the sell side.** Simpro sends dollars as
 * floats — 27.290000000000003 on one real line — so each figure is rounded
 * once on the way in and every total on the phone is integer arithmetic.
 * Nothing here holds a cost, a markup or a margin: the columns do not exist,
 * so the question of whether they are filled cannot arise.
 *
 * **Children are keyed to the local job id and replaced whole.** A section
 * deleted in the office has to leave this table too, and a merge cannot know
 * it is gone. Each detail sync deletes a job's children and writes what the
 * office holds now, in one transaction, and `job.detailSyncedAt` says when.
 *
 * **The quote tables are prefixed `simpro_`.** The app already has a `quote`
 * table — its own client quotes, built on the phone from a site's coded
 * defects, with a state machine of their own. An office quote is a different
 * document with a different lifecycle, and giving the two one name would
 * invite a screen to read the wrong one. Jobs, invoices and customers had no
 * local table to collide with and keep their plain names.
 */

/** The child tables a job and a quote both carry, generated so the two cannot drift. */
function documentChildren(parent: 'job' | 'simpro_quote', parentColumn: 'jobId' | 'quoteId'): string {
  const ref = parent === 'job' ? 'job(id)' : 'simpro_quote(externalId)';
  return `
CREATE TABLE IF NOT EXISTS ${parent}_section (
  ${parentColumn}  TEXT NOT NULL REFERENCES ${ref} ON DELETE CASCADE,
  externalId       TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  description      TEXT,
  displayOrder     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (${parentColumn}, externalId)
);

CREATE TABLE IF NOT EXISTS ${parent}_cost_center (
  ${parentColumn}      TEXT NOT NULL REFERENCES ${ref} ON DELETE CASCADE,
  sectionExternalId    TEXT NOT NULL,
  /* The cost centre on this document, which is not the setup cost centre it
     was made from; that one is kept beside it by id and name. */
  externalId           TEXT NOT NULL,
  setupCostCenterId    TEXT,
  setupCostCenterName  TEXT,
  name                 TEXT NOT NULL DEFAULT '',
  displayOrder         INTEGER NOT NULL DEFAULT 0,
  totalExTaxCents      INTEGER,
  totalIncTaxCents     INTEGER,
  percentComplete      REAL,
  PRIMARY KEY (${parentColumn}, externalId)
);

CREATE TABLE IF NOT EXISTS ${parent}_item (
  ${parentColumn}        TEXT NOT NULL REFERENCES ${ref} ON DELETE CASCADE,
  costCenterExternalId   TEXT NOT NULL,
  /* Ids are only unique within a family — a catalog line and a one-off can
     share a number — so the family is part of the key. */
  kind                   TEXT NOT NULL,
  externalId             TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  partNo                 TEXT,
  catalogId              TEXT,
  qty                    REAL NOT NULL DEFAULT 0,
  unitSellExTaxCents     INTEGER,
  unitSellIncTaxCents    INTEGER,
  sellExTaxCents         INTEGER,
  sellIncTaxCents        INTEGER,
  billableStatus         TEXT,
  discountPercent        REAL,
  sortIndex              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (${parentColumn}, kind, externalId)
);
CREATE INDEX IF NOT EXISTS idx_${parent}_item_cc ON ${parent}_item(${parentColumn}, costCenterExternalId, sortIndex);

CREATE TABLE IF NOT EXISTS ${parent}_note (
  ${parentColumn}    TEXT NOT NULL REFERENCES ${ref} ON DELETE CASCADE,
  externalId         TEXT NOT NULL,
  subject            TEXT,
  note               TEXT,
  createdAt          TEXT,
  createdBy          TEXT,
  visibleToCustomer  INTEGER,
  referenceType      TEXT,
  referenceNumber    TEXT,
  PRIMARY KEY (${parentColumn}, externalId)
);

CREATE TABLE IF NOT EXISTS ${parent}_attachment (
  ${parentColumn}  TEXT NOT NULL REFERENCES ${ref} ON DELETE CASCADE,
  externalId       TEXT NOT NULL,
  filename         TEXT NOT NULL DEFAULT '',
  folder           TEXT,
  mimeType         TEXT,
  sizeBytes        INTEGER,
  dateAdded        TEXT,
  addedBy          TEXT,
  public           INTEGER,
  /* Where the bytes are on this phone once somebody has opened the file.
     Null until then: the mirror holds the list, not forty photos a job. */
  localUri         TEXT,
  PRIMARY KEY (${parentColumn}, externalId)
);
`;
}

export const MIGRATION_V18 = `
/* What the full job list carries that the thin one did not. */
ALTER TABLE job ADD COLUMN orderNo TEXT;
ALTER TABLE job ADD COLUMN requestNo TEXT;
ALTER TABLE job ADD COLUMN statusName TEXT;
ALTER TABLE job ADD COLUMN statusColor TEXT;
/* Simpro's own Stage and Type words, untouched. 'stage' and 'jobType' are
   already filled from them and screens read those; these are the record. */
ALTER TABLE job ADD COLUMN stageRaw TEXT;
ALTER TABLE job ADD COLUMN jobTypeRaw TEXT;
ALTER TABLE job ADD COLUMN customerExternalId TEXT;
/* The office's site id even where no local site matched, so the link can be
   made later without another pull. */
ALTER TABLE job ADD COLUMN siteExternalId TEXT;
ALTER TABLE job ADD COLUMN siteContactJson TEXT;
ALTER TABLE job ADD COLUMN techniciansJson TEXT;
ALTER TABLE job ADD COLUMN tagsJson TEXT;
ALTER TABLE job ADD COLUMN projectManager TEXT;
/* Plain text: the office's HTML is stripped on the way in. */
ALTER TABLE job ADD COLUMN descriptionText TEXT;
ALTER TABLE job ADD COLUMN notesText TEXT;
/* The office's completion date, yyyy-mm-dd. A day, not an instant, and not
   the same thing as completedAt, which is the moment the technician tapped
   Complete on this phone. */
ALTER TABLE job ADD COLUMN completedDate TEXT;
ALTER TABLE job ADD COLUMN totalExTaxCents INTEGER;
ALTER TABLE job ADD COLUMN totalIncTaxCents INTEGER;
ALTER TABLE job ADD COLUMN convertedFromQuoteId TEXT;
ALTER TABLE job ADD COLUMN customerContractJson TEXT;
ALTER TABLE job ADD COLUMN dateModified TEXT;
/* When the children below were last read for this job. Null: never. */
ALTER TABLE job ADD COLUMN detailSyncedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_job_site ON job(siteId);
CREATE INDEX IF NOT EXISTS idx_job_customer_external ON job(customerExternalId);
CREATE INDEX IF NOT EXISTS idx_job_site_external ON job(siteExternalId);
CREATE INDEX IF NOT EXISTS idx_job_date_modified ON job(dateModified);

${documentChildren('job', 'jobId')}

/* The activity feed. Rows carry no id of their own, so the row number is the key. */
CREATE TABLE IF NOT EXISTS job_timeline (
  id         INTEGER PRIMARY KEY,
  jobId      TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  type       TEXT,
  message    TEXT NOT NULL DEFAULT '',
  staffId    TEXT,
  staffName  TEXT,
  at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_timeline_job ON job_timeline(jobId, at);

/* Tasks, both the company-wide list and the ones under a job. A task read
   under a job carries the job; one read from the company list may not, and
   the company read keeps whatever link a job read already made. */
CREATE TABLE IF NOT EXISTS job_task (
  externalId       TEXT PRIMARY KEY NOT NULL,
  jobId            TEXT REFERENCES job(id) ON DELETE SET NULL,
  subject          TEXT NOT NULL DEFAULT '',
  assignedTo       TEXT,
  assigneesJson    TEXT NOT NULL DEFAULT '[]',
  completedBy      TEXT,
  dueDate          TEXT,
  percentComplete  REAL,
  createdDate      TEXT,
  syncedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_task_job ON job_task(jobId);

CREATE TABLE IF NOT EXISTS simpro_quote (
  externalId           TEXT PRIMARY KEY NOT NULL,
  name                 TEXT NOT NULL DEFAULT '',
  descriptionText      TEXT,
  notesText            TEXT,
  customerExternalId   TEXT,
  customerName         TEXT,
  siteExternalId       TEXT,
  /* The local site, where the sync could match one. */
  siteId               TEXT REFERENCES site(id) ON DELETE SET NULL,
  siteName             TEXT,
  siteContactJson      TEXT,
  customerContactJson  TEXT,
  customerContractJson TEXT,
  stage                TEXT,
  customerStage        TEXT,
  statusName           TEXT,
  statusColor          TEXT,
  quoteType            TEXT,
  dateIssued           TEXT,
  dateApproved         TEXT,
  dueDate              TEXT,
  validityDays         INTEGER,
  orderNo              TEXT,
  requestNo            TEXT,
  isClosed             INTEGER NOT NULL DEFAULT 0,
  /* The job it became, once converted. */
  jobExternalId        TEXT,
  totalExTaxCents      INTEGER,
  totalIncTaxCents     INTEGER,
  techniciansJson      TEXT,
  salesperson          TEXT,
  projectManager       TEXT,
  tagsJson             TEXT,
  dateModified         TEXT,
  detailSyncedAt       TEXT,
  syncedAt             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_simpro_quote_site ON simpro_quote(siteId);
CREATE INDEX IF NOT EXISTS idx_simpro_quote_site_external ON simpro_quote(siteExternalId);
CREATE INDEX IF NOT EXISTS idx_simpro_quote_customer ON simpro_quote(customerExternalId);
CREATE INDEX IF NOT EXISTS idx_simpro_quote_modified ON simpro_quote(dateModified);
CREATE INDEX IF NOT EXISTS idx_simpro_quote_stage ON simpro_quote(stage, dateIssued);

${documentChildren('simpro_quote', 'quoteId')}

CREATE TABLE IF NOT EXISTS invoice (
  externalId          TEXT PRIMARY KEY NOT NULL,
  invoiceType         TEXT,
  customerExternalId  TEXT,
  customerName        TEXT,
  dateIssued          TEXT,
  stage               TEXT,
  statusName          TEXT,
  isPaid              INTEGER NOT NULL DEFAULT 0,
  datePaid            TEXT,
  dueDate             TEXT,
  orderNo             TEXT,
  descriptionText     TEXT,
  notesText           TEXT,
  periodStart         TEXT,
  periodEnd           TEXT,
  totalExTaxCents     INTEGER,
  totalIncTaxCents    INTEGER,
  amountAppliedCents  INTEGER,
  balanceDueCents     INTEGER,
  dateModified        TEXT,
  detailSyncedAt      TEXT,
  syncedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_customer ON invoice(customerExternalId, dateIssued);
CREATE INDEX IF NOT EXISTS idx_invoice_paid ON invoice(isPaid, dateIssued);
CREATE INDEX IF NOT EXISTS idx_invoice_modified ON invoice(dateModified);

/* One invoice can bill several jobs and one job can be billed in stages. */
CREATE TABLE IF NOT EXISTS invoice_job (
  invoiceExternalId  TEXT NOT NULL REFERENCES invoice(externalId) ON DELETE CASCADE,
  jobExternalId      TEXT NOT NULL,
  jobType            TEXT,
  description        TEXT,
  totalExTaxCents    INTEGER,
  totalIncTaxCents   INTEGER,
  PRIMARY KEY (invoiceExternalId, jobExternalId)
);
CREATE INDEX IF NOT EXISTS idx_invoice_job_job ON invoice_job(jobExternalId);

/* Companies and individuals in one table: a job's Customer is one or the
   other and a screen asking who the customer is does not care which. No
   rates, no banking, no amount owing — the columns do not exist. */
CREATE TABLE IF NOT EXISTS customer (
  externalId       TEXT PRIMARY KEY NOT NULL,
  customerKind     TEXT NOT NULL DEFAULT 'Company',
  name             TEXT NOT NULL DEFAULT '',
  givenName        TEXT,
  familyName       TEXT,
  phone            TEXT,
  altPhone         TEXT,
  email            TEXT,
  website          TEXT,
  address          TEXT,
  suburb           TEXT,
  state            TEXT,
  postcode         TEXT,
  country          TEXT,
  billingAddress   TEXT,
  billingSuburb    TEXT,
  billingState     TEXT,
  billingPostcode  TEXT,
  customerType     TEXT,
  customerGroup    TEXT,
  archived         INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  tagsJson         TEXT,
  sitesJson        TEXT NOT NULL DEFAULT '[]',
  contactsJson     TEXT NOT NULL DEFAULT '[]',
  dateModified     TEXT,
  detailSyncedAt   TEXT,
  syncedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_name ON customer(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_customer_modified ON customer(dateModified);
`;
