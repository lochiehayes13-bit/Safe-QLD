import { getDb, nowIso } from './index';
import type { JobRecord } from './opsRepo';
import type {
  SimproAddress, SimproAttachment, SimproContact, SimproContract, SimproCostCenter, SimproCustomer,
  SimproInvoice, SimproInvoiceJob, SimproItem, SimproItemKind, SimproJob, SimproJobDetail, SimproNote,
  SimproPerson, SimproQuote, SimproQuoteDetail, SimproSection, SimproTask, SimproTimelineEntry,
} from '@/simpro/mirrorResources';

/**
 * The Simpro mirror on the phone: reading and writing what v18 holds.
 *
 * Two kinds of function live here. The writes are what the sync calls —
 * an upsert per list-level record, and a "replace the children" per job
 * or quote somebody opened — and they are shaped so a half-finished pull
 * cannot leave a job with last week's sections and this week's notes: the
 * children of one document are replaced in one transaction or not at all.
 * The reads are what the screens call, and they hand back the same shapes
 * the resources module produces, assembled from the tables, so a screen
 * does not care whether a section came from the network a second ago or
 * from the phone a week ago.
 *
 * Nothing here decides what to fetch; that is the sync's. Nothing here
 * holds cost, markup or margin; the columns do not exist.
 */

const OPEN_STAGES = "('Pending','Progress')";

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return (JSON.parse(s) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const bool = (v: number | null | undefined): boolean => v === 1;
const optBool = (v: number | null | undefined): boolean | undefined =>
  v === 1 ? true : v === 0 ? false : undefined;

/** The local id the sync gives a job from the office, so a re-pull updates rather than duplicates. */
export function localJobId(externalId: string): string {
  return `simpro-${externalId}`;
}

// ---------------------------------------------------------------------------
// Jobs: the row, and what the row carries as JSON
// ---------------------------------------------------------------------------

/**
 * Simpro's stages that mean the work is over: done, billed, or filed away.
 *
 * Every job on the books is held now, not the five hundred newest, and the
 * screens count `status !== 'complete'` as open. Mapping only Complete would
 * put three thousand invoiced and archived jobs from years past on the open
 * list. An archived job may have been cancelled rather than done, but of the
 * four statuses the phone has, complete is the one that means "not yours to
 * do", which is what every screen asks.
 */
const CLOSED_STAGES = new Set(['complete', 'invoiced', 'archived']);

/**
 * A job row ready for upsertJob, from a list-level or detail-level read.
 *
 * Pure. The site is resolved by the caller because only the sync holds the
 * office-id-to-local-id map. A job the office has closed is complete here
 * unless the technician has set something themselves, which upsertJob
 * protects.
 */
export function jobRowFromSimpro(
  job: SimproJob | SimproJobDetail,
  siteId: string | undefined,
): Partial<JobRecord> & { siteName: string; title: string } {
  const detail = job as Partial<SimproJobDetail>;
  const technicianNames = job.technicians.map((t) => t.name).filter(Boolean);
  if (detail.technician?.name && !technicianNames.includes(detail.technician.name)) {
    technicianNames.unshift(detail.technician.name);
  }
  return {
    id: localJobId(job.id),
    externalId: job.id,
    siteId,
    siteExternalId: job.siteId,
    siteName: job.siteName ?? 'Unknown site',
    customerName: job.customerName,
    customerExternalId: job.customerId,
    title: job.title,
    jobType: job.type,
    jobTypeRaw: job.type,
    stage: job.stage,
    stageRaw: job.stage,
    dueAt: job.dueAt,
    scheduledFor: job.issuedAt,
    technician: technicianNames.length ? technicianNames.join(', ') : undefined,
    status: CLOSED_STAGES.has(job.stage?.toLowerCase() ?? '') ? 'complete' : 'scheduled',
    orderNo: job.orderNo,
    requestNo: job.requestNo,
    statusName: job.status,
    statusColor: job.statusColor,
    siteContactJson: job.siteContact ? JSON.stringify(job.siteContact) : undefined,
    techniciansJson: JSON.stringify(job.technicians),
    tagsJson: JSON.stringify(job.tags),
    projectManager: job.projectManager,
    descriptionText: job.description,
    notesText: detail.notes,
    completedDate: job.completedDate,
    totalExTaxCents: job.totalExTaxCents,
    totalIncTaxCents: job.totalIncTaxCents,
    convertedFromQuoteId: job.convertedFromQuoteId,
    customerContractJson: detail.customerContract ? JSON.stringify(detail.customerContract) : undefined,
    dateModified: job.DateModified,
  };
}

/** The JSON columns on a job row, read back into their shapes. */
export function readJobJson(job: Pick<JobRecord, 'siteContactJson' | 'techniciansJson' | 'tagsJson' | 'customerContractJson'>): {
  siteContact?: SimproContact;
  technicians: SimproPerson[];
  tags: string[];
  customerContract?: SimproContract;
} {
  return {
    siteContact: parseJson<SimproContact | undefined>(job.siteContactJson, undefined),
    technicians: parseJson<SimproPerson[]>(job.techniciansJson, []),
    tags: parseJson<string[]>(job.tagsJson, []),
    customerContract: parseJson<SimproContract | undefined>(job.customerContractJson, undefined),
  };
}

/**
 * Whether a job's children are old enough to read again.
 *
 * Fifteen minutes is the default the sync uses: long enough that opening a
 * job twice in a visit costs one read, short enough that a note the office
 * added mid-morning is on the phone by the time somebody looks. A job never
 * read is always stale; an unreadable stamp is treated as never.
 */
export function jobDetailIsStale(
  job: Pick<JobRecord, 'detailSyncedAt'>,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (!job.detailSyncedAt) return true;
  const at = Date.parse(job.detailSyncedAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= maxAgeMs;
}

export async function listJobsFor(filter: {
  siteId?: string;
  customerExternalId?: string;
  /** Simpro stages, e.g. ['Pending', 'Progress']. */
  stages?: string[];
  limit?: number;
} = {}): Promise<JobRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.siteId) { where.push('siteId = ?'); args.push(filter.siteId); }
  if (filter.customerExternalId) { where.push('customerExternalId = ?'); args.push(filter.customerExternalId); }
  if (filter.stages?.length) {
    where.push(`COALESCE(stageRaw, stage) IN (${filter.stages.map(() => '?').join(',')})`);
    args.push(...filter.stages);
  }
  args.push(filter.limit ?? 200);
  return db.getAllAsync<JobRecord>(
    `SELECT * FROM job ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(dateModified, scheduledFor, createdAt) DESC LIMIT ?`,
    ...args,
  );
}

/** The office job numbers already held, so a pull can say added from updated. */
export async function heldJobExternalIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ externalId: string }>('SELECT externalId FROM job WHERE externalId IS NOT NULL');
  return new Set(rows.map((r) => r.externalId));
}

// ---------------------------------------------------------------------------
// Job children
// ---------------------------------------------------------------------------

export interface JobChildren {
  sections: SimproSection[];
  notes: SimproNote[];
  attachments: SimproAttachment[];
  timeline: SimproTimelineEntry[];
  tasks: SimproTask[];
}

