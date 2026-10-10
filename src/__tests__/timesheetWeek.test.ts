import {
  WEEK_START_DAY, blankEntry, isWeekendDay, nextTimesFor, weekDates, weekStartFor, type TimesheetEntry,
} from '@/domain/timesheet';

/**
 * The pay week runs Wednesday to Tuesday.
 *
 * A sheet that started on Monday put the last two days of one pay week onto
 * the next sheet, which is how hours went missing from a pay run. The start
 * day lives in one constant, and everything that reads a week reads it from
 * the sheet's own `weekStarting`, so an old Monday sheet still opens as the
 * week it was.
 */

describe('the pay week', () => {
  it('starts on Wednesday', () => {
    expect(WEEK_START_DAY).toBe(3);
  });

  it.each([
    ['2026-09-09', '2026-09-09'], // a Wednesday is its own start
    ['2026-09-10', '2026-09-09'], // Thursday
    ['2026-09-14', '2026-09-09'], // Monday belongs to the week that began the previous Wednesday
    ['2026-09-15', '2026-09-09'], // Tuesday is the last day
    ['2026-09-16', '2026-09-16'], // the next Wednesday starts the next week
  ])('holding %s starts on %s', (day, start) => {
    expect(weekStartFor(day)).toBe(start);
  });

  it('runs Wednesday through Tuesday when laid out', () => {
    const days = weekDates(weekStartFor('2026-09-11')!);
    expect(days).toEqual(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']);
  });

  it('still honours a sheet that was made under the old Monday rule', () => {
    // weekDates reads the week from the sheet, not from the constant.
    expect(weekDates('2026-09-07')[0]).toBe('2026-09-07');
    expect(weekDates('2026-09-07')).toHaveLength(7);
  });

  it('can be asked for another start day, for a test or a future office', () => {
    expect(weekStartFor('2026-09-10', 1)).toBe('2026-09-07');
  });

  it('refuses a day it cannot read rather than inventing a week', () => {
    expect(weekStartFor('not a day')).toBeUndefined();
  });
});

describe('the weekend', () => {
  it('is Saturday and Sunday', () => {
    expect(isWeekendDay('2026-09-12')).toBe(true);
    expect(isWeekendDay('2026-09-13')).toBe(true);
    expect(isWeekendDay('2026-09-14')).toBe(false);
    expect(isWeekendDay('2026-09-09')).toBe(false);
  });

  it('is not an unreadable day', () => {
    expect(isWeekendDay('nope')).toBe(false);
  });
});

describe('the times a second job opens with', () => {
  const usual = { start: '06:30', finish: '14:30' };
  const entry = (id: string, date: string, startTime: string, finishTime: string): TimesheetEntry => ({
    ...blankEntry(id, date), startTime, finishTime,
  });

  it('uses the usual day for the first job on a date', () => {
    expect(nextTimesFor([], '2026-09-09', usual)).toEqual(usual);
    expect(nextTimesFor([entry('a', '2026-09-08', '06:30', '14:30')], '2026-09-09', usual)).toEqual(usual);
  });

  it('starts the next one when the last one on that day finished', () => {
    const entries = [entry('a', '2026-09-09', '06:30', '10:00')];
    expect(nextTimesFor(entries, '2026-09-09', usual)).toEqual({ start: '10:00', finish: '18:00' });
  });

  it('follows the latest finish, not the last one typed', () => {
    const entries = [
      entry('a', '2026-09-09', '06:30', '12:00'),
      entry('b', '2026-09-09', '06:30', '09:00'),
    ];
    expect(nextTimesFor(entries, '2026-09-09', usual).start).toBe('12:00');
  });

  it('ignores an entry whose finish cannot be read, rather than starting at midnight', () => {
    const entries = [entry('a', '2026-09-09', '06:30', 'lunchtime')];
    expect(nextTimesFor(entries, '2026-09-09', usual)).toEqual(usual);
  });

  it('does not run a job past the end of the day', () => {
    const entries = [entry('a', '2026-09-09', '06:30', '23:30')];
    expect(nextTimesFor(entries, '2026-09-09', usual)).toEqual({ start: '23:30', finish: '23:59' });
  });
});
