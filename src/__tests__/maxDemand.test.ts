import {
  assessDemand, checkDemandDraft, rebalanceSuggestion, type DemandDraft, type DemandRow,
} from '@/calc/maxDemand';

/**
 * Maximum demand.
 *
 * The per-load allowances come from the designer's own copy of the Wiring
 * Rules and are not in this app. What is here is the arithmetic around them,
 * and the arithmetic has one failure that matters more than all the others:
 * dividing a three-phase total by three.
 *
 * A supply is sized on its worst phase. An installation with everything on one
 * of them has a maximum demand three times what the average suggests, and the
 * mistake runs in the direction that trips a main on the first hot afternoon.
 */

const row = (over: Partial<DemandRow> & { id: string }): DemandRow => ({
  label: 'Load', connectedA: 10, basis: 'fraction', value: 1, phase: 'a', ...over,
});

describe('assessing a load', () => {
  it('takes a fraction of what is connected', () => {
    const r = assessDemand([row({ id: '1', connectedA: 40, basis: 'fraction', value: 0.5 })]);
    expect(r.rows[0]!.demandA).toBe(20);
    expect(r.connectedA).toBe(40);
    expect(r.diversity).toBe(0.5);
  });

  it('takes a fixed figure outright where the assessment gives one', () => {
    // Both forms appear in the table and mixing them up is easy.
    const r = assessDemand([row({ id: '1', connectedA: 40, basis: 'fixed', value: 15 })]);
    expect(r.rows[0]!.demandA).toBe(15);
  });

  it('ignores an assessment that would demand more than is connected, and says so', () => {
    const r = assessDemand([row({ id: '1', connectedA: 40, basis: 'fraction', value: 1.5 })]);
    expect(r.rows[0]!.ignored).toContain('over 1');
    expect(r.maximumDemandA).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });

  it('ignores a load that is not a number rather than clamping it to one', () => {
    // A clamped figure looks like an answer, and this answer sizes the supply.
    const r = assessDemand([row({ id: '1', connectedA: Number.NaN }), row({ id: '2', connectedA: -5 })]);
    expect(r.rows.every((x) => x.ignored)).toBe(true);
    expect(r.warnings).toHaveLength(2);
  });
});

describe('per phase, not divided by three', () => {
  it('sizes the main on the heaviest phase', () => {
    const r = assessDemand([
      row({ id: '1', connectedA: 60, phase: 'a' }),
      row({ id: '2', connectedA: 20, phase: 'b' }),
      row({ id: '3', connectedA: 10, phase: 'c' }),
    ]);
    expect(r.perPhaseA).toEqual({ a: 60, b: 20, c: 10 });
    // Not 30, which is what averaging the 90 A connected would have given.
    expect(r.maximumDemandA).toBe(60);
    expect(r.worstPhase).toBe('a');
  });

  it('puts a balanced three-phase load on every phase in full', () => {
    // Its per-phase current is the whole figure, not a third of it — dividing
    // here would understate all three.
    const r = assessDemand([row({ id: '1', connectedA: 30, phase: 'all' })]);
    expect(r.perPhaseA).toEqual({ a: 30, b: 30, c: 30 });
    expect(r.maximumDemandA).toBe(30);
  });

  it('reports how far out of balance the board is', () => {
    const r = assessDemand([
      row({ id: '1', connectedA: 40, phase: 'a' }),
      row({ id: '2', connectedA: 40, phase: 'b' }),
      row({ id: '3', connectedA: 40, phase: 'c' }),
    ]);
    expect(r.imbalancePercent).toBe(0);

    const skewed = assessDemand([row({ id: '1', connectedA: 40, phase: 'a' })]);
    expect(skewed.imbalancePercent).toBe(100);
  });

  it('is zero everywhere with nothing on the board, rather than dividing by nothing', () => {
    const r = assessDemand([]);
    expect(r).toMatchObject({ maximumDemandA: 0, connectedA: 0, diversity: 0, imbalancePercent: 0 });
  });
});

