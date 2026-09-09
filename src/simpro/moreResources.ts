import type { SimproClient } from './client';
import { collectionPath, recordPath } from './client';
import type { PagedRead, SimproAddress } from './mirrorResources';
import { cents } from './mirrorResources';
import { htmlToText } from '@/domain/simproText';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * The rest of Simpro, typed: purchase orders and the suppliers they went
 * to, the office catalogue, contacts, leads, the hours the office holds
 * against each employee, the activities it schedules that are not jobs,
 * and the money that came in or went back.
 *
 * Built the way ./mirrorResources is built and for the same reason: a raw
 * shape declaring only what is read, a pure mapper per shape so it can be
 * tested against an invented fixture, and one column set per list, pinned
 * to what the live build answered 200 to. A `columns=` name the build does
 * not know fails the whole request, so a set is only ever changed after it
 * has been sent to the build again (see src/__tests__/simproColumns.test.ts).
 *
 * The money rule, again, because these are the shapes that carry the most
 * of it. A purchase order's `Totals`, a line's `Price` and an allocation's
 * `Total` are what the company pays a supplier; a catalogue item's
 * `TradePrice`, `BasePrice` and `Markup` are the cost side of a sale; a
 * timesheet row's `Cost`, `OverheadCost` and `TotalCost` are what an hour
 * costs the company; a vendor's `Banking` is its bank account. None of
 * those is declared on a raw type below, none is read, and the tests check
 * the mapped objects for their names. What does come across is the sell
 * side: a catalogue item's SellPrice, a payment's Amount, a credit note's
 * Total.
 *
 * Verified against safeqld.simprosuite.com, company 0, 9 September 2026:
 * every list here accepts `orderby=-DateModified` and
 * `DateModified=gt(yyyy-mm-dd)` and drops its Result-Total accordingly,
 * except `catalogGroups/` and `setup/activities/`, which carry no
 * DateModified and are read whole (they are 42 and 13 rows). The
 * timesheet list is different again: it takes no paging at all, returns
 * today by default, and takes its window as `StartDate` and `EndDate`
 * (`Date=between(...)`, `DateFrom`/`DateTo` and the rest are ignored
 * silently and return today).
 */

// ---------------------------------------------------------------------------
// Raw shapes, as the build returns them. Only what is read is declared.
// ---------------------------------------------------------------------------

interface RawRef { ID?: number | string; Name?: string }
interface RawStaff { ID?: number | string; Name?: string; Type?: string; TypeId?: number }
interface RawCustomerRef {
  ID?: number | string;
  Type?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
}
interface RawMoney { ExTax?: number | string; Tax?: number | string; IncTax?: number | string }
interface RawAddress { Address?: string; City?: string; State?: string; PostalCode?: string; Country?: string }
type RawTag = string | { ID?: number | string; Name?: string };

/** Where a purchase order, or one allocation of a line on it, is going: a job cost centre. */
export interface RawAssignedTo {
  /** The job cost centre's own id. */
  ID?: number | string;
  CostCenter?: RawRef | null;
  Name?: string;
  Job?: number | string | null;
  Section?: number | string | null;
}

/** A purchase order as `vendorOrders/` lists it. `Totals` and `Freight` are not declared: cost. */
export interface RawVendorOrderRow {
  ID?: number | string;
  Type?: string;
  Stage?: string;
  Status?: RawRef | null;
  Vendor?: RawRef | null;
  AssignedTo?: RawAssignedTo | null;
  DateIssued?: string | null;
  DueDate?: string | null;
  Reference?: string;
  QuoteNo?: string;
  VendorNotes?: string;
  PrivateNotes?: string;
  CreatedBy?: RawStaff | null;
  Archived?: boolean;
  DateModified?: string;
}

/**
 * One catalogue line on a purchase order, as `vendorOrders/{id}/catalogs/`
 * lists it with the Allocations column. A line has no id of its own on
 * this build: it is named by the catalogue item it orders. The quantity
 * lives on the allocations, one per job cost centre the line is for.
 * `Price` on the line and `Total` on an allocation are not declared: cost.
 */
export interface RawVendorOrderLine {
  Catalog?: { ID?: number | string; PartNo?: string; Name?: string } | null;
  DisplayOrder?: number;
  DueDate?: string | null;
  Notes?: string;
  Allocations?: RawAllocation[];
}

export interface RawAllocation {
  DueDate?: string | null;
  Notes?: string;
  AssignedTo?: RawAssignedTo | null;
  Quantity?: { Received?: number | string; Total?: number | string } | null;
}

/** A supplier. `Banking` is not declared and never read. */
export interface RawVendor {
  ID?: number | string;
  Name?: string;
  Phone?: string;
  Email?: string;
  Website?: string;
  Address?: RawAddress | null;
  Archived?: boolean;
  DateModified?: string;
}

