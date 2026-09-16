/**
 * Setting a browser up from a link, rather than from a typed-in key.
 *
 * The web build reaches an iPhone where the APK cannot, and a browser that
 * has never been connected holds nothing: no sites, no jobs, no diary. The
 * office key is what turns it into the app. Reading a client id and a secret
 * off a screen and typing them into a phone keyboard is not something to ask
 * of somebody you are handing a link to.
 *
 * So the connection can travel in the link. What is deliberately NOT done is
 * put it in the published files: this repository is public and the built app
 * is served from GitHub Pages, so a key in the bundle is a key handed to
 * everybody who ever finds the address, permanently and in the history. A
 * link is different — it goes to the people it is sent to, in the message it
 * is sent in, and it can be replaced by rotating the key in Simpro.
 *
 * The connection rides in the URL's **fragment**, after the `#`. That is not
 * an aesthetic choice: a fragment is never transmitted to the server. It does
 * not appear in GitHub's request logs, in a proxy's, or in a Referer header
 * sent onward. A query string would appear in all three.
 *
 * Pure: builds a link, reads a link. Storing what it read is ./client's job
 * for the secret and the preferences' for the rest.
 */

import type { PastedConnection } from './oauthDetails';

/** The fragment key. Named so a person glancing at the link can see what it is. */
const PARAM = 'connect';

/**
 * base64url without padding: safe in a URL, and safe in the messaging apps
 * this gets pasted into, which is where `+` and `/` come unstuck.
 */
function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(text: string): string | undefined {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The link to send somebody, given where the app is served from.
 *
 * Only the three fields are carried, and only the ones that are set: this is
 * a connection, not a copy of the sender's preferences.
 */
export function buildConnectLink(appUrl: string, connection: PastedConnection): string {
  const payload: Record<string, string> = {};
  if (connection.domain) payload.d = connection.domain;
  if (connection.clientId) payload.i = connection.clientId;
  if (connection.clientSecret) payload.s = connection.clientSecret;
  const base = appUrl.split('#')[0] ?? appUrl;
  return `${base}#${PARAM}=${encode(JSON.stringify(payload))}`;
}

/**
 * The connection out of a link, or nothing.
 *
 * Nothing is the normal answer: this is read on every start of the web app,
 * and almost every start has an ordinary fragment or none at all. Anything
 * that is not a well-formed payload — a truncated link, a fragment that
 * happens to begin with the same word, a router path — comes back undefined
 * rather than half a connection.
 */
export function readConnectLink(url: string): PastedConnection | undefined {
  const fragment = url.split('#')[1];
  if (!fragment) return undefined;
  const found = new RegExp(`(?:^|&)${PARAM}=([A-Za-z0-9\\-_]+)`).exec(fragment);
  if (!found) return undefined;
  const json = decode(found[1]!);
  if (!json) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const text = (v: unknown): string | undefined =>
    (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const connection: PastedConnection = {
    domain: text(p.d),
    clientId: text(p.i),
    clientSecret: text(p.s),
  };
  return connection.domain || connection.clientId || connection.clientSecret ? connection : undefined;
}

/**
 * The same link with the connection taken out of it.
 *
 * Used to rewrite the address bar the moment the link has been read, so the
 * key is not left sitting in the bar to be screenshotted, read over a
 * shoulder, or carried into a bookmark or a shared tab.
 */
export function linkWithoutConnection(url: string): string {
  const base = url.split('#')[0] ?? url;
  const fragment = url.split('#')[1];
  if (!fragment) return url;
  const kept = fragment
    .split('&')
    .filter((part) => !part.startsWith(`${PARAM}=`))
    .join('&');
  return kept ? `${base}#${kept}` : base;
}
