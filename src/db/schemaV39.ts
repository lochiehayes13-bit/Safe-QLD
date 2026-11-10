/**
 * Schema v39 — which queue row carries a Form 72's PDF to the job.
 *
 * `attachedAt` (v27) was stamped the moment the PDF was queued, and never
 * touched again. So an upload that was abandoned — the file gone from the
 * cache, the server refusing the size, a reply that never came — left the
 * form saying "On the job" about a job that had nothing. The office rang, the
 * technician looked at a green chip, and both were right by their own records.
 *
 * The queue row is the truth about whether the file went, and it already
 * holds every state: pending, sending, sent, failed, unknown. So the form
 * remembers which row it queued, and the screen reads that row's status
 * rather than a timestamp of the moment the queueing happened. `attachedAt`
 * stays as the time it was queued; this says what became of it.
 *
 * NULL for every form queued before this migration, which the screen treats
 * as it did before: queued, by the timestamp. Nothing older is rewritten.
 */
export const MIGRATION_V39 = `
  ALTER TABLE form_72 ADD COLUMN attachmentQueueId TEXT;
`;
