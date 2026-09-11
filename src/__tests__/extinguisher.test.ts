import {
  ALL_TYPES,
  CONDITION_RULES,
  PROFILES,
  QLD_LICENSING_NOTE,
  SOURCES,
  adverseEnvironmentCaution,
  assessCondition,
  checkCharge,
  checkUse,
  chargeTolerance,
  citeSources,
  classifyTypeText,
  formatAuDate,
  intervalsFor,
  isRefused,
  nextDue,
  pressureTestInterval,
  prohibitedClasses,
  prohibitionLine,
  ratedClasses,
  rollupSite,
  suitabilityFor,
  toSpan,
  typesForClass,
  weighingIsPrimaryCheck,
  type ExtinguisherType,
  type FireClass,
  type RegisterEntry,
} from '@/domain/extinguisher';

/**
 * Extinguishers — 43% of the book, and until now no logic at all.
 *
 * What is asserted here is mostly about two things: the prohibitions, which are
 * the only part of this app where being wrong injures somebody, and the
 * refusals, which are the only defence against a register full of half-written
 * dates producing confident wrong answers.
 *
 * The prohibition tests are written as the real scenarios they come from — a
 * CO2 unit hanging in a commercial kitchen, a plain red water extinguisher next
 * to a switchboard, a "DCP" cell that could be either powder. Each of those has
 * happened on a site and each of them is a finding on a service sheet.
 */

const TODAY = '2026-09-01';

describe('the type profiles', () => {
  it('has a position on every fire class for every type, so a service sheet is never silent about one', () => {
    // Silence reads as "not applicable" to whoever prints it. Every type has to
    // answer all six classes, even where the answer is "not rated".
    const classes: FireClass[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const type of ALL_TYPES) {
      for (const fireClass of classes) {
        expect(suitabilityFor(type, fireClass)).toBeDefined();
      }
    }
  });

  it('gives every prohibition a consequence, because a prohibition alone gets argued with', () => {
    for (const type of ALL_TYPES) {
      for (const entry of PROFILES[type].classes) {
        if (entry.suitability === 'prohibited' || entry.suitability === 'conditional') {
          expect(entry.consequence).toBeTruthy();
          expect(entry.consequence!.length).toBeGreaterThan(30);
        }
      }
    }
  });

  it('ties every profile back to a source that exists', () => {
    for (const type of ALL_TYPES) {
      expect(PROFILES[type].sourceIds.length).toBeGreaterThan(0);
      for (const id of PROFILES[type].sourceIds) expect(SOURCES[id]).toBeDefined();
      for (const entry of PROFILES[type].classes) {
        expect(entry.sourceIds.length).toBeGreaterThan(0);
        for (const id of entry.sourceIds) expect(SOURCES[id]).toBeDefined();
      }
    }
  });
});

describe('prohibitions — the part that injures somebody when it is wrong', () => {
  it('forbids carbon dioxide on a Class F fire and says what happens', () => {
    // A CO2 unit hung in a commercial kitchen. The discharge velocity blows
    // burning oil out of the vat and the gas does nothing to cool it.
    const v = checkUse('carbon-dioxide', 'F');
    expect(isRefused(v)).toBe(false);
    if (isRefused(v)) return;
    expect(v.suitability).toBe('prohibited');
    expect(v.statement).toContain('MUST NOT');
    expect(v.consequence).toContain('burning oil');
  });

  it('forbids water on electrically energised equipment', () => {
    // The jet is a conductor and the operator is holding the other end of it.
    const v = checkUse('water', 'E');
    expect(isRefused(v)).toBe(false);
    if (isRefused(v)) return;
    expect(v.suitability).toBe('prohibited');
    expect(v.consequence).toContain('conductor');
  });

  it('forbids foam on electrical too, being mostly water however it is rated on Class B', () => {
    // The plant room case: a flammable liquid risk and an energised motor in
    // the same room, and a foam unit that covers only one of them.
    expect((checkUse('foam', 'E') as { suitability: string }).suitability).toBe('prohibited');
  });

  it('forbids wet chemical on electrical, which is the live risk in the room it lives in', () => {
    // Wet chemical belongs in a kitchen, and in a kitchen the fryer and its
    // power are within arm's reach of each other.
    const v = checkUse('wet-chemical', 'E');
    expect((v as { suitability: string }).suitability).toBe('prohibited');
  });

  it('forbids ABE powder on cooking oil, which is the commonest wrong-extinguisher finding there is', () => {
    const v = checkUse('dry-chemical-abe', 'F');
    expect((v as { suitability: string }).suitability).toBe('prohibited');
    expect((v as { consequence: string }).consequence).toContain('relights');
  });

  it('forbids BE powder on cooking oil as well, and says the conservative reading is deliberate', () => {
    // Some overseas material credits bicarbonate powder with saponifying oil.
    // No Australian source reached does, so the answer is the safe one and the
    // disagreement travels with it rather than being hidden.
    const v = checkUse('dry-chemical-be', 'F');
    expect((v as { suitability: string }).suitability).toBe('prohibited');
    expect((v as { dispute?: string }).dispute).toContain('Australian source');
  });

  it("does not call a merely useless extinguisher dangerous — CO2 on paper is unrated, not prohibited", () => {
    // The distinction the whole module turns on. CO2 on a Class A fire will not
    // hold it; nobody gets hurt. Printing the same word against that and
    // against CO2-in-a-fryer tells the reader nothing about which one bites.
    const v = checkUse('carbon-dioxide', 'A');
    expect((v as { suitability: string }).suitability).toBe('unrated');
    expect((v as { statement: string }).statement).toContain('will not put the fire out');
  });

  it('treats BE powder on Class A as unrated rather than prohibited, and explains the invisible difference', () => {
    // ABE and BE wear the same white band. The difference is a whole fire class
    // and it cannot be seen on the cylinder.
    const v = checkUse('dry-chemical-be', 'A');
    expect((v as { suitability: string }).suitability).toBe('unrated');
    expect((v as { consequence: string }).consequence).toContain('white band');
  });

  it('never gives a bare yes or no on a burning gas escape', () => {
    // Class C is a decision about the gas supply, not about the extinguisher.
    // Putting the flame out with gas still flowing fills the room.
    for (const type of ALL_TYPES) {
      const v = suitabilityFor(type, 'C');
      expect(v!.suitability).toBe('conditional');
      expect(v!.consequence).toContain('isolate');
    }
  });

  it('says on the Class C row that the condition is about the gas valve and not a rating', () => {
    // Every type answers Class C "only in the circumstances stated", which on a
    // service sheet reads as permission unless the row says otherwise. A water
    // extinguisher is not being offered for a gas fire here.
    for (const type of ALL_TYPES) {
      expect(suitabilityFor(type, 'C')!.consequence).toContain('not a rating');
    }
  });

  it('rules out every agent it carries on burning metal rather than offering the least bad one', () => {
    for (const type of ALL_TYPES) {
      expect(suitabilityFor(type, 'D')!.suitability).toBe('prohibited');
    }
  });

  it('names wet chemical as the only thing on the van rated for a fryer', () => {
    expect(typesForClass('F')).toEqual(['wet-chemical']);
  });

  it('never offers a withdrawn agent as the answer to a fire class', () => {
    // Halon would otherwise show up as a suggestion for a switchroom.
    for (const fireClass of ['A', 'B', 'E', 'F'] as FireClass[]) {
      expect(typesForClass(fireClass)).not.toContain('halon');
    }
  });

  it('prints the prohibition line a service sheet carries, built from the same data as the table', () => {
    // Written by hand this line drifts out of step with the ratings above it.
    expect(prohibitionLine('water')).toBe('MUST NOT be used on Class B, Class D, Class E, Class F.');
    expect(ratedClasses('dry-chemical-abe')).toEqual(['A', 'B', 'E']);
    expect(prohibitedClasses('carbon-dioxide')).toEqual(['D', 'F']);
  });
});

