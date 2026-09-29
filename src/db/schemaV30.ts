/**
 * Schema v30 — safe work method statements, as signed on the day.
 *
 * The company's method statements are seed data: they ship with the app and
 * change when the company changes them. What is stored here is the other half —
 * one crew, one site, one day, and their signatures.
 *
 * The shape follows the Form 72's: the parts that are lists live as JSON and
 * are read back through guards, and the two things the office asks about
 * afterwards — which Simpro job it belongs to and whether the signed PDF
 * actually reached it — are columns of their own so they can be indexed and
 * answered without parsing anything.
 *
 * `date` is the Queensland calendar day the work is being done, not the instant
 * the row was written. A statement signed at 5:30am UTC is for that day here,
 * and a row that stored the instant would file half the winter's statements
 * against the day before.
 */

export const MIGRATION_V30 = `
CREATE TABLE IF NOT EXISTS swms (
  id             TEXT PRIMARY KEY NOT NULL,
  templateIds    TEXT NOT NULL,
  title          TEXT NOT NULL,
  siteId         TEXT,
  siteName       TEXT,
  jobExternalId  TEXT,
  jobTitle       TEXT,
  date           TEXT NOT NULL,
  supervisor     TEXT,
  supervisorPhone TEXT,
  answers        TEXT NOT NULL,
  addedHazards   TEXT NOT NULL,
  ticked         TEXT NOT NULL,
  ppeChecked     TEXT NOT NULL,
  permits        TEXT NOT NULL,
  workers        TEXT NOT NULL,
  status         TEXT NOT NULL,
  signedAt       TEXT,
  attachedAt     TEXT,
  notes          TEXT,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swms_date ON swms(date);
CREATE INDEX IF NOT EXISTS idx_swms_site ON swms(siteId);
CREATE INDEX IF NOT EXISTS idx_swms_job ON swms(jobExternalId);
`;
