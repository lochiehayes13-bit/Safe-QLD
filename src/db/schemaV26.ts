/**
 * Schema v26 — the office's own cable tables.
 *
 * The cable sizing calculator does the arithmetic of AS/NZS 3008 and ships
 * none of its figures: those tables are the licensed part of a document the
 * company buys per copy, and this repository is public. So the figures live
 * here instead, typed or pasted in once from the office's own copy or from a
 * manufacturer's catalogue, and exported as a CSV to reach every other phone.
 *
 * Three tables, and the shape follows how the standard's own tables are laid
 * out rather than how a database would prefer them:
 *
 *  - `cable_table` is one cable construction installed one way, which is what
 *    a printed table is. Its `source` is not nullable, because a capacity
 *    figure nobody can account for is worthless the moment somebody asks.
 *  - `cable_rating` is one size down that table.
 *  - `cable_derating` is a factor read out of the derating tables, kept apart
 *    because a grouping factor applies across every cable type rather than
 *    belonging to one of them.
 *
 * None of it syncs to Simpro. It is reference data the office owns, not field
 * work, and pushing a licensed table into somebody else's system is the one
 * way this could become a redistribution problem after all.
 */

export const MIGRATION_V26 = `
CREATE TABLE IF NOT EXISTS cable_table (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  material TEXT NOT NULL,
  insulation TEXT NOT NULL,
  installMethod TEXT NOT NULL,
  cores TEXT,
  operatingC REAL NOT NULL,
  note TEXT,
  addedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cable_rating (
  id TEXT PRIMARY KEY NOT NULL,
  tableId TEXT NOT NULL,
  areaMm2 REAL NOT NULL,
  amps REAL NOT NULL,
  mvPerAmpMetre REAL,
  reactanceOhmPerKm REAL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_cable_rating_table ON cable_rating(tableId, areaMm2);
CREATE INDEX IF NOT EXISTS idx_cable_rating_size ON cable_rating(areaMm2);

CREATE TABLE IF NOT EXISTS cable_derating (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  condition TEXT NOT NULL,
  factor REAL NOT NULL,
  source TEXT NOT NULL,
  addedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cable_derating_kind ON cable_derating(kind);
`;
