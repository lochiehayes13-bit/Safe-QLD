import { QUANTITIES, convert, convertAll, formatValue, quantityById } from '@/calc/units';
import {
  autonomyHours, currentForLoad, minimumCableSize, power, solveOhms, voltageDrop,
} from '@/calc/electrical';

const unit = (q: string, u: string) => quantityById(q)!.units.find((x) => x.id === u)!;

describe('pressure conversion', () => {
  it('converts the figures a fire tech actually reads', () => {
    // 700 kPa is 7 bar, about 101.5 psi, about 71.4 m head.
    const kpa = unit('pressure', 'kpa');
    expect(convert(700, kpa, unit('pressure', 'bar'))).toBeCloseTo(7, 6);
    expect(convert(700, kpa, unit('pressure', 'psi'))).toBeCloseTo(101.53, 1);
    expect(convert(700, kpa, unit('pressure', 'mh2o'))).toBeCloseTo(71.38, 1);
  });

  it('round-trips', () => {
    const kpa = unit('pressure', 'kpa');
    for (const id of ['bar', 'psi', 'mh2o', 'pa', 'mpa']) {
      const u = unit('pressure', id);
      expect(convert(convert(850, kpa, u), u, kpa)).toBeCloseTo(850, 6);
    }
  });
});

describe('flow conversion', () => {
  it('converts litres per minute to litres per second', () => {
    // 250 L/min is 4.17 L/s.
    expect(convert(250, unit('flow', 'lpm'), unit('flow', 'lps'))).toBeCloseTo(4.1667, 3);
  });

  it('converts to cubic metres per hour', () => {
    expect(convert(1, unit('flow', 'lps'), unit('flow', 'm3h'))).toBeCloseTo(3.6, 6);
  });

  it('keeps US and imperial gallons distinct', () => {
    const lpm = unit('flow', 'lpm');
    const us = convert(100, unit('flow', 'usgpm'), lpm);
    const imp = convert(100, unit('flow', 'impgpm'), lpm);
    expect(us).toBeCloseTo(378.54, 1);
    expect(imp).toBeCloseTo(454.61, 1);
    expect(us).not.toBeCloseTo(imp, 0);
  });
});

describe('temperature conversion', () => {
  it.each([
    [0, 32],
    [100, 212],
    [-40, -40],
    [68, 154.4],
  ])('converts %i °C to %d °F', (c, f) => {
    expect(convert(c, unit('temperature', 'c'), unit('temperature', 'f'))).toBeCloseTo(f, 4);
  });

  it('converts Celsius to Kelvin', () => {
    expect(convert(0, unit('temperature', 'c'), unit('temperature', 'k'))).toBeCloseTo(273.15, 6);
    expect(convert(25, unit('temperature', 'c'), unit('temperature', 'k'))).toBeCloseTo(298.15, 6);
  });

  it('round-trips through Fahrenheit', () => {
    const c = unit('temperature', 'c');
    const f = unit('temperature', 'f');
    expect(convert(convert(21.5, c, f), f, c)).toBeCloseTo(21.5, 6);
  });
});

describe('convertAll', () => {
  it('returns every unit of the quantity', () => {
    const q = quantityById('pressure')!;
    const all = convertAll(100, unit('pressure', 'kpa'), q);
    expect(all).toHaveLength(q.units.length);
    expect(all.find((x) => x.unit.id === 'bar')?.value).toBeCloseTo(1, 6);
  });
});

describe('formatValue', () => {
  it('scales precision to the size of the number', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(1234.5678)).toBe('1234.6');
    expect(formatValue(1.23456)).toBe('1.235');
    expect(formatValue(0.000012)).toContain('e');
  });

  it('handles non-finite input', () => {
    expect(formatValue(Number.NaN)).toBe('—');
    expect(formatValue(Infinity)).toBe('—');
  });
});

describe('quantity catalogue', () => {
  it('uses unique ids and gives every unit a factor', () => {
    expect(new Set(QUANTITIES.map((q) => q.id)).size).toBe(QUANTITIES.length);
    for (const q of QUANTITIES) {
      expect(new Set(q.units.map((u) => u.id)).size).toBe(q.units.length);
      for (const u of q.units) {
        expect(u.toBase > 0 || !!u.toBaseFn).toBe(true);
      }
    }
  });
});

describe("Ohm's law", () => {
  it('solves from volts and amps', () => {
    const r = solveOhms({ volts: 24, amps: 2 })!;
    expect(r.ohms).toBeCloseTo(12, 6);
    expect(r.watts).toBeCloseTo(48, 6);
  });

  it('solves from amps and resistance', () => {
    const r = solveOhms({ amps: 0.5, ohms: 48 })!;
    expect(r.volts).toBeCloseTo(24, 6);
    expect(r.watts).toBeCloseTo(12, 6);
  });

  it('solves from volts and watts', () => {
    const r = solveOhms({ volts: 24, watts: 48 })!;
    expect(r.amps).toBeCloseTo(2, 6);
    expect(r.ohms).toBeCloseTo(12, 6);
  });

  it('solves from resistance and watts', () => {
    const r = solveOhms({ ohms: 12, watts: 48 })!;
    expect(r.volts).toBeCloseTo(24, 6);
    expect(r.amps).toBeCloseTo(2, 6);
  });

  it('refuses to guess from one value', () => {
    expect(solveOhms({ volts: 24 })).toBeNull();
    expect(solveOhms({})).toBeNull();
  });

  it('refuses a division by zero rather than returning infinity', () => {
    expect(solveOhms({ volts: 24, ohms: 0 })).toBeNull();
    expect(solveOhms({ watts: 10, amps: 0 })).toBeNull();
  });
});

