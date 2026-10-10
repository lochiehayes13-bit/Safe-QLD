import { getDb, nowIso } from './index';
import type { LatLng } from '@/domain/mapPins';

/**
 * The geocode cache: address key → position, with the misses remembered.
 *
 * Read in bulk and written one row at a time, which is the shape of the work:
 * the map asks about every site at once, and the geocoder answers about one
 * address every few hundred milliseconds.
 */

/**
 * SQLite caps the number of bound variables in one statement. The default
 * build's limit is 999 and newer ones allow far more, but a chunk this size is
 * well under either and costs eight queries for the whole site list.
 */
const CHUNK = 400;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

interface PositionRow {
  key: string;
  latitude: number;
  longitude: number;
}

/** The cached positions for whichever of the keys have one. */
export async function readPositions(keys: readonly string[]): Promise<Map<string, LatLng>> {
  const out = new Map<string, LatLng>();
  if (!keys.length) return out;
  const db = await getDb();
  for (const chunk of chunks([...new Set(keys)])) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<PositionRow>(
      `SELECT key, latitude, longitude FROM geocode
       WHERE failed = 0 AND latitude IS NOT NULL AND longitude IS NOT NULL AND key IN (${placeholders})`,
      ...chunk,
    );
    for (const row of rows) out.set(row.key, { latitude: row.latitude, longitude: row.longitude });
  }
  return out;
}

/**
 * Every cached position, keyed by address key.
 *
 * One statement for the whole table rather than eight chunked ones: the map
 * wants every site's position at once, and the table is the size of the site
 * list, so reading all of it costs the same as asking about all of it.
 */
export async function readAllPositions(): Promise<Map<string, LatLng>> {
  const db = await getDb();
  const rows = await db.getAllAsync<PositionRow>(
    'SELECT key, latitude, longitude FROM geocode WHERE failed = 0 AND latitude IS NOT NULL AND longitude IS NOT NULL',
  );
  const out = new Map<string, LatLng>();
  for (const row of rows) out.set(row.key, { latitude: row.latitude, longitude: row.longitude });
  return out;
}

export async function writePosition(key: string, latitude: number, longitude: number, source: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO geocode (key, latitude, longitude, source, attemptedAt, failed)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(key) DO UPDATE SET
       latitude = excluded.latitude, longitude = excluded.longitude, source = excluded.source,
       attemptedAt = excluded.attemptedAt, failed = 0`,
    key, latitude, longitude, source, nowIso(),
  );
}

/**
 * Records that the geocoder had nothing for this address. The position is
 * cleared rather than kept: a stale hit behind a fresh miss would be read as
 * current by anything that only looked at the coordinates.
 */
export async function writeFailure(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO geocode (key, latitude, longitude, source, attemptedAt, failed)
     VALUES (?, NULL, NULL, NULL, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       latitude = NULL, longitude = NULL, source = NULL, attemptedAt = excluded.attemptedAt, failed = 1`,
    key, nowIso(),
  );
}

interface AttemptRow {
  key: string;
  failed: number;
  attemptedAt: string;
}

/**
 * The keys still worth asking the geocoder about: never attempted, or a miss
 * old enough to try again. Returned in the caller's order, so the budget is
 * spent from the top of whatever list the caller thought mattered most.
 */
export async function pendingKeys(keys: readonly string[], retryAfterDays = 30): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (!unique.length) return [];
  const db = await getDb();
  const retryBefore = new Date(Date.now() - retryAfterDays * 24 * 60 * 60 * 1000).toISOString();

  const settled = new Set<string>();
  for (const chunk of chunks(unique)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<AttemptRow>(
      `SELECT key, failed, attemptedAt FROM geocode WHERE key IN (${placeholders})`,
      ...chunk,
    );
    for (const row of rows) {
      // A hit is settled for good. A miss is settled until the retry date.
      if (!row.failed || row.attemptedAt > retryBefore) settled.add(row.key);
    }
  }
  return unique.filter((k) => !settled.has(k));
}
