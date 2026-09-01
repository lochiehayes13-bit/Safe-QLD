import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'fs';
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

  it('prepares every static SELECT without a bad column', () => {
    // A column that does not exist throws when the query runs, not when it is
    // written — so a screen nobody opened in testing fails the first time a
    // technician does. prepare() resolves every column name without executing
    // anything, which is exactly the check wanted here.
    //
    // Queries assembled at runtime are skipped: their fragments are not valid
    // SQL on their own, and the pieces they interpolate are typed.
    const problems: string[] = [];
    const select = /(['"`])(SELECT[\s\S]*?)\1/gi;

    for (const { file, text } of sources) {
      select.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = select.exec(text))) {
        const sql = m[2]!.trim();
        if (sql.includes('${')) continue;
        try {
          db.prepare(sql);
        } catch (e) {
          problems.push(`${file}: ${(e as Error).message} — ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  afterAll(() => db.close());
});

/**
 * A table the app fills and never reads.
 *
 * `asset_schedule` was one. The importer wrote a row per routine into it on
 * every register import — thirty-one thousand of them on the real one — the
 * schema gave it a unique index on (assetId, frequency) and another on
 * nextDueAt for a query nobody had written, and no repository ever selected
 * from it. The reason the table exists is written in its own schema comment:
 * an extinguisher is due six-monthly, yearly and five-yearly on three different
 * dates and the asset's single nextDueAt can only hold the soonest. The app
 * showed the soonest.
 *
 * That is this repository's recurring failure, in the schema rather than in the
 * router: something finished, correct, and reachable from nothing. It cost
 * nothing to run and it silently threw away the only answer to "which routine
 * is this asset actually due for", which is the question a technician standing
 * in front of it is asking.
 *
 * A write with no read is the shape that catches it, and it is cheap to check.
 */
describe('tables the app writes to', () => {
  const schema = MIGRATIONS.join('\n');
  const declared = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]!);

  /**
   * Read somewhere else, and deliberately.
   *
   * `defect_code` mirrors the DEFECT_LIBRARY constant, which is what the app
   * actually reads — `defectByCode` resolves against the TypeScript, never
   * against a row. Its sibling `asset_type` is seeded the same way and *is*
   * joined against, so this is a real asymmetry rather than a convention.
   * Left as it is because deciding whether the database should describe its own
   * defect vocabulary is a call about the schema, not a bug to fix quietly.
   */
  const KNOWN_WRITE_ONLY = new Set(['defect_code']);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__'].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !entry.includes('schema')) out.push(full);
    }
    return out;
  }

  const code = ['src', 'app'].flatMap((r) => walk(r)).map((f) => readFileSync(f, 'utf8')).join('\n');

  it('has tables to check and code to check them against', () => {
    // Both halves can silently become empty, and either would pass forever.
    expect(declared.length).toBeGreaterThan(20);
    expect(declared).toContain('asset_schedule');
    expect(code.length).toBeGreaterThan(100_000);
  });

  it('reads every table it writes to', () => {
    const writeOnly: string[] = [];
    for (const table of declared) {
      if (KNOWN_WRITE_ONLY.has(table)) continue;
      const written = new RegExp(`(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i').test(code);
      const read = new RegExp(`(?:FROM|JOIN)\\s+${table}\\b`, 'i').test(code);
      if (written && !read) writeOnly.push(table);
    }
    // Named rather than counted: the fix is a repository function and a screen,
    // and neither is findable from a number.
    expect(writeOnly).toEqual([]);
  });

  it('names the one exception rather than hiding it in a count', () => {
    // An allowlist that nobody has to justify is a way of never fixing
    // anything, so the entry has to still be true.
    for (const table of KNOWN_WRITE_ONLY) {
      expect(declared).toContain(table);
      expect(new RegExp(`(?:FROM|JOIN)\\s+${table}\\b`, 'i').test(code)).toBe(false);
    }
  });
});
