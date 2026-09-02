import * as WebBrowser from 'expo-web-browser';
import { SimproClient, SimproError, type SimproConfig } from './client';
import { REDIRECT_URI, authorizeUrl, expiresAtFrom, parseAuthRedirect, type TokenSet } from './oauth';
import { clearUserSession, writeUserSession } from './userSession';
import type { CurrentUser } from './identity';

/**
 * Signing in to Simpro as a person.
 *
 * Two ways in, both ending in the same place: a token for this person in the
 * keystore, and Simpro's own answer to "who is this", where the build gives
 * one.
 *
 * The browser flow is the preferred one. It opens Simpro's login page in the
 * system browser — the page Simpro Mobile uses — so a two-factor prompt or a
 * single sign-on redirect works without this app knowing anything about
 * either, and the password never passes through the app at all. The password
 * flow is the fallback for a build where that grant is not enabled on the
 * API application, and for a phone with no browser worth the name.
 *
 * Nothing here decides who the person *is* in the staff list; that is
 * ./identity's, and it is pure. This module only touches things: the
 * browser, the network and the keystore.
 */

/** Something a login page cannot guess, so a redirect that arrives out of the blue is refused. */
function newState(): string {
  let out = '';
  for (let i = 0; i < 24; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

async function keep(tokens: TokenSet, label: string | undefined): Promise<void> {
  await writeUserSession({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: expiresAtFrom(Date.now(), tokens.expiresInSeconds),
    label,
  });
}

/**
 * Who Simpro says the new token belongs to, or null where the build does not
 * say. Asked straight after a sign-in, while the session is certainly fresh.
 */
async function whoAmI(config: SimproConfig): Promise<CurrentUser | null> {
  return new SimproClient(config).currentUser();
}

/**
 * Username and password, straight to the token server.
 *
 * The same login as Simpro Mobile. The password goes to Simpro once, in the
 * token request, and is not kept: what is kept is the token pair that comes
 * back. A refusal carries the server's own words — `invalid_grant` for a
 * wrong password, `unsupported_grant_type` for a build that does not allow
 * this — because those words are what the office needs to fix it.
 */
export async function signInWithPassword(
  config: SimproConfig,
  username: string,
  password: string,
): Promise<CurrentUser | null> {
  const user = username.trim();
  if (!user || !password) throw new SimproError('Type your Simpro username and password.');
  const tokens = await SimproClient.tokenExchange(config, { grant_type: 'password', username: user, password });
  await keep(tokens, user);
  const who = await whoAmI(config);
  if (who?.name) await relabel(tokens, who.name);
  return who;
}

/**
 * Simpro's own login page, in the system browser.
 *
 * The page redirects back to `safeqld://oauth` with a one-time code, which is
 * exchanged for tokens here. Simpro will only redirect to a URI that exactly
 * matches the one registered on the API application in its setup, so a
 * mismatch never reaches this code — it shows on the login page as an error,
 * and the browser is closed by the person, which comes back as a cancel.
 */
export async function signInInBrowser(config: SimproConfig): Promise<CurrentUser | null> {
  if (!config.buildDomain.trim()) throw new SimproError('No Simpro build domain is set. Add it in Settings.');
  if (!config.clientId.trim()) throw new SimproError('No Simpro client ID is set. Add it in Settings.');

  const state = newState();
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl(config, state), REDIRECT_URI);

  if (result.type !== 'success') {
    throw new SimproError(
      result.type === 'cancel' || result.type === 'dismiss'
        ? 'The browser was closed before Simpro handed back a login. If the page showed an error, '
          + `check the Redirect URI on the API application in Simpro is exactly ${REDIRECT_URI}.`
        : `The browser came back with "${result.type}" before Simpro handed back a login.`,
    );
  }

  const redirect = parseAuthRedirect(result.url);
  if (redirect.error) {
    throw new SimproError(
      `Simpro refused the sign-in: ${redirect.error}${redirect.errorDescription ? ` — ${redirect.errorDescription}` : ''}.`,
    );
  }
  if (!redirect.code) {
    throw new SimproError(`Simpro came back without a login code. The browser returned: ${result.url}`);
  }
  if (redirect.state !== state) {
    // A code this app did not ask for is not one it will exchange.
    throw new SimproError('The login that came back was not the one this app started. Try again.');
  }

  const tokens = await SimproClient.tokenExchange(config, {
    grant_type: 'authorization_code',
    code: redirect.code,
    redirect_uri: REDIRECT_URI,
  });
  await keep(tokens, undefined);
  const who = await whoAmI(config);
  if (who?.name || who?.email) await relabel(tokens, who.name ?? who.email);
  return who;
}

/** The Settings line names the person where Simpro said who they are, not just the tokens. */
async function relabel(tokens: TokenSet, label: string | undefined): Promise<void> {
  await keep(tokens, label);
}

/** Ends the person's session. The office's API key and its secret stay where they are. */
export async function signOut(): Promise<void> {
  await clearUserSession();
}
