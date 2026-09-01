import {
  bandFromName, buildRateCard, customerFromName, kindFromName, mapLabourRates,
  mapServiceFees, sellCentsFor, type RawLabourRate, type RawServiceFee,
} from '@/simpro/rateCard';
import { chargeForAttendance } from '@/domain/rates';

/**
 * Turning Simpro's rate card into the app's.
 *
 * The failures worth catching are the quiet ones. A sell rate derived wrongly
 * prices every job. A band read wrongly out of a rate name bills after-hours
 * work at day rates. A cost rate that survives the trip puts the company's
 * margin on a phone. And a customer rate filed one letter out is never selected
 * for anyone.
 *
 * The payloads below are shaped like a real card and are not one — the figures
 * are invented.
 */

const rate = (over: Partial<RawLabourRate>): RawLabourRate => ({
  ID: 1, Name: 'Normal Hours Labour', CostRate: 110, Markup: 18.181818, ...over,
});

const fee = (over: Partial<RawServiceFee>): RawServiceFee => ({
  ID: 1, Name: 'Site Attendance Normal Hours', Amount: 300, IncludedLabourTime: 120, ...over,
});

describe('bandFromName', () => {
  it('reads the band Simpro does not flag', () => {
    expect(bandFromName('After Hours Labour')).toBe('after-hours');
    expect(bandFromName('AFTER-HOURS CALLOUT')).toBe('after-hours');
    expect(bandFromName('Out of Hours Labour')).toBe('after-hours');
    expect(bandFromName('Normal Hours Labour')).toBe('normal');
    expect(bandFromName('Site Attendance Normal Hours')).toBe('normal');
  });

  it("does not read 'hours' on its own as after hours", () => {
    expect(bandFromName('Standard Hours')).toBe('normal');
  });
});

describe('kindFromName', () => {
  it('separates a call-out from an hourly rate', () => {
    expect(kindFromName('Vaxxas After Hours Callout')).toBe('callout');
    expect(kindFromName('Site Attendance Normal Hours')).toBe('callout');
    expect(kindFromName('Normal Hours Labour')).toBe('labour');
  });
});

describe('customerFromName', () => {
  const customers = ['Vaxxas', 'Seqwater', 'Ipswich Hospital'];

  it('files a rate under a customer it can name', () => {
    expect(customerFromName('Vaxxas Normal Hours Labour', customers)).toBe('Vaxxas');
    expect(customerFromName('Ipswich Hospital After Hours Callout', customers)).toBe('Ipswich Hospital');
  });

  it('leaves a general rate general', () => {
    expect(customerFromName('After Hours Labour', customers)).toBeUndefined();
    expect(customerFromName('Normal Hours Labour', customers)).toBeUndefined();
  });

  it('keeps a near-miss with the spelling Simpro used, rather than correcting it', () => {
    // A real card carried both spellings one letter apart.
    expect(customerFromName('Vaxxax Normal Hours Labour', customers)).toBe('Vaxxax');
  });

  it('does not turn a trade word into a customer', () => {
    expect(customerFromName('Apprentice Labour', customers)).toBeUndefined();
    expect(customerFromName('Senior Technician Rate', customers)).toBeUndefined();
  });
});

