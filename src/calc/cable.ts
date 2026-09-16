/**
 * Cable sizing, worked the way AS/NZS 3008 works it.
 *
 * A fire technician runs 24 V sounder circuits and a fire company also runs
 * mains: a booster pump submain, a FIP supply, a lighting subcircuit off a
 * distribution board. Those are sized by a chain of four checks, and getting
 * any one of them wrong puts a cable in a wall that is legal-looking and
 * undersized:
 *
 *  1. **Current-carrying capacity.** The cable has to carry the design
 *     current where it is actually installed — in a wall, in a group, at 40 °C
 *     in a roof space — not where the table assumed it was.
 *  2. **Volt drop.** The load at the far end has to still see enough voltage.
 *  3. **Protection coordination.** Ib ≤ In ≤ Iz: the load current, then the
 *     device rating, then what the cable can take. A breaker bigger than the
 *     cable protects nothing.
 *  4. **Short circuit withstand.** The conductor has to survive the fault for
 *     as long as the device takes to clear it.
 *
 * ## What is in this file and what is deliberately not
 *
 * **The method is here. The tables are not.** Every current-carrying capacity
 * figure in AS/NZS 3008.1.1 is Standards Australia's, licensed per copy, and
 * this repository is public — so not one of them is written down here. The
 * capacity figures come in through the office's own table import
 * (`src/domain/cableTables.ts`), each row carrying the source it was read
 * from, and this module does the arithmetic on whatever it is given. A phone
 * with no tables loaded says so plainly rather than guessing a number.
 *
 * **The physics is here, and it is real physics.** Conductor resistance at
 * temperature, reactive volt drop, and the adiabatic short-circuit constant
 * are all computed from material constants — resistivity, temperature
 * coefficient, volumetric heat capacity — which are properties of copper and
 * aluminium, not anybody's copyright. The adiabatic derivation is worth
 * pointing at: fed the standard insulation temperatures it reproduces the
 * published k values (115 for copper/PVC, 76 for aluminium/PVC) to within a
 * rounding, which is the check that this is a derivation and not a
 * transcription. The test asserts it.
 *
 * **Two numbers are defaults, not facts.** The volt drop percentage the
 * office works to, and the overload ratio a protective device is built to.
 * Both are inputs, both are shown on screen, and both can be changed to
 * whatever the job or the device datasheet actually says.
 *
 * ## A note on the other volt drop tool
 *
 * `src/calc/electrical.ts` holds a flat 75 °C resistivity for the 24 V
 * extra-low-voltage work the fire tools do. This module derives resistance
 * from the 20 °C figure and the conductor's own operating temperature
 * instead, which is what AS/NZS 3008 does. At 75 °C the two differ by under
 * 2 %, with the older tool on the conservative side. They are answering
 * different questions and both are left as they are; the screens say so.
 */

// ---------------------------------------------------------------------------
// Conductor materials
// ---------------------------------------------------------------------------

export type ConductorMaterial = 'copper' | 'aluminium';

export interface MaterialConstants {
  label: string;
  /** Resistivity at 20 °C, in ohm·mm²/m. */
  rho20: number;
  /** Temperature coefficient of resistance at 20 °C, per °C. */
  alpha20: number;
  /**
   * Reciprocal of the temperature coefficient at 0 °C, in °C — the "β" of the
   * adiabatic equation. 234.5 for copper is the same fact as α = 1/234.5 at
   * 0 °C; it is written this way because that is the form the equation takes.
   */
  beta: number;
  /** Volumetric heat capacity at 20 °C, in J/(°C·mm³). */
  heatCapacity: number;
}

/**
 * Properties of the two conductors anybody installs.
 *
 * Copper resistivity is the International Annealed Copper Standard figure,
 * 1/58 ohm·mm²/m. Aluminium is 1/35.38, the hard-drawn grade used in cable.
 * Both are material constants: they are the same in every textbook and every
 * standard because they are properties of the metal.
 */
export const MATERIALS: Record<ConductorMaterial, MaterialConstants> = {
  copper: {
    label: 'Copper',
    rho20: 1 / 58,
    alpha20: 0.00393,
    beta: 234.5,
    heatCapacity: 3.45e-3,
  },
  aluminium: {
    label: 'Aluminium',
    rho20: 1 / 35.38,
    alpha20: 0.00403,
    beta: 228,
    heatCapacity: 2.5e-3,
  },
};

/**
 * DC resistance of one conductor, in ohms per metre, at a temperature.
 *
 * The temperature matters more than people expect. A conductor at its 90 °C
 * rating has about 28 % more resistance than the same conductor on the bench,
 * so a volt drop worked at 20 °C is a volt drop that passes on paper and
 * fails in a hot roof.
 */