describe('voltage drop', () => {
  it('accounts for current travelling out and back on a DC run', () => {
    // 100 m of 1.5 mm² copper at 0.5 A: R = 0.0214 * 100 * 2 / 1.5 = 2.853 Ω
    const r = voltageDrop({ sourceVolts: 24, amps: 0.5, lengthM: 100, areaMm2: 1.5 })!;
    expect(r.resistanceOhms).toBeCloseTo(2.8533, 3);
    expect(r.dropVolts).toBeCloseTo(1.427, 2);
    expect(r.voltsAtLoad).toBeCloseTo(22.57, 1);
    expect(r.dropPercent).toBeCloseTo(5.94, 1);
  });

  it('says whether the device still sees enough volts', () => {
    const ok = voltageDrop({ sourceVolts: 24, amps: 0.5, lengthM: 100, areaMm2: 1.5, minimumVolts: 18 })!;
    expect(ok.withinLimit).toBe(true);

    const notOk = voltageDrop({ sourceVolts: 24, amps: 2, lengthM: 300, areaMm2: 1.0, minimumVolts: 18 })!;
    expect(notOk.withinLimit).toBe(false);
  });

  it('reports the longest run that still works', () => {
    const r = voltageDrop({ sourceVolts: 24, amps: 0.5, lengthM: 100, areaMm2: 1.5, minimumVolts: 18 })!;
    // 6 V allowable / (0.0214 * 2 * 0.5 / 1.5) = 420.6 m
    expect(r.maxLengthM).toBeCloseTo(420.6, 0);
  });

  it('uses the root-three relationship on three phase', () => {
    const single = voltageDrop({ sourceVolts: 400, amps: 10, lengthM: 50, areaMm2: 4, circuit: 'single-phase' })!;
    const three = voltageDrop({ sourceVolts: 400, amps: 10, lengthM: 50, areaMm2: 4, circuit: 'three-phase' })!;
    expect(three.dropVolts / single.dropVolts).toBeCloseTo(Math.sqrt(3) / 2, 4);
  });

  it('drops more on aluminium than copper', () => {
    const cu = voltageDrop({ sourceVolts: 24, amps: 1, lengthM: 100, areaMm2: 2.5, conductor: 'copper' })!;
    const al = voltageDrop({ sourceVolts: 24, amps: 1, lengthM: 100, areaMm2: 2.5, conductor: 'aluminium' })!;
    expect(al.dropVolts).toBeGreaterThan(cu.dropVolts);
  });

  it('rejects nonsense input rather than returning zero', () => {
    expect(voltageDrop({ sourceVolts: 24, amps: 1, lengthM: 100, areaMm2: 0 })).toBeNull();
    expect(voltageDrop({ sourceVolts: 24, amps: 1, lengthM: -5, areaMm2: 1.5 })).toBeNull();
  });
});

describe('minimum cable size', () => {
  it('picks the smallest standard size that works', () => {
    const size = minimumCableSize({ sourceVolts: 24, amps: 2, lengthM: 200, minimumVolts: 18 });
    expect(size).not.toBeNull();
    const check = voltageDrop({ sourceVolts: 24, amps: 2, lengthM: 200, areaMm2: size!, minimumVolts: 18 })!;
    expect(check.withinLimit).toBe(true);
  });

  it('returns null when no listed size will do it', () => {
    expect(minimumCableSize({ sourceVolts: 24, amps: 30, lengthM: 5000, minimumVolts: 22 })).toBeNull();
  });
});

describe('power', () => {
  it('computes single phase', () => {
    const r = power({ volts: 240, amps: 10, phase: 'single' })!;
    expect(r.va).toBeCloseTo(2400, 1);
    expect(r.kw).toBeCloseTo(2.4, 3);
  });

  it('applies power factor', () => {
    const r = power({ volts: 240, amps: 10, phase: 'single', powerFactor: 0.8 })!;
    expect(r.watts).toBeCloseTo(1920, 1);
    expect(r.va).toBeCloseTo(2400, 1);
  });

  it('computes three phase with the root-three factor', () => {
    const r = power({ volts: 400, amps: 10, phase: 'three' })!;
    expect(r.va).toBeCloseTo(Math.sqrt(3) * 400 * 10, 0);
  });

  it('rejects an impossible power factor', () => {
    expect(power({ volts: 240, amps: 10, phase: 'single', powerFactor: 1.4 })).toBeNull();
  });
});

describe('currentForLoad', () => {
  it('derives current from a load', () => {
    expect(currentForLoad(2400, 240, 'single')).toBeCloseTo(10, 3);
    expect(currentForLoad(6928, 400, 'three')).toBeCloseTo(10, 1);
  });

  it('refuses to divide by zero volts', () => {
    expect(currentForLoad(2400, 0, 'single')).toBeNull();
  });
});

describe('autonomyHours', () => {
  it('gives the plain runtime', () => {
    expect(autonomyHours(17, 0.5)).toBeCloseTo(34, 2);
  });

  it('refuses a zero or negative load', () => {
    expect(autonomyHours(17, 0)).toBeNull();
    expect(autonomyHours(0, 1)).toBeNull();
  });
});
