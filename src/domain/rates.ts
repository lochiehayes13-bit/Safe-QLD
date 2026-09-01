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

export type HoursBand = 'normal' | 'after-hours';

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
 * Worth surfacing rather than leaving implicit: on a real card the same cost
 * carried a 15% margin at normal hours and 41% after hours, and a rate picked
 * by name alone can quietly be the wrong one of those.
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