export function resistancePerMetre(areaMm2: number, material: ConductorMaterial, tempC: number): number | null {
  if (!Number.isFinite(areaMm2) || areaMm2 <= 0) return null;
  if (!Number.isFinite(tempC)) return null;
  const m = MATERIALS[material];
  if (!m) return null;
  const factor = 1 + m.alpha20 * (tempC - 20);
  if (factor <= 0) return null;
  return (m.rho20 * factor) / areaMm2;
}

// ---------------------------------------------------------------------------
// Derating
// ---------------------------------------------------------------------------

export type DeratingKind =
  | 'ambient'
  | 'grouping'
  | 'thermal-insulation'
  | 'depth'
  | 'soil'
  | 'harmonics'
  | 'other';

export const DERATING_KINDS: readonly DeratingKind[] = [
  'ambient', 'grouping', 'thermal-insulation', 'depth', 'soil', 'harmonics', 'other',
];

export const DERATING_LABEL: Record<DeratingKind, string> = {
  ambient: 'Ambient temperature',
  grouping: 'Grouping',
  'thermal-insulation': 'Thermal insulation',
  depth: 'Depth of burial',
  soil: 'Soil thermal resistivity',
  harmonics: 'Harmonic content',
  other: 'Other',
};

/**
 * One derating factor, and where it came from.
 *
 * The source is not decoration. A derated capacity is a number a designer
 * will be asked to justify, and "0.87" with nothing behind it is not a
 * justification — so every factor carries the table, page or datasheet it was
 * read out of, and the screen prints them under the answer.
 */
export interface DeratingFactor {
  kind: DeratingKind;
  /** The condition it applies to, in the reader's words: "40 °C in air". */
  condition: string;
  /** The factor. Almost always below 1; a few table conditions allow above. */
  factor: number;
  /** Where the number was read. Never blank. */
  source: string;
}

export interface DeratingResult {
  /** Every accepted factor multiplied together. */
  factor: number;
  applied: DeratingFactor[];
  /** Factors thrown out, with why — never silently dropped. */
  rejected: { factor: DeratingFactor; reason: string }[];
}

/** The widest a single factor may be before it is treated as a typo. */
const MAX_SANE_FACTOR = 2;

/**
 * Multiplies the derating factors together.
 *
 * A factor of zero, a negative one or one wildly above 1 is a mistyped table
 * lookup, not a condition — taking it at face value would produce a cable
 * rated at nothing or at twice its capacity, and the second is the dangerous
 * direction. Those are rejected and named rather than clamped, because a
 * clamped value looks like an answer.
 */
export function combineDerating(factors: DeratingFactor[]): DeratingResult {
  const applied: DeratingFactor[] = [];
  const rejected: { factor: DeratingFactor; reason: string }[] = [];

  for (const f of factors) {
    if (!Number.isFinite(f.factor)) {
      rejected.push({ factor: f, reason: 'not a number' });
    } else if (f.factor <= 0) {
      rejected.push({ factor: f, reason: 'zero or negative, which would rate the cable at nothing' });
    } else if (f.factor > MAX_SANE_FACTOR) {
      rejected.push({ factor: f, reason: `above ${MAX_SANE_FACTOR}, which reads as a mistyped lookup` });
    } else if (!f.source.trim()) {
      rejected.push({ factor: f, reason: 'no source, and a derating nobody can point at is not a derating' });
    } else {
      applied.push(f);
    }
  }

  const factor = applied.reduce((n, f) => n * f.factor, 1);
  return { factor, applied, rejected };
}

/**
 * The capacity a cable actually has where it is installed.
 *
 * `tableAmps` is the figure read out of the office's own table for the
 * installation method; everything after that is the site.
 */
export function deratedCapacity(tableAmps: number, factors: DeratingFactor[]): { amps: number; derating: DeratingResult } | null {
  if (!Number.isFinite(tableAmps) || tableAmps <= 0) return null;
  const derating = combineDerating(factors);
  return { amps: tableAmps * derating.factor, derating };
}

// ---------------------------------------------------------------------------
// Protection coordination
// ---------------------------------------------------------------------------

/**
 * The ratings protective devices are actually made in.
 *
 * IEC 60898 and IEC 60947 preferred values — what is printed on the front of
 * every breaker in every wholesaler in the country. Facts about products, and
 * the list is overridable anyway for a device that is not on it.
 */
export const PROTECTIVE_RATINGS_A: readonly number[] = [
  6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
];

