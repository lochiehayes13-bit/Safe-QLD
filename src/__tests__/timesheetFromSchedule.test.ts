/**
 * A construction crew's week, filled from the Simpro schedule.
 *
 * The schedule already says which job each person was on and when. The fill
 * turns those blocks into timesheet lines and never overwrites a day someone
 * has already filled in.
 */
import { blankEntry, weekDates } from '@/domain/timesheet';
import {
  blocksFromSchedule, blocksFromTimesheet, entriesFromSchedule, fillFromPosition, fillModeFor, fillSummary, fillsOnOpen,
  leaveColumn, rateKind, rememberFilled, type ScheduleFill, type WorkBlock,
} from '@/domain/timesheetFromSchedule';

const WEEK = weekDates('2026-10-07'); // Wed 7 to Tue 13 October
let n = 0;
const newId = () => `e${++n}`;
const block = (over: Partial<WorkBlock>): WorkBlock => ({ date: '2026-10-07', ...over });
const sites = new Map([
  ['9001', { siteName: 'Fictional Tower', siteId: 's1' }],
  ['9002', { siteName: 'Main St Depot' }],
]);
const fill = (blocks: WorkBlock[], over: Partial<Parameters<typeof entriesFromSchedule>[0]> = {}) =>
  entriesFromSchedule({ week: WEEK, blocks, sites, existing: [], newId, ...over });
const EMPTY: ScheduleFill = { entries: [], filled: [], kept: [], activity: [], untimed: [], later: [], clash: [] };

