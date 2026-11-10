import {
  chargeForAttendance, effectiveRateCard, formatCents, marginFraction, parseCents,
  rateCardFrom, roundCents, selectFee, selectRate, suspectRateNames,
  type LabourRate, type RateCardPrefs, type ServiceFee,
} from '@/domain/rates';

/**
 * Rates, fees and what an attendance costs.
 *
 * A quote is a document someone signs, so the failures that matter here are the
 * quiet ones: money drifting through floating point, an attendance fee charged
 * on top of the hours it already covers, and a negotiated customer silently
 * billed at list price.
 *
 * The figures below are shaped like a real rate card but are not one — the
 * actual rates are commercial terms and live in the office system.
 */

const rate = (over: Partial<LabourRate> & Pick<LabourRate, 'id' | 'name'>): LabourRate => ({
  costCentsPerHour: 10_000, sellCentsPerHour: 13_000, taxRate: 0.1,
  efficiencyMultiplier: 1, kind: 'labour', hours: 'normal', ...over,
});

const RATES: LabourRate[] = [
  rate({ id: 'nh', name: 'Normal Hours Labour', sellCentsPerHour: 13_000 }),
  rate({ id: 'ah', name: 'After Hours Labour', hours: 'after-hours', sellCentsPerHour: 18_500 }),
  rate({ id: 'c-nh', name: 'Acme Normal Hours Labour', customerName: 'Acme',
         costCentsPerHour: 14_200, sellCentsPerHour: 12_500 }),
  rate({ id: 'c-ah', name: 'Acme After Hours Labour', customerName: 'Acme', hours: 'after-hours',
         costCentsPerHour: 14_200, sellCentsPerHour: 16_500 }),
  rate({ id: 'c-co', name: 'Acme Normal Hours Callout', customerName: 'Acme', kind: 'callout',
         costCentsPerHour: 14_200, sellCentsPerHour: 22_500 }),
];

const FEES: ServiceFee[] = [
  { id: 'f-nh', name: 'Site Attendance - Normal Hours', chargeCents: 30_000,
    includedLabourMinutes: 120, taxRate: 0.1, hours: 'normal' },
  { id: 'f-ah', name: 'Site Attendance - After Hours', chargeCents: 57_500,
    includedLabourMinutes: 180, taxRate: 0.1, hours: 'after-hours' },
];

describe('holding money', () => {
  it('keeps cents exact where floating point would not', () => {
    // $136.88 an hour for 1.75 hours is 23954 cents. In dollars-as-floats this
    // is the kind of sum that lands on 239.53999999999996.
    expect(roundCents((1.75 * 13_688))).toBe(23_954);
  });

  it('rounds half away from zero, as an invoice does', () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(-0.5)).toBe(-1);
  });

  it('formats and parses without drifting', () => {
    expect(formatCents(30_000)).toBe('$300.00');
    expect(formatCents(13_688)).toBe('$136.88');
    expect(formatCents(123_456_789)).toBe('$1,234,567.89');
    expect(formatCents(-500)).toBe('-$5.00');
    expect(parseCents('$136.88')).toBe(13_688);
    expect(parseCents('136.8')).toBe(13_680);
    expect(parseCents('1,234.56')).toBe(123_456);
  });

  it('holds nought as nought, not as minus nought', () => {
    /*
     * A quote line at nought is a real thing — a fee waived, an hour inside an
     * allowance. Minus nought is what a sign test applied at the wrong side of
     * the boundary produces, and it prints as "-$0.00", which reads on a
     * customer's quote as a credit nobody offered.
     */
    expect(roundCents(0)).toBe(0);
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(roundCents(0))).toBe('$0.00');
  });

  it('refuses a figure it cannot read rather than returning zero', () => {
    // Zero is a price. Returning it for unparseable input puts free work on a
    // quote.
    expect(parseCents('')).toBeUndefined();
    expect(parseCents('POA')).toBeUndefined();
    expect(parseCents('12.345')).toBeUndefined();
  });
});

describe('picking a rate', () => {
  it('prefers the customer\'s own rate over the general one', () => {
    // Billing a negotiated account at list price is the failure that matters:
    // it is invisible until the year is reconciled.
    expect(selectRate(RATES, { hours: 'normal', kind: 'labour', customerName: 'Acme' })?.id).toBe('c-nh');
    expect(selectRate(RATES, { hours: 'normal', kind: 'labour' })?.id).toBe('nh');
  });

  it('matches the customer regardless of case', () => {
    expect(selectRate(RATES, { hours: 'normal', kind: 'labour', customerName: 'ACME' })?.id).toBe('c-nh');
  });

  it('falls back to the general rate for a customer with no card', () => {
    expect(selectRate(RATES, { hours: 'normal', kind: 'labour', customerName: 'Someone Else' })?.id).toBe('nh');
  });

  it('keeps callout and labour apart', () => {
    // A callout rate bundles travel and a minimum on site; charged per hour it
    // is nearly double the labour rate.
    expect(selectRate(RATES, { hours: 'normal', kind: 'callout', customerName: 'Acme' })?.id).toBe('c-co');
    expect(selectRate(RATES, { hours: 'normal', kind: 'callout' })).toBeUndefined();
  });

  it('keeps normal and after hours apart', () => {
    expect(selectRate(RATES, { hours: 'after-hours', kind: 'labour' })?.id).toBe('ah');
    expect(selectFee(FEES, 'after-hours')?.id).toBe('f-ah');
  });
});

