import { checkSpan } from '@/domain/scheduleForm';

/**
 * The schedule screen takes a date the way the rest of the app does.
 *
 * It used to ask for yyyy-mm-dd, the one box in the app that did.
 */

describe('the date on a booking or a move', () => {
  it('reads dd/mm/yyyy and sends the ISO day', () => {
    expect(checkSpan({ date: '12/10/2026', start: '07:00', end: '15:00' })).toEqual({ date: '2026-10-12', start: '07:00', end: '15:00' });
    expect(checkSpan({ date: '12102026', start: '7:30', end: '1530' })).toEqual({ date: '2026-10-12', start: '07:30', end: '15:30' });
  });

  it('still reads an ISO day, which is what a prefilled box held before', () => {
    expect(checkSpan({ date: '2026-10-12', start: '07:00', end: '15:00' })).toMatchObject({ date: '2026-10-12' });
  });

  it('says how to write a date it cannot read', () => {
    expect(checkSpan({ date: '31/02/2026', start: '07:00', end: '15:00' })).toEqual({ why: 'Write the date as dd/mm/yyyy.' });
    expect(checkSpan({ date: 'next tues', start: '07:00', end: '15:00' })).toEqual({ why: 'Write the date as dd/mm/yyyy.' });
  });

  it('says how to write a time, and refuses a block that ends first', () => {
    expect(checkSpan({ date: '12/10/2026', start: '7am', end: '15:00' })).toEqual({ why: 'Use 24-hour time, like 07:00.' });
    expect('why' in checkSpan({ date: '12/10/2026', start: '15:00', end: '07:00' })).toBe(true);
  });
});
