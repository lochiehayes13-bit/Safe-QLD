import {
  COLOURS,
  E24,
  E48,
  E96,
  E192,
  TOLERANCE_COLOURS,
  colourSpec,
  decodeBands,
  encodeBands,
  formatOhms,
  isPreferredValue,
  nearestPreferred,
  parseOhms,
  shorthandOhms,
  type BandColour,
} from '@/calc/resistor';

describe('decodeBands', () => {
  it('decodes a 4-band 4k7 5%', () => {
    const r = decodeBands(['yellow', 'violet', 'red', 'gold'], 4);
    expect(r.ok).toBe(true);
    expect(r.ohms).toBe(4700);
    expect(r.tolerancePct).toBe(5);
    expect(r.shorthand).toBe('4k7');
    expect(r.minOhms).toBeCloseTo(4465, 4);
    expect(r.maxOhms).toBeCloseTo(4935, 4);
  });

  it('decodes a 4-band 10k 1%', () => {
    const r = decodeBands(['brown', 'black', 'orange', 'brown'], 4);
    expect(r.ohms).toBe(10000);
    expect(r.tolerancePct).toBe(1);
  });

  it('decodes a 5-band 4k70 1%', () => {
    const r = decodeBands(['yellow', 'violet', 'black', 'brown', 'brown'], 5);
    expect(r.ohms).toBe(4700);
    expect(r.tolerancePct).toBe(1);
  });

  it('decodes a 6-band with temperature coefficient', () => {
    const r = decodeBands(['brown', 'black', 'black', 'brown', 'brown', 'red'], 6);
    expect(r.ohms).toBe(1000);
    expect(r.tolerancePct).toBe(1);
    expect(r.tcrPpm).toBe(50);
  });

  it('treats a 3-band resistor as ±20%', () => {
    const r = decodeBands(['brown', 'black', 'red'], 3);
    expect(r.ohms).toBe(1000);
    expect(r.tolerancePct).toBe(20);
  });

  it('handles the gold multiplier for sub-ohm values', () => {
    const r = decodeBands(['brown', 'black', 'gold', 'gold'], 4);
    expect(r.ohms).toBeCloseTo(1, 9);
  });

  it('handles the silver multiplier', () => {
    const r = decodeBands(['brown', 'black', 'silver', 'gold'], 4);
    expect(r.ohms).toBeCloseTo(0.1, 9);
  });

  it('rejects a gold digit band', () => {
    const r = decodeBands(['gold', 'black', 'red', 'gold'], 4);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('digit');
  });

  it('accepts an orange tolerance band, which is ±0.05%', () => {
    // This test previously asserted the opposite, because orange had been left
    // without a tolerance value in the colour table.
    const r = decodeBands(['brown', 'black', 'red', 'orange'], 4);
    expect(r.ok).toBe(true);
    expect(r.tolerancePct).toBe(0.05);
  });

  it('rejects a tolerance band whose colour really has no tolerance', () => {
    // White carries a digit and a multiplier but no tolerance, in any revision
    // of the table.
    const r = decodeBands(['brown', 'black', 'red', 'white'], 4);
    expect(r.ok).toBe(false);
  });

  it('reports missing bands rather than guessing', () => {
    const r = decodeBands(['brown', 'black'], 4);
    expect(r.ok).toBe(false);
  });
});

describe('formatOhms and shorthandOhms', () => {
  it.each([
    [4700, '4.7 kΩ', '4k7'],
    [10000, '10 kΩ', '10k'],
    [1000000, '1 MΩ', '1M'],
    [220, '220 Ω', '220R'],
    [3300, '3.3 kΩ', '3k3'],
    [6800, '6.8 kΩ', '6k8'],
    [1, '1 Ω', '1R'],
  ])('formats %i as %s / %s', (ohms, display, short) => {
    expect(formatOhms(ohms)).toBe(display);
    expect(shorthandOhms(ohms)).toBe(short);
  });
});

