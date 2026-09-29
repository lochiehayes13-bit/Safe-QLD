import { formatCents } from '@/domain/rates';
import { qldDay } from '@/domain/qldTime';

/**
 * Find anything: what a typed search means, and how its hits are read.
 *
 * The office's records are on the phone now — every job, invoice, purchase
 * order, quote, customer, site, contact, catalogue part, lead and supplier —
 * and each has its own list with its own search box. That is ten boxes, and
 * the thing a technician holds is one identifier: a job number off a
 * docket, an invoice number a customer reads out, a part number off a
 * label, a phone number that just rang. They do not always know which box
 * it belongs in, and they should not have to.
 *
 * So there is one box. This module is the pure half of it: reading what was
 * typed, ordering what came back, and writing the one line under each hit.
 * The database half is `src/db/searchRepo.ts`; nothing here touches a row.
 *
 * Two rules decide the order. An exact number match comes first whatever
 * kind it is, because a typed number is a typed number and "44501" is job
 * 44501 before it is the invoice whose order number contains it. After
 * that, kinds in the order a technician reaches for them — jobs, then the
 * place, the people, the paperwork, the parts — and within a kind the most
 * recent thing first.
 */

export type SearchKind =
  | 'job' | 'site' | 'customer' | 'contact' | 'quote' | 'invoice' | 'order' | 'catalog' | 'lead' | 'vendor';

/** The order the groups are shown in, and the tie-break between kinds. */
export const KIND_ORDER: readonly SearchKind[] = [
  'job', 'site', 'customer', 'contact', 'quote', 'invoice', 'order', 'catalog', 'lead', 'vendor',
];

export const KIND_LABEL: Record<SearchKind, { one: string; many: string; icon: string }> = {
  job: { one: 'Job', many: 'Jobs', icon: 'clipboard-list-outline' },
  site: { one: 'Site', many: 'Sites', icon: 'office-building-marker-outline' },
  customer: { one: 'Customer', many: 'Customers', icon: 'domain' },
  contact: { one: 'Contact', many: 'Contacts', icon: 'account-outline' },
  quote: { one: 'Quote', many: 'Quotes', icon: 'file-sign' },
  invoice: { one: 'Invoice', many: 'Invoices', icon: 'receipt-text-outline' },
  order: { one: 'Purchase order', many: 'Purchase orders', icon: 'cart-outline' },
  catalog: { one: 'Catalogue part', many: 'Catalogue parts', icon: 'package-variant-closed' },
  lead: { one: 'Lead', many: 'Leads', icon: 'lightbulb-outline' },
  vendor: { one: 'Supplier', many: 'Suppliers', icon: 'truck-outline' },
};

/**
 * Where each kind of hit opens.
 *
 * Held here as literals rather than assembled in the repository, because the
 * manifest in appMode proves its links by finding the route written out in
 * the file that navigates — and `app/search.tsx` navigates from these. A
 * catalogue part and a lead have no record screen of their own; they open
 * their list with the search already run.
 */
export const HIT_ROUTE: Record<SearchKind, string> = {
  job: '/work/job/[id]',
  site: '/site/[id]',
  customer: '/customer/[id]',
  contact: '/contacts/[id]',
  quote: '/quotes/simpro/[id]',
  invoice: '/invoices/[id]',
  order: '/orders/[id]',
  catalog: '/office-catalogue',
  lead: '/leads',
  vendor: '/vendors/[id]',
};

export interface SearchHit {
  kind: SearchKind;
  /** What the route opens with: the office's number for most, the phone's own id for a job or a site. */
  id: string;
  /** The office's number for it, where it has one, so a typed number can be matched exactly. */
  number?: string;
  /** A part number, so a typed one can be matched exactly the same way. */
  code?: string;
  title: string;
  /** One line, from `describeHit`. */
  subtitle: string;
  route: string;
  params: Record<string, string>;
  /** The newest date on the record — issued, changed, scheduled — for the tie-break. */
  when?: string;
}

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

export type QueryKind = 'number' | 'words' | 'code' | 'phone' | 'email';

