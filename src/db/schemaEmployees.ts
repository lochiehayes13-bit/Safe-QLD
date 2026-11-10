/**
 * Schema v16 — who works here, and where the office has put them.
 *
 * Until now the app knew nothing about the person holding it beyond a name
 * typed into Settings, and nothing about the office's schedule at all. Both
 * come from Simpro and both are small — a few dozen employees, a few hundred
 * schedule blocks in a month — so both are replaced wholesale on every sync
 * rather than merged. A person who leaves, or a block moved to somebody else,
 * has to disappear here too; a stale row in either table sends a technician
 * to the wrong building.
 *
 * The employee id is Simpro's own, used as the primary key rather than
 * wrapped in a local one, because the only thing the app ever does with it is
 * hand it back to Simpro: on a schedule filter, or in a preference saying
 * "this phone is employee 12".
 *
 * A schedule row carries the Simpro job number rather than a local job id.
 * The two syncs are independent, and the schedule of a job the job sync has
 * not reached yet is still where the office expects the technician to be.
 * The day screen resolves the number to a local job when it can.
 */

export const MIGRATION_V16 = `
CREATE TABLE IF NOT EXISTS employee (
  id        TEXT PRIMARY KEY NOT NULL,
  name      TEXT NOT NULL,
  email     TEXT,
  phone     TEXT,
  position  TEXT,
  /* Kept rather than dropped, so a phone set to somebody who has since left
     can be told so instead of quietly matching nothing. */
  archived  INTEGER NOT NULL DEFAULT 0,
  syncedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_name ON employee(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS schedule (
  id         TEXT PRIMARY KEY NOT NULL,
  /* Simpro's job number, not a local job id. See the note above. */
  jobId      TEXT,
  staffId    TEXT,
  staffName  TEXT,
  /* The calendar day Simpro scheduled it on, yyyy-mm-dd. A day, not an instant. */
  date       TEXT NOT NULL,
  startTime  TEXT,
  endTime    TEXT,
  type       TEXT,
  syncedAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);
CREATE INDEX IF NOT EXISTS idx_schedule_staff ON schedule(staffId, date);
CREATE INDEX IF NOT EXISTS idx_schedule_staff_name ON schedule(staffName COLLATE NOCASE, date);
`;
