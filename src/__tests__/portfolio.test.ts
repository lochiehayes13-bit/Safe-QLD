import {
  COVERAGE_THRESHOLD, OVERDUE_POINTS_BY_FREQUENCY, RISK_WEIGHTS, buildPortfolio, explainScore, foldRuns,
  qldCriticalVerdict, qldToday, riskBand, scoreAddsUp, statementDue,
  type PortfolioDefect, type PortfolioInput, type PortfolioRoutineHistory, type PortfolioSite,
} from '@/domain/portfolio';

/**
 * The portfolio picture across 897 sites.
 *
 * Three failures are being guarded against here, and none of them is
 * arithmetic. The first is a site nobody has ever serviced being counted as a
 * site that is late — one invents a compliance failure that may not exist, and
 * across a book taken over from another contractor it invents hundreds. The
 * second is a ranked list nobody can argue with: a score a technician cannot
 * take apart is a score they will stop believing the first time it puts the
 * wrong site on top. The third is the green dashboard — a screen that reports
 * 94% current because it happens to hold history for forty sites out of 897.
 */

const TODAY = '2026-09-01';

const site = (over: Partial<PortfolioSite> & Pick<PortfolioSite, 'siteId'>): PortfolioSite => ({
  siteName: `Site ${over.siteId}`,
  clientName: 'Brisbane City Council',
  suburb: 'Springwood',
  postcode: '4127',
  ...over,
});

/** An annual detection routine, serviced once in March 2024 and never since. */
const annual = (
  siteId: string,
  over: Partial<PortfolioRoutineHistory> = {},
): PortfolioRoutineHistory => ({
  siteId,
  routineId: 'det-annual',
  frequency: 'annual',
  firstCompletedAt: '2024-03-01',
  lastCompletedAt: '2024-03-01',
  completedCount: 1,
  ...over,
});

const defect = (over: Partial<PortfolioDefect> & Pick<PortfolioDefect, 'defectId' | 'siteId'>): PortfolioDefect => ({
  status: 'open',
  severity: 'non-critical',
  raisedAt: '2026-07-01',
  ...over,
});

/** A critical defect as the Queensland test defines it: both limbs answered yes. */
const critical = (over: Partial<PortfolioDefect> & Pick<PortfolioDefect, 'defectId' | 'siteId'>): PortfolioDefect =>
  defect({ severity: 'critical', qldLimbInoperable: true, qldLimbAdverseImpact: true, ...over });

const input = (over: Partial<PortfolioInput> = {}): PortfolioInput => ({
  today: TODAY,
  sites: [],
  histories: [],
  assets: [],
  defects: [],
  ...over,
});

describe('folding routine runs into a history per site and routine', () => {
  it('anchors a site to its earliest service even when the runs arrive newest first', () => {
    // The database hands back runs ordered by completedAt DESC. Folded
    // naively, every site anchors to its most recent service, every schedule
    // restarts from today, and the whole book reports as current.
    const { histories } = foldRuns([
      { siteId: 's1', routineId: 'det-annual', frequency: 'annual', completedAt: '2026-03-04' },
      { siteId: 's1', routineId: 'det-annual', frequency: 'annual', completedAt: '2024-03-01' },
      { siteId: 's1', routineId: 'det-annual', frequency: 'annual', completedAt: '2025-03-02' },
    ]);
    expect(histories).toHaveLength(1);
    expect(histories[0]!.firstCompletedAt).toBe('2024-03-01');
    expect(histories[0]!.lastCompletedAt).toBe('2026-03-04');
    expect(histories[0]!.completedCount).toBe(3);
  });

  it("refuses a frequency it does not know rather than mapping it to the nearest one", () => {
    // Guessing "yearly" for an unrecognised string asserts a two-month
    // tolerance the app has no basis for, and the site looks compliant on it.
    const { histories, rejected } = foldRuns([
      { siteId: 's1', routineId: 'x', frequency: 'bi-annual', completedAt: '2024-03-01' },
    ]);
    expect(histories).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('bi-annual');
  });

  it('refuses a completion date it cannot read, and says which run it dropped', () => {
    const { histories, rejected } = foldRuns([
      { siteId: 's1', routineId: 'det-annual', frequency: 'annual', completedAt: '1/3/2024' },
    ]);
    expect(histories).toEqual([]);
    expect(rejected[0]!.run.completedAt).toBe('1/3/2024');
  });

  it('reads the system off the routine when the run does not carry one', () => {
    const { histories } = foldRuns([
      { siteId: 's1', routineId: 'det-annual', frequency: 'annual', completedAt: '2024-03-01' },
    ]);
    expect(histories[0]!.system).toBe('detection');
  });
});

