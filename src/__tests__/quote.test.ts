import {
  DEFAULT_EXCLUSIONS, DEFAULT_VALIDITY_DAYS, UNPRICEABLE_REASON, addDays, buildQuoteLines,
  canEdit, canTransition, editRefusal, expiryFor, formatQuoteReference, lapseStatus,
  lineAmountCents, pricingSources, qldDate, quoteTotals, scopeLinesFor, unpriceableDefects,
  unpriceableReason, weakestConfidence, type PriceSource, type Quote, type QuoteLine,
  orderQuotes, QUOTE_URGENCY, QUOTE_STATUS_LABEL, type QuoteStatus,
} from '@/domain/quote';
import { uncoveredDefects } from '@/domain/partsNeeded';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import { formatCents, type LabourRate } from '@/domain/rates';
import { defectByCode } from '@/seed/defectLibrary';
import type { Defect } from '@/domain/types';

/**
 * The client quote.
 *
 * This is the document someone signs, so the failures worth guarding are the
 * quiet ones. A cent of floating-point drift, a line priced at nothing that
 * reads as free work, a defect silently left off, or a six-month-old quote
 * accepted at last year's rates — none of them announce themselves, and every
 * one of them is money out the door.
 *
 * The rates below are shaped like a real card and are not one. Safe QLD's
 * actual rates are commercial terms and live in the office system.
 */

// $136.88 an hour: the kind of rate that does not survive floating point.
const HOURLY_CENTS = 13_688;
const HEAD_CENTS = 8_950;

const OFFICE: PriceSource = {
  kind: 'office',
  label: 'Rate card pulled from the office system',
  confidence: 'high',
};
const TYPED: PriceSource = {
  kind: 'entered',
  label: 'Price typed onto this quote on site',
  confidence: 'low',
};

const labourRate = (sellCentsPerHour = HOURLY_CENTS): LabourRate => ({
  id: 'nh',
  name: 'Labour — normal hours',
  costCentsPerHour: 0,
  sellCentsPerHour,
  taxRate: 0.1,
  efficiencyMultiplier: 1,
  kind: 'labour',
  hours: 'normal',
});

let n = 0;
function defect(defectCode?: string, over: Partial<Defect> = {}): Defect {
  n += 1;
  return {
    id: `d${n}`,
    siteId: 'site-1',
    location: 'Level 1 Corridor',
    description: 'Detector did not alarm on test',
    severity: 'critical',
    status: 'open',
    raisedAt: '2026-08-31T00:00:00.000Z',
    photos: [],
    defectCode,
    ...over,
  } as Defect;
}

/** A real library code with a material line and two labour lines behind it. */
const FAILED_DETECTOR = 'DET-DET-001';
/** A real library code that describes the work but supplies no priced items. */
const OBSTRUCTED = 'DET-DET-006';
/** A real library code whose only quote item is hours: a panel fault to trace. */
const PANEL_FAULT = 'DET-FIP-001';