/**
 * The ratio of a device's conventional tripping current to its rating.
 *
 * 1.45 is what a circuit breaker built to IEC 60898 is required to do, and it
 * appears on the device's own datasheet. It is a default here rather than a
 * constant of nature: a fuse or an industrial breaker will differ, and the
 * caller passes whatever its datasheet says.
 */
export const DEFAULT_OVERLOAD_RATIO = 1.45;

/**
 * How far above its capacity a cable may be pushed for the conventional time.
 *
 * A separate 1.45 from the one above, and the coincidence is what makes the
 * overload check look redundant. This one is the cable's short-time allowance;
 * the other is what the device does. They cancel for a standard breaker, which
 * is why In ≤ Iz is the rule everybody remembers — and they stop cancelling
 * the moment the device is a fuse or a motor starter, which is when the check
 * earns its place.
 */
export const CABLE_OVERLOAD_ALLOWANCE = 1.45;

export interface CoordinationInput {
  /** Ib — the current the load will actually draw. */
  designCurrentA: number;
  /** Iz — what the cable can carry where it is installed, after derating. */
  capacityA: number;
  /** In — a device already chosen. Omitted, the smallest that works is found. */
  deviceRatingA?: number;
  ratings?: readonly number[];
  overloadRatio?: number;
}

export interface CoordinationResult {
  /** In — the device rating, chosen or given. Null where none will do. */
  deviceRatingA: number | null;
  /** Ib ≤ In. */
  carriesLoad: boolean;
  /** In ≤ Iz. */
  protectsCable: boolean;
  /** I₂ ≤ 1.45 Iz — the overload check on top of the rating check. */
  clearsOverload: boolean;
  ok: boolean;
  /** What failed, in a sentence a person can act on. */
  reason: string;
}

/**
 * Ib ≤ In ≤ Iz, and the overload check on top of it.
 *
 * The rule reads as arithmetic and fails as a fire. A device rated above what
 * the cable can carry will sit there happily while the cable cooks, because
 * from the device's point of view nothing is wrong — which is why the middle
 * inequality is the one that matters and the one people skip.
 */
export function coordinate(input: CoordinationInput): CoordinationResult {
  const { designCurrentA: ib, capacityA: iz } = input;
  const ratio = input.overloadRatio ?? DEFAULT_OVERLOAD_RATIO;
  const ratings = input.ratings ?? PROTECTIVE_RATINGS_A;

  const bad = (reason: string): CoordinationResult => ({
    deviceRatingA: null, carriesLoad: false, protectsCable: false, clearsOverload: false, ok: false, reason,
  });

  if (!Number.isFinite(ib) || ib <= 0) return bad('Enter the current the load will draw.');
  if (!Number.isFinite(iz) || iz <= 0) return bad('The cable has no capacity to protect — load a table figure first.');

  const chosen = input.deviceRatingA !== undefined && Number.isFinite(input.deviceRatingA)
    ? input.deviceRatingA
    : ratings.find((r) => r >= ib && r <= iz) ?? null;

  if (chosen === null) {
    const smallest = ratings.find((r) => r >= ib);
    return bad(
      smallest === undefined
        ? `No listed device rating reaches ${round(ib, 1)} A.`
        : `The smallest device that carries ${round(ib, 1)} A is ${smallest} A, and the cable only takes ${round(iz, 1)} A. The cable is too small, not the device too large.`,
    );
  }

  const carriesLoad = chosen >= ib;
  const protectsCable = chosen <= iz;
  const clearsOverload = ratio * chosen <= CABLE_OVERLOAD_ALLOWANCE * iz;
  const ok = carriesLoad && protectsCable && clearsOverload;

  let reason: string;
  if (!carriesLoad) {
    reason = `A ${chosen} A device will trip on a ${round(ib, 1)} A load.`;
  } else if (!protectsCable) {
    reason = `A ${chosen} A device does not protect a cable that only carries ${round(iz, 1)} A.`;
  } else if (!clearsOverload) {
    reason = `The device's overload current (${round(chosen * ratio, 1)} A) is above what the cable can survive.`;
  } else {
    reason = `${round(ib, 1)} A load, ${chosen} A device, ${round(iz, 1)} A cable.`;
  }

  return { deviceRatingA: chosen, carriesLoad, protectsCable, clearsOverload, ok, reason };
}

// ---------------------------------------------------------------------------
// Volt drop
// ---------------------------------------------------------------------------

export type CircuitPhase = 'dc' | 'single' | 'three';

export const PHASE_LABEL: Record<CircuitPhase, string> = {
  dc: 'DC',
  single: 'Single phase',
  three: 'Three phase',
};

/**
 * The volt drop percentage the office works to.
 *
 * A default rather than a fact from a table: the figure a particular job is
 * held to comes from the design, the supply authority or the client's spec,
 * and the screen lets it be changed.
 */
