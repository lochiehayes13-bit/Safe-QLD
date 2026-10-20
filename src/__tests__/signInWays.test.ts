import { buildKey, readRefused, withRefusal } from '@/domain/signInWays';
import { classifySignInRefusal } from '@/simpro/oauth';

/**
 * Remembering which way in a build refuses.
 *
 * Both ways of signing in as yourself depend on a setting on the office's API
 * application: the password grant has to be allowed, and the browser's
 * redirect has to be registered. Where one is not, Simpro refuses every
 * attempt at it identically, so the screen has to stop offering it first —
 * otherwise a technician meets the same wall on every phone, every time, and
 * concludes their login is wrong.
 */

const CONFIG = { buildDomain: 'safeqld.simprosuite.com', clientId: '6564738df3bba3cd587e3dacb58a1d' };
const KEY = buildKey(CONFIG);

describe('which build refused', () => {
  it('is one office\'s application, not the app', () => {
    expect(KEY).toBe('safeqld.simprosuite.com|6564738df3bba3cd587e3dacb58a1d');
    // Case and stray spaces come from a pasted setting, and are not a
    // different office.
    expect(buildKey({ buildDomain: '  SafeQLD.simprosuite.com ', clientId: ' 6564738df3bba3cd587e3dacb58a1d ' })).toBe(KEY);
    // A different build, or a replaced application, starts from nothing.
    expect(buildKey({ buildDomain: 'other.simprosuite.com', clientId: '6564738df3bba3cd587e3dacb58a1d' })).not.toBe(KEY);
    expect(buildKey({ ...CONFIG, clientId: 'new-application' })).not.toBe(KEY);
  });
});

describe('what is remembered', () => {
  it('is nothing at all until a build refuses something', () => {
    expect(readRefused(null, KEY)).toEqual({ password: false, browser: false });
    expect(readRefused('{}', KEY)).toEqual({ password: false, browser: false });
  });

  it('keeps the two ways apart', () => {
    const raw = withRefusal(null, KEY, 'password', true);
    expect(readRefused(raw, KEY)).toEqual({ password: true, browser: false });
    const both = withRefusal(raw, KEY, 'browser', true);
    expect(readRefused(both, KEY)).toEqual({ password: true, browser: true });
  });

  it('forgets a way that has started working, and leaves the other alone', () => {
    const both = withRefusal(withRefusal(null, KEY, 'password', true), KEY, 'browser', true);
    const fixed = withRefusal(both, KEY, 'browser', false);
    expect(readRefused(fixed, KEY)).toEqual({ password: true, browser: false });
    // Nothing refused any more: the office's row goes rather than lingering.
    expect(JSON.parse(withRefusal(fixed, KEY, 'password', false))).toEqual({});
  });

  it('is per build, so one office\'s setting says nothing about another\'s', () => {
    const other = buildKey({ buildDomain: 'other.simprosuite.com', clientId: 'x' });
    const raw = withRefusal(null, KEY, 'password', true);
    expect(readRefused(raw, other)).toEqual({ password: false, browser: false });
  });

  it('survives a stored value that will not read', () => {
    expect(readRefused('not json', KEY)).toEqual({ password: false, browser: false });
    expect(readRefused('[]', KEY)).toEqual({ password: false, browser: false });
    expect(readRefused(JSON.stringify({ [KEY]: 'yes' }), KEY)).toEqual({ password: false, browser: false });
    expect(readRefused(JSON.stringify({ [KEY]: { password: 'yes' } }), KEY)).toEqual({ password: false, browser: false });
    // A write over a broken value starts the map again rather than throwing.
    expect(readRefused(withRefusal('not json', KEY, 'password', true), KEY)).toEqual({ password: true, browser: false });
  });
});

describe('reading Simpro\'s own words', () => {
  it('tells a grant that is switched off from a redirect that is not registered', () => {
    // The two refusals this office's build actually gives, verbatim.
    expect(classifySignInRefusal('Simpro refused the sign-in (HTTP 400): unauthorized_client — The grant type is unauthorized for this client_id.'))
      .toBe('grant');
    expect(classifySignInRefusal('{"error":"redirect_uri_mismatch","error_description":"The redirect URI provided is missing or does not match"}'))
      .toBe('redirect');
    // A wrong password is the person's to fix, and stays that way.
    expect(classifySignInRefusal('invalid_grant — bad credentials')).toBe('password');
    expect(classifySignInRefusal('invalid_client')).toBe('client');
    expect(classifySignInRefusal('something else entirely')).toBe('other');
  });
});
