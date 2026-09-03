import * as SecureStore from 'expo-secure-store';
import {
  describeOAuthFailure, expiresAtFrom, parseTokenResponse, tokenRequestBody, tokenUrl,
  type TokenGrant, type TokenSet,
} from './oauth';
import { clearUserSession, readUserSession, writeUserSession, type UserSession } from './userSession';
import type { CurrentUser } from './identity';

/**
 * Simpro REST API client.
 *
 * Mirrors the Python toolkit already in use for back-office work, with the
 * constraints that matter in the field:
 *
 *  - Tokens are refreshed before they expire rather than after a 401, so a long
 *    sync does not fail because the clock ticked over mid-run. A 401 that
 *    arrives anyway — a password changed, a session revoked in the office — is
 *    answered by renewing once and sending again, not by failing every request
 *    until the clock catches up.
 *  - Requests are paced below the documented 10/sec build limit; going over
 *    returns 429 for everyone using the build, not just this device. The pacing
 *    is shared by every client in the app, because the limit is on the build
 *    and the app runs several clients at once — a pull, a job screen refreshing
 *    itself and a queue flush each build their own.
 *  - Every response is paginated defensively — a site list can be thousands of
 *    records and Simpro caps page size.
 *
 * On credentials: a client secret sitting on a technician's phone is a real
 * risk, so it is held in the platform keystore and never in plain storage.
 * `proxyUrl` exists so the whole exchange can be moved behind a Safe QLD server
 * later without touching any calling code — that is the better end state.
 */

const TOKEN_KEY = 'safeqld.simpro.token';
const SECRET_KEY = 'safeqld.simpro.clientSecret';

/** The build limit is 10/sec; pacing below it leaves headroom for office traffic. */
const REQUESTS_PER_SECOND = 8;

/** How long to stand off a 429 that names no Retry-After, and the most one is allowed to ask for. */
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * The endpoints without which the app cannot do its job.
 *
 * Deliberately shorter than the full probe list. A key that cannot read
 * catalogs or vendors is merely limited — ordering parts will not work — but a
 * key that cannot read sites or customer assets cannot show a technician what
 * they are standing in front of, and calling that "connected" wastes a trip.
 */
const REQUIRED_ENDPOINTS = ['Sites', 'Customer assets', 'Jobs', 'Customers'];

export interface SimproConfig {
  /** Host you log into Simpro with, e.g. "safeqld.simprosuite.com". */
  buildDomain: string;
  companyId: string;
  clientId: string;
  /** When set, requests go here instead of directly to Simpro and no secret is stored on device. */
  proxyUrl?: string;
}

/**
 * The path of a single record, which on this build must not end in a slash.
 *
 * Verified against the live build: `jobs/{id}` answers and `jobs/{id}/` is a
 * 404 "Invalid route", and the same holds for quotes, invoices, customers,
 * sites, customer assets and every nested child record. Collections are the
 * other way round — `jobs/`, `jobs/{id}/sections/` — so a path written from
 * memory is wrong half the time in a way no type can catch. Every record
 * path in the app goes through here, and the collection paths through
 * `collectionPath`, so the rule is written once.
 */
export function recordPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/** The path of a collection, which takes exactly one trailing slash. */
export function collectionPath(path: string): string {
  return `${recordPath(path)}/`;
}

export class SimproError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'SimproError';
  }
}

/**
 * The network failed before anything reached Simpro.
 *
 * Distinct from a request that went out and got no reply, which is the case
 * the outbound queue must not retry on its own. Nothing was sent here, so a
 * caller may try again freely, and a person's sign-in must not be ended over
 * it — a phone in a basement is not a refused password.
 */
export class SimproNetworkError extends SimproError {
  constructor(message: string, path?: string) {
    super(message, undefined, path);
    this.name = 'SimproNetworkError';
  }
}

/**
 * The token server refused what it was offered: a client ID or secret, a
 * password, a login code or a refresh token. Fixed in Settings or by signing
 * in again, never by retrying, which is why the queue and the session renewal
 * each need to tell it apart from a server that was merely unavailable.
 */
export class SimproCredentialsError extends SimproError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'SimproCredentialsError';
  }
}

