import {
  LEAVE_END, LEAVE_KINDS, LEAVE_START, alreadyBooked, buildLeaveEntry, isLeaveEntry, leaveActivityFor,
  leaveKind, leaveKindOfEntry, parseLeaveDay, upcomingWorkingDays,
} from '@/domain/leaveBooking';
import { sendReadiness, toScheduleRequest } from '@/domain/clockOn';

/**
 * A day off, booked onto the Simpro schedule.
 *
 * It rides on the clock's own send path, so the thing worth proving is that
 * what this builds is exactly an entry the clock will send — seven to three,
 * on the right day, under the office's own activity — and that nothing is
 * guessed where the office has not given an activity to book it under.
 */

const OFFICE = [
  { id: '1', name: 'Annual Leave' },
  { id: '13', name: 'Meeting' },
  { id: '14', name: 'RDO' },
  { id: '2', name: 'Sick / Personal Leave' },
  { id: '10', name: 'Unpaid Leave' },
  { id: '8', name: 'Workshop' },
];

describe("the office's activity for a kind of leave", () => {
  it('is matched by name, never pinned by id', () => {
    expect(leaveActivityFor(leaveKind('annual')!, OFFICE)?.id).toBe('1');
    expect(leaveActivityFor(leaveKind('rdo')!, OFFICE)?.id).toBe('14');
    expect(leaveActivityFor(leaveKind('sick')!, OFFICE)?.id).toBe('2');
    expect(leaveActivityFor(leaveKind('unpaid')!, OFFICE)?.id).toBe('10');
  });

  it('survives the office renaming things', () => {
    expect(leaveActivityFor(leaveKind('rdo')!, [{ id: '99', name: 'Rostered day off' }])?.id).toBe('99');
    expect(leaveActivityFor(leaveKind('unpaid')!, [{ id: '7', name: 'Leave without pay' }])?.id).toBe('7');
  });

  it('is nothing where the office has none, rather than a guess', () => {
    expect(leaveActivityFor(leaveKind('unpaid')!, OFFICE.filter((a) => a.id !== '10'))).toBeUndefined();
    // A meeting is not leave.
    expect(LEAVE_KINDS.some((k) => k.match.test('Meeting'))).toBe(false);
  });
});

describe('the entry a day of leave is sent as', () => {
  const built = buildLeaveEntry({
    id: 'e1', employeeId: '45', date: '2026-09-22', kind: leaveKind('annual')!, activity: OFFICE[0]!, note: '  Back Wednesday ',
  });

  it('is seven to three on that Queensland day, closed already', () => {
    expect('entry' in built).toBe(true);
    if (!('entry' in built)) return;
    expect(built.entry.date).toBe('2026-09-22');
    expect(built.entry.startedAt).toBe('2026-09-21T21:00:00.000Z');
    expect(built.entry.endedAt).toBe('2026-09-22T05:00:00.000Z');
    expect(built.entry.kind).toBe('activity');
    expect(built.entry.activityExternalId).toBe('1');
    expect(built.entry.note).toBe('Back Wednesday');
    expect([LEAVE_START, LEAVE_END]).toEqual(['07:00', '15:00']);
  });

  it("passes the clock's own readiness check and becomes an activity schedule", () => {
    if (!('entry' in built)) throw new Error('not built');
    expect(sendReadiness(built.entry)).toEqual({ ready: true });
    const req = toScheduleRequest(built.entry);
    expect(req.path).toBe('activitySchedules/');
    expect(req.body).toMatchObject({
      Staff: 45, Date: '2026-09-22', Activity: 1, Notes: 'Back Wednesday',
      Blocks: [{ StartTime: '07:00', EndTime: '15:00' }],
    });
  });

  it('reads back as leave, and as which kind', () => {
    if (!('entry' in built)) throw new Error('not built');
    expect(isLeaveEntry(built.entry)).toBe(true);
    expect(leaveKindOfEntry(built.entry)?.id).toBe('annual');
    expect(isLeaveEntry({ kind: 'activity', activityName: 'Meeting' })).toBe(false);
    expect(isLeaveEntry({ kind: 'work', activityName: 'Annual Leave' })).toBe(false);
  });

  it('refuses a phone that is nobody in Simpro, in words', () => {
    const r = buildLeaveEntry({ id: 'e', employeeId: '', date: '2026-09-22', kind: leaveKind('rdo')!, activity: OFFICE[2]! });
    expect('refused' in r && r.refused).toContain('not signed in');
  });

  it('refuses a day it cannot read', () => {
    const r = buildLeaveEntry({ id: 'e', employeeId: '45', date: 'tuesday', kind: leaveKind('rdo')!, activity: OFFICE[2]! });
    expect('refused' in r).toBe(true);
  });
});

describe('the days offered', () => {
  it('are working days only, for three weeks, from today', () => {
    const days = upcomingWorkingDays('2026-09-11', 3); // a Friday
    expect(days[0]).toBe('2026-09-11');
    expect(days[1]).toBe('2026-09-14'); // straight to Monday
    expect(days).toHaveLength(15);
    expect(days.some((d) => d === '2026-09-12' || d === '2026-09-13')).toBe(false);
  });

  it('are nothing from a day that is not one', () => {
    expect(upcomingWorkingDays('nope')).toEqual([]);
  });
});

describe('a typed day', () => {
  it('reads the ways people write it', () => {
    expect(parseLeaveDay('7/10/2026')).toBe('2026-10-07');
    expect(parseLeaveDay('07-10-26')).toBe('2026-10-07');
    expect(parseLeaveDay('2026-10-07')).toBe('2026-10-07');
  });

  it('refuses a day that does not exist', () => {
    expect(parseLeaveDay('31/9/2026')).toBeUndefined();
    expect(parseLeaveDay('next friday')).toBeUndefined();
    expect(parseLeaveDay('')).toBeUndefined();
  });
});

describe('a day already booked', () => {
  it('is said before the tap, and says where it is', () => {
    expect(alreadyBooked('2026-09-22', [{ date: '2026-09-22', activityName: 'RDO', where: 'office' }]))
      .toBe('RDO is already on your Simpro schedule for that day.');
    expect(alreadyBooked('2026-09-22', [{ date: '2026-09-22', activityName: 'Annual Leave', where: 'phone' }]))
      .toContain('waiting to send');
    expect(alreadyBooked('2026-09-23', [{ date: '2026-09-22', where: 'office' }])).toBeUndefined();
  });
});
