import { getDb, inTransaction, newId, nowIso } from './index';
import { ASSET_TYPES, type SystemKind } from '@/seed/assetTypes';
import { DEFECT_LIBRARY } from '@/seed/defectLibrary';
import { normalise } from '@/domain/assetTag';
import { SEPARATORS, identifierKeys, type AssetMatch, type IdentifierKeys } from '@/domain/assetLookup';

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
  /** The id the source system gave it, which is what makes a re-import an update. */
  externalId?: string;
  /** Which system that id belongs to, so two sources cannot collide. */
  externalSource?: string;
  /** Position in the walk around the site. */
  walkOrder?: number;
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
  await inTransaction(db, async () => {
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
    const clause = searchClause(q.search);
    where.push(clause.sql);
    args.push(...clause.args);
  }

  args.push(q.limit ?? 2000);
  // An outer join, so an asset whose type the app does not know is still in
  // the register. With an inner join such an asset was on no screen and no
  // form: the test sheet said every asset was already on it, Form 72 said
  // "none in the register", and the occupier prefill proposed the
  // installation as not present, with nothing anywhere saying equipment had
  // been dropped. Unknown types sort last.
  const rows = await db.getAllAsync<AssetRow>(
    `SELECT a.* FROM asset a LEFT JOIN asset_type t ON a.assetTypeId = t.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(t.sortIndex, 100000), a.level, a.room, a.name LIMIT ?`,
    ...args,
  );
  return rows.map(hydrate);
}

/*
 * The office's own asset number, as the sync and the register importer file
 * it: `tag` from every Simpro sync, `assetNumber` from the importer and the
 * current sync. Guarded by json_valid so one malformed row cannot fail the
 * whole search.
 */
const officeAttr = (...keys: ('tag' | 'assetNumber')[]) =>
  `(CASE WHEN json_valid(a.attributes) THEN json_extract(a.attributes, ${keys.map((k) => `'$.${k}'`).join(', ')}) END)`;
const OFFICE_TAG = officeAttr('tag');
const OFFICE_NUMBER = officeAttr('assetNumber');
/** Both keys in one read, as a JSON array's text: enough for a "contains" search. */
const OFFICE_EITHER = officeAttr('tag', 'assetNumber');

/**
 * A column with the separators in SEPARATORS removed, to compare with a
 * compact key. Compared case-blind by the caller (LIKE, or COLLATE NOCASE),
 * which is cheaper than upper-casing every row first.
 */
function stripped(column: string): string {
  return SEPARATORS.reduce((sql, ch) => `REPLACE(${sql}, '${ch}', '')`, column);
}

/** Any character that is neither a letter, a digit nor one of SEPARATORS. */
const UNSTRIPPED = new RegExp(`[^0-9A-Za-z${SEPARATORS.map((c) => `\\${c}`).join('')}]`);

/**
 * The search box's WHERE clause: name, location, model and serial as typed;
 * our code and the office's asset number with their separators stripped, so
 * a tag typed without hyphens still finds the asset.
 */
function searchClause(search: string): { sql: string; args: string[] } {
  const typed = search.trim();
  const term = `%${typed}%`;
  const parts = ['a.name LIKE ?', 'a.serial LIKE ?', 'a.model LIKE ?', 'a.room LIKE ?', 'a.level LIKE ?', 'a.locationNote LIKE ?'];
  const args = parts.map(() => term);
  const compact = normalise(typed);
  // Stripping both sides keeps every match the typed form would make, unless
  // what was typed has a separator the SQL does not strip.
  const keepsTyped = !compact || UNSTRIPPED.test(typed);
  for (const column of ['a.code', OFFICE_EITHER]) {
    if (compact) {
      parts.push(`${stripped(column)} LIKE ?`);
      args.push(`%${compact}%`);
    }
    if (keepsTyped) {
      parts.push(`${column} LIKE ?`);
      args.push(term);
    }
  }
  return { sql: `(${parts.join(' OR ')})`, args };
}

/** An asset with the site it is on, for a list that spans every site. */
export interface AssetHit extends AssetRecord {
  siteName?: string;
}

/** An asset that answered an identifier, and how. */
export interface AssetIdentifierHit extends AssetHit {
  match: AssetMatch;
}

/**
 * How well a row answers an identifier: 0 our code, 1 the office's asset
 * number, 2 the serial, 3 not at all. Each is compared whole with every form
 * in `keys.exact`; the code and the office number again with separators
 * stripped, against `keys.compact`. A serial is compared whole only: it is
 * the maker's, and its separators are part of it.
 */
