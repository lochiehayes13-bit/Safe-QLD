import { filledFields, solveFromLatest, touchField, type OhmsField } from '@/calc/ohmsEntry';

const blank: Record<OhmsField, string> = { volts: '', amps: '', ohms: '', watts: '' };

describe('the Ohm\'s law fields', () => {
  it('works nothing out until two are filled', () => {
    expect(solveFromLatest(blank, [])).toBeNull();
    expect(solveFromLatest({ ...blank, volts: '24' }, ['volts'])).toBeNull();
  });

  it('solves from any two the technician filled', () => {
    const r = solveFromLatest({ ...blank, ohms: '48', watts: '12' }, ['watts', 'ohms'])!;
    expect(r.volts).toBeCloseTo(24, 6);
    expect(r.amps).toBeCloseTo(0.5, 6);
  });

  it('takes decimals as typed', () => {
    const r = solveFromLatest({ ...blank, volts: '27.6', amps: '0.25' }, ['amps', 'volts'])!;
    expect(r.ohms).toBeCloseTo(110.4, 6);
  });

  it('uses the two most recently edited when more than two are filled', () => {
    /*
     * Volts and amps typed first, then resistance. The resistance is the new
     * figure, so it pairs with amps and the stale volts are left out.
     */
    let order: OhmsField[] = [];
    for (const f of ['volts', 'amps', 'ohms'] as const) order = touchField(order, f);
    const texts = { ...blank, volts: '24', amps: '0.5', ohms: '100' };
    expect(filledFields(texts, order).slice(0, 2)).toEqual(['ohms', 'amps']);
    const r = solveFromLatest(texts, order)!;
    expect(r.volts).toBeCloseTo(50, 6);
    expect(r.derivedFrom).toBe('amps and resistance');
  });

  it('skips a field that was edited last but cleared', () => {
    let order: OhmsField[] = [];
    for (const f of ['volts', 'amps', 'watts'] as const) order = touchField(order, f);
    const r = solveFromLatest({ ...blank, volts: '24', amps: '2', watts: '' }, order)!;
    expect(r.watts).toBeCloseTo(48, 6);
  });

  it('moves a re-edited field to the front without repeating it', () => {
    expect(touchField(['amps', 'volts'], 'volts')).toEqual(['volts', 'amps']);
  });
});
