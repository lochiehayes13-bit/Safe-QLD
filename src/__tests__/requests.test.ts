import {
  informationBody, informationNotReady, informationSubject,
  leaveBody, leaveNotReady, leaveSubject, workingDays,
  type InformationRequest, type LeaveRequest,
} from '@/domain/requests';
import { copyForNextWeek, type Timesheet, type TimesheetEntry } from '@/domain/timesheet';

function rfi(over: Partial<InformationRequest> = {}): InformationRequest {
  return {
    technicianName: 'Lachlan Hayes',
    jobNumber: '43747',
    siteName: 'BRIC Housing Emsworth St',
    question: 'The riser cupboard is locked and the building manager is not answering. Who holds a key?',
    blocking: false,
    ...over,
  };
}

function leave(over: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    technicianName: 'Lachlan Hayes',
    leaveType: 'Annual',
    fromDate: '2026-09-07',
    toDate: '2026-09-11',
    reason: '',
    ...over,
  };
}

describe('request for information', () => {
  it('puts the job and site in the subject so the answer can be filed', () => {
    expect(informationSubject(rfi()))
      .toBe('RFI — 43747 · BRIC Housing Emsworth St — Lachlan Hayes');
  });

  it('says in the subject when someone is standing still', () => {
    // The office triages by subject line. "Held up" has to be visible without
    // opening anything.
    expect(informationSubject(rfi({ blocking: true }))).toMatch(/^HELD UP —/);
  });

  it('leads the body with the fact that work has stopped', () => {
    // First line, so it shows in the preview pane.
    const body = informationBody(rfi({ blocking: true }));
    expect(body.split('\n')[0]).toBe('WORK IS STOPPED WAITING ON THIS ANSWER.');
  });

  it('does not shout when nothing is blocked', () => {
    expect(informationBody(rfi())).not.toMatch(/WORK IS STOPPED/);
  });

  it('carries the question itself', () => {
    expect(informationBody(rfi())).toContain('Who holds a key?');
  });

  it('copes with a question that belongs to no job', () => {
    expect(informationSubject(rfi({ jobNumber: '', siteName: '' })))
      .toBe('RFI — No job given — Lachlan Hayes');
  });

  it.each([
    ['no name', { technicianName: ' ' }, /set your name/i],
    ['a one-word question', { question: 'key?' }, /write the question out/i],
  ])('refuses %s', (_what, over, pattern) => {
    expect(informationNotReady(rfi(over))).toMatch(pattern);
  });

  it('lets a proper question through', () => {
    expect(informationNotReady(rfi())).toBeNull();
  });
});

describe('leave request', () => {
  it('names the person and the span', () => {
    expect(leaveSubject(leave()))
      .toBe('Leave request — Lachlan Hayes — 07/09/2026 to 11/09/2026');
  });

  it('reads as one day when it is one day', () => {
    expect(leaveSubject(leave({ fromDate: '2026-09-07', toDate: '2026-09-07' })))
      .toBe('Leave request — Lachlan Hayes — 07/09/2026');
  });

  it('counts working days, not calendar days', () => {
    // Mon to Fri.
    expect(leaveBody(leave())).toContain('Working days: 5');
  });

  it('says plainly that it is a request', () => {
    // Nobody should read a sent email as approved leave.
    expect(leaveBody(leave())).toMatch(/request, not an approval/i);
  });

  it.each([
    ['no name', { technicianName: '' }, /set your name/i],
    ['no type', { leaveType: '' }, /what kind of leave/i],
    ['a backwards range', { fromDate: '2026-09-11', toDate: '2026-09-07' }, /before the first day/i],
    ['a missing date', { toDate: '' }, /pick both dates/i],
  ])('refuses %s', (_what, over, pattern) => {
    expect(leaveNotReady(leave(over))).toMatch(pattern);
  });
});

describe('working days', () => {
  it.each([
    ['Mon to Fri', '2026-09-07', '2026-09-11', 5],
    ['a single Wednesday', '2026-09-09', '2026-09-09', 1],
    ['a single Saturday', '2026-09-12', '2026-09-12', 0],
    ['a full fortnight', '2026-09-07', '2026-09-18', 10],
    ['a weekend only', '2026-09-12', '2026-09-13', 0],
  ])('counts %s as %s', (_what, from, to, expected) => {
    expect(workingDays(from, to)).toBe(expected);
  });

  it('is zero when the range runs backwards', () => {
    expect(workingDays('2026-09-11', '2026-09-07')).toBe(0);
  });
});

describe('copying last week', () => {
  const entry = (over: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
    id: 'old', date: '2026-08-31', jobNumber: '43747', siteName: 'BRIC Housing',
    serviceReportNumber: 'SR-9912', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: 'Replaced 3 detectors',
    ...over,
  });
  const previous: Timesheet = {
    id: 'p', employeeName: 'Lachlan Hayes', vehicleRego: '123ABC', kilometerReading: '1',
    weekStarting: '2026-08-31', entries: [entry()], managerName: '', checkedBy: '',
    status: 'submitted', createdAt: '', updatedAt: '',
  };
  let n = 0;
  const ids = () => `new-${++n}`;

  it('moves each day forward by exactly a week, so a Monday stays a Monday', () => {
    const [copied] = copyForNextWeek(previous, '2026-09-07', ids);
    expect(copied!.date).toBe('2026-09-07');
  });

  it('keeps the shape of the week', () => {
    const [copied] = copyForNextWeek(previous, '2026-09-07', ids);
    expect({
      jobNumber: copied!.jobNumber, siteName: copied!.siteName,
      startTime: copied!.startTime, finishTime: copied!.finishTime, hourKind: copied!.hourKind,
    }).toEqual({
      jobNumber: '43747', siteName: 'BRIC Housing',
      startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
    });
  });

  it.each(['sick', 'rdo', 'annual', 'lwop', 'publicHoliday'] as const)(
    'never carries %s across',
    (field) => {
      // Copying last week's annual leave claims a day off nobody took.
      const withLeave = { ...previous, entries: [entry({ [field]: '7.6' } as Partial<TimesheetEntry>)] };
      const [copied] = copyForNextWeek(withLeave, '2026-09-07', ids);
      expect({ field, value: copied![field] }).toEqual({ field, value: '' });
    },
  );

  it('drops the service report number, which belongs to one visit', () => {
    const [copied] = copyForNextWeek(previous, '2026-09-07', ids);
    expect(copied!.serviceReportNumber).toBe('');
  });

  it('drops last week\'s comments', () => {
    const [copied] = copyForNextWeek(previous, '2026-09-07', ids);
    expect(copied!.comments).toBe('');
  });

  it('gives every copied day a new id', () => {
    const copied = copyForNextWeek(previous, '2026-09-07', ids);
    expect(copied[0]!.id).not.toBe('old');
  });
});
