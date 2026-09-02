import type { SimproClient } from './client';
import { collectionPath, recordPath } from './client';
import { htmlToText } from '@/domain/simproText';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * The rest of Simpro, typed: what a job actually holds, and the quotes,
 * invoices, customers and tasks around it.
 *
 * The app pulled a thin job row — a title, a stage, two dates — and nothing
 * else, so a technician opening a job saw a heading and a blank. This is the
 * read side of a faithful mirror: every list endpoint with the column set the
 * live build was verified to honour, every record endpoint the job screen
 * needs, and a pure mapper for each so the shapes can be tested against
 * fixtures rather than only against a signal.
 *
 * Two rules are enforced here and nowhere else, so they cannot be forgotten
 * by a caller:
 *
 * **Money that is not the sell price is never mapped.** A job and a quote
 * carry `Totals` — materials cost, labour cost, gross and nett margin — and a
 * catalog item carries `BasePrice` and `Markup`; a customer carries `Rates`,
 * `Banking` and `AmountOwing`. None of that belongs on a phone in a van. The
 * raw types below do not declare those fields, the mappers do not read them,
 * and the tests check the output for their names. Only `Total` (ExTax and
 * IncTax, the sell side) and an item's `SellPrice` and quantity come across.
 *
 * **A single record's path has no trailing slash.** See `recordPath` in the
 * client. Every path the mirror uses is built in `SIMPRO_PATHS` so the rule
 * is testable rather than remembered.
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
interface RawContactRef {
  ID?: number | string;
  Title?: string;
  GivenName?: string;
  FamilyName?: string;
  Email?: string;
  WorkPhone?: string;
  CellPhone?: string;
  Position?: string;
}
interface RawMoney { ExTax?: number | string; Tax?: number | string; IncTax?: number | string }
interface RawStatus { ID?: number | string; Name?: string; Color?: string }
interface RawAddress { Address?: string; City?: string; State?: string; PostalCode?: string; Country?: string }
interface RawContract {
  ID?: number | string;
  Name?: string;
  ContractNo?: string;
  StartDate?: string;
  EndDate?: string;
}
type RawTag = string | { ID?: number | string; Name?: string };

/** A job as `jobs/` lists it with the full column set. */
export interface RawJobRow {
  ID?: number | string;
  Name?: string;
  Description?: string;
  Customer?: RawCustomerRef | null;
  Site?: RawRef | null;
  SiteContact?: RawContactRef | null;
  Stage?: string;
  Status?: RawStatus | null;
  Type?: string;
  DateIssued?: string | null;
  DueDate?: string | null;
  OrderNo?: string;
  RequestNo?: string;
  Tags?: RawTag[];
  Total?: RawMoney | null;
  DateModified?: string;
  ProjectManager?: RawStaff | null;
  Technicians?: RawStaff[];
  CompletedDate?: string | null;
  ConvertedFromQuote?: number | string | { ID?: number | string } | null;
}

/** `jobs/{id}`. `Totals` is deliberately not declared: it is cost and margin. */
export interface RawJobDetail extends RawJobRow {
  Notes?: string;
  CustomerContract?: RawContract | null;
  CustomerContact?: RawContactRef | null;
  Technician?: RawStaff | null;
  Salesperson?: RawStaff | null;
  DueTime?: string | null;
  IsVariation?: boolean;
}

export interface RawSection { ID?: number | string; Name?: string; Description?: string; DisplayOrder?: number }

export interface RawCostCenter {
  ID?: number | string;
  CostCenter?: RawRef | null;
  Name?: string;
  DisplayOrder?: number;
  Total?: RawMoney | null;
  PercentComplete?: number;
}

/**
 * One line under a cost centre, whichever of the five families it is from.
 *
 * `BasePrice` and `Markup` are not declared and are never read: they are the
 * cost side of the line.
 */
export interface RawItem {
  ID?: number | string;
  Catalog?: { ID?: number | string; PartNo?: string; Name?: string } | null;
  Prebuild?: { ID?: number | string; PartNo?: string; Name?: string } | null;
  LaborRate?: RawRef | null;
  ServiceFee?: RawRef | null;
  Type?: string;
  Description?: string;
  BillableStatus?: string;
  Discount?: number;
  SellPrice?: { ExTax?: number | string; IncTax?: number | string } | null;
  Total?: { Qty?: number | string; Amount?: { ExTax?: number | string; IncTax?: number | string } | null } | null;
}

export interface RawNote {
  ID?: number | string;
  Subject?: string;
  Note?: string;
  Visibility?: { Customer?: boolean; Admin?: boolean };
  Reference?: { Type?: string; Number?: string; Text?: string };
  DateCreated?: string;
  CreatedBy?: RawStaff | string | null;
}

export interface RawAttachment {
  ID?: number | string;
  Filename?: string;
  Folder?: RawRef | null;
  Public?: boolean;
  Email?: boolean;
  MimeType?: string;
  FileSizeBytes?: number;
  DateAdded?: string;
  AddedBy?: RawStaff | null;
  Base64Data?: string;
}

export interface RawTimeline { Type?: string; Message?: string; Staff?: RawStaff | null; Date?: string }

export interface RawTask {
  ID?: number | string;
  Subject?: string;
  AssignedTo?: RawStaff | null;
  Assignees?: RawStaff[];
  CompletedBy?: RawStaff | null;
  DueDate?: string | null;
  PercentComplete?: number | string;
  CreatedDate?: string;
}

