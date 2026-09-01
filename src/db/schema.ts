/**
 * SQLite schema for Safe QLD.
 *
 * Migrations are append-only: add a new entry, never edit an existing one, so
 * an app already installed on a tech's phone upgrades cleanly.
 */

import {
  MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6, MIGRATION_V7, MIGRATION_V8,
} from './schemaV3';

export const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS site (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    address     TEXT,
    suburb      TEXT,
    state       TEXT,
    postcode    TEXT,
    clientName  TEXT,
    siteRef     TEXT,
    notes       TEXT,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS panel (
    id          TEXT PRIMARY KEY NOT NULL,
    siteId      TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    brand       TEXT NOT NULL,
    model       TEXT,
    nodeNumber  INTEGER,
    location    TEXT,
    firmware    TEXT,
    source      TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_panel_site ON panel(siteId);

  CREATE TABLE IF NOT EXISTS loop (
    id               TEXT PRIMARY KEY NOT NULL,
    panelId          TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE,
    number           INTEGER NOT NULL,
    label            TEXT,
    protocol         TEXT,
    measuredCurrentMa REAL
  );
  CREATE INDEX IF NOT EXISTS idx_loop_panel ON loop(panelId);

  CREATE TABLE IF NOT EXISTS zone (
    id       TEXT PRIMARY KEY NOT NULL,
    panelId  TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE,
    number   INTEGER NOT NULL,
    text     TEXT NOT NULL DEFAULT '',
    text2    TEXT,
    type     TEXT,
    unused   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_zone_panel ON zone(panelId);
  CREATE INDEX IF NOT EXISTS idx_zone_number ON zone(panelId, number);

  CREATE TABLE IF NOT EXISTS point (
    id             TEXT PRIMARY KEY NOT NULL,
    panelId        TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE,
    loopNumber     INTEGER,
    address        INTEGER,
    subAddress     INTEGER,
    pointRef       TEXT,
    text           TEXT NOT NULL DEFAULT '',
    text2          TEXT,
    deviceTypeRaw  TEXT,
    deviceType     TEXT NOT NULL DEFAULT 'unknown',
    zoneNumber     INTEGER,
    zoneText       TEXT,
    unused         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_point_panel ON point(panelId);
  CREATE INDEX IF NOT EXISTS idx_point_loop ON point(panelId, loopNumber, address);
  CREATE INDEX IF NOT EXISTS idx_point_zone ON point(panelId, zoneNumber);

  CREATE TABLE IF NOT EXISTS ce_rule (
    id               TEXT PRIMARY KEY NOT NULL,
    panelId          TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE,
    causeLabel       TEXT NOT NULL,
    causeKind        TEXT NOT NULL,
    causeZoneNumber  INTEGER,
    causePointRef    TEXT,
    sourceLogic      TEXT,
    notes            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ce_panel ON ce_rule(panelId);

  CREATE TABLE IF NOT EXISTS ce_effect (
    id            TEXT PRIMARY KEY NOT NULL,
    ruleId        TEXT NOT NULL REFERENCES ce_rule(id) ON DELETE CASCADE,
    effectLabel   TEXT NOT NULL,
    effectKind    TEXT NOT NULL,
    delaySeconds  INTEGER,
    state         TEXT NOT NULL DEFAULT 'operates'
  );
  CREATE INDEX IF NOT EXISTS idx_ceeffect_rule ON ce_effect(ruleId);

  CREATE TABLE IF NOT EXISTS report (
    id                   TEXT PRIMARY KEY NOT NULL,
    siteId               TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    panelId              TEXT REFERENCES panel(id) ON DELETE SET NULL,
    title                TEXT NOT NULL,
    frequency            TEXT NOT NULL,
    serviceDate          TEXT NOT NULL,
    technicianName       TEXT,
    technicianLicence    TEXT,
    companyName          TEXT,
    witnessName          TEXT,
    signatureTechnician  TEXT,
    signatureWitness     TEXT,
    status               TEXT NOT NULL DEFAULT 'draft',
    notes                TEXT,
    createdAt            TEXT NOT NULL,
    updatedAt            TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_report_site ON report(siteId);

  CREATE TABLE IF NOT EXISTS test_row (
    id          TEXT PRIMARY KEY NOT NULL,
    reportId    TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    pointId     TEXT,
    pointRef    TEXT,
    loopNumber  INTEGER,
    address     INTEGER,
    zoneNumber  INTEGER,
    zoneText    TEXT,
    deviceText  TEXT NOT NULL DEFAULT '',
    deviceType  TEXT NOT NULL DEFAULT 'unknown',
    result      TEXT NOT NULL DEFAULT 'untested',
    method      TEXT,
    comment     TEXT,
    testedAt    TEXT,
    sortIndex   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_testrow_report ON test_row(reportId, sortIndex);

  CREATE TABLE IF NOT EXISTS check_row (
    id         TEXT PRIMARY KEY NOT NULL,
    reportId   TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    section    TEXT NOT NULL,
    label      TEXT NOT NULL,
    result     TEXT NOT NULL DEFAULT 'untested',
    value      TEXT,
    unit       TEXT,
    comment    TEXT,
    sortIndex  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_checkrow_report ON check_row(reportId, sortIndex);

  CREATE TABLE IF NOT EXISTS defect (
    id           TEXT PRIMARY KEY NOT NULL,
    siteId       TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    reportId     TEXT REFERENCES report(id) ON DELETE SET NULL,
    pointId      TEXT,
    location     TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    severity     TEXT NOT NULL DEFAULT 'non-critical',
    status       TEXT NOT NULL DEFAULT 'open',
    raisedAt     TEXT NOT NULL,
    rectifiedAt  TEXT,
    photos       TEXT NOT NULL DEFAULT '[]',
    notes        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_defect_site ON defect(siteId, status);
  `,

  // v2 — Safe QLD baseline data, timesheets and the device catalogue
  `
  CREATE TABLE IF NOT EXISTS baseline (
    id                      TEXT PRIMARY KEY NOT NULL,
    siteId                  TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    premisesName            TEXT NOT NULL DEFAULT '',
    premisesAddress         TEXT NOT NULL DEFAULT '',
    installType             TEXT NOT NULL DEFAULT '',
    alterationDetails       TEXT NOT NULL DEFAULT '',
    systemType              TEXT NOT NULL DEFAULT '',
    owsAmplifier            TEXT NOT NULL DEFAULT '',
    monitoringProvider      TEXT NOT NULL DEFAULT '',
    speakerCircuits         TEXT NOT NULL DEFAULT '[]',
    equipment               TEXT NOT NULL DEFAULT '{}',
    fullAlarmCurrentA       TEXT NOT NULL DEFAULT '',
    quiescentCurrentA       TEXT NOT NULL DEFAULT '',
    primaryPowerV           TEXT NOT NULL DEFAULT '',
    batteryVoltage          TEXT NOT NULL DEFAULT '',
    batteryAh               TEXT NOT NULL DEFAULT '',
    batteryStandbyHours     TEXT NOT NULL DEFAULT '',
    batteryManufactureDate  TEXT NOT NULL DEFAULT '',
    batteryInstallDate      TEXT NOT NULL DEFAULT '',
    confirmations           TEXT NOT NULL DEFAULT '{}',
    zoneResults             TEXT NOT NULL DEFAULT '[]',
    testerNames             TEXT NOT NULL DEFAULT '',
    testDate                TEXT NOT NULL DEFAULT '',
    createdAt               TEXT NOT NULL,
    updatedAt               TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_baseline_site ON baseline(siteId);

  CREATE TABLE IF NOT EXISTS timesheet (
    id                 TEXT PRIMARY KEY NOT NULL,
    employeeName       TEXT NOT NULL DEFAULT '',
    vehicleRego        TEXT NOT NULL DEFAULT '',
    kilometerReading   TEXT NOT NULL DEFAULT '',
    weekStarting       TEXT NOT NULL,
    entries            TEXT NOT NULL DEFAULT '[]',
    employeeSignature  TEXT,
    managerName        TEXT NOT NULL DEFAULT '',
    checkedBy          TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'draft',
    createdAt          TEXT NOT NULL,
    updatedAt          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_timesheet_week ON timesheet(weekStarting DESC);

  CREATE TABLE IF NOT EXISTS catalogue_item (
    id            TEXT PRIMARY KEY NOT NULL,
    partNumber    TEXT NOT NULL,
    name          TEXT NOT NULL,
    brand         TEXT NOT NULL,
    supplier      TEXT,
    category      TEXT NOT NULL DEFAULT 'other',
    subcategory   TEXT,
    description   TEXT,
    voltage       TEXT,
    quiescentMa   REAL,
    alarmMa       REAL,
    protocol      TEXT,
    dbAt1m        REAL,
    ipRating      TEXT,
    standards     TEXT,
    notes         TEXT,
    sourceUrl     TEXT,
    confidence    TEXT NOT NULL DEFAULT 'medium',
    /* Lowercased haystack of part number, name, brand and description, so
       search is a single indexed LIKE rather than four ORed columns. */
    searchText    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_cat_search ON catalogue_item(searchText);
  CREATE INDEX IF NOT EXISTS idx_cat_brand ON catalogue_item(brand, category);
  CREATE INDEX IF NOT EXISTS idx_cat_category ON catalogue_item(category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_unique ON catalogue_item(brand, partNumber);
  `,

  // v3 — universal asset, test and defect engines
  MIGRATION_V3,

  // v4 — Queensland statutory fields on a defect
  MIGRATION_V4,

  // v5 — the annual occupier statement
  MIGRATION_V5,

  // v6 — routine completions, so the app can say what is due
  MIGRATION_V6,
  MIGRATION_V7,

  // v8 — the rate card, pulled from the office system rather than typed
  MIGRATION_V8,
];

/**
 * How many migrations exist, which is what the runner writes to user_version.
 *
 * Derived rather than declared: this was a hand-maintained 4 while five
 * migrations existed, and a constant that can disagree with the thing it counts
 * is worse than no constant.
 */
export const SCHEMA_VERSION = MIGRATIONS.length;
