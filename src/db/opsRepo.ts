import { getDb, newId, nowIso } from './index';
import { queueKey } from '@/domain/queueKey';
import { defectByCode, type Severity } from '@/seed/defectLibrary';

/**
 * Operations persistence: jobs, defects, impairments, stock, promises and
 * company knowledge.
 *
 * These are the records that make the app a day's work rather than a form.
 */

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return (JSON.parse(s) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobRecord {
  id: string;
  externalId?: string;
  siteId?: string;
  siteName: string;
  customerName?: string;
  title: string;
  jobType?: string;
  stage?: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  scheduledFor?: string;
  dueAt?: string;
  technician?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  status: 'scheduled' | 'in-progress' | 'complete' | 'blocked';
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listJobs(filter: { status?: JobRecord['status']; onDate?: string; limit?: number } = {}): Promise<JobRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter.onDate) { where.push('substr(scheduledFor,1,10) = ?'); args.push(filter.onDate); }
  args.push(filter.limit ?? 200);
  return db.getAllAsync<JobRecord>(
    `SELECT * FROM job ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              scheduledFor LIMIT ?`,
    ...args,
  );
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const db = await getDb();
  return (await db.getFirstAsync<JobRecord>('SELECT * FROM job WHERE id = ?', id)) ?? null;
}

/**
 * Writes a job from the office, without overwriting what happened on site.
 *
 * The sync re-sends every job before and after each run. The office owns the
 * booking — who, where, what stage — and takes those columns whole. The
 * technician owns what they did with it: a status they set on site outranks
 * the office's, notes already on the job are kept, and a site the job was
 * matched to locally survives an office copy that has none.
 */
export async function upsertJob(input: Partial<JobRecord> & { siteName: string; title: string }): Promise<JobRecord> {
  const db = await getDb();
  const now = nowIso();
  const job: JobRecord = {
    id: input.id ?? newId(),
    priority: input.priority ?? 'normal',
    status: input.status ?? 'scheduled',
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    ...input,
  } as JobRecord;

  await db.runAsync(
    `INSERT INTO job (id,externalId,siteId,siteName,customerName,title,jobType,stage,priority,
       scheduledFor,dueAt,technician,address,latitude,longitude,status,startedAt,completedAt,notes,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       siteId=COALESCE(excluded.siteId, job.siteId),
       siteName=excluded.siteName, customerName=excluded.customerName, title=excluded.title,
       jobType=excluded.jobType, stage=excluded.stage, priority=excluded.priority,
       scheduledFor=excluded.scheduledFor, dueAt=excluded.dueAt, technician=excluded.technician,
       address=excluded.address,
       status=CASE WHEN job.status IN ('in-progress','complete','blocked') THEN job.status ELSE excluded.status END,
       notes=COALESCE(job.notes, excluded.notes),
       updatedAt=excluded.updatedAt`,
    job.id, job.externalId ?? null, job.siteId ?? null, job.siteName, job.customerName ?? null,
    job.title, job.jobType ?? null, job.stage ?? null, job.priority, job.scheduledFor ?? null,
    job.dueAt ?? null, job.technician ?? null, job.address ?? null, job.latitude ?? null,
    job.longitude ?? null, job.status, job.startedAt ?? null, job.completedAt ?? null,
    job.notes ?? null, job.createdAt, job.updatedAt,
  );
  return job;
}

export async function setJobStatus(id: string, status: JobRecord['status']): Promise<void> {
  const db = await getDb();
  const stamp = status === 'in-progress' ? 'startedAt' : status === 'complete' ? 'completedAt' : null;
  if (stamp) {
    await db.runAsync(`UPDATE job SET status = ?, ${stamp} = ?, updatedAt = ? WHERE id = ?`, status, nowIso(), nowIso(), id);
  } else {
    await db.runAsync('UPDATE job SET status = ?, updatedAt = ? WHERE id = ?', status, nowIso(), id);
  }
}

// ---------------------------------------------------------------------------
// Impairments
// ---------------------------------------------------------------------------

export interface ImpairmentRecord {
  id: string;
  siteId: string;
  system: string;
  scope: string;
  reason: string;
  startedAt: string;
  expectedRestoreAt?: string;
  restoredAt?: string;
  technician?: string;
  responsibleNotified: boolean;
  responsibleName?: string;
  brigadeNotified: boolean;
  monitoringNotified: boolean;
  fireWatchInPlace: boolean;
  signagePlaced: boolean;
  alternativeMeasures?: string;
  isolatedAssets: string[];
  notes?: string;
}

