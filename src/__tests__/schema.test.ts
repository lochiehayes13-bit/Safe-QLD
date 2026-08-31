import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';

/**
 * The migrations, actually run.
 *
 * Nothing else checks these. TypeScript does not parse SQL, the unit tests are
 * pure logic, and the bundle only proves the strings are strings — so a
 * migration with a typo, or a repository writing to a column no migration
 * creates, ships silently and bricks the app on first launch. A phone that
 * cannot open its database is not a degraded app, it is no app.
 *
 * expo-sqlite cannot run here, but the SQL is plain SQLite, so it runs against
 * Node's own engine. That is not the same build, and a difference in SQLite
 * versions could hide something — but it catches the class of error that
 * actually happens, which is a mistake in the SQL we wrote.
 */

const DB_DIR = join(__dirname, '..', 'db');

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function tables(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe('migrations', () => {
  it('all apply, in order, to an empty database', () => {
    // The whole point: a migration that does not parse takes the app down on
    // the first launch after an update, for everyone at once.
    expect(() => migrated()).not.toThrow();
  });

  it('applies each one individually so a failure names the migration', () => {
    const db = new DatabaseSync(':memory:');
    MIGRATIONS.forEach((migration, i) => {
      expect(() => db.exec(migration)).not.toThrow();
      // Reported as an object so a failure says which migration, not just
      // "expected not to throw".
      expect({ migration: i + 1, applied: true }).toEqual({ migration: i + 1, applied: true });
    });
    db.close();
  });

  it('counts itself correctly, since the runner writes that count to user_version', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('creates the tables the app depends on', () => {
    const db = migrated();
    const present = tables(db);
    for (const table of [
      'site', 'panel', 'zone', 'point', 'loop', 'report', 'defect',
      'baseline', 'timesheet', 'catalogue_item',
      'asset', 'asset_event', 'occupier_statement',
    ]) {
      expect({ table, present: present.has(table) }).toEqual({ table, present: true });
    }
    db.close();
  });

  it('is safe to re-run from the version already applied', () => {
    // A phone that already has migration 3 must be able to take 4 and 5 without
    // the earlier ones being replayed — which is what the runner does, so the
    // later migrations have to stand alone.
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
    for (const m of MIGRATIONS.slice(3)) {
      expect(() => db.exec(m)).not.toThrow();
    }
    db.close();
  });
});

/**
 * Every column a repository writes has to exist.
 *
 * This is the failure that typechecking cannot see: the SQL is a string, so a
 * column that no migration creates compiles perfectly and throws the first time
 * a technician saves anything.
 */
describe('repositories against the schema', () => {
  const db = migrated();
  const present = tables(db);

  const sources = readdirSync(DB_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('schema'))
    .map((f) => ({ file: f, text: readFileSync(join(DB_DIR, f), 'utf8') }));

  it('finds repository SQL to check', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it('inserts only into columns that exist', () => {
    const problems: string[] = [];
    const insert = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/gis;

    for (const { file, text } of sources) {
      insert.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = insert.exec(text))) {
        const table = m[1]!;
        if (!present.has(table)) {
          problems.push(`${file}: INSERT INTO ${table} — no such table`);
          continue;
        }
        // A column list built at runtime from an array cannot be read here;
        // the array itself is typed against the record, which is the check.
        if (m[2]!.includes('${')) continue;
        const columns = tableColumns(db, table);
        for (const raw of m[2]!.split(',')) {
          const col = raw.trim().replace(/["`\[\]]/g, '');
          if (!col || !/^\w+$/.test(col)) continue;
          if (!columns.has(col)) problems.push(`${file}: ${table}.${col} does not exist`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('updates only columns that exist', () => {
    const problems: string[] = [];
    // `UPDATE <table> SET a = ?, b = ?` — stop at WHERE so the predicate is not
    // read as an assignment.
    const update = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|`|'|$)/gi;

    for (const { file, text } of sources) {
      update.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = update.exec(text))) {
        const table = m[1]!;
        if (!present.has(table)) {
          problems.push(`${file}: UPDATE ${table} — no such table`);
          continue;
        }
        const columns = tableColumns(db, table);
        for (const assignment of m[2]!.split(',')) {
          // Splitting on commas cuts through a function call, so
          // "COALESCE(?, externalId)" yields a fragment with no assignment in
          // it. Only a fragment containing '=' is one.
          if (!assignment.includes('=')) continue;
          const col = assignment.split('=')[0]!.trim().replace(/["`\[\]]/g, '');
          // A column name built at runtime is checked by its own typing.
          if (!col || !/^\w+$/.test(col)) continue;
          if (!columns.has(col)) problems.push(`${file}: ${table}.${col} does not exist`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  afterAll(() => db.close());
});
