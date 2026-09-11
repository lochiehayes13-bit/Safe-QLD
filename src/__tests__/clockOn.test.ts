import {
  MAX_ENTRY_MINUTES, addDays, clockContentKey, clockPayload, dayTotals, describeEntry, entryMinutes, entrySpan,
  findAcceptedSchedule, formatMinutes, openEntryOf, qldClock, qldInstant, qldNextMidnight, sendReadiness, shortDay,
  splitAcrossMidnight, startEntry, stopEntry, switchJob, toScheduleBody, toScheduleRequest, validateTimes, weekStartOf,
  weekTotals, type ClockEntry,
} from '@/domain/clockOn';

/**
 * The clock-on model, with the clock held still.
 *
 * Every instant here is UTC, and every day it is checked against is the
 * Queensland one: 06:30Z is half past four in the afternoon in Brisbane on
 * the same date, 15:00Z is one in the morning tomorrow. Those two are the
 * whole of what the model has to get right about dates.
 */

let n = 0;
const ids = () => `e${++n}`;
beforeEach(() => { n = 0; });

const EMP = '77';

const work = (over: Partial<ClockEntry> = {}): ClockEntry => ({
  id: 'w1', employeeExternalId: EMP, kind: 'work',
  jobExternalId: '1001', jobSectionExternalId: '5', jobCostCenterExternalId: '9',
  jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower',
  date: '2026-09-08', startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T23:30:00.000Z',
  ...over,
});