/**
 * The SQL for one document's children, written out for each parent rather
 * than built from a table name, so the schema test can prepare every SELECT
 * and check every INSERT's columns against the migrations. A string with a
 * table name spliced in is invisible to it.
 */
interface ChildSql {
  column: 'jobId' | 'quoteId';
  tables: readonly string[];
  localUris: string;
  sections: string;
  costCenters: string;
  items: string;
  notes: string;
  attachments: string;
  insertSection: string;
  insertCostCenter: string;
  insertItem: string;
  insertNote: string;
  insertAttachment: string;
}

const JOB_CHILDREN: ChildSql = {
  column: 'jobId',
  tables: ['job_section', 'job_cost_center', 'job_item', 'job_note', 'job_attachment'],
  localUris: 'SELECT externalId, localUri FROM job_attachment WHERE jobId = ? AND localUri IS NOT NULL',
  sections: 'SELECT * FROM job_section WHERE jobId = ? ORDER BY displayOrder, externalId',
  costCenters: 'SELECT * FROM job_cost_center WHERE jobId = ? ORDER BY displayOrder, externalId',
  items: 'SELECT * FROM job_item WHERE jobId = ? ORDER BY costCenterExternalId, sortIndex',
  notes: 'SELECT * FROM job_note WHERE jobId = ? ORDER BY createdAt DESC, externalId DESC',
  attachments: 'SELECT * FROM job_attachment WHERE jobId = ? ORDER BY dateAdded DESC, filename',
  insertSection:
    'INSERT OR REPLACE INTO job_section (jobId, externalId, name, description, displayOrder) VALUES (?,?,?,?,?)',
  insertCostCenter:
    `INSERT OR REPLACE INTO job_cost_center (jobId, sectionExternalId, externalId, setupCostCenterId, setupCostCenterName,
       name, displayOrder, totalExTaxCents, totalIncTaxCents, percentComplete) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  insertItem:
    `INSERT OR REPLACE INTO job_item (jobId, costCenterExternalId, kind, externalId, description, partNo, catalogId, qty,
       unitSellExTaxCents, unitSellIncTaxCents, sellExTaxCents, sellIncTaxCents, billableStatus, discountPercent, sortIndex)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  insertNote:
    `INSERT OR REPLACE INTO job_note (jobId, externalId, subject, note, createdAt, createdBy, visibleToCustomer, referenceType, referenceNumber)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  insertAttachment:
    `INSERT OR REPLACE INTO job_attachment (jobId, externalId, filename, folder, mimeType, sizeBytes, dateAdded, addedBy, public, localUri)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
};

const QUOTE_CHILDREN: ChildSql = {
  column: 'quoteId',
  tables: ['simpro_quote_section', 'simpro_quote_cost_center', 'simpro_quote_item', 'simpro_quote_note', 'simpro_quote_attachment'],
  localUris: 'SELECT externalId, localUri FROM simpro_quote_attachment WHERE quoteId = ? AND localUri IS NOT NULL',
  sections: 'SELECT * FROM simpro_quote_section WHERE quoteId = ? ORDER BY displayOrder, externalId',
  costCenters: 'SELECT * FROM simpro_quote_cost_center WHERE quoteId = ? ORDER BY displayOrder, externalId',
  items: 'SELECT * FROM simpro_quote_item WHERE quoteId = ? ORDER BY costCenterExternalId, sortIndex',
  notes: 'SELECT * FROM simpro_quote_note WHERE quoteId = ? ORDER BY createdAt DESC, externalId DESC',
  attachments: 'SELECT * FROM simpro_quote_attachment WHERE quoteId = ? ORDER BY dateAdded DESC, filename',
  insertSection:
    'INSERT OR REPLACE INTO simpro_quote_section (quoteId, externalId, name, description, displayOrder) VALUES (?,?,?,?,?)',
  insertCostCenter:
    `INSERT OR REPLACE INTO simpro_quote_cost_center (quoteId, sectionExternalId, externalId, setupCostCenterId, setupCostCenterName,
       name, displayOrder, totalExTaxCents, totalIncTaxCents, percentComplete) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  insertItem:
    `INSERT OR REPLACE INTO simpro_quote_item (quoteId, costCenterExternalId, kind, externalId, description, partNo, catalogId, qty,
       unitSellExTaxCents, unitSellIncTaxCents, sellExTaxCents, sellIncTaxCents, billableStatus, discountPercent, sortIndex)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  insertNote:
    `INSERT OR REPLACE INTO simpro_quote_note (quoteId, externalId, subject, note, createdAt, createdBy, visibleToCustomer, referenceType, referenceNumber)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  insertAttachment:
    `INSERT OR REPLACE INTO simpro_quote_attachment (quoteId, externalId, filename, folder, mimeType, sizeBytes, dateAdded, addedBy, public, localUri)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
};

/**
 * The sections, cost centres, lines, notes and attachments of one document,
 * replaced whole. Shared by jobs and quotes because the shapes are the same
 * and the rule is the same: what the office holds now is what the phone
 * holds, and a section deleted in the office is deleted here.
 *
 * A local copy of an attachment survives the replace — that is the phone's,
 * not the office's, and re-reading a list must not throw away a file a
 * technician already opened.
 *
 * A family left undefined is left alone. The sync reads each family in its
 * own request, and a key that cannot read notes must not cost the sections
 * that were read a moment before — nor wipe the notes read last week.
 */
async function replaceDocumentChildren(
  p: ChildSql,
  parentId: string,
  children: { sections?: SimproSection[]; notes?: SimproNote[]; attachments?: SimproAttachment[] },
): Promise<void> {
  const db = await getDb();
  const [sectionTable, costCenterTable, itemTable, noteTable, attachmentTable] = p.tables as [string, string, string, string, string];

  if (children.sections) {
    for (const table of [sectionTable, costCenterTable, itemTable]) {
      await db.runAsync(`DELETE FROM ${table} WHERE ${p.column} = ?`, parentId);
    }
    for (const s of children.sections) {
      await db.runAsync(p.insertSection, parentId, s.id, s.name, orNull(s.description), s.displayOrder);
      for (const c of s.costCenters) {
        await db.runAsync(
          p.insertCostCenter,
          parentId, s.id, c.id, orNull(c.setupCostCenterId), orNull(c.setupCostCenterName), c.name, c.displayOrder,
          orNull(c.totalExTaxCents), orNull(c.totalIncTaxCents), orNull(c.percentComplete),
        );
        for (const [i, it] of c.items.entries()) {
          await db.runAsync(
            p.insertItem,
            parentId, c.id, it.kind, it.id, it.description, orNull(it.partNo), orNull(it.catalogId), it.qty,
            orNull(it.unitSellExTaxCents), orNull(it.unitSellIncTaxCents), orNull(it.sellExTaxCents), orNull(it.sellIncTaxCents),
            orNull(it.billableStatus), orNull(it.discountPercent), i,
          );
        }
      }
    }
  }

  if (children.notes) {
    await db.runAsync(`DELETE FROM ${noteTable} WHERE ${p.column} = ?`, parentId);
    for (const n of children.notes) {
      await db.runAsync(
        p.insertNote,
        parentId, n.id, orNull(n.subject), orNull(n.note), orNull(n.createdAt), orNull(n.createdBy),
        n.visibleToCustomer === undefined ? null : n.visibleToCustomer ? 1 : 0,
        orNull(n.referenceType), orNull(n.referenceNumber),
      );
    }
  }

  if (children.attachments) {
    const kept = await db.getAllAsync<{ externalId: string; localUri: string }>(p.localUris, parentId);
    const localUris = new Map(kept.map((k) => [k.externalId, k.localUri]));
    await db.runAsync(`DELETE FROM ${attachmentTable} WHERE ${p.column} = ?`, parentId);
    for (const a of children.attachments) {
      await db.runAsync(
        p.insertAttachment,
        parentId, a.id, a.filename, orNull(a.folder), orNull(a.mimeType), orNull(a.sizeBytes), orNull(a.dateAdded),
        orNull(a.addedBy), a.public === undefined ? null : a.public ? 1 : 0, localUris.get(a.id) ?? null,
      );
    }
  }
}

