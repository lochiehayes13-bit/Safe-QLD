import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteError, columnsFromCreateTable, isSqlite, readSqlite } from '@/parsers/sqliteRead';

/**
 * The SQLite reader, checked against SQLite.
 *
 * This is a from-scratch implementation of a published binary format, which is
 * a thing that can be subtly wrong for a long time without anyone noticing:
 * a mistake in the overflow arithmetic does not throw, it silently returns a
 * record whose trailing columns are garbage. So rather than asserting against
 * values written into the test, every case builds a real database with Node's
 * own SQLite and requires the two readers to agree.
 *
 * The overflow cases are laboured because the real vendor file does not
 * exercise them at all — its widest row is 893 bytes against a 989-byte
 * threshold — so a bug there would have passed every test that only used real
 * data, and then corrupted the first large site that came along.
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sqlite-read-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;

/** Builds a database with the given statements and returns its bytes. */
function build(statements: string[], pageSize = 4096): Uint8Array {
  const path = join(dir, `db-${counter++}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA page_size=${pageSize}`);
  for (const sql of statements) db.exec(sql);
  db.close();
  return new Uint8Array(readFileSync(path));
}

/** Rows as Node's SQLite reads them, for comparison. */
function reference(bytes: Uint8Array, table: string): Record<string, unknown>[] {
  const path = join(dir, `ref-${counter++}.sqlite`);
  require('fs').writeFileSync(path, bytes);
  return new DatabaseSync(path, { readOnly: true }).prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
}

const normalise = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return Array.from(v).join(',');
  return v;
};

/** Asserts this reader and Node's agree on every value of a table. */
function expectAgreement(bytes: Uint8Array, table: string): number {
  const mine = readSqlite(bytes);
  const t = mine.table(table);
  expect(t).toBeDefined();
  const got = mine.rows(t!);
  const want = reference(bytes, table);

  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    for (const column of Object.keys(want[i]!)) {
      expect([column, normalise(got[i]![column])]).toEqual([column, normalise(want[i]![column])]);
    }
  }
  return got.length;
}

describe('agreeing with SQLite itself', () => {
  it('reads every storage class back unchanged', () => {
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, i INTEGER, r REAL, s TEXT, b BLOB, n INTEGER)',
      `INSERT INTO t (i, r, s, b, n) VALUES
         (0, 0.0, '', x'', NULL),
         (1, 1.5, 'ZONE 1', x'00ff10', 42),
         (-1, -1.5, 'café', x'deadbeef', NULL),
         (127, 3.141592653589793, 'MCP ON FIP DOOR', x'0102030405', 0),
         (-32768, -0.000001, 'a b  c', x'ff', 1)`,
    ]);
    expect(expectAgreement(bytes, 't')).toBe(5);
  });

  it('reads integers at every width the format uses', () => {
    // Serial types 1-6 are 1, 2, 3, 4, 6 and 8 byte integers, and each has its
    // own sign handling. A value just either side of each boundary catches a
    // width read as the wrong one.
    const values = [
      0, 1, -1, 127, -128, 128, 32767, -32768, 32768,
      8388607, -8388608, 8388608, 2147483647, -2147483648, 2147483648,
      140737488355327, -140737488355328,
      Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
    ];
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)',
      `INSERT INTO t (v) VALUES ${values.map((v) => `(${v})`).join(',')}`,
    ]);
    expect(expectAgreement(bytes, 't')).toBe(values.length);
  });

  it('substitutes the rowid for an INTEGER PRIMARY KEY column', () => {
    // Such a column is stored as NULL in every record; the value lives in the
    // cell header. Read literally it is null on every row, which then breaks
    // every join made on it — and nothing errors, so the damage is silent.
    const bytes = build([
      'CREATE TABLE t (DeviceKey INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)',
      "INSERT INTO t (name) VALUES ('a'), ('b'), ('c')",
      "DELETE FROM t WHERE name = 'b'",
      "INSERT INTO t (name) VALUES ('d')",
    ]);
    const rows = readSqlite(bytes).rows(readSqlite(bytes).table('t')!);
    expect(rows.map((r) => r.DeviceKey)).toEqual([1, 3, 4]);
    expect(rows.every((r) => r.DeviceKey !== null)).toBe(true);
    expectAgreement(bytes, 't');
  });

  it('returns rows in rowid order, as an unordered SELECT does', () => {
    // Enough rows at a small page to make the tree more than one level deep,
    // so the order depends on the traversal rather than on insertion.
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)',
      `INSERT INTO t (v) VALUES ${Array.from({ length: 400 }, (_, i) => `(${i})`).join(',')}`,
    ], 512);
    const db = readSqlite(bytes);
    const ids = db.rows(db.table('t')!).map((r) => r.id as number);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.length).toBe(400);
  });
});

