/**
 * Schema v28 — the documents this app makes, filed on the job they belong to.
 *
 * Fifteen screens here produce a document and, until now, exactly one of them
 * — the Form 72 — could put its own file on the Simpro job. Everything else
 * ended at the share sheet, which in practice means the office received it if
 * somebody remembered to email it to themselves afterwards.
 *
 * So the service report, the baseline record, the effectiveness assessment and
 * the occupier statement each gain the three columns the Form 72 got in v27:
 * which job it belongs to, that job's title denormalised beside it so the
 * record still names the job in words after the mirror has moved on, and when
 * the file actually went. `attachedAt` is the one that matters — "the office
 * has it" and "I think I sent it" are different states, and only one of them
 * lets a technician stop worrying.
 *
 * A note on the report's job number. It already had `jobNumber`, and that
 * column stays exactly what it was: free text the technician types, printed at
 * the top of the customer's copy. It is not an id and must never be used as
 * one — it can hold anything, including a purchase order number or a note to
 * themselves. `jobExternalId` is Simpro's own id, set only by picking a job.
 * Conflating the two would post attachments to whatever number somebody typed.
 *
 * The defect gains a priority. The picker has offered Critical, High, Medium
 * and Low since it was written, and the record only ever held critical or
 * non-critical — so High, Medium and Low all landed identically and the grade
 * a technician chose was thrown away between the screen and the row. Critical
 * stays where it is, in `severity`, because the statutory tests hang off it;
 * `priority` carries the rest.
 */

export const MIGRATION_V28 = `
ALTER TABLE report ADD COLUMN jobExternalId TEXT;
ALTER TABLE report ADD COLUMN jobTitle TEXT;
ALTER TABLE report ADD COLUMN attachedAt TEXT;
CREATE INDEX IF NOT EXISTS idx_report_job ON report(jobExternalId);

ALTER TABLE baseline ADD COLUMN jobExternalId TEXT;
ALTER TABLE baseline ADD COLUMN jobTitle TEXT;
ALTER TABLE baseline ADD COLUMN attachedAt TEXT;

ALTER TABLE occupier_statement ADD COLUMN jobExternalId TEXT;
ALTER TABLE occupier_statement ADD COLUMN jobTitle TEXT;
ALTER TABLE occupier_statement ADD COLUMN attachedAt TEXT;

ALTER TABLE assessment ADD COLUMN jobExternalId TEXT;
ALTER TABLE assessment ADD COLUMN jobTitle TEXT;
ALTER TABLE assessment ADD COLUMN attachedAt TEXT;

ALTER TABLE defect ADD COLUMN priority TEXT;
`;
