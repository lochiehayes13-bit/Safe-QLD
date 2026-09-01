import {
  COMMISSIONER_COPY_BUSINESS_DAYS,
  COMMISSIONER_LODGEMENT,
  CRITICAL_DEFECT_NOTICE_HOURS,
  HOLIDAY_COVERAGE,
  PART_DAY_TREATMENT,
  QLD_PUBLIC_HOLIDAYS,
  SCHEDULE_1_ITEMS,
  SCHEDULE_2_DECLARATION,
  SCHEDULE_2_FIELDS,
  SCHEDULE_2_FOOTNOTES,
  SCHEDULE_2_INSTALLATIONS,
  SOURCES,
  addQldBusinessDays,
  approvedFormClaim,
  canSignAsSchedule2,
  checkOccupierStatement,
  citeSources,
  commissionerCopyDeadline,
  formatAuDate,
  firstStatementDue,
  nextStatementDue,
  passiveMaintenance,
  publicHolidaysOn,
  qldBusinessDaysBetween,
  rectificationDeadline,
  renderDeclaration,
  schedule1TableForClass,
  schedule2Installation,
  statementRetainedUntil,
  toFilledRow,
  type FilledInstallationRow,
  type FilledOccupierStatement,
  type StatementIssue,
} from '@/domain/occupierForm';
import { OCCUPIER_STATEMENT_INSTALLATIONS } from '@/domain/qldCompliance';

/**
 * The occupier's statement as the Schedule 2 form.
 *
 * What is being defended here is a claim, and claims are the dangerous kind of
 * output. The app is about to stop saying "this is not the regulator's approved
 * form" and start saying "this is the Schedule 2 occupier statement". If that
 * sentence ever prints over a document with a blank row on it, an occupier
 * lodges something incomplete believing a computer checked it — so most of what
 * follows is about the claim refusing to appear rather than about it appearing.
 *
 * Three things are checked against the actual schedule rather than against the
 * app's own idea of it: the twenty-one installations word for word and in
 * order, the four Schedule 1 passive rows with their clause numbers, and the
 * declaration sentence. If the QDC is ever amended these fail, which is the
 * point.
 *
 * The date arithmetic is checked against a real Queensland April. Easter,
 * Anzac Day and Labour Day land inside one ten-business-day window in 2025, and
 * a weekends-only count comes out six days early — which is exactly the sort of
 * confidently wrong deadline that gets an occupier fined.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every Schedule 2 row answered: installed, with a standard and a No. */
function completeRows(over: Record<string, Partial<FilledInstallationRow>> = {}): FilledInstallationRow[] {
  return SCHEDULE_2_INSTALLATIONS.map((item) => ({
    installation: item.name,
    installed: true,
    nominatedStandard: 'AS 1851-2012',
    criticalDefectNoticeIssued: false,
    ...(item.detailsRequired ? { details: 'Smoke curtain to the atrium, required by the alternative solution' } : {}),
    ...(over[item.name] ?? {}),
  }));
}

function completeStatement(over: Partial<FilledOccupierStatement> = {}): FilledOccupierStatement {
  return {
    buildingName: 'Baldwin Living Bethania',
    buildingAddress: '18 Nyngan Street, Bethania QLD 4205',
    occupierName: 'Baldwin Living Bethania Pty Ltd',
    periodStart: '2025-04-16',
    periodEnd: '2026-04-15',
    rows: completeRows(),
    declarationFullName: 'Susan Doherty',
    organisationName: 'Baldwin Living Bethania Pty Ltd',
    signature: 'data:image/svg+xml;utf8,<svg/>',
    signedDate: '2026-04-16',
    commissionerCopy: { previousStatementDate: '2025-04-16' },
    ...over,
  };
}

const blocking = (issues: StatementIssue[]): StatementIssue[] => issues.filter((i) => i.blocking);
const about = (issues: StatementIssue[], field: string): StatementIssue[] =>
  issues.filter((i) => i.field === field);

// ---------------------------------------------------------------------------
// Schedule 1
// ---------------------------------------------------------------------------

describe('Schedule 1 — the passive fire safety installation maintenance schedule', () => {
  it('carries the four installations of each table with the clause numbers the schedule cites', () => {
    const table1 = SCHEDULE_1_ITEMS.filter((i) => i.table === 1);
    const table2 = SCHEDULE_1_ITEMS.filter((i) => i.table === 2);
    expect(table1.map((i) => [i.installation, i.as1851Clause])).toEqual([
      ['Hinged and pivoted fire-resistant doorsets', '17.4.3.1'],
      ['Horizontal fire-resistant sliding doorsets', '17.4.3.2'],
      ['Smoke doorsets – hinged and pivoted', '17.4.4'],
      ['Fire shutters', '17.4.5'],
    ]);
    expect(table2.map((i) => i.installation)).toEqual(table1.map((i) => i.installation));
  });

  it('sets six-monthly for class 5, 6, 9a and 9c and yearly for everything else', () => {
    expect(SCHEDULE_1_ITEMS.filter((i) => i.table === 1).every((i) => i.intervalMonths === 6)).toBe(true);
    expect(SCHEDULE_1_ITEMS.filter((i) => i.table === 2).every((i) => i.intervalMonths === 12)).toBe(true);
    expect(schedule1TableForClass('5').table).toBe(1);
    expect(schedule1TableForClass('9a').table).toBe(1);
    expect(schedule1TableForClass('9c').table).toBe(1);
    expect(schedule1TableForClass('Class 6').table).toBe(1);
    // 9b is the one people put in the wrong table: a hall or a shop is not 9a.
    expect(schedule1TableForClass('9b').table).toBe(2);
    expect(schedule1TableForClass('2').table).toBe(2);
  });

  it('refuses a class 1a building rather than defaulting it into the yearly table', () => {
    // MP 6.1's Application section excludes class 1a outright. "Yearly" and
    // "this code does not apply" are the difference between quoting a house for
    // fire door inspections and not.
    const answer = schedule1TableForClass('1a');
    expect(answer.table).toBeUndefined();
    expect(answer.reason).toMatch(/does not apply to a class 1a building/i);
  });

  it("says it does not know a class it has never heard of, rather than guessing a table", () => {
    const answer = schedule1TableForClass('Class 12');
    expect(answer.table).toBeUndefined();
    expect(answer.reason).toMatch(/not a BCA class/i);
    expect(schedule1TableForClass('').reason).toMatch(/No BCA class given/i);
  });

  it('gives the frequency and the clause for a real building and installation', () => {
    const shopping = passiveMaintenance('Fire shutters', '6');
    expect(shopping.item?.requiredFrequency).toBe('6 monthly');
    expect(shopping.item?.as1851Clause).toBe('17.4.5');
    expect(shopping.item?.ref).toBe('Schedule 1, table 1, row 4');

    const hall = passiveMaintenance('Fire shutters', '9b');
    expect(hall.item?.requiredFrequency).toBe('Yearly');
    expect(hall.item?.ref).toBe('Schedule 1, table 2, row 4');
  });

  it('refuses to invent a Schedule 1 row for solid core doors, which the schedule does not tabulate', () => {
    // Solid core doors are a passive installation under MP 6.1 and they have
    // their own row on the Schedule 2 statement, which is exactly why someone
    // expects a frequency here. Schedule 1 has four rows and this is not one of
    // them; the frequency comes from A1(a) or A1(b) instead.
    expect(SCHEDULE_2_INSTALLATIONS.some((i) => i.name === 'Solid core doors')).toBe(true);
    const answer = passiveMaintenance('Solid core doors', '5');
    expect(answer.item).toBeUndefined();
    expect(answer.reason).toMatch(/does not tabulate/i);
    expect(answer.reason).toMatch(/A1\(a\) or A1\(b\)/);
  });
});

