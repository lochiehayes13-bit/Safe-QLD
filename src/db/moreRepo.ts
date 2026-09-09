import { getDb, inTransaction, nowIso } from './index';
import type { SimproAddress } from '@/simpro/mirrorResources';
import type {
  SimproActivityBlock, SimproActivitySchedule, SimproCatalogGroup, SimproCatalogItem, SimproCreditNote,
  SimproCustomerPayment, SimproLead, SimproNamedRef, SimproOfficeContact, SimproPaymentInvoice, SimproSetupActivity,
  SimproTimesheetRow, SimproVendor, SimproVendorOrder, SimproVendorOrderLine, SimproVendorOrderLineKind,
} from '@/simpro/moreResources';

/**
 * The v23 mirror on the phone: purchase orders and their lines, suppliers,
 * the office catalogue, contacts, leads, the hours the office holds, the
 * activities it schedules, payments and credit notes.
 *
 * The same two kinds of function as ./mirrorRepo, shaped the same way. The
 * writes are what the sync calls: an upsert per list-level record keyed on
 * the office's id, so a re-pull updates rather than duplicates, and a
 * "replace the children" for the sets that are read whole — an order's
 * lines, a payment's invoices, an employee's hours in a window — done in
 * one transaction so a half-finished read cannot leave last week's lines
 * beside this week's. After a full pull the rows it did not see are pruned
 * by syncedAt, since the office no longer has them.
 *
 * The reads are what the screens will call, and every one is a query with
 * a WHERE and a LIMIT rather than a read of the table filtered in memory:
 * the catalogue is nine thousand rows and the contacts two and a half
 * thousand, and a phone does not page through either to find one.
 *
 * Nothing here holds cost, markup or margin; the columns do not exist.
 * clock_entry is the one v23 table not touched here: it is the phone's
 * own and lives in ./clockRepo.
 */

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return (JSON.parse(s) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const bool = (v: number | null | undefined): boolean => v === 1;

/** The words of a search, a leading # dropped the way the job search drops it. */
function searchWords(query: string | undefined): string[] {
  return (query ?? '').trim().split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
}

/**
 * A ref as it is written into a JSON list column, so a search for one can
 * match the exact text rather than parse every row. The shape is fixed here
 * and only here: {id, name}, in that order, no spaces, which is what
 * JSON.stringify produces for the object below and what refMarker finds.
 */
const refJson = (refs: readonly SimproNamedRef[]): string => JSON.stringify(refs.map((r) => ({ id: r.id, name: r.name })));
const refMarker = (id: string): string => `%${JSON.stringify({ id })
  .replace(/}$/, '')}%`;

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export interface VendorOrderRecord extends Omit<SimproVendorOrder, 'DateModified'> {
  dateModified?: string;
  /** When the lines were last read. Undefined: never. */
  detailSyncedAt?: string;
  syncedAt: string;
}

export interface VendorOrderFull extends VendorOrderRecord {
  lines: SimproVendorOrderLine[];
}

interface VendorOrderRow {
  externalId: string; orderType: string | null; stage: string | null; statusId: string | null; statusName: string | null;
  vendorExternalId: string | null; vendorName: string | null; jobExternalId: string | null;
  jobSectionExternalId: string | null; jobCostCenterExternalId: string | null; assignedToName: string | null;
  reference: string | null; quoteNo: string | null; dateIssued: string | null; dueDate: string | null;
  vendorNotes: string | null; privateNotes: string | null; createdByName: string | null; archived: number;
  dateModified: string | null; detailSyncedAt: string | null; syncedAt: string;
}

interface VendorOrderLineRow {
  orderExternalId: string; kind: string; externalId: string; catalogExternalId: string | null; partNo: string | null;
  description: string; qtyOrdered: number | null; qtyReceived: number | null; dueDate: string | null;
}

const hydrateVendorOrder = (r: VendorOrderRow): VendorOrderRecord => ({
  id: r.externalId,
  orderType: r.orderType ?? undefined,
  stage: r.stage ?? undefined,
  statusId: r.statusId ?? undefined,
  statusName: r.statusName ?? undefined,
  vendorId: r.vendorExternalId ?? undefined,
  vendorName: r.vendorName ?? undefined,
  jobId: r.jobExternalId ?? undefined,
  jobSectionId: r.jobSectionExternalId ?? undefined,
  jobCostCenterId: r.jobCostCenterExternalId ?? undefined,
  assignedToName: r.assignedToName ?? undefined,
  reference: r.reference ?? undefined,
  quoteNo: r.quoteNo ?? undefined,
  dateIssued: r.dateIssued ?? undefined,
  dueDate: r.dueDate ?? undefined,
  vendorNotes: r.vendorNotes ?? undefined,
  privateNotes: r.privateNotes ?? undefined,
  createdByName: r.createdByName ?? undefined,
  archived: bool(r.archived),
  dateModified: r.dateModified ?? undefined,
  detailSyncedAt: r.detailSyncedAt ?? undefined,
  syncedAt: r.syncedAt,
});

const hydrateLine = (l: VendorOrderLineRow): SimproVendorOrderLine => ({
  kind: l.kind as SimproVendorOrderLineKind,
  id: l.externalId,
  catalogId: l.catalogExternalId ?? undefined,
  partNo: l.partNo ?? undefined,
  description: l.description,
  qtyOrdered: l.qtyOrdered ?? undefined,
  qtyReceived: l.qtyReceived ?? undefined,
  dueDate: l.dueDate ?? undefined,
});

/** Writes an order from the list. The lines are a separate read and are left as they were. */
export async function upsertVendorOrder(o: SimproVendorOrder, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO vendor_order (externalId, orderType, stage, statusId, statusName, vendorExternalId, vendorName,
       jobExternalId, jobSectionExternalId, jobCostCenterExternalId, assignedToName, reference, quoteNo, dateIssued,
       dueDate, vendorNotes, privateNotes, createdByName, archived, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       orderType = excluded.orderType, stage = excluded.stage, statusId = excluded.statusId,
       statusName = excluded.statusName, vendorExternalId = excluded.vendorExternalId, vendorName = excluded.vendorName,
       jobExternalId = excluded.jobExternalId, jobSectionExternalId = excluded.jobSectionExternalId,
       jobCostCenterExternalId = excluded.jobCostCenterExternalId, assignedToName = excluded.assignedToName,
       reference = excluded.reference, quoteNo = excluded.quoteNo, dateIssued = excluded.dateIssued,
       dueDate = excluded.dueDate, vendorNotes = excluded.vendorNotes, privateNotes = excluded.privateNotes,
       createdByName = excluded.createdByName, archived = excluded.archived,
       dateModified = COALESCE(excluded.dateModified, vendor_order.dateModified),
       syncedAt = excluded.syncedAt`,
    o.id, orNull(o.orderType), orNull(o.stage), orNull(o.statusId), orNull(o.statusName), orNull(o.vendorId),
    orNull(o.vendorName), orNull(o.jobId), orNull(o.jobSectionId), orNull(o.jobCostCenterId), orNull(o.assignedToName),
    orNull(o.reference), orNull(o.quoteNo), orNull(o.dateIssued), orNull(o.dueDate), orNull(o.vendorNotes),
    orNull(o.privateNotes), orNull(o.createdByName), o.archived ? 1 : 0, orNull(o.DateModified), at,
  );
}

/**
 * Replaces an order's lines whole and stamps when they were read. One
 * transaction, joining one already open: an order is never seen with half
 * its lines from one read and half from another.
 */
export async function replaceVendorOrderLines(orderExternalId: string, lines: readonly SimproVendorOrderLine[], at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM vendor_order_line WHERE orderExternalId = ?', orderExternalId);
    for (const l of lines) {
      if (!l.id) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO vendor_order_line (orderExternalId, kind, externalId, catalogExternalId, partNo, description,
           qtyOrdered, qtyReceived, dueDate)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        orderExternalId, l.kind, l.id, orNull(l.catalogId), orNull(l.partNo), l.description,
        orNull(l.qtyOrdered), orNull(l.qtyReceived), orNull(l.dueDate),
      );
    }
    await db.runAsync('UPDATE vendor_order SET detailSyncedAt = ? WHERE externalId = ?', at, orderExternalId);
  });
}

export async function pruneVendorOrdersNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  // The lines go with the order: the foreign key cascades, and where a
  // connection has the keys off the orphaned lines are swept explicitly.
  await db.runAsync('DELETE FROM vendor_order_line WHERE orderExternalId IN (SELECT externalId FROM vendor_order WHERE syncedAt <> ?)', at);
  const r = await db.runAsync('DELETE FROM vendor_order WHERE syncedAt <> ?', at);
  return r.changes;
}

/**
 * The orders whose lines are worth reading this run: changed by the office
 * lately, or against a job the phone holds, and not read since the office
 * last touched them or within the freshness window. Newest change first,
 * capped, so a run's budget goes on what moved.
 *
 * `modifiedSince` is a day, compared as text against the office's
 * DateModified, which starts with the same yyyy-mm-dd; that is a day's
 * precision and it is all a sixty-day window needs.
 *
 * An order already read is wanted again only when the office has touched
 * it since, and not within the freshness window either way. The window is
 * a guard, not a trigger: read as "stale or touched", every in-scope
 * order was read again every run, and the sixty-request budget went on
 * orders that had not changed.
 *
 * "Touched since it was read" is not a text comparison. The read stamp is
 * the phone's UTC instant and the office's stamp carries its own +10:00,
 * so as text a read at 00:30Z sorts before a change at 09:00+10:00 that
 * happened an hour and a half earlier, and every order the office touched
 * that morning was read again on every run until the afternoon. SQLite's
 * datetime() brings both to UTC first.
 */
export async function vendorOrdersWantingLines(options: {
  modifiedSince: string;
  /** An order's lines read after this instant are fresh enough to keep. */
  freshAfter: string;
  limit?: number;
}): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ externalId: string }>(
    `SELECT externalId FROM vendor_order
     WHERE archived = 0
       AND (dateModified >= ? OR jobExternalId IN (SELECT externalId FROM job WHERE externalId IS NOT NULL))
       AND (detailSyncedAt IS NULL
            OR (detailSyncedAt < ? AND (dateModified IS NULL OR datetime(detailSyncedAt) < datetime(dateModified))))
     ORDER BY COALESCE(dateModified, '') DESC, externalId DESC
     LIMIT ?`,
    options.modifiedSince, options.freshAfter, options.limit ?? 60,
  );
  return rows.map((r) => r.externalId);
}

async function linesFor(orderIds: readonly string[]): Promise<Map<string, SimproVendorOrderLine[]>> {
  const out = new Map<string, SimproVendorOrderLine[]>();
  if (!orderIds.length) return out;
  const db = await getDb();
  const rows = await db.getAllAsync<VendorOrderLineRow>(
    `SELECT * FROM vendor_order_line WHERE orderExternalId IN (${orderIds.map(() => '?').join(',')})
     ORDER BY orderExternalId, kind, externalId`,
    ...orderIds,
  );
  for (const l of rows) out.set(l.orderExternalId, [...(out.get(l.orderExternalId) ?? []), hydrateLine(l)]);
  return out;
}

export async function getVendorOrder(externalId: string): Promise<VendorOrderFull | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VendorOrderRow>('SELECT * FROM vendor_order WHERE externalId = ?', externalId);
  if (!row) return null;
  const lines = await linesFor([externalId]);
  return { ...hydrateVendorOrder(row), lines: lines.get(externalId) ?? [] };
}

/**
 * Purchase orders by number, reference, supplier, quote number or the job
 * they are for — every word somewhere — newest issued first. No words
 * lists the newest.
 */
export async function searchVendorOrders(query: string, options: { jobExternalId?: string; vendorExternalId?: string; limit?: number } = {}): Promise<VendorOrderRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (options.jobExternalId) { where.push('jobExternalId = ?'); args.push(options.jobExternalId); }
  if (options.vendorExternalId) { where.push('vendorExternalId = ?'); args.push(options.vendorExternalId); }
  for (const word of searchWords(query)) {
    const like = `%${word}%`;
    where.push('(externalId LIKE ? OR reference LIKE ? OR vendorName LIKE ? OR quoteNo LIKE ? OR jobExternalId LIKE ?)');
    args.push(like, like, like, like, like);
  }
  args.push(options.limit ?? 50);
  const rows = await db.getAllAsync<VendorOrderRow>(
    `SELECT * FROM vendor_order ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY archived, COALESCE(dateIssued, '') DESC, externalId DESC LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateVendorOrder);
}

/** Every order raised against a job, with its lines, newest issued first. */
export async function listVendorOrdersForJob(jobExternalId: string, limit = 100): Promise<VendorOrderFull[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VendorOrderRow>(
    `SELECT * FROM vendor_order WHERE jobExternalId = ? ORDER BY COALESCE(dateIssued, '') DESC, externalId DESC LIMIT ?`,
    jobExternalId, limit,
  );
  const lines = await linesFor(rows.map((r) => r.externalId));
  return rows.map((r) => ({ ...hydrateVendorOrder(r), lines: lines.get(r.externalId) ?? [] }));
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface VendorRecord extends Omit<SimproVendor, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface VendorRow {
  externalId: string; name: string; phone: string | null; email: string | null; website: string | null;
  address: string | null; suburb: string | null; state: string | null; postcode: string | null; archived: number;
  dateModified: string | null; syncedAt: string;
}

function addressFrom(parts: { address: string | null; suburb: string | null; state: string | null; postcode: string | null }): SimproAddress | undefined {
  const out: SimproAddress = {
    address: parts.address ?? undefined,
    suburb: parts.suburb ?? undefined,
    state: parts.state ?? undefined,
    postcode: parts.postcode ?? undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

const hydrateVendor = (r: VendorRow): VendorRecord => ({
  id: r.externalId,
  name: r.name,
  phone: r.phone ?? undefined,
  email: r.email ?? undefined,
  website: r.website ?? undefined,
  address: addressFrom(r),
  archived: bool(r.archived),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertVendor(v: SimproVendor, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO vendor (externalId, name, phone, email, website, address, suburb, state, postcode, archived, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       name = excluded.name, phone = excluded.phone, email = excluded.email, website = excluded.website,
       address = excluded.address, suburb = excluded.suburb, state = excluded.state, postcode = excluded.postcode,
       archived = excluded.archived, dateModified = COALESCE(excluded.dateModified, vendor.dateModified),
       syncedAt = excluded.syncedAt`,
    v.id, v.name, orNull(v.phone), orNull(v.email), orNull(v.website), orNull(v.address?.address),
    orNull(v.address?.suburb), orNull(v.address?.state), orNull(v.address?.postcode), v.archived ? 1 : 0,
    orNull(v.DateModified), at,
  );
}

export async function pruneVendorsNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM vendor WHERE syncedAt <> ?', at);
  return r.changes;
}

export async function getVendor(externalId: string): Promise<VendorRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VendorRow>('SELECT * FROM vendor WHERE externalId = ?', externalId);
  return row ? hydrateVendor(row) : null;
}

/** Suppliers by name, email or phone, current ones first, the name that starts with the words ahead of one that contains them. */
export async function searchVendors(query: string, limit = 30): Promise<VendorRecord[]> {
  const db = await getDb();
  const term = query.trim();
  if (!term) {
    const rows = await db.getAllAsync<VendorRow>('SELECT * FROM vendor ORDER BY archived, name COLLATE NOCASE LIMIT ?', limit);
    return rows.map(hydrateVendor);
  }
  const like = `%${term}%`;
  const rows = await db.getAllAsync<VendorRow>(
    `SELECT * FROM vendor
     WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR externalId = ?
     ORDER BY archived, CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?`,
    like, like, like, term, `${term}%`, limit,
  );
  return rows.map(hydrateVendor);
}

// ---------------------------------------------------------------------------
// The office catalogue
// ---------------------------------------------------------------------------

export interface CatalogItemRecord extends Omit<SimproCatalogItem, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface CatalogItemRow {
  externalId: string; partNo: string | null; name: string; groupExternalId: string | null; groupName: string | null;
  parentGroupName: string | null; manufacturer: string | null; upc: string | null; sellExTaxCents: number | null;
  isInventory: number; isAsset: number; archived: number; dateModified: string | null; syncedAt: string;
}

const hydrateCatalogItem = (r: CatalogItemRow): CatalogItemRecord => ({
  id: r.externalId,
  partNo: r.partNo ?? undefined,
  name: r.name,
  groupId: r.groupExternalId ?? undefined,
  groupName: r.groupName ?? undefined,
  parentGroupName: r.parentGroupName ?? undefined,
  manufacturer: r.manufacturer ?? undefined,
  upc: r.upc ?? undefined,
  sellExTaxCents: r.sellExTaxCents ?? undefined,
  isInventory: bool(r.isInventory),
  isAsset: bool(r.isAsset),
  archived: bool(r.archived),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertCatalogItem(c: SimproCatalogItem, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO catalog_item (externalId, partNo, name, groupExternalId, groupName, parentGroupName, manufacturer, upc,
       sellExTaxCents, isInventory, isAsset, archived, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       partNo = excluded.partNo, name = excluded.name, groupExternalId = excluded.groupExternalId,
       groupName = excluded.groupName, parentGroupName = excluded.parentGroupName, manufacturer = excluded.manufacturer,
       upc = excluded.upc, sellExTaxCents = excluded.sellExTaxCents, isInventory = excluded.isInventory,
       isAsset = excluded.isAsset, archived = excluded.archived,
       dateModified = COALESCE(excluded.dateModified, catalog_item.dateModified), syncedAt = excluded.syncedAt`,
    c.id, orNull(c.partNo), c.name, orNull(c.groupId), orNull(c.groupName), orNull(c.parentGroupName),
    orNull(c.manufacturer), orNull(c.upc), orNull(c.sellExTaxCents), c.isInventory ? 1 : 0, c.isAsset ? 1 : 0,
    c.archived ? 1 : 0, orNull(c.DateModified), at,
  );
}

export async function pruneCatalogItemsNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM catalog_item WHERE syncedAt <> ?', at);
  return r.changes;
}

/**
 * Catalogue items by part number or name — every word somewhere — with an
 * exact part number first, then a part number that starts with the words,
 * then the rest by name. Current items ahead of archived. Optionally
 * within one group.
 */
export async function searchCatalogItems(query: string, options: { groupId?: string; limit?: number } = {}): Promise<CatalogItemRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (options.groupId) { where.push('groupExternalId = ?'); args.push(options.groupId); }
  const words = searchWords(query);
  for (const word of words) {
    const like = `%${word}%`;
    where.push('(partNo LIKE ? OR name LIKE ? OR manufacturer LIKE ? OR upc = ? OR externalId = ?)');
    args.push(like, like, like, word, word);
  }
  const term = query.trim();
  args.push(term, `${term}%`, options.limit ?? 50);
  const rows = await db.getAllAsync<CatalogItemRow>(
    `SELECT * FROM catalog_item ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY archived, CASE WHEN partNo = ? THEN 0 WHEN partNo LIKE ? THEN 1 ELSE 2 END, name COLLATE NOCASE LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateCatalogItem);
}

export async function getCatalogItem(externalId: string): Promise<CatalogItemRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CatalogItemRow>('SELECT * FROM catalog_item WHERE externalId = ?', externalId);
  return row ? hydrateCatalogItem(row) : null;
}

interface CatalogGroupRow { externalId: string; name: string; parentExternalId: string | null; parentName: string | null; syncedAt: string }

/** The groups, replaced whole: the list is read whole every time and carries no modification date. */
export async function replaceCatalogGroups(groups: readonly SimproCatalogGroup[], at: string = nowIso()): Promise<number> {
  const db = await getDb();
  let written = 0;
  await inTransaction(db, async () => {
    for (const g of groups) {
      if (!g.id) continue;
      await db.runAsync(
        `INSERT INTO catalog_group (externalId, name, parentExternalId, parentName, syncedAt) VALUES (?,?,?,?,?)
         ON CONFLICT(externalId) DO UPDATE SET
           name = excluded.name, parentExternalId = excluded.parentExternalId, parentName = excluded.parentName,
           syncedAt = excluded.syncedAt`,
        g.id, g.name, orNull(g.parentId), orNull(g.parentName), at,
      );
      written++;
    }
    await db.runAsync('DELETE FROM catalog_group WHERE syncedAt <> ?', at);
  });
  return written;
}

/** Every group, parents first then by name, so a picker can build the tree in one pass. */
export async function listCatalogGroups(): Promise<SimproCatalogGroup[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CatalogGroupRow>(
    'SELECT * FROM catalog_group ORDER BY CASE WHEN parentExternalId IS NULL THEN 0 ELSE 1 END, name COLLATE NOCASE',
  );
  return rows.map((r) => ({ id: r.externalId, name: r.name, parentId: r.parentExternalId ?? undefined, parentName: r.parentName ?? undefined }));
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactRecord extends Omit<SimproOfficeContact, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface ContactRow {
  externalId: string; title: string | null; givenName: string | null; familyName: string | null; name: string;
  email: string | null; workPhone: string | null; cellPhone: string | null; altPhone: string | null;
  department: string | null; position: string | null; notes: string | null; customersJson: string; sitesJson: string;
  dateModified: string | null; syncedAt: string;
}

const hydrateContact = (r: ContactRow): ContactRecord => ({
  id: r.externalId,
  title: r.title ?? undefined,
  givenName: r.givenName ?? undefined,
  familyName: r.familyName ?? undefined,
  name: r.name,
  email: r.email ?? undefined,
  workPhone: r.workPhone ?? undefined,
  cellPhone: r.cellPhone ?? undefined,
  altPhone: r.altPhone ?? undefined,
  department: r.department ?? undefined,
  position: r.position ?? undefined,
  notes: r.notes ?? undefined,
  customers: parseJson<SimproNamedRef[]>(r.customersJson, []),
  sites: parseJson<SimproNamedRef[]>(r.sitesJson, []),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertContact(c: SimproOfficeContact, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO contact (externalId, title, givenName, familyName, name, email, workPhone, cellPhone, altPhone, department,
       position, notes, customersJson, sitesJson, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       title = excluded.title, givenName = excluded.givenName, familyName = excluded.familyName, name = excluded.name,
       email = excluded.email, workPhone = excluded.workPhone, cellPhone = excluded.cellPhone, altPhone = excluded.altPhone,
       department = excluded.department, position = excluded.position, notes = excluded.notes,
       customersJson = excluded.customersJson, sitesJson = excluded.sitesJson,
       dateModified = COALESCE(excluded.dateModified, contact.dateModified), syncedAt = excluded.syncedAt`,
    c.id, orNull(c.title), orNull(c.givenName), orNull(c.familyName), c.name, orNull(c.email), orNull(c.workPhone),
    orNull(c.cellPhone), orNull(c.altPhone), orNull(c.department), orNull(c.position), orNull(c.notes),
    refJson(c.customers), refJson(c.sites), orNull(c.DateModified), at,
  );
}

export async function pruneContactsNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM contact WHERE syncedAt <> ?', at);
  return r.changes;
}

/**
 * Contacts by name, email, phone, position or department — every word
 * somewhere — optionally at one site or one customer. The site and
 * customer filters match the id inside the JSON list column as text, in
 * the exact shape upsertContact writes it (see refMarker), which is a
 * query the engine runs rather than a parse of every row on the phone.
 */
export async function searchContacts(query: string, options: { siteExternalId?: string; customerExternalId?: string; limit?: number } = {}): Promise<ContactRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (options.siteExternalId) { where.push('sitesJson LIKE ?'); args.push(refMarker(options.siteExternalId)); }
  if (options.customerExternalId) { where.push('customersJson LIKE ?'); args.push(refMarker(options.customerExternalId)); }
  for (const word of searchWords(query)) {
    const like = `%${word}%`;
    where.push('(name LIKE ? OR email LIKE ? OR workPhone LIKE ? OR cellPhone LIKE ? OR altPhone LIKE ? OR position LIKE ? OR department LIKE ? OR externalId = ?)');
    args.push(like, like, like, like, like, like, like, word);
  }
  const term = query.trim();
  args.push(`${term}%`, options.limit ?? 50);
  const rows = await db.getAllAsync<ContactRow>(
    `SELECT * FROM contact ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateContact);
}

export async function listContactsForSite(siteExternalId: string, limit = 100): Promise<ContactRecord[]> {
  return searchContacts('', { siteExternalId, limit });
}

export async function listContactsForCustomer(customerExternalId: string, limit = 100): Promise<ContactRecord[]> {
  return searchContacts('', { customerExternalId, limit });
}

export async function getContact(externalId: string): Promise<ContactRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ContactRow>('SELECT * FROM contact WHERE externalId = ?', externalId);
  return row ? hydrateContact(row) : null;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface LeadRecord extends Omit<SimproLead, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface LeadRow {
  externalId: string; name: string; customerExternalId: string | null; customerName: string | null;
  siteExternalId: string | null; siteName: string | null; stage: string | null; statusName: string | null;
  followUpDate: string | null; dateCreated: string | null; descriptionText: string | null; notesText: string | null;
  projectManager: string | null; salesperson: string | null; tagsJson: string | null; dateModified: string | null;
  syncedAt: string;
}

const hydrateLead = (r: LeadRow): LeadRecord => ({
  id: r.externalId,
  name: r.name,
  customerId: r.customerExternalId ?? undefined,
  customerName: r.customerName ?? undefined,
  siteId: r.siteExternalId ?? undefined,
  siteName: r.siteName ?? undefined,
  stage: r.stage ?? undefined,
  status: r.statusName ?? undefined,
  followUpDate: r.followUpDate ?? undefined,
  dateCreated: r.dateCreated ?? undefined,
  description: r.descriptionText ?? undefined,
  notes: r.notesText ?? undefined,
  projectManager: r.projectManager ?? undefined,
  salesperson: r.salesperson ?? undefined,
  tags: parseJson<string[]>(r.tagsJson, []),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertLead(l: SimproLead, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO lead (externalId, name, customerExternalId, customerName, siteExternalId, siteName, stage, statusName,
       followUpDate, dateCreated, descriptionText, notesText, projectManager, salesperson, tagsJson, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       name = excluded.name, customerExternalId = excluded.customerExternalId, customerName = excluded.customerName,
       siteExternalId = excluded.siteExternalId, siteName = excluded.siteName, stage = excluded.stage,
       statusName = excluded.statusName, followUpDate = excluded.followUpDate, dateCreated = excluded.dateCreated,
       descriptionText = excluded.descriptionText, notesText = excluded.notesText, projectManager = excluded.projectManager,
       salesperson = excluded.salesperson, tagsJson = excluded.tagsJson,
       dateModified = COALESCE(excluded.dateModified, lead.dateModified), syncedAt = excluded.syncedAt`,
    l.id, l.name, orNull(l.customerId), orNull(l.customerName), orNull(l.siteId), orNull(l.siteName), orNull(l.stage),
    orNull(l.status), orNull(l.followUpDate), orNull(l.dateCreated), orNull(l.description), orNull(l.notes),
    orNull(l.projectManager), orNull(l.salesperson), l.tags.length ? JSON.stringify(l.tags) : null,
    orNull(l.DateModified), at,
  );
}

export async function pruneLeadsNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM lead WHERE syncedAt <> ?', at);
  return r.changes;
}

/** Leads by stage and by words in the name, customer or site, newest created first. */
export async function listLeads(filter: { stage?: string; customerExternalId?: string; siteExternalId?: string; query?: string; limit?: number } = {}): Promise<LeadRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.stage) { where.push('stage = ? COLLATE NOCASE'); args.push(filter.stage); }
  if (filter.customerExternalId) { where.push('customerExternalId = ?'); args.push(filter.customerExternalId); }
  if (filter.siteExternalId) { where.push('siteExternalId = ?'); args.push(filter.siteExternalId); }
  for (const word of searchWords(filter.query)) {
    const like = `%${word}%`;
    where.push('(name LIKE ? OR customerName LIKE ? OR siteName LIKE ? OR externalId = ?)');
    args.push(like, like, like, word);
  }
  args.push(filter.limit ?? 100);
  const rows = await db.getAllAsync<LeadRow>(
    `SELECT * FROM lead ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(dateCreated, '') DESC, externalId DESC LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateLead);
}

export async function getLead(externalId: string): Promise<LeadRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LeadRow>('SELECT * FROM lead WHERE externalId = ?', externalId);
  return row ? hydrateLead(row) : null;
}

// ---------------------------------------------------------------------------
// The hours the office already holds
// ---------------------------------------------------------------------------

export interface SimproTimesheetRecord extends SimproTimesheetRow { syncedAt: string }

interface TimesheetRow {
  uid: string; employeeExternalId: string; scheduleType: string | null; reference: string | null;
  jobExternalId: string | null; jobCostCenterExternalId: string | null; activityExternalId: string | null;
  href: string | null; date: string; startTime: string | null; endTime: string | null; totalHours: number | null;
  scheduleRateId: string | null; scheduleRateName: string | null; syncedAt: string;
}

const hydrateTimesheet = (r: TimesheetRow): SimproTimesheetRecord => ({
  uid: r.uid,
  employeeId: r.employeeExternalId,
  scheduleType: r.scheduleType ?? undefined,
  reference: r.reference ?? undefined,
  jobId: r.jobExternalId ?? undefined,
  jobCostCenterId: r.jobCostCenterExternalId ?? undefined,
  activityId: r.activityExternalId ?? undefined,
  href: r.href ?? undefined,
  date: r.date,
  startTime: r.startTime ?? undefined,
  endTime: r.endTime ?? undefined,
  totalHours: r.totalHours ?? undefined,
  scheduleRateId: r.scheduleRateId ?? undefined,
  scheduleRateName: r.scheduleRateName ?? undefined,
  syncedAt: r.syncedAt,
});

/**
 * Replaces one employee's hours across a window of days with what the
 * office returned for it. The whole window, in one transaction: the
 * office's answer for the window is the truth of it, and a block the
 * office deleted has to leave the phone, which an upsert alone would
 * never do. Rows outside the window, and other employees' rows, are left
 * alone.
 */
export async function replaceSimproTimesheets(
  window: { employeeId: string; from: string; to: string },
  rows: readonly SimproTimesheetRow[],
  at: string = nowIso(),
): Promise<number> {
  const db = await getDb();
  let written = 0;
  await inTransaction(db, async () => {
    await db.runAsync(
      'DELETE FROM simpro_timesheet WHERE employeeExternalId = ? AND date >= ? AND date <= ?',
      window.employeeId, window.from, window.to,
    );
    for (const t of rows) {
      if (!t.uid || !t.date) continue;
      await db.runAsync(
        `INSERT INTO simpro_timesheet (uid, employeeExternalId, scheduleType, reference, jobExternalId, jobCostCenterExternalId,
           activityExternalId, href, date, startTime, endTime, totalHours, scheduleRateId, scheduleRateName, syncedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(uid) DO UPDATE SET
           employeeExternalId = excluded.employeeExternalId, scheduleType = excluded.scheduleType,
           reference = excluded.reference, jobExternalId = excluded.jobExternalId,
           jobCostCenterExternalId = excluded.jobCostCenterExternalId, activityExternalId = excluded.activityExternalId,
           href = excluded.href, date = excluded.date, startTime = excluded.startTime, endTime = excluded.endTime,
           totalHours = excluded.totalHours, scheduleRateId = excluded.scheduleRateId,
           scheduleRateName = excluded.scheduleRateName, syncedAt = excluded.syncedAt`,
        t.uid, t.employeeId || window.employeeId, orNull(t.scheduleType), orNull(t.reference), orNull(t.jobId),
        orNull(t.jobCostCenterId), orNull(t.activityId), orNull(t.href), t.date, orNull(t.startTime), orNull(t.endTime),
        orNull(t.totalHours), orNull(t.scheduleRateId), orNull(t.scheduleRateName), at,
      );
      written++;
    }
  });
  return written;
}

/** One employee's hours between two days inclusive, in day and start order. */
export async function listSimproTimesheets(filter: { employeeId: string; from: string; to: string; limit?: number }): Promise<SimproTimesheetRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimesheetRow>(
    `SELECT * FROM simpro_timesheet WHERE employeeExternalId = ? AND date >= ? AND date <= ?
     ORDER BY date, COALESCE(startTime, ''), uid LIMIT ?`,
    filter.employeeId, filter.from, filter.to, filter.limit ?? 2000,
  );
  return rows.map(hydrateTimesheet);
}

/** The office's hours against one job, whoever worked them. */
export async function listSimproTimesheetsForJob(jobExternalId: string, limit = 500): Promise<SimproTimesheetRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimesheetRow>(
    `SELECT * FROM simpro_timesheet WHERE jobExternalId = ? ORDER BY date, COALESCE(startTime, ''), uid LIMIT ?`,
    jobExternalId, limit,
  );
  return rows.map(hydrateTimesheet);
}

// ---------------------------------------------------------------------------
// Activities and leave
// ---------------------------------------------------------------------------

export interface ActivityScheduleRecord extends Omit<SimproActivitySchedule, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface ActivityScheduleRow {
  externalId: string; staffId: string | null; staffName: string | null; date: string; totalHours: number | null;
  notes: string | null; activityExternalId: string | null; activityName: string | null; blocksJson: string;
  isLocked: number; dateModified: string | null; syncedAt: string;
}

const hydrateActivitySchedule = (r: ActivityScheduleRow): ActivityScheduleRecord => ({
  id: r.externalId,
  staffId: r.staffId ?? undefined,
  staffName: r.staffName ?? undefined,
  date: r.date,
  totalHours: r.totalHours ?? undefined,
  notes: r.notes ?? undefined,
  activityId: r.activityExternalId ?? undefined,
  activityName: r.activityName ?? undefined,
  blocks: parseJson<SimproActivityBlock[]>(r.blocksJson, []),
  isLocked: bool(r.isLocked),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertActivitySchedule(a: SimproActivitySchedule, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO activity_schedule (externalId, staffId, staffName, date, totalHours, notes, activityExternalId, activityName,
       blocksJson, isLocked, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       staffId = excluded.staffId, staffName = excluded.staffName, date = excluded.date, totalHours = excluded.totalHours,
       notes = excluded.notes, activityExternalId = excluded.activityExternalId, activityName = excluded.activityName,
       blocksJson = excluded.blocksJson, isLocked = excluded.isLocked,
       dateModified = COALESCE(excluded.dateModified, activity_schedule.dateModified), syncedAt = excluded.syncedAt`,
    a.id, orNull(a.staffId), orNull(a.staffName), a.date, orNull(a.totalHours), orNull(a.notes), orNull(a.activityId),
    orNull(a.activityName), JSON.stringify(a.blocks), a.isLocked ? 1 : 0, orNull(a.DateModified), at,
  );
}