describe('overflow pages', () => {
  /**
   * A payload longer than fits on its page continues onto a chain of overflow
   * pages, and how much stays behind is not "one page worth" — it is an
   * arithmetic rule that keeps at least four cells on every b-tree page. The
   * lengths below straddle that split deliberately.
   */
  for (const pageSize of [512, 1024, 4096]) {
    it(`splits and reassembles correctly at a ${pageSize}-byte page`, () => {
      const lengths = [
        0, 1, 50,
        pageSize - 60, pageSize - 40, pageSize - 36, pageSize - 35, pageSize - 34,
        pageSize, pageSize + 1, pageSize * 2, pageSize * 3 + 7, pageSize * 17 + 13,
      ];
      const bytes = build([
        'CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT, body TEXT)',
        `INSERT INTO t (label, body) VALUES ${lengths.map((n) => `('row-${n}', '${'x'.repeat(n)}')`).join(',')}`,
      ], pageSize);

      expect(expectAgreement(bytes, 't')).toBe(lengths.length);

      // And the longest really did overflow, so the test is not passing
      // because everything happened to fit.
      const db = readSqlite(bytes);
      const bodies = db.rows(db.table('t')!).map((r) => String(r.body ?? '').length);
      expect(Math.max(...bodies)).toBe(pageSize * 17 + 13);
      expect(Math.max(...bodies)).toBeGreaterThan(pageSize);
    });
  }

  it('reassembles a blob across a chain without shifting a byte', () => {
    // Text that is one byte out still reads as text. A blob compared byte for
    // byte does not forgive an off-by-one in the chunk arithmetic.
    const blob = Array.from({ length: 40000 }, (_, i) => (i * 31 + 7) % 256);
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, b BLOB)',
      `INSERT INTO t (b) VALUES (x'${blob.map((v) => v.toString(16).padStart(2, '0')).join('')}')`,
    ], 512);
    const db = readSqlite(bytes);
    const got = db.rows(db.table('t')!)[0]!.b as Uint8Array;
    expect(got.length).toBe(blob.length);
    expect(Array.from(got)).toEqual(blob);
  });
});

describe('trees deeper than one page', () => {
  it('walks interior pages and finds every row', () => {
    // Enough rows at a small page size to force several levels of b-tree, so
    // the interior-page path is exercised rather than assumed.
    const rows = 5000;
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)',
      `INSERT INTO t (v) VALUES ${Array.from({ length: rows }, (_, i) => `('device ${i}')`).join(',')}`,
    ], 512);
    const db = readSqlite(bytes);
    const got = db.rows(db.table('t')!);
    expect(got.length).toBe(rows);
    expect(got[0]!.v).toBe('device 0');
    expect(got[rows - 1]!.v).toBe(`device ${rows - 1}`);
    expect(new Set(got.map((r) => r.id)).size).toBe(rows);
  });

  it('is not confused by indexes on the table', () => {
    // An index is a b-tree too, and walking into one instead of the table
    // would yield keys rather than rows.
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, zone INTEGER, v TEXT)',
      `INSERT INTO t (zone, v) VALUES ${Array.from({ length: 500 }, (_, i) => `(${i % 20}, 'v${i}')`).join(',')}`,
      'CREATE INDEX idx_zone ON t (zone)',
      'CREATE UNIQUE INDEX idx_v ON t (v)',
    ], 512);
    expect(expectAgreement(bytes, 't')).toBe(500);
  });
});

describe('reading the schema', () => {
  it('lists user tables and skips SQLite internals', () => {
    const bytes = build([
      'CREATE TABLE Zones (ZoneKey INTEGER PRIMARY KEY AUTOINCREMENT, ZoneName TEXT)',
      'CREATE TABLE Devices (DeviceKey INTEGER PRIMARY KEY AUTOINCREMENT)',
      'CREATE VIEW v AS SELECT 1',
      "INSERT INTO Zones (ZoneName) VALUES ('HALL')",
    ]);
    const names = readSqlite(bytes).tables().map((t) => t.name);
    expect(names).toContain('Zones');
    expect(names).toContain('Devices');
    // sqlite_sequence exists because of AUTOINCREMENT, and is not a user table.
    expect(names.some((n) => n.startsWith('sqlite_'))).toBe(false);
    expect(names).not.toContain('v');
  });

  it('finds a table case-insensitively, as SQL does', () => {
    const bytes = build(['CREATE TABLE Zones (a INTEGER)']);
    expect(readSqlite(bytes).table('zones')?.name).toBe('Zones');
    expect(readSqlite(bytes).table('ZONES')?.name).toBe('Zones');
    expect(readSqlite(bytes).table('nope')).toBeUndefined();
  });
});