export interface RawInvoiceJob { ID?: number | string; Type?: string; Description?: string; Total?: RawMoney | null }

export interface RawInvoice {
  ID?: number | string;
  Type?: string;
  Customer?: RawCustomerRef | null;
  Jobs?: RawInvoiceJob[];
  DateIssued?: string;
  Period?: { StartDate?: string; EndDate?: string } | null;
  PaymentTerms?: { Days?: number; Type?: string; DueDate?: string } | null;
  Stage?: string;
  Status?: RawStatus | null;
  Description?: string;
  Notes?: string;
  OrderNo?: string;
  Total?: (RawMoney & { AmountApplied?: number | string; BalanceDue?: number | string }) | null;
  IsPaid?: boolean;
  DatePaid?: string;
  DateModified?: string;
}

/** A quote as `quotes/` lists it. `Totals` is not declared: cost and margin. */
export interface RawQuoteRow {
  ID?: number | string;
  Name?: string;
  Description?: string;
  Customer?: RawCustomerRef | null;
  Site?: RawRef | null;
  SiteContact?: RawContactRef | null;
  Stage?: string;
  CustomerStage?: string;
  Status?: RawStatus | null;
  Type?: string;
  DateIssued?: string | null;
  DateApproved?: string | null;
  DueDate?: string | null;
  ValidityDays?: number;
  OrderNo?: string;
  RequestNo?: string;
  IsClosed?: boolean;
  JobNo?: number | string | null;
  Total?: RawMoney | null;
  DateModified?: string;
  Technicians?: RawStaff[];
  Salesperson?: RawStaff | null;
  ProjectManager?: RawStaff | null;
  Tags?: RawTag[];
}

export interface RawQuoteDetail extends RawQuoteRow {
  Notes?: string;
  CustomerContract?: RawContract | null;
  CustomerContact?: RawContactRef | null;
  LinkedJobID?: number | string | null;
}

/**
 * A customer company. `Rates`, `Banking` and `AmountOwing` are not declared
 * and never read: commercial terms have no business on a phone.
 */
export interface RawCompany {
  ID?: number | string;
  Type?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Phone?: string;
  AltPhone?: string;
  Email?: string;
  Website?: string;
  Address?: RawAddress | null;
  BillingAddress?: RawAddress | null;
  CustomerType?: string;
  Tags?: RawTag[];
  Profile?: { Notes?: string; CustomerGroup?: RawRef | null } | null;
  Archived?: boolean;
  Sites?: RawRef[];
  Contacts?: RawContactRef[];
  DateModified?: string;
}

export interface RawSiteDetail {
  ID?: number | string;
  Name?: string;
  Address?: RawAddress | null;
  PrimaryContact?: RawContactRef | null;
  PublicNotes?: string;
  PrivateNotes?: string;
  Zone?: RawRef | string | null;
  Customers?: RawCustomerRef[];
  Archived?: boolean;
  DateModified?: string;
}

// ---------------------------------------------------------------------------
// What the app holds. Money in whole cents; dates as the build wrote them.
// ---------------------------------------------------------------------------

export interface SimproPerson { id: string; name: string }

export interface SimproContact {
  id?: string;
  name: string;
  email?: string;
  workPhone?: string;
  mobile?: string;
  position?: string;
}

