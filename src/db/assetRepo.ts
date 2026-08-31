import { getDb, newId, nowIso } from './index';
import { ASSET_TYPES, type SystemKind } from '@/seed/assetTypes';
import { DEFECT_LIBRARY } from '@/seed/defectLibrary';

/**
 * Asset engine persistence.
 *
 * Assets form a tree — site, level, panel, loop, device — so most reads are
 * either "everything under this parent" or "everything of this type on this
 * site". Both are indexed; anything deeper is derived in memory because a site
 * tree is small enough to hold and recursive SQL would be worse to maintain.
 */

export interface AssetRecord {
  id: string;
  siteId: string;
  assetTypeId: string;
  parentAssetId?: string;
  code?: string;
  name: string;
  level?: string;
  room?: string;
  locationNote?: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  serial?: string;
  catalogueItemId?: string;
  installedDate?: string;
  status: string;
  attributes: Record<string, string | number | boolean>;
  lastServicedAt?: string;
  lastResult?: string;
  nextDueAt?: string;
  openDefects: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetEventKind =
  | 'installed' | 'tested' | 'passed' | 'failed' | 'cleaned' | 'repaired'
  | 'replaced' | 'isolated' | 'restored' | 'defect-raised' | 'defect-cleared'
  /* An attempt that could not be carried out. Distinct from a pass and from a
     failure: it is a gap in coverage, and the reason is what makes it
     defensible on the record. */
  | 'not-tested'
  | 'moved' | 'noted';

export interface AssetEvent {
  id: string;
  assetId: string;
  kind: AssetEventKind;
  occurredAt: string;
  technician?: string;
  jobId?: string;
  reportId?: string;
  summary: string;
  detail?: string;
  photos: string[];
  measurements: Record<string, string | number>;
}

interface AssetRow extends Omit<AssetRecord, 'attributes'> {
  attributes: string;
}
interface EventRow extends Omit<AssetEvent, 'photos' | 'measurements'> {
  photos: string;
  measurements: string;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return (JSON.parse(s) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const hydrate = (r: AssetRow): AssetRecord => ({ ...r, attributes: parseJson(r.attributes, {}) });
const hydrateEvent = (r: EventRow): AssetEvent => ({
  ...r,
  photos: parseJson<string[]>(r.photos, []),
  measurements: parseJson<Record<string, string | number>>(r.measurements, {}),
});

/**
 * Seeds the type catalogue and defect library.
 *
 * Runs on every start and upserts, so shipping a new asset type or defect code
 * reaches existing installs without a migration.
 */
export async function seedReferenceData(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [i, t] of ASSET_TYPES.entries()) {
      await db.runAsync(
        `INSERT INTO asset_type (id,label,system,icon,attributes,container,sortIndex)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           label=excluded.label, system=excluded.system, icon=excluded.icon,
           attributes=excluded.attributes, container=excluded.container, sortIndex=excluded.sortIndex`,
        t.id, t.label, t.system, t.icon, JSON.stringify(t.attributes), t.container ? 1 : 0, i,
      );
    }
    for (const d of DEFECT_LIBRARY) {
      await db.runAsync(
        `INSERT INTO defect_code (code,system,component,defect,severity,reportWording,clientWording,rectification,quoteItems,sourceKind,sourceRef,photoRequired)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET
           system=excluded.system, component=excluded.component, defect=excluded.defect,
           severity=excluded.severity, reportWording=excluded.reportWording,
           clientWording=excluded.clientWording, rectification=excluded.rectification,
           quoteItems=excluded.quoteItems, photoRequired=excluded.photoRequired`,
        d.code, d.system, d.component, d.defect, d.severity, d.reportWording,
        d.clientWording ?? null, d.rectification ?? null, JSON.stringify(d.quoteItems ?? []),
        d.sourceKind ?? 'internal', d.sourceRef ?? null, d.photoRequired ? 1 : 0,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetQuery {
  siteId?: string;
  parentAssetId?: string | null;
  assetTypeId?: string;
  system?: SystemKind;
  search?: string;
  status?: string;
  /** Only assets due on or before this ISO date. */
  dueBefore?: string;
  limit?: number;
}

export async function queryAssets(q: AssetQuery): Promise<AssetRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (q.siteId) { where.push('a.siteId = ?'); args.push(q.siteId); }
  if (q.parentAssetId === null) where.push('a.parentAssetId IS NULL');
  else if (q.parentAssetId) { where.push('a.parentAssetId = ?'); args.push(q.parentAssetId); }
  if (q.assetTypeId) { where.push('a.assetTypeId = ?'); args.push(q.assetTypeId); }
  if (q.system) { where.push('t.system = ?'); args.push(q.system); }
  if (q.status) { where.push('a.status = ?'); args.push(q.status); }
  if (q.dueBefore) { where.push('a.nextDueAt IS NOT NULL AND a.nextDueAt <= ?'); args.push(q.dueBefore); }
  if (q.search?.trim()) {
    const term = `%${q.search.trim()}%`;
    where.push('(a.name LIKE ? OR a.code LIKE ? OR a.serial LIKE ? OR a.model LIKE ? OR a.room LIKE ?)');
    args.push(term, term, term, term, term);
  }

  args.push(q.limit ?? 2000);
  const rows = await db.getAllAsync<AssetRow>(
    `SELECT a.* FROM asset a JOIN asset_type t ON a.assetTypeId = t.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.sortIndex, a.level, a.room, a.name LIMIT ?`,
    ...args,
  );
  return rows.map(hydrate);
}

export async function getAsset(id: string): Promise<AssetRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AssetRow>('SELECT * FROM asset WHERE id = ?', id);
  return row ? hydrate(row) : null;
}

/**
 * Finds an asset by the code printed on its tag.
 *
 * Matched case-insensitively and with surrounding whitespace ignored: a scanner
 * returns exactly what is encoded, and a tag printed years ago may not match
 * today's convention on case. An exact match would send a technician standing
 * in front of the right device to a "not found".
 */
export async function getAssetByCode(code: string): Promise<AssetRecord | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const db = await getDb();
  const row = await db.getFirstAsync<AssetRow>(
    'SELECT * FROM asset WHERE code IS NOT NULL AND UPPER(code) = UPPER(?) LIMIT 1',
    trimmed,
  );
  return row ? hydrate(row) : null;
}

/** Finds an asset by serial, so "where is serial 123456?" is answerable. */
export async function findBySerial(serial: string): Promise<AssetRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AssetRow>('SELECT * FROM asset WHERE serial = ? OR serial LIKE ?', serial, `%${serial}%`);
  return rows.map(hydrate);
}

/**
 * Generates the next asset code for a type, e.g. SQ-DET-0001847.
 *
 * Numbering is per prefix and derived from the highest existing code rather
 * than a counter table, so it stays correct after an import.
 */
export async function nextAssetCode(assetTypeId: string): Promise<string> {
  const db = await getDb();
  const type = ASSET_TYPES.find((t) => t.id === assetTypeId);
  const prefix = `SQ-${type?.codePrefix ?? 'AST'}-`;
  const row = await db.getFirstAsync<{ code: string }>(
    'SELECT code FROM asset WHERE code LIKE ? ORDER BY code DESC LIMIT 1',
    `${prefix}%`,
  );
  const last = row?.code ? parseInt(row.code.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}${String(next).padStart(7, '0')}`;
}

export async function createAsset(input: Partial<AssetRecord> & { siteId: string; assetTypeId: string }): Promise<AssetRecord> {
  const db = await getDb();
  const now = nowIso();
  const asset: AssetRecord = {
    id: input.id ?? newId(),
    siteId: input.siteId,
    assetTypeId: input.assetTypeId,
    parentAssetId: input.parentAssetId,
    code: input.code ?? (await nextAssetCode(input.assetTypeId)),
    name: input.name ?? '',
    level: input.level,
    room: input.room,
    locationNote: input.locationNote,
    manufacturer: input.manufacturer,
    model: input.model,
    partNumber: input.partNumber,
    serial: input.serial,
    catalogueItemId: input.catalogueItemId,
    installedDate: input.installedDate,
    status: input.status ?? 'in-service',
    attributes: input.attributes ?? {},
    lastServicedAt: input.lastServicedAt,
    lastResult: input.lastResult,
    nextDueAt: input.nextDueAt,
    openDefects: 0,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };

  await db.runAsync(
    `INSERT INTO asset (id,siteId,assetTypeId,parentAssetId,code,name,level,room,locationNote,
       manufacturer,model,partNumber,serial,catalogueItemId,installedDate,status,attributes,
       lastServicedAt,lastResult,nextDueAt,openDefects,notes,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    asset.id, asset.siteId, asset.assetTypeId, asset.parentAssetId ?? null, asset.code ?? null,
    asset.name, asset.level ?? null, asset.room ?? null, asset.locationNote ?? null,
    asset.manufacturer ?? null, asset.model ?? null, asset.partNumber ?? null, asset.serial ?? null,
    asset.catalogueItemId ?? null, asset.installedDate ?? null, asset.status,
    JSON.stringify(asset.attributes), asset.lastServicedAt ?? null, asset.lastResult ?? null,
    asset.nextDueAt ?? null, 0, asset.notes ?? null, asset.createdAt, asset.updatedAt,
  );

  if (asset.installedDate) {
    await addAssetEvent({
      assetId: asset.id, kind: 'installed', occurredAt: asset.installedDate,
      summary: `Installed${asset.model ? ` — ${asset.model}` : ''}`,
    });
  }
  return asset;
}

export async function updateAsset(id: string, patch: Partial<AssetRecord>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const textFields = ['name', 'level', 'room', 'locationNote', 'manufacturer', 'model', 'partNumber',
    'serial', 'catalogueItemId', 'installedDate', 'status', 'lastServicedAt', 'lastResult',
    'nextDueAt', 'notes', 'code', 'parentAssetId'] as const;

  for (const f of textFields) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  if (patch.attributes !== undefined) { sets.push('attributes = ?'); vals.push(JSON.stringify(patch.attributes)); }
  if (patch.openDefects !== undefined) { sets.push('openDefects = ?'); vals.push(patch.openDefects); }
  if (!sets.length) return;

  sets.push('updatedAt = ?');
  vals.push(nowIso());
  await db.runAsync(`UPDATE asset SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM asset WHERE id = ?', id);
}

/** Counts by system for a site, used on the site overview. */
export async function assetCountsBySystem(siteId: string): Promise<{ system: string; count: number }[]> {
  const db = await getDb();
  return db.getAllAsync<{ system: string; count: number }>(
    `SELECT t.system AS system, COUNT(*) AS count
     FROM asset a JOIN asset_type t ON a.assetTypeId = t.id
     WHERE a.siteId = ? GROUP BY t.system ORDER BY count DESC`,
    siteId,
  );
}

// ---------------------------------------------------------------------------
// Asset events
// ---------------------------------------------------------------------------

export async function addAssetEvent(e: Omit<AssetEvent, 'id' | 'photos' | 'measurements'> & {
  photos?: string[];
  measurements?: Record<string, string | number>;
}): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    `INSERT INTO asset_event (id,assetId,kind,occurredAt,technician,jobId,reportId,summary,detail,photos,measurements)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, e.assetId, e.kind, e.occurredAt, e.technician ?? null, e.jobId ?? null,
    e.reportId ?? null, e.summary, e.detail ?? null,
    JSON.stringify(e.photos ?? []), JSON.stringify(e.measurements ?? {}),
  );
  return id;
}

export async function assetTimeline(assetId: string, limit = 200): Promise<AssetEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<EventRow>(
    'SELECT * FROM asset_event WHERE assetId = ? ORDER BY occurredAt DESC LIMIT ?',
    assetId, limit,
  );
  return rows.map(hydrateEvent);
}