describe('filling a week from the schedule', () => {
  it('turns each job block into a line with the job, the site and the times', () => {
    const f = fill([
      block({ date: '2026-10-07', jobId: '9001', startTime: '7:00', endTime: '15:30' }),
      block({ date: '2026-10-08', jobId: '9002', startTime: '06:30:00', endTime: '14:00:00' }),
    ]);
    expect(f.filled).toEqual(['2026-10-07', '2026-10-08']);
    expect(f.entries.map((e) => [e.date, e.jobNumber, e.siteName, e.siteId, e.startTime, e.finishTime])).toEqual([
      ['2026-10-07', '9001', 'Fictional Tower', 's1', '07:00', '15:30'],
      ['2026-10-08', '9002', 'Main St Depot', undefined, '06:30', '14:00'],
    ]);
    expect(f.entries.every((e) => e.hourKind === 'ord')).toBe(true);
  });

  it('puts two jobs in a day in time order, and joins two blocks of one job that run end to start', () => {
    const f = fill([
      block({ jobId: '9002', startTime: '12:00', endTime: '15:00' }),
      block({ jobId: '9001', startTime: '07:00', endTime: '09:00' }),
      block({ jobId: '9001', startTime: '09:00', endTime: '12:00' }),
    ]);
    expect(f.entries.map((e) => [e.jobNumber, e.startTime, e.finishTime])).toEqual([
      ['9001', '07:00', '12:00'],
      ['9002', '12:00', '15:00'],
    ]);
    expect(f.clash).toEqual([]);
  });

  it('keeps a lunch gap as two lines, because the gap is not worked', () => {
    const f = fill([
      block({ jobId: '9001', startTime: '07:00', endTime: '12:00' }),
      block({ jobId: '9001', startTime: '12:30', endTime: '15:30' }),
    ]);
    expect(f.entries.map((e) => [e.startTime, e.finishTime])).toEqual([['07:00', '12:00'], ['12:30', '15:30']]);
  });

  it('counts a booked block and the block clocking on wrote once, not twice', () => {
    const f = fill([
      block({ jobId: '9001', startTime: '07:00', endTime: '15:30' }),
      block({ jobId: '9001', startTime: '07:10', endTime: '15:45' }),
    ]);
    expect(f.entries.map((e) => [e.startTime, e.finishTime])).toEqual([['07:00', '15:45']]);
  });

  it('says so where two different jobs overlap, rather than paying both quietly', () => {
    const f = fill([
      block({ jobId: '9001', startTime: '07:00', endTime: '15:00' }),
      block({ jobId: '9002', startTime: '13:00', endTime: '16:00' }),
    ]);
    expect(f.entries).toHaveLength(2);
    expect(f.clash).toEqual(['2026-10-07']);
    expect(fillSummary(f).body).toContain('Wed: two jobs at the same time. Fix the times.');
  });

  it('puts overtime and double time in their own buckets, from the rate Simpro names', () => {
    const f = fill([
      block({ jobId: '9001', startTime: '07:00', endTime: '15:00', rateName: 'Normal' }),
      block({ jobId: '9001', startTime: '15:00', endTime: '17:00', rateName: 'Overtime' }),
      block({ date: '2026-10-10', jobId: '9001', startTime: '07:00', endTime: '11:00', rateName: 'Double Time' }),
    ]);
    expect(f.entries.map((e) => [e.date, e.startTime, e.finishTime, e.hourKind])).toEqual([
      ['2026-10-07', '07:00', '15:00', 'ord'],
      ['2026-10-07', '15:00', '17:00', 'ot'],
      ['2026-10-10', '07:00', '11:00', 'dt'],
    ]);
  });

  it('never overwrites a day that already has anything on it', () => {
    const typed = { ...blankEntry('mine', '2026-10-07'), jobNumber: '9002', startTime: '08:00', finishTime: '16:00' };
    const f = fill([
      block({ date: '2026-10-07', jobId: '9001', startTime: '07:00', endTime: '15:30' }),
      block({ date: '2026-10-09', jobId: '9001', startTime: '07:00', endTime: '15:30' }),
    ], { existing: [typed] });
    expect(f.kept).toEqual(['2026-10-07']);
    expect(f.filled).toEqual(['2026-10-09']);
    expect(f.entries.map((e) => e.date)).toEqual(['2026-10-09']);
  });

  it('fills a day of leave in its own column, and names any other activity', () => {
    const f = fill([
      block({ date: '2026-10-12', activityName: 'Annual Leave', startTime: '07:00', endTime: '15:00' }),
      block({ date: '2026-10-13', jobId: '9001', startTime: '07:00', endTime: '11:00' }),
      block({ date: '2026-10-13', activityName: 'Toolbox training', startTime: '11:00', endTime: '15:00' }),
    ]);
    const monday = f.entries.find((e) => e.date === '2026-10-12');
    expect(monday?.annual).toBe('8');
    expect(f.activity).toEqual([{ date: '2026-10-13', name: 'Toolbox training' }]);
    expect(f.filled).toEqual(['2026-10-12', '2026-10-13']);
    expect(fillSummary(f).body).toContain('Tue: Toolbox training. Add it yourself.');
  });

  it('gives a leave block with no times a standard day', () => {
    const f = fill([block({ activityName: 'RDO' })]);
    expect(f.entries[0]?.rdo).toBe('8');
  });

  it('fills a job block with no times and says so', () => {
    const f = fill([block({ jobId: '9001' })]);
    expect(f.entries[0]).toMatchObject({ jobNumber: '9001', startTime: '', finishTime: '' });
    expect(f.untimed).toEqual(['2026-10-07']);
  });

  it('ignores blocks outside the week, and an unknown job keeps its number with no site', () => {
    const f = fill([block({ date: '2026-10-20', jobId: '9001' }), block({ date: '2026-10-08', jobId: '9555', startTime: '07:00', endTime: '15:00' })]);
    expect(f.entries.map((e) => [e.date, e.jobNumber, e.siteName])).toEqual([['2026-10-08', '9555', '']]);
  });
});

describe('only what has happened', () => {
  it('leaves days after today for later, so a plan the office changes is not written in', () => {
    const f = fill([
      block({ date: '2026-10-08', jobId: '9001', startTime: '07:00', endTime: '15:00' }),
      block({ date: '2026-10-09', jobId: '9001', startTime: '07:00', endTime: '15:00' }),
    ], { upTo: '2026-10-08' });
    expect(f.filled).toEqual(['2026-10-08']);
    expect(f.later).toEqual(['2026-10-09']);
    expect(fillSummary(f).body).toContain("Fri will fill once it's done.");
  });

  it('skips a day filled before, so a day cleared by hand stays cleared', () => {
    const f = fill([block({ date: '2026-10-08', jobId: '9001', startTime: '07:00', endTime: '15:00' })], { skip: new Set(['2026-10-08']) });
    expect(f.entries).toEqual([]);
    expect(f.filled).toEqual([]);
  });

  it('remembers filled days for ten weeks and no longer', () => {
    expect(rememberFilled(['2026-07-01', '2026-10-01'], ['2026-10-08', '2026-10-08'], '2026-10-09'))
      .toEqual(['2026-10-01', '2026-10-08']);
  });
});

