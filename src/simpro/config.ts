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