/** An office catalogue item. `TradePrice`, `BasePrice` and `Markup` are not declared: cost. */
export interface RawCatalogRow {
  ID?: number | string;
  PartNo?: string;
  Name?: string;
  Group?: { ID?: number | string; Name?: string; ParentGroup?: RawRef | null } | null;
  Archived?: boolean;
  SellPrice?: number | string | null;
  DateModified?: string;
  Manufacturer?: string;
  UPC?: string;
  IsInventory?: boolean;
  IsAsset?: boolean;
}

export interface RawCatalogGroup {
  ID?: number | string;
  Name?: string;
  ParentGroup?: RawRef | null;
}

export interface RawContactRow {
  ID?: number | string;
  Title?: string;
  GivenName?: string;
  FamilyName?: string;
  Email?: string;
  WorkPhone?: string;
  CellPhone?: string;
  AltPhone?: string;
  Department?: string;
  Position?: string;
  Notes?: string;
  DateModified?: string;
  Customers?: RawCustomerRef[];
  Sites?: RawRef[];
}

/** Simpro sends `{}` for a status or a salesperson a lead does not have, so the refs are all optional. */
export interface RawLead {
  ID?: number | string;
  LeadName?: string;
  Customer?: RawCustomerRef | null;
  Site?: RawRef | null;
  Stage?: string;
  Status?: RawRef | null;
  FollowUpDate?: string | null;
  DateCreated?: string;
  Description?: string;
  Notes?: string;
  ProjectManager?: RawStaff | null;
  Salesperson?: RawStaff | null;
  Tags?: RawTag[];
  DateModified?: string;
}

/**
 * One block of an employee's timesheet as `timesheets/` returns it.
 * `Cost`, `OverheadCost` and `TotalCost` are not declared: cost.
 */
export interface RawTimesheetRow {
  UID?: string | number;
  ScheduleType?: string;
  /** "job-costcentre" for a job block, the activity's id for an activity block. */
  Reference?: string | number;
  /** The schedule record's own path, which an update or a delete addresses. */
  _href?: string;
  Date?: string;
  StartTime?: string;
  EndTime?: string;
  TotalHrs?: number | string;
  ScheduleRate?: RawRef | null;
  EmployeeID?: number | string;
}

export interface RawActivityBlock {
  Hrs?: number | string;
  StartTime?: string;
  ISO8601StartTime?: string;
  EndTime?: string;
  ISO8601EndTime?: string;
  ScheduleRate?: RawRef | null;
}

export interface RawActivitySchedule {
  ID?: number | string;
  TotalHours?: number | string;
  Notes?: string;
  IsLocked?: boolean;
  Staff?: RawStaff | null;
  Date?: string;
  Blocks?: RawActivityBlock[];
  DateModified?: string;
  Activity?: RawRef | null;
}

export interface RawSetupActivity { ID?: number | string; Name?: string }

export interface RawCustomerPayment {
  ID?: number | string;
  Payment?: {
    PaymentMethod?: RawRef | null;
    Status?: string;
    Date?: string;
    CheckNo?: string;
    Details?: string;
  } | null;
  Notes?: string;
  Invoices?: {
    Invoice?: { ID?: number | string; Customer?: RawCustomerRef | null } | null;
    Amount?: number | string;
  }[];
  Exported?: boolean;
  DateModified?: string;
}

export interface RawCreditNote {
  ID?: number | string;
  Type?: string;
  Customer?: RawCustomerRef | null;
  InvoiceNo?: number | string | null;
  Jobs?: { ID?: number | string; Site?: RawRef | null }[];
  DateIssued?: string;
  Stage?: string;
  Status?: RawRef | null;
  OrderNo?: string;
  Description?: string;
  Notes?: string;
  Total?: RawMoney | null;
  DateModified?: string;
}

// ---------------------------------------------------------------------------
// What the app holds. Money in whole cents; days as the build wrote them.
// ---------------------------------------------------------------------------

export interface SimproVendorOrder {
  /** The source's own modification timestamp, which anchors the next incremental pull. */
  DateModified?: string;
  id: string;
  /** Simpro's Type: Catalogue, Service, and so on. */
  orderType?: string;
  stage?: string;
  statusId?: string;
  statusName?: string;
  vendorId?: string;
  vendorName?: string;
  jobId?: string;
  jobSectionId?: string;
  jobCostCenterId?: string;
  assignedToName?: string;
  reference?: string;
  quoteNo?: string;
  dateIssued?: string;
  dueDate?: string;
  /** Plain text; the office's HTML is stripped on the way in. */
  vendorNotes?: string;
  privateNotes?: string;
  createdByName?: string;
  archived: boolean;
}

