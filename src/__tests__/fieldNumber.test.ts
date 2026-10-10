import { readNumber, toggleSign } from '@/calc/fieldNumber';

describe('readNumber', () => {
  it('reads decimals and negatives as typed', () => {
    expect(readNumber('2.5')).toBe(2.5);
    expect(readNumber('.5')).toBe(0.5);
    expect(readNumber('-40')).toBe(-40);
    expect(readNumber(' 700 ')).toBe(700);
  });

  it('reads a figure part way through typing it', () => {
    // "2." is on the way to "2.5"; it is still 2, not a blank.
    expect(readNumber('2.')).toBe(2);
  });

  it('gives no figure for a blank or half-typed field, rather than zero', () => {
    for (const text of ['', '   ', '-', '.', '-.', '+']) {
      expect(readNumber(text)).toBeUndefined();
    }
  });

  it('refuses text that only starts with a number', () => {
    // parseFloat would read "12abc" as 12 and work out an answer from it.
    expect(readNumber('12abc')).toBeUndefined();
    expect(readNumber('1.2.3')).toBeUndefined();
  });
});

describe('toggleSign', () => {
  it('flips a figure either way', () => {
    expect(toggleSign('18')).toBe('-18');
    expect(toggleSign('-18')).toBe('18');
    expect(toggleSign('+4.5')).toBe('-4.5');
  });

  it('starts a negative in a blank field', () => {
    expect(toggleSign('')).toBe('-');
    expect(toggleSign('-')).toBe('');
  });

  it('round-trips', () => {
    expect(toggleSign(toggleSign('2.5'))).toBe('2.5');
  });
});
