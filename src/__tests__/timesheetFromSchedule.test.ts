/**
 * A construction crew's week, filled from the Simpro schedule.
 *
 * The schedule already says which job each person was on and when. The fill
 * turns those blocks into timesheet lines and never overwrites a day someone
 * has already filled in.
 */
import { blankEntry, weekDates } from '@/domain/timesheet';
import { entriesFromSchedule, fillFromPosition, fillSummary, fillsOnOpen } from '@/domain/timesheetFromSchedule';
import type { ScheduleEntry } from '@/domain/myDay';

const WEEK = weekDates('2026-10-07'); // Wed 7 to Tue 13 October
let n = 0;
const newId = () => `e${++n}`;
const block = (over: Partial<ScheduleEntry>): ScheduleEntry => ({ id: `b${++n}`, date: '2026-10-07', ...over });
const sites = new Map([
  ['9001', { siteName: 'Fictional Tower', siteId: 's1' }],
  ['9002', { siteName: 'Main St Depot' }],
]);

describe('filling a week from the schedule', () => {
  it('turns each job block into a line with the job, the site and the times', () => {
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [
        block({ date: '2026-10-07', jobId: '9001', startTime: '7:00', endTime: '15:30' }),
        block({ date: '2026-10-08', jobId: '9002', startTime: '06:30:00', endTime: '14:00:00' }),
      ],
      sites, existing: [], newId,
    });
    expect(fill.filled).toEqual(['2026-10-07', '2026-10-08']);
    expect(fill.entries.map((e) => [e.date, e.jobNumber, e.siteName, e.siteId, e.startTime, e.finishTime])).toEqual([
      ['2026-10-07', '9001', 'Fictional Tower', 's1', '07:00', '15:30'],
      ['2026-10-08', '9002', 'Main St Depot', undefined, '06:30', '14:00'],
    ]);
    expect(fill.entries.every((e) => e.hourKind === 'ord')).toBe(true);
  });

  it('puts two jobs in a day in time order, and joins two blocks of one job that run end to start', () => {
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [
        block({ jobId: '9002', startTime: '12:00', endTime: '15:00' }),
        block({ jobId: '9001', startTime: '07:00', endTime: '09:00' }),
        block({ jobId: '9001', startTime: '09:00', endTime: '12:00' }),
      ],
      sites, existing: [], newId,
    });
    expect(fill.entries.map((e) => [e.jobNumber, e.startTime, e.finishTime])).toEqual([
      ['9001', '07:00', '12:00'],
      ['9002', '12:00', '15:00'],
    ]);
  });

  it('keeps two blocks of one job apart when there is a gap, because the gap is not worked', () => {
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [
        block({ jobId: '9001', startTime: '07:00', endTime: '10:00' }),
        block({ jobId: '9001', startTime: '11:00', endTime: '15:00' }),
      ],
      sites, existing: [], newId,
    });
    expect(fill.entries).toHaveLength(2);
  });

  it('never overwrites a day that already has anything on it', () => {
    const typed = { ...blankEntry('mine', '2026-10-07'), jobNumber: '9002', startTime: '08:00', finishTime: '16:00' };
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [
        block({ date: '2026-10-07', jobId: '9001', startTime: '07:00', endTime: '15:30' }),
        block({ date: '2026-10-09', jobId: '9001', startTime: '07:00', endTime: '15:30' }),
      ],
      sites, existing: [typed], newId,
    });
    expect(fill.kept).toEqual(['2026-10-07']);
    expect(fill.filled).toEqual(['2026-10-09']);
    expect(fill.entries.map((e) => e.date)).toEqual(['2026-10-09']);
  });

  it('names a leave or training block rather than guessing what it was', () => {
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [
        block({ date: '2026-10-12', startTime: '07:00', endTime: '15:00', type: 'activity' }),
        block({ date: '2026-10-13', jobId: '9001', startTime: '07:00', endTime: '11:00' }),
        block({ date: '2026-10-13', startTime: '11:00', endTime: '15:00', type: 'activity' }),
      ],
      sites, existing: [], newId,
    });
    expect(fill.activity).toEqual(['2026-10-12', '2026-10-13']);
    expect(fill.filled).toEqual(['2026-10-13']);
    expect(fill.entries).toHaveLength(1);
  });

  it('fills a block with no times and says so', () => {
    const fill = entriesFromSchedule({ week: WEEK, blocks: [block({ jobId: '9001' })], sites, existing: [], newId });
    expect(fill.entries[0]).toMatchObject({ jobNumber: '9001', startTime: '', finishTime: '' });
    expect(fill.untimed).toEqual(['2026-10-07']);
  });

  it('ignores blocks outside the week, and an unknown job keeps its number with no site', () => {
    const fill = entriesFromSchedule({
      week: WEEK,
      blocks: [block({ date: '2026-10-20', jobId: '9001' }), block({ date: '2026-10-08', jobId: '9555', startTime: '07:00', endTime: '15:00' })],
      sites, existing: [], newId,
    });
    expect(fill.entries.map((e) => [e.date, e.jobNumber, e.siteName])).toEqual([['2026-10-08', '9555', '']]);
  });
});

describe('what the person is told', () => {
  it('says which days were filled and what was left', () => {
    const s = fillSummary({ entries: [], filled: ['2026-10-07', '2026-10-08'], kept: ['2026-10-12'], activity: ['2026-10-13'], untimed: [] });
    expect(s.title).toBe('Filled Wed and Thu');
    expect(s.body).toContain('Check the times');
    expect(s.body).toContain('Mon already had entries, so it was left.');
    expect(s.body).toContain('Tue: leave or other activities.');
  });

  it('says so when nothing is scheduled', () => {
    expect(fillSummary({ entries: [], filled: [], kept: [], activity: [], untimed: [] }).title).toBe('Nothing scheduled');
  });
});

describe('guessing the kind of worker from the Simpro position', () => {
  it.each([
    ['Construction Electrician', 'schedule'],
    ['Installer', 'schedule'],
    ['Project Supervisor', 'schedule'],
    ['Service Technician', 'manual'],
    ['Maintenance Tech', 'manual'],
    ['Office Manager', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%s → %s', (position, expected) => {
    expect(fillFromPosition(position)).toBe(expected);
  });
});

describe('a new week filling itself when it is opened', () => {
  const fresh = { status: 'draft' as const, entries: [], createdAt: '2026-10-07T21:00:00.000Z', updatedAt: '2026-10-07T21:00:00.000Z' };

  it('fills an untouched week for someone who asked for it', () => {
    expect(fillsOnOpen(fresh, 'schedule')).toBe(true);
  });

  it('does not for someone who types their own, or has not said', () => {
    expect(fillsOnOpen(fresh, 'manual')).toBe(false);
    expect(fillsOnOpen(fresh, '')).toBe(false);
  });

  it('leaves a week alone once anyone has saved it, so a day cleared by hand stays cleared', () => {
    expect(fillsOnOpen({ ...fresh, updatedAt: '2026-10-07T21:05:00.000Z' }, 'schedule')).toBe(false);
  });

  it('never touches a week with lines on it, or one that has been sent', () => {
    expect(fillsOnOpen({ ...fresh, entries: [blankEntry('x', '2026-10-07')] }, 'schedule')).toBe(false);
    expect(fillsOnOpen({ ...fresh, status: 'submitted' as const }, 'schedule')).toBe(false);
  });
});