const line = (over: Partial<QuoteLine> & Pick<QuoteLine, 'id' | 'section'>): QuoteLine => ({
  description: 'Line',
  unit: 'ea',
  quantity: 1,
  fromCodes: [],
  defectCount: 1,
  ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1',
  siteId: 'site-1',
  reference: 'Q-NPWTP-2026-004',
  clientName: 'Northern Facilities Group',
  siteName: 'Northern Water Treatment Plant',
  preparedBy: 'A. Technician',
  status: 'draft',
  validityDays: DEFAULT_VALIDITY_DAYS,
  discountCents: 0,
  lines: [],
  unpriceable: [],
  exclusions: [...DEFAULT_EXCLUSIONS],
  taxRate: 0.1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('building lines from defects', () => {
  it('keeps materials and labour in separate sections, as a real quote does', () => {
    // A client reads the two separately and queries them separately. A single
    // merged list is the first thing a facilities manager asks to have split.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR), defect(FAILED_DETECTOR), defect(FAILED_DETECTOR)],
      materialPrices: [{ description: 'Replacement detector head', unitCents: HEAD_CENTS, source: OFFICE }],
      labourRate: labourRate(),
      labourRateSource: OFFICE,
    });

    const materials = built.lines.filter((l) => l.section === 'materials');
    const labour = built.lines.filter((l) => l.section === 'labour');
    expect(materials.every((l) => l.unit !== 'hr')).toBe(true);
    expect(labour.every((l) => l.unit === 'hr')).toBe(true);

    // Three failed heads is one line for three, not three lines for one.
    const head = materials.find((l) => /detector head/i.test(l.description))!;
    expect(head.quantity).toBe(3);
    expect(head.defectCount).toBe(3);
    expect(head.fromCodes).toEqual([FAILED_DETECTOR]);
  });

  it("takes its hours from the library rather than from anyone's memory", () => {
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR), defect(FAILED_DETECTOR), defect(FAILED_DETECTOR)],
      labourRate: labourRate(),
      labourRateSource: OFFICE,
    });
    const code = defectByCode(FAILED_DETECTOR)!;
    const libraryHours = (code.quoteItems ?? [])
      .filter((q) => q.unit === 'hr')
      .reduce((t, q) => t + q.qtyPerDefect, 0) * 3;
    const quoted = built.lines
      .filter((l) => l.section === 'labour')
      .reduce((t, l) => t + l.quantity, 0);
    expect(quoted).toBeCloseTo(libraryHours, 6);
  });

  it('leaves a material with no price unpriced rather than pricing it at zero', () => {
    // Nothing in the app knows what a detector head sells for until someone
    // says. Zero would read on the document as supplied free of charge.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      labourRate: labourRate(),
      labourRateSource: OFFICE,
    });
    const head = built.lines.find((l) => /detector head/i.test(l.description))!;
    expect(head.unitCents).toBeUndefined();
    expect(head.source).toBeUndefined();
    expect(lineAmountCents(head)).toBeUndefined();
  });

  it('matches a material price exactly and never nearly', () => {
    // "Replacement detector head" and "Replacement detector base" are one word
    // apart and cost different money. A near-miss match survives to an invoice
    // dispute, so nothing here is fuzzy.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      materialPrices: [{ description: 'Replacement detector base', unitCents: 4_200, source: OFFICE }],
    });
    expect(built.lines.find((l) => /detector head/i.test(l.description))!.unitCents).toBeUndefined();
  });

  it('matches a material price regardless of case and surrounding space', () => {
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      materialPrices: [{ description: '  REPLACEMENT DETECTOR HEAD ', unitCents: HEAD_CENTS, source: TYPED }],
    });
    expect(built.lines.find((l) => /detector head/i.test(l.description))!.unitCents).toBe(HEAD_CENTS);
  });

  it('refuses to use a labour rate that arrives without a source', () => {
    // A figure nobody can trace cannot be defended when the client asks where
    // it came from, and an untraceable rate is exactly how last year's card
    // ends up on this year's quote.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      labourRate: labourRate(),
    });
    expect(built.lines.filter((l) => l.section === 'labour').every((l) => l.unitCents === undefined)).toBe(true);
  });

  it('says out loud that it refused a labour rate with no source, rather than only leaving it blank', () => {
    // A refused rate and a rate nobody set look identical on the screen: both
    // leave the hours unpriced. Only the warning says which happened, and only
    // one of the two is something the technician can go and fix.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      labourRate: labourRate(),
    });
    expect(built.warnings.join(' ')).toMatch(/nothing saying where it came from/i);
  });

  it('refuses a material price that is not a whole number of cents rather than printing it', () => {
    // $89.505 formats as "$89.50.5" on the document, and it means dollars were
    // multiplied out somewhere upstream. The line stays unpriced and says so.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      materialPrices: [{ description: 'Replacement detector head', unitCents: 8_950.5, source: OFFICE }],
    });
    expect(built.lines.find((l) => /detector head/i.test(l.description))!.unitCents).toBeUndefined();
    expect(built.warnings.join(' ')).toMatch(/not a whole number of cents/i);
  });

  it('refuses a material price of nothing rather than supplying the part free', () => {
    // Zero is not a price. On a signed document it reads as included at no
    // charge, and the client is entitled to read it that way.
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR)],
      materialPrices: [{ description: 'Replacement detector head', unitCents: 0, source: OFFICE }],
    });
    expect(built.lines.find((l) => /detector head/i.test(l.description))!.unitCents).toBeUndefined();
    expect(built.warnings.join(' ')).toMatch(/above nought/i);
  });

  it('gives a line the same id whichever defects are ticked on', () => {
    // The technician types a price against a line, then ticks one more defect.
    // A regenerated id would drop the price they just typed.
    const one = buildQuoteLines({ defects: [defect(FAILED_DETECTOR)] });
    const two = buildQuoteLines({ defects: [defect(FAILED_DETECTOR), defect(FAILED_DETECTOR)] });
    expect(one.lines.map((l) => l.id).sort()).toEqual(two.lines.map((l) => l.id).sort());
  });
});

