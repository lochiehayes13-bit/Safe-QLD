/**
 * Schema v25 — the office's status id on the job row.
 *
 * The mirror kept the status name and colour but not the id, and the id is
 * what a PATCH takes. So the job card's Change status picker joined the
 * names it had seen to a list of ids read off the office once and pinned in
 * code, which is right until the office adds a status or renames one: from
 * then on the pinned list is quietly wrong, and a status the office uses
 * every day cannot be sent because no line in a source file mentions it.
 *
 * The id is on the row now, taken from the same Status object the name and
 * colour already came from, so every status any mirrored job wears is
 * sendable whether or not anybody has pinned it. The pinned list stays as
 * the fallback for a status no job on this phone has worn yet.
 */

export const MIGRATION_V25 = `
ALTER TABLE job ADD COLUMN statusId TEXT;
CREATE INDEX IF NOT EXISTS idx_job_status_id ON job(statusId);
`;
