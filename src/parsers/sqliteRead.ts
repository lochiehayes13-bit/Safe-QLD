/**
 * A read-only reader for the SQLite file format.
 *
 * Kentec's Taktis tool writes its site files (.nle) as SQLite databases, and
 * more than one vendor does the same. Reading them needs a SQLite engine — and
 * the app has one, expo-sqlite, but it wants a database it manages, not an
 * arbitrary file a technician just picked out of their downloads. Handing a
 * customer's site file to the app's own database layer to open is both awkward
 * and a way to corrupt it.
 *
 * So this walks the file format directly. That sounds worse than it is: the
 * format is published, versioned and explicitly guaranteed stable, and reading
 * a table is a b-tree traversal plus a record decode. Nothing here writes, so
 * the failure modes are all "refuse and say why" rather than "damage the file".
 *
 * Deliberately not a SQL engine. It lists tables and streams their rows; the
 * joining and filtering is ordinary TypeScript in the parser above it.
 */

export class SqliteError extends Error {}

export type SqlValue = number | bigint | string | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

export interface SqliteTable {
  name: string;
  /** The CREATE TABLE statement, verbatim. */
  sql: string;
  /** Column names in declaration order. */
  columns: string[];
  rootPage: number;
}

const MAGIC = 'SQLite format 3\0';

/** Interior/leaf page type codes from the b-tree page header. */
const PAGE_INTERIOR_INDEX = 2;
const PAGE_INTERIOR_TABLE = 5;
const PAGE_LEAF_INDEX = 10;
const PAGE_LEAF_TABLE = 13;

export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

function u8(b: Uint8Array, at: number): number {
  const v = b[at];
  if (v === undefined) throw new SqliteError(`Read past end of file at byte ${at}.`);
  return v;
}

function u16(b: Uint8Array, at: number): number {
  return (u8(b, at) << 8) | u8(b, at + 1);
}

function u32(b: Uint8Array, at: number): number {
  // Multiply rather than shift on the top byte: << would make anything over
  // 2 GB negative, and page numbers are unsigned.
  return u8(b, at) * 0x1000000 + (u8(b, at + 1) << 16) + (u8(b, at + 2) << 8) + u8(b, at + 3);
}

/**
 * SQLite's variable-length integer: up to nine bytes, big-endian, seven bits
 * per byte with the top bit as a continuation flag. The ninth byte, if
 * reached, contributes all eight of its bits.
 */
function varint(b: Uint8Array, at: number): { value: number; length: number } {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const byte = u8(b, at + i);
    result = result * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: result, length: i + 1 };
  }
  // Nine-byte form. Values this large are beyond exact integer range, but they
  // only occur for huge rowids and payload lengths that this reader would
  // refuse anyway; returning the approximation is better than throwing here.
  return { value: result * 256 + u8(b, at + 8), length: 9 };
}

/** Big-endian two's-complement integer of 1-8 bytes. */
function signedBE(b: Uint8Array, at: number, len: number): number | bigint {
  if (len === 0) return 0;
  if (len <= 6) {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + u8(b, at + i);
    const limit = 2 ** (len * 8 - 1);
    return v >= limit ? v - limit * 2 : v;
  }
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(u8(b, at + i));
  const bits = BigInt(len * 8);
  const signed = v >= 1n << (bits - 1n) ? v - (1n << bits) : v;
  // Hand back a plain number when it is exactly representable, so callers do
  // not have to deal with bigint for ordinary small integers.
  return signed >= -9007199254740991n && signed <= 9007199254740991n ? Number(signed) : signed;
}

function float64BE(b: Uint8Array, at: number): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  for (let i = 0; i < 8; i++) view.setUint8(i, u8(b, at + i));
  return view.getFloat64(0, false);
}

/**
 * Splits the column definitions out of a CREATE TABLE statement.
 *
 * The column names are not stored anywhere else in the file — SQLite re-parses
 * this text every time it opens the database — so there is no alternative to
 * reading it here. Only the leading identifier of each top-level
 * comma-separated clause is needed, which avoids having to understand types,
 * defaults or expressions.
 */