// ---------------------------------------------------------------------------
// Schedule 2
// ---------------------------------------------------------------------------

describe('Schedule 2 — the occupier statement form', () => {
  it('lists the twenty-one prescribed installations word for word and in the order the schedule prints them', () => {
    expect(SCHEDULE_2_INSTALLATIONS.map((i) => i.name)).toEqual([
      'Air handling systems',
      'Emergency lifts',
      'Emergency lighting',
      'Emergency power supply',
      'Emergency warning and intercommunication systems',
      'Exit signs',
      'Fire detection and alarm systems',
      'Fire doorsets',
      'Fire extinguishers',
      'Fire hose reels',
      'Fire hydrants (including boosters)',
      'Fire mains',
      'Fire shutters',
      'Other features (provide details)',
      'Smoke and heat venting systems',
      'Smoke doorsets',
      'Smoke exhaust systems',
      'Solid core doors',
      'Special automatic fire suppression systems',
      'Sprinklers',
      'Stairwell pressurisation systems',
    ]);
    expect(SCHEDULE_2_INSTALLATIONS.map((i) => i.row)).toEqual(
      Array.from({ length: 21 }, (_, n) => n + 1),
    );
  });

  it('keeps the footnote markers the schedule prints against particular rows', () => {
    expect(schedule2Installation('Emergency warning and intercommunication systems')?.footnote).toBe(5);
    expect(schedule2Installation('Other features (provide details)')?.footnote).toBe(6);
    expect(schedule2Installation('Other features')?.detailsRequired).toBe(true);
  });

  it("matches the list the app already stores statements against, row for row", () => {
    // The register was built from the same schedule before the schedule was
    // read in full. If the two ever drift, a statement saved yesterday stops
    // lining up with the form printed today, so this is the join that has to
    // hold.
    expect(OCCUPIER_STATEMENT_INSTALLATIONS).toHaveLength(SCHEDULE_2_INSTALLATIONS.length);
    for (const [index, name] of OCCUPIER_STATEMENT_INSTALLATIONS.entries()) {
      const item = schedule2Installation(name);
      expect(item).toBeDefined();
      expect(item?.row).toBe(index + 1);
    }
  });

  it('resolves the names a register and a technician use, and refuses one that is not a row', () => {
    expect(schedule2Installation('EWIS')?.row).toBe(5);
    expect(schedule2Installation('  fire hydrants (INCLUDING boosters) ')?.row).toBe(11);
    expect(schedule2Installation('Other features')?.row).toBe(14);
    // A real thing, and still not a Schedule 2 row. Answering it as one would
    // put a line on the form that the schedule does not print.
    expect(schedule2Installation('Fire pumpset')).toBeUndefined();
  });

  it('carries all seven footnotes, in order', () => {
    expect(SCHEDULE_2_FOOTNOTES.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(SCHEDULE_2_FOOTNOTES[1]?.text).toMatch(/delete prescribed fire safety installations/);
    expect(SCHEDULE_2_FOOTNOTES[3]?.text).toMatch(/proof of rectification/);
    expect(SCHEDULE_2_FOOTNOTES[6]?.text).toMatch(/does not need to be completed/);
  });

  it('sets out the header, column and declaration fields in the schedule\'s order', () => {
    expect(SCHEDULE_2_FIELDS.filter((f) => f.kind === 'header').map((f) => f.label)).toEqual([
      'Name of building and address',
      'Name of occupier',
    ]);
    expect(SCHEDULE_2_FIELDS.filter((f) => f.kind === 'column').map((f) => f.label)).toEqual([
      'Prescribed fire safety installation',
      'Nominated Australian Standard or relevant maintenance requirements',
      'Was a critical defect notice issued during the period covered by this statement (Yes/No)',
      'Date of rectification of critical defect',
    ]);
    expect(SCHEDULE_2_FIELDS.filter((f) => f.kind === 'declaration').map((f) => f.label)).toEqual([
      'Full name', 'Name of organisation', 'Signature', 'Date',
    ]);
  });

  it('declares authority, not merely presence', () => {
    // "as an authorised person on behalf of" is the whole legal weight of the
    // sentence. An occupier who hands the pen to whoever is on reception has
    // not made this declaration.
    expect(SCHEDULE_2_DECLARATION.template).toContain('as an authorised person on behalf of');
    expect(SCHEDULE_2_DECLARATION.template).toContain(
      'declare the above listed prescribed fire safety installations have been maintained during the period '
      + 'covered by this statement in accordance with this code and as specified',
    );

    const rendered = renderDeclaration({
      fullName: 'Susan Doherty',
      organisation: 'Baldwin Living Bethania Pty Ltd',
      signature: 'S. Doherty',
      date: '16/04/2026',
    });
    expect(rendered).toBe(
      'I Susan Doherty as an authorised person on behalf of Baldwin Living Bethania Pty Ltd declare the above '
      + 'listed prescribed fire safety installations have been maintained during the period covered by this '
      + 'statement in accordance with this code and as specified, S. Doherty on 16/04/2026',
    );
  });

  it('prints an unfilled blank as a ruled line rather than closing the gap', () => {
    // A declaration that reads "I as an authorised person on behalf of
    // declare..." is visibly unfinished. One that silently closes up reads as
    // complete and is not.
    const rendered = renderDeclaration({ fullName: 'Susan Doherty' });
    expect(rendered).toContain('I Susan Doherty as an authorised person on behalf of ——');
    expect(rendered).not.toContain('on behalf of declare');
  });
});

// ---------------------------------------------------------------------------
// Business days
// ---------------------------------------------------------------------------

describe('ten business days across a Queensland April', () => {
  /**
   * 2025 puts Good Friday, Easter Saturday, Easter Sunday, Easter Monday, Anzac
   * Day and Labour Day inside one ten-business-day window. It is the worst
   * three weeks of the Queensland calendar and the right thing to count.
   */
  it('counts ten business days from 16 April 2025 to 6 May 2025', () => {
    const count = addQldBusinessDays('2025-04-16', 10);
    expect(count.date).toBe('2025-05-06');
    expect(count.holidaysApplied.map((h) => h.name)).toEqual([
      'Good Friday', 'Easter Monday', 'Anzac Day', 'Labour Day',
    ]);
    // Easter Saturday and Easter Sunday are appointed holidays too, but they
    // fall on a weekend and are skipped as weekend days before the holiday
    // table is ever consulted.
    expect(count.weekendDaysSkipped).toBe(6);
  });

  it('is six days later than the weekends-only answer the app used to give', () => {
    // The old arithmetic excluded weekends and said so. Six days of holidays
    // inside one window is how a "you have until the 30th" turns into a late
    // lodgement.
    const naive = (() => {
      const d = new Date('2025-04-16T00:00:00Z');
      let left = 10;
      while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) left--;
      }
      return d.toISOString().slice(0, 10);
    })();
    expect(naive).toBe('2025-04-30');
    expect(addQldBusinessDays('2025-04-16', 10).date).toBe('2025-05-06');
  });

  it('carries a weekend and a single public holiday correctly', () => {
    // Friday 23 January 2026, then a weekend, then Australia Day on the Monday.
    const count = addQldBusinessDays('2026-01-23', 3);
    expect(count.date).toBe('2026-01-29');
    expect(count.holidaysApplied.map((h) => h.name)).toEqual(['Australia Day']);
    expect(count.weekendDaysSkipped).toBe(2);
  });

  it('does not count the starting day, because the ten days run after it', () => {
    // Monday 6 July 2026 plus one business day is Tuesday, not Monday.
    expect(addQldBusinessDays('2026-07-06', 1).date).toBe('2026-07-07');
    expect(addQldBusinessDays('2026-07-06', 0).date).toBe('2026-07-06');
  });

  it('skips the extra appointed day when Boxing Day falls on a weekend', () => {
    // 2026 is the awkward one. Christmas Eve is a business day (it is a holiday
    // only from 6pm), Christmas Day is the Friday, Boxing Day is the Saturday,
    // and Monday 28 December is the extra day the Holidays Act 1983 appoints
    // when Boxing Day lands on a weekend. Counting Boxing Day itself and
    // forgetting the Monday would land on the 28th, which is a public holiday.
    const count = addQldBusinessDays('2026-12-23', 2);
    expect(count.date).toBe('2026-12-29');
    expect(count.holidaysApplied.map((h) => h.name)).toEqual([
      'Christmas Day', 'Boxing Day (additional day)',
    ]);
    expect(count.holidaysNotApplied.map((h) => h.holiday.name)).toEqual(['Christmas Eve']);
  });
});

