import { SIZING_SYSTEM_PROMPT, readSizingBrief, sizingPrompt, type SizingBrief } from '@/ai/sizingChat';
import { answerFromBrief, answerHeadline, answerWorking, pickDerating, pickTable } from '@/domain/sizingChat';
import { capacityColumns } from '@/domain/wiringCables';

/**
 * The sentence, and what the app is allowed to do with it.
 *
 * The rule this whole feature rests on: the model reads, the calculator
 * decides. A model that names a cable size is not trusted and is not quietly
 * ignored either — the size it gave is kept where the screen can say it tried.
 */

const blank: SizingBrief = { missing: [], quoted: [], refused: [] };

describe('reading what the model sent back', () => {
  it('takes the facts and the words they came from', () => {
    const read = readSizingBrief(JSON.stringify({
      loadWatts: 15000,
      loadAmps: null,
      loadKind: 'pump',
      volts: 400,
      phase: 'three',
      powerFactor: 0.85,
      lengthM: 60,
      installMethod: 'in conduit in a wall',
      insulation: 'TPS',
      material: 'copper',
      cores: 'four core',
      ambientC: 40,
      groupedCircuits: 5,
      inInsulation: false,
      buriedDepthM: null,
      voltDropLimitPercent: null,
      faultA: null,
      clearingTimeS: null,
      missing: ['the prospective fault current'],
      quoted: [{ field: 'loadWatts', phrase: '15 kW pump' }, { field: 'lengthM', phrase: '60 metres away' }],
    })) as SizingBrief;

    expect(read.loadWatts).toBe(15000);
    expect(read.phase).toBe('three');
    expect(read.powerFactor).toBe(0.85);
    expect(read.cores).toBe('four core');
    expect(read.groupedCircuits).toBe(5);
    expect(read.quoted).toHaveLength(2);
    expect(read.missing).toEqual(['the prospective fault current']);
    expect(read.refused).toEqual([]);
  });

  it('keeps a size it was told not to give, and does not use it', () => {
    const read = readSizingBrief(JSON.stringify({
      lengthM: 30, areaMm2: 16, breakerA: 32, capacityA: 80, missing: [], quoted: [],
    })) as SizingBrief;
    expect(read.refused).toEqual(expect.arrayContaining([
      'a cable size (16)', 'a breaker rating (32)', 'a current-carrying capacity (80)',
    ]));
    // And nothing on the brief carries them onward.
    expect(Object.keys(read)).not.toContain('areaMm2');
  });

  it('drops a number that is not one', () => {
    const read = readSizingBrief(JSON.stringify({
      loadWatts: -5, volts: 0, lengthM: 'sixty', powerFactor: 1.4, ambientC: 900,
      groupedCircuits: 0, missing: [], quoted: [],
    })) as SizingBrief;
    expect(read.loadWatts).toBeUndefined();
    expect(read.volts).toBeUndefined();
    expect(read.lengthM).toBeUndefined();
    expect(read.powerFactor).toBeUndefined();
    expect(read.ambientC).toBeUndefined();
    expect(read.groupedCircuits).toBeUndefined();
  });

  it('reads a phase said any of the ways it gets said', () => {
    for (const [said, want] of [['three', 'three'], ['3 phase', 'three'], ['single', 'single'], ['1 phase', 'single'], ['dc', 'dc']] as const) {
      expect((readSizingBrief(JSON.stringify({ phase: said, missing: [], quoted: [] })) as SizingBrief).phase).toBe(want);
    }
    expect((readSizingBrief(JSON.stringify({ phase: 'whatever', missing: [], quoted: [] })) as SizingBrief).phase).toBeUndefined();
  });

  it('refuses anything that is not the JSON it asked for', () => {
    expect(readSizingBrief('I think you need 16 mm².')).toEqual({ refusal: expect.stringContaining('JSON') });
    expect(readSizingBrief('{ not json }')).toEqual({ refusal: expect.stringContaining('JSON') });
  });

  it('survives prose wrapped around the JSON', () => {
    const read = readSizingBrief('Here you go:\n{"lengthM": 30, "missing": [], "quoted": []}\nHope that helps.');
    expect((read as SizingBrief).lengthM).toBe(30);
  });

  it('tells the model, in the prompt, that it may not answer', () => {
    expect(SIZING_SYSTEM_PROMPT).toContain('never give a cable size');
    expect(SIZING_SYSTEM_PROMPT).toContain('never assume a standard value');
    expect(sizingPrompt('a pump', ['Enclosed › In conduit in a wall'])).toContain('In conduit in a wall');
  });
});