describe('the Queensland clock', () => {
  it('reads an instant as Brisbane wall time', () => {
    expect(qldClock('2026-09-07T21:00:00.000Z')).toBe('07:00');
    expect(qldClock('2026-09-08T06:30:00.000Z')).toBe('16:30');
    expect(qldClock('2026-09-08T15:00:00.000Z')).toBe('01:00');
    expect(qldClock('nonsense')).toBeUndefined();
  });

  it('turns a day and a clock time back into the instant', () => {
    expect(qldInstant('2026-09-08', '07:00')).toBe('2026-09-07T21:00:00.000Z');
    expect(qldInstant('2026-09-08', '24:00')).toBeUndefined();
    expect(qldInstant('2026-09-08', '7am')).toBeUndefined();
    expect(qldInstant('2026-02-30', '07:00')).toBeUndefined();
  });

  it('knows where the day ends', () => {
    expect(qldNextMidnight('2026-09-08')).toBe('2026-09-08T14:00:00.000Z');
    expect(addDays('2026-09-08', 1)).toBe('2026-09-09');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('starts the week on Monday', () => {
    expect(weekStartOf('2026-09-08')).toBe('2026-09-07'); // a Tuesday
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07'); // Monday itself
    expect(weekStartOf('2026-09-13')).toBe('2026-09-07'); // Sunday belongs to the week before
  });
});

describe('clocking on', () => {
  it('dates the entry by the Queensland day, not the UTC one', () => {
    // 15:00Z on the 8th is 01:00 on the 9th in Brisbane.
    const late = startEntry([], { employeeExternalId: EMP, kind: 'work', jobExternalId: '1001' }, '2026-09-08T15:00:00.000Z', ids);
    expect(late.opened.date).toBe('2026-09-09');
    // 06:30Z is the same afternoon.
    const same = startEntry([], { employeeExternalId: EMP, kind: 'work', jobExternalId: '1001' }, '2026-09-08T06:30:00.000Z', ids);
    expect(same.opened.date).toBe('2026-09-08');
  });

  it('keeps at most one entry open, closing the old one at the same instant', () => {
    const first = startEntry([], { employeeExternalId: EMP, kind: 'work', jobExternalId: '1001' }, '2026-09-07T21:00:00.000Z', ids);
    const second = switchJob(first.entries, { employeeExternalId: EMP, jobExternalId: '1002' }, '2026-09-07T23:00:00.000Z', ids);
    expect(second.entries).toHaveLength(2);
    expect(second.closed).toHaveLength(1);
    expect(second.closed[0]?.id).toBe(first.opened.id);
    expect(second.closed[0]?.endedAt).toBe('2026-09-07T23:00:00.000Z');
    expect(second.opened.startedAt).toBe('2026-09-07T23:00:00.000Z');
    expect(second.opened.kind).toBe('work');
    expect(second.entries.filter((e) => !e.endedAt)).toHaveLength(1);
    expect(openEntryOf(second.entries)?.id).toBe(second.opened.id);
  });

  it('carries no undefined fields, so a round trip through JSON is the same entry', () => {
    const { opened } = startEntry([], { employeeExternalId: EMP, kind: 'break', jobExternalId: undefined }, '2026-09-07T21:00:00.000Z', ids);
    expect(JSON.parse(JSON.stringify(opened))).toEqual(opened);
  });

  it('stops nothing without complaint', () => {
    const r = stopEntry([work()], '2026-09-08T00:00:00.000Z');
    expect(r.closed).toEqual([]);
    expect(r.entries).toEqual([work()]);
    const s = startEntry([work()], { employeeExternalId: EMP, kind: 'break' }, '2026-09-08T00:00:00.000Z', ids);
    expect(s.closed).toEqual([]);
  });

  it('hands back every piece a switch closed, so each can be sent', () => {
    // On at 22:00 Brisbane; switched to another job at 02:00 the next morning.
    const open = work({ endedAt: undefined, startedAt: '2026-09-08T12:00:00.000Z', date: '2026-09-08' });
    const r = switchJob([open], { employeeExternalId: EMP, jobExternalId: '1002' }, '2026-09-08T16:00:00.000Z', ids);
    expect(r.closed.map((e) => [e.id, e.date])).toEqual([['w1', '2026-09-08'], ['e1', '2026-09-09']]);
    expect(r.opened.id).toBe('e2');
    expect(r.entries.map((e) => e.id)).toEqual(['w1', 'e1', 'e2']);
  });
});

describe('an entry that ran past midnight', () => {
  it('is split at the Queensland midnight into one entry per day', () => {
    // On at 22:00 Brisbane, off at 02:00 the next morning.
    const open = work({ endedAt: undefined, startedAt: '2026-09-08T12:00:00.000Z', date: '2026-09-08' });
    const r = stopEntry([open], '2026-09-08T16:00:00.000Z', ids);
    expect(r.entries).toHaveLength(2);
    const [a, b] = r.entries;
    expect(a).toMatchObject({ id: 'w1', date: '2026-09-08', startedAt: '2026-09-08T12:00:00.000Z', endedAt: '2026-09-08T14:00:00.000Z' });
    expect(b).toMatchObject({ id: 'e1', date: '2026-09-09', startedAt: '2026-09-08T14:00:00.000Z', endedAt: '2026-09-08T16:00:00.000Z', jobExternalId: '1001' });
    expect(r.closed.map((e) => e.id)).toEqual(['w1', 'e1']);
    expect(entryMinutes(a!)).toBe(120);
    expect(entryMinutes(b!)).toBe(120);
  });

  it('leaves an entry inside its day alone, and an open one alone', () => {
    expect(splitAcrossMidnight(work(), ids)).toEqual([work()]);
    const open = work({ endedAt: undefined });
    expect(splitAcrossMidnight(open, ids)).toEqual([open]);
  });

  it('gives the second piece a clean send state', () => {
    const sent = work({ endedAt: '2026-09-08T16:00:00.000Z', startedAt: '2026-09-08T12:00:00.000Z', sentAt: '2026-09-08T16:01:00.000Z', simproUid: '4' });
    const [, b] = splitAcrossMidnight(sent, ids);
    expect(b?.sentAt).toBeUndefined();
    expect(b?.simproUid).toBeUndefined();
  });
});

describe('minutes', () => {
  it('rounds to the nearest whole minute', () => {
    expect(entryMinutes({ startedAt: '2026-09-07T21:00:29.000Z', endedAt: '2026-09-07T21:59:31.000Z' })).toBe(59);
    expect(entryMinutes({ startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T21:59:31.000Z' })).toBe(60);
    expect(entryMinutes({ startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T21:00:20.000Z' })).toBe(0);
  });

  it('refuses a span that runs backwards or past eighteen hours, in words', () => {
    expect(entrySpan({ startedAt: '2026-09-07T22:00:00.000Z', endedAt: '2026-09-07T21:00:00.000Z' }))
      .toEqual({ minutes: 0, refused: 'Ends before it starts' });
    expect(entrySpan({ startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-08T15:01:00.000Z' }))
      .toEqual({ minutes: 0, refused: 'Longer than 18 hours: check the times' });
    expect(entrySpan({ startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-08T15:00:00.000Z' }).minutes).toBe(MAX_ENTRY_MINUTES);
    expect(entrySpan({ startedAt: 'x', endedAt: '2026-09-08T15:00:00.000Z' }).refused).toBe('The times could not be read');
  });

  it('measures a running entry to now, and refuses it without a now', () => {
    const open = { startedAt: '2026-09-07T21:00:00.000Z' };
    expect(entryMinutes(open, '2026-09-07T21:45:00.000Z')).toBe(45);
    expect(entrySpan(open)).toEqual({ minutes: 0, refused: 'Still running' });
  });

  it('prints hours and minutes the way a timesheet reads', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(65)).toBe('1h 05m');
    expect(formatMinutes(600)).toBe('10h 00m');
  });
});

describe('editing the times', () => {
  it('keeps an entry inside its day', () => {
    const e = { date: '2026-09-08' };
    expect(validateTimes(e, '2026-09-07T21:00:00.000Z', '2026-09-08T04:00:00.000Z')).toBeUndefined();
    expect(validateTimes(e, '2026-09-07T21:00:00.000Z', '2026-09-08T14:00:00.000Z')).toBeUndefined(); // to midnight is still the day
    expect(validateTimes(e, '2026-09-07T21:00:00.000Z', '2026-09-08T14:01:00.000Z')).toMatch(/after midnight/);
    expect(validateTimes(e, '2026-09-07T13:00:00.000Z', '2026-09-08T04:00:00.000Z')).toMatch(/different day/);
    expect(validateTimes(e, '2026-09-08T04:00:00.000Z', '2026-09-07T21:00:00.000Z')).toBe('Ends before it starts');
  });
});

describe('totals', () => {
  const day = '2026-09-08';
  const entries: ClockEntry[] = [
    work({ id: 'a', startedAt: '2026-09-07T21:00:00.000Z', endedAt: '2026-09-07T23:00:00.000Z' }),
    work({ id: 't', kind: 'travel', jobExternalId: undefined, activityName: 'Travel', startedAt: '2026-09-07T23:00:00.000Z', endedAt: '2026-09-07T23:30:00.000Z' }),
    work({ id: 'b', jobExternalId: '1002', jobTitle: 'Hydrant flow', startedAt: '2026-09-07T23:30:00.000Z', endedAt: '2026-09-08T01:30:00.000Z' }),
    work({ id: 'br', kind: 'break', jobExternalId: undefined, startedAt: '2026-09-08T01:30:00.000Z', endedAt: '2026-09-08T02:00:00.000Z' }),
    work({ id: 'c', startedAt: '2026-09-08T02:00:00.000Z', endedAt: '2026-09-08T03:00:00.000Z' }),
    // Yesterday, and not today's business.
    work({ id: 'y', date: '2026-09-07', startedAt: '2026-09-06T21:00:00.000Z', endedAt: '2026-09-07T05:00:00.000Z' }),
    // Running, and only counted when the caller says when now is.
    work({ id: 'open', endedAt: undefined, startedAt: '2026-09-08T03:00:00.000Z' }),
  ];

  it('adds a day up by kind and by job', () => {
    const t = dayTotals(entries, day);
    expect(t.workMinutes).toBe(120 + 120 + 60);
    expect(t.travelMinutes).toBe(30);
    expect(t.breakMinutes).toBe(30);
    expect(t.byJob).toEqual([
      { jobExternalId: '1001', jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower', minutes: 180 },
      { jobExternalId: '1002', jobTitle: 'Hydrant flow', siteName: 'Fictional Tower', minutes: 120 },
    ]);
    expect(t.refused).toEqual([{ id: 'open', why: 'Still running' }]);
  });

  it('counts the running entry to now when given one', () => {
    const t = dayTotals(entries, day, '2026-09-08T03:20:00.000Z');
    expect(t.workMinutes).toBe(320);
    expect(t.refused).toEqual([]);
  });

  it('adds the week up from Monday, with every day present', () => {
    const w = weekTotals(entries, day);
    expect(w.weekStart).toBe('2026-09-07');
    expect(w.weekEnd).toBe('2026-09-13');
    expect(w.days.map((d) => d.day)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
    expect(w.workMinutes).toBe(480 + 300);
    expect(w.byJob[0]).toEqual({ jobExternalId: '1001', jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower', minutes: 660 });
  });
});

describe('what goes to Simpro', () => {
  it('posts a job entry as a schedule block on the cost centre, in Brisbane time', () => {
    expect(toScheduleRequest(work())).toEqual({
      path: 'jobs/1001/sections/5/costCenters/9/schedules/',
      body: { Staff: 77, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '09:30' }] },
    });
    expect(toScheduleBody).toBe(toScheduleRequest);
  });

  it('carries the schedule rate when the entry has one', () => {
    const r = toScheduleRequest(work({ scheduleRateId: '3', scheduleRateName: 'Overtime' }));
    expect(r.body.Blocks[0]).toEqual({ StartTime: '07:00', EndTime: '09:30', ScheduleRate: 3 });
  });

  it('writes a block that runs to midnight as ending at 23:59, a minute short rather than a guess', () => {
    const r = toScheduleRequest(work({ startedAt: '2026-09-08T12:00:00.000Z', endedAt: '2026-09-08T14:00:00.000Z' }));
    expect(r.body.Blocks[0]).toEqual({ StartTime: '22:00', EndTime: '23:59' });
  });

  it('posts travel and other activities as an activity schedule', () => {
    const travel = work({
      kind: 'travel', jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined,
      activityExternalId: '12', activityName: 'Travel', note: 'Out to the coast',
    });
    expect(toScheduleRequest(travel)).toEqual({
      path: 'activitySchedules/',
      body: { Staff: 77, Date: '2026-09-08', Activity: 12, Blocks: [{ StartTime: '07:00', EndTime: '09:30' }], Notes: 'Out to the coast' },
    });
  });

  it('says why an entry cannot go, in a word', () => {
    expect(sendReadiness(work())).toEqual({ ready: true });
    expect(sendReadiness(work({ endedAt: undefined }))).toEqual({ ready: false, why: 'Still running' });
    expect(sendReadiness(work({ sentAt: '2026-09-08T01:00:00.000Z' }))).toEqual({ ready: false, why: 'Already sent' });
    expect(sendReadiness(work({ kind: 'break' })).ready).toBe(false);
    expect(sendReadiness(work({ jobCostCenterExternalId: undefined })))
      .toEqual({ ready: false, why: 'No cost centre on this job yet' });
    expect(sendReadiness(work({ jobExternalId: undefined }))).toEqual({ ready: false, why: 'No job on this entry' });
    expect(sendReadiness(work({ employeeExternalId: '' }))).toEqual({ ready: false, why: 'No Simpro employee on this entry' });
    expect(sendReadiness(work({ kind: 'travel', activityName: 'Travel', activityExternalId: undefined })).ready).toBe(false);
    expect(sendReadiness(work({ endedAt: '2026-09-07T21:00:10.000Z' }))).toEqual({ ready: false, why: 'Under a minute: nothing to send' });
    expect(sendReadiness(work({ endedAt: '2026-09-08T15:00:00.000Z' }))).toEqual({ ready: false, why: 'Runs past midnight: split it first' });
    expect(() => toScheduleRequest(work({ endedAt: undefined }))).toThrow(/Still running/);
  });

  it('keys the queue on the entry, not on the times', () => {
    expect(clockContentKey('w1')).toBe('timesheet-block|w1');
    expect(clockPayload(work())).toEqual({ entryId: 'w1', jobId: '1001', kind: 'work' });
  });
});

describe('the block the office already holds', () => {
  const request = toScheduleRequest(work());
  const record = (over: Record<string, unknown> = {}) => ({
    ID: 4410, Staff: { ID: 77, Name: 'Somebody' }, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '09:30' }], ...over,
  });

  it('finds this block by staff, date, start and end, and answers with its id', () => {
    expect(findAcceptedSchedule([record()], request)).toBe('4410');
    expect(findAcceptedSchedule([record({ Blocks: [{ StartTime: '06:00', EndTime: '06:30' }, { StartTime: '07:00', EndTime: '09:30' }] })], request)).toBe('4410');
    expect(findAcceptedSchedule([record({ ID: '12' })], request)).toBe('12');
  });

  it('does not mistake another block for it', () => {
    expect(findAcceptedSchedule([], request)).toBeUndefined();
    expect(findAcceptedSchedule([record({ Staff: { ID: 78 } })], request)).toBeUndefined();
    expect(findAcceptedSchedule([record({ Date: '2026-09-09' })], request)).toBeUndefined();
    expect(findAcceptedSchedule([record({ Blocks: [{ StartTime: '07:00', EndTime: '09:31' }] })], request)).toBeUndefined();
    expect(findAcceptedSchedule([record({ Blocks: null })], request)).toBeUndefined();
    expect(findAcceptedSchedule([record({ ID: undefined })], request)).toBeUndefined();
  });

  it('wants the same activity for an activity block, since the same minutes on another are not this one', () => {
    const travel = toScheduleRequest(work({
      kind: 'travel', jobExternalId: undefined, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined, activityExternalId: '12',
    }));
    expect(findAcceptedSchedule([record({ Activity: { ID: 12 } })], travel)).toBe('4410');
    expect(findAcceptedSchedule([record({ Activity: { ID: 13 } })], travel)).toBeUndefined();
    // A list read without the activity column still matches on the rest.
    expect(findAcceptedSchedule([record()], travel)).toBe('4410');
  });
});

describe('naming an entry for a person', () => {
  it('says the job, the times and the day', () => {
    expect(describeEntry(work())).toBe('Hours on job 1001, 07:00–09:30, 8 Sep');
    expect(describeEntry(work({ kind: 'travel', activityName: 'Travel' }))).toBe('Travel, 07:00–09:30, 8 Sep');
    expect(describeEntry(work({ kind: 'activity', activityName: undefined }))).toBe('Activity, 07:00–09:30, 8 Sep');
    expect(describeEntry(work({ kind: 'break', endedAt: undefined }))).toBe('Break, 07:00–now, 8 Sep');
    expect(shortDay('2026-12-01')).toBe('1 Dec');
    expect(shortDay('nonsense')).toBe('nonsense');
  });
});