export async function pruneActivitySchedulesNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM activity_schedule WHERE syncedAt <> ?', at);
  return r.changes;
}

/** Activities between two days inclusive, everyone's or one person's, in day order. */
export async function listActivitySchedules(filter: { staffId?: string; from: string; to: string; limit?: number }): Promise<ActivityScheduleRecord[]> {
  const db = await getDb();
  const where = ['date >= ?', 'date <= ?'];
  const args: (string | number)[] = [filter.from, filter.to];
  if (filter.staffId) { where.push('staffId = ?'); args.push(filter.staffId); }
  args.push(filter.limit ?? 1000);
  const rows = await db.getAllAsync<ActivityScheduleRow>(
    `SELECT * FROM activity_schedule WHERE ${where.join(' AND ')} ORDER BY date, staffName COLLATE NOCASE, externalId LIMIT ?`,
    ...args,
  );
  return rows.map(hydrateActivitySchedule);
}

/** The activity list, replaced whole: the setup list carries no modification date and is a dozen rows. */
export async function replaceSetupActivities(activities: readonly SimproSetupActivity[], at: string = nowIso()): Promise<number> {
  const db = await getDb();
  let written = 0;
  await inTransaction(db, async () => {
    for (const a of activities) {
      if (!a.id) continue;
      await db.runAsync(
        `INSERT INTO setup_activity (externalId, name, syncedAt) VALUES (?,?,?)
         ON CONFLICT(externalId) DO UPDATE SET name = excluded.name, syncedAt = excluded.syncedAt`,
        a.id, a.name, at,
      );
      written++;
    }
    await db.runAsync('DELETE FROM setup_activity WHERE syncedAt <> ?', at);
  });
  return written;
}

