/**
 * How old a detector is, read off its own label.
 *
 * A fire system effectiveness assessment turns on this: three heads sampled,
 * date codes photographed, and the finding is age rather than any fault —
 * "these devices are NOT defective, they have exceeded the manufacturer's
 * recommended service life". Getting that date wrong puts a wrong statement in
 * a report a client acts on, so this module refuses to give one answer where
 * the code genuinely has several.
 *
 * Two things are always true of these codes and both are handled rather than
 * hidden:
 *
 *  - The year is a single digit, so every code repeats every ten years. 6015
 *    is January 2016 or January 2006 or January 1996, and nothing in the code
 *    itself decides which. Every candidate is returned, newest first, and a
 *    known install or commissioning year narrows them.
 *  - Two manufacturers use four digits beginning with the same year and month,
 *    differing only in what the last digit means. Both readings are given
 *    where both are valid, and the one that cannot be valid is dropped with
 *    the reason.
 *
 * Sources are named per format. Where the format comes from a trade supplier
 * rather than the manufacturer, the reading says so and is marked low
 * confidence, because a second-hand format is exactly the sort of thing that
 * is right until it is not.
 */

export type CodeFormat =
  | 'system-sensor'
  | 'hochiki-serial'
  | 'hochiki-batch'
  | 'apollo-mmyy'
  | 'apollo-yymmdd'
  | 'apollo-week-year';

export type Confidence = 'high' | 'medium' | 'low';

export interface FormatSpec {
  id: CodeFormat;
  label: string;
  /** Brands known to use it, lowercased for matching. */
  brands: string[];
  /** Where the format was taken from. Shown with every reading. */
  source: string;
  confidence: Confidence;
  /** What the digits mean, in a technician's words. */
  layout: string;
}

export const FORMATS: Record<CodeFormat, FormatSpec> = {
  'system-sensor': {
    id: 'system-sensor',
    label: 'System Sensor / Notifier — 4-digit date code',
    brands: ['system sensor', 'notifier', 'honeywell'],
    source: "System Sensor date code explanation, and Safe QLD's own effectiveness reporting",
    confidence: 'high',
    layout: 'Year, month, week of month: 6015 is the fifth week of January in a year ending 6.',
  },
  'hochiki-serial': {
    id: 'hochiki-serial',
    label: 'Hochiki — 9-digit serial',
    brands: ['hochiki'],
    source: 'Hochiki Europe application note AP093/ISS1/OCT06, Product Serial & Batch Numbers',
    confidence: 'high',
    layout: 'Year, month, place of manufacture, then a five-digit serial: 012400697 is December 2000, Hochiki Europe.',
  },
  'hochiki-batch': {
    id: 'hochiki-batch',
    label: 'Hochiki — 4-digit batch',
    brands: ['hochiki'],
    source: 'Hochiki Europe application note AP093/ISS1/OCT06, Product Serial & Batch Numbers',
    confidence: 'high',
    layout: 'Year, month, place of manufacture: 0124 is December 2000, Hochiki Europe.',
  },
  'apollo-mmyy': {
    id: 'apollo-mmyy',
    label: 'Apollo — MMYY with a batch suffix',
    brands: ['apollo'],
    source: 'Trade supplier guidance, not an Apollo publication',
    confidence: 'low',
    layout: 'Month and year, then a batch: 0402-25684 is April 2002.',
  },
  'apollo-yymmdd': {
    id: 'apollo-yymmdd',
    label: 'Apollo — YYMMDD',
    brands: ['apollo'],
    source: 'Trade supplier guidance, not an Apollo publication',
    confidence: 'low',
    layout: 'Year, month, day: 020401 is 1 April 2002.',
  },
  'apollo-week-year': {
    id: 'apollo-week-year',
    label: 'Apollo sounders — week and year',
    brands: ['apollo'],
    source: 'Trade supplier guidance, not an Apollo publication',
    confidence: 'low',
    layout: 'Week of the year, then the year: 1502123 is week 15 of 2002.',
  },
};

/** Hochiki's place-of-manufacture digit. An unlisted value is not a Hochiki code. */
export const HOCHIKI_PLACE: Record<string, string> = {
  '1': 'Hochiki Corporation, Japan',
  '2': 'Hochiki Corporation, Japan',
  '3': 'Hochiki Corporation, America',
  '4': 'Hochiki Europe',
};

export type Precision = 'day' | 'week' | 'month';

