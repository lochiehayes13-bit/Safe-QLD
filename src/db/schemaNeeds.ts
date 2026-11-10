/**
 * Schema v22 — the things a technician needs to get.
 *
 * The list that has always lived on a dashboard, in a phone's notes, or on the
 * back of a delivery docket: an extinguisher for a site, a flow meter before
 * the hydrant work in March. It is deliberately not the purchase_request
 * table. A request has lines, a supplier and a status because it is a document
 * that goes to the office; this is one row per thing wanted, and every column
 * on it except `what` may be null, because a lookup that finds nothing must
 * not be able to stop somebody writing down what they need.
 *
 * Two decisions worth writing down.
 *
 * **`siteId` is not a foreign key.** Everything else in this schema that names
 * a site references it, and here that would be wrong: a technician types the
 * building they mean and it is regularly one the phone has never synced, or a
 * bay rather than a building. So the id is stored where the site was picked
 * from the list and the name is stored always, and a line for a site nobody
 * has heard of is kept exactly as it was written rather than refused by the
 * database.
 *
 * **Nothing is deleted on a tick.** `state` moves needed → ordered → got and
 * back again, and the row stays. `gotAt` and `orderedAt` are what the screen
 * uses to put a line back the way it was when a tick was a mistake, which is
 * the whole reason a technician is willing to tick anything at all.
 *
 * The one index is the order the list is read in: the two groups, then what is
 * still wanted before what has been got, then oldest first. There is no index
 * on the site, on purpose — this is a shopping list of tens of rows, not a
 * register of thousands, and an index nothing searches is write cost for
 * nothing. This schema has carried one of those before.
 */

export const MIGRATION_V22 = `
CREATE TABLE IF NOT EXISTS need_line (
  id                 TEXT PRIMARY KEY NOT NULL,
  /* What to get, in the technician's words. The only thing that must be here. */
  what               TEXT NOT NULL,
  quantity           REAL,
  partNumber         TEXT,
  /* Loose by design — see the note above. */
  siteId             TEXT,
  siteName           TEXT,
  note               TEXT,
  /* 'now' or 'future'. */
  whenNeeded         TEXT NOT NULL DEFAULT 'now',
  /* 'needed', 'ordered' or 'got'. */
  state              TEXT NOT NULL DEFAULT 'needed',
  /* What was said when it was marked ordered: a PO number, "rang the office". */
  orderNote          TEXT,
  /* The purchase request it went to the office on, where it went on one. */
  purchaseRequestId  TEXT,
  createdAt          TEXT NOT NULL,
  updatedAt          TEXT NOT NULL,
  orderedAt          TEXT,
  gotAt              TEXT
);

/* The list's own order, so reading it is a walk of the index rather than a
   read of the table and a sort. */
CREATE INDEX IF NOT EXISTS idx_need_line_order ON need_line(whenNeeded, state, createdAt);
`;