export type SimproVendorOrderLineKind = 'catalog' | 'oneOff';

export interface SimproVendorOrderLine {
  kind: SimproVendorOrderLineKind;
  /** The catalogue item's id for a catalogue line, since the line has none of its own. */
  id: string;
  catalogId?: string;
  partNo?: string;
  description: string;
  qtyOrdered?: number;
  qtyReceived?: number;
  dueDate?: string;
}

export interface SimproVendor {
  DateModified?: string;
  id: string;
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: SimproAddress;
  archived: boolean;
}

export interface SimproCatalogItem {
  DateModified?: string;
  id: string;
  partNo?: string;
  name: string;
  groupId?: string;
  groupName?: string;
  parentGroupName?: string;
  manufacturer?: string;
  upc?: string;
  sellExTaxCents?: number;
  isInventory: boolean;
  isAsset: boolean;
  archived: boolean;
}

export interface SimproCatalogGroup {
  id: string;
  name: string;
  parentId?: string;
  parentName?: string;
}

export interface SimproNamedRef { id: string; name: string }

/** A person the office has a number for. Named so it does not shadow the site contact shape on a job. */
export interface SimproOfficeContact {
  DateModified?: string;
  id: string;
  title?: string;
  givenName?: string;
  familyName?: string;
  /** Given and family together, for the list and the search. */
  name: string;
  email?: string;
  workPhone?: string;
  cellPhone?: string;
  altPhone?: string;
  department?: string;
  position?: string;
  notes?: string;
  customers: SimproNamedRef[];
  sites: SimproNamedRef[];
}

export interface SimproLead {
  DateModified?: string;
  id: string;
  name: string;
  customerId?: string;
  customerName?: string;
  siteId?: string;
  siteName?: string;
  stage?: string;
  status?: string;
  followUpDate?: string;
  dateCreated?: string;
  description?: string;
  notes?: string;
  projectManager?: string;
  salesperson?: string;
  tags: string[];
}

export interface SimproTimesheetRow {
  uid: string;
  employeeId: string;
  /** Job or Activity. */
  scheduleType?: string;
  reference?: string;
  jobId?: string;
  jobCostCenterId?: string;
  activityId?: string;
  href?: string;
  /** yyyy-mm-dd, the office's day. */
  date: string;
  startTime?: string;
  endTime?: string;
  totalHours?: number;
  scheduleRateId?: string;
  scheduleRateName?: string;
}

export interface SimproActivityBlock {
  startTime?: string;
  endTime?: string;
  hours?: number;
  rateName?: string;
}

export interface SimproActivitySchedule {
  DateModified?: string;
  id: string;
  staffId?: string;
  staffName?: string;
  date: string;
  totalHours?: number;
  notes?: string;
  activityId?: string;
  activityName?: string;
  blocks: SimproActivityBlock[];
  isLocked: boolean;
}

export interface SimproSetupActivity { id: string; name: string }

export interface SimproPaymentInvoice {
  invoiceId: string;
  customerId?: string;
  customerName?: string;
  amountCents?: number;
}

export interface SimproCustomerPayment {
  DateModified?: string;
  id: string;
  paymentMethod?: string;
  status?: string;
  date?: string;
  notes?: string;
  /** The amounts applied to its invoices, added up: the build sends no total of its own. */
  totalCents?: number;
  exported: boolean;
  invoices: SimproPaymentInvoice[];
}

export interface SimproCreditNote {
  DateModified?: string;
  id: string;
  /** Simpro's Type: Void, Refund, and so on. */
  creditType?: string;
  invoiceId?: string;
  customerId?: string;
  customerName?: string;
  stage?: string;
  status?: string;
  dateIssued?: string;
  orderNo?: string;
  description?: string;
  notes?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  jobs: { id: string; siteName?: string }[];
}

// ---------------------------------------------------------------------------
// Small readers shared by the mappers. The same rules as mirrorResources',
// which keeps its own private; copied rather than exported so that module's
// surface stays what it is.
// ---------------------------------------------------------------------------

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

const idOf = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') return idOf((v as { ID?: unknown }).ID);
  return str(v);
};

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const text = (v: unknown): string | undefined => {
  const plain = htmlToText(typeof v === 'string' ? v : undefined);
  return plain === '' ? undefined : plain;
};

/**
 * An instant as the build writes it, made ISO: `2026-08-30 09:12:44+10`
 * becomes `2026-08-30T09:12:44+10:00`. Left alone when already ISO or a
 * bare day. The same rule as mirrorResources' instant(), for the same
 * reason: the phone's engine does not read the space-and-two-digit form.
 */