export interface SimproAddress {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

export interface SimproContract { id: string; name?: string; contractNo?: string; startDate?: string; endDate?: string }

export interface SimproJob {
  /** The source's own modification timestamp, where it provides one. */
  DateModified?: string;
  id: string;
  title: string;
  /** Plain text; the office's HTML is stripped on the way in. */
  description?: string;
  customerId?: string;
  customerName?: string;
  customerType?: string;
  siteName?: string;
  siteId?: string;
  siteContact?: SimproContact;
  stage?: string;
  status?: string;
  statusColor?: string;
  issuedAt?: string;
  dueAt?: string;
  type?: string;
  orderNo?: string;
  requestNo?: string;
  tags: string[];
  technicians: SimproPerson[];
  projectManager?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  /** The office's completion date, yyyy-mm-dd. A day, not an instant. */
  completedDate?: string;
  convertedFromQuoteId?: string;
}

export interface SimproJobDetail extends SimproJob {
  notes?: string;
  customerContract?: SimproContract;
  customerContact?: SimproContact;
  technician?: SimproPerson;
  salesperson?: string;
  dueTime?: string;
  isVariation?: boolean;
}

export type SimproItemKind = 'catalog' | 'oneOff' | 'labor' | 'prebuild' | 'serviceFee';

export interface SimproItem {
  id: string;
  kind: SimproItemKind;
  description: string;
  partNo?: string;
  catalogId?: string;
  /** Units for a part, hours for labour. */
  qty: number;
  unitSellExTaxCents?: number;
  unitSellIncTaxCents?: number;
  /** The line: quantity by unit sell, after discount. */
  sellExTaxCents?: number;
  sellIncTaxCents?: number;
  billableStatus?: string;
  discountPercent?: number;
}

export interface SimproCostCenter {
  id: string;
  name: string;
  setupCostCenterId?: string;
  setupCostCenterName?: string;
  displayOrder: number;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  percentComplete?: number;
  items: SimproItem[];
}

export interface SimproSection {
  id: string;
  name: string;
  description?: string;
  displayOrder: number;
  costCenters: SimproCostCenter[];
}

export interface SimproNote {
  id: string;
  subject?: string;
  note?: string;
  createdAt?: string;
  createdBy?: string;
  visibleToCustomer?: boolean;
  referenceType?: string;
  referenceNumber?: string;
}

export interface SimproAttachment {
  id: string;
  filename: string;
  folder?: string;
  mimeType?: string;
  sizeBytes?: number;
  dateAdded?: string;
  addedBy?: string;
  public?: boolean;
  /** Only when asked for with `withData`. Never stored in the mirror tables. */
  base64Data?: string;
}

export interface SimproTimelineEntry {
  type?: string;
  message: string;
  staffId?: string;
  staffName?: string;
  at?: string;
}

export interface SimproTask {
  id: string;
  subject: string;
  assignedTo?: string;
  assignees: string[];
  completedBy?: string;
  dueDate?: string;
  percentComplete?: number;
  createdDate?: string;
}

export interface SimproInvoiceJob {
  id: string;
  type?: string;
  description?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
}

export interface SimproInvoice {
  DateModified?: string;
  id: string;
  type?: string;
  customerId?: string;
  customerName?: string;
  jobs: SimproInvoiceJob[];
  dateIssued?: string;
  stage?: string;
  status?: string;
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
}

export interface SimproQuote {
  DateModified?: string;
  id: string;
  name: string;
  description?: string;
  customerId?: string;
  customerName?: string;
  siteId?: string;
  siteName?: string;
  siteContact?: SimproContact;
  stage?: string;
  customerStage?: string;
  status?: string;
  statusColor?: string;
  type?: string;
  dateIssued?: string;
  dateApproved?: string;
  dueDate?: string;
  validityDays?: number;
  orderNo?: string;
  requestNo?: string;
  isClosed: boolean;
  /** The job it became, once converted. */
  jobId?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  technicians: SimproPerson[];
  salesperson?: string;
  projectManager?: string;
  tags: string[];
}

export interface SimproQuoteDetail extends SimproQuote {
  notes?: string;
  customerContract?: SimproContract;
  customerContact?: SimproContact;
}

export interface SimproCustomer {
  DateModified?: string;
  id: string;
  /** Simpro's `Type`: Company or Individual. */
  type: string;
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
}

export interface SimproSiteDetail {
  DateModified?: string;
  id: string;
  name: string;
  address?: SimproAddress;
  primaryContact?: SimproContact;
  publicNotes?: string;
  privateNotes?: string;
  zone?: string;
  customers: { id: string; name: string; type?: string }[];
  archived: boolean;
}

// ---------------------------------------------------------------------------
// Small readers shared by the mappers.
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

/**
 * Dollars to whole cents.
 *
 * The build sends sell figures as floats — 152.35, and on one line 27.290000000000003 —
 * so they are rounded here, once, and every total the phone shows is added
 * up in integers. A string is read too, because one endpoint quotes its
 * numbers and a mirror should not care.
 */
export function cents(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$\s]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const text = (v: unknown): string | undefined => {
  const plain = htmlToText(typeof v === 'string' ? v : undefined);
  return plain === '' ? undefined : plain;
};

function person(s: RawStaff | null | undefined): SimproPerson | undefined {
  const id = idOf(s?.ID);
  const name = str(s?.Name);
  if (!id && !name) return undefined;
  return { id: id ?? '', name: name ?? '' };
}

function people(list: RawStaff[] | undefined): SimproPerson[] {
  return (list ?? []).map(person).filter((p): p is SimproPerson => p !== undefined);
}

/** A company by its name; a person by given and family name. What a list row shows. */
export function customerDisplayName(c: RawCustomerRef | null | undefined): string | undefined {
  if (!c) return undefined;
  return str(c.CompanyName) ?? str([str(c.GivenName), str(c.FamilyName)].filter(Boolean).join(' '));
}

function contact(c: RawContactRef | null | undefined): SimproContact | undefined {
  if (!c) return undefined;
  const name = [str(c.GivenName), str(c.FamilyName)].filter(Boolean).join(' ');
  const out: SimproContact = {
    id: idOf(c.ID),
    name,
    email: str(c.Email),
    workPhone: str(c.WorkPhone),
    mobile: str(c.CellPhone),
    position: str(c.Position),
  };
  if (!name && !out.email && !out.workPhone && !out.mobile) return undefined;
  return out;
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

function contract(c: RawContract | null | undefined): SimproContract | undefined {
  const id = idOf(c?.ID);
  if (!id) return undefined;
  return {
    id,
    name: str(c?.Name),
    contractNo: str(c?.ContractNo),
    startDate: str(c?.StartDate),
    endDate: str(c?.EndDate),
  };
}

function tags(list: RawTag[] | undefined): string[] {
  return (list ?? [])
    .map((t) => (typeof t === 'string' ? str(t) : str(t?.Name) ?? idOf(t?.ID)))
    .filter((t): t is string => t !== undefined);
}

// ---------------------------------------------------------------------------
// Mappers. Pure, one per shape, exported for the tests.
// ---------------------------------------------------------------------------

export function mapJobRow(j: RawJobRow): SimproJob {
  return {
    DateModified: str(j.DateModified),
    id: idOf(j.ID) ?? '',
    title: str(j.Name) ?? text(j.Description)?.split('\n')[0] ?? `Job ${idOf(j.ID) ?? ''}`,
    description: text(j.Description),
    customerId: idOf(j.Customer?.ID),
    customerName: customerDisplayName(j.Customer),
    customerType: str(j.Customer?.Type),
    siteName: str(j.Site?.Name),
    siteId: idOf(j.Site?.ID),
    siteContact: contact(j.SiteContact),
    stage: str(j.Stage),
    status: str(j.Status?.Name),
    statusColor: str(j.Status?.Color),
    issuedAt: str(j.DateIssued),
    dueAt: str(j.DueDate),
    type: str(j.Type),
    orderNo: str(j.OrderNo),
    requestNo: str(j.RequestNo),
    tags: tags(j.Tags),
    technicians: people(j.Technicians),
    projectManager: str(j.ProjectManager?.Name),
    totalExTaxCents: cents(j.Total?.ExTax),
    totalIncTaxCents: cents(j.Total?.IncTax),
    completedDate: str(j.CompletedDate),
    convertedFromQuoteId: idOf(j.ConvertedFromQuote),
  };
}

export function mapJobDetail(j: RawJobDetail): SimproJobDetail {
  return {
    ...mapJobRow(j),
    notes: text(j.Notes),
    customerContract: contract(j.CustomerContract),
    customerContact: contact(j.CustomerContact),
    technician: person(j.Technician),
    salesperson: str(j.Salesperson?.Name),
    dueTime: str(j.DueTime),
    isVariation: j.IsVariation === true,
  };
}

export function mapSection(s: RawSection, costCenters: SimproCostCenter[] = []): SimproSection {
  return {
    id: idOf(s.ID) ?? '',
    name: str(s.Name) ?? '',
    description: text(s.Description),
    displayOrder: num(s.DisplayOrder) ?? 0,
    costCenters,
  };
}

export function mapCostCenter(c: RawCostCenter, items: SimproItem[] = []): SimproCostCenter {
  return {
    id: idOf(c.ID) ?? '',
    name: str(c.Name) ?? str(c.CostCenter?.Name) ?? '',
    setupCostCenterId: idOf(c.CostCenter?.ID),
    setupCostCenterName: str(c.CostCenter?.Name),
    displayOrder: num(c.DisplayOrder) ?? 0,
    totalExTaxCents: cents(c.Total?.ExTax),
    totalIncTaxCents: cents(c.Total?.IncTax),
    percentComplete: num(c.PercentComplete),
    items,
  };
}

/**
 * One line of any family. The five endpoints share a frame — an id, a sell
 * price, a quantity and an amount — and differ in where the name is: a
 * catalog item names its part, a one-off carries a description, a labour
 * line names its rate, a fee names the fee. Read in that order and never
 * from `BasePrice` or `Markup`, which are not declared on the raw type.
 */
export function mapItem(kind: SimproItemKind, r: RawItem): SimproItem {
  const description = str(r.Description)
    ?? str(r.Catalog?.Name)
    ?? str(r.Prebuild?.Name)
    ?? str(r.LaborRate?.Name)
    ?? str(r.ServiceFee?.Name)
    ?? str(r.Type)
    ?? '';
  return {
    id: idOf(r.ID) ?? '',
    kind,
    description,
    partNo: str(r.Catalog?.PartNo) ?? str(r.Prebuild?.PartNo),
    catalogId: idOf(r.Catalog?.ID) ?? idOf(r.Prebuild?.ID),
    qty: num(r.Total?.Qty) ?? 0,
    unitSellExTaxCents: cents(r.SellPrice?.ExTax),
    unitSellIncTaxCents: cents(r.SellPrice?.IncTax),
    sellExTaxCents: cents(r.Total?.Amount?.ExTax),
    sellIncTaxCents: cents(r.Total?.Amount?.IncTax),
    billableStatus: str(r.BillableStatus),
    discountPercent: num(r.Discount),
  };
}

export function mapNote(n: RawNote): SimproNote {
  const by = n.CreatedBy;
  return {
    id: idOf(n.ID) ?? '',
    subject: str(n.Subject),
    note: text(n.Note),
    createdAt: str(n.DateCreated),
    createdBy: typeof by === 'string' ? str(by) : str(by?.Name),
    visibleToCustomer: n.Visibility?.Customer === true ? true : n.Visibility?.Customer === false ? false : undefined,
    referenceType: str(n.Reference?.Type),
    referenceNumber: str(n.Reference?.Number),
  };
}

export function mapAttachment(a: RawAttachment): SimproAttachment {
  return {
    id: idOf(a.ID) ?? '',
    filename: str(a.Filename) ?? 'attachment',
    folder: str(a.Folder?.Name),
    mimeType: str(a.MimeType),
    sizeBytes: num(a.FileSizeBytes),
    dateAdded: str(a.DateAdded),
    addedBy: str(a.AddedBy?.Name),
    public: a.Public === true ? true : a.Public === false ? false : undefined,
    base64Data: str(a.Base64Data),
  };
}

export function mapTimeline(t: RawTimeline): SimproTimelineEntry {
  return {
    type: str(t.Type),
    message: text(t.Message) ?? '',
    staffId: idOf(t.Staff?.ID),
    staffName: str(t.Staff?.Name),
    at: str(t.Date),
  };
}

export function mapTask(t: RawTask): SimproTask {
  return {
    id: idOf(t.ID) ?? '',
    subject: str(t.Subject) ?? '',
    assignedTo: str(t.AssignedTo?.Name),
    assignees: people(t.Assignees).map((p) => p.name).filter(Boolean),
    completedBy: str(t.CompletedBy?.Name),
    dueDate: str(t.DueDate),
    percentComplete: num(t.PercentComplete),
    createdDate: str(t.CreatedDate),
  };
}

export function mapInvoice(i: RawInvoice): SimproInvoice {
  return {
    DateModified: str(i.DateModified),
    id: idOf(i.ID) ?? '',
    type: str(i.Type),
    customerId: idOf(i.Customer?.ID),
    customerName: customerDisplayName(i.Customer),
    jobs: (i.Jobs ?? [])
      .map((j) => ({
        id: idOf(j.ID) ?? '',
        type: str(j.Type),
        description: text(j.Description),
        totalExTaxCents: cents(j.Total?.ExTax),
        totalIncTaxCents: cents(j.Total?.IncTax),
      }))
      .filter((j) => j.id !== ''),
    dateIssued: str(i.DateIssued),
    stage: str(i.Stage),
    status: str(i.Status?.Name),
    isPaid: i.IsPaid === true,
    datePaid: str(i.DatePaid),
    dueDate: str(i.PaymentTerms?.DueDate),
    orderNo: str(i.OrderNo),
    description: text(i.Description),
    notes: text(i.Notes),
    periodStart: str(i.Period?.StartDate),
    periodEnd: str(i.Period?.EndDate),
    totalExTaxCents: cents(i.Total?.ExTax),
    totalIncTaxCents: cents(i.Total?.IncTax),
    amountAppliedCents: cents(i.Total?.AmountApplied),
    balanceDueCents: cents(i.Total?.BalanceDue),
  };
}

export function mapQuoteRow(q: RawQuoteRow): SimproQuote {
  return {
    DateModified: str(q.DateModified),
    id: idOf(q.ID) ?? '',
    name: str(q.Name) ?? text(q.Description)?.split('\n')[0] ?? `Quote ${idOf(q.ID) ?? ''}`,
    description: text(q.Description),
    customerId: idOf(q.Customer?.ID),
    customerName: customerDisplayName(q.Customer),
    siteId: idOf(q.Site?.ID),
    siteName: str(q.Site?.Name),
    siteContact: contact(q.SiteContact),
    stage: str(q.Stage),
    customerStage: str(q.CustomerStage),
    status: str(q.Status?.Name),
    statusColor: str(q.Status?.Color),
    type: str(q.Type),
    dateIssued: str(q.DateIssued),
    dateApproved: str(q.DateApproved),
    dueDate: str(q.DueDate),
    validityDays: num(q.ValidityDays),
    orderNo: str(q.OrderNo),
    requestNo: str(q.RequestNo),
    isClosed: q.IsClosed === true,
    jobId: idOf(q.JobNo),
    totalExTaxCents: cents(q.Total?.ExTax),
    totalIncTaxCents: cents(q.Total?.IncTax),
    technicians: people(q.Technicians),
    salesperson: str(q.Salesperson?.Name),
    projectManager: str(q.ProjectManager?.Name),
    tags: tags(q.Tags),
  };
}

export function mapQuoteDetail(q: RawQuoteDetail): SimproQuoteDetail {
  const row = mapQuoteRow(q);
  return {
    ...row,
    jobId: row.jobId ?? idOf(q.LinkedJobID),
    notes: text(q.Notes),
    customerContract: contract(q.CustomerContract),
    customerContact: contact(q.CustomerContact),
  };
}

/**
 * A customer, company or individual, from the list row or the detail. The
 * detail adds contacts, notes and the customer group; the list gives the
 * rest. `Rates`, `Banking` and `AmountOwing` are not on the raw type.
 */
export function mapCustomer(c: RawCompany): SimproCustomer {
  const name = customerDisplayName(c) ?? `Customer ${idOf(c.ID) ?? ''}`;
  return {
    DateModified: str(c.DateModified),
    id: idOf(c.ID) ?? '',
    type: str(c.Type) ?? (str(c.CompanyName) ? 'Company' : 'Individual'),
    name,
    givenName: str(c.GivenName),
    familyName: str(c.FamilyName),
    phone: str(c.Phone),
    altPhone: str(c.AltPhone),
    email: str(c.Email),
    website: str(c.Website),
    address: address(c.Address),
    billingAddress: address(c.BillingAddress),
    customerType: str(c.CustomerType),
    customerGroup: str(c.Profile?.CustomerGroup?.Name),
    archived: c.Archived === true,
    notes: text(c.Profile?.Notes),
    tags: tags(c.Tags),
    sites: (c.Sites ?? [])
      .map((s) => ({ id: idOf(s.ID) ?? '', name: str(s.Name) ?? '' }))
      .filter((s) => s.id !== ''),
    contacts: (c.Contacts ?? []).map(contact).filter((x): x is SimproContact => x !== undefined),
  };
}

export function mapSiteDetail(s: RawSiteDetail): SimproSiteDetail {
  const zone = s.Zone;
  return {
    DateModified: str(s.DateModified),
    id: idOf(s.ID) ?? '',
    name: str(s.Name) ?? 'Unnamed site',
    address: address(s.Address),
    primaryContact: contact(s.PrimaryContact),
    publicNotes: text(s.PublicNotes),
    privateNotes: text(s.PrivateNotes),
    zone: typeof zone === 'string' ? str(zone) : str(zone?.Name),
    customers: (s.Customers ?? [])
      .map((c) => ({ id: idOf(c.ID) ?? '', name: customerDisplayName(c) ?? '', type: str(c.Type) }))
      .filter((c) => c.id !== ''),
    archived: s.Archived === true,
  };
}

// ---------------------------------------------------------------------------
// Paths and column sets.
// ---------------------------------------------------------------------------

/** The five item families under a cost centre, as the build spells the route. */
export const ITEM_ROUTES: Record<SimproItemKind, string> = {
  catalog: 'catalogs',
  oneOff: 'oneOffs',
  labor: 'labor',
  prebuild: 'prebuilds',
  serviceFee: 'serviceFees',
};

export const ITEM_KINDS: SimproItemKind[] = ['catalog', 'oneOff', 'labor', 'prebuild', 'serviceFee'];

/** Every path the mirror reads, so the slash rule is written once and tested once. */
export const SIMPRO_PATHS = {
  jobs: () => collectionPath('jobs'),
  job: (id: string) => recordPath(`jobs/${id}`),
  jobSections: (id: string) => collectionPath(`jobs/${id}/sections`),
  jobCostCenters: (id: string, sectionId: string) => collectionPath(`jobs/${id}/sections/${sectionId}/costCenters`),
  jobCostCenter: (id: string, sectionId: string, ccId: string) =>
    recordPath(`jobs/${id}/sections/${sectionId}/costCenters/${ccId}`),
  jobItems: (id: string, sectionId: string, ccId: string, kind: SimproItemKind) =>
    collectionPath(`jobs/${id}/sections/${sectionId}/costCenters/${ccId}/${ITEM_ROUTES[kind]}`),
  jobNotes: (id: string) => collectionPath(`jobs/${id}/notes`),
  jobAttachments: (id: string) => collectionPath(`jobs/${id}/attachments/files`),
  jobAttachment: (id: string, fileId: string) => recordPath(`jobs/${id}/attachments/files/${fileId}`),
  jobTimelines: (id: string) => collectionPath(`jobs/${id}/timelines`),
  jobTasks: (id: string) => collectionPath(`jobs/${id}/tasks`),
  jobInvoices: (id: string) => collectionPath(`jobs/${id}/invoices`),

  quotes: () => collectionPath('quotes'),
  quote: (id: string) => recordPath(`quotes/${id}`),
  quoteSections: (id: string) => collectionPath(`quotes/${id}/sections`),
  quoteCostCenters: (id: string, sectionId: string) => collectionPath(`quotes/${id}/sections/${sectionId}/costCenters`),
  quoteItems: (id: string, sectionId: string, ccId: string, kind: SimproItemKind) =>
    collectionPath(`quotes/${id}/sections/${sectionId}/costCenters/${ccId}/${ITEM_ROUTES[kind]}`),
  quoteNotes: (id: string) => collectionPath(`quotes/${id}/notes`),
  quoteAttachments: (id: string) => collectionPath(`quotes/${id}/attachments/files`),
  quoteAttachment: (id: string, fileId: string) => recordPath(`quotes/${id}/attachments/files/${fileId}`),

  invoices: () => collectionPath('invoices'),
  invoice: (id: string) => recordPath(`invoices/${id}`),

  companies: () => collectionPath('customers/companies'),
  company: (id: string) => recordPath(`customers/companies/${id}`),
  individuals: () => collectionPath('customers/individuals'),
  individual: (id: string) => recordPath(`customers/individuals/${id}`),

  sites: () => collectionPath('sites'),
  site: (id: string) => recordPath(`sites/${id}`),

  customerAssets: () => collectionPath('customerAssets'),
  customerAsset: (id: string) => recordPath(`customerAssets/${id}`),

  tasks: () => collectionPath('tasks'),
} as const;

export const JOB_LIST_COLUMNS =
  'ID,Name,Description,Customer,Site,SiteContact,Stage,Status,Type,DateIssued,DueDate,OrderNo,RequestNo,'
  + 'Tags,Total,DateModified,ProjectManager,Technicians,CompletedDate,ConvertedFromQuote';

export const QUOTE_LIST_COLUMNS =
  'ID,Name,Description,Customer,Site,SiteContact,Stage,CustomerStage,Status,Type,DateIssued,DateApproved,'
  + 'DueDate,ValidityDays,OrderNo,RequestNo,IsClosed,JobNo,Total,DateModified,Technicians,Salesperson';

export const INVOICE_LIST_COLUMNS =
  'ID,Type,Customer,Jobs,DateIssued,Stage,Status,IsPaid,DatePaid,Total,DateModified,OrderNo';

export const COMPANY_LIST_COLUMNS = 'ID,CompanyName,Phone,Email,Address,CustomerType,Archived,DateModified,Sites';

/** Individuals are four rows on this build; the column set mirrors the companies' and is unverified. */
export const INDIVIDUAL_LIST_COLUMNS =
  'ID,GivenName,FamilyName,Phone,Email,Address,CustomerType,Archived,DateModified,Sites';

export const TASK_LIST_COLUMNS = 'ID,Subject,AssignedTo,Assignees,CompletedBy,DueDate,PercentComplete,CreatedDate';

/**
 * The attachment list gives ID and Filename; the rest lives on each file's
 * record. Asked for as columns first because one read per file is what a
 * job with forty photos turns into otherwise; the build has not been seen
 * to answer this, so a refusal falls back to the thin list.
 */
export const ATTACHMENT_LIST_COLUMNS = 'ID,Filename,Folder,Public,MimeType,FileSizeBytes,DateAdded,AddedBy';

/**
 * The first day of the invoice window: this many months before today, on
 * the Queensland calendar. Two years of invoices is what a customer
 * conversation on site reaches back to; the rest stays in the office.
 */
export function invoiceWindowStart(nowIso: string, months = 24): string {
  const today = qldIsoDay(nowIso);
  if (!today) throw new Error(`Cannot read the day out of "${nowIso}".`);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  // Clamped to the last day of the target month, so the 31st of a month
  // does not roll into the one after.
  const lastDay = new Date(Date.UTC(y, m - months, 0)).getUTCDate();
  const iso = new Date(Date.UTC(y, m - 1 - months, Math.min(d, lastDay))).toISOString();
  return iso.slice(0, 10);
}

/** Simpro's range and threshold filters for a date column. */
export function dateSinceFilter(day: string): string {
  return `gt(${day})`;
}

// ---------------------------------------------------------------------------
// The reads.
// ---------------------------------------------------------------------------

export interface PagedRead<T> {
  items: T[];
  truncated: boolean;
  /** Set when the build refused the column set and the thin list was read instead. The server's words. */
  columnsRejected?: string;
}

const statusOf = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
    ? (e as { status: number }).status
    : undefined;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SimproMirror {
  constructor(private readonly client: SimproClient) {}

  /**
   * A collection read with a column set, falling back to the thin list when
   * the build refuses the columns.
   *
   * A 422 "Invalid columns found" fails the whole read, and one column name
   * this build does not know — the individuals' set is unverified, the
   * attachment set is a guess — would otherwise cost the entire stage. The
   * thin rows still carry the IDs, so the mirror stays complete if sparse,
   * and the refusal is returned in the server's own words for the notes.
   */
  private async list<T>(
    path: string,
    columns: string | undefined,
    query: Record<string, string | number>,
    maxRecords: number,
  ): Promise<PagedRead<T>> {
    try {
      return await this.client.listAllPaged<T>(path, columns ? { columns, ...query } : query, maxRecords);
    } catch (e) {
      if (!columns || statusOf(e) !== 422) throw e;
      const thin = await this.client.listAllPaged<T>(path, query, maxRecords);
      return { ...thin, columnsRejected: messageOf(e) };
    }
  }

  private async record<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    const { data } = await this.client.request<T>('GET', path, query ? { query } : {});
    return data;
  }

  // ------------------------------------------------------------------- jobs

  /** Every job, newest change first, with the full verified column set. */
  async jobsPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<PagedRead<SimproJob>> {
    const read = await this.list<RawJobRow>(
      SIMPRO_PATHS.jobs(), JOB_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapJobRow) };
  }

