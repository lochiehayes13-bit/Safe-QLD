import {
  assessCombinedFlow, combinedFlowCertificateHtml, type CombinedFlowInput,
} from '@/export/combinedFlowCertificate';

/**
 * The combined sprinkler and hydrant flow test certificate.
 *
 * Two arithmetic failures are worth more attention than everything else on the
 * page, because both produce a certificate that reads as a pass.
 *
 * The sprinkler demand is written in litres per minute and the hydrant duty in
 * litres per second, on the same form, because that is how each trade writes its
 * own figure. Adding them as written overstates the duty sixtyfold, which then
 * fails a system that is fine — or, worse, the same slip in the other direction.
 *
 * And a pump tested only at its rated duty has not been tested. One on the way
 * out still makes its number at the easy end of the curve; the run that finds it
 * is 150% of duty flow at 65% of duty pressure.
 */

const base = (over: Partial<CombinedFlowInput> = {}): CombinedFlowInput => ({
  buildingName: 'An Example Building',
  testDate: '2026-07-03',
  hydrantFlowLps: 10,
  hydrantPressureKpa: 700,
  equipment: [],
  testPoints: [],
  testedBy: 'A Technician',
  ...over,
});

describe('assessCombinedFlow', () => {
  it('converts the sprinkler demand before adding it to the hydrant duty', () => {
    // 10 L/s of hydrants plus 600 L/min of sprinklers is 20 L/s, not 610.
    const a = assessCombinedFlow(base({ sprinklerFlowLpm: 600 }));
    expect(a.combinedLps).toBe(20);
  });

  it('falls back to the hydrant duty alone when there is no sprinkler demand', () => {
    expect(assessCombinedFlow(base()).combinedLps).toBe(10);
  });

  it('requires 150% of duty flow at 65% of duty pressure', () => {
    // Safe QLD's own certificate works this example: 16 L/s at 700 kPa gives
    // 24 L/s at 455 kPa.
    const a = assessCombinedFlow(base({ hydrantFlowLps: 16, hydrantPressureKpa: 700 }));
    expect(a.overload!.requiredFlowLps).toBe(24);
    expect(a.overload!.requiredPressureKpa).toBe(455);
  });

  it('fails an overload run that made the pressure but not the flow', () => {
    // A run below the required flow has proved nothing, whatever pressure it
    // held — which is exactly how a tiring pump passes.
    const a = assessCombinedFlow(base({
      hydrantFlowLps: 16,
      achievedAt150: { flowLps: 18, residualKpa: 600 },
    }));
    expect(a.overload!.achieved).toBe(false);
    expect(a.overload!.note).toContain('has not proved the pump at overload');
  });

  it('passes an overload run that made both', () => {
    const a = assessCombinedFlow(base({
      hydrantFlowLps: 16,
      achievedAt100: { flowLps: 16, residualKpa: 700 },
      achievedAt150: { flowLps: 24, residualKpa: 460 },
    }));
    expect(a.overload!.achieved).toBe(true);
    expect(a.passed).toBe(true);
  });

  it('says the duty was never made rather than going straight to the overload', () => {
    const a = assessCombinedFlow(base({
      achievedAt100: { flowLps: 7, residualKpa: 700 },
      achievedAt150: { flowLps: 15, residualKpa: 500 },
    }));
    expect(a.warnings.join(' ')).toContain('did not make its duty');
    expect(a.passed).toBe(false);
  });

  it('will not call it a pass when a gauge was out of calibration', () => {
    // Every pressure on the page was read with that gauge.
    const a = assessCombinedFlow(base({
      hydrantFlowLps: 16,
      achievedAt100: { flowLps: 16, residualKpa: 700 },
      achievedAt150: { flowLps: 24, residualKpa: 460 },
      equipment: [{ item: 'Pressure Gauge', idNumber: 'G1', certificationDate: '2024-01-01' }],
    }));
    expect(a.staleEquipment).toHaveLength(1);
    expect(a.passed).toBe(false);
    expect(a.warnings.join(' ')).toContain('none of them can be relied on');
  });

  it('catches a calibration date after the test date', () => {
    const a = assessCombinedFlow(base({
      equipment: [{ item: 'Gauge', idNumber: 'G2', certificationDate: '2027-01-01' }],
    }));
    expect(a.warnings.join(' ')).toContain('One of the two is wrong');
  });

  it('leaves the verdict undetermined rather than passing on missing figures', () => {
    // A certificate that says "pass" because a field was blank is worse than
    // one that says nothing.
    const a = assessCombinedFlow(base({ achievedAt100: undefined, achievedAt150: undefined }));
    expect(a.passed).toBeUndefined();
  });

  it('says there is nothing to test against with no block plan duty', () => {
    const a = assessCombinedFlow(base({ hydrantFlowLps: undefined, hydrantPressureKpa: undefined }));
    expect(a.warnings.join(' ')).toContain('block plan at the booster');
  });
});

describe('combinedFlowCertificateHtml', () => {
  it('prints the combined duty and the overload requirement', () => {
    const html = combinedFlowCertificateHtml(base({
      hydrantFlowLps: 16, sprinklerFlowLpm: 600, hydrantPressureKpa: 700,
    }));
    expect(html).toContain('26 L/s');
    expect(html).toContain('39 L/s');
    expect(html).toContain('455 kPa');
  });

  it('says the outcome is undetermined rather than showing a pass', () => {
    const html = combinedFlowCertificateHtml(base());
    expect(html).toContain('Not determined from the figures recorded');
    expect(html).not.toContain('Flow test PASSED');
  });

  it('marks a stale calibration date in the equipment table', () => {
    const html = combinedFlowCertificateHtml(base({
      equipment: [{ item: 'Pressure Gauge', idNumber: 'G1', certificationDate: '2024-01-01' }],
    }));
    expect(html).toContain('class="fail"');
    expect(html).toContain('Before this is signed');
  });

  it('explains the unit conversion on the page, not only in the code', () => {
    const html = combinedFlowCertificateHtml(base({ sprinklerFlowLpm: 600 }));
    expect(html).toContain('overstates the duty sixtyfold');
  });

  it('prints Australian dates', () => {
    expect(combinedFlowCertificateHtml(base({ testDate: '2026-07-03' }))).toContain('03/07/2026');
  });

  it('escapes what a technician typed', () => {
    const html = combinedFlowCertificateHtml(base({ buildingName: 'Smith & Sons <Pty>' }));
    expect(html).toContain('Smith &amp; Sons &lt;Pty&gt;');
  });
});
