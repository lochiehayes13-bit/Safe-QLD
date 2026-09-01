import {
  FORMATS, HOCHIKI_PLACE, RECOMMENDED_LIFE_YEARS, ageYears, normaliseCode, readDateCode, serviceLife,
} from '@/calc/deviceAge';

/**
 * Reading a detector's age off its own label.
 *
 * The failure that matters is a confident wrong date: a report telling a client
 * their heads are twenty years old when they are ten, or ten when they are
 * twenty. So most of what is asserted here is about refusing to be certain —
 * every candidate decade returned, both manufacturers' readings offered where
 * both fit, and nothing returned at all when the digits fit nothing.
 *
 * The worked example is the real one: 6015, sampled from FSP-851AUS heads and
 * reported as January 2016.
 */

const AUG_2026 = new Date('2026-08-15T00:00:00Z');

describe('normaliseCode', () => {
  it('strips what a label puts between the digits', () => {
    expect(normaliseCode(' 0402-25684 ')).toBe('040225684');
    expect(normaliseCode('60/15')).toBe('6015');
  });
});

describe('readDateCode — System Sensor', () => {
  it('reads the real sampled code as January, week five', () => {
    const [best] = readDateCode('6015', { brand: 'Notifier', today: AUG_2026 });
    expect(best).toMatchObject({
      format: 'system-sensor', year: 2026, month: 1, week: 5, precision: 'week',
    });
  });

  it('reads both ends of the week-of-month digit', () => {
    /*
     * System Sensor's fourth digit is a week of the month, 1 to 5. Both ends
     * are real weeks: refusing either makes a head manufactured in that week
     * unreadable, and an unreadable code is a head with no age at all on the
     * effectiveness report.
     */
    for (const week of [1, 5]) {
      const [best] = readDateCode(`601${week}`, { brand: 'Notifier', today: AUG_2026 });
      expect({ week, read: best?.week }).toEqual({ week, read: week });
    }

    // Six is not a week of the month, and is not read as one.
    const [six] = readDateCode('6016', { brand: 'Notifier', today: AUG_2026 });
    expect(six?.format).not.toBe('system-sensor');
  });

  it('offers every decade the single year digit could mean, newest first', () => {
    const years = readDateCode('6015', { brand: 'System Sensor', today: AUG_2026 }).map((r) => r.year);
    expect(years).toEqual([2026, 2016, 2006, 1996, 1986]);
  });

  it('settles on the reported year once an in-service date rules the rest out', () => {
    // The panel was built in 2016, so a head cannot have been made in 2026.
    const readings = readDateCode('6015', {
      brand: 'Notifier', today: AUG_2026, knownInServiceYear: 2016,
    });
    expect(readings[0]!.year).toBe(2016);
    expect(readings.map((r) => r.year)).not.toContain(2026);
  });

  it('never offers a date in the future', () => {
    // Week 5 of December in a year ending 6 has not happened yet in mid-2026.
    const years = readDateCode('6125', { brand: 'Notifier', today: AUG_2026 }).map((r) => r.year);
    expect(years).not.toContain(2026);
    expect(years[0]).toBe(2016);
  });

  it('refuses a fourth digit that is not a week of the month', () => {
    // 0 and 6 are not weeks, so this is not a System Sensor code.
    expect(readDateCode('6010', { brand: 'System Sensor', today: AUG_2026 })).toEqual([]);
    expect(readDateCode('6016', { brand: 'System Sensor', today: AUG_2026 })).toEqual([]);
  });

  it('refuses digits two and three that are not a month', () => {
    expect(readDateCode('6131', { brand: 'System Sensor', today: AUG_2026 })).toEqual([]);
    expect(readDateCode('6001', { brand: 'System Sensor', today: AUG_2026 })).toEqual([]);
  });
});

