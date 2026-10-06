/**
 * A date and a time as somebody standing at a booster types them.
 *
 * Form 72's test date was a text box holding an ISO string. That asks a
 * technician on a phone to type "2026-10-02": eleven characters in a format
 * nobody in Australia writes, two of them hyphens from the symbol layer, and a
 * wrong one is a date on a statutory document whose retention and notice
 * clocks run from it. The field's placeholder was the format.
 *
 * Both of these return nothing rather than a guess for anything they cannot
 * read, which is the property that matters: a half-typed date must never
 * become a stored one.
 */
import { typedClock, typedDay } from '@/domain/qldTime';

describe('a date somebody typed', () => {
  it('reads eight digits straight off a keypad as the order we write them in', () => {
    expect(typedDay('02102026')).toBe('2026-10-02');
    expect(typedDay('18072026')).toBe('2026-07-18');
  });

  it('reads the slashes an Australian would put in', () => {
    expect(typedDay('2/10/2026')).toBe('2026-10-02');
    expect(typedDay('02/10/2026')).toBe('2026-10-02');
    expect(typedDay('2-10-2026')).toBe('2026-10-02');
    expect(typedDay('2.10.2026')).toBe('2026-10-02');
  });

  it('reads a two-digit year as this century', () => {
    expect(typedDay('2/10/26')).toBe('2026-10-02');
    expect(typedDay('021026')).toBe('2026-10-02');
  });

  it('still reads the ISO form, which is what every stored date is', () => {
    expect(typedDay('2026-10-02')).toBe('2026-10-02');
    expect(typedDay('2026-7-8')).toBe('2026-07-08');
  });

  it('tells the two orders apart by where the four-digit year is', () => {
    expect(typedDay('2026-10-02')).toBe('2026-10-02');
    expect(typedDay('10/02/2026')).toBe('2026-02-10');
  });

  it('pads a single-digit month and day, so stored dates sort', () => {
    expect(typedDay('1/1/2026')).toBe('2026-01-01');
  });

  it('answers nothing for a date half typed', () => {
    // The caller keeps what is on screen and stores only when it resolves, so
    // "2/10" must not become a date.
    for (const half of ['', ' ', '2', '02', '0210', '2/', '2/10', '2/10/202']) {
      expect({ half, read: typedDay(half) }).toEqual({ half, read: undefined });
    }
  });

  it('reads a stopped-at two-digit year as a date, which is the cost of allowing them', () => {
    /*
     * "2/10/20" on the way to "2/10/2026" resolves, for one keystroke, to
     * 2 October 2020 — and a technician who meant 2026 and stopped there gets
     * 2020. Two-digit years are what people write, so refusing them would be
     * worse friction than this; the answer is that the screen echoes the date
     * it understood back in full, rather than hiding the interpretation.
     */
    expect(typedDay('2/10/20')).toBe('2020-10-02');
  });

  it('answers nothing for a day that is not on the calendar', () => {
    // 31 February passes a range check and is not a day.
    expect(typedDay('31/02/2026')).toBeUndefined();
    expect(typedDay('29/02/2026')).toBeUndefined();
    expect(typedDay('32/01/2026')).toBeUndefined();
    expect(typedDay('01/13/2026')).toBeUndefined();
  });

  it('reads a leap day in a leap year', () => {
    expect(typedDay('29/02/2028')).toBe('2028-02-29');
  });

  it('answers nothing for text that is not a date at all', () => {
    for (const junk of ['today', 'n/a', '2026', '--', '1/2/3/4', '2026-10-02T00:00:00Z']) {
      expect({ junk, read: typedDay(junk) }).toEqual({ junk, read: undefined });
    }
  });
});

describe('a time somebody typed', () => {
  it('reads four digits as the 24-hour clock', () => {
    expect(typedClock('0930')).toBe('09:30');
    expect(typedClock('1415')).toBe('14:15');
    expect(typedClock('0000')).toBe('00:00');
  });

  it('reads three digits as h:mm, because there is no other reading of 930', () => {
    expect(typedClock('930')).toBe('09:30');
    expect(typedClock('745')).toBe('07:45');
  });

  it('reads a colon or a stop', () => {
    expect(typedClock('9:30')).toBe('09:30');
    expect(typedClock('09:30')).toBe('09:30');
    expect(typedClock('9.30')).toBe('09:30');
  });

  it('answers nothing for a time half typed', () => {
    for (const half of ['', '9', '09', '9:', '9:3']) {
      expect({ half, read: typedClock(half) }).toEqual({ half, read: undefined });
    }
  });

  it('answers nothing for an hour or minute off the clock', () => {
    expect(typedClock('2500')).toBeUndefined();
    expect(typedClock('0970')).toBeUndefined();
    expect(typedClock('24:00')).toBeUndefined();
  });

  it('reads the last minute of the day', () => {
    expect(typedClock('2359')).toBe('23:59');
  });

  it('answers nothing for text that is not a time', () => {
    for (const junk of ['morning', '9am', '9:30pm', '12345']) {
      expect({ junk, read: typedClock(junk) }).toEqual({ junk, read: undefined });
    }
  });
});
