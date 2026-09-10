import type { CandidateRow, ConductorMaterial, DeratingFactor, DeratingKind } from '@/calc/cable';
import {
  WIRING_TABLES, columnSeries, rowGroup, rowSizeMm2, wiringTable,
  type WiringColumn, type WiringTable,
} from '@/seed/wiring';

/**
 * The wiring rules tables, as the cable calculator eats them.
 *
 * The tables ship as the standard prints them — one table per cable
 * construction, one column per installation arrangement, one row per
 * conductor size. The calculator wants something else: a flat list of
 * candidate rows for one cable installed one way, each carrying its capacity,
 * its volts per amp-metre, and where it was read from. This is the join
 * between the two, and it is deliberately a pure module with no database in
 * it: the figures are already in the binary, and a copy in SQLite would go
 * stale the first time a transcription is corrected.
 *
 * The unit of choice is the **column**, not the table. Table 4 alone carries
 * twenty-seven of them — unenclosed and spaced, unenclosed and touching,
 * enclosed in conduit in a wall, buried direct, surrounded by thermal
 * insulation — and each is a different installation with different figures.
 * A screen that offered "Table 4" would be offering twenty-seven answers at
 * once, and the difference between the widest and narrowest of them is more
 * than a factor of two.
 *
 * Three joins are done here and each is stated on the row it produces.
 *
 * Capacity comes from the column itself. Volts per amp-metre comes from the
 * voltage drop tables, matched on conductor material, cable family and the
 * conductor temperature the capacity table assumes — and it is a three-phase
 * figure, which the calculator converts for a single-phase run rather than
 * this module pretending it is phase-neutral. Reactance is left to the
 * voltage drop figure that already contains it.
 *
 * Where a join finds nothing the row simply carries less, and the screen says
 * so. Nothing here invents a figure that is not in a book.
 */

// ---------------------------------------------------------------------------
// Which tables are which
// ---------------------------------------------------------------------------

/**
 * The current-carrying capacity tables the calculator can size against.
 *
 * Tables 20 and 21 — the aerial cables — are deliberately not here. Their
 * rows are named by conductor construction rather than by area ("7/1.00" is
 * seven strands of a millimetre), so there is no cross-section to size
 * against, and the volt drop and fault checks both need one. They are in the
 * app and searchable like every other table; they are just not something this
 * calculator can answer with.
 */
const CAPACITY_REFS = [
  'Table 4', 'Table 5', 'Table 6', 'Table 7', 'Table 8', 'Table 9', 'Table 10', 'Table 11',
  'Table 12', 'Table 13', 'Table 14', 'Table 15', 'Table 16', 'Table 17', 'Table 18', 'Table 19',
];

/**
 * The voltage drop tables, and what each one is for.
 *
 * Vc is not one number per size: it depends on the conductor material, on
 * whether the cable is single-core in trefoil or flat or multicore, and on
 * how hot the conductor is allowed to get. Picking the wrong one of these is
 * worth up to about a quarter of the answer.
 */
interface DropTable {
  ref: string;
  material: ConductorMaterial;
  /** What the capacity table's cable type has to look like for this to fit. */
  family: 'single-core-trefoil' | 'single-core-flat' | 'multicore' | 'flexible' | 'mims' | 'aerial';
}

const DROP_TABLES: DropTable[] = [
  { ref: 'Table 40', material: 'copper', family: 'single-core-trefoil' },
  { ref: 'Table 41', material: 'copper', family: 'single-core-flat' },
  { ref: 'Table 42', material: 'copper', family: 'multicore' },
  { ref: 'Table 43', material: 'aluminium', family: 'single-core-trefoil' },
  { ref: 'Table 44', material: 'aluminium', family: 'single-core-flat' },
  { ref: 'Table 45', material: 'aluminium', family: 'multicore' },
  { ref: 'Table 46', material: 'copper', family: 'flexible' },
  { ref: 'Table 49', material: 'copper', family: 'mims' },
  { ref: 'Table 50', material: 'copper', family: 'aerial' },
  { ref: 'Table 51', material: 'aluminium', family: 'aerial' },
];