describe('readDateCode — Hochiki', () => {
  it("reads the application note's own example", () => {
    // AP093: 012400697 is December 2000, Hochiki Europe.
    const readings = readDateCode('012400697', { brand: 'Hochiki', today: AUG_2026 });
    const y2000 = readings.find((r) => r.year === 2000);
    expect(y2000).toMatchObject({
      format: 'hochiki-serial', month: 12, place: 'Hochiki Europe', precision: 'month',
    });
  });

  it('reads a four-digit batch the same way', () => {
    const readings = readDateCode('0124', { brand: 'Hochiki', today: AUG_2026 });
    expect(readings.find((r) => r.year === 2000)).toMatchObject({
      format: 'hochiki-batch', month: 12, place: 'Hochiki Europe',
    });
  });

  it('does not read a batch as year-month, which is the common mistake', () => {
    // Second-hand guides call 0124 "January 2004". The manufacturer's own note
    // says December 2000, place 4.
    const readings = readDateCode('0124', { brand: 'Hochiki', today: AUG_2026 });
    expect(readings.every((r) => r.month === 12)).toBe(true);
    expect(readings.some((r) => r.year === 2004)).toBe(false);
  });

  it('names each place of manufacture', () => {
    expect(HOCHIKI_PLACE['1']).toContain('Japan');
    expect(HOCHIKI_PLACE['3']).toContain('America');
    expect(HOCHIKI_PLACE['4']).toContain('Europe');
    expect(HOCHIKI_PLACE['5']).toBeUndefined();
  });

  it('refuses a place digit Hochiki does not use', () => {
    // 5 is not a place, so 6015 is not a Hochiki code however much it looks
    // like one.
    expect(readDateCode('6015', { brand: 'Hochiki', today: AUG_2026 })).toEqual([]);
  });
});

describe('readDateCode — more than one format fits', () => {
  it('offers both readings and says the make has to be read off the head', () => {
    // 0124 is a valid Hochiki batch and a valid System Sensor code — week 4 of
    // January — and the digits alone cannot separate them.
    const readings = readDateCode('0124', { today: AUG_2026 });
    const formats = new Set(readings.map((r) => r.format));
    expect(formats.has('hochiki-batch')).toBe(true);
    expect(formats.has('system-sensor')).toBe(true);
    expect(readings[0]!.notes.join(' ')).toContain('More than one manufacturer');
  });

  it('narrows to one format once the brand is given', () => {
    const formats = new Set(
      readDateCode('0124', { brand: 'Hochiki', today: AUG_2026 }).map((r) => r.format),
    );
    expect([...formats]).toEqual(['hochiki-batch']);
  });
});

describe('readDateCode — Apollo', () => {
  it('reads MMYY, marked low confidence because the format is second-hand', () => {
    const readings = readDateCode('0402-25684', { brand: 'Apollo', today: AUG_2026 });
    const apr02 = readings.find((r) => r.format === 'apollo-mmyy' && r.year === 2002);
    expect(apr02).toMatchObject({ month: 4, confidence: 'low' });
    expect(apr02!.source).toContain('not an Apollo publication');
  });

  it('reads YYMMDD to the day', () => {
    const readings = readDateCode('020401', { brand: 'Apollo', today: AUG_2026 });
    expect(readings.find((r) => r.format === 'apollo-yymmdd' && r.year === 2002))
      .toMatchObject({ month: 4, day: 1, precision: 'day', manufactured: '2002-04-01' });
  });
});

