/**
 * Finding a place that is not one of ours.
 *
 * "Random sites from Google": a technician types the name of a shop or an
 * address they have been given, and the map has to put a pin on it whether or
 * not the office has ever heard of it. Two providers answer that:
 *
 *  - OpenStreetMap's Nominatim, which needs no key and is the default. Its
 *    usage policy is one request a second with a User-Agent that says who is
 *    asking, and both are kept here rather than left to the caller — a search
 *    box fires faster than that, and a blocked IP takes the map down for every
 *    technician at once.
 *  - Google Places text search, used instead when a key is in the keystore.
 *    It knows shop names Nominatim does not, and it costs money per call,
 *    which is why it is optional and why the key is never written anywhere but
 *    the request header.
 *
 * Pure: `fetch` is handed in, so the mappers and the pacing can be tested with
 * an invented answer and a fake clock. Nothing here imports the platform.
 */

export interface Place {
  /** The provider's own id, prefixed with the provider so two never collide. */
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  source: 'osm' | 'google';
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

/** Nominatim's policy asks that the agent name the application; a browser default gets blocked. */
export const USER_AGENT = 'SafeQLD-FieldApp/1.0 (Queensland fire protection; map place search)';

/** Nominatim's policy: an absolute maximum of one request per second. */
export const NOMINATIM_MIN_GAP_MS = 1000;

export const DEFAULT_LIMIT = 5;

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

export interface Pacer {
  /** Resolves when the next request may go. */
  wait(): Promise<void>;
}

/**
 * One request a second, whoever is asking. The clock and the sleep are
 * injectable so the rule can be tested without waiting a second for it.
 */
export function createPacer(
  minGapMs: number = NOMINATIM_MIN_GAP_MS,
  clock: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Pacer {
  const now = clock.now ?? (() => Date.now());
  const sleep = clock.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let nextAt = 0;
  return {
    async wait() {
      const t = now();
      const delay = nextAt - t;
      // Claim the slot before sleeping, so two callers waiting at once are
      // spaced a second apart rather than both leaving the moment the first
      // slot opens.
      nextAt = Math.max(t, nextAt) + minGapMs;
      if (delay > 0) await sleep(delay);
    },
  };
}

/**
 * The app's one OpenStreetMap pacer.
 *
 * Exported because the site geocoder in the browser goes to the same service
 * (see geo/platformGeocode.web.ts) and the policy is one request a second per
 * application. Two pacers, one per feature, would each wait a second and
 * together send two a second — politely, and against the rule.
 */
export const OSM_PACER = createPacer();

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

export function nominatimUrl(query: string, limit: number = DEFAULT_LIMIT): string {
  const params = [
    `q=${encodeURIComponent(query.trim())}`,
    'format=jsonv2',
    'countrycodes=au',
    `limit=${Math.max(1, Math.min(50, Math.trunc(limit)))}`,
  ];
  return `${NOMINATIM_URL}?${params.join('&')}`;
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Nominatim's rows as places.
 *
 * `display_name` is the whole address chain — "Bunnings, 12, Smith Street,
 * Springfield, Ipswich City, Queensland, 4300, Australia" — with the name at
 * the front where the feature has one. The name is taken off the front so it
 * is not printed twice, and the country off the end because every answer is
 * in Australia by construction. The region and state stay: "Springfield"
 * alone does not say which one.
 *
 * A plain address has no name, and its chain starts with the house number
 * on its own: "40, Fictional Parade, Springfield, …". The card is titled
 * with the number and the street together, the way a person says an
 * address, and the address keeps the number — it is what the matcher reads
 * the street number from, and an address handed over without its number
 * matches no site of ours.
 */
export function mapNominatim(body: unknown): Place[] {
  if (!Array.isArray(body)) return [];
  const out: Place[] = [];
  for (const row of body) {
    if (!isRecord(row)) continue;
    const latitude = asNumber(row.lat);
    const longitude = asNumber(row.lon);
    if (latitude === undefined || longitude === undefined) continue;
    if (latitude === 0 && longitude === 0) continue;
    const display = asString(row.display_name);
    const segments = display.split(',').map((s) => s.trim()).filter(Boolean);
    const rawName = asString(row.name);
    let name = rawName;
    let addressParts = segments;
    if (rawName) {
      if (segments[0] && segments[0].toLowerCase() === rawName.toLowerCase()) addressParts = segments.slice(1);
    } else if (segments[0]) {
      name = /^\d/.test(segments[0]) && segments[1] ? `${segments[0]} ${segments[1]}` : segments[0];
    }
    if (!name) continue;
    if (addressParts.length && addressParts[addressParts.length - 1]!.toLowerCase() === 'australia') {
      addressParts = addressParts.slice(0, -1);
    }
    const id = row.place_id !== undefined && row.place_id !== null ? String(row.place_id) : `${latitude},${longitude}`;
    out.push({
      id: `osm:${id}`,
      name,
      address: addressParts.join(', '),
      latitude,
      longitude,
      source: 'osm',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google Places
// ---------------------------------------------------------------------------

/** The fields asked for, which is also the whole of what is paid for. */
export const GOOGLE_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location';

export interface GoogleSearchOptions {
  limit?: number;
  /** Bias results towards here, within a generous radius. Coarsened before it is sent; see `coarsePosition`. */
  near?: { latitude: number; longitude: number };
}

/**
 * A position rounded to about a kilometre: two decimal places of a degree.
 *
 * The bias only has to say which part of the state the technician is in, so
 * that "Bunnings" finds the nearest one and not the first alphabetically.
 * The exact fix would say which driveway they are parked in, and that goes
 * to a third party with every search, so it is blurred here before it
 * leaves the phone. The bias radius is fifty kilometres; a kilometre of
 * blur changes nothing about the answer.
 */
export function coarsePosition(at: { latitude: number; longitude: number }): { latitude: number; longitude: number } {
  const round = (v: number) => Math.round(v * 100) / 100;
  return { latitude: round(at.latitude), longitude: round(at.longitude) };
}

/** The request body for the text search, so a test can see exactly what goes over the wire. */
export function googlePlacesBody(query: string, options: GoogleSearchOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: query.trim(),
    regionCode: 'AU',
    languageCode: 'en-AU',
    maxResultCount: Math.max(1, Math.min(20, Math.trunc(options.limit ?? DEFAULT_LIMIT))),
  };
  if (options.near) {
    const near = coarsePosition(options.near);
    body.locationBias = {
      circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 50000 },
    };
  }
  return body;
}

export function mapGooglePlaces(body: unknown): Place[] {
  if (!isRecord(body) || !Array.isArray(body.places)) return [];
  const out: Place[] = [];
  for (const row of body.places) {
    if (!isRecord(row)) continue;
    const location = isRecord(row.location) ? row.location : {};
    const latitude = asNumber(location.latitude);
    const longitude = asNumber(location.longitude);
    if (latitude === undefined || longitude === undefined) continue;
    if (latitude === 0 && longitude === 0) continue;
    const displayName = isRecord(row.displayName) ? asString(row.displayName.text) : asString(row.displayName);
    const address = asString(row.formattedAddress).replace(/,\s*australia$/i, '');
    const name = displayName || address;
    if (!name) continue;
    const id = asString(row.id) || `${latitude},${longitude}`;
    out.push({ id: `google:${id}`, name, address, latitude, longitude, source: 'google' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export interface SearchPlacesOptions extends GoogleSearchOptions {
  fetch: FetchLike;
  /** A Google Places API key. With one, Google answers instead of Nominatim. */
  key?: string;
  /** Replaces the module's own one-a-second pacer; for tests. */
  pacer?: Pacer;
}

/**
 * Places matching the text, from Google when there is a key and from
 * Nominatim otherwise.
 *
 * Throws on a failed request so the screen can say so; an empty answer is
 * an empty list, which is a different thing and is not an error.
 */
export async function searchPlaces(query: string, options: SearchPlacesOptions): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (options.key) {
    const response = await options.fetch(GOOGLE_PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': options.key,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify(googlePlacesBody(q, { limit, near: options.near })),
    });
    // The status and nothing else: a Google error body can echo the request,
    // and the request carried the key.
    if (!response.ok) throw new Error(`Google Places answered ${response.status}`);
    return mapGooglePlaces(await response.json());
  }

  await (options.pacer ?? OSM_PACER).wait();
  const response = await options.fetch(nominatimUrl(q, limit), {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OpenStreetMap answered ${response.status}`);
  return mapNominatim(await response.json());
}
