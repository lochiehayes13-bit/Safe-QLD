import { WIRING_TABLES, type WiringTable } from '@/seed/wiring';

/**
 * The wiring rules tables as a technician reads them.
 *
 * The seed carries more than the book prints: transcription conventions,
 * column layouts and the like sit in each table's meta so the figures can be
 * traced. None of that is for the person on site. This module picks out what
 * is (cable, insulation, temperatures, units, page), gives each table's
 * columns the numbers the book prints, and keeps the search to those same
 * words so a hit never surfaces a working note.
 */

// ---------------------------------------------------------------------------
// Column numbers as printed
// ---------------------------------------------------------------------------

/**
 * Tables whose second page is numbered one higher than the seed's columns.
 *
 * The standard numbers the conductor-size column it repeats at the left of a
 * continuation page. These eight transcriptions dropped that column and
 * numbered on without it, so from the first column of the second page every
 * seed number is one below the book. Table 3(2) to 3(4) — the standard's own
 * index into these tables — and the tables' own notes agree on the printed
 * numbers: Table 6 "Columns 11 and 12" for a wiring enclosure in air is seed
 * columns 10 and 11, and so on. The values are indexed by the seed number, so
 * the fix is here, in what is printed, not in the data.
 */
const SECOND_PAGE_FROM: Record<string, number> = {
  'Table 6': 10,
  'Table 7': 14,
  'Table 8': 14,
  'Table 9': 10,
  'Table 10': 14,
  'Table 11': 14,
  'Table 20': 11,
  'Table 21': 11,
};

/** The column number the book prints for a seed column. */
export function printedColumn(table: Pick<WiringTable, 'doc' | 'ref'>, n: number): number {
  if (table.doc !== 'as3008') return n;
  const from = SECOND_PAGE_FROM[table.ref];
  return from !== undefined && n >= from ? n + 1 : n;
}

// ---------------------------------------------------------------------------
// Doubts
// ---------------------------------------------------------------------------

/** Every figure doubt on a table, one short line each. Usually none. */
export function tableDoubts(table: WiringTable): string[] {
  return table.problems.filter((p) => p.trim());
}

/** The printed columns a doubt line is about, or none where it is about the table. */
export function doubtColumns(line: string): number[] {
  const m = /^Columns?\s+(\d+)(?:\s*[–-]\s*(\d+))?\b/.exec(line);
  if (!m) return [];
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

/** The doubts that touch one printed column. */
export function columnDoubts(table: WiringTable, printedN: number): string[] {
  return tableDoubts(table).filter((p) => doubtColumns(p).includes(printedN));
}

// ---------------------------------------------------------------------------
// Meta, tidied
// ---------------------------------------------------------------------------

/** Words the standard prints in capitals that stay that way. */
const KEEP_UPPER = new Set(['MIMS', 'XLPE', 'PVC', 'ABC', 'EPR', 'CSP', 'HF', 'NZ', 'AUS', 'IEC', 'BS', 'A', 'V', 'C']);

/**
 * A heading as a sentence: "THREE SINGLE-CORE (See Note 1)" → "Three single-core".
 *
 * The title blocks are shouted, and not consistently — Table 8 prints "THREE
 * SINGLE-CORE" where Table 9 prints "Three single-core" — so two tables of the
 * same cable would otherwise read as two different cables.
 */
export function tidyHeading(raw: string, keepNoteRef = false): string {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!keepNoteRef) s = s.replace(/\s*\(\s*see\s+notes?[^)]*\)/gi, '').trim();
  const letters = s.replace(/\(\s*see\s+notes?[^)]*\)/gi, '').replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (letters.length >= 4 && upper / letters.length > 0.8) {
    s = s.replace(/[A-Za-z][A-Za-z0-9-]*/g, (word) => {
      if (/\d/.test(word) || KEEP_UPPER.has(word)) return word;
      if (/^[A-Z](-[A-Z]+)+$/.test(word)) return word; // R-HF, X-HF
      if (/^note$/i.test(word) || /^see$/i.test(word)) return word;
      return word.toLowerCase();
    });
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

/** A meta key, as the transcriptions spell it in three different ways. */
function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[\s-]+/g, '_');
}

