import {
  appendixFFields,
  availableFractionAtRate,
  calculateBattery,
  FC_DEFAULT,
  L_DESIGN,
  L_IN_SERVICE,
  nextStandardSize,
  STANDARD_SLA_AH,
  totalCurrents,
  type LoadItem,
  TEMP_MIN_C, TEMP_MAX_C,
} from '@/calc/battery';

/**
 * The worked examples below are the published ones used across Australian
 * industry guidance, so they double as a check that the engine agrees with what
 * a technician would get by hand.
 */

/** A load set totalling exactly 0.5 A standby and 0.8 A alarm. */
function loads(): LoadItem[] {
  return [
    { id: '1', label: 'Panel + devices', quantity: 1, standbyMa: 400, alarmMa: 500 },
    { id: '2', label: 'ASE', quantity: 1, standbyMa: 100, alarmMa: 300, isAse: true },
  ];
}

const base = {
  loads: loads(),
  alarmHours: 0.5,
  capacityDerating: FC_DEFAULT,
  deteriorationFactor: L_DESIGN,
};

describe('totalCurrents', () => {
  it('sums quantity-scaled milliamp loads into amps', () => {
    const { quiescentA, alarmA } = totalCurrents([
      { id: 'a', label: 'Detector', quantity: 100, standbyMa: 0.33, alarmMa: 3 },
      { id: 'b', label: 'Panel', quantity: 1, standbyMa: 150, alarmMa: 200 },
    ]);
    expect(quiescentA).toBeCloseTo((100 * 0.33 + 150) / 1000, 6);
    expect(alarmA).toBeCloseTo((100 * 3 + 200) / 1000, 6);
  });

  it('treats non-finite entries as zero rather than producing NaN', () => {
    const { quiescentA } = totalCurrents([
      { id: 'a', label: 'bad', quantity: Number.NaN, standbyMa: 10, alarmMa: 0 },
    ]);
    expect(quiescentA).toBe(0);
  });
});

describe('calculateBattery — monitored system, new battery', () => {
  const r = calculateBattery({ ...base, mode: 'design', monitored: true });

  it('applies the 24 hour standby period', () => {
    expect(r.standbyHours).toBe(24);
  });

  it('matches the published worked example of 16.0 Ah', () => {
    // 1.25 * ((0.5 * 24) + 2 * (0.8 * 0.5)) = 1.25 * 12.8 = 16.0
    expect(r.quiescentA).toBeCloseTo(0.5, 6);
    expect(r.alarmA).toBeCloseTo(0.8, 6);
    expect(r.standbyAh).toBeCloseTo(12, 6);
    expect(r.alarmAh).toBeCloseTo(0.8, 6);
    expect(r.subtotalAh).toBeCloseTo(12.8, 6);
    expect(r.requiredAh).toBeCloseTo(16, 6);
  });

  it('recommends the next standard size up, never down', () => {
    expect(r.recommendedAh).toBe(17);
  });
});

describe('calculateBattery — unmonitored system', () => {
  const r = calculateBattery({ ...base, mode: 'design', monitored: false });

  it('applies the full 72 hour standby period', () => {
    expect(r.standbyHours).toBe(72);
  });

  it('matches the published worked example of 46.0 Ah', () => {
    // 1.25 * ((0.5 * 72) + 2 * (0.8 * 0.5)) = 1.25 * 36.8 = 46.0
    expect(r.requiredAh).toBeCloseTo(46, 6);
    expect(r.recommendedAh).toBe(50);
  });

  it('says plainly that the longer standby period was applied', () => {
    expect(r.issues.some((i) => i.title.includes('72 hour'))).toBe(true);
  });
});

describe('calculateBattery — in-service assessment', () => {
  it('matches the published in-service example of 14.08 Ah', () => {
    // 1.1 * ((0.5 * 24) + 2 * (0.8 * 0.5)) = 1.1 * 12.8 = 14.08
    const r = calculateBattery({
      ...base,
      mode: 'service',
      monitored: true,
      deteriorationFactor: L_IN_SERVICE,
    });
    expect(r.requiredAh).toBeCloseTo(14.08, 6);
  });

  it('never applies the reduced factor to a design calculation', () => {
    const r = calculateBattery({
      ...base,
      mode: 'design',
      monitored: true,
      deteriorationFactor: L_IN_SERVICE,
    });
    expect(r.requiredAh).toBeCloseTo(16, 6);
  });

  it('fails an undersized installed battery and passes an adequate one', () => {
    const common = { ...base, mode: 'service' as const, monitored: true, deteriorationFactor: L_IN_SERVICE };
    expect(calculateBattery({ ...common, installedBatteryAh: 12 }).installedPasses).toBe(false);
    expect(calculateBattery({ ...common, installedBatteryAh: 17 }).installedPasses).toBe(true);
  });
});

