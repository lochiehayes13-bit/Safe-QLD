import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPacer, searchPlaces, type FetchLike, type FetchResponse } from '@/geo/places';
import {
  GEOCODE_BATCH, GEOCODE_PROVIDER, GEOCODE_SOURCE, geocodeAddress, geocodeNote, mapNominatimPoint,
} from '@/geo/platformGeocode.web';

/**
 * The site geocoder a browser has instead of the phone's.
 *
 * A browser has no geocoder at all, so the map in a browser could only ever
 * show sites some phone had already placed — which, on a machine whose
 * database starts empty, is no sites. This asks Nominatim instead, and the
 * things worth testing about that are the ones that get an application
 * blocked: the volume, the pacing, and what happens when the service says no.
 *
 * A miss and a refusal are different answers and must stay different. Null is
 * "that address is not on the map", which is cached and not asked again for a
 * month. A throw is "the service will not talk to us just now", which must not
 * be written into the cache at all, or a rate-limited afternoon would poison
 * three thousand rows that nothing ever retries.
 */

const ROOT = join(__dirname, '..', '..');
const NATIVE = readFileSync(join(ROOT, 'src/geo/platformGeocode.ts'), 'utf8');
const WEB = readFileSync(join(ROOT, 'src/geo/platformGeocode.web.ts'), 'utf8');

/** One Nominatim row, as it comes over the wire: coordinates as strings. */
const ROW = {
  place_id: 12345,
  lat: '-27.4698',
  lon: '153.0251',
  display_name: '12, Smith Street, Springfield, Ipswich City, Queensland, 4300, Australia',
};

const ADDRESS = '12 smith st, springfield qld 4300, australia';

function replies(body: unknown, { ok = true, status = 200 } = {}): { fetch: FetchLike; calls: { url: string; headers?: Record<string, string> }[] } {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    return { ok, status, json: async () => body } satisfies FetchResponse;
  };
  return { fetch, calls };
}

/** A pacer that does not wait, for every test but the one about waiting. */
const instant = createPacer(0, { now: () => 0, sleep: async () => undefined });

describe('an address in a browser', () => {
  it('asks Nominatim for one Australian answer', async () => {
    const { fetch, calls } = replies([ROW]);
    await geocodeAddress(ADDRESS, { fetch, pacer: instant });
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toContain('https://nominatim.openstreetmap.org/search');
    expect(url).toContain('countrycodes=au');
    expect(url).toContain('limit=1');
    expect(url).toContain(encodeURIComponent(ADDRESS));
    // Dropped by a browser, which sends its own agent and a Referer instead,
    // but set for anything that honours it. See the file's header.
    expect(calls[0]!.headers?.['User-Agent']).toContain('SafeQLD-FieldApp');
  });

  it('comes back as a position', async () => {
    expect(await geocodeAddress(ADDRESS, { ...replies([ROW]), pacer: instant }))
      .toEqual({ lat: -27.4698, lng: 153.0251 });
  });

  it('is a miss, not an error, when Nominatim has never heard of it', async () => {
    // Cached as a miss by the caller: asked again next month, not next visit.
    expect(await geocodeAddress(ADDRESS, { ...replies([]), pacer: instant })).toBeNull();
  });

  it('is not asked about at all when there is no address to ask about', async () => {
    const { fetch, calls } = replies([ROW]);
    expect(await geocodeAddress('   ', { fetch, pacer: instant })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('throws when the service refuses, so the run backs off instead of caching it', async () => {
    // Being told to slow down is the one answer that must not look like a
    // miss: three thousand rows written as "not found" during one throttled
    // afternoon would never be looked up again.
    const { fetch } = replies([], { ok: false, status: 429 });
    await expect(geocodeAddress(ADDRESS, { fetch, pacer: instant })).rejects.toThrow('429');
  });

  it('throws when the network does', async () => {
    const fetch: FetchLike = async () => { throw new Error('Failed to fetch'); };
    await expect(geocodeAddress(ADDRESS, { fetch, pacer: instant })).rejects.toThrow('Failed to fetch');
  });
});

describe('reading Nominatim as a position', () => {
  it('takes the coordinates and nothing else', () => {
    expect(mapNominatimPoint([ROW])).toEqual({ lat: -27.4698, lng: 153.0251 });
  });

  it('takes a row a place search would have thrown away', () => {
    // mapNominatim needs a name for the card and drops a row without one. A
    // street address is exactly that row, and its coordinates are all this
    // wants.
    expect(mapNominatimPoint([{ lat: '-27.5', lon: '153.1' }])).toEqual({ lat: -27.5, lng: 153.1 });
  });

  it('refuses nothing, rubbish, and the null island', () => {
    expect(mapNominatimPoint([])).toBeNull();
    expect(mapNominatimPoint(null)).toBeNull();
    expect(mapNominatimPoint({ error: 'Unable to geocode' })).toBeNull();
    expect(mapNominatimPoint([{ lat: 'somewhere', lon: 'else' }])).toBeNull();
    expect(mapNominatimPoint([{ lat: '0', lon: '0' }])).toBeNull();
  });

  it('steps over a bad row to a good one', () => {
    expect(mapNominatimPoint([{ lat: null, lon: null }, ROW])).toEqual({ lat: -27.4698, lng: 153.0251 });
  });
});

describe('what the browser is allowed to do', () => {
  it('asks for a batch small enough to be a drip', () => {
    // The policy's first line is no bulk geocoding. At one request a second,
    // anything much larger than this is minutes of continuous asking.
    expect(GEOCODE_BATCH).toBeGreaterThan(0);
    expect(GEOCODE_BATCH).toBeLessThanOrEqual(20);
  });

  it('records where the coordinates came from', () => {
    expect(GEOCODE_SOURCE).toBe('osm');
    expect(GEOCODE_PROVIDER).toContain('OpenStreetMap');
  });

  it('says on the screen how many are left and that the phone is quicker', () => {
    const note = geocodeNote(2917)!;
    expect(note).toContain('2,917');
    expect(note).toContain('OpenStreetMap');
    expect(note).toContain(String(GEOCODE_BATCH));
    expect(note).toContain('phone app');
  });

  it('says nothing once there is nothing left to place', () => {
    expect(geocodeNote(0)).toBeNull();
    expect(geocodeNote(-3)).toBeNull();
  });
});

describe('the two platforms', () => {
  it('answer the same five questions', () => {
    // The twins are swapped by the bundler, so nothing in the type checker
    // compares them. A name missing from one is a screen that renders
    // undefined on that platform and nowhere else.
    for (const name of ['GEOCODE_SOURCE', 'GEOCODE_BATCH', 'GEOCODE_PROVIDER', 'geocodeNote', 'geocodeAddress']) {
      const declared = new RegExp(`export (?:const|function|async function) ${name}\\b`);
      expect(NATIVE).toMatch(declared);
      expect(WEB).toMatch(declared);
    }
  });

  it('share one pacer rather than building a second', () => {
    // Two pacers would each wait a second and together send two a second.
    expect(WEB).toContain("from './places'");
    expect(WEB).toContain('OSM_PACER');
    expect(WEB).not.toContain('createPacer');
  });
});

describe('the pacer the place search uses', () => {
  it('holds the site geocoder back too, because the policy counts the application', async () => {
    // The real one, with its real clock: this is the only assertion in the
    // file that two features are queued behind one another rather than each
    // being polite on its own.
    const { fetch, calls } = replies([ROW]);
    const started = Date.now();
    await searchPlaces('bunnings springfield', { fetch });
    await geocodeAddress(ADDRESS, { fetch });
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});
