import { QUANTITIES, convert, type Unit } from '@/calc/units';

/**
 * What an asset's measurements have been doing over its life.
 *
 * Every routine writes a number against an asset — a residual pressure, a
 * terminal voltage, a discharge duration — and the app has never looked across
 * them. A single reading is only a pass or a fail. The sequence is the
 * engineering signal: a hydrant whose residual has fallen 15% over three
 * services is failing before it fails, and the service where it finally fails
 * is the one where somebody finds out.
 *
 * The reason this is hard is that most of what looks like a trend is not one,
 * and a confident wrong trend is worse than no trend at all — it books a valve
 * replacement for a hydrant whose main was simply busier that morning. So the
 * refusals here are the substance of the module, not its edges:
 *
 *  - Two points is a line through noise. Nothing is trended below
 *    MINIMUM_POINTS, and the refusal says so rather than fitting anyway.
 *  - Readings in different units are never silently combined. Where they are
 *    the same quantity they are converted and the conversion is reported;
 *    where they are not — a kPa among the volts — the whole series is refused,
 *    naming both units.
 *  - A key whose meaning changed splits the history in two. "Gauge reading or
 *    mass" is a real key in this app's own routine table and it holds two
 *    different quantities depending on the extinguisher; a trend through both
 *    is arithmetic, not engineering.
 *  - A step is not a drift. A hydrant that dropped 40% between two services had
 *    something happen to it — a valve part-shut, a main broken and repaired, a
 *    new connection upstream — and that is an investigation, not a decline
 *    curve. Where the step falls inside a long gap between services the two
 *    cannot be told apart, and the module says that instead of choosing.
 *  - A short series is a season. South East Queensland mains demand rises
 *    sharply in a hot summer, so a residual measured in January is not
 *    comparable with one measured in July, and neither is a battery voltage
 *    read in a hot switch room. Anything spanning less than a year is marked.
 *
 * Every outside fact used to justify a caution carries its source and a
 * confidence in the data itself, not in a comment, so a technician reading a
 * caution on site can see who said it.
 *
 * Nothing here touches the database. It takes plain arrays of dated numbers,
 * which is what makes the decisions testable.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type Confidence = 'low' | 'medium' | 'high';

/** A fact that came from outside this module, with where it came from. */
export interface Provenance {
  /** The fact, in our own words. */
  fact: string;
  source: string;
  url?: string;
  confidence: Confidence;
}

/**
 * Things that move a measurement without the asset changing at all.
 *
 * These are the reason a trend is advisory. Each is held with its source
 * because a technician challenged on site ("the pressure is down because the
 * hydrant is failing") needs to be able to say who says otherwise.
 */
export const CONFOUNDER_SEQ_DEMAND: Provenance = {
  fact:
    'South East Queensland mains demand swings hard with the weather: regional use peaked at an '
    + 'average 239 litres per person per day in a hot January against about 170 across the year. '
    + 'Higher demand means lower pressure at the hydrant, with nothing wrong at the site.',
  source: 'Seqwater — SEQ water use at record high since the Millennium Drought',
  url: 'https://www.seqwater.com.au/news/seq-water-use-record-high-millennium-drought',
  confidence: 'high',
};

export const CONFOUNDER_NETWORK_NOT_GUARANTEED: Provenance = {
  fact:
    'The water utility does not guarantee any minimum flow or pressure to a private fire system, '
    + 'and says its available network capacity varies over time with how the network is operated '
    + 'and with customer demand. A falling residual can be the street, not the property.',
  source: 'Queensland Urban Utilities — Private Fire Systems Guideline, July 2017 V1.0',
  url: 'https://www.urbanutilities.com.au/sfsites/c/cms/delivery/media/MCHP2ULEYLZ5GOVDEYRD5XIZZHTQ',
  confidence: 'high',
};

export const CONFOUNDER_BATTERY_TEMPERATURE: Provenance = {
  fact:
    'Float voltage is temperature dependent — a coefficient of about −2 mV per cell per °C below '
    + '20 °C in float use, on a recommended float of 2.25–2.30 V per cell. A 24 V string read in a '
    + 'hot switch room in February and a cool one in July can differ by a few tenths of a volt with '
    + 'the same battery and the same charger.',
  source: 'Power-Sonic — How to charge a lead acid battery (manufacturer technical guidance)',
  url: 'https://www.power-sonic.com/how-to-charge-a-lead-acid-battery/',
  confidence: 'high',
};

export const CONFOUNDER_CONDUCTOR_TEMPERATURE: Provenance = {
  fact:
    'Conductor resistance rises with temperature, so a loop measured on a roof at midday reads '
    + 'higher than the same loop measured at 7am. Compare impedance readings taken in comparable '
    + 'conditions before calling a rise deterioration.',
  source: 'Own engineering reasoning — no measured figure is claimed here',
  confidence: 'medium',
};

export const CONFOUNDER_RECHARGE_STATE: Provenance = {
  fact:
    'A discharge duration is only meaningful from a fully recharged fitting. A unit tested a day '
    + 'after the last test reads short because it was not full, not because the battery has aged.',
  source: 'Own engineering reasoning',
  confidence: 'medium',
};

export const CONFOUNDER_SPL_POSITION: Provenance = {
  fact:
    'Sound pressure level depends on where the meter was held and what the room was doing. Unless '
    + 'the reading was taken at the commissioning position with comparable ambient noise, a change '
    + 'between services may be the measurement rather than the speaker.',
  source: 'Own engineering reasoning',
  confidence: 'medium',
};

// ---------------------------------------------------------------------------
// Measurement kinds
// ---------------------------------------------------------------------------

/** Which way a measurement moves as the asset gets worse. */
export type Deterioration = 'falling' | 'rising';

export interface MeasurementKind {
  id: string;
  label: string;
  /** Lowercased fragments matched against the recorded key. */
  match: string[];
  /** The unit this app's routine table records it in. */
  unit: string;
  deterioration: Deterioration;
  /** Set where one key holds more than one quantity, which cannot be trended together. */
  ambiguous?: string;
  confounders: Provenance[];
}

/**
 * The measurement keys this app's own routines write, and what they mean.
 *
 * The keys and units come from src/seed/serviceRoutines.ts, so this table and
 * the routine that records the number cannot drift apart. Which direction is
 * deterioration is engineering interpretation and is stated as that: for a key
 * not listed here the module reports the direction of movement and refuses to
 * say whether it is good news, because it does not know.
 */
