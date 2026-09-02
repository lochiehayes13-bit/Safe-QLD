import {
  GOOGLE_FIELD_MASK, GOOGLE_PLACES_URL, NOMINATIM_MIN_GAP_MS, NOMINATIM_URL, USER_AGENT,
  createPacer, googlePlacesBody, mapGooglePlaces, mapNominatim, nominatimUrl, searchPlaces,
  type FetchLike, type FetchResponse,
} from '@/geo/places';

/**
 * The place search.
 *
 * An invented answer from each provider, and a fetch that records what it was
 * asked, because the things that go wrong here are on the wire: the wrong
 * field asked for, a key in the wrong header, a second request inside the
 * second Nominatim allows.
 */

// Invented rows in the shape each provider answers with.
const NOMINATIM_ROWS = [
  {
    place_id: 123456,
    lat: '-27.5601',
    lon: '152.9302',
    name: 'Example Hardware',
    display_name: 'Example Hardware, 12, Example Street, Sumner Park, Brisbane City, Queensland, 4074, Australia',
    type: 'hardware',
  },
  {
    place_id: 123457,
    lat: '-27.66',
    lon: '152.92',
    display_name: '40, Fictional Parade, Springfield, Ipswich City, Queensland, 4300, Australia',
  },
  { place_id: 1, lat: 'not a number', lon: '1', display_name: 'Broken' },
  { place_id: 2, lat: '0', lon: '0', display_name: 'Null Island' },
  'not a row',
];

const GOOGLE_BODY = {
  places: [
    {
      id: 'ChIJexample',
      displayName: { text: 'Example Hardware', languageCode: 'en' },
      formattedAddress: '12 Example St, Sumner Park QLD 4074, Australia',
      location: { latitude: -27.5601, longitude: 152.9302 },
    },
    { id: 'ChIJnolocation', displayName: { text: 'Nowhere' }, formattedAddress: 'x' },
  ],
};

function answer(body: unknown, status = 200): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

interface Call { url: string; init?: Parameters<FetchLike>[1] }

function recorder(body: unknown, status = 200): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer(body, status);
    },
  };
}

