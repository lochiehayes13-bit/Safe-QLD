import { MAX_LEAVE_DAYS, leaveDays, planLeave, tapLeaveDay } from '@/domain/leaveRange';
import type { ExistingLeave } from '@/domain/leaveBooking';

/**
 * Booking a run of days off in one go.
 *
 * 2026-10-12 is a Monday. Each day in a run is booked as a single day is, so
 * what is checked here is which days a run turns into and which it leaves out.
 */

describe('the days a pick books', () => {
  it('books one day as picked, a weekend day included', () => {
    expect(leaveDays('2026-10-14')).toEqual({ days: ['2026-10-14'] });
    expect(leaveDays('2026-10-17', '2026-10-17')).toEqual({ days: ['2026-10-17'] });
  });

  it('books the weekdays of a run and skips the weekend', () => {
    expect(leaveDays('2026-10-15', '2026-10-20')).toEqual({
      days: ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'],
    });
  });

  it('refuses a run that ends before it starts, or has no weekdays', () => {
    expect(leaveDays('2026-10-20', '2026-10-15')).toEqual({ refused: expect.stringContaining('before') });
    expect(leaveDays('2026-10-17', '2026-10-18')).toEqual({ refused: expect.stringContaining('No weekdays') });
  });

  it('refuses a run long enough to be a typo in the year', () => {
    const r = leaveDays('2026-10-12', '2027-10-12');
    expect('refused' in r).toBe(true);
    const ok = leaveDays('2026-10-12', '2026-12-31');
    expect('days' in ok && ok.days.length <= MAX_LEAVE_DAYS).toBe(true);
  });
});

describe('a run against what is already booked', () => {
  const existing: ExistingLeave[] = [
    { date: '2026-10-14', activityName: 'RDO', where: 'office' },
    { date: '2026-10-21', activityName: 'Annual Leave', where: 'phone' },
  ];

  it('books the free days and leaves out the booked ones', () => {
    const plan = planLeave({ from: '2026-10-12', to: '2026-10-16' }, '2026-10-09', existing);
    expect(plan.refused).toBeUndefined();
    expect(plan.book).toEqual(['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16']);
    expect(plan.skipped).toEqual(['2026-10-14']);
  });

  it('refuses a single day already booked, in the single-day words', () => {
    const plan = planLeave({ from: '2026-10-14' }, '2026-10-09', existing);
    expect(plan.book).toEqual([]);
    expect(plan.refused).toContain('RDO');
  });

  it('refuses a run with every day already booked', () => {
    const plan = planLeave({ from: '2026-10-14', to: '2026-10-14' }, '2026-10-09', existing);
    expect(plan.refused).toBeTruthy();
    const both = planLeave({ from: '2026-10-21', to: '2026-10-21' }, '2026-10-09', existing);
    expect(both.book).toEqual([]);
  });

  it('refuses a start in the past', () => {
    expect(planLeave({ from: '2026-10-05', to: '2026-10-16' }, '2026-10-09', []).refused).toContain('passed');
  });
});

describe('tapping the day chips', () => {
  it('picks a first day, then a last day', () => {
    const first = tapLeaveDay({}, '2026-10-12');
    expect(first).toEqual({ from: '2026-10-12' });
    expect(tapLeaveDay(first, '2026-10-16')).toEqual({ from: '2026-10-12', to: '2026-10-16' });
  });

  it('starts again on an earlier day, or after a finished run', () => {
    expect(tapLeaveDay({ from: '2026-10-14' }, '2026-10-12')).toEqual({ from: '2026-10-12' });
    expect(tapLeaveDay({ from: '2026-10-12', to: '2026-10-16' }, '2026-10-20')).toEqual({ from: '2026-10-20' });
  });

  it('clears when the same day is tapped again', () => {
    expect(tapLeaveDay({ from: '2026-10-12' }, '2026-10-12')).toEqual({});
  });
});
