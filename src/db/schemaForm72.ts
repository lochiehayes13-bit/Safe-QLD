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
 * tables would buy nothing and cost a join per part. What the office does ask
 * of a form — which site, when, whether it passed, who signed it, whether the
 * occupier has their copy — is a real column and is indexed.
 *
 * issuedAt is distinct from createdAt on purpose. A form in progress and a form
 * that has been given to a client are different things, and only the second one
 * is a statement anybody can be held to.
 *
 * Two columns are deliberately nullable where a boolean would have been easier.
 * Part H's questions have three states on the printed form: Yes, No, and nobody
 * ticked either. Defaulting the third to 0 would turn "unanswered" into "no
 * critical defects", which is the answer that decides whether an occupier is
 * given a statutory notice.
 */
export const MIGRATION_V12 = `
CREATE TABLE IF NOT EXISTS form_72 (
  id                        TEXT PRIMARY KEY NOT NULL,
  siteId                    TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  /* Denormalised so an issued form still reads correctly if the site is renamed. */
  siteName                  TEXT NOT NULL,
  siteAddress               TEXT NOT NULL DEFAULT '',
  contractor                TEXT NOT NULL DEFAULT '',
  /* Which system this form covers, where a site has more than one: "Towns Main
     System", "Boosted Hydrant System". Without it two forms for the same site
     on the same day are indistinguishable in a list. */
  systemLabel               TEXT NOT NULL DEFAULT '',
  testDate                  TEXT,
  testTime                  TEXT,

  /* Parts A to G. Read and written whole, never queried across. Each part
     carries its own na/pass/fail result inside its JSON, because the result
     belongs to the part — hoisted out, a form can disagree with itself. */
  maintenanceTest           TEXT NOT NULL DEFAULT '{}',
  hydrostatic               TEXT NOT NULL DEFAULT '{}',
  flowDeviceKinds           TEXT NOT NULL DEFAULT '[]',
  devices                   TEXT NOT NULL DEFAULT '[]',
  flowTest                  TEXT NOT NULL DEFAULT '{}',
  booster                   TEXT NOT NULL DEFAULT '{}',
  sprinklerHydrostatic      TEXT NOT NULL DEFAULT '{}',
  sprinklerFlow             TEXT NOT NULL DEFAULT '{}',

  /* The pump overload run — 150% of duty flow at 65% of duty pressure. The
     department's form has no box for it, so it sits beside the parts rather
     than inside one. Nullable because most jobs do not run it, and never
     defaulted to zero: a pump recorded as making 0 kPa at overload reads as a
     catastrophic failure rather than as a test not done. */
  overloadFlowLps           REAL,
  overloadPressureKpa       REAL,

  /* Part H. Null is a real state — unanswered is not the same as "no". */
  criticalDefectsIdentified INTEGER,
  repairsRequired           INTEGER,
  systemResult              TEXT NOT NULL DEFAULT 'na',
  systemNotes               TEXT NOT NULL DEFAULT '',

  /* Part I. The form is a statement by a licensed person and is not valid
     without the licence number. Stored on the form rather than read from
     settings at print time — the licence held today is not necessarily the one
     that signed. */
  licenseeName              TEXT NOT NULL DEFAULT '',
  licenceNumber             TEXT NOT NULL DEFAULT '',
  licenseeReportNumber      TEXT NOT NULL DEFAULT '',
  signature                 TEXT NOT NULL DEFAULT '',

  /* draft | issued. Only an issued form is a statement anybody can be held to. */
  status                    TEXT NOT NULL DEFAULT 'draft',
  issuedAt                  TEXT,
  /* When the client was given their copy, which is a separate obligation:
     QDC MP 6.1 A4(b) runs ten business days from completing the work, and
     producing the PDF is not the same event as handing it over. */
  copyGivenAt               TEXT,

  createdAt                 TEXT NOT NULL,
  updatedAt                 TEXT NOT NULL
);
/* The list a technician opens: this site's forms. */
CREATE INDEX IF NOT EXISTS idx_form_72_site ON form_72(siteId, testDate);
/* "Which forms are still to go out?" — the query behind the occupier copy
   deadline, across every site. */
CREATE INDEX IF NOT EXISTS idx_form_72_outstanding ON form_72(status, copyGivenAt);
`;