/** Derating and rating-factor tables, and the kind of condition each covers. */
const DERATING_TABLES: { ref: string; kind: DeratingKind; note: string }[] = [
  { ref: 'Table 2', kind: 'harmonics', note: 'Harmonic content in four and five core cables' },
  { ref: 'Table 22', kind: 'grouping', note: 'Circuits bunched in air or in a wiring enclosure' },
  { ref: 'Table 23', kind: 'grouping', note: 'Single-core cables on trays, racks or cleats in air' },
  { ref: 'Table 24', kind: 'grouping', note: 'Multicore cables on trays, racks or cleats in air' },
  { ref: 'Table 25(1)', kind: 'grouping', note: 'Circuits buried direct' },
  { ref: 'Table 25(2)', kind: 'grouping', note: 'Circuits buried direct' },
  { ref: 'Table 26(1)', kind: 'grouping', note: 'Circuits in underground wiring enclosures' },
  { ref: 'Table 26(2)', kind: 'grouping', note: 'Circuits in underground wiring enclosures' },
  { ref: 'Table 27(1)', kind: 'ambient', note: 'Ambient air or concrete slab temperature' },
  { ref: 'Table 27(2)', kind: 'ambient', note: 'Ambient soil temperature' },
  { ref: 'Table 28(1)', kind: 'depth', note: 'Depth of laying' },
  { ref: 'Table 28(2)', kind: 'depth', note: 'Depth of laying' },
  { ref: 'Table 29', kind: 'soil', note: 'Soil thermal resistivity' },
];

// ---------------------------------------------------------------------------
// A capacity column, which is what a person actually picks
// ---------------------------------------------------------------------------

export interface CapacityColumn {
  id: string;
  /** "Table 4 col 6". */
  ref: string;
  tableRef: string;
  columnN: number;
  material: ConductorMaterial;
  /** As the table designates it: Thermoplastic, X-90, 110 °C. */
  insulation: string;
  /** The table's own cable type: "Two single-core", "Three-core and four-core". */
  cores: string;
  /** The column heading with the conductor words taken out. */
  installMethod: string;
  /**
   * Solid, stranded or flexible, where the column distinguishes them.
   *
   * Two columns of the same table can describe the same arrangement and
   * differ only in this — a flexible conductor of the same size carries a
   * little less — so it is kept out of the arrangement and shown beside it,
   * rather than making the two columns look identical in a picker.
   */
  conductorForm?: string;
  /** The conductor temperature the figures assume. */
  operatingC: number;
  /** The ambient the figures assume, in the table's words. */
  referenceAmbient?: string;
  /** Never blank: a figure nobody can point at is not a figure. */
  source: string;
  /** Anything the transcription could not reconcile on this table. */
  problems: string[];
  /** How many sizes the column actually carries a figure for. */
  sizes: number;
}

/** Words in a column heading that describe the conductor, not where it is. */
const CONDUCTOR_WORDS = new Set([
  'cu', 'al', 'copper', 'aluminium', 'aluminum', 'flexible', 'solid', 'stranded', 'solid/stranded',
]);

function segments(label: string): string[] {
  return label.split(/[›>|]/).map((p) => p.trim()).filter(Boolean);
}

const FORM_WORDS = new Set(['solid', 'stranded', 'solid/stranded', 'flexible']);

/** Solid, stranded or flexible, where the heading says. */
export function conductorFormOf(label: string): string | undefined {
  const found = segments(label).find((p) => FORM_WORDS.has(p.toLowerCase()));
  return found;
}

/** The installation arrangement a column describes, without the conductor. */
export function arrangementOf(label: string): string {
  return segments(label).filter((p) => !CONDUCTOR_WORDS.has(p.toLowerCase())).join(' › ');
}

function materialOf(label: string, table: WiringTable): ConductorMaterial {
  if (/\bal\b|alumin/i.test(label)) return 'aluminium';
  if (/\bcu\b|copper/i.test(label)) return 'copper';
  const meta = `${table.meta.conductor ?? ''} ${table.meta.cable_type ?? ''} ${table.title}`;
  return /alumin/i.test(meta) ? 'aluminium' : 'copper';
}

function temperatureOf(table: WiringTable): number {
  // MIMS tables state a sheath temperature rather than a conductor one; it is
  // the figure their ratings are computed against, so it is the right one to
  // match a voltage drop column on.
  const raw = table.meta.max_conductor_temperature
    ?? table.meta.maximum_conductor_temperature
    ?? table.meta.sheath_temperature
    ?? '';
  const m = /(\d+(?:\.\d+)?)/.exec(String(raw));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : 75;
}