describe('the Nominatim request', () => {
  it('asks for JSON, Australia only, and a handful of results', () => {
    expect(nominatimUrl('storage choice sumner park')).toBe(
      `${NOMINATIM_URL}?q=storage%20choice%20sumner%20park&format=jsonv2&countrycodes=au&limit=5`,
    );
    expect(nominatimUrl(' x ', 3)).toContain('q=x&');
    expect(nominatimUrl('x', 3)).toContain('limit=3');
    expect(nominatimUrl('x', 999)).toContain('limit=50');
  });

  it('names the app in the User-Agent, as the usage policy asks', async () => {
    const r = recorder(NOMINATIM_ROWS);
    await searchPlaces('example hardware', { fetch: r.fetch, pacer: { wait: async () => undefined } });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url.startsWith(NOMINATIM_URL)).toBe(true);
    expect(r.calls[0]!.init?.headers?.['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/SafeQLD/);
  });

  it('maps the rows, taking the name off the front of the address and the country off the end', () => {
    const places = mapNominatim(NOMINATIM_ROWS);
    expect(places).toEqual([
      {
        id: 'osm:123456',
        name: 'Example Hardware',
        address: '12, Example Street, Sumner Park, Brisbane City, Queensland, 4074',
        latitude: -27.5601,
        longitude: 152.9302,
        source: 'osm',
      },
      {
        id: 'osm:123457',
        name: '40',
        address: 'Fictional Parade, Springfield, Ipswich City, Queensland, 4300',
        latitude: -27.66,
        longitude: 152.92,
        source: 'osm',
      },
    ]);
  });

  it('is an empty list for an answer that is not a list', () => {
    expect(mapNominatim({ error: 'Unable to geocode' })).toEqual([]);
    expect(mapNominatim(null)).toEqual([]);
  });

  it('throws on a refused request rather than showing nothing found', async () => {
    const r = recorder({ error: 'blocked' }, 429);
    await expect(searchPlaces('x', { fetch: r.fetch, pacer: { wait: async () => undefined } })).rejects.toThrow('OpenStreetMap answered 429');
  });
});

describe('the one-a-second rule', () => {
  it('spaces consecutive requests a second apart', async () => {
    let clock = 10_000;
    const sleeps: number[] = [];
    const pacer = createPacer(NOMINATIM_MIN_GAP_MS, {
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    });
    await pacer.wait();
    expect(sleeps).toEqual([]);
    await pacer.wait();
    expect(sleeps).toEqual([1000]);
    // Time passes; no wait needed.
    clock += 5000;
    await pacer.wait();
    expect(sleeps).toEqual([1000]);
  });

  it('is applied to Nominatim and not to Google', async () => {
    let waits = 0;
    const pacer = { wait: async () => { waits += 1; } };
    const osm = recorder([]);
    await searchPlaces('x', { fetch: osm.fetch, pacer });
    expect(waits).toBe(1);
    const google = recorder(GOOGLE_BODY);
    await searchPlaces('x', { fetch: google.fetch, pacer, key: 'test-key' });
    expect(waits).toBe(1);
  });
});

describe('the Google Places request', () => {
  it('is used when a key is present, with the key and the field mask in the headers', async () => {
    const r = recorder(GOOGLE_BODY);
    const places = await searchPlaces('example hardware', {
      fetch: r.fetch, key: 'test-key', near: { latitude: -27.47, longitude: 153.02 },
    });
    expect(r.calls).toHaveLength(1);
    const call = r.calls[0]!;
    expect(call.url).toBe(GOOGLE_PLACES_URL);
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers?.['X-Goog-Api-Key']).toBe('test-key');
    expect(call.init?.headers?.['X-Goog-FieldMask']).toBe(GOOGLE_FIELD_MASK);
    expect(GOOGLE_FIELD_MASK.split(',').sort()).toEqual(['places.displayName', 'places.formattedAddress', 'places.id', 'places.location']);
    // The key goes in the header and nowhere else.
    expect(call.url).not.toContain('test-key');
    expect(call.init?.body).not.toContain('test-key');
    expect(JSON.parse(call.init!.body!)).toEqual({
      textQuery: 'example hardware',
      regionCode: 'AU',
      languageCode: 'en-AU',
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: -27.47, longitude: 153.02 }, radius: 50000 } },
    });
    expect(places).toHaveLength(1);
  });

  it('leaves the bias out when the phone does not know where it is', () => {
    expect(googlePlacesBody('x')).toEqual({ textQuery: 'x', regionCode: 'AU', languageCode: 'en-AU', maxResultCount: 5 });
  });

  it('maps the places and drops one with no location', () => {
    expect(mapGooglePlaces(GOOGLE_BODY)).toEqual([{
      id: 'google:ChIJexample',
      name: 'Example Hardware',
      address: '12 Example St, Sumner Park QLD 4074',
      latitude: -27.5601,
      longitude: 152.9302,
      source: 'google',
    }]);
    expect(mapGooglePlaces({})).toEqual([]);
    expect(mapGooglePlaces('nope')).toEqual([]);
  });

  it('reports the status and never the body on a failure', async () => {
    const r = recorder({ error: { message: 'API key not valid: test-key' } }, 403);
    await expect(searchPlaces('x', { fetch: r.fetch, key: 'test-key' })).rejects.toThrow('Google Places answered 403');
    await expect(searchPlaces('x', { fetch: r.fetch, key: 'test-key' })).rejects.not.toThrow(/test-key/);
  });
});

describe('an empty query', () => {
  it('asks nobody', async () => {
    const r = recorder([]);
    expect(await searchPlaces('   ', { fetch: r.fetch })).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});