describe('defects that cannot be priced at all', () => {
  it('surfaces a defect whose library entry supplies no quote line', () => {
    // An obstructed detector: the library says clear the obstruction and stops,
    // because the work depends on what is in the way. Left off the quote it
    // becomes free work nobody notices until the job is done.
    const code = defectByCode(OBSTRUCTED)!;
    expect(code.quoteItems ?? []).toHaveLength(0);

    const built = buildQuoteLines({ defects: [defect(FAILED_DETECTOR), defect(OBSTRUCTED)] });
    expect(built.unpriceable).toHaveLength(1);
    expect(built.unpriceable[0]).toMatchObject({ defectCode: OBSTRUCTED, reason: 'no-quote-lines' });
  });

  it('separates a free-text defect from one carrying a code this build does not know', () => {
    // They need different answers: one wants a line writing, the other wants
    // the library updating, and a single "could not price" hides which.
    const found = unpriceableDefects([defect(undefined), defect('ZZZ-ZZZ-999')]);
    expect(found.map((u) => u.reason)).toEqual(['no-code', 'unknown-code']);
    expect(UNPRICEABLE_REASON['unknown-code']).toMatch(/does not know/i);
  });

  it("counts a labour-only defect as priced, unlike the parts order does", () => {
    // partsNeeded calls a labour-only defect uncovered because a supplier
    // cannot ship labour. On a quote labour is exactly what is being sold, so
    // the same defect is fully covered and must not be reported as missed.
    // The defect has to be genuinely labour-only for this to test anything:
    // against a defect that also needs a part, both answers are "covered" and
    // the assertion would pass on either rule.
    const code = defectByCode(PANEL_FAULT)!;
    expect((code.quoteItems ?? []).every((q) => q.unit === 'hr')).toBe(true);

    const labourOnly = defect(PANEL_FAULT);
    expect(uncoveredDefects([labourOnly]).map((u) => u.reason)).toEqual(['labour-only']);
    expect(unpriceableDefects([labourOnly])).toHaveLength(0);
  });

  it('says the reason was not recorded rather than printing nothing for one it does not know', () => {
    // The list is JSON on the quote row, so a build that has never heard of a
    // reason can still be asked to print one. "undefined" on a client's copy
    // is worse than saying plainly that nobody wrote the reason down.
    expect(unpriceableReason('no-quote-lines')).toBe(UNPRICEABLE_REASON['no-quote-lines']);
    expect(unpriceableReason('something-a-later-build-invented')).toMatch(/reason was not recorded/i);
  });

  it('warns on the total for every defect it could not price', () => {
    const built = buildQuoteLines({
      defects: [defect(FAILED_DETECTOR), defect(OBSTRUCTED, { description: 'Stock stacked under detector' })],
      materialPrices: [{ description: 'Replacement detector head', unitCents: HEAD_CENTS, source: OFFICE }],
      labourRate: labourRate(),
      labourRateSource: OFFICE,
    });
    const totals = quoteTotals(quote({ lines: built.lines, unpriceable: built.unpriceable }));
    expect(totals.incomplete).toBe(true);
    expect(totals.warnings.join(' ')).toMatch(/priced at nothing/i);
    expect(totals.warnings.join(' ')).toMatch(/Stock stacked under detector/);
  });
});

describe('holding the money', () => {
  it('keeps cents exact at $136.88 an hour across several lines', () => {
    // In dollars-as-floats this is the sum that lands on 239.53999999999996.
    const lines: QuoteLine[] = [
      line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1.75, unitCents: HOURLY_CENTS }),
      line({ id: 'l2', section: 'labour', unit: 'hr', quantity: 0.25, unitCents: HOURLY_CENTS }),
      line({ id: 'l3', section: 'labour', unit: 'hr', quantity: 2.1, unitCents: HOURLY_CENTS }),
    ];
    expect(lineAmountCents(lines[0]!)).toBe(23_954);
    expect(lineAmountCents(lines[1]!)).toBe(3_422);
    expect(lineAmountCents(lines[2]!)).toBe(28_745);

    const totals = quoteTotals(quote({ lines }));
    expect(totals.labourCents).toBe(23_954 + 3_422 + 28_745);
    expect(formatCents(totals.labourCents)).toBe('$561.21');
  });

  it('works GST once on the subtotal, not once per line', () => {
    // Three quarter-hours at $136.87. Per line the GST rounds to $3.42 and
    // three of those is $10.26; on the subtotal it is $10.27. The client signs
    // the total, so the total is where the GST is worked.
    const lines: QuoteLine[] = [1, 2, 3].map((i) => line({
      id: `l${i}`, section: 'labour', unit: 'hr', quantity: 0.25, unitCents: 13_687,
    }));
    const totals = quoteTotals(quote({ lines }));

    expect(totals.subtotalCents).toBe(10_266);
    expect(totals.gstCents).toBe(1_027);
    const perLineGst = lines.reduce((t, l) => t + Math.round(lineAmountCents(l)! * 0.1), 0);
    expect(perLineGst).toBe(1_026);
    expect(totals.gstCents).not.toBe(perLineGst);
    expect(totals.totalCents).toBe(11_293);
  });

  it('makes the printed column add up to the printed subtotal', () => {
    // A client with a calculator has to reach the figure they are signing for.
    const lines: QuoteLine[] = [
      line({ id: 'm1', section: 'materials', quantity: 3, unitCents: 8_933 }),
      line({ id: 'm2', section: 'materials', quantity: 7, unitCents: 1_249 }),
      line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2.25, unitCents: 13_688 }),
    ];
    const totals = quoteTotals(quote({ lines }));
    const printed = lines.reduce((t, l) => t + lineAmountCents(l)!, 0);
    expect(totals.workCents).toBe(printed);
    expect(totals.subtotalCents).toBe(printed);
  });

  it('never lets a float reach a total', () => {
    // Every figure on this quote is a whole number of cents. One float in the
    // chain and the document says $300.00000000000006.
    const totals = quoteTotals(quote({
      lines: [
        line({ id: 'm1', section: 'materials', quantity: 7, unitCents: 1_249 }),
        line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2.1, unitCents: HOURLY_CENTS }),
        line({ id: 'l2', section: 'labour', unit: 'hr', quantity: 0.75, unitCents: 13_687 }),
      ],
      discountCents: 1_337,
    }));
    for (const [key, value] of Object.entries(totals)) {
      if (typeof value !== 'number') continue;
      expect([key, Number.isInteger(value)]).toEqual([key, true]);
    }
  });

  it('leaves an unpriced line out of the total and says so', () => {
    // Counted as zero it would produce a total that looks complete and is not.
    const totals = quoteTotals(quote({
      lines: [
        line({ id: 'm1', section: 'materials', description: 'Replacement detector head', quantity: 3 }),
        line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1.5, unitCents: HOURLY_CENTS }),
      ],
    }));
    expect(totals.materialsCents).toBe(0);
    expect(totals.labourCents).toBe(20_532);
    expect(totals.unpricedLines).toHaveLength(1);
    expect(totals.incomplete).toBe(true);
    expect(totals.warnings.join(' ')).toMatch(/Replacement detector head.*not in the total/s);
  });

  it('says outright when nothing on the quote is priced', () => {
    const totals = quoteTotals(quote({ lines: [line({ id: 'm1', section: 'materials' })] }));
    expect(totals.warnings.join(' ')).toMatch(/Nothing on this quote is priced/);
  });

  it('warns rather than presenting an empty quote as free work', () => {
    const totals = quoteTotals(quote({ lines: [] }));
    expect(totals.totalCents).toBe(0);
    expect(totals.warnings.join(' ')).toMatch(/reads to a client as free work/);
  });
});

