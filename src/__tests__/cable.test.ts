import {
  CABLE_OVERLOAD_ALLOWANCE, MATERIALS, PROTECTIVE_RATINGS_A, STANDARD_SIZES_MM2,
  adiabaticK, combineDerating, coordinate, deratedCapacity, minimumFaultSize,
  resistancePerMetre, sizeCable, voltDrop, withstandTimeS,
  type CandidateRow, type DeratingFactor,
} from '@/calc/cable';

/**
 * Cable sizing.
 *
 * This module carries no table from any standard, so the thing worth testing
 * is that what it does carry — physics — actually reproduces what the tables
 * say. The adiabatic constants are the proof: fed the insulation temperatures,
 * the equation returns the published k values for all four combinations of
 * copper, aluminium, PVC and XLPE. That agreement is what distinguishes a
 * derivation from a number somebody remembered.
 *
 * The rest is the four checks a cable has to pass, and the ways each of them
 * is got wrong: a derating factor that would rate the cable at nothing, a
 * breaker larger than the cable it protects, a volt drop worked at bench
 * temperature, and a conductor that carries the load beautifully and cannot
 * survive a fault.
 */

describe('conductor resistance', () => {
  it('is the material constant at 20 °C', () => {
    // 1/58 ohm·mm²/m is the International Annealed Copper Standard.
    expect(resistancePerMetre(1, 'copper', 20)).toBeCloseTo(1 / 58, 6);
    expect(resistancePerMetre(1, 'aluminium', 20)).toBeCloseTo(1 / 35.38, 6);
  });

  it('rises with temperature, which is the whole reason it is a parameter', () => {
    const cold = resistancePerMetre(2.5, 'copper', 20)!;
    const hot = resistancePerMetre(2.5, 'copper', 90)!;
    // About 28% more resistance at the X-90 rating than on the bench: a volt
    // drop worked cold passes on paper and fails in a hot roof.
    expect(hot / cold).toBeCloseTo(1.275, 2);
  });

  it('halves when the conductor doubles', () => {
    expect(resistancePerMetre(4, 'copper', 75)! / resistancePerMetre(2, 'copper', 75)!).toBeCloseTo(0.5, 9);
  });

  it('refuses a size or a temperature that is not one', () => {
    expect(resistancePerMetre(0, 'copper', 75)).toBeNull();
    expect(resistancePerMetre(-2.5, 'copper', 75)).toBeNull();
    expect(resistancePerMetre(2.5, 'copper', Number.NaN)).toBeNull();
    // Below about -275 °C the linear model goes negative, which is not a cable.
    expect(resistancePerMetre(2.5, 'copper', -300)).toBeNull();
  });
});

describe('the adiabatic constant', () => {
  /*
   * The published k values, and the temperatures they are drawn for. These are
   * the check that the equation in cable.ts is the real one — nothing in that
   * module knows these numbers, it computes them from resistivity, heat
   * capacity and the temperature coefficient.
   */
  it.each([
    ['copper', 70, 160, 115],
    ['aluminium', 70, 160, 76],
    ['copper', 90, 250, 143],
    ['aluminium', 90, 250, 94],
  ] as const)('for %s from %d °C to %d °C is about %d', (material, start, final, expected) => {
    const k = adiabaticK(material, start, final)!;
    expect(Math.round(k)).toBeGreaterThanOrEqual(expected - 1);
    expect(Math.round(k)).toBeLessThanOrEqual(expected + 1);
  });

  it('refuses a fault that cools the conductor down', () => {
    expect(adiabaticK('copper', 160, 70)).toBeNull();
    expect(adiabaticK('copper', 90, 90)).toBeNull();
    expect(adiabaticK('copper', Number.NaN, 160)).toBeNull();
  });

  it('is larger for the insulation that tolerates more', () => {
    // XLPE takes 250 °C where PVC takes 160, so the same conductor survives a
    // bigger fault. Getting this backwards would undersize every XLPE run.
    expect(adiabaticK('copper', 90, 250)!).toBeGreaterThan(adiabaticK('copper', 70, 160)!);
  });
});

