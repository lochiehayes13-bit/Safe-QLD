/**
 * Labour rates, service fees, and what an attendance actually costs.
 *
 * Money is held in whole cents throughout. Rates like $136.88 an hour do not
 * survive floating point — a few additions and a two-hour attendance bills
 * $300.00000000000006 — and a quote is a document someone signs.
 *
 * No rates ship in this file. They are Safe QLD's commercial terms, including
 * cost rates and therefore margins, and they belong in the office system and
 * the app's own settings rather than in a repository. What ships is the shape
 * and the arithmetic.
 */

import { qldIsoDay } from '@/domain/qldTime';

export type HoursBand = 'normal' | 'after-hours';

/** GST in Australia, as a fraction. Rates on a card are held excluding it. */
export const GST = 0.1;

export interface LabourRate {
  id: string;
  /** The name as the office system holds it, which is how a rate is matched. */
  name: string;
  /** What the hour costs Safe QLD, in cents, excluding GST. */
  costCentsPerHour: number;
  /** What the client is charged for it, in cents, excluding GST. */
  sellCentsPerHour: number;
  /** As a fraction: 0.1 for GST at ten per cent. */
  taxRate: number;
  /** Billable hours per worked hour; 1 unless the office system says otherwise. */
  efficiencyMultiplier: number;
  /**
   * A callout rate is not a labour rate at a different number — it bundles
   * travel and an on-site minimum, so it is charged once rather than per hour.
   */
  kind: 'labour' | 'callout';
  hours: HoursBand;
  /**
   * Set on a rate that applies to one customer only.
   *
   * Real rate cards are per-customer far more often than not, and a general
   * rate quietly applied to a customer who negotiated their own is an
   * undercharge nobody notices until the year is reconciled.
   */
  customerName?: string;
  isTemplate?: boolean;
  includesOverhead?: boolean;
}

export interface ServiceFee {
  id: string;
  name: string;
  /** The flat charge in cents, excluding GST. */
  chargeCents: number;
  /** Minutes of labour the flat charge already covers. */
  includedLabourMinutes: number;
  taxRate: number;
  hours: HoursBand;
}

/** Rounds to whole cents, away from zero, the way an invoice does. */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * The margin on a rate, as a fraction of the sell price.
 *
 * Kept as arithmetic, not as a figure: the same cost can carry a very
 * different margin at normal and after hours, and a rate picked by name alone
 * can quietly be the wrong one of those. Nothing on the phone holds a cost
 * rate, so nothing on the phone can call this with a real one — the rate
 * card arrives with cost at zero and a margin from that is not a margin.
 */
export function marginFraction(rate: LabourRate): number | null {
  if (rate.sellCentsPerHour <= 0) return null;
  return (rate.sellCentsPerHour - rate.costCentsPerHour) / rate.sellCentsPerHour;
}

/**
 * Picks the rate to apply.
 *
 * A rate named for the customer wins over a general one. Where a customer has
 * several, the kind and hours decide; where nothing matches, this returns
 * nothing rather than falling back to a general rate, because silently billing
 * a negotiated account at list price is the failure that matters here.
 */
export function selectRate(
  rates: LabourRate[],
  want: { hours: HoursBand; kind: LabourRate['kind']; customerName?: string },
): LabourRate | undefined {
  const matches = rates.filter((r) => r.hours === want.hours && r.kind === want.kind);
  if (want.customerName) {
    const forCustomer = matches.filter(
      (r) => r.customerName && r.customerName.toLowerCase() === want.customerName!.toLowerCase(),
    );
    if (forCustomer.length) return forCustomer[0];
  }
  return matches.find((r) => !r.customerName);
}

export function selectFee(fees: ServiceFee[], hours: HoursBand): ServiceFee | undefined {
  return fees.find((f) => f.hours === hours);
}