describe('the discount', () => {
  it('comes off in whole cents before GST is worked', () => {
    const totals = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2, unitCents: HOURLY_CENTS })],
      discountCents: 2_376,
    }));
    expect(totals.workCents).toBe(27_376);
    expect(totals.subtotalCents).toBe(25_000);
    expect(totals.gstCents).toBe(2_500);
    expect(totals.totalCents).toBe(27_500);
  });

  it('lets a job be written off entirely without calling it an error', () => {
    /*
     * A discount equal to the work is a real thing — goodwill, a warranty
     * rectification, work done to keep a client. It comes to nothing owing,
     * which is the correct answer, and warning about it puts a query on a
     * decision somebody made deliberately.
     *
     * A cent more than the work is the one worth flagging: the total goes
     * negative, and nothing here clamps it.
     */
    const wholeJob = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2, unitCents: HOURLY_CENTS })],
      discountCents: 27_376,
    }));
    expect(wholeJob.subtotalCents).toBe(0);
    expect(wholeJob.totalCents).toBe(0);
    expect(wholeJob.warnings.filter((w) => w.includes('larger than the work'))).toEqual([]);

    const overshoot = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2, unitCents: HOURLY_CENTS })],
      discountCents: 27_377,
    }));
    expect(overshoot.warnings.some((w) => w.includes('larger than the work'))).toBe(true);
  });

  it('says nothing about a quote with no discount on it', () => {
    // Nought is the ordinary case, not a negative one. A warning here would
    // appear on every quote this company writes.
    const totals = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2, unitCents: HOURLY_CENTS })],
      discountCents: 0,
    }));
    expect(totals.warnings.filter((w) => w.includes('discount'))).toEqual([]);
  });

  it('refuses a discount that is not whole cents rather than rounding it quietly', () => {
    // A fraction of a cent means a percentage was multiplied out somewhere. If
    // this rounded it, the quote and the office system would differ by a cent
    // depending on which of them rounded first.
    const totals = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 2, unitCents: HOURLY_CENTS })],
      discountCents: 1_368.8,
    }));
    expect(totals.discountCents).toBe(0);
    expect(totals.subtotalCents).toBe(27_376);
    expect(totals.warnings.join(' ')).toMatch(/not a whole number of cents/);
  });

  it('reports a discount bigger than the work instead of clamping it', () => {
    // Clamping to zero would hide a typo that turns a $500 discount into
    // $50,000 and leaves the total looking deliberate.
    const totals = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS })],
      discountCents: 50_000,
    }));
    expect(totals.subtotalCents).toBe(13_688 - 50_000);
    expect(totals.warnings.join(' ')).toMatch(/larger than the work/);
  });

  it('calls a negative discount what it is', () => {
    const totals = quoteTotals(quote({
      lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS })],
      discountCents: -5_000,
    }));
    expect(totals.warnings.join(' ')).toMatch(/adds to the price/);
  });
});