export function instant(v: unknown): string | undefined {
  const raw = str(v);
  if (!raw) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(raw);
  if (!m) return raw;
  const [, day, time, offset] = m as unknown as [string, string, string, string | undefined];
  const zone = !offset ? '' : offset === 'Z' ? 'Z'
    : offset.length === 3 ? `${offset}:00`
      : offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
  return `${day}T${time}${zone}`;
}

/** A company by its name; a person by given and family name. */
function customerName(c: RawCustomerRef | null | undefined): string | undefined {
  if (!c) return undefined;
  return str(c.CompanyName) ?? str([str(c.GivenName), str(c.FamilyName)].filter(Boolean).join(' '));
}

function address(a: RawAddress | null | undefined): SimproAddress | undefined {
  if (!a) return undefined;
  const out: SimproAddress = {
    address: str(a.Address),
    suburb: str(a.City),
    state: str(a.State),
    postcode: str(a.PostalCode),
    country: str(a.Country),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

function tags(list: RawTag[] | undefined): string[] {
  return (list ?? [])
    .map((t) => (typeof t === 'string' ? str(t) : str(t?.Name) ?? idOf(t?.ID)))
    .filter((t): t is string => t !== undefined);
}

function namedRefs(list: RawRef[] | undefined): SimproNamedRef[] {
  return (list ?? [])
    .map((r) => ({ id: idOf(r.ID) ?? '', name: str(r.Name) ?? '' }))
    .filter((r) => r.id !== '');
}

// ---------------------------------------------------------------------------
// Mappers. Pure, one per shape, exported for the tests.
// ---------------------------------------------------------------------------

export function mapVendorOrder(o: RawVendorOrderRow): SimproVendorOrder {
  return {
    DateModified: str(o.DateModified),
    id: idOf(o.ID) ?? '',
    orderType: str(o.Type),
    stage: str(o.Stage),
    statusId: idOf(o.Status?.ID),
    statusName: str(o.Status?.Name),
    vendorId: idOf(o.Vendor?.ID),
    vendorName: str(o.Vendor?.Name),
    jobId: idOf(o.AssignedTo?.Job),
    jobSectionId: idOf(o.AssignedTo?.Section),
    jobCostCenterId: idOf(o.AssignedTo?.ID),
    assignedToName: str(o.AssignedTo?.Name) ?? str(o.AssignedTo?.CostCenter?.Name),
    reference: str(o.Reference),
    quoteNo: str(o.QuoteNo),
    dateIssued: str(o.DateIssued),
    dueDate: str(o.DueDate),
    vendorNotes: text(o.VendorNotes),
    privateNotes: text(o.PrivateNotes),
    createdByName: str(o.CreatedBy?.Name),
    archived: o.Archived === true,
  };
}

/**
 * One catalogue line, its quantities added up across its allocations.
 *
 * A line ordered for two cost centres carries two allocations, each with
 * its own ordered and received count; the phone wants the line. A row that
 * came from the thin list (the build refused the column set) has no
 * allocations at all, and then the quantities are left undefined rather
 * than written as zero, which would read as "nothing ordered".
 */
export function mapVendorOrderLine(l: RawVendorOrderLine): SimproVendorOrderLine {
  const allocations = l.Allocations ?? [];
  let ordered: number | undefined;
  let received: number | undefined;
  for (const a of allocations) {
    const total = num(a.Quantity?.Total);
    const got = num(a.Quantity?.Received);
    if (total !== undefined) ordered = (ordered ?? 0) + total;
    if (got !== undefined) received = (received ?? 0) + got;
  }
  const catalogId = idOf(l.Catalog?.ID);
  return {
    kind: 'catalog',
    id: catalogId ?? '',
    catalogId,
    partNo: str(l.Catalog?.PartNo),
    description: str(l.Catalog?.Name) ?? text(l.Notes) ?? str(l.Catalog?.PartNo) ?? '',
    qtyOrdered: ordered,
    qtyReceived: received,
    dueDate: str(l.DueDate) ?? str(allocations.find((a) => str(a.DueDate))?.DueDate),
  };
}

/**
 * The lines of one order, folded so each catalogue item appears once.
 *
 * The line has no id of its own, so the catalogue item is the key, and an
 * order that lists the same part twice would otherwise write one row over
 * the other and lose a quantity. Folded here rather than in the repository
 * so the rule is testable without a database.
 */
export function mergeVendorOrderLines(lines: readonly SimproVendorOrderLine[]): SimproVendorOrderLine[] {
  const byKey = new Map<string, SimproVendorOrderLine>();
  for (const line of lines) {
    if (!line.id) continue;
    const key = `${line.kind}:${line.id}`;
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, { ...line });
      continue;
    }
    const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
    held.qtyOrdered = add(held.qtyOrdered, line.qtyOrdered);
    held.qtyReceived = add(held.qtyReceived, line.qtyReceived);
    held.dueDate = held.dueDate ?? line.dueDate;
  }
  return [...byKey.values()];
}

