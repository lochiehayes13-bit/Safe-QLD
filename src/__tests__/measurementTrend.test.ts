import {
  MEASUREMENT_KINDS,
  MINIMUM_POINTS,
  PROJECTION_ASSUMPTION,
  formatAuDate,
  formatAuMonth,
  kindForKey,
  parseMeasurement,
  projectToThreshold,
  rankDeterioration,
  seriesFromEvents,
  trendHeadline,
  trendMeasurements,
  type MeasurementPoint,
  type MeasurementSeries,
} from '@/domain/measurementTrend';

/**
 * Trending a measurement across an asset's life.
 *
 * The failure this guards against is a confident wrong trend. A single reading
 * is a pass or a fail and nobody over-reads it; a rate of decline gets believed,
 * quoted to a client, and turned into a replacement that was never needed —
 * or, worse, into a reassurance about a hydrant that had a valve shut on it in
 * 2024. So most of what is asserted here is a refusal: units that must not be
 * combined, a series too short to fit, a step that must not be reported as
 * wear, and a projection that must come out as a range wide enough to be
 * honest about three readings.
 *
 * Dates are yearly services, because that is what the data looks like: four
 * numbers, four years apart, and a decision to make from them.
 */

const HYDRANT = 'Residual pressure';

/** A yearly service series starting 1 March 2020, in the given unit. */
function yearly(values: number[], unit = 'kPa', startYear = 2020): MeasurementPoint[] {
  return values.map((value, i) => ({ at: `${startYear + i}-03-01`, value, unit }));
}

function series(over: Partial<MeasurementSeries> & { points: MeasurementPoint[] }): MeasurementSeries {
  return { assetId: 'hyd-1', assetName: 'Hydrant 1 — carpark', key: HYDRANT, ...over };
}

describe('parseMeasurement', () => {
  it('reads a plain number and a number with its unit', () => {
    expect(parseMeasurement(412)).toEqual({ ok: true, value: 412 });
    expect(parseMeasurement('412 kPa')).toEqual({ ok: true, value: 412, unit: 'kPa' });
    expect(parseMeasurement('26.4V')).toEqual({ ok: true, value: 26.4, unit: 'V' });
  });

  it('strips a thousands separator but refuses a comma that could be a decimal point', () => {
    // 1,200 kPa is a booster reading; 1,2 is either 1.2 or twelve hundred and
    // the difference is a factor of a thousand.
    expect(parseMeasurement('1,200 kPa')).toEqual({ ok: true, value: 1200, unit: 'kPa' });
    expect(parseMeasurement('1,2')).toMatchObject({ ok: false });
  });

  it('refuses a censored reading rather than trending the number beside the sign', () => {
    // ">600" means the gauge ran out, not that the pressure was 600. Trending
    // 600 flattens a curve that may be steep.
    expect(parseMeasurement('>600 kPa')).toMatchObject({ ok: false });
    expect(parseMeasurement('<200')).toMatchObject({ ok: false });
    expect(parseMeasurement('approx 450')).toMatchObject({ ok: false });
  });

  it('refuses a range, because two readings are not one reading', () => {
    expect(parseMeasurement('400-420')).toMatchObject({ ok: false });
  });

  it('refuses a verdict written where a measurement belongs', () => {
    expect(parseMeasurement('pass')).toMatchObject({ ok: false });
    expect(parseMeasurement('N/A')).toMatchObject({ ok: false });
    expect(parseMeasurement('')).toMatchObject({ ok: false });
  });

  it('says why it refused, so the reading can be corrected on site', () => {
    const parsed = parseMeasurement('>600 kPa');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/limit or an approximation/);
  });
});

describe('dates', () => {
  it('formats Australian, never American', () => {
    // 4 March, not 3 April. This has been the difference between an in-window
    // service and an out-of-window one on other screens in this app.
    expect(formatAuDate('2026-03-04')).toBe('4/3/2026');
    expect(formatAuDate('2026-03-04T09:15:00Z')).toBe('4/3/2026');
    expect(formatAuMonth('2028-11-04')).toBe('November 2028');
  });
});