describe('calculateBattery — validation', () => {
  it('refuses a deterioration factor that is not a number, or below one', () => {
    /*
     * The factor multiplies the whole requirement. NaN turns every figure on
     * the page into NaN, and zero makes a battery of any size pass its
     * assessment. Both come straight off a text field.
     */
    for (const bad of [Number.NaN, 0]) {
      const r = calculateBattery({
        ...base, mode: 'service', monitored: true, deteriorationFactor: bad, installedBatteryAh: 1,
      });
      expect(Number.isFinite(r.requiredAh)).toBe(true);
      // Sized against the design factor instead, which is the safe direction.
      expect(r.requiredAh).toBeCloseTo(16, 6);
      expect(r.issues.some((i) => i.level === 'error' && /deterioration factor/i.test(i.title))).toBe(true);
      expect(r.installedPasses).toBe(false);
    }
  });

  it('flags a battery that will not fit the panel', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: false, panelMaxBatteryAh: 26 });
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('will not fit'))).toBe(true);
  });

  it('accepts a battery that exactly fills the panel, and refuses the one over it', () => {
    /*
     * The calculation calls for 50 Ah here. A panel that accepts 50 accepts it;
     * one that accepts 49 does not, and needs an external supply and a cabinet.
     *
     * Read a hair the wrong way, a panel sized exactly for its own battery is
     * told it needs a cabinet it does not need — which is a quote for work
     * nobody has to do.
     */
    const exact = calculateBattery({ ...base, mode: 'design', monitored: false, panelMaxBatteryAh: 50 });
    expect(exact.recommendedAh).toBe(50);
    expect(exact.issues.some((i) => i.title.includes('will not fit'))).toBe(false);

    const oneShort = calculateBattery({ ...base, mode: 'design', monitored: false, panelMaxBatteryAh: 49 });
    expect(oneShort.issues.some((i) => i.level === 'error' && i.title.includes('will not fit'))).toBe(true);
  });

  it('treats both ends of the stated temperature window as inside it', () => {
    /*
     * The capacity formula is stated for 15–30 °C and gives no correction
     * outside it. Those two temperatures are inside the window, and warning at
     * them sends somebody to a manufacturer's derating curve for a battery
     * sitting in the range the formula covers.
     */
    for (const temp of [TEMP_MIN_C, TEMP_MAX_C]) {
      const r = calculateBattery({ ...base, mode: 'design', monitored: false, averageTempC: temp });
      expect({ temp, warned: r.issues.some((i) => i.title.includes('outside')) })
        .toEqual({ temp, warned: false });
    }
    for (const temp of [TEMP_MIN_C - 1, TEMP_MAX_C + 1]) {
      const r = calculateBattery({ ...base, mode: 'design', monitored: false, averageTempC: temp });
      expect({ temp, warned: r.issues.some((i) => i.title.includes('outside')) })
        .toEqual({ temp, warned: true });
    }
  });

  it('warns when no alarm signalling equipment load was entered', () => {
    const r = calculateBattery({
      ...base,
      loads: [{ id: '1', label: 'Panel', quantity: 1, standbyMa: 400, alarmMa: 500 }],
      mode: 'design',
      monitored: true,
    });
    expect(r.issues.some((i) => i.title.includes('alarm signalling'))).toBe(true);
  });

  it('warns outside the temperature window the formula is stated for', () => {
    const hot = calculateBattery({ ...base, mode: 'design', monitored: true, averageTempC: 42 });
    expect(hot.issues.some((i) => i.title.includes('temperature'))).toBe(true);
    const ok = calculateBattery({ ...base, mode: 'design', monitored: true, averageTempC: 22 });
    expect(ok.issues.some((i) => i.title.includes('temperature'))).toBe(false);
  });

  it('errors when nothing has been entered', () => {
    const r = calculateBattery({ ...base, loads: [], mode: 'design', monitored: true });
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('models door holders correctly: heavy in standby, absent in alarm', () => {
    // 20 holders at 55 mA dominate standby and contribute nothing in alarm.
    const r = calculateBattery({
      ...base,
      mode: 'design',
      monitored: true,
      loads: [
        { id: 'p', label: 'Panel', quantity: 1, standbyMa: 150, alarmMa: 250 },
        { id: 'd', label: 'Door holders', quantity: 20, standbyMa: 55, alarmMa: 0 },
        { id: 'a', label: 'ASE', quantity: 1, standbyMa: 50, alarmMa: 100, isAse: true },
      ],
    });
    expect(r.quiescentA).toBeCloseTo((150 + 20 * 55 + 50) / 1000, 6);
    expect(r.alarmA).toBeCloseTo((250 + 0 + 100) / 1000, 6);
    expect(r.alarmA).toBeLessThan(r.quiescentA);
    expect(r.issues.some((i) => i.title.includes('below standby'))).toBe(true);
  });
});

