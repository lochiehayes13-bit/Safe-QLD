/**
 * Hydrant and booster flow testing.
 *
 * A hydrant service is a flow-and-pressure test and very little else. The
 * technician stands at the hydraulically most disadvantaged outlet with a pitot
 * gauge, a pressure gauge and a pen, and the whole substance of the job is the
 * arithmetic done on the tailboard afterwards: what flow that pitot reading
 * represents, what the supply will still deliver once the residual is drawn
 * down to the pressure the brigade needs, and whether that clears the duty the
 * building was signed off against.
 *
 * The field failure this exists to prevent is a confident wrong pass. Three
 * ways it happens:
 *
 *  - The discharge coefficient is guessed. A 65 mm outlet flowed as if it were
 *    a smooth-bore nozzle reads about 21% high (0.97 against 0.80), which is
 *    the difference between 9 L/s and 11 L/s on a 10 L/s duty. So an outlet
 *    whose geometry has no sourced coefficient is REFUSED, not defaulted.
 *  - The residual barely moved. If the test only pulled the pressure down a few
 *    percent, projecting from it is extrapolating off a lever arm one pencil
 *    width long, and at zero drawdown the projection is arithmetically
 *    infinite. Those cases are refused too.
 *  - The required duty is invented. The flow and pressure a building must make
 *    come out of the standard's design tables and the building's own
 *    classification, and nothing in this file knows either. The duty is an
 *    INPUT the technician supplies. What ships is a short list of published
 *    figures, each carrying the regulator's URL and its jurisdiction, so a tech
 *    can pick one knowingly. This module checks against what it was told. It
 *    does not certify a design and it does not replace a hydraulic consultant.
 *
 * Units are kPa, L/min and mm throughout, converted at the edges. Queensland
 * gauges read kPa and Australian pipe is sized in mm; carrying psi or bar
 * internally would just add two more places to get a factor of ten wrong.
 *
 * No text, table or schedule from AS 2419, AS 1851 or any other standard is
 * reproduced here. Clause references and regulator URLs are recorded; the
 * standards themselves are not.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  title: string;
  detail: string;
}

/**
 * What a calculation returns when it will not answer.
 *
 * A refusal carries its reason in the data rather than in a log line, because
 * the reason has to reach the technician's screen and, when the test is written
 * up, the report.
 */
export interface Refused {
  ok: false;
  reason: string;
  issues: Issue[];
}

function refuse(reason: string, issues: Issue[] = []): Refused {
  return { ok: false, reason, issues };
}

export function isRefused(r: { ok: boolean }): r is Refused {
  return r.ok === false;
}

// ---------------------------------------------------------------------------
// Physical constants and edge conversions
// ---------------------------------------------------------------------------

/** Fresh water. Salt water and foam solution are not what a hydrant test flows. */
export const WATER_DENSITY_KG_PER_M3 = 1000;

/** Standard gravity, CODATA/SI defined value. https://physics.nist.gov/cgi-bin/cuu/Value?gn */
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665;

/**
 * One metre of water column, in kPa.
 *
 * 9.80665 rather than the tailboard 10: a 30 m riser is 294 kPa, not 300, and
 * the 6 kPa of daylight between those two numbers is roughly a floor and a half
 * of head on a marginal system.
 */
export const KPA_PER_METRE_OF_HEAD = (WATER_DENSITY_KG_PER_M3 * STANDARD_GRAVITY_M_PER_S2) / 1000;

export const KPA_PER_PSI = 6.894757293168;
export const KPA_PER_BAR = 100;

export const psiToKpa = (psi: number): number => psi * KPA_PER_PSI;
export const kpaToPsi = (kpa: number): number => kpa / KPA_PER_PSI;
export const barToKpa = (bar: number): number => bar * KPA_PER_BAR;
export const lpsToLpm = (lps: number): number => lps * 60;
export const lpmToLps = (lpm: number): number => lpm / 60;

/** Metres of static lift, as kPa of head. Negative rise (a drop) adds pressure. */
export function headToKpa(metres: number): number | null {
  if (!Number.isFinite(metres)) return null;
  return round(metres * KPA_PER_METRE_OF_HEAD, 3);
}

/** kPa expressed as metres of water column. */
export function kpaToHead(kpa: number): number | null {
  if (!Number.isFinite(kpa)) return null;
  return round(kpa / KPA_PER_METRE_OF_HEAD, 3);
}

// ---------------------------------------------------------------------------
// Flow from a pitot reading
// ---------------------------------------------------------------------------

/**
 * Discharge coefficients by outlet geometry.
 *
 * The three bare-outlet values are the long-standing fire-service figures for
 * a rounded, a square-edged and an inward-projecting outlet; the nozzle and
 * playpipe values are the equally long-standing smooth-bore ones. Every entry
 * names where it came from.
 *
 * There is deliberately no entry for "65 mm Australian hydrant outlet" as such.
 * The coefficient is a property of the outlet's geometry, not its nominal size
 * or country, and the tech looking down the barrel is the one who can see
 * whether the throat is rounded, cut square, or a spigot standing proud inside
 * it. Offering a national default would be inventing a number.
 */
export interface OutletSpec {
  id: OutletId;
  label: string;
  /** What the tech is looking for when choosing this one. */
  geometry: string;
  /** Null where no coefficient can be sourced — the calculation then refuses. */
  coefficient: number | null;
  source: string;
  url?: string;
  confidence: Confidence;
  note?: string;
}

export type OutletId =
  | 'rounded'
  | 'square-edged'
  | 'projecting'
  | 'stream-straightener'
  | 'smooth-bore-nozzle'
  | 'short-playpipe'
  | 'unknown';

const WSRB_URL = 'https://www1.wsrb.com/resources/hydrant-flow-testing';
const QRFS_PLAYPIPE_URL = 'https://blog.qrfs.com/200-whats-a-firefighting-playpipe-and-why-do-we-call-it-that/';