describe('trendMeasurements — refusing what cannot be trended', () => {
  it('refuses two readings, because two points always fit a line perfectly', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 620]) }));
    expect(trend.status).toBe('insufficient');
    expect(trend.ratePerYear).toBeUndefined();
    expect(trend.confidence).toBe('low');
    expect(trend.refusal).toMatch(/straight line perfectly/);
  });

  it("never lets a two-point series produce a confident trend by any route", () => {
    // Whatever the numbers do, two services is a difference and not a rate.
    for (const values of [[700, 300], [700, 700], [300, 700], [26.4, 21.2]]) {
      const trend = trendMeasurements(series({ points: yearly(values) }));
      expect(trend.status).toBe('insufficient');
      expect(trend.direction).toBeUndefined();
      expect(trend.significant).toBeUndefined();
      expect(trend.confidence).toBe('low');
      expect(trendHeadline(trend)).toMatch(/straight line perfectly/);
    }
  });

  it('states the minimum it needs rather than fitting anyway', () => {
    const trend = trendMeasurements(series({ points: yearly([700]) }));
    expect(trend.status).toBe('insufficient');
    expect(trend.refusal).toContain(String(MINIMUM_POINTS));
  });

  it('refuses readings in units that are not the same quantity, and names both', () => {
    // A volts reading filed under a pressure key is a data entry error, and
    // averaging it in produces a plausible number from nonsense.
    const trend = trendMeasurements(series({
      points: [
        { at: '2020-03-01', value: 700, unit: 'kPa' },
        { at: '2021-03-01', value: 690, unit: 'kPa' },
        { at: '2022-03-01', value: 26.4, unit: 'V' },
      ],
    }));
    expect(trend.status).toBe('mixed-units');
    expect(trend.refusal).toContain('kPa');
    expect(trend.refusal).toContain('V');
    expect(trend.ratePerYear).toBeUndefined();
  });

  it('converts readings that ARE the same quantity, and says that it did', () => {
    // A gauge in bar is still a pressure. Converting is right; converting
    // silently is not, because the two gauges may not have agreed.
    const trend = trendMeasurements(series({
      points: [
        { at: '2020-03-01', value: 700, unit: 'kPa' },
        { at: '2021-03-01', value: 6.6, unit: 'bar' },
        { at: '2022-03-01', value: 620, unit: 'kPa' },
      ],
    }));
    expect(trend.status).toBe('trend');
    expect(trend.unit).toBe('kPa');
    expect(trend.used[1]!.value).toBeCloseTo(660, 0);
    expect(trend.conversions).toEqual([{ from: 'bar', to: 'kPa', count: 1 }]);
    expect(trend.cautions.map((c) => c.code)).toContain('unit-converted');
  });

  it('refuses a key that holds two different quantities when nothing separates them', () => {
    // "Gauge reading or mass" is a real key in this app's routine table: a
    // gauged extinguisher gives kPa and a CO2 one gives kg. Trending both
    // together is arithmetic, not engineering.
    const trend = trendMeasurements(series({
      key: 'Gauge reading or mass',
      points: [
        { at: '2020-03-01', value: 1400 },
        { at: '2021-03-01', value: 1380 },
        { at: '2022-03-01', value: 6.2 },
      ],
    }));
    expect(trend.status).toBe('ambiguous-key');
    expect(trend.refusal).toMatch(/two different quantities|CO₂/);
  });

  it('trends that same key once every reading says which quantity it is', () => {
    const trend = trendMeasurements(series({
      key: 'Gauge reading or mass',
      points: yearly([6.4, 6.3, 6.2], 'kg'),
    }));
    expect(trend.status).toBe('trend');
    expect(trend.unit).toBe('kg');
  });

  it('refuses to trend through a date on which the key changed meaning', () => {
    // The measurement was re-defined from "time to first alarm" to "time to
    // evacuation tone". Same key, different stopwatch.
    const trend = trendMeasurements(
      series({ key: 'Time to alarm', points: yearly([12, 13, 41, 42], 's') }),
      { keyChanges: [{ at: '2022-01-01', what: 'Timed to the evacuation tone rather than the first alarm.' }] },
    );
    expect(trend.status).toBe('key-redefined');
    expect(trend.refusal).toContain('1/1/2022');
    // Two readings sit after the change, which is one short of a trend of
    // their own, and the refusal says so rather than leaving a blank screen.
    expect(trend.refusal).toMatch(/2 readings sit after the change/);
    expect(trend.continuation).toBeUndefined();
  });

  it('offers the post-change readings as a trend once there are enough of them', () => {
    const trend = trendMeasurements(
      series({ key: 'Time to alarm', points: yearly([12, 13, 41, 43, 46], 's') }),
      { keyChanges: [{ at: '2022-01-01', what: 'Timed to the evacuation tone.' }] },
    );
    expect(trend.status).toBe('key-redefined');
    expect(trend.continuation?.status).toBe('trend');
    expect(trend.continuation?.used).toHaveLength(3);
  });

  it('refuses a set of readings all taken on one day', () => {
    // Three readings at one service are repeats of one measurement. Their
    // spread is worth knowing; their "trend" is meaningless.
    const trend = trendMeasurements(series({
      points: [
        { at: '2024-03-01T08:00:00Z', value: 700, unit: 'kPa' },
        { at: '2024-03-01T08:10:00Z', value: 690, unit: 'kPa' },
        { at: '2024-03-01T08:20:00Z', value: 695, unit: 'kPa' },
      ],
    }));
    expect(trend.status).toBe('no-time-span');
  });

  it('drops a reading whose date cannot be read, and says which and why', () => {
    const trend = trendMeasurements(series({
      points: [
        ...yearly([700, 665, 630]),
        { at: '1/3/2023', value: 600, unit: 'kPa' },
      ],
    }));
    expect(trend.status).toBe('trend');
    expect(trend.used).toHaveLength(3);
    expect(trend.excluded[0]!.reason).toMatch(/not a date/);
    expect(trend.cautions.map((c) => c.code)).toContain('excluded-readings');
  });

  it('trends without a unit but refuses to compare the result with a threshold', () => {
    // Bare numbers can still rise or fall. They cannot be measured against
    // 350 kPa, because nothing says they are pressures at all.
    const trend = trendMeasurements(series({
      points: [
        { at: '2020-03-01', value: 700 },
        { at: '2021-03-01', value: 665 },
        { at: '2022-03-01', value: 630 },
      ],
    }));
    expect(trend.status).toBe('trend');
    expect(trend.unit).toBeUndefined();
    expect(trend.cautions.map((c) => c.code)).toContain('unit-unstated');

    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' });
    expect(projection.status).toBe('unknown');
    expect(projection.reason).toMatch(/no unit/);
  });
});

