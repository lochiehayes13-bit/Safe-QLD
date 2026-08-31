import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './schema';

const DB_NAME = 'safeqld.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the database and brings it up to the current schema version.
 *
 * user_version tracks how many migrations have run, so an upgrade only applies
 * the ones the device has not seen.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA foreign_keys = ON;');
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
      const applied = row?.user_version ?? 0;
      for (let i = applied; i < MIGRATIONS.length; i++) {
        await db.execAsync(MIGRATIONS[i]!);
      }
      if (applied < MIGRATIONS.length) {
        await db.execAsync(`PRAGMA user_version = ${MIGRATIONS.length};`);
      }
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
