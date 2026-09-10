import {
  distanceKm, formatKm, hasPosition, planRoute, type RoutePoint, runCandidates} from '@/domain/routing';

/**
 * Route ordering.
 *
 * The distances are checked against known separations in South East
 * Queensland, so a wrong earth radius or a degrees/radians slip shows up as a
 * figure a technician would recognise as wrong rather than as a ratio.
 */

// Brisbane GPO, and places a technician would actually be sent.
const BRISBANE = { latitude: -27.4678, longitude: 153.0281 };
const GOLD_COAST = { latitude: -28.0167, longitude: 153.4000 };
const IPSWICH = { latitude: -27.6171, longitude: 152.7605 };
const TOOWOOMBA = { latitude: -27.5598, longitude: 151.9507 };

function point(id: string, pos?: { latitude: number; longitude: number }, priority?: RoutePoint['priority']): RoutePoint {
  return { id, label: id, ...pos, priority };
}

describe('distance', () => {
  it('is zero between a point and itself', () => {
    expect(distanceKm(BRISBANE, BRISBANE)).toBeCloseTo(0, 6);
  });

  it('matches the known separation Brisbane to the Gold Coast', () => {
    // About 70 km great-circle. A wrong earth radius or a missing
    // degrees-to-radians conversion misses this by orders of magnitude.
    expect(distanceKm(BRISBANE, GOLD_COAST)).toBeGreaterThan(66);
    expect(distanceKm(BRISBANE, GOLD_COAST)).toBeLessThan(74);
  });

  it('matches Brisbane to Ipswich', () => {
    // About 30 km.
    expect(distanceKm(BRISBANE, IPSWICH)).toBeGreaterThan(27);
    expect(distanceKm(BRISBANE, IPSWICH)).toBeLessThan(33);
  });

  it('is symmetric', () => {
    expect(distanceKm(BRISBANE, TOOWOOMBA)).toBeCloseTo(distanceKm(TOOWOOMBA, BRISBANE), 9);
  });

  it('stays accurate over a few hundred metres', () => {
    // Two points 0.001° of latitude apart — about 111 m. This is where the
    // spherical law of cosines loses precision and haversine does not.
    const a = { latitude: -27.4678, longitude: 153.0281 };
    const b = { latitude: -27.4688, longitude: 153.0281 };
    expect(distanceKm(a, b) * 1000).toBeGreaterThan(105);
    expect(distanceKm(a, b) * 1000).toBeLessThan(118);
  });
});

describe('what counts as a position', () => {
  it('accepts a real coordinate', () => {
    expect(hasPosition(point('a', BRISBANE))).toBe(true);
  });

  it('rejects a missing one', () => {
    expect(hasPosition(point('a'))).toBe(false);
    expect(hasPosition({ id: 'a', label: 'a', latitude: -27.4 })).toBe(false);
  });

  it('rejects null island, which is a missing coordinate not a site', () => {
    expect(hasPosition(point('a', { latitude: 0, longitude: 0 }))).toBe(false);
  });

  it('rejects an out-of-range or non-finite coordinate', () => {
    expect(hasPosition(point('a', { latitude: 91, longitude: 0 }))).toBe(false);
    expect(hasPosition(point('a', { latitude: 0, longitude: 181 }))).toBe(false);
    expect(hasPosition(point('a', { latitude: Number.NaN, longitude: 153 }))).toBe(false);
  });
});