interface SectionRow { externalId: string; name: string; description: string | null; displayOrder: number }
interface CostCenterRow {
  sectionExternalId: string; externalId: string; setupCostCenterId: string | null; setupCostCenterName: string | null;
  name: string; displayOrder: number; totalExTaxCents: number | null; totalIncTaxCents: number | null; percentComplete: number | null;
}
interface ItemRow {
  costCenterExternalId: string; kind: string; externalId: string; description: string; partNo: string | null; catalogId: string | null;
  qty: number; unitSellExTaxCents: number | null; unitSellIncTaxCents: number | null; sellExTaxCents: number | null;
  sellIncTaxCents: number | null; billableStatus: string | null; discountPercent: number | null; sortIndex: number;
}
interface NoteRow {
  externalId: string; subject: string | null; note: string | null; createdAt: string | null; createdBy: string | null;
  visibleToCustomer: number | null; referenceType: string | null; referenceNumber: string | null;
}
interface AttachmentRow {
  externalId: string; filename: string; folder: string | null; mimeType: string | null; sizeBytes: number | null;
  dateAdded: string | null; addedBy: string | null; public: number | null; localUri: string | null;
}

/** An attachment as the phone holds it: the office's record plus where the bytes are, if anywhere. */
export interface AttachmentRecord extends SimproAttachment { localUri?: string }

async function readDocumentChildren(
  p: ChildSql,
  parentId: string,
): Promise<{ sections: SimproSection[]; notes: SimproNote[]; attachments: AttachmentRecord[] }> {
  const db = await getDb();
  const [sections, costCenters, items, notes, attachments] = await Promise.all([
    db.getAllAsync<SectionRow>(p.sections, parentId),
    db.getAllAsync<CostCenterRow>(p.costCenters, parentId),
    db.getAllAsync<ItemRow>(p.items, parentId),
    db.getAllAsync<NoteRow>(p.notes, parentId),
    db.getAllAsync<AttachmentRow>(p.attachments, parentId),
  ]);

  const itemsByCc = new Map<string, SimproItem[]>();
  for (const r of items) {
    const list = itemsByCc.get(r.costCenterExternalId) ?? [];
    list.push({
      id: r.externalId,
      kind: r.kind as SimproItemKind,
      description: r.description,
      partNo: r.partNo ?? undefined,
      catalogId: r.catalogId ?? undefined,
      qty: r.qty,
      unitSellExTaxCents: r.unitSellExTaxCents ?? undefined,
      unitSellIncTaxCents: r.unitSellIncTaxCents ?? undefined,
      sellExTaxCents: r.sellExTaxCents ?? undefined,
      sellIncTaxCents: r.sellIncTaxCents ?? undefined,
      billableStatus: r.billableStatus ?? undefined,
      discountPercent: r.discountPercent ?? undefined,
    });
    itemsByCc.set(r.costCenterExternalId, list);
  }
  const ccBySection = new Map<string, SimproCostCenter[]>();
  for (const r of costCenters) {
    const list = ccBySection.get(r.sectionExternalId) ?? [];
    list.push({
      id: r.externalId,
      name: r.name,
      setupCostCenterId: r.setupCostCenterId ?? undefined,
      setupCostCenterName: r.setupCostCenterName ?? undefined,
      displayOrder: r.displayOrder,
      totalExTaxCents: r.totalExTaxCents ?? undefined,
      totalIncTaxCents: r.totalIncTaxCents ?? undefined,
      percentComplete: r.percentComplete ?? undefined,
      items: itemsByCc.get(r.externalId) ?? [],
    });
    ccBySection.set(r.sectionExternalId, list);
  }
  return {
    sections: sections.map((s) => ({
      id: s.externalId,
      name: s.name,
      description: s.description ?? undefined,
      displayOrder: s.displayOrder,
      costCenters: ccBySection.get(s.externalId) ?? [],
    })),
    notes: notes.map((n) => ({
      id: n.externalId,
      subject: n.subject ?? undefined,
      note: n.note ?? undefined,
      createdAt: n.createdAt ?? undefined,
      createdBy: n.createdBy ?? undefined,
      visibleToCustomer: optBool(n.visibleToCustomer),
      referenceType: n.referenceType ?? undefined,
      referenceNumber: n.referenceNumber ?? undefined,
    })),
    attachments: attachments.map((a) => ({
      id: a.externalId,
      filename: a.filename,
      folder: a.folder ?? undefined,
      mimeType: a.mimeType ?? undefined,
      sizeBytes: a.sizeBytes ?? undefined,
      dateAdded: a.dateAdded ?? undefined,
      addedBy: a.addedBy ?? undefined,
      public: optBool(a.public),
      localUri: a.localUri ?? undefined,
    })),
  };
}

/**
 * Replaces everything under a job with what the office holds now, and stamps
 * the job as read. One transaction: a pull that fails on the timeline leaves
 * last time's children in place rather than half of this time's.
 */
export async function replaceJobChildren(localId: string, children: Partial<JobChildren>, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await replaceDocumentChildren(JOB_CHILDREN, localId, children);
    if (children.timeline) {
      await db.runAsync('DELETE FROM job_timeline WHERE jobId = ?', localId);
      for (const t of children.timeline) {
        await db.runAsync(
          'INSERT INTO job_timeline (jobId, type, message, staffId, staffName, at) VALUES (?,?,?,?,?,?)',
          localId, orNull(t.type), t.message, orNull(t.staffId), orNull(t.staffName), orNull(t.at),
        );
      }
    }
    if (children.tasks) {
      await db.runAsync('DELETE FROM job_task WHERE jobId = ?', localId);
      for (const t of children.tasks) await writeTask(t, at, localId);
    }
    await db.runAsync('UPDATE job SET detailSyncedAt = ? WHERE id = ?', at, localId);
  });
}

/** Where a technician saved an attachment's bytes on this phone. Null forgets it. */
export async function setJobAttachmentLocalUri(localJobId_: string, attachmentId: string, uri: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE job_attachment SET localUri = ? WHERE jobId = ? AND externalId = ?', uri, localJobId_, attachmentId);
}

export interface JobFull {
  job: JobRecord;
  siteContact?: SimproContact;
  technicians: SimproPerson[];
  tags: string[];
  customerContract?: SimproContract;
  sections: SimproSection[];
  notes: SimproNote[];
  attachments: AttachmentRecord[];
  timeline: SimproTimelineEntry[];
  tasks: TaskRecord[];
  invoices: InvoiceRecord[];
  /** Whether the children have ever been read; a job with none may simply never have been opened. */
  detailSynced: boolean;
}