interface ImpairmentRow extends Omit<ImpairmentRecord, 'isolatedAssets' | 'responsibleNotified' | 'brigadeNotified' | 'monitoringNotified' | 'fireWatchInPlace' | 'signagePlaced'> {
  isolatedAssets: string;
  responsibleNotified: number;
  brigadeNotified: number;
  monitoringNotified: number;
  fireWatchInPlace: number;
  signagePlaced: number;
}

const hydrateImpairment = (r: ImpairmentRow): ImpairmentRecord => ({
  ...r,
  isolatedAssets: parseJson<string[]>(r.isolatedAssets, []),
  responsibleNotified: r.responsibleNotified === 1,
  brigadeNotified: r.brigadeNotified === 1,
  monitoringNotified: r.monitoringNotified === 1,
  fireWatchInPlace: r.fireWatchInPlace === 1,
  signagePlaced: r.signagePlaced === 1,
});

export async function listImpairments(openOnly = true): Promise<ImpairmentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ImpairmentRow>(
    `SELECT * FROM impairment ${openOnly ? 'WHERE restoredAt IS NULL' : ''} ORDER BY startedAt DESC`,
  );
  return rows.map(hydrateImpairment);
}

export async function getImpairment(id: string): Promise<ImpairmentRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ImpairmentRow>('SELECT * FROM impairment WHERE id = ?', id);
  return row ? hydrateImpairment(row) : null;
}

