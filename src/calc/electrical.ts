/**
 * Electrical calculations.
 *
 * Sized for the work a fire technician actually does: voltage drop on a long
 * sounder circuit, whether a device still sees enough volts at the far end of a
 * loop, and the basic power arithmetic that turns up in every plant room.
 *
 * Cable resistivity is taken at 75 degrees Celsius, which is the conservative
 * operating assumption rather than the 20 degree bench figure — a cable running
 * warm has higher resistance and drops more volts, so the cooler figure would
 * flatter the result.
 */

/** Resistivity of annealed copper at 75 °C, in ohm·mm²/m. */
export const COPPER_RESISTIVITY_75C = 0.0214;
/** Aluminium at 75 °C, for the occasional submain. */
export const ALUMINIUM_RESISTIVITY_75C = 0.0345;

export type Conductor = 'copper' | 'aluminium';

export function resistivity(conductor: Conductor): number {
  return conductor === 'aluminium' ? ALUMINIUM_RESISTIVITY_75C : COPPER_RESISTIVITY_75C;
}

// ---------------------------------------------------------------------------
// Ohm's law
// ---------------------------------------------------------------------------

export interface OhmsInput {
  volts?: number;
  amps?: number;
  ohms?: number;
  watts?: number;
}

export interface OhmsResult {
  volts: number;
  amps: number;
  ohms: number;
  watts: number;
  /** Which two inputs the rest were derived from. */
  derivedFrom: string;
}

/**
 * Solves Ohm's law from any two known values.
 *
 * Returns null when fewer than two are supplied or the pair cannot determine
 * the rest, rather than producing a confident zero.
 */
export function solveOhms(input: OhmsInput): OhmsResult | null {
  const v = valid(input.volts);
  const i = valid(input.amps);
  const r = valid(input.ohms);
  const p = valid(input.watts);

  const known = [v, i, r, p].filter((x) => x !== null).length;
  if (known < 2) return null;

  let volts = v;
  let amps = i;
  let ohms = r;
  let watts = p;
  let from = '';

  if (v !== null && i !== null) {
    ohms = i === 0 ? null : v / i;
    watts = v * i;
    from = 'volts and amps';
  } else if (v !== null && r !== null) {
    if (r === 0) return null;
    amps = v / r;
    watts = (v * v) / r;
    from = 'volts and resistance';
  } else if (v !== null && p !== null) {
    if (v === 0) return null;
    amps = p / v;
    ohms = (v * v) / p;
    from = 'volts and watts';
  } else if (i !== null && r !== null) {
    volts = i * r;
    watts = i * i * r;
    from = 'amps and resistance';
  } else if (i !== null && p !== null) {
    if (i === 0) return null;
    volts = p / i;
    ohms = p / (i * i);
    from = 'amps and watts';
  } else if (r !== null && p !== null) {
    if (r < 0 || p < 0) return null;
    volts = Math.sqrt(p * r);
    amps = Math.sqrt(p / r);
    from = 'resistance and watts';
  } else {
    return null;
  }

  if (volts === null || amps === null || ohms === null || watts === null) return null;
  if (![volts, amps, ohms, watts].every(Number.isFinite)) return null;

  return { volts, amps, ohms, watts, derivedFrom: from };
}