/** A job and everything under it, assembled from the mirror. Null when the job is not held. */
export async function getJobFull(localId: string): Promise<JobFull | null> {
  const db = await getDb();
  const job = await db.getFirstAsync<JobRecord>('SELECT * FROM job WHERE id = ?', localId);
  if (!job) return null;
  const [children, timelineRows, tasks, invoices] = await Promise.all([
    readDocumentChildren(JOB_CHILDREN, localId),
    db.getAllAsync<{ type: string | null; message: string; staffId: string | null; staffName: string | null; at: string | null }>(
      'SELECT type, message, staffId, staffName, at FROM job_timeline WHERE jobId = ? ORDER BY at DESC, id DESC', localId,
    ),
    listTasks({ jobId: localId }),
    job.externalId ? listInvoices({ jobExternalId: job.externalId }) : Promise.resolve([] as InvoiceRecord[]),
  ]);
  return {
    job,
    ...readJobJson(job),
    ...children,
    timeline: timelineRows.map((t) => ({
      type: t.type ?? undefined,
      message: t.message,
      staffId: t.staffId ?? undefined,
      staffName: t.staffName ?? undefined,
      at: t.at ?? undefined,
    })),
    tasks,
    invoices,
    detailSynced: !!job.detailSyncedAt,
  };
}

/**
 * Jobs whose children are worth reading now, most wanted first.
 *
 * `preferExternalIds` are the ones somebody is booked to, in the order the
 * caller wants them; after those come jobs the office touched since
 * `modifiedSince`, newest change first. Jobs read within `maxAgeMs` are
 * left out, and the whole list is cut at `limit` — a sync reads a dozen
 * requests per job, and sixty jobs is already a minute and a half.
 */
export async function jobsWantingDetail(options: {
  preferExternalIds?: string[];
  modifiedSince?: string;
  maxAgeMs: number;
  limit: number;
  now?: number;
}): Promise<{ id: string; externalId: string }[]> {
  const db = await getDb();
  const now = options.now ?? Date.now();
  const preferred = options.preferExternalIds ?? [];
  const rank = new Map(preferred.map((id, i) => [id, i]));

  const where: string[] = [];
  const args: string[] = [];
  if (preferred.length) {
    where.push(`externalId IN (${preferred.map(() => '?').join(',')})`);
    args.push(...preferred);
  }
  if (options.modifiedSince) {
    where.push('dateModified >= ?');
    args.push(options.modifiedSince);
  }
  if (!where.length) return [];

  const rows = await db.getAllAsync<Pick<JobRecord, 'id' | 'externalId' | 'dateModified' | 'detailSyncedAt'>>(
    `SELECT id, externalId, dateModified, detailSyncedAt FROM job
     WHERE externalId IS NOT NULL AND (${where.join(' OR ')})`,
    ...args,
  );
  return rows
    .filter((r) => r.externalId && jobDetailIsStale(r, options.maxAgeMs, now))
    .sort((a, b) => {
      const ra = rank.get(a.externalId!) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.externalId!) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (b.dateModified ?? '').localeCompare(a.dateModified ?? '');
    })
    .slice(0, options.limit)
    .map((r) => ({ id: r.id, externalId: r.externalId! }));
}

/**
 * The office's job numbers on the schedule between two days, soonest first,
 * for one person where the phone knows whose it is and for everyone where
 * it does not.
 */
