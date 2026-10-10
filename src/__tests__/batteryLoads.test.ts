import {
  appendixFFields, calculateBattery, FC_DEFAULT, L_DESIGN, SUPPLY_HEAVY_LOAD, standbySupplyLoad,
} from '@/calc/battery';
import {
  draftFromFigures, figureText, hasLoadFigures, loadFromDraft, loadsFromDrafts, parseFigure,
  type LoadDraft,
} from '@/calc/batteryLoads';

describe('a load row keeps what was typed', () => {
  it('reads a decimal mid-typing without losing the point', () => {
    // "0." used to round-trip through a number and come back as "0".
    expect(parseFigure('0.')).toBe(0);
    expect(parseFigure('0.05')).toBeCloseTo(0.05, 9);
    expect(parseFigure('.33')).toBeCloseTo(0.33, 9);
    expect(parseFigure('1,5')).toBeCloseTo(1.5, 9);
    expect(parseFigure('-2')).toBe(-2);
  });

  it('treats blank and nonsense as not given, not as zero', () => {
    expect(parseFigure('')).toBeUndefined();
    expect(parseFigure('  ')).toBeUndefined();
    expect(parseFigure('abc')).toBeUndefined();
    expect(parseFigure('1.2.3')).toBeUndefined();
    expect(parseFigure(undefined)).toBeUndefined();
  });

  it('sizes a 0.05 mA detector line, which could not be typed before', () => {
    const draft: LoadDraft = { id: 'd', label: 'Detectors', quantity: '200', standbyMa: '0.05', alarmMa: '0.05' };
    const line = loadFromDraft(draft);
    expect(line.standbyMa).toBeCloseTo(0.05, 9);
    expect(line.quantity).toBe(200);
  });

  it('counts a blank box as nothing drawn, and never a negative current', () => {
    const line = loadFromDraft({ id: 'x', label: '', quantity: '', standbyMa: '-5', alarmMa: '' });
    expect(line).toMatchObject({ quantity: 0, standbyMa: 0, alarmMa: 0 });
  });

  it('writes a figure back without float noise', () => {
    expect(figureText(291.66666666)).toBe('291.6667');
    expect(figureText(0.33)).toBe('0.33');
    expect(figureText(undefined)).toBe('');
    expect(draftFromFigures('a', { label: 'Panel', standbyMa: 150 }).quantity).toBe('1');
  });
});

describe('the schedule opens empty and shows no battery until loads are in', () => {
  it('has nothing to size with no lines, or with lines still blank', () => {
    expect(hasLoadFigures([])).toBe(false);
    expect(hasLoadFigures(loadsFromDrafts([draftFromFigures('a', { label: 'ASE', isAse: true })]))).toBe(false);
    expect(hasLoadFigures(loadsFromDrafts([
      { id: 'b', label: 'Door holders', quantity: '0', standbyMa: '55', alarmMa: '0' },
    ]))).toBe(false);
  });

  it('has something to size once a line carries a quantity and a current', () => {
    expect(hasLoadFigures(loadsFromDrafts([
      { id: 'p', label: 'Panel', quantity: '1', standbyMa: '150', alarmMa: '' },
    ]))).toBe(true);
  });
});

describe('the supply in standby', () => {
  const base = { mode: 'design' as const, monitored: true, alarmHours: 0.5, capacityDerating: FC_DEFAULT, deteriorationFactor: L_DESIGN };
  const loads = [
    { id: 'v', label: 'VESDA', quantity: 2, standbyMa: 612.5, alarmMa: 645.83 },
    { id: 'a', label: 'ASE', quantity: 0, standbyMa: 0, alarmMa: 0, isAse: true },
  ];

  it('errors when the standby draw is over the supply rating', () => {
    const r = calculateBattery({ ...base, loads, psuOutputA: 0.5 });
    expect(r.issues.some((i) => i.level === 'error' && i.title === 'Supply overloaded in standby')).toBe(true);
  });

  it('warns above the heavy-load share, and stays quiet below it', () => {
    const heavy = calculateBattery({ ...base, loads, psuOutputA: 1.3 });
    expect(standbySupplyLoad(heavy.quiescentA, 1.3)).toBeGreaterThan(SUPPLY_HEAVY_LOAD);
    expect(heavy.issues.some((i) => i.title === 'Supply heavily loaded in standby')).toBe(true);
    const fine = calculateBattery({ ...base, loads, psuOutputA: 3 });
    expect(fine.issues.some((i) => i.title.startsWith('Supply'))).toBe(false);
  });

  it('says nothing without a supply rating', () => {
    expect(standbySupplyLoad(1, undefined)).toBeUndefined();
    expect(standbySupplyLoad(1, 0)).toBeUndefined();
  });
});

describe('baseline data', () => {
  it('gives mains as 230 V', () => {
    const r = calculateBattery({
      mode: 'design', monitored: true, alarmHours: 0.5, capacityDerating: FC_DEFAULT, deteriorationFactor: L_DESIGN,
      loads: [{ id: 'p', label: 'Panel', quantity: 1, standbyMa: 150, alarmMa: 250, isAse: true }],
    });
    expect(appendixFFields(r).find((f) => f.item === '14a')?.value).toBe('230 V a.c.');
  });
});