describe('classifyTypeText — reading the register cell', () => {
  it('reads the ordinary descriptors a technician types', () => {
    expect(classifyTypeText('9.0kg ABE')).toMatchObject({ type: 'dry-chemical-abe' });
    expect(classifyTypeText('3.5kg CO2')).toMatchObject({ type: 'carbon-dioxide' });
    expect(classifyTypeText('Wet Chemical 7L')).toMatchObject({ type: 'wet-chemical' });
    expect(classifyTypeText('9L AFFF Foam')).toMatchObject({ type: 'foam' });
    expect(classifyTypeText('Water 9L')).toMatchObject({ type: 'water' });
    expect(classifyTypeText('2kg Vaporising Liquid')).toMatchObject({ type: 'vaporising-liquid' });
  });

  it("refuses a cell that says powder without saying which powder", () => {
    // The refusal that matters most in this function. Guessing ABE because it
    // is commoner puts a Class A rating on an asset that may not have one, and
    // the two share a white band so nothing on the cylinder corrects it.
    const r = classifyTypeText('4.5kg DCP');
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('ABE or BE');
    expect(r.whatToDo).toContain('not as ABE');
  });

  it('does not mistake the BE inside ABE for a BE unit', () => {
    // A word-boundary bug here would silently reclassify every ABE on the book
    // as a type with no Class A rating.
    expect(classifyTypeText('ABE 4.5kg')).toMatchObject({ type: 'dry-chemical-abe' });
    expect(classifyTypeText('BE 4.5kg')).toMatchObject({ type: 'dry-chemical-be' });
  });

  it('refuses a row that names two agents rather than picking one', () => {
    // A trolley, a typo, or two assets on one row. None of those is safely
    // resolved from the cell.
    const r = classifyTypeText('CO2 / ABE trolley');
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('more than one agent');
  });

  it('refuses an empty cell and an unrecognisable one, separately', () => {
    expect(isRefused(classifyTypeText(''))).toBe(true);
    expect(isRefused(classifyTypeText(undefined))).toBe(true);
    const r = classifyTypeText('9kg unit');
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.whatToDo).toContain('Do not assume from the size');
  });

  it('does not read the English word "be" in a note cell as BE powder', () => {
    // "9.0kg to be replaced" is a note, not an agent. Matched case-insensitively
    // it classifies as BE — a type with no Class A rating — and the app then
    // prints a prohibition list for an asset nobody has identified. BE is an
    // agent designation and is written in capitals; the lower-case word is not.
    const r = classifyTypeText('9.0kg to be replaced');
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.code).toBe('type-cell-unrecognised');

    // And the real designation still reads, in either position.
    expect(classifyTypeText('BE 4.5kg')).toMatchObject({ type: 'dry-chemical-be' });
    expect(classifyTypeText('4.5KG BE POWDER')).toMatchObject({ type: 'dry-chemical-be' });
  });

  it('gives every refusal a code, so a count of them never depends on the wording', () => {
    // The site rollup counts ambiguous-powder rows and unschedulable assets to
    // put them in its caveats. It used to do that by matching the sentence,
    // which means rewording a message silently drops a caveat off a proposal
    // and nothing fails.
    const refusals = [
      classifyTypeText(''),
      classifyTypeText('4.5kg DCP'),
      classifyTypeText('CO2 / ABE trolley'),
      classifyTypeText('9kg unit'),
    ];
    expect(refusals.map((r) => (isRefused(r) ? r.code : undefined))).toEqual([
      'type-cell-empty',
      'type-cell-ambiguous-powder',
      'type-cell-two-agents',
      'type-cell-unrecognised',
    ]);
  });

  it('recognises halon on an old register so it can be dealt with rather than serviced', () => {
    expect(classifyTypeText('BCF 1kg')).toMatchObject({ type: 'halon' });
    expect(classifyTypeText('Halon 1211')).toMatchObject({ type: 'halon' });
  });
});