describe('trendMeasurements — the trend itself', () => {
  it('reports a falling hydrant as deteriorating, with a rate per year', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    expect(trend.status).toBe('trend');
    expect(trend.direction).toBe('falling');
    expect(trend.shape).toBe('drift');
    expect(trend.ratePerYear).toBeCloseTo(-35, 0);
    expect(trend.ratePercentPerYear).toBeCloseTo(-5, 1);
    expect(trend.changePercent).toBeCloseTo(-15, 1);
    expect(trend.interpretation).toBe('deteriorating');
  });

  it('knows that rising impedance is the bad direction and rising pressure is not', () => {
    // Direction alone is meaningless: up is failure on one key and recovery on
    // another. Getting this backwards puts healthy assets on a work plan.
    const rising = trendMeasurements(series({ key: 'Circuit impedance', points: yearly([40, 44, 48], 'Ω') }));
    expect(rising.interpretation).toBe('deteriorating');

    const recovering = trendMeasurements(series({ points: yearly([630, 665, 700]) }));
    expect(recovering.direction).toBe('rising');
    expect(recovering.interpretation).toBe('improving');
  });

  it('refuses to judge a measurement it does not recognise', () => {
    const trend = trendMeasurements(series({ key: 'Widget wobble', points: yearly([10, 12, 14], 'mm') }));
    expect(trend.status).toBe('trend');
    expect(trend.direction).toBe('rising');
    expect(trend.interpretation).toBe('unknown');
    expect(trend.cautions.map((c) => c.code)).toContain('unknown-key');
  });

  it('takes the caller’s word for the bad direction where it has no opinion', () => {
    const trend = trendMeasurements(series({
      key: 'Widget wobble', points: yearly([10, 12, 14], 'mm'), deterioration: 'rising',
    }));
    expect(trend.interpretation).toBe('deteriorating');
  });

  it('calls a barely moving series steady rather than inventing a direction', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 699, 698, 697]) }));
    expect(trend.direction).toBe('flat');
    expect(trend.interpretation).toBe('stable');
  });

  it('warns that identical readings may be a test that stops at its target', () => {
    // Emergency light discharge tests are stopped at the required duration, so
    // a run of 90s means "reached 90" and not "has exactly 90 left".
    const trend = trendMeasurements(series({
      key: 'Duration achieved', points: yearly([90, 90, 90, 90], 'min'),
    }));
    expect(trend.direction).toBe('flat');
    expect(trend.cautions.map((c) => c.code)).toContain('no-variation');
    expect(trend.cautions.find((c) => c.code === 'no-variation')!.message).toMatch(/switched off/);
  });

  it('marks a series shorter than a year as possibly seasonal, with a source', () => {
    // SEQ mains demand swings with the weather, so four readings across one
    // summer are a season and not a decline.
    const trend = trendMeasurements(series({
      points: [
        { at: '2025-11-01', value: 700, unit: 'kPa' },
        { at: '2025-12-15', value: 680, unit: 'kPa' },
        { at: '2026-02-01', value: 655, unit: 'kPa' },
        { at: '2026-03-20', value: 640, unit: 'kPa' },
      ],
    }));
    expect(trend.status).toBe('trend');
    const seasonal = trend.cautions.find((c) => c.code === 'seasonal');
    expect(seasonal).toBeDefined();
    expect(seasonal!.message).toMatch(/less than a full year/);
    expect(seasonal!.provenance?.url).toMatch(/^https:\/\//);
    // Nothing spanning less than a year is ever more than low confidence.
    expect(trend.confidence).toBe('low');
  });

  it('carries the confounders for the measurement, each with where it came from', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    const confounders = trend.cautions.filter((c) => c.code === 'confounded');
    expect(confounders.length).toBeGreaterThan(0);
    for (const c of confounders) {
      expect(c.provenance?.source).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(c.provenance!.confidence);
    }
    // The utility's own guideline is the primary source for "the street can be
    // the cause", so it must be present and marked high confidence.
    const utility = confounders.find((c) => /Urban Utilities/.test(c.provenance!.source));
    expect(utility?.provenance?.confidence).toBe('high');
  });

  it('earns higher confidence only from a long, dense, well-behaved series', () => {
    const short = trendMeasurements(series({ points: yearly([700, 665, 630]) }));
    expect(short.confidence).toBe('low');

    const long = trendMeasurements(series({
      points: yearly([700, 688, 676, 665, 652, 640, 629]),
    }));
    expect(long.confidence).toBe('high');
  });
});