describe('sellCentsFor', () => {
  it('works the sell rate out of cost plus markup, and says it did', () => {
    const r = sellCentsFor(rate({ CostRate: 110, Markup: 18.181818 }));
    expect(r.sellCents).toBe(13_000);
    expect(r.note).toContain('worked out from cost plus');
  });

  it('prefers a sell rate Simpro gave outright, with nothing to explain', () => {
    const r = sellCentsFor(rate({ SellRate: 130, CostRate: 110, Markup: 18.181818 }));
    expect(r.sellCents).toBe(13_000);
    expect(r.note).toBeUndefined();
  });

  it('reports a disagreement rather than splitting the difference', () => {
    const r = sellCentsFor(rate({ Name: 'Odd rate', SellRate: 130, CostRate: 110, Markup: 50 }));
    expect(r.sellCents).toBe(13_000);
    expect(r.note).toContain('disagree');
  });

  it('applies a multiplier and names it', () => {
    const r = sellCentsFor(rate({ CostRate: 100, Markup: 0, Multiplier: 1.5 }));
    expect(r.sellCents).toBe(15_000);
    expect(r.note).toContain('1.5× multiplier');
  });

  it('returns nothing when there is nothing to work with', () => {
    expect(sellCentsFor({ Name: 'Bare' }).sellCents).toBeUndefined();
  });

  it('reads a rate given as a string', () => {
    expect(sellCentsFor({ Name: 'x', SellRate: '$136.88' }).sellCents).toBe(13_688);
  });
});

describe('mapLabourRates', () => {
  it('drops the cost rate on the way in', () => {
    const { rates } = mapLabourRates([rate({})]);
    expect(rates[0]!.costCentsPerHour).toBe(0);
    expect(rates[0]!.sellCentsPerHour).toBe(13_000);
  });

  it('still reports the margin once, for the office to check the pull', () => {
    const { margins } = mapLabourRates([rate({ Name: 'After Hours Labour', CostRate: 110, SellRate: 185 })]);
    expect(margins).toEqual([{ name: 'After Hours Labour', percent: 40.5 }]);
  });

  it('skips a rate it cannot price rather than pricing it at nothing', () => {
    const { rates, skipped } = mapLabourRates([rate({ Name: 'Broken', CostRate: undefined, Markup: undefined })]);
    expect(rates).toEqual([]);
    expect(skipped[0]!.reason).toContain('no sell rate');
  });

  it('leaves archived rates out', () => {
    const { rates } = mapLabourRates([rate({ Archived: true })]);
    expect(rates).toEqual([]);
  });

  it('reads a tax code given as a percentage', () => {
    const { rates } = mapLabourRates([rate({ TaxCode: { Rate: 10 } })]);
    expect(rates[0]!.taxRate).toBe(0.1);
  });

  it('reads a tax code already given as a fraction', () => {
    const { rates } = mapLabourRates([rate({ TaxCode: { Rate: 0.1 } })]);
    expect(rates[0]!.taxRate).toBe(0.1);
  });

  it('flags a customer rate that is one letter from a real customer', () => {
    const { suspect } = mapLabourRates(
      [rate({ ID: 7, Name: 'Vaxxax Normal Hours Labour', SellRate: 125 })],
      ['Vaxxas'],
    );
    expect(suspect).toHaveLength(1);
    expect(suspect[0]).toContain('Vaxxax');
    expect(suspect[0]).toContain('Vaxxas');
  });

  it('says the band was read from the name, because Simpro does not flag it', () => {
    const { notes } = mapLabourRates([rate({ Name: 'After Hours Labour', SellRate: 185 })]);
    expect(notes.join(' ')).toContain('read from the rate name');
  });
});

describe('mapServiceFees', () => {
  it('reads the charge and the time it covers', () => {
    const { fees } = mapServiceFees([fee({})]);
    expect(fees[0]).toMatchObject({
      name: 'Site Attendance Normal Hours', chargeCents: 30_000, includedLabourMinutes: 120, hours: 'normal',
    });
  });

  it('reads an after-hours fee from its name', () => {
    const { fees } = mapServiceFees([fee({ Name: 'Site Attendance After Hours', Amount: 575, IncludedLabourTime: 180 })]);
    expect(fees[0]).toMatchObject({ chargeCents: 57_500, includedLabourMinutes: 180, hours: 'after-hours' });
  });

  it('accepts the several names Simpro has used for the charge', () => {
    expect(mapServiceFees([{ Name: 'a', Charge: 300 }]).fees[0]!.chargeCents).toBe(30_000);
    expect(mapServiceFees([{ Name: 'b', SellPrice: 300 }]).fees[0]!.chargeCents).toBe(30_000);
    expect(mapServiceFees([{ Name: 'c', Price: 300 }]).fees[0]!.chargeCents).toBe(30_000);
  });

  it('warns when no included time came back, instead of assuming one', () => {
    const { fees, notes } = mapServiceFees([fee({ IncludedLabourTime: undefined })]);
    expect(fees[0]!.includedLabourMinutes).toBe(0);
    expect(notes.join(' ')).toContain('covering no time');
  });

  it('skips a fee with no charge', () => {
    const { fees, skipped } = mapServiceFees([fee({ Amount: undefined })]);
    expect(fees).toEqual([]);
    expect(skipped[0]!.reason).toContain('no charge amount');
  });
});