describe('Queensland dates', () => {
  it('dates a quote by the Queensland calendar and not by UTC', () => {
    // Eight in the morning in Brisbane is 22:00 the previous day in UTC.
    // Slicing the timestamp dates the quote a day early and expires it a day
    // early with it. Queensland is UTC+10 all year — there is no daylight
    // saving to complicate this, only the offset to remember.
    const earlyMorningBrisbane = '2026-09-01T22:00:00.000Z';
    expect(earlyMorningBrisbane.slice(0, 10)).toBe('2026-09-01');
    expect(qldDate(earlyMorningBrisbane)).toBe('2026-09-02');
  });

  it('leaves a date-only string alone rather than shifting it', () => {
    expect(qldDate('2026-09-02')).toBe('2026-09-02');
  });

  it('refuses a date it cannot read instead of guessing at today', () => {
    expect(qldDate('not a date')).toBeUndefined();
    expect(qldDate(undefined)).toBeUndefined();
    expect(addDays('rubbish', 30)).toBeUndefined();
  });

  it('expires thirty days after the Queensland issue date by default', () => {
    expect(DEFAULT_VALIDITY_DAYS).toBe(30);
    expect(expiryFor('2026-09-01T22:00:00.000Z')).toBe('2026-10-02');
    expect(expiryFor('2026-09-02')).toBe('2026-10-02');
    expect(expiryFor('2026-09-02', 7)).toBe('2026-09-09');
  });

  it('refuses a validity it cannot honour rather than substituting thirty days', () => {
    // A quote silently held open three weeks longer than intended is priced at
    // rates three weeks out of date.
    expect(expiryFor('2026-09-02', 0)).toBeUndefined();
    expect(expiryFor('2026-09-02', -5)).toBeUndefined();
    expect(expiryFor('2026-09-02', 14.5)).toBeUndefined();
    expect(expiryFor(undefined)).toBeUndefined();
  });
});

describe('whether a quote still holds good', () => {
  const issued = quote({ status: 'issued', issuedAt: '2026-09-02', expiresAt: '2026-10-02' });

  it('holds good on the expiry date itself', () => {
    // "Valid for thirty days" that dies on the thirtieth morning is
    // twenty-nine days of validity and an argument with a client who accepted
    // on time.
    const check = lapseStatus(issued, '2026-10-02T05:00:00.000Z');
    expect(check.lapsed).toBe(false);
    expect(check.daysRemaining).toBe(0);
    expect(check.note).toMatch(/last day/);
  });

  it('has lapsed the following day', () => {
    const check = lapseStatus(issued, '2026-10-02T23:00:00.000Z');
    expect(check.lapsed).toBe(true);
    expect(check.daysRemaining).toBe(-1);
    expect(check.note).toMatch(/Prices move/);
  });

  it("says it does not know rather than answering false for a quote never issued", () => {
    // False would read as "still valid", which is the opposite of the truth
    // about a draft: it was never offered to anybody.
    const check = lapseStatus(quote({ status: 'draft' }), '2026-12-25');
    expect(check.lapsed).toBeUndefined();
    expect(check.note).toMatch(/Not issued yet/);
  });

  it('says it does not know when the dates cannot be read', () => {
    const check = lapseStatus({ status: 'issued', expiresAt: 'sometime' }, '2026-10-02');
    expect(check.lapsed).toBeUndefined();
    expect(check.note).toMatch(/unknown/);
  });

  it('warns on the totals when an issued quote has run out', () => {
    const totals = quoteTotals(
      { ...issued, lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS })] },
      '2026-11-01',
    );
    expect(totals.warnings.join(' ')).toMatch(/Lapsed 30 days ago/);
  });
});