export const DEFAULT_DROP_LIMIT_PERCENT = 5;

/**
 * Three-phase Vc to single-phase Vc, from AS/NZS 3008.1.1's own note under the
 * voltage drop tables. √3 out and back over √3 shared, which is 2/√3.
 */
export const SINGLE_PHASE_VC_FACTOR = 1.155;

export interface VoltDropInput {
  amps: number;
  /** One-way run length in metres. The out-and-back is handled here. */
  lengthM: number;
  areaMm2: number;
  material: ConductorMaterial;
  /** The conductor's operating temperature — 75 for V-75, 90 for X-90. */
  operatingC: number;
  phase: CircuitPhase;
  supplyVolts: number;
  /** cos φ of the load. 1 for DC and for a resistive load. */
  powerFactor?: number;
  /**
   * Reactance in ohms per kilometre, where the office's table gives it.
   * Without it the answer is resistance only, and `resistanceOnly` says so —
   * which is right for small cables and optimistic above about 25 mm².
   */
  reactanceOhmPerKm?: number;
  /** Overrides everything above with a mV/A·m figure read straight from a table. */
  mvPerAmpMetre?: number;
  /**
   * Whether that table figure is a three-phase one. AS/NZS 3008's voltage drop
   * tables are, and its own note says to multiply by 1.155 for single phase —
   * because the current goes out and back down two conductors rather than
   * being shared across three. Left true by default, since a mV/A·m figure
   * copied from anywhere in that standard is a three-phase figure; set false
   * for a manufacturer's single-phase table.
   */
  mvIsThreePhase?: boolean;
  limitPercent?: number;
}

export interface VoltDropResult {
  /** Vc — millivolts dropped per amp per metre of run. */
  mvPerAmpMetre: number;
  dropVolts: number;
  dropPercent: number;
  voltsAtLoad: number;
  /** Null where no supply voltage was given to measure against. */
  withinLimit: boolean | null;
  limitPercent: number;
  /** The longest run at this size and load that still meets the limit. */
  maxLengthM: number | null;
  /** True where reactance was not supplied, so the figure is resistive only. */
  resistanceOnly: boolean;
  /** True where the mV/A·m came from a table rather than being computed. */
  fromTable: boolean;
}

/**
 * Volt drop over a run, the AS/NZS 3008 way.
 *
 * The standard's own arithmetic is Vd = L × I × Vc ÷ 1000, where Vc is the
 * millivolts dropped per amp per metre. Where the office's table gives Vc it
 * is used directly; where it does not, it is computed from the conductor's
 * resistance at its operating temperature and, if supplied, its reactance:
 *
 *   single phase and DC:  Vc = 2 × (R cos φ + X sin φ) × 1000
 *   three phase:          Vc = √3 × (R cos φ + X sin φ) × 1000
 *
 * The 2 is the out-and-back: single-phase current travels down the active and
 * returns down the neutral, and forgetting it halves the answer. Three phase
 * uses √3 because the return is shared across the phases.
 */
export function voltDrop(input: VoltDropInput): VoltDropResult | null {
  const { amps, lengthM, supplyVolts, phase } = input;
  if (![amps, lengthM, supplyVolts].every(Number.isFinite)) return null;
  if (lengthM < 0 || amps < 0) return null;

  const pf = clampPf(input.powerFactor, phase);
  const multiplier = phase === 'three' ? Math.sqrt(3) : 2;

  let mv: number;
  let resistanceOnly: boolean;
  let fromTable: boolean;

  if (input.mvPerAmpMetre !== undefined && Number.isFinite(input.mvPerAmpMetre) && input.mvPerAmpMetre > 0) {
    // The standard's own conversion, not an approximation of one: a
    // three-phase Vc used unchanged on a single-phase circuit under-reports
    // the drop by 15.5%, which is the wrong direction to be wrong in.
    const singlePhase = (input.mvIsThreePhase ?? true) && phase !== 'three';
    mv = singlePhase ? input.mvPerAmpMetre * SINGLE_PHASE_VC_FACTOR : input.mvPerAmpMetre;
    resistanceOnly = false;
    fromTable = true;
  } else {
    const r = resistancePerMetre(input.areaMm2, input.material, input.operatingC);
    if (r === null) return null;
    const x = Number.isFinite(input.reactanceOhmPerKm ?? NaN) ? (input.reactanceOhmPerKm as number) / 1000 : 0;
    resistanceOnly = x === 0;
    fromTable = false;
    const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
    mv = multiplier * (r * pf + x * sinPhi) * 1000;
  }

  const dropVolts = (lengthM * amps * mv) / 1000;
  const voltsAtLoad = supplyVolts - dropVolts;
  const dropPercent = supplyVolts > 0 ? (dropVolts / supplyVolts) * 100 : Number.NaN;
  const limitPercent = input.limitPercent ?? DEFAULT_DROP_LIMIT_PERCENT;

  const withinLimit = supplyVolts > 0 && Number.isFinite(dropPercent) ? dropPercent <= limitPercent : null;
  const allowableVolts = (supplyVolts * limitPercent) / 100;
  const maxLengthM = amps > 0 && mv > 0 && supplyVolts > 0
    ? (allowableVolts * 1000) / (amps * mv)
    : null;

  return {
    mvPerAmpMetre: round(mv, 3),
    dropVolts: round(dropVolts, 3),
    dropPercent: round(dropPercent, 2),
    voltsAtLoad: round(voltsAtLoad, 2),
    withinLimit,
    limitPercent,
    maxLengthM: maxLengthM === null ? null : round(maxLengthM, 1),
    resistanceOnly,
    fromTable,
  };
}

