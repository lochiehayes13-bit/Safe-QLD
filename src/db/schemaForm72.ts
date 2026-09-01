/**
 * v12 — Form 72, the Queensland statutory hydrant and sprinkler form.
 *
 * A licensee signs this one and their QBCC or PIC licence number goes on it, so
 * it is kept as a record in its own right rather than regenerated from the
 * assets each time it is printed. What was measured on the day is what the form
 * says, and a later change to the site must not silently rewrite a document
 * somebody already put their name to.
 *
 * The parts that are lists — the gauges, the flow rows, the sprinkler test
 * points — are stored as JSON in one column each. They are only ever read and
 * written whole, as a part of the form, and never queried across, so separate
 * tables would buy nothing and cost a join per part.
 *
 * issuedAt is distinct from createdAt on purpose. A form in progress and a form
 * that has been given to a client are different things, and only the second one
 * is a statement anybody can be held to.
 */
export const MIGRATION_V12 = `
CREATE TABLE IF NOT EXISTS form_72 (
  id                        TEXT PRIMARY KEY NOT NULL,
  siteId                    TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  /* Denormalised so an issued form still reads correctly if the site is renamed. */
  siteName                  TEXT NOT NULL,
  siteAddress               TEXT NOT NULL DEFAULT '',
  contractor                TEXT NOT NULL DEFAULT '',
  /* Which system this form covers, where a site has more than one. */
  systemLabel               TEXT NOT NULL DEFAULT '',
  testDate                  TEXT,
  testTime                  TEXT,

  /* Parts A to G. Read and written whole, never queried across. */
  maintenanceTest           TEXT NOT NULL DEFAULT '{}',
  hydrostatic               TEXT NOT NULL DEFAULT '{}',
  flowDeviceKinds           TEXT NOT NULL DEFAULT '[]',
  devices                   TEXT NOT NULL DEFAULT '[]',
  flowTest                  TEXT NOT NULL DEFAULT '{}',
  booster                   TEXT NOT NULL DEFAULT '{}',
  sprinklerHydrostatic      TEXT NOT NULL DEFAULT '{}',
  sprinklerFlow             TEXT NOT NULL DEFAULT '{}',

  /* The duty the pump overload run was assessed against, kept because the
     block plan it came from can change and the form must not move with it. */
  overloadFlowLps           REAL,
  overloadPressureKpa       REAL,

  /* Part H. Null is a real state — unanswered is not the same as "no". */
  criticalDefectsIdentified INTEGER,
  repairsRequired           INTEGER,
  systemResult              TEXT NOT NULL DEFAULT 'na',
  systemNotes               TEXT NOT NULL DEFAULT '',

  /* Part I. The form is a statement by a licensed person and is not valid
     without the licence number. */
  licenseeName              TEXT NOT NULL DEFAULT '',
  licenceNumber             TEXT NOT NULL DEFAULT '',
  licenseeReportNumber      TEXT NOT NULL DEFAULT '',
  signature                 TEXT NOT NULL DEFAULT '',

  /* draft | issued. Only an issued form is a statement anybody can be held to. */
  status                    TEXT NOT NULL DEFAULT 'draft',
  issuedAt                  TEXT,
  /* When the client was given their copy, which is a separate obligation. */
  copyGivenAt               TEXT,

  createdAt                 TEXT NOT NULL,
  updatedAt                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_72_site ON form_72(siteId, testDate);
`;