export const OUTLETS: OutletSpec[] = [
  {
    id: 'rounded',
    label: 'Rounded outlet',
    geometry: 'Throat rounded where it meets the barrel; no lip to catch a fingernail on.',
    coefficient: 0.9,
    source: 'WSRB Guide to Hydrant Flow Testing, restating the NFPA 291 coefficients',
    url: WSRB_URL,
    confidence: 'medium',
    note: 'Widely published and long established, but restated by an insurance advisory rather than measured on this outlet.',
  },
  {
    id: 'square-edged',
    label: 'Square-edged outlet',
    geometry: 'Outlet cut square and flush with the inside of the barrel — the most common case.',
    coefficient: 0.8,
    source: 'WSRB Guide to Hydrant Flow Testing, restating the NFPA 291 coefficients',
    url: WSRB_URL,
    confidence: 'medium',
  },
  {
    id: 'projecting',
    label: 'Outlet projecting into the barrel',
    geometry: 'The outlet tube stands proud inside the barrel, so the flow has to turn into it.',
    coefficient: 0.7,
    source: 'WSRB Guide to Hydrant Flow Testing, restating the NFPA 291 coefficients',
    url: WSRB_URL,
    confidence: 'medium',
  },
  {
    id: 'stream-straightener',
    label: 'Outlet fitted with a stream straightener',
    geometry: 'A vaned diffuser fitted to the outlet to settle the stream before the pitot.',
    coefficient: 0.95,
    source: 'WSRB Guide to Hydrant Flow Testing',
    url: WSRB_URL,
    confidence: 'medium',
    note: 'Use the straightener manufacturer’s own figure in preference to this one where they publish it.',
  },
  {
    id: 'smooth-bore-nozzle',
    label: 'Smooth-bore nozzle',
    geometry: 'A tapered smooth-bore tip on a standpipe or branch — measure the tip bore, not the hose.',
    coefficient: 0.97,
    source: 'QRFS, on published smooth-bore and playpipe coefficients',
    url: QRFS_PLAYPIPE_URL,
    confidence: 'low',
    note: 'Trade publication, not a manufacturer’s test certificate. Published values sit between 0.96 and 0.98.',
  },
  {
    id: 'short-playpipe',
    label: 'Short playpipe',
    geometry: 'Short smooth-bore playpipe, no shut-off.',
    coefficient: 0.96,
    source: 'QRFS, on published smooth-bore and playpipe coefficients',
    url: QRFS_PLAYPIPE_URL,
    confidence: 'low',
  },
  {
    id: 'unknown',
    label: 'Not identified',
    geometry: 'The outlet geometry has not been established.',
    coefficient: null,
    source: 'No source — deliberately no value.',
    confidence: 'low',
    note:
      'A pitot flow cannot be calculated without a coefficient. Identify the geometry, or use a flow meter, ' +
      'or enter a coefficient from the equipment documentation.',
  },
];

export function outletSpec(id: OutletId): OutletSpec | undefined {
  return OUTLETS.find((o) => o.id === id);
}

/**
 * The metric pitot constant, for the working shown on screen.
 *
 * Derived rather than looked up. Q = Cd·A·v with v = √(2P/ρ); at ρ = 1000 kg/m³
 * a pressure in kPa gives v = √(2P) directly in m/s, and the rest is the area of
 * a circle in mm² and a conversion to litres per minute:
 *
 *   (π/4) × 10⁻⁶ × √2 × 60000 = 0.0666433
 *
 * so Q(L/min) = 0.0666433 × Cd × d(mm)² × √P(kPa).
 *
 * The test pins this against the published imperial constant — the same
 * derivation in gpm, inches and psi gives 29.82, against the 29.83/29.84 that
 * NFPA 291 and every US flow-test form print. Agreeing with a number arrived at
 * independently seventy years ago is the check that the derivation is right.
 */
export const PITOT_CONSTANT_METRIC = (Math.PI / 4) * 1e-6 * Math.sqrt(2) * 60000;

/**
 * Accuracy window for a hand-held pitot, from NFPA 291 as reported in trade
 * guidance: below 10 psi the stream does not fill the outlet, above 30 psi it
 * is hard to hold the tube steady in the jet.
 */
export const PITOT_MIN_RELIABLE_KPA = psiToKpa(10);
export const PITOT_MAX_RELIABLE_KPA = psiToKpa(30);
const PITOT_WINDOW_URL = 'https://blog.qrfs.com/370-nfpa-guidance-on-fire-hydrant-testing/';

export interface PitotFlowInput {
  /** Pitot gauge reading, kPa. */
  pitotKpa: number;
  /** Bore of the outlet or nozzle tip the stream leaves, mm. */
  outletDiameterMm: number;
  outlet: OutletId;
  /**
   * Coefficient taken from the equipment's own documentation, overriding the
   * geometry table. Recorded as technician-supplied so the report says so.
   */
  coefficientOverride?: number;
}

export interface PitotFlow {
  ok: true;
  flowLpm: number;
  flowLps: number;
  /** Stream velocity at the outlet, m/s — the sanity check on a silly reading. */
  velocityMs: number;
  coefficient: number;
  coefficientSource: string;
  coefficientConfidence: Confidence;
  issues: Issue[];
}

/**
 * Flow from a pitot reading, Q = K·Cd·d²·√P.
 *
 * Refuses rather than guesses in three cases: a negative pressure, a
 * non-positive diameter, and — the one that matters — an outlet whose
 * coefficient is not sourced.
 */
export function pitotFlow(input: PitotFlowInput): PitotFlow | Refused {
  const { pitotKpa, outletDiameterMm } = input;
  if (![pitotKpa, outletDiameterMm].every(Number.isFinite)) {
    return refuse('Enter a pitot pressure and an outlet diameter.');
  }
  if (pitotKpa < 0) {
    return refuse('A pitot reading below zero is not a flow. Check the gauge is zeroed and reading gauge pressure.');
  }
  if (outletDiameterMm <= 0) {
    return refuse('Outlet diameter must be greater than zero.');
  }

  const spec = outletSpec(input.outlet);
  const override = input.coefficientOverride;
  let coefficient: number;
  let coefficientSource: string;
  let coefficientConfidence: Confidence;

  if (override !== undefined) {
    if (!Number.isFinite(override) || override <= 0 || override > 1) {
      return refuse('A discharge coefficient has to be greater than 0 and no more than 1.');
    }
    coefficient = override;
    coefficientSource = 'Entered by the technician from the equipment documentation';
    coefficientConfidence = 'medium';
  } else {
    if (!spec) {
      return refuse(`No outlet type "${input.outlet}" is held, so no coefficient can be applied.`);
    }
    if (spec.coefficient === null) {
      return refuse(
        `No discharge coefficient is sourced for "${spec.label}", so the flow cannot be calculated. ` +
          'Identify the outlet geometry, flow it through a meter, or enter the coefficient from the equipment documentation.',
      );
    }
    coefficient = spec.coefficient;
    coefficientSource = spec.source;
    coefficientConfidence = spec.confidence;
  }

  const velocityMs = Math.sqrt(2 * pitotKpa);
  const flowLpm = PITOT_CONSTANT_METRIC * coefficient * outletDiameterMm * outletDiameterMm * Math.sqrt(pitotKpa);

  const issues: Issue[] = [];
  if (pitotKpa > 0 && pitotKpa < PITOT_MIN_RELIABLE_KPA) {
    issues.push({
      level: 'warning',
      title: `Pitot reading below ${round(PITOT_MIN_RELIABLE_KPA, 0)} kPa`,
      detail:
        'Below about 10 psi the stream does not fill the outlet, so the reading understates the flow by an amount ' +
        `nobody can quantify afterwards. Open a larger outlet or flow more of them. Source: ${PITOT_WINDOW_URL}`,
    });
  }
  if (pitotKpa > PITOT_MAX_RELIABLE_KPA) {
    issues.push({
      level: 'warning',
      title: `Pitot reading above ${round(PITOT_MAX_RELIABLE_KPA, 0)} kPa`,
      detail:
        'Holding a pitot tube steady and central in a jet this hard is difficult, and an off-centre tube reads low. ' +
        `Consider a smaller outlet or a flow meter. Source: ${PITOT_WINDOW_URL}`,
    });
  }
  if (coefficientConfidence === 'low') {
    issues.push({
      level: 'info',
      title: 'Discharge coefficient is second-hand',
      detail: `${coefficientSource}. Prefer the equipment manufacturer's own figure where one is published.`,
    });
  }

  return {
    ok: true,
    flowLpm: round(flowLpm, 1),
    flowLps: round(flowLpm / 60, 3),
    velocityMs: round(velocityMs, 2),
    coefficient,
    coefficientSource,
    coefficientConfidence,
    issues,
  };
}