/**
 * The current a load of a given power will actually draw.
 *
 * The design current is what everything else hangs off, and on site it does
 * not arrive as amps — it arrives as a kilowatt figure on a nameplate. The
 * power factor belongs in here rather than only in the volt drop: a 3 kW motor
 * at 0.8 draws a quarter more current than 3 kW of heating does, and the cable
 * feels the current.
 *
 * `electrical.ts` has the same arithmetic for the fire tools without the DC
 * case; this one keeps the three phase kinds in one type so a screen does not
 * have to translate between two of them.
 */
export function designCurrent(watts: number, volts: number, phase: CircuitPhase, powerFactor = 1): number | null {
  if (![watts, volts].every(Number.isFinite)) return null;
  if (volts <= 0 || watts < 0) return null;
  const pf = clampPf(powerFactor, phase);
  const denominator = phase === 'three' ? Math.sqrt(3) * volts * pf : volts * pf;
  if (denominator <= 0) return null;
  return round(watts / denominator, 2);
}

/**
 * Power factor, kept inside the physics.
 *
 * A DC circuit has no phase angle, so anything but 1 there is a mistake in the
 * form rather than a property of the load. Outside 0 to 1 there is no angle at
 * all and the reactive term would come out imaginary.
 */
function clampPf(pf: number | undefined, phase: CircuitPhase): number {
  if (phase === 'dc') return 1;
  if (pf === undefined || !Number.isFinite(pf)) return 1;
  if (pf <= 0) return 1;
  return Math.min(1, pf);
}

// ---------------------------------------------------------------------------
// Short circuit withstand
// ---------------------------------------------------------------------------

/**
 * The adiabatic constant k for a conductor and its insulation.
 *
 * Derived from IEC 60949's equation rather than looked up:
 *
 *   k = √( Qc·(β + 20) / ρ₂₀ · ln((β + θf) / (β + θi)) )
 *
 * where Qc is the volumetric heat capacity, β the reciprocal temperature
 * coefficient, ρ₂₀ the resistivity at 20 °C in ohm·millimetres, θi the
 * conductor temperature when the fault starts and θf the highest the
 * insulation will take.
 *
 * "Adiabatic" is the assumption doing the work: for the tens of milliseconds
 * a fault lasts, none of the heat escapes the conductor, so all of it goes
 * into raising its temperature. That is conservative and it is why the
 * equation is this short.
 *
 * Fed the temperatures for PVC (70 → 160) this returns 115 for copper and 76
 * for aluminium — the published figures, to a rounding. That agreement is the
 * evidence that this is a derivation and not a transcription, and the test
 * asserts it.
 */
export function adiabaticK(material: ConductorMaterial, startC: number, finalC: number): number | null {
  const m = MATERIALS[material];
  if (!m) return null;
  if (![startC, finalC].every(Number.isFinite)) return null;
  if (finalC <= startC) return null;
  if (m.beta + startC <= 0) return null;

  // ρ₂₀ in ohm·mm: ohm·mm²/m is ohm·mm² per 1000 mm.
  const rhoOhmMm = m.rho20 / 1000;
  const ratio = (m.beta + finalC) / (m.beta + startC);
  const k = Math.sqrt((m.heatCapacity * (m.beta + 20) / rhoOhmMm) * Math.log(ratio));
  return Number.isFinite(k) ? k : null;
}

export interface FaultInput {
  /** Prospective fault current at the point of the fault, in amps. */
  faultA: number;
  /** How long the protective device takes to clear it, in seconds. */
  clearingTimeS: number;
  k: number;
}

export interface FaultResult {
  /** S = I√t ÷ k — the smallest conductor that survives the fault. */
  minimumAreaMm2: number;
  /** The smallest standard size at or above it. */
  standardAreaMm2: number | null;
}

