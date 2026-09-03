/**
 * Simpro's OAuth2 exchanges, as data.
 *
 * Every phone used to share one identity with the office system: an API key
 * (client_credentials) whose secret sits in the keystore. Simpro's token server
 * grants more than that. It also issues a token to a *person* — the same
 * username and password they use for Simpro Mobile — either typed straight in
 * (the password grant) or through Simpro's own login page in the system
 * browser (the authorization code grant, which is how single sign-on and
 * two-factor logins work, because the app never sees the password at all).
 *
 * This module is the pure half of that: the URLs, the request bodies and the
 * reading of what comes back. It touches no keystore, no network and no
 * browser, so every rule in it can be tested. ./auth and ./userSession do the
 * touching.
 */

/** The parts of the connection the token exchanges need. A structural subset of SimproConfig. */
export interface OAuthTarget {
  buildDomain: string;
  clientId: string;
  proxyUrl?: string;
}

/**
 * Refresh this far ahead of expiry so an in-flight request never carries a
 * dead token. One margin for both kinds of token: the API key's and a
 * person's, so a long sync near the end of either lifetime does not fail
 * halfway through.
 */
export const EXPIRY_MARGIN_SECONDS = 120;

/**
 * Where a person signs in, and where a code or a password becomes a token.
 *
 * Both paths are taken from Simpro's API documentation for its OAuth 2.0
 * server. The token path is already proven — every sync goes through it. The
 * login path is confirmed on a device against the real build, not here: this
 * sandbox cannot reach the build, and a path that is wrong shows up as the
 * server's own error text on the sign-in screen, which is why that text is
 * shown verbatim rather than paraphrased.
 */
export const AUTHORIZE_PATH = '/oauth2/login';
export const TOKEN_PATH = '/oauth2/token';

/**
 * Where the browser hands the code back to the app.
 *
 * The `safeqld` scheme is registered in app.json. Simpro only redirects to a
 * URI that matches the one registered on the API application in its own
 * setup, exactly — so this string is also what the office types into Simpro,
 * and a mismatch comes back as an error from the login page, not from here.
 */
export const REDIRECT_URI = 'safeqld://oauth';

/** Where token requests go. Behind a proxy that is the proxy, which holds the secret. */
export function tokenUrl(target: OAuthTarget): string {
  const base = target.proxyUrl ?? `https://${target.buildDomain}`;
  return `${base.replace(/\/$/, '')}${TOKEN_PATH}`;
}

/**
 * The login page, always on the build itself.
 *
 * A proxy can hold the secret and forward the code exchange, but it cannot
 * show a person Simpro's login page — that page is Simpro's, and it is the
 * page that handles two-factor prompts and single sign-on.
 */
