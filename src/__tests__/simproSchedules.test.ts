import {
  SCHEDULE_COLUMNS, mapSchedule, rejectedTheDateRange, scheduleDateFilter, type RawSchedule,
} from '@/simpro/resources';

/**
 * The diary read, against the shapes the live build actually returns.
 *
 * This exists because of a sync that ran for twelve minutes, read four and a
 * half thousand jobs, and came back with an empty week. The schedules stage
 * had asked for a column called `Job`; the build answered
 * `422 Invalid columns found` and the whole stage was lost. Every other test
 * mocked the client, so every other test passed.
 *
 * The fixtures below are in the exact shape probed on the build — an
 * activity block whose `Project` is the empty string, a job block whose
 * `Project` is an object — with invented ids, names and dates.
 */

const jobBlock = (): RawSchedule => ({
  ID: 34327,
  Type: 'job',
  Reference: '41801-11950',
  Staff: { ID: 228, Name: 'Jade Castle' },
  Date: '2026-12-18',
  Blocks: [{ StartTime: '09:00', EndTime: '10:00' }],
  Project: { ProjectID: 41801 },
});

const leaveBlock = (): RawSchedule => ({
  ID: 14756,
  Type: 'activity',
  Reference: '10',
  Staff: { ID: 219, Name: 'Sam Ferrier' },
  Date: '2026-12-13',
  Blocks: [{ StartTime: '08:00', EndTime: '16:00' }],
  Project: '',
});

describe('the columns the diary asks for', () => {
  it('does not ask for Job, which this build refuses outright', () => {
    // Not a style preference. The server's words were:
    //   422 {"errors":[{"path":null,"message":"Invalid columns found.","value":"Job"}]}
    expect(SCHEDULE_COLUMNS.split(',')).not.toContain('Job');
  });

  it('asks for Project, which is where the job id actually is', () => {
    expect(SCHEDULE_COLUMNS.split(',')).toContain('Project');
  });

  it('asks for the staff member, the day and the hours', () => {
    expect(SCHEDULE_COLUMNS.split(',')).toEqual(
      expect.arrayContaining(['ID', 'Type', 'Reference', 'Staff', 'Date', 'Blocks']),
    );
  });

  it('does not ask for JobID, which the build accepts and then leaves empty', () => {
    // The worse of the two failures: a refusal is loud, a column that comes
    // back blank on every row looks like a build with nothing scheduled.
    expect(SCHEDULE_COLUMNS.split(',')).not.toContain('JobID');
  });
});

describe('a schedule block off the wire', () => {
  it('takes the job id from Project, not from the reference', () => {
    expect(mapSchedule(jobBlock(), '2026-12-01').jobId).toBe('41801');
  });

  it('gives an activity no job at all', () => {
    // Annual leave is on the diary and belongs to nobody's job. Reading the
    // "10" in its Reference as a job number would put a technician's leave
    // on job 10 for whoever owns it.
    expect(mapSchedule(leaveBlock(), '2026-12-01').jobId).toBeUndefined();
  });

  it('falls back to the reference when the object is missing', () => {
    // "41801-11950" is the job id and the cost centre. A build that returns
    // the reference but not the object still says which job it is.
    const thin = { ...jobBlock(), Project: undefined };
    expect(mapSchedule(thin, '2026-12-01').jobId).toBe('41801');
  });

  it('reads the day from the row, not from the window it was asked for', () => {
    expect(mapSchedule(jobBlock(), '2026-12-01').date).toBe('2026-12-18');
  });

  it('falls back to the asked-for day when the row carries none', () => {
    expect(mapSchedule({ ...jobBlock(), Date: undefined }, '2026-12-01').date).toBe('2026-12-01');
  });

  it('spans the first block to the last, not each block on its own', () => {
    // Two hours in the morning and two after another site is one visit.
    const split: RawSchedule = {
      ...jobBlock(),
      Blocks: [{ StartTime: '07:30', EndTime: '09:30' }, { StartTime: '13:00', EndTime: '15:00' }],
    };
    const mapped = mapSchedule(split, '2026-12-01');
    expect(mapped.startTime).toBe('07:30');
    expect(mapped.endTime).toBe('15:00');
  });

  it('survives a row with no blocks on it', () => {
    const mapped = mapSchedule({ ...jobBlock(), Blocks: [] }, '2026-12-01');
    expect(mapped.startTime).toBeUndefined();
    expect(mapped.endTime).toBeUndefined();
    expect(mapped.id).toBe('34327');
  });

  it('keeps the staff member so the week can be filtered to one technician', () => {
    const mapped = mapSchedule(jobBlock(), '2026-12-01');
    expect(mapped.staffId).toBe('228');
    expect(mapped.staffName).toBe('Jade Castle');
  });
});

describe('the date filter', () => {
  it('is the between() form the build honours', () => {
    // Verified against the build: between(2026-09-01,2026-09-30) returned 240
    // of 4,422 blocks, so the filter is applied server-side rather than
    // ignored — which is the difference between one read and twenty-eight.
    expect(scheduleDateFilter('2026-09-01', '2026-09-30')).toBe('between(2026-09-01,2026-09-30)');
  });
});

describe('what the fallback to a day at a time is for', () => {
  const columns = '{"errors":[{"path":null,"message":"Invalid columns found.","value":"Job"}]}';

  it('does not blame the date range for a refused column', () => {
    // This is the bug that made the original failure unreadable: the sync
    // said the date filter had been rejected, retried a day at a time with
    // the same bad column, and reported the day reads' failure. Somebody
    // reading the notes was told the wrong cause.
    expect(rejectedTheDateRange(422, columns)).toBe(false);
  });

  it('falls back when the build will not take between()', () => {
    expect(rejectedTheDateRange(422, '{"errors":[{"message":"Invalid filter value for Date."}]}')).toBe(true);
    expect(rejectedTheDateRange(400, 'Bad Request')).toBe(true);
  });

  it('does not fall back on anything that is not a refusal', () => {
    // A 500 or a dropped connection is not the build declining the range,
    // and reading two days instead would quietly halve the diary.
    expect(rejectedTheDateRange(500, 'Internal Server Error')).toBe(false);
    expect(rejectedTheDateRange(undefined, 'The network dropped')).toBe(false);
    expect(rejectedTheDateRange(401, 'Unauthorized')).toBe(false);
  });
});
