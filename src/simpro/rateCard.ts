/**
 * The rate card, as Simpro holds it.
 *
 * Rates change in the office system day to day, so the app follows it rather
 * than a copy someone typed in months ago. What arrives is Simpro's shape, not
 * the app's, and the differences are real:
 *
 *  - Simpro holds a cost rate and a markup. The sell rate is derived. This
 *    module derives it and says so.
 *  - Simpro has no normal/after-hours flag on a rate. The band lives in the
 *    rate's name, which means reading it is an inference, not a fact. Every
 *    inference is reported alongside the rate it was made about.
 *  - Cost rates and markups are deliberately dropped on the way in, and no
 *    figure worked out from them — a margin, a percentage — leaves this
 *    module either, not even in a note. A phone that never holds any of
 *    them cannot show one, and a technician has no use for one. What the
 *    office wants to sanity-check belongs in the office toolkit.
 *
 * Nothing here calls the network. It takes the JSON and returns the card.
 */

import {
  GST, suspectRateNames,
  type HoursBand, type LabourRate, type ServiceFee,
} from '@/domain/rates';

/** Only the fields actually read. Simpro returns considerably more. */
export interface RawLabourRate {
  ID?: number | string;
  Name?: string;
  CostRate?: number | string;
  Markup?: number | string;
  /** Not documented on every build; preferred over the derived figure when present. */
  SellRate?: number | string;
  Multiplier?: number | string;
  TaxCode?: { Rate?: number | string };
  IsDefault?: boolean;
  AddToAllCustomers?: boolean;
  Archived?: boolean;
}

export interface RawServiceFee {
  ID?: number | string;
  Name?: string;
  /** Simpro has used several names for the charge across builds. */
  Amount?: number | string;
  Charge?: number | string;
  SellPrice?: number | string;
  Price?: number | string;
  /**
   * Minutes of labour the fee covers, again under several names.
   *
   * `LaborTime` is the American spelling and is the one this build actually
   * returns. Without it the fee imported with its charge but no included time,
   * so an attendance fee looked like it covered nothing and every minute on
   * site was billed again on top of it.
   */
  LaborTime?: number | string;
  IncludedLabourTime?: number | string;
  LabourTime?: number | string;
  IncludedMinutes?: number | string;
  /** Simpro names this `SalesTaxCode` on the service fee endpoint. */
  TaxCode?: { Rate?: number | string };
  SalesTaxCode?: { Rate?: number | string };
  Archived?: boolean;
}