export async function scheduledJobExternalIds(filter: {
  from: string;
  to: string;
  staffId?: string;
  staffName?: string;
}): Promise<string[]> {
  const db = await getDb();
  const where = ['date >= ?', 'date <= ?', 'jobId IS NOT NULL'];
  const args: string[] = [filter.from, filter.to];
  if (filter.staffId) { where.push('staffId = ?'); args.push(filter.staffId); }
  else if (filter.staffName?.trim()) { where.push('staffName = ? COLLATE NOCASE'); args.push(filter.staffName.trim()); }
  const rows = await db.getAllAsync<{ jobId: string }>(
    `SELECT jobId, MIN(date) AS first FROM schedule WHERE ${where.join(' AND ')} GROUP BY jobId ORDER BY first, jobId`,
    ...args,
  );
  return rows.map((r) => r.jobId);
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface QuoteRecord {
  externalId: string;
  name: string;
  description?: string;
  notes?: string;
  customerExternalId?: string;
  customerName?: string;
  siteExternalId?: string;
  siteId?: string;
  siteName?: string;
  siteContact?: SimproContact;
  customerContact?: SimproContact;
  customerContract?: SimproContract;
  stage?: string;
  customerStage?: string;
  statusName?: string;
  statusColor?: string;
  quoteType?: string;
  dateIssued?: string;
  dateApproved?: string;
  dueDate?: string;
  validityDays?: number;
  orderNo?: string;
  requestNo?: string;
  isClosed: boolean;
  jobExternalId?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  technicians: SimproPerson[];
  salesperson?: string;
  projectManager?: string;
  tags: string[];
  dateModified?: string;
  detailSyncedAt?: string;
  syncedAt: string;
}

interface QuoteRow {
  externalId: string; name: string; descriptionText: string | null; notesText: string | null;
  customerExternalId: string | null; customerName: string | null; siteExternalId: string | null; siteId: string | null;
  siteName: string | null; siteContactJson: string | null; customerContactJson: string | null; customerContractJson: string | null;
  stage: string | null; customerStage: string | null; statusName: string | null; statusColor: string | null; quoteType: string | null;
  dateIssued: string | null; dateApproved: string | null; dueDate: string | null; validityDays: number | null;
  orderNo: string | null; requestNo: string | null; isClosed: number; jobExternalId: string | null;
  totalExTaxCents: number | null; totalIncTaxCents: number | null; techniciansJson: string | null;
  salesperson: string | null; projectManager: string | null; tagsJson: string | null;
  dateModified: string | null; detailSyncedAt: string | null; syncedAt: string;
}

const hydrateQuote = (r: QuoteRow): QuoteRecord => ({
  externalId: r.externalId,
  name: r.name,
  description: r.descriptionText ?? undefined,
  notes: r.notesText ?? undefined,
  customerExternalId: r.customerExternalId ?? undefined,
  customerName: r.customerName ?? undefined,
  siteExternalId: r.siteExternalId ?? undefined,
  siteId: r.siteId ?? undefined,
  siteName: r.siteName ?? undefined,
  siteContact: parseJson<SimproContact | undefined>(r.siteContactJson, undefined),
  customerContact: parseJson<SimproContact | undefined>(r.customerContactJson, undefined),
  customerContract: parseJson<SimproContract | undefined>(r.customerContractJson, undefined),
  stage: r.stage ?? undefined,
  customerStage: r.customerStage ?? undefined,
  statusName: r.statusName ?? undefined,
  statusColor: r.statusColor ?? undefined,
  quoteType: r.quoteType ?? undefined,
  dateIssued: r.dateIssued ?? undefined,
  dateApproved: r.dateApproved ?? undefined,
  dueDate: r.dueDate ?? undefined,
  validityDays: r.validityDays ?? undefined,
  orderNo: r.orderNo ?? undefined,
  requestNo: r.requestNo ?? undefined,
  isClosed: bool(r.isClosed),
  jobExternalId: r.jobExternalId ?? undefined,
  totalExTaxCents: r.totalExTaxCents ?? undefined,
  totalIncTaxCents: r.totalIncTaxCents ?? undefined,
  technicians: parseJson<SimproPerson[]>(r.techniciansJson, []),
  salesperson: r.salesperson ?? undefined,
  projectManager: r.projectManager ?? undefined,
  tags: parseJson<string[]>(r.tagsJson, []),
  dateModified: r.dateModified ?? undefined,
  detailSyncedAt: r.detailSyncedAt ?? undefined,
  syncedAt: r.syncedAt,
});

/**
 * Writes a quote from a list-level or detail-level read.
 *
 * The three detail-only fields — notes, the customer contact, the contract
 * — survive a list-level write that did not ask for them, the same way a
 * job's do. Everything else is the office's and is taken whole.
 */
export async function upsertQuote(q: SimproQuote | SimproQuoteDetail, siteId: string | undefined, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  const detail = q as Partial<SimproQuoteDetail>;
  await db.runAsync(
    `INSERT INTO simpro_quote (externalId, name, descriptionText, notesText, customerExternalId, customerName,
       siteExternalId, siteId, siteName, siteContactJson, customerContactJson, customerContractJson,
       stage, customerStage, statusName, statusColor, quoteType, dateIssued, dateApproved, dueDate, validityDays,
       orderNo, requestNo, isClosed, jobExternalId, totalExTaxCents, totalIncTaxCents, techniciansJson,
       salesperson, projectManager, tagsJson, dateModified, detailSyncedAt, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       name = excluded.name, descriptionText = excluded.descriptionText,
       notesText = COALESCE(excluded.notesText, simpro_quote.notesText),
       customerExternalId = excluded.customerExternalId, customerName = excluded.customerName,
       siteExternalId = excluded.siteExternalId, siteId = COALESCE(excluded.siteId, simpro_quote.siteId),
       siteName = excluded.siteName, siteContactJson = excluded.siteContactJson,
       customerContactJson = COALESCE(excluded.customerContactJson, simpro_quote.customerContactJson),
       customerContractJson = COALESCE(excluded.customerContractJson, simpro_quote.customerContractJson),
       stage = excluded.stage, customerStage = excluded.customerStage,
       statusName = excluded.statusName, statusColor = excluded.statusColor, quoteType = excluded.quoteType,
       dateIssued = excluded.dateIssued, dateApproved = excluded.dateApproved, dueDate = excluded.dueDate,
       validityDays = excluded.validityDays, orderNo = excluded.orderNo, requestNo = excluded.requestNo,
       isClosed = excluded.isClosed, jobExternalId = COALESCE(excluded.jobExternalId, simpro_quote.jobExternalId),
       totalExTaxCents = excluded.totalExTaxCents, totalIncTaxCents = excluded.totalIncTaxCents,
       techniciansJson = excluded.techniciansJson, salesperson = excluded.salesperson,
       projectManager = excluded.projectManager, tagsJson = excluded.tagsJson,
       dateModified = COALESCE(excluded.dateModified, simpro_quote.dateModified),
       syncedAt = excluded.syncedAt`,
    q.id, q.name, orNull(q.description), orNull(detail.notes), orNull(q.customerId), orNull(q.customerName),
    orNull(q.siteId), orNull(siteId), orNull(q.siteName), json(q.siteContact), json(detail.customerContact),
    json(detail.customerContract), orNull(q.stage), orNull(q.customerStage), orNull(q.status), orNull(q.statusColor),
    orNull(q.type), orNull(q.dateIssued), orNull(q.dateApproved), orNull(q.dueDate), orNull(q.validityDays),
    orNull(q.orderNo), orNull(q.requestNo), q.isClosed ? 1 : 0, orNull(q.jobId), orNull(q.totalExTaxCents),
    orNull(q.totalIncTaxCents), JSON.stringify(q.technicians), orNull(q.salesperson), orNull(q.projectManager),
    JSON.stringify(q.tags), orNull(q.DateModified), null, at,
  );
}

export interface QuoteChildren {
  sections: SimproSection[];
  notes: SimproNote[];
  attachments: SimproAttachment[];
}

export async function replaceQuoteChildren(externalId: string, children: Partial<QuoteChildren>, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await replaceDocumentChildren(QUOTE_CHILDREN, externalId, children);
    await db.runAsync('UPDATE simpro_quote SET detailSyncedAt = ? WHERE externalId = ?', at, externalId);
  });
}

export async function setQuoteAttachmentLocalUri(quoteExternalId: string, attachmentId: string, uri: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE simpro_quote_attachment SET localUri = ? WHERE quoteId = ? AND externalId = ?', uri, quoteExternalId, attachmentId,
  );
}

export async function getQuote(externalId: string): Promise<QuoteRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<QuoteRow>('SELECT * FROM simpro_quote WHERE externalId = ?', externalId);
  return row ? hydrateQuote(row) : null;
}

export interface QuoteFull {
  quote: QuoteRecord;
  sections: SimproSection[];
  notes: SimproNote[];
  attachments: AttachmentRecord[];
  detailSynced: boolean;
}

export async function getQuoteFull(externalId: string): Promise<QuoteFull | null> {
  const quote = await getQuote(externalId);
  if (!quote) return null;
  const children = await readDocumentChildren(QUOTE_CHILDREN, externalId);
  return { quote, ...children, detailSynced: !!quote.detailSyncedAt };
}