describe('maintenance intervals', () => {
  it('carries the six-monthly, the yearly and the five-yearly, in months', () => {
    const water = intervalsFor('water');
    expect(water.map((i) => [i.activity, i.intervalMonths])).toEqual([
      ['six-monthly', 6],
      ['yearly', 12],
      ['five-yearly', 60],
    ]);
  });

  it('says plainly that it does not know which extra items fall at the yearly', () => {
    // A vague interval is not turned into a checklist. The purchased copy of
    // Section 10 governs the method; this app carries the frequency.
    const yearly = intervalsFor('dry-chemical-abe').find((i) => i.activity === 'yearly')!;
    expect(yearly.what.join(' ')).toContain('not established in this app');
    expect(yearly.confidence).toBe('medium');
  });

  it('answers the carbon dioxide pressure test with the shorter interval and reports the disagreement', () => {
    // One set of trade guidance puts CO2 on a ten-year hydrostatic cycle at a
    // gas cylinder station; the AS 1851 material puts every portable on five.
    // Being early costs a service call; being late leaves an untested
    // high-pressure cylinder in a corridor.
    const co2 = pressureTestInterval('carbon-dioxide');
    expect(co2.intervalMonths).toBe(60);
    expect(co2.confidence).toBe('low');
    expect(co2.dispute).toContain('ten-yearly');
    expect(co2.dispute).toContain('shorter');
    expect(co2.sourceIds).toContain('co2-ten-year-claim');
  });

  it('anchors the pressure test to the cylinder rather than to the last service', () => {
    for (const type of ALL_TYPES) {
      expect(pressureTestInterval(type).anchor).toBe('date-of-manufacture');
    }
  });

  it('carries the dispute onto the five-yearly a CO2 asset is scheduled against', () => {
    const fiveYearly = intervalsFor('carbon-dioxide').find((i) => i.activity === 'five-yearly')!;
    expect(fiveYearly.dispute).toContain('ten-yearly');
    expect(intervalsFor('water').find((i) => i.activity === 'five-yearly')!.dispute).toBeUndefined();
  });

  it("refuses to shorten an interval for an adverse environment it cannot quantify", () => {
    // Coastal salt from the Gold Coast to the Sunshine Coast is most of the
    // book. The clause exists; how much the frequency increases is not
    // established here, so nothing is shortened and the warning is returned
    // instead.
    const c = adverseEnvironmentCaution();
    expect(c.statement).toContain('have NOT been shortened');
    expect(c.statement).toContain('1.13');
    expect(c.confidence).toBe('low');
  });
});

describe('nextDue — the anchor rule', () => {
  it('counts the five-yearly from the date of manufacture, not from a late service', () => {
    // The whole point of the anchor. Manufactured June 2015, five-yearly done
    // eight months late in February 2021. Scheduling from the completion would
    // put the next one in February 2026 and let the drift compound; scheduling
    // from the cylinder puts it back on June 2025 where it belongs.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'dry-chemical-abe',
      manufactured: '1/6/2015',
      lastDone: '1/2/2021',
      today: TODAY,
    });
    expect(isRefused(r)).toBe(false);
    if (isRefused(r)) return;
    expect(r.anchoredTo).toBe('date-of-manufacture');
    expect(r.occurrence).toBe(2);
    expect(r.due.earliest).toBe('2025-06-01');
    expect(r.state).toBe('overdue');
    expect(r.daysUntil.latest).toBeLessThan(0);
  });

  it('does not let an off-schedule service swallow the occurrence it came nowhere near', () => {
    // Manufactured June 2015, a five-yearly recorded June 2018 — three years
    // into a five year cycle. Rounded to the nearest occurrence that service
    // counts as the 2020 test, the app answers "next due 2025", and by today it
    // has quietly written off both the 2020 and the 2025 tests on a pressure
    // vessel. The occurrence it did not reach is still outstanding and it says
    // which service failed to satisfy it.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'dry-chemical-abe',
      manufactured: '1/6/2015',
      lastDone: '1/6/2018',
      today: TODAY,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.occurrence).toBe(1);
    expect(r.due.earliest).toBe('2020-06-01');
    expect(r.state).toBe('overdue');
    expect(r.missedOccurrences).toBe(2);
    expect(r.notes.join(' ')).toContain('still outstanding');
  });

  it('still counts a service done a few weeks early as the occurrence it was for', () => {
    // The other half of that rule, and the reason it is a quarter of the
    // interval rather than nothing: a site whose six-monthly round runs a month
    // ahead of the cylinder anniversary is not a month overdue every single
    // time, which is what a strict reading would report across the whole book.
    const r = nextDue({
      activity: 'six-monthly',
      type: 'dry-chemical-abe',
      manufactured: '1/6/2015',
      lastDone: '1/5/2026',
      today: TODAY,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.due.earliest).toBe('2026-12-01');
    expect(r.state).toBe('upcoming');
    expect(r.notes.join(' ')).toContain('counted as it');
  });

  it('reports the oldest outstanding occurrence, not the most recent one', () => {
    // An asset with no five-yearly ever recorded since 2010 is not "due in
    // 2030". Three tests have fallen due — 2015, 2020 and 2025 — and the date
    // shown has to be the one the arrears start at.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'water',
      manufactured: '1/3/2010',
      today: TODAY,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.due.earliest).toBe('2015-03-01');
    expect(r.missedOccurrences).toBe(3);
    expect(r.notes.join(' ')).toContain('oldest one still outstanding');
  });

  it('falls back to the last service when there is no date stamp, and says loudly that it has', () => {
    // Not a silent default. It is a materially weaker basis — whatever lateness
    // is already in the record is carried forward — and the reader is told.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'foam',
      lastDone: '1/2/2021',
      today: TODAY,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.anchoredTo).toBe('last-service');
    expect(r.due.earliest).toBe('2026-02-01');
    expect(r.anchorNote).toContain('because no date of manufacture was readable');
    expect(r.notes.join(' ')).toContain('drift the anchor rule exists to prevent');
  });

  it('states that no tolerance window has been applied, on every answer it gives', () => {
    // The Section 6 tolerance tables in this app are for detection systems.
    // What Section 10 allows on an extinguisher is not known here, so none is
    // assumed and the reader is not left to discover that.
    const r = nextDue({ activity: 'six-monthly', type: 'water', lastDone: '1/6/2026', today: TODAY });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.notes.join(' ')).toContain('No tolerance window has been applied');
    expect(r.state).toBe('upcoming');
    expect(r.due.earliest).toBe('2026-12-01');
  });
});