function valid(n: number | undefined): number | null {
  return n === undefined || !Number.isFinite(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Voltage drop
// ---------------------------------------------------------------------------

export interface VoltDropInput {
  /** Supply voltage at the source. */
  sourceVolts: number;
  /** Current drawn by the load, in amps. */
  amps: number;
  /** One-way cable run in metres. */
  lengthM: number;
  /** Conductor cross-sectional area in mm². */
  areaMm2: number;
  conductor?: Conductor;
  /** DC and single-phase runs carry current out and back. */
  circuit?: 'dc' | 'single-phase' | 'three-phase';
  /** Minimum voltage the device will still operate at. */
  minimumVolts?: number;
}

export interface VoltDropResult {
  /** Loop resistance of the run, in ohms. */
  resistanceOhms: number;
  dropVolts: number;
  dropPercent: number;
  voltsAtLoad: number;
  /** Null when no minimum was supplied. */
  withinLimit: boolean | null;
  /** Longest run that still meets the minimum, in metres. */
  maxLengthM: number | null;
}

/**
 * Voltage drop over a cable run.
 *
 * DC and single-phase circuits use twice the run length because the current
 * travels out and back. Three-phase uses the √3 relationship.
 */
export function voltageDrop(input: VoltDropInput): VoltDropResult | null {
  const { sourceVolts, amps, lengthM, areaMm2 } = input;
  if (![sourceVolts, amps, lengthM, areaMm2].every(Number.isFinite)) return null;
  if (areaMm2 <= 0 || lengthM < 0) return null;

  const rho = resistivity(input.conductor ?? 'copper');
  const circuit = input.circuit ?? 'dc';

  // Length multiplier: out and back for DC and single phase.
  const multiplier = circuit === 'three-phase' ? Math.sqrt(3) : 2;
  const resistanceOhms = (rho * lengthM * multiplier) / areaMm2;
  const dropVolts = amps * resistanceOhms;
  const voltsAtLoad = sourceVolts - dropVolts;
  const dropPercent = sourceVolts === 0 ? Number.NaN : (dropVolts / sourceVolts) * 100;

  let withinLimit: boolean | null = null;
  let maxLengthM: number | null = null;
  if (input.minimumVolts !== undefined && Number.isFinite(input.minimumVolts)) {
    withinLimit = voltsAtLoad >= input.minimumVolts;
    const allowableDrop = sourceVolts - input.minimumVolts;
    maxLengthM = amps > 0 && allowableDrop > 0
      ? (allowableDrop * areaMm2) / (rho * multiplier * amps)
      : 0;
  }

  return {
    resistanceOhms: round(resistanceOhms, 4),
    dropVolts: round(dropVolts, 3),
    dropPercent: round(dropPercent, 2),
    voltsAtLoad: round(voltsAtLoad, 2),
    withinLimit,
    maxLengthM: maxLengthM === null ? null : round(maxLengthM, 1),
  };
}

/**
 * Smallest standard conductor size that keeps the load above its minimum
 * voltage. Returns null when even the largest listed size will not do it.
 */
export const STANDARD_AREAS_MM2 = [0.5, 0.75, 1.0, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];

export function minimumCableSize(input: Omit<VoltDropInput, 'areaMm2'> & { minimumVolts: number }): number | null {
  for (const area of STANDARD_AREAS_MM2) {
    const r = voltageDrop({ ...input, areaMm2: area });
    if (r?.withinLimit) return area;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

export interface PowerInput {
  volts: number;
  amps: number;
  powerFactor?: number;
  phase: 'single' | 'three';
}

export interface PowerResult {
  /** Apparent power in volt-amps. */
  va: number;
  /** Real power in watts. */
  watts: number;
  kw: number;
  kva: number;
}

export function power(input: PowerInput): PowerResult | null {
  const { volts, amps, phase } = input;
  if (![volts, amps].every(Number.isFinite)) return null;
  const pf = input.powerFactor === undefined || !Number.isFinite(input.powerFactor) ? 1 : input.powerFactor;
  if (pf < 0 || pf > 1) return null;

  const va = phase === 'three' ? Math.sqrt(3) * volts * amps : volts * amps;
  const watts = va * pf;
  return { va: round(va, 1), watts: round(watts, 1), kw: round(watts / 1000, 3), kva: round(va / 1000, 3) };
}

/** Current a load of a given power will draw. */
export function currentForLoad(watts: number, volts: number, phase: 'single' | 'three', powerFactor = 1): number | null {
  if (![watts, volts].every(Number.isFinite) || volts === 0 || powerFactor <= 0) return null;
  const denominator = phase === 'three' ? Math.sqrt(3) * volts * powerFactor : volts * powerFactor;
  return round(watts / denominator, 3);
}

// ---------------------------------------------------------------------------
// Battery autonomy
// ---------------------------------------------------------------------------

/**
 * How long a battery will hold a constant load.
 *
 * This is the plain arithmetic, deliberately without the de-rating a design
 * calculation applies — it answers "roughly how long have I got", not "what
 * capacity should be installed". The battery calculator does the latter.
 */
export function autonomyHours(capacityAh: number, loadA: number): number | null {
  if (![capacityAh, loadA].every(Number.isFinite) || loadA <= 0 || capacityAh <= 0) return null;
  return round(capacityAh / loadA, 2);
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
