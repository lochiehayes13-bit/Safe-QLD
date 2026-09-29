import {
  CURVE_MULTIPLIER, disconnects, faultLoop, maxLengthForDisconnection,
} from '@/calc/cable';

/**
 * The earth fault loop.
 *
 * This is the check a long run fails silently. Everything else about the
 * circuit is right — the cable carries the load, the volt drop is inside the
 * limit, the breaker matches the cable — and an earth fault at the far end
 * draws too little current to move the magnetic element, so the device falls
 * back to its thermal curve and takes seconds instead of milliseconds.
 *
 * Two things are easy to get wrong and both are tested here. Working the loop
 * at bench temperature produces a circuit that disconnects on paper and not on
 * site, because a warm conductor has more resistance and passes less fault
 * current. And assuming the earth is the same size as the active understates
 * R1 + R2, which is exactly the case a 6 mm² active with a 2.5 mm² earth
 * presents.
 */

const RUN = {
  supplyOhms: 0.35,
  lengthM: 40,
  activeMm2: 2.5,
  earthMm2: 2.5,
  material: 'copper' as const,
  operatingC: 75,
  phaseVolts: 230,
};

describe('the loop itself', () => {
  it('is out along the active and back along the earth', () => {
    const r = faultLoop(RUN)!;
    // Two conductors of the same size, so R1 + R2 is twice one of them.
    expect(r.circuitOhms).toBeCloseTo(2 * (0.0209681 / 2.5) * 40, 3);
    expect(r.totalOhms).toBeCloseTo(r.circuitOhms + 0.35, 4);
    expect(r.faultCurrentA).toBeCloseTo(230 / r.totalOhms, 0);
  });

  it('counts a smaller earth as the larger half of the loop', () => {
    // The case that fails a check people assume it passes.
    const equal = faultLoop({ ...RUN, activeMm2: 6, earthMm2: 6 })!;
    const reduced = faultLoop({ ...RUN, activeMm2: 6, earthMm2: 2.5 })!;
    expect(reduced.circuitOhms).toBeGreaterThan(equal.circuitOhms);
    expect(reduced.faultCurrentA).toBeLessThan(equal.faultCurrentA);
  });

  it('works the conductor warm, which is the conservative direction', () => {
    const hot = faultLoop(RUN)!;
    const cold = faultLoop({ ...RUN, operatingC: 20 })!;
    // Less fault current when warm, so a loop that passes here passes on site.
    expect(hot.faultCurrentA).toBeLessThan(cold.faultCurrentA);
  });

  it('is the supply alone when the run is nothing', () => {
    const r = faultLoop({ ...RUN, lengthM: 0 })!;
    expect(r.circuitOhms).toBe(0);
    expect(r.totalOhms).toBeCloseTo(0.35, 4);
  });

  it('refuses input it cannot work with rather than dividing by zero', () => {
    expect(faultLoop({ ...RUN, activeMm2: 0 })).toBeNull();
    expect(faultLoop({ ...RUN, supplyOhms: -1 })).toBeNull();
    expect(faultLoop({ ...RUN, phaseVolts: 0 })).toBeNull();
    expect(faultLoop({ ...RUN, lengthM: Number.NaN })).toBeNull();
  });
});

describe('whether the device trips at once', () => {
  it('needs its curve multiple of its rating', () => {
    // A Type C at 20 A wants 200 A before the magnetic element moves.
    const r = disconnects({ faultCurrentA: 300, deviceRatingA: 20, multiplier: CURVE_MULTIPLIER.C, phaseVolts: 230 })!;
    expect(r.tripCurrentA).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.marginPercent).toBe(50);
  });

  it('gives the largest loop that still delivers it', () => {
    // 230 ÷ 200: this is where a printed maximum loop impedance comes from,
    // and computing it holds for any device and any supply voltage.
    const r = disconnects({ faultCurrentA: 300, deviceRatingA: 20, multiplier: 10, phaseVolts: 230 })!;
    expect(r.maxLoopOhms).toBeCloseTo(1.15, 3);
  });

  it('says what will actually happen when it fails, not just that it failed', () => {
    const r = disconnects({ faultCurrentA: 150, deviceRatingA: 20, multiplier: 10, phaseVolts: 230 })!;
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('thermal curve');
    expect(r.marginPercent).toBeLessThan(0);
  });

  it('is harder to satisfy the further up the curve the device is', () => {
    const at = (m: number) => disconnects({ faultCurrentA: 150, deviceRatingA: 20, multiplier: m, phaseVolts: 230 })!;
    expect(at(CURVE_MULTIPLIER.B).ok).toBe(true);
    expect(at(CURVE_MULTIPLIER.C).ok).toBe(false);
    expect(CURVE_MULTIPLIER.D).toBeGreaterThan(CURVE_MULTIPLIER.C);
  });

  it('refuses a device or a supply that is not one', () => {
    expect(disconnects({ faultCurrentA: 300, deviceRatingA: 0, multiplier: 10, phaseVolts: 230 })).toBeNull();
    expect(disconnects({ faultCurrentA: 300, deviceRatingA: 20, multiplier: 0, phaseVolts: 230 })).toBeNull();
  });
});

describe('the longest run that still disconnects', () => {
  it('is the number worth having when the check fails', () => {
    // "Use a different breaker" is almost never the answer; "how much of this
    // run can stay" is.
    const max = maxLengthForDisconnection({ ...RUN, deviceRatingA: 20, multiplier: 5 })!;
    expect(max).toBeGreaterThan(0);
    const at = faultLoop({ ...RUN, lengthM: max })!;
    expect(disconnects({ faultCurrentA: at.faultCurrentA, deviceRatingA: 20, multiplier: 5, phaseVolts: 230 })!.ok).toBe(true);
    // One metre further and it no longer does.
    const past = faultLoop({ ...RUN, lengthM: max + 1 })!;
    expect(disconnects({ faultCurrentA: past.faultCurrentA, deviceRatingA: 20, multiplier: 5, phaseVolts: 230 })!.ok).toBe(false);
  });

  it('is nothing at all where the supply alone already exceeds the loop', () => {
    // Not a negative length, which would read as room to spare.
    expect(maxLengthForDisconnection({ ...RUN, supplyOhms: 5, deviceRatingA: 20, multiplier: 10 })).toBe(0);
  });

  it('grows with the conductor and shrinks with the device rating', () => {
    const base = maxLengthForDisconnection({ ...RUN, deviceRatingA: 20, multiplier: 5 })!;
    expect(maxLengthForDisconnection({ ...RUN, activeMm2: 6, earthMm2: 6, deviceRatingA: 20, multiplier: 5 })!).toBeGreaterThan(base);
    expect(maxLengthForDisconnection({ ...RUN, deviceRatingA: 32, multiplier: 5 })!).toBeLessThan(base);
  });
});
