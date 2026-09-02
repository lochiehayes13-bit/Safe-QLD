import {
  blankEntry,
  copyDay,
  dayName,
  dayWorkedHours,
  entryHours,
  filterJobOptions,
  groupByDate,
  hydrateEntry,
  jobOptions,
  leaveOf,
  parseTime,
  previousDayWithEntries,
  setLeave,
  timesheetTotals,
  toggleExtra,
  usualTimes,
  validateTimesheet,
  weekDates,
  type Timesheet,
  type TimesheetEntry,
} from '@/domain/timesheet';

function entry(p: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: p.id ?? 'e1',
    date: p.date ?? '2026-08-12',
    jobNumber: p.jobNumber ?? '',
    siteName: p.siteName ?? 'Site',
    serviceReportNumber: p.serviceReportNumber ?? '',
    startTime: p.startTime ?? '06:30',
    finishTime: p.finishTime ?? '14:30',
    hourKind: p.hourKind ?? 'ord',
    hoursOverride: p.hoursOverride,
    sick: p.sick ?? '',
    rdo: p.rdo ?? '',
    annual: p.annual ?? '',
    lwop: p.lwop ?? '',
    publicHoliday: p.publicHoliday ?? '',
    comments: p.comments ?? '',
    extras: p.extras ?? [],
  };
}

