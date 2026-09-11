import {
  CONDUITS,
  DRAWDOWN_EXPONENT,
  KPA_PER_METRE_OF_HEAD,
  MINIMUM_USABLE_DRAWDOWN_FRACTION,
  OUTLETS,
  PITOT_CONSTANT_METRIC,
  REQUIREMENT_REFS,
  assessHydrant,
  barToKpa,
  conduitSpec,
  flowMeterToLpm,
  frictionLoss,
  headToKpa,
  isRefused,
  kFactorFlow,
  kpaToHead,
  outletSpec,
  pitotFlow,
  pressureAtHydrant,
  projectAvailableFlow,
  projectResidualAtFlow,
  psiToKpa,
  refToDuty,
  requiredBoostPressure,
  requirementRef,
  requirementsFor,
  totalPitotFlow,
  type FlowUnit,
  type KFactorUnit,
  RECOMMENDED_DRAWDOWN_FRACTION,
  PITOT_MIN_RELIABLE_KPA, PITOT_MAX_RELIABLE_KPA,
} from '@/calc/hydrant';

/**
 * Hydrant flow testing.
 *
 * Every formula here is pinned to a worked example somebody else published, in
 * their units, so that a change to this module which quietly breaks the physics
 * fails the suite rather than shipping. The sources are named at each block.
 *
 * The other half of the suite is about refusing. A hydrant test that reports a
 * confident wrong pass is worse than one that reports nothing, because the
 * nothing sends a technician back to open another outlet and the wrong pass
 * sends a certificate to a building owner. Most of what follows asserts that
 * the module declines to answer.
 */

/** US gallon, for converting published imperial examples. */
const L_PER_US_GAL = 3.785411784;
const gpmToLpm = (gpm: number): number => gpm * L_PER_US_GAL;
const lpmToGpm = (lpm: number): number => lpm / L_PER_US_GAL;
const inchesToMm = (inches: number): number => inches * 25.4;

// ---------------------------------------------------------------------------

describe('the pitot constant', () => {
  it('reproduces the published imperial constant of 29.83 when converted', () => {
    // NFPA 291's Q = 29.83 c d² √p is in gpm, inches and psi. This module derives
    // its own constant from Q = Cd·A·√(2P/ρ) in L/min, mm and kPa and never
    // consults that number — so converting one into the other is an independent
    // check that the derivation is right, against a figure settled decades ago.
    // https://www1.wsrb.com/resources/hydrant-flow-testing
    const imperialEquivalent = (PITOT_CONSTANT_METRIC * 25.4 * 25.4 * Math.sqrt(6.894757293168)) / L_PER_US_GAL;
    expect(imperialEquivalent).toBeCloseTo(29.83, 1);
  });

  it('is the value the on-screen working prints', () => {
    // If this drifts the formula shown to the technician stops matching the answer.
    expect(PITOT_CONSTANT_METRIC).toBeCloseTo(0.0666432, 7);
  });
});

describe('pitotFlow — the published worked example', () => {
  /**
   * Fire Engineering's flow test example: a 2½ inch hydrant butt, coefficient
   * 0.80, pitot reading 45 psi, stated answer 1,000 gpm.
   * https://www.fireengineering.com/firefighting-equipment/fire-flow-testing/
   */
  const r = pitotFlow({
    pitotKpa: psiToKpa(45),
    outletDiameterMm: inchesToMm(2.5),
    outlet: 'square-edged',
  });

  it('gives 1,000 gpm for a 2½ inch square-edged butt at 45 psi', () => {
    if (isRefused(r)) throw new Error(r.reason);
    expect(lpmToGpm(r.flowLpm)).toBeCloseTo(1000, 0);
  });

  it('gives the same answer in the units the technician actually reads', () => {
    // 1,000 gpm is 63.1 L/s, which is what the gauge-and-clipboard end of the
    // job needs — the imperial figure only exists to check the arithmetic.
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.flowLps).toBeCloseTo(63.1, 1);
    expect(Math.abs(r.flowLpm - gpmToLpm(1000)) / gpmToLpm(1000)).toBeLessThan(0.001);
  });

  it('reports the stream velocity, which is the sanity check on a silly reading', () => {
    // v = √(2P) with P in kPa: 45 psi is 310.3 kPa, so 24.9 m/s.
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.velocityMs).toBeCloseTo(24.9, 1);
  });

  it('names where the coefficient came from, in the result and not in a comment', () => {
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.coefficient).toBe(0.8);
    expect(r.coefficientSource).toMatch(/WSRB/);
    expect(r.coefficientConfidence).toBe('medium');
  });
});