describe('trendMeasurements — a step is not a drift', () => {
  const STEPPED = [700, 695, 690, 420, 415];

  it('separates a sudden drop from gradual decline', () => {
    // A hydrant that lost 39% between two services had something done to it.
    // Reported as "13% a year" a technician goes looking for wear.
    const trend = trendMeasurements(series({ points: yearly(STEPPED) }));
    expect(trend.shape).toBe('step');
    expect(trend.step).toBeDefined();
    expect(trend.step!.from.value).toBe(690);
    expect(trend.step!.to.value).toBe(420);
    expect(Math.round(trend.step!.percent)).toBe(-39);
    expect(trend.step!.distinguishable).toBe(true);
    expect(trend.step!.message).toMatch(/event, not wear/);
    expect(trend.cautions.map((c) => c.code)).toContain('step');
  });

  it('does not call an evenly declining series a step', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    expect(trend.step).toBeUndefined();
    expect(trend.shape).toBe('drift');
  });

  it('says a step is explained when recorded work lines up with it', () => {
    const trend = trendMeasurements(
      series({ points: yearly(STEPPED) }),
      { interventions: [{ at: '2022-08-14', what: 'Ring main isolated for tenancy works; valve left part-shut' }] },
    );
    expect(trend.step!.explanation?.what).toMatch(/part-shut/);
    expect(trend.step!.message).toMatch(/step is explained/);
  });

  it('refuses to tell a step from a decline when it falls inside a long gap', () => {
    // Nobody was there for four years. A valve shut on day one and a steady
    // corrosion of the main produce exactly the same two readings, and no
    // arithmetic can separate them.
    const trend = trendMeasurements(series({
      points: [
        { at: '2019-03-01', value: 700, unit: 'kPa' },
        { at: '2020-03-01', value: 695, unit: 'kPa' },
        { at: '2021-03-01', value: 690, unit: 'kPa' },
        { at: '2025-03-01', value: 420, unit: 'kPa' },
        { at: '2026-03-01', value: 415, unit: 'kPa' },
      ],
    }));
    expect(trend.step!.distinguishable).toBe(false);
    expect(trend.shape).toBe('unclear');
    expect(trend.step!.message).toMatch(/look identical/);
    expect(trend.cautions.map((c) => c.code)).toContain('step-in-gap');
  });

  it('reports scattered readings as unclear rather than quoting a rate from them', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 500, 720, 480, 690, 520]) }));
    expect(trend.shape).toBe('unclear');
    expect(trend.cautions.map((c) => c.code)).toContain('scatter');
  });
});