export async function createImpairment(input: Partial<ImpairmentRecord> & { siteId: string; system: string }): Promise<ImpairmentRecord> {
  const db = await getDb();
  const rec: ImpairmentRecord = {
    id: newId(),
    scope: '',
    reason: '',
    startedAt: nowIso(),
    responsibleNotified: false,
    brigadeNotified: false,
    monitoringNotified: false,
    fireWatchInPlace: false,
    signagePlaced: false,
    isolatedAssets: [],
    ...input,
  };
  await db.runAsync(
    `INSERT INTO impairment (id,siteId,system,scope,reason,startedAt,expectedRestoreAt,restoredAt,
       technician,responsibleNotified,responsibleName,brigadeNotified,monitoringNotified,
       fireWatchInPlace,signagePlaced,alternativeMeasures,isolatedAssets,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.siteId, rec.system, rec.scope, rec.reason, rec.startedAt,
    rec.expectedRestoreAt ?? null, rec.restoredAt ?? null, rec.technician ?? null,
    rec.responsibleNotified ? 1 : 0, rec.responsibleName ?? null, rec.brigadeNotified ? 1 : 0,
    rec.monitoringNotified ? 1 : 0, rec.fireWatchInPlace ? 1 : 0, rec.signagePlaced ? 1 : 0,
    rec.alternativeMeasures ?? null, JSON.stringify(rec.isolatedAssets), rec.notes ?? null,
  );
  return rec;
}

export async function updateImpairment(id: string, patch: Partial<ImpairmentRecord>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const f of ['scope', 'reason', 'expectedRestoreAt', 'restoredAt', 'technician',
    'responsibleName', 'alternativeMeasures', 'notes'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  for (const f of ['responsibleNotified', 'brigadeNotified', 'monitoringNotified',
    'fireWatchInPlace', 'signagePlaced'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push(patch[f] ? 1 : 0); }
  }
  if (patch.isolatedAssets !== undefined) { sets.push('isolatedAssets = ?'); vals.push(JSON.stringify(patch.isolatedAssets)); }
  if (!sets.length) return;
  await db.runAsync(`UPDATE impairment SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

/** How long an impairment has been running, in milliseconds. */
export function impairmentElapsedMs(rec: ImpairmentRecord, now = Date.now()): number {
  const start = Date.parse(rec.startedAt);
  const end = rec.restoredAt ? Date.parse(rec.restoredAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/** What still has to happen before an impairment can be closed out. */
export function impairmentOutstanding(rec: ImpairmentRecord): string[] {
  const out: string[] = [];
  if (!rec.responsibleNotified) out.push('Notify the responsible person');
  if (!rec.monitoringNotified) out.push('Notify the monitoring provider');
  if (!rec.fireWatchInPlace) out.push('Confirm fire watch or alternative measures');
  if (!rec.signagePlaced) out.push('Place signage at the panel');
  return out;
}

// ---------------------------------------------------------------------------
// Stock and purchasing
// ---------------------------------------------------------------------------

export interface StockLocation { id: string; label: string; kind: 'workshop' | 'van' | 'site'; owner?: string }
export interface StockItem {
  id: string;
  locationId: string;
  catalogueItemId?: string;
  partNumber: string;
  description: string;
  quantity: number;
  minimum: number;
  updatedAt: string;
}

export async function listStockLocations(): Promise<StockLocation[]> {
  const db = await getDb();
  return db.getAllAsync<StockLocation>('SELECT * FROM stock_location ORDER BY kind, label');
}

export async function createStockLocation(label: string, kind: StockLocation['kind'], owner?: string): Promise<StockLocation> {
  const db = await getDb();
  const rec: StockLocation = { id: newId(), label, kind, owner };
  await db.runAsync('INSERT INTO stock_location (id,label,kind,owner) VALUES (?,?,?,?)', rec.id, rec.label, rec.kind, rec.owner ?? null);
  return rec;
}

export async function listStock(locationId?: string): Promise<StockItem[]> {
  const db = await getDb();
  return locationId
    ? db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE locationId = ? ORDER BY description', locationId)
    : db.getAllAsync<StockItem>('SELECT * FROM stock_item ORDER BY description');
}

export async function upsertStock(item: Omit<StockItem, 'id' | 'updatedAt'> & { id?: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO stock_item (id,locationId,catalogueItemId,partNumber,description,quantity,minimum,updatedAt)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity, minimum=excluded.minimum, updatedAt=excluded.updatedAt`,
    item.id ?? newId(), item.locationId, item.catalogueItemId ?? null, item.partNumber,
    item.description, item.quantity, item.minimum, nowIso(),
  );
}

/** Items at or below their minimum — what a van needs before tomorrow. */
export async function restockNeeded(locationId?: string): Promise<StockItem[]> {
  const db = await getDb();
  return locationId
    ? db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE locationId = ? AND quantity <= minimum ORDER BY description', locationId)
    : db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE quantity <= minimum ORDER BY description');
}

export interface PurchaseLine { partNumber: string; description: string; quantity: number; note?: string }
export interface PurchaseRequest {
  id: string;
  createdAt: string;
  requestedBy?: string;
  supplier?: string;
  jobId?: string;
  siteId?: string;
  lines: PurchaseLine[];
  status: 'draft' | 'submitted' | 'ordered' | 'received' | 'cancelled';
  externalId?: string;
  notes?: string;
}

export async function listPurchaseRequests(): Promise<PurchaseRequest[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<PurchaseRequest, 'lines'> & { lines: string }>(
    'SELECT * FROM purchase_request ORDER BY createdAt DESC',
  );
  return rows.map((r) => ({ ...r, lines: parseJson<PurchaseLine[]>(r.lines, []) }));
}

export async function createPurchaseRequest(input: Partial<PurchaseRequest> & { lines: PurchaseLine[] }): Promise<PurchaseRequest> {
  const db = await getDb();
  const rec: PurchaseRequest = {
    id: newId(),
    createdAt: nowIso(),
    status: 'draft',
    ...input,
  };
  await db.runAsync(
    `INSERT INTO purchase_request (id,createdAt,requestedBy,supplier,jobId,siteId,lines,status,externalId,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.createdAt, rec.requestedBy ?? null, rec.supplier ?? null, rec.jobId ?? null,
    rec.siteId ?? null, JSON.stringify(rec.lines), rec.status, rec.externalId ?? null, rec.notes ?? null,
  );
  return rec;
}

export async function setPurchaseStatus(id: string, status: PurchaseRequest['status'], externalId?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE purchase_request SET status = ?, externalId = COALESCE(?, externalId) WHERE id = ?', status, externalId ?? null, id);
}

// ---------------------------------------------------------------------------
// Promises
// ---------------------------------------------------------------------------

export interface Promise_ {
  id: string;
  what: string;
  siteId?: string;
  assetId?: string;
  jobId?: string;
  owner?: string;
  dueAt?: string;
  createdAt: string;
  completedAt?: string;
}

export async function listPromises(openOnly = true): Promise<Promise_[]> {
  const db = await getDb();
  return db.getAllAsync<Promise_>(
    `SELECT * FROM promise ${openOnly ? 'WHERE completedAt IS NULL' : ''} ORDER BY COALESCE(dueAt, createdAt)`,
  );
}

export async function createPromise(input: Partial<Promise_> & { what: string }): Promise<Promise_> {
  const db = await getDb();
  const rec: Promise_ = { id: newId(), createdAt: nowIso(), ...input };
  await db.runAsync(
    'INSERT INTO promise (id,what,siteId,assetId,jobId,owner,dueAt,createdAt,completedAt) VALUES (?,?,?,?,?,?,?,?,?)',
    rec.id, rec.what, rec.siteId ?? null, rec.assetId ?? null, rec.jobId ?? null,
    rec.owner ?? null, rec.dueAt ?? null, rec.createdAt, rec.completedAt ?? null,
  );
  return rec;
}

export async function completePromise(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE promise SET completedAt = ? WHERE id = ?', nowIso(), id);
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  system?: string;
  manufacturer?: string;
  model?: string;
  siteId?: string;
  author?: string;
  status: 'unverified' | 'verified' | 'manufacturer-confirmed' | 'superseded';
  sourceKind: string;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listKnowledge(filter: { siteId?: string; search?: string } = {}): Promise<KnowledgeNote[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: string[] = [];
  if (filter.siteId) { where.push('siteId = ?'); args.push(filter.siteId); }
  if (filter.search?.trim()) {
    const term = `%${filter.search.trim()}%`;
    where.push('(title LIKE ? OR body LIKE ? OR manufacturer LIKE ? OR model LIKE ?)');
    args.push(term, term, term, term);
  }
  return db.getAllAsync<KnowledgeNote>(
    `SELECT * FROM knowledge_note ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE status WHEN 'manufacturer-confirmed' THEN 0 WHEN 'verified' THEN 1 WHEN 'unverified' THEN 2 ELSE 3 END,
              updatedAt DESC`,
    ...args,
  );
}

export async function createKnowledge(input: Partial<KnowledgeNote> & { title: string }): Promise<KnowledgeNote> {
  const db = await getDb();
  const now = nowIso();
  const rec: KnowledgeNote = {
    id: newId(), body: '', status: 'unverified', sourceKind: 'technician',
    createdAt: now, updatedAt: now, ...input,
  };
  await db.runAsync(
    `INSERT INTO knowledge_note (id,title,body,system,manufacturer,model,siteId,author,status,sourceKind,sourceRef,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.title, rec.body, rec.system ?? null, rec.manufacturer ?? null, rec.model ?? null,
    rec.siteId ?? null, rec.author ?? null, rec.status, rec.sourceKind, rec.sourceRef ?? null,
    rec.createdAt, rec.updatedAt,
  );
  return rec;
}

export async function setKnowledgeStatus(id: string, status: KnowledgeNote['status']): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE knowledge_note SET status = ?, updatedAt = ? WHERE id = ?', status, nowIso(), id);
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------

export interface SyncEntry {
  id: string;
  createdAt: string;
  kind: string;
  payload: string;
  attempts: number;
  lastError?: string;
  /**
   * `unknown` is a send the phone cannot vouch for either way: the request
   * went out and the reply never came. It is not retried on its own, because
   * a vendor order that did arrive would be raised twice; a person looks at
   * Simpro and either retries it or lets it go.
   */
  status: 'pending' | 'sent' | 'failed' | 'unknown';
  /** What the item is, derived from its content. See domain/queueKey. */
  contentKey?: string | null;
}

/**
 * Queues an item once.
 *
 * The same kind and content already pending, sent or in doubt is not queued
 * again: a double tap on "send", or a screen that re-queues its note on every
 * focus, used to become two notes on the job. Returns whether it was new.
 */
export async function enqueueSync(kind: string, payload: unknown): Promise<{ id: string; duplicate: boolean }> {
  const db = await getDb();
  const key = queueKey(kind, payload);
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sync_queue WHERE contentKey = ? AND status IN ('pending', 'sent', 'unknown') LIMIT 1",
    key,
  );
  if (existing) return { id: existing.id, duplicate: true };
  const id = newId();
  await db.runAsync(
    'INSERT INTO sync_queue (id,createdAt,kind,payload,attempts,status,contentKey) VALUES (?,?,?,?,0,?,?)',
    id, nowIso(), kind, JSON.stringify(payload), 'pending', key,
  );
  return { id, duplicate: false };
}

export async function pendingSync(limit = 100): Promise<SyncEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SyncEntry>("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY createdAt LIMIT ?", limit);
}

/** Sends nobody can vouch for, oldest first, for a person to look at. */
export async function unknownSync(): Promise<SyncEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SyncEntry>("SELECT * FROM sync_queue WHERE status = 'unknown' ORDER BY createdAt");
}

/** A send that went out and got no reply. Kept out of the retry loop; see SyncEntry.status. */
export async function markSyncUnknown(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'unknown', attempts = attempts + 1, lastError = ? WHERE id = ?", error, id);
}

/** A person has looked and wants it sent again, or a failed item given another go. */
export async function retrySync(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'pending', attempts = 0, lastError = NULL WHERE id = ?", id);
}

/** A person has looked, found it in Simpro, and is done with it. */
export async function dismissSync(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'sent' WHERE id = ?", id);
}

export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'sent' WHERE id = ?", id);
}

export async function markSyncFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  // Five attempts is enough to ride out a flat spot without hammering a real failure.
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, lastError = ?,
       status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END WHERE id = ?`,
    error, id,
  );
}

export async function pendingSyncCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'");
  return row?.n ?? 0;
}

/** Severity of a defect code, for sorting a mixed list. */
export function severityOf(code: string): Severity {
  return defectByCode(code)?.severity ?? 'medium';
}