export function mapVendor(v: RawVendor): SimproVendor {
  return {
    DateModified: str(v.DateModified),
    id: idOf(v.ID) ?? '',
    name: str(v.Name) ?? `Supplier ${idOf(v.ID) ?? ''}`,
    phone: str(v.Phone),
    email: str(v.Email),
    website: str(v.Website),
    address: address(v.Address),
    archived: v.Archived === true,
  };
}

/**
 * A catalogue item. SellPrice on this build is a bare number, ex tax; it is
 * the one figure about money that comes across.
 */
export function mapCatalogItem(c: RawCatalogRow): SimproCatalogItem {
  return {
    DateModified: str(c.DateModified),
    id: idOf(c.ID) ?? '',
    partNo: str(c.PartNo),
    name: str(c.Name) ?? str(c.PartNo) ?? `Item ${idOf(c.ID) ?? ''}`,
    groupId: idOf(c.Group?.ID),
    groupName: str(c.Group?.Name),
    parentGroupName: str(c.Group?.ParentGroup?.Name),
    manufacturer: str(c.Manufacturer),
    upc: str(c.UPC),
    sellExTaxCents: cents(c.SellPrice),
    isInventory: c.IsInventory === true,
    isAsset: c.IsAsset === true,
    archived: c.Archived === true,
  };
}

export function mapCatalogGroup(g: RawCatalogGroup): SimproCatalogGroup {
  return {
    id: idOf(g.ID) ?? '',
    name: str(g.Name) ?? '',
    parentId: idOf(g.ParentGroup?.ID),
    parentName: str(g.ParentGroup?.Name),
  };
}

export function mapContact(c: RawContactRow): SimproOfficeContact {
  const givenName = str(c.GivenName);
  const familyName = str(c.FamilyName);
  return {
    DateModified: str(c.DateModified),
    id: idOf(c.ID) ?? '',
    title: str(c.Title),
    givenName,
    familyName,
    name: [givenName, familyName].filter(Boolean).join(' '),
    email: str(c.Email),
    workPhone: str(c.WorkPhone),
    cellPhone: str(c.CellPhone),
    altPhone: str(c.AltPhone),
    department: str(c.Department),
    position: str(c.Position),
    notes: text(c.Notes),
    customers: (c.Customers ?? [])
      .map((x) => ({ id: idOf(x.ID) ?? '', name: customerName(x) ?? '' }))
      .filter((x) => x.id !== ''),
    sites: namedRefs(c.Sites),
  };
}

export function mapLead(l: RawLead): SimproLead {
  return {
    DateModified: str(l.DateModified),
    id: idOf(l.ID) ?? '',
    name: str(l.LeadName) ?? text(l.Description)?.split('\n')[0] ?? `Lead ${idOf(l.ID) ?? ''}`,
    customerId: idOf(l.Customer?.ID),
    customerName: customerName(l.Customer),
    siteId: idOf(l.Site?.ID),
    siteName: str(l.Site?.Name),
    stage: str(l.Stage),
    status: str(l.Status?.Name),
    // The two dates a lead carries are the ones the build has been seen to
    // write in its space-and-short-offset form on other records; made ISO
    // here so the phone's engine can read them. A bare day passes through.
    followUpDate: instant(l.FollowUpDate),
    dateCreated: instant(l.DateCreated),
    description: text(l.Description),
    notes: text(l.Notes),
    projectManager: str(l.ProjectManager?.Name),
    salesperson: str(l.Salesperson?.Name),
    tags: tags(l.Tags),
  };
}

/**
 * The job, section and cost centre a timesheet row is against, out of its
 * own record path, which the build writes as
 * `/api/v1.0/companies/0/jobs/{job}/sections/{section}/costCenters/{cc}/schedules/{id}`.
 * Exported so the clock-on work can address the same schedule.
 */
export function parseScheduleHref(href: string | undefined): { jobId: string; sectionId: string; costCenterId: string; scheduleId: string } | undefined {
  if (!href) return undefined;
  const m = /\/jobs\/(\d+)\/sections\/(\d+)\/costCenters\/(\d+)\/schedules\/(\d+)\/?$/.exec(href);
  if (!m) return undefined;
  return { jobId: m[1]!, sectionId: m[2]!, costCenterId: m[3]!, scheduleId: m[4]! };
}

/**
 * A row of an employee's timesheet. A job row's Reference is
 * "job-costcentre" and its path names the same two ids; the path is
 * preferred because it is unambiguous and the reference is split as the
 * fallback. An activity row's Reference is the activity's id.
 */
