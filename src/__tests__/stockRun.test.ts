import {
  DEFAULT_STOCK_DAYS, MAX_STOCK_DAYS, buildStockRun, stockRunDays,
  type StockOnHand, type StockRunBlock, type StockRunInput, type StockRunJob,
} from '@/domain/stockRun';
import type { Defect } from '@/domain/types';

/** The first line, insisted upon: a test that silently got none proves nothing. */
function firstLine(run: ReturnType<typeof buildStockRun>) {
  const line = run.lines[0];
  if (!line) throw new Error('the list came back empty, so there was nothing to assert about');
  return line;
}

/** The first building, for the same reason. */
function firstSite(run: ReturnType<typeof buildStockRun>) {
  const site = run.sites[0];
  if (!site) throw new Error('no building came back in the window');
  return site;
}

/**
 * The list of what to load before the next few days.
 *
 * Every test here is a way the list could be wrong while looking right, which
 * is the only interesting kind of wrong for a thing somebody loads a van from.
 * A list that is too small sends a technician back across town; one that is too
 * big fills the van with stock the office has paid for and nobody needs; one
 * that quietly covers fewer days than it was asked for does both and says
 * neither.
 */

/*
 * A real code out of the seeded library, not an invented one: the point of the
 * whole feature is that the parts come from the library rather than from
 * somebody's memory, so a mocked code would test the plumbing and skip the
 * claim. DET-DET-001 is a detector that failed to alarm — one replacement head
 * plus labour, so it exercises the material/labour split as well.
 */
const CODE = 'DET-DET-001';

function defect(id: string, siteId: string, over: Partial<Defect> = {}): Defect {
  return {
    id,
    siteId,
    location: 'Level 1',
    description: 'Detector failed to alarm on test',
    severity: 'non-critical',
    status: 'open',
    raisedAt: '2026-09-01T00:00:00.000Z',
    defectCode: CODE,
    ...over,
  } as Defect;
}

function input(over: Partial<StockRunInput> = {}): StockRunInput {
  return {
    today: '2026-09-14',
    days: 7,
    scheduleCoversTo: '2026-10-05',
    blocks: [],
    jobs: new Map<string, StockRunJob>(),
    defectsBySite: new Map<string, Defect[]>(),
    onHand: [],
    ...over,
  };
}

/** A code the seeded library really carries, so the parts side is not a mock. */
describe('the coded library behind it', () => {
  it('turns the defect used by these tests into at least one part', () => {
    const run = buildStockRun(input({
      blocks: [{ jobId: 'J1', date: '2026-09-15' }],
      jobs: new Map([['J1', { siteId: 's1', siteName: 'Sandgate Hall', orderNo: '41207' }]]),
      defectsBySite: new Map([['s1', [defect('d1', 's1')]]]),
    }));
    expect(run.lines.length).toBeGreaterThan(0);
    expect(run.uncovered).toEqual([]);
  });
});

describe('how many days it will cover', () => {
  it('defaults to a working week', () => {
    expect(stockRunDays(NaN)).toBe(DEFAULT_STOCK_DAYS);
  });

  it('will not go below a single day', () => {
    expect(stockRunDays(0)).toBe(1);
    expect(stockRunDays(-5)).toBe(1);
  });

  it('stops at the schedule sync’s own reach', () => {
    expect(stockRunDays(365)).toBe(MAX_STOCK_DAYS);
  });

  /*
   * The one that matters. The window is the schedule's, not the question's:
   * answering for thirty days when the phone holds twenty-one would print nine
   * empty days as though the diary were clear, and somebody would read that as
   * a quiet fortnight rather than as data the phone does not have.
   */
  it('covers only as far as the schedule reaches, and says so', () => {
    const run = buildStockRun(input({ days: 21, scheduleCoversTo: '2026-09-18' }));
    expect(run.days).toBe(5);
    expect(run.to).toBe('2026-09-18');
    expect(run.beyondSchedule).toBe(16);
    expect(run.notes.join(' ')).toContain('16 days are not in it');
  });

  it('says nothing about the reach when it covers the whole question', () => {
    const run = buildStockRun(input({ days: 7, scheduleCoversTo: '2026-10-05' }));
    expect(run.beyondSchedule).toBe(0);
    expect(run.days).toBe(7);
    expect(run.notes.join(' ')).not.toContain('not in it');
  });
});

