import * as Location from 'expo-location';
import type { FetchLike, Pacer } from './places';

/**
 * Turning one address into a position, on a phone.
 *
 * The phone has a geocoder of its own — Apple's, or Android's through Google
 * Play services — and it is free, fast and offline-ish, so `locateSites` can
 * drip two hundred addresses through it every time the map is opened. A
 * browser has nothing of the kind, and `expo-location`'s geocoder throws
 * there, which is why this file has a `.web.ts` twin: same three questions,
 * different answer for each. Everything above this line — the cache, the
 * pending list, the budget, the back-off — is shared and knows nothing about
 * which one it is talking to.
 *
 * The twin is the one with the interesting constraints; read it for why a
 * browser is allowed ten addresses a visit and a phone two hundred.
 */

/** A geocoder's answer: where the address is. */
export interface GeocodePoint {
  lat: number;
  lng: number;
}

/**
 * What the browser's twin needs and the phone's does not: somewhere to send
 * the request, and the one-a-second pacer to send it behind. Both are for
 * tests; the twin has working defaults for both.
 */
export interface GeocodeOptions {
  fetch?: FetchLike;
  pacer?: Pacer;
}

/** Recorded on the cached row, so a position says which geocoder produced it. */
export const GEOCODE_SOURCE = 'device';

/**
 * Addresses one opening of the map may look up. Two hundred is a couple of
 * minutes of a shared platform service at four hundred milliseconds apiece,
 * which is a drip rather than a batch job — see the header of geocode.ts.
 */
export const GEOCODE_BATCH = 200;

/** Names the geocoder in the line the screen shows when it has stopped. */
export const GEOCODE_PROVIDER = 'The phone’s geocoder';

/**
 * What the status line says about the addresses still to place, or null where
 * there is nothing worth saying. On a phone there is not: it places two
 * hundred a visit without asking anybody's permission or patience, and the
 * count beside it already says how far it has got.
 */
export function geocodeNote(_remaining: number): string | null {
  return null;
}

/**
 * The phone's geocoder, for one address.
 *
 * Throws whatever the platform throws — no Play services, a throttle, an
 * airplane-mode failure — because the caller treats a throw as the platform's
 * fault and stops the run, while null is the address's fault and is cached as
 * a miss.
 */
export async function geocodeAddress(address: string, _options: GeocodeOptions = {}): Promise<GeocodePoint | null> {
  const answers = await Location.geocodeAsync(address);
  const first = answers[0];
  if (!first || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) return null;
  return { lat: first.latitude, lng: first.longitude };
}
