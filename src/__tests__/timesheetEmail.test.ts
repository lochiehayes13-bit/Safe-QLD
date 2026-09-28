import {
  TIMESHEET_INBOX,
  TIMESHEET_LACHLAN,
  TIMESHEET_MATT,
  TIMESHEET_ROUTES,
  routeAddresses,
  timesheetBody,
  timesheetNotReady,
  timesheetRoute,
  timesheetSubject,
} from '@/domain/timesheetEmail';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/**
 * The timesheet that reaches payroll.
 *
 * A week of someone's pay travels in this. The failures that matter are the
 * quiet ones: a sheet sent with no name that cannot be filed against anyone, a
 * day whose hours silently vanish because a field was blank, or a total that
 * disagrees with the rows above it.
 */

function entry(over: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: 'e1',
    date: '2026-08-31',
    jobNumber: '43747',
    siteName: 'BRIC Housing Emsworth St',
    serviceReportNumber: '',
    startTime: '06:30',
    finishTime: '14:30',
    hourKind: 'ord',
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '',
    comments: '',
    ...over,
  };
}

function sheet(over: Partial<Timesheet> = {}): Timesheet {
  return {
    id: 't1',
    employeeName: 'Lachlan Hayes',
    vehicleRego: '123ABC',
    kilometerReading: '184320',
    weekStarting: '2026-08-31',
    entries: [entry()],
    managerName: '',
    checkedBy: '',
    status: 'draft',
    createdAt: '2026-08-31T06:00:00+10:00',
    updatedAt: '2026-08-31T06:00:00+10:00',
    ...over,
  };
}

describe('where it goes', () => {
  it('is addressed to accounts', () => {
    expect(TIMESHEET_INBOX).toBe('accounts@safeqld.com.au');
  });

  it('offers accounts alone, accounts and Matt, and accounts and Lachlan', () => {
    expect(TIMESHEET_ROUTES.map((r) => r.id)).toEqual(['accounts', 'accounts-matt', 'accounts-lachlan']);
    expect(TIMESHEET_MATT).toBe('matt@safeqld.com.au');
    expect(TIMESHEET_LACHLAN).toBe('lachlan@safeqld.com.au');
    expect(timesheetRoute('accounts-matt').to).toEqual([TIMESHEET_INBOX, TIMESHEET_MATT]);
    expect(timesheetRoute('accounts-lachlan').to).toEqual([TIMESHEET_INBOX, TIMESHEET_LACHLAN]);
  });

  /*
   * The one that matters. Everything else in this block is wiring; this is the
   * reason the choice is a fixed list of routes and not a recipient field.
   */
  it('never lets a route drop accounts, whichever one is chosen', () => {
    for (const route of TIMESHEET_ROUTES) {
      expect(route.to).toContain(TIMESHEET_INBOX);
      // A week's pay addressed twice to the same inbox is a second copy of the
      // same email for payroll to reconcile.
      expect(new Set(route.to).size).toBe(route.to.length);
      expect(route.to.every((a) => a.trim() === a && a.includes('@'))).toBe(true);
    }
  });

  it('falls back to accounts alone rather than to whoever was chosen last', () => {
    // An id nobody recognises -- a stale choice, a value from a build that had a
    // fourth route -- must not copy somebody in on a week's pay by accident.
    for (const id of [undefined, null, '', 'accounts-matt ', 'ACCOUNTS-MATT', 'accounts-everyone']) {
      expect(timesheetRoute(id).to).toEqual([TIMESHEET_INBOX]);
    }
  });

  it('gives every route a label short enough to sit three-across, and its own words', () => {
    // `Segmented` renders one line and truncates, so a long label on a handset
    // becomes a choice nobody can read.
    for (const route of TIMESHEET_ROUTES) {
      expect(route.short.length).toBeLessThanOrEqual(12);
      expect(route.action.trim()).not.toBe('');
      expect(route.who.trim()).not.toBe('');
    }
    expect(new Set(TIMESHEET_ROUTES.map((r) => r.action)).size).toBe(TIMESHEET_ROUTES.length);
  });

  it('reads the addresses out the way a person would, so the screen can show them', () => {
    expect(routeAddresses(timesheetRoute('accounts'))).toBe('accounts@safeqld.com.au');
    expect(routeAddresses(timesheetRoute('accounts-matt')))
      .toBe('accounts@safeqld.com.au and matt@safeqld.com.au');
  });
});

describe('subject', () => {
  it('carries the technician and the week, in a fixed shape', () => {
    // A dozen of these land in one inbox each week. Sorting and searching
    // beats reading nicely.
    expect(timesheetSubject(sheet())).toBe('Timesheet — Lachlan Hayes — week starting 31/08/2026');
  });

  it('says so rather than going out blank when there is no name', () => {
    expect(timesheetSubject(sheet({ employeeName: '   ' })))
      .toBe('Timesheet — Unnamed technician — week starting 31/08/2026');
  });
});

