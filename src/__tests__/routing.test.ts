import {
  distanceKm, formatKm, hasPosition, planRoute, type RoutePoint,
} from '@/domain/routing';

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