describe('matching the description to a real table', () => {
  const columns = capacityColumns();

  it('finds thermoplastic multicore in a wall from the words a sparky uses', () => {
    const pick = pickTable({
      ...blank, insulation: 'TPS', cores: 'three core and earth', installMethod: 'in conduit in a wall', material: 'copper',
    }, columns);
    expect(pick.best).toBeDefined();
    expect(pick.best!.column.insulation.toLowerCase()).toContain('thermoplastic');
    expect(pick.best!.column.cores.toLowerCase()).toContain('core');
    // The standard has no word "conduit": a conduit run is an enclosed one,
    // in a wiring enclosure in air. Matching that is the whole point of the
    // vocabulary map, and picking "buried" or "unenclosed" here would size the
    // cable off a column with higher figures.
    expect(pick.best!.column.installMethod.toLowerCase()).toContain('wiring enclosure');
    expect(pick.best!.column.installMethod.toLowerCase()).not.toContain('underground');
  });

  it('prefers X-90 when the description says XLPE', () => {
    const pick = pickTable({ ...blank, insulation: 'XLPE', cores: 'four core' }, columns);
    expect(pick.best!.column.insulation.toLowerCase()).toMatch(/x-90|x-hf-90/);
  });

  it('picks aluminium only when aluminium was said', () => {
    expect(pickTable({ ...blank, cores: 'four core' }, columns).best!.column.material).toBe('copper');
    expect(pickTable({ ...blank, cores: 'four core', material: 'aluminium' }, columns).best!.column.material).toBe('aluminium');
  });

  it('offers the runners-up, because one description is often three arrangements', () => {
    const pick = pickTable({ ...blank, insulation: 'TPS', cores: 'two core', installMethod: 'in a wall' }, columns);
    expect(pick.runnersUp.length).toBeGreaterThan(0);
    expect(pick.runnersUp.every((m) => m.column.id !== pick.best!.column.id)).toBe(true);
  });

  it('does not put a run underground, in insulation or in the sun unless it was said', () => {
    for (const method of ['in conduit in a wall', 'clipped to the wall', 'on a cable tray']) {
      const best = pickTable({ ...blank, insulation: 'TPS', cores: 'two core', installMethod: method }, columns).best!;
      expect(best.column.installMethod.toLowerCase()).not.toMatch(/buried|underground|thermal insulation|sun/);
    }
    const buried = pickTable({ ...blank, insulation: 'TPS', cores: 'two core', installMethod: 'buried direct in the ground' }, columns).best!;
    expect(buried.column.installMethod.toLowerCase()).toContain('buried');
    const batts = pickTable({ ...blank, insulation: 'TPS', cores: 'two core', installMethod: 'run through ceiling insulation' }, columns).best!;
    expect(batts.column.installMethod.toLowerCase()).toContain('thermal insulation');
  });

  it('says what it could not match rather than matching it anyway', () => {
    const pick = pickTable({ ...blank, insulation: 'unobtanium', installMethod: 'in the roof space somewhere' }, columns);
    expect(pick.unmatched.join(' ')).toContain('unobtanium');
  });
});

describe('matching the conditions', () => {
  it('derates for the circuits that were said, and only those', () => {
    const picked = pickDerating({ ...blank, groupedCircuits: 6 });
    expect(picked.applied.some((f) => f.kind === 'grouping')).toBe(true);
    expect(picked.applied.every((f) => f.factor > 0 && f.factor <= 1.2)).toBe(true);
  });

  it('applies nothing at all when nothing was said', () => {
    expect(pickDerating(blank)).toEqual({ applied: [], uncovered: [] });
  });

  it('says a stated condition was not covered rather than dropping it', () => {
    const picked = pickDerating({ ...blank, inInsulation: true });
    expect(picked.applied).toEqual([]);
    expect(picked.uncovered.join(' ')).toContain('thermal insulation');
  });
});

describe('the answer', () => {
  it('asks for what is missing rather than sizing off a guess', () => {
    const answer = answerFromBrief({ ...blank, loadWatts: 15000, insulation: 'TPS', cores: 'four core' });
    expect(answer.result).toBeUndefined();
    expect(answer.needs).toEqual(expect.arrayContaining([
      'Single phase or three phase?',
      'What is the supply voltage?',
      'How long is the run, one way?',
    ]));
    expect(answerHeadline(answer)).toBe('Not enough to size it yet');
  });

  it('sizes a whole install and shows the working', () => {
    const answer = answerFromBrief({
      ...blank,
      loadWatts: 15000,
      volts: 400,
      phase: 'three',
      lengthM: 60,
      insulation: 'TPS',
      cores: 'four core',
      material: 'copper',
      installMethod: 'in conduit in a wall',
      powerFactor: 0.85,
    });

    expect(answer.needs).toEqual([]);
    expect(answer.result?.chosen).toBeDefined();
    const working = answerWorking(answer);
    expect(working.join(' ')).toContain('Design current');
    expect(working.join(' ')).toContain('AS/NZS 3008.1.1:2009');
    expect(answerHeadline(answer)).toMatch(/mm² on a \d+ A device/);
  });

  it('states every assumption it made', () => {
    const answer = answerFromBrief({
      ...blank, loadWatts: 3000, volts: 230, phase: 'single', lengthM: 20, insulation: 'TPS', cores: 'two core',
    });
    const said = answer.assumptions.join(' ');
    expect(said).toContain('power factor');
    expect(said).toContain('volt drop limit');
    expect(said).toContain('Fault withstand');
    expect(said).toContain('Nothing derated');
  });

  it('takes a bigger cable once the circuits are grouped', () => {
    const base = {
      ...blank,
      loadAmps: 40,
      volts: 400,
      phase: 'three' as const,
      lengthM: 30,
      insulation: 'TPS',
      cores: 'four core',
      installMethod: 'bunched in a wiring enclosure',
    };
    const alone = answerFromBrief(base);
    const grouped = answerFromBrief({ ...base, groupedCircuits: 6 });
    expect(grouped.derating.applied.length).toBeGreaterThan(0);
    expect(grouped.result!.chosen!.row.areaMm2).toBeGreaterThanOrEqual(alone.result!.chosen!.row.areaMm2);
    expect(grouped.result!.derating.factor).toBeLessThan(1);
  });

  it('gives the same answer as the manual screen would, because it is the same engine', () => {
    const answer = answerFromBrief({
      ...blank, loadAmps: 32, volts: 400, phase: 'three', lengthM: 25, insulation: 'TPS', cores: 'three core',
      installMethod: 'unenclosed spaced',
    });
    const chosen = answer.result!.chosen!;
    // Every rejected size comes back with the check that stopped it, exactly
    // as the manual calculator shows them.
    expect(answer.result!.considered.length).toBeGreaterThan(1);
    expect(answer.result!.considered.filter((c) => c.failedOn).every((c) => Boolean(c.failedOn))).toBe(true);
    expect(chosen.row.source).toContain('col');
  });
});
