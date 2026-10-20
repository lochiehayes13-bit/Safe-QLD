import { defectByCode } from '@/seed/defectLibrary';
import { labourNeededFor, partsNeededFor } from '@/domain/partsNeeded';
import { GST, roundCents, type LabourRate } from '@/domain/rates';
import { qldIsoDay } from '@/domain/qldTime';
import type { Defect } from '@/domain/types';

/**
 * The client quote — turning a site's defects into a priced document.
 *
 * Everything up to here stops short of the money. A defect carries its coded
 * quote lines, the rate card carries the hours, and the two never meet, so the
 * rectification work gets described to a client and then quoted from memory in
 * an email. This module is the join.
 *
 * Four things it refuses to do, because each of them is a real way to lose
 * money or a client:
 *
 *  - It never prices a line at nothing. A defect whose library entry has no
 *    quote items, or a line with no rate behind it, comes out unpriced and
 *    loudly reported. Zero on a quote reads as "included at no charge", and the
 *    client is entitled to read it that way.
 *  - It never drops a defect quietly. A quote covering eleven of fourteen
 *    defects looks complete; the three it missed are done for free.
 *  - It never lets a float near a total. Rates like $136.88 an hour do not
 *    survive floating point, and a quote is a document someone signs.
 *  - It never edits an issued quote. Prices, scope and the client's copy all
 *    move together or not at all, so a change after issue is a new quote with
 *    its own number, not a silent amendment to the one the client is holding.
 *
 * GST is worked once, on the subtotal, rather than on each line and added up.
 * The two answers differ by a cent often enough to matter, and the total is the
 * figure on the acceptance block.
 */

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Where a figure came from, carried with the figure rather than assumed.
 *
 * A price typed on a phone on site and a rate pulled from the office system are
 * both numbers on the same quote, and only this says which is which.
 */
export interface PriceSource {
  /**
   * office    — pulled from the office system's rate card.
   * settings  — the charge-out figures typed into the app's own Settings.
   * entered   — typed onto this quote by whoever built it.
   * catalogue — a price held against a catalogue item on the device.
   * statute   — fixed by law, not by Safe QLD.
   */
  kind: 'office' | 'settings' | 'entered' | 'catalogue' | 'statute';
  /** In a technician's words, because it is shown rather than only stored. */
  label: string;
  confidence: Confidence;
  /** The published source, where there is one to cite. */
  url?: string;
}

/** GST is 10%, and it is 10% because an Act says so rather than by convention. */
export const GST_RATE_SOURCE: PriceSource = {
  kind: 'statute',
  label: 'A New Tax System (Goods and Services Tax) Act 1999 s 9-70 — GST on a taxable supply '
    + 'is 10% of the value of the supply.',
  url: 'https://www8.austlii.edu.au/cgi-bin/viewdoc/au/legis/cth/consol_act/antsasta1999402/s9.70.html',
  confidence: 'high',
};

/**
 * Why GST is worked once on the subtotal.
 *
 * The ATO's guidance on tax invoices sets out a total invoice rule: add up the
 * GST-exclusive value of the taxable sales, work the GST on that figure, and
 * round once to the nearest cent. Marked medium rather than high because the
 * page was read through a search summary and not fetched directly, so the
 * wording behind this paraphrase has not been seen first-hand.
 */
export const GST_ROUNDING_SOURCE: PriceSource = {
  kind: 'statute',
  label: 'ATO guidance on tax invoices — the total invoice rule: GST may be worked on the summed '
    + 'GST-exclusive value of the sales and rounded once to the nearest cent.',
  url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
  confidence: 'medium',
};

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Materials and labour print as separate sections, the way a real quote does. */
export type QuoteSection = 'materials' | 'labour';

