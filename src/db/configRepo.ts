import { getDb, inTransaction, nowIso } from '@/db';
import {
  emptySummary, type ConfigFileRecord, type ConfigSummary,
} from '@/domain/configLibrary';
import type { PanelBrand } from '@/domain/types';

/**
 * The index over the configuration files this phone holds.
 *
 * Thin, like the rest of them. Every rule about what a config record is —
 * what makes two of them the same file, what a summary says, which of them
 * describe the same building — lives in `@/domain/configLibrary` and is tested
 * without a database. This reads and writes one table.
 *
 * The one decision that is here rather than there: a row whose `summary` will
 * not parse comes back with an empty summary and a warning saying so, not with
 * plausible-looking zeroes. A config listed as holding no devices reads as a
 * config that holds no devices, and somebody would go and fetch the file
 * again. Saying the count could not be read sends them to the right place.
 */

interface ConfigRow {
  id: string;
  fileName: string;
  byteLength: number;
  fingerprint: string;
  parserId: string | null;
  brand: string;
  model: string | null;
  siteNameInFile: string | null;
  siteId: string | null;
  openedAt: string;
  lastOpenedAt: string;
  importedAt: string | null;
  summary: string;
  note: string | null;
  /** Joined from the site table, so a list does not read sites one at a time. */
  siteName?: string | null;
}

const SELECT = `
  SELECT c.*, s.name AS siteName
  FROM config_file c
  LEFT JOIN site s ON s.id = c.siteId
`;

function readSummary(raw: string, fileName: string): ConfigSummary {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    const s = parsed as Partial<ConfigSummary>;
    return {
      panels: Number(s.panels) || 0,
      loops: Number(s.loops) || 0,
      zones: Number(s.zones) || 0,
      points: Number(s.points) || 0,
      rules: Number(s.rules) || 0,
      unused: Number(s.unused) || 0,
      warnings: Array.isArray(s.warnings) ? s.warnings.filter((w): w is string => typeof w === 'string') : [],
      breakdown: Array.isArray(s.breakdown) ? s.breakdown : [],
    };
  } catch {
    return emptySummary([`What is in ${fileName} could not be read from the library. Open it to read it again.`]);
  }
}

function toRecord(r: ConfigRow): ConfigFileRecord {
  return {
    id: r.id,
    fileName: r.fileName,
    byteLength: r.byteLength,
    fingerprint: r.fingerprint,
    parserId: r.parserId ?? undefined,
    brand: r.brand as PanelBrand,
    model: r.model ?? undefined,
    siteNameInFile: r.siteNameInFile ?? undefined,
    siteId: r.siteId ?? undefined,
    siteName: r.siteName ?? undefined,
    openedAt: r.openedAt,
    lastOpenedAt: r.lastOpenedAt,
    importedAt: r.importedAt ?? undefined,
    summary: readSummary(r.summary, r.fileName),
    note: r.note ?? undefined,
  };
}

/** Everything in the library, most recently opened first. */
export async function listConfigFiles(): Promise<ConfigFileRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ConfigRow>(`${SELECT} ORDER BY c.lastOpenedAt DESC`);
  return rows.map(toRecord);
}

export async function getConfigFile(id: string): Promise<ConfigFileRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ConfigRow>(`${SELECT} WHERE c.id = ?`, id);
  return row ? toRecord(row) : null;
}

/** The record for these exact bytes, where one has been opened before. */
export async function configByFingerprint(print: string): Promise<ConfigFileRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ConfigRow>(
    `${SELECT} WHERE c.fingerprint = ? ORDER BY c.lastOpenedAt DESC LIMIT 1`,
    print,
  );
  return row ? toRecord(row) : null;
}

/** Every config tied to one site, newest first. */
export async function configsForSite(siteId: string): Promise<ConfigFileRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ConfigRow>(`${SELECT} WHERE c.siteId = ? ORDER BY c.lastOpenedAt DESC`, siteId);
  return rows.map(toRecord);
}

/** Writes a record, replacing one already there under the same id. */
export async function saveConfigFile(record: ConfigFileRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO config_file
       (id,fileName,byteLength,fingerprint,parserId,brand,model,siteNameInFile,siteId,
        openedAt,lastOpenedAt,importedAt,summary,note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    record.id, record.fileName, record.byteLength, record.fingerprint,
    record.parserId ?? null, record.brand, record.model ?? null, record.siteNameInFile ?? null,
    record.siteId ?? null, record.openedAt, record.lastOpenedAt, record.importedAt ?? null,
    JSON.stringify(record.summary), record.note ?? null,
  );
}

/**
 * The bytes of a config, or nothing where the row has lost them.
 *
 * Nothing rather than an empty array: an empty Uint8Array parses as a file
 * with nothing in it, and the screen would report a configuration holding no
 * devices instead of a configuration it could not read.
 */
export async function configBytes(id: string): Promise<Uint8Array | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ bytes: Uint8Array | null }>(
    'SELECT bytes FROM config_blob WHERE configId = ?', id,
  );
  const bytes = row?.bytes;
  if (!bytes || bytes.length === 0) return undefined;
  // expo-sqlite hands back a Uint8Array; node:sqlite hands back a Buffer,
  // which is one. Copied so a caller cannot hold a view onto the driver's own
  // buffer after the statement is finalised.
  return new Uint8Array(bytes);
}

/** Writes a config and its bytes together, so neither can exist without the other. */
export async function saveConfigWithBytes(record: ConfigFileRecord, bytes: Uint8Array): Promise<void> {
  const db = await getDb();
  await inTransaction(db, async () => {
    await saveConfigFile(record);
    await db.runAsync(
      'INSERT OR REPLACE INTO config_blob (configId,bytes) VALUES (?,?)',
      record.id, bytes,
    );
  });
}

/**
 * Records that a file has been opened again, and what was in it this time.
 *
 * The summary is rewritten rather than left alone because the parser that
 * produced it may not be the parser that produced the stored one — a build
 * that reads a format better gives a different count for the same bytes, and
 * the library should show what this build can see rather than what an older
 * one could.
 */
export async function touchConfigFile(id: string, summary: ConfigSummary, at = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE config_file SET lastOpenedAt = ?, summary = ? WHERE id = ?',
    at, JSON.stringify(summary), id,
  );
}

/** Ties a config to a site, or unties it when given nothing. */
export async function setConfigSite(id: string, siteId?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE config_file SET siteId = ? WHERE id = ?', siteId ?? null, id);
}

/** Records that this config's contents have been written into a site. */
export async function markConfigImported(id: string, siteId: string, at = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE config_file SET importedAt = ?, siteId = ? WHERE id = ?', at, siteId, id);
}

export async function setConfigNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE config_file SET note = ? WHERE id = ?', note.trim() || null, id);
}

/** Forgets a config. The bytes go with it, by the blob table's cascade. */
export async function deleteConfigFile(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM config_file WHERE id = ?', id);
}

/**
 * How much of the phone the library is using, and over how many files.
 *
 * Worth showing. A configuration is the largest single thing this app stores,
 * and a technician who has opened forty of them is entitled to know that
 * before the phone tells them instead.
 */
export async function configLibrarySize(): Promise<{ files: number; bytes: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ files: number; bytes: number | null }>(
    'SELECT COUNT(*) AS files, SUM(byteLength) AS bytes FROM config_file',
  );
  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 };
}