describe('readDateCode — nothing fits', () => {
  it('returns nothing rather than the nearest thing', () => {
    expect(readDateCode('ABC', { today: AUG_2026 })).toEqual([]);
    expect(readDateCode('', { today: AUG_2026 })).toEqual([]);
  });

  it('warns about the repeating decade whenever more than one year is possible', () => {
    const readings = readDateCode('6015', { brand: 'Notifier', today: AUG_2026 });
    expect(readings[0]!.notes.join(' ')).toContain('repeats every ten years');
  });

  it('does not warn about a decade once the bounds leave one year', () => {
    // An in-service year caps the candidates but does not floor them: a 2006
    // head can perfectly well be in service in 2016. Both bounds together are
    // the only thing that makes a one-digit year unambiguous.
    const capped = readDateCode('6015', {
      brand: 'Notifier', today: AUG_2026, knownInServiceYear: 2016,
    });
    expect(capped.map((r) => r.year)).toEqual([2016, 2006, 1996, 1986]);
    expect(capped[0]!.notes.join(' ')).toContain('repeats every ten years');

    const single = readDateCode('6015', {
      brand: 'Notifier', today: AUG_2026, knownInServiceYear: 2016, earliestYear: 2010,
    });
    expect(single).toHaveLength(1);
    expect(single[0]!.year).toBe(2016);
    expect(single[0]!.notes.join(' ')).not.toContain('repeats every ten years');
  });
});

describe('serviceLife', () => {
  const reading = readDateCode('6015', {
    brand: 'Notifier', today: AUG_2026, knownInServiceYear: 2016,
  })[0]!;

  it('reproduces the age the effectiveness report stated', () => {
    // Week five of January 2016, assessed 3 July 2026. The report said 10.4
    // years, which only comes out if the week is used — the first of the month
    // gives 10.5, and being a month out on a ten-year life is the difference
    // between a head inside its life and one past it.
    expect(reading.manufactured).toBe('2016-01-29');
    expect(ageYears(reading, new Date('2026-07-03T00:00:00Z'))).toBe(10.4);
  });

  it('counts a head that has reached its recommended age as past it', () => {
    /*
     * Ten years exactly is the age the recommendation is about, so it counts.
     * This is where a lifecycle finding either appears on the report or does
     * not, and nothing held the year itself.
     *
     * The comparison is made on the age as reported, which is a tenth of a
     * year — about five weeks. That is the right resolution for a
     * recommendation rather than a deadline, but it means the changeover is
     * not to the day: two months before the anniversary reads as 9.8 and is
     * inside its life, the day before reads as 10.0 and is not. Both are
     * asserted so the resolution is a stated property rather than something
     * somebody rediscovers.
     */
    const reached = serviceLife(reading, new Date(`${reading.year + 10}-01-29T00:00:00Z`));
    expect(reached.ageYears).toBe(10);
    expect(reached.past).toBe(true);
    expect(reached.yearsLeft).toBe(0);

    const twoMonthsBefore = serviceLife(reading, new Date(`${reading.year + 9}-12-01T00:00:00Z`));
    expect(twoMonthsBefore.ageYears).toBe(9.8);
    expect(twoMonthsBefore.past).toBe(false);
    expect(twoMonthsBefore.yearsLeft).toBe(0.2);
  });

  it('calls a head past the recommended age without calling it a defect', () => {
    const verdict = serviceLife(reading, new Date('2026-07-03T00:00:00Z'));
    expect(verdict.past).toBe(true);
    expect(verdict.yearsLeft).toBe(0);
    expect(verdict.label).toContain('Age alone is not a defect');
  });

  it('counts the years remaining while a head is still inside it', () => {
    const verdict = serviceLife(reading, new Date('2020-01-01T00:00:00Z'));
    expect(verdict.past).toBe(false);
    expect(verdict.yearsLeft).toBeGreaterThan(5);
  });

  it('takes a different life where the manufacturer sets one', () => {
    expect(serviceLife(reading, new Date('2024-01-01T00:00:00Z'), 15).past).toBe(false);
    expect(RECOMMENDED_LIFE_YEARS).toBe(10);
  });
});

describe('FORMATS', () => {
  it('names a source for every format', () => {
    for (const spec of Object.values(FORMATS)) {
      expect(spec.source.length).toBeGreaterThan(10);
      expect(spec.layout).toContain(':');
    }
  });

  it('marks anything not from the manufacturer as low confidence', () => {
    for (const spec of Object.values(FORMATS)) {
      if (/not an .* publication|Trade supplier/i.test(spec.source)) {
        expect(spec.confidence).toBe('low');
      }
    }
  });
});