function identifierRank(keys: IdentifierKeys): { sql: string; args: string[] } {
  const exact = keys.exact.filter(Boolean);
  const args: string[] = [];
  const matches = (column: string, compact = true): string => {
    const tests: string[] = [];
    if (exact.length) {
      tests.push(`TRIM(${column}) COLLATE NOCASE IN (${exact.map(() => '?').join(',')})`);
      args.push(...exact);
    }
    if (compact && keys.compact) {
      tests.push(`${stripped(column)} = ? COLLATE NOCASE`);
      args.push(keys.compact);
    }
    return tests.length ? `(${tests.join(' OR ')})` : '0';
  };
  // Built in the order the placeholders appear in the statement.
  const byCode = matches('a.code');
  const byNumber = `(${matches(OFFICE_TAG)} OR ${matches(OFFICE_NUMBER)})`;
  const bySerial = matches('a.serial', false);
  return { sql: `(CASE WHEN ${byCode} THEN 0 WHEN ${byNumber} THEN 1 WHEN ${bySerial} THEN 2 ELSE 3 END)`, args };
}

/**
 * Assets matching what was typed in the find box, across every site.
 *
 * The same search as the site register's, with the site's name on each row,
 * because an office asset number or a room name repeats across sites. An
 * asset whose tag, office number or serial is exactly what was typed comes
 * first; the rank is only worked out for rows the search already matched.
 */
export async function searchAssets(search: string, limit = 40): Promise<AssetHit[]> {
  if (!search.trim()) return [];
  const db = await getDb();
  const clause = searchClause(search);
  const rank = identifierRank(identifierKeys(search));
  const rows = await db.getAllAsync<AssetRow & { siteName: string | null }>(
    `SELECT a.*, s.name AS siteName FROM asset a
     LEFT JOIN asset_type t ON a.assetTypeId = t.id
     LEFT JOIN site s ON s.id = a.siteId
     WHERE ${clause.sql}
     ORDER BY ${rank.sql}, COALESCE(t.sortIndex, 100000), s.name, a.level, a.room, a.name LIMIT ?`,
    ...clause.args, ...rank.args, limit,
  );
  return rows.map(hydrateHit);
}

/**
 * Assets whose code, office asset number or serial is the identifier, whole.
 *
 * For a scan, where only an exact answer will do. Ordered best match first:
 * our own code, then the office's number, then the serial.
 */
export async function findAssetsByIdentifier(keys: IdentifierKeys, limit = 40): Promise<AssetIdentifierHit[]> {
  if (!keys.exact.some(Boolean) && !keys.compact) return [];
  const db = await getDb();
  const rank = identifierRank(keys);
  const rows = await db.getAllAsync<AssetRow & { siteName: string | null; matchRank: number }>(
    `SELECT * FROM (
       SELECT a.*, s.name AS siteName, ${rank.sql} AS matchRank
       FROM asset a LEFT JOIN site s ON s.id = a.siteId
     ) WHERE matchRank < 3
     ORDER BY matchRank, siteName, name LIMIT ?`,
    ...rank.args, limit,
  );
  const MATCH: AssetMatch[] = ['code', 'office-number', 'serial'];
  return rows.map(({ matchRank, ...row }) => ({ ...hydrateHit(row), match: MATCH[matchRank] ?? 'serial' }));
}

/** Assets whose serial contains the value, for a maker's barcode with more on it than the serial. */
export async function findBySerialContaining(value: string, limit = 5): Promise<AssetIdentifierHit[]> {
  const typed = value.trim();
  if (typed.length < 4) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<AssetRow & { siteName: string | null }>(
    `SELECT a.*, s.name AS siteName FROM asset a LEFT JOIN site s ON s.id = a.siteId
     WHERE LENGTH(a.serial) >= 4 AND (a.serial LIKE ? OR ? LIKE '%' || a.serial || '%')
     LIMIT ?`,
    `%${typed}%`, typed, limit,
  );
  return rows.map((r) => ({ ...hydrateHit(r), match: 'serial' as const }));
}

function hydrateHit(row: AssetRow & { siteName: string | null }): AssetHit {
  const { siteName, ...rest } = row;
  return { ...hydrate(rest), siteName: siteName ?? undefined };
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
/**
 * Finds assets already imported from a source system.
 *
 * Keyed on source and id together: two systems can both number an asset 14211,
 * and matching on the number alone would fold two buildings into one.
 */
export async function findByExternalIds(
  source: string,
  ids: string[],
): Promise<Map<string, AssetRecord>> {
  const found = new Map<string, AssetRecord>();
  if (!ids.length) return found;
  const db = await getDb();
  // Chunked: SQLite's default parameter limit is 999, and a register runs to
  // thousands.
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await db.getAllAsync<AssetRow>(
      `SELECT * FROM asset WHERE externalSource = ? AND externalId IN (${slice.map(() => '?').join(',')})`,
      source, ...slice,
    );
    for (const row of rows) {
      const asset = hydrate(row);
      if (asset.externalId) found.set(asset.externalId, asset);
    }
  }
  return found;
}

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
 *
 * The prefix is a range rather than a LIKE. LIKE cannot use the index on
 * code, so every asset created walked every code on the phone — thirteen
 * thousand rows on the real register, once per asset. `>= 'SQ-DET-'` and
 * `< 'SQ-DET-~'` bound the same codes and seek straight to the last one:
 * a tilde sorts after every character a code can contain.
 */