export interface DateReading {
  format: CodeFormat;
  formatLabel: string;
  year: number;
  month: number;
  /** Week of the month, where the format carries one. */
  week?: number;
  day?: number;
  place?: string;
  precision: Precision;
  /** ISO date. The first of the month where only the month is known. */
  manufactured: string;
  confidence: Confidence;
  source: string;
  /** Anything the technician has to know before writing this in a report. */
  notes: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The date a week-of-month code points at.
 *
 * Taking the first of the month instead would overstate a head's age by up to
 * four weeks, which is the difference between the 10.4 years Safe QLD reported
 * for a week-five January code and the 10.5 the first of the month gives.
 */
const weekStart = (y: number, m: number, week: number) =>
  iso(y, m, Math.min(1 + (week - 1) * 7, daysInMonth(y, m)));

/** Strips the separators a label carries without changing the digits. */
export function normaliseCode(code: string): string {
  return code.replace(/[\s\-_/.:]/g, '').toUpperCase();
}

/**
 * Every calendar year a single year digit could mean.
 *
 * Newest first, never in the future, and no further back than fire detection
 * of this kind existed. A head cannot have been made next year, and offering
 * 1966 as a candidate is noise rather than caution.
 */
function yearCandidates(digit: number, today: Date, earliest = 1980): number[] {
  const thisYear = today.getFullYear();
  const out: number[] = [];
  for (let y = thisYear - (((thisYear % 10) - digit + 10) % 10); y >= earliest; y -= 10) out.push(y);
  return out;
}

/** Two digits from a code, or undefined when they are not a month. */
function monthAt(code: string, at: number): number | undefined {
  const m = Number(code.slice(at, at + 2));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : undefined;
}

export interface ReadOptions {
  /** Restricts the formats tried. Matched loosely against each format's brands. */
  brand?: string;
  today?: Date;
  /**
   * A year the device is known to have been in service — an install date, a
   * commissioning date, the panel's own build year. Candidates later than this
   * are impossible and are dropped.
   */
  knownInServiceYear?: number;
  /**
   * The earliest year the device could have been made — the year the building
   * went up, or the system was first installed. Nothing below it is offered.
   *
   * Given alongside an in-service year this usually leaves one candidate, which
   * is the only circumstance in which a single-digit year code is unambiguous.
   */
  earliestYear?: number;
}

function formatsFor(brand: string | undefined): FormatSpec[] {
  const all = Object.values(FORMATS);
  if (!brand?.trim()) return all;
  const b = brand.trim().toLowerCase();
  const matched = all.filter((f) => f.brands.some((known) => b.includes(known) || known.includes(b)));
  return matched.length ? matched : all;
}

/**
 * Every date the code could be, best first.
 *
 * An empty result is a real answer and is not padded out with a guess. It
 * means the digits do not fit any format this app knows, which is the point at
 * which a technician reads the label rather than trusting a decoder.
 */
export function readDateCode(code: string, options: ReadOptions = {}): DateReading[] {
  const today = options.today ?? new Date();
  const digits = normaliseCode(code).replace(/[^0-9]/g, '');
  if (!digits) return [];

  const out: DateReading[] = [];
  const wanted = new Set(formatsFor(options.brand).map((f) => f.id));
  const floor = options.earliestYear ?? 1980;

  const push = (
    spec: FormatSpec,
    year: number,
    month: number,
    extra: Partial<DateReading> & { precision: Precision; manufactured: string },
  ) => {
    if (options.knownInServiceYear !== undefined && year > options.knownInServiceYear) return;
    if (options.earliestYear !== undefined && year < options.earliestYear) return;
    if (Date.parse(extra.manufactured) > today.getTime()) return;
    out.push({
      format: spec.id,
      formatLabel: spec.label,
      year,
      month,
      confidence: spec.confidence,
      source: spec.source,
      notes: [],
      ...extra,
    });
  };

  // --- Four digits: year, month, then one digit two makers use differently ---
  if (digits.length === 4 || digits.length === 9 || digits.length === 12) {
    const month = monthAt(digits, 1);
    const last = digits[3]!;
    if (month !== undefined) {
      const years = yearCandidates(Number(digits[0]), today, floor);

      // System Sensor's fourth digit is a week of the month, so 1 to 5.
      if (wanted.has('system-sensor') && Number(last) >= 1 && Number(last) <= 5) {
        const spec = FORMATS['system-sensor'];
        for (const year of years) {
          push(spec, year, month, {
            week: Number(last),
            precision: 'week',
            manufactured: weekStart(year, month, Number(last)),
          });
        }
      }

      // Hochiki's is a place of manufacture, so 1 to 4 and nothing else.
      const place = HOCHIKI_PLACE[last];
      const hochikiFormat: CodeFormat = digits.length === 9 ? 'hochiki-serial' : 'hochiki-batch';
      if (place && wanted.has(hochikiFormat) && digits.length !== 12) {
        const spec = FORMATS[hochikiFormat];
        for (const year of years) {
          push(spec, year, month, { place, precision: 'month', manufactured: iso(year, month, 1) });
        }
      }
    }
  }

  // --- Apollo, second-hand formats, all marked low confidence ---
  if (digits.length >= 4 && wanted.has('apollo-mmyy')) {
    const month = monthAt(digits, 0);
    const yy = Number(digits.slice(2, 4));
    if (month !== undefined && Number.isInteger(yy)) {
      const spec = FORMATS['apollo-mmyy'];
      for (const century of [2000, 1900]) {
        push(spec, century + yy, month, { precision: 'month', manufactured: iso(century + yy, month, 1) });
      }
    }
  }
  if (digits.length >= 6 && wanted.has('apollo-yymmdd')) {
    const month = monthAt(digits, 2);
    const yy = Number(digits.slice(0, 2));
    const day = Number(digits.slice(4, 6));
    if (month !== undefined && day >= 1) {
      const spec = FORMATS['apollo-yymmdd'];
      for (const century of [2000, 1900]) {
        // Checked against the month in that year, not against 31: a 31 April
        // written into a date string rolls to 1 May and reads as a confident
        // day-precise reading of a code that fits nothing.
        if (day > daysInMonth(century + yy, month)) continue;
        push(spec, century + yy, month, { day, precision: 'day', manufactured: iso(century + yy, month, day) });
      }
    }
  }
  if (digits.length >= 4 && wanted.has('apollo-week-year')) {
    const week = Number(digits.slice(0, 2));
    const yy = Number(digits.slice(2, 4));
    if (week >= 1 && week <= 53) {
      const spec = FORMATS['apollo-week-year'];
      for (const century of [2000, 1900]) {
        // A week of the year fixes the month within a few days; the first of
        // the month it falls in is close enough for a service life and is not
        // claimed to be more.
        const approx = new Date(Date.UTC(century + yy, 0, 1 + (week - 1) * 7));
        push(spec, century + yy, approx.getUTCMonth() + 1, {
          week,
          precision: 'month',
          manufactured: iso(century + yy, approx.getUTCMonth() + 1, 1),
        });
      }
    }
  }

  // Newest first, and a well-sourced format ahead of a second-hand one where
  // two readings land on the same date.
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => b.manufactured.localeCompare(a.manufactured) || rank[a.confidence] - rank[b.confidence]);