describe('parseOhms', () => {
  it.each([
    ['4k7', 4700],
    ['4.7k', 4700],
    ['4700', 4700],
    ['470R', 470],
    ['1M', 1000000],
    ['1M0', 1000000],
    ['10k', 10000],
    ['R22', 0.22],
    ['3k3', 3300],
    ['  6K8  ', 6800],
    ['100 ohms', 100],
  ])('parses %s to %i ohms', (input, expected) => {
    expect(parseOhms(input)).toBeCloseTo(expected, 6);
  });

  it('returns null for nonsense', () => {
    expect(parseOhms('banana')).toBeNull();
    expect(parseOhms('')).toBeNull();
  });

  it('round-trips through shorthand', () => {
    for (const v of [220, 470, 1000, 3300, 4700, 6800, 10000, 47000, 100000]) {
      expect(parseOhms(shorthandOhms(v))).toBeCloseTo(v, 6);
    }
  });
});

describe('encodeBands', () => {
  it('encodes 4k7 5% as a 4-band sequence', () => {
    expect(encodeBands(4700, 4, 5)).toEqual<BandColour[]>(['yellow', 'violet', 'red', 'gold']);
  });

  it('encodes 10k 1% as a 5-band sequence', () => {
    expect(encodeBands(10000, 5, 1)).toEqual<BandColour[]>(['brown', 'black', 'black', 'red', 'brown']);
  });

  it('encodes a sub-ohm value using the gold multiplier', () => {
    expect(encodeBands(1, 4, 5)).toEqual<BandColour[]>(['brown', 'black', 'gold', 'gold']);
  });

  it('refuses a 3-significant-figure value on a 4-band resistor', () => {
    expect(encodeBands(1210, 4, 1)).toBeNull();
    expect(encodeBands(1210, 5, 1)).toEqual<BandColour[]>(['brown', 'red', 'brown', 'brown', 'brown']);
  });

  it('round-trips every E24 value through encode and decode', () => {
    for (const mant of E24) {
      for (const decade of [1, 10, 100, 1000]) {
        const ohms = mant * decade;
        const bands = encodeBands(ohms, 4, 5);
        expect(bands).not.toBeNull();
        const back = decodeBands(bands!, 4);
        expect(back.ohms).toBeCloseTo(ohms, 6);
      }
    }
  });
});

describe('preferred values', () => {
  it('recognises E24 members', () => {
    expect(isPreferredValue(4700, 'E24')).toBe(true);
    expect(isPreferredValue(3300, 'E24')).toBe(true);
    expect(isPreferredValue(4400, 'E24')).toBe(false);
  });

  it('recognises E96 members', () => {
    expect(isPreferredValue(1210, 'E96')).toBe(true);
    expect(isPreferredValue(4990, 'E96')).toBe(true);
    expect(isPreferredValue(1215, 'E96')).toBe(false);
  });

  it('finds the nearest preferred value', () => {
    expect(nearestPreferred(4600, 'E24')).toBe(4700);
    expect(nearestPreferred(4400, 'E24')).toBe(4300);
    expect(nearestPreferred(999, 'E24')).toBe(1000);
  });

  it('has the right number of values in each series', () => {
    expect(E24).toHaveLength(24);
    expect(E48).toHaveLength(48);
    expect(E96).toHaveLength(96);
  });

  it('keeps every series strictly ascending', () => {
    for (const s of [E24, E48, E96]) {
      for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    }
  });
});