describe('reporting margin', () => {
  it('computes it as a fraction of the sell price', () => {
    expect(marginFraction(RATES[0]!)).toBeCloseTo(0.2308, 3);
    expect(marginFraction(RATES[1]!)).toBeCloseTo(0.4595, 3);
  });

  it('reports a negative margin rather than hiding it', () => {
    // A real card can carry one — a customer rate below cost — and it should be
    // visible, not clamped to zero.
    expect(marginFraction(RATES[2]!)).toBeLessThan(0);
  });

  it('declines to divide by a zero sell price', () => {
    expect(marginFraction(rate({ id: 'x', name: 'x', sellCentsPerHour: 0 }))).toBeNull();
  });
});

describe('charging an attendance', () => {
  it('charges the fee alone when the visit fits inside it', () => {
    const c = chargeForAttendance({ minutesOnSite: 90, hours: 'normal', rates: RATES, fees: FEES });
    expect(c.lines).toHaveLength(1);
    expect(c.extraMinutes).toBe(0);
    expect(c.subtotalCents).toBe(30_000);
    expect(c.gstCents).toBe(3_000);
    expect(c.totalCents).toBe(33_000);
  });

  it('does not bill again the minutes the fee already covers', () => {
    // The fee covers two hours. Charging it and then every minute double-bills
    // the first two hours of every job on the book.
    const c = chargeForAttendance({ minutesOnSite: 180, hours: 'normal', rates: RATES, fees: FEES });
    expect(c.extraMinutes).toBe(60);
    expect(c.lines.map((l) => l.amountCents)).toEqual([30_000, 13_000]);
    expect(c.subtotalCents).toBe(43_000);
  });

  it('bills the extra at the customer rate where there is one', () => {
    const c = chargeForAttendance({
      minutesOnSite: 240, hours: 'normal', customerName: 'Acme', rates: RATES, fees: FEES,
    });
    // Two hours over, at Acme's $125 rather than the list $130.
    expect(c.lines[1]).toMatchObject({ quantity: 2, unitCents: 12_500, amountCents: 25_000 });
  });

  it('uses the after-hours fee and rate together', () => {
    const c = chargeForAttendance({ minutesOnSite: 240, hours: 'after-hours', rates: RATES, fees: FEES });
    expect(c.lines[0]!.amountCents).toBe(57_500);
    expect(c.extraMinutes).toBe(60);
    expect(c.lines[1]!.unitCents).toBe(18_500);
  });

  it('applies the efficiency multiplier to billable hours', () => {
    const c = chargeForAttendance({
      minutesOnSite: 240, hours: 'normal', fees: FEES,
      rates: [rate({ id: 'e', name: 'Loaded', efficiencyMultiplier: 1.25 })],
    });
    expect(c.lines[1]).toMatchObject({ quantity: 2.5, amountCents: 32_500 });
  });

  it('can skip the fee for work inside an existing visit', () => {
    const c = chargeForAttendance({
      minutesOnSite: 60, hours: 'normal', rates: RATES, fees: FEES, chargeAttendance: false,
    });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]!.label).toBe('Normal Hours Labour');
    expect(c.subtotalCents).toBe(13_000);
  });

  it('takes GST once on the total rather than per line', () => {
    // Rounding each line and adding can differ from the total by a cent, and
    // the total is what appears on the invoice.
    const c = chargeForAttendance({ minutesOnSite: 195, hours: 'normal', rates: RATES, fees: FEES });
    expect(c.gstCents).toBe(roundCents(c.subtotalCents * 0.1));
    expect(c.totalCents).toBe(c.subtotalCents + c.gstCents);
  });
});