/** The conductor sizes cable is actually made in. */
export const STANDARD_SIZES_MM2: readonly number[] = [
  1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
];

/**
 * The smallest conductor that survives the fault, S = I√t ÷ k.
 *
 * This is the check people skip, because a cable that carries the load and
 * meets the volt drop feels finished. It is not: a 2.5 mm² conductor on a
 * board with 6 kA available and a slow device does not melt gradually, it
 * goes at once.
 */
export function minimumFaultSize(input: FaultInput): FaultResult | null {
  const { faultA, clearingTimeS, k } = input;
  if (![faultA, clearingTimeS, k].every(Number.isFinite)) return null;
  if (faultA <= 0 || clearingTimeS <= 0 || k <= 0) return null;
  const minimumAreaMm2 = (faultA * Math.sqrt(clearingTimeS)) / k;
  return {
    minimumAreaMm2: round(minimumAreaMm2, 2),
    standardAreaMm2: STANDARD_SIZES_MM2.find((s) => s >= minimumAreaMm2) ?? null,
  };
}

/** How long a conductor of a given size survives a given fault current. */
export function withstandTimeS(areaMm2: number, k: number, faultA: number): number | null {
  if (![areaMm2, k, faultA].every(Number.isFinite)) return null;
  if (areaMm2 <= 0 || k <= 0 || faultA <= 0) return null;
  return round(((k * areaMm2) / faultA) ** 2, 4);
}

// ---------------------------------------------------------------------------
// Earth fault loop
// ---------------------------------------------------------------------------

/**
 * How far past its rating a protective device has to be pushed to trip at once.
 *
 * These are the IEC 60898 tripping curves — the letter printed on the front of
 * the breaker, and the reason a Type C on a long run will sit there during an
 * earth fault that a Type B would have cleared. Product data, on every
 * datasheet, and the multiplier is an editable input anyway because a fuse or
 * a motor-rated device is neither.
 */
export const CURVE_MULTIPLIER: Record<'B' | 'C' | 'D', number> = { B: 5, C: 10, D: 20 };

export interface LoopInput {
  /**
   * Ze — the impedance of everything upstream of the board, from the supply
   * authority's figure or a measurement at the origin.
   */
  supplyOhms: number;
  lengthM: number;
  /** The active conductor. */
  activeMm2: number;
  /** The earth, which is usually smaller and usually the larger half of R2. */
  earthMm2: number;
  material: ConductorMaterial;
  /** The conductor temperature to work at. Its operating rating, not 20 °C. */
  operatingC: number;
  /** Uo — the voltage to earth. */
  phaseVolts: number;
}

export interface LoopResult {
  /** R1 + R2 — the loop out along the active and back along the earth. */
  circuitOhms: number;
  /** Zs — everything, including the supply. */
  totalOhms: number;
  /** Uo ÷ Zs. */
  faultCurrentA: number;
}

/**
 * The earth fault loop, from the supply to the far end and back.
 *
 * Worked at the conductor's operating temperature rather than at 20 °C, which
 * is the conservative direction: a warm conductor has more resistance, so less
 * fault current flows and the device is slower to see it. Working it cold
 * produces a loop that disconnects on paper.
 *
 * The earth conductor is usually the smaller of the two and therefore the
 * larger half of R1 + R2, which is why it is a separate input rather than
 * assumed equal to the active. Assuming them equal is how a 6 mm² active with
 * a 2.5 mm² earth passes a check it fails.
 */
export function faultLoop(input: LoopInput): LoopResult | null {
  const rActive = resistancePerMetre(input.activeMm2, input.material, input.operatingC);
  const rEarth = resistancePerMetre(input.earthMm2, input.material, input.operatingC);
  if (rActive === null || rEarth === null) return null;
  if (!Number.isFinite(input.lengthM) || input.lengthM < 0) return null;
  if (!Number.isFinite(input.supplyOhms) || input.supplyOhms < 0) return null;
  if (!Number.isFinite(input.phaseVolts) || input.phaseVolts <= 0) return null;

  const circuitOhms = (rActive + rEarth) * input.lengthM;
  const totalOhms = circuitOhms + input.supplyOhms;
  if (totalOhms <= 0) return null;

  return {
    circuitOhms: round(circuitOhms, 4),
    totalOhms: round(totalOhms, 4),
    faultCurrentA: round(input.phaseVolts / totalOhms, 1),
  };
}

export interface DisconnectionInput {
  faultCurrentA: number;
  deviceRatingA: number;
  /** How many times its rating the device needs to trip instantly. */
  multiplier: number;
  phaseVolts: number;
}