export interface ParsedQuery {
  kind: QueryKind;
  /** What was typed, trimmed. */
  text: string;
  /** The digits of a number query, the # and any prefix word dropped. */
  number?: string;
  /** The kind a prefix named — "inv 62339" is an invoice and nothing else. */
  hint?: SearchKind;
  /** The words of a words query; the one token of a code query. */
  words: string[];
  /** The bare digits of a phone query, for matching what the office typed with spaces in it. */
  digits?: string;
  email?: string;
}

/**
 * What the words in front of a number mean.
 *
 * The short forms are how the numbers are said aloud in this trade: "inv
 * six-two-three-three-nine", "PO eight-oh-three-seven-five". "Order" is a
 * purchase order rather than a customer's order number, because a customer's
 * order number is something a technician looks up, not something they say.
 */
const PREFIX: Record<string, SearchKind> = {
  job: 'job', j: 'job',
  inv: 'invoice', invoice: 'invoice',
  po: 'order', order: 'order', 'purchase order': 'order',
  quote: 'quote', q: 'quote', quotation: 'quote',
  cust: 'customer', customer: 'customer', client: 'customer',
  contact: 'contact',
  lead: 'lead',
  site: 'site',
  supplier: 'vendor', vendor: 'vendor',
};

// A space or a hash has to sit between the prefix and the number: "PO
// 1234" is an order, "PO1234" is a part code, and "Q10" a part code too.
const PREFIXED = /^([a-z]+(?: [a-z]+)?)(?: +#? *|#)(\d+)$/i;
const NUMBER = /^#?(\d+)$/;
const PHONE_SHAPE = /^\+?[\d\s()-]+$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9\-./_]{1,}$/;