function sheet(entries: TimesheetEntry[]): Timesheet {
  return {
    id: 't1',
    employeeName: 'Lachlan Hayes',
    vehicleRego: 'ABC123',
    kilometerReading: '120450',
    weekStarting: '2026-08-12',
    entries,
    managerName: '',
    checkedBy: '',
    status: 'draft',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
}

describe('parseTime', () => {
  it('parses valid times', () => {
    expect(parseTime('06:30')).toBe(390);
    expect(parseTime('6:30')).toBe(390);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
  });

  it('rejects invalid times', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('06:75')).toBeNull();
    expect(parseTime('half six')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('entryHours', () => {
  it('computes a standard day', () => {
    expect(entryHours(entry({ startTime: '06:30', finishTime: '14:30' }))).toBe(8);
  });

  it('computes an after-hours callout', () => {
    // The real timesheet's overtime row: 17:30 to 20:45 is 3.25 hours.
    expect(entryHours(entry({ startTime: '17:30', finishTime: '20:45' }))).toBe(3.25);
  });

  it('handles a shift running past midnight rather than going negative', () => {
    expect(entryHours(entry({ startTime: '22:00', finishTime: '02:30' }))).toBe(4.5);
  });

  it('reads the same start and finish as no time at all, not as a full day round', () => {
    /*
     * The overnight case and this one are the same comparison, and it decides
     * between nought hours and twenty-four. A finish before a start means the
     * shift crossed midnight and a day is added; a finish equal to the start is
     * a typo or an abandoned row, and adding a day to it puts twenty-four
     * hours on somebody's pay.
     */
    expect(entryHours(entry({ startTime: '06:30', finishTime: '06:30' }))).toBe(0);
  });

  it('honours a manual override', () => {
    expect(entryHours(entry({ startTime: '06:30', finishTime: '14:30', hoursOverride: '7.5' }))).toBe(7.5);
  });

  it('returns zero when times are missing or unparseable', () => {
    expect(entryHours(entry({ startTime: '', finishTime: '' }))).toBe(0);
    expect(entryHours(entry({ startTime: 'nope', finishTime: '14:30' }))).toBe(0);
  });
});

describe('timesheetTotals', () => {
  it('splits worked hours across ordinary, overtime and double time', () => {
    const t = timesheetTotals(
      sheet([
        entry({ id: 'a', startTime: '06:30', finishTime: '14:30', hourKind: 'ord' }),
        entry({ id: 'b', startTime: '17:30', finishTime: '20:45', hourKind: 'ot' }),
        entry({ id: 'c', startTime: '08:00', finishTime: '10:00', hourKind: 'dt' }),
      ]),
    );
    expect(t.ord).toBe(8);
    expect(t.ot).toBe(3.25);
    expect(t.dt).toBe(2);
    expect(t.worked).toBe(13.25);
  });

  it('totals leave separately from worked hours', () => {
    const t = timesheetTotals(
      sheet([
        entry({ id: 'a', startTime: '06:30', finishTime: '14:30' }),
        entry({ id: 'b', startTime: '', finishTime: '', sick: '8' }),
        entry({ id: 'c', startTime: '', finishTime: '', annual: '8' }),
      ]),
    );
    expect(t.worked).toBe(8);
    expect(t.sick).toBe(8);
    expect(t.annual).toBe(8);
    expect(t.grand).toBe(24);
  });

  it('reproduces the five-day week on the supplied sheet', () => {
    // Wed-Tue, five 8 hour days plus one 3.25 hour overtime callout.
    const days = ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17', '2026-08-18'];
    const entries = days.map((d, i) => entry({ id: `d${i}`, date: d }));
    entries.push(entry({ id: 'ot', date: '2026-08-12', startTime: '17:30', finishTime: '20:45', hourKind: 'ot' }));
    const t = timesheetTotals(sheet(entries));
    expect(t.ord).toBe(40);
    expect(t.ot).toBe(3.25);
    expect(t.grand).toBe(43.25);
  });

  it('ignores non-numeric leave entries instead of producing NaN', () => {
    const t = timesheetTotals(sheet([entry({ sick: 'n/a' })]));
    expect(t.sick).toBe(0);
    expect(Number.isNaN(t.grand)).toBe(false);
  });
});

describe('validateTimesheet', () => {
  it('accepts a well-formed sheet', () => {
    expect(validateTimesheet(sheet([entry()]))).toHaveLength(0);
  });

  it('flags an entry with neither times nor leave', () => {
    const issues = validateTimesheet(sheet([entry({ startTime: '', finishTime: '' })]));
    expect(issues.some((i) => i.message.includes('no times'))).toBe(true);
  });

  it('flags a malformed time', () => {
    const issues = validateTimesheet(sheet([entry({ startTime: '6.30' })]));
    expect(issues.some((i) => i.message.includes('HH:MM'))).toBe(true);
  });

  it('flags an implausibly long entry', () => {
    const issues = validateTimesheet(sheet([entry({ startTime: '04:00', finishTime: '23:00' })]));
    expect(issues.some((i) => i.message.includes('hours in one entry'))).toBe(true);
  });

  it('says an entry ending when it started is exactly that', () => {
    // A row somebody started and did not finish. Silently worth twenty-four
    // hours if the span is read the wrong way, and worth saying out loud
    // either way.
    const issues = validateTimesheet(sheet([entry({ startTime: '06:30', finishTime: '06:30' })]));
    expect(issues.some((i) => i.message.includes('start and finish are the same'))).toBe(true);
    expect(issues.some((i) => i.message.includes('hours in one entry'))).toBe(false);
  });

  it('treats a half-filled pair of times as no times, not as a bad shift', () => {
    /*
     * A start typed and the finish still to come. Counted as a complete pair
     * it works out to nought hours and is reported as "start and finish are
     * the same", which sends somebody looking at two times when only one is
     * there.
     */
    const issues = validateTimesheet(sheet([entry({ finishTime: '' })]));
    expect(issues.some((i) => i.message.includes('no times'))).toBe(true);
    expect(issues.some((i) => i.message.includes('start and finish are the same'))).toBe(false);
  });

  it('leaves a sixteen-hour day alone and questions the one past it', () => {
    // Sixteen hours is a long day and a real one — a full day and a callout
    // on the end of it. Seventeen is worth a second look.
    expect(validateTimesheet(sheet([entry({ startTime: '05:00', finishTime: '21:00' })]))
      .some((i) => i.message.includes('hours in one entry'))).toBe(false);
    expect(validateTimesheet(sheet([entry({ startTime: '05:00', finishTime: '22:00' })]))
      .some((i) => i.message.includes('hours in one entry'))).toBe(true);
  });

  it('flags hours booked with no site name', () => {
    const issues = validateTimesheet(sheet([entry({ siteName: '' })]));
    expect(issues.some((i) => i.message.includes('no job or site name'))).toBe(true);
  });

  it('does not require a site name on a leave day', () => {
    const issues = validateTimesheet(sheet([entry({ siteName: '', startTime: '', finishTime: '', annual: '8' })]));
    expect(issues).toHaveLength(0);
  });

  it('flags a blank employee name', () => {
    const s = sheet([entry()]);
    s.employeeName = '';
    expect(validateTimesheet(s).some((i) => i.message.includes('Employee name'))).toBe(true);
  });
});

describe('dates', () => {
  it('names weekdays as the sheet prints them', () => {
    expect(dayName('2026-08-12')).toBe('Wed');
    expect(dayName('2026-08-13')).toBe('Thu');
    expect(dayName('2026-08-17')).toBe('Mon');
  });

  it('expands a week from its first day', () => {
    const days = weekDates('2026-08-12');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-12');
    expect(days[6]).toBe('2026-08-18');
  });

  it('groups entries by date in order', () => {
    const groups = groupByDate([
      entry({ id: 'b', date: '2026-08-13' }),
      entry({ id: 'a', date: '2026-08-12' }),
      entry({ id: 'c', date: '2026-08-12' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-08-12', '2026-08-13']);
    expect(groups[0]!.entries).toHaveLength(2);
  });
});

/**
 * The day-oriented editor.
 *
 * The screen thinks in two shapes — a job with hours, or a day off of one
 * kind — and these are the translations between that and the flat row payroll
 * still receives. The failures worth guarding are a leave column that outlives
 * a switch to a worked day, a copy that quietly carries yesterday's leave, and
 * a job list that offers a job twice.
 */
describe('leave on an entry', () => {
  const base = (): TimesheetEntry => ({
    id: 'e', date: '2026-09-07', jobNumber: '', siteName: '', serviceReportNumber: '',
    startTime: '', finishTime: '', hourKind: 'ord',
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: '', extras: [],
  });

  it('reads the one leave column that is set', () => {
    expect(leaveOf({ ...base(), annual: '7.6' })).toEqual({ kind: 'annual', hours: 7.6 });
  });

  it('is null for a worked day', () => {
    expect(leaveOf({ ...base(), startTime: '06:30', finishTime: '14:30' })).toBeNull();
  });

  it('setting a leave kind clears the times and every other leave column', () => {
    const worked = { ...base(), startTime: '06:30', finishTime: '14:30', sick: '4' };
    const off = setLeave(worked, 'annual', 7.6);
    expect({ annual: off.annual, sick: off.sick, start: off.startTime, finish: off.finishTime })
      .toEqual({ annual: '7.6', sick: '', start: '', finish: '' });
  });

  it('setting hours to zero clears the day off, so a mistaken tap is undoable', () => {
    const off = setLeave(base(), 'rdo', 7.6);
    expect(leaveOf(setLeave(off, 'rdo', 0))).toBeNull();
  });
});

describe('allowances', () => {
  it('adds one and takes it away, case-insensitively', () => {
    const e = blankEntry('e', '2026-09-07');
    const withCallout = toggleExtra(e, 'Call-out');
    expect(withCallout.extras).toEqual(['Call-out']);
    expect(toggleExtra(withCallout, 'call-out').extras).toEqual([]);
  });

  it('will not add a blank label', () => {
    expect(toggleExtra(blankEntry('e', '2026-09-07'), '   ').extras).toEqual([]);
  });
});

describe('copying the previous day', () => {
  const day = (date: string, over: Partial<TimesheetEntry> = {}) => ({ ...blankEntry(`${date}-${Math.random()}`, date), jobNumber: '43747', siteName: 'BRIC', startTime: '06:30', finishTime: '14:30', ...over });
  let n = 0;
  const ids = () => `new-${++n}`;

  it('carries the jobs, times and allowances but not the report number or notes', () => {
    const entries = [day('2026-09-07', { serviceReportNumber: 'SR-1', comments: 'did a thing', extras: ['Call-out'] })];
    const [copied] = copyDay(entries, '2026-09-07', '2026-09-08', ids);
    expect({ job: copied!.jobNumber, start: copied!.startTime, extras: copied!.extras, sr: copied!.serviceReportNumber, notes: copied!.comments })
      .toEqual({ job: '43747', start: '06:30', extras: ['Call-out'], sr: '', notes: '' });
  });

  it('never copies a day off', () => {
    const entries = [setLeave(blankEntry('x', '2026-09-07'), 'annual', 7.6)];
    expect(copyDay(entries, '2026-09-07', '2026-09-08', ids)).toEqual([]);
  });

  it('finds the nearest earlier day that has entries', () => {
    const entries = [day('2026-09-07'), day('2026-09-09')];
    expect(previousDayWithEntries(entries, '2026-09-10')).toBe('2026-09-09');
    expect(previousDayWithEntries(entries, '2026-09-08')).toBe('2026-09-07');
    expect(previousDayWithEntries(entries, '2026-09-07')).toBeNull();
  });

  it('counts only worked hours in a day, not leave', () => {
    const entries = [day('2026-09-07'), setLeave(blankEntry('l', '2026-09-07'), 'annual', 7.6)];
    expect(dayWorkedHours(entries, '2026-09-07')).toBe(8);
  });
});

describe('the job list', () => {
  const mkSheet = (weekStarting: string, es: Partial<TimesheetEntry>[]): Timesheet => ({
    id: `s-${weekStarting}`, employeeName: 'L', vehicleRego: '', kilometerReading: '',
    weekStarting, entries: es.map((e, i) => ({ ...blankEntry(`e${i}`, weekStarting), ...e })),
    managerName: '', checkedBy: '', status: 'submitted', createdAt: '', updatedAt: '',
  });

  it('offers the most recent jobs first and never the same one twice', () => {
    const sheets = [
      mkSheet('2026-08-24', [{ jobNumber: '100', siteName: 'A' }]),
      mkSheet('2026-08-31', [{ jobNumber: '200', siteName: 'B' }, { jobNumber: '100', siteName: 'A' }]),
    ];
    const opts = jobOptions(sheets, []);
    expect(opts.map((o) => o.jobNumber)).toEqual(['200', '100']);
  });

  it('adds the office open jobs after the recent ones and drops completed', () => {
    const opts = jobOptions([], [
      { externalId: '900', siteName: 'Open site', status: 'scheduled' },
      { externalId: '901', siteName: 'Done site', status: 'complete' },
    ]);
    expect(opts.map((o) => o.jobNumber)).toEqual(['900']);
  });

  it('does not offer a day off as a job', () => {
    const off = mkSheet('2026-08-31', [{ annual: '7.6' }]);
    expect(jobOptions([off], [])).toEqual([]);
  });

  it('filters by number or site, case-insensitively', () => {
    const opts = jobOptions([], [
      { externalId: '900', siteName: 'Emsworth St', status: 'scheduled' },
      { externalId: '901', siteName: 'Carina Depot', status: 'scheduled' },
    ]);
    expect(filterJobOptions(opts, 'ems').map((o) => o.jobNumber)).toEqual(['900']);
    expect(filterJobOptions(opts, '901').map((o) => o.siteName)).toEqual(['Carina Depot']);
  });
});

describe('the usual times', () => {
  const mk = (start: string, finish: string): TimesheetEntry => ({ ...blankEntry('e', '2026-09-07'), startTime: start, finishTime: finish });
  it('is the pair worked most often', () => {
    const sheet: Timesheet = {
      id: 's', employeeName: '', vehicleRego: '', kilometerReading: '', weekStarting: '2026-09-07',
      entries: [mk('06:30', '14:30'), mk('06:30', '14:30'), mk('07:00', '15:00')],
      managerName: '', checkedBy: '', status: 'draft', createdAt: '', updatedAt: '',
    };
    expect(usualTimes([sheet])).toEqual({ start: '06:30', finish: '14:30' });
  });
  it('falls back to the standard day when there is no history', () => {
    expect(usualTimes([])).toEqual({ start: '06:30', finish: '14:30' });
  });
});

describe('hydrating an entry from an older saved sheet', () => {
  it('fills a missing extras array and every missing text field', () => {
    const raw = { id: 'e', date: '2026-09-07', jobNumber: '1' } as Partial<TimesheetEntry>;
    const e = hydrateEntry(raw, () => 'gen');
    expect({ extras: e.extras, sick: e.sick, comments: e.comments, hourKind: e.hourKind })
      .toEqual({ extras: [], sick: '', comments: '', hourKind: 'ord' });
  });

  it('drops a non-string that snuck into extras', () => {
    const raw = { extras: ['Call-out', 5, '', 'Travel'] } as unknown as Partial<TimesheetEntry>;
    expect(hydrateEntry(raw, () => 'gen').extras).toEqual(['Call-out', 'Travel']);
  });
});