export interface DisconnectionResult {
  /** The current the device needs to see. */
  tripCurrentA: number;
  /** The largest loop impedance that still delivers it. */
  maxLoopOhms: number;
  ok: boolean;
  /** How much fault current there is above what is needed, as a percentage. */
  marginPercent: number;
  reason: string;
}

/**
 * Whether the device actually sees enough fault current to trip at once.
 *
 * This is the check a long run fails silently. Everything else about the
 * circuit is fine — the cable carries the load, the volt drop is inside the
 * limit, the breaker matches — and the earth fault at the far end draws too
 * little current to move the magnetic element, so the device falls back to its
 * thermal curve and takes seconds instead of milliseconds.
 *
 * `maxLoopOhms` is Uo ÷ (multiplier × In), which is where the printed maximum
 * loop impedance figures come from in the first place. Computing it means the
 * answer holds for whatever device and whatever supply voltage are in front of
 * you, rather than only for the rows somebody tabulated.
 */
export function disconnects(input: DisconnectionInput): DisconnectionResult | null {
  const { faultCurrentA, deviceRatingA, multiplier, phaseVolts } = input;
  if (![faultCurrentA, deviceRatingA, multiplier, phaseVolts].every(Number.isFinite)) return null;
  if (deviceRatingA <= 0 || multiplier <= 0 || phaseVolts <= 0 || faultCurrentA < 0) return null;

  const tripCurrentA = deviceRatingA * multiplier;
  const maxLoopOhms = phaseVolts / tripCurrentA;
  const ok = faultCurrentA >= tripCurrentA;
  const marginPercent = ((faultCurrentA - tripCurrentA) / tripCurrentA) * 100;

  return {
    tripCurrentA: round(tripCurrentA, 1),
    maxLoopOhms: round(maxLoopOhms, 3),
    ok,
    marginPercent: round(marginPercent, 1),
    reason: ok
      ? `${round(faultCurrentA, 0)} A of fault current against the ${round(tripCurrentA, 0)} A this device needs.`
      : `Only ${round(faultCurrentA, 0)} A of fault current, and this device needs ${round(tripCurrentA, 0)} A to trip at once. It will fall back to its thermal curve and take seconds.`,
  };
}

/**
 * The longest run that still disconnects.
 *
 * The number worth having when a check fails, because the answer is almost
 * never "use a different breaker" — it is "how much of this run can stay".
 */
export function maxLengthForDisconnection(
  input: Omit<LoopInput, 'lengthM'> & { deviceRatingA: number; multiplier: number },
): number | null {
  const rActive = resistancePerMetre(input.activeMm2, input.material, input.operatingC);
  const rEarth = resistancePerMetre(input.earthMm2, input.material, input.operatingC);
  if (rActive === null || rEarth === null) return null;
  if (!Number.isFinite(input.phaseVolts) || input.phaseVolts <= 0) return null;
  if (!Number.isFinite(input.deviceRatingA) || input.deviceRatingA <= 0) return null;
  if (!Number.isFinite(input.multiplier) || input.multiplier <= 0) return null;

  const maxLoop = input.phaseVolts / (input.deviceRatingA * input.multiplier);
  const forCircuit = maxLoop - input.supplyOhms;
  if (forCircuit <= 0) return 0;
  return round(forCircuit / (rActive + rEarth), 1);
}

// ---------------------------------------------------------------------------
// The whole chain
// ---------------------------------------------------------------------------

/** One candidate size, from the office's table. */
export interface CandidateRow {
  areaMm2: number;
  /** Capacity as printed in the office's table, before any derating. */
  tableAmps: number;
  mvPerAmpMetre?: number;
  /** See VoltDropInput.mvIsThreePhase. Defaults to true, as the standard's do. */
  mvIsThreePhase?: boolean;
  reactanceOhmPerKm?: number;
  /** Where the row was read from. Carried through to the answer. */
  source: string;
}

export interface SizingInput {
  designCurrentA: number;
  lengthM: number;
  supplyVolts: number;
  phase: CircuitPhase;
  material: ConductorMaterial;
  operatingC: number;
  powerFactor?: number;
  limitPercent?: number;
  derating: DeratingFactor[];
  rows: CandidateRow[];
  ratings?: readonly number[];
  overloadRatio?: number;
  fault?: { faultA: number; clearingTimeS: number; startC: number; finalC: number };
}

export type SizingFailure = 'capacity' | 'volt drop' | 'protection' | 'fault';

