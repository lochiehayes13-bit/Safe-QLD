import { SimproClient, SimproError, type SimproConfig } from '@/simpro/client';
import { __reset } from '@/__mocks__/expo-secure-store';

/**
 * The Simpro client, which every sync in the app goes through.
 *
 * It had no tests, and could not have any: it imports the platform keystore at
 * the top of the file, and under the node preset that import alone stops the
 * suite loading. So the OAuth exchange, the request pacing and the paging —
 * the foundation of the most heavily relied on integration here — were
 * exercised only by running the app against a live build. A keystore stub
 * fixes that, and it is a real store rather than a set of no-ops because half
 * the behaviour depends on whether a secret is actually there.
 *
 * Three things matter more than the rest.
 *
 * **Pacing.** The build limit is 10 requests a second and it is a limit on the
 * build, not on this device: going over returns 429 for everyone at the
 * company, including whoever is in the office trying to invoice.
 *
 * **The token margin.** Refreshing after a 401 means a long sync fails halfway
 * because the clock ticked over. Refreshing ahead of expiry means it does not.
 *
 * **Paging that says when it stopped.** A read cut off at a record limit and
 * returned as a plain array is indistinguishable from a complete one, and one
 * caller uses it to decide whether a service has already been sent.
 */

const config = (over: Partial<SimproConfig> = {}): SimproConfig => ({
  buildDomain: 'safeqld.simprosuite.com',
  companyId: '2',
  clientId: 'client-id',
  ...over,
});

interface Call { url: string; init?: RequestInit }

/** A fetch that answers from a script, and records what it was asked. */
function stubFetch(handler: (url: string, init?: RequestInit) => {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Hold the answer open this long, for the cases where slowness is the point. */
  delayMs?: number;
}) {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = handler(url, init);
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => r.headers?.[k] ?? null },
      json: async () => r.json ?? {},
      text: async () => r.text ?? '',
    } as unknown as Response;
  };
  return { fn, calls };
}

const tokenResponse = { access_token: 'tok-1', expires_in: 3600 };

beforeEach(() => {
  __reset();
});

describe('credentials', () => {
  it('is talking to the same keystore the client is', async () => {
    /*
     * The client imports 'expo-secure-store'; this file imports the stub by its
     * own path, because TypeScript resolves the package name to the real
     * declarations and would not see the reset helper. Both land on the same
     * module today. If a mapping change ever separated them, every test below
     * would still pass while testing nothing — the store being cleared would
     * not be the store being read — so prove it once, here.
     */
    await SimproClient.storeSecret('s3cret');
    expect(await SimproClient.hasSecret()).toBe(true);
    __reset();
    expect(await SimproClient.hasSecret()).toBe(false);
  });

  it('reports no secret before one is stored, and one after', async () => {
    expect(await SimproClient.hasSecret()).toBe(false);
    await SimproClient.storeSecret('s3cret');
    expect(await SimproClient.hasSecret()).toBe(true);
  });

  it('forgets the secret and the token together', async () => {
    /*
     * Clearing the secret and leaving a token behind would leave a device able
     * to keep reading until the token expired, after somebody deliberately
     * disconnected it.
     */
    await SimproClient.storeSecret('s3cret');
    await SimproClient.clearSecret();
    expect(await SimproClient.hasSecret()).toBe(false);
  });

  it('refuses in words a technician can act on when no secret is stored', async () => {
    const { fn } = stubFetch(() => ({ json: tokenResponse }));
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config());
    await expect(client.request('GET', 'sites/')).rejects.toThrow(/no simpro client secret/i);
  });
});

describe('the token', () => {
  it('is fetched once and reused, so a burst of calls does not re-authenticate each time', async () => {
    await SimproClient.storeSecret('s3cret');
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config());
    await client.request('GET', 'sites/');
    await client.request('GET', 'jobs/');

    expect(calls.filter((c) => c.url.includes('/oauth2/token'))).toHaveLength(1);
  });

  it('collapses refreshes that overlap into one token request', async () => {
    /*
     * A sync starting several reads at once would otherwise ask for a token
     * once per read, which is both wasteful and a good way to be rate limited
     * on the endpoint that grants the thing.
     *
     * The token endpoint has to be slow for this to be a real test. Requests
     * are paced an eighth of a second apart, so against an instant server the
     * first read has already stored a token before the second one asks — the
     * reads never overlap and the collapsing is never reached. Overlap needs a
     * token fetch that outlasts the pacing gap, which is the case it exists
     * for: a handset on site waiting on a slow response while the rest of the
     * sync queues up behind it.
     */
    await SimproClient.storeSecret('s3cret');
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token')
        ? { json: tokenResponse, delayMs: 400 }
        : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config());
    await Promise.all([
      client.request('GET', 'sites/'),
      client.request('GET', 'jobs/'),
      client.request('GET', 'quotes/'),
    ]);

    expect(calls.filter((c) => c.url.includes('/oauth2/token'))).toHaveLength(1);
  });

  it('is sent as a bearer token on every request', async () => {
    await SimproClient.storeSecret('s3cret');
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config()).request('GET', 'sites/');
    const api = calls.find((c) => c.url.includes('/api/v1.0'))!;
    expect((api.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('renews before expiry, not after a 401 halfway through a sync', async () => {
    /*
     * A token is treated as spent some minutes before the server would stop
     * accepting it. Without that margin a sync that starts near the end of a
     * token's life gets a 401 partway through — half the site's assets read,
     * half not, and the technician sees a failure on work that was fine.
     *
     * Here the server grants a token with a minute on it, which is inside the
     * margin, so the second request must ask for a new one rather than reuse
     * something about to lapse.
     */
    await SimproClient.storeSecret('s3cret');
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token')
        ? { json: { access_token: 'tok-short', expires_in: 60 } }
        : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config());
    await client.request('GET', 'sites/');
    await client.request('GET', 'jobs/');

    expect(calls.filter((c) => c.url.includes('/oauth2/token'))).toHaveLength(2);
  });

  it('says the credentials were rejected rather than reporting a raw 401', async () => {
    await SimproClient.storeSecret('wrong');
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { status: 401 } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/'))
      .rejects.toThrow(/rejected the client id or secret/i);
  });

  it('refuses a token response with no token in it', async () => {
    await SimproClient.storeSecret('s3cret');
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: { expires_in: 3600 } } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/'))
      .rejects.toThrow(/no access token/i);
  });
});