describe('a site nobody has ever serviced', () => {
  const book = buildPortfolio(input({
    sites: [site({ siteId: 'never' }), site({ siteId: 'late' })],
    histories: [annual('late')],
  }));

  it('stands as never serviced rather than overdue', () => {
    // Safe QLD takes sites over from other contractors. A site with no history
    // in this app may have been serviced for a decade by somebody else, and
    // calling it overdue puts a compliance failure on a client that may not
    // exist.
    expect(book.health.neverServiced).toBe(1);
    expect(book.health.overdue).toBe(1);
    expect(book.unjudged.map((u) => u.siteId)).toEqual(['never']);
    expect(book.unjudged[0]!.reason).toBe('never-serviced');
  });

  it('is left out of the health percentage entirely, on both sides of it', () => {
    // Counted as current it hides a hole; counted as overdue it invents one.
    // The only honest denominator is the sites that can actually be judged.
    expect(book.health.judged).toBe(1);
    expect(book.health.currentFractionOfJudged).toBe(0);
    expect(book.health.denominator).toContain('never been serviced');
  });

  it('does not call a routine overdue merely because it has never been recorded', () => {
    // With no first service there is no anchor, and with no anchor there is no
    // due date to be past.
    const one = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1', { firstCompletedAt: undefined, lastCompletedAt: undefined, completedCount: 0 })],
    }));
    expect(one.health.neverServiced).toBe(1);
    expect(one.health.overdue).toBe(0);
    expect(one.ranked).toEqual([]);
  });

  it('still counts an open critical defect at a site it cannot otherwise judge', () => {
    // The absence of a service history is an unknown. The defect is a fact,
    // and hiding it behind the unknown is how a critical defect goes quiet.
    const one = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      defects: [critical({ defectId: 'd1', siteId: 's1' })],
    }));
    expect(one.health.neverServiced).toBe(1);
    expect(one.ranked).toHaveLength(1);
    expect(one.ranked[0]!.standing).toBe('never-serviced');
    expect(one.ranked[0]!.score).toBeGreaterThanOrEqual(RISK_WEIGHTS['critical-defect'].points);
    expect(one.unjudged[0]!.criticalDefectsOutstanding).toBe(1);
  });

  it('separates a site that has been serviced but cannot be scheduled', () => {
    // A quarterly routine is a Safe QLD interval with no Section 6 table behind
    // it. The site has been worked on; nothing about it can be called due.
    const one = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1', { routineId: 'ext-quarterly', frequency: 'quarterly' })],
    }));
    expect(one.health.unschedulable).toBe(1);
    expect(one.health.neverServiced).toBe(0);
    expect(one.health.judged).toBe(0);
    expect(one.health.currentFractionOfJudged).toBeUndefined();
  });
});