describe('reading column names out of a CREATE TABLE', () => {
  // The column names live nowhere else in the file — SQLite re-parses this
  // text every time it opens a database — so getting this wrong shifts every
  // value one column to the left, which reads as data rather than as an error.

  it('handles the ordinary case', () => {
    expect(columnsFromCreateTable('CREATE TABLE t (a INTEGER, b TEXT, c REAL)')).toEqual(['a', 'b', 'c']);
  });

  it('does not split inside a parenthesised type', () => {
    expect(columnsFromCreateTable('CREATE TABLE t (a NUMERIC(10,2), b VARCHAR(255), c INT)'))
      .toEqual(['a', 'b', 'c']);
  });

  it('does not split on a comma inside a string default', () => {
    expect(columnsFromCreateTable(`CREATE TABLE t (a TEXT DEFAULT 'x,y', b INTEGER)`)).toEqual(['a', 'b']);
    expect(columnsFromCreateTable('CREATE TABLE t (a TEXT NOT NULL DEFAULT "", b INTEGER)')).toEqual(['a', 'b']);
  });

  it('unquotes quoted identifiers in all four styles', () => {
    expect(columnsFromCreateTable('CREATE TABLE "t" ("a b" INTEGER, `c d` TEXT, [e f] REAL, g INT)'))
      .toEqual(['a b', 'c d', 'e f', 'g']);
  });

  it('skips table constraints, which are not columns', () => {
    expect(columnsFromCreateTable(
      'CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b), ' +
      'FOREIGN KEY (b) REFERENCES u(id), UNIQUE (a), CHECK (a > 0), CONSTRAINT ck CHECK (b > 0))',
    )).toEqual(['a', 'b']);
  });

  it('matches what SQLite itself reports, on a deliberately awkward schema', () => {
    const ddl =
      'CREATE TABLE "Odd Table" (' +
      '"Zone Key" INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'Name TEXT NOT NULL DEFAULT "", ' +
      "Note TEXT DEFAULT 'a,b(c)', " +
      'Amount NUMERIC(10,2) NOT NULL DEFAULT 0, ' +
      '[Odd Name] BOOLEAN NOT NULL DEFAULT 0, ' +
      'CHECK (Amount >= 0))';
    const bytes = build([ddl, `INSERT INTO "Odd Table" (Name) VALUES ('x')`]);
    const db = readSqlite(bytes);
    const table = db.table('Odd Table')!;
    expect(table.columns).toEqual(Object.keys(reference(bytes, 'Odd Table')[0]!));
    expect(db.rows(table)[0]!['Zone Key']).toBe(1);
  });
});

describe('refusing what it cannot read correctly', () => {
  it('rejects a file that is not a database', () => {
    expect(isSqlite(new Uint8Array(16))).toBe(false);
    expect(() => readSqlite(new TextEncoder().encode('not a database at all, just some text')))
      .toThrow(SqliteError);
  });

  it('rejects a truncated header', () => {
    const bytes = build(['CREATE TABLE t (a INTEGER)']);
    expect(() => readSqlite(bytes.slice(0, 50))).toThrow(/truncated/i);
  });

  it('rejects an impossible page size rather than reading garbage', () => {
    const bytes = build(['CREATE TABLE t (a INTEGER)']);
    const damaged = Uint8Array.from(bytes);
    damaged[16] = 0x00;
    damaged[17] = 0x03; // 768: not a power of two
    expect(() => readSqlite(damaged)).toThrow(/page size/i);
  });

  it('refuses a b-tree page whose type it does not know', () => {
    // Rather than treating an unrecognised page as a leaf and reading its
    // bytes as cells, which produces rows that look real.
    const bytes = build([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)',
      "INSERT INTO t (v) VALUES ('a'), ('b')",
    ]);
    const db = readSqlite(bytes);
    const root = db.table('t')!.rootPage;
    const damaged = Uint8Array.from(bytes);
    damaged[(root - 1) * db.pageSize] = 99;
    const broken = readSqlite(damaged);
    expect(() => broken.rows(broken.table('t')!)).toThrow(/page type/i);
  });
});

/**
 * Against the real Kentec site file when it is present. Customer
 * configurations are never committed, so this is skipped on CI — every case
 * above builds its own database precisely so the coverage does not depend on
 * it.
 */
const REAL = '/tmp/panels/taktis.nle';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against a real vendor database', () => {
  it('agrees with SQLite on every value in every table', () => {
    const bytes = new Uint8Array(readFileSync(REAL));
    const db = readSqlite(bytes);
    const tables = db.tables();
    expect(tables.length).toBeGreaterThan(50);

    let cells = 0;
    for (const table of tables) {
      const got = db.rows(table);
      const want = reference(bytes, table.name);
      expect([table.name, got.length]).toEqual([table.name, want.length]);
      for (let i = 0; i < want.length; i++) {
        for (const column of table.columns) {
          expect(normalise(got[i]![column])).toEqual(normalise(want[i]![column]));
          cells++;
        }
      }
    }
    expect(cells).toBeGreaterThan(10000);
  });
});