describe('the buildings in the window', () => {
  const jobs = new Map<string, StockRunJob>([
    ['J1', { siteId: 's1', siteName: 'Sandgate Hall', orderNo: '41207' }],
    ['J2', { siteId: 's1', siteName: 'Sandgate Hall', orderNo: '41208' }],
    ['J3', { siteId: 's2', siteName: 'Carina Bus Depot', orderNo: '41300' }],
  ]);

  /*
   * A week at one building is one building. Counting per block instead would
   * multiply its defects by the number of days somebody is there, and the order
   * would come back five times too big — the expensive direction of wrong.
   */
  it('counts a site booked several days once', () => {
    const blocks: StockRunBlock[] = [
      { jobId: 'J1', date: '2026-09-15' },
      { jobId: 'J1', date: '2026-09-16' },
      { jobId: 'J2', date: '2026-09-17' },
    ];
    const run = buildStockRun(input({
      blocks, jobs,
      defectsBySite: new Map([['s1', [defect('d1', 's1'), defect('d2', 's1')]]]),
    }));

    expect(run.sites).toHaveLength(1);
    expect(firstSite(run).days).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    expect(firstSite(run).jobNumbers).toEqual(['41207', '41208']);
    expect(firstSite(run).openDefects).toBe(2);

    const perDefect = buildStockRun(input({
      blocks: [{ jobId: 'J1', date: '2026-09-15' }], jobs,
      defectsBySite: new Map([['s1', [defect('d1', 's1'), defect('d2', 's1')]]]),
    }));
    // Three blocks, same two defects: the quantities must not have moved.
    expect(run.lines.map((l) => l.needed)).toEqual(perDefect.lines.map((l) => l.needed));
  });

  it('leaves out days outside the window', () => {
    const run = buildStockRun(input({
      days: 2,
      blocks: [
        { jobId: 'J1', date: '2026-09-14' },
        { jobId: 'J3', date: '2026-09-20' },
      ],
      jobs,
      defectsBySite: new Map([['s1', [defect('d1', 's1')]], ['s2', [defect('d9', 's2')]]]),
    }));
    expect(run.sites.map((s) => s.siteName)).toEqual(['Sandgate Hall']);
  });

  it('leaves out days already gone', () => {
    const run = buildStockRun(input({
      blocks: [{ jobId: 'J1', date: '2026-09-13' }],
      jobs,
      defectsBySite: new Map([['s1', [defect('d1', 's1')]]]),
    }));
    expect(run.sites).toEqual([]);
  });

  it('says when a booked job is not against a building it holds', () => {
    const run = buildStockRun(input({
      blocks: [{ jobId: 'J9', date: '2026-09-15' }],
      jobs,
    }));
    expect(run.sites).toEqual([]);
    expect(run.notes.join(' ')).toContain('could not be matched to a building');
    expect(run.notes.join(' ')).toContain('J9');
  });

  it('says when a block is not against a job at all', () => {
    const run = buildStockRun(input({ blocks: [{ date: '2026-09-15' }], jobs }));
    expect(run.notes.join(' ')).toContain('not against a job');
  });
});

describe('what goes on the list', () => {
  const jobs = new Map<string, StockRunJob>([
    ['J1', { siteId: 's1', siteName: 'Sandgate Hall', orderNo: '41207' }],
  ]);
  const blocks: StockRunBlock[] = [{ jobId: 'J1', date: '2026-09-15' }];

  it('counts only what is still open', () => {
    const run = buildStockRun(input({
      blocks, jobs,
      defectsBySite: new Map([['s1', [
        defect('d1', 's1'),
        defect('d2', 's1', { status: 'rectified' }),
        defect('d3', 's1', { status: 'quoted' }),
        defect('d4', 's1', { status: 'closed' }),
      ]]]),
    }));
    expect(firstSite(run).openDefects).toBe(1);
    const one = buildStockRun(input({
      blocks, jobs, defectsBySite: new Map([['s1', [defect('d1', 's1')]]]),
    }));
    expect(run.lines.map((l) => l.needed)).toEqual(one.lines.map((l) => l.needed));
  });

  it('names the buildings behind a line', () => {
    const run = buildStockRun(input({
      blocks: [{ jobId: 'J1', date: '2026-09-15' }, { jobId: 'J2', date: '2026-09-16' }],
      jobs: new Map([
        ['J1', { siteId: 's1', siteName: 'Sandgate Hall' }],
        ['J2', { siteId: 's2', siteName: 'Carina Bus Depot' }],
      ]),
      defectsBySite: new Map([['s1', [defect('d1', 's1')]], ['s2', [defect('d2', 's2')]]]),
    }));
    expect(firstLine(run).sites).toEqual(['Carina Bus Depot', 'Sandgate Hall']);
  });

  /*
   * A defect raised as free text, or one whose work is all labour, produces
   * nothing to order. Dropping them silently leaves a list that looks complete
   * and misses the reason somebody is going.
   */
  it('names the defects that will not put anything on the list', () => {
    const run = buildStockRun(input({
      blocks, jobs,
      defectsBySite: new Map([['s1', [
        defect('typed', 's1', { defectCode: undefined }),
        defect('unknown', 's1', { defectCode: 'NOT-A-REAL-CODE' }),
      ]]]),
    }));
    expect(run.uncovered).toEqual([
      { defectId: 'typed', reason: 'no-code' },
      { defectId: 'unknown', reason: 'unknown-code' },
    ]);
  });

  it('says when the booked buildings have nothing open', () => {
    const run = buildStockRun(input({ blocks, jobs }));
    expect(run.lines).toEqual([]);
    expect(run.notes.join(' ')).toContain('nothing to take');
  });
});