describe('projectToThreshold', () => {
  const TODAY = '2023-03-01';

  it('gives a range and not a date, and says what it assumes', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });

    expect(projection.status).toBe('projected');
    expect(projection.earliest).toBeDefined();
    expect(projection.latest).toBeDefined();
    // A range, not a point: the two ends must actually differ.
    expect(Date.parse(projection.latest!)).toBeGreaterThan(Date.parse(projection.earliest!));
    expect(projection.label).toMatch(/^between /);
    expect(projection.assumption).toBe(PROJECTION_ASSUMPTION);
    expect(projection.assumption).toMatch(/when to look again, not as when it fails/);
  });

  it('never claims a week even when the readings fall exactly on a line', () => {
    // Four gauge readings landing on a perfect line is luck. Zero statistical
    // uncertainty would name a date, and a named date gets booked.
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    const spanDays = (Date.parse(projection.latest!) - Date.parse(projection.earliest!)) / 86_400_000;
    expect(spanDays).toBeGreaterThan(180);
  });

  it('refuses to bound the far end when three readings cannot rule out no decline at all', () => {
    // Three points give one degree of freedom. With any scatter at all the
    // 95% interval on the rate reaches past zero, so "never" is inside it.
    const trend = trendMeasurements(series({ points: yearly([700, 660, 630]) }));
    expect(trend.significant).toBe(false);
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: '2022-03-01' });
    expect(projection.status).toBe('projected');
    expect(projection.openEnded).toBe(true);
    expect(projection.latest).toBeUndefined();
    expect(projection.label).toMatch(/no later bound/);
  });

  it('reports an asset already past the threshold rather than projecting into the past', () => {
    const trend = trendMeasurements(series({ points: yearly([420, 390, 360, 340]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    expect(projection.status).toBe('crossed');
    expect(projection.label).toMatch(/Already at or past/);
  });

  it('says when an asset is moving away from the threshold, without promising it will not fail', () => {
    const trend = trendMeasurements(series({ points: yearly([600, 630, 660, 690]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    expect(projection.status).toBe('moving-away');
    expect(projection.earliest).toBeUndefined();
    expect(projection.cautions.some((c) => /not a guarantee/.test(c.message))).toBe(true);
  });

  it('will not project through a step, and says how many services would settle it', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 695, 690, 420, 415]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    expect(projection.status).toBe('unknown');
    expect(projection.reason).toMatch(/step change/);
    // Two readings sit after the step, so one more service settles it — and
    // saying which is the difference between a dead end and a plan.
    expect(projection.reason).toMatch(/1 more service will answer this/);
  });

  it('projects from the readings after a step once there are enough of them', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 695, 690, 420, 410, 400, 390]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: '2026-03-01' });
    expect(projection.status).toBe('projected');
    expect(projection.basedOn).toBe(4);
    expect(projection.cautions.some((c) => /since the step change/.test(c.message))).toBe(true);
  });

  it('refuses a threshold in a quantity the readings are not in', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    const projection = projectToThreshold(trend, { value: 24, unit: 'V' }, { today: TODAY });
    expect(projection.status).toBe('unknown');
    expect(projection.reason).toMatch(/cannot be compared/);
  });

  it('converts a threshold given in another unit of the same quantity', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 665, 630, 595]) }));
    const inKpa = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    const inBar = projectToThreshold(trend, { value: 3.5, unit: 'bar' }, { today: TODAY });
    expect(inBar.status).toBe('projected');
    expect(inBar.earliest).toBe(inKpa.earliest);
  });

  it('will not project a trend it refused to fit in the first place', () => {
    const trend = trendMeasurements(series({ points: yearly([700, 620]) }));
    const projection = projectToThreshold(trend, { value: 350, unit: 'kPa' }, { today: TODAY });
    expect(projection.status).toBe('unknown');
    expect(projection.reason).toMatch(/straight line perfectly/);
  });
});