/** The first non-blank meta value under any of these keys. */
export function metaValue(table: Pick<WiringTable, 'meta'>, ...keys: string[]): string {
  const wanted = keys.map(normaliseKey);
  for (const want of wanted) {
    for (const [k, v] of Object.entries(table.meta)) {
      if (normaliseKey(k) === want && typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

export interface TableFact {
  label: string;
  value: string;
}

/** What a technician reads off a table's title block, in that order. */
const FACTS: { label: string; keys: string[] }[] = [
  { label: 'Cable', keys: ['cable_type', 'cable_types'] },
  { label: 'Insulation', keys: ['insulation', 'insulation_type', 'insulation_types'] },
  { label: 'Conductor', keys: ['conductor', 'conductor_material', 'conductor_materials'] },
  {
    label: 'Conductor temp',
    keys: [
      'max_conductor_temperature', 'maximum_conductor_temperature', 'conductor_operating_temperature',
      'conductor_temperatures_c', 'conductor_temperatures',
    ],
  },
  { label: 'Ambient', keys: ['reference_ambient_temperature', 'reference_ambient'] },
  { label: 'Installed', keys: ['installation', 'installation_conditions'] },
  { label: 'Voltage', keys: ['nominal_voltage'] },
  { label: 'Units', keys: ['units', 'unit', 'value_units', 'value_unit'] },
];

/** The pages a table runs over, from its meta where it spans more than one. */
function pagesOf(table: WiringTable): string {
  const m = /^\D{0,6}(\d+)\s*[–-]\s*(\d+)/.exec(metaValue(table, 'pages', 'spans_pages'));
  if (m && Number(m[2]) > Number(m[1])) return `${m[1]}–${m[2]}`;
  return table.page ? String(table.page) : '';
}

/** The title-block facts for a table, tidied. Nothing about how it was transcribed. */
export function tableFacts(table: WiringTable): TableFact[] {
  const out: TableFact[] = [];
  for (const f of FACTS) {
    const v = metaValue(table, ...f.keys);
    if (!v) continue;
    const value = tidyHeading(v, true);
    // "45, 60, 75, 90" is a list of temperatures with the unit in the heading.
    const bareTemps = f.label === 'Conductor temp' && /^[\d.,\s]+$/.test(value);
    out.push({ label: f.label, value: bareTemps ? `${value} °C` : value });
  }
  const pages = pagesOf(table);
  if (pages) out.push({ label: pages.includes('–') ? 'Pages' : 'Page', value: pages });
  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface TableHit {
  table: WiringTable;
  matched: 'ref' | 'title' | 'column' | 'fact' | 'note';
  detail?: string;
}

function normaliseRef(ref: string): string {
  return ref.toLowerCase().replace(/^t(able)?\s*/, '').replace(/\s+/g, '');
}

/**
 * Search by what is in a table: its number, title, column headings, the
 * facts above, and the notes under it. Never the working notes.
 */
export function searchTables(query: string, tables: readonly WiringTable[] = WIRING_TABLES, limit = 60): TableHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return tables.slice(0, limit).map((table) => ({ table, matched: 'title' as const }));

  const hits: TableHit[] = [];
  for (const table of tables) {
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
    const fact = tableFacts(table).find((f) => f.value.toLowerCase().includes(q));
    if (fact) {
      hits.push({ table, matched: 'fact', detail: `${fact.label}: ${fact.value}` });
      continue;
    }
    const note = table.notes.find((n) => n.toLowerCase().includes(q));
    if (note) hits.push({ table, matched: 'note', detail: note });
  }
  const order = { ref: 0, title: 1, column: 2, fact: 3, note: 4 };
  return hits.sort((a, b) => order[a.matched] - order[b.matched]).slice(0, limit);
}