describe('the state machine', () => {
  const draft = quote();
  const issued = quote({ status: 'issued', issuedAt: '2026-09-02', expiresAt: '2026-10-02' });

  it('lets a draft be issued', () => {
    expect(canTransition(draft, 'issued')).toEqual({ allowed: true });
  });

  it('lets an issued quote be accepted, declined or expired', () => {
    expect(canTransition(issued, 'accepted', '2026-09-10').allowed).toBe(true);
    expect(canTransition(issued, 'declined', '2026-09-10').allowed).toBe(true);
    expect(canTransition(issued, 'expired', '2026-10-03').allowed).toBe(true);
  });

  it('refuses to accept a quote that was never issued', () => {
    // Accepting a draft means the client accepted something nobody sent them.
    const check = canTransition(draft, 'accepted', '2026-09-10');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/draft quote cannot be marked accepted/i);
  });

  it('refuses to put an issued quote back to draft', () => {
    // The client is holding a numbered document. Editing ours makes the two
    // disagree while both look authoritative.
    const check = canTransition(issued, 'draft');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/raise a new quote/i);
  });

  it('refuses to accept a lapsed quote', () => {
    // This is the entire reason the expiry date exists. A six-month-old quote
    // accepted at last year's rates is a job done at a loss.
    const check = canTransition(issued, 'accepted', '2026-10-15');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/lapsed 13 days ago/i);
  });

  it('refuses to mark a quote expired before it has run out', () => {
    // If the client has said no, that is declined. Running out of time and
    // being turned down are different conversations and different follow-ups.
    const check = canTransition(issued, 'expired', '2026-09-20');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/mark it declined/i);
  });

  it('refuses to mark a quote expired with no date to check against', () => {
    expect(canTransition(issued, 'expired').allowed).toBe(false);
  });

  it('refuses to accept a quote with no date to check it against either', () => {
    // "No date given" is not "it has not lapsed". Read as the second, a quote
    // six months past its date is accepted at last year's prices by a caller
    // that simply did not pass today in.
    const check = canTransition(issued, 'accepted');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/needs a date to check it against/i);
  });

  it('counts a single day of lapse as one day, not one days', () => {
    // The refusal goes straight on the screen and into an email to a client.
    const check = canTransition(issued, 'accepted', '2026-10-03');
    expect(check.reason).toMatch(/lapsed 1 day ago/);
  });

  it('refuses to expire a quote that has been accepted', () => {
    // Acceptance closed it. A date passing does not undo an agreement, and a
    // job in progress must not quietly stop being sold work.
    const accepted = quote({ status: 'accepted', expiresAt: '2026-10-02' });
    const check = canTransition(accepted, 'expired', '2026-11-01');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/has been accepted/i);
  });

  it('treats declined and expired as finished with', () => {
    for (const status of ['declined', 'expired'] as const) {
      const check = canTransition(quote({ status }), 'accepted', '2026-09-10');
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/Raise a new one at current rates/);
    }
  });

  it('refuses a transition to the status it is already in', () => {
    // Re-issuing an issued quote would move the expiry date under a client who
    // is already holding the document.
    expect(canTransition(issued, 'issued').allowed).toBe(false);
    expect(canTransition(issued, 'issued').reason).toMatch(/already issued/i);
  });

  it('lets only a draft be edited, and says why not otherwise', () => {
    expect(canEdit(draft)).toBe(true);
    expect(editRefusal(draft)).toBeUndefined();
    expect(canEdit(issued)).toBe(false);
    expect(editRefusal(issued)).toMatch(/an issued quote that changes is a different quote/i);
    expect(editRefusal(quote({ status: 'accepted' }))).toMatch(/accepted/);
  });
});

describe('where the figures came from', () => {
  it('reports every distinct source once', () => {
    const lines = [
      line({ id: 'm1', section: 'materials', unitCents: HEAD_CENTS, source: TYPED }),
      line({ id: 'm2', section: 'materials', unitCents: 4_200, source: TYPED }),
      line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS, source: OFFICE }),
    ];
    expect(pricingSources(lines).map((s) => s.kind)).toEqual(['entered', 'office']);
  });

  it('reports the weakest confidence anything on the quote rests on', () => {
    // A total is only as good as its worst figure. A quote half built from
    // prices typed on a phone should not look as settled as one off the card.
    const lines = [
      line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS, source: OFFICE }),
      line({ id: 'm1', section: 'materials', unitCents: HEAD_CENTS, source: TYPED }),
    ];
    expect(weakestConfidence(lines)).toBe('low');
    expect(weakestConfidence([lines[0]!])).toBe('high');
    expect(weakestConfidence([])).toBeUndefined();
  });
});

describe('the quote number', () => {
  it('carries the site, the year and a sequence', () => {
    expect(formatQuoteReference('NPWTP', 4, '2026-09-02')).toBe('Q-NPWTP-2026-004');
    expect(formatQuoteReference('north pine wtp', 12, '2026-09-02')).toBe('Q-NORTH-PINE-WTP-2026-012');
  });

  it('refuses to make up a number it cannot build', () => {
    expect(formatQuoteReference('', 4, '2026-09-02')).toBeUndefined();
    expect(formatQuoteReference('NPWTP', 0, '2026-09-02')).toBeUndefined();
    expect(formatQuoteReference('NPWTP', 1.5, '2026-09-02')).toBeUndefined();
  });

  it('leaves the year out rather than guessing at it before issue', () => {
    expect(formatQuoteReference('NPWTP', 4)).toBe('Q-NPWTP-004');
  });
});