describe('nextDue — today handed over as an instant', () => {
  it('reads the Queensland day, so half past eight in the morning is not yesterday', () => {
    // 22:30 UTC on 2 July is the morning of 3 July in Brisbane. The days-until
    // figures and the due state have to come out the same either way.
    const asDay = nextDue({ activity: 'six-monthly', type: 'water', lastDone: '1/6/2026', today: '2026-07-03' });
    const asInstant = nextDue({
      activity: 'six-monthly', type: 'water', lastDone: '1/6/2026', today: '2026-07-02T22:30:00.000Z',
    });
    expect(isRefused(asDay)).toBe(false);
    expect(asInstant).toEqual(asDay);
  });
});

describe('nextDue — dates recorded to a month, and no further', () => {
  it('turns a "Jun-25" pressure test into a due month rather than a due day', () => {
    // The real register value. Read as 1 June it moves the next test by up to a
    // month; read as the month it is, the answer is a window and it is true.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'dry-chemical-abe',
      lastDone: 'Jun-25',
      today: TODAY,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.due.precision).toBe('month');
    expect(r.due.earliest).toBe('2030-06-01');
    expect(r.due.latest).toBe('2030-06-30');
    expect(r.due.label).toBe('June 2030');
    expect(r.notes.join(' ')).toContain('No day has been invented');
  });

  it('decides overdue against the end of the window, so a month-precision record is never called late early', () => {
    // Manufactured somewhere in June 2020, so the five-yearly fell somewhere in
    // June 2025. On 15 June 2025 the asset is due, not overdue — the day it was
    // actually made is unknown and might still be ahead.
    const due = nextDue({
      activity: 'five-yearly',
      type: 'water',
      manufactured: 'Jun-20',
      today: '2025-06-15',
    });
    if (isRefused(due)) throw new Error(due.reason);
    expect(due.state).toBe('due');

    const overdue = nextDue({
      activity: 'five-yearly',
      type: 'water',
      manufactured: 'Jun-20',
      today: '2025-07-01',
    });
    if (isRefused(overdue)) throw new Error(overdue.reason);
    expect(overdue.state).toBe('overdue');
  });

  it('reads a bare year as a whole year, and gives back a whole year', () => {
    // "2015" in an overhaul column is a year and nothing more. Twelve months of
    // uncertainty in, twelve months of uncertainty out.
    const r = nextDue({ activity: 'five-yearly', type: 'foam', manufactured: '2015', today: TODAY });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.due.precision).toBe('year');
    expect(r.due.earliest).toBe('2020-01-01');
    expect(r.due.latest).toBe('2020-12-31');
    expect(r.due.label).toBe('January 2020 to December 2020');
  });

  it('clamps a month-end anchor instead of rolling it into the next month', () => {
    // 31 August plus six months is the end of February, not the third of March.
    const r = nextDue({ activity: 'six-monthly', type: 'water', lastDone: '31/8/2026', today: TODAY });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.due.earliest).toBe('2027-02-28');
  });

  it('keeps a day-precision record to the day', () => {
    const span = toSpan('15/6/2020');
    expect(span).toMatchObject({ earliest: '2020-06-15', latest: '2020-06-15', precision: 'day', label: '15/6/2020' });
  });

  it('refuses to make a span out of a cell it cannot read', () => {
    expect(toSpan('unknown')).toBeUndefined();
    expect(toSpan('')).toBeUndefined();
    expect(toSpan(undefined)).toBeUndefined();
  });
});