describe('netting against the van', () => {
  const jobs = new Map<string, StockRunJob>([['J1', { siteId: 's1', siteName: 'Sandgate Hall' }]]);
  const blocks: StockRunBlock[] = [{ jobId: 'J1', date: '2026-09-15' }];
  const four = [defect('d1', 's1'), defect('d2', 's1'), defect('d3', 's1'), defect('d4', 's1')];

  function withVan(onHand: StockOnHand[]) {
    return buildStockRun(input({ blocks, jobs, defectsBySite: new Map([['s1', four]]), onHand }));
  }

  it('takes what the van already carries off the shortfall', () => {
    const bare = withVan([]);
    const line = firstLine(bare);
    const held = withVan([{ description: line.description, partNumber: 'P-1', quantity: 1 }]);
    const netted = held.lines.find((l) => l.description === line.description)!;

    expect(netted.needed).toBe(line.needed);
    expect(netted.onHand).toBe(1);
    expect(netted.partNumber).toBe('P-1');
    expect(netted.short).toBe(line.needed - 1);
  });

  it('never asks for a negative number', () => {
    const line = firstLine(withVan([]));
    const plenty = withVan([{ description: line.description, quantity: line.needed + 50 }]);
    expect(plenty.lines.find((l) => l.description === line.description)!.short).toBe(0);
  });

  it('adds up the same part held in two places', () => {
    const line = firstLine(withVan([]));
    const split = withVan([
      { description: line.description, quantity: 1 },
      { description: line.description, quantity: 2 },
    ]);
    expect(split.lines.find((l) => l.description === line.description)!.onHand).toBe(3);
  });

  it('matches the van line whatever its case and spacing', () => {
    const line = firstLine(withVan([]));
    const messy = withVan([{ description: `  ${line.description.toUpperCase()}  `, quantity: 2 }]);
    expect(messy.lines.find((l) => l.description === line.description)!.onHand).toBe(2);
  });

  /*
   * The distinction the whole netting rests on. A part the van list has never
   * carried is unknown, not zero: zero reads as "counted, none there" and
   * unknown means nobody has looked. Showing unknown as zero would be the same
   * number with a false claim attached to it.
   */
  it('leaves the count blank when the van list has never carried the part', () => {
    const bare = withVan([]);
    expect(firstLine(bare).onHand).toBeUndefined();
    expect(firstLine(bare).short).toBe(firstLine(bare).needed);
    expect(bare.notes.join(' ')).toContain('not on the van list at all');
  });

  it('shows nought as nought when the van does carry it and is empty', () => {
    const line = firstLine(withVan([]));
    const empty = withVan([{ description: line.description, quantity: 0 }]);
    const netted = empty.lines.find((l) => l.description === line.description)!;
    expect(netted.onHand).toBe(0);
    expect(netted.short).toBe(netted.needed);
    expect(empty.notes.join(' ')).not.toContain('not on the van list at all');
  });

  it('puts the biggest shortfall first, because that is the list you walk with', () => {
    const run = withVan([]);
    const shorts = run.lines.map((l) => l.short);
    expect(shorts).toEqual([...shorts].sort((a, b) => b - a));
  });
});
