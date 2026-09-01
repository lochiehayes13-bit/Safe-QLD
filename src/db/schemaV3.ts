/**
 * Schema v3 — the universal engines.
 *
 * The app deliberately does not carry a table per equipment type. A detector,
 * a pump, an extinguisher, an emergency light and a fire door are all assets
 * that differ only in their type definition and their attributes, so adding a
 * new kind of equipment is data rather than code.
 *
 * The same idea runs through testing and defects: an AS 1851 routine is a set
 * of test definitions, not a hand-built screen, and a defect is an instance of
 * a coded library entry that already knows its severity, its wording and the
 * work needed to clear it.
 */

export const MIGRATION_V3 = `
-- ===========================================================================
-- Asset engine
-- ===========================================================================

-- Type definitions are seeded as data, so new equipment classes need no code.
CREATE TABLE IF NOT EXISTS asset_type (
  id           TEXT PRIMARY KEY NOT NULL,
  label        TEXT NOT NULL,
  /* Broad system this type belongs to: detection, ews, sprinkler, hydrant,
     hose-reel, extinguisher, emergency-lighting, pump, passive, door, gas. */
  system       TEXT NOT NULL,
  /* Icon name for the UI. */
  icon         TEXT,
  /* JSON array of attribute definitions {key,label,type,unit,options}. */
  attributes   TEXT NOT NULL DEFAULT '[]',
  /* Whether assets of this type can contain children, e.g. a panel holds loops. */
  container    INTEGER NOT NULL DEFAULT 0,
  sortIndex    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset (
  id             TEXT PRIMARY KEY NOT NULL,
  siteId         TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  assetTypeId    TEXT NOT NULL,
  /* Self-reference builds the building tree: site > level > panel > loop > device. */
  parentAssetId  TEXT REFERENCES asset(id) ON DELETE SET NULL,
  /* Safe QLD asset code, e.g. SQ-DET-0001847. Unique across the company. */
  code           TEXT,
  name           TEXT NOT NULL DEFAULT '',
  /* Where it physically is: level, room, position. */
  level          TEXT,
  room           TEXT,
  locationNote   TEXT,
  manufacturer   TEXT,
  model          TEXT,
  partNumber     TEXT,
  serial         TEXT,
  /* Links to the catalogue when the model is recognised. */
  catalogueItemId TEXT,
  installedDate  TEXT,
  /* in-service, isolated, removed, faulty, decommissioned */
  status         TEXT NOT NULL DEFAULT 'in-service',
  /* Type-specific values as JSON, described by asset_type.attributes. */
  attributes     TEXT NOT NULL DEFAULT '{}',
  /* Denormalised for list performance — a site can hold thousands of assets. */
  lastServicedAt TEXT,
  lastResult     TEXT,
  nextDueAt      TEXT,
  openDefects    INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_site ON asset(siteId, assetTypeId);
CREATE INDEX IF NOT EXISTS idx_asset_parent ON asset(parentAssetId);
CREATE INDEX IF NOT EXISTS idx_asset_due ON asset(nextDueAt);
CREATE INDEX IF NOT EXISTS idx_asset_serial ON asset(serial);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_code ON asset(code) WHERE code IS NOT NULL;

/* The asset timeline. Every meaningful thing that happens lands here, which is
   what makes "why does this keep failing?" answerable. */
CREATE TABLE IF NOT EXISTS asset_event (
  id          TEXT PRIMARY KEY NOT NULL,
  assetId     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  /* installed, tested, passed, failed, cleaned, repaired, replaced, isolated,
     restored, defect-raised, defect-cleared, not-tested, moved, noted */
  kind        TEXT NOT NULL,
  occurredAt  TEXT NOT NULL,
  technician  TEXT,
  jobId       TEXT,
  reportId    TEXT,
  summary     TEXT NOT NULL DEFAULT '',
  detail      TEXT,
  /* JSON array of local photo URIs. */
  photos      TEXT NOT NULL DEFAULT '[]',
  /* JSON object of recorded measurements. */
  measurements TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_event_asset ON asset_event(assetId, occurredAt DESC);
CREATE INDEX IF NOT EXISTS idx_event_kind ON asset_event(kind, occurredAt DESC);

-- ===========================================================================
-- Test engine
-- ===========================================================================

/* An AS 1851 routine is a named set of test definitions at a frequency. */
CREATE TABLE IF NOT EXISTS test_routine (
  id           TEXT PRIMARY KEY NOT NULL,
  label        TEXT NOT NULL,
  system       TEXT NOT NULL,
  frequency    TEXT NOT NULL,
  /* Where the requirement comes from, kept separate so the app never blurs a
     standard, a manufacturer instruction and an internal procedure. */
  sourceKind   TEXT NOT NULL DEFAULT 'standard',
  sourceRef    TEXT,
  description  TEXT,
  sortIndex    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_definition (
  id              TEXT PRIMARY KEY NOT NULL,
  routineId       TEXT NOT NULL REFERENCES test_routine(id) ON DELETE CASCADE,
  /* Asset type this test applies to; null means it is a system-level check. */
  assetTypeId     TEXT,
  section         TEXT NOT NULL DEFAULT '',
  label           TEXT NOT NULL,
  whatToDo        TEXT,
  whatToLookFor   TEXT,
  passCriteria    TEXT,
  failCriteria    TEXT,
  photoRequired   INTEGER NOT NULL DEFAULT 0,
  /* Name of the measurement to record, e.g. "Terminal voltage". Null for none. */
  measurementKey  TEXT,
  measurementUnit TEXT,
  /* Defect code raised automatically when this test fails. */
  defectCode      TEXT,
  sourceKind      TEXT NOT NULL DEFAULT 'standard',
  sourceRef       TEXT,
  sortIndex       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_testdef_routine ON test_definition(routineId, sortIndex);

-- ===========================================================================
-- Defect engine
-- ===========================================================================

/* The coded defect library. A technician picks system > component > defect and
   the app supplies the wording, the severity and the work to clear it, so
   reports stop depending on how articulate someone felt that afternoon. */
CREATE TABLE IF NOT EXISTS defect_code (
  code            TEXT PRIMARY KEY NOT NULL,
  system          TEXT NOT NULL,
  component       TEXT NOT NULL,
  defect          TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'medium',
  /* Wording for the formal service record. */
  reportWording   TEXT NOT NULL,
  /* Plain-English wording for the client. */
  clientWording   TEXT,
  /* What the technician has to actually do. */
  rectification   TEXT,
  /* JSON array of quote line items {description, unit, qtyPerDefect}. */
  quoteItems      TEXT NOT NULL DEFAULT '[]',
  sourceKind      TEXT NOT NULL DEFAULT 'internal',
  sourceRef       TEXT,
  photoRequired   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_defectcode_system ON defect_code(system, component);

-- ===========================================================================
-- Jobs, impairments, stock, people
-- ===========================================================================

CREATE TABLE IF NOT EXISTS job (
  id             TEXT PRIMARY KEY NOT NULL,
  /* Simpro job number when the job came from there. */
  externalId     TEXT,
  siteId         TEXT REFERENCES site(id) ON DELETE SET NULL,
  siteName       TEXT NOT NULL DEFAULT '',
  customerName   TEXT,
  title          TEXT NOT NULL DEFAULT '',
  jobType        TEXT,
  stage          TEXT,
  priority       TEXT NOT NULL DEFAULT 'normal',
  scheduledFor   TEXT,
  dueAt          TEXT,
  technician     TEXT,
  address        TEXT,
  latitude       REAL,
  longitude      REAL,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  startedAt      TEXT,
  completedAt    TEXT,
  notes          TEXT,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_sched ON job(scheduledFor);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_external ON job(externalId) WHERE externalId IS NOT NULL;

/* A fire system out of service is a legal and safety event with a clock on it,
   not a note. Everything needed to close it out lives here. */
CREATE TABLE IF NOT EXISTS impairment (
  id                  TEXT PRIMARY KEY NOT NULL,
  siteId              TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  system              TEXT NOT NULL,
  scope               TEXT NOT NULL DEFAULT '',
  reason              TEXT NOT NULL DEFAULT '',
  startedAt           TEXT NOT NULL,
  expectedRestoreAt   TEXT,
  restoredAt          TEXT,
  technician          TEXT,
  responsibleNotified INTEGER NOT NULL DEFAULT 0,
  responsibleName     TEXT,
  brigadeNotified     INTEGER NOT NULL DEFAULT 0,
  monitoringNotified  INTEGER NOT NULL DEFAULT 0,
  fireWatchInPlace    INTEGER NOT NULL DEFAULT 0,
  signagePlaced       INTEGER NOT NULL DEFAULT 0,
  alternativeMeasures TEXT,
  /* JSON array of assets isolated, so restoration can be checked off. */
  isolatedAssets      TEXT NOT NULL DEFAULT '[]',
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_impairment_open ON impairment(restoredAt, startedAt DESC);

CREATE TABLE IF NOT EXISTS stock_location (
  id       TEXT PRIMARY KEY NOT NULL,
  label    TEXT NOT NULL,
  /* workshop, van, site */
  kind     TEXT NOT NULL DEFAULT 'van',
  owner    TEXT
);

CREATE TABLE IF NOT EXISTS stock_item (
  id           TEXT PRIMARY KEY NOT NULL,
  locationId   TEXT NOT NULL REFERENCES stock_location(id) ON DELETE CASCADE,
  catalogueItemId TEXT,
  partNumber   TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  quantity     REAL NOT NULL DEFAULT 0,
  minimum      REAL NOT NULL DEFAULT 0,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_loc ON stock_item(locationId);
CREATE INDEX IF NOT EXISTS idx_stock_part ON stock_item(partNumber);

CREATE TABLE IF NOT EXISTS purchase_request (
  id          TEXT PRIMARY KEY NOT NULL,
  createdAt   TEXT NOT NULL,
  requestedBy TEXT,
  supplier    TEXT,
  jobId       TEXT,
  siteId      TEXT,
  /* JSON array of {partNumber, description, quantity, note}. */
  lines       TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'draft',
  externalId  TEXT,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_request(status, createdAt DESC);

CREATE TABLE IF NOT EXISTS technician (
  id            TEXT PRIMARY KEY NOT NULL,
  externalId    TEXT,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'service',
  vehicleRego   TEXT,
  stockLocationId TEXT,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS competency (
  id           TEXT PRIMARY KEY NOT NULL,
  technicianId TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  /* none, training, competent, expert */
  level        TEXT NOT NULL DEFAULT 'competent',
  evidence     TEXT,
  expiresAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_competency_tech ON competency(technicianId);

CREATE TABLE IF NOT EXISTS licence (
  id           TEXT PRIMARY KEY NOT NULL,
  technicianId TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  number       TEXT,
  issuedBy     TEXT,
  expiresAt    TEXT,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_licence_expiry ON licence(expiresAt);

CREATE TABLE IF NOT EXISTS tool (
  id              TEXT PRIMARY KEY NOT NULL,
  label           TEXT NOT NULL,
  serial          TEXT,
  assignedTo      TEXT,
  calibratedAt    TEXT,
  calibrationDueAt TEXT,
  provider        TEXT,
  condition       TEXT NOT NULL DEFAULT 'good',
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_cal ON tool(calibrationDueAt);

/* Company knowledge, with an approval state so a passing remark never becomes
   policy by accident. */
CREATE TABLE IF NOT EXISTS knowledge_note (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  system      TEXT,
  manufacturer TEXT,
  model       TEXT,
  siteId      TEXT,
  author      TEXT,
  /* unverified, verified, manufacturer-confirmed, superseded */
  status      TEXT NOT NULL DEFAULT 'unverified',
  sourceKind  TEXT NOT NULL DEFAULT 'technician',
  sourceRef   TEXT,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_note(status, updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_site ON knowledge_note(siteId);

/* Anything the technician said they would do. Nothing disappears into notes. */
CREATE TABLE IF NOT EXISTS promise (
  id          TEXT PRIMARY KEY NOT NULL,
  what        TEXT NOT NULL,
  siteId      TEXT,
  assetId     TEXT,
  jobId       TEXT,
  owner       TEXT,
  dueAt       TEXT,
  createdAt   TEXT NOT NULL,
  completedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_promise_open ON promise(completedAt, dueAt);

/* Outbound queue so field work never blocks on connectivity. */
CREATE TABLE IF NOT EXISTS sync_queue (
  id          TEXT PRIMARY KEY NOT NULL,
  createdAt   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  lastError   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status, createdAt);
`;