export interface SizedCandidate {
  row: CandidateRow;
  /** Iz — capacity where it is installed. */
  capacityA: number;
  drop: VoltDropResult | null;
  protection: CoordinationResult;
  /** Null where no fault current was given. */
  faultMinimumMm2: number | null;
  passes: boolean;
  /** The first check it failed, in the order they are worked. */
  failedOn?: SizingFailure;
}

export interface SizingResult {
  /** The smallest row that passes every check. */
  chosen?: SizedCandidate;
  /** Every row, in size order, with why each was rejected. Nothing is hidden. */
  considered: SizedCandidate[];
  derating: DeratingResult;
  /** The k used for the fault check, so it can be shown and argued with. */
  k: number | null;
  /** Why nothing was chosen. Present exactly when `chosen` is not. */
  refusal?: string;
}

/**
 * Runs the whole chain over the office's table rows and picks the smallest
 * size that survives all four checks.
 *
 * The rows that fail come back too, each labelled with the check that stopped
 * it. That matters more than the answer: a designer who is told "16 mm²" and
 * nothing else cannot tell whether 10 mm² missed on capacity by a hair or was
 * never close, and the difference decides whether the run gets shortened or
 * the cable gets bigger.
 */
export function sizeCable(input: SizingInput): SizingResult {
  const derating = combineDerating(input.derating);
  const k = input.fault ? adiabaticK(input.material, input.fault.startC, input.fault.finalC) : null;

  const rows = [...input.rows].sort((a, b) => a.areaMm2 - b.areaMm2);
  const considered: SizedCandidate[] = [];

  for (const row of rows) {
    const capacityA = row.tableAmps * derating.factor;

    const drop = voltDrop({
      amps: input.designCurrentA,
      lengthM: input.lengthM,
      areaMm2: row.areaMm2,
      material: input.material,
      operatingC: input.operatingC,
      phase: input.phase,
      supplyVolts: input.supplyVolts,
      powerFactor: input.powerFactor,
      reactanceOhmPerKm: row.reactanceOhmPerKm,
      mvPerAmpMetre: row.mvPerAmpMetre,
      mvIsThreePhase: row.mvIsThreePhase,
      limitPercent: input.limitPercent,
    });

    const protection = coordinate({
      designCurrentA: input.designCurrentA,
      capacityA,
      ratings: input.ratings,
      overloadRatio: input.overloadRatio,
    });

    const fault = input.fault && k !== null
      ? minimumFaultSize({ faultA: input.fault.faultA, clearingTimeS: input.fault.clearingTimeS, k })
      : null;
    const faultMinimumMm2 = fault?.minimumAreaMm2 ?? null;

    let failedOn: SizingFailure | undefined;
    if (capacityA < input.designCurrentA) failedOn = 'capacity';
    else if (drop?.withinLimit === false) failedOn = 'volt drop';
    else if (!protection.ok) failedOn = 'protection';
    else if (faultMinimumMm2 !== null && row.areaMm2 < faultMinimumMm2) failedOn = 'fault';

    considered.push({ row, capacityA: round(capacityA, 1), drop, protection, faultMinimumMm2, passes: !failedOn, failedOn });
  }

  const chosen = considered.find((c) => c.passes);
  if (chosen) return { chosen, considered, derating, k };

  return { considered, derating, k, refusal: refusalFor(considered, input) };
}

/**
 * Why nothing passed, in the terms the person can act on.
 *
 * Not "no suitable cable found". Which check stopped the largest size tried,
 * because that is the one that decides what to do next: a volt drop failure
 * means shorten the run or raise the voltage, a capacity failure means the
 * installation method is wrong, and no rows at all means nothing has been
 * loaded.
 */
function refusalFor(considered: SizedCandidate[], input: SizingInput): string {
  if (!considered.length) {
    return 'No table rows are loaded for this cable and installation method. Load your own figures in Cable tables and the sizing runs against them.';
  }
  const largest = considered[considered.length - 1]!;
  switch (largest.failedOn) {
    case 'capacity':
      return `Even ${largest.row.areaMm2} mm² only carries ${largest.capacityA} A where this is installed, against a ${round(input.designCurrentA, 1)} A load. The installation method or the derating is what has to change.`;
    case 'volt drop':
      return `Every size loaded exceeds the ${largest.drop?.limitPercent ?? DEFAULT_DROP_LIMIT_PERCENT}% volt drop over ${input.lengthM} m. Shorten the run, raise the supply voltage, or load larger sizes.`;
    case 'protection':
      return `No device rating sits between the ${round(input.designCurrentA, 1)} A load and what these cables carry. ${largest.protection.reason}`;
    case 'fault':
      return `Every size loaded is below the ${largest.faultMinimumMm2} mm² the fault current needs. A faster protective device or a larger cable.`;
    default:
      return 'Nothing passed every check.';
  }
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