/** Several outlets flowed at once. Refuses the whole set if any one of them refuses. */
export function totalPitotFlow(readings: PitotFlowInput[]): { ok: true; flowLpm: number; flowLps: number; parts: PitotFlow[]; issues: Issue[] } | Refused {
  if (readings.length === 0) return refuse('No pitot readings entered.');
  const parts: PitotFlow[] = [];
  const issues: Issue[] = [];
  for (let i = 0; i < readings.length; i++) {
    const r = pitotFlow(readings[i]!);
    if (isRefused(r)) return refuse(`Outlet ${i + 1}: ${r.reason}`, r.issues);
    parts.push(r);
    issues.push(...r.issues);
  }
  const flowLpm = parts.reduce((sum, p) => sum + p.flowLpm, 0);
  return { ok: true, flowLpm: round(flowLpm, 1), flowLps: round(flowLpm / 60, 3), parts, issues };
}

// ---------------------------------------------------------------------------
// Flow from a meter, or from a device with a known K-factor
// ---------------------------------------------------------------------------

export type FlowUnit = 'lpm' | 'lps' | 'm3h' | 'usgpm';

const FLOW_TO_LPM: Record<FlowUnit, number> = {
  lpm: 1,
  lps: 60,
  m3h: 1000 / 60,
  usgpm: 3.785411784,
};

/**
 * A flow meter reading, normalised to L/min.
 *
 * Returns null for a unit that is not held rather than assuming L/min: a
 * hydrant test rig bought from a US supplier reads gpm, and treating 250 gpm as
 * 250 L/min turns a comfortable pass into a fail nobody can explain.
 */
export function flowMeterToLpm(value: number, unit: FlowUnit): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const factor = FLOW_TO_LPM[unit];
  if (factor === undefined) return null;
  return round(value * factor, 2);
}

/**
 * K-factor units, which are the whole difficulty.
 *
 * The same nozzle is published as K = 80 in one catalogue and K = 8 in another
 * because one is L/min per √bar and the other L/min per √kPa — a factor of
 * √100 = 10. So the units are a required input and there is no default. A
 * K-factor with no stated units is not usable and is refused.
 */
export type KFactorUnit = 'lpm-per-sqrt-kpa' | 'lpm-per-sqrt-bar';

/** Multiply a K in these units by this to get L/min per √kPa. */
export const K_UNIT_TO_LPM_PER_SQRT_KPA: Record<KFactorUnit, number> = {
  'lpm-per-sqrt-kpa': 1,
  'lpm-per-sqrt-bar': 1 / Math.sqrt(KPA_PER_BAR),
};

export interface KFactorFlowInput {
  /** Nominal K as printed on the device or its data sheet. */
  k: number;
  kUnit: KFactorUnit;
  /** Pressure at the device, kPa. */
  pressureKpa: number;
}

export interface KFactorFlow {
  ok: true;
  flowLpm: number;
  flowLps: number;
  /** K restated in L/min per √kPa, which is what the arithmetic used. */
  kInLpmPerSqrtKpa: number;
  issues: Issue[];
}

/**
 * Flow through a standpipe, monitor or nozzle of known K-factor: Q = K√P.
 *
 * This is the sound way to measure a hydrant flow when the equipment carries a
 * calibrated K — no pitot tube to hold steady and no coefficient to judge by
 * eye. It is only as good as the K, so the units are made explicit above.
 */