describe('buildRateCard', () => {
  it('builds a card shaped like the real one', () => {
    const card = buildRateCard(
      [
        rate({ ID: 1, Name: 'Normal Hours Labour', CostRate: 110, SellRate: 130 }),
        rate({ ID: 2, Name: 'After Hours Labour', CostRate: 110, SellRate: 185 }),
        rate({ ID: 3, Name: 'Vaxxas Normal Hours Labour', CostRate: 136.88, SellRate: 125 }),
        rate({ ID: 4, Name: 'Vaxxas After Hours Callout', CostRate: 136.88, SellRate: 480 }),
      ],
      [
        fee({ ID: 1, Name: 'Site Attendance Normal Hours', Amount: 300, IncludedLabourTime: 120 }),
        fee({ ID: 2, Name: 'Site Attendance After Hours', Amount: 575, IncludedLabourTime: 180 }),
      ],
      ['Vaxxas'],
    );
    expect(card.rates).toHaveLength(4);
    expect(card.fees).toHaveLength(2);
    expect(card.rates.filter((r) => r.customerName === 'Vaxxas')).toHaveLength(2);
    expect(card.rates.find((r) => r.name === 'Vaxxas After Hours Callout')).toMatchObject({
      kind: 'callout', hours: 'after-hours', sellCentsPerHour: 48_000,
    });
    expect(card.suspect).toEqual([]);
    expect(card.skipped).toEqual([]);
    expect(card.rates.every((r) => r.costCentsPerHour === 0)).toBe(true);
  });

  it('says so when a band has a fee but no general rate behind it', () => {
    const card = buildRateCard(
      [rate({ ID: 1, Name: 'Normal Hours Labour', SellRate: 130 })],
      [fee({ ID: 2, Name: 'Site Attendance After Hours', Amount: 575, IncludedLabourTime: 180 })],
    );
    expect(card.notes.join(' ')).toContain('will not be charged at all');
  });

  it('does not warn about a band that has both', () => {
    const card = buildRateCard(
      [rate({ ID: 1, Name: 'Normal Hours Labour', SellRate: 130 })],
      [fee({ ID: 2, Name: 'Site Attendance Normal Hours', Amount: 300, IncludedLabourTime: 120 })],
    );
    expect(card.notes.join(' ')).not.toContain('will not be charged at all');
  });

  it('produces a card the charge functions can use as-is', () => {
    const card = buildRateCard(
      [rate({ ID: 1, Name: 'Normal Hours Labour', SellRate: 130 })],
      [fee({ ID: 2, Name: 'Site Attendance Normal Hours', Amount: 300, IncludedLabourTime: 120 })],
    );
    // Four hours: $300 covers two, the rest at $130.
    // Proven here rather than assumed, because the whole point of the pull is
    // that these two shapes meet.
    const charge = chargeForAttendance({
      minutesOnSite: 240, hours: 'normal', rates: card.rates, fees: card.fees, chargeAttendance: true,
    });
    expect(charge.subtotalCents).toBe(56_000);
    expect(charge.warnings).toEqual([]);
  });
});