export async function listQuotes(filter: {
  siteId?: string;
  siteExternalId?: string;
  customerExternalId?: string;
  stage?: string;
  /** Not closed and not yet turned into a job. */
  openOnly?: boolean;
  limit?: number;
} = {}): Promise<QuoteRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.siteId) { where.push('siteId = ?'); args.push(filter.siteId); }
  if (filter.siteExternalId) { where.push('siteExternalId = ?'); args.push(filter.siteExternalId); }
  if (filter.customerExternalId) { where.push('customerExternalId = ?'); args.push(filter.customerExternalId); }
  if (filter.stage) { where.push('stage = ?'); args.push(filter.stage); }
  if (filter.openOnly) where.push('isClosed = 0 AND jobExternalId IS NULL');
  args.push(filter.limit ?? 200);
  const rows = await db.getAllAsync<QuoteRow>(
    `SELECT * FROM simpro_quote ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(dateModified, dateIssued, '') DESC LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateQuote);
}

/** Quotes whose children are worth reading now: never read, or older than `maxAgeMs`, and modified since. */
export async function quotesWantingDetail(options: {
  modifiedSince?: string;
  maxAgeMs: number;
  limit: number;
  now?: number;
}): Promise<string[]> {
  const db = await getDb();
  const now = options.now ?? Date.now();
  const rows = options.modifiedSince
    ? await db.getAllAsync<{ externalId: string; detailSyncedAt: string | null }>(
      'SELECT externalId, detailSyncedAt FROM simpro_quote WHERE dateModified >= ? ORDER BY dateModified DESC',
      options.modifiedSince,
    )
    : [];
  return rows
    .filter((r) => jobDetailIsStale({ detailSyncedAt: r.detailSyncedAt ?? undefined }, options.maxAgeMs, now))
    .slice(0, options.limit)
    .map((r) => r.externalId);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceRecord {
  externalId: string;
  invoiceType?: string;
  customerExternalId?: string;
  customerName?: string;
  dateIssued?: string;
  stage?: string;
  statusName?: string;
  isPaid: boolean;
  datePaid?: string;
  dueDate?: string;
  orderNo?: string;
  description?: string;
  notes?: string;
  periodStart?: string;
  periodEnd?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  amountAppliedCents?: number;
  balanceDueCents?: number;
  dateModified?: string;
  detailSyncedAt?: string;
  syncedAt: string;
  jobs: SimproInvoiceJob[];
}

interface InvoiceRow {
  externalId: string; invoiceType: string | null; customerExternalId: string | null; customerName: string | null;
  dateIssued: string | null; stage: string | null; statusName: string | null; isPaid: number; datePaid: string | null;
  dueDate: string | null; orderNo: string | null; descriptionText: string | null; notesText: string | null;
  periodStart: string | null; periodEnd: string | null; totalExTaxCents: number | null; totalIncTaxCents: number | null;
  amountAppliedCents: number | null; balanceDueCents: number | null; dateModified: string | null;
  detailSyncedAt: string | null; syncedAt: string;
}
interface InvoiceJobRow {
  invoiceExternalId: string; jobExternalId: string; jobType: string | null; description: string | null;
  totalExTaxCents: number | null; totalIncTaxCents: number | null;
}

const hydrateInvoice = (r: InvoiceRow, jobs: InvoiceJobRow[]): InvoiceRecord => ({
  externalId: r.externalId,
  invoiceType: r.invoiceType ?? undefined,
  customerExternalId: r.customerExternalId ?? undefined,
  customerName: r.customerName ?? undefined,
  dateIssued: r.dateIssued ?? undefined,
  stage: r.stage ?? undefined,
  statusName: r.statusName ?? undefined,
  isPaid: bool(r.isPaid),
  datePaid: r.datePaid ?? undefined,
  dueDate: r.dueDate ?? undefined,
  orderNo: r.orderNo ?? undefined,
  description: r.descriptionText ?? undefined,
  notes: r.notesText ?? undefined,
  periodStart: r.periodStart ?? undefined,
  periodEnd: r.periodEnd ?? undefined,
  totalExTaxCents: r.totalExTaxCents ?? undefined,
  totalIncTaxCents: r.totalIncTaxCents ?? undefined,
  amountAppliedCents: r.amountAppliedCents ?? undefined,
  balanceDueCents: r.balanceDueCents ?? undefined,
  dateModified: r.dateModified ?? undefined,
  detailSyncedAt: r.detailSyncedAt ?? undefined,
  syncedAt: r.syncedAt,
  jobs: jobs.map((j) => ({
    id: j.jobExternalId,
    type: j.jobType ?? undefined,
    description: j.description ?? undefined,
    totalExTaxCents: j.totalExTaxCents ?? undefined,
    totalIncTaxCents: j.totalIncTaxCents ?? undefined,
  })),
});

/**
 * Writes an invoice and the jobs it bills. The job links are replaced whole
 * with the invoice, since an invoice re-issued against a different job has
 * to stop pointing at the old one.
 */
export async function upsertInvoice(inv: SimproInvoice, at: string = nowIso(), options: { fromDetail?: boolean } = {}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO invoice (externalId, invoiceType, customerExternalId, customerName, dateIssued, stage, statusName,
       isPaid, datePaid, dueDate, orderNo, descriptionText, notesText, periodStart, periodEnd,
       totalExTaxCents, totalIncTaxCents, amountAppliedCents, balanceDueCents, dateModified, detailSyncedAt, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       invoiceType = excluded.invoiceType, customerExternalId = excluded.customerExternalId,
       customerName = excluded.customerName, dateIssued = excluded.dateIssued, stage = excluded.stage,
       statusName = excluded.statusName, isPaid = excluded.isPaid, datePaid = excluded.datePaid,
       dueDate = COALESCE(excluded.dueDate, invoice.dueDate), orderNo = excluded.orderNo,
       descriptionText = COALESCE(excluded.descriptionText, invoice.descriptionText),
       notesText = COALESCE(excluded.notesText, invoice.notesText),
       periodStart = COALESCE(excluded.periodStart, invoice.periodStart),
       periodEnd = COALESCE(excluded.periodEnd, invoice.periodEnd),
       totalExTaxCents = excluded.totalExTaxCents, totalIncTaxCents = excluded.totalIncTaxCents,
       amountAppliedCents = excluded.amountAppliedCents, balanceDueCents = excluded.balanceDueCents,
       dateModified = COALESCE(excluded.dateModified, invoice.dateModified),
       detailSyncedAt = COALESCE(excluded.detailSyncedAt, invoice.detailSyncedAt),
       syncedAt = excluded.syncedAt`,
    inv.id, orNull(inv.type), orNull(inv.customerId), orNull(inv.customerName), orNull(inv.dateIssued), orNull(inv.stage),
    orNull(inv.status), inv.isPaid ? 1 : 0, orNull(inv.datePaid), orNull(inv.dueDate), orNull(inv.orderNo),
    orNull(inv.description), orNull(inv.notes), orNull(inv.periodStart), orNull(inv.periodEnd),
    orNull(inv.totalExTaxCents), orNull(inv.totalIncTaxCents), orNull(inv.amountAppliedCents), orNull(inv.balanceDueCents),
    orNull(inv.DateModified), options.fromDetail ? at : null, at,
  );
  await db.runAsync('DELETE FROM invoice_job WHERE invoiceExternalId = ?', inv.id);
  for (const j of inv.jobs) {
    await db.runAsync(
      `INSERT OR REPLACE INTO invoice_job (invoiceExternalId, jobExternalId, jobType, description, totalExTaxCents, totalIncTaxCents)
       VALUES (?,?,?,?,?,?)`,
      inv.id, j.id, orNull(j.type), orNull(j.description), orNull(j.totalExTaxCents), orNull(j.totalIncTaxCents),
    );
  }
}

export async function getInvoice(externalId: string): Promise<InvoiceRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<InvoiceRow>('SELECT * FROM invoice WHERE externalId = ?', externalId);
  if (!row) return null;
  const jobs = await db.getAllAsync<InvoiceJobRow>('SELECT * FROM invoice_job WHERE invoiceExternalId = ?', externalId);
  return hydrateInvoice(row, jobs);
}

