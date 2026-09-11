import { hasSignInApplication, signInConfigFromPrefs, simproConfigFromPrefs } from '@/simpro/config';
import { DEFAULT_PREFS } from '@/app-prefs';

/**
 * Which of the office's API applications a sign-in goes through.
 *
 * An application in Simpro has one Authentication Method, fixed when it is
 * made. The office's is Client Credentials: it is how a phone reaches Simpro
 * with nobody logged in, and it refuses every login by design — no password
 * and no visit to Simpro's login page will ever get through it. An
 * application that can sign a person in is a second one, with its own id and
 * its own secret, and until the office makes one the staff list is the way
 * in.
 */

const PREFS = { ...DEFAULT_PREFS };

describe('the application a sign-in goes through', () => {
  it('is the office\'s own until a second one is named, which is what the screen reads', () => {
    expect(hasSignInApplication(PREFS)).toBe(false);
    expect(signInConfigFromPrefs(PREFS)).toEqual(simproConfigFromPrefs(PREFS));
    // No `application`, so the office's shipped secret still applies to it.
    expect(signInConfigFromPrefs(PREFS).application).toBeUndefined();
  });

  it('is the second application once the office has made one', () => {
    const withOwn = { ...PREFS, simproSignInClientId: ' abc123 ' };
    expect(hasSignInApplication(withOwn)).toBe(true);
    expect(signInConfigFromPrefs(withOwn)).toEqual({
      buildDomain: PREFS.simproDomain,
      companyId: PREFS.simproCompanyId,
      clientId: 'abc123',
      proxyUrl: undefined,
      // Marked, so its own secret is read and never the office's.
      application: 'signin',
    });
    // Everything else on the phone still talks as the office.
    expect(simproConfigFromPrefs(withOwn).clientId).toBe(PREFS.simproClientId);
  });

  it('goes through the proxy too, where the office runs one', () => {
    const proxied = { ...PREFS, simproSignInClientId: 'abc123', simproProxyUrl: 'https://api.example.invalid/simpro' };
    expect(signInConfigFromPrefs(proxied).proxyUrl).toBe('https://api.example.invalid/simpro');
  });

  it('treats whitespace as nothing, since a cleared field is often spaces', () => {
    expect(hasSignInApplication({ ...PREFS, simproSignInClientId: '   ' })).toBe(false);
    expect(signInConfigFromPrefs({ ...PREFS, simproSignInClientId: '   ' }).application).toBeUndefined();
  });
});