  async jobDetail(id: string): Promise<SimproJobDetail> {
    return mapJobDetail(await this.record<RawJobDetail>(SIMPRO_PATHS.job(id)));
  }

  /**
   * A job's sections, each with its cost centres, each with its lines.
   *
   * One read per section, one per cost centre, five per cost centre for the
   * item families: a plain service job is a dozen requests, which is why the
   * sync does not do this for every job on the books. Empty families cost a
   * request each and are read anyway — the build returns [] rather than
   * refusing, and a job with labour lines and no parts is exactly the one a
   * technician wants to see.
   */
  async jobSections(id: string): Promise<SimproSection[]> {
    return this.sectionsUnder(
      SIMPRO_PATHS.jobSections(id),
      (sid) => SIMPRO_PATHS.jobCostCenters(id, sid),
      (sid, cc, kind) => SIMPRO_PATHS.jobItems(id, sid, cc, kind),
    );
  }

  async jobNotes(id: string): Promise<SimproNote[]> {
    return (await this.client.listAll<RawNote>(SIMPRO_PATHS.jobNotes(id), {}, 1000)).map(mapNote);
  }

  async jobAttachments(id: string): Promise<SimproAttachment[]> {
    const read = await this.list<RawAttachment>(SIMPRO_PATHS.jobAttachments(id), ATTACHMENT_LIST_COLUMNS, {}, 1000);
    return read.items.map(mapAttachment);
  }

