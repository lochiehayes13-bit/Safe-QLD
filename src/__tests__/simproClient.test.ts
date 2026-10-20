import {
  SimproClient, SimproError, SimproNetworkError, SimproUnreadableReply, resetClientState,
  type SimproConfig,
} from '@/simpro/client';
import { readSignedOutReason, readUserSession, writeUserSession } from '@/simpro/userSession';
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
 * Four things matter more than the rest.
 *
 * **Pacing.** The build limit is 10 requests a second and it is a limit on the
 * build, not on this device: going over returns 429 for everyone at the
 * company, including whoever is in the office trying to invoice. And the app
 * runs several clients at once, so the pacing has to be shared between them
 * or it is not pacing at all.
 *
 * **The token margin.** Refreshing after a 401 means a long sync fails halfway
 * because the clock ticked over. Refreshing ahead of expiry means it does not.
 * A 401 that arrives anyway — a password changed in the office — is answered
 * by renewing once, not by failing for the rest of the hour.
 *
 * **Whose name the work goes under.** A person's session must not be ended
 * because the phone was in a basement when it came to renew it; only the
 * server refusing the renewal ends it.
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

interface Scripted {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Hold the answer open this long, for the cases where slowness is the point. */
  delayMs?: number;
  /** Fail the way fetch does with no signal: reject, no response at all. */
  unreachable?: boolean;
}

/** A fetch that answers from a script, and records what it was asked. */
function stubFetch(handler: (url: string, init?: RequestInit) => Scripted) {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = handler(url, init);
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    if (r.unreachable) throw new TypeError('Network request failed');
    const status = r.status ?? 200;
    // The client reads a reply as text and parses it itself, so a scripted
    // JSON body has to come back through both doors.
    const text = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => r.headers?.[k] ?? null },
      json: async () => (r.json !== undefined ? r.json : JSON.parse(text)),
      text: async () => text,
    } as unknown as Response;
  };
  return { fn, calls };
}

const tokenResponse = { access_token: 'tok-1', expires_in: 3600 };

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/oauth2/token'));
const apiCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/api/v1.0'));
const bearer = (init?: RequestInit) => (init?.headers as Record<string, string>).Authorization;
const grantOf = (init?: RequestInit) => new URLSearchParams(String(init?.body ?? '')).get('grant_type');

/** A person signed in an hour ago, or an hour after their token lapsed. */
async function signedIn(over: { expired?: boolean; refreshToken?: string | undefined } = {}): Promise<void> {
  await writeUserSession({
    accessToken: 'user-old',
    refreshToken: 'refreshToken' in over ? over.refreshToken : 'r-1',
    expiresAt: Date.now() + (over.expired ? -60_000 : 3_600_000),
    label: 'Dave',
  });
}

beforeEach(() => {
  __reset();
  resetClientState();
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

    expect(tokenCalls(calls)).toHaveLength(1);
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

    expect(tokenCalls(calls)).toHaveLength(1);
  });

  it('is sent as a bearer token on every request', async () => {
    await SimproClient.storeSecret('s3cret');
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config()).request('GET', 'sites/');
    expect(bearer(apiCalls(calls)[0]!.init)).toBe('Bearer tok-1');
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

    expect(tokenCalls(calls)).toHaveLength(2);
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

  it('says nothing was sent when the token server cannot be reached', async () => {
    /*
     * The outbound queue has to tell "no request went out" from "a request
     * went out and got no reply". The first is safe to try again; the second
     * is the one that posts a note twice. The class says which.
     */
    await SimproClient.storeSecret('s3cret');
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { unreachable: true } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const failure = await new SimproClient(config()).request('GET', 'sites/').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SimproNetworkError);
    expect((failure as SimproError).status).toBeUndefined();
  });
});

