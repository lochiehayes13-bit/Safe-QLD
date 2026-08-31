/**
 * SQLite schema for Safe QLD.
 *
 * Migrations are append-only: add a new entry, never edit an existing one, so
 * an app already installed on a tech's phone upgrades cleanly.
 */

export const SCHEMA_VERSION = 1;

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
];