describe("the scope in the client's words", () => {
  it("uses the library's client wording rather than the compliance wording", () => {
    // The report wording is written for a compliance record and reads as an
    // accusation in a quote.
    const code = defectByCode(FAILED_DETECTOR)!;
    const scope = scopeLinesFor([defect(FAILED_DETECTOR)]);
    expect(scope[0]!.text).toBe(code.clientWording);
    expect(scope[0]!.text).not.toBe(code.reportWording);
  });

  it("falls back to the library's own words for a code with no client wording", () => {
    // A panel fault carries no client wording, and a defect raised by picking
    // the code can carry no typed description either. Dropped from the scope,
    // the client is charged two hours for work the document never describes.
    const scope = scopeLinesFor([defect(PANEL_FAULT, { description: '  ' })]);
    expect(scope).toHaveLength(1);
    expect(scope[0]!.text).toMatch(/Fire indicator panel/i);
  });

  it("falls back to the technician's own description, never to nothing", () => {
    const scope = scopeLinesFor([defect(undefined, { description: 'Bell in the loading dock does not sound' })]);
    expect(scope[0]!.text).toBe('Bell in the loading dock does not sound');
  });
});

describe('the document a client receives', () => {
  const built = buildQuoteLines({
    defects: [
      defect(FAILED_DETECTOR),
      defect(FAILED_DETECTOR),
      defect(OBSTRUCTED, { location: 'Store 2', description: 'Pallets stacked under detector' }),
    ],
    materialPrices: [{ description: 'Replacement detector head', unitCents: HEAD_CENTS, source: OFFICE }],
    labourRate: labourRate(),
    labourRateSource: OFFICE,
  });
  const issued = quote({
    status: 'issued',
    issuedAt: '2026-09-01T22:00:00.000Z',
    expiresAt: '2026-10-02',
    lines: built.lines,
    unpriceable: built.unpriceable,
    discountCents: 5_000,
    discountReason: 'Goodwill on repeat work',
  });
  const html = quoteDocumentHtml({ quote: issued, scopeItems: scopeLinesFor([defect(FAILED_DETECTOR)]) });

  it('prints Australian dates and never American ones', () => {
    // 10/02/2026 read as the second of October by an Australian client and as
    // the tenth of February by the software that wrote it is a month of
    // validity nobody agreed on.
    expect(html).toContain('02/10/2026');
    expect(html).not.toContain('10/02/2026');
  });

  it('shows GST separately from the amount it is charged on', () => {
    const totals = quoteTotals(issued);
    expect(html).toContain('GST at 10%');
    expect(html).toContain(formatCents(totals.gstCents));
    expect(html).toContain(formatCents(totals.subtotalCents));
    expect(html).toContain(formatCents(totals.totalCents));
  });

  it('splits materials from labour, each with its own subtotal', () => {
    expect(html).toMatch(/<td colspan="4">Materials<\/td>/);
    expect(html).toMatch(/<td colspan="4">Labour<\/td>/);
    expect(html).toContain('Materials subtotal');
    expect(html).toContain('Labour subtotal');
  });

  it('shows the discount as an amount off rather than folding it into the lines', () => {
    // A client who cannot see the discount does not know they were given one.
    expect(html).toContain('Goodwill on repeat work');
    expect(html).toContain('-$50.00');
  });

  it('calls an amount added to the price an addition and not a discount', () => {
    // A negative discount adds to the subtotal. Printed as "Discount $50.00"
    // the client reads fifty dollars off while the figure went fifty dollars
    // up, and the column stops adding up in front of them.
    const out = quoteDocumentHtml({
      quote: quote({
        lines: [line({ id: 'l1', section: 'labour', unit: 'hr', quantity: 1, unitCents: HOURLY_CENTS })],
        discountCents: -5_000,
        discountReason: 'Out of hours attendance',
      }),
    });
    expect(out).toMatch(/Additional amount — Out of hours attendance/);
    expect(out).not.toMatch(/Discount — Out of hours attendance/);
  });

  it('names a defect it could not price rather than leaving it off quietly', () => {
    expect(html).toContain('Pallets stacked under detector');
    expect(html).toMatch(/NOT covered by it/);
  });

  it('prints an unpriced line as not priced and never as $0.00', () => {
    const unpriced = quote({
      lines: [line({ id: 'm1', section: 'materials', description: 'Replacement sounder', quantity: 2 })],
    });
    const out = quoteDocumentHtml({ quote: unpriced });
    // The materials subtotal below it is legitimately $0.00. The line itself
    // must not be, so the assertion is on that row and nothing else.
    const row = out.match(/<tr>\s*<td>Replacement sounder[\s\S]*?<\/tr>/)![0];
    expect(row).toContain('Not priced');
    expect(row).not.toContain('$0.00');
  });

  it('carries an acceptance block with somewhere to sign', () => {
    // An emailed "yes please" is not something anyone can point to when the
    // invoice is queried nine months later.
    expect(html).toContain('Acceptance');
    expect(html).toMatch(/Accepted for the client by/);
    expect(html).toMatch(/Signature/);
    expect(html).toMatch(/Purchase order number/);
    expect(html).toMatch(/class="sig"/);
  });

  it('states what is not included', () => {
    expect(html).toContain('Not included:');
    expect(html).toMatch(/scissor lifts/i);
  });

  it('says it is a quotation and not a tax invoice', () => {
    expect(html).toMatch(/not a tax invoice/i);
    expect(html).toMatch(/Goods and Services Tax\) Act 1999/);
  });

  it('says where the prices came from', () => {
    expect(html).toMatch(/Basis of pricing: Rate card pulled from the office system/);
  });

  it('marks a draft as a draft on its face', () => {
    // A draft that reaches a client looking like an issued quote gets accepted.
    const out = quoteDocumentHtml({ quote: quote({ status: 'draft' }) });
    expect(out).toMatch(/not a final issued quotation/i);
    expect(out).toContain('Not yet issued');
    expect(html).not.toMatch(/not a final issued quotation/i);
  });

  it('escapes anything that came from a person', () => {
    // Site and client names carry ampersands and angle brackets routinely, and
    // a name that closes a tag produces a document that renders as nonsense.
    const out = quoteDocumentHtml({
      quote: quote({
        clientName: 'Smith & Sons <Holdings>',
        siteName: '</table><script>alert(1)</script>',
      }),
    });
    expect(out).toContain('Smith &amp; Sons &lt;Holdings&gt;');
    expect(out).not.toContain('<script>');
  });
});