describe('holidays this app cannot apply, and what it says about them', () => {
  it('leaves the Royal Queensland Show holiday out when it does not know the locality, and says so', () => {
    const unknown = addQldBusinessDays('2026-08-10', 5);
    expect(unknown.date).toBe('2026-08-17');
    expect(unknown.holidaysNotApplied.map((h) => h.holiday.name)).toContain('Royal Queensland Show');
    expect(unknown.holidaysNotApplied[0]?.why).toMatch(/Brisbane area only/);
    expect(unknown.caveats.join(' ')).toMatch(/locality/i);
  });

  it('applies it once told the building is in the Brisbane area', () => {
    const brisbane = addQldBusinessDays('2026-08-10', 5, { locality: 'brisbane-area' });
    expect(brisbane.date).toBe('2026-08-18');
    expect(brisbane.holidaysApplied.map((h) => h.name)).toEqual(['Royal Queensland Show']);
  });

  it('applies a district show holiday the caller knows about', () => {
    // Show holidays are appointed per local government area. This module has no
    // way to look one up, so a caller who knows it hands it in.
    const count = addQldBusinessDays('2026-08-10', 5, {
      locality: 'elsewhere-in-queensland',
      districtHolidays: [{ date: '2026-08-13', name: 'Toowoomba Royal Agricultural Show' }],
    });
    expect(count.date).toBe('2026-08-18');
    expect(count.holidaysApplied.map((h) => h.name)).toEqual(['Toowoomba Royal Agricultural Show']);
    expect(count.confidence).toBe('high');
  });

  it('counts Christmas Eve as a business day and flags that it is only a holiday from 6pm', () => {
    const count = addQldBusinessDays('2026-12-22', 2);
    expect(count.date).toBe('2026-12-24');
    expect(count.holidaysNotApplied.map((h) => h.holiday.name)).toContain('Christmas Eve');
    expect(count.caveats.join(' ')).toMatch(/part-day/i);
    // The choice is recorded rather than buried, because nobody has litigated
    // whether a part-day holiday makes the whole day a non-business day, and a
    // future reader is entitled to know which way this module went.
    expect(PART_DAY_TREATMENT).toBe('counted-as-a-business-day');
  });

  it('promises that a holiday it failed to apply can only move the real deadline later', () => {
    // The one guarantee that makes the answer safe to work to, and it is a
    // property rather than a flag: hand the count a holiday it did not know
    // about and the date it gives can only move later, never earlier. Assert
    // the property, because a test that only reads the flag would still pass
    // if the arithmetic underneath it started skipping days it should not.
    for (const from of ['2025-04-16', '2026-08-10', '2026-12-22', '2027-12-20']) {
      const known = addQldBusinessDays(from, 10);
      expect(known.noLaterThanStatutory).toBe(true);
      expect(known.date).toBeDefined();
      // Every weekday in the window, one at a time, as a holiday this module
      // could not have known about.
      const cursor = new Date(`${from}T00:00:00Z`);
      for (let i = 0; i < 20; i++) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const iso = cursor.toISOString().slice(0, 10);
        const withExtra = addQldBusinessDays(from, 10, {
          districtHolidays: [{ date: iso, name: 'A district show holiday this module cannot look up' }],
        });
        expect(withExtra.date).toBeDefined();
        expect(withExtra.date! >= known.date!).toBe(true);
      }
    }
    expect(addQldBusinessDays('2026-08-10', 5).caveats.join(' ')).toMatch(/never late/i);
  });

  it('does not describe a district holiday it was handed as a Brisbane one', () => {
    // holidaysApplied is printed as the working behind a statutory deadline. A
    // document that calls the Toowoomba show holiday a Brisbane-area holiday is
    // wrong in a way the reader has no way to catch.
    const count = addQldBusinessDays('2026-08-10', 5, {
      locality: 'elsewhere-in-queensland',
      districtHolidays: [{ date: '2026-08-13', name: 'Toowoomba Royal Agricultural Show' }],
    });
    expect(count.holidaysApplied[0]?.scope).toBe('district');
    expect(count.holidaysApplied.some((h) => h.scope === 'brisbane-area')).toBe(false);
  });
});

