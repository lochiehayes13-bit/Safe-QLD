/**
 * Schema v29 — the impairment notice, filed on the job it belongs to.
 *
 * An impairment is the one record here that somebody outside this company has
 * to be handed. A sprinkler valve is shut, a panel is isolated, a pump is
 * off — and the building's responsible person is now carrying a risk they did
 * not have this morning. The record already tracked who was told and what was
 * put in place instead; what it could not do was produce the piece of paper
 * that says so, or get that paper anywhere near the office.
 *
 * So it takes the same three columns v28 gave the report, the baseline, the
 * assessment and the occupier statement: which Simpro job it belongs to, the
 * job's title kept beside it so the record still names the job in words after
 * the mirror has moved on, and when the notice actually went up.
 *
 * `noticeIssuedAt` is separate from `attachedAt` on purpose. Handing the
 * responsible person a notice on site and getting the file to the office are
 * different obligations that fail in different ways, and a record that
 * collapsed them would report the second as though it were the first.
 */

export const MIGRATION_V29 = `
ALTER TABLE impairment ADD COLUMN jobExternalId TEXT;
ALTER TABLE impairment ADD COLUMN jobTitle TEXT;
ALTER TABLE impairment ADD COLUMN attachedAt TEXT;
ALTER TABLE impairment ADD COLUMN noticeIssuedAt TEXT;
CREATE INDEX IF NOT EXISTS idx_impairment_job ON impairment(jobExternalId);
`;
