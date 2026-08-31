import {
  dayName,
  entryHours,
  groupByDate,
  parseTime,
  timesheetTotals,
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
    comments: p.comments ?? '',
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