describe('nextDue — the refusals', () => {
  it('refuses when there is neither a date stamp nor a service record', () => {
    // There is nothing to count from. Returning a date anyway would put a
    // schedule on an asset that has none.
    const r = nextDue({ activity: 'five-yearly', type: 'water', today: TODAY });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('nothing to count from');
    expect(r.whatToDo).toContain('Read the date stamped on the cylinder');
  });

  it('refuses a date of manufacture in the future rather than scheduling from it', () => {
    // A two-digit year read into the wrong century. Scheduled from, it makes
    // the asset permanently not-yet-due.
    const r = nextDue({ activity: 'five-yearly', type: 'water', manufactured: '1/6/2035', today: TODAY });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('in the future');
  });

  it('refuses a service recorded before the extinguisher was made', () => {
    // One of the two dates is wrong, and an asset scheduled off a bad anchor
    // reads as compliant for years.
    const r = nextDue({
      activity: 'five-yearly',
      type: 'water',
      manufactured: '1/6/2015',
      lastDone: '1/6/2010',
      today: TODAY,
    });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('before the date of manufacture');
    expect(r.whatToDo).toContain('Do not schedule from either');
  });

  it('refuses an unreadable date the same way it refuses a missing one', () => {
    const r = nextDue({ activity: 'six-monthly', type: 'water', lastDone: 'n/a', today: TODAY });
    expect(isRefused(r)).toBe(true);
  });

  it('refuses a service dated in the future rather than counting an occurrence nobody carried out', () => {
    // The same typed-year error as a date of manufacture in the future, and
    // worse to schedule from: with no cylinder stamp the whole schedule counts
    // forward from this date, so the asset reports "upcoming" until somebody
    // finds the typo — on a five-yearly, years.
    const r = nextDue({ activity: 'five-yearly', type: 'water', lastDone: '1/6/2035', today: TODAY });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.code).toBe('service-in-future');
    expect(r.reason).toContain('has not happened yet');
  });

  it('refuses a service dated in the future even where the cylinder date is sound', () => {
    const r = nextDue({
      activity: 'five-yearly',
      type: 'water',
      manufactured: '1/6/2015',
      lastDone: 'Jun-40',
      today: TODAY,
    });
    expect(isRefused(r)).toBe(true);
  });
});

describe('assessCondition', () => {
  it('condemns a halon extinguisher on sight, and puts the legal obligation first', () => {
    // The one finding here that is a law rather than an engineering judgement.
    // It applies to a unit in perfect condition.
    const a = assessCondition({ type: 'halon', findings: [], inspected: true });
    expect(a.verdict).toBe('condemn');
    expect(a.condemning[0]!.id).toBe('halon-agent');
    expect(a.statement).toContain('National Halon Bank');
  });

  it('condemns halon even where nobody inspected the asset', () => {
    // The agent is enough. Waiting for an inspection to condemn it leaves an
    // unlawful cylinder on a wall.
    expect(assessCondition({ type: 'halon', findings: [], inspected: false }).verdict).toBe('condemn');
  });

  it('condemns a failed pressure test with no route back into service', () => {
    const a = assessCondition({ type: 'water', findings: ['failed-pressure-test'], inspected: true });
    expect(a.verdict).toBe('condemn');
    expect(a.statement).toContain('render unusable');
  });

  it("will not call an asset serviceable when a judgement it cannot make is outstanding", () => {
    // How deep is that pitting is not a question a checkbox answers. Rounding
    // it to "serviceable" is how a corroded pressure vessel goes back up.
    const a = assessCondition({ type: 'water', findings: ['shell-corrosion-pitting'], inspected: true });
    expect(a.verdict).toBe('undetermined');
    expect(a.needsJudgement.map((r) => r.id)).toEqual(['shell-corrosion-pitting']);
    expect(a.statement).toContain('neither condemned nor serviceable');
  });

  it('will not read an uninspected asset as a clean one', () => {
    // No findings because nobody looked is not the same as no findings because
    // there is nothing wrong.
    const a = assessCondition({ type: 'dry-chemical-abe', findings: [], inspected: false });
    expect(a.verdict).toBe('undetermined');
    expect(a.statement).toContain('is not a pass');
  });

  it('passes an inspected asset with nothing found, and fences what that covers', () => {
    const a = assessCondition({ type: 'dry-chemical-abe', findings: [], inspected: true });
    expect(a.verdict).toBe('serviceable');
    expect(a.statement).toContain('not a statement about the inside of the body');
  });

  it('separates a consumable defect from a condemnation', () => {
    // A perished hose is a defect and a part. The body is sound and the asset
    // stays on the register.
    const a = assessCondition({ type: 'foam', findings: ['hose-perished', 'seal-broken-or-discharged'], inspected: true });
    expect(a.verdict).toBe('serviceable');
    expect(a.repairable).toHaveLength(2);
    expect(a.statement).toContain('the body itself is sound');
  });

  it('reports a finding it has no rule for instead of ignoring it', () => {
    // Silently dropping an unknown finding turns a technician's note into a
    // pass. The asset comes back undetermined and the rule gets added.
    const a = assessCondition({ type: 'water', findings: ['sat-in-a-flood'], inspected: true });
    expect(a.verdict).toBe('undetermined');
    expect(a.unrecognised).toEqual(['sat-in-a-flood']);
    expect(a.statement).toContain('no rule for');
  });

  it('lets a condemnation outrank an outstanding judgement rather than deferring', () => {
    const a = assessCondition({
      type: 'carbon-dioxide',
      findings: ['shell-corrosion-pitting', 'repaired-by-welding'],
      inspected: true,
    });
    expect(a.verdict).toBe('condemn');
    expect(a.needsJudgement).toHaveLength(1);
  });

  it('counts the same finding ticked twice as one finding', () => {
    // A duplicated tick on a form prints the reason twice on the report and
    // counts two defects where a technician found one.
    const a = assessCondition({ type: 'foam', findings: ['hose-perished', 'hose-perished'], inspected: true });
    expect(a.repairable).toHaveLength(1);
    expect(a.verdict).toBe('serviceable');
  });

  it('gives every rule an action, because a finding with no next step is a note nobody acts on', () => {
    for (const rule of Object.values(CONDITION_RULES)) {
      expect(rule.action.length).toBeGreaterThan(20);
      expect(rule.reason.length).toBeGreaterThan(20);
      for (const id of rule.sourceIds) expect(SOURCES[id]).toBeDefined();
    }
  });
});