describe('charger checks', () => {
  it('derives the minimum charge current for the 80%-in-24-hours rule', () => {
    // (0.8 * 17 * 1.2) / 24 = 0.68 A; continuous need = 0.5 + 0.68 = 1.18 A
    const r = calculateBattery({ ...base, mode: 'design', monitored: true });
    expect(r.charger?.minimumChargeA).toBeCloseTo(0.68, 2);
    expect(r.charger?.requiredContinuousA).toBeCloseTo(1.18, 2);
  });

  it('passes a supply that charges fast enough and carries the load', () => {
    const r = calculateBattery({
      ...base, mode: 'design', monitored: true, psuChargeCurrentA: 2.1, psuOutputA: 2.9,
    });
    expect(r.charger?.rechargeOk).toBe(true);
    expect(r.charger?.simultaneousOk).toBe(true);
  });

  it('fails a supply that cannot recharge in time', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: true, psuChargeCurrentA: 0.2, psuOutputA: 2.9 });
    expect(r.charger?.rechargeOk).toBe(false);
    expect(r.issues.some((i) => i.level === 'error' && i.title.includes('recharge'))).toBe(true);
  });

  it('fails a supply that cannot charge and carry the load at once', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: true, psuChargeCurrentA: 2.1, psuOutputA: 2.0 });
    expect(r.charger?.simultaneousOk).toBe(false);
  });

  it('reports unknown rather than guessing when the supply is not specified', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: true });
    expect(r.charger?.rechargeOk).toBeNull();
    expect(r.charger?.simultaneousOk).toBeNull();
  });
});

describe('nextStandardSize', () => {
  it('rounds up to a real battery size', () => {
    expect(nextStandardSize(16)).toBe(17);
    expect(nextStandardSize(17)).toBe(17);
    // Was 24 while 18 Ah was missing from the list of standard sizes.
    expect(nextStandardSize(17.01)).toBe(18);
    expect(nextStandardSize(0.5)).toBe(1.2);
  });

  it('returns null beyond the largest listed size', () => {
    expect(nextStandardSize(150)).toBeNull();
  });
});

describe('availableFractionAtRate', () => {
  it('returns tabulated fractions at the tabulated rates', () => {
    expect(availableFractionAtRate(0.05)).toBeCloseTo(1.0, 6);
    expect(availableFractionAtRate(0.5)).toBeCloseTo(0.65, 6);
    expect(availableFractionAtRate(1.0)).toBeCloseTo(0.55, 6);
  });

  it('interpolates between them', () => {
    // Midway between 0.1C (0.90) and 0.2C (0.80).
    expect(availableFractionAtRate(0.15)).toBeCloseTo(0.85, 6);
  });

  it('clamps outside the tabulated range', () => {
    expect(availableFractionAtRate(0.001)).toBeCloseTo(1.0, 6);
    expect(availableFractionAtRate(10)).toBeCloseTo(0.36, 6);
  });

  it('shows the mandated de-rating is conservative on a small system', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: true });
    // 0.8 A from a 17 Ah battery is ~0.047C — essentially the 20 hour rate.
    expect(r.alarmCRate).toBeCloseTo(0.047, 3);
    expect(r.effectiveDerating).toBeLessThan(FC_DEFAULT);
  });
});

describe('appendixFFields', () => {
  it('emits the baseline data items in order with computed values', () => {
    const r = calculateBattery({ ...base, mode: 'design', monitored: true });
    const f = appendixFFields(r);
    expect(f.map((x) => x.item)).toEqual(['14a', '14b', '14c', '14d', '14e', '14f', '14g']);
    expect(f.find((x) => x.item === '14c')?.value).toBe('500 mA');
    expect(f.find((x) => x.item === '14d')?.value).toBe('800 mA');
    expect(f.find((x) => x.item === '14f')?.value).toBe('24 h');
    expect(f.find((x) => x.item === '14g')?.value).toBe('30 min');
    expect(f.find((x) => x.item === '14b')?.value).toContain('17 Ah');
  });
});

describe('standard battery sizes', () => {
  it('is sorted and free of duplicates', () => {
    const arr = [...STANDARD_SLA_AH];
    expect(arr).toEqual([...new Set(arr)].sort((a, b) => a - b));
  });

  it('carries 18 Ah, which several one-loop cabinets top out at', () => {
    expect(STANDARD_SLA_AH).toContain(18);
  });

  it('rounds up to the next real size rather than skipping one', () => {
    // 17.4 Ah used to round to 24 Ah because 18 was missing from the list —
    // a size that then fails the cabinet fit this same calculator checks.
    expect(nextStandardSize(17.4)).toBe(18);
    expect(nextStandardSize(17)).toBe(17);
    expect(nextStandardSize(66)).toBe(75);
  });

  it('has nothing above the largest listed size', () => {
    expect(nextStandardSize(500)).toBeNull();
  });
});
