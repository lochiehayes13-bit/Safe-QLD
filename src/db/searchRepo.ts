import { getDb } from './index';
import type { Site } from '@/domain/types';
import { jobStatusWord } from '@/domain/jobPresentation';
import {
  HIT_ROUTE, KIND_ORDER, describeHit, parseQuery, rankHits, type ParsedQuery, type SearchHit, type SearchKind,
} from '@/domain/search';

/**
 * One search over everything the office's mirror holds.
 *
 * Ten tables, one query each, every one with a WHERE and a LIMIT. The
 * catalogue is nine thousand rows and the jobs four and a half thousand,
 * and the point of a single box is that it answers as fast as any one of
 * the ten it replaces — so nothing here reads a table to filter it on the
 * phone, and a kind that cannot match what was typed is not asked at all:
 * an email is not looked for in the invoices.
 *
 * A typed number goes to the id columns first. Every kind's query puts the
 * row whose number is exactly what was typed ahead of the rows that merely
 * contain it, and `rankHits` then puts those exact rows ahead of every
 * other kind, so "44501" opens on job 44501 and not on the invoice whose
 * order number has 44501 in it.
 *
 * Nothing here reads a cost, a markup or a margin; the columns do not exist.
 */

type Arg = string | number;

/** A phone column with the spaces, dashes and brackets the office typed taken out, so bare digits match it. */
const bare = (col: string): string =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')`;

interface Clause { where: string; args: Arg[] }

