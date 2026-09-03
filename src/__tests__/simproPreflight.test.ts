import { SimproClient, type SimproConfig } from '@/simpro/client';
import { DEFAULT_PREFS } from '@/app-prefs';

const store = require('@/__mocks__/expo-secure-store') as { __reset?: () => void };

/**
 * The check that runs before a sync does.
 *
 * On the first real install, a technician tapped sync before pasting the
 * secret. Every stage then failed on its own and the dialog read:
 *
 *   sites: No Simpro client secret is stored on this device.
 *   jobs: No Simpro client secret is stored on this device.
 *   assets: No Simpro client secret is stored on this device.
 *   Labour rates: No Simpro client secret is stored on this device.
 *   Service fees: No Simpro client secret is stored on this device.
 *
 * Five lines, one unticked box. It reads as five faults, and the instruction
 * that fixes all of them is buried in the repetition. One check up front, one
 * sentence back.
 */

function config(over: Partial<SimproConfig> = {}): SimproConfig {
  return {
    buildDomain: DEFAULT_PREFS.simproDomain,
    companyId: DEFAULT_PREFS.simproCompanyId,
    clientId: DEFAULT_PREFS.simproClientId,
    ...over,
  };
}

beforeEach(() => {
  store.__reset?.();
});

describe('missingCredentials', () => {
  it('names the secret when everything else is already filled in', async () => {
    const reason = await SimproClient.missingCredentials(config());
    expect(reason).toMatch(/client secret/i);
    // The build ships with the domain, company and client ID set, so the
    // message must not send someone hunting for those too.
    expect(reason).toMatch(/already filled in/i);
  });

  it('passes once a secret is stored', async () => {
    await SimproClient.storeSecret('a-secret');
    expect(await SimproClient.missingCredentials(config())).toBeNull();
  });

  it('passes with a proxy and no secret at all', async () => {
    // The whole point of the proxy: the handset holds nothing.
    expect(await SimproClient.missingCredentials(config({ proxyUrl: 'https://example.invalid/simpro' })))
      .toBeNull();
  });

  it.each([
    ['build domain', { buildDomain: '' }, /build domain/i],
    ['build domain of only spaces', { buildDomain: '   ' }, /build domain/i],
    ['client ID', { clientId: '' }, /client id/i],
  ])('names a missing %s', async (_what, over, pattern) => {
    await SimproClient.storeSecret('a-secret');
    expect(await SimproClient.missingCredentials(config(over))).toMatch(pattern);
  });

  it('reports one thing at a time, starting with what is checked first', async () => {
    // Everything missing at once. A list of three faults is not more useful
    // than the first one to fix.
    const reason = await SimproClient.missingCredentials(config({ buildDomain: '', clientId: '' }));
    expect(reason).toMatch(/build domain/i);
    expect(reason).not.toMatch(/client id/i);
  });

  it('does not treat company 0 as unconfigured', async () => {
    // This build's company ID is literally 0. A falsy check here would call a
    // correctly configured install blank.
    await SimproClient.storeSecret('a-secret');
    expect(await SimproClient.missingCredentials(config({ companyId: '0' }))).toBeNull();
  });
});

describe('connect() before a secret exists', () => {
  it('says what to do instead of failing on the token request', async () => {
    const report = await new SimproClient(config()).connect();
    expect(report.authenticated).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.problem).toMatch(/client secret/i);
    // No endpoint probing happened, so no misleading list of "no access" rows.
    expect(report.endpoints).toEqual([]);
  });
});