export function columnsFromCreateTable(sql: string): string[] {
  const open = sql.indexOf('(');
  if (open < 0) return [];

  // Walk to the matching close paren, tracking quoting so a comma or paren
  // inside a string default or a NUMERIC(10,2) does not end a clause early.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;

  for (let i = open; i < sql.length; i++) {
    const c = sql[i]!;

    if (quote) {
      current += c;
      // A doubled quote character is an escaped one, not the end.
      if (c === quote) {
        if (sql[i + 1] === quote) {
          current += c;
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '[') {
      quote = ']';
      current += c;
      continue;
    }

    if (c === '(') {
      depth++;
      if (depth === 1) continue; // the opening paren of the column list itself
      current += c;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth === 0) break;
      current += c;
      continue;
    }
    if (c === ',' && depth === 1) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);

  // Clauses that define a table constraint rather than a column.
  const CONSTRAINT = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i;

  const names: string[] = [];
  for (const part of parts) {
    const clause = part.trim();
    if (!clause || CONSTRAINT.test(clause)) continue;

    const first = clause[0]!;
    if (first === '"' || first === '`' || first === "'" || first === '[') {
      const close = first === '[' ? ']' : first;
      let name = '';
      let i = 1;
      for (; i < clause.length; i++) {
        if (clause[i] === close) {
          if (clause[i + 1] === close) {
            name += close;
            i++;
            continue;
          }
          break;
        }
        name += clause[i];
      }
      names.push(name);
    } else {
      const m = clause.match(/^[A-Za-z_][A-Za-z0-9_$]*/);
      if (m) names.push(m[0]);
    }
  }
  return names;
}

/**
 * True when a column is declared `INTEGER PRIMARY KEY`, which makes it an alias
 * for the row's rowid.
 *
 * This matters: such a column is stored as NULL in every record, and the real
 * value is the rowid in the cell header. Reading it literally gives a primary
 * key column that is null on every row, which then breaks every join made on
 * it — silently, because nothing errors.
 */
function rowidAliasColumn(sql: string, columns: string[]): string | undefined {
  const open = sql.indexOf('(');
  if (open < 0) return undefined;
  const body = sql.slice(open);
  for (const col of columns) {
    const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`["'\`\\[]?${escaped}["'\`\\]]?\\s+INTEGER\\s+PRIMARY\\s+KEY\\b`, 'i');
    if (re.test(body)) return col;
  }
  return undefined;
}

export class SqliteFile {
  private readonly bytes: Uint8Array;
  readonly pageSize: number;
  readonly pageCount: number;
  /** Bytes reserved at the end of every page, normally 0. */
  private readonly reserved: number;
  private readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be';

  constructor(bytes: Uint8Array) {
    if (!isSqlite(bytes)) throw new SqliteError('Not a SQLite database — the file header does not match.');
    if (bytes.length < 100) throw new SqliteError('Truncated: shorter than the 100-byte file header.');

    this.bytes = bytes;

    const declared = u16(bytes, 16);
    // 1 is the format's way of writing 65536, which does not fit the field.
    this.pageSize = declared === 1 ? 65536 : declared;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) {
      throw new SqliteError(`Unsupported page size ${this.pageSize}.`);
    }

    this.reserved = u8(bytes, 20);
    if (this.reserved >= this.pageSize - 480) {
      throw new SqliteError(`Unusable reserved-space value ${this.reserved}.`);
    }

    const readVersion = u8(bytes, 19);
    if (readVersion > 2) {
      throw new SqliteError(`The file claims read format ${readVersion}, which this reader does not know.`);
    }

    const enc = u32(bytes, 56);
    this.encoding = enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8';

