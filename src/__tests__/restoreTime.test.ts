import { qldMoment } from '@/domain/qldTime';
import { qldInstant, readRestoreTime, restoreBoxes, restorePicks } from '@/domain/restoreTime';

/**
 * The expected back-in-service time on an impairment, typed as a date and a
 * time and stored as the instant the notice prints in Queensland time.
 */

// Midday in Brisbane on Friday 9 October 2026.
const NOON = Date.parse('2026-10-09T02:00:00Z');

describe('readRestoreTime', () => {
  it('allows the time to be left unknown', () => {
    expect(readRestoreTime('', '', NOON)).toEqual({ at: undefined });
    expect(readRestoreTime('  ', ' ', NOON)).toEqual({ at: undefined });
  });

  it('reads dd/mm/yyyy and hh:mm as Queensland time', () => {
    const read = readRestoreTime('10/10/2026', '14:30', NOON);
    expect(read).toEqual({ at: '2026-10-10T04:30:00.000Z' });
    expect(qldMoment((read as { at: string }).at)).toBe('10/10/2026 14:30 (Qld)');
  });

  it('reads digits typed straight off a keypad', () => {
    expect(readRestoreTime('10102026', '1430', NOON)).toEqual({ at: '2026-10-10T04:30:00.000Z' });
  });

  it('puts an early-morning time on the right UTC day', () => {
    // 7 am in Brisbane is 9 pm the evening before in UTC.
    expect(readRestoreTime('10/10/2026', '07:00', NOON)).toEqual({ at: '2026-10-09T21:00:00.000Z' });
  });

  it('refuses a date that is not a day', () => {
    expect(readRestoreTime('31/02/2026', '14:30', NOON)).toEqual({ why: 'Write the date as dd/mm/yyyy.' });
    expect(readRestoreTime('', '14:30', NOON)).toEqual({ why: 'Write the date as dd/mm/yyyy.' });
  });

  it('wants a time with the date', () => {
    expect(readRestoreTime('10/10/2026', '', NOON)).toEqual({ why: 'Add a time, like 14:30.' });
    expect(readRestoreTime('10/10/2026', '25:00', NOON)).toEqual({ why: 'Use 24-hour time, like 14:30.' });
    expect(readRestoreTime('10/10/2026', 'arvo', NOON)).toEqual({ why: 'Use 24-hour time, like 14:30.' });
  });

  it('refuses a time that has already gone', () => {
    expect(readRestoreTime('09/10/2026', '11:00', NOON)).toEqual({ why: 'That time has passed.' });
    expect(readRestoreTime('09/10/2026', '12:00', NOON)).toEqual({ why: 'That time has passed.' });
    expect(readRestoreTime('09/10/2026', '12:15', NOON)).toEqual({ at: '2026-10-09T02:15:00.000Z' });
  });
});

describe('qldInstant', () => {
  it('only takes an ISO day and an HH:MM clock', () => {
    expect(qldInstant('2026-10-10', '14:30')).toBe('2026-10-10T04:30:00.000Z');
    expect(qldInstant('10/10/2026', '14:30')).toBeUndefined();
    expect(qldInstant('2026-10-10', '2:30')).toBeUndefined();
  });
});

describe('restoreBoxes', () => {
  it('puts a stored instant back in Queensland time', () => {
    expect(restoreBoxes('2026-10-09T21:00:00.000Z')).toEqual({ date: '10/10/2026', time: '07:00' });
  });

  it('leaves the boxes empty for nothing, or for free text saved by an older build', () => {
    expect(restoreBoxes(undefined)).toEqual({ date: '', time: '' });
    expect(restoreBoxes('2026-10-10 14:00')).toEqual({ date: '', time: '' });
    expect(restoreBoxes('tomorrow arvo')).toEqual({ date: '', time: '' });
  });
});

describe('restorePicks', () => {
  it('offers two hours, four hours and first thing tomorrow', () => {
    expect(restorePicks(NOON)).toEqual([
      { label: 'In 2 hours', date: '09/10/2026', time: '14:00' },
      { label: 'In 4 hours', date: '09/10/2026', time: '16:00' },
      { label: 'Tomorrow 7 am', date: '10/10/2026', time: '07:00' },
    ]);
  });

  it('rounds up to the quarter hour', () => {
    const [two] = restorePicks(NOON + 7 * 60_000);
    expect(two).toMatchObject({ date: '09/10/2026', time: '14:15' });
  });

  it('counts tomorrow from the Queensland day, not the UTC one', () => {
    // 1 am Saturday in Brisbane is still Friday in UTC.
    const oneAm = Date.parse('2026-10-09T15:00:00Z');
    expect(restorePicks(oneAm).find((p) => p.label === 'Tomorrow 7 am'))
      .toMatchObject({ date: '11/10/2026', time: '07:00' });
  });

  it('rolls over the end of the month', () => {
    const lastDay = Date.parse('2026-10-31T02:00:00Z');
    expect(restorePicks(lastDay).find((p) => p.label === 'Tomorrow 7 am'))
      .toMatchObject({ date: '01/11/2026', time: '07:00' });
  });

  it('every pick reads back as a time still to come', () => {
    for (const now of [NOON, Date.parse('2026-10-09T13:50:00Z'), Date.parse('2026-12-31T13:59:00Z')]) {
      for (const pick of restorePicks(now)) {
        const read = readRestoreTime(pick.date, pick.time, now);
        expect({ pick: pick.label, ok: 'at' in read && !!read.at }).toEqual({ pick: pick.label, ok: true });
      }
    }
  });
});