export async function listSetupActivities(): Promise<SimproSetupActivity[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ externalId: string; name: string }>('SELECT externalId, name FROM setup_activity ORDER BY name COLLATE NOCASE');
  return rows.map((r) => ({ id: r.externalId, name: r.name }));
}

// ---------------------------------------------------------------------------
// Money that came in
// ---------------------------------------------------------------------------

export interface CustomerPaymentRecord extends Omit<SimproCustomerPayment, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface PaymentRow {
  externalId: string; paymentMethod: string | null; status: string | null; date: string | null; notes: string | null;
  totalCents: number | null; exported: number; dateModified: string | null; syncedAt: string;
}
interface PaymentInvoiceRow {
  paymentExternalId: string; invoiceExternalId: string; customerExternalId: string | null; customerName: string | null;
  amountCents: number | null;
}

const hydratePayment = (r: PaymentRow, invoices: PaymentInvoiceRow[]): CustomerPaymentRecord => ({
  id: r.externalId,
  paymentMethod: r.paymentMethod ?? undefined,
  status: r.status ?? undefined,
  date: r.date ?? undefined,
  notes: r.notes ?? undefined,
  totalCents: r.totalCents ?? undefined,
  exported: bool(r.exported),
  invoices: invoices.map((i): SimproPaymentInvoice => ({
    invoiceId: i.invoiceExternalId,
    customerId: i.customerExternalId ?? undefined,
    customerName: i.customerName ?? undefined,
    amountCents: i.amountCents ?? undefined,
  })),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

/** Writes a payment and the invoices it settles, the invoice links replaced whole with it. */
export async function upsertCustomerPayment(p: SimproCustomerPayment, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO customer_payment (externalId, paymentMethod, status, date, notes, totalCents, exported, dateModified, syncedAt)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(externalId) DO UPDATE SET
         paymentMethod = excluded.paymentMethod, status = excluded.status, date = excluded.date, notes = excluded.notes,
         totalCents = excluded.totalCents, exported = excluded.exported,
         dateModified = COALESCE(excluded.dateModified, customer_payment.dateModified), syncedAt = excluded.syncedAt`,
      p.id, orNull(p.paymentMethod), orNull(p.status), orNull(p.date), orNull(p.notes), orNull(p.totalCents),
      p.exported ? 1 : 0, orNull(p.DateModified), at,
    );
    await db.runAsync('DELETE FROM customer_payment_invoice WHERE paymentExternalId = ?', p.id);
    for (const i of p.invoices) {
      if (!i.invoiceId) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO customer_payment_invoice (paymentExternalId, invoiceExternalId, customerExternalId, customerName, amountCents)
         VALUES (?,?,?,?,?)`,
        p.id, i.invoiceId, orNull(i.customerId), orNull(i.customerName), orNull(i.amountCents),
      );
    }
  });
}

export async function pruneCustomerPaymentsNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  await db.runAsync('DELETE FROM customer_payment_invoice WHERE paymentExternalId IN (SELECT externalId FROM customer_payment WHERE syncedAt <> ?)', at);
  const r = await db.runAsync('DELETE FROM customer_payment WHERE syncedAt <> ?', at);
  return r.changes;
}

async function paymentsWhere(where: string, args: (string | number)[], limit: number): Promise<CustomerPaymentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PaymentRow>(
    `SELECT * FROM customer_payment WHERE ${where} ORDER BY COALESCE(date, '') DESC, externalId DESC LIMIT ?`,
    ...args, limit,
  );
  if (!rows.length) return [];
  const links = await db.getAllAsync<PaymentInvoiceRow>(
    `SELECT * FROM customer_payment_invoice WHERE paymentExternalId IN (${rows.map(() => '?').join(',')})`,
    ...rows.map((r) => r.externalId),
  );
  const byPayment = new Map<string, PaymentInvoiceRow[]>();
  for (const l of links) byPayment.set(l.paymentExternalId, [...(byPayment.get(l.paymentExternalId) ?? []), l]);
  return rows.map((r) => hydratePayment(r, byPayment.get(r.externalId) ?? []));
}

/** The payments applied to one invoice, newest first. */
export async function listPaymentsForInvoice(invoiceExternalId: string, limit = 100): Promise<CustomerPaymentRecord[]> {
  return paymentsWhere(
    'externalId IN (SELECT paymentExternalId FROM customer_payment_invoice WHERE invoiceExternalId = ?)',
    [invoiceExternalId], limit,
  );
}