export interface QuoteLine {
  /**
   * Stable across a rebuild from the same defects, so a price typed against a
   * line survives the technician ticking one more defect on.
   */
  id: string;
  section: QuoteSection;
  description: string;
  unit: 'ea' | 'hr' | 'm' | 'lot';
  /** Hours are fractional; counts are not. Both are held as given. */
  quantity: number;
  /**
   * Whole cents excluding GST, or undefined when nothing has priced this line.
   *
   * Undefined is a state the document prints. It is not zero, and code reading
   * this must not turn it into zero.
   */
  unitCents?: number;
  /** Where unitCents came from. Absent exactly when the line is unpriced. */
  source?: PriceSource;
  /** Defect codes behind the line, so a client query can be traced back. */
  fromCodes: string[];
  /** How many defects contributed, for the same reason. */
  defectCount: number;
}

/**
 * What a line comes to, or undefined when it cannot be worked out.
 *
 * Rounded here, once, so the printed line amounts are the amounts that add up
 * to the printed subtotal. A client who adds the column with a calculator has
 * to arrive at the figure they are signing for.
 */
export function lineAmountCents(line: QuoteLine): number | undefined {
  if (line.unitCents === undefined) return undefined;
  return roundCents(line.quantity * line.unitCents);
}

// ---------------------------------------------------------------------------
// Defects that cannot be priced at all
// ---------------------------------------------------------------------------

export interface UnpriceableDefect {
  defectId: string;
  /** The code, where it had one worth naming. */
  defectCode?: string;
  location: string;
  description: string;
  reason: 'no-code' | 'unknown-code' | 'no-quote-lines';
}

export const UNPRICEABLE_REASON: Record<UnpriceableDefect['reason'], string> = {
  'no-code': 'Free-text defect with no code',
  'unknown-code': 'Code not in the defect library',
  'no-quote-lines': 'No priced work in the library for this code',
};

/**
 * The reason in words, for a reason that may have come off the database.
 *
 * The list is stored as JSON on the quote, so a row written by an older or a
 * newer build can carry a reason this one has never heard of. Reading it
 * straight out of the table above puts "undefined" on a client's document; this
 * says plainly that the reason was not recorded instead.
 */
export function unpriceableReason(reason: string): string {
  return UNPRICEABLE_REASON[reason as UnpriceableDefect['reason']]
    ?? 'No priced work, reason not recorded';
}

/**
 * Defects that will contribute nothing to the quote, and why.
 *
 * Deliberately not the same test as partsNeeded's uncoveredDefects. That one
 * treats a labour-only defect as uncovered because a supplier cannot ship
 * labour; here labour is exactly what is being sold, so a labour-only defect is
 * fully priced and only a defect with no quote items at all is a problem.
 *
 * "Obstructed detector" is the honest example: the library says clear the
 * obstruction and stops there, because the work depends on what is in the way.
 * Left off the quote it becomes free work; listed here it becomes a
 * conversation before the quote goes out.
 */
