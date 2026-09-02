import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '@/db/schema';

/**
 * The app's database API, on Node's own SQLite.
 *
 * expo-sqlite cannot run under Jest, so a repository has only ever been checked
 * by reading its SQL as text. That catches a column no migration creates and
 * misses everything else — a conflict clause that overwrites what a technician
 * wrote on site, an INSERT that drops half its columns, a query that scans an
 * index it should search. Those only show up when the statement runs.
 *
 * This is the smallest adapter that lets a repository run: the four expo-sqlite
 * calls the repositories use, over `node:sqlite`, with the same shapes back.
 * A test file swaps it in for `@/db/index` with
 *
 *     jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
 *
 * and opens a database with `openMigrated()`; every repository call after that
 * lands on it.
 */

type Bind = string | number | bigint | null | Uint8Array;

export interface RanStatement {
  sql: string;
  params: Bind[];
}

export interface NodeSqliteDb {
  raw: DatabaseSync;
  /** Every statement run through the adapter, oldest first, so a test can EXPLAIN one. */
  statements: RanStatement[];
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/**
 * expo-sqlite takes parameters either spread or as one array, and binds
 * booleans and undefined; node:sqlite takes neither, so they are normalised.
 */
function bindable(params: unknown[]): Bind[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as Bind;
  });
}

export function wrapNodeSqlite(raw: DatabaseSync): NodeSqliteDb {
  const statements: RanStatement[] = [];
  const note = (sql: string, params: Bind[]): void => { statements.push({ sql, params }); };
  return {
    raw,
    statements,
    async execAsync(sql) {
      note(sql, []);
      raw.exec(sql);
    },
    async runAsync(sql, ...params) {
      const bound = bindable(params);
      note(sql, bound);
      const r = raw.prepare(sql).run(...bound);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      const bound = bindable(params);
      note(sql, bound);
      const row = raw.prepare(sql).get(...bound);
      return (row === undefined ? null : row) as T | null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      const bound = bindable(params);
      note(sql, bound);
      return raw.prepare(sql).all(...bound) as T[];
    },
    async withTransactionAsync(work) {
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    async closeAsync() {
      raw.close();
    },
  };
}

// ---------------------------------------------------------------------------
// The `@/db/index` surface, for jest.mock
// ---------------------------------------------------------------------------

let current: NodeSqliteDb | null = null;

/** Opens a fresh in-memory database at the current schema and makes it the app's. */
export function openMigrated(): NodeSqliteDb {
  const raw = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) raw.exec(m);
  const db = wrapNodeSqlite(raw);
  current = db;
  return db;
}

/** Makes an already-open database the one the repositories see. */
export function attachDb(db: NodeSqliteDb): void {
  current = db;
}

export async function getDb(): Promise<NodeSqliteDb> {
  if (!current) throw new Error('No database is open for this test. Call openMigrated() first.');
  return current;
}

export function resetDbHandle(): void {
  current = null;
}

let counter = 0;

export function newId(): string {
  counter += 1;
  return `test-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