export interface ChargeLine {
  label: string;
  /** Hours, or 1 for a flat charge. */
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface AttendanceCharge {
  lines: ChargeLine[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  /** Minutes billed beyond what the attendance fee covers. */
  extraMinutes: number;
  /** Anything the caller should be told before this becomes a quote. */
  warnings: string[];
}

export interface AttendanceInput {
  minutesOnSite: number;
  hours: HoursBand;
  customerName?: string;
  rates: LabourRate[];
  fees: ServiceFee[];
  /** Charge the attendance fee. Off for work inside an existing contract visit. */
  chargeAttendance?: boolean;
}

/**
 * What an attendance comes to.
 *
 * The attendance fee is not a call-out surcharge on top of the hours — it
 * covers a stated number of minutes, and only the minutes past that are billed
 * again. Charging the fee and then every minute double-bills the first two
 * hours of every job.
 */
export function chargeForAttendance(input: AttendanceInput): AttendanceCharge {
  const warnings: string[] = [];
  const lines: ChargeLine[] = [];
  const minutes = Math.max(0, input.minutesOnSite);

  const fee = input.chargeAttendance === false ? undefined : selectFee(input.fees, input.hours);
  if (input.chargeAttendance !== false && !fee) {
    warnings.push(`No ${input.hours === 'normal' ? 'normal hours' : 'after hours'} attendance fee is set up.`);
  }

  let included = 0;
  if (fee) {
    lines.push({ label: fee.name, quantity: 1, unitCents: fee.chargeCents, amountCents: fee.chargeCents });
    included = fee.includedLabourMinutes;
  }

  const extraMinutes = Math.max(0, minutes - included);
  if (extraMinutes > 0) {
    const rate = selectRate(input.rates, { hours: input.hours, kind: 'labour', customerName: input.customerName });
    if (!rate) {
      warnings.push(
        `${extraMinutes} minutes are beyond the attendance allowance but no ` +
        `${input.hours === 'normal' ? 'normal hours' : 'after hours'} labour rate ` +
        `${input.customerName ? `for ${input.customerName} ` : ''}is set up, so they are not on this quote.`,
      );
    } else {
      // The efficiency multiplier turns worked hours into billable ones.
      const hoursBilled = (extraMinutes / 60) * (rate.efficiencyMultiplier || 1);
      const amount = roundCents(hoursBilled * rate.sellCentsPerHour);
      lines.push({
        label: rate.name,
        quantity: Number(hoursBilled.toFixed(4)),
        unitCents: rate.sellCentsPerHour,
        amountCents: amount,
      });
    }
  }

  const subtotalCents = lines.reduce((n, l) => n + l.amountCents, 0);
  // One GST figure on the total rather than per line: rounding each line and
  // adding them can differ from the total by a cent, and the invoice shows the
  // total.
  const taxRate = fee?.taxRate ?? input.rates[0]?.taxRate ?? 0.1;
  const gstCents = roundCents(subtotalCents * taxRate);

  return {
    lines,
    subtotalCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
    extraMinutes,
    warnings,
  };
}

/** Formats whole cents as dollars, for a quote line. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-AU')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parses "$136.88" or "136.88" to whole cents, refusing what it cannot read. */
export function parseCents(value: string): number | undefined {
  const m = value.trim().replace(/[$,\s]/g, '').match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return undefined;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

/**
 * Rate names that will not match anything.
 *
 * A real card carried both "Vaxxas Normal Hours Labour" and "Vaxxax Normal
 * Hours Labour" — one letter apart, and a rate looked up by customer name only
 * finds one of them. Left uncorrected, because the office system is the record
 * and quietly renaming it here would break the match rather than fix it.
 */
export function suspectRateNames(rates: LabourRate[], customers: string[]): string[] {
  const problems: string[] = [];
  const known = customers.map((c) => c.toLowerCase());
  for (const rate of rates) {
    if (!rate.customerName) continue;
    const name = rate.customerName.toLowerCase();
    if (known.includes(name)) continue;
    const near = known.find((c) => withinOneEdit(c, name));
    if (near) {
      problems.push(
        `Rate "${rate.name}" is filed under "${rate.customerName}", which is one character from ` +
        `"${customers[known.indexOf(near)]}". One of the two is a typo, and the rate will not be ` +
        `found for that customer until they match.`,
      );
    }
  }
  return problems;
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
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (shorter.length === longer.length) i++;
    j++;
  }
  return true;
}

/**
 * The rate fields the app stores, as a shape rather than the Prefs type.
 *
 * Prefs lives behind AsyncStorage, and importing it here would drag a native
 * module into a module that is otherwise pure arithmetic. A structural type
 * costs nothing and keeps this testable.
 */
export interface RateCardPrefs {
  normalHoursSellCents: number;
  afterHoursSellCents: number;
  attendanceNormalCents: number;
  attendanceNormalMinutes: number;
  attendanceAfterHoursCents: number;
  attendanceAfterHoursMinutes: number;
}

/**
 * Turns the settings figures into rates and fees the charge functions accept.
 *
 * A rate left at zero is omitted rather than included as a free hour. The
 * distinction matters: an omitted rate makes `chargeForAttendance` warn that
 * nothing is set up, where a zero rate would quietly bill the work at nothing
 * and look like a real answer.
 *
 * Cost is left at zero because the app is not told it. That makes
 * `marginFraction` read 100%, which is wrong, so nothing shown from this card
 * should quote a margin.
 */
export function rateCardFrom(p: RateCardPrefs): { rates: LabourRate[]; fees: ServiceFee[] } {
  const rates: LabourRate[] = [];
  const fees: ServiceFee[] = [];

  const labour = (hours: HoursBand, sell: number, name: string) => {
    if (sell > 0) {
      rates.push({
        id: `${hours}-labour`,
        name,
        costCentsPerHour: 0,
        sellCentsPerHour: sell,
        taxRate: GST,
        efficiencyMultiplier: 1,
        kind: 'labour',
        hours,
      });
    }
  };
  labour('normal', p.normalHoursSellCents, 'Labour — normal hours');
  labour('after-hours', p.afterHoursSellCents, 'Labour — after hours');

  const attendance = (hours: HoursBand, charge: number, minutes: number, name: string) => {
    if (charge > 0) {
      fees.push({
        id: `${hours}-attendance`,
        name,
        chargeCents: charge,
        includedLabourMinutes: Math.max(0, Math.round(minutes)),
        taxRate: GST,
        hours,
      });
    }
  };
  attendance('normal', p.attendanceNormalCents, p.attendanceNormalMinutes, 'Site attendance — normal hours');
  attendance('after-hours', p.attendanceAfterHoursCents, p.attendanceAfterHoursMinutes, 'Site attendance — after hours');

  return { rates, fees };
}

export interface EffectiveCard {
  rates: LabourRate[];
  fees: ServiceFee[];
  /** Where each half came from, because a mixed card is worth knowing about. */
  rateSource: 'office' | 'settings' | 'none';
  feeSource: 'office' | 'settings' | 'none';
  /** In a technician's words, for the screen that shows the money. */
  note: string;
}

/**
 * Which card to actually quote from.
 *
 * The office system wins where it has answered, because it is the record and it
 * changes day to day. It wins per half rather than outright: a key without
 * setup scope commonly reads labour rates and not service fees, and throwing
 * away a typed attendance fee because the labour rates arrived would quietly
 * stop charging attendances.
 *
 * Nothing here falls back silently. Whatever the mix, the note says it, so a
 * figure on a screen can always be traced to where it came from.
 */
export function effectiveRateCard(
  pulled: { rates: LabourRate[]; fees: ServiceFee[]; pulledAt?: string },
  prefs: RateCardPrefs,
): EffectiveCard {
  const typed = rateCardFrom(prefs);

  const rates = pulled.rates.length ? pulled.rates : typed.rates;
  const fees = pulled.fees.length ? pulled.fees : typed.fees;
  const rateSource = pulled.rates.length ? 'office' : typed.rates.length ? 'settings' : 'none';
  const feeSource = pulled.fees.length ? 'office' : typed.fees.length ? 'settings' : 'none';

  const parts: string[] = [];
  if (rateSource === 'office' && feeSource === 'office') {
    parts.push('Rates and attendance fees came from the office system');
  } else {
    if (rateSource === 'office') parts.push('Labour rates came from the office system');
    if (rateSource === 'settings') parts.push('Labour rates are the ones typed into Settings');
    if (rateSource === 'none') parts.push('No labour rate is set anywhere');
    if (feeSource === 'office') parts.push('attendance fees came from the office system');
    if (feeSource === 'settings') parts.push('attendance fees are the ones typed into Settings');
    if (feeSource === 'none') parts.push('no attendance fee is set');
  }

  let note = `${parts.join(', ')}.`;
  if ((rateSource === 'office' || feeSource === 'office') && pulled.pulledAt) {
    note += ` Pulled ${qldIsoDay(pulled.pulledAt) ?? pulled.pulledAt}.`;
  }
  if (rateSource === 'none' && feeSource === 'none') {
    note = 'No rates are set, so labour is shown as hours only.';
  }

  return { rates, fees, rateSource, feeSource, note };
}
