import tables from './tables.json';

/**
 * The wiring rules tables, on the phone.
 *
 * Every numbered table in AS/NZS 3008.1.1 and the sizing tables of AS/NZS
 * 3000 — current-carrying capacities, the installation-method schedules,
 * derating and rating factors, resistance and reactance, voltage drop,
 * short-circuit constants, earthing conductor sizes, earth fault loop
 * impedance, and the whole of Appendix C — transcribed from Safe QLD's
 * licensed copies and shipped with the app.
 *
 * ## Why this is here at all
 *
 * The original design shipped empty and asked the office to type its own
 * figures in, because Australian Standards are copyright Standards Australia
 * and licensed per copy, and this repository is public. The company's owner
 * has since decided otherwise: he holds the licences, he asked for every table
 * in the app, and he asked twice. That is his call to make about his own
 * licensed copies, and it is recorded here rather than in a commit message so
 * that whoever reads this file next knows it was a decision and not an
 * oversight. **The repository this ships from should be private.**
 *
 * The office's own import (see `@/domain/cableTables`) has not been removed and
 * is not redundant: a manufacturer's catalogue figure for a cable that is not
 * in the standard, or a newer edition the company buys, still goes in there,
 * and a figure from either source carries where it was read from.
 *
 * ## How the figures got here
 *
 * Two independent readers transcribed each table from the same page, blind to
 * each other, and a third adjudicated every disagreement. `scripts/build-
 * wiring-seed.py` then checks the result the way a person would check a
 * transcription — that every row has as many figures as the table has columns,
 * that a current rating rises with conductor size and a voltage drop falls,
 * that copper beats aluminium in the column beside it — and records anything
 * it cannot reconcile on the table itself.
 *
 * Which is the point of `problems`. A table that carries one is still shown,
 * because a missing table is discovered on site and a flagged one is
 * discovered here, but the app prints the flag beside the figure rather than
 * quietly presenting it as sound.
 *
 * ## The edition matters
 *
 * These are the 2009 tables of AS/NZS 3008.1.1 including Amendment 1, and the
 * 2018 Wiring Rules including Amendments 1 and 2. The current-carrying
 * capacities did not change between the 2009 and 2017 editions of 3008 — they
 * were checked against a published manufacturer's handbook computed to the
 * same method — but the edition is on every table anyway, because "which book
 * is that from" is the question asked in front of somebody.
 */

export type WiringDoc = 'as3008' | 'as3000';

export interface WiringColumn {
  /** The column number as the standard prints it. Column 1 is the row key. */
  n: number;
  /** The heading, with the printed hierarchy kept: "Unenclosed › Spaced › Cu". */
  label: string;
  unit?: string;
}

export interface WiringRow {
  /**
   * What the row is about, usually a conductor size in mm². Where a table
   * prints its rows under sub-headings the key carries both, as
   * "0.6/0.6 kV: 2.5", because the same size appears under each one.
   */
  key: string;
  /** One value per column after the first. `null` is a blank cell in the book. */
  values: (number | string | null)[];
}

export interface WiringTable {
  doc: WiringDoc;
  docTitle: string;
  /** The edition, printed under every answer that uses this table. */
  source: string;
  /** Which extraction job produced it. Kept so a figure can be traced back. */
  job: string;
  /** "Table 4", "Table 25(1)", "Table C1". */
  ref: string;
  title: string;
  page?: number;
  /** What the table's own headings say: cable type, insulation, temperatures. */
  meta: Record<string, string>;
  columns: WiringColumn[];
  rows: WiringRow[];
  /** The notes printed under the table, verbatim. They change the answer. */
  notes: string[];
  confidence?: string;
  /** Anything the readers or the checks could not reconcile. Usually empty. */
  problems: string[];
}

/*
 * The JSON is generated, so TypeScript infers a union of every literal shape
 * it happens to contain — one per table's own meta keys — and no two of them
 * are assignable to each other. The assertion is through `unknown` for that
 * reason rather than to paper over a mismatch: `scripts/build-wiring-seed.py`
 * is what guarantees the shape, and it checks more than a type can.
 */
export const WIRING_TABLES: readonly WiringTable[] = tables as unknown as WiringTable[];

export const WIRING_DOC_LABEL: Record<WiringDoc, string> = {
  as3008: 'AS/NZS 3008.1.1',
  as3000: 'AS/NZS 3000',
};

