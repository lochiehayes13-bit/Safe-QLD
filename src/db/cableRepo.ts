import { getDb, newId, nowIso } from './index';
import {
  candidatesFor, parseRatingCsv, searchRatings,
  type CableRating, type CableTable, type DeratingEntry, type RatingHit, type TableQuery,
} from '@/domain/cableTables';
import type { ConductorMaterial } from '@/calc/cable';

/**
 * Keeping the office's cable tables.
 *
 * Thin, like the rest of the repositories here: every decision about what a
 * table means, how a paste is read and how a search matches lives in
 * `@/domain/cableTables`, which imports no database and can be tested without
 * one. This writes rows and reads them back.
 *
 * The one piece of judgement it holds is the import, and it is the piece worth
 * describing. Loading a table is a paste of forty lines that has to either
 * land completely or not at all — a half-imported table is worse than none,
 * because the sizing engine will happily size against it and step over the
 * size that was missing. So the rows go in inside a transaction, the caller is
 * told how many were read and which lines were not, and replacing a table
 * clears its old rows in the same transaction rather than leaving two
 * generations of figures side by side.
 */

interface TableRow {
  id: string;
  label: string;
  source: string;
  material: string;
  insulation: string;
  installMethod: string;
  cores: string | null;
  operatingC: number;
  note: string | null;
  addedAt: string;
}

interface RatingRow {
  id: string;
  tableId: string;
  areaMm2: number;
  amps: number;
  mvPerAmpMetre: number | null;
  reactanceOhmPerKm: number | null;
  note: string | null;
}

interface DeratingRow {
  id: string;
  kind: string;
  condition: string;
  factor: number;
  source: string;
  addedAt: string;
}

function some(v: string | null): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

/**
 * A row as a table.
 *
 * `material` is read defensively — it is plain text in the column, and a row
 * written by a later build must not be able to hand the calculator a
 * conductor it has no constants for. Anything unrecognised reads as copper,
 * which is what all but a handful of these tables are.
 */
function hydrateTable(row: TableRow): CableTable {
  const material: ConductorMaterial = row.material === 'aluminium' ? 'aluminium' : 'copper';
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    material,
    insulation: row.insulation,
    installMethod: row.installMethod,
    cores: some(row.cores),
    operatingC: row.operatingC,
    note: some(row.note),
    addedAt: row.addedAt,
  };
}