describe('where the blocks come from', () => {
  it("reads the person's own timesheet block by block, naming activities from the office's list", () => {
    const blocks = blocksFromTimesheet([
      { date: '2026-10-07', jobId: '9001', startTime: '07:00', endTime: '12:00', scheduleRateName: 'Normal' },
      { date: '2026-10-07', activityId: '12', startTime: '12:30', endTime: '15:30', totalHours: 3 },
    ], new Map([['12', 'Annual Leave']]));
    expect(blocks).toEqual([
      { date: '2026-10-07', jobId: '9001', activityName: undefined, startTime: '07:00', endTime: '12:00', hours: undefined, rateName: 'Normal' },
      { date: '2026-10-07', jobId: undefined, activityName: 'Annual Leave', startTime: '12:30', endTime: '15:30', hours: 3, rateName: undefined },
    ]);
  });

  it("falls back to the office's schedule, where a block with no job is an unnamed activity", () => {
    expect(blocksFromSchedule([{ id: 'b', date: '2026-10-07', jobId: '', startTime: '07:00', endTime: '15:00' }]))
      .toEqual([{ date: '2026-10-07', jobId: undefined, startTime: '07:00', endTime: '15:00' }]);
  });

  it.each([
    ['Overtime', 'ot'], ['Time and a half', 'ot'], ['x1.5', 'ot'],
    ['Double Time', 'dt'], ['x2', 'dt'],
    ['Normal', 'ord'], [undefined, 'ord'],
  ])('rate %s goes to %s', (name, kind) => {
    expect(rateKind(name)).toBe(kind);
  });

  it.each([
    ['Annual Leave', 'annual'], ['RDO', 'rdo'], ['Sick / Carers', 'sick'], ['Leave without pay', 'lwop'],
    ['Public Holiday', 'publicHoliday'], ['Training', undefined], [undefined, undefined],
  ])('activity %s fills %s', (name, column) => {
    expect(leaveColumn(name)).toBe(column);
  });
});

describe('what the person is told', () => {
  it('says which days were filled and what was left', () => {
    const s = fillSummary({ ...EMPTY, filled: ['2026-10-07', '2026-10-08'], kept: ['2026-10-12'], activity: [{ date: '2026-10-13' }] });
    expect(s.title).toBe('Filled Wed and Thu');
    expect(s.body).toContain('Check the times');
    expect(s.body).toContain('Mon already had entries, so it was left.');
    expect(s.body).toContain('Tue: not on a job. Add it yourself.');
  });

  it('says so when nothing is scheduled', () => {
    expect(fillSummary(EMPTY).title).toBe('Nothing scheduled');
  });
});

describe('who fills from the schedule', () => {
  it.each([
    ['Construction Electrician', 'schedule'],
    ['Installer', 'schedule'],
    ['Project Supervisor', 'schedule'],
    ['Service Technician', 'manual'],
    ['Maintenance Tech', 'manual'],
    ['Office Manager', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('position %s → %s', (position, expected) => {
    expect(fillFromPosition(position)).toBe(expected);
  });

  it('takes their own answer first, then the trade they picked in Settings', () => {
    expect(fillModeFor({ timesheetFill: 'manual', tradeStream: 'construction' })).toBe('manual');
    expect(fillModeFor({ timesheetFill: '', tradeStream: 'construction' })).toBe('schedule');
    expect(fillModeFor({ timesheetFill: '', tradeStream: 'service' })).toBe('manual');
    expect(fillModeFor({ timesheetFill: '', tradeStream: 'both' })).toBeUndefined();
  });

  it('fills a draft on open only for someone filling from the schedule', () => {
    expect(fillsOnOpen({ status: 'draft' }, 'schedule')).toBe(true);
    expect(fillsOnOpen({ status: 'draft' }, 'manual')).toBe(false);
    expect(fillsOnOpen({ status: 'draft' }, undefined)).toBe(false);
    expect(fillsOnOpen({ status: 'submitted' }, 'schedule')).toBe(false);
  });
});
