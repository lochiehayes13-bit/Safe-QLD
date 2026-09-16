/**
 * Schema v27 — which Simpro job a Form 72 belongs to, and when its PDF went up.
 *
 * A Form 72 is the statutory record of a hydrant test and the office files it
 * against the job the test was done under. Until now that was somebody
 * emailing the PDF to themselves and attaching it by hand. The form now
 * carries the job, so the PDF can be queued onto the job's attachments the
 * moment the form is issued, and `attachedAt` says it has been — which is
 * the difference between "the office has it" and "I think I sent it".
 *
 * The job title is denormalised beside the id so the form still names the
 * job in words after the mirror has moved on.
 */

export const MIGRATION_V27 = `
ALTER TABLE form_72 ADD COLUMN jobExternalId TEXT;
ALTER TABLE form_72 ADD COLUMN jobTitle TEXT;
ALTER TABLE form_72 ADD COLUMN attachedAt TEXT;
CREATE INDEX IF NOT EXISTS idx_form_72_job ON form_72(jobExternalId);
`;