export interface RateCardImport {
  rates: LabourRate[];
  fees: ServiceFee[];
  /**
   * What was inferred rather than read, in the technician's words. Shown next
   * to the card so nothing derived is mistaken for something Simpro said.
   */
  notes: string[];
  /** Rate names carrying a customer the app has never heard of. */
  suspect: string[];
  /** Records that could not be turned into a rate or a fee, and why. */
  skipped: { name: string; reason: string }[];
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/** Dollars to whole cents, without letting a float decide the last cent. */
const cents = (dollars: number): number => Math.round(dollars * 100);

const AFTER_HOURS = /\b(after[\s-]*hours?|out[\s-]*of[\s-]*hours?|overtime|a\/h|oo?h)\b/i;
const CALLOUT = /\b(call[\s-]*out|callout|attendance|site\s+attendance)\b/i;

/** Which band a rate name describes. Nothing in the payload says, so the name must. */
export function bandFromName(name: string): HoursBand {
  return AFTER_HOURS.test(name) ? 'after-hours' : 'normal';
}

/** A call-out is charged once, not per hour, so it is not a labour rate at a different number. */
export function kindFromName(name: string): LabourRate['kind'] {
  return CALLOUT.test(name) ? 'callout' : 'labour';
}

/** The vocabulary a rate name is built from, once the customer is taken off the front. */
const RATE_WORDS = /\b(after|out\s*of|normal|business|ordinary|standard|hours?|hrs?|labou?r|call\s*out|callout|attendance|site|rate|fee|overtime|weekend|public\s+holiday|saturday|sunday|apprentice|technician|senior|junior|1st|2nd|3rd|4th|year)\b/gi;

/**
 * The customer a rate is filed under, as Simpro spells it.
 *
 * Whatever is left of a rate name once the trade vocabulary is removed is the
 * candidate. It only becomes a customer if a customer the app knows matches it,
 * or is one character from it — a rate named "Apprentice Labour" must not
 * become a rate for a customer called Apprentice, because that quietly removes
 * it from the general pool and nothing would ever select it.
 *
 * The near miss is deliberately kept with Simpro's spelling rather than
 * corrected. A real card carried both "Vaxxas" and "Vaxxax" one letter apart;
 * the office system is the record, and silently renaming it here would hide the
 * fault instead of fixing it. Recorded faithfully, suspectRateNames reports it.
 */
export function customerFromName(name: string, customers: readonly string[]): string | undefined {
  const candidate = name.replace(RATE_WORDS, ' ').replace(/[^A-Za-z0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!candidate) return undefined;
  const lower = candidate.toLowerCase();

  for (const c of customers) {
    if (c.trim().toLowerCase() === lower) return candidate;
  }
  // A rate naming a customer that does not quite exist is still filed under
  // that name, and is reported rather than reassigned.
  for (const c of customers) {
    if (withinOneEdit(c.trim().toLowerCase(), lower)) return candidate;
  }
  return undefined;
}

/** True when two strings differ by a single substitution, insertion or deletion. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (shorter.length === longer.length) i++;
    j++;
  }
  return edits + (longer.length - j) <= 1;
}

/**
 * The sell rate for one Simpro labour rate.
 *
 * Simpro stores cost and markup; the sell rate a technician sees in the UI is
 * the product. Where a build also returns a sell rate outright it wins, and a
 * disagreement between the two is reported rather than averaged — a quote is a
 * document someone signs, and two answers means one of them is wrong.
 *
 * The notes say that a figure was derived and never what from. A markup
 * percentage beside the sell rate it produced is the cost rate one division
 * away, on a screen a technician reads in a customer's plant room; the
 * multiplier is named because it is neither cost nor markup.
 */
export function sellCentsFor(raw: RawLabourRate): { sellCents?: number; note?: string } {
  const explicit = num(raw.SellRate);
  const cost = num(raw.CostRate);
  const markup = num(raw.Markup);
  const multiplier = num(raw.Multiplier);

  let derived: number | undefined;
  if (cost !== undefined && markup !== undefined) {
    derived = cost * (1 + markup / 100);
    if (multiplier !== undefined && multiplier > 0 && multiplier !== 1) derived *= multiplier;
  }

  if (explicit !== undefined && derived !== undefined) {
    const a = cents(explicit);
    const b = cents(derived);
    if (Math.abs(a - b) > 1) {
      return {
        sellCents: a,
        note: `${raw.Name ?? 'A rate'}: Simpro's sell rate and its cost-plus-markup disagree; ` +
          `the sell rate (${(a / 100).toFixed(2)}) is used.`,
      };
    }
    return { sellCents: a };
  }
  if (explicit !== undefined) return { sellCents: cents(explicit) };
  if (derived !== undefined) {
    const mult = multiplier !== undefined && multiplier !== 1 ? ` and a ${multiplier}× multiplier` : '';
    return {
      sellCents: cents(derived),
      note: `${raw.Name ?? 'A rate'}: sell rate worked out from cost plus markup${mult}, ` +
        'because Simpro did not give one outright.',
    };
  }
  return {};
}

/** Simpro gives tax as a percentage; the app holds it as a fraction. */
const taxFraction = (raw: { TaxCode?: { Rate?: number | string } }): number => {
  const rate = num(raw.TaxCode?.Rate);
  if (rate === undefined) return GST;
  // A build returning 0.1 already means a fraction; 10 means per cent.
  return rate > 1 ? rate / 100 : rate;
};

export function mapLabourRates(
  raw: readonly RawLabourRate[],
  customers: readonly string[] = [],
): Pick<RateCardImport, 'rates' | 'notes' | 'suspect' | 'skipped'> {
  const rates: LabourRate[] = [];
  const notes: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const r of raw) {
    const name = (r.Name ?? '').trim();
    if (!name) {
      skipped.push({ name: `Rate ${r.ID ?? '?'}`, reason: 'has no name, so nothing can match it' });
      continue;
    }
    if (r.Archived) continue;

    const { sellCents, note } = sellCentsFor(r);
    if (note) notes.push(note);
    if (sellCents === undefined || sellCents <= 0) {
      skipped.push({ name, reason: 'no sell rate and nothing to work one out from' });
      continue;
    }

    const band = bandFromName(name);
    const kind = kindFromName(name);
    const customerName = customerFromName(name, customers);

    rates.push({
      id: String(r.ID ?? name),
      name,
      // Not carried onto the device. See the note at the top of this file.
      costCentsPerHour: 0,
      sellCentsPerHour: sellCents,
      taxRate: taxFraction(r),
      efficiencyMultiplier: 1,
      kind,
      hours: band,
      customerName,
      includesOverhead: r.AddToAllCustomers === undefined ? undefined : !r.AddToAllCustomers,
    });
  }

  const named = rates.filter((r) => AFTER_HOURS.test(r.name) || CALLOUT.test(r.name)).length;
  if (named > 0) {
    notes.push(
      `${named} of ${rates.length} rates had their hours or call-out status read from the rate name — ` +
      'Simpro does not flag either, so check any rate named unusually.',
    );
  }

  const suspect = suspectRateNames(rates, [...customers]);
  return { rates, notes, suspect, skipped };
}

const feeCharge = (f: RawServiceFee): number | undefined =>
  num(f.Amount) ?? num(f.Charge) ?? num(f.SellPrice) ?? num(f.Price);

const feeMinutes = (f: RawServiceFee): number | undefined =>
  num(f.LaborTime) ?? num(f.IncludedLabourTime) ?? num(f.LabourTime) ?? num(f.IncludedMinutes);

export function mapServiceFees(
  raw: readonly RawServiceFee[],
): Pick<RateCardImport, 'fees' | 'notes' | 'skipped'> {
  const fees: ServiceFee[] = [];
  const notes: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const f of raw) {
    const name = (f.Name ?? '').trim();
    if (f.Archived) continue;
    if (!name) {
      skipped.push({ name: `Fee ${f.ID ?? '?'}`, reason: 'has no name' });
      continue;
    }
    const charge = feeCharge(f);
    if (charge === undefined || charge <= 0) {
      skipped.push({ name, reason: 'no charge amount in the payload' });
      continue;
    }
    const minutes = feeMinutes(f);
    if (minutes === undefined) {
      notes.push(
        `${name}: no included labour time came back, so it is treated as covering no time and ` +
        'every hour is charged on top. Check it against Simpro before quoting from it.',
      );
    }
    fees.push({
      id: String(f.ID ?? name),
      name,
      chargeCents: cents(charge),
      includedLabourMinutes: Math.max(0, Math.round(minutes ?? 0)),
      taxRate: taxFraction(f),
      hours: bandFromName(name),
    });
  }

  return { fees, notes, skipped };
}

/**
 * One card from both endpoints.
 *
 * A band with a fee but no labour rate is worth saying out loud: the fee will
 * charge and the hours past it will silently not, which reads as a cheap job
 * rather than a missing rate.
 */
export function buildRateCard(
  rawRates: readonly RawLabourRate[],
  rawFees: readonly RawServiceFee[],
  customers: readonly string[] = [],
): RateCardImport {
  const labour = mapLabourRates(rawRates, customers);
  const fee = mapServiceFees(rawFees);
  const notes = [...labour.notes, ...fee.notes];

  for (const band of ['normal', 'after-hours'] as const) {
    const hasFee = fee.fees.some((f) => f.hours === band);
    const hasRate = labour.rates.some((r) => r.hours === band && r.kind === 'labour' && !r.customerName);
    const label = band === 'normal' ? 'normal hours' : 'after hours';
    if (hasFee && !hasRate) {
      notes.push(
        `There is a ${label} attendance fee but no general ${label} labour rate, so time past the ` +
        'fee will not be charged at all.',
      );
    }
  }

  return {
    rates: labour.rates,
    fees: fee.fees,
    notes,
    suspect: labour.suspect,
    skipped: [...labour.skipped, ...fee.skipped],
  };
}