describe('a token the server has stopped accepting', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('is renewed once and the request sent again, rather than failing until the clock catches up', async () => {
    /*
     * A password changed in the office five minutes into the hour. The stored
     * session still looks good by the clock for another fifty-five, so the
     * renewal has to be forced by the 401, not left to expiry.
     */
    await signedIn();
    const { fn, calls } = stubFetch((url, init) => {
      if (url.includes('/oauth2/token')) {
        return grantOf(init) === 'refresh_token'
          ? { json: { access_token: 'user-new', refresh_token: 'r-2', expires_in: 3600 } }
          : { status: 400, text: 'invalid_client' };
      }
      return bearer(init) === 'Bearer user-new' ? { json: [{ ID: 1 }] } : { status: 401 };
    });
    global.fetch = fn as unknown as typeof fetch;

    const { data } = await new SimproClient(config()).request<{ ID: number }[]>('GET', 'sites/');

    expect(data).toEqual([{ ID: 1 }]);
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(String(tokenCalls(calls)[0]!.init?.body)).toContain('refresh_token=r-1');
    expect(apiCalls(calls).map((c) => bearer(c.init))).toEqual(['Bearer user-old', 'Bearer user-new']);

    const session = await readUserSession();
    expect(session?.accessToken).toBe('user-new');
    expect(session?.refreshToken).toBe('r-2');
  });

  it('is renewed once only: a second refusal is reported, not looped on', async () => {
    await signedIn();
    const { fn, calls } = stubFetch((url, init) =>
      url.includes('/oauth2/token') && grantOf(init) === 'refresh_token'
        ? { json: { access_token: 'user-new', expires_in: 3600 } }
        : { status: 401 });
    global.fetch = fn as unknown as typeof fetch;

    const failure = await new SimproClient(config()).request('GET', 'sites/').catch((e: SimproError) => e);
    expect(failure).toBeInstanceOf(SimproError);
    expect((failure as SimproError).status).toBe(401);
    expect((failure as SimproError).message).toMatch(/even after renewing/i);
    expect(apiCalls(calls)).toHaveLength(2);
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  it("re-issues the office's own token once when that is the one refused", async () => {
    let issued = 0;
    const { fn, calls } = stubFetch((url, init) => {
      if (url.includes('/oauth2/token')) {
        issued++;
        return { json: { access_token: `tok-${issued}`, expires_in: 3600 } };
      }
      return bearer(init) === 'Bearer tok-2' ? { json: [] } : { status: 401 };
    });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/')).resolves.toMatchObject({ data: [] });
    expect(tokenCalls(calls).map((c) => grantOf(c.init))).toEqual(['client_credentials', 'client_credentials']);
  });

  it('is not renewed behind a proxy, where the device holds no token to renew', async () => {
    const { fn, calls } = stubFetch(() => ({ status: 401 }));
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config({ proxyUrl: 'https://safeqld.example/simpro' })).request('GET', 'sites/'))
      .rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });
});

describe("a person's session", () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('is used ahead of the office key while it is good', async () => {
    await signedIn();
    const { fn, calls } = stubFetch(() => ({ json: [] }));
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config()).request('GET', 'sites/');
    expect(tokenCalls(calls)).toHaveLength(0);
    expect(bearer(apiCalls(calls)[0]!.init)).toBe('Bearer user-old');
  });

  it('is renewed with its refresh token once it has lapsed', async () => {
    await signedIn({ expired: true });
    const { fn, calls } = stubFetch((url, init) =>
      url.includes('/oauth2/token') && grantOf(init) === 'refresh_token'
        ? { json: { access_token: 'user-new', refresh_token: 'r-2', expires_in: 3600 } }
        : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await new SimproClient(config()).request('GET', 'sites/');
    expect(bearer(apiCalls(calls)[0]!.init)).toBe('Bearer user-new');
    expect((await readUserSession())?.refreshToken).toBe('r-2');
  });

  it('is kept, and the request fails, when the renewal could not reach Simpro', async () => {
    /*
     * The case that was signing people out every morning. Yesterday's session
     * has lapsed, the job screen refreshes itself in a basement, the renewal
     * cannot get out — and the phone concluded the server had refused it.
     * From then on the technician's notes went up under the office's name.
     */
    await signedIn({ expired: true });
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { unreachable: true } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const failure = await new SimproClient(config()).request('GET', 'sites/').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SimproNetworkError);
    expect((await readUserSession())?.refreshToken).toBe('r-1');
    expect(await readSignedOutReason()).toBeNull();
  });

  it('is kept when the token server itself is the fault', async () => {
    await signedIn({ expired: true });
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { status: 503, text: 'maintenance' } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/')).rejects.toMatchObject({ status: 503 });
    expect(await readUserSession()).not.toBeNull();
  });

  it("is ended, with the server's words kept, only when the server refuses to renew it", async () => {
    await signedIn({ expired: true });
    const { fn, calls } = stubFetch((url, init) => {
      if (!url.includes('/oauth2/token')) return { json: [] };
      return grantOf(init) === 'refresh_token'
        ? { status: 400, text: JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token revoked' }) }
        : { json: tokenResponse };
    });
    global.fetch = fn as unknown as typeof fetch;

    // The sync carries on under the office key, as the module promises.
    await expect(new SimproClient(config()).request('GET', 'sites/')).resolves.toMatchObject({ data: [] });
    expect(bearer(apiCalls(calls)[0]!.init)).toBe('Bearer tok-1');
    expect(await readUserSession()).toBeNull();
    expect(await readSignedOutReason()).toMatch(/would not renew.*invalid_grant/i);
  });

  it('is renewed once, however many clients find it lapsed at the same moment', async () => {
    /*
     * The pull and the job screen each build their own client, and on a
     * foreground they both wake at once. Two refresh requests with the same
     * token is one refusal on a build that rotates them, and a refusal signs
     * the person out.
     */
    await signedIn({ expired: true });
    const { fn, calls } = stubFetch((url, init) =>
      url.includes('/oauth2/token') && grantOf(init) === 'refresh_token'
        ? { json: { access_token: 'user-new', refresh_token: 'r-2', expires_in: 3600 }, delayMs: 300 }
        : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    await Promise.all([
      new SimproClient(config()).request('GET', 'sites/'),
      new SimproClient(config()).request('GET', 'jobs/'),
    ]);

    expect(tokenCalls(calls)).toHaveLength(1);
    expect(apiCalls(calls).map((c) => bearer(c.init))).toEqual(['Bearer user-new', 'Bearer user-new']);
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
    expect(bearer(calls[0]!.init)).toBeUndefined();
  });
});

