import { OSM_PACER, USER_AGENT, nominatimUrl, type FetchLike } from './places';
import { formatCount } from '@/domain/mapPins';
import type { GeocodeOptions, GeocodePoint } from './platformGeocode';

/**
 * Turning one address into a position, in a browser.
 *
 * A browser has no geocoder, so this asks the one the app already talks to:
 * OpenStreetMap's Nominatim, the same service behind the map's place search,
 * through the same URL builder and — this is the part that matters — the same
 * pacer. Nominatim's policy is one request a second *per application*, not per
 * feature, so a second pacer here would be two features each politely waiting
 * a second and together sending two a second, which is the thing the policy
 * forbids and the way an IP gets blocked for every technician at once.
 *
 * The other half of the policy is a cap on volume. The phone geocodes two
 * hundred addresses a visit against a local service; at one a second, three
 * thousand sites would be an hour of continuous requests to a service run by
 * volunteers, and "no bulk geocoding" is the first line of their usage policy.
 * So a browser is allowed ten a visit — fifteen seconds of work, enough that
 * a small run of sites fills in over a few openings — and the status line says
 * how many are still to place and that the phone app is the tool for the job.
 * Everything found is cached like any other position and never asked twice.
 *
 * One thing a browser cannot do: send the User-Agent Nominatim's policy asks
 * for. It is a forbidden header, dropped silently, and the browser sends its
 * own plus a Referer naming the site the app is served from — which is what
 * the policy accepts from a web application in place of an agent string. The
 * header is still set here for the day this file is read on a platform that
 * honours it.
 */

/** Recorded on the cached row, so a position says which geocoder produced it. */
export const GEOCODE_SOURCE = 'osm';

/**
 * Addresses one opening of the map may look up. Ten, at one a second: about
 * fifteen seconds of a volunteer-run service per visit, and small enough that
 * nobody could mistake this for the bulk geocoding the policy forbids.
 */
export const GEOCODE_BATCH = 10;

/** Names the geocoder in the line the screen shows when it has stopped. */
export const GEOCODE_PROVIDER = 'The address lookup at OpenStreetMap';

/**
 * What the status line says about the addresses still to place.
 *
 * A map showing 40 of 3,000 sites has to say why, or it reads as a broken map
 * rather than a slow one — and it has to say that the phone app is not slow,
 * because the person looking at it may be one tap from a better answer.
 */
export function geocodeNote(remaining: number): string | null {
  if (remaining <= 0) return null;
  return `${formatCount(remaining)} to place — ${GEOCODE_BATCH} a visit from OpenStreetMap; the phone app is far quicker`;
}

/**
 * The first usable position in a Nominatim answer.
 *
 * Not `mapNominatim`: that builds a card — a name, an address chain, a
 * provider id — and drops a row it cannot name. A site address geocodes to
 * exactly the kind of row it would drop, a numbered house with no name of its
 * own, and all that is wanted from it is the two numbers. Null zero is checked
 * because Nominatim uses it for "nothing", and a pin off the coast of Africa
 * is worse than no pin.
 */
export function mapNominatimPoint(body: unknown): GeocodePoint | null {
  if (!Array.isArray(body)) return null;
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const lat = Number(record.lat);
    const lng = Number(record.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    return { lat, lng };
  }
  return null;
}

/**
 * Nominatim, for one address.
 *
 * Throws when the service refuses — a 429 for going too fast, a 403 for being
 * blocked, or the network failing — because the caller reads a throw as the
 * provider's fault, backs off, and gives up for this visit after three in a
 * row. Null is the address's fault and is cached as a miss, which is what an
 * address Nominatim genuinely does not know deserves: asked once a month, not
 * once a visit.
 */
export async function geocodeAddress(address: string, options: GeocodeOptions = {}): Promise<GeocodePoint | null> {
  const query = address.trim();
  if (!query) return null;
  const send: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  await (options.pacer ?? OSM_PACER).wait();
  const response = await send(nominatimUrl(query, 1), {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OpenStreetMap answered ${response.status}`);
  return mapNominatimPoint(await response.json());
}