export function authorizeUrl(target: OAuthTarget, state: string): string {
  const params = new URLSearchParams({
    client_id: target.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `https://${target.buildDomain}${AUTHORIZE_PATH}?${params.toString()}`;
}

/** The grants the app uses, each with only the fields its request carries. */
export type TokenGrant =
  | { grant_type: 'client_credentials' }
  | { grant_type: 'password'; username: string; password: string }
  | { grant_type: 'authorization_code'; code: string; redirect_uri: string }
  | { grant_type: 'refresh_token'; refresh_token: string };

/**
 * The form body for a token request.
 *
 * The client id always goes; the secret goes only when the device holds one.
 * Behind a proxy the device holds none and the proxy adds its own, which is
 * the whole reason the proxy exists.
 */
export function tokenRequestBody(target: OAuthTarget, grant: TokenGrant, clientSecret: string | undefined): string {
  const fields: Record<string, string> = { ...grant, client_id: target.clientId };
  if (clientSecret) fields.client_secret = clientSecret;
  return new URLSearchParams(fields).toString();
}

export interface TokenSet {
  accessToken: string;
  /** Not every grant returns one. client_credentials never does; a person's login usually does. */
  refreshToken?: string;
  expiresInSeconds: number;
}

/**
 * Reads a token response.
 *
 * A response with no access token is refused rather than passed on as an
 * empty bearer: every request would then fail with a 401 that reads as a
 * permissions problem, three screens away from the exchange that caused it.
 * The refresh token is optional because the API key's grant never carries
 * one, and the lifetime defaults to Simpro's documented hour.
 */
export function parseTokenResponse(json: unknown): TokenSet {
  const body = (json ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
  if (!accessToken) throw new Error('Simpro returned no access token.');
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token.trim()
    ? body.refresh_token.trim()
    : undefined;
  const lifetime = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
    ? body.expires_in
    : 3600;
  return { accessToken, refreshToken, expiresInSeconds: lifetime };
}

/** The instant a token is treated as spent, with the margin already taken off. */
export function expiresAtFrom(nowMs: number, expiresInSeconds: number): number {
  return nowMs + (expiresInSeconds - EXPIRY_MARGIN_SECONDS) * 1000;
}

export interface AuthRedirect {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * What the login page sent back on the redirect.
 *
 * Read by hand rather than through URL: a custom scheme like `safeqld://`
 * is exactly the kind of URL a partial implementation parses differently from
 * a browser, and the fields here are three plain query parameters. Both the
 * query and the fragment are read, because a server that was configured for
 * the implicit flow answers in the fragment.
 */
export function parseAuthRedirect(url: string): AuthRedirect {
  const out: AuthRedirect = {};
  const afterScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^?#]*/i, '');
  for (const part of afterScheme.split(/[?#]/)) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = decode(eq === -1 ? pair : pair.slice(0, eq));
      const value = decode(eq === -1 ? '' : pair.slice(eq + 1));
      if (key === 'code' && value) out.code = value;
      else if (key === 'state' && value) out.state = value;
      else if (key === 'error' && value) out.error = value;
      else if (key === 'error_description' && value) out.errorDescription = value;
    }
  }
  return out;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/**
 * A refusal from the token server, in a sentence that keeps the server's words.
 *
 * The server's text is the only thing that says which of several quite
 * different problems this is — a grant this build does not allow, a wrong
 * password, a code that expired, a redirect URI that does not match the one
 * registered in Simpro — and each of those is fixed somewhere different. So
 * the exact `error` and `error_description` go on the screen, and a hint
 * follows for the ones with a known fix.
 */
export function describeOAuthFailure(status: number, bodyText: string): string {
  let error = '';
  let description = '';
  try {
    const json = JSON.parse(bodyText) as { error?: unknown; error_description?: unknown; message?: unknown };
    if (typeof json.error === 'string') error = json.error;
    if (typeof json.error_description === 'string') description = json.error_description;
    else if (typeof json.message === 'string') description = json.message;
  } catch {
    description = bodyText.trim().slice(0, 300);
  }

  const said = [error, description].filter(Boolean).join(' — ') || '(no detail in the response)';
  const hint = HINTS[error] ?? (/redirect/i.test(description) ? HINTS.redirect_uri_mismatch : undefined);
  return `Simpro refused the sign-in (HTTP ${status}): ${said}.${hint ? ` ${hint}` : ''}`;
}

const HINTS: Record<string, string> = {
  unsupported_grant_type:
    'This build does not allow that way of signing in for this API application. '
    + 'Try the other one, or ask Simpro support to enable it on the application.',
  invalid_grant:
    'The username or password was wrong, or the login code had already expired. Try again.',
  invalid_client:
    'The client ID or secret in Settings was rejected. Check them, and that the secret has not been regenerated.',
  invalid_request:
    'Something in the request was missing. If this happened in the browser, check the Redirect URI '
    + `on the API application in Simpro is exactly ${REDIRECT_URI}.`,
  redirect_uri_mismatch:
    `The Redirect URI on the API application in Simpro has to be exactly ${REDIRECT_URI}.`,
  access_denied: 'The login was refused or cancelled on Simpro\'s side.',
};