export async function nextAssetCode(assetTypeId: string): Promise<string> {
  const db = await getDb();
  const type = ASSET_TYPES.find((t) => t.id === assetTypeId);
  const prefix = `SQ-${type?.codePrefix ?? 'AST'}-`;
  const row = await db.getFirstAsync<{ code: string }>(
    'SELECT code FROM asset WHERE code >= ? AND code < ? ORDER BY code DESC LIMIT 1',
    prefix, `${prefix}~`,
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
    externalId: input.externalId,
    externalSource: input.externalSource,
    walkOrder: input.walkOrder,
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
       lastServicedAt,lastResult,nextDueAt,openDefects,notes,createdAt,updatedAt,
       externalId,externalSource,walkOrder)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    asset.id, asset.siteId, asset.assetTypeId, asset.parentAssetId ?? null, asset.code ?? null,
    asset.name, asset.level ?? null, asset.room ?? null, asset.locationNote ?? null,
    asset.manufacturer ?? null, asset.model ?? null, asset.partNumber ?? null, asset.serial ?? null,
    asset.catalogueItemId ?? null, asset.installedDate ?? null, asset.status,
    JSON.stringify(asset.attributes), asset.lastServicedAt ?? null, asset.lastResult ?? null,
    asset.nextDueAt ?? null, 0, asset.notes ?? null, asset.createdAt, asset.updatedAt,
    asset.externalId ?? null, asset.externalSource ?? null, asset.walkOrder ?? null,
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

  // siteId is on the list because the register moves assets between sites,
  // and a re-import that could not follow the move left the asset on the old
  // building for as long as it was on the books.
  const textFields = ['siteId', 'name', 'level', 'room', 'locationNote', 'manufacturer', 'model', 'partNumber',
    'serial', 'catalogueItemId', 'installedDate', 'status', 'lastServicedAt', 'lastResult',
    'nextDueAt', 'notes', 'code', 'parentAssetId', 'externalId', 'externalSource'] as const;

  for (const f of textFields) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  if (patch.attributes !== undefined) { sets.push('attributes = ?'); vals.push(JSON.stringify(patch.attributes)); }
  if (patch.openDefects !== undefined) { sets.push('openDefects = ?'); vals.push(patch.openDefects); }
  if (patch.walkOrder !== undefined) { sets.push('walkOrder = ?'); vals.push(patch.walkOrder ?? null); }
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
    `SELECT COALESCE(t.system, 'unknown') AS system, COUNT(*) AS count
     FROM asset a LEFT JOIN asset_type t ON a.assetTypeId = t.id
     WHERE a.siteId = ? GROUP BY COALESCE(t.system, 'unknown') ORDER BY count DESC`,
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

/**
 * The summary every test-sheet event starts with, which is what marks it as
 * the sheet's rather than a routine run's or a defect's.
 */
export const TEST_SHEET_EVENT = 'Test sheet —';

/**
 * Removes the test-sheet events one report wrote on an asset, so a result
 * re-marked on the sheet replaces its earlier event instead of joining it.
 * Scoped to the report and to the sheet's own summary: a routine run's or a
 * defect's event on the same asset is not the sheet's to remove.
 */
export async function clearTestSheetEvents(assetId: string, reportId: string | undefined): Promise<void> {
  if (!reportId) return;
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM asset_event WHERE assetId = ? AND reportId = ? AND summary LIKE ?',
    assetId, reportId, `${TEST_SHEET_EVENT}%`,
  );
}

/**
 * Puts the failure comment on the sheet's event for this asset and report.
 *
 * The comment is typed after the result is tapped — the field only appears
 * once a row is marked fail — so the event written at the tap has no detail.
 * Rather than write a second event, the one already there is given the text.
 */
export async function setTestSheetEventDetail(assetId: string, reportId: string | undefined, detail: string | undefined): Promise<void> {
  if (!reportId) return;
  const db = await getDb();
  await db.runAsync(
    'UPDATE asset_event SET detail = ? WHERE assetId = ? AND reportId = ? AND summary LIKE ?',
    detail?.trim() || null, assetId, reportId, `${TEST_SHEET_EVENT}%`,
  );
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

  // `reason` is a bare column beside MAX(occurredAt), which SQLite defines as
  // taking its value from the same row the maximum came from — so the reason
  // shown is the most recent one, not an arbitrary one. That guarantee holds
  // while there is exactly one min()/max() in the query; COUNT(*) alongside is
  // fine. Adding a second MAX would silently break it.
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
