/**
 * Schema v33 — which Simpro job a defect belongs to, and when the office took it.
 *
 * Two columns, and both of them are questions a technician is already being
 * asked and cannot presently answer from the phone.
 *
 * **jobId.** A defect is raised against a site, and it always has been. The
 * office does not work in sites, it works in jobs — a defect that is not on a
 * job is not scheduled, not quoted and not invoiced, so the only way a rectify
 * gets booked today is somebody phoning it through and the office typing it in
 * again. The site column cannot stand in for this: a shopping centre has half a
 * dozen jobs open at once and "the fault at Level 2" against the site names
 * none of them. Holding Simpro's own job id on the row is what lets the note go
 * up on the right job, and lets the technician see afterwards which job it went
 * to rather than trusting that it did. It is Simpro's id and nothing else — not
 * the job number somebody typed, which is free text and can be a purchase order
 * or a note to themselves, the same trap v28 wrote down for the report.
 *
 * **sentToOfficeAt.** "Has the office got this?" is the last thing a technician
 * wonders about before driving off, and right now the honest answer is that
 * nobody knows. The defect exists on the phone; whether its note reached Simpro
 * is not recorded anywhere, so there is no way to tell a note that went from one
 * that failed in a tunnel and was dropped. Stamped, it separates the two states,
 * and a defect that never went can be sent again rather than told about twice.
 * It is the moment the office accepted the note, not the moment the phone queued
 * it — a queued note on a phone in a basement carpark has not reached anybody.
 *
 * Both are nullable with no DEFAULT, so every defect already on a phone reads
 * back exactly as it did: no job, and never sent. That is a deliberate
 * departure from the statutory columns in v4, which used NOT NULL DEFAULT
 * because a missing limb had to read as "not ticked" rather than "unknown".
 * Here the distinction is worth keeping — a defect raised before this shipped
 * genuinely has no job, and writing one in would be inventing a fact.
 */

export const MIGRATION_V33 = `
ALTER TABLE defect ADD COLUMN jobId TEXT;
ALTER TABLE defect ADD COLUMN sentToOfficeAt TEXT;
`;
