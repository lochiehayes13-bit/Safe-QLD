import type { OAuthTarget } from './oauth';

/**
 * The office's API application, shipped inside the app.
 *
 * Every phone used to need the client secret pasted into it before it could
 * talk to Simpro at all, and until somebody did that the app was a set of
 * empty lists that read as broken. The owner's decision, made twice with the
 * risk spelled out, is that the app ships ready: this is the "Operations
 * Dashboard" application in Simpro's System Setup → API, and it is the only
 * credential a handset needs.
 *
 * What that costs, said plainly. Anyone who unpacks the bundle can read this
 * file, and with it can read what the application can read. That is why it
 * is one file with one constant: rotating the secret in Simpro and changing
 * one line here is the whole of a revocation, and a rotated secret pasted in
 * Settings takes over on a phone before the next build reaches it — see
 * `SimproClient.secretFor`.
 *
 * A person signing in with their own Simpro login still goes through this
 * application: the token server wants the client id and secret on a password
 * grant too. The application is the door; the login is who walks through it.
 */
export const OFFICE_APPLICATION = {
  name: 'Operations Dashboard',
  buildDomain: 'safeqld.simprosuite.com',
  /** Zero on this build, which is why it is a string: as a number it would read as "not set". */
  companyId: '0',
  clientId: '6564738df3bba3cd587e3dacb58a1d',
  clientSecret: '824c148c10',
} as const;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a configuration is the shipped application, and so may use its secret.
 *
 * The build domain is checked as well as the client id. A different build
 * with the same id is not something Simpro does, but a secret sent to the
 * wrong host is the one mistake this file must not be able to make.
 */
export function isOfficeApplication(target: Pick<OAuthTarget, 'buildDomain' | 'clientId' | 'proxyUrl'>): boolean {
  if (target.proxyUrl) return false;
  return same(target.buildDomain, OFFICE_APPLICATION.buildDomain) && same(target.clientId, OFFICE_APPLICATION.clientId);
}

/** The shipped secret where the configuration is the shipped application; nothing otherwise. */
export function shippedSecretFor(target: Pick<OAuthTarget, 'buildDomain' | 'clientId' | 'proxyUrl'>): string | undefined {
  return isOfficeApplication(target) ? OFFICE_APPLICATION.clientSecret : undefined;
}