describe('short circuit withstand', () => {
  it('is S = I√t ÷ k', () => {
    // 6 kA cleared in 0.1 s through a copper PVC conductor.
    const r = minimumFaultSize({ faultA: 6000, clearingTimeS: 0.1, k: 115 })!;
    expect(r.minimumAreaMm2).toBeCloseTo((6000 * Math.sqrt(0.1)) / 115, 2);
    expect(r.standardAreaMm2).toBe(25);
  });

  it('picks a size cable is actually made in', () => {
    const r = minimumFaultSize({ faultA: 1000, clearingTimeS: 0.1, k: 115 })!;
    expect(r.minimumAreaMm2).toBeLessThan(3);
    expect(r.standardAreaMm2).toBe(4);
    expect(STANDARD_SIZES_MM2).toContain(4);
  });

  it('says nothing rather than a size when the fault is larger than any cable', () => {
    expect(minimumFaultSize({ faultA: 500000, clearingTimeS: 1, k: 115 })!.standardAreaMm2).toBeNull();
  });

  it('turns the same equation round to give a time', () => {
    expect(withstandTimeS(25, 115, 6000)).toBeCloseTo(0.2296, 3);
    expect(withstandTimeS(0, 115, 6000)).toBeNull();
  });
});

describe('derating', () => {
  const good = (factor: number, kind: DeratingFactor['kind'] = 'ambient'): DeratingFactor =>
    ({ kind, condition: '40 °C in air', factor, source: 'the office copy, table 27' });

  it('multiplies the factors together', () => {
    const r = combineDerating([good(0.87), good(0.8, 'grouping')]);
    expect(r.factor).toBeCloseTo(0.696, 6);
    expect(r.applied).toHaveLength(2);
  });

  it('is 1 when nothing derates it', () => {
    expect(combineDerating([]).factor).toBe(1);
  });

  it('throws out a factor that would rate the cable at nothing, and says so', () => {
    const r = combineDerating([good(0.87), good(0)]);
    expect(r.factor).toBeCloseTo(0.87, 6);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain('rate the cable at nothing');
  });

  it('throws out a factor above 2, because that reads as a mistyped lookup', () => {
    // The dangerous direction: a factor of 8 where 0.8 was meant would rate a
    // 2.5 mm² cable at 200 A.
    const r = combineDerating([good(8)]);
    expect(r.factor).toBe(1);
    expect(r.rejected[0]!.reason).toContain('mistyped');
  });

  it('throws out a factor nobody can point at', () => {
    const r = combineDerating([{ kind: 'grouping', condition: 'six circuits', factor: 0.57, source: '  ' }]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('not a derating');
  });

  it('applies the whole chain to a table figure', () => {
    const r = deratedCapacity(32, [good(0.87), good(0.8, 'grouping')])!;
    expect(r.amps).toBeCloseTo(22.27, 2);
  });

  it('has no capacity to derate when nothing was loaded', () => {
    expect(deratedCapacity(0, [])).toBeNull();
  });
});

describe('protection coordination', () => {
  it('picks the smallest device between the load and the cable', () => {
    const r = coordinate({ designCurrentA: 18, capacityA: 32 });
    expect(r.deviceRatingA).toBe(20);
    expect(r.ok).toBe(true);
  });

  it('refuses when no rating fits between them, and names which way to fix it', () => {
    // 25 A load, 24 A cable: there is nothing between them, and the cable is
    // the thing that is wrong.
    const r = coordinate({ designCurrentA: 25, capacityA: 24 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('The cable is too small');
  });

  it('rejects a device larger than the cable it is meant to protect', () => {
    // The failure that burns a wall down: the device is happy, the cable cooks.
    const r = coordinate({ designCurrentA: 18, capacityA: 20, deviceRatingA: 32 });
    expect(r.protectsCable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('does not protect');
  });

  it('rejects a device that will trip on the load', () => {
    const r = coordinate({ designCurrentA: 25, capacityA: 40, deviceRatingA: 16 });
    expect(r.carriesLoad).toBe(false);
    expect(r.reason).toContain('will trip');
  });

  it('checks the overload current on top of the rating', () => {
    // A device whose conventional tripping current runs well past what the
    // cable takes passes In ≤ Iz and still cooks it. With a standard breaker
    // the two 1.45s cancel; with a fuse at 1.9 they do not.
    const breaker = coordinate({ designCurrentA: 18, capacityA: 20, deviceRatingA: 20 });
    expect(breaker.ok).toBe(true);
    const fuse = coordinate({ designCurrentA: 18, capacityA: 20, deviceRatingA: 20, overloadRatio: 1.9 });
    expect(fuse.protectsCable).toBe(true);
    expect(fuse.clearsOverload).toBe(false);
    expect(fuse.reason).toContain('overload current');
    expect(CABLE_OVERLOAD_ALLOWANCE).toBe(1.45);
  });

  it('says what is missing rather than producing a confident zero', () => {
    expect(coordinate({ designCurrentA: 0, capacityA: 32 }).reason).toContain('Enter the current');
    expect(coordinate({ designCurrentA: 18, capacityA: 0 }).reason).toContain('load a table figure');
  });

  it('offers the ratings devices are actually made in', () => {
    expect(PROTECTIVE_RATINGS_A).toContain(20);
    expect(PROTECTIVE_RATINGS_A).toContain(63);
    expect([...PROTECTIVE_RATINGS_A]).toEqual([...PROTECTIVE_RATINGS_A].sort((a, b) => a - b));
  });
});

describe('volt drop', () => {
  const run = { amps: 20, lengthM: 40, areaMm2: 4, material: 'copper' as const, operatingC: 75, supplyVolts: 230 };

  it('counts the run twice on single phase, because the current comes back', () => {
    const single = voltDrop({ ...run, phase: 'single' })!;
    const three = voltDrop({ ...run, phase: 'three' })!;
    // √3 against 2 — forgetting the 2 halves the answer and passes everything.
    // Compared loosely because the returned figure is rounded for display.
    expect(single.mvPerAmpMetre / three.mvPerAmpMetre).toBeCloseTo(2 / Math.sqrt(3), 3);
  });

  it('is L × I × Vc ÷ 1000', () => {
    const r = voltDrop({ ...run, phase: 'single' })!;
    expect(r.dropVolts).toBeCloseTo((40 * 20 * r.mvPerAmpMetre) / 1000, 2);
    expect(r.voltsAtLoad).toBeCloseTo(230 - r.dropVolts, 2);
    expect(r.dropPercent).toBeCloseTo((r.dropVolts / 230) * 100, 2);
  });

  it('says when the answer is resistance only', () => {
    expect(voltDrop({ ...run, phase: 'single' })!.resistanceOnly).toBe(true);
    expect(voltDrop({ ...run, phase: 'single', reactanceOhmPerKm: 0.09, powerFactor: 0.8 })!.resistanceOnly).toBe(false);
  });

  it('prefers the table figure over its own, and says it did', () => {
    const computed = voltDrop({ ...run, phase: 'single' })!;
    const tabled = voltDrop({ ...run, phase: 'single', mvPerAmpMetre: 11.2 })!;
    expect(tabled.mvPerAmpMetre).toBe(11.2);
    expect(tabled.fromTable).toBe(true);
    expect(computed.fromTable).toBe(false);
  });

  it('adds the reactive part only where there is an angle to add it at', () => {
    // At unity there is no sin φ, so reactance contributes nothing at all —
    // the same answer as a run with no reactance figure supplied.
    const unity = voltDrop({ ...run, phase: 'three', reactanceOhmPerKm: 0.09, powerFactor: 1 })!;
    expect(unity.mvPerAmpMetre).toBeCloseTo(voltDrop({ ...run, phase: 'three' })!.mvPerAmpMetre, 6);

    // At a lagging power factor the reactive term is real, and leaving the
    // reactance out understates the drop.
    const withX = voltDrop({ ...run, phase: 'three', reactanceOhmPerKm: 0.09, powerFactor: 0.8 })!;
    const withoutX = voltDrop({ ...run, phase: 'three', powerFactor: 0.8 })!;
    expect(withX.mvPerAmpMetre).toBeGreaterThan(withoutX.mvPerAmpMetre);
  });

  it('drops less per amp at a lagging power factor, which is not the trap it looks like', () => {
    // R cos φ falls faster than X sin φ rises on a small cable, so the drop
    // PER AMP genuinely goes down. The current goes up for the same load
    // power, which is where the extra drop actually comes from — so this is
    // only ever fed the current the load really draws.
    const unity = voltDrop({ ...run, phase: 'single', powerFactor: 1 })!;
    const lagging = voltDrop({ ...run, phase: 'single', powerFactor: 0.8 })!;
    expect(lagging.mvPerAmpMetre).toBeLessThan(unity.mvPerAmpMetre);
  });

  it('ignores a power factor on a DC circuit, which has no angle', () => {
    const a = voltDrop({ ...run, phase: 'dc', powerFactor: 0.5 })!;
    const b = voltDrop({ ...run, phase: 'dc' })!;
    expect(a.mvPerAmpMetre).toBe(b.mvPerAmpMetre);
  });

  it('judges against the limit, and gives the run length that meets it', () => {
    const tight = voltDrop({ ...run, phase: 'single', limitPercent: 1 })!;
    expect(tight.withinLimit).toBe(false);
    // The longest run at this size and load, and it is shorter than the one asked about.
    expect(tight.maxLengthM!).toBeLessThan(40);
    const back = voltDrop({ ...run, phase: 'single', lengthM: tight.maxLengthM!, limitPercent: 1 })!;
    expect(back.dropPercent).toBeCloseTo(1, 1);
  });

  it('refuses nonsense rather than returning zero', () => {
    expect(voltDrop({ ...run, phase: 'single', lengthM: -1 })).toBeNull();
    expect(voltDrop({ ...run, phase: 'single', areaMm2: 0 })).toBeNull();
    expect(voltDrop({ ...run, phase: 'single', amps: Number.NaN })).toBeNull();
  });
});

describe('the whole chain', () => {
  const rows: CandidateRow[] = [
    { areaMm2: 1.5, tableAmps: 17.5, source: 'office copy' },
    { areaMm2: 2.5, tableAmps: 24, source: 'office copy' },
    { areaMm2: 4, tableAmps: 32, source: 'office copy' },
    { areaMm2: 6, tableAmps: 41, source: 'office copy' },
    { areaMm2: 10, tableAmps: 57, source: 'office copy' },
  ];
  const base = {
    designCurrentA: 20, lengthM: 30, supplyVolts: 230, phase: 'single' as const,
    material: 'copper' as const, operatingC: 75, derating: [], rows,
  };

  it('picks the smallest size that survives every check', () => {
    // 20 A over 30 m: 2.5 mm² carries it, holds the volt drop and takes a
    // 20 A device. Going bigger than that is money in a wall.
    const r = sizeCable(base);
    expect(r.chosen?.row.areaMm2).toBe(2.5);
    expect(r.chosen?.protection.deviceRatingA).toBe(20);
    expect(r.refusal).toBeUndefined();
  });

  it('carries the source of the row it chose', () => {
    // "Where did this come from" is the question asked six months later.
    expect(sizeCable(base).chosen?.row.source).toBe('office copy');
  });

  it('says why each size it rejected was rejected', () => {
    const r = sizeCable(base);
    const small = r.considered.find((c) => c.row.areaMm2 === 1.5)!;
    expect(small.passes).toBe(false);
    expect(small.failedOn).toBe('capacity');
    expect(small.capacityA).toBe(17.5);
    // Nothing is hidden: every row loaded comes back, in size order.
    expect(r.considered.map((c) => c.row.areaMm2)).toEqual([1.5, 2.5, 4, 6, 10]);
  });

  it('goes up a size when the run is long enough to fail on volt drop', () => {
    // Four times the run, and 2.5 mm² now drops far past 5% while still
    // carrying the load perfectly well — which is the whole reason volt drop
    // is a separate check.
    const long = sizeCable({ ...base, lengthM: 120 });
    expect(long.chosen!.row.areaMm2).toBe(10);
    expect(long.considered.find((c) => c.row.areaMm2 === 2.5)!.failedOn).toBe('volt drop');
    expect(long.considered.find((c) => c.row.areaMm2 === 6)!.failedOn).toBe('volt drop');
  });

  it('goes up a size when the site derates it', () => {
    const derated = sizeCable({
      ...base,
      derating: [{ kind: 'grouping', condition: 'six circuits', factor: 0.57, source: 'office copy' }],
    });
    // Six circuits bunched together take a 32 A cable down to 18 A, and the
    // 20 A load no longer fits on it.
    expect(derated.chosen!.row.areaMm2).toBe(6);
    expect(derated.considered.find((c) => c.row.areaMm2 === 4)!.failedOn).toBe('capacity');
    expect(derated.derating.factor).toBeCloseTo(0.57, 6);
  });

  it('goes up a size when the fault current needs one', () => {
    const withFault = sizeCable({
      ...base,
      fault: { faultA: 6000, clearingTimeS: 0.1, startC: 70, finalC: 160 },
    });
    expect(withFault.k!).toBeGreaterThan(110);
    // 6 kA for 0.1 s needs about 16.5 mm², which none of these rows reach.
    expect(withFault.chosen).toBeUndefined();
    expect(withFault.refusal).toContain('fault current needs');
  });

  it('tells a phone with no tables to load some, rather than reporting no cable', () => {
    const empty = sizeCable({ ...base, rows: [] });
    expect(empty.chosen).toBeUndefined();
    expect(empty.refusal).toContain('Cable tables');
  });

  it('names the check that stopped the largest size, since that is what to change', () => {
    const hopeless = sizeCable({ ...base, designCurrentA: 200 });
    expect(hopeless.refusal).toContain('installation method or the derating');
  });

  it('has the material constants it works from', () => {
    expect(MATERIALS.copper.beta).toBe(234.5);
    expect(MATERIALS.aluminium.beta).toBe(228);
  });
});