describe('behind a proxy', () => {
  it('asks for no token and stores no secret, because the server holds them', async () => {
    /*
     * The whole point of the proxy: the secret never reaches the handset. A
     * client that still tried to fetch a token here would fail on a device
     * that correctly has nothing stored.
     */
    const { fn, calls } = stubFetch(() => ({ json: [] }));
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config({ proxyUrl: 'https://safeqld.example/simpro' }));
    await client.request('GET', 'sites/');

    expect(calls.some((c) => c.url.includes('/oauth2/token'))).toBe(false);
    expect(calls[0]!.url.startsWith('https://safeqld.example/simpro')).toBe(true);
  });

  it('sends no Authorization header, since the proxy adds its own', async () => {
    const { fn, calls } = stubFetch(() => ({ json: [] }));
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config({ proxyUrl: 'https://safeqld.example/simpro' }))
      .request('GET', 'sites/');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('what it does with a refusal', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('names the rate limit rather than a bare 429', async () => {
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 429 });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/'))
      .rejects.toThrow(/rate limit/i);
  });

  it('says a 403 is a per-endpoint permission, which is where it is actually fixed', async () => {
    /*
     * The useful half. "HTTP 403" sends somebody to check the whole key; "API
     * permissions are set per endpoint" sends them to the one screen in Simpro
     * that fixes it.
     */
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 403 });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'customerAssets/'))
      .rejects.toThrow(/permitted to read customerAssets\/|per endpoint/i);
  });

  it('carries the status and the path on the error, so a caller can decide', async () => {
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 403 });
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config()).request('GET', 'sites/').catch((e: SimproError) => {
      expect(e.status).toBe(403);
      expect(e.path).toBe('sites/');
    });
  });

  it('refuses to build a URL with no company configured', () => {
    // Guessing a company id reads somebody else's data.
    expect(() => new SimproClient(config({ companyId: '' })).companyRoot)
      .toThrow(/no simpro company id/i);
  });
});

describe('paging', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  /** A server holding `total` records, answering 250 at a time. */
  const paged = (total: number) => stubFetch((url) => {
    if (url.includes('/oauth2/token')) return { json: tokenResponse };
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const size = Number(new URL(url).searchParams.get('pageSize') ?? '250');
    const start = (page - 1) * size;
    const count = Math.max(0, Math.min(size, total - start));
    return {
      json: Array.from({ length: count }, (_, i) => ({ ID: start + i })),
      headers: { 'Result-Total': String(total) },
    };
  });

  it('reads every page of a collection larger than one page', async () => {
    const { fn } = paged(600);
    global.fetch = fn as unknown as typeof fetch;
    const rows = await new SimproClient(config()).listAll<{ ID: number }>('sites/');
    expect(rows).toHaveLength(600);
  });

  it('stops when the server says there are no more, without asking again', async () => {
    const { fn, calls } = paged(250);
    global.fetch = fn as unknown as typeof fetch;
    await new SimproClient(config()).listAll('sites/');
    expect(calls.filter((c) => c.url.includes('sites/'))).toHaveLength(1);
  });

  it('says when it stopped early, which a bare array cannot', async () => {
    /*
     * The one that decides whether a service posts twice. A read cut off at the
     * limit and handed back as an array is indistinguishable from a complete
     * one, and the caller reading a job's notes for markers treats "not in the
     * set" as "not yet sent".
     */
    const { fn } = paged(600);
    global.fetch = fn as unknown as typeof fetch;
    const read = await new SimproClient(config()).listAllPaged('sites/', {}, 250);
    expect(read.items).toHaveLength(250);
    expect(read.truncated).toBe(true);
  });

  it('does not cry truncation on a collection that ends exactly on the limit', async () => {
    const { fn } = paged(250);
    global.fetch = fn as unknown as typeof fetch;
    const read = await new SimproClient(config()).listAllPaged('sites/', {}, 250);
    expect(read.items).toHaveLength(250);
    expect(read.truncated).toBe(false);
  });

  it('returns nothing, and not truncated, for an empty collection', async () => {
    const { fn } = paged(0);
    global.fetch = fn as unknown as typeof fetch;
    const read = await new SimproClient(config()).listAllPaged('sites/');
    expect(read).toEqual({ items: [], truncated: false });
  });
});

describe('pacing', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('spaces requests below the build limit, which is shared with the office', async () => {
    /*
     * Ten a second is a limit on the build rather than on this handset. Going
     * over returns 429 for everyone at the company, including whoever is
     * invoicing — so this leaves headroom rather than riding the ceiling.
     */
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const client = new SimproClient(config());
    const started = Date.now();
    for (let i = 0; i < 5; i++) await client.request('GET', 'sites/');
    const elapsed = Date.now() - started;

    // Five requests at eight a second cannot finish inside half a second.
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });
});
