import { BLANK_VOLT_DROP, anyTyped, readVoltDrop, type VoltDropFields } from '@/calc/voltdropEntry';

const CHOICES = { areaMm2: 1.5, conductor: 'copper', circuit: 'dc' } as const;

const fields = (patch: Partial<VoltDropFields>): VoltDropFields => ({ ...BLANK_VOLT_DROP, ...patch });

describe('volt drop entry', () => {
  it('opens blank with nothing worked out', () => {
    expect(readVoltDrop(BLANK_VOLT_DROP, CHOICES)).toEqual({ kind: 'blank' });
    expect(anyTyped(BLANK_VOLT_DROP)).toBe(false);
  });

  it('works nothing out until supply, load and length are all typed', () => {
    expect(readVoltDrop(fields({ supply: '24', load: '0.5' }), CHOICES).kind).toBe('blank');
    expect(readVoltDrop(fields({ supply: '24', length: '100' }), CHOICES).kind).toBe('blank');
    expect(readVoltDrop(fields({ load: '0.5', length: '100', minimum: '18' }), CHOICES).kind).toBe('blank');
    // Half typed is not a figure yet.
    expect(readVoltDrop(fields({ supply: '24', load: '.', length: '100' }), CHOICES).kind).toBe('blank');
  });

  it('gives the volts at the device but no verdict without a device minimum', () => {
    const r = readVoltDrop(fields({ supply: '24', load: '0.5', length: '100' }), CHOICES);
    expect(r.kind).toBe('result');
    if (r.kind !== 'result') return;
    expect(r.result.voltsAtLoad).toBeCloseTo(24 - 0.5 * ((0.0214 * 100 * 2) / 1.5), 2);
    expect(r.result.withinLimit).toBeNull();
    expect(r.minimumVolts).toBeUndefined();
    expect(r.smallestMm2).toBeUndefined();
  });

  it('gives a verdict and the smallest size once the minimum is typed', () => {
    const ok = readVoltDrop(fields({ supply: '24', load: '0.5', length: '100', minimum: '18' }), CHOICES);
    expect(ok.kind).toBe('result');
    if (ok.kind !== 'result') return;
    expect(ok.result.withinLimit).toBe(true);
    expect(ok.minimumVolts).toBe(18);
    expect(ok.smallestMm2).toBe(0.5);

    const short = readVoltDrop(fields({ supply: '24', load: '2', length: '300', minimum: '18' }), { ...CHOICES, areaMm2: 1 });
    expect(short.kind).toBe('result');
    if (short.kind !== 'result') return;
    expect(short.result.withinLimit).toBe(false);
    expect(short.smallestMm2).toBeGreaterThan(1);
  });

  it('says when no listed size will do it', () => {
    const r = readVoltDrop(fields({ supply: '24', load: '50', length: '2000', minimum: '23.9' }), CHOICES);
    expect(r.kind).toBe('result');
    if (r.kind !== 'result') return;
    expect(r.smallestMm2).toBeNull();
  });

  it('asks for a check rather than working out zero or impossible figures', () => {
    expect(readVoltDrop(fields({ supply: '0', load: '0.5', length: '100' }), CHOICES).kind).toBe('check');
    expect(readVoltDrop(fields({ supply: '24', load: '0', length: '100' }), CHOICES).kind).toBe('check');
    expect(readVoltDrop(fields({ supply: '24', load: '0.5', length: '0' }), CHOICES).kind).toBe('check');
    expect(readVoltDrop(fields({ supply: '24', load: '0.5', length: '100', minimum: '24' }), CHOICES).kind).toBe('check');
    expect(readVoltDrop(fields({ supply: '24', load: '0.5', length: '100', minimum: '0' }), CHOICES).kind).toBe('check');
  });

  it('knows when something has been typed, for the Clear button', () => {
    expect(anyTyped(fields({ length: '5' }))).toBe(true);
    expect(anyTyped(fields({ minimum: '  ' }))).toBe(false);
  });
});