describe('what it does with a reply', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('treats a 204 as success with nothing in it, which is how the build answers a write', async () => {
    /*
     * The asset-test PATCH answers 204. Parsing that as JSON threw a
     * SyntaxError that the queue read as "went out, no reply", and every
     * asset test a technician recorded was left for a person to adjudicate
     * after the server had already taken it.
     */
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 204 });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('PATCH', 'customerAssets/7', { body: { LastTest: 'x' } }))
      .resolves.toEqual({ data: undefined, total: null });
  });

  it('treats a 200 with an empty body the same way', async () => {
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 200, text: '  ' });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('POST', 'jobs/1/notes/', { body: {} }))
      .resolves.toEqual({ data: undefined, total: null });
  });

  it('reports a 2xx it cannot read as acted-on-but-unreadable, never as a status to retry', async () => {
    /*
     * The queue reads "an error with a status" as "the server did not act,
     * send it again". On a 2xx the server did act, so that would post the
     * note twice. The error must carry no status.
     */
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 200, text: '<html>gateway</html>' });
    global.fetch = fn as unknown as typeof fetch;

    const failure = await new SimproClient(config()).request('POST', 'jobs/1/notes/', { body: {} })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SimproUnreadableReply);
    expect((failure as SimproError).status).toBeUndefined();
    expect((failure as SimproUnreadableReply).httpStatus).toBe(200);
    expect((failure as SimproError).path).toBe('jobs/1/notes/');
  });

  it('still reads the record count from the header when the body is a list', async () => {
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [{ ID: 1 }], headers: { 'Result-Total': '9' } });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/'))
      .resolves.toEqual({ data: [{ ID: 1 }], total: 9 });
  });
});

describe('what it does with a refusal', () => {
  beforeEach(async () => {
    await SimproClient.storeSecret('s3cret');
  });

  it('waits out a 429 once, as the build asked, and then sends again', async () => {
    let seen = 0;
    const { fn, calls } = stubFetch((url) => {
      if (url.includes('/oauth2/token')) return { json: tokenResponse };
      seen++;
      return seen === 1 ? { status: 429, headers: { 'Retry-After': '0' } } : { json: [] };
    });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/')).resolves.toMatchObject({ data: [] });
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it('names the rate limit rather than a bare 429 when the wait did not help, and does not loop', async () => {
    const { fn, calls } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { status: 429, headers: { 'Retry-After': '0' } });
    global.fetch = fn as unknown as typeof fetch;

    await expect(new SimproClient(config()).request('GET', 'sites/'))
      .rejects.toThrow(/rate limit/i);
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it('honours the Retry-After it was given, for every client on the build', async () => {
    /*
     * The limit is on the build. A 429 seen by the pull is a 429 the job
     * screen would get too, so the stand-off is shared, and the retry waits
     * as long as the header said rather than the usual eighth of a second.
     */
    let seen = 0;
    const { fn } = stubFetch((url) => {
      if (url.includes('/oauth2/token')) return { json: tokenResponse };
      seen++;
      return seen === 1 ? { status: 429, headers: { 'Retry-After': '1' } } : { json: [] };
    });
    global.fetch = fn as unknown as typeof fetch;

    const started = Date.now();
    await new SimproClient(config()).request('GET', 'sites/');
    const other = Date.now();
    await new SimproClient(config()).request('GET', 'jobs/');

    expect(other - started).toBeGreaterThanOrEqual(900);
    // The second client arrived after the stand-off had passed, so it was
    // only paced, not held.
    expect(Date.now() - other).toBeLessThan(500);
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

  it('is shared by every client on the build, not kept per client', async () => {
    /*
     * The app runs several clients at once — the pull, a job screen refreshing
     * itself, a queue flush — and each pacing itself politely to eight a
     * second is sixteen a second to the build. Alternating two clients has
     * to take as long as one client sending the same five requests.
     */
    const { fn } = stubFetch((url) =>
      url.includes('/oauth2/token') ? { json: tokenResponse } : { json: [] });
    global.fetch = fn as unknown as typeof fetch;

    const a = new SimproClient(config());
    const b = new SimproClient(config());
    const started = Date.now();
    for (let i = 0; i < 5; i++) await (i % 2 ? b : a).request('GET', 'sites/');

    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });
});
