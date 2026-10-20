import { isSqlite, readSqlite, type SqlValue, type SqliteFile } from './sqliteRead';
import { isZip, readZip, type ZipEntryRead } from './zipRead';
import { decodeCp1252, parseTagLine } from './lineTags';
import { parseSections, isFfp } from './ampacFfp';
import {
  isPertronicUtil, parseFields, unwrapPertronicUtil, PERTRONIC_REFERENCE_BANNER,
} from './pertronicUtil';
import { isVigilant } from './vigilant';
import { isPci } from './notifierPci';
import { parseDelimited } from './csv';
import { probeFile } from './probe';

/**
 * What is actually inside a panel configuration file.
 *
 * Every parser in this directory answers the same question — what devices,
 * what zones, what logic — and throws the rest away, because the rest is not
 * what an import needs. Standing at a panel with a file that will not behave,
 * the rest is the whole point: which tables the vendor tool wrote, what it put
 * in them, and what this app is choosing not to read.
 *
 * The useful discovery is that all seven formats are the same shape underneath.
 * Kentec writes SQLite tables. Notifier and Vigilant write one self-closing tag
 * per line, and a tag name with its attributes is a table with columns.
 * Pertronic writes `KEY=field:value field:value`, and the key's shape says
 * which table the record belongs to. Ampac writes named text sections. A CSV is
 * a table and always was. So this module reduces all of them to named groups of
 * records with named columns, and a screen written once browses any of them.
 *
 * It is deliberately not a parser. Nothing here normalises a device type or
 * decides what a zone is; it reports what the file says, verbatim, including
 * the columns the app's own parsers ignore. That is what makes it worth having:
 * `readConfigStructure` will show a Kentec table this build cannot read, and
 * that is the first thing anyone needs to know before writing the code that
 * reads it.
 */

/** One named group of records: a SQLite table, a tag name, a text section. */
export interface ConfigGroup {
  /** The file's own name for it, verbatim. */
  name: string;
  /** The entry it came from, where the file is a container. */
  entry?: string;
  /** Field names in the order the file declares them. */
  columns: string[];
  rowCount: number;
  /** The first rows, as text, for a person to read. */
  sample: string[][];
  /**
   * What this group is, where the name alone does not say.
   *
   * Only where it is known from the format, never guessed — an unlabelled
   * table stays unlabelled rather than acquiring a confident description of
   * something nobody has confirmed.
   */
  note?: string;
}

/** A file inside a container. */
export interface ConfigEntry {
  name: string;
  byteLength: number;
  /** True for the entry the app's parser actually reads. */
  isConfig: boolean;
}

export interface ConfigStructure {
  /** How the file is packaged, in a word a person can repeat down the phone. */
  packaging: 'sqlite' | 'zip' | 'tagged-text' | 'sectioned-text' | 'delimited-text' | 'text' | 'binary';
  /** One sentence about the packaging and what it means for reading it. */
  headline: string;
  byteLength: number;
  entries: ConfigEntry[];
  groups: ConfigGroup[];
  /** What could not be opened, named rather than dropped. */
  warnings: string[];
}

/** The rows this returns by default. Enough to see the shape, small enough to hold. */
export const SAMPLE_ROWS = 25;