describe('body', () => {
  it('names the technician, the week and the vehicle', () => {
    const body = timesheetBody(sheet());
    expect(body).toContain('Timesheet for Lachlan Hayes');
    expect(body).toContain('Week starting 31/08/2026');
    expect(body).toContain('Vehicle 123ABC');
    expect(body).toContain('Odometer 184320');
  });

  it('shows the day, the job and the hours worked', () => {
    const body = timesheetBody(sheet());
    expect(body).toContain('Mon 31/08/2026');
    expect(body).toContain('43747 · BRIC Housing Emsworth St');
    expect(body).toContain('8h 06:30–14:30');
  });

  it('marks overtime and double time, and leaves ordinary unmarked', () => {
    expect(timesheetBody(sheet({ entries: [entry({ hourKind: 'ot' })] }))).toContain('8h O/T');
    expect(timesheetBody(sheet({ entries: [entry({ hourKind: 'dt' })] }))).toContain('8h D/T');
    expect(timesheetBody(sheet())).not.toMatch(/8h (O\/T|D\/T)/);
  });

  it.each([
    ['sick', 'sick'],
    ['rdo', 'RDO'],
    ['annual', 'annual'],
    ['lwop', 'LWOP'],
    ['publicHoliday', 'public holiday'],
  ])('reports %s hours on the day', (field, label) => {
    const body = timesheetBody(sheet({
      entries: [entry({ startTime: '', finishTime: '', [field]: '7.6' } as Partial<TimesheetEntry>)],
    }));
    expect(body).toContain(`7.6h ${label}`);
  });

  it('does not print a column of zeroes for leave nobody took', () => {
    // A block of zeroes on every sheet teaches people to skip the block, and
    // then they skip it on the week it says something.
    const body = timesheetBody(sheet());
    for (const label of ['Sick', 'RDO', 'Annual leave', 'Leave without pay', 'Public holiday']) {
      expect({ label, present: body.includes(`${label}  `) }).toEqual({ label, present: false });
    }
  });

  it('totals worked hours and leave together', () => {
    const body = timesheetBody(sheet({
      entries: [
        entry({ id: 'a', hourKind: 'ord' }),                                        // 8
        entry({ id: 'b', date: '2026-09-01', startTime: '17:00', finishTime: '20:00', hourKind: 'ot' }), // 3
        entry({ id: 'c', date: '2026-09-02', startTime: '', finishTime: '', publicHoliday: '7.6' }),
      ],
    }));
    expect(body).toContain('Ordinary  8');
    expect(body).toContain('Overtime  3');
    expect(body).toContain('Public holiday  7.6');
    expect(body).toContain('TOTAL  18.6');
  });

  it('says a day is empty rather than printing a silent blank', () => {
    const body = timesheetBody(sheet({ entries: [entry({ startTime: '', finishTime: '' })] }));
    expect(body).toContain('nothing recorded');
  });

  it('carries the comment when there is one', () => {
    const body = timesheetBody(sheet({ entries: [entry({ comments: 'Shutdown MAINS & FIP cutover' })] }));
    expect(body).toContain('Shutdown MAINS & FIP cutover');
  });

  it('handles a sheet with no days at all', () => {
    expect(timesheetBody(sheet({ entries: [] }))).toContain('No days were entered');
  });
});

describe('what stops a sheet being sent', () => {
  it('lets a normal sheet through', () => {
    expect(timesheetNotReady(sheet())).toBeNull();
  });

  it('refuses a sheet with no name, which payroll cannot file', () => {
    expect(timesheetNotReady(sheet({ employeeName: '  ' }))).toMatch(/no technician name/i);
  });

  it('refuses a sheet with no days', () => {
    expect(timesheetNotReady(sheet({ entries: [] }))).toMatch(/no days/i);
  });

  it('refuses a sheet whose days are all empty', () => {
    // The dangerous one: it looks filled in, and it is a week's pay missing.
    const empty = entry({ startTime: '', finishTime: '' });
    expect(timesheetNotReady(sheet({ entries: [empty, { ...empty, id: 'e2' }] })))
      .toMatch(/nothing would reach payroll/i);
  });

  it('accepts a week that is only leave', () => {
    // Annual leave is a legitimate whole week and must not be refused as empty.
    const leave = entry({ startTime: '', finishTime: '', annual: '7.6' });
    expect(timesheetNotReady(sheet({ entries: [leave] }))).toBeNull();
  });
});
