/**
 * Ordering a day's jobs by where they are.
 *
 * This is deliberately modest about what it knows. Two limits shape everything
 * here, and both are stated on the screen rather than hidden:
 *
 * Straight-line distance is not driving distance. Across SEQ, with the river,
 * the motorways and a good deal of water, the two diverge badly — two sites a
 * kilometre apart across the Brisbane River are a fifteen-minute drive. The
 * ordering is still useful because relative closeness usually survives, but the
 * kilometre figure is a lower bound and is labelled as one.
 *
 * Nearest-neighbour is not the shortest route. It is within a fraction of it
 * for a handful of stops, which is what a day is, and it has the property that
 * matters more than optimality: a technician can look at the list and see why
 * it is in that order.
 */

export interface RoutePoint {
  id: string;
  label: string;
  latitude?: number;
  longitude?: number;
  /** Urgent work is not reordered around to save a few kilometres. */
  priority?: 'urgent' | 'high' | 'normal' | 'low';
}

export interface RouteStop<T extends RoutePoint = RoutePoint> {
  point: T;
  /** Straight-line kilometres from the previous stop, or from the start. */
  legKm: number;
  /** Running total, straight line. */
  cumulativeKm: number;
}

export interface PlannedRoute<T extends RoutePoint = RoutePoint> {
  stops: RouteStop<T>[];
  /** Jobs that could not be placed, because nothing says where they are. */
  unplaceable: T[];
  totalKm: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Whether a point carries a usable position. */
export function hasPosition(p: RoutePoint): p is RoutePoint & { latitude: number; longitude: number } {
  return (
    typeof p.latitude === 'number' && Number.isFinite(p.latitude) &&
    typeof p.longitude === 'number' && Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 &&
    // 0,0 is in the Gulf of Guinea. It is a missing coordinate, not a site.
    !(p.latitude === 0 && p.longitude === 0)
  );
}

/**
 * Great-circle distance in kilometres.
 *
 * Uses the haversine form, which stays accurate at the short distances a day's
 * work actually involves — the spherical law of cosines loses precision to
 * floating point over a few hundred metres.
 */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PRIORITY_ORDER: Record<NonNullable<RoutePoint['priority']>, number> = {
  urgent: 0, high: 1, normal: 2, low: 2,
};

/**
 * Orders points into a run, nearest-neighbour from a starting position.
 *
 * Urgent work is placed first and only ordered among itself: nobody drives past
 * a callout to save three kilometres, and a router that suggests it will be
 * ignored on the first day and distrusted after that. Everything else is
 * ordered purely by proximity.
 *
 * Points with no position come back separately rather than being appended as
 * though they had been routed — an unplaceable job at the end of the list looks
 * like a decision, and it is not one.
 */
export function planRoute<T extends RoutePoint>(
  points: T[],
  start?: { latitude: number; longitude: number },
): PlannedRoute<T> {
  const placeable: T[] = [];
  const unplaceable: T[] = [];
  for (const p of points) (hasPosition(p) ? placeable : unplaceable).push(p);

  // Two tiers, walked in order, so proximity never reorders urgent work behind
  // routine work.
  const tiers = new Map<number, T[]>();
  for (const p of placeable) {
    const rank = PRIORITY_ORDER[p.priority ?? 'normal'];
    const tier = tiers.get(rank) ?? [];
    tier.push(p);
    tiers.set(rank, tier);
  }

  const stops: RouteStop<T>[] = [];
  let cursor = start;
  let cumulativeKm = 0;

  for (const rank of [...tiers.keys()].sort((a, b) => a - b)) {
    const remaining = [...tiers.get(rank)!];

    while (remaining.length) {
      let bestIndex = 0;
      let bestKm = Number.POSITIVE_INFINITY;

      if (cursor) {
        remaining.forEach((p, i) => {
          const km = distanceKm(cursor!, p as RoutePoint & { latitude: number; longitude: number });
          if (km < bestKm) {
            bestKm = km;
            bestIndex = i;
          }
        });
      } else {
        // No starting position: the first stop is simply the first one given,
        // and the run is ordered from there rather than from nowhere.
        bestKm = 0;
      }

      const [next] = remaining.splice(bestIndex, 1);
      const legKm = cursor ? bestKm : 0;
      cumulativeKm += legKm;
      stops.push({ point: next!, legKm, cumulativeKm });
      cursor = next as RoutePoint & { latitude: number; longitude: number };
    }
  }

  return { stops, unplaceable, totalKm: cumulativeKm };
}

/** Kilometres rendered the way a run sheet reads them. */
export function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