describe('planning a run', () => {
  it('visits the nearest first from where the technician starts', () => {
    // Brisbane is 31 km from Ipswich, 71 from the Gold Coast, 107 from
    // Toowoomba — so Ipswich leads. From Ipswich the Gold Coast is 77 km
    // against Toowoomba's 80, so it comes next.
    //
    // That three-kilometre margin is exactly the limit this module admits to:
    // straight-line, nobody would actually drive Ipswich to the Gold Coast to
    // Toowoomba. The ordering is a starting point a technician can see the
    // reasoning behind, not a route to follow blindly.
    const route = planRoute(
      [point('coast', GOLD_COAST), point('ipswich', IPSWICH), point('toowoomba', TOOWOOMBA)],
      BRISBANE,
    );
    expect(route.stops.map((s) => s.point.id)).toEqual(['ipswich', 'coast', 'toowoomba']);
  });

  it('accumulates the running total across legs', () => {
    const route = planRoute([point('ipswich', IPSWICH), point('coast', GOLD_COAST)], BRISBANE);
    const [first, second] = route.stops;
    expect(first!.cumulativeKm).toBeCloseTo(first!.legKm, 6);
    expect(second!.cumulativeKm).toBeCloseTo(first!.legKm + second!.legKm, 6);
    expect(route.totalKm).toBeCloseTo(second!.cumulativeKm, 6);
  });

  it('puts urgent work first and never reorders it behind routine work', () => {
    // Toowoomba is by far the furthest, but it is the urgent one.
    const route = planRoute(
      [point('ipswich', IPSWICH), point('urgent', TOOWOOMBA, 'urgent'), point('coast', GOLD_COAST)],
      BRISBANE,
    );
    expect(route.stops[0]!.point.id).toBe('urgent');
  });

  it('orders urgent work among itself by proximity', () => {
    const route = planRoute(
      [point('far', GOLD_COAST, 'urgent'), point('near', IPSWICH, 'urgent')],
      BRISBANE,
    );
    expect(route.stops.map((s) => s.point.id)).toEqual(['near', 'far']);
  });

  it('separates jobs with no position rather than appending them as routed', () => {
    const route = planRoute([point('placed', IPSWICH), point('nowhere')], BRISBANE);
    expect(route.stops.map((s) => s.point.id)).toEqual(['placed']);
    expect(route.unplaceable.map((p) => p.id)).toEqual(['nowhere']);
  });

  it('still orders a run when the technician has no starting position', () => {
    const route = planRoute([point('a', GOLD_COAST), point('b', IPSWICH)]);
    expect(route.stops).toHaveLength(2);
    // First leg has nothing to measure from, so it contributes nothing.
    expect(route.stops[0]!.legKm).toBe(0);
    expect(route.stops[1]!.legKm).toBeGreaterThan(0);
  });

  it('handles an empty day without throwing', () => {
    const route = planRoute([], BRISBANE);
    expect(route).toEqual({ stops: [], unplaceable: [], totalKm: 0 });
  });

  it('visits every job exactly once', () => {
    const points = [
      point('a', BRISBANE), point('b', IPSWICH), point('c', GOLD_COAST),
      point('d', TOOWOOMBA, 'urgent'), point('e'),
    ];
    const route = planRoute(points, BRISBANE);
    const seen = [...route.stops.map((s) => s.point.id), ...route.unplaceable.map((p) => p.id)];
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('formatting', () => {
  it('uses metres below a kilometre', () => {
    expect(formatKm(0.4)).toBe('400 m');
  });

  it('keeps one decimal in the single digits and drops it above ten', () => {
    expect(formatKm(3.46)).toBe('3.5 km');
    expect(formatKm(31.4)).toBe('31 km');
  });

  it('refuses to render a nonsense distance as a number', () => {
    expect(formatKm(Number.NaN)).toBe('—');
    expect(formatKm(-1)).toBe('—');
  });
});

/**
 * Whose day the run is.
 *
 * It used to be everybody's. "Today's run" filtered the newest five hundred
 * job rows to those scheduled today and ordered them by distance from the
 * technician — so on a company with four technicians it presented three other
 * people's work as yours, sorted convincingly enough that nothing on the
 * screen suggested otherwise.
 */
describe("whose jobs are today's run", () => {
  const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : undefined);
  const TODAY = '2026-09-10';
  const job = (id: string, over: Partial<{ status: string; scheduledFor: string | null }> = {}) => ({
    id, status: 'scheduled', scheduledFor: `${TODAY}T00:00:00.000Z`, ...over,
  });

  it('takes only the jobs the office has this person booked on', () => {
    const jobs = [job('a'), job('b'), job('c')];
    const out = runCandidates(jobs, {
      scope: 'today', bookedToday: new Set(['b']), everyones: false, today: TODAY, dayOf,
    });
    expect(out.map((j) => j.id)).toEqual(['b']);
  });

  it('shows nothing rather than everything when this person is booked on nothing', () => {
    // The failure that matters: an empty booking list must not fall back to
    // the whole company's day, which is the bug this replaced.
    const jobs = [job('a'), job('b')];
    const out = runCandidates(jobs, {
      scope: 'today', bookedToday: new Set(), everyones: false, today: TODAY, dayOf,
    });
    expect(out).toEqual([]);
  });

  it('falls back to the job\'s own date only where the phone does not know whose it is', () => {
    const jobs = [job('a'), job('b', { scheduledFor: '2026-09-11T00:00:00.000Z' })];
    const out = runCandidates(jobs, {
      scope: 'today', bookedToday: new Set(), everyones: true, today: TODAY, dayOf,
    });
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  it('never puts a finished job on a run', () => {
    const jobs = [job('a', { status: 'complete' }), job('b')];
    for (const everyones of [true, false]) {
      const out = runCandidates(jobs, {
        scope: 'today', bookedToday: new Set(['a', 'b']), everyones, today: TODAY, dayOf,
      });
      expect(out.map((j) => j.id)).toEqual(['b']);
    }
  });

  it('takes everything still open on the other tab, booked or not', () => {
    const jobs = [job('a', { scheduledFor: null }), job('b'), job('c', { status: 'complete' })];
    const out = runCandidates(jobs, {
      scope: 'open', bookedToday: new Set(), everyones: false, today: TODAY, dayOf,
    });
    expect(out.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('reads the day in Queensland time, not off the front of the instant', () => {
    /*
     * A block booked at 7am here is 21:00 the day before in UTC. Slicing the
     * instant would file half the winter's work against yesterday, which is
     * the whole reason dayOf is passed in rather than assumed.
     */
    const qld = (iso: string | undefined) => (iso === '2026-09-09T21:00:00.000Z' ? TODAY : iso?.slice(0, 10));
    const out = runCandidates([job('a', { scheduledFor: '2026-09-09T21:00:00.000Z' })], {
      scope: 'today', bookedToday: new Set(), everyones: true, today: TODAY, dayOf: qld,
    });
    expect(out.map((j) => j.id)).toEqual(['a']);
  });
});
