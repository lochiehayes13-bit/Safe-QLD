import { getDb, newId, nowIso } from './index';
import type { NeedLine, NeedWhen } from '@/domain/needsList';

/**
 * Keeping the "things I need" list.
 *
 * Thin on purpose. Every decision about the list — how it sorts, what a tick
 * does, what a line means once it has been ordered — lives in
 * `@/domain/needsList`, which imports nothing from here and can therefore be
 * tested without a database. This file writes rows and reads them back.
 *
 * The one piece of judgement it does hold is the shape of the round trip.
 * SQLite has no undefined and no booleans, so an optional field is null in the
 * row and undefined on the record, and the two conversions live here rather
 * than being repeated by every caller — a screen that wrote an empty string
 * where the record says "nobody has filled this in" would put a blank part
 * number on a purchase request and look like a choice somebody had made.
 */

interface NeedRow {
  id: string;
  what: string;
  quantity: number | null;
  partNumber: string | null;
  siteId: string | null;
  siteName: string | null;
  note: string | null;
  whenNeeded: string;
  state: string;
  orderNote: string | null;
  purchaseRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  orderedAt: string | null;
  gotAt: string | null;
}

/** Null to undefined, and an empty string to undefined with it. */
function some(v: string | null): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

/**
 * A row as the app's record.
 *
 * `whenNeeded` and `state` are read defensively: they are plain text in the
 * table, and a row written by a later build — or by a hand on a database
 * pulled off a phone — must not be able to put the screen in a state it has no
 * group for. Anything unrecognised reads as a thing still needed now, which is
 * the state that keeps a line in front of somebody rather than hiding it.
 */
function hydrate(row: NeedRow): NeedLine {
  return {
    id: row.id,
    what: row.what,
    quantity: row.quantity ?? undefined,
    partNumber: some(row.partNumber),
    siteId: some(row.siteId),
    siteName: some(row.siteName),
    note: some(row.note),
    when: row.whenNeeded === 'future' ? 'future' : 'now',
    state: row.state === 'ordered' || row.state === 'got' ? row.state : 'needed',
    orderNote: some(row.orderNote),
    purchaseRequestId: some(row.purchaseRequestId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    orderedAt: some(row.orderedAt),
    gotAt: some(row.gotAt),
  };
}

export interface NeedsQuery {
  /**
   * Whether to include what has already been got. The screen wants them —
   * nothing is deleted, and a technician checks whether they already picked
   * something up — but a caller that only wants the outstanding work should
   * not have to read them to throw them away.
   */
  includeGot?: boolean;
}

/**
 * The list, in the order it is read.
 *
 * The ORDER BY is the index in `schemaNeeds`: the two groups, then what is
 * still wanted before what has been got, then oldest first. The screen sorts
 * within a group again — the same part for four sites has to read together,
 * and that is a rule about the words rather than about the row — but it starts
 * from an order rather than from whatever SQLite happened to hand back.
 */
export async function listNeeds(q: NeedsQuery = {}): Promise<NeedLine[]> {
  const db = await getDb();
  const rows = q.includeGot
    ? await db.getAllAsync<NeedRow>(
      'SELECT * FROM need_line ORDER BY whenNeeded, state, createdAt',
    )
    : await db.getAllAsync<NeedRow>(
      "SELECT * FROM need_line WHERE state <> 'got' ORDER BY whenNeeded, state, createdAt",
    );
  return rows.map(hydrate);
}

/** How many things are still to get, for the count beside a link to the list. */
export async function openNeedsCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM need_line WHERE state <> 'got'",
  );
  return row?.n ?? 0;
}

export interface NewNeed {
  what: string;
  quantity?: number;
  partNumber?: string;
  siteId?: string;
  siteName?: string;
  note?: string;
  when?: NeedWhen;
}

/**
 * Writes a new line.
 *
 * `what` is trimmed and everything else is optional, which is the whole point
 * of the screen: a line reading "flow meter" and nothing else is a complete
 * and useful record, and anything that made it less than that would be another
 * form nobody fills in on a roof.
 */
export async function addNeed(input: NewNeed): Promise<NeedLine> {
  const db = await getDb();
  const at = nowIso();
  const line: NeedLine = {
    id: newId(),
    what: input.what.trim(),
    quantity: input.quantity,
    partNumber: input.partNumber?.trim() || undefined,
    siteId: input.siteId,
    siteName: input.siteName?.trim() || undefined,
    note: input.note?.trim() || undefined,
    when: input.when ?? 'now',
    state: 'needed',
    createdAt: at,
    updatedAt: at,
  };
  await db.runAsync(
    `INSERT INTO need_line
       (id,what,quantity,partNumber,siteId,siteName,note,whenNeeded,state,orderNote,
        purchaseRequestId,createdAt,updatedAt,orderedAt,gotAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    line.id, line.what, line.quantity ?? null, line.partNumber ?? null, line.siteId ?? null,
    line.siteName ?? null, line.note ?? null, line.when, line.state, null, null,
    line.createdAt, line.updatedAt, null, null,
  );
  return line;
}

/**
 * Writes a line back whole.
 *
 * Whole rather than as a patch because the state changes are worked out in the
 * domain module and handed here already made: `tickNeed` returns the line as
 * it should now be, including the stamps it cleared, and a patch write would
 * have no way to clear one. A column that has become undefined has to be able
 * to become null in the row, or an un-ticked line would keep the time it was
 * got and read as still got the next time it was opened.
 */
export async function saveNeed(line: NeedLine): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE need_line SET
       what = ?, quantity = ?, partNumber = ?, siteId = ?, siteName = ?, note = ?,
       whenNeeded = ?, state = ?, orderNote = ?, purchaseRequestId = ?,
       updatedAt = ?, orderedAt = ?, gotAt = ?
     WHERE id = ?`,
    line.what, line.quantity ?? null, line.partNumber ?? null, line.siteId ?? null,
    line.siteName ?? null, line.note ?? null, line.when, line.state, line.orderNote ?? null,
    line.purchaseRequestId ?? null, nowIso(), line.orderedAt ?? null, line.gotAt ?? null,
    line.id,
  );
}

/**
 * Removes a line for good.
 *
 * The one thing on this screen that does destroy something, and it is behind a
 * confirmation for that reason. It exists because the alternative to being
 * able to delete a line typed by mistake is a list with rubbish in it, and a
 * list with rubbish in it stops being read.
 */
export async function deleteNeed(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM need_line WHERE id = ?', id);
}