export const MEASUREMENT_KINDS: MeasurementKind[] = [
  {
    id: 'residual-pressure',
    label: 'Hydrant residual pressure',
    match: ['residual pressure', 'running pressure', 'duty point pressure', 'test pressure'],
    unit: 'kPa',
    deterioration: 'falling',
    confounders: [CONFOUNDER_SEQ_DEMAND, CONFOUNDER_NETWORK_NOT_GUARANTEED],
  },
  {
    id: 'static-pressure',
    label: 'Static pressure',
    match: ['static pressure', 'start pressure', 'churn pressure'],
    unit: 'kPa',
    deterioration: 'falling',
    confounders: [CONFOUNDER_SEQ_DEMAND, CONFOUNDER_NETWORK_NOT_GUARANTEED],
  },
  {
    id: 'flow',
    label: 'Flow',
    match: ['flow rate', 'flow'],
    unit: 'L/min',
    deterioration: 'falling',
    confounders: [CONFOUNDER_SEQ_DEMAND, CONFOUNDER_NETWORK_NOT_GUARANTEED],
  },
  {
    id: 'battery-voltage',
    label: 'Battery terminal voltage',
    match: ['battery terminal voltage', 'final terminal voltage', 'terminal voltage'],
    unit: 'V',
    deterioration: 'falling',
    confounders: [CONFOUNDER_BATTERY_TEMPERATURE],
  },
  {
    id: 'quiescent-current',
    label: 'Quiescent current',
    match: ['quiescent current'],
    unit: 'A',
    // A rising standby draw is load creeping onto the panel, or a device
    // failing wet. It shortens standby time, so up is the bad direction.
    deterioration: 'rising',
    confounders: [],
  },
  {
    id: 'impedance',
    label: 'Circuit impedance',
    match: ['circuit impedance', 'impedance', 'loop resistance'],
    unit: 'Ω',
    deterioration: 'rising',
    confounders: [CONFOUNDER_CONDUCTOR_TEMPERATURE],
  },
  {
    id: 'duration',
    label: 'Duration achieved',
    match: ['duration achieved', 'duration sustained', 'duration'],
    unit: 'min',
    deterioration: 'falling',
    confounders: [CONFOUNDER_RECHARGE_STATE],
  },
  {
    id: 'spl',
    label: 'Sound pressure level',
    match: ['sound pressure level'],
    unit: 'dB(A)',
    deterioration: 'falling',
    confounders: [CONFOUNDER_SPL_POSITION],
  },
  {
    id: 'charged-mass',
    label: 'Charged mass',
    match: ['charged mass'],
    unit: 'kg',
    deterioration: 'falling',
    confounders: [],
  },
  {
    id: 'gauge-or-mass',
    label: 'Gauge reading or mass',
    match: ['gauge reading or mass'],
    unit: 'kPa or kg',
    deterioration: 'falling',
    ambiguous:
      'This key records a gauge pressure on a stored-pressure extinguisher and a mass on a CO₂ '
      + 'one. Two different quantities under one name cannot be trended together, and the unit '
      + 'recorded with each reading is the only thing that separates them.',
    confounders: [],
  },
  {
    id: 'tank-level',
    label: 'Tank level',
    match: ['tank level'],
    unit: '%',
    deterioration: 'falling',
    confounders: [],
  },
  {
    id: 'time-to-alarm',
    label: 'Time to alarm',
    match: ['time to alarm', 'transport time'],
    unit: 's',
    deterioration: 'rising',
    confounders: [],
  },
];

