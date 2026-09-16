/**
 * v13 — the queue of work going back to the office, and what it already accepted.
 *
 * Two tables, and the split between them is the point.
 *
 * `outbound_accepted` is the record of keys the office system has taken. It is
 * the only thing standing between a retry and a duplicate service record, so it
 * is written the moment an item is accepted rather than at the end of a batch,
 * and it is never cleared. A key is small and a duplicated service record
 * double-counts in the office's compliance reporting, which nobody goes looking
 * for.
 *
 * `outbound_job_link` records which Simpro job a routine run was carried out
 * under. That link does not live on `routine_run` because a run is a record of
 * work done and stays true whether or not it was ever sent — bolting an
 * integration's field onto it would mean a routine service could not be
 * recorded at all on a site the office has not raised a job for, which is
 * exactly the site where the paperwork already goes missing.
 *
 * Neither table holds the note text. What went out is on the job in Simpro,
 * which is the record; keeping a second copy here would create two versions of
 * a document nobody reconciles.
 */
export const MIGRATION_V13 = `
CREATE TABLE IF NOT EXISTS outbound_accepted (
  /* The Safe QLD key: SRV-xxxxxxxx-xxxxxxxx or DEF-xxxxxxxx-xxxxxxxx. Its own
     primary key, because accepting the same key twice is the thing this table
     exists to make impossible. */
  key        TEXT PRIMARY KEY NOT NULL,
  /* The identity half, indexed on its own: "has this attendance been reported
     at all?" is a different question from "has this exact record been sent?",
     and the answer to the first is what makes an edit an amendment rather than
     a duplicate. */
  identity   TEXT NOT NULL,
  jobId      TEXT NOT NULL,
  /* Kept so a person can see what a key was without decoding it. */
  description TEXT NOT NULL DEFAULT '',
  urgency    TEXT NOT NULL DEFAULT 'routine',
  acceptedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_identity ON outbound_accepted(identity);
CREATE INDEX IF NOT EXISTS idx_outbound_job ON outbound_accepted(jobId, acceptedAt);

CREATE TABLE IF NOT EXISTS outbound_job_link (
  runId      TEXT PRIMARY KEY NOT NULL REFERENCES routine_run(id) ON DELETE CASCADE,
  jobId      TEXT NOT NULL,
  linkedAt   TEXT NOT NULL
);
`;
