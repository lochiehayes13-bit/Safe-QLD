import {
  informationBody, informationNotReady, informationSubject, requestJobFromRoute, withPickedJob,
  type InformationRequest,
} from '@/domain/requests';
import { copyForNextWeek, type Timesheet, type TimesheetEntry } from '@/domain/timesheet';

function rfi(over: Partial<InformationRequest> = {}): InformationRequest {
  return {
    technicianName: 'Lachlan Hayes',
    jobNumber: '9001',
    siteName: 'Fictional Tower Main St',
    question: 'The riser cupboard is locked and the building manager is not answering. Who holds a key?',
    blocking: false,
    ...over,
  };
}

describe('request for information', () => {
  it('puts the job and site in the subject so the answer can be filed', () => {
    expect(informationSubject(rfi()))
      .toBe('RFI — 9001 · Fictional Tower Main St — Lachlan Hayes');
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

describe('the job a question is about', () => {
  it('takes the job and site the job screen opened it with', () => {
    expect(requestJobFromRoute({ job: '9001', site: 'Fictional Tower' }))
      .toEqual({ jobNumber: '9001', siteName: 'Fictional Tower' });
  });

  it('reads a repeated or blank parameter as text, never as a list or a space', () => {
    expect(requestJobFromRoute({ job: ['9001', '9002'], site: '  ' }))
      .toEqual({ jobNumber: '9001', siteName: '' });
    expect(requestJobFromRoute({})).toEqual({ jobNumber: '', siteName: '' });
  });

  it('fills the number and the site from a picked job', () => {
    expect(withPickedJob({ jobNumber: '', siteName: 'Wrong building' }, { externalId: '9001', siteName: 'Fictional Tower' }))
      .toEqual({ jobNumber: '9001', siteName: 'Fictional Tower' });
  });

  it('keeps the typed site where the job has none', () => {
    expect(withPickedJob({ jobNumber: '9001', siteName: 'Plant room, Main St' }, { externalId: '9001', siteName: ' ' }))
      .toEqual({ jobNumber: '9001', siteName: 'Plant room, Main St' });
  });

  it('keeps a typed number where the pick carries none', () => {
    expect(withPickedJob({ jobNumber: '9001', siteName: '' }, { siteName: 'Fictional Tower' }))
      .toEqual({ jobNumber: '9001', siteName: 'Fictional Tower' });
  });
});

describe('copying last week', () => {
  const entry = (over: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
    id: 'old', date: '2026-08-31', jobNumber: '9001', siteName: 'Fictional Tower',
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
      jobNumber: '9001', siteName: 'Fictional Tower',
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