/** The kind a recorded key belongs to, or undefined where the app does not know it. */
export function kindForKey(key: string): MeasurementKind | undefined {
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  // Longest fragment first, so "residual pressure" beats a bare "pressure".
  const candidates = MEASUREMENT_KINDS
    .flatMap((kind) => kind.match.map((m) => ({ kind, m })))
    .sort((a, b) => b.m.length - a.m.length);
  return candidates.find(({ m }) => k === m || k.includes(m))?.kind;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Queensland is UTC+10 in every month of the year and never shifts. */
export const QLD_UTC_OFFSET_HOURS = 10;

const YEAR_MS = 365.25 * 24 * 3_600_000;
const DAY_MS = 86_400_000;

/** Milliseconds for an ISO date or timestamp, or undefined when it is neither. */
export function instantOf(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const text = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const ms = Date.parse(`${text}T00:00:00Z`);
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The Queensland calendar date at an instant, as an ISO date. */
export function qldDateOf(ms: number): string {
  return new Date(ms + QLD_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** d/m/yyyy. Never m/d/y — an Australian service record is read by Australians. */
export function formatAuDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "March 2028".
 *
 * A projection is never given to the day. Quoting 14/3/2028 for something
 * derived from four readings invites it to be booked, and the honest precision
 * of a fitted line through service data is a month at best.
 */
export function formatAuMonth(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------------------
// Reading a recorded measurement
// ---------------------------------------------------------------------------

export type MeasurementParse =
  | { ok: true; value: number; unit?: string }
  | { ok: false; reason: string };

/**
 * Turns what was actually typed into a number and a unit, or refuses.
 *
 * Measurements are stored as free text as often as not, and the refusals here
 * are the ones that matter in the field. "greater than 600 kPa" is a censored
 * reading: the real value is unknown and putting 600 in a trend flattens a
 * curve that may be steep. "400-420" is two readings pretending to be one.
 * "1,2" cannot be told from 1.2 or 12 hundred. None of them is worth guessing
 * at when the cost of a guess is a wrong rate of decline.
 */
export function parseMeasurement(raw: string | number | null | undefined): MeasurementParse {
  if (raw === null || raw === undefined) return { ok: false, reason: 'nothing was recorded' };
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: 'the recorded number is not finite' };
  }

  const text = raw.trim();
  if (!text) return { ok: false, reason: 'nothing was recorded' };

  if (/^(n\/?a|nil|none|pass|fail|ok|good|yes|no)$/i.test(text)) {
    return { ok: false, reason: `"${text}" is a verdict, not a measurement` };
  }
  if (/^[<>≤≥~≈]|^(approx|about|circa|over|under)\b/i.test(text)) {
    return {
      ok: false,
      reason: `"${text}" is a limit or an approximation, so the real value is unknown. `
        + 'Trending the number written next to it would understate or overstate the change.',
    };
  }
  if (/\d\s*(?:-|–|to)\s*\d/i.test(text) && !/^\d{4}-\d{2}/.test(text)) {
    return { ok: false, reason: `"${text}" is a range, not a reading` };
  }
  // A lone comma between digits is either a decimal point or a thousands
  // separator and the two differ by a factor of a thousand.
  if (/\d,\d(?!\d\d)/.test(text)) {
    return {
      ok: false,
      reason: `"${text}" uses a comma that could be a decimal point or a thousands separator`,
    };
  }

  const cleaned = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { ok: false, reason: `"${text}" does not start with a number` };

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a number` };
  const unit = m[2]?.trim();
  return unit ? { ok: true, value, unit } : { ok: true, value };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

interface UnitMatch {
  quantityId: string;
  unit: Unit;
}

/**
 * Every unit in the app's conversion table that a written symbol could mean.
 *
 * More than one match across different quantities is an ambiguity, not a
 * choice: picking one would convert a pressure into a length.
 */
function lookupUnit(symbol: string): UnitMatch[] {
  const s = symbol.trim().toLowerCase();
  if (!s) return [];
  const out: UnitMatch[] = [];
  for (const q of QUANTITIES) {
    for (const u of q.units) {
      if (u.symbol.toLowerCase() === s || u.id.toLowerCase() === s) out.push({ quantityId: q.id, unit: u });
    }
  }
  return out;
}

const normaliseUnit = (u: string | undefined): string | undefined => {
  const s = u?.trim().replace(/\s+/g, ' ');
  return s ? s : undefined;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface MeasurementPoint {
  /** ISO date or timestamp of the service that took the reading. */
  at: string;
  value: number;
  /** The unit as recorded. Undefined means the record does not say. */
  unit?: string;
  /** The event the reading came from, so a point on a chart is traceable. */
  eventId?: string;
  technician?: string;
  note?: string;
}

export interface MeasurementSeries {
  assetId: string;
  assetName?: string;
  /** The measurement key as recorded, e.g. "Residual pressure". */
  key: string;
  points: MeasurementPoint[];
  /**
   * Which direction is deterioration, where the caller knows and this module
   * does not. Without it an unrecognised key is trended but not judged.
   */
  deterioration?: Deterioration;
}

/**
 * Something done to the asset that resets its history.
 *
 * A battery replaced, a valve rebuilt, a main repaired: the readings either
 * side belong to two different things wearing the same tag, and a step that
 * lines up with one of these is explained rather than suspicious.
 */
export interface Intervention {
  at: string;
  what: string;
}

/** A date on and after which the key means something different. */
export interface KeyRedefinition {
  at: string;
  what: string;
}

export interface TrendOptions {
  today?: string;
  /** Below this many usable points nothing is trended. Default MINIMUM_POINTS. */
  minimumPoints?: number;
  /** Ignores everything before this ISO date. */
  from?: string;
  /** The unit to read unstated readings as — normally the routine's own unit. */
  assumeUnit?: string;
  interventions?: Intervention[];
  keyChanges?: KeyRedefinition[];
  /** Fraction of the earlier reading a single interval must move to be a step. */
  stepRelative?: number;
  /** How many times the typical rate the stepping interval must move. */
  stepDominance?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Three readings.
 *
 * Two points always fit a straight line perfectly, so a two-point "trend"
 * reports a rate with no way of knowing whether it is a rate at all — it is
 * the difference between two numbers, at least one of which has measurement
 * error in it. Three is the smallest series in which the data can disagree
 * with the line, and even three is reported at low confidence.
 */
export const MINIMUM_POINTS = 3;

/** A year of readings, below which a trend and a season look identical. */
export const SEASONAL_SPAN_DAYS = 365;

/** Movement smaller than this a year is called flat rather than a direction. */
export const FLAT_PERCENT_PER_YEAR = 1;

/** How far one interval must move to be considered a step. */
export const DEFAULT_STEP_RELATIVE = 0.15;

/** How many times the typical rate the stepping interval must move. */
export const DEFAULT_STEP_DOMINANCE = 3;

/** Below this the readings do not sit on a line and no rate is worth quoting. */
export const SCATTER_R2 = 0.25;

/**
 * A gap longer than this multiple of the typical service interval hides the
 * difference between a step and a steady decline, because nobody was there.
 */
export const GAP_RATIO_UNRESOLVABLE = 1.5;

/**
 * The narrowest the rate is ever treated as being known, as a fraction of it.
 *
 * Four service readings that happen to fall exactly on a line make the
 * statistical uncertainty zero, and a projection would then name a week. That
 * is luck, not precision: these are gauge readings taken by different people on
 * different days, and a floor of fifteen per cent on the rate keeps the
 * projection honest about what a field measurement is worth.
 */
export const PROJECTION_MINIMUM_RATE_UNCERTAINTY = 0.15;

export const PROJECTION_ASSUMPTION =
  'This is what the numbers do if nothing changes, and nothing here knows whether it will. A '
  + 'partly shut valve stays shut until somebody opens it; a corroding main keeps corroding; a '
  + 'summer dip reverses on its own in April. Read it as when to look again, not as when it fails.';

export const RANKING_CAVEAT =
  'Ranked by the percentage of the first reading lost each year, not by absolute rate: 3 kPa a '
  + 'year and 3 volts a year are not the same quantity and ranking them together would put every '
  + 'hydrant above every battery. Rows differ in how much they are worth believing — read the '
  + 'confidence and the span before booking work off this list.';

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type TrendStatus =
  | 'trend'
  /** Fewer usable readings than the minimum. */
  | 'insufficient'
  /** Readings in units that are not the same quantity. */
  | 'mixed-units'
  /** One key holding two quantities, with nothing to separate them. */
  | 'ambiguous-key'
  /** The key changed meaning inside the series. */
  | 'key-redefined'
  /** Every reading on the same day: a set of repeats, not a history. */
  | 'no-time-span';

export type TrendDirection = 'falling' | 'rising' | 'flat';

export type TrendShape = 'drift' | 'step' | 'unclear';

export type Interpretation = 'deteriorating' | 'improving' | 'stable' | 'unknown';

export type CautionCode =
  | 'seasonal'
  | 'sparse'
  | 'scatter'
  | 'step'
  | 'step-in-gap'
  | 'no-variation'
  | 'unit-unstated'
  | 'unit-converted'
  | 'same-day-readings'
  | 'perfect-fit'
  | 'confounded'
  | 'excluded-readings'
  | 'unknown-key';

export interface TrendCaution {
  code: CautionCode;
  message: string;
  /** Where the caution's claim comes from, when it rests on an outside fact. */
  provenance?: Provenance;
}

export interface ExcludedPoint {
  point: MeasurementPoint;
  reason: string;
}

export interface LinearFit {
  /** Units of the measurement per year. */
  slopePerYear: number;
  /** The mean reading, which the fitted line passes through at meanYears. */
  meanValue: number;
  meanYears: number;
  r2: number;
  /** Standard error of the slope, or undefined with only three points and a perfect fit. */
  slopeStdError: number;
  /** Points fitted, which sets the degrees of freedom. */
  n: number;
}

export interface StepChange {
  from: MeasurementPoint;
  to: MeasurementPoint;
  delta: number;
  percent: number;
  days: number;
  /**
   * False when the step sits inside a gap long enough that a steady decline
   * across the gap would look exactly the same.
   */
  distinguishable: boolean;
  /** The recorded work that explains it, where one lines up. */
  explanation?: Intervention;
  message: string;
}

export interface MeasurementTrend {
  assetId: string;
  assetName?: string;
  key: string;
  kind?: MeasurementKind;
  /** Which way is deterioration, from the catalogue or from the caller. */
  deterioration?: Deterioration;
  status: TrendStatus;
  /** Why there is no trend. Present on every status except 'trend'. */
  refusal?: string;
  /** The readings the fit used, in date order and in a single unit. */
  used: MeasurementPoint[];
  excluded: ExcludedPoint[];
  /** The unit everything was normalised to, or undefined when none was recorded. */
  unit?: string;
  /** Conversions applied to get there, so a converted number is never silent. */
  conversions: { from: string; to: string; count: number }[];
  first?: MeasurementPoint;
  last?: MeasurementPoint;
  spanDays?: number;
  direction?: TrendDirection;
  /** True when the fitted rate is distinguishable from no change at all. */
  significant?: boolean;
  shape?: TrendShape;
  step?: StepChange;
  fit?: LinearFit;
  ratePerYear?: number;
  /** As a percentage of the first reading, which is what makes assets comparable. */
  ratePercentPerYear?: number;
  changeAbsolute?: number;
  changePercent?: number;
  interpretation: Interpretation;
  cautions: TrendCaution[];
  confidence: Confidence;
  /**
   * The trend of the readings after a key redefinition, where there are enough
   * of them. The combined series stays refused: this is offered so the history
   * is not simply lost.
   */
  continuation?: MeasurementTrend;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

/** Least squares of value against years since the first reading. */
function fitLine(xs: number[], ys: number[]): LinearFit {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = meanY + slope * (xs[i]! - meanX);
    ssRes += (ys[i]! - predicted) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  // A flat series has no variance to explain. Calling that a perfect fit is
  // right — the line goes through every point — and calling it 0/0 is not.
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  const slopeStdError = n > 2 && sxx > 0 ? Math.sqrt(ssRes / (n - 2) / sxx) : 0;

  return { slopePerYear: slope, meanValue: meanY, meanYears: meanX, r2, slopeStdError, n };
}

/**
 * Student's t for a two-sided 95% interval.
 *
 * The small-sample values are the point of the table. Three readings give one
 * degree of freedom and a multiplier of 12.7, which produces a projection range
 * wide enough to be embarrassing — correctly so. A three-point projection is
 * embarrassing.
 */
const T95: [number, number][] = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365],
  [8, 2.306], [9, 2.262], [10, 2.228], [12, 2.179], [15, 2.131], [20, 2.086], [25, 2.060],
  [30, 2.042], [40, 2.021], [60, 2.000],
];

function tValue(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  let value = 1.96;
  for (const [k, v] of T95) {
    if (df <= k) { value = v; break; }
  }
  return value;
}

// ---------------------------------------------------------------------------
// The trend
// ---------------------------------------------------------------------------

function refuse(
  base: Omit<MeasurementTrend, 'status' | 'refusal' | 'interpretation' | 'cautions' | 'confidence'>,
  status: TrendStatus,
  refusal: string,
  cautions: TrendCaution[] = [],
): MeasurementTrend {
  return { ...base, status, refusal, interpretation: 'unknown', cautions, confidence: 'low' };
}

/**
 * What one asset's readings of one measurement have been doing.
 *
 * Returns a refusal far more often than it returns a rate, and the refusal is
 * always specific: which units clashed, how many readings short it is, which
 * gap hides the step. A technician can act on "two of these are in bar and
 * three are in kPa"; nobody can act on a blank chart.
 */
export function trendMeasurements(
  series: MeasurementSeries,
  options: TrendOptions = {},
): MeasurementTrend {
  const kind = kindForKey(series.key);
  const minimum = options.minimumPoints ?? MINIMUM_POINTS;
  const excluded: ExcludedPoint[] = [];

  const base = {
    assetId: series.assetId,
    assetName: series.assetName,
    key: series.key,
    kind,
    deterioration: series.deterioration ?? kind?.deterioration,
    used: [] as MeasurementPoint[],
    excluded,
    conversions: [] as { from: string; to: string; count: number }[],
  };

  // --- Readings that cannot be used at all ---------------------------------
  const fromMs = instantOf(options.from);
  const dated: { point: MeasurementPoint; ms: number }[] = [];
  for (const p of series.points) {
    const ms = instantOf(p.at);
    if (ms === undefined) {
      excluded.push({ point: p, reason: `"${p.at}" is not a date this app can read` });
      continue;
    }
    if (!Number.isFinite(p.value)) {
      excluded.push({ point: p, reason: 'the reading is not a finite number' });
      continue;
    }
    if (fromMs !== undefined && ms < fromMs) {
      excluded.push({ point: p, reason: `before ${formatAuDate(options.from)}` });
      continue;
    }
    dated.push({ point: p, ms });
  }
  dated.sort((a, b) => a.ms - b.ms || 0);

  // --- A key that changed meaning ------------------------------------------
  if (dated.length) {
    const spanFrom = dated[0]!.ms;
    const spanTo = dated[dated.length - 1]!.ms;
    for (const change of options.keyChanges ?? []) {
      const at = instantOf(change.at);
      if (at === undefined || at <= spanFrom || at > spanTo) continue;
      const after = dated.filter((d) => d.ms >= at);
      const result = refuse(
        base,
        'key-redefined',
        `"${series.key}" changed meaning on ${formatAuDate(change.at)}: ${change.what} `
        + 'Readings either side are not the same measurement, so nothing is trended through it. '
        + `${after.length} reading${after.length === 1 ? '' : 's'} ${after.length === 1 ? 'sits' : 'sit'} `
        + `after the change; ${minimum} are needed before those alone can be trended.`,
      );
      if (after.length >= minimum) {
        result.continuation = trendMeasurements(
          { ...series, points: after.map((d) => d.point) },
          { ...options, keyChanges: [], from: change.at },
        );
      }
      return result;
    }
  }

  // --- Units ---------------------------------------------------------------
  const stated = new Map<string, number>();
  let unstated = 0;
  for (const { point } of dated) {
    const u = normaliseUnit(point.unit) ?? normaliseUnit(options.assumeUnit);
    if (u) stated.set(u, (stated.get(u) ?? 0) + 1);
    else unstated += 1;
  }

  let target: string | undefined;
  if (stated.size) {
    // The unit most readings are in, and on a tie the one the last reading
    // used: that is the unit the technician's gauge is showing today.
    const latestUnit = normaliseUnit(dated[dated.length - 1]?.point.unit) ?? normaliseUnit(options.assumeUnit);
    target = [...stated.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      if (a[0] === latestUnit) return -1;
      if (b[0] === latestUnit) return 1;
      return a[0].localeCompare(b[0]);
    })[0]![0];
  }

  const cautions: TrendCaution[] = [];
  const conversions = new Map<string, number>();
  const converted: { point: MeasurementPoint; ms: number }[] = [];

  for (const entry of dated) {
    const recorded = normaliseUnit(entry.point.unit) ?? normaliseUnit(options.assumeUnit);
    if (!recorded || !target || recorded === target) {
      converted.push(entry);
      continue;
    }
    const fromMatches = lookupUnit(recorded);
    const toMatches = lookupUnit(target);
    const pair = fromMatches.find((f) => toMatches.some((t) => t.quantityId === f.quantityId));
    const to = pair ? toMatches.find((t) => t.quantityId === pair.quantityId) : undefined;
    if (!pair || !to) {
      return refuse(
        base,
        'mixed-units',
        `Readings are in ${recorded} and in ${target}. Those are not the same quantity — or not `
        + 'one this app can convert between — so combining them would invent a number. Correct '
        + 'the units on the readings and try again.',
      );
    }
    if (fromMatches.length > 1 && new Set(fromMatches.map((f) => f.quantityId)).size > 1) {
      return refuse(
        base,
        'mixed-units',
        `"${recorded}" matches more than one quantity in the unit table, so which reading was `
        + 'taken cannot be established from the record.',
      );
    }
    const value = convert(entry.point.value, pair.unit, to.unit);
    const label = `${recorded}→${target}`;
    conversions.set(label, (conversions.get(label) ?? 0) + 1);
    converted.push({ point: { ...entry.point, value, unit: target, note: entry.point.note }, ms: entry.ms });
  }

  base.conversions = [...conversions.entries()].map(([label, count]) => {
    const [from, to] = label.split('→');
    return { from: from!, to: to!, count };
  });
  if (base.conversions.length) {
    cautions.push({
      code: 'unit-converted',
      message: base.conversions
        .map((c) => `${c.count} reading${c.count === 1 ? '' : 's'} converted from ${c.from} to ${c.to}`)
        .join('; ') + '. The conversion is exact; whether the two gauges agreed is another matter.',
    });
  }

  // --- A key holding two quantities ----------------------------------------
  if (kind?.ambiguous && (!target || unstated > 0)) {
    return refuse(base, 'ambiguous-key', kind.ambiguous, cautions);
  }

  if (!target) {
    cautions.push({
      code: 'unit-unstated',
      message:
        'No unit was recorded against any of these readings. The direction and the percentage '
        + 'still hold, because they are relative; the rate has no unit and cannot be compared '
        + 'against a threshold.',
    });
  } else if (unstated > 0) {
    cautions.push({
      code: 'unit-unstated',
      message: `${unstated} reading${unstated === 1 ? ' has' : 's have'} no unit recorded and `
        + `${unstated === 1 ? 'was' : 'were'} read as ${target}. If a gauge was in bar that day, `
        + 'this trend is wrong.',
    });
  }

  // --- Enough to work with? ------------------------------------------------
  const used = converted.map((c) => c.point);
  base.used = used;

  if (used.length < minimum) {
    const short = `${used.length} usable reading${used.length === 1 ? '' : 's'}`;
    return refuse(
      base,
      'insufficient',
      used.length === 2
        ? `Two readings always fit a straight line perfectly, so this would report a rate with no `
          + `way of telling whether it is one. ${minimum} are needed before a trend is offered.`
        : `${short}. ${minimum} are needed before a trend is offered.`,
      cautions,
    );
  }

  const times = converted.map((c) => c.ms);
  const firstMs = times[0]!;
  const lastMs = times[times.length - 1]!;
  const spanDays = Math.round((lastMs - firstMs) / DAY_MS);
  if (spanDays <= 0) {
    return refuse(
      base,
      'no-time-span',
      'Every reading is from the same day, so these are repeats of one measurement rather than a '
      + 'history. Their spread is worth looking at; their trend does not exist.',
      cautions,
    );
  }

  // --- The fit -------------------------------------------------------------
  const xs = times.map((ms) => (ms - firstMs) / YEAR_MS);
  const ys = used.map((p) => p.value);
  const fit = fitLine(xs, ys);

  const firstValue = ys[0]!;
  const lastValue = ys[ys.length - 1]!;
  const changeAbsolute = lastValue - firstValue;
  const scale = Math.abs(firstValue) || Math.abs(fit.meanValue) || 0;
  const changePercent = scale ? (changeAbsolute / scale) * 100 : undefined;
  const ratePercentPerYear = scale ? (fit.slopePerYear / scale) * 100 : undefined;

  const direction: TrendDirection =
    ratePercentPerYear !== undefined && Math.abs(ratePercentPerYear) < FLAT_PERCENT_PER_YEAR
      ? 'flat'
      : fit.slopePerYear < 0 ? 'falling' : fit.slopePerYear > 0 ? 'rising' : 'flat';

  const t = tValue(fit.n - 2);
  const slopeMargin = fit.slopeStdError * t;
  const significant = Number.isFinite(slopeMargin) && slopeMargin > 0
    ? Math.abs(fit.slopePerYear) > slopeMargin
    : fit.slopeStdError === 0 && fit.slopePerYear !== 0;

  // --- Step or drift -------------------------------------------------------
  const step = detectStep(converted, options);
  let shape: TrendShape = 'drift';
  if (step) shape = step.distinguishable ? 'step' : 'unclear';
  else if (fit.r2 < SCATTER_R2 && direction !== 'flat') shape = 'unclear';

  if (step) {
    cautions.push({
      code: step.distinguishable ? 'step' : 'step-in-gap',
      message: step.message,
    });
  }
  if (shape === 'unclear' && !step) {
    cautions.push({
      code: 'scatter',
      message: `The readings do not sit on a line (r² ${fit.r2.toFixed(2)}). Something is moving `
        + 'this number that is not time — the measurement itself, the conditions, or the asset '
        + 'behaving irregularly. The rate below is arithmetic, not a forecast.',
    });
  }

  // --- Cautions ------------------------------------------------------------
  if (spanDays < SEASONAL_SPAN_DAYS) {
    cautions.push({
      code: 'seasonal',
      message: `These readings span ${spanDays} days, less than a full year. Over less than a `
        + 'year a season and a trend look the same, and in South East Queensland that matters: '
        + 'mains demand, ambient temperature and rainfall all move on an annual cycle. Repeat at '
        + 'the same time of year before treating this as deterioration.',
      provenance: kind?.confounders[0] ?? CONFOUNDER_SEQ_DEMAND,
    });
  }
  if (used.length === minimum) {
    cautions.push({
      code: 'sparse',
      message: `Fitted from ${used.length} readings, which is the fewest this app will use. One `
        + 'bad reading in three sets the whole rate.',
    });
  }
  if (fit.r2 < SCATTER_R2 && shape === 'drift' && direction !== 'flat') {
    cautions.push({
      code: 'scatter',
      message: `The readings scatter around the line (r² ${fit.r2.toFixed(2)}), so the rate is a `
        + 'rough figure.',
    });
  }
  if (fit.slopeStdError === 0 && used.length >= minimum && direction !== 'flat') {
    cautions.push({
      code: 'perfect-fit',
      message: 'The readings sit exactly on a straight line. Real measurements rarely do; check '
        + 'that they were measured rather than copied forward from the last service.',
    });
  }
  if (new Set(ys).size === 1) {
    cautions.push({
      code: 'no-variation',
      message: 'Every reading is identical. Either nothing has changed, or the test stops at its '
        + 'target and the target is what gets written down — a fitting that reaches 90 minutes '
        + 'and is switched off records 90 minutes whether it had 91 left in it or 300.',
    });
  }
  const sameDay = new Set<string>();
  const repeated = new Set<string>();
  for (const c of converted) {
    const day = qldDateOf(c.ms);
    if (sameDay.has(day)) repeated.add(day);
    sameDay.add(day);
  }
  if (repeated.size) {
    cautions.push({
      code: 'same-day-readings',
      message: `More than one reading on ${[...repeated].map(formatAuDate).join(', ')}. Repeats on `
        + 'one day are a retest, not history; they add scatter to the fit rather than direction.',
    });
  }
  if (excluded.length) {
    cautions.push({
      code: 'excluded-readings',
      message: `${excluded.length} reading${excluded.length === 1 ? ' was' : 's were'} left out: `
        + excluded.map((e) => e.reason).join('; ') + '.',
    });
  }
  if (!kind) {
    cautions.push({
      code: 'unknown-key',
      message: `"${series.key}" is not a measurement this app knows, so the direction is reported `
        + 'without an opinion on whether it is good news.',
    });
  }
  for (const confounder of kind?.confounders ?? []) {
    cautions.push({ code: 'confounded', message: confounder.fact, provenance: confounder });
  }

  // --- Interpretation ------------------------------------------------------
  const bad = series.deterioration ?? kind?.deterioration;
  let interpretation: Interpretation = 'unknown';
  if (direction === 'flat') interpretation = 'stable';
  else if (bad) interpretation = direction === bad ? 'deteriorating' : 'improving';

  // --- Confidence ----------------------------------------------------------
  let confidence: Confidence = 'low';
  if (used.length >= 6 && spanDays >= 2 * SEASONAL_SPAN_DAYS && fit.r2 >= 0.7 && shape === 'drift') {
    confidence = 'high';
  } else if (used.length >= 4 && spanDays >= SEASONAL_SPAN_DAYS && fit.r2 >= 0.4 && shape !== 'unclear') {
    confidence = 'medium';
  }
  if (confidence === 'high' && unstated > 0) confidence = 'medium';
  if (spanDays < SEASONAL_SPAN_DAYS || shape === 'unclear' || !target) confidence = 'low';

  return {
    ...base,
    status: 'trend',
    unit: target,
    first: used[0],
    last: used[used.length - 1],
    spanDays,
    direction,
    significant,
    shape,
    step,
    fit,
    ratePerYear: fit.slopePerYear,
    ratePercentPerYear,
    changeAbsolute,
    changePercent,
    interpretation,
    cautions,
    confidence,
  };
}

/**
 * The one interval that moved unlike all the others.
 *
 * A step and a drift are different investigations. Gradual decline is a
 * lifecycle conversation — budget a replacement, watch it. A step is an event:
 * somebody shut a valve, a main was repaired with a smaller diameter, a new
 * development connected upstream. Reporting a step as "falling 13% a year"
 * sends a technician looking for wear on something that was fine until a
 * Tuesday.
 *
 * The comparison is between rates rather than raw differences, because a big
 * change across a three-year gap is not a step — and where the moving interval
 * IS the long gap, nothing can separate the two and the step is returned marked
 * as indistinguishable rather than asserted.
 */
function detectStep(
  points: { point: MeasurementPoint; ms: number }[],
  options: TrendOptions,
): StepChange | undefined {
  if (points.length < 3) return undefined;
  const relative = options.stepRelative ?? DEFAULT_STEP_RELATIVE;
  const dominance = options.stepDominance ?? DEFAULT_STEP_DOMINANCE;

  const intervals = points.slice(1).map((to, i) => {
    const from = points[i]!;
    const days = (to.ms - from.ms) / DAY_MS;
    const delta = to.point.value - from.point.value;
    const years = (to.ms - from.ms) / YEAR_MS;
    return {
      from, to, delta, days,
      rate: years > 0 ? delta / years : 0,
      fraction: from.point.value === 0 ? 0 : Math.abs(delta / from.point.value),
    };
  });

  let worst = intervals[0]!;
  for (const i of intervals) if (Math.abs(i.rate) > Math.abs(worst.rate)) worst = i;

  const others = intervals.filter((i) => i !== worst).map((i) => Math.abs(i.rate)).sort((a, b) => a - b);
  if (!others.length) return undefined;
  const median = others.length % 2
    ? others[(others.length - 1) / 2]!
    : (others[others.length / 2 - 1]! + others[others.length / 2]!) / 2;

  const dominant = median === 0 ? Math.abs(worst.rate) > 0 : Math.abs(worst.rate) >= dominance * median;
  if (!dominant || worst.fraction < relative) return undefined;

  const dayList = intervals.map((i) => i.days).sort((a, b) => a - b);
  const medianDays = dayList.length % 2
    ? dayList[(dayList.length - 1) / 2]!
    : (dayList[dayList.length / 2 - 1]! + dayList[dayList.length / 2]!) / 2;
  const distinguishable = medianDays > 0 ? worst.days <= GAP_RATIO_UNRESOLVABLE * medianDays : true;

  const explanation = (options.interventions ?? []).find((i) => {
    const at = instantOf(i.at);
    return at !== undefined && at > worst.from.ms && at <= worst.to.ms;
  });

  const percent = worst.delta / (worst.from.point.value || 1) * 100;
  const movement = `${percent > 0 ? 'rose' : 'fell'} ${Math.abs(percent).toFixed(0)}%`;
  const between = `between ${formatAuDate(worst.from.point.at)} and ${formatAuDate(worst.to.point.at)}`;

  const message = explanation
    ? `The reading ${movement} ${between}, and "${explanation.what}" was recorded in that window. `
      + 'The step is explained: readings either side are of two different states of this asset, so '
      + 'trend from the later ones only.'
    : distinguishable
      ? `The reading ${movement} ${between} while the other services moved a fraction of that. `
        + 'That is an event, not wear — a valve part-shut, a repair, a new connection upstream, a '
        + 'component replaced without a record. Investigate what happened, rather than projecting a '
        + 'rate of decline through it.'
      : `The reading ${movement} ${between}, a gap of ${Math.round(worst.days)} days — much longer `
        + 'than the usual interval here. Across a gap that long a single event and a steady decline '
        + 'look identical, and nothing in this data can tell them apart.';

  return {
    from: worst.from.point,
    to: worst.to.point,
    delta: worst.delta,
    percent,
    days: Math.round(worst.days),
    distinguishable,
    explanation,
    message,
  };
}

// ---------------------------------------------------------------------------
// Projecting to a threshold
// ---------------------------------------------------------------------------

export interface Threshold {
  value: number;
  unit?: string;
  /** A floor (minimum acceptable) or a ceiling (maximum acceptable). Inferred when absent. */
  kind?: 'minimum' | 'maximum';
  /** Where the threshold came from — a standard clause, a design figure, a manufacturer. */
  source?: string;
}

export type ProjectionStatus =
  /** The latest reading is already past the threshold. */
  | 'crossed'
  /** A range of dates the trend crosses in. */
  | 'projected'
  /** Moving away from the threshold. */
  | 'moving-away'
  /** No measurable movement, which is not the same as no decline. */
  | 'flat'
  /** Not answerable, with the reason. */
  | 'unknown';

export interface ThresholdProjection {
  status: ProjectionStatus;
  threshold: number;
  unit?: string;
  kind: 'minimum' | 'maximum';
  /** Why the question cannot be answered. Present on 'unknown'. */
  reason?: string;
  /** ISO dates. A range, because a single date from a fitted line is a fiction. */
  earliest?: string;
  latest?: string;
  /** True when the slower end of the uncertainty never reaches the threshold. */
  openEnded?: boolean;
  yearsEarliest?: number;
  yearsLatest?: number;
  /** "between March 2028 and November 2031". */
  label: string;
  assumption: string;
  cautions: TrendCaution[];
  /** How many readings the projection is built from, after any step. */
  basedOn: number;
}

/**
 * When this asset crosses a pass threshold, as a range.
 *
 * The range is a 95% interval on the fitted rate, so three readings produce a
 * range measured in years and six readings over six years produce something a
 * scheduler can use. Both are honest; only one is useful, and the difference is
 * visible instead of hidden behind a single date.
 *
 * It refuses outright where the shape of the history makes the question
 * meaningless: through a step, through scatter, or against a threshold in a
 * unit the readings are not in.
 */
export function projectToThreshold(
  trend: MeasurementTrend,
  threshold: Threshold,
  options: { today?: string } = {},
): ThresholdProjection {
  const todayMs = instantOf(options.today) ?? Date.now();

  /**
   * A floor or a ceiling.
   *
   * Taken from what the measurement is — a residual pressure has a minimum, a
   * loop impedance has a maximum — rather than from where the readings
   * currently sit. Inferring it from the latest reading inverts exactly when
   * the asset has already failed, which is the one case that has to be right.
   */
  const kindOf = (firstValue: number): 'minimum' | 'maximum' => {
    if (threshold.kind) return threshold.kind;
    if (trend.deterioration) return trend.deterioration === 'falling' ? 'minimum' : 'maximum';
    return firstValue >= threshold.value ? 'minimum' : 'maximum';
  };

  const shell = (
    status: ProjectionStatus,
    label: string,
    extra: Partial<ThresholdProjection> = {},
  ): ThresholdProjection => ({
    status,
    threshold: threshold.value,
    unit: threshold.unit ?? trend.unit,
    kind: threshold.kind ?? 'minimum',
    label,
    assumption: PROJECTION_ASSUMPTION,
    cautions: [],
    basedOn: 0,
    ...extra,
  });

  if (trend.status !== 'trend' || !trend.fit || !trend.last) {
    return shell('unknown', 'No projection', {
      reason: trend.refusal ?? 'There is no trend to project.',
    });
  }

  // A threshold in kPa against readings with no unit, or in a different unit,
  // is a comparison of two different numbers that happen to be side by side.
  const thresholdUnit = normaliseUnit(threshold.unit);
  if (thresholdUnit && trend.unit && thresholdUnit !== trend.unit) {
    const from = lookupUnit(thresholdUnit);
    const to = lookupUnit(trend.unit);
    const pair = from.find((f) => to.some((t) => t.quantityId === f.quantityId));
    const target = pair ? to.find((t) => t.quantityId === pair.quantityId) : undefined;
    if (!pair || !target) {
      return shell('unknown', 'No projection', {
        reason: `The threshold is in ${thresholdUnit} and the readings are in ${trend.unit}. `
          + 'Those cannot be compared without a conversion this app does not have.',
      });
    }
    return projectToThreshold(
      trend,
      { ...threshold, value: convert(threshold.value, pair.unit, target.unit), unit: trend.unit },
      options,
    );
  }
  if (thresholdUnit && !trend.unit) {
    return shell('unknown', 'No projection', {
      reason: `The threshold is in ${thresholdUnit} and the readings carry no unit at all, so `
        + 'there is nothing to say the two are the same quantity.',
    });
  }

  if (trend.shape === 'unclear') {
    return shell('unknown', 'No projection', {
      reason: trend.step
        ? 'The history has a change in it that cannot be told apart from steady decline, so a '
          + 'projection through it would be a guess dressed as a date.'
        : 'The readings do not sit on a line, so there is no rate to project.',
    });
  }

  // After a step the earlier readings describe a different asset — or a
  // different plumbing arrangement — so the projection uses what came after it.
  let points = trend.used;
  const cautions: TrendCaution[] = [];
  if (trend.shape === 'step' && trend.step) {
    const stepAt = instantOf(trend.step.to.at);
    points = trend.used.filter((p) => {
      const ms = instantOf(p.at);
      return ms !== undefined && stepAt !== undefined && ms >= stepAt;
    });
    if (points.length < MINIMUM_POINTS) {
      return shell('unknown', 'No projection', {
        reason: `There was a step change on ${formatAuDate(trend.step.to.at)} and only `
          + `${points.length} reading${points.length === 1 ? '' : 's'} since. Readings from before `
          + 'it describe a different state of this asset, and there are not enough after it to '
          + `project from. ${MINIMUM_POINTS - points.length} more service`
          + `${MINIMUM_POINTS - points.length === 1 ? '' : 's'} will answer this.`,
      });
    }
    cautions.push({
      code: 'step',
      message: `Projected from the ${points.length} readings since the step change on `
        + `${formatAuDate(trend.step.to.at)}. Everything before it is a different asset in `
        + 'practice and is excluded.',
    });
  }

  const times = points.map((p) => instantOf(p.at)!);
  const firstMs = times[0]!;
  const xs = times.map((ms) => (ms - firstMs) / YEAR_MS);
  const ys = points.map((p) => p.value);
  const fit = fitLine(xs, ys);

  const latestValue = ys[ys.length - 1]!;
  const kind = kindOf(ys[0]!);
  const crossed = kind === 'minimum' ? latestValue <= threshold.value : latestValue >= threshold.value;

  const forUnit = trend.unit ? ` ${trend.unit}` : '';
  if (crossed) {
    return shell(
      'crossed',
      `Already at or past ${threshold.value}${forUnit} — measured `
      + `${formatAuDate(points[points.length - 1]!.at)}`,
      {
        kind,
        basedOn: points.length,
        // The seasonal caution matters most here: a hydrant below its duty in
        // February may be above it in July, and one reading is not a failure.
        cautions: [...cautions, ...trend.cautions.filter((c) => c.code === 'seasonal')],
      },
    );
  }

  const towards = kind === 'minimum' ? -1 : 1;
  const margin = Math.max(
    fit.slopeStdError * tValue(fit.n - 2),
    Math.abs(fit.slopePerYear) * PROJECTION_MINIMUM_RATE_UNCERTAINTY,
  );
  const slopes = [fit.slopePerYear - margin, fit.slopePerYear + margin]
    .filter((s) => Number.isFinite(s));

  const movingToward = Math.sign(fit.slopePerYear) === towards
    && Math.abs(fit.slopePerYear) > 0;

  const yearsFor = (slope: number): number | undefined => {
    if (!Number.isFinite(slope) || slope === 0 || Math.sign(slope) !== towards) return undefined;
    // The fitted line pivots about the centroid, so every candidate slope is
    // anchored there rather than at the last reading.
    const years = fit.meanYears + (threshold.value - fit.meanValue) / slope;
    return Number.isFinite(years) ? years : undefined;
  };

  const candidates = slopes.map(yearsFor).filter((y): y is number => y !== undefined);
  const nowYears = (todayMs - firstMs) / YEAR_MS;

  if (!movingToward || !candidates.length) {
    const couldStill = candidates.length > 0;
    const status: ProjectionStatus = trend.direction === 'flat' ? 'flat' : 'moving-away';
    const projection = shell(
      status,
      status === 'flat'
        ? 'No measurable movement toward the threshold'
        : `Moving away from ${threshold.value}${forUnit}`,
      {
        kind,
        basedOn: points.length,
        cautions,
      },
    );
    projection.cautions.push({
      code: 'scatter',
      message: couldStill
        ? 'The best fit is not moving toward the threshold, but the uncertainty in it still allows '
          + 'a decline that would. Not measurably falling is not the same as not falling.'
        : 'No movement toward the threshold at this rate. That is not a guarantee — it is what '
          + 'these readings support, and a fault that starts tomorrow is not in them.',
    });
    return projection;
  }

  const earliestYears = Math.max(Math.min(...candidates), nowYears);
  const latestYears = candidates.length > 1 ? Math.max(...candidates) : undefined;
  const openEnded = candidates.length === 1;

  const earliestIso = qldDateOf(firstMs + earliestYears * YEAR_MS);
  const latestIso = latestYears !== undefined ? qldDateOf(firstMs + latestYears * YEAR_MS) : undefined;

  const label = latestIso
    ? `between ${formatAuMonth(earliestIso)} and ${formatAuMonth(latestIso)}`
    : `no earlier than ${formatAuMonth(earliestIso)}, with no later bound — at the slow end of the `
      + 'uncertainty this trend never reaches the threshold';

  const projection = shell('projected', label, {
    kind,
    earliest: earliestIso,
    latest: latestIso,
    openEnded,
    yearsEarliest: Math.round((earliestYears - nowYears) * 10) / 10,
    yearsLatest: latestYears !== undefined ? Math.round((latestYears - nowYears) * 10) / 10 : undefined,
    basedOn: points.length,
    cautions,
  });

  // The seasonal and sparse cautions travel with the projection, because a
  // projection is exactly where somebody stops reading the trend.
  for (const c of trend.cautions) {
    if (c.code === 'seasonal' || c.code === 'sparse' || c.code === 'unit-unstated') {
      projection.cautions.push(c);
    }
  }
  if (points.length === MINIMUM_POINTS) {
    projection.cautions.push({
      code: 'sparse',
      message: 'Three readings give one degree of freedom, which is why this range is years wide. '
        + 'It narrows quickly with each service.',
    });
  }
  return projection;
}

// ---------------------------------------------------------------------------
// A portfolio
// ---------------------------------------------------------------------------

export interface RankedTrend {
  assetId: string;
  assetName?: string;
  key: string;
  /** Percent of the first reading lost each year, positive as it gets worse. */
  percentPerYear: number;
  ratePerYear: number;
  unit?: string;
  confidence: Confidence;
  trend: MeasurementTrend;
  projection?: ThresholdProjection;
}

export interface UnrankedTrend {
  assetId: string;
  assetName?: string;
  key: string;
  reason: string;
}

export interface DeteriorationRanking {
  /** Deteriorating fastest first. */
  ranked: RankedTrend[];
  /** Trended, but not getting worse. */
  steady: RankedTrend[];
  /** Could not be trended, or could not be judged, each with why. */
  notRanked: UnrankedTrend[];
  caveat: string;
}

export interface RankOptions extends TrendOptions {
  /** Threshold per measurement key, where the office holds one. */
  thresholds?: Record<string, Threshold>;
  /** Interventions per asset id. */
  interventionsByAsset?: Record<string, Intervention[]>;
}

/**
 * Which of these assets is going downhill fastest.
 *
 * This is what turns a chart into a work plan. Ranking is on percent of the
 * original reading lost per year rather than absolute rate, because absolute
 * rates of different quantities cannot be ordered against each other — a list
 * that ranks 3 kPa a year above 0.4 V a year has ranked the units, not the
 * assets.
 *
 * An asset whose key this app does not recognise, and whose caller has not said
 * which direction is bad, is not ranked at all. Guessing that falling is always
 * worse would put every asset with a rising transport time at the bottom of the
 * list, which is where it should not be.
 */
export function rankDeterioration(
  seriesList: MeasurementSeries[],
  options: RankOptions = {},
): DeteriorationRanking {
  const ranked: RankedTrend[] = [];
  const steady: RankedTrend[] = [];
  const notRanked: UnrankedTrend[] = [];

  for (const series of seriesList) {
    const trend = trendMeasurements(series, {
      ...options,
      interventions: options.interventionsByAsset?.[series.assetId] ?? options.interventions,
    });
    const head = { assetId: series.assetId, assetName: series.assetName, key: series.key };

    if (trend.status !== 'trend' || trend.ratePercentPerYear === undefined || !trend.fit) {
      notRanked.push({ ...head, reason: trend.refusal ?? 'No trend could be fitted.' });
      continue;
    }
    if (trend.shape === 'unclear') {
      notRanked.push({
        ...head,
        reason: trend.step
          ? 'A change in the readings cannot be told apart from steady decline, so no rate is quoted.'
          : 'The readings do not sit on a line, so no rate is quoted.',
      });
      continue;
    }
    const bad = trend.deterioration;
    if (!bad) {
      notRanked.push({
        ...head,
        reason: `"${series.key}" is not a measurement this app knows, so which direction is `
          + 'deterioration is not established. Say which and it will rank.',
      });
      continue;
    }

    const signed = bad === 'falling' ? -trend.ratePercentPerYear : trend.ratePercentPerYear;
    const row: RankedTrend = {
      ...head,
      percentPerYear: Math.round(signed * 100) / 100,
      ratePerYear: trend.ratePerYear!,
      unit: trend.unit,
      confidence: trend.confidence,
      trend,
    };
    const threshold = options.thresholds?.[series.key];
    if (threshold) row.projection = projectToThreshold(trend, threshold, { today: options.today });

    if (trend.interpretation === 'deteriorating') ranked.push(row);
    else steady.push(row);
  }

  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  ranked.sort((a, b) => b.percentPerYear - a.percentPerYear || rank[a.confidence] - rank[b.confidence]);
  steady.sort((a, b) => b.percentPerYear - a.percentPerYear);

  return { ranked, steady, notRanked, caveat: RANKING_CAVEAT };
}

// ---------------------------------------------------------------------------
// Building series from a timeline
// ---------------------------------------------------------------------------

/**
 * The shape of an asset event this module needs.
 *
 * Structurally what src/db/assetRepo.ts returns, declared here so nothing in
 * the trend logic imports the database layer.
 */
export interface MeasurementEventLike {
  id?: string;
  occurredAt: string;
  technician?: string;
  measurements: Record<string, string | number>;
}

export interface SeriesBuild {
  series: MeasurementSeries[];
  /** Readings that could not be turned into a number, with why. */
  rejected: { key: string; at: string; raw: string | number; reason: string }[];
}

/**
 * Groups a timeline into one series per measurement key.
 *
 * Every reading that cannot be read is reported rather than dropped. A series
 * quietly missing its three worst readings — the ones a technician wrote as
 * "<200" because the gauge would not settle — trends beautifully and means
 * nothing.
 */
export function seriesFromEvents(
  assetId: string,
  events: MeasurementEventLike[],
  options: { assetName?: string; units?: Record<string, string> } = {},
): SeriesBuild {
  const byKey = new Map<string, MeasurementPoint[]>();
  const rejected: SeriesBuild['rejected'] = [];

  for (const event of events) {
    for (const [key, raw] of Object.entries(event.measurements ?? {})) {
      const parsed = parseMeasurement(raw);
      if (!parsed.ok) {
        rejected.push({ key, at: event.occurredAt, raw, reason: parsed.reason });
        continue;
      }
      const list = byKey.get(key) ?? [];
      list.push({
        at: event.occurredAt,
        value: parsed.value,
        unit: parsed.unit ?? options.units?.[key],
        eventId: event.id,
        technician: event.technician,
      });
      byKey.set(key, list);
    }
  }

  const series = [...byKey.entries()]
    .map(([key, points]) => ({
      assetId,
      assetName: options.assetName,
      key,
      points: points.sort((a, b) => (instantOf(a.at) ?? 0) - (instantOf(b.at) ?? 0)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { series, rejected };
}

// ---------------------------------------------------------------------------
// Words for the screen and the report
// ---------------------------------------------------------------------------

const DIRECTION_WORD: Record<TrendDirection, string> = {
  falling: 'falling',
  rising: 'rising',
  flat: 'steady',
};

/** Rounds for display without pretending to a precision the reading has not got. */
export function formatRate(value: number, unit?: string): string {
  const magnitude = Math.abs(value);
  const dp = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3;
  return `${value.toFixed(dp)}${unit ? ` ${unit}` : ''}/year`;
}

/** One line a technician can read on site, or the refusal in plain words. */
export function trendHeadline(trend: MeasurementTrend): string {
  if (trend.status !== 'trend') return trend.refusal ?? 'No trend.';
  const pct = trend.ratePercentPerYear;
  const rate = trend.ratePerYear !== undefined ? formatRate(trend.ratePerYear, trend.unit) : '';
  const percentPart = pct !== undefined ? ` (${Math.abs(pct).toFixed(1)}% a year)` : '';

  if (trend.shape === 'step' && trend.step) {
    return `Step change of ${trend.step.percent > 0 ? '+' : ''}${trend.step.percent.toFixed(0)}% `
      + `${trend.step.explanation ? 'explained by recorded work' : 'with no recorded cause'}, `
      + `${formatAuDate(trend.step.to.at)}.`;
  }
  if (trend.direction === 'flat') {
    return `Steady over ${Math.round((trend.spanDays ?? 0) / 30)} months of readings.`;
  }
  const judgement = trend.interpretation === 'deteriorating'
    ? ' — deteriorating'
    : trend.interpretation === 'improving' ? ' — improving' : '';
  return `${DIRECTION_WORD[trend.direction ?? 'flat']} ${rate}${percentPart}${judgement}.`;
}