describe('refusing to count what it does not know', () => {
  it('will not count from a date before the published holiday table starts', () => {
    const count = addQldBusinessDays('2024-12-01', 10);
    expect(count.date).toBeUndefined();
    // d/m/yyyy in the sentence, ISO in the constant. The occupier reads the
    // sentence and this app prints one date format.
    expect(count.reason).toContain(formatAuDate(HOLIDAY_COVERAGE.from));
    expect(count.reason).toContain('1/1/2025');
    expect(count.reason).toMatch(/outside that/);
  });

  it('will not count into a year whose holidays Queensland has not appointed yet', () => {
    // Projecting "first Monday in May" past the published table is how a
    // confident wrong deadline gets printed on a statutory document.
    const count = addQldBusinessDays('2029-12-20', 10);
    expect(count.date).toBeUndefined();
    expect(count.reason).toContain(formatAuDate(HOLIDAY_COVERAGE.to));
    expect(count.reason).toContain('31/12/2029');
  });

  it('counts from the first day the table covers, and refuses the day before it', () => {
    /*
     * Both ends of the published table are covered days. Excluding its own
     * first day refuses a count the app can make correctly, and telling an
     * occupier the deadline is unknown when it is knowable is the same fault
     * as inventing one, pointing the other way.
     */
    expect(addQldBusinessDays(HOLIDAY_COVERAGE.from, 10).date).toBeDefined();
    expect(addQldBusinessDays('2024-12-31', 10).date).toBeUndefined();
  });

  it('counts from the last day the table covers, so long as the count lands inside it', () => {
    // The final day of coverage is a day the table knows about. Counting
    // forward from it runs off the end, which is the refusal above — so this
    // asks for a count that stays inside.
    expect(addQldBusinessDays(HOLIDAY_COVERAGE.to, 0).date).toBe(HOLIDAY_COVERAGE.to);
    expect(addQldBusinessDays('2030-01-01', 0).date).toBeUndefined();
  });

  it('refuses an unreadable date, an impossible date and a negative count', () => {
    expect(addQldBusinessDays('the 16th', 10).reason).toMatch(/not a date/);
    expect(addQldBusinessDays('2026-02-30', 10).reason).toMatch(/not a date/);
    expect(addQldBusinessDays('2026-04-16', -1).reason).toMatch(/cannot be negative/);
    expect(addQldBusinessDays('2026-04-16', 1.5).reason).toMatch(/whole number/);
  });

  it('counts backwards with the same arithmetic it counts forwards', () => {
    // So a screen can say "three days left" and "three days late" without two
    // implementations disagreeing at zero.
    expect(qldBusinessDaysBetween('2025-04-16', '2025-05-06').days).toBe(10);
    expect(qldBusinessDaysBetween('2025-05-06', '2025-04-16').days).toBe(-10);
    expect(qldBusinessDaysBetween('2025-05-06', '2025-05-06').days).toBe(0);
    expect(qldBusinessDaysBetween('2020-01-01', '2020-01-20').reason).toMatch(/outside that/);
  });

  it('cites the definition a business day count rests on, both ways and when it refuses', () => {
    // A screen that says "three days late" is making a statutory claim, and the
    // definition it rests on is not this app's.
    const forward = qldBusinessDaysBetween('2025-04-16', '2025-05-06');
    expect(forward.legalRef).toMatch(/Acts Interpretation Act 1954/);
    expect(citeSources(forward.sourceIds).map((c) => c.id)).toContain('acts-interpretation');
    expect(qldBusinessDaysBetween('2020-01-01', '2020-01-20').sourceIds).toEqual(forward.sourceIds);
  });

  it('has a holiday table that agrees with itself', () => {
    for (const h of QLD_PUBLIC_HOLIDAYS) {
      expect(h.date >= HOLIDAY_COVERAGE.from && h.date <= HOLIDAY_COVERAGE.to).toBe(true);
      expect(publicHolidaysOn(h.date)).toContainEqual(h);
      expect(SOURCES[h.sourceId]).toBeDefined();
    }
    expect(publicHolidaysOn('2026-07-06')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The commissioner's copy
// ---------------------------------------------------------------------------

describe("the ten business days to give the commissioner a copy", () => {
  it('counts from the day the statement was required, not from the day it was signed', () => {
    // Section 55A(3) is explicit and the distinction is the whole point: the
    // clock is hung off the anniversary, so signing early does not shorten it
    // and signing late does not restart it.
    const early = commissionerCopyDeadline({
      previousStatementDate: '2024-04-16',
      signedDate: '2025-04-02',
    });
    const late = commissionerCopyDeadline({
      previousStatementDate: '2024-04-16',
      signedDate: '2025-06-01',
    });
    expect(early.due).toBe('2025-05-06');
    expect(late.due).toBe('2025-05-06');
    expect(early.anchor).toBe('previous-statement');
    expect(early.anchorDate).toBe('2025-04-16');
    expect(early.basis).toBe('statutory');
    expect(late.caveats[0]).toMatch(/Signing late does not restart/);
  });

  it('says neither early nor late for a statement signed on the day it was required', () => {
    /*
     * The occupier who signs on their anniversary. Both caveats hang off the
     * same comparison against that date, and either being a day out puts a
     * warning about signing late — or about signing early, which is the one
     * caveat here saying the deadline may be later than a regulator would
     * allow — on a statement that was signed exactly on time.
     */
    const onTime = commissionerCopyDeadline({
      previousStatementDate: '2025-04-16',
      signedDate: '2026-04-16',
    });
    expect(onTime.anchorDate).toBe('2026-04-16');
    expect(onTime.caveats.some((c) => /Signing late does not restart/.test(c))).toBe(false);
    expect(onTime.caveats.some((c) => /signing early does not shorten/i.test(c))).toBe(false);
  });

  it('warns that an early signature is the one deadline here later than the cautious answer', () => {
    // Everywhere else in this module an unknown pushes the date earlier, which
    // is what makes a date safe to work to. This is the exception: an occupier
    // who signs in January is not required to lodge until ten business days
    // after the April anniversary, so the deadline printed is months later than
    // counting from the signature. That reading is right on the words of
    // s 55A(3), and it is still the one answer here that can be late if a
    // regulator reads it the other way — so it is said out loud.
    const early = commissionerCopyDeadline({
      previousStatementDate: '2025-04-16',
      signedDate: '2026-01-05',
    });
    expect(early.due).toBe('2026-04-30');
    expect(early.anchorDate).toBe('2026-04-16');
    expect(early.caveats[0]).toMatch(/signing early does not shorten/i);
    // And it names the cautious date rather than leaving the reader to work it
    // out: ten business days from the signature is 19 January 2026.
    expect(addQldBusinessDays('2026-01-05', 10).date).toBe('2026-01-19');
    expect(early.caveats[0]).toContain('19/1/2026');
    expect(early.caveats[0]).toContain('5/1/2026');
  });

  it('takes a required-preparation date over anything else when the caller knows it', () => {
    const deadline = commissionerCopyDeadline({
      requiredPreparationDate: '2026-01-23',
      previousStatementDate: '2024-04-16',
    });
    expect(deadline.anchor).toBe('required-preparation');
    // Friday 23 January, then Australia Day on the Monday, then two more
    // weekends: ten business days lands on Monday 9 February.
    expect(deadline.due).toBe('2026-02-09');
  });

  it('uses a year from taking up occupation for a first statement', () => {
    const deadline = commissionerCopyDeadline({ occupationDate: '2024-04-16' });
    expect(deadline.anchor).toBe('occupation');
    expect(deadline.anchorDate).toBe('2025-04-16');
    expect(deadline.due).toBe('2025-05-06');
  });

  it('names the signature as a fallback rather than passing it off as the statutory answer', () => {
    const deadline = commissionerCopyDeadline({ signedDate: '2025-04-16' });
    expect(deadline.due).toBe('2025-05-06');
    expect(deadline.basis).toBe('signature-fallback');
    expect(deadline.anchor).toBe('signature');
    expect(deadline.confidence).toBe('low');
    expect(deadline.caveats[0]).toMatch(/runs from the required date/);
    expect(deadline.caveats[0]).toMatch(/possibly already past/);
  });

  it('gives no date at all when it has nothing to count from', () => {
    const deadline = commissionerCopyDeadline({});
    expect(deadline.due).toBeUndefined();
    expect(deadline.reason).toMatch(/nothing to count from/);
    expect(deadline.reason).toMatch(/required to prepare/);
  });

  it('keeps the ten in one place and shows where the copy goes', () => {
    expect(COMMISSIONER_COPY_BUSINESS_DAYS).toBe(10);
    // Administrative rather than statutory, so it is carried with its
    // confidence rather than printed as though the regulation said it.
    expect(COMMISSIONER_LODGEMENT.email).toBe('occupier.statements@fire.qld.gov.au');
    expect(COMMISSIONER_LODGEMENT.confidence).toBe('medium');
    expect(citeSources([COMMISSIONER_LODGEMENT.sourceId])[0]?.url).toMatch(/^https:\/\/www\.business\.qld\.gov\.au\//);
  });
});

describe('the other statutory clocks', () => {
  it('puts the next statement a year on, and the retention two years on', () => {
    expect(nextStatementDue('2026-04-16').date).toBe('2027-04-16');
    expect(firstStatementDue('2026-04-16').date).toBe('2027-04-16');
    expect(statementRetainedUntil('2026-04-16').date).toBe('2028-04-16');
  });

  it('clamps a 29 February anniversary back into February rather than rolling into March', () => {
    // A statement made on 29 February 2028 is due again on 28 February 2029.
    // Rolling forward would put it a day outside the "yearly" A2(b)(ii) asks
    // for.
    expect(nextStatementDue('2028-02-29').date).toBe('2029-02-28');
  });

  it('refuses an unreadable date instead of returning today', () => {
    expect(nextStatementDue('soon').date).toBeUndefined();
    expect(nextStatementDue('soon').reason).toMatch(/not a date/);
    expect(statementRetainedUntil('').reason).toMatch(/not a date/);
  });

  it('counts the month for rectification from the maintenance, and says when it had to use the notice', () => {
    // Section 54(4) runs from the maintenance. Where only the notice date is
    // held the answer is still usable, because s 53(2) gives the maintainer at
    // most 24 hours to issue it — so the real deadline is at most a day
    // earlier. That is flagged, not hidden.
    expect(rectificationDeadline({ maintenanceDate: '2026-03-15' })).toMatchObject({
      due: '2026-04-15', approximate: false,
    });
    expect(rectificationDeadline({ noticeDate: '2026-03-16' })).toMatchObject({
      due: '2026-04-16', approximate: true,
    });
    // Section 53(2) is why the notice date is a usable substitute at all: the
    // notice cannot be more than a day behind the maintenance.
    expect(CRITICAL_DEFECT_NOTICE_HOURS).toBe(24);
    expect(rectificationDeadline({}).due).toBeUndefined();
    expect(rectificationDeadline({}).reason).toMatch(/nothing to count from/);
  });
});

// ---------------------------------------------------------------------------
// Checking a filled statement
// ---------------------------------------------------------------------------

describe('checking a filled statement against the Regulation', () => {
  it('passes a complete statement with nothing blocking', () => {
    const issues = checkOccupierStatement(completeStatement(), '2026-04-20');
    expect(blocking(issues)).toEqual([]);
    expect(canSignAsSchedule2(completeStatement(), '2026-04-20')).toBe(true);
  });

  it('blocks on a missing occupier and cites the section that puts the duty on them', () => {
    const issues = checkOccupierStatement(completeStatement({ occupierName: '' }));
    const issue = about(issues, 'occupierName')[0];
    expect(issue?.blocking).toBe(true);
    expect(issue?.legalRef).toContain('s 55A(1)');
    expect(issue?.formRef).toBe('Schedule 2, header');
  });

  it('treats a header field of spaces as blank, because on the page it is', () => {
    /*
     * The one a blank-string check misses. A technician taps into a field,
     * hits the space bar and moves on, and the statement then has nothing
     * blocking it while printing an empty line where the building's name goes.
     *
     * Both header fields are held, because a statement that names a building
     * without saying where it is cannot be matched to a premises on file — and
     * a statement naming neither cannot be matched to anything.
     */
    expect(blocking(checkOccupierStatement(completeStatement({ occupierName: '   ' }))))
      .not.toEqual([]);
    expect(about(checkOccupierStatement(completeStatement({ buildingName: ' ' })), 'buildingNameAndAddress')[0]?.blocking)
      .toBe(true);
    expect(about(checkOccupierStatement(completeStatement({ buildingAddress: '\t ' })), 'buildingNameAndAddress')[0]?.blocking)
      .toBe(true);
    expect(canSignAsSchedule2(completeStatement({ occupierName: '   ' }), '2026-04-20')).toBe(false);
  });

  it('treats a row nobody answered as unanswered, not as a No', () => {
    // Footnote 2 says to delete an installation the building does not have,
    // which is an answer. A blank row is not, and the difference matters: a
    // struck-out row says somebody looked.
    const rows = completeRows();
    const target = rows.find((r) => r.installation === 'Emergency lifts');
    if (target) target.installed = undefined;
    const issues = checkOccupierStatement(completeStatement({ rows }));
    const issue = about(issues, 'Emergency lifts')[0];
    expect(issue?.blocking).toBe(true);
    expect(issue?.legalRef).toContain('footnote 2');
    expect(issue?.message).toMatch(/Leaving the row blank is not/);
  });

  it('blocks when an installed row nominates no standard', () => {
    const issues = checkOccupierStatement(completeStatement({
      rows: completeRows({ 'Fire doorsets': { nominatedStandard: '' } }),
    }));
    const issue = about(issues, 'Fire doorsets').find((i) => i.formRef.endsWith('column 2'));
    expect(issue?.blocking).toBe(true);
    expect(issue?.legalRef).toContain('footnote 3');
  });

  it('blocks a critical defect notice with no rectification date, and demands the attachments', () => {
    // This is what column 4 exists to surface. A signed statement saying a
    // critical defect notice was issued and leaving the rectification blank is
    // a declaration that an installation may still be inoperable.
    const issues = checkOccupierStatement(completeStatement({
      rows: completeRows({ 'Fire detection and alarm systems': { criticalDefectNoticeIssued: true } }),
    }));
    const column4 = about(issues, 'Fire detection and alarm systems')
      .find((i) => i.formRef.endsWith('column 4'));
    expect(column4?.blocking).toBe(true);
    expect(column4?.legalRef).toContain('s 54(4)');

    const attach = about(issues, 'criticalDefectNoticesAttached')[0];
    expect(attach?.blocking).toBe(true);
    expect(attach?.legalRef).toContain('footnote 4');
    expect(attach?.legalRef).toContain('s 53(2)');
  });

  it('accepts a rectified critical defect once the notice and the proof travel with it', () => {
    const issues = checkOccupierStatement(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({
        'Fire detection and alarm systems': {
          criticalDefectNoticeIssued: true,
          maintenanceDate: '2026-02-10',
          rectificationDate: '2026-02-24',
        },
      }),
    }), '2026-04-20');
    expect(blocking(issues)).toEqual([]);
  });

  it('counts a rectification on the last day of the month as inside it', () => {
    /*
     * Section 54(4) gives a month. The last day of it is a compliant day, and
     * a comparison a day out puts a s 54(4) note on a statement that complied
     * — an occupier reading "after the one month allowed" against work done on
     * time.
     *
     * Maintenance 10 February, so the month runs to 10 March.
     */
    const onTheDay = checkOccupierStatement(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({
        Sprinklers: {
          criticalDefectNoticeIssued: true,
          maintenanceDate: '2026-02-10',
          rectificationDate: '2026-03-10',
        },
      }),
    }), '2026-04-20');
    expect(about(onTheDay, 'Sprinklers').find((i) => i.legalRef.includes('s 54(4)'))).toBeUndefined();

    const dayAfter = checkOccupierStatement(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({
        Sprinklers: {
          criticalDefectNoticeIssued: true,
          maintenanceDate: '2026-02-10',
          rectificationDate: '2026-03-11',
        },
      }),
    }), '2026-04-20');
    expect(about(dayAfter, 'Sprinklers').find((i) => i.legalRef.includes('s 54(4)'))?.blocking)
      .toBe(false);
  });

  it('notices a rectification that took longer than the month section 54(4) allows, without blocking it', () => {
    // Section 54(4) has a reasonable excuse limb — remoteness, complexity,
    // parts. The statement is still true, so this is worth knowing rather than
    // a blocker.
    const issues = checkOccupierStatement(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({
        Sprinklers: {
          criticalDefectNoticeIssued: true,
          maintenanceDate: '2026-02-10',
          rectificationDate: '2026-03-30',
        },
      }),
    }), '2026-04-20');
    const issue = about(issues, 'Sprinklers').find((i) => i.legalRef.includes('s 54(4)'));
    expect(issue?.blocking).toBe(false);
    expect(issue?.message).toMatch(/reasonable excuse/);
    expect(blocking(issues)).toEqual([]);
  });

  it('blocks an "Other features" row ticked with nothing written in it', () => {
    const issues = checkOccupierStatement(completeStatement({
      rows: completeRows({ 'Other features (provide details)': { details: '' } }),
    }));
    const issue = about(issues, 'Other features (provide details)')
      .find((i) => i.legalRef.includes('footnote 6'));
    expect(issue?.blocking).toBe(true);
  });

  it('excuses the organisation box only where footnote 7 actually applies', () => {
    const missing = checkOccupierStatement(completeStatement({ organisationName: '' }));
    expect(about(missing, 'organisationName')[0]?.blocking).toBe(true);
    expect(about(missing, 'organisationName')[0]?.legalRef).toContain('footnote 7');

    const owner = checkOccupierStatement(
      completeStatement({ organisationName: '', footnote7Applies: true }),
      '2026-04-20',
    );
    expect(about(owner, 'organisationName')).toEqual([]);
    expect(blocking(owner)).toEqual([]);
  });

  it('notices the occupier handing the pen to their fire contractor', () => {
    // Section 55A(1) puts the duty on the occupier. A contractor signing it
    // does not discharge that duty, and the occupier usually does not know
    // that. Not a blocker — the signer may genuinely be authorised — but it is
    // the question worth asking.
    const issues = checkOccupierStatement(completeStatement({
      organisationName: 'Safe QLD Fire Protection',
      maintenanceContractorName: 'Safe QLD Fire Protection',
    }), '2026-04-20');
    const issue = about(issues, 'organisationName')[0];
    expect(issue?.blocking).toBe(false);
    expect(issue?.legalRef).toContain('s 55A(1)');
    expect(issue?.message).toMatch(/does not discharge that duty/);
  });

  it('reports the ten business days on the statement itself, with the date', () => {
    const issues = checkOccupierStatement(completeStatement(), '2026-04-20');
    const issue = about(issues, 'sentToCommissionerDate')[0];
    expect(issue?.legalRef).toContain('s 55A(3)');
    // 30/4/2026, never 4/30/2026 and never the ISO the arithmetic runs on.
    expect(issue?.message).toContain('30/4/2026');
    expect(issue?.message).not.toContain('2026-04-30');
  });

  it('says plainly when the copy went late', () => {
    const issues = checkOccupierStatement(completeStatement({
      sentToCommissionerDate: '2026-05-11',
    }), '2026-05-12');
    const issue = about(issues, 'sentToCommissionerDate')[0];
    expect(issue?.message).toMatch(/after the 30\/4\/2026 deadline/);
    expect(issue?.message).toContain('11/5/2026');
    expect(issue?.message).toMatch(/20 penalty units/);
  });

  it('flags a statement signed before the period it covers has finished', () => {
    const issues = checkOccupierStatement(completeStatement({ signedDate: '2026-03-01' }), '2026-03-02');
    const issue = about(issues, 'signedDate').find((i) => i.message.includes('before the period'));
    expect(issue?.blocking).toBe(false);
    expect(issue?.message).toMatch(/has not happened yet/);
  });

  it('says nothing about a statement signed the day its period ends', () => {
    /*
     * The declaration speaks of maintenance during the period covered, so
     * signing before the period ends declares work that has not happened. The
     * last day of the period is not before it — an occupier who signs on the
     * final day is declaring a period that has run, and telling them part of
     * it has not happened yet is wrong and would be argued with.
     */
    const onTheDay = checkOccupierStatement(completeStatement({ signedDate: '2026-04-15' }), '2026-04-20');
    expect(about(onTheDay, 'signedDate').find((i) => i.message.includes('before the period')))
      .toBeUndefined();

    const dayBefore = checkOccupierStatement(completeStatement({ signedDate: '2026-04-14' }), '2026-04-20');
    expect(about(dayBefore, 'signedDate').find((i) => i.message.includes('before the period')))
      .toBeDefined();
  });

  it('does not block on a missing period, because Schedule 2 has no box for one', () => {
    // Three of the four columns and the declaration all speak of "the period
    // covered by this statement" and the schedule never provides a field for
    // it. Capturing it is an improvement on the paper form, so its absence
    // cannot stop the document being the form.
    const issues = checkOccupierStatement(
      completeStatement({ periodStart: '', periodEnd: '' }),
      '2026-04-20',
    );
    const issue = about(issues, 'period')[0];
    expect(issue?.blocking).toBe(false);
    expect(issue?.formRef).toBe('Not a Schedule 2 field');
    expect(blocking(issues)).toEqual([]);
  });

  it('blocks when rows are missing from the statement altogether, and names them', () => {
    const issues = checkOccupierStatement(completeStatement({
      rows: completeRows().filter((r) => r.installation !== 'Fire mains' && r.installation !== 'Exit signs'),
    }));
    const issue = about(issues, 'installations')[0];
    expect(issue?.blocking).toBe(true);
    expect(issue?.message).toContain('Exit signs');
    expect(issue?.message).toContain('Fire mains');
  });

  it('sends an installation the schedule does not list to the Other features row', () => {
    const issues = checkOccupierStatement(completeStatement({
      rows: [...completeRows(), {
        installation: 'Fire pumpset', installed: true, nominatedStandard: 'AS 1851-2012',
        criticalDefectNoticeIssued: false,
      }],
    }), '2026-04-20');
    const issue = about(issues, 'Fire pumpset')[0];
    expect(issue?.blocking).toBe(false);
    expect(issue?.message).toMatch(/Other features/);
    expect(issue?.legalRef).toContain('footnote 6');
  });

  it('blocks a row answered twice, because the schedule prints it once', () => {
    const rows = completeRows();
    const duplicate = rows[6];
    const issues = checkOccupierStatement(completeStatement({
      rows: duplicate ? [...rows, { ...duplicate, nominatedStandard: 'AS 1851-2005' }] : rows,
    }));
    expect(blocking(issues).some((i) => i.message.includes('answered more than once'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The approved-form claim
// ---------------------------------------------------------------------------

describe('whether the document can honestly call itself the statutory statement', () => {
  it('says yes only when every Schedule 2 field is present and every installation addressed', () => {
    const claim = approvedFormClaim(completeStatement());
    expect(claim.isSchedule2Form).toBe(true);
    expect(claim.missingFields).toEqual([]);
    expect(claim.unaddressedInstallations).toEqual([]);
    expect(claim.statement).toContain('Schedule 2 of the Queensland Development Code Mandatory Part 6.1');
    expect(claim.statement).toContain('section 55A');
  });

  it('explains why "approved form" is the wrong phrase and what the right one is', () => {
    // Section 53(2) uses "the approved form", but only for the critical defect
    // notice. Section 55A asks for a statement complying with MP 6.1, and MP
    // 6.1 sets it out in Schedule 2. Reproduce Schedule 2 and you have it.
    const claim = approvedFormClaim(completeStatement());
    expect(claim.note).toContain('Section 53(2)');
    expect(claim.note).toMatch(/only for a critical defect notice/);
    expect(claim.note).toMatch(/no separate approved form/);
  });

  it('names the missing field instead of claiming approval', () => {
    // "This is not the approved form" told an occupier nothing they could act
    // on. "Name of occupier is blank" tells them everything.
    const claim = approvedFormClaim(completeStatement({ occupierName: '  ' }));
    expect(claim.isSchedule2Form).toBe(false);
    expect(claim.missingFields.map((f) => f.label)).toEqual(['Name of occupier']);
    expect(claim.missingFields[0]?.formRef).toBe('Schedule 2, header');
    expect(claim.statement).toContain('not yet the Schedule 2 occupier statement');
    expect(claim.statement).toContain('Name of occupier');
  });

  it('distinguishes a named building with no address from an address with no name', () => {
    expect(approvedFormClaim(completeStatement({ buildingAddress: '' })).missingFields[0]?.why)
      .toMatch(/named but has no address/);
    expect(approvedFormClaim(completeStatement({ buildingName: '' })).missingFields[0]?.why)
      .toMatch(/address is recorded but the building is not named/);
  });

  it('will not sign off an unsigned or undated declaration', () => {
    const claim = approvedFormClaim(completeStatement({ signature: '', signedDate: '' }));
    expect(claim.isSchedule2Form).toBe(false);
    expect(claim.missingFields.map((f) => f.label)).toEqual(['Signature', 'Date']);
  });

  it('counts a row with no standard against it as unaddressed, not as addressed', () => {
    // The row is on the page and two of its three answers are not. A form
    // printed like that is a form with holes in it.
    const claim = approvedFormClaim(completeStatement({
      rows: completeRows({ Sprinklers: { nominatedStandard: '' } }),
    }));
    expect(claim.isSchedule2Form).toBe(false);
    expect(claim.unaddressedInstallations.map((u) => u.name)).toEqual(['Sprinklers']);
    expect(claim.unaddressedInstallations[0]?.formRef).toBe('Schedule 2, row 20');
  });

  it('will not call the form complete over a critical defect notice with no rectification date', () => {
    // The worst hole the claim could paper over. Column 3 says a critical
    // defect notice was issued, column 4 does not say the defect was ever
    // fixed, and the claim sentence says in terms that every field the schedule
    // sets out has been completed. Printing that over this document declares a
    // statement complete while an installation may still be inoperable.
    const claim = approvedFormClaim(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({ Sprinklers: { criticalDefectNoticeIssued: true } }),
    }));
    expect(claim.isSchedule2Form).toBe(false);
    expect(claim.unaddressedInstallations.map((u) => u.name)).toEqual(['Sprinklers']);
    expect(claim.unaddressedInstallations[0]?.why).toMatch(/column 4 gives no date of rectification/i);
    expect(claim.statement).toMatch(/no date of rectification/i);

    // Fill column 4 and the same statement is the form.
    expect(approvedFormClaim(completeStatement({
      criticalDefectNoticesAttached: true,
      rows: completeRows({
        Sprinklers: { criticalDefectNoticeIssued: true, rectificationDate: '2026-02-24' },
      }),
    })).isSchedule2Form).toBe(true);
  });

  it('will not call the form complete over an "Other features" row with no details written in', () => {
    // Column 1 of that row is not a name, it is a name and a blank: the
    // schedule prints "Other features (provide details)". A tick with nothing
    // after it tells a reader nothing, and checkOccupierStatement already
    // blocks it — the claim has to agree, or the two halves of this module
    // disagree about the same document.
    const statement = completeStatement({
      rows: completeRows({ 'Other features (provide details)': { details: '' } }),
    });
    const claim = approvedFormClaim(statement);
    expect(claim.isSchedule2Form).toBe(false);
    expect(claim.unaddressedInstallations.map((u) => u.name)).toEqual(['Other features (provide details)']);
    expect(claim.unaddressedInstallations[0]?.why).toMatch(/details/i);
    expect(canSignAsSchedule2(statement, '2026-04-20')).toBe(false);
  });

  it('never claims the form over a document checkOccupierStatement is still blocking on a row', () => {
    // The two functions answer different questions and are meant to. But a row
    // the schedule prints and nobody filled in is a hole on the page, so on
    // rows they cannot come apart: whenever a row blocks, the claim must fail.
    const holes: Partial<FilledInstallationRow>[] = [
      { installed: undefined },
      { nominatedStandard: '' },
      { criticalDefectNoticeIssued: undefined },
      { criticalDefectNoticeIssued: true },
    ];
    for (const hole of holes) {
      const statement = completeStatement({
        criticalDefectNoticesAttached: true,
        rows: completeRows({ 'Fire hose reels': hole }),
      });
      expect(blocking(checkOccupierStatement(statement, '2026-04-20')).length).toBeGreaterThan(0);
      expect(approvedFormClaim(statement).isSchedule2Form).toBe(false);
    }
  });

  it('says which box is empty, not merely that a row is unfinished', () => {
    // "Sprinklers have not been addressed" sends an occupier back to a row that
    // looks filled in. "Column 2 nominates no standard" sends them to the box.
    const claim = approvedFormClaim(completeStatement({
      rows: completeRows({ Sprinklers: { nominatedStandard: '' } }),
    }));
    expect(claim.unaddressedInstallations[0]?.why).toMatch(/Column 2/);
    expect(claim.statement).toContain('Sprinklers — Column 2');
  });

  it('counts a row struck out under footnote 2 as addressed', () => {
    // A building with no lift still has "Emergency lifts" on its form, deleted.
    // That is a positive answer and it completes the row.
    const claim = approvedFormClaim(completeStatement({
      rows: completeRows({
        'Emergency lifts': { installed: false, nominatedStandard: '', criticalDefectNoticeIssued: undefined },
      }),
    }));
    expect(claim.isSchedule2Form).toBe(true);
  });

  it('does not let a late lodgement stop the document being the form', () => {
    // Being the Schedule 2 statement and having been lodged on time are two
    // different questions. Conflating them would mean a perfectly good form
    // failing to be a form because somebody was slow to the post.
    const late = completeStatement({ sentToCommissionerDate: '2026-06-30' });
    expect(approvedFormClaim(late).isSchedule2Form).toBe(true);
    expect(checkOccupierStatement(late, '2026-07-01').some((i) => i.message.includes('after the'))).toBe(true);
  });

  it('reports what it carries beyond the schedule separately, so an addition never reads as a fault', () => {
    const claim = approvedFormClaim(completeStatement({
      rows: completeRows({ Sprinklers: { maintenanceDate: '2026-02-10' } }),
      sentToCommissionerDate: '2026-04-20',
    }));
    expect(claim.isSchedule2Form).toBe(true);
    expect(claim.additionsBeyondSchedule.join(' ')).toMatch(/period covered/);
    expect(claim.additionsBeyondSchedule.join(' ')).toMatch(/s 54\(4\)|section 54\(4\)/);
  });

  it('cites the code and the regulation on every claim it makes', () => {
    const claim = approvedFormClaim(completeStatement());
    expect(claim.legalRef).toContain('s 55A(1)');
    expect(claim.legalRef).toContain('Schedule 2');
    const cited = citeSources(claim.sourceIds);
    expect(cited.map((s) => s.id).sort()).toEqual(['bfsr-2008', 'qdc-mp61']);
    for (const source of cited) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.confidence).toBe('high');
      expect(source.basis.length).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

describe('reading the rows the app already stores', () => {
  it('maps a stored row onto a Schedule 2 row', () => {
    expect(toFilledRow({
      installation: 'Fire hose reels',
      present: true,
      nominatedStandard: 'AS 1851-2012',
      criticalDefectNoticeGiven: true,
      rectifiedDate: '2026-02-24',
    })).toEqual({
      installation: 'Fire hose reels',
      installed: true,
      nominatedStandard: 'AS 1851-2012',
      criticalDefectNoticeIssued: true,
      rectificationDate: '2026-02-24',
    });
  });

  it('leaves column 3 unanswered on a row the building does not have', () => {
    // The schedule deletes the row rather than answering its columns, so
    // writing "No" into column 3 of a struck-out row would be inventing an
    // answer the occupier never gave.
    expect(toFilledRow({
      installation: 'Emergency lifts', present: false, criticalDefectNoticeGiven: false,
    }).criticalDefectNoticeIssued).toBeUndefined();
  });

  it('turns the whole stored register into a statement the claim can be run against', () => {
    const stored = OCCUPIER_STATEMENT_INSTALLATIONS.map((installation) => ({
      installation,
      present: true,
      nominatedStandard: 'AS 1851-2012',
      criticalDefectNoticeGiven: false,
    }));
    const claim = approvedFormClaim(completeStatement({
      rows: stored.map(toFilledRow).map((r) => (
        r.installation === 'Other features' ? { ...r, details: 'Smoke curtain to the atrium' } : r
      )),
    }));
    expect(claim.isSchedule2Form).toBe(true);
  });
});
