/**
 * v12 — Form 72, the statutory hydrant and sprinkler form.
 *
 * A Form 72 is not a service report with different headings. It is the document
 * QDC MP 6.1 requires a licensee to complete and give to the building occupier
 * within 10 business days of the maintenance, and to keep for five years after
 * it. That lifecycle is why it gets its own table rather than a column on the
 * service report: a report can be edited, and a form somebody has signed and
 * handed over cannot.
 *
 * The parts are stored as JSON and the office's questions are stored as
 * columns. Part B alone has six boxes and Part D has fifteen; a column for each
 * printed box would be sixty-odd columns whose only reader is the printer, and
 * every future version of the department's form would be a migration of them.
 * Nothing queries "the end of test pressure" across sites. What is queried —
 * which site, when, whether it passed, who signed it, whether the occupier has
 * their copy — is a real column and can be indexed.
 *
 * Two columns are deliberately nullable where a boolean would have been easier.
 * criticalDefectsIdentified and repairsRequired have three states on the
 * printed form: Yes, No, and nobody ticked either. Defaulting the third to 0
 * would turn "unanswered" into "no critical defects", which is the answer that
 * decides whether an occupier is given a statutory notice.
 */

export const MIGRATION_V12 = `
CREATE TABLE IF NOT EXISTS form_72 (
  id             TEXT PRIMARY KEY NOT NULL,
  siteId         TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,

  /* Denormalised from the site so an issued form reprints exactly as it was
     issued. The occupier's copy cannot be edited by renaming a site here. */
  siteName       TEXT NOT NULL DEFAULT '',
  siteAddress    TEXT NOT NULL DEFAULT '',
  contractor     TEXT NOT NULL DEFAULT '',

  /* The descriptor the department's form carries in its top right corner:
     "Towns Main System", "Boosted Hydrant System". One site routinely needs a
     form for each, and without this two forms for the same site on the same day
     are indistinguishable in a list. */
  systemLabel    TEXT NOT NULL DEFAULT '',

  /* ISO date and free text time, as Part A asks for them. */
  testDate       TEXT,
  testTime       TEXT,

  /* Part A's six tick boxes as JSON: hydrant/sprinkler/combined by annual and
     five-yearly. More than one can be ticked on a combined job. */
  maintenanceTest TEXT NOT NULL DEFAULT '{}',

  /* Parts B and D to G, each as the JSON of its domain interface. Each carries
     its own na/pass/fail result inside it, because the result belongs to the
     part and a form with the part results hoisted out of them can disagree with
     itself. */
  hydrostatic          TEXT NOT NULL DEFAULT '{}',
  flowDeviceKinds      TEXT NOT NULL DEFAULT '[]',
  devices              TEXT NOT NULL DEFAULT '[]',
  flowTest             TEXT NOT NULL DEFAULT '{}',
  booster              TEXT NOT NULL DEFAULT '{}',
  sprinklerHydrostatic TEXT NOT NULL DEFAULT '{}',
  sprinklerFlow        TEXT NOT NULL DEFAULT '{}',

  /* The overload run — 150% of duty flow at 65% of duty pressure. The
     department's form has no box for it, so it is stored beside the form
     rather than inside a part, and it is nullable because most jobs do not run
     it. Never defaulted to zero: a pump recorded as making 0 kPa at overload
     would read as a catastrophic failure rather than as a test not done. */
  overloadFlowLps     REAL,
  overloadPressureKpa REAL,

  /* Part H. Nullable on purpose — see the header comment. 1 = Yes, 0 = No,
     NULL = the question has not been answered. */
  criticalDefectsIdentified INTEGER,
  repairsRequired           INTEGER,
  /* na | pass | fail. */
  systemResult   TEXT NOT NULL DEFAULT 'na',
  systemNotes    TEXT NOT NULL DEFAULT '',

  /* Part I. The licence number is what makes the form a statement by a licensed
     person, so it is stored on the form and not looked up from settings at
     print time — the licence held today is not necessarily the one that signed. */
  licenseeName         TEXT NOT NULL DEFAULT '',
  licenceNumber        TEXT NOT NULL DEFAULT '',
  licenseeReportNumber TEXT NOT NULL DEFAULT '',
  signature            TEXT NOT NULL DEFAULT '',

  /* draft | issued. Only a draft may be edited. The rules about what may be
     issued live in domain/form72.ts; this column records the outcome. */
  status         TEXT NOT NULL DEFAULT 'draft',
  issuedAt       TEXT,

  /* When the occupier was actually given their copy, which is the fact MP 6.1
     A4(b) hangs on. Stored rather than inferred from issuedAt: producing the
     PDF and handing it over are different events, and the ten business days
     run against the second one. */
  copyGivenAt    TEXT,

  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);

/* The list a technician opens: this site's forms, most recent first. */
CREATE INDEX IF NOT EXISTS idx_form72_site ON form_72(siteId, testDate DESC);

/* "Which forms are still to go out?" — the query behind the occupier copy
   deadline, across every site. */
CREATE INDEX IF NOT EXISTS idx_form72_outstanding ON form_72(status, copyGivenAt);
`;