describe('what to move', () => {
  it('names the heaviest load on the worst phase and where it should go', () => {
    const r = assessDemand([
      row({ id: '1', label: 'Range', connectedA: 30, phase: 'a' }),
      row({ id: '2', label: 'Lighting', connectedA: 10, phase: 'a' }),
      row({ id: '3', label: 'Sockets', connectedA: 5, phase: 'b' }),
    ]);
    const move = rebalanceSuggestion(r)!;
    expect(move.row.label).toBe('Range');
    expect(move.to).toBe('c');
    expect(move.newMaximumA).toBeLessThan(r.maximumDemandA);
  });

  it('says nothing where moving something would only make a different phase the worst', () => {
    const r = assessDemand([
      row({ id: '1', connectedA: 30, phase: 'a' }),
      row({ id: '2', connectedA: 29, phase: 'b' }),
      row({ id: '3', connectedA: 29, phase: 'c' }),
    ]);
    expect(rebalanceSuggestion(r)).toBeUndefined();
  });

  it('says nothing about a balanced board, or an empty one', () => {
    const balanced = assessDemand([
      row({ id: '1', connectedA: 20, phase: 'a' }),
      row({ id: '2', connectedA: 20, phase: 'b' }),
      row({ id: '3', connectedA: 20, phase: 'c' }),
    ]);
    expect(rebalanceSuggestion(balanced)).toBeUndefined();
    expect(rebalanceSuggestion(assessDemand([]))).toBeUndefined();
  });

  it('says nothing where the only thing on the worst phase is a three-phase load', () => {
    // Moving it is not a thing anybody can do with a screwdriver.
    const r = assessDemand([
      row({ id: '1', connectedA: 30, phase: 'all' }),
      row({ id: '2', connectedA: 5, phase: 'a' }),
    ]);
    expect(rebalanceSuggestion(r)?.row.id).not.toBe('1');
  });
});

describe('the add form', () => {
  const draft = (over: Partial<DemandDraft> = {}): DemandDraft => ({
    label: 'Lighting', connectedText: '16', wattsText: '', voltsText: '230',
    basis: 'fraction', valueText: '0.5', phase: 'a', source: '', ...over,
  });

  it('builds a row from what was typed, decimals included', () => {
    const c = checkDemandDraft(draft({ connectedText: '12.5', valueText: '0.75', source: ' AS/NZS 3000 Table C1 ' }));
    expect(c.row).toEqual({
      label: 'Lighting', connectedA: 12.5, basis: 'fraction', value: 0.75, phase: 'a', source: 'AS/NZS 3000 Table C1',
    });
  });

  it('works the amps from watts when watts are entered', () => {
    const c = checkDemandDraft(draft({ wattsText: '2300', connectedText: '' }));
    expect(c.connectedA).toBeCloseTo(10, 6);
  });

  it('works a three-phase load at line volts', () => {
    // 10 kW across three phases at 400 V is about 14.4 A a phase.
    const c = checkDemandDraft(draft({ wattsText: '10000', voltsText: '400', phase: 'all' }));
    expect(c.connectedA).toBeCloseTo(14.43, 1);
  });

  it('refuses a fraction over 1 at the field rather than adding a row that is not counted', () => {
    const c = checkDemandDraft(draft({ valueText: '1.5' }));
    expect(c.row).toBeUndefined();
    expect(c.valueProblem).toBe('Enter 0 to 1.');
  });

  it('allows a fixed allowance over 1 amp', () => {
    const c = checkDemandDraft(draft({ basis: 'fixed', valueText: '15' }));
    expect(c.row?.value).toBe(15);
    expect(c.valueProblem).toBeUndefined();
  });

  it('adds nothing until the load, the amps and the allowance are all there', () => {
    expect(checkDemandDraft(draft({ label: '  ' })).row).toBeUndefined();
    expect(checkDemandDraft(draft({ connectedText: '' })).row).toBeUndefined();
    expect(checkDemandDraft(draft({ connectedText: '0' })).row).toBeUndefined();
    expect(checkDemandDraft(draft({ basis: 'fixed', valueText: '' })).row).toBeUndefined();
    expect(checkDemandDraft(draft({ valueText: '-0.5' })).valueProblem).toBe("Can't be negative.");
  });
});
