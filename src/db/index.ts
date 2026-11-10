import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './schema';
import { applyMigrations } from './migrate';

const DB_NAME = 'safeqld.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the database and brings it up to the current schema version.
 *
 * user_version tracks how many migrations have run, so an upgrade only applies
 * the ones the device has not seen. The loop itself lives in migrate.ts so the
 * test suite runs the same one against Node's SQLite.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await applyMigrations(db, MIGRATIONS);
      return db;
    })();
  }
  return dbPromise;
}

/** Test hook: drops the cached connection so a fresh one is opened next call. */
export function resetDbHandle(): void {
  dbPromise = null;
}

/** The one call a transaction needs from a connection. */
export interface TransactionalDb {
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
}

/** Connections with a transaction open right now. See inTransaction. */
const open = new WeakSet<object>();

/**
 * Runs work inside a transaction, or inside the one already open.
 *
 * expo-sqlite's withTransactionAsync is a bare BEGIN and COMMIT on the single
 * shared connection: a second BEGIN while one is open throws "cannot start a
 * transaction within a transaction", and the loser's ROLLBACK undoes the
 * winner's work so far. Two callers overlap in ordinary use — the pull's
 * detail prefetch and the job screen's own read of the same job, or a
 * technician's save landing mid-pull — so every multi-statement write goes
 * through here rather than opening one itself. While a transaction is open
 * on the connection the work simply joins it: it commits or rolls back with
 * the one already running, which is what SQLite would have done had the two
 * been written as one, and nothing is thrown.
 *
 * Tracked per connection so the test double, which has its own connection,
 * gets the same rule.
 */
export async function inTransaction(db: TransactionalDb, work: () => Promise<void>): Promise<void> {
  if (open.has(db)) {
    await work();
    return;
  }
  open.add(db);
  try {
    await db.withTransactionAsync(work);
  } finally {
    open.delete(db);
  }
}

/** Whether a transaction is open on the connection right now. */
export function transactionIsOpen(db: TransactionalDb): boolean {
  return open.has(db);
}

/** RFC4122-ish v4 id. Not cryptographic — just needs to be unique on-device. */
export function newId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 12) out += '4';
    else if (i === 16) out += hex[(Math.floor(Math.random() * 4) + 8)]!;
    else out += hex[Math.floor(Math.random() * 16)]!;
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