/** What one customer has paid, newest first. */
export async function listPaymentsForCustomer(customerExternalId: string, limit = 100): Promise<CustomerPaymentRecord[]> {
  return paymentsWhere(
    'externalId IN (SELECT paymentExternalId FROM customer_payment_invoice WHERE customerExternalId = ?)',
    [customerExternalId], limit,
  );
}

export async function getCustomerPayment(externalId: string): Promise<CustomerPaymentRecord | null> {
  const [found] = await paymentsWhere('externalId = ?', [externalId], 1);
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export interface CreditNoteRecord extends Omit<SimproCreditNote, 'DateModified'> {
  dateModified?: string;
  syncedAt: string;
}

interface CreditNoteRow {
  externalId: string; creditType: string | null; invoiceExternalId: string | null; customerExternalId: string | null;
  customerName: string | null; stage: string | null; statusName: string | null; dateIssued: string | null;
  orderNo: string | null; descriptionText: string | null; notesText: string | null; totalExTaxCents: number | null;
  totalIncTaxCents: number | null; jobsJson: string; dateModified: string | null; syncedAt: string;
}

const hydrateCreditNote = (r: CreditNoteRow): CreditNoteRecord => ({
  id: r.externalId,
  creditType: r.creditType ?? undefined,
  invoiceId: r.invoiceExternalId ?? undefined,
  customerId: r.customerExternalId ?? undefined,
  customerName: r.customerName ?? undefined,
  stage: r.stage ?? undefined,
  status: r.statusName ?? undefined,
  dateIssued: r.dateIssued ?? undefined,
  orderNo: r.orderNo ?? undefined,
  description: r.descriptionText ?? undefined,
  notes: r.notesText ?? undefined,
  totalExTaxCents: r.totalExTaxCents ?? undefined,
  totalIncTaxCents: r.totalIncTaxCents ?? undefined,
  jobs: parseJson<{ id: string; siteName?: string }[]>(r.jobsJson, []),
  dateModified: r.dateModified ?? undefined,
  syncedAt: r.syncedAt,
});

export async function upsertCreditNote(n: SimproCreditNote, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO credit_note (externalId, creditType, invoiceExternalId, customerExternalId, customerName, stage, statusName,
       dateIssued, orderNo, descriptionText, notesText, totalExTaxCents, totalIncTaxCents, jobsJson, dateModified, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(externalId) DO UPDATE SET
       creditType = excluded.creditType, invoiceExternalId = excluded.invoiceExternalId,
       customerExternalId = excluded.customerExternalId, customerName = excluded.customerName, stage = excluded.stage,
       statusName = excluded.statusName, dateIssued = excluded.dateIssued, orderNo = excluded.orderNo,
       descriptionText = excluded.descriptionText, notesText = excluded.notesText,
       totalExTaxCents = excluded.totalExTaxCents, totalIncTaxCents = excluded.totalIncTaxCents, jobsJson = excluded.jobsJson,
       dateModified = COALESCE(excluded.dateModified, credit_note.dateModified), syncedAt = excluded.syncedAt`,
    n.id, orNull(n.creditType), orNull(n.invoiceId), orNull(n.customerId), orNull(n.customerName), orNull(n.stage),
    orNull(n.status), orNull(n.dateIssued), orNull(n.orderNo), orNull(n.description), orNull(n.notes),
    orNull(n.totalExTaxCents), orNull(n.totalIncTaxCents), JSON.stringify(n.jobs), orNull(n.DateModified), at,
  );
}

export async function pruneCreditNotesNotSyncedAt(at: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('DELETE FROM credit_note WHERE syncedAt <> ?', at);
  return r.changes;
}

async function creditNotesWhere(where: string, args: (string | number)[], limit: number): Promise<CreditNoteRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CreditNoteRow>(
    `SELECT * FROM credit_note WHERE ${where} ORDER BY COALESCE(dateIssued, '') DESC, externalId DESC LIMIT ?`,
    ...args, limit,
  );
  return rows.map(hydrateCreditNote);
}

export async function listCreditNotesForInvoice(invoiceExternalId: string, limit = 50): Promise<CreditNoteRecord[]> {
  return creditNotesWhere('invoiceExternalId = ?', [invoiceExternalId], limit);
}

export async function listCreditNotesForCustomer(customerExternalId: string, limit = 100): Promise<CreditNoteRecord[]> {
  return creditNotesWhere('customerExternalId = ?', [customerExternalId], limit);
}

export async function getCreditNote(externalId: string): Promise<CreditNoteRecord | null> {
  const [found] = await creditNotesWhere('externalId = ?', [externalId], 1);
  return found ?? null;
}
