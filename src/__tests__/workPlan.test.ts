import {
  DEFAULT_PROXIMITY_RADIUS_KM,
  ESTIMATE_CAVEAT,
  FREQUENCY_EFFORT,
  NOT_COUNTED_ASSET_TYPES,
  PER_ASSET_MINUTES,
  VISIT_OVERHEAD_MINUTES,
  calendarMonthWindow,
  clusterSites,
  defaultPlanWindow,
  estimateVisitHours,
  formatHours,
  planWork,
  qldDate,
  workingDaysIn,
  type PlanOptions,
  type PlanRoutine,
  type PlanSite,
  type PlanWindow,
} from '@/domain/workPlan';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import { ASSET_TYPES, SYSTEM_LABELS } from '@/seed/assetTypes';

/**
 * Planning a month of work.
 *
 * The failures being guarded against are all ones that cost real money or real
 * compliance: a month booked so tightly that one slip breaches a tolerance
 * window, a technician sent across Brisbane and back because two jobs in the
 * same suburb landed on different days, an overdue service politely queued
 * behind routine work, and — worst of the four — a plausible number invented
 * for a site nobody has ever surveyed.
 */

// October 2026 is a clean month to reason about: it starts on a Thursday and
// holds 22 weekdays, one of which (Monday 5 October, King's Birthday) is a
// Queensland public holiday.
const OCTOBER: PlanWindow = { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' };
const TODAY = '2026-09-15';

function site(over: Partial<PlanSite> & { siteId: string }): PlanSite {
  return {
    siteName: over.siteId,
    suburb: 'Springwood',
    postcode: '4127',
    assetCounts: [{ system: 'detection', count: 20 }],
    ...over,
  };
}

function routine(over: Partial<PlanRoutine> & { siteId: string }): PlanRoutine {
  return {
    routineId: 'det-annual',
    routineLabel: 'Detection — annual',
    system: 'detection',
    frequency: 'annual',
    state: 'upcoming',
    scheduledFor: '2026-10-15',
    window: { earliest: '2026-08-15', latest: '2026-12-15' },
    ...over,
  };
}

function options(over: Partial<PlanOptions> = {}): PlanOptions {
  return { today: TODAY, window: OCTOBER, technicians: 1, hoursPerDay: 7.5, ...over };
}

function allVisits(plan: ReturnType<typeof planWork>) {
  return plan.days.flatMap((d) => d.technicians.flatMap((t) => t.visits));
}

function visitFor(plan: ReturnType<typeof planWork>, siteId: string) {
  return allVisits(plan).filter((v) => v.siteId === siteId);
}

describe('the window being planned', () => {
  it('defaults to next month, because the office books October during September', () => {
    // Planning the month you are already working is not planning.
    expect(defaultPlanWindow('2026-09-15')).toEqual({
      from: '2026-10-01', to: '2026-10-31', label: 'October 2026',
    });
  });

  it('ends a month on its real last day, including February in a leap year', () => {
    // Naive month arithmetic produces 31 February and then a plan with days in
    // it that do not exist.
    expect(calendarMonthWindow('2028-02-10')?.to).toBe('2028-02-29');
    expect(calendarMonthWindow('2026-02-10')?.to).toBe('2026-02-28');
    expect(calendarMonthWindow('2026-12-15', 1)).toEqual({
      from: '2027-01-01', to: '2027-01-31', label: 'January 2027',
    });
  });

  it("refuses a date it cannot read rather than planning from today's accident", () => {
    expect(calendarMonthWindow('not a date')).toBeUndefined();
    expect(calendarMonthWindow('15/10/2026')).toBeUndefined();
  });

  it('reads a Queensland calendar date off an instant, with no daylight saving to worry about', () => {
    // 15:00 UTC is one in the morning the next day in Brisbane. A planner that
    // slices the UTC date books the work a day early every evening.
    expect(qldDate('2026-10-14T15:00:00.000Z')).toBe('2026-10-15');
    expect(qldDate('2026-10-14T13:59:00.000Z')).toBe('2026-10-14');
    expect(qldDate('rubbish')).toBeUndefined();
  });
});

describe('working days', () => {
  it('leaves out the weekends', () => {
    const days = workingDaysIn(OCTOBER);
    expect(days).toHaveLength(22);
    expect(days).not.toContain('2026-10-03'); // Saturday
    expect(days).not.toContain('2026-10-04'); // Sunday
    expect(days[0]).toBe('2026-10-01');
  });

  it('leaves out the public holidays it is given, and never invents any', () => {
    // Queensland's list changes yearly and the Brisbane show holiday is
    // regional, so a hardcoded list would be wrong for half the book. The
    // caller supplies them; the planner never guesses.
    const days = workingDaysIn(OCTOBER, ['2026-10-05']);
    expect(days).not.toContain('2026-10-05');
    expect(days).toHaveLength(21);
  });

  it('does not quietly stop counting partway through a long window', () => {
    // A window longer than a month is legitimate, and a loop capped at a round
    // number returns half of one. A plan short of days reports "no room left"
    // for work there was room for, which is indistinguishable from a full book.
    const year = workingDaysIn({ from: '2026-01-01', to: '2026-12-31', label: '2026' });
    expect(year[0]).toBe('2026-01-01');
    expect(year[year.length - 1]).toBe('2026-12-31'); // a Thursday
    expect(year).toHaveLength(261); // 2026 has 261 weekdays
  });

  it('never plans into the past', () => {
    const days = workingDaysIn(OCTOBER, [], '2026-10-20');
    expect(days[0]).toBe('2026-10-20');
    expect(days).not.toContain('2026-10-19');
  });
});

describe('estimating how long a visit takes', () => {
  it('refuses to guess at a site nobody has surveyed', () => {
    // The whole point of the optional return. A site with no register could be
    // a cupboard or a hospital, and a plausible half day is worse than a gap
    // somebody can see.
    expect(estimateVisitHours(undefined, [{ system: 'detection', frequency: 'annual' }])).toBeUndefined();
  });

  it('separates an empty register from an unknown one', () => {
    // An empty array means somebody looked. It still returns a figure rather
    // than undefined, which is the distinction the optional return exists for.
    const estimate = estimateVisitHours([], [{ system: 'detection', frequency: 'annual' }]);
    expect(estimate).toBeDefined();
    expect(estimate!.minutes).toBe(VISIT_OVERHEAD_MINUTES + FREQUENCY_EFFORT.annual.systemMinutes);
    expect(estimate!.basis.some((b) => /no fire detection assets registered/i.test(b))).toBe(true);
  });

  it("will not size a device walk at nothing because the register holds none of that system", () => {
    // A detection annual is only ever due at a site because a detection service
    // was recorded there. Zero registered detectors is a hole in the register,
    // not an empty building, and costing the walk at nought books a hospital as
    // an hour and three quarters — the day is then a day short in the field.
    const estimate = estimateVisitHours(
      [{ system: 'extinguisher', count: 30 }],
      [{ system: 'detection', frequency: 'annual' }],
    )!;
    expect(estimate.partial).toBe(true);
    expect(estimate.notCosted.some((n) => /fire detection devices/i.test(n))).toBe(true);
  });

  it('does not call a monthly partial just because nothing is registered', () => {
    // A monthly never walks the devices, so an empty detection register takes
    // nothing away from the figure and the estimate is complete as it stands.
    const estimate = estimateVisitHours([], [{ system: 'detection', frequency: 'monthly' }])!;
    expect(estimate.partial).toBe(false);
    expect(estimate.notCosted).toEqual([]);
  });

  it('refuses a count that is not a whole number of assets rather than reading it as none', () => {
    // A NaN or a negative arrives from a bad import or a hand-edited row.
    // Folding it in as zero shrinks the visit, and short is the direction that
    // costs a day: the work is booked and the technician runs out of hours.
    const nan = estimateVisitHours(
      [{ system: 'detection', count: Number.NaN }],
      [{ system: 'detection', frequency: 'annual' }],
    )!;
    expect(nan.partial).toBe(true);
    expect(nan.notCosted.some((n) => /whole number/i.test(n))).toBe(true);

    const negative = estimateVisitHours(
      [{ system: 'detection', count: -5 }],
      [{ system: 'detection', frequency: 'annual' }],
    )!;
    // The old arithmetic added it straight through and took half an hour off.
    expect(negative.minutes).toBeGreaterThanOrEqual(VISIT_OVERHEAD_MINUTES);
    expect(negative.partial).toBe(true);
  });

  it('walks the devices on a yearly and does not on a monthly', () => {
    // Treating a monthly as though it walked 200 detectors turns a book of
    // monthlies into a fictional several hundred hours.
    const assets = [{ system: 'detection', count: 200 }];
    const yearly = estimateVisitHours(assets, [{ system: 'detection', frequency: 'annual' }])!;
    const monthly = estimateVisitHours(assets, [{ system: 'detection', frequency: 'monthly' }])!;
    expect(yearly.minutes).toBe(
      VISIT_OVERHEAD_MINUTES + FREQUENCY_EFFORT.annual.systemMinutes + 200 * PER_ASSET_MINUTES.detection.minutesPerAsset,
    );
    expect(monthly.minutes).toBe(VISIT_OVERHEAD_MINUTES + FREQUENCY_EFFORT.monthly.systemMinutes);
    expect(yearly.hours).toBeGreaterThan(monthly.hours);
  });

  it('counts a system once even when two routines on it fall the same day', () => {
    // A six-monthly and a yearly done together is one walk of the detectors,
    // not one and a quarter of one.
    const assets = [{ system: 'detection', count: 100 }];
    const both = estimateVisitHours(assets, [
      { system: 'detection', frequency: 'six-monthly' },
      { system: 'detection', frequency: 'annual' },
    ])!;
    const yearlyOnly = estimateVisitHours(assets, [{ system: 'detection', frequency: 'annual' }])!;
    // The extra routine adds its own panel work and paperwork, and nothing else.
    expect(both.minutes - yearlyOnly.minutes).toBe(FREQUENCY_EFFORT['six-monthly'].systemMinutes);
  });

  it('charges the attendance overhead once however many routines are done', () => {
    const assets = [{ system: 'detection', count: 10 }, { system: 'extinguisher', count: 30 }];
    const one = estimateVisitHours(assets, [{ system: 'detection', frequency: 'annual' }])!;
    const two = estimateVisitHours(assets, [
      { system: 'detection', frequency: 'annual' },
      { system: 'extinguisher', frequency: 'annual' },
    ])!;
    expect(two.minutes - one.minutes).toBe(
      FREQUENCY_EFFORT.annual.systemMinutes + 30 * PER_ASSET_MINUTES.extinguisher.minutesPerAsset,
    );
  });

  it('names what it could not cost instead of charging it at the nearest thing', () => {
    // A system kind this table has never heard of turns up the day somebody
    // adds one. Its assets stay out of the figure and the figure says so.
    const estimate = estimateVisitHours(
      [{ system: 'lightning-protection', count: 40 }],
      [{ system: 'lightning-protection', frequency: 'annual' }],
    )!;
    expect(estimate.partial).toBe(true);
    expect(estimate.notCosted).toContain('lightning-protection assets');
    expect(estimate.minutes).toBe(VISIT_OVERHEAD_MINUTES + FREQUENCY_EFFORT.annual.systemMinutes);
  });

  it('never presents itself as a measurement', () => {
    const estimate = estimateVisitHours([{ system: 'detection', count: 5 }], [
      { system: 'detection', frequency: 'annual' },
    ])!;
    expect(estimate.estimate).toBe(true);
    expect(estimate.confidence).toBe('low');
    expect(ESTIMATE_CAVEAT).toMatch(/not a figure from AS 1851/);
  });

  it('carries a source on every per-asset figure it ships', () => {
    // The rule the whole app runs on: a number from outside your own head
    // carries where it came from, in the data and not in a comment.
    for (const [system, rate] of Object.entries(PER_ASSET_MINUTES)) {
      expect(rate.source.length).toBeGreaterThan(10);
      expect(['low', 'medium', 'high']).toContain(rate.confidence);
      expect(SYSTEM_LABELS[rate.system]).toBeDefined();
      expect(rate.system).toBe(system);
    }
  });

  it('carries a source and a confidence on every frequency effort figure as well', () => {
    // The per-asset minutes are not the only estimate in the module. How much
    // of a site a monthly touches is a bigger lever on the total than any
    // single device rate, and it has to say where it came from in the data.
    for (const [frequency, effort] of Object.entries(FREQUENCY_EFFORT)) {
      expect(effort.frequency).toBe(frequency);
      expect(effort.source.length).toBeGreaterThan(10);
      expect(['low', 'medium', 'high']).toContain(effort.confidence);
      expect(effort.assetCoverage).toBeGreaterThanOrEqual(0);
      expect(effort.assetCoverage).toBeLessThanOrEqual(1);
    }
  });

  it('costs every frequency the shipped routines actually use', () => {
    // The routine list and the effort table are edited separately. A frequency
    // with no effort behind it silently plans as an empty visit.
    const missing = [...new Set(SERVICE_ROUTINES.map((r) => r.frequency))].filter((f) => !FREQUENCY_EFFORT[f]);
    expect(missing).toEqual([]);
  });

  it('costs every system the shipped routines actually use', () => {
    const missing = [...new Set(SERVICE_ROUTINES.map((r) => r.system))].filter((s) => !PER_ASSET_MINUTES[s]);
    expect(missing).toEqual([]);
  });

  it('names a real asset type, with a written reason, in every exclusion', () => {
    // The register is a tree and the rates are per device. A loop charged as a
    // detector, or a sampling hole charged as a whole aspirating unit, turns a
    // real building into a fifty hour visit — which the planner then refuses as
    // larger than a day, and the site quietly falls out of the month. This list
    // is what stops that, so a renamed type id must break here rather than
    // silently stop excluding anything.
    const known = new Set(ASSET_TYPES.map((t) => t.id));
    for (const [id, why] of Object.entries(NOT_COUNTED_ASSET_TYPES)) {
      expect(known.has(id)).toBe(true);
      // Not "excluded": excluded, and here is the figure that covers it.
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('excludes only types whose system would otherwise charge them per device', () => {
    // An exclusion against a system costed at zero minutes would be noise, and
    // noise in a list like this is how a real exclusion gets deleted later.
    for (const id of Object.keys(NOT_COUNTED_ASSET_TYPES)) {
      const type = ASSET_TYPES.find((t) => t.id === id)!;
      expect(PER_ASSET_MINUTES[type.system].minutesPerAsset).toBeGreaterThan(0);
    }
  });
});

describe('clustering by locality', () => {
  it('batches a suburb together and says that is what it did', () => {
    // A technician does a suburb, not a radius. Two Springwood jobs on
    // different days is an hour of driving nobody billed for.
    const result = clusterSites([
      site({ siteId: 'a', suburb: 'Springwood', postcode: '4127' }),
      site({ siteId: 'b', suburb: 'SPRINGWOOD ', postcode: '4127' }),
      site({ siteId: 'c', suburb: 'Chermside', postcode: '4032' }),
    ]);
    const springwood = result.clusters.find((c) => c.label.startsWith('Springwood'))!;
    expect(springwood.siteIds.sort()).toEqual(['a', 'b']);
    expect(springwood.method).toBe('locality');
    expect(result.clusters).toHaveLength(2);
  });

  it('does not split a suburb over a difference in case or spacing', () => {
    // Real imports arrive shouting, padded, or both.
    const result = clusterSites([
      site({ siteId: 'a', suburb: 'mount  gravatt', postcode: '4122' }),
      site({ siteId: 'b', suburb: 'Mount Gravatt', postcode: '4122' }),
    ]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.label).toBe('Mount Gravatt 4122');
  });

  it('ignores a postcode that is not a postcode', () => {
    // "QLD 4127" in the postcode column is a data entry error, and clustering
    // on it would batch sites together on the strength of one.
    const result = clusterSites([
      site({ siteId: 'a', suburb: 'Springwood', postcode: 'QLD 4127' }),
      site({ siteId: 'b', suburb: 'Springwood', postcode: '4127' }),
    ]);
    // Site a keys on the suburb alone, and folds in because 4127 is the only
    // postcode the book holds for the name.
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.siteIds.sort()).toEqual(['a', 'b']);
  });

  it("refuses to guess which Springfield a site with no postcode is in", () => {
    // Springfield is in 4300 near Ipswich and in 4870 near Cairns. Folding the
    // postcode-less one into either is how somebody drives 1,500 km.
    const result = clusterSites([
      site({ siteId: 'ipswich', suburb: 'Springfield', postcode: '4300' }),
      site({ siteId: 'cairns', suburb: 'Springfield', postcode: '4870' }),
      site({ siteId: 'unknown', suburb: 'Springfield', postcode: undefined }),
    ]);
    const stray = result.clusters.find((c) => c.siteIds.includes('unknown'))!;
    expect(stray.siteIds).toEqual(['unknown']);
    expect(stray.basis).toMatch(/2 postcodes/);
  });

  it('falls back to straight-line proximity where a site has no locality at all', () => {
    // Brisbane GPO and a point a few hundred metres away; the Gold Coast is 70
    // km off and must not join them.
    const result = clusterSites([
      site({ siteId: 'city', suburb: undefined, postcode: undefined, latitude: -27.4678, longitude: 153.0281 }),
      site({ siteId: 'nearby', suburb: undefined, postcode: undefined, latitude: -27.4700, longitude: 153.0300 }),
      site({ siteId: 'coast', suburb: undefined, postcode: undefined, latitude: -28.0167, longitude: 153.4000 }),
    ]);
    const cityCluster = result.clusters.find((c) => c.siteIds.includes('city'))!;
    expect(cityCluster.method).toBe('proximity');
    expect(cityCluster.siteIds.sort()).toEqual(['city', 'nearby']);
    expect(cityCluster.basis).toMatch(new RegExp(`${DEFAULT_PROXIMITY_RADIUS_KM} km`));
    // And the weaker method admits to being weaker.
    expect(cityCluster.basis).toMatch(/straight-line/i);
    expect(result.clusters.find((c) => c.siteIds.includes('coast'))!.siteIds).toEqual(['coast']);
  });

  it('prefers the suburb over the coordinates when it has both', () => {
    // Two sites in the same suburb separated by more than the proximity radius
    // still belong to one day: the suburb is the stronger fact.
    const result = clusterSites([
      site({ siteId: 'a', suburb: 'Ipswich', postcode: '4305', latitude: -27.6171, longitude: 152.7605 }),
      site({ siteId: 'b', suburb: 'Ipswich', postcode: '4305', latitude: -27.7000, longitude: 152.8500 }),
    ]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.method).toBe('locality');
  });

  it('reports a site with no locality and no position rather than dropping it', () => {
    const result = clusterSites([site({ siteId: 'nowhere', suburb: undefined, postcode: undefined })]);
    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered.map((s) => s.siteId)).toEqual(['nowhere']);
  });

  it('treats the Gulf of Guinea as a missing coordinate, not a site', () => {
    // 0,0 arrives from any import that defaults a null to a number.
    const result = clusterSites([
      site({ siteId: 'nullisland', suburb: undefined, postcode: undefined, latitude: 0, longitude: 0 }),
    ]);
    expect(result.unclustered.map((s) => s.siteId)).toEqual(['nullisland']);
  });
});

describe('placing work inside its tolerance window', () => {
  it('lands near the middle of the window rather than on the due date', () => {
    // The whole reason tolerance exists. A visit booked on the last day of its
    // window breaches the moment anything goes wrong; one in the middle has
    // days of give either side.
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-10-06', latest: '2026-10-16' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    const [visit] = visitFor(plan, 'a');
    expect(visit).toBeDefined();
    expect(visit!.date >= '2026-10-08').toBe(true);
    expect(visit!.date <= '2026-10-14').toBe(true);
    expect(Math.abs(visit!.daysFromPreferred)).toBeLessThanOrEqual(2);
    expect(visit!.daysOfMargin).toBeGreaterThan(0);
  });

  it('clips the window to the month being planned', () => {
    // A yearly with a four month tolerance is schedulable in August; that does
    // not make August part of October's plan.
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-08-15', latest: '2026-12-15' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    const [visit] = visitFor(plan, 'a');
    expect(visit!.date >= '2026-10-01').toBe(true);
    expect(visit!.date <= '2026-10-31').toBe(true);
  });

  it('never plans a day that has already gone', () => {
    // Planning the current month mid-month. The first half is history.
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-09-01', latest: '2026-09-30' } })],
      [site({ siteId: 'a' })],
      options({ today: '2026-09-15', window: calendarMonthWindow('2026-09-15')! }),
    );
    const [visit] = visitFor(plan, 'a');
    expect(visit!.date >= '2026-09-15').toBe(true);
  });

  it('leaves out work whose window falls entirely outside the month', () => {
    // Not a failure and not a warning: it is simply not due yet, and reporting
    // it as unplannable would bury the things that are.
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-11-01', latest: '2027-01-31' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(allVisits(plan)).toHaveLength(0);
    expect(plan.unplanned).toHaveLength(0);
    expect(plan.summary.notDueInWindow).toBe(1);
  });
});

describe('overdue work goes first', () => {
  it('places an already-breached routine on the earliest working day, ahead of everything', () => {
    // It is late whatever happens. The only variable left is how late, and
    // locality does not get a vote on that.
    const plan = planWork(
      [
        routine({ siteId: 'late', state: 'overdue', window: { earliest: '2026-06-01', latest: '2026-08-31' } }),
        routine({ siteId: 'ontime', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
      ],
      [site({ siteId: 'late' }), site({ siteId: 'ontime' })],
      options(),
    );
    const late = visitFor(plan, 'late')[0]!;
    expect(late.urgent).toBe(true);
    expect(late.date).toBe('2026-10-01');
    expect(late.daysOfMargin).toBeLessThan(0);
  });

  it('does not write off a job whose window closes on the first day it can be done', () => {
    /*
     * The plan runs 1–31 October. A routine whose tolerance closes on the 1st
     * can still be done on the 1st, in tolerance — and telling a planner it is
     * "late whatever happens" is telling them not to bother saving something
     * that can be saved.
     *
     * A day earlier and it genuinely cannot: the window shut before the month
     * opened, and the only variable left is how late.
     */
    const closesOnTheFirstDay = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-09-01', latest: '2026-10-01' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    const saveable = visitFor(closesOnTheFirstDay, 'a')[0]!;
    expect(saveable.urgent).toBe(false);
    expect(saveable.daysOfMargin).toBeGreaterThanOrEqual(0);

    const closedTheDayBefore = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-09-01', latest: '2026-09-30' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(visitFor(closedTheDayBefore, 'a')[0]!.urgent).toBe(true);
  });

  it('plans a routine whose window opens on the last day being planned', () => {
    /*
     * A window opening on the final day of the plan is due inside it, and
     * dropping it as "not due" loses the job silently — nothing is left to say
     * it was ever considered.
     *
     * The window ends on Friday 30 October rather than the 31st, because the
     * 31st is a Saturday and there would be no working day to place it on: a
     * correct absence that would make this test pass for the wrong reason.
     */
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-10-30', latest: '2026-12-31' } })],
      [site({ siteId: 'a' })],
      options({ window: { from: '2026-10-01', to: '2026-10-30', label: 'October 2026' } }),
    );
    expect(visitFor(plan, 'a').map((v) => v.date)).toEqual(['2026-10-30']);
  });

  it('takes the day off an on-time job when the day is only big enough for one', () => {
    // Fifty detectors is most of a day each, so only one of these fits. The
    // overdue one must get the first day even though the other was equally
    // schedulable on it.
    const plan = planWork(
      [
        routine({ siteId: 'ontime', window: { earliest: '2026-10-01', latest: '2026-10-02' } }),
        routine({ siteId: 'late', state: 'overdue', window: { earliest: '2026-05-01', latest: '2026-07-31' } }),
      ],
      [
        site({ siteId: 'ontime', assetCounts: [{ system: 'detection', count: 50 }] }),
        site({ siteId: 'late', assetCounts: [{ system: 'detection', count: 50 }] }),
      ],
      options({ hoursPerDay: 7.5 }),
    );
    expect(visitFor(plan, 'late')[0]!.date).toBe('2026-10-01');
    expect(visitFor(plan, 'ontime')[0]!.date).toBe('2026-10-02');
  });

  it('says how many days late a breached routine actually landed, when it was not the first day', () => {
    // A site is attended once. An overdue monthly at a site whose annual cannot
    // start until the 20th is done on the 20th — one drive instead of two — and
    // that is the right trade. What is not right is a plan that then says
    // overdue work "goes first" and leaves the extra fortnight unsaid.
    const plan = planWork(
      [
        routine({
          siteId: 'a', routineId: 'det-monthly', frequency: 'monthly', state: 'overdue',
          window: { earliest: '2026-06-01', latest: '2026-08-31' },
        }),
        routine({ siteId: 'a', routineId: 'det-annual', window: { earliest: '2026-10-20', latest: '2026-10-30' } }),
      ],
      [site({ siteId: 'a' })],
      options(),
    );
    const visits = visitFor(plan, 'a');
    expect(visits).toHaveLength(1);
    expect(visits[0]!.urgent).toBe(true);
    expect(visits[0]!.date).toBe('2026-10-20');
    // Thirteen working... no: whole days from 1 October, which is what the
    // office counts a breach in.
    expect(visits[0]!.daysAfterEarliest).toBe(19);
    expect(plan.notes.some((n) => /later than the first workable day/i.test(n))).toBe(true);
  });

  it('reports no delay at all on a breached routine that did get the first day', () => {
    // The counterpart, so the field above cannot quietly become "always zero"
    // or "always something".
    const plan = planWork(
      [routine({ siteId: 'a', state: 'overdue', window: { earliest: '2026-06-01', latest: '2026-08-31' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(visitFor(plan, 'a')[0]!.daysAfterEarliest).toBe(0);
    expect(plan.notes.some((n) => /later than the first workable day/i.test(n))).toBe(false);
  });

  it('does the most overdue first when several have breached', () => {
    const plan = planWork(
      [
        routine({ siteId: 'aug', state: 'overdue', window: { earliest: '2026-06-01', latest: '2026-08-31' } }),
        routine({ siteId: 'jun', state: 'overdue', window: { earliest: '2026-04-01', latest: '2026-06-30' } }),
      ],
      [
        site({ siteId: 'aug', assetCounts: [{ system: 'detection', count: 50 }] }),
        site({ siteId: 'jun', assetCounts: [{ system: 'detection', count: 50 }] }),
      ],
      options(),
    );
    expect(visitFor(plan, 'jun')[0]!.date).toBe('2026-10-01');
    expect(visitFor(plan, 'aug')[0]!.date).toBe('2026-10-02');
  });
});

describe('balancing the days', () => {
  it('spreads work rather than stacking one impossible day', () => {
    // Twelve visits of under three hours against a seven and a half hour day.
    // No technician may go over the day, and no site may be split across two.
    const routines = Array.from({ length: 12 }, (_, i) => routine({
      siteId: `s${i}`,
      window: { earliest: '2026-10-01', latest: '2026-10-31' },
    }));
    const sites = Array.from({ length: 12 }, (_, i) => site({
      siteId: `s${i}`,
      assetCounts: [{ system: 'detection', count: 10 }],
    }));
    const plan = planWork(routines, sites, options());

    for (const day of plan.days) {
      for (const tech of day.technicians) {
        expect(tech.hours).toBeLessThanOrEqual(tech.capacityHours);
      }
    }
    expect(allVisits(plan)).toHaveLength(12);
    expect(plan.unplanned).toHaveLength(0);
  });

  it('never splits a site across two days', () => {
    // Half a fire panel on Tuesday and half on Thursday is not a service; it
    // is two attendances and two records.
    const routines = [
      routine({ siteId: 'big', routineId: 'det-annual', system: 'detection' }),
      routine({ siteId: 'big', routineId: 'ext-annual', system: 'extinguisher', routineLabel: 'Extinguishers — annual' }),
    ];
    const plan = planWork(
      routines,
      [site({ siteId: 'big', assetCounts: [{ system: 'detection', count: 20 }, { system: 'extinguisher', count: 20 }] })],
      options(),
    );
    const visits = visitFor(plan, 'big');
    expect(visits).toHaveLength(1);
    expect(visits[0]!.routines).toHaveLength(2);
  });

  it('needs two visits when two routines at one site have no overlapping window', () => {
    // Forcing them into one day would breach the tighter of the two, so the
    // site legitimately gets two attendances and the plan says so.
    const plan = planWork(
      [
        routine({ siteId: 'a', routineId: 'det-monthly', frequency: 'monthly', window: { earliest: '2026-10-01', latest: '2026-10-07' } }),
        routine({ siteId: 'a', routineId: 'det-annual', window: { earliest: '2026-10-20', latest: '2026-10-31' } }),
      ],
      [site({ siteId: 'a' })],
      options(),
    );
    const visits = visitFor(plan, 'a');
    expect(visits).toHaveLength(2);
    expect(visits[0]!.date < visits[1]!.date).toBe(true);
  });

  it('books the tightest window first so it does not find the month already full', () => {
    // A monthly carries days of tolerance and a yearly carries months. Booking
    // in any order that ignores that — alphabetical, by due date, by site —
    // fills the only day the monthly had with work that could have gone
    // anywhere, and the monthly is the one that breaches.
    //
    // The tight routine here deliberately closes LATER than the loose ones. An
    // ordering by closing date alone gets the earlier fixture right by accident
    // and this one wrong, which is the point of arranging it this way: the rule
    // being proved is "least room to move first", not "earliest deadline first".
    const tight = routine({
      siteId: 'tight',
      routineId: 'det-monthly',
      frequency: 'monthly',
      // Friday the 30th is the only working day in it; the 31st is a Saturday.
      window: { earliest: '2026-10-30', latest: '2026-10-31' },
    });
    const loose = Array.from({ length: 5 }, (_, i) => routine({
      siteId: `loose${i}`,
      window: { earliest: '2026-10-26', latest: '2026-10-30' },
    }));
    const sites = ['tight', ...loose.map((r) => r.siteId)].map((siteId) => site({
      siteId,
      // Most of a day each, so the last week of the month holds one visit a day.
      assetCounts: [{ system: 'detection', count: 50 }],
    }));

    const plan = planWork([...loose, tight], sites, options());

    // The one with nowhere else to go got its day.
    expect(visitFor(plan, 'tight')[0]?.date).toBe('2026-10-30');
    // And the work that gave way is work that had four other days to choose
    // from, reported by name rather than dropped.
    expect(plan.unplanned).toHaveLength(1);
    expect(plan.unplanned[0]!.reason).toBe('no-capacity');
    expect(plan.unplanned[0]!.siteId).toMatch(/^loose/);
  });

  it('shares a day between technicians instead of overloading one', () => {
    // Two techs, two five-hour visits that must both happen on the same day.
    const plan = planWork(
      [
        routine({ siteId: 'a', window: { earliest: '2026-10-01', latest: '2026-10-01' } }),
        routine({ siteId: 'b', window: { earliest: '2026-10-01', latest: '2026-10-01' } }),
      ],
      [
        site({ siteId: 'a', assetCounts: [{ system: 'detection', count: 40 }] }),
        site({ siteId: 'b', assetCounts: [{ system: 'detection', count: 40 }] }),
      ],
      options({ technicians: 2 }),
    );
    const day = plan.days.find((d) => d.date === '2026-10-01')!;
    expect(day.visitCount).toBe(2);
    expect(day.technicians.filter((t) => t.visits.length === 1)).toHaveLength(2);
  });

  it('reports the load on every day, including the empty ones', () => {
    // A month with three quiet Fridays in it is exactly what the office wants
    // to see, and a list of only the busy days hides it.
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-10-01', latest: '2026-10-01' } })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(plan.days).toHaveLength(22);
    const first = plan.days[0]!;
    expect(first.hours).toBeGreaterThan(0);
    expect(first.utilisation).toBeGreaterThan(0);
    expect(plan.days.filter((d) => d.visitCount === 0)).toHaveLength(21);
    expect(plan.days.every((d) => d.capacityHours === 7.5)).toBe(true);
  });

  it('honours a public holiday it was given', () => {
    const plan = planWork(
      [routine({ siteId: 'a', window: { earliest: '2026-10-05', latest: '2026-10-05' } })],
      [site({ siteId: 'a' })],
      options({ holidays: ['2026-10-05'] }),
    );
    // The only day it could have been done is not a working day, so it is
    // reported rather than quietly moved outside its window.
    expect(allVisits(plan)).toHaveLength(0);
    expect(plan.unplanned[0]!.reason).toBe('no-working-day');
  });
});

describe('keeping a technician in one suburb', () => {
  it('pulls a site onto the day its suburb is already being worked', () => {
    // Two Springwood jobs whose windows both cover the month. They belong on
    // the same day; on separate days the second one is an hour of driving.
    const plan = planWork(
      [
        routine({ siteId: 'sw1', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
        routine({ siteId: 'sw2', window: { earliest: '2026-10-05', latest: '2026-10-28' } }),
      ],
      [
        site({ siteId: 'sw1', suburb: 'Springwood', postcode: '4127', assetCounts: [{ system: 'detection', count: 20 }] }),
        site({ siteId: 'sw2', suburb: 'Springwood', postcode: '4127', assetCounts: [{ system: 'detection', count: 20 }] }),
      ],
      options(),
    );
    const [a] = visitFor(plan, 'sw1');
    const [b] = visitFor(plan, 'sw2');
    expect(a!.date).toBe(b!.date);
    expect(a!.clusterId).toBe(b!.clusterId);
  });

  it('keeps one technician on the suburb rather than splitting it between two', () => {
    const plan = planWork(
      [
        routine({ siteId: 'sw1', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
        routine({ siteId: 'sw2', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
      ],
      [
        site({ siteId: 'sw1', assetCounts: [{ system: 'detection', count: 10 }] }),
        site({ siteId: 'sw2', assetCounts: [{ system: 'detection', count: 10 }] }),
      ],
      options({ technicians: 2 }),
    );
    const visits = allVisits(plan);
    expect(new Set(visits.map((v) => v.date)).size).toBe(1);
    expect(new Set(visits.map((v) => v.technician)).size).toBe(1);
  });

  it('will not drag a visit across the month to join its suburb', () => {
    // Batching is worth driving for, not worth spending three weeks of
    // tolerance margin on.
    const plan = planWork(
      [
        routine({ siteId: 'early', window: { earliest: '2026-10-01', latest: '2026-10-02' } }),
        routine({ siteId: 'late', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
      ],
      [
        site({ siteId: 'early', assetCounts: [{ system: 'detection', count: 10 }] }),
        site({ siteId: 'late', assetCounts: [{ system: 'detection', count: 10 }] }),
      ],
      options({ clusterPullDays: 2 }),
    );
    const early = visitFor(plan, 'early')[0]!;
    const late = visitFor(plan, 'late')[0]!;
    expect(early.date).not.toBe(late.date);
    // The second one sat near the middle of its own window instead.
    expect(Math.abs(late.daysFromPreferred)).toBeLessThanOrEqual(2);
  });

  it('reports which method grouped each cluster, because the two are not equal', () => {
    const plan = planWork(
      [
        routine({ siteId: 'suburb', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
        routine({ siteId: 'coords', window: { earliest: '2026-10-01', latest: '2026-10-31' } }),
      ],
      [
        site({ siteId: 'suburb' }),
        site({ siteId: 'coords', suburb: undefined, postcode: undefined, latitude: -27.4678, longitude: 153.0281 }),
      ],
      options(),
    );
    expect(plan.summary.clusteredByLocality).toBe(1);
    expect(plan.summary.clusteredByProximity).toBe(1);
    expect(visitFor(plan, 'coords')[0]!.clusterMethod).toBe('proximity');
    expect(plan.notes.some((n) => /straight-line distance is not driving distance/i.test(n))).toBe(true);
  });
});

describe('what could not be planned, and why', () => {
  it('reports a frequency with no schedule table behind it', () => {
    // A quarterly is a Safe QLD interval with no Section 6 table; giving it a
    // yearly tolerance would assert a compliance it has no basis for.
    const plan = planWork(
      [routine({ siteId: 'a', frequency: 'quarterly', state: 'not-scheduled', window: undefined, scheduledFor: undefined })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(plan.unplanned[0]!.reason).toBe('no-schedule-table');
    expect(plan.unplanned[0]!.detail).toMatch(/no schedule table/i);
  });

  it('reports a routine that has never been recorded, because there is no anchor', () => {
    // The schedule counts from the first service. Without one there is no
    // date to count from, and inventing an anniversary would be a fiction the
    // whole compliance chain then rests on.
    const plan = planWork(
      [routine({ siteId: 'a', state: 'never-done', window: undefined, scheduledFor: undefined })],
      [site({ siteId: 'a' })],
      options(),
    );
    expect(plan.unplanned[0]!.reason).toBe('never-recorded');
  });

  it('reports a site with no locality and no coordinates', () => {
    const plan = planWork(
      [routine({ siteId: 'a' })],
      [site({ siteId: 'a', siteName: 'Unit 4 somewhere', suburb: undefined, postcode: undefined })],
      options(),
    );
    expect(plan.unplanned[0]!.reason).toBe('no-locality-or-position');
    expect(plan.unplanned[0]!.detail).toMatch(/Unit 4 somewhere/);
  });

  it('reports a site with no asset register instead of estimating one', () => {
    const plan = planWork(
      [routine({ siteId: 'a' })],
      [site({ siteId: 'a', assetCounts: undefined })],
      options(),
    );
    expect(allVisits(plan)).toHaveLength(0);
    expect(plan.unplanned[0]!.reason).toBe('no-asset-estimate');
  });

  it('reports work against a site it was never given', () => {
    const plan = planWork([routine({ siteId: 'ghost' })], [], options());
    expect(plan.unplanned[0]!.reason).toBe('unknown-site');
  });

  it('reports a site that cannot fit in one working day rather than splitting it', () => {
    // A thousand detectors is a hundred hours. That is a project with a plan
    // of its own, and a planner that quietly halved it would be lying twice.
    const plan = planWork(
      [routine({ siteId: 'huge' })],
      [site({ siteId: 'huge', assetCounts: [{ system: 'detection', count: 1000 }] })],
      options(),
    );
    expect(plan.unplanned[0]!.reason).toBe('larger-than-a-day');
    expect(plan.unplanned[0]!.detail).toMatch(/crewed or broken up/);
  });

  it('reports what did not fit when the month runs out of capacity', () => {
    // Ten visits of nearly a day each, all of which must happen inside the
    // three working days between the first and the fifth.
    const routines = Array.from({ length: 10 }, (_, i) => routine({
      siteId: `s${i}`,
      window: { earliest: '2026-10-01', latest: '2026-10-05' },
    }));
    const sites = Array.from({ length: 10 }, (_, i) => site({
      siteId: `s${i}`,
      assetCounts: [{ system: 'detection', count: 50 }],
    }));
    const plan = planWork(routines, sites, options());
    expect(plan.unplanned.length).toBeGreaterThan(0);
    expect(plan.unplanned.every((u) => u.reason === 'no-capacity')).toBe(true);
    expect(plan.unplanned[0]!.detail).toMatch(/Add a technician/);
    // And what did fit is still a usable plan, not an empty one.
    expect(allVisits(plan).length).toBeGreaterThan(0);
  });

  it('plans nothing and says why when there are no technicians', () => {
    const plan = planWork([routine({ siteId: 'a' })], [site({ siteId: 'a' })], options({ technicians: 0 }));
    expect(allVisits(plan)).toHaveLength(0);
    expect(plan.unplanned[0]!.reason).toBe('no-capacity');
    expect(plan.notes.some((n) => /No technicians were given/.test(n))).toBe(true);
  });

  it('refuses to plan from a date it cannot read', () => {
    const plan = planWork([routine({ siteId: 'a' })], [site({ siteId: 'a' })], { today: 'yesterday' });
    expect(plan.days).toHaveLength(0);
    expect(plan.notes[0]).toMatch(/not a date/);
  });
});

describe('the plan as a whole', () => {
  it('adds up to what it placed', () => {
    const plan = planWork(
      [
        routine({ siteId: 'a' }),
        routine({ siteId: 'b' }),
        routine({ siteId: 'b', routineId: 'ext-annual', system: 'extinguisher' }),
      ],
      [site({ siteId: 'a' }), site({ siteId: 'b' })],
      options(),
    );
    const visits = allVisits(plan);
    expect(plan.summary.visits).toBe(visits.length);
    expect(plan.summary.sites).toBe(2);
    expect(plan.summary.routines).toBe(3);
    expect(plan.summary.estimatedHours).toBeCloseTo(
      visits.reduce((sum, v) => sum + v.hours.hours, 0), 2,
    );
    expect(plan.summary.capacityHours).toBe(22 * 7.5);
  });

  it('leads with the estimate caveat every time', () => {
    // Wherever the plan goes — a screen, a printout, an email to a client —
    // the hours travel with the sentence that says what they are.
    const plan = planWork([routine({ siteId: 'a' })], [site({ siteId: 'a' })], options());
    expect(plan.notes[0]).toBe(ESTIMATE_CAVEAT);
  });

  it('warns that no public holidays were supplied', () => {
    const plan = planWork([routine({ siteId: 'a' })], [site({ siteId: 'a' })], options());
    expect(plan.notes.some((n) => /No public holidays were supplied/.test(n))).toBe(true);
  });

  it('is stable: the same inputs produce the same plan twice', () => {
    // A plan that reshuffles itself on every refresh cannot be checked against
    // the one somebody printed yesterday.
    const routines = Array.from({ length: 8 }, (_, i) => routine({ siteId: `s${i}` }));
    const sites = Array.from({ length: 8 }, (_, i) => site({
      siteId: `s${i}`,
      suburb: i % 2 ? 'Chermside' : 'Springwood',
      postcode: i % 2 ? '4032' : '4127',
    }));
    const first = planWork(routines, sites, options({ technicians: 2 }));
    const second = planWork(routines, sites, options({ technicians: 2 }));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('writes hours the way a run sheet reads them', () => {
    expect(formatHours(3.5)).toBe('3.5 h');
    expect(formatHours(3.25)).toBe('3.25 h');
    expect(formatHours(2)).toBe('2 h');
    expect(formatHours(0.75)).toBe('45 min');
    expect(formatHours(Number.NaN)).toBe('—');
  });
});