  if (out.length > 1) {
    const years = new Set(out.map((r) => r.year));
    for (const r of out) {
      if (years.size > 1) {
        r.notes.push('The year is one digit, so this code repeats every ten years. An install or commissioning date settles it.');
      }
    }
  }
  const formats = new Set(out.map((r) => r.format));
  if (formats.size > 1) {
    for (const r of out) {
      r.notes.push('More than one manufacturer’s format fits these digits. Read the make off the head before using a date.');
    }
  }
  return out;
}

/**
 * The manufacturer's recommended replacement age for a smoke detector.
 *
 * A manufacturer's recommendation, not a requirement of AS 1851 — the standard
 * does not set a replacement age for point detectors, and a report that says it
 * does is wrong. Kept adjustable because it is a manufacturer figure and
 * manufacturers differ.
 */
export const RECOMMENDED_LIFE_YEARS = 10;

export const LIFE_SOURCE =
  'A manufacturer recommendation, not an AS 1851 requirement. AS 1851 sets no replacement age for point detectors.';

/** Age in years to one decimal, which is the precision a report should quote. */
export function ageYears(reading: DateReading, at: Date): number {
  const made = Date.parse(reading.manufactured);
  if (!Number.isFinite(made)) return 0;
  const years = (at.getTime() - made) / (365.25 * 24 * 3_600_000);
  return Math.round(years * 10) / 10;
}

export interface LifeVerdict {
  ageYears: number;
  past: boolean;
  /** Whole years remaining, or 0 once past. */
  yearsLeft: number;
  label: string;
}

export function serviceLife(
  reading: DateReading,
  at: Date,
  lifeYears = RECOMMENDED_LIFE_YEARS,
): LifeVerdict {
  const age = ageYears(reading, at);
  const past = age >= lifeYears;
  return {
    ageYears: age,
    past,
    yearsLeft: past ? 0 : Math.round((lifeYears - age) * 10) / 10,
    label: past
      ? `${age} years old — past the ${lifeYears}-year recommended replacement age. Age alone is not a defect.`
      : `${age} years old — ${Math.round((lifeYears - age) * 10) / 10} years inside the ${lifeYears}-year recommended replacement age.`,
  };
}
