/**
 * Resistor colour code decoding and encoding (IEC 60062).
 *
 * Covers 3, 4, 5 and 6 band resistors in both directions: bands to a value, and
 * a value back to the bands you should see. The reverse direction is the one
 * that gets used in the field — you know you need 4k7 and want to confirm the
 * part in your hand is right.
 */

export type BandColour =
  | 'black' | 'brown' | 'red' | 'orange' | 'yellow'
  | 'green' | 'blue' | 'violet' | 'grey' | 'white'
  | 'gold' | 'silver' | 'none';

export interface ColourSpec {
  colour: BandColour;
  label: string;
  /** Hex for the swatch. */
  hex: string;
  /** True when the swatch needs a border to be visible on a dark background. */
  needsOutline?: boolean;
  digit?: number;
  multiplier?: number;
  /** Tolerance as a percentage. */
  tolerance?: number;
  /** Temperature coefficient in ppm/K. */
  tcr?: number;
}

export const COLOURS: ColourSpec[] = [
  { colour: 'black',  label: 'Black',  hex: '#1A1A1A', needsOutline: true, digit: 0, multiplier: 1,      tcr: 250 },
  { colour: 'brown',  label: 'Brown',  hex: '#8B4513', digit: 1, multiplier: 10,      tolerance: 1,    tcr: 100 },
  { colour: 'red',    label: 'Red',    hex: '#D32F2F', digit: 2, multiplier: 100,     tolerance: 2,    tcr: 50 },
  { colour: 'orange', label: 'Orange', hex: '#F57C00', digit: 3, multiplier: 1e3,                      tcr: 15 },
  { colour: 'yellow', label: 'Yellow', hex: '#FBC02D', digit: 4, multiplier: 1e4,                      tcr: 25 },
  { colour: 'green',  label: 'Green',  hex: '#388E3C', digit: 5, multiplier: 1e5,     tolerance: 0.5,  tcr: 20 },
  { colour: 'blue',   label: 'Blue',   hex: '#1976D2', digit: 6, multiplier: 1e6,     tolerance: 0.25, tcr: 10 },
  { colour: 'violet', label: 'Violet', hex: '#7B1FA2', digit: 7, multiplier: 1e7,     tolerance: 0.1,  tcr: 5 },
  { colour: 'grey',   label: 'Grey',   hex: '#757575', digit: 8, multiplier: 1e8,     tolerance: 0.05, tcr: 1 },
  { colour: 'white',  label: 'White',  hex: '#F5F5F5', needsOutline: true, digit: 9, multiplier: 1e9 },
  { colour: 'gold',   label: 'Gold',   hex: '#C9A227', multiplier: 0.1,  tolerance: 5 },
  { colour: 'silver', label: 'Silver', hex: '#B0BEC5', multiplier: 0.01, tolerance: 10 },
  { colour: 'none',   label: 'None',   hex: 'transparent', needsOutline: true, tolerance: 20 },
];

const BY_COLOUR = new Map(COLOURS.map((c) => [c.colour, c]));

export function colourSpec(c: BandColour): ColourSpec | undefined {
  return BY_COLOUR.get(c);
}

/** Colours valid in each band position, for building the pickers. */
export const DIGIT_COLOURS = COLOURS.filter((c) => c.digit !== undefined).map((c) => c.colour);
export const MULTIPLIER_COLOURS = COLOURS.filter((c) => c.multiplier !== undefined).map((c) => c.colour);
export const TOLERANCE_COLOURS = COLOURS.filter((c) => c.tolerance !== undefined).map((c) => c.colour);
export const TCR_COLOURS = COLOURS.filter((c) => c.tcr !== undefined).map((c) => c.colour);

export type BandCount = 3 | 4 | 5 | 6;

export interface DecodeResult {
  ok: boolean;
  /** Nominal resistance in ohms. */
  ohms?: number;
  tolerancePct?: number;
  tcrPpm?: number;
  /** Bounds implied by the tolerance. */
  minOhms?: number;
  maxOhms?: number;
  /** Formatted value, e.g. "4.7 kΩ". */
  display?: string;
  /** Value in the shorthand techs write on drawings, e.g. "4k7". */
  shorthand?: string;
  error?: string;
}

/**
 * Decodes a band sequence.
 *
 * Band layout by count:
 *   3 — digit, digit, multiplier (tolerance implied ±20%)
 *   4 — digit, digit, multiplier, tolerance
 *   5 — digit, digit, digit, multiplier, tolerance
 *   6 — digit, digit, digit, multiplier, tolerance, temperature coefficient
 */
