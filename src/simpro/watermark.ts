import { getDb } from '@/db';
import type { SyncResource, SyncState } from './incremental';

/**
 * Reading and writing the sync watermarks.
 *
 * The office system changes every day: assets get added, sites get renamed,
 * schedules move. A phone in a plant room cannot query it live, so the honest
 * design is not "always live" but "as current as the last time there was
 * signal, and always clear about when that was". This is where that second
 * half is kept; the logic that interprets it lives in ./incremental, free of
 * the database so it can be tested.
 */

const EMPTY = (resource: SyncResource): SyncState => ({
  resource, lastRecordCount: 0, mode: 'full',
});

export async function readSyncState(resource: SyncResource): Promise<SyncState> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    resource: string; lastSyncedAt: string | null; lastChangeSeenAt: string | null;
    lastRecordCount: number; mode: string; lastError: string | null; updatedAt: string | null;
  }>('SELECT * FROM sync_state WHERE resource = ?', [resource]);
  if (!row) return EMPTY(resource);
  return {
    resource,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    lastChangeSeenAt: row.lastChangeSeenAt ?? undefined,
    lastRecordCount: row.lastRecordCount,
    mode: row.mode === 'incremental' ? 'incremental' : 'full',
    lastError: row.lastError ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
}

export async function writeSyncState(state: SyncState, now: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_state (resource, lastSyncedAt, lastChangeSeenAt, lastRecordCount, mode, lastError, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(resource) DO UPDATE SET
       lastSyncedAt = COALESCE(excluded.lastSyncedAt, sync_state.lastSyncedAt),
       lastChangeSeenAt = COALESCE(excluded.lastChangeSeenAt, sync_state.lastChangeSeenAt),
       lastRecordCount = excluded.lastRecordCount,
       mode = excluded.mode,
       lastError = excluded.lastError,
       updatedAt = excluded.updatedAt`,
    [state.resource, state.lastSyncedAt ?? null, state.lastChangeSeenAt ?? null,
     state.lastRecordCount, state.mode, state.lastError ?? null, now],
  );
}

export async function readAllSyncState(): Promise<SyncState[]> {
  const resources: SyncResource[] = [
    'sites', 'jobs', 'assets', 'employees', 'schedules', 'customers', 'quotes', 'invoices', 'tasks',
  ];
  return Promise.all(resources.map(readSyncState));
}

/**
 * Whether anything has ever been pulled onto this device.
 *
 * An empty screen has two very different causes — a device nobody connected,
 * and a device that is connected and simply has nothing yet — and until this
 * existed every screen said the same thing about both, which is how a browser
 * with an empty database read as an app that does not work.
 */
export async function everSynced(): Promise<boolean> {
  const states = await readAllSyncState();
  return states.some((s) => Boolean(s.lastSyncedAt));
}