export function mapTimesheetRow(t: RawTimesheetRow): SimproTimesheetRow {
  const scheduleType = str(t.ScheduleType);
  const reference = str(t.Reference);
  const fromHref = parseScheduleHref(str(t._href));
  const isActivity = scheduleType?.toLowerCase() === 'activity';
  let jobId = fromHref?.jobId;
  let jobCostCenterId = fromHref?.costCenterId;
  if (!isActivity && !jobId && reference) {
    const [job, cc] = reference.split('-');
    jobId = str(job);
    jobCostCenterId = str(cc);
  }
  return {
    uid: str(t.UID) ?? '',
    employeeId: idOf(t.EmployeeID) ?? '',
    scheduleType,
    reference,
    jobId: isActivity ? undefined : jobId,
    jobCostCenterId: isActivity ? undefined : jobCostCenterId,
    activityId: isActivity ? reference : undefined,
    href: str(t._href),
    date: str(t.Date) ?? '',
    startTime: str(t.StartTime),
    endTime: str(t.EndTime),
    totalHours: num(t.TotalHrs),
    scheduleRateId: idOf(t.ScheduleRate?.ID),
    scheduleRateName: str(t.ScheduleRate?.Name),
  };
}

export function mapActivitySchedule(a: RawActivitySchedule): SimproActivitySchedule {
  return {
    DateModified: str(a.DateModified),
    id: idOf(a.ID) ?? '',
    staffId: idOf(a.Staff?.ID),
    staffName: str(a.Staff?.Name),
    date: str(a.Date) ?? '',
    totalHours: num(a.TotalHours),
    notes: text(a.Notes),
    activityId: idOf(a.Activity?.ID),
    activityName: str(a.Activity?.Name),
    blocks: (a.Blocks ?? []).map((b) => ({
      startTime: str(b.StartTime),
      endTime: str(b.EndTime),
      hours: num(b.Hrs),
      rateName: str(b.ScheduleRate?.Name),
    })),
    isLocked: a.IsLocked === true,
  };
}

export function mapSetupActivity(a: RawSetupActivity): SimproSetupActivity {
  return { id: idOf(a.ID) ?? '', name: str(a.Name) ?? '' };
}

export function mapCustomerPayment(p: RawCustomerPayment): SimproCustomerPayment {
  const invoices = (p.Invoices ?? [])
    .map((i) => ({
      invoiceId: idOf(i.Invoice?.ID) ?? '',
      customerId: idOf(i.Invoice?.Customer?.ID),
      customerName: customerName(i.Invoice?.Customer),
      amountCents: cents(i.Amount),
    }))
    .filter((i) => i.invoiceId !== '');
  const amounts = invoices.map((i) => i.amountCents).filter((c): c is number => c !== undefined);
  return {
    DateModified: str(p.DateModified),
    id: idOf(p.ID) ?? '',
    paymentMethod: str(p.Payment?.PaymentMethod?.Name),
    status: str(p.Payment?.Status),
    date: str(p.Payment?.Date),
    notes: text(p.Notes),
    totalCents: amounts.length ? amounts.reduce((a, b) => a + b, 0) : undefined,
    exported: p.Exported === true,
    invoices,
  };
}

export function mapCreditNote(n: RawCreditNote): SimproCreditNote {
  return {
    DateModified: str(n.DateModified),
    id: idOf(n.ID) ?? '',
    creditType: str(n.Type),
    invoiceId: idOf(n.InvoiceNo),
    customerId: idOf(n.Customer?.ID),
    customerName: customerName(n.Customer),
    stage: str(n.Stage),
    status: str(n.Status?.Name),
    dateIssued: str(n.DateIssued),
    orderNo: str(n.OrderNo),
    description: text(n.Description),
    notes: text(n.Notes),
    totalExTaxCents: cents(n.Total?.ExTax),
    totalIncTaxCents: cents(n.Total?.IncTax),
    jobs: (n.Jobs ?? [])
      .map((j) => ({ id: idOf(j.ID) ?? '', siteName: str(j.Site?.Name) }))
      .filter((j) => j.id !== ''),
  };
}

// ---------------------------------------------------------------------------
// Paths and column sets.
// ---------------------------------------------------------------------------