export function decodeBands(bands: BandColour[], count: BandCount): DecodeResult {
  if (bands.length < count) return { ok: false, error: `Select all ${count} bands.` };

  const digitCount = count >= 5 ? 3 : 2;
  let digits = 0;

  for (let i = 0; i < digitCount; i++) {
    const spec = BY_COLOUR.get(bands[i]!);
    if (!spec || spec.digit === undefined) {
      return { ok: false, error: `Band ${i + 1} cannot be ${spec?.label ?? bands[i]} — it must carry a digit.` };
    }
    digits = digits * 10 + spec.digit;
  }

  const multSpec = BY_COLOUR.get(bands[digitCount]!);
  if (!multSpec || multSpec.multiplier === undefined) {
    return { ok: false, error: `The multiplier band cannot be ${multSpec?.label ?? bands[digitCount]}.` };
  }

  let tolerancePct = 20;
  if (count >= 4) {
    const tolSpec = BY_COLOUR.get(bands[digitCount + 1]!);
    if (!tolSpec || tolSpec.tolerance === undefined) {
      return { ok: false, error: `The tolerance band cannot be ${tolSpec?.label ?? bands[digitCount + 1]}.` };
    }
    tolerancePct = tolSpec.tolerance;
  }

  let tcrPpm: number | undefined;
  if (count === 6) {
    const tcrSpec = BY_COLOUR.get(bands[digitCount + 2]!);
    if (!tcrSpec || tcrSpec.tcr === undefined) {
      return { ok: false, error: `The temperature coefficient band cannot be ${tcrSpec?.label ?? bands[digitCount + 2]}.` };
    }
    tcrPpm = tcrSpec.tcr;
  }

  const ohms = digits * multSpec.multiplier;

  return {
    ok: true,
    ohms,
    tolerancePct,
    tcrPpm,
    minOhms: ohms * (1 - tolerancePct / 100),
    maxOhms: ohms * (1 + tolerancePct / 100),
    display: formatOhms(ohms),
    shorthand: shorthandOhms(ohms),
  };
}

const UNITS: { limit: number; div: number; suffix: string; letter: string }[] = [
  { limit: 1e9, div: 1e9, suffix: 'GΩ', letter: 'G' },
  { limit: 1e6, div: 1e6, suffix: 'MΩ', letter: 'M' },
  { limit: 1e3, div: 1e3, suffix: 'kΩ', letter: 'k' },
  { limit: 0, div: 1, suffix: 'Ω', letter: 'R' },
];

/** Formats ohms with an SI prefix, e.g. 4700 -> "4.7 kΩ". */
export function formatOhms(ohms: number): string {
  if (!Number.isFinite(ohms)) return '—';
  const u = UNITS.find((x) => Math.abs(ohms) >= x.limit) ?? UNITS[UNITS.length - 1]!;
  const v = ohms / u.div;
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  // Trim trailing zeros only after a decimal point — "220" must not become "22".
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return `${trimmed} ${u.suffix}`;
}

/**
 * The shorthand written on drawings and schedules, where the multiplier letter
 * replaces the decimal point: 4700 -> "4k7", 0.22 -> "R22".
 */