export interface RecurringFailure {
  assetId: string;
  assetName: string;
  assetCode?: string;
  failures: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Assets that have failed repeatedly.
 *
 * This is the difference between recording services and understanding a site:
 * three failures on one detector is a location or environment problem, not
 * three unrelated faults.
 */
export async function recurringFailures(siteId?: string, minFailures = 3): Promise<RecurringFailure[]> {
  const db = await getDb();
  const args: (string | number)[] = [];
  const siteClause = siteId ? 'AND a.siteId = ?' : '';
  if (siteId) args.push(siteId);
  args.push(minFailures);

  return db.getAllAsync<RecurringFailure>(
    `SELECT e.assetId AS assetId, a.name AS assetName, a.code AS assetCode,
            COUNT(*) AS failures, MIN(e.occurredAt) AS firstAt, MAX(e.occurredAt) AS lastAt
     FROM asset_event e JOIN asset a ON e.assetId = a.id
     WHERE e.kind = 'failed' ${siteClause}
     GROUP BY e.assetId HAVING COUNT(*) >= ?
     ORDER BY failures DESC, lastAt DESC`,
    ...args,
  );
}

export interface CoverageGap {
  assetId: string;
  assetName: string;
  assetCode?: string;
  assetTypeId: string;
  level?: string;
  room?: string;
  /** The most recent reason the check could not be carried out. */
  reason: string;
  occurredAt: string;
  /** How many times running this asset has gone untested. */
  attempts: number;
}

/**
 * Assets that could not be tested, and are still in that state.
 *
 * The point of recording "not tested" separately from a pass or a failure is
 * that it is the one result nobody chases: a failure raises a defect and a pass
 * closes the item, while an inaccessible device quietly leaves a hole in the
 * year's coverage. This is that hole, made visible.
 *
 * An asset drops off this list as soon as it is actually tested — the filter is
 * on events after the last pass or failure, not on the untested events alone.
 */
export async function coverageGaps(siteId?: string, limit = 300): Promise<CoverageGap[]> {
  const db = await getDb();
  const args: (string | number)[] = [];
  const siteClause = siteId ? 'AND a.siteId = ?' : '';
  if (siteId) args.push(siteId);
  args.push(limit);

  return db.getAllAsync<CoverageGap>(
    `SELECT e.assetId AS assetId,
            COALESCE(NULLIF(a.name,''), a.assetTypeId) AS assetName,
            a.code AS assetCode, a.assetTypeId AS assetTypeId,
            a.level AS level, a.room AS room,
            e.summary AS reason,
            MAX(e.occurredAt) AS occurredAt,
            COUNT(*) AS attempts
     FROM asset_event e JOIN asset a ON e.assetId = a.id
     WHERE e.kind = 'not-tested' ${siteClause}
       AND e.occurredAt > COALESCE((
         SELECT MAX(d.occurredAt) FROM asset_event d
         WHERE d.assetId = e.assetId AND d.kind IN ('passed','failed')
       ), '')
     GROUP BY e.assetId
     ORDER BY attempts DESC, occurredAt DESC
     LIMIT ?`,
    ...args,
  );
}
