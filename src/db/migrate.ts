/**
 * Bringing a database up to the current schema.
 *
 * Pure, so the same loop that runs on the phone runs in a test against Node's
 * SQLite: the only thing it needs from a connection is the two calls below.
 *
 * Two things this gets right that the loop it replaced did not.
 *
 * **The version is recorded after each migration, not after all of them.** A
 * migration that failed part-way through the list left every earlier one
 * applied and `user_version` where it started, so the next launch replayed
 * them all — and a CREATE TABLE without IF NOT EXISTS then threw on the
 * second attempt, on every launch, for good.
 *
 * **Each migration from the second onward runs in a transaction.** A migration
 * is several statements, and one that fails on its third leaves the first two
 * behind with nothing recording that it half-happened. Rolled back whole, the
 * database is exactly where the version says it is. The first migration stays
 * bare because it switches the journal to WAL, which SQLite refuses to do
 * inside a transaction.
 */

export interface MigrationConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null | undefined>;
}

export interface MigrationOutcome {
  /** The version the database was at. */
  from: number;
  /** The version it is at now, which is the number of migrations known. */
  to: number;
}

export async function applyMigrations(
  db: MigrationConnection,
  migrations: readonly string[],
): Promise<MigrationOutcome> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const applied = row?.user_version ?? 0;

  for (let i = applied; i < migrations.length; i++) {
    const version = i + 1;
    const record = `PRAGMA user_version = ${version};`;

    if (i === 0) {
      await db.execAsync(migrations[i]!);
      await db.execAsync(record);
      continue;
    }

    await db.execAsync('BEGIN;');
    try {
      await db.execAsync(migrations[i]!);
      await db.execAsync(record);
      await db.execAsync('COMMIT;');
    } catch (e) {
      // A failed ROLLBACK has nothing to add to the error that caused it.
      await db.execAsync('ROLLBACK;').catch(() => undefined);
      throw e;
    }
  }

  return { from: applied, to: migrations.length };
}