describe('rankDeterioration', () => {
  const PORTFOLIO: MeasurementSeries[] = [
    { assetId: 'hyd-1', assetName: 'Hydrant 1', key: HYDRANT, points: yearly([700, 665, 630]) },
    { assetId: 'hyd-2', assetName: 'Hydrant 2', key: HYDRANT, points: yearly([700, 690, 680]) },
    {
      assetId: 'fip-1', assetName: 'FIP battery', key: 'Battery terminal voltage',
      points: yearly([27.4, 26.9, 26.4], 'V'),
    },
    { assetId: 'hyd-3', assetName: 'Hydrant 3', key: HYDRANT, points: yearly([630, 665, 700]) },
    { assetId: 'hyd-4', assetName: 'Hydrant 4', key: HYDRANT, points: yearly([700, 620]) },
    { assetId: 'wid-1', assetName: 'Widget', key: 'Widget wobble', points: yearly([10, 12, 14], 'mm') },
  ];

  it('puts the fastest-deteriorating asset first', () => {
    const ranking = rankDeterioration(PORTFOLIO);
    expect(ranking.ranked.map((r) => r.assetId)).toEqual(['hyd-1', 'fip-1', 'hyd-2']);
    expect(ranking.ranked[0]!.percentPerYear).toBeGreaterThan(ranking.ranked[1]!.percentPerYear);
  });

  it('ranks on percentage, so a battery and a hydrant can share a list', () => {
    // Ranking on absolute rate would put every hydrant losing kPa above every
    // battery losing volts, which orders the units and not the assets.
    const ranking = rankDeterioration(PORTFOLIO);
    const battery = ranking.ranked.find((r) => r.assetId === 'fip-1')!;
    const slowHydrant = ranking.ranked.find((r) => r.assetId === 'hyd-2')!;
    expect(Math.abs(battery.ratePerYear)).toBeLessThan(Math.abs(slowHydrant.ratePerYear));
    expect(battery.percentPerYear).toBeGreaterThan(slowHydrant.percentPerYear);
    expect(ranking.caveat).toMatch(/percentage of the first reading/);
  });

  it('keeps an improving asset off the work list without hiding it', () => {
    const ranking = rankDeterioration(PORTFOLIO);
    expect(ranking.ranked.map((r) => r.assetId)).not.toContain('hyd-3');
    expect(ranking.steady.map((r) => r.assetId)).toContain('hyd-3');
  });

  it('lists what it could not rank, each with its reason', () => {
    const ranking = rankDeterioration(PORTFOLIO);
    const reasons = Object.fromEntries(ranking.notRanked.map((n) => [n.assetId, n.reason]));
    expect(reasons['hyd-4']).toMatch(/straight line perfectly/);
    // An unknown key is not ranked at all: nothing establishes which way is bad.
    expect(reasons['wid-1']).toMatch(/which direction is deterioration/);
  });

  it('carries a projection on each row where the office holds a threshold', () => {
    const ranking = rankDeterioration(PORTFOLIO, {
      today: '2022-03-01',
      thresholds: { [HYDRANT]: { value: 350, unit: 'kPa', source: 'Design duty from the booster block plan' } },
    });
    const worst = ranking.ranked[0]!;
    expect(worst.projection?.status).toBe('projected');
    expect(worst.projection?.assumption).toBe(PROJECTION_ASSUMPTION);
    // A row with no threshold gets no invented one.
    expect(ranking.ranked.find((r) => r.assetId === 'fip-1')!.projection).toBeUndefined();
  });
});