/**
 * Simpro answered 2xx — it acted — but the body could not be read.
 *
 * Carries no status on purpose. The outbound queue reads "an error with a
 * status" as "the server answered and did not act, so send it again", and
 * that is exactly wrong here: a job note or a vendor order posted on a reply
 * that happened to be unreadable would go out twice. It is left for a person
 * to check, the same as a request that got no reply at all.
 */
export class SimproUnreadableReply extends SimproError {
  constructor(message: string, readonly httpStatus: number, path?: string) {
    super(message, undefined, path);
    this.name = 'SimproUnreadableReply';
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// ------------------------------------------------------- shared across clients

/**
 * What every client talking to the same build has to agree on.
 *
 * The pacing slot, because the rate limit is on the build and two clients
 * each politely sending eight a second are sixteen a second to the build.
 * Keyed by the base URL rather than held on the instance, so a proxy and a
 * direct connection to the same build do not share one when they are in fact
 * different servers, and so `connect()`'s rebuilt scoped client shares the
 * slot with the client it was built from.
 */
interface BuildLane {
  /** Timestamp the next request may be sent. */
  nextSlot: number;
}

const lanes = new Map<string, BuildLane>();

function laneFor(baseUrl: string): BuildLane {
  let lane = lanes.get(baseUrl);
  if (!lane) {
    lane = { nextSlot: 0 };
    lanes.set(baseUrl, lane);
  }
  return lane;
}

/**
 * The renewal of a person's session that is in flight, by the refresh token
 * being spent. Two clients finding the same session expired at the same
 * moment — the pull and the job screen, on a foreground — would otherwise
 * both post the same refresh token, and on a build that rotates them the
 * loser is refused and signs the person out.
 */
const renewals = new Map<string, Promise<UserSession | null>>();

/** Test-only. Forgets the pacing and in-flight renewals so one test cannot slow or steer the next. */
export function resetClientState(): void {
  lanes.clear();
  renewals.clear();
}

/**
 * How long a 429 asks to be left alone, in milliseconds.
 *
 * Seconds or an HTTP date, per the header's definition; a header that says
 * nothing usable gets a second, and nothing is allowed to ask for more than
 * half a minute — a sync waiting five minutes on a header it cannot see is
 * indistinguishable from one that has hung.
 */
function retryAfterMs(header: string | null): number {
  if (header === null) return DEFAULT_RETRY_AFTER_MS;
  const value = header.trim();
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
}

/**
 * Renews a person's session, once, however many clients ask.
 *
 * The stored session is read again before the refresh token is spent: if
 * another client renewed it in the meantime, that is the session to use, and
 * sending the old refresh token would only get it refused. A refusal is also
 * checked against the store before it ends the sign-in, for the same reason.
 *
 * Only a refusal ends the session. A network failure, a server fault or a
 * rate limit is thrown to the caller so this one request fails and the
 * sign-in stays; falling through to the office key there would put the
 * person's work under the office's name, which is the thing the session
 * exists to prevent.
 */
async function renewUserSession(config: SimproConfig, spent: UserSession & { refreshToken: string }): Promise<UserSession | null> {
  const running = renewals.get(spent.refreshToken);
  if (running) return running;

  const run = (async (): Promise<UserSession | null> => {
    const current = await readUserSession();
    if (!current) return null;
    if (current.refreshToken !== spent.refreshToken || current.accessToken !== spent.accessToken) {
      return current;
    }

    let granted: TokenSet;
    try {
      granted = await SimproClient.tokenExchange(config, {
        grant_type: 'refresh_token', refresh_token: spent.refreshToken,
      });
    } catch (e) {
      if (!(e instanceof SimproCredentialsError)) throw e;
      const latest = await readUserSession();
      if (latest && latest.refreshToken !== spent.refreshToken) return latest;
      await clearUserSession(`Simpro would not renew your sign-in: ${e.message}`);
      return null;
    }

    const renewed: UserSession = {
      accessToken: granted.accessToken,
      refreshToken: granted.refreshToken ?? spent.refreshToken,
      expiresAt: expiresAtFrom(Date.now(), granted.expiresInSeconds),
      label: spent.label,
    };
    await writeUserSession(renewed);
    return renewed;
  })().finally(() => {
    renewals.delete(spent.refreshToken);
  });

  renewals.set(spent.refreshToken, run);
  return run;
}

export class SimproClient {
  private token: CachedToken | null = null;
  private tokenPromise: Promise<string> | null = null;
  /** Set when the server refused the token it was sent, so the next resolve renews rather than trusts the clock. */
  private renewOnNextToken = false;

  constructor(private readonly config: SimproConfig) {}

  private get baseUrl(): string {
    return this.config.proxyUrl ?? `https://${this.config.buildDomain}`;
  }

  private get apiRoot(): string {
    return `${this.baseUrl}/api/v1.0`;
  }

  get companyRoot(): string {
    if (!this.config.companyId) {
      throw new SimproError('No Simpro company ID is configured. Run the connection test in Settings.');
    }
    return `${this.apiRoot}/companies/${this.config.companyId}`;
  }

  // -------------------------------------------------------------- credentials

  static async storeSecret(secret: string): Promise<void> {
    await SecureStore.setItemAsync(SECRET_KEY, secret, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  static async hasSecret(): Promise<boolean> {
    return (await SecureStore.getItemAsync(SECRET_KEY)) !== null;
  }

  /**
   * Why this configuration cannot talk to Simpro yet, or null if it can.
   *
   * Checked once before a sync starts rather than discovered separately by each
   * stage. Without it, a device with no secret runs the whole pull and reports
   * the same sentence five times over — once for sites, jobs, assets, rates and
   * fees — which reads like five faults instead of one unticked box, and buries
   * the one instruction that would fix it.
   */
  static async missingCredentials(config: SimproConfig): Promise<string | null> {
    if (config.proxyUrl) return null;
    if (!config.buildDomain.trim()) {
      return 'No Simpro build domain is set. Add it in Settings.';
    }
    if (!config.clientId.trim()) {
      return 'No Simpro client ID is set. Add it in Settings.';
    }
    if (!(await SimproClient.hasSecret())) {
      return 'Paste the Simpro client secret in Settings and save it to the keystore. '
        + 'Everything else is already filled in.';
    }
    return null;
  }

  static async clearSecret(): Promise<void> {
    await SecureStore.deleteItemAsync(SECRET_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }

  // ------------------------------------------------------------------- token

  /**
   * One token request for every grant the app uses.
   *
   * The office's API key (client_credentials), a person's password, the code
   * a browser login hands back, and a refresh all go through the same door,
   * because they differ only in the form body — ./oauth builds it — and in
   * how a refusal is worded. The client-credentials wording is kept as it
   * was: that refusal is the one a technician can fix in Settings, and it
   * has to read as such rather than as a raw OAuth error.
   *
   * What went wrong is said in the error's class as well as its words. A
   * refusal is a credentials error; a network that never reached the server
   * is a network error; a server fault is neither. The session renewal and
   * the outbound queue both decide differently on each.
   */
  static async tokenExchange(config: SimproConfig, grant: TokenGrant): Promise<TokenSet> {
    const secret = config.proxyUrl ? undefined : ((await SecureStore.getItemAsync(SECRET_KEY)) ?? undefined);
    if (!config.proxyUrl && !secret) {
      throw new SimproError('No Simpro client secret is stored on this device. Add it in Settings.');
    }

    let res: Response;
    try {
      res = await fetch(tokenUrl(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: tokenRequestBody(config, grant, secret),
      });
    } catch (e) {
      throw new SimproNetworkError(
        `Could not reach Simpro to get a token: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const refused = res.status === 400 || res.status === 401 || res.status === 403;
      if (grant.grant_type === 'client_credentials') {
        // Simpro answers bad client credentials with 400 and an `invalid_client`
        // body, not 401. Matching only on 401 meant the one error a person can
        // actually fix surfaced as a raw HTTP dump with a JSON blob in it.
        const badCredentials = res.status === 401 || (res.status === 400 && text.includes('invalid_client'));
        const message = badCredentials
          ? 'Simpro rejected the client ID or secret. Check them in Settings, and confirm the secret has not been regenerated.'
          : `Could not get a Simpro token (HTTP ${res.status}). ${text.slice(0, 200)}`;
        throw refused ? new SimproCredentialsError(message, res.status) : new SimproError(message, res.status);
      }
      const message = describeOAuthFailure(res.status, text);
      throw refused ? new SimproCredentialsError(message, res.status) : new SimproError(message, res.status);
    }

    try {
      return parseTokenResponse(await res.json());
    } catch (e) {
      throw new SimproError(e instanceof Error ? e.message : String(e), res.status);
    }
  }

  /** The office's own token. Behind a proxy the server holds the credentials; the device sends none. */
  private async fetchToken(): Promise<string> {
    if (this.config.proxyUrl) return 'proxy';
    const t = await SimproClient.tokenExchange(this.config, { grant_type: 'client_credentials' });
    this.token = { accessToken: t.accessToken, expiresAt: expiresAtFrom(Date.now(), t.expiresInSeconds) };
    return t.accessToken;
  }

  /**
   * The signed-in person's token, or null when there is nobody signed in.
   *
   * A person's session comes first so that what they write is theirs in the
   * office system. A spent session is renewed with its refresh token; one the
   * server refuses to renew is ended, with the server's words kept for
   * Settings, and the office's key carries on underneath — a sync must not
   * stop because somebody's login lapsed overnight. A renewal that could not
   * be attempted at all — no signal, a server fault — is neither: it is
   * thrown, the request fails, and the session is kept for when it can.
   *
   * `renew` says the server has already refused the stored token, so the
   * clock is not to be trusted about it.
   */
  private async userToken(renew: boolean): Promise<string | null> {
    const session = await readUserSession();
    if (!session) return null;
    if (!renew && Date.now() < session.expiresAt) {
      this.token = { accessToken: session.accessToken, expiresAt: session.expiresAt };
      return session.accessToken;
    }
    if (!session.refreshToken) {
      await clearUserSession('Your Simpro sign-in expired and the build gave no way to renew it. Sign in again.');
      return null;
    }
    const renewed = await renewUserSession(this.config, { ...session, refreshToken: session.refreshToken });
    if (!renewed) return null;
    this.token = { accessToken: renewed.accessToken, expiresAt: renewed.expiresAt };
    return renewed.accessToken;
  }

  private async resolveToken(): Promise<string> {
    if (this.config.proxyUrl) return 'proxy';
    const renew = this.renewOnNextToken;
    this.renewOnNextToken = false;
    return (await this.userToken(renew)) ?? this.fetchToken();
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.accessToken;
    // Collapse concurrent refreshes so a burst of calls triggers one token request.
    if (!this.tokenPromise) {
      this.tokenPromise = this.resolveToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  /**
   * Forgets a token the server has just refused, so the next request renews.
   *
   * Only the token that was actually sent is discarded. A request that was in
   * flight with the old token when another request already fetched a new one
   * must not throw the new one away on a stale 401.
   */
  private discardToken(sent: string): void {
    if (this.token && this.token.accessToken !== sent) return;
    this.token = null;
    if (!this.tokenPromise) this.renewOnNextToken = true;
  }

  /**
   * Who the current token belongs to, in Simpro's words, or null where the
   * build does not offer the endpoint. Any field may be missing.
   */
  async currentUser(): Promise<CurrentUser | null> {
    try {
      const { data } = await this.request<{ ID?: number | string; Name?: string; Email?: string } | undefined>(
        'GET', `${this.apiRoot}/currentUser/`,
      );
      const who = data ?? {};
      return {
        id: who.ID !== undefined && who.ID !== null ? String(who.ID) : undefined,
        name: who.Name?.trim() || undefined,
        email: who.Email?.trim() || undefined,
      };
    } catch (e) {
      if (e instanceof SimproError && e.status === 404) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------------ pacing

  /** Spaces requests so the build's rate limit is never the reason a sync fails. */
  private async pace(): Promise<void> {
    const lane = laneFor(this.baseUrl);
    const interval = 1000 / REQUESTS_PER_SECOND;
    const now = Date.now();
    const wait = Math.max(0, lane.nextSlot - now);
    lane.nextSlot = Math.max(now, lane.nextSlot) + interval;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  /** Holds every client off the build for as long as a 429 asked, not just the one that saw it. */
  private backOff(ms: number): void {
    const lane = laneFor(this.baseUrl);
    lane.nextSlot = Math.max(lane.nextSlot, Date.now() + ms);
  }

  // ----------------------------------------------------------------- requests

  /**
   * One request, with the two answers that are worth a second attempt.
   *
   * A 401 means the server refused the token before acting, so the token is
   * renewed and the same request sent once more — safe for a POST for the
   * same reason. A 429 means it refused to look at all; the wait it asked for
   * is honoured once, shared with every other client so they stand off too,
   * and then the request goes again. Each is tried once. A token refused
   * twice or a limit still in force after the wait is reported, not looped
   * on.
   */
  async request<T>(method: string, path: string, options: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<{ data: T; total: number | null }> {
    const url = new URL(path.startsWith('http') ? path : `${this.companyRoot}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      url.searchParams.set(k, String(v));
    }
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    let renewed = false;
    let waited = false;
    for (;;) {
      await this.pace();
      const token = await this.getToken();

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (!this.config.proxyUrl) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(url.toString(), { method, headers, body });

      if (res.status === 401 && !this.config.proxyUrl) {
        if (!renewed) {
          renewed = true;
          this.discardToken(token);
          continue;
        }
        throw new SimproError(
          `Simpro rejected the token for ${path} even after renewing it. Sign in again, or check the client ID and secret in Settings.`,
          401,
          path,
        );
      }
      if (res.status === 429) {
        this.backOff(retryAfterMs(res.headers.get('Retry-After')));
        if (!waited) {
          waited = true;
          continue;
        }
        throw new SimproError(
          'Simpro rate limit reached, and still reached after waiting as long as it asked. The next sync will try again.',
          429,
          path,
        );
      }
      if (res.status === 403) {
        throw new SimproError(
          `This Simpro key is not permitted to read ${path}. API permissions are set per endpoint in Simpro.`,
          403,
          path,
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new SimproError(`Simpro returned HTTP ${res.status} for ${path}. ${text.slice(0, 200)}`, res.status, path);
      }

      const totalHeader = res.headers.get('Result-Total');
      const total = totalHeader ? parseInt(totalHeader, 10) : null;

      /*
       * Read as text first: a 204, or a 200 with nothing in it, is how the
       * build answers a write it has accepted, and asking JSON of an empty
       * body throws a parse error that reads as "no reply" three files away.
       */
      const text = await res.text();
      if (res.status === 204 || !text.trim()) return { data: undefined as T, total };
      try {
        return { data: JSON.parse(text) as T, total };
      } catch {
        throw new SimproUnreadableReply(
          `Simpro answered HTTP ${res.status} for ${path} but the reply could not be read.`,
          res.status,
          path,
        );
      }
    }
  }

  /**
   * Reads every page of a collection.
   *
   * `maxRecords` is a deliberate guard: pulling an entire multi-year job history
   * onto a phone over mobile data is rarely what anyone wanted.
   */
  async listAll<T>(path: string, query: Record<string, string | number> = {}, maxRecords = 5000): Promise<T[]> {
    return (await this.listAllPaged<T>(path, query, maxRecords)).items;
  }

  /**
   * The same read, saying whether it stopped early.
   *
   * `listAll` returns a bare array, so a caller cannot tell a complete list
   * from one cut off at `maxRecords` — and for one caller that difference
   * decides whether a service gets posted twice. Reading a job's notes to find
   * the markers this app wrote is a "have I already sent this" question, and a
   * truncated read answers it with a set that looks complete and is not: the
   * marker sits on note 240 of 300, is not in the first 200, and the send goes
   * out again.
   *
   * So truncation is reported rather than inferred. A caller that must be
   * certain can refuse; a caller pulling a list to show on a screen can carry
   * on, which is why `listAll` still exists and still returns an array.
   */
  async listAllPaged<T>(
    path: string,
    query: Record<string, string | number> = {},
    maxRecords = 5000,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const pageSize = 250;
    const out: T[] = [];
    let page = 1;
    let truncated = false;

    for (;;) {
      const { data, total } = await this.request<T[]>('GET', path, {
        query: { ...query, page, pageSize },
      });
      if (!Array.isArray(data) || data.length === 0) break;
      out.push(...data);

      if (out.length >= maxRecords) {
        /*
         * More only where the server said so, or where this page was full and
         * so there is very likely another. A full last page on a collection
         * that happens to end exactly there reports truncated when it is not,
         * which costs a caller caution rather than correctness.
         */
        truncated = total !== null ? out.length < total : data.length === pageSize;
        break;
      }
      if (total !== null && out.length >= total) break;
      if (data.length < pageSize) break;
      page++;
    }
    return { items: out, truncated };
  }

  /** Confirms credentials work and reports which endpoints this key may read. */
  async testConnection(): Promise<{ ok: boolean; companyId?: string; endpoints: { name: string; path: string; readable: boolean; total: number | null; error?: string }[] }> {
    const probes: { name: string; path: string }[] = [
      { name: 'Jobs', path: 'jobs/' },
      { name: 'Quotes', path: 'quotes/' },
      { name: 'Sites', path: 'sites/' },
      { name: 'Customers', path: 'customers/companies/' },
      { name: 'Employees', path: 'employees/' },
      { name: 'Schedules', path: 'schedules/' },
      { name: 'Timesheets', path: 'timesheets/' },
      { name: 'Customer assets', path: 'customerAssets/' },
      // Simpro calls these vendor orders. `purchaseOrders/` is not a route and
      // answers 404, which made a working key look half-broken in the report.
      { name: 'Purchase orders', path: 'vendorOrders/' },
      { name: 'Vendors', path: 'vendors/' },
      { name: 'Catalogs', path: 'catalogs/' },
    ];

    const endpoints: { name: string; path: string; readable: boolean; total: number | null; error?: string }[] = [];
    for (const probe of probes) {
      try {
        const { total } = await this.request<unknown[]>('GET', probe.path, { query: { page: 1, pageSize: 1 } });
        endpoints.push({ ...probe, readable: true, total });
      } catch (e) {
        endpoints.push({
          ...probe,
          readable: false,
          total: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ok: endpoints.some((e) => e.readable), companyId: this.config.companyId, endpoints };
  }

  /** Company IDs these credentials can see — needed before anything else works. */
  async listCompanies(): Promise<{ ID: number; Name: string }[]> {
    const { data } = await this.request<{ ID: number; Name: string }[] | undefined>('GET', `${this.apiRoot}/companies/`);
    return data ?? [];
  }

  /**
   * The whole setup in one action: authenticate, find the company, check access.
   *
   * Setting this up by hand used to mean four typed fields and then running the
   * test twice — the first run only discovered the company ID and told you to
   * run it again, because the client had already been built with the old blank
   * one. On a phone, in a van, that reads as broken. So the discovery happens
   * here, against a client that is rebuilt with the ID it just found, and the
   * caller gets one answer.
   *
   * The three stages are reported separately because they fail for different
   * reasons and want different fixes: a bad secret, a key with no company, or a
   * key whose per-endpoint permissions are too narrow. Collapsing them into one
   * boolean is what made a permissions problem look like a login problem.
   */
  async connect(): Promise<{
    authenticated: boolean;
    company: { id: string; name: string } | null;
    endpoints: { name: string; path: string; readable: boolean; total: number | null; error?: string }[];
    /** True only when the endpoints the app actually depends on are all readable. */
    ready: boolean;
    problem?: string;
  }> {
    const empty = { authenticated: false, company: null, endpoints: [], ready: false };

    // Say what is missing rather than letting the token request fail with it.
    const notConfigured = await SimproClient.missingCredentials(this.config);
    if (notConfigured) return { ...empty, problem: notConfigured };

    let companies: { ID: number; Name: string }[];
    try {
      companies = await this.listCompanies();
    } catch (e) {
      return { ...empty, problem: e instanceof SimproError ? e.message : String(e) };
    }

    // A company ID already configured wins, so an office with more than one
    // build does not get silently moved to whichever is listed first.
    const configured = this.config.companyId.trim();
    const chosen = configured
      ? (companies.find((c) => String(c.ID) === configured) ?? null)
      : (companies[0] ?? null);

    if (!chosen) {
      return {
        ...empty,
        authenticated: true,
        problem: configured
          ? `These credentials authenticated, but company ${configured} is not one they can see (${companies.map((c) => c.ID).join(', ') || 'none'}).`
          : 'These credentials authenticated but no company was visible to them.',
      };
    }

    // Rebuilt rather than mutated: `companyRoot` reads config on every request,
    // and a half-configured client that works only after a second call is the
    // bug this method exists to remove.
    const scoped = new SimproClient({ ...this.config, companyId: String(chosen.ID) });
    scoped.token = this.token;

    const { endpoints } = await scoped.testConnection();
    const missing = endpoints.filter((e) => REQUIRED_ENDPOINTS.includes(e.name) && !e.readable);

    return {
      authenticated: true,
      company: { id: String(chosen.ID), name: chosen.Name },
      endpoints,
      ready: missing.length === 0,
      problem: missing.length
        ? `Connected, but this key cannot read ${missing.map((m) => m.name).join(', ')}. Simpro sets API permissions per endpoint.`
        : undefined,
    };
  }
}