describe('pitotFlow — the coefficient is the whole ball game', () => {
  const at = (outlet: 'rounded' | 'square-edged' | 'smooth-bore-nozzle') =>
    pitotFlow({ pitotKpa: 200, outletDiameterMm: 65, outlet });

  it('separates a rounded outlet from a square-edged one by exactly the coefficient ratio', () => {
    // 0.90 against 0.80 is 12.5%. On a 10 L/s duty that is the difference
    // between 9 L/s and 10.1 L/s — a fail written up as a pass.
    const rounded = at('rounded');
    const square = at('square-edged');
    if (isRefused(rounded) || isRefused(square)) throw new Error('both should calculate');
    expect(rounded.flowLpm / square.flowLpm).toBeCloseTo(0.9 / 0.8, 6);
  });

  it('is 21 per cent adrift if a bare outlet is flowed as though it were a nozzle', () => {
    // This is the specific mistake the refusal below exists to prevent.
    const nozzle = at('smooth-bore-nozzle');
    const square = at('square-edged');
    if (isRefused(nozzle) || isRefused(square)) throw new Error('both should calculate');
    expect((nozzle.flowLpm / square.flowLpm - 1) * 100).toBeCloseTo(21.25, 2);
  });

  it("refuses an outlet whose geometry has not been established, rather than assuming one", () => {
    const r = pitotFlow({ pitotKpa: 200, outletDiameterMm: 65, outlet: 'unknown' });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/coefficient/i);
    // The refusal has to tell the technician what to do instead, or it is just a blank screen.
    expect(r.reason).toMatch(/meter|documentation|geometry/i);
  });

  it('trusts a pitot reading at either end of its own window', () => {
    /*
     * Below about 10 psi the stream does not fill the outlet and the reading
     * understates the flow; above about 30 psi a pitot tube is hard to hold
     * centred and an off-centre one reads low. Those two pressures are the ends
     * of the usable window, not outside it.
     *
     * Warning at them puts a caution on a reading taken exactly as the source
     * describes — and a caution that fires on good readings is one nobody
     * reads by the third hydrant.
     */
    for (const kpa of [PITOT_MIN_RELIABLE_KPA, PITOT_MAX_RELIABLE_KPA]) {
      const r = pitotFlow({ pitotKpa: kpa, outletDiameterMm: 65, outlet: 'rounded' });
      if (isRefused(r)) throw new Error(r.reason);
      expect({ kpa, warned: r.issues.some((i2) => i2.title.includes('Pitot reading')) })
        .toEqual({ kpa, warned: false });
    }

    // Outside it, both ends warn.
    for (const kpa of [PITOT_MIN_RELIABLE_KPA - 1, PITOT_MAX_RELIABLE_KPA + 1]) {
      const r = pitotFlow({ pitotKpa: kpa, outletDiameterMm: 65, outlet: 'rounded' });
      if (isRefused(r)) throw new Error(r.reason);
      expect({ kpa, warned: r.issues.some((i2) => i2.title.includes('Pitot reading')) })
        .toEqual({ kpa, warned: true });
    }
  });

  it('accepts a coefficient from the equipment documentation and records that it was entered', () => {
    const r = pitotFlow({ pitotKpa: 200, outletDiameterMm: 65, outlet: 'unknown', coefficientOverride: 0.92 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.coefficient).toBe(0.92);
    expect(r.coefficientSource).toMatch(/technician/i);
  });

  it('refuses a coefficient outside 0 to 1, which is a typo and not a device', () => {
    // A coefficient above 1 says the outlet discharges more than the theoretical
    // maximum. It is always a decimal point in the wrong place.
    for (const bad of [0, -0.8, 1.4, Number.NaN]) {
      const r = pitotFlow({ pitotKpa: 200, outletDiameterMm: 65, outlet: 'rounded', coefficientOverride: bad });
      expect(isRefused(r)).toBe(true);
    }
  });
});

