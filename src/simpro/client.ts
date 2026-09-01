import * as SecureStore from 'expo-secure-store';

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

/** Refresh this far ahead of expiry so an in-flight request never carries a dead token. */
const EXPIRY_MARGIN_SECONDS = 120;

/** The build limit is 10/sec; pacing below it leaves headroom for office traffic. */
const REQUESTS_PER_SECOND = 8;

export interface SimproConfig {
  /** Host you log into Simpro with, e.g. "safeqld.simprosuite.com". */
  buildDomain: string;
  companyId: string;
  clientId: string;
  /** When set, requests go here instead of directly to Simpro and no secret is stored on device. */
  proxyUrl?: string;
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

  static async clearSecret(): Promise<void> {
    await SecureStore.deleteItemAsync(SECRET_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }

  // ------------------------------------------------------------------- token

  private async fetchToken(): Promise<string> {
    // Behind a proxy the server holds the credentials; the device sends none.
    if (this.config.proxyUrl) return 'proxy';

    const secret = await SecureStore.getItemAsync(SECRET_KEY);
    if (!secret) {
      throw new SimproError('No Simpro client secret is stored on this device. Add it in Settings.');
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: secret,
    }).toString();

    const res = await fetch(`https://${this.config.buildDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SimproError(
        res.status === 401
          ? 'Simpro rejected the client ID or secret. Check them in Settings.'
          : `Could not get a Simpro token (HTTP ${res.status}). ${text.slice(0, 200)}`,
        res.status,
      );
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new SimproError('Simpro returned no access token.');

    const lifetime = json.expires_in ?? 3600;
    this.token = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (lifetime - EXPIRY_MARGIN_SECONDS) * 1000,
    };
    return json.access_token;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.accessToken;
    // Collapse concurrent refreshes so a burst of calls triggers one token request.
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
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
      { name: 'Purchase orders', path: 'purchaseOrders/' },
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
}
