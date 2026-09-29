import type { ConductorMaterial } from '@/calc/cable';

/**
 * The office's own cable tables, held on the phone.
 *
 * `src/calc/cable.ts` does the arithmetic of AS/NZS 3008 and carries none of
 * its numbers. This is where the numbers come from instead: a table the office
 * types or pastes in once, from their own licensed copy of the standard or
 * from a manufacturer's published catalogue, with the source recorded on the
 * table and printed under every answer that used it.
 *
 * That is a deliberate trade and it is worth saying why, because a calculator
 * that ships empty looks broken.
 *
 * Australian Standards are copyright Standards Australia and licensed per
 * copy. Their current-carrying capacity tables are the licensed part — the
 * whole commercial value of AS/NZS 3008.1.1 is those tables — and this
 * repository is public. Shipping them would be redistributing a document the
 * company pays for, to everybody. Reciting them from memory would be worse
 * than that: a capacity figure that is confidently wrong by 10 % puts an
 * undersized cable in a wall and nobody finds out until it is warm.
 *
 * So the app ships the method, the search, and the import. The figures are the
 * office's, they are entered once, they carry where they were read from, and
 * they can be exported and handed to every other phone as a CSV.
 *
 * A row that came from a manufacturer's catalogue and a row that came from the
 * standard are both fine and they are not the same thing, which is why the
 * source is a required field rather than a nicety. "Where did this 63 A come
 * from" is the question asked six months later, in front of somebody.
 */

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/**
 * One table: a cable construction, installed one way.
 *
 * This mirrors how the standard's tables are actually laid out — a table is a
 * cable type and an installation method, and the rows down it are sizes. The
 * office names it however their copy names it, because the point is to be able
 * to find the same figure again.
 */
export interface CableTable {
  id: string;
  /** How the office refers to it: "V-75 2C+E, enclosed in a wall". */
  label: string;
  /**
   * Where the figures were read. "AS/NZS 3008.1.1:2017 Table 4(1) col 6",
   * "Olex catalogue 2024 p.34". Required, and enforced.
   */
  source: string;
  material: ConductorMaterial;
  /** The insulation, as the cable is designated: V-75, X-90, R-EP-90. */
  insulation: string;
  /** The installation method, in the words of the table's own column. */
  installMethod: string;
  /** '2C+E', '4C', 'single core' — free text, because tables differ. */
  cores?: string;
  /** The conductor operating temperature the table is drawn for. */
  operatingC: number;
  note?: string;
  /** Full instant, not a day — the phone shows it in Queensland time. */
  addedAt: string;
}

/** One size in one table. */
export interface CableRating {
  id: string;
  tableId: string;
  areaMm2: number;
  /** Current-carrying capacity in amps, as printed. Before any derating. */
  amps: number;
  /** Millivolts per amp per metre, where the table gives it. */
  mvPerAmpMetre?: number;
  /** Reactance in ohms per kilometre, where the table gives it. */
  reactanceOhmPerKm?: number;
  note?: string;
}

