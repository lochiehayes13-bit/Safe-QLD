/**
 * Schema v24 — the register can be changed from the phone.
 *
 * Until now the office's asset register only flowed one way: the sync read
 * it, and a test result was the one thing that went back. A technician who
 * found an extinguisher the register did not have, or one the register had
 * in the wrong room, wrote it on a note for the office. Two tables let the
 * phone say it itself.
 *
 * `simpro_asset_type` is the office's own list of asset types with the
 * custom fields each one carries, because a create has to say which type
 * and address every value by the office's field id, and neither is known on
 * the phone otherwise. Read on demand, replaced whole.
 *
 * `asset_change` is the phone's record of every register change it has
 * asked for: what it was, the queue row that carries it, and the moment
 * before which it must not go. That moment is the undo window — the row and
 * its queue row are deleted together if a person takes the change back in
 * time — and after it the row is the answer to "did that go?", which the
 * queue row alone cannot give once it is forgotten.
 */

export const MIGRATION_V24 = `
/* ------------------------------------------------- the office's asset types */

CREATE TABLE IF NOT EXISTS simpro_asset_type (
  externalId        TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  /* [{id, name, type, listItems}] as the office defines them, in its order. */
  customFieldsJson  TEXT NOT NULL DEFAULT '[]',
  syncedAt          TEXT NOT NULL
);

/* ------------------------------------------- register changes made on the phone */

CREATE TABLE IF NOT EXISTS asset_change (
  id               TEXT PRIMARY KEY NOT NULL,
  /* The phone's asset. Not a foreign key: a delete outlives the row it deletes. */
  assetId          TEXT NOT NULL,
  /* The office's id, where the asset has one; written by the send for a create. */
  assetExternalId  TEXT,
  /* 'create', 'update', 'archive' or 'delete'. */
  kind             TEXT NOT NULL,
  payloadJson      TEXT NOT NULL,
  /* The sync_queue row carrying it; gone once the change is taken back. */
  queueRowId       TEXT,
  /* The instant before which the queue answers "later": the undo window. */
  notBefore        TEXT NOT NULL,
  createdAt        TEXT NOT NULL,
  sentAt           TEXT,
  /* The server's words, when the send was refused. */
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_change_asset ON asset_change(assetId, createdAt);
CREATE INDEX IF NOT EXISTS idx_asset_change_queue ON asset_change(queueRowId);
`;
