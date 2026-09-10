import {
  DAY_END, DAY_START, DEFAULT_TRAVEL_MINUTES, MIN_BLOCK_MINUTES, blockMinutes, bookingsFor, dayHeadline,
  layOutDay, moveStop,
} from '@/domain/dayBuilder';

/**
 * Building a day and putting it on the schedule.
 *
 * Laid out from seven as back-to-back blocks with travel between, sized
 * from the estimate, and turned into one booking per stop that has a job.
 * A site with no job is laid out so the day's total is honest and marked
 * not bookable so nothing is posted against thin air.
 */

const sites = [
  { siteId: 'a', siteName: 'Tower', estimateHours: 2, job: { externalId: '41900', title: 'Annual' } },
  { siteId: 'b', siteName: 'Shed', estimateHours: 0.75 },
  { siteId: 'c', siteName: 'Clinic', estimateHours: 3.4, job: { externalId: '41950' } },
];

describe('laying out the day', () => {
  it('runs from seven, back to back, with travel between stops', () => {
    const day = layOutDay(sites);
    expect(day.stops.map((s) => [s.start, s.end])).toEqual([
      ['07:00', '09:00'],
      ['09:20', '10:05'],
      ['10:25', '13:55'], // 3.4 h rounds to the quarter hour: 3.5
    ]);
    expect(day.stops[1]!.travelMinutes).toBe(DEFAULT_TRAVEL_MINUTES);
    expect(day.stops[0]!.travelMinutes).toBe(0);
    expect(day.totalHours).toBe(7);
    expect(day.endsAt).toBe('13:55');
    expect(day.overrunHours).toBe(0);
    expect([DAY_START, DAY_END]).toEqual(['07:00', '15:30']);
  });

  it('says how far past the shift it runs rather than squeezing the last site', () => {
    const day = layOutDay([...sites, { siteId: 'd', siteName: 'Big', estimateHours: 4 }]);
    expect(day.overrunHours).toBe(2.75);
    expect(dayHeadline(day)).toContain('past the end of the shift');
  });

  it('marks a site with no job as not bookable, and says why', () => {
    const day = layOutDay(sites);
    expect(day.stops[1]!.bookable).toBe(false);
    expect(day.stops[1]!.why).toContain('raise one');
    expect(day.stops[0]!.bookable).toBe(true);
  });

  it('never makes a block the calendar cannot read', () => {
    expect(blockMinutes(0)).toBe(MIN_BLOCK_MINUTES);
    expect(blockMinutes(0.1)).toBe(MIN_BLOCK_MINUTES);
    expect(blockMinutes(1.2)).toBe(75);
  });

  it('is empty for no sites', () => {
    const day = layOutDay([]);
    expect(day).toEqual({ stops: [], totalHours: 0, overrunHours: 0, endsAt: undefined });
    expect(dayHeadline(day)).toBe('Nothing on the day yet');
  });

  it('takes a different start and travel allowance', () => {
    const day = layOutDay(sites.slice(0, 2), { start: '08:00', travelMinutes: 0 });
    expect(day.stops.map((s) => s.start)).toEqual(['08:00', '10:00']);
  });
});

describe('reordering', () => {
  it('moves a stop one place, and leaves the ends alone', () => {
    expect(moveStop(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveStop(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveStop(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the bookings a day becomes', () => {
  it('is one payload per stop with a job, in order, all with the same undo moment', () => {
    const day = layOutDay(sites);
    const plan = bookingsFor(day, { employeeId: '45', date: '2026-09-15', notBefore: '2026-09-15T00:01:00.000Z' });
    expect(plan.payloads.map((p) => [p.jobId, p.start, p.end])).toEqual([['41900', '07:00', '09:00'], ['41950', '10:25', '13:55']]);
    expect(plan.payloads.every((p) => p.notBefore === '2026-09-15T00:01:00.000Z' && p.employeeId === '45' && p.date === '2026-09-15')).toBe(true);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.stop.siteName).toBe('Shed');
  });

  it('books nothing for a phone that is nobody in Simpro, and says so', () => {
    const plan = bookingsFor(layOutDay(sites), { employeeId: '', date: '2026-09-15', notBefore: 'x' });
    expect(plan.payloads).toEqual([]);
    expect(plan.skipped.some((s) => s.why.includes('not signed in'))).toBe(true);
  });

  it('refuses a day it cannot read', () => {
    const plan = bookingsFor(layOutDay(sites), { employeeId: '45', date: 'tuesday', notBefore: 'x' });
    expect(plan.payloads).toEqual([]);
  });
});