function metaOf(table: WiringTable, ...keys: string[]): string {
  for (const k of keys) {
    const v = table.meta[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Whether a column is the repeated key column rather than a rating.
 *
 * A capacity table printed across two pages repeats the conductor size down
 * the left of the second page, and that column is in the transcription
 * because it is on the page. Its values equal the row keys; treating it as a
 * rating would offer "carries 2.5 A at 2.5 mm²".
 */
function isKeyColumn(table: WiringTable, column: WiringColumn): boolean {
  if (/conductor size|nominal (cross|area)/i.test(column.label)) return true;
  const series = columnSeries(table, column.n);
  if (series.length < 3) return false;
  return series.every((s) => {
    const size = rowSizeMm2({ key: s.key, values: [] });
    return size !== undefined && Math.abs(size - s.value) < 1e-9;
  });
}

let cachedColumns: CapacityColumn[] | null = null;

/**
 * Every cable-and-installation the phone can size against.
 *
 * Built once and kept: it is a walk over eleven thousand figures and the
 * answer never changes inside a run of the app.
 */
export function capacityColumns(): CapacityColumn[] {
  if (cachedColumns) return cachedColumns;

  const out: CapacityColumn[] = [];
  for (const table of WIRING_TABLES) {
    if (table.doc !== 'as3008' || !CAPACITY_REFS.includes(table.ref)) continue;
    // The transcriptions use whichever key the table's own heading uses, and
    // the headings are not consistent between tables. Reading one key would
    // leave a third of the columns unlabelled in the picker.
    const insulation = metaOf(table, 'insulation_type', 'insulation', 'insulation_types');
    const cores = metaOf(table, 'cable_type', 'cable_types');
    const operatingC = temperatureOf(table);
    const referenceAmbient = metaOf(table, 'reference_ambient_temperature', 'reference_ambient');

    for (const column of table.columns) {
      if (column.n === 1) continue;
      if ((column.unit ?? '').trim().toUpperCase() !== 'A') continue;
      if (isKeyColumn(table, column)) continue;
      const series = columnSeries(table, column.n);
      if (!series.length) continue;

      out.push({
        id: `${table.ref}#${column.n}`.replace(/\s+/g, ''),
        ref: `${table.ref} col ${column.n}`,
        tableRef: table.ref,
        columnN: column.n,
        material: materialOf(column.label, table),
        insulation,
        cores,
        installMethod: arrangementOf(column.label) || column.label,
        conductorForm: conductorFormOf(column.label),
        operatingC,
        referenceAmbient: referenceAmbient || undefined,
        source: `${table.source}, ${table.ref} col ${column.n}${table.page ? `, p.${table.page}` : ''}`,
        problems: table.problems,
        sizes: series.length,
      });
    }
  }
  cachedColumns = out;
  return out;
}

/** A one-line description for a picker: what it is and where it goes. */
export function describeColumn(c: CapacityColumn): string {
  const bits = [c.cores, c.insulation].filter(Boolean).join(', ');
  const form = c.conductorForm ? `, ${c.conductorForm.toLowerCase()}` : '';
  return `${bits ? `${bits} — ` : ''}${c.installMethod}${form}`;
}

// ---------------------------------------------------------------------------
// The rows for one of them
// ---------------------------------------------------------------------------

/** Which voltage drop table belongs to a capacity column. */
function dropTableFor(column: CapacityColumn): WiringTable | undefined {
  const cores = column.cores.toLowerCase();
  const arrangement = column.installMethod.toLowerCase();

  const family: DropTable['family'] = cores.includes('mims')
    ? 'mims'
    : cores.includes('aerial')
      ? 'aerial'
      : cores.includes('flexible') || cores.includes('cord')
        ? 'flexible'
        : cores.includes('single-core')
          ? (arrangement.includes('trefoil') ? 'single-core-trefoil' : 'single-core-flat')
          : 'multicore';

  const match = DROP_TABLES.find((d) => d.family === family && d.material === column.material)
    // Aluminium has no flexible or MIMS table of its own; the copper one is
    // the wrong answer, so nothing is returned rather than something close.
    ?? undefined;
  return match ? wiringTable('as3008', match.ref) : undefined;
}

/**
 * The column of a voltage drop table that matches the conductor temperature.
 *
 * The tables print Vc at 45, 60, 75, 90, 105 and 110 °C, each with a maximum
 * and a 0.8 power factor sub-column. The maximum is taken: it is the figure
 * the standard intends for a design check, and the 0.8 column is lower, which
 * is the flattering direction.
 */
function dropColumnFor(table: WiringTable, operatingC: number): WiringColumn | undefined {
  const maxima = table.columns.filter((c) => c.n > 1 && /max\.?/i.test(c.label));
  const candidates = maxima.length ? maxima : table.columns.filter((c) => c.n > 1);
  let best: { column: WiringColumn; gap: number } | undefined;
  for (const column of candidates) {
    const temp = temperatureInLabel(column.label);
    if (temp === undefined) continue;
    const gap = Math.abs(temp - operatingC);
    if (!best || gap < best.gap) best = { column, gap };
  }
  return best?.column ?? candidates[0];
}

/**
 * The conductor temperature a voltage drop column is for.
 *
 * The headings put it in three different shapes across the tables —
 * "Conductor temperature, °C › 75 › Max.", "Conductor temperature 75°C ›
 * Max.", and occasionally just "75" — and a regular expression that only
 * knew one of them silently returned the first column of every table, which
 * is 45 °C. That is a fifth of the answer, in the flattering direction.
 */
function temperatureInLabel(label: string): number | undefined {
  for (const part of segments(label).reverse()) {
    const m = /(\d{2,3})\s*°?\s*C\b/i.exec(part) ?? /^(\d{2,3})$/.exec(part);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 30 && n <= 200) return n;
  }
  return undefined;
}

export interface WiringCandidates {
  rows: CandidateRow[];
  /** Where the volts per amp-metre came from, or why they are missing. */
  dropNote: string;
}

/**
 * The candidate rows for one cable installed one way.
 *
 * Sizes with no figure in the column are left out rather than carried as a
 * zero: a blank in the book means that arrangement does not apply at that
 * size, and a zero would read as a cable that carries nothing.
 */
export function candidateRowsFor(column: CapacityColumn): WiringCandidates {
  const table = wiringTable('as3008', column.tableRef);
  if (!table) return { rows: [], dropNote: 'That table is not on this phone.' };

  const dropTable = dropTableFor(column);
  const dropColumn = dropTable ? dropColumnFor(dropTable, column.operatingC) : undefined;
  const dropBySize = new Map<number, number>();
  if (dropTable && dropColumn) {
    for (const row of dropTable.rows) {
      // A voltage drop table printed under sub-headings is read the same way
      // the capacity tables are: the size is the number after the colon.
      const size = rowSizeMm2(row);
      const value = row.values[dropColumn.n - 2];
      if (size !== undefined && typeof value === 'number' && !dropBySize.has(size)) dropBySize.set(size, value);
    }
  }

  const rows: CandidateRow[] = [];
  const index = column.columnN - 2;
  for (const row of table.rows) {
    const size = rowSizeMm2(row);
    const value = row.values[index];
    if (size === undefined || typeof value !== 'number') continue;
    // A table with two blocks (a MIMS voltage group, say) would otherwise
    // offer the same size twice with different figures; the first block wins
    // and the group is named in the source.
    if (rows.some((r) => r.areaMm2 === size)) continue;
    const group = rowGroup(row);
    rows.push({
      areaMm2: size,
      tableAmps: value,
      mvPerAmpMetre: dropBySize.get(size),
      mvIsThreePhase: true,
      source: group ? `${column.source} (${group})` : column.source,
    });
  }

  const dropNote = dropTable && dropColumn
    ? `Volt drop from ${dropTable.ref}, ${dropColumn.label}.`
    : 'No voltage drop table on this phone matches this cable, so the drop is computed from the conductor’s resistance instead.';

  return { rows: rows.sort((a, b) => a.areaMm2 - b.areaMm2), dropNote };
}

// ---------------------------------------------------------------------------
// Derating
// ---------------------------------------------------------------------------

export interface WiringDerating extends DeratingFactor {
  id: string;
  tableRef: string;
}

let cachedDerating: WiringDerating[] | null = null;

/**
 * Every derating and rating factor in the standard, flattened.
 *
 * One entry per cell: a condition, a factor and where it was read. The
 * condition is built from the row's own key and the column's heading, because
 * that is what the technician is matching against — "6 circuits, touching,
 * trefoil" — rather than a table number.
 */
export function deratingFactors(): WiringDerating[] {
  if (cachedDerating) return cachedDerating;

  const out: WiringDerating[] = [];
  for (const { ref, kind, note } of DERATING_TABLES) {
    const table = wiringTable('as3008', ref);
    if (!table) continue;
    const keyLabel = table.columns[0]?.label ?? '';

    for (const column of table.columns) {
      if (column.n === 1) continue;
      const heading = arrangementOf(column.label) || column.label;
      for (const row of table.rows) {
        const value = row.values[column.n - 2];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        // Factors above one are rating factors for a cooler ambient, which the
        // standard does print — they are kept, and the calculator's own sanity
        // check is what refuses anything wild.
        out.push({
          id: `${ref}#${column.n}#${row.key}`.replace(/\s+/g, ''),
          tableRef: ref,
          kind,
          condition: `${note}: ${keyLabel} ${row.key}${heading ? ` — ${heading}` : ''}`,
          factor: value,
          source: `${table.source}, ${ref}${table.page ? `, p.${table.page}` : ''}`,
        });
      }
    }
  }
  cachedDerating = out;
  return out;
}

/** The distinct conditions of one kind, for a picker that is not four hundred rows long. */
export function deratingFor(kind: DeratingKind): WiringDerating[] {
  return deratingFactors().filter((f) => f.kind === kind);
}

/** What the phone is carrying, for the line on the screen that says so. */
export function wiringCoverage(): { columns: number; deratingFactors: number; tables: number } {
  return {
    columns: capacityColumns().length,
    deratingFactors: deratingFactors().length,
    tables: new Set(capacityColumns().map((c) => c.tableRef)).size,
  };
}
