import type { Prefs } from '@/app-prefs';
import type { SimproConfig } from './client';

/**
 * The Simpro connection as the preferences describe it.
 *
 * Built in one place because it was built in four — twice in Settings, once
 * on the outbound screen, and now once for the automatic sync — and the one
 * rule in it is exactly the kind that drifts when copied: an empty proxy URL
 * means no proxy, not a proxy at ''. A copy that forgot the `|| undefined`
 * would send every request to an empty host and report it as the proxy being
 * down.
 */
export function simproConfigFromPrefs(
  prefs: Pick<Prefs, 'simproDomain' | 'simproCompanyId' | 'simproClientId' | 'simproProxyUrl'>,
): SimproConfig {
  return {
    buildDomain: prefs.simproDomain,
    companyId: prefs.simproCompanyId,
    clientId: prefs.simproClientId,
    proxyUrl: prefs.simproProxyUrl || undefined,
  };
}

/**
 * The application a sign-in goes through.
 *
 * The office's application cannot sign a person in — its Authentication
 * Method in Simpro is Client Credentials, which is what lets a phone reach
 * the office with nobody logged in. Where the office has made a second
 * application that allows logins, its id is here and the sign-in uses it,
 * with its own secret in its own keystore slot. Where they have not, this is
 * the office's application and the sign-in screen already knows what that
 * means: the staff list is the way in.
 */
export function signInConfigFromPrefs(
  prefs: Pick<Prefs, 'simproDomain' | 'simproCompanyId' | 'simproClientId' | 'simproSignInClientId' | 'simproProxyUrl'>,
): SimproConfig {
  const own = prefs.simproSignInClientId.trim();
  if (!own) return simproConfigFromPrefs(prefs);
  return {
    buildDomain: prefs.simproDomain,
    companyId: prefs.simproCompanyId,
    clientId: own,
    proxyUrl: prefs.simproProxyUrl || undefined,
    application: 'signin',
  };
}

/** Whether the office has made an application that can sign a person in. */
export function hasSignInApplication(prefs: Pick<Prefs, 'simproSignInClientId'>): boolean {
  return prefs.simproSignInClientId.trim().length > 0;
}