/** One derating factor the office has read out of their own tables. */
export interface DeratingEntry {
  id: string;
  /** Which chain it belongs to: ambient, grouping, depth and so on. */
  kind: string;
  /** The condition, in the reader's words: "40 °C in air", "6 circuits touching". */
  condition: string;
  factor: number;
  /** Where it was read. Required, same as a table's. */
  source: string;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Suggestions, which are descriptions of situations and not table text
// ---------------------------------------------------------------------------

/**
 * Insulation types by their product designation.
 *
 * The temperature in each of these is part of the cable's name — V-75 is
 * called that because it is a 75 °C conductor, and it is printed on the drum
 * and in every wholesaler's catalogue. Offered as a starting point; the
 * operating temperature is an editable field either way.
 */
export const INSULATION_PRESETS: readonly { id: string; label: string; operatingC: number; shortCircuitC: number }[] = [
  { id: 'v75', label: 'PVC (V-75)', operatingC: 75, shortCircuitC: 160 },
  { id: 'v90', label: 'PVC (V-90)', operatingC: 90, shortCircuitC: 160 },
  { id: 'x90', label: 'XLPE (X-90)', operatingC: 90, shortCircuitC: 250 },
  { id: 'repe90', label: 'EPR (R-EP-90)', operatingC: 90, shortCircuitC: 250 },
  { id: 'silicone', label: 'Silicone (fire rated)', operatingC: 150, shortCircuitC: 350 },
];

/**
 * Ways a cable is installed, described rather than quoted.
 *
 * These are physical situations — where the cable is and what is around it —
 * not the wording of any table's column headings. The office edits the text to
 * match their own copy, and what is stored is what they typed.
 */
export const INSTALL_METHOD_SUGGESTIONS: readonly string[] = [
  'Unenclosed in air, spaced from a surface',
  'Unenclosed in air, touching a surface',
  'Enclosed in a wall or ceiling',
  'Enclosed in thermal insulation',
  'In conduit, in air',
  'In conduit, buried',
  'Buried direct',
  'On a cable tray or ladder',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TableProblem {
  field: string;
  reason: string;
}

/**
 * What is wrong with a table before it is saved.
 *
 * The source check is the one that matters. A table saved without it becomes,
 * within a month, a set of numbers on a phone that nobody can account for —
 * and the honest answer to "where did this come from" would then be "somebody
 * typed it", which is not an answer a designer can give.
 */
export function checkTable(t: Partial<CableTable>): TableProblem[] {
  const problems: TableProblem[] = [];
  if (!t.label?.trim()) problems.push({ field: 'label', reason: 'Give it a name you will recognise in six months.' });
  if (!t.source?.trim()) {
    problems.push({ field: 'source', reason: 'Say where the figures were read from — the table and column, or the catalogue and page.' });
  }
  if (!t.insulation?.trim()) problems.push({ field: 'insulation', reason: 'Which insulation these figures are for.' });
  if (!t.installMethod?.trim()) problems.push({ field: 'installMethod', reason: 'Which installation method these figures are for.' });
  if (!Number.isFinite(t.operatingC) || (t.operatingC as number) <= 0) {
    problems.push({ field: 'operatingC', reason: 'The conductor operating temperature the table is drawn for.' });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// CSV in and out
// ---------------------------------------------------------------------------

/** A row read out of pasted text, with the line it came from. */
export interface ParsedRating {
  areaMm2: number;
  amps: number;
  mvPerAmpMetre?: number;
  reactanceOhmPerKm?: number;
  note?: string;
  line: number;
}

export interface RatingParse {
  rows: ParsedRating[];
  /** Lines that were not rows, and why. Shown, never swallowed. */
  skipped: { line: number; text: string; reason: string }[];
}

const HEADER_ALIASES: Record<string, keyof ParsedRating> = {
  size: 'areaMm2', mm2: 'areaMm2', 'mm²': 'areaMm2', area: 'areaMm2', csa: 'areaMm2', conductor: 'areaMm2',
  amps: 'amps', a: 'amps', current: 'amps', capacity: 'amps', ccc: 'amps', rating: 'amps',
  mv: 'mvPerAmpMetre', mvam: 'mvPerAmpMetre', 'mv/a/m': 'mvPerAmpMetre', 'mv/am': 'mvPerAmpMetre', voltdrop: 'mvPerAmpMetre',
  x: 'reactanceOhmPerKm', reactance: 'reactanceOhmPerKm', 'ohm/km': 'reactanceOhmPerKm',
  note: 'note', notes: 'note', comment: 'note',
};

/**
 * Reads a pasted table.
 *
 * Written for what people actually paste, which is a column selection out of a
 * spreadsheet: tabs or commas, a header row or none, blank lines, and a stray
 * "Table 4(1)" caption at the top. The first two numbers on a line are the
 * size and the capacity when there is no header, because that is the order
 * every one of these tables is printed in.
 *
 * Everything it could not read comes back in `skipped` with the line number
 * and the reason. Silently dropping a row would be the worst possible
 * behaviour here: a table missing its 16 mm² row does not look wrong, it just
 * quietly stops offering the size that was the right answer.
 */
export function parseRatingCsv(text: string): RatingParse {
  const rows: ParsedRating[] = [];
  const skipped: { line: number; text: string; reason: string }[] = [];
  const lines = text.split(/\r?\n/);

  let map: (keyof ParsedRating | null)[] | null = null;

  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const cells = splitCells(trimmed);

    if (!map) {
      const header = headerMap(cells);
      if (header) {
        map = header;
        return;
      }
    }

    const values = map ? byHeader(cells, map) : byPosition(cells);
    if (!values) {
      skipped.push({ line, text: trimmed, reason: 'no size and capacity on this line' });
      return;
    }
    if (values.areaMm2 <= 0) {
      skipped.push({ line, text: trimmed, reason: 'the size is not a positive number' });
      return;
    }
    if (values.amps <= 0) {
      skipped.push({ line, text: trimmed, reason: 'the capacity is not a positive number' });
      return;
    }
    rows.push({ ...values, line });
  });

  return { rows, skipped };
}

/**
 * Splits a pasted line into cells.
 *
 * Tabs, semicolons, commas and runs of spaces, because that is what comes out
 * of a spreadsheet, a European CSV, a CSV and a PDF respectively.
 *
 * One separator wins per line, in that order, rather than all of them at once.
 * A line pasted from a spreadsheet is tab-separated and may hold "1,010" in a
 * cell, and splitting on both would turn one capacity into two. A single space
 * is the last resort, because "Enclosed in a wall" in a note column would
 * otherwise become five cells.
 *
 * Trailing empty cells are dropped and the interior ones kept: "1.5,17.5,,"
 * has no mV figure, and "1.5,,17.5" would be a different row entirely if the
 * gap collapsed.
 */
const CELL_SEPARATORS: readonly RegExp[] = [/\t/, /;/, /,/, /\s{2,}/, /\s+/];

function splitCells(line: string): string[] {
  const separator = CELL_SEPARATORS.find((s) => s.test(line));
  const cells = (separator ? line.split(new RegExp(separator.source, 'g')) : [line]).map((c) => c.trim());
  while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function headerMap(cells: string[]): (keyof ParsedRating | null)[] | null {
  const mapped = cells.map((c) => HEADER_ALIASES[c.toLowerCase().replace(/[\s_()]/g, '')] ?? null);
  const named = new Set(mapped.filter(Boolean));
  // A header row names both of the columns that matter and holds no bare
  // numbers — otherwise a data row whose first cell reads "16" would be eaten.
  if (!named.has('areaMm2') || !named.has('amps')) return null;
  if (cells.some((c) => /^-?\d+(\.\d+)?$/.test(c))) return null;
  return mapped;
}

function byHeader(cells: string[], map: (keyof ParsedRating | null)[]): Omit<ParsedRating, 'line'> | null {
  const out: Record<string, unknown> = {};
  map.forEach((key, i) => {
    if (!key) return;
    const cell = cells[i];
    if (cell === undefined || cell === '') return;
    if (key === 'note') out[key] = cell;
    else {
      const n = num(cell);
      if (n !== null) out[key] = n;
    }
  });
  if (typeof out.areaMm2 !== 'number' || typeof out.amps !== 'number') return null;
  return out as Omit<ParsedRating, 'line'>;
}

function byPosition(cells: string[]): Omit<ParsedRating, 'line'> | null {
  const numbers = cells.map(num).filter((n): n is number => n !== null);
  if (numbers.length < 2) return null;
  const [areaMm2, amps, mv, x] = numbers;
  const out: Omit<ParsedRating, 'line'> = { areaMm2: areaMm2!, amps: amps! };
  if (mv !== undefined) out.mvPerAmpMetre = mv;
  if (x !== undefined) out.reactanceOhmPerKm = x;
  return out;
}

/** A number, tolerating the units and thousands separators people paste. */
function num(cell: string): number | null {
  const cleaned = cell.replace(/[,\s]/g, '').replace(/(mm²|mm2|amps?|a|v|mv\/a\/m|ohm\/km)$/i, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Writes the rows back out, so one phone's tables can reach the rest.
 *
 * The header is written even for an empty table: a CSV with no header is a
 * file somebody has to guess the columns of.
 */
export function formatRatingCsv(rows: readonly CableRating[]): string {
  const head = 'size,amps,mv,x,note';
  const body = [...rows]
    .sort((a, b) => a.areaMm2 - b.areaMm2)
    .map((r) => [
      r.areaMm2,
      r.amps,
      r.mvPerAmpMetre ?? '',
      r.reactanceOhmPerKm ?? '',
      csvCell(r.note ?? ''),
    ].join(','));
  return [head, ...body].join('\n');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

export interface RatingHit {
  table: CableTable;
  rating: CableRating;
}

export interface TableQuery {
  /** Free text over the table's label, source, insulation and method. */
  text?: string;
  material?: ConductorMaterial;
  /** Only this conductor size. */
  areaMm2?: number;
  /** Only sizes that carry at least this much. */
  minAmps?: number;
}

/**
 * Finds rows across every table loaded.
 *
 * The search that matters on site is not "show me table 4(1)", it is "what
 * carries 40 amps" or "what is 6 mil rated at". So a word that is nothing but
 * a number means a size or a capacity and nothing else — it is not matched
 * against the text, because a source reading "table 4(1) column 6" would then
 * answer a search for 6 mm² with every row in that table, and the noise
 * arrives exactly when the search is most useful.
 *
 * Words that are not bare numbers do search the text: the label, the source,
 * the insulation, the installation method and the notes. Every word has to
 * match something, so two words narrow rather than widen.
 *
 * A technician who types "6" gets the 6 mm² rows from every table at once,
 * which is the comparison they were about to make by hand.
 */
export function searchRatings(
  tables: readonly CableTable[],
  ratings: readonly CableRating[],
  query: TableQuery,
): RatingHit[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const words = (query.text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);

  const hits: RatingHit[] = [];
  for (const rating of ratings) {
    const table = byId.get(rating.tableId);
    if (!table) continue;
    if (query.material && table.material !== query.material) continue;
    if (query.areaMm2 !== undefined && rating.areaMm2 !== query.areaMm2) continue;
    if (query.minAmps !== undefined && rating.amps < query.minAmps) continue;

    if (words.length) {
      const haystack = [
        table.label, table.source, table.insulation, table.installMethod, table.cores ?? '', table.note ?? '',
        rating.note ?? '',
      ].join(' ').toLowerCase();
      const matched = words.every((w) => {
        const n = bareNumber(w);
        return n === null ? haystack.includes(w) : rating.areaMm2 === n || rating.amps === n;
      });
      if (!matched) continue;
    }

    hits.push({ table, rating });
  }

  return hits.sort((a, b) => a.rating.areaMm2 - b.rating.areaMm2 || a.table.label.localeCompare(b.table.label));
}

/** A search word that is nothing but a number, or null if it is anything else. */
function bareNumber(word: string): number | null {
  if (!/^\d*\.?\d+$/.test(word)) return null;
  const n = Number(word);
  return Number.isFinite(n) ? n : null;
}

/** The rows of one table, in size order, ready to hand to the sizing engine. */
export function candidatesFor(table: CableTable, ratings: readonly CableRating[]) {
  return ratings
    .filter((r) => r.tableId === table.id)
    .sort((a, b) => a.areaMm2 - b.areaMm2)
    .map((r) => ({
      areaMm2: r.areaMm2,
      tableAmps: r.amps,
      mvPerAmpMetre: r.mvPerAmpMetre,
      reactanceOhmPerKm: r.reactanceOhmPerKm,
      source: table.source,
    }));
}