describe('the risk score', () => {
  const worst = buildPortfolio(input({
    sites: [site({ siteId: 's1', lastStatementAt: '2024-06-01' })],
    histories: [annual('s1')],
    assets: [{ siteId: 's1', system: 'detection' }],
    defects: [
      critical({ defectId: 'd1', siteId: 's1', raisedAt: '2026-07-01', description: 'FIP in fault' }),
      defect({ defectId: 'd2', siteId: 's1' }),
      defect({ defectId: 'd3', siteId: 's1' }),
    ],
  })).ranked[0]!;

  it('adds every contribution up to exactly the score it reports', () => {
    // The whole defence of a ranked list is that the number is the sum of the
    // reasons printed under it. A score with an unexplained remainder is a
    // number a technician is being asked to take on trust.
    expect(scoreAddsUp(worst)).toBe(true);
    expect(worst.contributions.reduce((n, c) => n + c.points, 0)).toBe(worst.score);
  });

  it('names the routine or the defect behind every contribution', () => {
    // "Why is this site at the top" has to be answerable without opening the
    // site.
    for (const c of worst.contributions) {
      expect(c.detail.length).toBeGreaterThan(20);
      expect(c.sourceIds.length).toBeGreaterThan(0);
    }
    expect(explainScore(worst)[0]).toContain('Critical defect');
  });

  it('says where the weight itself came from, and that it is not a standard', () => {
    // The intervals come from AS 1851. The idea that a lapsed annual is worth
    // thirty and a lapsed monthly six is Safe QLD's opinion, and a screen that
    // does not say so is passing off an opinion as a compliance finding.
    const weighting = worst.contributions.filter((c) => c.sourceIds.includes('safe-qld-weighting'));
    expect(weighting.length).toBe(worst.contributions.length);
  });

  it('weights a lapsed annual well above a lapsed monthly', () => {
    // One is a panel nobody has looked at for a month. The other is a building
    // whose detection has not been tested in over a year.
    expect(OVERDUE_POINTS_BY_FREQUENCY.annual).toBeGreaterThan(OVERDUE_POINTS_BY_FREQUENCY.monthly * 3);
    const yearly = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1')],
    })).ranked[0]!;
    const monthly = buildPortfolio(input({
      sites: [site({ siteId: 's2' })],
      histories: [annual('s2', { routineId: 'det-monthly', frequency: 'monthly' })],
    })).ranked[0]!;
    expect(yearly.score).toBeGreaterThan(monthly.score);
  });

  it('stops the lateness contribution climbing forever', () => {
    // A year late and two years late are the same problem and the same visit.
    // Uncapped, an abandoned site would out-rank a live critical defect purely
    // by sitting there.
    const age = worst.contributions.find((c) => c.factor === 'routine-overdue-age');
    expect(age!.points).toBe(RISK_WEIGHTS['routine-overdue-age'].cap);
    expect(age!.points).toBeLessThan(RISK_WEIGHTS['critical-defect'].points);
  });

  it('caps a pile of small defects below a single critical one', () => {
    // Forty loose escutcheons are not a fire indicator panel in fault.
    const many = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      defects: Array.from({ length: 40 }, (_, i) => defect({ defectId: `d${i}`, siteId: 's1' })),
    })).ranked[0]!;
    const one = buildPortfolio(input({
      sites: [site({ siteId: 's2' })],
      defects: [critical({ defectId: 'c1', siteId: 's2' })],
    })).ranked[0]!;
    expect(many.score).toBe(RISK_WEIGHTS['non-critical-defects'].cap);
    expect(one.score).toBeGreaterThan(many.score);
  });

  it('counts the days from the end of the tolerance window, not from the due date', () => {
    // A yearly carries two months of tolerance. Calling a service eight weeks
    // late while the standard still allows it is how a technician stops
    // believing the list.
    const inWindow = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1')],
      today: '2025-04-01',
    }));
    expect(inWindow.health.due).toBe(1);
    expect(inWindow.health.overdue).toBe(0);

    const justOut = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1')],
      today: '2025-05-20',
    })).ranked[0]!;
    const age = justOut.contributions.find((c) => c.factor === 'routine-overdue-age');
    expect(age!.label).toContain('19 days past its window');
    expect(age!.points).toBe(2);
  });

  it('ranks a critical defect and a lapsed annual above a handful of monthlies', () => {
    // The comparison the whole module exists to get right.
    const book = buildPortfolio(input({
      sites: [site({ siteId: 'bad' }), site({ siteId: 'busy' })],
      histories: [
        annual('bad'),
        ...['det-monthly', 'ews-monthly', 'ext-monthly'].map((routineId) =>
          annual('busy', { routineId, frequency: 'monthly', firstCompletedAt: '2026-07-01', lastCompletedAt: '2026-07-01' })),
      ],
      defects: [critical({ defectId: 'd1', siteId: 'bad' })],
    }));
    expect(book.ranked[0]!.siteId).toBe('bad');
    expect(book.ranked.map((r) => r.band)).toEqual(['severe', 'moderate']);
  });

  it('bands a score without inventing a second judgement', () => {
    expect(riskBand(0)).toBe('none');
    expect(riskBand(1)).toBe('low');
    expect(riskBand(30)).toBe('high');
    expect(riskBand(60)).toBe('severe');
  });

  it('lists what it could not weigh instead of scoring it', () => {
    // An unknown that quietly becomes a zero is the same lie as an unknown that
    // quietly becomes a failure.
    const codes = worst.unknowns.map((u) => u.code);
    expect(codes).not.toContain('no-asset-register');

    const noRegister = buildPortfolio(input({
      sites: [site({ siteId: 's1' })],
      histories: [annual('s1')],
    })).ranked[0]!;
    expect(noRegister.unknowns.map((u) => u.code)).toContain('no-asset-register');
    expect(noRegister.unknowns.every((u) => u.detail.length > 20)).toBe(true);
  });
});

