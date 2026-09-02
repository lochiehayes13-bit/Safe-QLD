import * as SecureStore from 'expo-secure-store';
import {
  describeOAuthFailure, expiresAtFrom, parseTokenResponse, tokenRequestBody, tokenUrl,
  type TokenGrant, type TokenSet,
} from './oauth';
import { clearUserSession, readUserSession, writeUserSession } from './userSession';
import type { CurrentUser } from './identity';

/**
 * Simpro REST API client.
 *
 * Mirrors the Python toolkit already in use for back-office work, with the
 * constraints that matter in the field:
 *
 *  - Tokens are refreshed before they expire rather than after a 401, so a long
 *    sync does not fail because the clock ticked over mid-run.
 *  - Requests are paced below the documented 10/sec build limit; going over
 *    returns 429 for everyone using the build, not just this device.
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

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class SimproClient {
  private token: CachedToken | null = null;
  private tokenPromise: Promise<string> | null = null;
  /** Timestamp the next request may be sent, for rate pacing. */
  private nextSlot = 0;

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
   */
  static async tokenExchange(config: SimproConfig, grant: TokenGrant): Promise<TokenSet> {
    const secret = config.proxyUrl ? undefined : ((await SecureStore.getItemAsync(SECRET_KEY)) ?? undefined);
    if (!config.proxyUrl && !secret) {
      throw new SimproError('No Simpro client secret is stored on this device. Add it in Settings.');
    }

    const res = await fetch(tokenUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenRequestBody(config, grant, secret),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (grant.grant_type === 'client_credentials') {
        // Simpro answers bad client credentials with 400 and an `invalid_client`
        // body, not 401. Matching only on 401 meant the one error a person can
        // actually fix surfaced as a raw HTTP dump with a JSON blob in it.
        const badCredentials = res.status === 401 || (res.status === 400 && text.includes('invalid_client'));
        throw new SimproError(
          badCredentials
            ? 'Simpro rejected the client ID or secret. Check them in Settings, and confirm the secret has not been regenerated.'
            : `Could not get a Simpro token (HTTP ${res.status}). ${text.slice(0, 200)}`,
          res.status,
        );
      }
      throw new SimproError(describeOAuthFailure(res.status, text), res.status);
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
   * server will not renew is ended, with the server's words kept for
   * Settings, and the office's key carries on underneath — a sync must not
   * stop because somebody's login lapsed overnight.
   */
  private async userToken(): Promise<string | null> {
    const session = await readUserSession();
    if (!session) return null;
    if (Date.now() < session.expiresAt) {
      this.token = { accessToken: session.accessToken, expiresAt: session.expiresAt };
      return session.accessToken;
    }
    if (!session.refreshToken) {
      await clearUserSession('Your Simpro sign-in expired and the build gave no way to renew it. Sign in again.');
      return null;
    }
    try {
      const t = await SimproClient.tokenExchange(this.config, {
        grant_type: 'refresh_token', refresh_token: session.refreshToken,
      });
      const expiresAt = expiresAtFrom(Date.now(), t.expiresInSeconds);
      await writeUserSession({
        accessToken: t.accessToken,
        refreshToken: t.refreshToken ?? session.refreshToken,
        expiresAt,
        label: session.label,
      });
      this.token = { accessToken: t.accessToken, expiresAt };
      return t.accessToken;
    } catch (e) {
      await clearUserSession(`Simpro would not renew your sign-in: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private async resolveToken(): Promise<string> {
    if (this.config.proxyUrl) return 'proxy';
    return (await this.userToken()) ?? this.fetchToken();
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
   * Who the current token belongs to, in Simpro's words, or null where the
   * build does not offer the endpoint. Any field may be missing.
   */
  async currentUser(): Promise<CurrentUser | null> {
    try {
      const { data } = await this.request<{ ID?: number | string; Name?: string; Email?: string }>(
        'GET', `${this.apiRoot}/currentUser/`,
      );
      return {
        id: data.ID !== undefined && data.ID !== null ? String(data.ID) : undefined,
        name: data.Name?.trim() || undefined,
        email: data.Email?.trim() || undefined,
      };
    } catch (e) {
      if (e instanceof SimproError && e.status === 404) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------------ paceing

  /** Spaces requests so the build's rate limit is never the reason a sync fails. */
  private async pace(): Promise<void> {
    const interval = 1000 / REQUESTS_PER_SECOND;
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + interval;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  // ----------------------------------------------------------------- requests

  async request<T>(method: string, path: string, options: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<{ data: T; total: number | null }> {
    await this.pace();
    const token = await this.getToken();

    const url = new URL(path.startsWith('http') ? path : `${this.companyRoot}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!this.config.proxyUrl) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (res.status === 429) {
      throw new SimproError('Simpro rate limit reached. The sync will retry shortly.', 429, path);
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
    const data = (await res.json()) as T;
    return { data, total: totalHeader ? parseInt(totalHeader, 10) : null };
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
    const { data } = await this.request<{ ID: number; Name: string }[]>('GET', `${this.apiRoot}/companies/`);
    return data;
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