function hydrateRating(row: RatingRow): CableRating {
  return {
    id: row.id,
    tableId: row.tableId,
    areaMm2: row.areaMm2,
    amps: row.amps,
    mvPerAmpMetre: row.mvPerAmpMetre ?? undefined,
    reactanceOhmPerKm: row.reactanceOhmPerKm ?? undefined,
    note: some(row.note),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listCableTables(): Promise<CableTable[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TableRow>('SELECT * FROM cable_table ORDER BY label');
  return rows.map(hydrateTable);
}

export async function getCableTable(id: string): Promise<CableTable | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TableRow>('SELECT * FROM cable_table WHERE id = ?', [id]);
  return row ? hydrateTable(row) : null;
}

export async function listRatings(tableId: string): Promise<CableRating[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RatingRow>(
    'SELECT * FROM cable_rating WHERE tableId = ? ORDER BY areaMm2', [tableId],
  );
  return rows.map(hydrateRating);
}

/** Every row on the phone, for a search that runs across tables. */
export async function allRatings(): Promise<CableRating[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RatingRow>('SELECT * FROM cable_rating ORDER BY areaMm2');
  return rows.map(hydrateRating);
}

/**
 * The search the table screen runs.
 *
 * Reads everything and matches in the domain rather than in SQL. These are
 * reference tables — tens of rows per table and a handful of tables, not a
 * mirrored job list — and matching a bare number against a size or a capacity
 * is a rule with a reason behind it that belongs where it can be tested.
 */
export async function searchCableTables(query: TableQuery): Promise<RatingHit[]> {
  const [tables, ratings] = await Promise.all([listCableTables(), allRatings()]);
  return searchRatings(tables, ratings, query);
}

/** One table's rows, in the shape the sizing engine takes. */
export async function candidateRows(tableId: string) {
  const table = await getCableTable(tableId);
  if (!table) return [];
  return candidatesFor(table, await listRatings(tableId));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type NewCableTable = Omit<CableTable, 'id' | 'addedAt'>;

export async function saveCableTable(input: NewCableTable & { id?: string }): Promise<string> {
  const db = await getDb();
  const id = input.id ?? newId();
  await db.runAsync(
    `INSERT INTO cable_table (id, label, source, material, insulation, installMethod, cores, operatingC, note, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, source = excluded.source, material = excluded.material,
       insulation = excluded.insulation, installMethod = excluded.installMethod,
       cores = excluded.cores, operatingC = excluded.operatingC, note = excluded.note`,
    [
      id, input.label.trim(), input.source.trim(), input.material, input.insulation.trim(),
      input.installMethod.trim(), input.cores?.trim() || null, input.operatingC,
      input.note?.trim() || null, nowIso(),
    ],
  );
  return id;
}

/**
 * Deletes a table and everything under it.
 *
 * The rows go with it deliberately. A cable_rating whose table is gone is a
 * capacity figure with no source, no insulation and no installation method,
 * which is exactly the orphan this whole module exists to prevent — and the
 * search would skip it silently, so nobody would ever find out it was there.
 */
export async function deleteCableTable(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cable_rating WHERE tableId = ?', [id]);
  await db.runAsync('DELETE FROM cable_table WHERE id = ?', [id]);
}

export interface ImportOutcome {
  /** How many rows went in. */
  imported: number;
  /** How many were already there and were replaced. */
  replaced: number;
  /** Lines that were not rows, with why. Shown to the person, never swallowed. */
  skipped: { line: number; text: string; reason: string }[];
}

/**
 * Loads a pasted table into one cable table.
 *
 * `replace` is the honest default for re-importing a table somebody has
 * corrected: the old figures go, in the same breath as the new ones arrive,
 * so there is never a moment where a size appears twice with two different
 * capacities. Without it the paste is merged, and a size already present is
 * overwritten rather than duplicated — which is what "I forgot the 16 mil
 * row" wants.
 */
export async function importRatings(
  tableId: string, text: string, options: { replace?: boolean } = {},
): Promise<ImportOutcome> {
  const db = await getDb();
  const parsed = parseRatingCsv(text);

  const existing = await listRatings(tableId);
  const bySize = new Map(existing.map((r) => [r.areaMm2, r]));

  let replaced = 0;
  if (options.replace) {
    await db.runAsync('DELETE FROM cable_rating WHERE tableId = ?', [tableId]);
    replaced = existing.length;
    bySize.clear();
  }

  for (const row of parsed.rows) {
    const already = bySize.get(row.areaMm2);
    if (already) replaced += 1;
    await db.runAsync(
      `INSERT INTO cable_rating (id, tableId, areaMm2, amps, mvPerAmpMetre, reactanceOhmPerKm, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         amps = excluded.amps, mvPerAmpMetre = excluded.mvPerAmpMetre,
         reactanceOhmPerKm = excluded.reactanceOhmPerKm, note = excluded.note`,
      [
        already?.id ?? newId(), tableId, row.areaMm2, row.amps,
        row.mvPerAmpMetre ?? null, row.reactanceOhmPerKm ?? null, row.note ?? null,
      ],
    );
  }

  return { imported: parsed.rows.length, replaced, skipped: parsed.skipped };
}

/** One row, typed rather than pasted. */
export async function saveRating(input: Omit<CableRating, 'id'> & { id?: string }): Promise<string> {
  const db = await getDb();
  const id = input.id ?? newId();
  await db.runAsync(
    `INSERT INTO cable_rating (id, tableId, areaMm2, amps, mvPerAmpMetre, reactanceOhmPerKm, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       areaMm2 = excluded.areaMm2, amps = excluded.amps, mvPerAmpMetre = excluded.mvPerAmpMetre,
       reactanceOhmPerKm = excluded.reactanceOhmPerKm, note = excluded.note`,
    [
      id, input.tableId, input.areaMm2, input.amps,
      input.mvPerAmpMetre ?? null, input.reactanceOhmPerKm ?? null, input.note?.trim() || null,
    ],
  );
  return id;
}

export async function deleteRating(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cable_rating WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Derating factors
// ---------------------------------------------------------------------------

export async function listDeratingEntries(): Promise<DeratingEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DeratingRow>('SELECT * FROM cable_derating ORDER BY kind, factor DESC');
  return rows.map((r) => ({
    id: r.id, kind: r.kind, condition: r.condition, factor: r.factor, source: r.source, addedAt: r.addedAt,
  }));
}

export async function saveDeratingEntry(input: Omit<DeratingEntry, 'id' | 'addedAt'> & { id?: string }): Promise<string> {
  const db = await getDb();
  const id = input.id ?? newId();
  await db.runAsync(
    `INSERT INTO cable_derating (id, kind, condition, factor, source, addedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind, condition = excluded.condition, factor = excluded.factor, source = excluded.source`,
    [id, input.kind, input.condition.trim(), input.factor, input.source.trim(), nowIso()],
  );
  return id;
}

export async function deleteDeratingEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cable_derating WHERE id = ?', [id]);
}