describe('statutory exposure', () => {
  const base = input({
    sites: [site({ siteId: 's1', lastStatementAt: '2026-06-01' }), site({ siteId: 's2', lastStatementAt: '2026-06-01' })],
    histories: [annual('s1'), annual('s2', { firstCompletedAt: '2026-08-01', lastCompletedAt: '2026-08-01' })],
  });

  it('never moves a health figure, however many critical defects are open', () => {
    // A statutory clock is not offset by ninety sites being up to date. If a
    // defect could shift the health counts, the two would be averaged together
    // — which is exactly how a legal obligation goes quiet.
    const without = buildPortfolio(base);
    const withDefects = buildPortfolio({
      ...base,
      defects: [
        critical({ defectId: 'd1', siteId: 's1' }),
        critical({ defectId: 'd2', siteId: 's2' }),
        critical({ defectId: 'd3', siteId: 's2' }),
      ],
    });
    expect(withDefects.health).toEqual(without.health);
    expect(withDefects.coverage.fraction).toEqual(without.coverage.fraction);
    expect(withDefects.statutory.criticalDefectsOutstanding).toBe(3);
    expect(without.statutory.criticalDefectsOutstanding).toBe(0);
  });

  it('counts the written notice as overdue once the 24 hours has run with none recorded', () => {
    const book = buildPortfolio({
      ...base,
      defects: [critical({ defectId: 'd1', siteId: 's1', raisedAt: '2026-08-20' })],
    });
    expect(book.statutory.noticeOverdue).toBe(1);
    expect(book.statutory.noticeClockRunning).toBe(0);
    const item = book.statutory.items.find((i) => i.kind === 'notice-overdue')!;
    expect(item.legalRef).toContain('s 53(2)');
    // The regulation counts from the maintenance; the app holds the date the
    // defect was raised. Every figure derived from it has to say so.
    expect(item.detail).toContain('raised');
  });

  it('leaves the clock running rather than reporting a breach on the day', () => {
    const book = buildPortfolio({
      ...base,
      defects: [critical({ defectId: 'd1', siteId: 's1', raisedAt: '2026-09-01T09:00:00.000Z' })],
    });
    expect(book.statutory.noticeClockRunning).toBe(1);
    expect(book.statutory.noticeOverdue).toBe(0);
  });

  it('does not chase a notice that has already been given', () => {
    const book = buildPortfolio({
      ...base,
      defects: [critical({
        defectId: 'd1', siteId: 's1', raisedAt: '2026-07-01', noticeIssuedAt: '2026-07-01T22:00:00.000Z',
      })],
    });
    expect(book.statutory.noticeRecorded).toBe(1);
    expect(book.statutory.noticeOverdue).toBe(0);
  });

  it('counts a defect past the occupier\'s month, and only while it is outstanding', () => {
    const book = buildPortfolio({
      ...base,
      defects: [
        critical({ defectId: 'd1', siteId: 's1', raisedAt: '2026-07-01' }),
        critical({ defectId: 'd2', siteId: 's2', raisedAt: '2026-07-01', status: 'rectified', rectifiedAt: '2026-07-10' }),
      ],
    });
    expect(book.statutory.pastRectificationDate).toBe(1);
    expect(book.statutory.criticalDefectsOutstanding).toBe(1);
  });

  it("keeps a defect flagged critical with the two limbs unanswered out of the critical count", () => {
    // Counting it as critical asserts a notice obligation nobody established;
    // counting it as ordinary drops one that may exist. It is unanswered.
    const book = buildPortfolio({
      ...base,
      defects: [defect({ defectId: 'd1', siteId: 's1', severity: 'critical' })],
    });
    expect(book.statutory.criticalDefectsOutstanding).toBe(0);
    expect(book.statutory.classificationUnanswered).toBe(1);
    expect(book.statutory.noticeOverdue).toBe(0);
    expect(book.ranked[0]!.unknowns.map((u) => u.code)).toContain('critical-limbs-unanswered');
  });

  it('reads the Queensland test as two limbs, both of which have to be true', () => {
    expect(qldCriticalVerdict(critical({ defectId: 'd', siteId: 's' }))).toBe('yes');
    expect(qldCriticalVerdict(defect({
      defectId: 'd', siteId: 's', severity: 'critical', qldLimbInoperable: true, qldLimbAdverseImpact: false,
    }))).toBe('no');
    expect(qldCriticalVerdict(defect({
      defectId: 'd', siteId: 's', severity: 'critical', qldLimbInoperable: true,
    }))).toBe('unanswered');
    expect(qldCriticalVerdict(defect({ defectId: 'd', siteId: 's' }))).toBe('no');
  });

  it('reports a rectification date it cannot work out rather than assuming the repair is in time', () => {
    const book = buildPortfolio({
      ...base,
      defects: [critical({ defectId: 'd1', siteId: 's1', raisedAt: 'last Tuesday' })],
    });
    expect(book.statutory.rectificationDateUnknown).toBe(1);
    expect(book.statutory.pastRectificationDate).toBe(0);
    expect(book.statutory.items.find((i) => i.kind === 'rectification-date-unknown')!.detail)
      .toContain('last Tuesday');
  });

  it('will not say when an occupier statement is due where it holds no date to count from', () => {
    // Shown as in hand it hides a statutory obligation; shown as overdue it
    // invents one at every site the app has not been told about.
    const book = buildPortfolio(input({ sites: [site({ siteId: 's1' })] }));
    expect(statementDue(site({ siteId: 's1' })).date).toBeUndefined();
    expect(book.statutory.statementDateUnknown).toBe(1);
    expect(book.statutory.statementsOverdue).toBe(0);
    expect(book.ranked).toEqual([]);
  });

  it('counts a statement a year past its last one as overdue', () => {
    const book = buildPortfolio(input({
      sites: [site({ siteId: 's1', lastStatementAt: '2025-01-15' })],
    }));
    expect(book.statutory.statementsOverdue).toBe(1);
    expect(book.statutory.items[0]!.dueAt).toBe('2026-01-15');
  });

  it('runs the statement year off the statement, not off the last service', () => {
    // An occupier who serviced everything in March but did not sign until
    // August has an August anniversary.
    expect(statementDue(site({ siteId: 's1', lastStatementAt: '2026-08-20' })).date).toBe('2027-08-20');
    expect(statementDue(site({ siteId: 's1', occupationAt: '2026-02-01' })).date).toBe('2027-02-01');
  });

  it('carries a source and a legal reference on every statutory item', () => {
    const book = buildPortfolio({
      ...base,
      defects: [critical({ defectId: 'd1', siteId: 's1' })],
    });
    expect(book.statutory.items.length).toBeGreaterThan(0);
    for (const item of book.statutory.items) {
      expect(item.legalRef).toBeTruthy();
      expect(item.sourceIds.length).toBeGreaterThan(0);
    }
    expect(book.statutory.sources.every((s) => s.url)).toBe(true);
    expect(book.statutory.note).toContain('not a measure of how the book is going');
  });
});