export function kFactorFlow(input: KFactorFlowInput): KFactorFlow | Refused {
  const { k, pressureKpa } = input;
  if (![k, pressureKpa].every(Number.isFinite)) return refuse('Enter a K-factor and a pressure.');
  if (k <= 0) return refuse('K-factor must be greater than zero.');
  if (pressureKpa < 0) return refuse('Pressure at the device cannot be negative.');
  const factor = K_UNIT_TO_LPM_PER_SQRT_KPA[input.kUnit];
  if (factor === undefined) {
    return refuse(
      'The units of the K-factor have not been stated. L/min per √bar and L/min per √kPa differ by a factor of ten, ' +
        'so the figure cannot be used until the data sheet is read.',
    );
  }

  const kKpa = k * factor;
  const flowLpm = kKpa * Math.sqrt(pressureKpa);
  return {
    ok: true,
    flowLpm: round(flowLpm, 1),
    flowLps: round(flowLpm / 60, 3),
    kInLpmPerSqrtKpa: round(kKpa, 4),
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// Friction loss
// ---------------------------------------------------------------------------

/**
 * Hazen-Williams, not Darcy-Weisbach.
 *
 * Both are defensible; Hazen-Williams is chosen because it is the convention of
 * the fire industry and of the Australian sprinkler and hydrant hydraulic
 * calculations a consultant's report will have used, so a figure produced here
 * can be compared with the design without a translation step. It also needs
 * only a material coefficient, where Darcy-Weisbach needs an absolute
 * roughness, a water temperature and an iteration on Reynolds number — three
 * more things to be wrong about on a tailboard.
 *
 * Its limits are real and are reported: it is an empirical fit for water at
 * ordinary temperatures and for velocities of roughly 0.6 to 3 m/s, and it
 * drifts outside that band.
 *
 * The SI form used is:
 *
 *   h_f = 10.67 · L · Q^1.852 / (C^1.852 · D^4.87)
 *
 * with h_f and L in m, Q in m³/s and D in m. The test cross-checks it against
 * the fire-industry metric form (p = 6.05×10⁵ · Q^1.85 / (C^1.85 · d^4.87), bar
 * per metre, L/min, mm) and against a hose manufacturer's own published loss.
 */
export const HAZEN_WILLIAMS_SI_CONSTANT = 10.67;

/** The band Hazen-Williams was fitted over. Outside it, the result is flagged. */
export const HW_VELOCITY_MIN_MS = 0.6;
export const HW_VELOCITY_MAX_MS = 3.0;

export interface ConduitSpec {
  id: ConduitId;
  label: string;
  /**
   * Published range. The low end is what the calculation uses, because it gives
   * the greater loss — a friction estimate that flatters the system is the one
   * that gets a technician to a pass they cannot defend.
   */
  cLow: number;
  cHigh: number;
  source: string;
  url: string;
  confidence: Confidence;
  note?: string;
}

export type ConduitId =
  | 'layflat-hose'
  | 'cast-iron-new'
  | 'cast-iron-20yr'
  | 'cast-iron-40yr'
  | 'galvanised-iron'
  | 'steel-new'
  | 'steel-lined'
  | 'copper'
  | 'plastic'
  | 'asbestos-cement'
  | 'concrete-spun';

const BENTLEY_C_URL =
  'https://docs.bentley.com/LiveContent/web/Bentley%20HAMMER%20SS6-v1/en/GUID-4DE7ECDF-A8B3-4D7B-948F-5647631E6DD0.html';
const BENTLEY_C_SOURCE = 'Bentley HAMMER documentation, Hazen-Williams roughness values';
const AFH_HOSE_URL = 'http://afh.com.au/products/sbr800/';

/**
 * Hazen-Williams C by material.
 *
 * These are general hydraulics values from a software vendor's published table,
 * not a fire standard's own table, and they are marked medium confidence
 * accordingly. Where a design calculation is being checked, the C value the
 * standard nominates for that material governs and should be entered directly.
 *
 * The hose entry is the one worth reading twice. No manufacturer publishes a C
 * for layflat hose, but Australian Fire Hose publishes measured friction loss
 * for its SBR800 at four sizes; back-solving Hazen-Williams against all four
 * gives C between 146 and 161, so 146 is carried as the low end and 161 as the
 * high. That is a derivation from a primary source, not a published figure, and
 * is marked as such.
 */
export const CONDUITS: ConduitSpec[] = [
  {
    id: 'layflat-hose',
    label: 'Layflat delivery hose, rubber lined',
    cLow: 146,
    cHigh: 161,
    source: 'Derived from Australian Fire Hose SBR800 published friction loss at 25, 38, 65 and 70 mm',
    url: AFH_HOSE_URL,
    confidence: 'medium',
    note:
      'Back-solved from the manufacturer’s own measured loss figures, not published as a C value. ' +
      'A worn or badly coupled length will do worse than any of this.',
  },
  { id: 'cast-iron-new', label: 'Cast iron, new, unlined', cLow: 130, cHigh: 130, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  {
    id: 'cast-iron-20yr',
    label: 'Cast iron, about 20 years old',
    cLow: 89,
    cHigh: 100,
    source: BENTLEY_C_SOURCE,
    url: BENTLEY_C_URL,
    confidence: 'medium',
    note: 'Age matters more than material on old reticulation — tuberculation roughly halves C over forty years.',
  },
  { id: 'cast-iron-40yr', label: 'Cast iron, about 40 years old', cLow: 64, cHigh: 83, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'galvanised-iron', label: 'Galvanised iron', cLow: 120, cHigh: 120, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'steel-new', label: 'Steel, new, unlined', cLow: 140, cHigh: 150, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'steel-lined', label: 'Steel, coal-tar enamel lined', cLow: 145, cHigh: 150, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'copper', label: 'Copper', cLow: 130, cHigh: 140, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'plastic', label: 'Plastic (PVC, PE)', cLow: 140, cHigh: 150, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'asbestos-cement', label: 'Asbestos cement', cLow: 140, cHigh: 140, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
  { id: 'concrete-spun', label: 'Concrete, centrifugally spun', cLow: 135, cHigh: 135, source: BENTLEY_C_SOURCE, url: BENTLEY_C_URL, confidence: 'medium' },
];

export function conduitSpec(id: ConduitId): ConduitSpec | undefined {
  return CONDUITS.find((c) => c.id === id);
}

export interface FrictionLossInput {
  flowLpm: number;
  /** Internal diameter, mm. On hose this is the nominal bore; on pipe it is not the nominal size. */
  internalDiameterMm: number;
  lengthM: number;
  conduit?: ConduitId;
  /** C from the design documents or the standard, which overrides the material table. */
  cOverride?: number;
}

export interface FrictionLoss {
  ok: true;
  /** Loss expressed as head, m. */
  headLossM: number;
  pressureLossKpa: number;
  lossKpaPerM: number;
  velocityMs: number;
  c: number;
  cSource: string;
  cConfidence: Confidence;
  issues: Issue[];
}

/** Friction loss along a hose or pipe run, by Hazen-Williams. */
export function frictionLoss(input: FrictionLossInput): FrictionLoss | Refused {
  const { flowLpm, internalDiameterMm, lengthM } = input;
  if (![flowLpm, internalDiameterMm, lengthM].every(Number.isFinite)) {
    return refuse('Enter a flow, an internal diameter and a length.');
  }
  if (flowLpm < 0) return refuse('Flow cannot be negative.');
  if (internalDiameterMm <= 0) return refuse('Internal diameter must be greater than zero.');
  if (lengthM < 0) return refuse('Length cannot be negative.');

  let c: number;
  let cSource: string;
  let cConfidence: Confidence;
  if (input.cOverride !== undefined) {
    if (!Number.isFinite(input.cOverride) || input.cOverride <= 0) {
      return refuse('The Hazen-Williams C value must be greater than zero.');
    }
    c = input.cOverride;
    cSource = 'Entered by the technician from the design documents';
    cConfidence = 'medium';
  } else {
    const spec = input.conduit ? conduitSpec(input.conduit) : undefined;
    if (!spec) {
      return refuse(
        'No material selected, so no roughness coefficient applies. Friction loss cannot be estimated without one — ' +
          'pick the material or enter the C value from the design.',
      );
    }
    c = spec.cLow;
    cSource = spec.source;
    cConfidence = spec.confidence;
  }

  const qM3s = flowLpm / 60000;
  const dM = internalDiameterMm / 1000;
  const areaM2 = (Math.PI / 4) * dM * dM;
  const velocityMs = areaM2 > 0 ? qM3s / areaM2 : 0;

  const headLossM =
    (HAZEN_WILLIAMS_SI_CONSTANT * lengthM * Math.pow(qM3s, 1.852)) / (Math.pow(c, 1.852) * Math.pow(dM, 4.87));
  const pressureLossKpa = headLossM * KPA_PER_METRE_OF_HEAD;

  const issues: Issue[] = [];
  if (flowLpm > 0 && velocityMs > HW_VELOCITY_MAX_MS) {
    issues.push({
      level: 'warning',
      title: `Velocity ${round(velocityMs, 1)} m/s is above the Hazen-Williams band`,
      detail:
        `Hazen-Williams is fitted for roughly ${HW_VELOCITY_MIN_MS}–${HW_VELOCITY_MAX_MS} m/s and understates loss ` +
        'above it. Treat this figure as a floor, not an estimate.',
    });
  }
  if (flowLpm > 0 && velocityMs < HW_VELOCITY_MIN_MS) {
    issues.push({
      level: 'info',
      title: `Velocity ${round(velocityMs, 2)} m/s is below the Hazen-Williams band`,
      detail: 'The loss is small enough at this velocity that the error hardly matters, but the fit is outside its range.',
    });
  }
  if (input.cOverride === undefined && input.conduit === 'layflat-hose') {
    issues.push({
      level: 'info',
      title: 'Hose C value is derived, not published',
      detail:
        'Back-solved from Australian Fire Hose’s published SBR800 loss figures. Another hose, or a tired one, will do worse. ' +
        `Source: ${AFH_HOSE_URL}`,
    });
  }

  return {
    ok: true,
    headLossM: round(headLossM, 3),
    pressureLossKpa: round(pressureLossKpa, 2),
    lossKpaPerM: lengthM > 0 ? round(pressureLossKpa / lengthM, 4) : 0,
    velocityMs: round(velocityMs, 3),
    c,
    cSource,
    cConfidence,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Static, residual and the projection between them
// ---------------------------------------------------------------------------

/**
 * The exponent in the flow-versus-drawdown relationship, which falls out of
 * Hazen-Williams: loss goes as Q^1.852, so Q goes as loss^(1/1.852) = ^0.54.
 */
export const DRAWDOWN_EXPONENT = 0.54;

/**
 * Least drawdown worth projecting from, as a fraction of static.
 *
 * NFPA 291 asks for a drop of at least 25% at the residual hydrant. Below that
 * the two points are so close together that the fitted curve swings wildly on
 * a gauge needle's width, so anything under 25% is warned about and anything
 * under 5% is refused outright.
 */
export const RECOMMENDED_DRAWDOWN_FRACTION = 0.25;
export const MINIMUM_USABLE_DRAWDOWN_FRACTION = 0.05;
const NFPA291_DRAWDOWN_URL = 'https://blog.qrfs.com/370-nfpa-guidance-on-fire-hydrant-testing/';

export interface ProjectionInput {
  /** Pressure at the test hydrant with nothing flowing, kPa. */
  staticKpa: number;
  /** Pressure at the same gauge while the test flow was running, kPa. */
  residualKpa: number;
  /** Flow actually measured during the test, L/min. */
  measuredFlowLpm: number;
  /** The residual pressure the answer is wanted at, kPa. */
  targetResidualKpa: number;
}

export interface Projection {
  ok: true;
  /** Flow the supply will deliver at the target residual, L/min. */
  projectedFlowLpm: number;
  projectedFlowLps: number;
  /** Static minus measured residual, kPa. The lever arm the projection sits on. */
  measuredDrawdownKpa: number;
  /** Static minus target residual, kPa. */
  targetDrawdownKpa: number;
  drawdownFraction: number;
  /** True when the target is below the measured residual, so the curve is being extended past the data. */
  extrapolating: boolean;
  issues: Issue[];
}

/**
 * The question a hydrant test actually answers: given what the supply did at
 * one measured flow, what will it deliver at the residual pressure the brigade
 * needs?
 *
 *   Q_target = Q_measured × (Δ_target / Δ_measured)^0.54
 *
 * Refusals here are the important part of the function. A residual above static
 * means the gauge or the procedure is wrong. A residual equal to static means
 * the denominator is zero and the projection is infinite — there is no answer,
 * and returning a very large number instead of refusing is how a dead main gets
 * written up as unlimited supply.
 */
export function projectAvailableFlow(input: ProjectionInput): Projection | Refused {
  const { staticKpa, residualKpa, measuredFlowLpm, targetResidualKpa } = input;
  if (![staticKpa, residualKpa, measuredFlowLpm, targetResidualKpa].every(Number.isFinite)) {
    return refuse('Enter static pressure, residual pressure, measured flow and the target residual.');
  }
  if (staticKpa <= 0) return refuse('Static pressure must be above zero — there is nothing to draw down.');
  if (measuredFlowLpm <= 0) return refuse('A projection needs a measured flow greater than zero.');
  if (residualKpa > staticKpa) {
    return refuse(
      'The residual read higher than the static. Either the hydrant was not flowing when the residual was taken, ' +
        'the two readings came from different gauges, or the gauge is faulty.',
    );
  }
  if (targetResidualKpa < 0) return refuse('Target residual pressure cannot be negative.');
  if (targetResidualKpa > staticKpa) {
    return refuse(
      `The target residual of ${round(targetResidualKpa, 0)} kPa is above the static of ${round(staticKpa, 0)} kPa. ` +
        'The supply never reaches that pressure, at any flow.',
    );
  }

  const measuredDrawdownKpa = staticKpa - residualKpa;
  const targetDrawdownKpa = staticKpa - targetResidualKpa;
  const drawdownFraction = measuredDrawdownKpa / staticKpa;

  if (measuredDrawdownKpa <= 0) {
    return refuse(
      'The residual did not move off the static, so the supply curve cannot be established from this test. ' +
        'Flow more water — the pressure has to come down before anything can be projected from it.',
    );
  }
  if (drawdownFraction < MINIMUM_USABLE_DRAWDOWN_FRACTION) {
    return refuse(
      `The residual only fell ${round(drawdownFraction * 100, 1)}% below static. A projection off a drawdown that ` +
        'small is dominated by gauge error and would be a number, not an answer. Flow more outlets and retest.',
    );
  }

  const projectedFlowLpm = measuredFlowLpm * Math.pow(targetDrawdownKpa / measuredDrawdownKpa, DRAWDOWN_EXPONENT);

  const issues: Issue[] = [];
  if (drawdownFraction < RECOMMENDED_DRAWDOWN_FRACTION) {
    issues.push({
      level: 'warning',
      title: `Drawdown of ${round(drawdownFraction * 100, 1)}% is below the recommended 25%`,
      detail:
        'NFPA 291 asks for the residual to fall at least a quarter below static before projecting from it. ' +
        `This result will be sensitive to a few kPa of gauge error. Source: ${NFPA291_DRAWDOWN_URL}`,
    });
  }
  const extrapolating = targetResidualKpa < residualKpa;
  if (extrapolating) {
    issues.push({
      level: 'info',
      title: 'This is an extrapolation, not an interpolation',
      detail:
        `The target residual of ${round(targetResidualKpa, 0)} kPa is below the ${round(residualKpa, 0)} kPa actually ` +
        'measured, so the curve is being extended past the data. It assumes the supply keeps behaving the same way, ' +
        'which a partly shut valve or a pump cut-in will not.',
    });
  }

  return {
    ok: true,
    projectedFlowLpm: round(projectedFlowLpm, 1),
    projectedFlowLps: round(projectedFlowLpm / 60, 3),
    measuredDrawdownKpa: round(measuredDrawdownKpa, 1),
    targetDrawdownKpa: round(targetDrawdownKpa, 1),
    drawdownFraction: round(drawdownFraction, 4),
    extrapolating,
    issues,
  };
}

/**
 * The inverse: what residual is left when a given flow is drawn.
 *
 * Same curve, rearranged. Useful for the question "what will I see at the top
 * hydrant when the brigade is flowing 10 L/s downstairs".
 */
export function projectResidualAtFlow(
  input: Omit<ProjectionInput, 'targetResidualKpa'> & { targetFlowLpm: number },
): { ok: true; residualKpa: number; issues: Issue[] } | Refused {
  const probe = projectAvailableFlow({ ...input, targetResidualKpa: 0 });
  if (isRefused(probe)) return probe;
  if (!Number.isFinite(input.targetFlowLpm) || input.targetFlowLpm < 0) {
    return refuse('Enter the flow the residual is wanted at.');
  }
  const measuredDrawdown = input.staticKpa - input.residualKpa;
  const drawdownAtTarget = measuredDrawdown * Math.pow(input.targetFlowLpm / input.measuredFlowLpm, 1 / DRAWDOWN_EXPONENT);
  const residualKpa = input.staticKpa - drawdownAtTarget;
  const issues: Issue[] = [...probe.issues.filter((i) => i.title.includes('Drawdown'))];
  if (residualKpa < 0) {
    issues.push({
      level: 'error',
      title: 'The supply runs out before that flow',
      detail:
        `Drawing ${round(input.targetFlowLpm / 60, 1)} L/s would take the residual below zero on this curve — the ` +
        'supply cannot deliver it at any usable pressure.',
    });
  }
  return { ok: true, residualKpa: round(residualKpa, 1), issues };
}

// ---------------------------------------------------------------------------
// Elevation and the booster
// ---------------------------------------------------------------------------

export interface SupplyChainInput {
  /** Pressure available at the source — street main residual, or booster inlet, kPa. */
  sourceKpa: number;
  /** Height of the test hydrant above the source, m. Negative for a basement. */
  elevationRiseM: number;
  /** Friction loss between the two, kPa. Usually from frictionLoss(). */
  frictionLossKpa?: number;
}

export interface SupplyChain {
  ok: true;
  /** Pressure arriving at the hydrant, kPa. */
  arrivingKpa: number;
  elevationLossKpa: number;
  frictionLossKpa: number;
  issues: Issue[];
}

/**
 * What is left at the hydrant after the lift and the pipe.
 *
 * A hydrant three storeys up is the binding case on nearly every job in South
 * East Queensland, and it is binding for a reason that has nothing to do with
 * the pump: 10 m of rise costs 98 kPa before a drop of water has moved.
 */
export function pressureAtHydrant(input: SupplyChainInput): SupplyChain | Refused {
  const { sourceKpa, elevationRiseM } = input;
  if (![sourceKpa, elevationRiseM].every(Number.isFinite)) {
    return refuse('Enter the source pressure and the height of the hydrant above it.');
  }
  const friction = input.frictionLossKpa ?? 0;
  if (!Number.isFinite(friction) || friction < 0) return refuse('Friction loss cannot be negative.');

  const elevationLossKpa = elevationRiseM * KPA_PER_METRE_OF_HEAD;
  const arrivingKpa = sourceKpa - elevationLossKpa - friction;

  const issues: Issue[] = [];
  if (arrivingKpa <= 0) {
    issues.push({
      level: 'error',
      title: 'Nothing arrives at the hydrant',
      detail:
        `${round(sourceKpa, 0)} kPa will not lift water ${round(elevationRiseM, 1)} m and cover ${round(friction, 0)} kPa ` +
        'of friction. At this flow the outlet is dry.',
    });
  }
  if (input.frictionLossKpa === undefined) {
    issues.push({
      level: 'info',
      title: 'Friction not included',
      detail: 'This is the static lift only. Add the friction loss along the run for the flowing case.',
    });
  }

  return {
    ok: true,
    arrivingKpa: round(arrivingKpa, 1),
    elevationLossKpa: round(elevationLossKpa, 1),
    frictionLossKpa: round(friction, 1),
    issues,
  };
}

export interface BoostRequirementInput {
  /** Residual wanted at the hydrant outlet, kPa. */
  requiredResidualKpa: number;
  elevationRiseM: number;
  frictionLossKpa: number;
  /** Pressure the brigade will find at the booster inlet, kPa. */
  inletKpa?: number;
}

export interface BoostRequirement {
  ok: true;
  /** Pressure that must be delivered into the booster, kPa. */
  requiredAtBoosterKpa: number;
  elevationLossKpa: number;
  frictionLossKpa: number;
  /** How much the appliance has to add over what the inlet already provides. */
  boostNeededKpa: number | null;
  issues: Issue[];
}

/**
 * What has to go into the booster to get the required residual out of the top
 * hydrant.
 *
 * This is the number that belongs on the boost pressure sign, and the reason it
 * is worth calculating on site is that the sign is often wrong — it was
 * computed for the building as designed, and a later riser extension or a
 * changed test point moves it.
 *
 * Composed from the elevation and friction terms above rather than pinned to a
 * published worked example of its own; each part is verified separately.
 */
export function requiredBoostPressure(input: BoostRequirementInput): BoostRequirement | Refused {
  const { requiredResidualKpa, elevationRiseM, frictionLossKpa } = input;
  if (![requiredResidualKpa, elevationRiseM, frictionLossKpa].every(Number.isFinite)) {
    return refuse('Enter the required residual, the rise to the hydrant and the friction loss along the run.');
  }
  if (requiredResidualKpa < 0) return refuse('Required residual pressure cannot be negative.');
  if (frictionLossKpa < 0) return refuse('Friction loss cannot be negative.');

  const elevationLossKpa = elevationRiseM * KPA_PER_METRE_OF_HEAD;
  const requiredAtBoosterKpa = requiredResidualKpa + elevationLossKpa + frictionLossKpa;
  const boostNeededKpa =
    input.inletKpa !== undefined && Number.isFinite(input.inletKpa)
      ? Math.max(0, requiredAtBoosterKpa - input.inletKpa)
      : null;

  const issues: Issue[] = [
    {
      level: 'info',
      title: 'Friction is at the design flow',
      detail:
        'The friction term has to be the loss at the flow the duty calls for, not at the flow that happened to be ' +
        'running. Loss rises as roughly the square of flow, so halving the flow quarters it.',
    },
  ];

  return {
    ok: true,
    requiredAtBoosterKpa: round(requiredAtBoosterKpa, 1),
    elevationLossKpa: round(elevationLossKpa, 1),
    frictionLossKpa: round(frictionLossKpa, 1),
    boostNeededKpa: boostNeededKpa === null ? null : round(boostNeededKpa, 1),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Published requirement figures
// ---------------------------------------------------------------------------

/**
 * Printed wherever a requirement figure is offered, and worth reading in full.
 */
export const REQUIREMENT_DISCLAIMER =
  'These are published figures collected from regulators, each with its jurisdiction and scope. They are not a ' +
  'design table and they are not a substitute for the standard or for the building’s own approved documents. The ' +
  'flow and pressure a particular building must achieve depend on its classification, its water supply and its ' +
  'approval, and only the fire safety documents for that building settle it. This app checks the test against the ' +
  'duty it was told to check against — it does not certify a design.';

export interface RequirementRef {
  id: string;
  label: string;
  /** Required flow, L/s. Null where the source states a pressure only. */
  flowLps: number | null;
  /** Required pressure at the outlet, kPa. */
  pressureKpa: number;
  /** Where it applies. Requirements are jurisdictional and this is not decoration. */
  jurisdiction: string;
  /** What the figure covers — the scope limit that stops it being applied everywhere. */
  scope: string;
  source: string;
  url: string;
  confidence: Confidence;
  /** Marks a ceiling rather than a floor, e.g. a maximum permitted outlet pressure. */
  kind: 'minimum' | 'maximum';
  note?: string;
}

const QFD_E1D16_URL = 'https://www.fire.qld.gov.au/sites/default/files/2025-03/NCC-Clause-E1D16.pdf';
const QFD_E1D16_SOURCE = 'Queensland Fire Department, NCC Clause E1D16 Precautions During Building Construction Work, version 03/2025';
const DFES_ORG5_URL =
  'https://cdn.prod.website-files.com/61de5d84c5a92d75c52a9ca6/640a8a40c8563391ea160c75_Operational%20Requirement%20Guideline%20(ORG)%205%20HydrantV3.pdf';
const DFES_ORG5_SOURCE = 'DFES (Western Australia) FES Commissioner’s Operational Requirement Guideline ORG 5, March 2023';

/**
 * Requirement figures that could each be sourced to a named regulator document.
 *
 * Every one of these is scoped, and the scope is the point. The Queensland
 * figures come from the fire department's guidance for buildings *under
 * construction*; they are the clearest statement of those numbers published by
 * a Queensland regulator, but a completed building is governed by its own
 * approval and by the standard, not by this document. The Western Australian
 * entry is here precisely because it differs — it shows that "the required
 * pressure" is not one number nationally, which is the assumption that gets a
 * technician into trouble on an interstate job.
 *
 * Nothing here is selected automatically. The technician picks one, or types
 * the duty from the building's fire safety documents, and the choice is
 * recorded on the result.
 */
export const REQUIREMENT_REFS: RequirementRef[] = [
  {
    id: 'qld-construction-feed',
    label: 'Feed hydrant — 10 L/s at 200 kPa',
    flowLps: 10,
    pressureKpa: 200,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16. Not a figure for a completed building.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'minimum',
  },
  {
    id: 'qld-construction-attack',
    label: 'Attack hydrant, unassisted — 10 L/s at 350 kPa',
    flowLps: 10,
    pressureKpa: 350,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16, including at the most disadvantaged point.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'minimum',
    note: 'The same document treats 10 L/s at 700 kPa boosted, or 5 L/s at 700 kPa with an on-site pump set, as equivalent.',
  },
  {
    id: 'qld-construction-boosted',
    label: 'Attack hydrant, boosted — 10 L/s at 700 kPa',
    flowLps: 10,
    pressureKpa: 700,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16, boosted equivalent of the unassisted duty.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'minimum',
  },
  {
    id: 'qld-construction-pumpset',
    label: 'With on-site pump set — 5 L/s at 700 kPa',
    flowLps: 5,
    pressureKpa: 700,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16, where a pump set is incorporated in the hydrant system.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'minimum',
  },
  {
    id: 'qld-construction-max-static',
    label: 'Maximum static at any outlet, pump running — 1300 kPa',
    flowLps: null,
    pressureKpa: 1300,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16. No flow, pump running, unless the brigade agrees otherwise.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'maximum',
  },
  {
    id: 'qld-construction-max-discharge',
    label: 'Maximum discharge at any outlet at design flow — 1200 kPa',
    flowLps: null,
    pressureKpa: 1200,
    jurisdiction: 'Queensland',
    scope: 'Buildings under construction, NCC clause E1D16, unless the brigade agrees otherwise.',
    source: QFD_E1D16_SOURCE,
    url: QFD_E1D16_URL,
    confidence: 'high',
    kind: 'maximum',
    note: 'A ceiling on hose handling, not a target. A hydrant that over-pressurises is a defect in the other direction.',
  },
  {
    id: 'wa-dfes-attack-min',
    label: 'Attack hydrant — minimum 700 kPa at the required flow',
    flowLps: null,
    pressureKpa: 700,
    jurisdiction: 'Western Australia',
    scope: 'DFES operational requirement for attack hydrants. Included to show requirements differ between states.',
    source: DFES_ORG5_SOURCE,
    url: DFES_ORG5_URL,
    confidence: 'high',
    kind: 'minimum',
  },
  {
    id: 'wa-dfes-attack-max',
    label: 'Attack hydrant — maximum 1200 kPa',
    flowLps: null,
    pressureKpa: 1200,
    jurisdiction: 'Western Australia',
    scope: 'DFES operational requirement for attack hydrants.',
    source: DFES_ORG5_SOURCE,
    url: DFES_ORG5_URL,
    confidence: 'high',
    kind: 'maximum',
  },
];

export function requirementRef(id: string): RequirementRef | undefined {
  return REQUIREMENT_REFS.find((r) => r.id === id);
}

export function requirementsFor(jurisdiction: string): RequirementRef[] {
  return REQUIREMENT_REFS.filter((r) => r.jurisdiction.toLowerCase() === jurisdiction.toLowerCase());
}

/**
 * Turns a published reference into a duty the assessment can use.
 *
 * Returns null for a reference that states a pressure but no flow, because a
 * flow duty cannot be manufactured out of a pressure ceiling.
 */
export function refToDuty(ref: RequirementRef): { requiredFlowLpm: number; requiredResidualKpa: number; requirementSource: string } | null {
  if (ref.kind !== 'minimum' || ref.flowLps === null) return null;
  return {
    requiredFlowLpm: ref.flowLps * 60,
    requiredResidualKpa: ref.pressureKpa,
    requirementSource: `${ref.label} — ${ref.source} (${ref.jurisdiction}). ${ref.url}`,
  };
}

// ---------------------------------------------------------------------------
// The assessment
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'fail' | 'indeterminate';

export interface AssessmentInput {
  /** Flow the installation must make, L/min. Supplied by the technician. */
  requiredFlowLpm: number;
  /** Residual pressure that flow must be made at, kPa. Supplied by the technician. */
  requiredResidualKpa: number;
  /** Where the duty came from, recorded verbatim on the result. */
  requirementSource: string;
  /** Flow actually achieved on test, L/min. */
  measuredFlowLpm: number;
  /** Residual at the test hydrant while that flow ran, kPa. */
  measuredResidualKpa: number;
  /** Static at the test hydrant. Lets the result be projected to the required residual. */
  staticKpa?: number;
  /** Maximum permitted outlet pressure, kPa, where the installation has one. */
  maxOutletKpa?: number;
  /** Identifies the hydrant tested, for the record. */
  hydrantRef?: string;
}

export interface Assessment {
  ok: true;
  verdict: Verdict;
  /** Plain sentence for the report. */
  summary: string;
  /** What the assessment was measured against, restated. */
  requirementSource: string;
  /** True when the duty was demonstrated outright rather than projected to. */
  demonstrated: boolean;
  /** Available flow at the required residual, where it could be projected. */
  availableAtRequiredKpa: number | null;
  /** Flow margin at the required residual, L/min. Negative is a shortfall. */
  flowMarginLpm: number | null;
  pressureMarginKpa: number;
  issues: Issue[];
}

/**
 * Does the test meet the duty?
 *
 * Three outcomes, and the third one is not a failure of the code. A test that
 * neither demonstrates the duty nor supplies enough information to project to
 * it is INDETERMINATE, and says so. Reporting that honestly sends a technician
 * back to open another outlet; guessing sends a certificate to a building
 * owner.
 *
 * The over-pressure check runs in both directions. A hydrant that hands the
 * brigade more than the installation's ceiling is a defect too — nobody can
 * hold the hose.
 */
export function assessHydrant(input: AssessmentInput): Assessment | Refused {
  const { requiredFlowLpm, requiredResidualKpa, measuredFlowLpm, measuredResidualKpa } = input;
  if (![requiredFlowLpm, requiredResidualKpa, measuredFlowLpm, measuredResidualKpa].every(Number.isFinite)) {
    return refuse('Enter the required duty and the measured flow and residual.');
  }
  if (requiredFlowLpm <= 0) return refuse('The required flow must be greater than zero.');
  if (requiredResidualKpa < 0) return refuse('The required residual pressure cannot be negative.');
  if (measuredFlowLpm < 0 || measuredResidualKpa < 0) return refuse('Measured flow and residual cannot be negative.');
  if (!input.requirementSource || !input.requirementSource.trim()) {
    return refuse(
      'No source recorded for the required duty. The assessment is only meaningful against a stated requirement, ' +
        'so the figure has to say where it came from.',
    );
  }

  const issues: Issue[] = [];
  const pressureMarginKpa = measuredResidualKpa - requiredResidualKpa;

  // Over-pressure is checked first: it fails regardless of how well the flow went.
  let overPressure = false;
  if (input.maxOutletKpa !== undefined && Number.isFinite(input.maxOutletKpa)) {
    const worst = Math.max(measuredResidualKpa, input.staticKpa ?? 0);
    if (worst > input.maxOutletKpa) {
      overPressure = true;
      issues.push({
        level: 'error',
        title: 'Outlet pressure above the permitted maximum',
        detail:
          `${round(worst, 0)} kPa against a stated maximum of ${round(input.maxOutletKpa, 0)} kPa. An over-pressurised ` +
          'outlet is a hose-handling hazard and a defect in its own right, whatever the flow did.',
      });
    }
  }

  const demonstrated = measuredFlowLpm >= requiredFlowLpm && measuredResidualKpa >= requiredResidualKpa;

  let availableAtRequiredKpa: number | null = null;
  let flowMarginLpm: number | null = null;
  let verdict: Verdict;
  let summary: string;

  if (demonstrated) {
    verdict = overPressure ? 'fail' : 'pass';
    flowMarginLpm = round(measuredFlowLpm - requiredFlowLpm, 1);
    availableAtRequiredKpa = round(measuredFlowLpm, 1);
    summary =
      `${round(measuredFlowLpm / 60, 2)} L/s flowed at ${round(measuredResidualKpa, 0)} kPa residual, against a duty of ` +
      `${round(requiredFlowLpm / 60, 2)} L/s at ${round(requiredResidualKpa, 0)} kPa. The duty was demonstrated directly.`;
    if (overPressure) summary += ' The installation nonetheless fails on maximum outlet pressure.';
  } else if (input.staticKpa !== undefined && Number.isFinite(input.staticKpa)) {
    const projection = projectAvailableFlow({
      staticKpa: input.staticKpa,
      residualKpa: measuredResidualKpa,
      measuredFlowLpm,
      targetResidualKpa: requiredResidualKpa,
    });
    if (isRefused(projection)) {
      verdict = 'indeterminate';
      summary =
        `The duty was not demonstrated and could not be projected to: ${projection.reason} ` +
        'Retest with a larger flow, or record the result as inconclusive.';
      issues.push({
        level: 'warning',
        title: 'Could not project to the required residual',
        detail: projection.reason,
      });
    } else {
      issues.push(...projection.issues);
      availableAtRequiredKpa = projection.projectedFlowLpm;
      flowMarginLpm = round(projection.projectedFlowLpm - requiredFlowLpm, 1);
      const meets = projection.projectedFlowLpm >= requiredFlowLpm;
      verdict = overPressure ? 'fail' : meets ? 'pass' : 'fail';
      summary =
        `Projected ${round(projection.projectedFlowLpm / 60, 2)} L/s available at ${round(requiredResidualKpa, 0)} kPa, ` +
        `against a duty of ${round(requiredFlowLpm / 60, 2)} L/s. ` +
        (meets ? 'The duty is met on projection.' : 'The duty is not met.');
      issues.push({
        level: 'info',
        title: 'Result is projected, not demonstrated',
        detail:
          `The test flowed ${round(measuredFlowLpm / 60, 2)} L/s at ${round(measuredResidualKpa, 0)} kPa; the figure at ` +
          'the required residual is derived from the supply curve. Flowing the duty outright is the stronger record.',
      });
      if (overPressure) summary += ' It fails on maximum outlet pressure regardless.';
    }
  } else {
    verdict = 'indeterminate';
    summary =
      `${round(measuredFlowLpm / 60, 2)} L/s at ${round(measuredResidualKpa, 0)} kPa does not meet the duty of ` +
      `${round(requiredFlowLpm / 60, 2)} L/s at ${round(requiredResidualKpa, 0)} kPa, and without a static reading ` +
      'there is no supply curve to project along. Record the static and retest.';
    issues.push({
      level: 'warning',
      title: 'No static pressure recorded',
      detail:
        'Static is the second point the supply curve needs. Without it the only question that can be answered is ' +
        'whether the duty was flowed outright, and it was not.',
    });
  }

  issues.push({
    level: 'info',
    title: 'Checked against a supplied requirement',
    detail: `${input.requirementSource} — ${REQUIREMENT_DISCLAIMER}`,
  });

  return {
    ok: true,
    verdict,
    summary: input.hydrantRef ? `${input.hydrantRef}: ${summary}` : summary,
    requirementSource: input.requirementSource,
    demonstrated,
    availableAtRequiredKpa,
    flowMarginLpm,
    pressureMarginKpa: round(pressureMarginKpa, 1),
    issues,
  };
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