describe('checkCharge', () => {
  it('passes a CO2 extinguisher holding its charge', () => {
    // 3.5 kg CO2: 8 200 g empty, 11 600 g on the scales, so 3 400 g of gas
    // against 3 500 g nominal — under three per cent short.
    const r = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200,
      grossGrams: 11600,
      nominalChargeGrams: 3500,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.actualChargeGrams).toBe(3400);
    expect(r.state).toBe('within-tolerance');
    expect(r.differencePercent).toBe(-2.9);
  });

  it('fails a CO2 extinguisher that has leaked past the tolerance, and names where the tolerance came from', () => {
    // The figure is North American, from a manual written to NFPA 10. It is
    // used because a CO2 unit has no gauge and nothing Australian this app can
    // reach states one — and the reader is told exactly that.
    const r = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200,
      grossGrams: 11100,
      nominalChargeGrams: 3500,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.state).toBe('undercharged');
    expect(r.confidence).toBe('low');
    expect(r.toleranceCaveat).toContain('Not an Australian figure');
    expect(r.sourceIds).toContain('nfpa10-co2-charge');
  });

  it('refuses to judge a powder extinguisher against a tolerance it does not have', () => {
    // The refusal the task turns on. Borrowing the CO2 figure would be a made
    // up pass or fail on 43% of the book.
    const r = checkCharge({
      type: 'dry-chemical-abe',
      tareGrams: 3200,
      grossGrams: 7600,
      nominalChargeGrams: 4500,
    });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('will not borrow one from another type');
    expect(r.whatToDo).toContain('label or plate');
  });

  it("uses the manufacturer's own tolerance where the plate states one, and treats it as the figure that governs", () => {
    const r = checkCharge({
      type: 'dry-chemical-abe',
      tareGrams: 3200,
      grossGrams: 7300,
      nominalChargeGrams: 4500,
      manufacturerTolerancePercent: 5,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.state).toBe('undercharged');
    expect(r.differenceGrams).toBe(-400);
    expect(r.confidence).toBe('high');
  });

  it("never credits a standard with a figure read off the extinguisher's own plate", () => {
    // The screen prints the source list under the verdict. A plate reading has
    // no document behind it, and an empty list filled in with AS 1851 puts the
    // standard's name against a number the standard never stated — in a
    // document a client reads.
    const r = checkCharge({
      type: 'dry-chemical-abe',
      tareGrams: 3200,
      grossGrams: 7300,
      nominalChargeGrams: 4500,
      manufacturerTolerancePercent: 5,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.toleranceOrigin).toBe('manufacturer-plate');
    expect(r.sourceIds).toEqual([]);
    expect(r.toleranceCaveat).toContain('no document is cited');

    // The app's own held figure keeps its citation, and it is the North
    // American one.
    const held = checkCharge({ type: 'carbon-dioxide', tareGrams: 8200, grossGrams: 11600, nominalChargeGrams: 3500 });
    if (isRefused(held)) throw new Error(held.reason);
    expect(held.toleranceOrigin).toBe('app-held');
    expect(held.sourceIds).toEqual(['nfpa10-co2-charge']);
  });

  it('refuses a mass that is not a whole number of grams instead of doing float arithmetic on it', () => {
    // 3.5 in a grams field is three and a half grams, not a 3.5 kg unit, and a
    // fractional tare turns every figure on the report into 3400.199999999999.
    // The check is documented as whole grams; a fraction is a unit error
    // upstream and is sent back rather than rounded into looking right.
    const r = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200.5,
      grossGrams: 11600,
      nominalChargeGrams: 3500,
    });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.code).toBe('mass-not-whole-grams');
    expect(r.whatToDo).toContain('kilograms in a grams field');

    // And a fractional charge worked out from a fractional label figure is
    // caught as the same error, not reported as "nothing to compare against".
    const fromLabel = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200,
      grossGrams: 11600,
      labelledFullGrossGrams: 11700.5,
    });
    expect(isRefused(fromLabel) && fromLabel.code).toBe('mass-not-whole-grams');
  });

  it('works out the charge from a labelled full gross mass when no nominal charge is marked', () => {
    const r = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200,
      grossGrams: 11600,
      labelledFullGrossGrams: 11700,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(r.expectedChargeGrams).toBe(3500);
    expect(r.state).toBe('within-tolerance');
  });

  it('refuses a gross mass at or below the tare instead of reporting a negative charge', () => {
    // Almost always a tare read off the wrong stamping, or a scale still in
    // kilograms. Reported as an empty extinguisher it becomes a defect nobody
    // can reproduce.
    const r = checkCharge({ type: 'carbon-dioxide', tareGrams: 8200, grossGrams: 8200, nominalChargeGrams: 3500 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('no agent at all');
    expect(r.whatToDo).toContain('scale still in kilograms');
  });

  it('refuses when there is nothing to compare the weight against', () => {
    const r = checkCharge({ type: 'carbon-dioxide', tareGrams: 8200, grossGrams: 11600 });
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.reason).toContain('nothing to compare');
  });

  it('refuses a missing or nonsensical mass rather than reading it as zero', () => {
    expect(isRefused(checkCharge({ type: 'carbon-dioxide', tareGrams: NaN, grossGrams: 11600, nominalChargeGrams: 3500 }))).toBe(true);
    expect(isRefused(checkCharge({ type: 'carbon-dioxide', tareGrams: -1, grossGrams: 11600, nominalChargeGrams: 3500 }))).toBe(true);
  });

  it('refuses a tolerance figure that is not a percentage of the charge', () => {
    const r = chargeTolerance('dry-chemical-abe', 250);
    expect(isRefused(r)).toBe(true);
    if (!isRefused(r)) return;
    expect(r.whatToDo).toContain('not of the gross mass');
  });

  it('works in whole grams so a scale reading never becomes a float sum', () => {
    const r = checkCharge({
      type: 'carbon-dioxide',
      tareGrams: 8200,
      grossGrams: 11700,
      nominalChargeGrams: 3500,
    });
    if (isRefused(r)) throw new Error(r.reason);
    expect(Number.isInteger(r.actualChargeGrams)).toBe(true);
    expect(Number.isInteger(r.differenceGrams)).toBe(true);
    expect(r.differenceGrams).toBe(0);
  });

  it('knows which types the scale is the only check on, and says so is unknown where it is', () => {
    // CO2 has no gauge. Everything else does, and the weight is a second
    // opinion on it. Halon is neither: whether that cylinder carries a gauge
    // depends on the model, and answering "the gauge is the primary check" for
    // it is the wrong instruction confidently given.
    expect(weighingIsPrimaryCheck('carbon-dioxide')).toBe(true);
    expect(weighingIsPrimaryCheck('dry-chemical-abe')).toBe(false);
    expect(weighingIsPrimaryCheck('halon')).toBeNull();
  });
});