describe('coverage', () => {
  const mixed = buildPortfolio(input({
    sites: [site({ siteId: 'a' }), site({ siteId: 'b' }), site({ siteId: 'c' }), site({ siteId: 'd' })],
    histories: [
      annual('a'),
      annual('b', { firstCompletedAt: '2026-08-01', lastCompletedAt: '2026-08-01' }),
      annual('d', { routineId: 'ext-quarterly', frequency: 'quarterly' }),
    ],
    assets: [{ siteId: 'a', system: 'detection' }, { siteId: 'a', system: 'detection' }],
  }));

  it('reports the fraction of the book it can judge at all, before anything else', () => {
    // A dashboard that reads green because it only knows about forty sites is
    // the most dangerous screen in this app.
    expect(mixed.coverage.sites).toBe(4);
    expect(mixed.coverage.judged).toBe(2);
    expect(mixed.coverage.fraction).toBe(0.5);
    expect(mixed.coverage.percent).toBe(50);
    expect(mixed.coverage.headline).toContain('2 of 4 sites');
  });

  it('says plainly that a health figure over half a book is not the book', () => {
    expect(mixed.coverage.enoughToJudge).toBe(false);
    expect(0.5).toBeLessThan(COVERAGE_THRESHOLD);
    expect(mixed.coverage.caveats.join(' ')).toContain('cannot be placed on the schedule');
  });

  it('refuses a coverage figure where there is nothing to cover', () => {
    // Zero of zero is not 0% and is not 100%. It is no answer.
    const empty = buildPortfolio(input());
    expect(empty.coverage.fraction).toBeUndefined();
    expect(empty.coverage.percent).toBeUndefined();
    expect(empty.coverage.headline).toContain('no sites');
  });

  it('counts a site with no asset register as unknown rather than empty', () => {
    // An unimported register and an empty building look identical from here,
    // and treating the first as the second understates the book of work.
    expect(mixed.coverage.sitesWithAssetsKnown).toBe(1);
    expect(mixed.coverage.sitesWithAssetsUnknown).toBe(3);
    expect(mixed.coverage.assetsCounted).toBe(2);
    expect(mixed.coverage.caveats.join(' ')).toContain('no asset register imported');
  });

  it('takes an explicit asset count as knowledge, including a count of zero', () => {
    const known = buildPortfolio(input({ sites: [site({ siteId: 'a', assetCount: 0 })] }));
    expect(known.coverage.sitesWithAssetsKnown).toBe(1);
    expect(known.coverage.sitesWithAssetsUnknown).toBe(0);
  });

  it('counts rows that point at a site the book does not hold', () => {
    // A defect against a site the app has lost is still a defect. Silently
    // dropping it is how the statutory count comes out short.
    const book = buildPortfolio(input({
      sites: [site({ siteId: 'a' })],
      histories: [annual('gone')],
      defects: [critical({ defectId: 'd1', siteId: 'gone' })],
      assets: [{ siteId: 'gone' }],
    }));
    expect(book.unmatched).toMatchObject({ histories: 1, defects: 1, assets: 1 });
    expect(book.statutory.criticalDefectsOutstanding).toBe(0);
    expect(book.notes.join(' ')).toContain('not in the book');
  });
});

