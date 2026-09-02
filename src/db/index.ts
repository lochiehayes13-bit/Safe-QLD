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