describe('rollupSite — what this site is going to need', () => {
  const entry = (id: string, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
    assetId: id,
    typeText: '9.0kg ABE',
    manufactured: '1/6/2015',
    lastSixMonthly: '1/6/2026',
    lastYearly: '1/6/2026',
    lastFiveYearly: '1/6/2020',
    ...over,
  });

  it('splits the book by type and counts what is overdue against what is coming', () => {
    const r = rollupSite(
      [
        entry('E1'),
        entry('E2'),
        entry('E3', { typeText: '3.5kg CO2' }),
      ],
      TODAY,
      12,
    );
    expect(r.total).toBe(3);
    expect(r.byType.map((b) => [b.type, b.count])).toEqual([
      ['dry-chemical-abe', 2],
      ['carbon-dioxide', 1],
    ]);
    // The five-yearly fell in June 2025 and has not been done.
    const abe = r.byType.find((b) => b.type === 'dry-chemical-abe')!;
    expect(abe.activities.find((a) => a.activity === 'five-yearly')!.overdue).toBe(2);
    expect(r.overdue).toBe(3);
  });

  it('reads today as the Queensland day when it is handed an instant', () => {
    const asDay = rollupSite([entry('E1'), entry('E2', { typeText: '3.5kg CO2' })], '2026-07-03');
    const asInstant = rollupSite([entry('E1'), entry('E2', { typeText: '3.5kg CO2' })], '2026-07-02T22:30:00.000Z');
    expect(asInstant).toEqual(asDay);
  });

  it('keeps assets it could not classify in their own bucket rather than spreading them over the others', () => {
    // Forty unclassified extinguishers is a finding about the register. Buried
    // in the ABE count it disappears.
    const r = rollupSite([entry('E1'), entry('E2', { typeText: '4.5kg DCP' })], TODAY);
    expect(r.unclassified).toBe(1);
    expect(r.byType.find((b) => b.type === 'unclassified')!.count).toBe(1);
    expect(r.caveats.join(' ')).toContain('powder without saying ABE or');
  });

  it('counts an asset it cannot schedule as unknown, never as compliant', () => {
    // A silent asset is the one that bites. It has no dates at all, so it has
    // no schedule, and that is reported rather than smoothed over.
    const r = rollupSite(
      [entry('E1', { manufactured: undefined, lastSixMonthly: undefined, lastYearly: undefined, lastFiveYearly: undefined })],
      TODAY,
    );
    expect(r.unknown).toBe(1);
    expect(r.overdue).toBe(0);
    const abe = r.byType[0]!;
    expect(abe.activities.every((a) => a.unknown === 1)).toBe(true);
    expect(abe.activities[0]!.unknownReasons[0]!.count).toBe(1);
    expect(r.caveats.join(' ')).toContain('not as compliant');
  });

  it('lifts a halon unit out of the schedule entirely, because no amount of servicing fixes it', () => {
    const r = rollupSite([entry('E1'), entry('E9', { typeText: 'BCF 1kg' })], TODAY);
    expect(r.condemnable).toEqual([
      { assetId: 'E9', reason: expect.stringContaining('National Halon Bank') },
    ]);
    expect(r.caveats.join(' ')).toContain('must come off the wall');

    // "Out of the schedule" has to mean out of the counts as well. The halon
    // unit is on the same 2015 cylinder date as the ABE beside it, so left in
    // it contributes an overdue five-yearly — and the office prices a strip and
    // pressure test on a cylinder that is going to the Halon Bank instead.
    const halon = r.byType.find((b) => b.type === 'halon')!;
    expect(halon.count).toBe(1);
    expect(halon.activities.every((a) => a.overdue + a.dueWithinHorizon + a.later + a.unknown === 0)).toBe(true);
    expect(halon.overdue).toBe(0);
    expect(r.overdue).toBe(1);
  });

  it('counts work in assets and activities and refuses to put a price on it', () => {
    // Rates are commercial terms. The field app owes the office an accurate
    // count broken down finely enough to price; the price is applied elsewhere.
    // Run over a site that exercises every caveat this function can add —
    // unclassified rows, an unschedulable asset and a condemnable one — because
    // a rollup with nothing wrong with it is the one case where the wording
    // cannot leak a commercial term.
    const r = rollupSite(
      [
        entry('E1'),
        entry('E2', { typeText: '4.5kg DCP' }),
        entry('E3', { typeText: 'BCF 1kg' }),
        entry('E4', { manufactured: undefined, lastSixMonthly: undefined, lastYearly: undefined, lastFiveYearly: undefined }),
      ],
      TODAY,
    );
    expect(r.caveats.join(' ')).toContain('not of money');
    expect(JSON.stringify(r)).not.toMatch(/\$|\bcents\b|\bexGst\b|\bprice\b|\brate\b/i);
  });

  it('always says the register being right is an assumption', () => {
    const r = rollupSite([entry('E1')], TODAY);
    expect(r.caveats.join(' ')).toContain('register being right is an assumption');
    expect(r.caveats.join(' ')).toContain('No tolerance window');
  });

  it('reports an empty register as empty rather than as a site with nothing due', () => {
    const r = rollupSite([], TODAY);
    expect(r.total).toBe(0);
    expect(r.byType).toEqual([]);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it('separates what falls inside the horizon from what falls after it', () => {
    // The question is "what does this site cost me this year", so a five-yearly
    // due in 2029 must not land in the twelve-month count.
    const r = rollupSite([entry('E1', { manufactured: '1/6/2024', lastFiveYearly: undefined })], TODAY, 12);
    const abe = r.byType[0]!;
    const five = abe.activities.find((a) => a.activity === 'five-yearly')!;
    expect(five.later).toBe(1);
    expect(five.overdue).toBe(0);
    expect(r.horizonEnds).toBe('2027-09-01');
  });
});

describe('sources', () => {
  it('gives every source a URL, a confidence and a reason for that confidence', () => {
    for (const [id, s] of Object.entries(SOURCES)) {
      expect(s.id).toBe(id);
      expect(s.url).toMatch(/^https:\/\//);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.basis.length).toBeGreaterThan(30);
      expect(s.ref.length).toBeGreaterThan(0);
      expect(s.what.length).toBeGreaterThan(0);
    }
  });

  it("marks a regulator's own publication high and second-hand trade guidance low", () => {
    // The distinction that stops a supplier's blog being quoted in a report as
    // though it carried the weight of the code.
    expect(SOURCES['amsa-707'].confidence).toBe('high');
    expect(SOURCES['dcceew-halon'].confidence).toBe('high');
    expect(SOURCES['qbcc-portable'].confidence).toBe('high');
    expect(SOURCES['firewize-5yr'].confidence).toBe('low');
    expect(SOURCES['alexon-types'].confidence).toBe('low');
    expect(SOURCES['co2-ten-year-claim'].confidence).toBe('low');
  });

  it('says out loud that the charge tolerance it holds is not Australian', () => {
    expect(SOURCES['nfpa10-co2-charge'].confidence).toBe('low');
    expect(SOURCES['nfpa10-co2-charge'].basis).toContain('Not Australian');
  });

  it('resolves the ids every result carries, without repeating one', () => {
    expect(citeSources(['as1851-s10', 'as1851-s10', 'amsa-707']).map((s) => s.id)).toEqual([
      'as1851-s10',
      'amsa-707',
    ]);
  });

  it('lets every result be traced back to a source', () => {
    const results: string[][] = [
      (checkUse('water', 'E') as { sourceIds: string[] }).sourceIds,
      pressureTestInterval('carbon-dioxide').sourceIds,
      assessCondition({ type: 'water', findings: ['failed-pressure-test'], inspected: true }).sourceIds,
      rollupSite([], TODAY).sourceIds,
    ];
    for (const ids of results) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(SOURCES[id as keyof typeof SOURCES]).toBeDefined();
    }
  });

  it('carries the Queensland licensing position, which is the only state that has one', () => {
    expect(QLD_LICENSING_NOTE).toContain('QBCC');
    expect(QLD_LICENSING_NOTE).toContain('certify class does not');
  });
});

describe('dates are Australian', () => {
  it('prints d/m/yyyy and never m/d/y', () => {
    // 1 October read as January moves two thirds of a year of scheduling.
    expect(formatAuDate('2025-10-01')).toBe('1/10/2025');
    expect(formatAuDate('2025-01-10')).toBe('10/1/2025');
  });
});

/** Kept last: a plain readout of the type table, so a reviewer can see what a technician sees. */
describe('the type table as a technician reads it', () => {
  it('names a band, an agent and a rated set for every type', () => {
    for (const type of ALL_TYPES as ExtinguisherType[]) {
      const p = PROFILES[type];
      expect(p.colourBand.length).toBeGreaterThan(0);
      expect(p.agent.length).toBeGreaterThan(0);
      expect(p.handlingCautions.length).toBeGreaterThan(0);
    }
    expect(PROFILES.water.colourBand).toContain('no band');
    expect(PROFILES['dry-chemical-be'].colourBand).toContain('same band as ABE');
    expect(PROFILES['carbon-dioxide'].hasPressureGauge).toBe(false);
  });
});