describe('concentration', () => {
  const book = buildPortfolio(input({
    sites: [
      site({ siteId: 'a', clientName: 'Logan City Council', suburb: 'Springwood' }),
      site({ siteId: 'b', clientName: ' logan city  council ', suburb: 'SPRINGWOOD ' }),
      site({ siteId: 'c', clientName: 'Queensland Health', suburb: 'Chermside', postcode: '4032' }),
      site({ siteId: 'd', clientName: undefined, suburb: undefined }),
    ],
    histories: [
      annual('a'),
      annual('b'),
      annual('b', { routineId: 'ext-annual', frequency: 'annual', system: 'extinguisher' }),
      annual('c', { firstCompletedAt: '2026-08-01', lastCompletedAt: '2026-08-01' }),
    ],
  }));

  it('puts one client in one row however the name was typed', () => {
    // Three spellings of a council split the concentration three ways, which
    // is the exact failure the table exists to expose.
    expect(book.concentration.byClient[0]!.label).toBe('Logan City Council');
    expect(book.concentration.byClient[0]!.sites).toBe(2);
    expect(book.concentration.byClient[0]!.overdueRoutines).toBe(3);
    expect(book.concentration.byClient[0]!.shareOfOverdue).toBe(1);
  });

  it('counts sites with no client or suburb rather than bucketing them as Unknown', () => {
    // An "Unknown" bucket of 300 sites tops the table and sends somebody
    // looking for a client that does not exist.
    expect(book.concentration.sitesWithNoClient).toBe(1);
    expect(book.concentration.sitesWithNoSuburb).toBe(1);
    expect(book.concentration.byClient.map((r) => r.label)).not.toContain('Unknown');
    expect(book.concentration.caveats.join(' ')).toContain('no client recorded');
  });

  it('counts overdue work by system per routine, not per site', () => {
    // One site can be overdue on detection and current on extinguishers.
    // Rolling it up to the site puts the whole site against both.
    const systems = Object.fromEntries(book.concentration.bySystem.map((r) => [r.key, r.overdueRoutines]));
    expect(systems).toEqual({ detection: 2, extinguisher: 1 });
  });

  it('reports how much of each row it could not judge', () => {
    const nothing = buildPortfolio(input({
      sites: [site({ siteId: 'a', clientName: 'Logan City Council' })],
    }));
    expect(nothing.concentration.byClient[0]!.unjudgedSites).toBe(1);
    expect(nothing.concentration.byClient[0]!.shareOfOverdue).toBeUndefined();
  });
});

