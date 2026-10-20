/**
 * Schema v17 — what a queued send is, and the three answers an inspector reads.
 *
 * `sync_queue.contentKey` names a queued item by its content rather than by
 * its row, so the same note queued twice is stored once, and a send whose
 * outcome is unknown can be recognised later by the marker it carried. See
 * domain/queueKey.
 *
 * The three report columns are the Queensland record-of-maintenance answers:
 * whether the maintenance complied with QDC MP 6.1, whether the installation
 * is in proper working order, and whether a hardcopy was left on site. The
 * screen asked them and printed them, and never saved them — leaving the
 * screen wiped the answers, and a PDF made on a later visit printed them
 * unanswered. Stored as 1/0/NULL, NULL meaning not answered, which for the
 * working-order question is a real third state.
 */

export const MIGRATION_V17 = `
ALTER TABLE sync_queue ADD COLUMN contentKey TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_key ON sync_queue(contentKey);

ALTER TABLE report ADD COLUMN qdcCompliance INTEGER;
ALTER TABLE report ADD COLUMN inProperWorkingOrder INTEGER;
ALTER TABLE report ADD COLUMN hardcopyLeftOnSite INTEGER;
`;