export function parseQuery(text: string): ParsedQuery {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { kind: 'words', text: '', words: [] };

  // An email has an @ and no spaces; nothing else typed here does.
  if (/^\S+@\S+\.\S+$/.test(trimmed)) {
    return { kind: 'email', text: trimmed, words: [trimmed], email: trimmed.toLowerCase() };
  }

  const prefixed = trimmed.match(PREFIXED);
  if (prefixed) {
    const hint = PREFIX[prefixed[1]!.toLowerCase()];
    if (hint) return { kind: 'number', text: trimmed, number: prefixed[2]!, hint, words: [prefixed[2]!] };
  }

  // A phone number: digits with spaces, brackets, dashes or a plus in them,
  // or a bare run of digits that starts with a zero and is as long as a
  // number is. The office's ids never start with zero, so "0400 000 000"
  // and "0400000000" are both a phone and "44501" is not. An Australian
  // number typed with its country code, "+61 400 000 000", is the one the
  // office typed as "0400 000 000", so the 61 becomes the 0 it stands for.
  if (PHONE_SHAPE.test(trimmed)) {
    const typed = trimmed.replace(/\D/g, '');
    const spaced = /[\s()+-]/.test(trimmed);
    if (typed.length >= 6 && (spaced || (typed.startsWith('0') && typed.length >= 8))) {
      const digits = typed.startsWith('61') && typed.length >= 11 ? `0${typed.slice(2)}` : typed;
      return { kind: 'phone', text: trimmed, words: [digits], digits };
    }
  }

  const number = trimmed.match(NUMBER);
  if (number) return { kind: 'number', text: trimmed, number: number[1]!, words: [number[1]!] };

  // A part number: one token with letters and digits in it, or with the
  // punctuation a part number carries. "DET-OPT-1", "FP1000", "SD-1". A bare
  // word is a word.
  if (!trimmed.includes(' ') && CODE.test(trimmed)) {
    const hasDigit = /\d/.test(trimmed);
    const hasLetter = /[A-Za-z]/.test(trimmed);
    if ((hasDigit && hasLetter) || /[-./_]/.test(trimmed)) {
      return { kind: 'code', text: trimmed, words: [trimmed] };
    }
  }

  const words = trimmed.split(' ').map((w) => w.replace(/^#/, '')).filter(Boolean);
  return { kind: 'words', text: trimmed, words };
}

// ---------------------------------------------------------------------------
// Ordering what came back
// ---------------------------------------------------------------------------

/** Whether a hit is the record whose number, or whose part number, was typed. */
export function isExact(hit: Pick<SearchHit, 'number' | 'code'>, query: ParsedQuery | undefined): boolean {
  if (!query) return false;
  if (query.number) return hit.number === query.number;
  if (query.kind === 'code') return !!hit.code && hit.code.toLowerCase() === query.text.toLowerCase();
  return false;
}

/**
 * Exact number matches first, then by kind, then newest first, then by name.
 *
 * A part-number search turns the kind order around so the catalogue leads:
 * somebody who typed "DET-OPT-1" wants the part, and a job whose order
 * number happens to contain it is the afterthought.
 */
export function rankHits<T extends SearchHit>(hits: readonly T[], query?: ParsedQuery): T[] {
  const order = query?.kind === 'code' ? ['catalog', ...KIND_ORDER.filter((k) => k !== 'catalog')] : KIND_ORDER;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...hits].sort((a, b) => {
    const exact = Number(isExact(b, query)) - Number(isExact(a, query));
    if (exact) return exact;
    const kind = (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99);
    if (kind) return kind;
    // Newest first; a record with no date at all goes after every dated one.
    const when = (b.when ?? '').localeCompare(a.when ?? '');
    if (when) return when;
    return a.title.localeCompare(b.title);
  });
}

export interface HitGroup {
  kind: SearchKind;
  label: string;
  icon: string;
  hits: SearchHit[];
}

/** Ranked hits by kind, in the order the first of each kind appeared. */
export function groupHits(ranked: readonly SearchHit[]): HitGroup[] {
  const groups: HitGroup[] = [];
  for (const hit of ranked) {
    const last = groups.find((g) => g.kind === hit.kind);
    if (last) last.hits.push(hit);
    else groups.push({ kind: hit.kind, label: KIND_LABEL[hit.kind].many, icon: KIND_LABEL[hit.kind].icon, hits: [hit] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The line under each hit
// ---------------------------------------------------------------------------

/** What a hit's one line is made from, per kind. Dates are as the record holds them; money is cents. */
export type HitFacts =
  | { kind: 'job'; siteName?: string; customerName?: string; state?: string; day?: string }
  | { kind: 'site'; address?: string; suburb?: string; clientName?: string; siteRef?: string }
  | { kind: 'customer'; customerKind?: string; phone?: string; email?: string; archived?: boolean }
  | { kind: 'contact'; position?: string; department?: string; mobile?: string; workPhone?: string; siteNames?: string[]; customerNames?: string[] }
  | { kind: 'quote'; siteName?: string; customerName?: string; state?: string; day?: string; totalIncTaxCents?: number }
  | { kind: 'invoice'; customerName?: string; isPaid: boolean; balanceDueCents?: number; totalIncTaxCents?: number; day?: string }
  | { kind: 'order'; vendorName?: string; jobId?: string; stage?: string; statusName?: string; reference?: string; day?: string }
  | { kind: 'catalog'; partNo?: string; groupName?: string; manufacturer?: string; sellExTaxCents?: number; archived?: boolean }
  | { kind: 'lead'; customerName?: string; siteName?: string; stage?: string; status?: string; day?: string }
  | { kind: 'vendor'; phone?: string; email?: string; suburb?: string; archived?: boolean };

const join = (parts: readonly (string | undefined)[]): string => parts.map((p) => p?.trim()).filter(Boolean).join(' · ');

/**
 * One line under a hit: enough to tell it from its neighbours, and nothing
 * that is not on the record. A job says where and for whom and where it
 * stands; an invoice says whether it is paid, because that is the question
 * that had somebody searching for it.
 */
export function describeHit(facts: HitFacts): string {
  switch (facts.kind) {
    case 'job':
      return join([facts.siteName, facts.customerName, facts.state, facts.day ? `Issued ${qldDay(facts.day) ?? facts.day}` : undefined]);
    case 'site':
      return join([[facts.address, facts.suburb].filter(Boolean).join(', ') || undefined, facts.clientName, facts.siteRef ? `Ref ${facts.siteRef}` : undefined]);
    case 'customer':
      return join([facts.customerKind, facts.phone, facts.email, facts.archived ? 'Archived' : undefined]);
    case 'contact': {
      const where = [...(facts.siteNames ?? []), ...(facts.customerNames ?? [])];
      const at = where.length ? (where.length > 2 ? `${where.slice(0, 2).join(', ')} and ${where.length - 2} more` : where.join(', ')) : undefined;
      return join([facts.position, facts.department, at, facts.mobile ?? facts.workPhone]);
    }
    case 'quote':
      return join([
        facts.siteName, facts.customerName, facts.state,
        facts.day ? `Issued ${qldDay(facts.day) ?? facts.day}` : undefined,
        facts.totalIncTaxCents !== undefined ? `${formatCents(facts.totalIncTaxCents)} inc GST` : undefined,
      ]);
    case 'invoice': {
      const owing = facts.isPaid
        ? 'Paid'
        : facts.balanceDueCents !== undefined ? `${formatCents(facts.balanceDueCents)} owing` : 'Unpaid';
      return join([
        facts.customerName, owing,
        facts.totalIncTaxCents !== undefined ? `${formatCents(facts.totalIncTaxCents)} inc GST` : undefined,
        facts.day ? `Issued ${qldDay(facts.day) ?? facts.day}` : undefined,
      ]);
    }
    case 'order':
      return join([
        facts.vendorName, facts.jobId ? `Job ${facts.jobId}` : undefined, facts.statusName ?? facts.stage,
        facts.reference, facts.day ? `Issued ${qldDay(facts.day) ?? facts.day}` : undefined,
      ]);
    case 'catalog':
      return join([
        facts.partNo, facts.groupName, facts.manufacturer,
        facts.sellExTaxCents !== undefined ? `${formatCents(facts.sellExTaxCents)} ex GST` : undefined,
        facts.archived ? 'Archived' : undefined,
      ]);
    case 'lead':
      return join([facts.customerName, facts.siteName, facts.status ?? facts.stage, facts.day ? `Raised ${qldDay(facts.day) ?? facts.day}` : undefined]);
    case 'vendor':
      return join([facts.suburb, facts.phone, facts.email, facts.archived ? 'Archived' : undefined]);
  }
}

/** What can be typed, for the hint row under an empty box. */
export const SEARCH_HINTS: readonly { example: string; finds: string }[] = [
  { example: '44501', finds: 'a job by its number' },
  { example: 'inv 62339', finds: 'an invoice' },
  { example: 'po 80375', finds: 'a purchase order' },
  { example: 'quote 1234', finds: 'a Simpro quote' },
  { example: 'DET-OPT-1', finds: 'a part in the office catalogue' },
  { example: '0400 000 000', finds: 'whoever has that number' },
  { example: 'name@example.com', finds: 'a customer, contact or supplier by email' },
  { example: 'Fictional Tower', finds: 'a site, customer or lead by name' },
];

/** What a search with nothing to show should say, given what was typed. */
export function nothingFoundWords(query: ParsedQuery): { title: string; body: string } {
  if (query.hint && query.number) {
    return {
      title: `No ${KIND_LABEL[query.hint].one.toLowerCase()} ${query.number} on this phone`,
      body: 'It may be older than what the phone holds, or it has not come down yet. Try the number on its own to search every kind of record.',
    };
  }
  if (query.kind === 'phone') return { title: 'Nobody has that number', body: 'Not on any customer, contact, site or supplier the phone holds. Try fewer digits.' };
  if (query.kind === 'email') return { title: 'Nobody has that email', body: 'Not on any customer, contact or supplier the phone holds. Try the part before the @.' };
  return { title: 'Nothing matched', body: 'Try a number on its own, or a shorter piece of the name.' };
}

// ---------------------------------------------------------------------------
// Reaching people
// ---------------------------------------------------------------------------

/**
 * A text-message link, or nothing where what the office typed is not a
 * number. The same rule as telHref in jobPresentation; the scheme is the
 * only difference, and a landline gets one too because the phone's own
 * messaging app is the one that knows it cannot deliver.
 */
export function smsHref(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  const plain = digits.replace(/\+/g, '');
  if (plain.length < 6) return undefined;
  return `sms:${digits.startsWith('+') ? '+' : ''}${plain}`;
}