export function unpriceableDefects(defects: Defect[]): UnpriceableDefect[] {
  const out: UnpriceableDefect[] = [];
  for (const defect of defects) {
    const base = {
      defectId: defect.id,
      defectCode: defect.defectCode,
      location: defect.location,
      description: defect.description,
    };
    if (!defect.defectCode) {
      out.push({ ...base, reason: 'no-code' });
      continue;
    }
    const code = defectByCode(defect.defectCode);
    if (!code) {
      out.push({ ...base, reason: 'unknown-code' });
      continue;
    }
    if (!(code.quoteItems ?? []).length) {
      out.push({ ...base, reason: 'no-quote-lines' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building the lines
// ---------------------------------------------------------------------------

/**
 * A price for one material line, matched on the library's own wording.
 *
 * Matched exactly, lowercased, and never fuzzily. "Replacement detector head"
 * and "Replacement detector base" are one word apart and cost different money,
 * and a near-miss match that prices the wrong one is the sort of error that
 * survives all the way to an invoice dispute.
 */
export interface MaterialPrice {
  description: string;
  unitCents: number;
  source: PriceSource;
}

export interface QuoteBuildInput {
  /** The defects the technician chose to put on this quote. */
  defects: Defect[];
  /** Prices for the material lines. Empty is the normal state, not an error. */
  materialPrices?: MaterialPrice[];
  /**
   * The rate every labour line is charged at.
   *
   * One rate for all of them: the library says how many hours a rectification
   * takes but nothing about when it is done, so it cannot know that one line is
   * after hours and another is not. Whoever builds the quote decides that once.
   */
  labourRate?: LabourRate;
  /** Where labourRate came from. Required with it, so a rate is never anonymous. */
  labourRateSource?: PriceSource;
}

export interface QuoteBuild {
  lines: QuoteLine[];
  /** Defects that produced no line at all. Kept on the quote, not recomputed. */
  unpriceable: UnpriceableDefect[];
  /**
   * Prices that were offered and not used, in words.
   *
   * A refusal nobody is told about is indistinguishable from nobody having
   * typed a price: both leave the line blank. These say which happened, so a
   * rate that arrived without a source is a thing the technician can fix rather
   * than a line that mysteriously will not price.
   */
  warnings: string[];
}

const materialKey = (description: string, unit: string) => `mat:${description.toLowerCase()}|${unit}`;
const labourKey = (description: string) => `lab:${description.toLowerCase()}`;

/**
 * Turns chosen defects into quote lines.
 *
 * Quantities aggregate across defects that need the same thing — three failed
 * heads is one line for three, which is how a client reads a quote and how a
 * supplier reads an order. The aggregation is partsNeededFor's and
 * labourNeededFor's rather than a second copy of it here: two implementations
 * of "the same thing" is two answers to how many heads are needed.
 */
export function buildQuoteLines(input: QuoteBuildInput): QuoteBuild {
  const warnings: string[] = [];
  const prices = new Map<string, MaterialPrice>();
  for (const p of input.materialPrices ?? []) {
    // A price is whole cents or it is not a price. A fraction of a cent means
    // dollars were multiplied out somewhere upstream, and it prints as
    // "$89.5.5" on the document; nought or less means the material is being
    // given away. Neither is used, and neither is quietly corrected.
    if (!Number.isInteger(p.unitCents) || p.unitCents <= 0) {
      warnings.push(`Price for "${p.description.trim()}" not used. It must be above $0, to the cent.`);
      continue;
    }
    prices.set(p.description.trim().toLowerCase(), p);
  }

  const lines: QuoteLine[] = [];

  for (const part of partsNeededFor(input.defects)) {
    const priced = prices.get(part.description.trim().toLowerCase());
    lines.push({
      id: materialKey(part.description, part.unit),
      section: 'materials',
      description: part.description,
      unit: part.unit,
      quantity: part.quantity,
      unitCents: priced?.unitCents,
      source: priced?.source,
      fromCodes: [...part.fromCodes],
      defectCount: part.defectCount,
    });
  }

  // A labour rate with no stated source is refused rather than used: an
  // unattributable figure on a quote cannot be defended when the client asks
  // where it came from, and the whole point of carrying the source is that
  // there is never a figure without one.
  const rate = input.labourRate && input.labourRateSource ? input.labourRate : undefined;
  if (input.labourRate && !input.labourRateSource) {
    warnings.push(`Labour rate "${input.labourRate.name}" has no source. Hours are unpriced.`);
  }
  if (rate && (!Number.isInteger(rate.sellCentsPerHour) || rate.sellCentsPerHour <= 0)) {
    warnings.push(`Labour rate "${rate.name}" is not a valid amount. Hours are unpriced.`);
  }
  const hourlyCents = rate && Number.isInteger(rate.sellCentsPerHour) && rate.sellCentsPerHour > 0
    ? rate.sellCentsPerHour
    : undefined;

  for (const labour of labourNeededFor(input.defects)) {
    lines.push({
      id: labourKey(labour.description),
      section: 'labour',
      description: labour.description,
      unit: 'hr',
      quantity: labour.hours,
      unitCents: hourlyCents,
      source: hourlyCents === undefined ? undefined : input.labourRateSource,
      fromCodes: [...labour.fromCodes],
      defectCount: labour.defectCount,
    });
  }

  return { lines, unpriceable: unpriceableDefects(input.defects), warnings };
}

/** One line of the scope of works, as the client reads it. */
export interface ScopeLine {
  location: string;
  text: string;
}

/** The plain-English scope, in the wording the library keeps for clients. */
export function scopeLinesFor(defects: Defect[]): ScopeLine[] {
  const out: ScopeLine[] = [];
  for (const defect of defects) {
    const code = defect.defectCode ? defectByCode(defect.defectCode) : undefined;
    // The client wording where the library has one, then the technician's own
    // description. The formal report wording is deliberately not used: it is
    // written for a compliance record and reads as an accusation in a quote.
    // The library's own component and defect wording is the last resort rather
    // than dropping the line: a defect can carry a code with no client wording
    // (a panel fault does) and be raised with no typed description, and a
    // priced line whose scope entry vanished is work the client is being
    // charged for and cannot see described.
    const named = code ? `${code.component} — ${code.defect.toLowerCase()}` : '';
    const text = code?.clientWording?.trim() || defect.description.trim() || named;
    if (text) out.push({ location: defect.location, text });
  }
  return out;
}

/** The library's client wording for a code, or its own component and defect words. */
function codeScopeText(code: string): string {
  const entry = defectByCode(code);
  if (!entry) return '';
  return entry.clientWording?.trim() || `${entry.component} — ${entry.defect.toLowerCase()}`;
}

/**
 * The scope a saved quote prints with.
 *
 * The scope is stored with the quote when it is saved, so a reprint carries
 * the same lines the client was first sent. A quote saved before the scope was
 * stored has none, and printing "no scope items" over priced work is a document
 * charging for work it does not describe. For those the scope is rebuilt from
 * the defect codes on its lines, in the library's client wording: the locations
 * were never kept, so they are left blank rather than guessed.
 */
export function scopeForReprint(quote: Pick<Quote, 'scope' | 'lines'>): ScopeLine[] {
  const stored = (quote.scope ?? []).filter((s) => s.text.trim());
  if (stored.length) return stored;
  const codes: string[] = [];
  for (const line of quote.lines) {
    for (const code of line.fromCodes) if (!codes.includes(code)) codes.push(code);
  }
  return codes
    .map((code) => ({ location: '', text: codeScopeText(code) }))
    .filter((s) => s.text);
}

// ---------------------------------------------------------------------------
// Prices from the office catalogue
// ---------------------------------------------------------------------------

/**
 * A row of the office catalogue, as far as a quote needs it.
 *
 * The sell price and nothing else about money. The catalogue mirror holds no
 * cost, and this type has no field for one so nothing can hand it over.
 */
export interface CatalogueSellItem {
  name: string;
  partNo?: string;
  /** Whole cents excluding GST, or undefined where the office has no sell price. */
  sellExTaxCents?: number;
  archived?: boolean;
}

/** Where a catalogue price came from, in the form a quote line stores it. */
export function catalogueSource(item: Pick<CatalogueSellItem, 'partNo'>): PriceSource {
  return {
    kind: 'catalogue',
    label: `Office catalogue${item.partNo?.trim() ? ` (${item.partNo.trim()})` : ''}`,
    confidence: 'high',
  };
}

/** A sell price a quote line can use: whole cents above nothing. */
export function usableSellCents(item: Pick<CatalogueSellItem, 'sellExTaxCents' | 'archived'>): number | undefined {
  const cents = item.sellExTaxCents;
  if (item.archived || cents === undefined || !Number.isInteger(cents) || cents <= 0) return undefined;
  return cents;
}

/**
 * Prices for material lines that the office catalogue sells by the same name.
 *
 * Matched exactly on the item's name or part number, lowercased and trimmed,
 * the same rule as a typed price: "Replacement detector head" and
 * "Replacement detector base" are one word apart and cost different money.
 * Where two current items share the wording at different prices the line is
 * left for the technician to price, because picking either is a guess.
 */
export function catalogueMaterialPrices(
  descriptions: readonly string[],
  items: readonly CatalogueSellItem[],
): MaterialPrice[] {
  const key = (s: string | undefined) => (s ?? '').trim().toLowerCase();
  const out: MaterialPrice[] = [];
  for (const description of descriptions) {
    const wanted = key(description);
    if (!wanted) continue;
    const hits = items.filter((i) => usableSellCents(i) !== undefined
      && (key(i.name) === wanted || key(i.partNo) === wanted));
    const prices = new Set(hits.map((i) => i.sellExTaxCents));
    if (!hits.length || prices.size !== 1) continue;
    const item = hits[0]!;
    out.push({ description, unitCents: item.sellExTaxCents!, source: catalogueSource(item) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The quote itself
// ---------------------------------------------------------------------------

export type QuoteStatus = 'draft' | 'issued' | 'accepted' | 'declined' | 'expired';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

export interface Quote {
  id: string;
  siteId: string;
  /** The number the client quotes back. */
  reference: string;
  jobReference?: string;
  clientName: string;
  siteName: string;
  siteAddress?: string;
  contactName?: string;
  preparedBy: string;
  status: QuoteStatus;
  /** Whole days the quote holds good for, counted from the issue date. */
  validityDays: number;
  issuedAt?: string;
  /** Calendar date in Queensland, set on issue. */
  expiresAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  declinedAt?: string;
  /**
   * A whole-cent reduction, never a percentage.
   *
   * A five per cent multiply on a subtotal produces a fraction of a cent, and
   * the difference between rounding it here and rounding it in the office
   * system is a quote and an invoice that disagree.
   */
  discountCents: number;
  discountReason?: string;
  lines: QuoteLine[];
  /** Recorded at build time so an issued quote can still say what it excluded. */
  unpriceable: UnpriceableDefect[];
  /**
   * The scope of works as it was printed when the quote was saved, so a
   * reprint matches the client's copy. Absent on quotes saved before it was
   * stored; see scopeForReprint.
   */
  scope?: ScopeLine[];
  scopeNote?: string;
  /** What the price does not cover. Printed, because an unstated exclusion is a dispute. */
  exclusions: string[];
  notes?: string;
  /** As a fraction. Held per quote so a historic quote reprints at its own rate. */
  taxRate: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_VALIDITY_DAYS = 30;

/**
 * What a quote excludes unless someone says otherwise.
 *
 * Written out rather than left to be understood. Every one of these has been an
 * argument on a real job: who pays for the scissor lift, who pays when the
 * ceiling comes down with the detector, and whether the price included coming
 * back at night because the client would not take an isolation during trade.
 */
export const DEFAULT_EXCLUSIONS: string[] = [
  'Access equipment beyond a standard ladder — scissor lifts, EWPs and scaffold are quoted separately.',
  'Work outside normal business hours, unless this quote says otherwise.',
  'Making good to ceilings, walls or finishes disturbed while carrying out the work.',
  'Repairs to faults found once the quoted work is under way and not visible beforehand.',
  'Statutory or certifying fees payable to another party.',
];

// ---------------------------------------------------------------------------
// Dates — Queensland time, and Australian conventions
// ---------------------------------------------------------------------------

/**
 * The Queensland calendar date of an instant.
 *
 * Slicing the first ten characters off an ISO timestamp is the obvious approach
 * and it is wrong here: a quote issued at eight in the morning in Brisbane was
 * stamped at 22:00 the previous day in UTC, so the slice dates it a day early
 * and expires it a day early with it.
 *
 * One implementation, in qldTime.ts. This was a fourth copy of the same ten
 * hours, and the copies had stopped agreeing: this one read "1/9/2026" as the
 * ninth of January, which would expire a quote eight months early.
 */
export function qldDate(iso: string | undefined): string | undefined {
  return qldIsoDay(iso);
}

/** Adds whole days to a Queensland calendar date, refusing what it cannot read. */
export function addDays(iso: string | undefined, days: number): string | undefined {
  const day = qldDate(iso);
  if (!day || !Number.isInteger(days)) return undefined;
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from one calendar date to another; negative when the second is earlier. */
function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

/**
 * The date a quote issued now stops holding good.
 *
 * Refuses a validity it cannot honour rather than substituting the default: a
 * quote whose expiry silently became thirty days when someone meant seven is a
 * quote held open three weeks longer than intended.
 */
export function expiryFor(issuedAt: string | undefined, validityDays = DEFAULT_VALIDITY_DAYS): string | undefined {
  if (!Number.isInteger(validityDays) || validityDays < 1) return undefined;
  return addDays(issuedAt, validityDays);
}

export interface LapseCheck {
  /** Undefined when the quote has never been issued, so there is nothing to lapse. */
  lapsed?: boolean;
  /** Whole days left, counting today. Negative once it has lapsed. */
  daysRemaining?: number;
  /** In a technician's words, for the screen. */
  note: string;
}

/**
 * Whether a quote still holds good as at a date.
 *
 * The expiry date is the last day the quote can be accepted, not the first day
 * it is dead — "valid for thirty days" that dies on the thirtieth morning is
 * twenty-nine days of validity and an argument with a client who accepted on
 * time.
 *
 * Prices move. A six-month-old quote accepted at last year's rates is a job
 * done at a loss, which is why this exists at all rather than being left to
 * whoever reads the date.
 */
export function lapseStatus(
  quote: Pick<Quote, 'status' | 'expiresAt'>,
  asAt: string,
): LapseCheck {
  if (!quote.expiresAt) {
    return { note: 'Not issued yet.' };
  }
  const expires = qldDate(quote.expiresAt);
  const today = qldDate(asAt);
  if (!expires || !today) {
    return { note: 'Expiry date unreadable, so lapse unknown.' };
  }
  const daysRemaining = daysBetween(today, expires);
  if (daysRemaining < 0) {
    return {
      lapsed: true,
      daysRemaining,
      note: `Lapsed ${-daysRemaining} day${daysRemaining === -1 ? '' : 's'} ago. Requote at current rates.`,
    };
  }
  return {
    lapsed: false,
    daysRemaining,
    note: daysRemaining === 0
      ? 'Today is the last day.'
      : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left.`,
  };
}

/**
 * The order a list of quotes should be read in.
 *
 * By what needs an answer soonest, not by site and not by date. An issued quote
 * about to lapse is the row that matters; one accepted last month is history,
 * and one declined is closed. A list ordered alphabetically buries the first at
 * whatever letter its site begins with, which across 897 sites means nobody
 * sees it.
 *
 * Issued first and, among those, the one with least time left. Drafts next,
 * because a draft is work this company has not finished rather than work a
 * client has not answered. Then the settled ones, and expired ahead of the rest
 * of them: an expired quote is the one still worth raising again.
 */
export const QUOTE_URGENCY: Record<QuoteStatus, number> = {
  issued: 0, draft: 1, expired: 2, declined: 3, accepted: 4,
};

export interface QuoteForOrder {
  status: QuoteStatus;
  siteName: string;
  expiresAt?: string;
}

/**
 * Sorts quotes for a list, soonest to need an answer first.
 *
 * Days remaining is worked from the expiry against the day given, in Queensland
 * dates — the whole reason `lapseStatus` exists rather than a slice of a UTC
 * timestamp. A quote with no expiry sorts after ones that have one, since there
 * is no clock running on it.
 */
export function orderQuotes<T extends QuoteForOrder>(quotes: readonly T[], asAt: string): T[] {
  const remaining = (q: QuoteForOrder): number =>
    lapseStatus(q, asAt).daysRemaining ?? Number.POSITIVE_INFINITY;

  return [...quotes].sort((a, b) =>
    QUOTE_URGENCY[a.status] - QUOTE_URGENCY[b.status]
    || remaining(a) - remaining(b)
    || a.siteName.localeCompare(b.siteName));
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface TransitionCheck {
  allowed: boolean;
  /** Why not, in words that can go straight on the screen. Absent when allowed. */
  reason?: string;
}

const ALLOWED: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['issued'],
  issued: ['accepted', 'declined', 'expired'],
  accepted: [],
  declined: [],
  expired: [],
};

/**
 * Whether a quote may move to a status, and if not, why not.
 *
 * The refusals carry the reasoning because they are the point of the machine:
 *
 *  - An issued quote cannot go back to draft. The client is holding a numbered
 *    document; editing the one in the app makes the two disagree while both
 *    look authoritative.
 *  - An accepted quote cannot expire. Acceptance closed it; a job in progress
 *    does not stop being agreed because a date passed.
 *  - A lapsed quote cannot be accepted. That is the whole reason for the date.
 *  - An issued quote cannot be marked expired early. If the client has said no,
 *    that is declined, and the two are not the same conversation.
 */
export function canTransition(
  quote: Pick<Quote, 'status' | 'expiresAt'>,
  to: QuoteStatus,
  asAt?: string,
): TransitionCheck {
  const from = quote.status;
  if (from === to) {
    return { allowed: false, reason: `This quote is already ${QUOTE_STATUS_LABEL[to].toLowerCase()}.` };
  }
  if (!ALLOWED[from].includes(to)) {
    if (to === 'draft') {
      return {
        allowed: false,
        reason: 'An issued quote cannot go back to draft. Raise a new quote for the change.',
      };
    }
    if (from === 'accepted') {
      return {
        allowed: false,
        reason: 'This quote has been accepted and is closed.',
      };
    }
    if (from === 'declined' || from === 'expired') {
      return {
        allowed: false,
        reason: `A ${QUOTE_STATUS_LABEL[from].toLowerCase()} quote is closed. `
          + 'Raise a new one at current rates.',
      };
    }
    return {
      allowed: false,
      reason: `A ${QUOTE_STATUS_LABEL[from].toLowerCase()} quote cannot be marked `
        + `${QUOTE_STATUS_LABEL[to].toLowerCase()}.`,
    };
  }

  if (to === 'accepted' && quote.expiresAt) {
    // No date to check against is not the same as "it has not lapsed". Left to
    // mean the latter, a quote six months past its date is accepted at last
    // year's prices by a caller that simply did not pass today in.
    if (!asAt) {
      return {
        allowed: false,
        reason: 'Accepting needs a date to check it against.',
      };
    }
    const lapse = lapseStatus(quote, asAt);
    if (lapse.lapsed) {
      const days = -(lapse.daysRemaining ?? 0);
      return {
        allowed: false,
        reason: `This quote lapsed ${days} day${days === 1 ? '' : 's'} ago. `
          + 'Raise a new quote at current rates.',
      };
    }
  }

  if (to === 'expired') {
    if (!asAt) {
      return {
        allowed: false,
        reason: 'Expiring needs a date to check it against.',
      };
    }
    const lapse = lapseStatus(quote, asAt);
    if (lapse.lapsed !== true) {
      return {
        allowed: false,
        reason: 'Not lapsed yet. If the client said no, mark it declined.',
      };
    }
  }

  return { allowed: true };
}

/** Only a draft can be edited; anything else is refused with the reason. */
export function editRefusal(quote: Pick<Quote, 'status'>): string | undefined {
  if (quote.status === 'draft') return undefined;
  return `${QUOTE_STATUS_LABEL[quote.status]} quotes are locked. Raise a new quote to change it.`;
}

export function canEdit(quote: Pick<Quote, 'status'>): boolean {
  return editRefusal(quote) === undefined;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface QuoteTotals {
  /** Every figure here is whole cents, excluding GST unless it says otherwise. */
  materialsCents: number;
  labourCents: number;
  /** Materials plus labour, before any discount. */
  workCents: number;
  discountCents: number;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  /** Lines carrying no price. They are in the document and not in the total. */
  unpricedLines: QuoteLine[];
  /**
   * True when something the client asked about is missing a price, so the total
   * is not the whole job. The document says so rather than presenting a total
   * that quietly understates the work.
   */
  incomplete: boolean;
  warnings: string[];
}

export type QuoteForTotals =
  Pick<Quote, 'lines' | 'discountCents'>
  & Partial<Pick<Quote, 'unpriceable' | 'status' | 'expiresAt' | 'taxRate'>>;

/**
 * What the quote comes to.
 *
 * Money flows one way through here: line amounts are rounded once each so the
 * printed column adds up, the subtotal is the sum of those rounded amounts, and
 * GST is worked once on the subtotal after the discount. Working GST per line
 * and adding it up gives a different answer often enough to matter, and the
 * client signs the total.
 *
 * Nothing unpriced contributes. That is the whole discipline: an unpriced line
 * counted as zero would produce a total that looks complete and is not.
 */
export function quoteTotals(quote: QuoteForTotals, asAt?: string): QuoteTotals {
  const warnings: string[] = [];
  const unpricedLines = quote.lines.filter((l) => l.unitCents === undefined);

  const sectionTotal = (section: QuoteSection) => quote.lines
    .filter((l) => l.section === section)
    .reduce((n, l) => n + (lineAmountCents(l) ?? 0), 0);

  const materialsCents = sectionTotal('materials');
  const labourCents = sectionTotal('labour');
  const workCents = materialsCents + labourCents;

  // A discount arriving as a float means someone multiplied by a percentage
  // somewhere upstream. Refused rather than rounded here, because rounding it
  // silently is how the quote and the office system come to differ by a cent.
  const rawDiscount = quote.discountCents ?? 0;
  let discountCents = 0;
  if (Number.isInteger(rawDiscount)) {
    discountCents = rawDiscount;
  } else {
    warnings.push('Discount left off: not a whole number of cents. Enter a dollar amount.');
  }

  const subtotalCents = workCents - discountCents;
  const taxRate = quote.taxRate ?? GST;
  const gstCents = roundCents(subtotalCents * taxRate);
  const totalCents = subtotalCents + gstCents;

  for (const line of unpricedLines) {
    warnings.push(`"${line.description}" has no price and is not in the total.`);
  }

  if (!quote.lines.length) {
    warnings.push('No lines on this quote.');
  } else if (unpricedLines.length === quote.lines.length) {
    warnings.push('Nothing on this quote is priced, so the total is not a price.');
  }

  for (const u of quote.unpriceable ?? []) {
    warnings.push(
      `${u.location ? `${u.location}: ` : ''}${u.description || u.defectCode || 'A defect'} is not priced. `
      + `${unpriceableReason(u.reason)}.`,
    );
  }

  if (discountCents < 0) {
    warnings.push('The discount is negative, so it adds to the price.');
  } else if (discountCents > workCents) {
    warnings.push('The discount is larger than the work. Check the figure.');
  }

  if (asAt && quote.status === 'issued') {
    const lapse = lapseStatus({ status: 'issued', expiresAt: quote.expiresAt }, asAt);
    if (lapse.lapsed) warnings.push(lapse.note);
  }

  return {
    materialsCents,
    labourCents,
    workCents,
    discountCents,
    subtotalCents,
    gstCents,
    totalCents,
    unpricedLines,
    incomplete: unpricedLines.length > 0 || (quote.unpriceable ?? []).length > 0,
    warnings,
  };
}

/**
 * The distinct sources behind the figures on a quote.
 *
 * A quote priced half from the office rate card and half from prices typed on a
 * phone is a normal state and worth being able to say out loud, on the document
 * as well as the screen.
 */
export function pricingSources(lines: QuoteLine[]): PriceSource[] {
  const seen = new Map<string, PriceSource>();
  for (const line of lines) {
    if (!line.source) continue;
    const key = `${line.source.kind}|${line.source.label}`;
    if (!seen.has(key)) seen.set(key, line.source);
  }
  return [...seen.values()];
}

/**
 * The lowest confidence anything on the quote rests on.
 *
 * Surfaced because a total is only as good as its weakest figure, and a quote
 * built entirely from prices typed on site should not look as settled as one
 * off the office rate card.
 */
export function weakestConfidence(lines: QuoteLine[]): Confidence | undefined {
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  let worst: Confidence | undefined;
  for (const source of pricingSources(lines)) {
    if (!worst || rank[source.confidence] > rank[worst]) worst = source.confidence;
  }
  return worst;
}

/**
 * The quote number.
 *
 * A Safe QLD convention rather than anything a standard has an opinion on: the
 * site's own code, the year the quote was issued in, and a sequence within that
 * site. It reads back over the phone, and it sorts.
 */
export function formatQuoteReference(siteCode: string, seq: number, issuedAt?: string): string | undefined {
  const code = siteCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!code || !Number.isInteger(seq) || seq < 1) return undefined;
  const year = (qldDate(issuedAt) ?? '').slice(0, 4);
  return year
    ? `Q-${code}-${year}-${String(seq).padStart(3, '0')}`
    : `Q-${code}-${String(seq).padStart(3, '0')}`;
}