/** A page of one group's records, read on demand when somebody opens it. */
export interface GroupPage {
  name: string;
  columns: string[];
  rows: string[][];
  /** Records in the whole group, not in this page. */
  total: number;
  /** Where this page starts. */
  offset: number;
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

/** A group with all of its records, before sampling. Never leaves this module. */
interface RawGroup {
  name: string;
  entry?: string;
  columns: string[];
  rows: string[][];
  note?: string;
}

interface Collected {
  packaging: ConfigStructure['packaging'];
  headline: string;
  entries: ConfigEntry[];
  groups: RawGroup[];
  warnings: string[];
}

/**
 * Every record in the file, grouped.
 *
 * Held whole rather than streamed because these are building configurations —
 * hundreds to a few thousand devices — and the parsers beside this one already
 * build the same amount of data to do an import. It is called once to describe
 * a file and once more when somebody opens a group, and neither result is kept.
 */
function collect(bytes: Uint8Array, fileName: string): Collected {
  if (isSqlite(bytes)) return fromSqlite(bytes, fileName);
  if (isZip(bytes)) return fromZip(bytes, fileName);

  /*
   * Sniffed on the front of the file, decoded whole only once something has
   * matched. A configuration is a few megabytes and a picked file can be
   * anything at all; decoding every byte of a video to discover it is not a
   * .pci builds a string the size of the video to answer a question the first
   * four kilobytes already answered.
   *
   * 20 KB rather than a few hundred bytes because `isPci` looks that far in —
   * its second test is for a Point row, which sits past the header.
   *
   * Windows-1252 for the sniff because it maps every byte to a character and
   * so cannot fail; the real decode below is chosen per format.
   */
  const head = decodeCp1252(bytes.subarray(0, 20_480));

  /*
   * Decoded the way that format's own parser decodes it, which is not the same
   * for all of them and must not be.
   *
   * Vigilant writes Windows-1252 — `parseVigilantBytes` says so, and 30 of the
   * 44 files the vendor ships die on a strict UTF-8 parse. Notifier's .pci and
   * Ampac's .ffp reach their parsers through `file.text()`, which is UTF-8.
   * Picking one for both would make this view disagree with the parsed view
   * about the same bytes — a curly apostrophe in a device label reading one
   * way on the Devices screen and another on the Raw screen, with nothing to
   * say which is the file and which is the app.
   */
  if (isVigilant(head)) return fromTaggedText(decodeCp1252(bytes), fileName);
  if (isPci(head)) return fromTaggedText(decodeUtf8(bytes), fileName);
  if (isFfp(head)) return fromSections(decodeUtf8(bytes));
  if (!plausiblyText(bytes)) return fromUnknownBinary(bytes, fileName);

  // Windows-1252 for anything unrecognised: it is the superset that cannot
  // fail, and a file nobody has a parser for is exactly the one where a screen
  // full of replacement characters helps least.
  return fromLooseText(decodeCp1252(bytes), fileName);
}

/** UTF-8, as `File.text()` gives it to the parsers. */
function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * A file nobody has a parser for, described rather than dismissed.
 *
 * `probeFile` already answers the question anybody would ask next — is this a
 * container, is it compressed, is it encrypted, is there any structure left in
 * it — and it unwraps one level on the way past. So the raw view of a format
 * this build cannot read is that answer, which is genuinely the first step to
 * writing the code that reads it.
 */
function fromUnknownBinary(bytes: Uint8Array, fileName: string): Collected {
  const probe = probeFile(bytes);
  const inner = probe.inner ? ` Inside it: ${probe.inner.name} — ${probe.inner.probe.containerNote}` : '';
  return {
    packaging: 'binary',
    headline: `${fileName || 'This file'} is not text. ${probe.containerNote} ${probe.assessment}${inner}`,
    entries: [],
    groups: [],
    warnings: [],
  };
}

/** Whether the front of a file could be something a person typed. */
function plausiblyText(bytes: Uint8Array): boolean {
  const look = Math.min(bytes.length, 4096);
  if (look === 0) return false;
  let printable = 0;
  for (let i = 0; i < look; i++) {
    const c = bytes[i]!;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  return printable / look >= 0.85;
}

/** A SQLite value as a person would read it. */
function renderSql(value: SqlValue): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return `«${value.length} bytes»`;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

function fromSqlite(bytes: Uint8Array, fileName: string, entry?: string): Collected {
  const warnings: string[] = [];
  let db: SqliteFile;
  try {
    db = readSqlite(bytes);
  } catch (e) {
    return {
      packaging: 'binary',
      headline: 'A SQLite database this reader could not open.',
      entries: [],
      groups: [],
      warnings: [e instanceof Error ? e.message : String(e)],
    };
  }

  const groups: RawGroup[] = [];
  for (const table of db.tables()) {
    try {
      groups.push({
        name: table.name,
        entry,
        columns: table.columns,
        rows: db.rows(table).map((row) => table.columns.map((c) => renderSql(row[c] ?? null))),
      });
    } catch (e) {
      // One unreadable table must not cost the other forty. The file is still
      // worth browsing, and which table failed is worth saying.
      warnings.push(`Table "${table.name}" could not be read: ${e instanceof Error ? e.message : String(e)}`);
      groups.push({ name: table.name, entry, columns: table.columns, rows: [], note: 'Could not be read.' });
    }
  }

  return {
    packaging: 'sqlite',
    headline:
      `${fileName || 'This file'} is a SQLite database of ${db.pageCount.toLocaleString()} pages. `
      + 'Every table the vendor tool wrote is listed below, including the ones this app does not read.',
    entries: [],
    groups,
    warnings,
  };
}

/**
 * A zip, opened one level down.
 *
 * Pertronic's .util is the case this exists for: the panel configuration is a
 * .txt inside the archive, and the archive also carries files the parser
 * ignores. Listing the entries is half of it — the other half is opening the
 * one that matters, so the groups below come from the configuration itself
 * rather than from the wrapper.
 */
function fromZip(bytes: Uint8Array, fileName: string): Collected {
  let raw: ZipEntryRead[];
  try {
    raw = readZip(bytes);
  } catch (e) {
    return {
      packaging: 'binary',
      headline: 'A zip container that could not be opened.',
      entries: [],
      groups: [],
      warnings: [e instanceof Error ? e.message : String(e)],
    };
  }

  const warnings: string[] = [];
  let configName: string | undefined;
  let groups: RawGroup[] = [];

  if (isPertronicUtil(bytes)) {
    try {
      const inner = unwrapPertronicUtil(bytes);
      configName = inner.name;
      groups = pertronicGroups(inner.text, inner.name);
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    /*
     * Not a format with a parser. Take the largest entry that has text in it —
     * by content rather than by extension, because the one that matters in the
     * .NCF this was tested against is called `SITE` with no extension at all,
     * and the only .txt in that archive is zero bytes long.
     */
    const text = raw
      .filter((e) => e.bytes.length > 0 && plausiblyText(e.bytes))
      .sort((a, b) => b.bytes.length - a.bytes.length)[0];
    if (text) {
      configName = text.name;
      groups = [{
        name: text.name,
        entry: text.name,
        columns: ['Line'],
        rows: splitLines(decodeUtf8(text.bytes)).map((l) => [l]),
      }];
    } else {
      // Nothing readable inside, so say what the biggest thing in there looks
      // like instead of listing names and stopping.
      const biggest = [...raw].sort((a, b) => b.bytes.length - a.bytes.length)[0];
      if (biggest?.bytes.length) {
        const probe = probeFile(biggest.bytes);
        warnings.push(`${biggest.name} is the largest file in the archive. ${probe.containerNote} ${probe.assessment}`);
      }
    }
  }

  const entries: ConfigEntry[] = raw.map((e) => ({
    name: e.name,
    byteLength: e.uncompressedSize,
    isConfig: e.name === configName,
  }));

  return {
    packaging: 'zip',
    headline:
      `${fileName || 'This file'} is a zip holding ${entries.length} ${entries.length === 1 ? 'file' : 'files'}`
      + `${configName ? `. The configuration itself is ${configName}` : ', none of which is a configuration this app reads'}.`,
    entries,
    groups,
    warnings,
  };
}

/**
 * Pertronic's records, grouped by what their key says they are.
 *
 * The file is one record to a line, `KEY=field:value field:value`, and the key
 * carries the type: `L01D001` is device 1 on loop 1, `Z003` is zone 3, `LB001`
 * is logic block 1, `SITEINFO` and `OPTIONS` stand alone. Grouping on the
 * key's shape is what turns a flat file into the tables the panel thinks in.
 *
 * Columns are the union of the field names seen in the group, in first-seen
 * order, because the format omits a field rather than writing it empty — so no
 * single record tells you the shape of the group.
 */
function pertronicGroups(text: string, entry: string): RawGroup[] {
  const KINDS: { test: RegExp; name: string; note: string }[] = [
    { test: /^L\d+D\d+$/, name: 'Loop devices', note: 'Detectors and call points, keyed loop and address.' },
    { test: /^L\d+M\d+$/, name: 'Loop modules', note: 'Input and output modules, keyed loop and address.' },
    { test: /^Z\d+$/, name: 'Zones', note: '' },
    { test: /^LB\d+$/, name: 'Logic blocks', note: 'The cause and effect, as the panel holds it.' },
    { test: /^G\d+$/, name: 'Output groups', note: 'What a zone or a logic block drives, as one name.' },
    { test: /^Loop\d+$/, name: 'Loops', note: '' },
  ];

  const byGroup = new Map<string, { columns: string[]; rows: string[][]; note?: string; seen: Set<string> }>();
  const loose: string[][] = [];

  /*
   * The file holds the configuration twice: the live one, then a banner
   * reading "Start of Reference Panel Config", then what the tool last read
   * back off the panel. The parser stops at the banner. This does not — the
   * second copy is real content and a raw view that hides it is not raw — but
   * it must not be folded into the first, or a 318-device panel reports 636
   * loop devices and every one of them looks legitimate.
   */
  let inReference = false;

  for (const line of splitLines(text)) {
    if (PERTRONIC_REFERENCE_BANNER.test(line)) {
      inReference = true;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      if (line.trim() && !inReference) loose.push([line]);
      continue;
    }
    const key = line.slice(0, eq).trim();
    const fields = parseFields(line.slice(eq + 1));
    const kind = KINDS.find((k) => k.test.test(key));
    const name = `${kind ? kind.name : key}${inReference ? ' — read back off the panel' : ''}`;

    let group = byGroup.get(name);
    if (!group) {
      group = {
        columns: ['Key'],
        rows: [],
        note: inReference
          ? 'The panel\u2019s own state when the tool last read it back, not the configuration. '
            + (kind?.note ?? '')
          : kind?.note || undefined,
        seen: new Set(['Key']),
      };
      byGroup.set(name, group);
    }
    for (const field of fields.keys()) {
      if (!group.seen.has(field)) {
        group.seen.add(field);
        group.columns.push(field);
      }
    }
    // Laid against the group's columns rather than against this record's own
    // fields. The format omits a field it has nothing for, so two records of
    // the same kind carry different field sets, and writing each record in its
    // own order shifts every value after the gap one cell to the left.
    group.rows.push([key, ...group.columns.slice(1).map((c) => fields.get(c) ?? '')]);
  }

  const groups: RawGroup[] = [...byGroup.entries()].map(([name, g]) => ({
    name,
    entry,
    columns: g.columns,
    // Padded to the final column list. A record read before a later record
    // introduced a column was written short, and a short row draws nothing at
    // all in the cells past its end.
    rows: g.rows.map((r) => g.columns.map((_, i) => r[i] ?? '')),
    note: g.note,
  }));

  if (loose.length) {
    groups.push({ name: 'Header lines', entry, columns: ['Line'], rows: loose, note: 'Everything before the records begin.' });
  }
  return groups;
}

/**
 * Notifier's .pci and Vigilant's site files: one self-closing tag per line.
 *
 * A tag name is the table and its attributes are the columns, which is exactly
 * how both vendors' own tools present them. Neither file is valid XML — the
 * comment at the top of `lineTags` records why — so the same line scan the
 * parsers use is what reads them here.
 */
function fromTaggedText(text: string, fileName: string): Collected {
  const byTag = new Map<string, { columns: string[]; seen: Set<string>; rows: string[][] }>();
  let unreadable = 0;

  for (const line of splitLines(text)) {
    if (!line.trim()) continue;
    const tag = parseTagLine(line);
    if (!tag || tag.closing) {
      if (line.trim() && !tag) unreadable++;
      continue;
    }
    let group = byTag.get(tag.name);
    if (!group) {
      group = { columns: [], seen: new Set(), rows: [] };
      byTag.set(tag.name, group);
    }
    for (const attr of Object.keys(tag.attrs)) {
      if (!group.seen.has(attr)) {
        group.seen.add(attr);
        group.columns.push(attr);
      }
    }
    group.rows.push(group.columns.map((c) => tag.attrs[c] ?? ''));
  }

  const groups: RawGroup[] = [...byTag.entries()].map(([name, g]) => ({
    name,
    columns: g.columns,
    rows: g.rows.map((r) => g.columns.map((_, i) => r[i] ?? '')),
  }));

  return {
    packaging: 'tagged-text',
    headline:
      `${fileName || 'This file'} is one element per line, ${groups.length} different kinds of them. `
      + 'Each kind is listed below with the attributes it carries.',
    entries: [],
    groups,
    warnings: unreadable
      ? [`${unreadable.toLocaleString()} ${unreadable === 1 ? 'line is' : 'lines are'} not elements and are not shown.`]
      : [],
  };
}

/**
 * Ampac's .ffp: numbered sections of tab-separated rows.
 *
 * A section header is `[ M 10101 X 2` — a type letter, an id, a sub-letter and
 * an index — and the same type appears many times over, once per panel, loop
 * or function. Four of the letters are known from `parseFfp` itself: Z is the
 * zone table, P a panel's own record, M a module or loop table, F one slot of a
 * cause-and-effect function. The rest keep their letter rather than acquiring a
 * name nobody has confirmed.
 *
 * Sections of a type are gathered into one group with their header carried in
 * the first column, because a hundred separate two-row tables is not something
 * anybody can read, and without the header a row cannot be traced back to the
 * loop it came from.
 */
const FFP_TYPE_NOTE: Record<string, string> = {
  Z: 'The zone table. A row\u2019s position in it is the zone number.',
  P: 'One panel on the network: its name, and on node 1 the site line.',
  M: 'Module and loop tables. The loop device tables are the ones with sub X, index 2.',
  F: 'Cause and effect, one slot per section: index 1 names the function, 10-15 are its causes, 40-55 its effects.',
};

function fromSections(text: string): Collected {
  const { header, sections } = parseSections(text);

  const byType = new Map<string, { width: number; rows: string[][] }>();
  for (const s of sections) {
    const label = `${s.type} ${s.id} ${s.sub} ${s.index}`.replace(/\s+/g, ' ').trim();
    let group = byType.get(s.type);
    if (!group) {
      group = { width: 0, rows: [] };
      byType.set(s.type, group);
    }
    // A section with no rows is still a fact — an empty loop table is how the
    // file says the loop is there and has nothing on it.
    if (!s.rows.length) {
      group.rows.push([label]);
      continue;
    }
    for (const row of s.rows) {
      group.width = Math.max(group.width, row.length);
      group.rows.push([label, ...row]);
    }
  }

  const groups: RawGroup[] = [...byType.entries()].map(([type, g]) => {
    const columns = ['Section', ...Array.from({ length: g.width }, (_, i) => `Field ${i + 1}`)];
    return {
      name: `Sections of type ${type}`,
      columns,
      rows: g.rows.map((r) => columns.map((_, i) => r[i] ?? '')),
      note: FFP_TYPE_NOTE[type],
    };
  });

  const described = [header.project, header.date, header.configManagerVersion && `Config Manager ${header.configManagerVersion}`]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' \u00b7 ');

  return {
    packaging: 'sectioned-text',
    headline:
      `A FireFinder configuration${header.fileVersion ? `, file version ${header.fileVersion}` : ''}, `
      + `written as ${sections.length.toLocaleString()} numbered `
      + `${sections.length === 1 ? 'section' : 'sections'}${described ? `. ${described}` : '.'}`,
    entries: [],
    groups,
    warnings: [],
  };
}

/**
 * Anything else: a delimited table if it reads as one, otherwise its lines.
 *
 * The distinction matters on screen. Columns are worth showing as columns; a
 * file that is not a table gets its lines, which is honest and still useful,
 * rather than a grid split on a delimiter that was never there.
 */
function fromLooseText(text: string, fileName: string): Collected {
  const rows = parseDelimited(text);
  const widths = rows.slice(0, 20).map((r) => r.length);
  const tabular = rows.length > 1 && widths.length > 0 && Math.max(...widths) >= 3;

  if (tabular) {
    const header = rows[0] ?? [];
    const width = Math.max(...rows.map((r) => r.length));
    const columns = Array.from({ length: width }, (_, i) => header[i]?.trim() || `Column ${i + 1}`);
    return {
      packaging: 'delimited-text',
      headline:
        `${fileName || 'This file'} is a delimited table: ${(rows.length - 1).toLocaleString()} rows `
        + `of ${columns.length} columns.`,
      entries: [],
      groups: [{ name: fileName || 'Rows', columns, rows: rows.slice(1).map((r) => columns.map((_, i) => r[i] ?? '')) }],
      warnings: [],
    };
  }

  const lines = splitLines(text);
  return {
    packaging: 'text',
    headline: `${fileName || 'This file'} is plain text, ${lines.length.toLocaleString()} lines of it.`,
    entries: [],
    groups: [{ name: fileName || 'Lines', columns: ['Line'], rows: lines.map((l) => [l]) }],
    warnings: [],
  };
}

/** Lines, with a trailing newline's empty last line dropped. */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// The two things a screen asks for
// ---------------------------------------------------------------------------

/** Everything in the file, with the first few records of each group. */
export function readConfigStructure(
  bytes: Uint8Array,
  fileName = '',
  sampleRows = SAMPLE_ROWS,
): ConfigStructure {
  const c = collect(bytes, fileName);
  return {
    packaging: c.packaging,
    headline: c.headline,
    byteLength: bytes.length,
    entries: c.entries,
    groups: c.groups
      .map((g) => ({
        name: g.name,
        entry: g.entry,
        columns: g.columns,
        rowCount: g.rows.length,
        sample: g.rows.slice(0, Math.max(0, sampleRows)),
        note: g.note,
      }))
      // Biggest first: the table with four thousand rows in it is the device
      // list, whatever the vendor called it, and it is what somebody opened the
      // file to find.
      .sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name)),
    warnings: c.warnings,
  };
}

/** One group's records, from `offset`, for somebody scrolling through it. */
export function readGroupPage(
  bytes: Uint8Array,
  fileName: string,
  groupName: string,
  offset = 0,
  limit = 200,
): GroupPage | undefined {
  const group = collect(bytes, fileName).groups.find((g) => g.name === groupName);
  if (!group) return undefined;
  const from = Math.max(0, Math.min(offset, group.rows.length));
  return {
    name: group.name,
    columns: group.columns,
    rows: group.rows.slice(from, from + Math.max(0, limit)),
    total: group.rows.length,
    offset: from,
  };
}