describe('saying what is missing rather than quoting anyway', () => {
  it('warns when no attendance fee is set up', () => {
    const c = chargeForAttendance({ minutesOnSite: 60, hours: 'normal', rates: RATES, fees: [] });
    expect(c.warnings.join(' ')).toMatch(/no normal hours attendance fee/i);
  });

  it('names the band the missing fee belongs to, so it can be set up', () => {
    /*
     * "No attendance fee is set up" sends somebody to a settings screen with
     * two boxes on it. Naming the band sends them to the right one, and naming
     * the wrong one is worse than naming neither.
     */
    const normal = chargeForAttendance({ rates: RATES, fees: [], hours: 'normal', minutesOnSite: 60 });
    expect(normal.warnings[0]).toContain('normal hours attendance fee');

    const after = chargeForAttendance({ rates: RATES, fees: [], hours: 'after-hours', minutesOnSite: 60 });
    expect(after.warnings[0]).toContain('after hours attendance fee');
  });

  it('says nothing about a missing fee where the fee was deliberately skipped', () => {
    /*
     * Work inside a visit already being charged for. The fee is absent because
     * somebody said so, and warning about it trains people to ignore warnings.
     */
    const out = chargeForAttendance({
      rates: RATES, fees: [], hours: 'normal', minutesOnSite: 60, chargeAttendance: false,
    });
    expect(out.warnings.filter((w) => w.includes('attendance fee is set up'))).toEqual([]);
  });

  it('warns rather than dropping unbilled time silently', () => {
    // Time worked and not charged is the same shape of error as a wrong rate,
    // and easier to miss.
    const c = chargeForAttendance({ minutesOnSite: 240, hours: 'normal', rates: [], fees: FEES });
    expect(c.warnings.join(' ')).toMatch(/120 minutes are beyond the attendance allowance/i);
    expect(c.subtotalCents).toBe(30_000);
  });

  it('handles a visit of no time at all', () => {
    const c = chargeForAttendance({ minutesOnSite: 0, hours: 'normal', rates: RATES, fees: FEES });
    expect(c.extraMinutes).toBe(0);
    expect(c.subtotalCents).toBe(30_000);
  });
});

describe('spotting a rate nobody will ever match', () => {
  it('finds a customer name one character out', () => {
    // A real card carried both "Vaxxas ... Labour" and "Vaxxax ... Labour".
    // Looked up by customer, only one of them is ever found.
    const problems = suspectRateNames(
      [rate({ id: 'x', name: 'Vaxxax Normal Hours Labour', customerName: 'Vaxxax' })],
      ['Vaxxas', 'Seqwater'],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/one character from "Vaxxas"/);
    expect(problems[0]).toMatch(/will not be\s+found/);
  });

  it('leaves the name alone rather than correcting it', () => {
    // The office system is the record. Renaming it here breaks the match
    // instead of fixing it — the fix belongs upstream.
    const rates = [rate({ id: 'x', name: 'Vaxxax Normal Hours Labour', customerName: 'Vaxxax' })];
    suspectRateNames(rates, ['Vaxxas']);
    expect(rates[0]!.customerName).toBe('Vaxxax');
  });

  it('says nothing about a name that matches a customer exactly', () => {
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Acme Normal Hours Labour', customerName: 'Acme' })], ['Acme'],
    )).toEqual([]);
  });

  it('does not flag a name that is nothing like any customer', () => {
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Default', customerName: 'Zzzz Pty Ltd' })], ['Acme', 'Seqwater'],
    )).toEqual([]);
  });

  it('ignores general rates, which have no customer to match', () => {
    expect(suspectRateNames(RATES.filter((r) => !r.customerName), ['Acme'])).toEqual([]);
  });

  it('catches a dropped character as well as a wrong one', () => {
    // "Seqwater" filed as "Seqater". A substitution is the case that was
    // tested; a typist is at least as likely to miss a key as hit the wrong one.
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Seqater Labour', customerName: 'Seqater' })], ['Seqwater'],
    )).toHaveLength(1);
  });

  it('catches an extra character', () => {
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Seqwaterr Labour', customerName: 'Seqwaterr' })], ['Seqwater'],
    )).toHaveLength(1);
  });

  it('stays quiet at two characters out, which is a different customer', () => {
    /*
     * The line has to be somewhere. Two edits reaches names that are genuinely
     * different companies, and a warning against every roughly similar name is
     * one nobody reads — which costs more than the miss, because the whole
     * point is that the one real typo stands out.
     */
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Seqwerer Labour', customerName: 'Seqwerer' })], ['Seqwater'],
    )).toEqual([]);
  });

  it('stays quiet where the lengths differ by two', () => {
    expect(suspectRateNames(
      [rate({ id: 'x', name: 'Seq Labour', customerName: 'Seqwa' })], ['Seqwater'],
    )).toEqual([]);
  });
});