describe('seriesFromEvents', () => {
  const EVENTS = [
    {
      id: 'e1', occurredAt: '2023-03-01', technician: 'LH',
      measurements: { 'Residual pressure': '700 kPa', Flow: '620 L/min' },
    },
    {
      id: 'e2', occurredAt: '2024-03-01', technician: 'LH',
      measurements: { 'Residual pressure': '665 kPa', Flow: '>1000 L/min' },
    },
    {
      id: 'e3', occurredAt: '2025-03-01', technician: 'LH',
      measurements: { 'Residual pressure': 630, Flow: 'n/a' },
    },
  ];

  it('groups a timeline into one series per measurement key', () => {
    const built = seriesFromEvents('hyd-1', EVENTS, { assetName: 'Hydrant 1' });
    expect(built.series.map((s) => s.key)).toEqual(['Flow', 'Residual pressure']);
    const pressure = built.series.find((s) => s.key === 'Residual pressure')!;
    expect(pressure.points).toHaveLength(3);
    expect(pressure.points[0]).toMatchObject({ value: 700, unit: 'kPa', eventId: 'e1' });
  });

  it('reports every reading it could not use instead of quietly dropping it', () => {
    // A series missing the two readings a technician wrote as ">1000" and
    // "n/a" trends beautifully and means nothing.
    const built = seriesFromEvents('hyd-1', EVENTS);
    expect(built.rejected).toHaveLength(2);
    expect(built.rejected.map((r) => r.at)).toEqual(['2024-03-01', '2025-03-01']);
    expect(built.rejected[0]!.reason).toMatch(/limit or an approximation/);
  });

  it('falls back to the routine’s own unit for a bare number, and only then', () => {
    const built = seriesFromEvents('hyd-1', EVENTS, { units: { 'Residual pressure': 'kPa' } });
    const pressure = built.series.find((s) => s.key === 'Residual pressure')!;
    expect(pressure.points[2]).toMatchObject({ value: 630, unit: 'kPa' });
  });
});

describe('the measurement catalogue', () => {
  it('matches the keys this app’s own routines record', () => {
    // These strings come from src/seed/serviceRoutines.ts. If a routine is
    // renamed and this table is not, the trend silently loses its meaning.
    expect(kindForKey('Residual pressure')?.id).toBe('residual-pressure');
    expect(kindForKey('Battery terminal voltage')?.id).toBe('battery-voltage');
    expect(kindForKey('Circuit impedance')?.deterioration).toBe('rising');
    expect(kindForKey('Duration achieved')?.deterioration).toBe('falling');
    expect(kindForKey('Gauge reading or mass')?.ambiguous).toBeTruthy();
  });

  it('does not guess at a key it has never seen', () => {
    expect(kindForKey('Widget wobble')).toBeUndefined();
    expect(kindForKey('')).toBeUndefined();
  });

  it('gives every second-hand fact a source and a confidence', () => {
    for (const kind of MEASUREMENT_KINDS) {
      for (const c of kind.confounders) {
        expect(c.source).toBeTruthy();
        expect(['low', 'medium', 'high']).toContain(c.confidence);
        // A published source must be citable; our own reasoning must not
        // pretend to be one.
        if (c.url) expect(c.url).toMatch(/^https:\/\//);
        else expect(c.source).toMatch(/[Oo]wn engineering reasoning/);
      }
    }
  });
});