/** Every path this module reads, so the slash rule is written once and tested once. */
export const MORE_PATHS = {
  vendorOrders: () => collectionPath('vendorOrders'),
  vendorOrder: (id: string) => recordPath(`vendorOrders/${id}`),
  /** The only line family a purchase order has on this build; `oneOffs/` under an order answers 404. */
  vendorOrderCatalogs: (id: string) => collectionPath(`vendorOrders/${id}/catalogs`),
  vendors: () => collectionPath('vendors'),
  vendor: (id: string) => recordPath(`vendors/${id}`),
  catalogs: () => collectionPath('catalogs'),
  catalog: (id: string) => recordPath(`catalogs/${id}`),
  catalogGroups: () => collectionPath('catalogGroups'),
  contacts: () => collectionPath('contacts'),
  contact: (id: string) => recordPath(`contacts/${id}`),
  leads: () => collectionPath('leads'),
  lead: (id: string) => recordPath(`leads/${id}`),
  timesheets: () => collectionPath('timesheets'),
  activitySchedules: () => collectionPath('activitySchedules'),
  activitySchedule: (id: string) => recordPath(`activitySchedules/${id}`),
  setupActivities: () => collectionPath('setup/activities'),
  customerPayments: () => collectionPath('customerPayments'),
  customerPayment: (id: string) => recordPath(`customerPayments/${id}`),
  creditNotes: () => collectionPath('creditNotes'),
  creditNote: (id: string) => recordPath(`creditNotes/${id}`),
} as const;

/** `Job` is not a column on this list: the job is inside AssignedTo. */
export const VENDOR_ORDER_LIST_COLUMNS =
  'ID,Type,Stage,Status,Vendor,AssignedTo,DateIssued,DueDate,Reference,QuoteNo,VendorNotes,PrivateNotes,'
  + 'CreatedBy,Archived,DateModified';

/**
 * Allocations carries the ordered and received quantities, which the
 * default line list leaves out, and asking for the columns by name is also
 * how `Price` is left behind. A line has no ID column: asking for one is
 * refused.
 */
export const VENDOR_ORDER_LINE_COLUMNS = 'Catalog,DisplayOrder,DueDate,Notes,Allocations';

export const VENDOR_LIST_COLUMNS = 'ID,Name,Phone,Email,Website,Address,Archived,DateModified';

export const CATALOG_LIST_COLUMNS = 'ID,PartNo,Name,Group,Archived,SellPrice,DateModified,Manufacturer,UPC,IsInventory,IsAsset';

export const CATALOG_GROUP_LIST_COLUMNS = 'ID,Name,ParentGroup';

export const CONTACT_LIST_COLUMNS =
  'ID,Title,GivenName,FamilyName,Email,WorkPhone,CellPhone,AltPhone,Department,Position,Notes,DateModified,Customers,Sites';

export const LEAD_LIST_COLUMNS =
  'ID,LeadName,Customer,Site,Stage,Status,FollowUpDate,DateCreated,Description,Notes,ProjectManager,Salesperson,Tags,DateModified';

export const ACTIVITY_SCHEDULE_LIST_COLUMNS = 'ID,TotalHours,Notes,IsLocked,Staff,Date,Blocks,DateModified,Activity';

export const SETUP_ACTIVITY_LIST_COLUMNS = 'ID,Name';

export const CUSTOMER_PAYMENT_LIST_COLUMNS = 'ID,Payment,Notes,Invoices,Exported,DateModified';

export const CREDIT_NOTE_LIST_COLUMNS =
  'ID,Type,Customer,InvoiceNo,Jobs,DateIssued,Stage,Status,OrderNo,Description,Notes,Total,DateModified';

/**
 * The window of an employee's hours the phone holds: this many weeks back
 * and ahead of today on the Queensland calendar. Eight weeks back covers a
 * pay query about last month; two ahead covers leave already booked.
 */
export function timesheetWindow(nowIso: string, weeksBack = 8, weeksAhead = 2): { from: string; to: string } {
  const today = qldIsoDay(nowIso);
  if (!today) throw new Error(`Cannot read the day out of "${nowIso}".`);
  return { from: addDays(today, -weeksBack * 7), to: addDays(today, weeksAhead * 7) };
}