describe('colour table integrity', () => {
  it('maps digits 0-9 exactly once each', () => {
    const digits = COLOURS.filter((c) => c.digit !== undefined).map((c) => c.digit!);
    expect(digits.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('includes the gold and silver multipliers, which are easy to omit', () => {
    expect(COLOURS.find((c) => c.colour === 'gold')?.multiplier).toBeCloseTo(0.1, 9);
    expect(COLOURS.find((c) => c.colour === 'silver')?.multiplier).toBeCloseTo(0.01, 9);
  });

  it('gives no-band a ±20% tolerance', () => {
    expect(COLOURS.find((c) => c.colour === 'none')?.tolerance).toBe(20);
  });

  it('keeps digit colours and their multipliers consistent', () => {
    for (const c of COLOURS) {
      if (c.digit !== undefined && c.digit > 0 && c.multiplier !== undefined) {
        expect(c.multiplier).toBeCloseTo(10 ** c.digit, 6);
      }
    }
  });
});

describe('tolerance bands', () => {
  // These three were missing or wrong and nothing caught it: the decoder read
  // a 5-band resistor with an orange or yellow tolerance band as undecodable,
  // and reported grey as five times looser than it is.
  it.each([
    ['brown', 1],
    ['red', 2],
    ['orange', 0.05],
    ['yellow', 0.02],
    ['green', 0.5],
    ['blue', 0.25],
    ['violet', 0.1],
    ['grey', 0.01],
    ['gold', 5],
    ['silver', 10],
    ['none', 20],
  ])('%s is ±%s%%', (colour, tolerance) => {
    expect(colourSpec(colour as BandColour)?.tolerance).toBe(tolerance);
  });

  it('offers every tolerance colour in the picker', () => {
    // Eleven colours carry a tolerance; two of them were absent from this list
    // because they had no value set.
    expect(TOLERANCE_COLOURS).toHaveLength(11);
    expect(TOLERANCE_COLOURS).toContain('orange');
    expect(TOLERANCE_COLOURS).toContain('yellow');
  });
});

describe('E192 and the series derived from it', () => {
  it('has 192 values, all three digits, strictly increasing', () => {
    expect(E192).toHaveLength(192);
    expect(E192[0]).toBe(100);
    expect(E192[E192.length - 1]).toBe(988);
    for (let i = 1; i < E192.length; i++) {
      expect(E192[i]!).toBeGreaterThan(E192[i - 1]!);
      expect(E192[i]!).toBeLessThan(1000);
    }
  });

  it('contains E96, which contains E48', () => {
    expect(E96).toHaveLength(96);
    expect(E48).toHaveLength(48);
    for (const v of E96) expect(E192).toContain(v);
    for (const v of E48) expect(E96).toContain(v);
  });

  it('reproduces the E96 values this file shipped before E192 was added', () => {
    // Guards the transcription: if a digit of E192 is wrong, the derived E96
    // stops matching the table that was already in use and verified.
    const shipped = [
      100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130,
      133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174,
      178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232,
      237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
      316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412,
      422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549,
      562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732,
      750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
    ];
    expect(E96).toEqual(shipped);
  });

  it('finds E192 values the coarser series do not carry', () => {
    expect(isPreferredValue(1010, 'E192')).toBe(true);
    expect(isPreferredValue(1010, 'E96')).toBe(false);
  });
});

describe('nearest preferred value is nearest by ratio', () => {
  it('does not bias upward on a wide gap', () => {
    // Between E6's 10 and 15, the ratio midpoint is 12.25 — so 12 belongs to
    // 10, not 15. Linear distance calls it for 15 and is wrong.
    expect(nearestPreferred(12, 'E6')).toBe(10);
  });

  it('still picks the obvious neighbour', () => {
    expect(nearestPreferred(14, 'E6')).toBe(15);
    expect(nearestPreferred(4700, 'E24')).toBe(4700);
  });

  it('crosses a decade boundary when the closer value is on the other side', () => {
    expect(nearestPreferred(9.9, 'E12')).toBe(10);
    expect(nearestPreferred(97, 'E12')).toBe(100);
  });

  it('refuses a nonsense input rather than returning a number', () => {
    expect(nearestPreferred(0, 'E24')).toBeNull();
    expect(nearestPreferred(-5, 'E24')).toBeNull();
    expect(nearestPreferred(Number.NaN, 'E24')).toBeNull();
  });
});
