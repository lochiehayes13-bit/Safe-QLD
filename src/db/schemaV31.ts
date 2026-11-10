/**
 * Schema v31 — the configuration files this phone is holding.
 *
 * The row is not the configuration. The configuration is the file, kept whole
 * and byte for byte, and this is the index over it: what it is, what was in it
 * the last time it was read, and which site somebody has tied it to.
 * Everything on the row can be rebuilt by reading the file again, which is the
 * property that matters — a parser improved in a later build gives a better
 * answer for a file opened months ago, and would not if the contents had been
 * flattened into tables at import time.
 *
 * The bytes are in SQLite rather than in document storage, and that is a
 * decision rather than a convenience. Half this company reads the app in a
 * browser on an iPhone, and a browser has no document directory to write into:
 * `expo-file-system` is the one part of the app with a separate web half for
 * exactly that reason. SQLite is the only store both builds actually have, so
 * it is where anything that must survive already lives. It costs database size
 * — a configuration is a few hundred kilobytes to a few megabytes — and buys a
 * feature that works the same on both, a delete that cannot leave an orphan,
 * and no directory to reconcile.
 *
 * They are in a table of their own so that listing the library never reads
 * them. `SELECT *` over a table with a multi-megabyte blob on every row is the
 * kind of thing that is instant on the four configs a developer has and takes
 * seconds on a phone that has been in service a year.
 *
 * `summary` is JSON for the same reason the Form 72's parts are: read whole,
 * written whole, never queried a field at a time. What is queried — the
 * fingerprint, when it was last opened, which site it belongs to — are columns
 * with indexes on them.
 *
 * `siteId` sets itself to null when a site is deleted rather than taking the
 * config with it. A configuration file outlives the site record it was tied
 * to: the building is still there, and so is the file somebody went and
 * fetched.
 */

export const MIGRATION_V31 = `
CREATE TABLE IF NOT EXISTS config_file (
  id             TEXT PRIMARY KEY NOT NULL,
  fileName       TEXT NOT NULL,
  byteLength     INTEGER NOT NULL,
  fingerprint    TEXT NOT NULL,
  parserId       TEXT,
  brand          TEXT NOT NULL,
  model          TEXT,
  siteNameInFile TEXT,
  siteId         TEXT REFERENCES site(id) ON DELETE SET NULL,
  openedAt       TEXT NOT NULL,
  lastOpenedAt   TEXT NOT NULL,
  importedAt     TEXT,
  summary        TEXT NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS config_blob (
  configId TEXT PRIMARY KEY NOT NULL REFERENCES config_file(id) ON DELETE CASCADE,
  bytes    BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_file_print ON config_file(fingerprint);
CREATE INDEX IF NOT EXISTS idx_config_file_opened ON config_file(lastOpenedAt);
CREATE INDEX IF NOT EXISTS idx_config_file_site ON config_file(siteId);
`;
