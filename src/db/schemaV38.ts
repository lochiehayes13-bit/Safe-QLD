/**
 * Schema v38 — the office archived this building.
 *
 * Simpro's site list does not return an archived site. The sync reads
 * `sites/`, writes what comes back, and an archived building is simply absent
 * — so it is absent from the site list, the pickers, the map, the search, and
 * every form that starts from a site. Nothing anywhere says why. A technician
 * searches for it, is told "Nothing matched", and concludes they have mistyped
 * the name of a building they have stood in.
 *
 * This repository already knew that, in one comment, about one building: the
 * note on `describeMissingSites` says "the sites endpoint does not return an
 * archived site, the assets endpoint happily returns its assets, and nothing
 * about pulling again changes that". Fifteen assets with nowhere to live.
 *
 * So the sync now asks for the archived ones too, and this is where the answer
 * goes. Three states, not two:
 *
 *   NULL  — nobody has asked. Every site held before this migration, and every
 *           site typed in on a phone. Not the same as "live", and must not
 *           print as either.
 *   0     — the office's list returned it as a current site.
 *   1     — the office has archived it.
 *
 * An archived site stays findable. That is the whole point: the work in its
 * logbook happened, the assets under it are still in the building, and a
 * technician sent there needs to find it. It is marked, not hidden — a search
 * that silently drops rows is the fault this is fixing, and hiding archived
 * ones would be the same fault wearing a better excuse.
 */
export const MIGRATION_V38 = `
  ALTER TABLE site ADD COLUMN archived INTEGER;
`;