export function shorthandOhms(ohms: number): string {
  if (!Number.isFinite(ohms)) return '—';
  const u = UNITS.find((x) => Math.abs(ohms) >= x.limit) ?? UNITS[UNITS.length - 1]!;
  const v = ohms / u.div;
  const rounded = Math.round(v * 100) / 100;
  const whole = Math.floor(rounded);
  const frac = Math.round((rounded - whole) * 100);
  if (frac === 0) return `${whole}${u.letter}`;
  const fracStr = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${whole}${u.letter}${fracStr}`;
}

/** Parses "4k7", "4.7k", "470R", "1M0", "220" into ohms. */
export function parseOhms(input: string): number | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '').replace(/OHMS?|Ω/g, '');
  if (!s) return null;

  // Shorthand with the letter as decimal point: 4K7, R22, 1M0.
  const short = s.match(/^(\d*)([RKMG])(\d*)$/);
  if (short) {
    const mult = { R: 1, K: 1e3, M: 1e6, G: 1e9 }[short[2]!]!;
    const whole = short[1] ? parseInt(short[1], 10) : 0;
    const frac = short[3] ? parseFloat(`0.${short[3]}`) : 0;
    return (whole + frac) * mult;
  }

  // Plain number with optional suffix: 4.7K, 470, 1M.
  const plain = s.match(/^(\d*\.?\d+)([RKMG])?$/);
  if (plain) {
    const mult = plain[2] ? { R: 1, K: 1e3, M: 1e6, G: 1e9 }[plain[2]]! : 1;
    return parseFloat(plain[1]!) * mult;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Preferred values
// ---------------------------------------------------------------------------

export const E6 = [10, 15, 22, 33, 47, 68];
export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export const E24 = [
  10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30,
  33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91,
];
export const E96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130,
  133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174,
  178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232,
  237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
  316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412,
  422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549,
  562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732,
  750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
];
/** E48 is every second E96 value. */
export const E48 = E96.filter((_, i) => i % 2 === 0);

export type ESeries = 'E6' | 'E12' | 'E24' | 'E48' | 'E96';

const SERIES: Record<ESeries, number[]> = { E6, E12, E24, E48, E96 };

/** True when a value is a preferred value in the given series. */
export function isPreferredValue(ohms: number, series: ESeries): boolean {
  const base = SERIES[series];
  // Normalise into the series' own decade: E6/E12/E24 are 2-digit, E48/E96 3-digit.
  const digits = series === 'E48' || series === 'E96' ? 3 : 2;
  const target = normaliseMantissa(ohms, digits);
  if (target === null) return false;
  return base.some((v) => Math.abs(v - target) < 0.5);
}

/** Nearest preferred value in a series, in ohms. */
export function nearestPreferred(ohms: number, series: ESeries): number | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const base = SERIES[series];
  const digits = series === 'E48' || series === 'E96' ? 3 : 2;
  const decade = Math.floor(Math.log10(ohms)) - (digits - 1);
  let best: number | null = null;
  let bestErr = Infinity;
  // Check the decade below and above too, so a value near a decade boundary
  // does not miss the closer candidate.
  for (const d of [decade - 1, decade, decade + 1]) {
    for (const v of base) {
      const candidate = v * 10 ** d;
      const err = Math.abs(candidate - ohms);
      if (err < bestErr) {
        bestErr = err;
        best = candidate;
      }
    }
  }
  return best;
}

function normaliseMantissa(ohms: number, digits: number): number | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const exp = Math.floor(Math.log10(ohms)) - (digits - 1);
  return Math.round(ohms / 10 ** exp);
}

/**
 * Produces the band sequence for a value.
 *
 * Returns null where the value cannot be shown in the requested band count —
 * a 3-significant-figure value has no 4-band representation.
 */
export function encodeBands(ohms: number, count: BandCount, tolerancePct = 5, tcrPpm?: number): BandColour[] | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;

  const digitCount = count >= 5 ? 3 : 2;
  const exp = Math.floor(Math.log10(ohms)) - (digitCount - 1);
  const mantissa = Math.round(ohms / 10 ** exp);

  // Rounding can carry into an extra digit, e.g. 99.6 -> 100 on two digits.
  const maxMantissa = 10 ** digitCount - 1;
  const adjusted = mantissa > maxMantissa ? { m: Math.round(mantissa / 10), e: exp + 1 } : { m: mantissa, e: exp };

  // The value must be representable exactly at this precision.
  if (Math.abs(adjusted.m * 10 ** adjusted.e - ohms) > Math.abs(ohms) * 1e-9) return null;

  const multiplier = 10 ** adjusted.e;
  const multSpec = COLOURS.find((c) => c.multiplier !== undefined && Math.abs(c.multiplier - multiplier) < multiplier * 1e-9);
  if (!multSpec) return null;

  const bands: BandColour[] = [];
  const digitsStr = String(adjusted.m).padStart(digitCount, '0');
  for (const ch of digitsStr) {
    const spec = COLOURS.find((c) => c.digit === Number(ch));
    if (!spec) return null;
    bands.push(spec.colour);
  }
  bands.push(multSpec.colour);

  if (count >= 4) {
    const tolSpec = COLOURS.find((c) => c.tolerance === tolerancePct);
    if (!tolSpec) return null;
    bands.push(tolSpec.colour);
  }

  if (count === 6) {
    const tcrSpec = COLOURS.find((c) => c.tcr === tcrPpm);
    if (!tcrSpec) return null;
    bands.push(tcrSpec.colour);
  }

  return bands;
}