/**
 * Schema v4 — Queensland statutory fields on a defect.
 *
 * The Queensland critical defect test has two limbs and is not the same as the
 * AS 1851 definition, so both limbs are stored rather than one being inferred.
 * The notice and rectification clocks are stored alongside, because "when was
 * the occupier told" is the question that gets asked afterwards.
 */
export const MIGRATION_V4 = `
ALTER TABLE defect ADD COLUMN qldLimbInoperable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE defect ADD COLUMN qldLimbAdverseImpact INTEGER NOT NULL DEFAULT 0;
ALTER TABLE defect ADD COLUMN defectCode TEXT;
ALTER TABLE defect ADD COLUMN as1851Class TEXT NOT NULL DEFAULT 'non-critical';
ALTER TABLE defect ADD COLUMN noticeIssuedAt TEXT;
ALTER TABLE defect ADD COLUMN noticeRecipient TEXT;
ALTER TABLE defect ADD COLUMN verbalNotifiedAt TEXT;
ALTER TABLE defect ADD COLUMN verbalNotifiedTo TEXT;
ALTER TABLE defect ADD COLUMN rectificationDueAt TEXT;
ALTER TABLE defect ADD COLUMN interimMeasures TEXT;
ALTER TABLE defect ADD COLUMN extentOfImpairment TEXT;
CREATE INDEX IF NOT EXISTS idx_defect_notice ON defect(noticeIssuedAt, raisedAt DESC);
`;