  /**
   * One attachment's record; with `withData`, its bytes as Base64 too.
   *
   * `?display=Base64` is what Simpro documents for the bytes and it has not
   * been confirmed against this build, so the caller gets `base64Data`
   * undefined rather than an error where the build ignores the parameter.
   */
  async jobAttachment(id: string, fileId: string, options: { withData?: boolean } = {}): Promise<SimproAttachment> {
    const raw = await this.record<RawAttachment>(
      SIMPRO_PATHS.jobAttachment(id, fileId),
      options.withData ? { display: 'Base64' } : undefined,
    );
    return mapAttachment(raw);
  }

  async jobTimelines(id: string): Promise<SimproTimelineEntry[]> {
    return (await this.client.listAll<RawTimeline>(SIMPRO_PATHS.jobTimelines(id), {}, 2000)).map(mapTimeline);
  }

  async jobTasks(id: string): Promise<SimproTask[]> {
    const read = await this.list<RawTask>(SIMPRO_PATHS.jobTasks(id), TASK_LIST_COLUMNS, {}, 500);
    return read.items.map(mapTask);
  }

  async jobInvoices(id: string): Promise<SimproInvoice[]> {
    const read = await this.list<RawInvoice>(SIMPRO_PATHS.jobInvoices(id), INVOICE_LIST_COLUMNS, {}, 500);
    return read.items.map(mapInvoice);
  }

