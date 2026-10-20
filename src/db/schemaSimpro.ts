/**
 * Schema v14 — what the office already knows about a site.
 *
 * Reports have always printed Contact, Mobile and Email rows and those rows
 * have always been blank. Not because the office lacks the detail — it holds a
 * primary contact for roughly two thirds of its sites — but because the sync
 * never asked Simpro for the field and the site table had nowhere to put it.
 *
 * The contact is stored on the site rather than in a table of its own because
 * that is the shape the source has: one primary contact per site, replaced
 * wholesale when the office edits it. A contacts table would imply a history
 * nobody keeps and an ordering nobody sets.
 *
 * `externalId` and `externalSource` are separate from the primary key on
 * purpose. Sites can arrive from a CSV import or be created on site by a
 * technician, and those have no Simpro ID; matching on a nullable pair keeps
 * the local id stable and lets a later sync adopt a site that already exists.
 */

export const MIGRATION_V14 = `
ALTER TABLE site ADD COLUMN contactName TEXT;
ALTER TABLE site ADD COLUMN contactEmail TEXT;
ALTER TABLE site ADD COLUMN contactWorkPhone TEXT;
ALTER TABLE site ADD COLUMN contactMobile TEXT;

/* Where this site came from, so a re-sync updates rather than duplicates. */
ALTER TABLE site ADD COLUMN externalId TEXT;
ALTER TABLE site ADD COLUMN externalSource TEXT;

CREATE INDEX IF NOT EXISTS idx_site_external ON site(externalSource, externalId);
`;