describe('refusing to answer', () => {
  it('judges nothing at all against a date it cannot read', () => {
    // "1/9/2026" is a perfectly ordinary Australian date and not an ISO one.
    // Counted as today by accident, every window in the book moves.
    const book = buildPortfolio(input({
      today: '1/9/2026',
      sites: [site({ siteId: 'a' })],
      histories: [annual('a')],
    }));
    expect(book.today).toBeUndefined();
    expect(book.health.sites).toBe(0);
    expect(book.ranked).toEqual([]);
    expect(book.refusals[0]).toContain('1/9/2026');
    expect(book.coverage.fraction).toBeUndefined();
  });

  it('never hands an Australian date to a parser that reads it American', () => {
    // Date.parse("1/9/2026") returns 9 January, not 1 September, and does it
    // silently. Nothing that is not already ISO is given to it.
    expect(qldToday('1/9/2026')).toBeUndefined();
    expect(qldToday('01/09/2026')).toBeUndefined();
    expect(qldToday('2026-09-01')).toBe('2026-09-01');
  });

  it('refuses a date that looks ISO but is not a day of the year', () => {
    expect(qldToday('2026-02-31')).toBeUndefined();
    expect(qldToday('2026-13-01')).toBeUndefined();
  });

  it('reads an instant on the Queensland calendar, which never shifts for daylight saving', () => {
    // A job closed at 23:00 UTC on the 31st is the 1st here, and a run sheet
    // that says otherwise sends somebody a day late.
    expect(qldToday('2026-08-31T23:00:00.000Z')).toBe('2026-09-01');
    expect(qldToday('2026-09-01T02:00:00.000Z')).toBe('2026-09-01');
  });

  it('keeps the first row when two rows claim the same site id, and says it did', () => {
    // Two rows claiming one id is a data fault. Merging them invents a site
    // with somebody else's history on it.
    const book = buildPortfolio(input({
      sites: [site({ siteId: 'a', siteName: 'First' }), site({ siteId: 'a', siteName: 'Second' })],
    }));
    expect(book.coverage.sites).toBe(1);
    expect(book.unjudged[0]!.siteName).toBe('First');
    expect(book.notes.join(' ')).toContain('repeated a site id');
  });
});