describe('pitotFlow — refusals and warnings on the reading itself', () => {
  it('refuses a negative pitot pressure', () => {
    const r = pitotFlow({ pitotKpa: -10, outletDiameterMm: 65, outlet: 'rounded' });
    expect(isRefused(r)).toBe(true);
  });

  it('refuses a zero or negative outlet diameter instead of returning zero flow', () => {
    // Zero flow is an answer a report would print. "No diameter entered" is not.
    expect(isRefused(pitotFlow({ pitotKpa: 200, outletDiameterMm: 0, outlet: 'rounded' }))).toBe(true);
    expect(isRefused(pitotFlow({ pitotKpa: 200, outletDiameterMm: -65, outlet: 'rounded' }))).toBe(true);
  });

  it('refuses a missing reading rather than treating it as zero', () => {
    expect(isRefused(pitotFlow({ pitotKpa: Number.NaN, outletDiameterMm: 65, outlet: 'rounded' }))).toBe(true);
  });

  it('warns below 10 psi, where the stream no longer fills the outlet', () => {
    // The reading understates the flow by an amount nobody can quantify later,
    // so the warning has to survive into the report.
    const r = pitotFlow({ pitotKpa: 40, outletDiameterMm: 65, outlet: 'rounded' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.title.includes('below'))).toBe(true);
  });

  it('warns on a dead-zero pitot rather than reporting no flow without comment', () => {
    // Zero on the pitot is far more often a tube out of the stream or a gauge
    // left shut than a hydrant that genuinely delivers nothing, and "0.00 L/s"
    // on its own is a number a report would print.
    const r = pitotFlow({ pitotKpa: 0, outletDiameterMm: 65, outlet: 'rounded' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.flowLpm).toBe(0);
    expect(r.issues.some((i) => i.level === 'warning' && i.title.includes('below'))).toBe(true);
  });

  it('warns above 30 psi, where the tube cannot be held steady in the jet', () => {
    const r = pitotFlow({ pitotKpa: 300, outletDiameterMm: 65, outlet: 'rounded' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.title.includes('above'))).toBe(true);
  });

  it('stays quiet inside the usable window', () => {
    const r = pitotFlow({ pitotKpa: 150, outletDiameterMm: 65, outlet: 'rounded' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.filter((i) => i.level === 'warning')).toHaveLength(0);
  });

  it('flags a second-hand coefficient so it is never quoted as though it were measured', () => {
    const r = pitotFlow({ pitotKpa: 150, outletDiameterMm: 25, outlet: 'smooth-bore-nozzle' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.title.includes('second-hand'))).toBe(true);
  });
});

describe('totalPitotFlow', () => {
  it('adds the outlets flowed together', () => {
    const one = { pitotKpa: 150, outletDiameterMm: 65, outlet: 'square-edged' as const };
    const r = totalPitotFlow([one, one]);
    const single = pitotFlow(one);
    if (isRefused(r) || isRefused(single)) throw new Error('both should calculate');
    expect(r.flowLpm).toBeCloseTo(single.flowLpm * 2, 1);
  });

  it('refuses the whole set when one outlet cannot be calculated, naming which', () => {
    // Silently dropping the outlet that could not be worked out would understate
    // the total, which on a flow test reads as a system that is worse than it is.
    const r = totalPitotFlow([
      { pitotKpa: 150, outletDiameterMm: 65, outlet: 'square-edged' },
      { pitotKpa: 150, outletDiameterMm: 65, outlet: 'unknown' },
    ]);
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/Outlet 2/);
  });

  it('refuses an empty set rather than reporting zero flow', () => {
    expect(isRefused(totalPitotFlow([]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('kFactorFlow', () => {
  it('applies Q = K√P for a K stated in L/min per √kPa', () => {
    const r = kFactorFlow({ k: 8, kUnit: 'lpm-per-sqrt-kpa', pressureKpa: 400 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.flowLpm).toBeCloseTo(160, 4);
  });

  it('treats a K in L/min per √bar as ten times smaller, because that is what it is', () => {
    // The same nozzle is printed as K = 80 in one catalogue and K = 8 in another.
    // Getting this backwards is a factor of ten on the flow, which no other
    // error in a hydrant test can match for size.
    const perBar = kFactorFlow({ k: 80, kUnit: 'lpm-per-sqrt-bar', pressureKpa: barToKpa(1) });
    const perKpa = kFactorFlow({ k: 80, kUnit: 'lpm-per-sqrt-kpa', pressureKpa: barToKpa(1) });
    if (isRefused(perBar) || isRefused(perKpa)) throw new Error('both should calculate');
    expect(perBar.flowLpm).toBeCloseTo(80, 4);
    expect(perKpa.flowLpm).toBeCloseTo(800, 4);
    expect(perBar.kInLpmPerSqrtKpa).toBeCloseTo(8, 4);
  });

  it("refuses a K-factor whose units were not stated", () => {
    // A K with no units on the data sheet is not a usable number, and guessing
    // which convention the manufacturer meant is a coin toss on a factor of ten.
    const r = kFactorFlow({ k: 80, kUnit: 'lpm-per-sqrt-atmosphere' as KFactorUnit, pressureKpa: 100 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/units/i);
  });

  it('refuses a non-positive K and a negative pressure', () => {
    expect(isRefused(kFactorFlow({ k: 0, kUnit: 'lpm-per-sqrt-kpa', pressureKpa: 100 }))).toBe(true);
    expect(isRefused(kFactorFlow({ k: 8, kUnit: 'lpm-per-sqrt-kpa', pressureKpa: -1 }))).toBe(true);
  });
});

describe('flowMeterToLpm', () => {
  it('converts the units a hydrant test rig actually reads', () => {
    expect(flowMeterToLpm(10, 'lps')).toBeCloseTo(600, 6);
    expect(flowMeterToLpm(36, 'm3h')).toBeCloseTo(600, 6);
    expect(flowMeterToLpm(100, 'usgpm')).toBeCloseTo(378.54, 2);
  });

  it("returns nothing for a unit it does not hold, rather than assuming L/min", () => {
    // A rig bought from a US supplier reads gpm. Treating 250 gpm as 250 L/min
    // turns a comfortable pass into a fail nobody on site can explain.
    expect(flowMeterToLpm(250, 'gpm' as FlowUnit)).toBeNull();
  });

  it('returns nothing for a negative or non-numeric reading', () => {
    expect(flowMeterToLpm(-5, 'lps')).toBeNull();
    expect(flowMeterToLpm(Number.NaN, 'lps')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('frictionLoss — pinned to a manufacturer’s published loss figures', () => {
  /**
   * Australian Fire Hose publishes measured friction loss for SBR800 layflat:
   * 65 mm at 7.5 L/s loses 0.7 kPa/m, and 25 mm at 1.5 L/s loses 3.5 kPa/m.
   * http://afh.com.au/products/sbr800/
   *
   * These are the only primary metric loss figures found for fire hose, and
   * they are what the module's C range was back-solved from — so they are also
   * the check that the Hazen-Williams implementation itself is right.
   */
  it('matches the published 0.7 kPa/m for 65 mm hose at 7.5 L/s', () => {
    const r = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.lossKpaPerM).toBeCloseTo(0.7, 1);
  });

  it('is within 10 per cent of the published 3.5 kPa/m for 25 mm hose at 1.5 L/s', () => {
    // A single C cannot fit four hose sizes exactly. Being close on the small
    // sizes as well as the large ones is what says the exponent is right rather
    // than the constant having been tuned to one point.
    const r = frictionLoss({ flowLpm: 90, internalDiameterMm: 25, lengthM: 1, conduit: 'layflat-hose' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(Math.abs(r.lossKpaPerM - 3.5) / 3.5).toBeLessThan(0.1);
  });

  it('agrees with the fire-industry metric form of Hazen-Williams to better than one per cent', () => {
    // The sprinkler and hydrant trade writes it as p = 6.05e5 · Q^1.85 / (C^1.85 · d^4.87)
    // in bar per metre, L/min and mm; this module uses the SI form in m, m³/s and m.
    // They are the same equation and must agree, which catches a slipped exponent
    // or a botched unit conversion that a single pinned example might not.
    // https://canutesoft.com/hydraulic-calculation-for-fire-protection-engineers/the-hazen-williams-formula-for-use-in-fire-sprinkler-systems
    const q = 450;
    const d = 65;
    const c = conduitSpec('layflat-hose')!.cLow;
    const tradeFormKpaPerM = ((6.05e5 * Math.pow(q, 1.85)) / (Math.pow(c, 1.85) * Math.pow(d, 4.87))) * 100;

    const r = frictionLoss({ flowLpm: q, internalDiameterMm: d, lengthM: 1, conduit: 'layflat-hose' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(Math.abs(r.lossKpaPerM - tradeFormKpaPerM) / tradeFormKpaPerM).toBeLessThan(0.01);
  });

  it('scales linearly with length, so a 60 m lay loses twice what a 30 m lay does', () => {
    const short = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    const long = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 60, conduit: 'layflat-hose' });
    if (isRefused(short) || isRefused(long)) throw new Error('both should calculate');
    expect(long.lossKpaPerM).toBe(short.lossKpaPerM);
    expect(long.pressureLossKpa).toBeCloseTo(short.pressureLossKpa * 2, 1);
  });

  it('uses the low end of the published C range, because the low end loses more', () => {
    // A friction estimate that flatters the system is the one that gets a
    // technician to a pass they cannot defend in front of a brigade.
    const spec = conduitSpec('layflat-hose')!;
    const auto = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    const atHigh = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, cOverride: spec.cHigh });
    if (isRefused(auto) || isRefused(atHigh)) throw new Error('both should calculate');
    expect(auto.c).toBe(spec.cLow);
    expect(auto.pressureLossKpa).toBeGreaterThan(atHigh.pressureLossKpa);
  });

  it('reports the velocity and warns when it leaves the band Hazen-Williams was fitted over', () => {
    // 20 L/s down 65 mm is 6 m/s. The equation understates loss up there, so the
    // number has to be labelled a floor rather than an estimate.
    const r = frictionLoss({ flowLpm: 1200, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.velocityMs).toBeCloseTo(6.03, 1);
    expect(r.issues.some((i) => i.level === 'warning' && i.title.includes('above'))).toBe(true);
  });

  it("refuses when no material was chosen, rather than picking a middling C", () => {
    // Every C in the table is defensible and none of them is a default. Choosing
    // one on the technician's behalf is choosing the answer.
    const r = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/coefficient|material/i);
  });

  it('refuses a C value no material has, because a slipped decimal flatters the system', () => {
    // C = 1400 for C = 140 cuts the estimated loss by about 99%. Every other
    // guard in this module is about not flattering a marginal supply, and an
    // unbounded C override is the one hole straight through all of them.
    const r = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, cOverride: 1400 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/decimal/i);
    // 150 is a real design value and has to keep working.
    expect(isRefused(frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, cOverride: 150 }))).toBe(false);
  });

  it('still reports a loss rate for a run whose length has not been entered yet', () => {
    // Dividing the total by the length gives 0 kPa/m at zero length, and a hose
    // does not stop having a loss rate because nobody has said how much of it is
    // laid out. The total is zero; the rate is not.
    const none = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 0, conduit: 'layflat-hose' });
    const thirty = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    if (isRefused(none) || isRefused(thirty)) throw new Error('both should calculate');
    expect(none.pressureLossKpa).toBe(0);
    expect(none.lossKpaPerM).toBeCloseTo(thirty.lossKpaPerM, 6);
    expect(none.lossKpaPerM).toBeGreaterThan(0);
  });

  it('refuses a zero diameter, a negative flow and a negative length', () => {
    expect(isRefused(frictionLoss({ flowLpm: 450, internalDiameterMm: 0, lengthM: 30, conduit: 'layflat-hose' }))).toBe(true);
    expect(isRefused(frictionLoss({ flowLpm: -1, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' }))).toBe(true);
    expect(isRefused(frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: -1, conduit: 'layflat-hose' }))).toBe(true);
  });

  it('says plainly that the hose C value was derived rather than published', () => {
    const r = frictionLoss({ flowLpm: 450, internalDiameterMm: 65, lengthM: 30, conduit: 'layflat-hose' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.title.includes('derived'))).toBe(true);
    expect(r.cSource).toMatch(/Australian Fire Hose/);
  });
});

// ---------------------------------------------------------------------------

describe('elevation head', () => {
  it('uses 9.80665 kPa per metre, not the tailboard ten', () => {
    // Over a 30 m riser the difference between 9.81 and 10 is 6 kPa, which is a
    // floor and a half of head on a system that is already marginal.
    expect(KPA_PER_METRE_OF_HEAD).toBeCloseTo(9.80665, 5);
    expect(headToKpa(30)).toBeCloseTo(294.2, 1);
  });

  it('round-trips metres to kPa and back', () => {
    const kpa = headToKpa(10.5)!;
    expect(kpaToHead(kpa)).toBeCloseTo(10.5, 6);
  });

  it('treats a hydrant below the source as a gain, not a loss', () => {
    // Basement hydrants are the one case where the lift is on your side.
    expect(headToKpa(-4)).toBeCloseTo(-39.23, 2);
  });

  it('returns nothing for a non-numeric height', () => {
    expect(headToKpa(Number.NaN)).toBeNull();
    expect(kpaToHead(Number.NaN)).toBeNull();
  });
});

describe('pressureAtHydrant', () => {
  it('takes the lift and the friction off the source pressure', () => {
    // 500 kPa in the street, hydrant 12 m up, 40 kPa lost along the riser.
    const r = pressureAtHydrant({ sourceKpa: 500, elevationRiseM: 12, frictionLossKpa: 40 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.elevationLossKpa).toBeCloseTo(117.7, 1);
    expect(r.arrivingKpa).toBeCloseTo(342.3, 1);
  });

  it('carries an error saying the outlet is dry, because a negative kPa on its own reads as a small number', () => {
    // The shortfall is worth keeping — "you are 194 kPa short" is more use than
    // "no" — but it cannot be the only thing on the screen, so the error issue
    // is what the caller has to show.
    const r = pressureAtHydrant({ sourceKpa: 100, elevationRiseM: 30, frictionLossKpa: 0 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.arrivingKpa).toBeLessThan(0);
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('Nothing arrives'))).toBe(true);
  });

  it('flags that friction was left out when no friction figure was supplied', () => {
    const r = pressureAtHydrant({ sourceKpa: 500, elevationRiseM: 12 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.title.includes('Friction not included'))).toBe(true);
  });
});

describe('requiredBoostPressure', () => {
  it('adds the residual, the lift and the friction to get the figure for the boost sign', () => {
    // 700 kPa wanted at a hydrant 30 m up, 150 kPa of friction in the riser.
    const r = requiredBoostPressure({ requiredResidualKpa: 700, elevationRiseM: 30, frictionLossKpa: 150 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.elevationLossKpa).toBeCloseTo(294.2, 1);
    expect(r.requiredAtBoosterKpa).toBeCloseTo(1144.2, 1);
  });

  it('reports how much the appliance has to add over what the inlet already gives', () => {
    const r = requiredBoostPressure({
      requiredResidualKpa: 700,
      elevationRiseM: 30,
      frictionLossKpa: 150,
      inletKpa: 400,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.boostNeededKpa).toBeCloseTo(744.2, 1);
  });

  it('never asks for a negative boost when the inlet already covers it', () => {
    const r = requiredBoostPressure({ requiredResidualKpa: 200, elevationRiseM: 0, frictionLossKpa: 10, inletKpa: 600 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.boostNeededKpa).toBe(0);
  });

  it('leaves the boost figure unknown when no inlet pressure was measured', () => {
    const r = requiredBoostPressure({ requiredResidualKpa: 700, elevationRiseM: 30, frictionLossKpa: 150 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.boostNeededKpa).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('projectAvailableFlow — the published worked example', () => {
  /**
   * LMNO Engineering's fire hydrant calculator example: static 68 psi, residual
   * 43 psi at a measured 1,710 gpm, stated answer 2,432 gpm at 20 psi.
   * https://www.lmnoeng.com/Hydrant/hydrant.php
   *
   * The relationship is a ratio of pressure drops, so it is unit-free — running
   * the example in kPa and L/min and converting back is a check on both the
   * exponent and the conversions at the edges.
   */
  const r = projectAvailableFlow({
    staticKpa: psiToKpa(68),
    residualKpa: psiToKpa(43),
    measuredFlowLpm: gpmToLpm(1710),
    targetResidualKpa: psiToKpa(20),
  });

  it('gives the published 2,432 gpm at 20 psi', () => {
    if (isRefused(r)) throw new Error(r.reason);
    expect(lpmToGpm(r.projectedFlowLpm)).toBeCloseTo(2432, 0);
  });

  it('reports the drawdown the projection rests on', () => {
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.measuredDrawdownKpa).toBeCloseTo(psiToKpa(25), 1);
    expect(r.drawdownFraction).toBeCloseTo(25 / 68, 3);
  });

  it('uses the 0.54 exponent that falls out of Hazen-Williams', () => {
    // Loss goes as Q^1.852, so flow goes as loss^(1/1.852) = loss^0.54.
    expect(DRAWDOWN_EXPONENT).toBeCloseTo(0.54, 6);
    expect(1 / 1.852).toBeCloseTo(DRAWDOWN_EXPONENT, 2);
  });

  it('says that projecting below the measured residual is an extrapolation', () => {
    // 20 psi is below the 43 psi actually seen, so the curve is being extended
    // past the data — true of nearly every real hydrant test, and worth saying.
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.extrapolating).toBe(true);
  });
});

describe('projectAvailableFlow — refusals', () => {
  it('refuses when the residual did not move off the static', () => {
    // The denominator is zero and the projected flow is arithmetically infinite.
    // Returning a very large number here is how a dead main gets written up as
    // an unlimited supply.
    const r = projectAvailableFlow({ staticKpa: 600, residualKpa: 600, measuredFlowLpm: 500, targetResidualKpa: 350 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/did not move/i);
  });

  it('treats both thresholds as the numbers they are named for', () => {
    /*
     * Five per cent is usable and twenty-five is recommended, and each is the
     * value the rule is about rather than the first value past it.
     *
     * Getting the lower one wrong withholds an answer a technician can act on,
     * from a test they may not be able to repeat — there may be no more outlets
     * on that main. Getting the upper one wrong attaches a caveat to a test
     * that met NFPA 291's own figure, which is how a caveat stops meaning
     * anything.
     */
    const at = (fraction: number) => projectAvailableFlow({
      staticKpa: 600,
      residualKpa: 600 * (1 - fraction),
      measuredFlowLpm: 500,
      targetResidualKpa: 350,
    });

    const usable = at(MINIMUM_USABLE_DRAWDOWN_FRACTION);
    expect(isRefused(usable)).toBe(false);

    const recommended = at(RECOMMENDED_DRAWDOWN_FRACTION);
    if (isRefused(recommended)) throw new Error(recommended.reason);
    expect(recommended.issues.some((i) => i.title.includes('25%'))).toBe(false);
  });

  it('refuses a drawdown too small to project from', () => {
    // 3% below static. The fitted curve swings on a gauge needle's width.
    const r = projectAvailableFlow({ staticKpa: 500, residualKpa: 485, measuredFlowLpm: 500, targetResidualKpa: 350 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/3(\.0)?%/);
  });

  it('accepts a drawdown just over the usable threshold but warns below the recommended 25%', () => {
    // NFPA 291 asks for a quarter. Between 5% and 25% the answer is offered with
    // its caveat attached rather than withheld — the tech may have no more outlets.
    const fraction = MINIMUM_USABLE_DRAWDOWN_FRACTION + 0.05;
    const r = projectAvailableFlow({
      staticKpa: 600,
      residualKpa: 600 * (1 - fraction),
      measuredFlowLpm: 500,
      targetResidualKpa: 350,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.issues.some((i) => i.level === 'warning' && i.title.includes('25%'))).toBe(true);
  });

  it('refuses a residual below zero, which is a typed minus sign and not a reading', () => {
    // Left alone it makes the drawdown larger than the static itself, and every
    // flow projected off it reads low — a fail on a system that was fine.
    const r = projectAvailableFlow({ staticKpa: 600, residualKpa: -300, measuredFlowLpm: 500, targetResidualKpa: 350 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/sign/i);
  });

  it("refuses a residual that read higher than the static, which is a procedure fault", () => {
    // Almost always the residual was taken before the hydrant was opened, or off
    // a different gauge. It is never a real supply.
    const r = projectAvailableFlow({ staticKpa: 400, residualKpa: 450, measuredFlowLpm: 500, targetResidualKpa: 350 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/higher than the static/i);
  });

  it('refuses a target residual above the static, because no flow ever reaches it', () => {
    const r = projectAvailableFlow({ staticKpa: 400, residualKpa: 300, measuredFlowLpm: 500, targetResidualKpa: 700 });
    expect(isRefused(r)).toBe(true);
  });

  it('refuses a measured flow of zero', () => {
    const r = projectAvailableFlow({ staticKpa: 600, residualKpa: 400, measuredFlowLpm: 0, targetResidualKpa: 350 });
    expect(isRefused(r)).toBe(true);
  });

  it('refuses a static of zero rather than dividing by it', () => {
    const r = projectAvailableFlow({ staticKpa: 0, residualKpa: 0, measuredFlowLpm: 500, targetResidualKpa: 0 });
    expect(isRefused(r)).toBe(true);
  });
});

describe('projectResidualAtFlow', () => {
  it('inverts the projection, so the two agree at the same point', () => {
    // "What will the top hydrant read when the brigade flows 10 L/s downstairs"
    // is the same curve read the other way, and a mismatch here would mean one
    // of the two is wrong.
    const base = { staticKpa: 700, residualKpa: 480, measuredFlowLpm: 500 };
    const back = projectResidualAtFlow({ ...base, targetFlowLpm: 600 });
    if (isRefused(back)) throw new Error(back.reason);
    const forward = projectAvailableFlow({ ...base, targetResidualKpa: back.residualKpa });
    if (isRefused(forward)) throw new Error(forward.reason);
    expect(forward.projectedFlowLpm).toBeCloseTo(600, 0);
  });

  it('says the supply runs out when the demanded flow takes the residual below zero', () => {
    const r = projectResidualAtFlow({ staticKpa: 400, residualKpa: 300, measuredFlowLpm: 200, targetFlowLpm: 2000 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.residualKpa).toBeLessThan(0);
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('inherits the refusals of the forward projection', () => {
    const r = projectResidualAtFlow({ staticKpa: 600, residualKpa: 600, measuredFlowLpm: 500, targetFlowLpm: 600 });
    expect(isRefused(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('assessHydrant', () => {
  const duty = {
    requiredFlowLpm: 600,
    requiredResidualKpa: 350,
    requirementSource: 'Entered from the building’s fire safety documents',
  };

  it('passes a duty that was flowed outright and says it was demonstrated', () => {
    // The strongest record there is: the system did the thing, at the pressure,
    // with a gauge on it. No curve, no projection, no argument.
    const r = assessHydrant({ ...duty, measuredFlowLpm: 620, measuredResidualKpa: 360 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('pass');
    expect(r.demonstrated).toBe(true);
    expect(r.flowMarginLpm).toBeCloseTo(20, 1);
    expect(r.summary).toMatch(/demonstrated directly/);
  });

  it('passes on projection when the test flowed less but the curve reaches the duty', () => {
    // 500 L/min at 480 kPa off a 700 kPa static projects to 642 L/min at 350 kPa.
    const r = assessHydrant({ ...duty, measuredFlowLpm: 500, measuredResidualKpa: 480, staticKpa: 700 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('pass');
    expect(r.demonstrated).toBe(false);
    expect(r.availableAtRequiredKpa).toBeCloseTo(642.5, 0);
    expect(r.issues.some((i) => i.title.includes('projected, not demonstrated'))).toBe(true);
  });

  it('fails when the projected flow falls short of the duty', () => {
    const r = assessHydrant({ ...duty, measuredFlowLpm: 300, measuredResidualKpa: 480, staticKpa: 700 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.flowMarginLpm!).toBeLessThan(0);
  });

  it("returns indeterminate, not a fail, when there is no static to project along", () => {
    // A technician who did not record the static has an incomplete test, not a
    // failed system, and writing it up as a defect is a false statement.
    const r = assessHydrant({ ...duty, measuredFlowLpm: 400, measuredResidualKpa: 500 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('indeterminate');
    expect(r.summary).toMatch(/Record the static and retest/);
  });

  it('returns indeterminate when the drawdown was too small to project from', () => {
    const r = assessHydrant({ ...duty, measuredFlowLpm: 400, measuredResidualKpa: 690, staticKpa: 700 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('indeterminate');
    expect(r.issues.some((i) => i.title.includes('Could not project'))).toBe(true);
  });

  it('fails a hydrant flowing above the permitted maximum even though the duty was demonstrated', () => {
    // Too much pressure is a defect in the other direction — nobody can hold the
    // hose. A pass on flow alone would send that out as compliant.
    const r = assessHydrant({
      ...duty,
      measuredFlowLpm: 900,
      measuredResidualKpa: 1250,
      maxOutletKpa: 1200,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.demonstrated).toBe(true);
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('Outlet pressure above'))).toBe(true);
  });

  it('does not fail a static that is above the flowing ceiling, because that is a different limit', () => {
    // The Queensland document this module ships as a reference sets 1200 kPa at
    // the outlet under design flow and 1300 kPa static with the pump running.
    // A static of 1250 is inside what that document allows; failing it against
    // the flowing figure writes up a defect the source does not support, which
    // is a false statement in a report a client acts on.
    const r = assessHydrant({
      ...duty,
      measuredFlowLpm: 900,
      measuredResidualKpa: 400,
      staticKpa: 1250,
      maxOutletKpa: 1200,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('pass');
    expect(r.issues.some((i) => i.level === 'warning' && i.title.includes('different limit'))).toBe(true);
  });

  it('fails a static over its own stated ceiling', () => {
    const r = assessHydrant({
      ...duty,
      measuredFlowLpm: 900,
      measuredResidualKpa: 400,
      staticKpa: 1400,
      maxStaticKpa: 1300,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('Static pressure above'))).toBe(true);
  });

  it('fails on over-pressure even where the flow question could not be answered', () => {
    // The flow test is incomplete — no static, and a shortfall — but the outlet
    // was measured over its ceiling, and a measured defect does not become
    // inconclusive because a different question went unanswered.
    const r = assessHydrant({
      ...duty,
      measuredFlowLpm: 300,
      measuredResidualKpa: 1250,
      maxOutletKpa: 1200,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.verdict).toBe('fail');
    expect(r.summary).toMatch(/regardless of the flow result/);
  });

  it("refuses a ceiling it cannot read rather than quietly not checking it", () => {
    // The screen hands over whatever is in the field. A ceiling that arrives as
    // NaN and is silently dropped produces a PASS on flow alone from a test the
    // technician believes was checked against a maximum.
    const over = { ...duty, measuredFlowLpm: 900, measuredResidualKpa: 1250 };
    expect(isRefused(assessHydrant({ ...over, maxOutletKpa: Number.NaN }))).toBe(true);
    expect(isRefused(assessHydrant({ ...over, maxStaticKpa: Number.NaN }))).toBe(true);
    expect(isRefused(assessHydrant({ ...over, maxOutletKpa: 0 }))).toBe(true);
    // And with the ceiling readable, the same test is a fail rather than a refusal.
    const good = assessHydrant({ ...over, maxOutletKpa: 1200 });
    expect(isRefused(good)).toBe(false);
  });

  it("refuses a static it cannot read instead of reporting that none was taken", () => {
    // "Record the static and retest" sends a technician back to a site where the
    // static was recorded — it was just typed with a letter in it.
    const r = assessHydrant({ ...duty, measuredFlowLpm: 400, measuredResidualKpa: 500, staticKpa: Number.NaN });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/static/i);
  });

  it('does not call a duty demonstrated when the flow was made but not at the pressure', () => {
    // 10.3 L/s came out, which is over the duty, but at 100 kPa instead of 350.
    // "Demonstrated" has to mean both halves of the duty at once, or a hydrant
    // that dumps water at no useful pressure passes on the flow figure alone.
    const r = assessHydrant({ ...duty, measuredFlowLpm: 620, measuredResidualKpa: 100 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.demonstrated).toBe(false);
    expect(r.verdict).toBe('indeterminate');
  });

  it("refuses to assess against a duty with no recorded source", () => {
    // The whole result is "measured against X". Without X it is a number with an
    // opinion attached, and the report cannot say what it was checked against.
    const r = assessHydrant({
      requiredFlowLpm: 600,
      requiredResidualKpa: 350,
      requirementSource: '   ',
      measuredFlowLpm: 620,
      measuredResidualKpa: 360,
    });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toMatch(/source/i);
  });

  it('carries the requirement and the disclaimer through to the result', () => {
    const r = assessHydrant({ ...duty, measuredFlowLpm: 620, measuredResidualKpa: 360 });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.requirementSource).toBe(duty.requirementSource);
    expect(r.issues.some((i) => i.detail.includes('does not certify a design'))).toBe(true);
  });

  it('labels the result with the hydrant it came from when one is given', () => {
    const r = assessHydrant({ ...duty, measuredFlowLpm: 620, measuredResidualKpa: 360, hydrantRef: 'HYD-14 level 8' });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.summary.startsWith('HYD-14 level 8:')).toBe(true);
  });

  it('refuses a required flow of zero or a negative measurement', () => {
    expect(isRefused(assessHydrant({ ...duty, requiredFlowLpm: 0, measuredFlowLpm: 1, measuredResidualKpa: 1 }))).toBe(true);
    expect(isRefused(assessHydrant({ ...duty, measuredFlowLpm: -1, measuredResidualKpa: 360 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the published requirement references', () => {
  it('carries a URL, a jurisdiction and a scope on every single entry', () => {
    // A duty figure with no source is exactly the invented number this module
    // exists to avoid, so there is no way to add one without saying where it
    // came from and where it applies.
    for (const ref of REQUIREMENT_REFS) {
      expect(ref.url).toMatch(/^https?:\/\//);
      expect(ref.jurisdiction.length).toBeGreaterThan(0);
      expect(ref.scope.length).toBeGreaterThan(20);
      expect(['high', 'medium', 'low']).toContain(ref.confidence);
      expect(ref.pressureKpa).toBeGreaterThan(0);
    }
  });

  it('says of every ceiling which state of the system it was written for', () => {
    // 1300 kPa static with the pump running and 1200 kPa at the outlet under
    // design flow are two different limits in the same document. A ceiling that
    // does not say which one it is gets applied to whichever reading is to hand,
    // and a static checked against the flowing figure is a defect nobody wrote.
    for (const ref of REQUIREMENT_REFS.filter((r) => r.kind === 'maximum')) {
      expect(['no-flow', 'design-flow', 'unstated']).toContain(ref.appliesAt);
    }
    // And where the source genuinely does not distinguish, that is recorded as
    // "unstated" rather than guessed at — the WA guideline states one maximum
    // for attack hydrants and never says whether it is measured flowing.
    expect(requirementRef('wa-dfes-attack-max')!.appliesAt).toBe('unstated');
    expect(requirementRef('qld-construction-max-static')!.appliesAt).toBe('no-flow');
    expect(requirementRef('qld-construction-max-discharge')!.appliesAt).toBe('design-flow');
  });

  it('has unique ids so a recorded assessment can be traced back to its figure', () => {
    const ids = REQUIREMENT_REFS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds the Queensland attack hydrant figure as its regulator published it', () => {
    // 10 L/s at 350 kPa, from the Queensland Fire Department's own document.
    const ref = requirementRef('qld-construction-attack');
    expect(ref).toBeDefined();
    expect(ref!.flowLps).toBe(10);
    expect(ref!.pressureKpa).toBe(350);
    expect(ref!.url).toContain('fire.qld.gov.au');
  });

  it('keeps the construction-phase scope attached, because it is not a figure for a finished building', () => {
    const ref = requirementRef('qld-construction-attack')!;
    expect(ref.scope).toMatch(/under construction/i);
  });

  it('holds a second jurisdiction whose figures differ, so nobody assumes one national number', () => {
    // WA asks 700 kPa at attack hydrants where the Queensland construction
    // document asks 350 unassisted. An interstate job on the wrong figure is a
    // whole day of testing against the wrong duty.
    const qld = requirementsFor('Queensland');
    const wa = requirementsFor('Western Australia');
    expect(qld.length).toBeGreaterThan(0);
    expect(wa.length).toBeGreaterThan(0);
    expect(wa.some((r) => r.pressureKpa === 700 && r.kind === 'minimum')).toBe(true);
  });

  it('turns a minimum into a duty in the units the calculation uses', () => {
    const duty = refToDuty(requirementRef('qld-construction-attack')!);
    expect(duty).not.toBeNull();
    expect(duty!.requiredFlowLpm).toBe(600);
    expect(duty!.requiredResidualKpa).toBe(350);
    expect(duty!.requirementSource).toContain('fire.qld.gov.au');
  });

  it("will not manufacture a flow duty out of a pressure ceiling", () => {
    // The 1200 kPa maximum says nothing about how much water has to come out,
    // and treating it as a duty would assess against a requirement nobody set.
    expect(refToDuty(requirementRef('qld-construction-max-discharge')!)).toBeNull();
    expect(refToDuty(requirementRef('wa-dfes-attack-min')!)).toBeNull();
  });

  it('refuses a maximum that does carry a flow figure, which is the case the null check alone misses', () => {
    // Every maximum shipped today happens to have flowLps null, so the entries
    // above pass on the missing flow and never touch the "is it a minimum"
    // guard at all. A ceiling added later that states a flow — "no more than
    // 1200 kPa at 10 L/s" — would sail straight through and be assessed as a
    // duty of 10 L/s at 1200 kPa, which is not a requirement anybody wrote.
    const ceilingWithAFlow = { ...requirementRef('qld-construction-max-discharge')!, flowLps: 10 };
    expect(refToDuty(ceilingWithAFlow)).toBeNull();
  });

  it('returns nothing for a jurisdiction it holds no figures for', () => {
    expect(requirementsFor('New South Wales')).toEqual([]);
  });
});

describe('the reference tables', () => {
  it('sources every discharge coefficient it offers, and offers none it cannot', () => {
    for (const o of OUTLETS) {
      expect(o.source.length).toBeGreaterThan(0);
      expect(o.geometry.length).toBeGreaterThan(0);
      if (o.coefficient !== null) {
        expect(o.url).toMatch(/^https?:\/\//);
        expect(o.coefficient).toBeGreaterThan(0);
        expect(o.coefficient).toBeLessThanOrEqual(1);
      }
    }
    // And at least one entry is deliberately empty, so "I cannot tell" is selectable.
    expect(OUTLETS.some((o) => o.coefficient === null)).toBe(true);
  });

  it('sources every Hazen-Williams C value and keeps its range the right way round', () => {
    for (const c of CONDUITS) {
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.source.length).toBeGreaterThan(0);
      expect(c.cLow).toBeGreaterThan(0);
      expect(c.cHigh).toBeGreaterThanOrEqual(c.cLow);
    }
  });

  it('returns nothing for an outlet or material it does not hold', () => {
    expect(outletSpec('storz' as never)).toBeUndefined();
    expect(conduitSpec('unobtainium' as never)).toBeUndefined();
  });
});