  // ----------------------------------------------------------------- quotes

  async quotesPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<PagedRead<SimproQuote>> {
    const read = await this.list<RawQuoteRow>(
      SIMPRO_PATHS.quotes(), QUOTE_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapQuoteRow) };
  }

  async quoteDetail(id: string): Promise<SimproQuoteDetail> {
    return mapQuoteDetail(await this.record<RawQuoteDetail>(SIMPRO_PATHS.quote(id)));
  }

  async quoteSections(id: string): Promise<SimproSection[]> {
    return this.sectionsUnder(
      SIMPRO_PATHS.quoteSections(id),
      (sid) => SIMPRO_PATHS.quoteCostCenters(id, sid),
      (sid, cc, kind) => SIMPRO_PATHS.quoteItems(id, sid, cc, kind),
    );
  }

  async quoteNotes(id: string): Promise<SimproNote[]> {
    return (await this.client.listAll<RawNote>(SIMPRO_PATHS.quoteNotes(id), {}, 1000)).map(mapNote);
  }

  async quoteAttachments(id: string): Promise<SimproAttachment[]> {
    const read = await this.list<RawAttachment>(SIMPRO_PATHS.quoteAttachments(id), ATTACHMENT_LIST_COLUMNS, {}, 1000);
    return read.items.map(mapAttachment);
  }

  async quoteAttachment(id: string, fileId: string, options: { withData?: boolean } = {}): Promise<SimproAttachment> {
    const raw = await this.record<RawAttachment>(
      SIMPRO_PATHS.quoteAttachment(id, fileId),
      options.withData ? { display: 'Base64' } : undefined,
    );
    return mapAttachment(raw);
  }

  // --------------------------------------------------------------- invoices

  async invoicesPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<PagedRead<SimproInvoice>> {
    const read = await this.list<RawInvoice>(
      SIMPRO_PATHS.invoices(), INVOICE_LIST_COLUMNS, { orderby: '-DateModified', ...query }, maxRecords,
    );
    return { ...read, items: read.items.map(mapInvoice) };
  }

  async invoiceDetail(id: string): Promise<SimproInvoice> {
    return mapInvoice(await this.record<RawInvoice>(SIMPRO_PATHS.invoice(id)));
  }

  // -------------------------------------------------------------- customers

  async companiesPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<PagedRead<SimproCustomer>> {
    const read = await this.list<RawCompany>(SIMPRO_PATHS.companies(), COMPANY_LIST_COLUMNS, query, maxRecords);
    return { ...read, items: read.items.map((c) => mapCustomer({ Type: 'Company', ...c })) };
  }

  async individualsPaged(query: Record<string, string | number> = {}, maxRecords = 6000): Promise<PagedRead<SimproCustomer>> {
    const read = await this.list<RawCompany>(SIMPRO_PATHS.individuals(), INDIVIDUAL_LIST_COLUMNS, query, maxRecords);
    return { ...read, items: read.items.map((c) => mapCustomer({ Type: 'Individual', ...c })) };
  }

  /** The company record: contacts, the profile notes, its sites. Rates and banking are never read. */
  async companyDetail(id: string): Promise<SimproCustomer> {
    return mapCustomer({ Type: 'Company', ...(await this.record<RawCompany>(SIMPRO_PATHS.company(id))) });
  }

  async individualDetail(id: string): Promise<SimproCustomer> {
    return mapCustomer({ Type: 'Individual', ...(await this.record<RawCompany>(SIMPRO_PATHS.individual(id))) });
  }

  // ------------------------------------------------------------------ sites

  /** The site record, for the notes and the zone the list does not carry. */
  async siteDetail(id: string): Promise<SimproSiteDetail> {
    return mapSiteDetail(await this.record<RawSiteDetail>(SIMPRO_PATHS.site(id)));
  }

  // ------------------------------------------------------------------ tasks

  async tasks(maxRecords = 2000): Promise<PagedRead<SimproTask>> {
    const read = await this.list<RawTask>(SIMPRO_PATHS.tasks(), TASK_LIST_COLUMNS, {}, maxRecords);
    return { ...read, items: read.items.map(mapTask) };
  }

  // ---------------------------------------------------------------- shared

  private async sectionsUnder(
    sectionsPath: string,
    costCentersPath: (sectionId: string) => string,
    itemsPath: (sectionId: string, ccId: string, kind: SimproItemKind) => string,
  ): Promise<SimproSection[]> {
    const rawSections = await this.client.listAll<RawSection>(sectionsPath, {}, 200);
    const sections: SimproSection[] = [];
    for (const rs of rawSections) {
      const sid = idOf(rs.ID);
      if (!sid) continue;
      const rawCostCenters = await this.client.listAll<RawCostCenter>(costCentersPath(sid), {}, 200);
      const costCenters: SimproCostCenter[] = [];
      for (const rc of rawCostCenters) {
        const ccId = idOf(rc.ID);
        if (!ccId) continue;
        const items: SimproItem[] = [];
        for (const kind of ITEM_KINDS) {
          const rows = await this.client.listAll<RawItem>(itemsPath(sid, ccId, kind), {}, 1000);
          items.push(...rows.map((r) => mapItem(kind, r)));
        }
        costCenters.push(mapCostCenter(rc, items));
      }
      sections.push(mapSection(rs, costCenters));
    }
    return sections.sort((a, b) => a.displayOrder - b.displayOrder);
  }
}