export async function listInvoices(filter: {
  /** The office's job number, not the local job id. */
  jobExternalId?: string;
  customerExternalId?: string;
  unpaidOnly?: boolean;
  /** Issued on or after this day, yyyy-mm-dd. */
  since?: string;
  limit?: number;
} = {}): Promise<InvoiceRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.jobExternalId) {
    where.push('externalId IN (SELECT invoiceExternalId FROM invoice_job WHERE jobExternalId = ?)');
    args.push(filter.jobExternalId);
  }
  if (filter.customerExternalId) { where.push('customerExternalId = ?'); args.push(filter.customerExternalId); }
  if (filter.unpaidOnly) where.push('isPaid = 0');
  if (filter.since) { where.push('dateIssued >= ?'); args.push(filter.since); }
  args.push(filter.limit ?? 200);
  const rows = await db.getAllAsync<InvoiceRow>(
    `SELECT * FROM invoice ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(dateIssued, '') DESC, externalId DESC LIMIT ?`,
    ...args,
  );
  if (!rows.length) return [];
  const links = await db.getAllAsync<InvoiceJobRow>(
    `SELECT * FROM invoice_job WHERE invoiceExternalId IN (${rows.map(() => '?').join(',')})`,
    ...rows.map((r) => r.externalId),
  );
  const byInvoice = new Map<string, InvoiceJobRow[]>();
  for (const l of links) byInvoice.set(l.invoiceExternalId, [...(byInvoice.get(l.invoiceExternalId) ?? []), l]);
  return rows.map((r) => hydrateInvoice(r, byInvoice.get(r.externalId) ?? []));
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerRecord {
  externalId: string;
  /** Simpro's Type: Company or Individual. */
  kind: string;
  name: string;
  givenName?: string;
  familyName?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  website?: string;
  address?: SimproAddress;
  billingAddress?: SimproAddress;
  customerType?: string;
  customerGroup?: string;
  archived: boolean;
  notes?: string;
  tags: string[];
  sites: SimproPerson[];
  contacts: SimproContact[];
  dateModified?: string;
  detailSyncedAt?: string;
  syncedAt: string;
}

interface CustomerRow {
  externalId: string; customerKind: string; name: string; givenName: string | null; familyName: string | null;
  phone: string | null; altPhone: string | null; email: string | null; website: string | null;
  address: string | null; suburb: string | null; state: string | null; postcode: string | null; country: string | null;
  billingAddress: string | null; billingSuburb: string | null; billingState: string | null; billingPostcode: string | null;
  customerType: string | null; customerGroup: string | null; archived: number; notes: string | null;
  tagsJson: string | null; sitesJson: string; contactsJson: string; dateModified: string | null;
  detailSyncedAt: string | null; syncedAt: string;
}

function addressFrom(parts: { address: string | null; suburb: string | null; state: string | null; postcode: string | null; country?: string | null }): SimproAddress | undefined {
  const out: SimproAddress = {
    address: parts.address ?? undefined,
    suburb: parts.suburb ?? undefined,
    state: parts.state ?? undefined,
    postcode: parts.postcode ?? undefined,
    country: parts.country ?? undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

const hydrateCustomer = (r: CustomerRow): CustomerRecord => ({
  externalId: r.externalId,
  kind: r.customerKind,
  name: r.name,
  givenName: r.givenName ?? undefined,
  familyName: r.familyName ?? undefined,
  phone: r.phone ?? undefined,
  altPhone: r.altPhone ?? undefined,
  email: r.email ?? undefined,
  website: r.website ?? undefined,
  address: addressFrom(r),
  billingAddress: addressFrom({ address: r.billingAddress, suburb: r.billingSuburb, state: r.billingState, postcode: r.billingPostcode }),
  customerType: r.customerType ?? undefined,
  customerGroup: r.customerGroup ?? undefined,
  archived: bool(r.archived),
  notes: r.notes ?? undefined,
  tags: parseJson<string[]>(r.tagsJson, []),
  sites: parseJson<SimproPerson[]>(r.sitesJson, []),
  contacts: parseJson<SimproContact[]>(r.contactsJson, []),
  dateModified: r.dateModified ?? undefined,
  detailSyncedAt: r.detailSyncedAt ?? undefined,
  syncedAt: r.syncedAt,
});

/**
 * Writes a customer from the list or from the company record.
 *
 * The list does not carry contacts, notes, the group or the billing
 * address; a list-level write leaves whatever a detail read put there.
 * `fromDetail` says this write is the record itself, so it may replace
 * those and stamp detailSyncedAt.
 */
export async function upsertCustomer(c: SimproCustomer, at: string = nowIso(), options: { fromDetail?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const detail = options.fromDetail === true;
  await db.runAsync(
    `INSERT INTO customer (externalId, customerKind, name, givenName, familyName, phone, altPhone, email, website,
       address, suburb, state, postcode, country, billingAddress, billingSuburb, billingState, billingPostcode,
       customerType, customerGroup, archived, notes, tagsJson, sitesJson, contactsJson, dateModified, detailSyncedAt, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       customerKind = excluded.customerKind, name = excluded.name,
       givenName = COALESCE(excluded.givenName, customer.givenName),
       familyName = COALESCE(excluded.familyName, customer.familyName),
       phone = COALESCE(excluded.phone, customer.phone), altPhone = COALESCE(excluded.altPhone, customer.altPhone),
       email = COALESCE(excluded.email, customer.email), website = COALESCE(excluded.website, customer.website),
       address = COALESCE(excluded.address, customer.address), suburb = COALESCE(excluded.suburb, customer.suburb),
       state = COALESCE(excluded.state, customer.state), postcode = COALESCE(excluded.postcode, customer.postcode),
       country = COALESCE(excluded.country, customer.country),
       billingAddress = COALESCE(excluded.billingAddress, customer.billingAddress),
       billingSuburb = COALESCE(excluded.billingSuburb, customer.billingSuburb),
       billingState = COALESCE(excluded.billingState, customer.billingState),
       billingPostcode = COALESCE(excluded.billingPostcode, customer.billingPostcode),
       customerType = COALESCE(excluded.customerType, customer.customerType),
       customerGroup = COALESCE(excluded.customerGroup, customer.customerGroup),
       archived = excluded.archived,
       notes = COALESCE(excluded.notes, customer.notes),
       tagsJson = COALESCE(excluded.tagsJson, customer.tagsJson),
       sitesJson = CASE WHEN excluded.sitesJson = '[]' THEN customer.sitesJson ELSE excluded.sitesJson END,
       contactsJson = CASE WHEN excluded.contactsJson = '[]' THEN customer.contactsJson ELSE excluded.contactsJson END,
       dateModified = COALESCE(excluded.dateModified, customer.dateModified),
       detailSyncedAt = COALESCE(excluded.detailSyncedAt, customer.detailSyncedAt),
       syncedAt = excluded.syncedAt`,
    c.id, c.type, c.name, orNull(c.givenName), orNull(c.familyName), orNull(c.phone), orNull(c.altPhone), orNull(c.email),
    orNull(c.website), orNull(c.address?.address), orNull(c.address?.suburb), orNull(c.address?.state),
    orNull(c.address?.postcode), orNull(c.address?.country), orNull(c.billingAddress?.address),
    orNull(c.billingAddress?.suburb), orNull(c.billingAddress?.state), orNull(c.billingAddress?.postcode),
    orNull(c.customerType), orNull(c.customerGroup), c.archived ? 1 : 0, orNull(c.notes),
    c.tags.length ? JSON.stringify(c.tags) : null, JSON.stringify(c.sites), JSON.stringify(c.contacts),
    orNull(c.DateModified), detail ? at : null, at,
  );
}

/**
 * After a full pull, the customers it did not see are gone from the office
 * and go from here. Only after a full pull: an incremental one saw only
 * what changed, and everything else is still there.
 */
export async function pruneCustomersNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM customer WHERE syncedAt <> ?', at);
  return r.changes;
}

export async function getCustomer(externalId: string): Promise<CustomerRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CustomerRow>('SELECT * FROM customer WHERE externalId = ?', externalId);
  return row ? hydrateCustomer(row) : null;
}

/** Customers by name, email or phone, the way a technician would type one. Current ones first. */
export async function searchCustomers(query: string, limit = 30): Promise<CustomerRecord[]> {
  const db = await getDb();
  const term = query.trim();
  if (!term) {
    const rows = await db.getAllAsync<CustomerRow>(
      'SELECT * FROM customer ORDER BY archived, name COLLATE NOCASE LIMIT ?', limit,
    );
    return rows.map(hydrateCustomer);
  }
  const like = `%${term}%`;
  const rows = await db.getAllAsync<CustomerRow>(
    `SELECT * FROM customer
     WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR externalId = ?
     ORDER BY archived, CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?`,
    like, like, like, term, `${term}%`, limit,
  );
  return rows.map(hydrateCustomer);
}

export interface CustomerStats {
  jobsTotal: number;
  /** Pending or in progress at the office. */
  jobsOpen: number;
  /** The most recent job's issue date, yyyy-mm-dd. A day, not an instant. */
  lastJobAt?: string;
  /** Quotes neither closed nor yet turned into a job. */
  quotesOpen: number;
  /** Balance due across unpaid invoices, whole cents, within the two-year window the mirror holds. */
  invoicesUnpaidCents: number;
}

export async function customerStats(externalId: string): Promise<CustomerStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ jobsTotal: number; jobsOpen: number; lastJobAt: string | null; quotesOpen: number; invoicesUnpaidCents: number }>(
    `SELECT
       (SELECT COUNT(*) FROM job WHERE customerExternalId = ?) AS jobsTotal,
       (SELECT COUNT(*) FROM job WHERE customerExternalId = ? AND COALESCE(stageRaw, stage) IN ${OPEN_STAGES}) AS jobsOpen,
       (SELECT MAX(scheduledFor) FROM job WHERE customerExternalId = ?) AS lastJobAt,
       (SELECT COUNT(*) FROM simpro_quote WHERE customerExternalId = ? AND isClosed = 0 AND jobExternalId IS NULL) AS quotesOpen,
       (SELECT COALESCE(SUM(balanceDueCents), 0) FROM invoice WHERE customerExternalId = ? AND isPaid = 0) AS invoicesUnpaidCents`,
    externalId, externalId, externalId, externalId, externalId,
  );
  return {
    jobsTotal: row?.jobsTotal ?? 0,
    jobsOpen: row?.jobsOpen ?? 0,
    lastJobAt: row?.lastJobAt ?? undefined,
    quotesOpen: row?.quotesOpen ?? 0,
    invoicesUnpaidCents: row?.invoicesUnpaidCents ?? 0,
  };
}

