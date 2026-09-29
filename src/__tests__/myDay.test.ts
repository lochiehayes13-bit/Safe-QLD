import {
  addDays, groupScheduleByDay, scheduleWindow, whoseSchedule, type HeldJob, type ScheduleEntry,
} from '@/domain/myDay';

/**
 * A technician's own day out of the office schedule.
 *
 * The failure that matters is a block landing on the wrong day. Before ten in
 * the morning the UTC day is still yesterday in Brisbane, so a window or a
 * grouping anchored on the clock rather than the Queensland day calls this
 * morning's first job "tomorrow" until ten.
 */

// 8:30am on 2 September in Brisbane, which is still 1 September in UTC.
const NOW = '2026-09-01T22:30:00.000Z';

describe('the window the sync reads', () => {
  it('is anchored on the Queensland day, not the UTC one', () => {
    expect(scheduleWindow(NOW)).toEqual({
      today: '2026-09-02', tomorrow: '2026-09-03', from: '2026-08-26', to: '2026-09-23',
    });
  });

  it('moves calendar days without touching a clock', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('laying the blocks out by day', () => {
  const block = (id: string, date: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
    ({ id, date, staffId: '12', staffName: 'Dave Smith', startTime: '07:30', endTime: '11:00', jobId: '43747', ...over });
  const jobs: HeldJob[] = [
    { id: 'simpro-43747', externalId: '43747', siteName: 'BRIC Housing', title: 'Annual', address: '1 Emsworth St' },
    { id: 'local-1', siteName: 'Hand-entered', title: 'Call-out' },
  ];

  it('puts this morning under today, not tomorrow', () => {
    const g = groupScheduleByDay([block('a', '2026-09-02'), block('b', '2026-09-03'), block('c', '2026-09-10'), block('d', '2026-08-30')], NOW, jobs);
    expect({
      today: g.today.map((r) => r.schedule.id),
      tomorrow: g.tomorrow.map((r) => r.schedule.id),
      later: g.later.map((r) => r.schedule.id),
      earlier: g.earlier.map((r) => r.schedule.id),
    }).toEqual({ today: ['a'], tomorrow: ['b'], later: ['c'], earlier: ['d'] });
  });

  it('joins a block to the job the phone holds, by the office number', () => {
    const [row] = groupScheduleByDay([block('a', '2026-09-02')], NOW, jobs).today;
    expect(row!.job?.siteName).toBe('BRIC Housing');
  });

  it('still lists a block whose job is not on the phone', () => {
    // The schedule is the office's statement of where to be; dropping the row
    // because the job sync is behind hides exactly the appointment that matters.
    const [row] = groupScheduleByDay([block('a', '2026-09-02', { jobId: '99999' })], NOW, jobs).today;
    expect({ listed: !!row, job: row!.job }).toEqual({ listed: true, job: undefined });
  });

  it('orders a day by start time with untimed blocks last', () => {
    const g = groupScheduleByDay([
      block('late', '2026-09-02', { startTime: '13:00' }),
      block('none', '2026-09-02', { startTime: undefined }),
      block('early', '2026-09-02', { startTime: '07:00' }),
    ], NOW, jobs);
    expect(g.today.map((r) => r.schedule.id)).toEqual(['early', 'late', 'none']);
  });
});

describe('whose schedule', () => {
  it('filters by employee id when one is set, whatever the name says', () => {
    expect(whoseSchedule({ simproEmployeeId: '12', technicianName: 'Dave' })).toMatchObject({ by: 'id', staffId: '12' });
  });

  it('falls back to the typed name', () => {
    expect(whoseSchedule({ simproEmployeeId: '', technicianName: 'Dave Smith' })).toMatchObject({ by: 'name', staffName: 'Dave Smith' });
  });

  it('is nobody when the phone knows neither', () => {
    expect(whoseSchedule({ simproEmployeeId: ' ', technicianName: '' })).toBeNull();
  });
});