/** A calendar day moved by whole days. Day arithmetic only, so no offset is involved. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  const yy = moved.getUTCFullYear();
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(moved.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// The reads.
// ---------------------------------------------------------------------------

const statusOf = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
    ? (e as { status: number }).status
    : undefined;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Query = Record<string, string | number>;

export class SimproMore {
  constructor(private readonly client: SimproClient) {}

  /**
   * A collection read with a column set, falling back to the thin list when
   * the build refuses the columns. The same shape as SimproMirror's: the
   * refusal comes back in the server's words rather than as a failure, and
   * the caller decides whether a thin list is any use to it (the sync says
   * no, and records the stage as failed rather than blanking the mirror).
   */
  private async list<T>(path: string, columns: string | undefined, query: Query, maxRecords: number): Promise<PagedRead<T>> {
    try {
      return await this.client.listAllPaged<T>(path, columns ? { columns, ...query } : query, maxRecords);
    } catch (e) {
      if (!columns || statusOf(e) !== 422) throw e;
      const thin = await this.client.listAllPaged<T>(path, query, maxRecords);
      return { ...thin, columnsRejected: messageOf(e) };
    }
  }

  async vendorOrdersPaged(query: Query = {}, maxRecords = 3000): Promise<PagedRead<SimproVendorOrder>> {
    const read = await this.list<RawVendorOrderRow>(
      MORE_PATHS.vendorOrders(), VENDOR_ORDER_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapVendorOrder) };
  }

  /**
   * The lines on one order, quantities included. One request per order.
   * A refused column set leaves the thin list, which names the parts but
   * not how many: mapped with the quantities undefined, and the refusal
   * reported so the sync can say so.
   */
  async vendorOrderLines(id: string): Promise<PagedRead<SimproVendorOrderLine>> {
    const read = await this.list<RawVendorOrderLine>(MORE_PATHS.vendorOrderCatalogs(id), VENDOR_ORDER_LINE_COLUMNS, {}, 500);
    return { ...read, items: mergeVendorOrderLines(read.items.map(mapVendorOrderLine)) };
  }

  async vendorsPaged(query: Query = {}, maxRecords = 5000): Promise<PagedRead<SimproVendor>> {
    const read = await this.list<RawVendor>(MORE_PATHS.vendors(), VENDOR_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords);
    return { ...read, items: read.items.map(mapVendor) };
  }

  async catalogsPaged(query: Query = {}, maxRecords = 20000): Promise<PagedRead<SimproCatalogItem>> {
    const read = await this.list<RawCatalogRow>(MORE_PATHS.catalogs(), CATALOG_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords);
    return { ...read, items: read.items.map(mapCatalogItem) };
  }

  /** Read whole every time: the groups carry no DateModified and there are a few dozen. */
  async catalogGroups(): Promise<PagedRead<SimproCatalogGroup>> {
    const read = await this.list<RawCatalogGroup>(MORE_PATHS.catalogGroups(), CATALOG_GROUP_LIST_COLUMNS, {}, 2000);
    return { ...read, items: read.items.map(mapCatalogGroup) };
  }

  async contactsPaged(query: Query = {}, maxRecords = 10000): Promise<PagedRead<SimproOfficeContact>> {
    const read = await this.list<RawContactRow>(MORE_PATHS.contacts(), CONTACT_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords);
    return { ...read, items: read.items.map(mapContact) };
  }

  async leadsPaged(query: Query = {}, maxRecords = 2000): Promise<PagedRead<SimproLead>> {
    const read = await this.list<RawLead>(MORE_PATHS.leads(), LEAD_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords);
    return { ...read, items: read.items.map(mapLead) };
  }

  /**
   * One employee's hours in a window of days.
   *
   * A single request rather than a paged read, on purpose: `timesheets/`
   * on this build ignores page and pageSize and answers the whole window
   * every time, so a paged read would take the same rows again as page two
   * and keep taking them until the ceiling. The window is what bounds it —
   * ten weeks of one person is under a hundred rows — and a window a
   * caller is not sure of should be split rather than paged.
   */
  async timesheets(filter: { employeeId: string; from: string; to: string }): Promise<SimproTimesheetRow[]> {
    const { data } = await this.client.request<RawTimesheetRow[] | undefined>('GET', MORE_PATHS.timesheets(), {
      query: { EmployeeID: filter.employeeId, StartDate: filter.from, EndDate: filter.to },
    });
    return (Array.isArray(data) ? data : []).map(mapTimesheetRow).filter((r) => r.uid !== '');
  }

  /**
   * Every activity schedule, all staff: the list does not filter by staff
   * (`Staff=` is refused and `StaffID=` is ignored), so whose it is gets
   * decided on the phone.
   */
  async activitySchedulesPaged(query: Query = {}, maxRecords = 5000): Promise<PagedRead<SimproActivitySchedule>> {
    const read = await this.list<RawActivitySchedule>(
      MORE_PATHS.activitySchedules(), ACTIVITY_SCHEDULE_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapActivitySchedule) };
  }

  async setupActivities(): Promise<PagedRead<SimproSetupActivity>> {
    const read = await this.list<RawSetupActivity>(MORE_PATHS.setupActivities(), SETUP_ACTIVITY_LIST_COLUMNS, {}, 500);
    return { ...read, items: read.items.map(mapSetupActivity) };
  }

  async customerPaymentsPaged(query: Query = {}, maxRecords = 6000): Promise<PagedRead<SimproCustomerPayment>> {
    const read = await this.list<RawCustomerPayment>(
      MORE_PATHS.customerPayments(), CUSTOMER_PAYMENT_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapCustomerPayment) };
  }

  async creditNotesPaged(query: Query = {}, maxRecords = 2000): Promise<PagedRead<SimproCreditNote>> {
    const read = await this.list<RawCreditNote>(
      MORE_PATHS.creditNotes(), CREDIT_NOTE_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapCreditNote) };
  }
}