const BY_REF = new Map<string, WiringTable>();
for (const t of WIRING_TABLES) BY_REF.set(`${t.doc}|${normaliseRef(t.ref)}`, t);

/** "table 4", "t4", "4" and "Table 4" all find Table 4. */
function normaliseRef(ref: string): string {
  return ref.toLowerCase().replace(/^t(able)?\s*/, '').replace(/\s+/g, '');
}

export function wiringTable(doc: WiringDoc, ref: string): WiringTable | undefined {
  return BY_REF.get(`${doc}|${normaliseRef(ref)}`);
}

export interface WiringHit {
  table: WiringTable;
  /** Why it matched, so the list can say so rather than looking arbitrary. */
  matched: 'ref' | 'title' | 'column' | 'note' | 'meta';
  detail?: string;
}

/**
 * Search over every table.
 *
 * Deliberately searches the column headings and the notes as well as the
 * titles, because the way a sparky asks for a table is by what is in it —
 * "buried direct", "thermal insulation", "trefoil" — and none of those words
 * appear in a title that reads "CURRENT-CARRYING CAPACITIES CABLE TYPE: TWO
 * SINGLE-CORE".
 */
export function searchWiringTables(query: string, limit = 40): WiringHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return WIRING_TABLES.slice(0, limit).map((table) => ({ table, matched: 'title' as const }));

  const hits: WiringHit[] = [];
  for (const table of WIRING_TABLES) {
    if (normaliseRef(table.ref).includes(normaliseRef(q))) {
      hits.push({ table, matched: 'ref' });
      continue;
    }
    if (table.title.toLowerCase().includes(q)) {
      hits.push({ table, matched: 'title' });
      continue;
    }
    const column = table.columns.find((c) => c.label.toLowerCase().includes(q));
    if (column) {
      hits.push({ table, matched: 'column', detail: column.label });
      continue;
    }
    const meta = Object.entries(table.meta).find(([, v]) => String(v).toLowerCase().includes(q));
    if (meta) {
      hits.push({ table, matched: 'meta', detail: `${meta[0].replace(/_/g, ' ')}: ${meta[1]}` });
      continue;
    }
    const note = table.notes.find((n) => n.toLowerCase().includes(q));
    if (note) hits.push({ table, matched: 'note', detail: note });
  }
  // A reference match is what somebody typing "table 4" wants at the top.
  const order = { ref: 0, title: 1, column: 2, meta: 3, note: 4 };
  return hits.sort((a, b) => order[a.matched] - order[b.matched]).slice(0, limit);
}

/**
 * The conductor size a row is about, where it is about one.
 *
 * Returns undefined for the tables whose rows are something else — a load
 * group, a device rating, a number of circuits — rather than pretending the
 * first number it finds is a size.
 */
export function rowSizeMm2(row: WiringRow): number | undefined {
  const tail = row.key.includes(':') ? row.key.slice(row.key.lastIndexOf(':') + 1) : row.key;
  const m = /(\d+(?:\.\d+)?)/.exec(tail);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** The sub-heading a row was printed under, or '' where the table has none. */
export function rowGroup(row: WiringRow): string {
  return row.key.includes(':') ? row.key.slice(0, row.key.lastIndexOf(':')).trim() : '';
}

/** One column's figures against the row keys, skipping the blanks. */
export function columnSeries(table: WiringTable, columnN: number): { key: string; value: number }[] {
  const index = columnN - 2;
  if (index < 0) return [];
  const out: { key: string; value: number }[] = [];
  for (const row of table.rows) {
    const v = row.values[index];
    if (typeof v === 'number') out.push({ key: row.key, value: v });
  }
  return out;
}

/** Every table of a kind, for the browsers: `as3008`, `as3000`, or both. */
export function tablesFor(doc?: WiringDoc): WiringTable[] {
  return doc ? WIRING_TABLES.filter((t) => t.doc === doc) : [...WIRING_TABLES];
}

/** How many figures the app is carrying, for the screen that says so. */
export function wiringFigureCount(): { tables: number; rows: number; figures: number } {
  let rows = 0;
  let figures = 0;
  for (const t of WIRING_TABLES) {
    rows += t.rows.length;
    for (const r of t.rows) figures += r.values.filter((v) => v !== null && v !== undefined).length;
  }
  return { tables: WIRING_TABLES.length, rows, figures };
}