describe('turning the settings figures into a card', () => {
  const prefs = (over: Partial<RateCardPrefs> = {}): RateCardPrefs => ({
    normalHoursSellCents: 13_000,
    afterHoursSellCents: 18_500,
    attendanceNormalCents: 30_000,
    attendanceNormalMinutes: 120,
    attendanceAfterHoursCents: 57_500,
    attendanceAfterHoursMinutes: 180,
    ...over,
  });

  it('leaves out a rate set to zero rather than quoting a free hour', () => {
    /*
     * Nought in a settings box means "not set up", never "no charge". Carried
     * through as a rate it produces a labour line at nought dollars, which
     * reads on a quote as work deliberately not being charged for.
     */
    const card = rateCardFrom(prefs({ afterHoursSellCents: 0 }));
    expect(card.rates.map((r) => r.hours)).toEqual(['normal']);
  });

  it('leaves out an attendance fee set to zero', () => {
    const card = rateCardFrom(prefs({ attendanceAfterHoursCents: 0 }));
    expect(card.fees.map((f) => f.hours)).toEqual(['normal']);
  });

  it('builds both bands where both are set', () => {
    const card = rateCardFrom(prefs());
    expect(card.rates).toHaveLength(2);
    expect(card.fees).toHaveLength(2);
  });
});

describe('saying which card the money came from', () => {
  /*
   * The source claim, and until now nothing checked it. The module promises a
   * figure on a screen can always be traced to where it came from, and the
   * mixed case is the one that matters: a Simpro key without setup scope
   * commonly reads labour rates and not service fees, so half the card arrives
   * from the office and half is what somebody typed into Settings months ago.
   *
   * Getting the note wrong is worse than having no note. "Rates came from the
   * office system" over a stale typed figure is a false provenance on a number
   * that ends up on a quote.
   */
  const prefs: RateCardPrefs = {
    normalHoursSellCents: 13_000, afterHoursSellCents: 18_500,
    attendanceNormalCents: 30_000, attendanceNormalMinutes: 120,
    attendanceAfterHoursCents: 57_500, attendanceAfterHoursMinutes: 180,
  };
  const none: RateCardPrefs = {
    normalHoursSellCents: 0, afterHoursSellCents: 0,
    attendanceNormalCents: 0, attendanceNormalMinutes: 0,
    attendanceAfterHoursCents: 0, attendanceAfterHoursMinutes: 0,
  };

  it('says so when the whole card came from the office', () => {
    const card = effectiveRateCard({ rates: RATES, fees: FEES, pulledAt: '2026-08-30T04:00:00Z' }, prefs);
    expect(card.rateSource).toBe('office');
    expect(card.feeSource).toBe('office');
    expect(card.note).toBe('Rates and attendance fees came from the office system. Pulled 2026-08-30.');
  });

  it('names each half separately where only the rates arrived', () => {
    // The common real case: a key that can read rates but not service fees.
    const card = effectiveRateCard({ rates: RATES, fees: [], pulledAt: '2026-08-30T04:00:00Z' }, prefs);
    expect(card.rateSource).toBe('office');
    expect(card.feeSource).toBe('settings');
    expect(card.note).toBe(
      'Labour rates came from the office system, attendance fees are the ones typed into Settings. '
      + 'Pulled 2026-08-30.',
    );
  });

  it('keeps a typed attendance fee when the office answered only for rates', () => {
    // Throwing it away because the rates arrived would quietly stop charging
    // attendances, which is the larger half of a short visit.
    const card = effectiveRateCard({ rates: RATES, fees: [] }, prefs);
    expect(card.fees).toHaveLength(2);
    expect(card.fees[0]!.chargeCents).toBe(30_000);
  });

  it('says the figures are the typed ones when nothing was pulled', () => {
    const card = effectiveRateCard({ rates: [], fees: [] }, prefs);
    expect(card.rateSource).toBe('settings');
    expect(card.feeSource).toBe('settings');
    expect(card.note).toBe(
      'Labour rates are the ones typed into Settings, attendance fees are the ones typed into Settings.',
    );
    expect(card.note).not.toContain('Pulled');
  });

  it('says plainly that there are no rates rather than showing a card of nothing', () => {
    const card = effectiveRateCard({ rates: [], fees: [] }, none);
    expect(card.rateSource).toBe('none');
    expect(card.feeSource).toBe('none');
    expect(card.note).toBe('No rates are set, so labour is shown as hours only.');
  });

  it('names the half that is missing where only one is', () => {
    const card = effectiveRateCard({ rates: [], fees: [] }, { ...none, normalHoursSellCents: 13_000 });
    expect(card.rateSource).toBe('settings');
    expect(card.feeSource).toBe('none');
    expect(card.note).toBe(
      'Labour rates are the ones typed into Settings, no attendance fee is set.',
    );
  });

  it('does not claim a pull date it was not given', () => {
    const card = effectiveRateCard({ rates: RATES, fees: FEES }, prefs);
    expect(card.note).toBe('Rates and attendance fees came from the office system.');
  });
});