/** Every word somewhere in the columns: one AND group per word, LIKE across the columns. */
function wordsClause(words: readonly string[], cols: readonly string[]): Clause {
  const parts: string[] = [];
  const args: Arg[] = [];
  for (const word of words) {
    parts.push(`(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) args.push(`%${word}%`);
  }
  return { where: parts.length ? parts.join(' AND ') : '1', args };
}

/** A number anywhere in the id columns, exact or contained. */
function numberClause(number: string, idCols: readonly string[]): Clause {
  const parts = idCols.flatMap((c) => [`${c} = ?`, `${c} LIKE ?`]);
  const args = idCols.flatMap((): Arg[] => [number, `%${number}%`]);
  return { where: `(${parts.join(' OR ')})`, args };
}

/** The exact id first, so the row somebody typed the number of leads its kind. */
function exactFirst(number: string, idCols: readonly string[]): Clause {
  return { where: `CASE WHEN ${idCols.map((c) => `${c} = ?`).join(' OR ')} THEN 0 ELSE 1 END`, args: idCols.map(() => number) };
}

/** The columns each kind is searched on: the ids a number goes to, the text words go to, the phones, the emails. */
interface KindColumns {
  table: string;
  ids: readonly string[];
  text: readonly string[];
  phones?: readonly string[];
  emails?: readonly string[];
  /**
   * Where a number also reaches this kind through a child table, as one
   * condition with one `?`. An invoice's jobs are rows of invoice_job, not
   * a column, and "1001" has to find the invoice that bills job 1001.
   */
  alsoByNumber?: string;
  order: string;
}

const COLUMNS: Record<SearchKind, KindColumns> = {
  job: {
    table: 'job', ids: ['externalId', 'orderNo'],
    text: ['externalId', 'siteName', 'customerName', 'title', 'orderNo', 'address'],
    // Open work first, as the job list itself orders it; then newest.
    order: `CASE WHEN status = 'complete' THEN 1 ELSE 0 END, COALESCE(dateModified, scheduledFor, '') DESC`,
  },
  site: {
    table: 'site', ids: ['externalId'],
    text: ['name', 'address', 'suburb', 'siteRef', 'clientName'],
    phones: ['contactWorkPhone', 'contactMobile'], emails: ['contactEmail'],
    order: 'name COLLATE NOCASE',
  },
  customer: {
    table: 'customer', ids: ['externalId'],
    text: ['name', 'email', 'phone'],
    phones: ['phone', 'altPhone'], emails: ['email'],
    order: 'archived, name COLLATE NOCASE',
  },
  contact: {
    table: 'contact', ids: ['externalId'],
    text: ['name', 'email', 'position', 'department', 'sitesJson', 'customersJson'],
    phones: ['workPhone', 'cellPhone', 'altPhone'], emails: ['email'],
    order: 'name COLLATE NOCASE',
  },
  quote: {
    table: 'simpro_quote', ids: ['externalId', 'orderNo', 'jobExternalId'],
    text: ['externalId', 'name', 'siteName', 'customerName', 'orderNo', 'requestNo'],
    order: `isClosed, COALESCE(dateIssued, '') DESC`,
  },
  invoice: {
    table: 'invoice', ids: ['externalId', 'orderNo'],
    text: ['externalId', 'customerName', 'orderNo', 'descriptionText'],
    alsoByNumber: 'externalId IN (SELECT invoiceExternalId FROM invoice_job WHERE jobExternalId = ?)',
    order: `isPaid, COALESCE(dateIssued, '') DESC`,
  },
  order: {
    table: 'vendor_order', ids: ['externalId', 'jobExternalId', 'quoteNo'],
    text: ['externalId', 'reference', 'vendorName', 'quoteNo', 'jobExternalId'],
    order: `archived, COALESCE(dateIssued, '') DESC`,
  },
  catalog: {
    table: 'catalog_item', ids: ['externalId', 'upc'],
    text: ['partNo', 'name', 'manufacturer', 'groupName'],
    order: 'archived, name COLLATE NOCASE',
  },
  lead: {
    table: 'lead', ids: ['externalId'],
    text: ['name', 'customerName', 'siteName'],
    order: `COALESCE(dateCreated, '') DESC`,
  },
  vendor: {
    table: 'vendor', ids: ['externalId'],
    text: ['name', 'email', 'phone'],
    phones: ['phone'], emails: ['email'],
    order: 'archived, name COLLATE NOCASE',
  },
};

/** The WHERE for one kind given the query, or nothing where the kind cannot hold what was typed. */
function clauseFor(kind: SearchKind, q: ParsedQuery): Clause | undefined {
  const cols = COLUMNS[kind];
  switch (q.kind) {
    case 'number': {
      const byNumber = numberClause(q.number!, [...cols.ids, ...cols.text.filter((c) => !cols.ids.includes(c))]);
      if (!cols.alsoByNumber) return byNumber;
      return { where: `(${byNumber.where} OR ${cols.alsoByNumber})`, args: [...byNumber.args, q.number!] };
    }
    case 'phone': {
      if (!cols.phones?.length) return undefined;
      // A full number is matched on its last eight digits, so what the
      // office typed with a country code, "+61 400 000 000", meets what
      // was typed here as "0400 000 000" and the other way about; the
      // trunk 0 and the 61 are the only two ways the front differs.
      // Anything shorter is a piece of a number and matches anywhere.
      const digits = q.digits!;
      const tail = digits.length >= 9 ? digits.slice(-8) : digits;
      return {
        where: `(${cols.phones.map((c) => `${bare(c)} LIKE ?`).join(' OR ')})`,
        args: cols.phones.map(() => `%${tail}%`),
      };
    }
    case 'email': {
      if (!cols.emails?.length) return undefined;
      return {
        where: `(${cols.emails.map((c) => `${c} LIKE ?`).join(' OR ')})`,
        args: cols.emails.map(() => `%${q.email}%`),
      };
    }
    case 'code': {
      // A part number is looked for in the catalogue's part number as well
      // as the text everything else carries; exact, then starts-with, then
      // anywhere — see the ORDER BY in searchKind.
      return wordsClause(q.words, cols.text);
    }
    case 'words':
      return wordsClause(q.words, cols.text);
  }
}

// ---------------------------------------------------------------------------
// One kind at a time
// ---------------------------------------------------------------------------

interface JobRow {
  id: string; externalId: string | null; siteName: string; customerName: string | null; title: string;
  status: string; stage: string | null; stageRaw: string | null; statusName: string | null;
  scheduledFor: string | null; dateModified: string | null;
}
interface SiteRow { id: string; name: string; address: string | null; suburb: string | null; clientName: string | null; siteRef: string | null; externalId: string | null; externalSource: string | null; updatedAt: string }
interface CustomerRow { externalId: string; name: string; customerKind: string; phone: string | null; email: string | null; archived: number; dateModified: string | null }
interface ContactRow { externalId: string; name: string; position: string | null; department: string | null; cellPhone: string | null; workPhone: string | null; sitesJson: string; customersJson: string; dateModified: string | null }
interface QuoteRow { externalId: string; name: string; siteName: string | null; customerName: string | null; statusName: string | null; stage: string | null; isClosed: number; dateIssued: string | null; dateModified: string | null; totalIncTaxCents: number | null }
interface InvoiceRow { externalId: string; customerName: string | null; isPaid: number; balanceDueCents: number | null; totalIncTaxCents: number | null; dateIssued: string | null }
interface OrderRow { externalId: string; vendorName: string | null; jobExternalId: string | null; stage: string | null; statusName: string | null; reference: string | null; dateIssued: string | null }
interface CatalogRow { externalId: string; partNo: string | null; name: string; groupName: string | null; manufacturer: string | null; sellExTaxCents: number | null; archived: number; dateModified: string | null }
interface LeadRow { externalId: string; name: string; customerName: string | null; siteName: string | null; stage: string | null; statusName: string | null; dateCreated: string | null }
interface VendorRow { externalId: string; name: string; phone: string | null; email: string | null; suburb: string | null; archived: number; dateModified: string | null }

function names(json: string): string[] {
  try {
    const refs = JSON.parse(json) as { name?: string }[];
    return Array.isArray(refs) ? refs.map((r) => r?.name?.trim() ?? '').filter(Boolean) : [];
  } catch {
    return [];
  }
}

const or = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Each kind's rows into hits. The rows are typed per kind above; the table is keyed so `searchKind` can stay one function. */
const HYDRATE: Record<SearchKind, (row: unknown) => SearchHit> = {
  job: (row) => {
    const r = row as JobRow;
    return {
      kind: 'job', id: r.id, number: or(r.externalId), title: r.externalId ? `Job ${r.externalId} · ${r.title || r.siteName}` : r.title || r.siteName,
      subtitle: describeHit({
        kind: 'job', siteName: r.siteName, customerName: or(r.customerName),
        state: jobStatusWord({ status: r.status, stage: or(r.stage), stageRaw: or(r.stageRaw), statusName: or(r.statusName) }).label,
        day: or(r.scheduledFor),
      }),
      route: HIT_ROUTE.job, params: { id: r.id }, when: or(r.dateModified) ?? or(r.scheduledFor),
    };
  },
  // A site's externalId is the office's number only where the sync
  // matched it to Simpro; an imported register carries numbers of its
  // own, and one of those must not read as exactly the site somebody
  // typed the Simpro number of.
  site: (row) => { const r = row as SiteRow; return ({
    kind: 'site', id: r.id, number: r.externalSource === 'simpro' ? or(r.externalId) : undefined, title: r.name,
    subtitle: describeHit({ kind: 'site', address: or(r.address), suburb: or(r.suburb), clientName: or(r.clientName), siteRef: or(r.siteRef) }),
    route: HIT_ROUTE.site, params: { id: r.id }, when: r.updatedAt,
  }); },
  customer: (row) => { const r = row as CustomerRow; return ({
    kind: 'customer', id: r.externalId, number: r.externalId, title: r.name,
    subtitle: describeHit({ kind: 'customer', customerKind: r.customerKind, phone: or(r.phone), email: or(r.email), archived: r.archived === 1 }),
    route: HIT_ROUTE.customer, params: { id: r.externalId }, when: or(r.dateModified),
  }); },
  contact: (row) => { const r = row as ContactRow; return ({
    kind: 'contact', id: r.externalId, number: r.externalId, title: r.name || 'Unnamed contact',
    subtitle: describeHit({
      kind: 'contact', position: or(r.position), department: or(r.department), mobile: or(r.cellPhone), workPhone: or(r.workPhone),
      siteNames: names(r.sitesJson), customerNames: names(r.customersJson),
    }),
    route: HIT_ROUTE.contact, params: { id: r.externalId }, when: or(r.dateModified),
  }); },
  quote: (row) => { const r = row as QuoteRow; return ({
    kind: 'quote', id: r.externalId, number: r.externalId, title: `Quote ${r.externalId} · ${r.name || r.siteName || ''}`.replace(/ · $/, ''),
    subtitle: describeHit({
      kind: 'quote', siteName: or(r.siteName), customerName: or(r.customerName),
      state: r.isClosed === 1 ? 'Closed' : or(r.statusName) ?? or(r.stage), day: or(r.dateIssued), totalIncTaxCents: or(r.totalIncTaxCents),
    }),
    route: HIT_ROUTE.quote, params: { id: r.externalId }, when: or(r.dateModified) ?? or(r.dateIssued),
  }); },
  invoice: (row) => { const r = row as InvoiceRow; return ({
    kind: 'invoice', id: r.externalId, number: r.externalId, title: `Invoice ${r.externalId}`,
    subtitle: describeHit({
      kind: 'invoice', customerName: or(r.customerName), isPaid: r.isPaid === 1,
      balanceDueCents: or(r.balanceDueCents), totalIncTaxCents: or(r.totalIncTaxCents), day: or(r.dateIssued),
    }),
    route: HIT_ROUTE.invoice, params: { id: r.externalId }, when: or(r.dateIssued),
  }); },
  order: (row) => { const r = row as OrderRow; return ({
    kind: 'order', id: r.externalId, number: r.externalId, title: `PO ${r.externalId}${r.vendorName ? ` · ${r.vendorName}` : ''}`,
    subtitle: describeHit({
      kind: 'order', vendorName: undefined, jobId: or(r.jobExternalId), stage: or(r.stage), statusName: or(r.statusName),
      reference: or(r.reference), day: or(r.dateIssued),
    }),
    route: HIT_ROUTE.order, params: { id: r.externalId }, when: or(r.dateIssued),
  }); },
  catalog: (row) => { const r = row as CatalogRow; return ({
    kind: 'catalog', id: r.externalId, number: r.externalId, code: or(r.partNo), title: r.name,
    subtitle: describeHit({
      kind: 'catalog', partNo: or(r.partNo), groupName: or(r.groupName), manufacturer: or(r.manufacturer),
      sellExTaxCents: or(r.sellExTaxCents), archived: r.archived === 1,
    }),
    // No record screen of its own: the catalogue opens with the part searched.
    route: HIT_ROUTE.catalog, params: { q: r.partNo || r.name }, when: or(r.dateModified),
  }); },
  lead: (row) => { const r = row as LeadRow; return ({
    kind: 'lead', id: r.externalId, number: r.externalId, title: r.name,
    subtitle: describeHit({ kind: 'lead', customerName: or(r.customerName), siteName: or(r.siteName), stage: or(r.stage), status: or(r.statusName), day: or(r.dateCreated) }),
    route: HIT_ROUTE.lead, params: { q: r.name }, when: or(r.dateCreated),
  }); },
  vendor: (row) => { const r = row as VendorRow; return ({
    kind: 'vendor', id: r.externalId, number: r.externalId, title: r.name,
    subtitle: describeHit({ kind: 'vendor', phone: or(r.phone), email: or(r.email), suburb: or(r.suburb), archived: r.archived === 1 }),
    route: HIT_ROUTE.vendor, params: { id: r.externalId }, when: or(r.dateModified),
  }); },
};

/** The columns each kind's SELECT reads — only what the hit needs, never the whole row. */
const SELECT: Record<SearchKind, string> = {
  job: 'id, externalId, siteName, customerName, title, status, stage, stageRaw, statusName, scheduledFor, dateModified',
  site: 'id, name, address, suburb, clientName, siteRef, externalId, externalSource, updatedAt',
  customer: 'externalId, name, customerKind, phone, email, archived, dateModified',
  contact: 'externalId, name, position, department, cellPhone, workPhone, sitesJson, customersJson, dateModified',
  quote: 'externalId, name, siteName, customerName, statusName, stage, isClosed, dateIssued, dateModified, totalIncTaxCents',
  invoice: 'externalId, customerName, isPaid, balanceDueCents, totalIncTaxCents, dateIssued',
  order: 'externalId, vendorName, jobExternalId, stage, statusName, reference, dateIssued',
  catalog: 'externalId, partNo, name, groupName, manufacturer, sellExTaxCents, archived, dateModified',
  lead: 'externalId, name, customerName, siteName, stage, statusName, dateCreated',
  vendor: 'externalId, name, phone, email, suburb, archived, dateModified',
};

/** One kind, one statement. */
export async function searchKind(kind: SearchKind, q: ParsedQuery, limit: number): Promise<SearchHit[]> {
  const clause = clauseFor(kind, q);
  if (!clause) return [];
  const cols = COLUMNS[kind];
  const db = await getDb();
  // The ORDER BY is built from the terms that apply: a bare "0" in an ORDER
  // BY is a column position to SQLite, not a constant, so an absent term is
  // left out rather than written as nothing.
  const order: string[] = [];
  const orderArgs: Arg[] = [];
  if (q.number && cols.ids.length) {
    const lead = exactFirst(q.number, cols.ids);
    order.push(lead.where);
    orderArgs.push(...lead.args);
  }
  // A part number typed exactly, or as the start of one, leads the catalogue
  // before the name order takes over.
  if (kind === 'catalog' && q.kind === 'code') {
    order.push('CASE WHEN partNo = ? THEN 0 WHEN partNo LIKE ? THEN 1 ELSE 2 END');
    orderArgs.push(q.text, `${q.text}%`);
  }
  order.push(cols.order);
  const rows = await db.getAllAsync<unknown>(
    `SELECT ${SELECT[kind]} FROM ${cols.table}
     WHERE ${clause.where}
     ORDER BY ${order.join(', ')} LIMIT ?`,
    ...clause.args, ...orderArgs, limit,
  );
  return rows.map((r) => HYDRATE[kind](r));
}

/**
 * Everything that matches, ranked.
 *
 * A prefixed number — "inv 62339" — asks one kind and no other: the person
 * said which record they meant, and an answer from another kind is a wrong
 * answer dressed as a helpful one. Anything else asks every kind that can
 * hold it, each capped at `limitPerKind`, and hands the lot to `rankHits`.
 * Under two characters returns nothing rather than every row that has an
 * "a" in it — unless the caller named the kinds, which is a request for
 * those kinds' most recent records and not a search for two characters:
 * "the open purchase orders" is a phrase whose words all belong to the
 * sentence and none to a name, and the answer to it is the orders.
 */
export async function searchEverything(
  query: string,
  options: { limitPerKind?: number; kinds?: readonly SearchKind[] } = {},
): Promise<SearchHit[]> {
  const q = parseQuery(query);
  if (q.text.length < 2 && !options.kinds?.length) return [];
  const limit = options.limitPerKind ?? 8;
  const kinds = q.hint ? [q.hint] : (options.kinds ?? KIND_ORDER);
  const perKind = await Promise.all(kinds.map((k) => searchKind(k, q, limit)));
  return rankHits(perKind.flat(), q);
}

/**
 * How many of the office's records the phone holds at all, so the search
 * screen can tell "nothing matched" from "nothing has come down yet".
 */
export async function searchableCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM job) + (SELECT COUNT(*) FROM site) + (SELECT COUNT(*) FROM customer)
          + (SELECT COUNT(*) FROM contact) + (SELECT COUNT(*) FROM invoice) + (SELECT COUNT(*) FROM vendor_order)
          + (SELECT COUNT(*) FROM catalog_item) AS n`,
  );
  return row?.n ?? 0;
}

/**
 * The phone's site for the office's site number.
 *
 * A contact, a lead and a purchase order carry the office's site id, not
 * the phone's, and the site screen opens by the phone's. Only a site the
 * sync matched to Simpro counts: an imported register can carry an
 * externalId of its own, and a number that means one thing in Simpro
 * and another in somebody's spreadsheet must not open the wrong building.
 */
export async function getSiteByExternalId(externalId: string): Promise<Site | null> {
  const id = externalId.trim();
  if (!id) return null;
  const db = await getDb();
  return (await db.getFirstAsync<Site>(
    "SELECT * FROM site WHERE externalId = ? AND externalSource = 'simpro' LIMIT 1", id,
  )) ?? null;
}
