/**
 * Schema v20 — what the office says about a site, on the site.
 *
 * The site row the sync writes carried an address, a contact and a client
 * name, and nothing else the office holds about the building. Two things it
 * holds are asked for on the doorstep and were on no screen:
 *
 * **The public notes.** "Park in visitor bay 3", "sign in at reception",
 * "the panel is behind the cafe" — the office writes these on the site record
 * for exactly the person standing outside it. Plain text: the office's HTML
 * is stripped on the way in, like a job's description. The private notes are
 * not held; they are the office's.
 *
 * **The customer number.** The site screen worked out who the customer was
 * from the jobs and quotes at the site, and a site with no job yet had no
 * customer to open. The office's own site record names the customer outright.
 *
 * `detailSyncedAt` says when the site's own record was last read, the way
 * `job.detailSyncedAt` does for a job, so a screen that opens the site does
 * not read it again within the quarter hour.
 */

export const MIGRATION_V20 = `
ALTER TABLE site ADD COLUMN publicNotes TEXT;
ALTER TABLE site ADD COLUMN customerExternalId TEXT;
ALTER TABLE site ADD COLUMN detailSyncedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_site_customer_external ON site(customerExternalId);
`;