describe('the order a list of quotes is read in', () => {
  /*
   * There was no list at all: the builder saved a quote and nothing could show
   * it again. Which one a person sees first is the whole value of having one,
   * and across 897 sites an alphabetical list buries the quote about to lapse
   * at whatever letter its site starts with.
   */
  const q = (over: Partial<Parameters<typeof orderQuotes>[0][number]> = {}) => ({
    status: 'issued' as QuoteStatus,
    siteName: 'A Site',
    expiresAt: undefined as string | undefined,
    ...over,
  });
  const TODAY = '2026-09-01T00:00:00.000Z';

  it('puts what a client still has to answer above what is settled', () => {
    const out = orderQuotes([
      q({ status: 'accepted', siteName: 'Accepted' }),
      q({ status: 'declined', siteName: 'Declined' }),
      q({ status: 'expired', siteName: 'Expired' }),
      q({ status: 'draft', siteName: 'Draft' }),
      q({ status: 'issued', siteName: 'Issued', expiresAt: '2026-09-30' }),
    ], TODAY);
    expect(out.map((x) => x.siteName))
      .toEqual(['Issued', 'Draft', 'Expired', 'Declined', 'Accepted']);
  });

  it('puts the issued quote with least time left first', () => {
    // The one that needs a phone call today.
    const out = orderQuotes([
      q({ siteName: 'Next month', expiresAt: '2026-10-01' }),
      q({ siteName: 'Tomorrow', expiresAt: '2026-09-02' }),
      q({ siteName: 'Next week', expiresAt: '2026-09-08' }),
    ], TODAY);
    expect(out.map((x) => x.siteName)).toEqual(['Tomorrow', 'Next week', 'Next month']);
  });

  it('puts one expiring today above one expiring tomorrow', () => {
    // Nought days left is the last day it holds good, not "no answer".
    const out = orderQuotes([
      q({ siteName: 'Tomorrow', expiresAt: '2026-09-02' }),
      q({ siteName: 'Today', expiresAt: '2026-09-01' }),
    ], TODAY);
    expect(out.map((x) => x.siteName)).toEqual(['Today', 'Tomorrow']);
  });

  it('sorts a quote with no expiry after ones that have one', () => {
    // Nothing is running down on it, so it is not the row that needs an answer.
    const out = orderQuotes([
      q({ siteName: 'No expiry' }),
      q({ siteName: 'Expiring', expiresAt: '2026-12-01' }),
    ], TODAY);
    expect(out.map((x) => x.siteName)).toEqual(['Expiring', 'No expiry']);
  });

  it('falls back to the site name so the order does not wander', () => {
    // Two quotes equally urgent must not swap places between openings.
    const out = orderQuotes([
      q({ status: 'draft', siteName: 'Sandgate Hall' }),
      q({ status: 'draft', siteName: 'Carina Bus Depot' }),
    ], TODAY);
    expect(out.map((x) => x.siteName)).toEqual(['Carina Bus Depot', 'Sandgate Hall']);
  });

  it('leaves the list it was given alone', () => {
    const given = [q({ siteName: 'B' }), q({ siteName: 'A' })];
    orderQuotes(given, TODAY);
    expect(given.map((x) => x.siteName)).toEqual(['B', 'A']);
  });

  it('ranks every status, so a new one cannot sort by accident', () => {
    for (const status of Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[]) {
      expect(typeof QUOTE_URGENCY[status]).toBe('number');
    }
  });
});