    const declaredPages = u32(bytes, 28);
    const actualPages = Math.floor(bytes.length / this.pageSize);
    // The in-header page count is only authoritative when the change counter
    // and version-valid-for match; when they disagree the file size wins. Take
    // the smaller either way so a traversal can never read past the end.
    this.pageCount = declaredPages > 0 ? Math.min(declaredPages, actualPages) : actualPages;
    if (this.pageCount < 1) throw new SqliteError('Truncated: not even one complete page.');
  }

  /** Usable bytes per page, i.e. the page minus any reserved tail. */
  private get usable(): number {
    return this.pageSize - this.reserved;
  }

  /** A page, 1-indexed as the format numbers them. */
  private page(n: number): Uint8Array {
    if (n < 1 || n > this.pageCount) {
      throw new SqliteError(`Page ${n} is outside the file (${this.pageCount} pages).`);
    }
    const start = (n - 1) * this.pageSize;
    return this.bytes.subarray(start, start + this.pageSize);
  }

  private decodeText(bytes: Uint8Array): string {
    if (this.encoding === 'utf-8') {
      // TextDecoder is present in Node and in React Native's Hermes runtime.
      if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
      return s;
    }
    const swap = this.encoding === 'utf-16be';
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const a = bytes[i]!;
      const b = bytes[i + 1]!;
      s += String.fromCharCode(swap ? (a << 8) | b : (b << 8) | a);
    }
    return s;
  }

  /**
   * Reassembles a cell payload that may continue onto overflow pages.
   *
   * The split point is not simply "one page worth". SQLite keeps a minimum
   * amount on the page itself so that a b-tree page always holds at least four
   * cells, and the arithmetic below is that rule verbatim. Getting it wrong
   * does not throw — it yields a record whose trailing columns are garbage.
   */
  private payload(page: Uint8Array, at: number, total: number, pageNumber: number): Uint8Array {
    const U = this.usable;
    const maxLocal = U - 35;

    if (total <= maxLocal) return page.subarray(at, at + total);

    const minLocal = Math.floor(((U - 12) * 32) / 255) - 23;
    const k = minLocal + ((total - minLocal) % (U - 4));
    const local = k <= maxLocal ? k : minLocal;

    const out = new Uint8Array(total);
    out.set(page.subarray(at, at + local), 0);

    let filled = local;
    let next = u32(page, at + local);
    const seen = new Set<number>([pageNumber]);

    while (filled < total) {
      if (next < 1 || next > this.pageCount) {
        throw new SqliteError(`Overflow chain points at page ${next}, which is outside the file.`);
      }
      // A corrupted file can point a chain back at itself; without this the
      // loop never ends.
      if (seen.has(next)) throw new SqliteError('Overflow page chain loops back on itself.');
      seen.add(next);

      const overflow = this.page(next);
      const chunk = Math.min(total - filled, U - 4);
      out.set(overflow.subarray(4, 4 + chunk), filled);
      filled += chunk;
      next = u32(overflow, 0);
    }

    return out;
  }

  /** Decodes one record body into values, in column order. */
  private decodeRecord(record: Uint8Array): SqlValue[] {
    const header = varint(record, 0);
    const headerEnd = header.value;
    if (headerEnd > record.length) {
      throw new SqliteError('Record header claims to be longer than the record.');
    }

    const serials: number[] = [];
    let at = header.length;
    while (at < headerEnd) {
      const s = varint(record, at);
      serials.push(s.value);
      at += s.length;
    }

    const values: SqlValue[] = [];
    let body = headerEnd;
    for (const serial of serials) {
      switch (serial) {
        case 0:
          values.push(null);
          break;
        case 1: case 2: case 3: case 4: {
          values.push(signedBE(record, body, serial));
          body += serial;
          break;
        }
        case 5:
          values.push(signedBE(record, body, 6));
          body += 6;
          break;
        case 6:
          values.push(signedBE(record, body, 8));
          body += 8;
          break;
        case 7:
          values.push(float64BE(record, body));
          body += 8;
          break;
        case 8:
          values.push(0);
          break;
        case 9:
          values.push(1);
          break;
        case 10: case 11:
          // Reserved by the format and never written by any released version.
          throw new SqliteError(`Record uses reserved serial type ${serial}.`);
        default: {
          const len = (serial - (serial % 2 === 0 ? 12 : 13)) / 2;
          if (body + len > record.length) {
            throw new SqliteError('Record value runs past the end of the record.');
          }
          const slice = record.subarray(body, body + len);
          values.push(serial % 2 === 0 ? slice.slice() : this.decodeText(slice));
          body += len;
          break;
        }
      }
    }
    return values;
  }

  /**
   * Walks a table b-tree and calls back with each row.
   *
   * Iterative rather than recursive: a deep tree on a large site file would be
   * fine either way, but the explicit stack also makes the visited-page guard
   * natural, and that guard is what stops a corrupt file spinning forever.
   */
  private walkTable(rootPage: number, onRow: (rowid: number, values: SqlValue[]) => void): void {
    const stack: number[] = [rootPage];
    const seen = new Set<number>();

    while (stack.length) {
      const pageNumber = stack.pop()!;
      if (seen.has(pageNumber)) {
        throw new SqliteError(`Page ${pageNumber} appears twice in one b-tree — the file is corrupt.`);
      }
      seen.add(pageNumber);

      const page = this.page(pageNumber);
      // Page 1 carries the 100-byte file header before its b-tree header.
      const headerAt = pageNumber === 1 ? 100 : 0;
      const type = u8(page, headerAt);

      if (type === PAGE_INTERIOR_INDEX || type === PAGE_LEAF_INDEX) {
        throw new SqliteError('Expected a table b-tree but found an index page.');
      }
      if (type !== PAGE_INTERIOR_TABLE && type !== PAGE_LEAF_TABLE) {
        throw new SqliteError(`Unknown b-tree page type ${type} on page ${pageNumber}.`);
      }

      const cellCount = u16(page, headerAt + 3);
      const cellsAt = headerAt + (type === PAGE_INTERIOR_TABLE ? 12 : 8);

      if (type === PAGE_INTERIOR_TABLE) {
        // Children are pushed in reverse so they pop in key order: the cells
        // are already sorted, and the right-most pointer covers everything
        // past the last of them. Push them forwards and the rows come back
        // shuffled, which is not wrong so much as gratuitously surprising —
        // every other SQLite reader yields a rowid table in rowid order.
        stack.push(u32(page, headerAt + 8));
        for (let i = cellCount - 1; i >= 0; i--) {
          const cellAt = u16(page, cellsAt + i * 2);
          stack.push(u32(page, cellAt));
        }
        continue;
      }

      for (let i = 0; i < cellCount; i++) {
        const cellAt = u16(page, cellsAt + i * 2);
        if (cellAt < headerAt || cellAt >= this.usable) {
          throw new SqliteError(`Cell ${i} on page ${pageNumber} points outside the page.`);
        }
        const size = varint(page, cellAt);
        const rowid = varint(page, cellAt + size.length);
        const bodyAt = cellAt + size.length + rowid.length;
        onRow(rowid.value, this.decodeRecord(this.payload(page, bodyAt, size.value, pageNumber)));
      }
    }
  }

  /** Every ordinary table in the database, in name order. */
  tables(): SqliteTable[] {
    const found: SqliteTable[] = [];

    this.walkTable(1, (_rowid, values) => {
      // sqlite_master is (type, name, tbl_name, rootpage, sql).
      const [type, name, , rootpage, sql] = values;
      if (type !== 'table' || typeof name !== 'string') return;
      // Internal bookkeeping tables have no user-visible schema.
      if (name.startsWith('sqlite_')) return;
      if (typeof rootpage !== 'number' || rootpage < 1) return;

      const ddl = typeof sql === 'string' ? sql : '';
      found.push({ name, sql: ddl, columns: columnsFromCreateTable(ddl), rootPage: rootpage });
    });

    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every row of one table, as objects keyed by column name. */
  rows(table: SqliteTable): SqlRow[] {
    const alias = rowidAliasColumn(table.sql, table.columns);
    const out: SqlRow[] = [];

    this.walkTable(table.rootPage, (rowid, values) => {
      const row: SqlRow = {};
      table.columns.forEach((col, i) => {
        // A record may hold fewer values than there are columns when a column
        // was added by ALTER TABLE after the row was written; those read as
        // their default, and NULL is the honest stand-in here.
        row[col] = i < values.length ? values[i]! : null;
      });
      if (alias) row[alias] = rowid;
      out.push(row);
    });

    return out;
  }

  /** Convenience: rows of a table looked up by name. */
  table(name: string): SqliteTable | undefined {
    return this.tables().find((t) => t.name.toLowerCase() === name.toLowerCase());
  }
}

/** Opens a database held in memory. */
export function readSqlite(bytes: Uint8Array): SqliteFile {
  return new SqliteFile(bytes);
}