/** The same figures for a local site: its jobs, its quotes, and the invoices that bill its jobs. */
export async function siteStats(siteId: string): Promise<CustomerStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ jobsTotal: number; jobsOpen: number; lastJobAt: string | null; quotesOpen: number; invoicesUnpaidCents: number }>(
    `SELECT
       (SELECT COUNT(*) FROM job WHERE siteId = ?) AS jobsTotal,
       (SELECT COUNT(*) FROM job WHERE siteId = ? AND COALESCE(stageRaw, stage) IN ${OPEN_STAGES}) AS jobsOpen,
       (SELECT MAX(scheduledFor) FROM job WHERE siteId = ?) AS lastJobAt,
       (SELECT COUNT(*) FROM simpro_quote WHERE siteId = ? AND isClosed = 0 AND jobExternalId IS NULL) AS quotesOpen,
       (SELECT COALESCE(SUM(balanceDueCents), 0) FROM invoice WHERE isPaid = 0 AND externalId IN (
          SELECT ij.invoiceExternalId FROM invoice_job ij JOIN job j ON j.externalId = ij.jobExternalId WHERE j.siteId = ?
       )) AS invoicesUnpaidCents`,
    siteId, siteId, siteId, siteId, siteId,
  );
  return {
    jobsTotal: row?.jobsTotal ?? 0,
    jobsOpen: row?.jobsOpen ?? 0,
    lastJobAt: row?.lastJobAt ?? undefined,
    quotesOpen: row?.quotesOpen ?? 0,
    invoicesUnpaidCents: row?.invoicesUnpaidCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskRecord extends SimproTask {
  /** The local job it sits under, where it was read under one. */
  jobId?: string;
  syncedAt: string;
}

interface TaskRow {
  externalId: string; jobId: string | null; subject: string; assignedTo: string | null; assigneesJson: string;
  completedBy: string | null; dueDate: string | null; percentComplete: number | null; createdDate: string | null; syncedAt: string;
}

const hydrateTask = (r: TaskRow): TaskRecord => ({
  id: r.externalId,
  jobId: r.jobId ?? undefined,
  subject: r.subject,
  assignedTo: r.assignedTo ?? undefined,
  assignees: parseJson<string[]>(r.assigneesJson, []),
  completedBy: r.completedBy ?? undefined,
  dueDate: r.dueDate ?? undefined,
  percentComplete: r.percentComplete ?? undefined,
  createdDate: r.createdDate ?? undefined,
  syncedAt: r.syncedAt,
});

async function writeTask(t: SimproTask, at: string, jobId: string | undefined): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO job_task (externalId, jobId, subject, assignedTo, assigneesJson, completedBy, dueDate, percentComplete, createdDate, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       jobId = COALESCE(excluded.jobId, job_task.jobId), subject = excluded.subject, assignedTo = excluded.assignedTo,
       assigneesJson = excluded.assigneesJson, completedBy = excluded.completedBy, dueDate = excluded.dueDate,
       percentComplete = excluded.percentComplete, createdDate = excluded.createdDate, syncedAt = excluded.syncedAt`,
    t.id, orNull(jobId), t.subject, orNull(t.assignedTo), JSON.stringify(t.assignees), orNull(t.completedBy),
    orNull(t.dueDate), orNull(t.percentComplete), orNull(t.createdDate), at,
  );
}

/** The company-wide task list. Upserted, not replaced, so a job link a detail read made survives. */
export async function upsertTasks(tasks: readonly SimproTask[], at: string = nowIso()): Promise<number> {
  const db = await getDb();
  let written = 0;
  await db.withTransactionAsync(async () => {
    for (const t of tasks) {
      if (!t.id) continue;
      await writeTask(t, at, undefined);
      written++;
    }
  });
  return written;
}

export async function listTasks(filter: { jobId?: string; openOnly?: boolean; limit?: number } = {}): Promise<TaskRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.jobId) { where.push('jobId = ?'); args.push(filter.jobId); }
  if (filter.openOnly) where.push('completedBy IS NULL AND COALESCE(percentComplete, 0) < 100');
  args.push(filter.limit ?? 200);
  const rows = await db.getAllAsync<TaskRow>(
    `SELECT * FROM job_task ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(dueDate, '9999') , createdDate DESC, externalId LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateTask);
}
