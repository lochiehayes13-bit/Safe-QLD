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
    // The one guarantee that makes the answer safe to work to. Every holiday
    // this module cannot know about adds a day; none of them takes one away.
    for (const from of ['2025-04-16', '2026-08-10', '2026-12-22', '2027-12-20']) {
      expect(addQldBusinessDays(from, 10).noLaterThanStatutory).toBe(true);
    }
    expect(addQldBusinessDays('2026-08-10', 5).caveats.join(' ')).toMatch(/never late/i);
  });
});

describe('refusing to count what it does not know', () => {
  it('will not count from a date before the published holiday table starts', () => {
    const count = addQldBusinessDays('2024-12-01', 10);
    expect(count.date).toBeUndefined();
    expect(count.reason).toContain(HOLIDAY_COVERAGE.from);
    expect(count.reason).toMatch(/outside that/);
  });

  it('will not count into a year whose holidays Queensland has not appointed yet', () => {
    // Projecting "first Monday in May" past the published table is how a
    // confident wrong deadline gets printed on a statutory document.
    const count = addQldBusinessDays('2029-12-20', 10);
    expect(count.date).toBeUndefined();
    expect(count.reason).toContain(HOLIDAY_COVERAGE.to);
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
    expect(issue?.message).toContain('2026-04-30');
  });

  it('says plainly when the copy went late', () => {
    const issues = checkOccupierStatement(completeStatement({
      sentToCommissionerDate: '2026-05-11',
    }), '2026-05-12');
    const issue = about(issues, 'sentToCommissionerDate')[0];
    expect(issue?.message).toMatch(/after the 2026-04-30 deadline/);
    expect(issue?.message).toMatch(/20 penalty units/);
  });

  it('flags a statement signed before the period it covers has finished', () => {
    const issues = checkOccupierStatement(completeStatement({ signedDate: '2026-03-01' }), '2026-03-02');
    const issue = about(issues, 'signedDate').find((i) => i.message.includes('before the period'));
    expect(issue?.blocking).toBe(false);
    expect(issue?.message).toMatch(/has not happened yet/);
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