/**
 * v5 — the occupier statement.
 *
 * Queensland's Building Fire Safety Regulation makes the occupier, not the
 * contractor, responsible for lodging an annual statement. We produce it, they
 * sign it, and a copy goes to the Commissioner within ten working days. The
 * rows are held as JSON because the statement is always read and written whole
 * and the installation list is prescribed, so there is nothing to join to.
 */
export const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS occupier_statement (
  id                TEXT PRIMARY KEY NOT NULL,
  siteId            TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  occupierName      TEXT NOT NULL DEFAULT '',
  occupierPhone     TEXT NOT NULL DEFAULT '',
  premisesName      TEXT NOT NULL DEFAULT '',
  premisesAddress   TEXT NOT NULL DEFAULT '',
  periodStart       TEXT NOT NULL DEFAULT '',
  periodEnd         TEXT NOT NULL DEFAULT '',
  /* JSON array of OccupierStatementRow, one per prescribed installation. */
  rows              TEXT NOT NULL DEFAULT '[]',
  signedBy          TEXT NOT NULL DEFAULT '',
  signedPosition    TEXT NOT NULL DEFAULT '',
  signature         TEXT,
  signedAt          TEXT,
  /* When the copy actually went to the Commissioner, against the ten working
     days the signing date starts running. */
  sentToCommissionerAt TEXT,
  createdAt         TEXT NOT NULL,
  updatedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_occupier_site ON occupier_statement(siteId, periodEnd DESC);
`;

/**
 * v6 — routine completions.
 *
 * The app recorded that individual assets were tested, and never that the
 * routine itself was carried out — so it could not answer the question a
 * technician and an office both ask first, which is what is due and when.
 *
 * The schedule is anchored to the earliest run held here, not the latest, so a
 * service done late does not move the next one. That is why every run is kept
 * rather than a single "last serviced" column being overwritten.
 */
export const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS routine_run (
  id              TEXT PRIMARY KEY NOT NULL,
  siteId          TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  routineId       TEXT NOT NULL,
  /* Denormalised so a run still reads correctly if a routine is retired. */
  routineLabel    TEXT NOT NULL DEFAULT '',
  frequency       TEXT NOT NULL DEFAULT '',
  system          TEXT NOT NULL DEFAULT '',
  completedAt     TEXT NOT NULL,
  technician      TEXT,
  /* What the run actually covered, so a thin run is visible as one. */
  checksPassed    INTEGER NOT NULL DEFAULT 0,
  checksFailed    INTEGER NOT NULL DEFAULT 0,
  checksNotTested INTEGER NOT NULL DEFAULT 0,
  defectsRaised   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_site ON routine_run(siteId, routineId, completedAt);
`;

/**
 * v7 — where an asset came from, when it is next due, and how fresh our copy is.
 *
 * Three things a real asset register needs that the original schema had no
 * room for.
 *
 * An external id, because a register is re-exported constantly and a re-import
 * has to be an update rather than a second copy of the building. Matching on
 * name and location cannot do that: two extinguishers in the same corridor are
 * indistinguishable by anything except the id the source system gave them.
 *
 * A schedule per routine, because one asset is due on several different cycles
 * at once — an extinguisher is six-monthly, yearly and five-yearly, each with
 * its own date — and a single nextDueAt can only hold the soonest, which loses
 * the other two.
 *
 * And a sync watermark per resource, because the office system changes daily.
 * Without a record of what was last seen, every sync is a full pull of every
 * site and every asset, which is slow enough that it stops being done.
 */
export const MIGRATION_V7 = `
ALTER TABLE asset ADD COLUMN externalId TEXT;
ALTER TABLE asset ADD COLUMN externalSource TEXT;
ALTER TABLE asset ADD COLUMN walkOrder INTEGER;
CREATE INDEX IF NOT EXISTS idx_asset_external ON asset(externalSource, externalId);
/* The walk is ordered within a site, which is how a technician moves through it. */
CREATE INDEX IF NOT EXISTS idx_asset_walk ON asset(siteId, walkOrder);

CREATE TABLE IF NOT EXISTS asset_schedule (
  id                TEXT PRIMARY KEY NOT NULL,
  assetId           TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  /* monthly | quarterly | six-monthly | annual | five-yearly | ten-yearly */
  frequency         TEXT NOT NULL,
  nextDueAt         TEXT,
  lastDoneAt        TEXT,
  /* day | month | year — a five-yearly test recorded as "Jun-25" knows no day,
     and inventing one moves the next one by up to a month. */
  lastDonePrecision TEXT,
  /* Exactly what the source said, kept because the parse is lossy. */
  lastDoneRaw       TEXT,
  source            TEXT NOT NULL DEFAULT 'register-import',
  createdAt         TEXT NOT NULL,
  updatedAt         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_schedule ON asset_schedule(assetId, frequency);
CREATE INDEX IF NOT EXISTS idx_asset_schedule_due ON asset_schedule(nextDueAt);

CREATE TABLE IF NOT EXISTS sync_state (
  resource         TEXT PRIMARY KEY NOT NULL,
  /* When a sync of this resource last completed without error. */
  lastSyncedAt     TEXT,
  /* The newest modification timestamp seen, which is where the next one starts. */
  lastChangeSeenAt TEXT,
  lastRecordCount  INTEGER NOT NULL DEFAULT 0,
  /* incremental | full — recorded because a server that ignores the filter
     silently turns an incremental sync into a full one, and the difference
     matters when deciding whether the local copy can be trusted. */
  mode             TEXT NOT NULL DEFAULT 'full',
  lastError        TEXT,
  updatedAt        TEXT NOT NULL
);
`;
