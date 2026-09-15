import {
  isPicked, prefsForEmployee, prefsForNobody, repairPick, resolveIdentity, searchEmployees,
  type IdentityCandidate, type IdentityPrefs,
} from '@/simpro/identity';
import {
  APP_REDIRECT_URI, authorizeUrl, describeOAuthFailure, expiresAtFrom, parseAuthRedirect, parseTokenResponse,
  redirectUriFor, webBase,
  tokenRequestBody, tokenUrl,
} from '@/simpro/oauth';

/**
 * Who the phone belongs to, and the exchanges that decide it.
 *
 * The failure worth guarding is a phone that becomes somebody else: a login
 * matched to the wrong employee attributes their notes and their schedule to
 * the wrong person, quietly. So identity resolution is tested for its order
 * of trust, and the OAuth pieces for refusing what they should refuse.
 */

const staff: IdentityCandidate[] = [
  { id: '12', name: 'Dave Smith', email: 'dave@safeqld.com.au', position: 'Technician' },
  { id: '13', name: 'Dave Smith', email: 'dsmith@safeqld.com.au', position: 'Apprentice' },
  { id: '14', name: 'Kerry Lee', email: 'kerry@safeqld.com.au', position: 'Service manager' },
  { id: '15', name: 'Old Hand', email: 'old@safeqld.com.au', position: 'Technician', archived: true },
];

describe('resolving who signed in', () => {
  it('trusts the employee id over everything', () => {
    const r = resolveIdentity({ currentUser: { id: '13', name: 'Kerry Lee', email: 'kerry@safeqld.com.au' }, employees: staff });
    expect(r).toMatchObject({ employeeId: '13', matchedBy: 'id' });
  });

  it('falls back to the email, ignoring case', () => {
    const r = resolveIdentity({ currentUser: { name: 'Nobody Known', email: 'KERRY@SafeQLD.com.au' }, employees: staff });
    expect(r).toMatchObject({ employeeId: '14', name: 'Kerry Lee', matchedBy: 'email' });
  });

  it('falls back to the name last, and takes the first live match', () => {
    // Two Dave Smiths: a name match is a name match, and the picker is one
    // tap away if it is the wrong one.
    const r = resolveIdentity({ currentUser: { name: 'dave smith' }, employees: staff });
    expect(r).toMatchObject({ employeeId: '12', matchedBy: 'name' });
  });

  it('never matches somebody who has left, however well the email lines up', () => {
    expect(resolveIdentity({ currentUser: { id: '15', email: 'old@safeqld.com.au', name: 'Old Hand' }, employees: staff })).toBeNull();
  });

  it('is nobody when there is no login or nothing matches', () => {
    expect(resolveIdentity({ currentUser: null, employees: staff })).toBeNull();
    expect(resolveIdentity({ currentUser: { name: 'Stranger' }, employees: staff })).toBeNull();
  });

  it('keeps the address the person signed in with when the employee record has none', () => {
    const r = resolveIdentity({
      currentUser: { id: '20', email: 'new@safeqld.com.au' },
      employees: [{ id: '20', name: 'New Start' }],
    });
    expect(r?.email).toBe('new@safeqld.com.au');
  });
});

describe('what choosing an employee changes', () => {
  it('seeds a blank display name and leaves a typed one alone', () => {
    const e = { id: '12', name: 'David Anthony Smith', email: 'dave@safeqld.com.au' };
    expect(prefsForEmployee({ technicianName: '', simproEmployeeId: '', simproEmployeeEmail: '' }, e).technicianName)
      .toBe('David Anthony Smith');
    expect(prefsForEmployee({ technicianName: 'Dave', simproEmployeeId: '', simproEmployeeEmail: '' }, e).technicianName)
      .toBe('Dave');
  });

  it('clearing forgets the employee but not the name on the reports', () => {
    expect(prefsForNobody()).toEqual({ simproEmployeeId: '', simproEmployeeEmail: '' });
  });
});

describe('searching the staff list', () => {
  it('matches every word, across name and position, and hides the archived', () => {
    expect(searchEmployees(staff, 'dav tech').map((e) => e.id)).toEqual(['12']);
    expect(searchEmployees(staff, 'old').map((e) => e.id)).toEqual([]);
  });

  it('is everyone live for an empty query', () => {
    expect(searchEmployees(staff, '  ')).toHaveLength(3);
  });
});

describe('the token exchange', () => {
  const target = { buildDomain: 'safeqld.simprosuite.com', clientId: 'abc' };

  it('refuses a response with no access token rather than passing on an empty bearer', () => {
    expect(() => parseTokenResponse({ expires_in: 3600 })).toThrow(/no access token/i);
  });

  it('keeps the refresh token optional and defaults the lifetime to an hour', () => {
    expect(parseTokenResponse({ access_token: 'x' })).toEqual({ accessToken: 'x', refreshToken: undefined, expiresInSeconds: 3600 });
    expect(parseTokenResponse({ access_token: 'x', refresh_token: 'r', expires_in: 600 }).refreshToken).toBe('r');
  });

  it('sends the secret only when the device holds one', () => {
    expect(tokenRequestBody(target, { grant_type: 'client_credentials' }, 's3')).toContain('client_secret=s3');
    expect(tokenRequestBody(target, { grant_type: 'client_credentials' }, undefined)).not.toContain('client_secret');
  });

  it('posts to the build directly, or to the proxy when there is one', () => {
    expect(tokenUrl(target)).toBe('https://safeqld.simprosuite.com/oauth2/token');
    expect(tokenUrl({ ...target, proxyUrl: 'https://proxy.example/' })).toBe('https://proxy.example/oauth2/token');
  });

  it('takes the refresh margin off the lifetime', () => {
    expect(expiresAtFrom(1_000_000, 3600)).toBe(1_000_000 + (3600 - 120) * 1000);
  });
});

describe('the browser login', () => {
  it('sends the app back to the registered redirect with the state it chose', () => {
    const url = authorizeUrl({ buildDomain: 'safeqld.simprosuite.com', clientId: 'abc' }, 'st4te');
    expect(url.startsWith('https://safeqld.simprosuite.com/oauth2/login?')).toBe(true);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(APP_REDIRECT_URI)}`);
    expect(url).toContain('state=st4te');
    expect(url).toContain('response_type=code');
  });

  /**
   * The redirect is the app's own scheme on a phone and the page's own
   * address in a browser. Asking a browser to be redirected to
   * `safeqld://oauth` is refused every time, whatever the office registered,
   * which is what the web app was doing.
   */
  it('hands back to the app\'s own address in a browser, and to the scheme on a phone', () => {
    expect(redirectUriFor({ origin: 'https://lochiehayes13-bit.github.io', base: '/Safe-QLD/' }))
      .toBe('https://lochiehayes13-bit.github.io/Safe-QLD/');
    // Served from the root, as a Netlify or user-page build is.
    expect(redirectUriFor({ origin: 'http://localhost:8081' })).toBe('http://localhost:8081/');
    // No page, or something that is not one: the installed app's own scheme.
    expect(redirectUriFor()).toBe(APP_REDIRECT_URI);
    expect(redirectUriFor({ origin: 'file://' })).toBe(APP_REDIRECT_URI);
    expect(authorizeUrl({ buildDomain: 'b.example', clientId: 'abc' }, 's', 'https://web.example/app/'))
      .toContain(`redirect_uri=${encodeURIComponent('https://web.example/app/')}`);
  });

  /**
   * One registered URI has to match wherever the sign-in was started from, so
   * it is the app's root and never the route: a person signing in from the
   * job card would otherwise ask Simpro to hand back to the job card's path.
   */
  it('takes the app\'s root from the build, or from the page\'s own icon', () => {
    expect(webBase('/Safe-QLD/')).toBe('/Safe-QLD/');
    expect(webBase('Safe-QLD/')).toBe('/Safe-QLD/');
    expect(webBase(undefined, '/Safe-QLD/favicon.ico')).toBe('/Safe-QLD/');
    expect(webBase('', '/favicon.ico')).toBe('/');
    // Nothing to go on, and a relative icon says nothing about the root.
    expect(webBase()).toBe('/');
    expect(webBase(undefined, 'favicon.ico')).toBe('/');
  });

  it('reads the code and state from the redirect, in the query or the fragment', () => {
    expect(parseAuthRedirect('safeqld://oauth?code=c0de&state=s1')).toEqual({ code: 'c0de', state: 's1' });
    expect(parseAuthRedirect('safeqld://oauth#code=c0de&state=s1')).toEqual({ code: 'c0de', state: 's1' });
  });

  it('reads a refusal', () => {
    expect(parseAuthRedirect('safeqld://oauth?error=access_denied&error_description=No+thanks'))
      .toEqual({ error: 'access_denied', errorDescription: 'No thanks' });
  });
});

describe('what a refusal says', () => {
  it('keeps the server\'s words and adds the fix for a grant the build does not allow', () => {
    const text = describeOAuthFailure(400, JSON.stringify({ error: 'unsupported_grant_type', error_description: 'Not enabled' }));
    expect(text).toContain('unsupported_grant_type');
    expect(text).toContain('Not enabled');
    expect(text).toMatch(/enable it on the application/i);
  });

  it('points at the address the sign-in screen shows when the redirect is what went wrong', () => {
    // Not a constant: the right answer differs between the web app and the
    // installed one, so the words send the reader to the screen that knows.
    const text = describeOAuthFailure(400, '{"error":"redirect_uri_mismatch","error_description":"The redirect URI provided is missing or does not match"}');
    expect(text).toContain('redirect_uri_mismatch');
    expect(text).toMatch(/sign-in screen shows/i);
  });

  it('copes with a body that is not JSON', () => {
    expect(describeOAuthFailure(502, '<html>Bad gateway</html>')).toContain('Bad gateway');
  });
});

describe('staying picked', () => {
  /**
   * "Once somebody picks themselves from the list, they are always picked."
   *
   * It reads like a rule that needs no code, and it needed some. The pick is
   * one field in the same settings blob as the rate card, the licence number
   * and the Simpro credentials, and two screens wrote that whole blob back
   * from a copy read when they opened — so a screen loaded before the pick and
   * saved after it put the blank back, and the phone was nobody's again with
   * nothing said. Those writes are patches now, and a guard test holds them
   * there; this is the other half, which puts a lost pick back.
   *
   * Narrow on purpose. Adopting the wrong person is worse than asking: their
   * notes, their timesheet blocks and their day would all go to somebody else,
   * quietly, which is the same failure the identity resolver above exists to
   * prevent.
   */
  const prefs = (over: Partial<IdentityPrefs> = {}): IdentityPrefs => ({
    technicianName: '',
    simproEmployeeId: '',
    simproEmployeeEmail: '',
    ...over,
  });

  it('leaves a pick that is already held alone', () => {
    expect(repairPick(prefs({ simproEmployeeId: '14', technicianName: 'Kerry Lee' }), staff)).toBeNull();
  });

  it('keeps a pick whose employee is not on the list rather than clearing it', () => {
    // The staff list is replaced whole on every sync. A read that half-failed,
    // or an office that archived somebody for an afternoon, must not be able
    // to un-pick a technician standing in a plant room.
    expect(repairPick(prefs({ simproEmployeeId: '99', technicianName: 'Kerry Lee' }), staff)).toBeNull();
    expect(repairPick(prefs({ simproEmployeeId: '14' }), [])).toBeNull();
  });

  it('adopts the name already on the phone when it names exactly one person here', () => {
    expect(repairPick(prefs({ technicianName: 'Kerry Lee' }), staff))
      .toEqual({ simproEmployeeId: '14', simproEmployeeEmail: 'kerry@safeqld.com.au', technicianName: 'Kerry Lee' });
  });

  it('ignores case and surrounding space, because the name was typed by hand', () => {
    expect(repairPick(prefs({ technicianName: '  kerry lee ' }), staff))
      .toMatchObject({ simproEmployeeId: '14' });
  });

  it('refuses a name two people share', () => {
    // Two Dave Smiths on this office's list, one a technician and one an
    // apprentice. Guessing here sends one man's week to the other man's pay.
    expect(repairPick(prefs({ technicianName: 'Dave Smith' }), staff)).toBeNull();
  });

  it('never adopts somebody who has left', () => {
    expect(repairPick(prefs({ technicianName: 'Old Hand' }), staff)).toBeNull();
  });

  it('adopts nobody off a blank name', () => {
    expect(repairPick(prefs(), staff)).toBeNull();
    expect(repairPick(prefs({ technicianName: '   ' }), staff)).toBeNull();
  });

  it('adopts nobody when there is no list to look in', () => {
    expect(repairPick(prefs({ technicianName: 'Kerry Lee' }), [])).toBeNull();
  });

  it('keeps the typed name when it adopts, because that is the name on the reports', () => {
    const repair = repairPick(prefs({ technicianName: 'Kerry' }), [
      { id: '14', name: 'Kerry', email: 'kerry@safeqld.com.au' },
    ]);
    expect(repair?.technicianName).toBe('Kerry');
  });

  it('reads picked off the id rather than the name', () => {
    // A name is typed on a report by anybody; the id is what a schedule
    // filter and a timesheet block are keyed on.
    expect(isPicked({ simproEmployeeId: '14' })).toBe(true);
    expect(isPicked({ simproEmployeeId: '  ' })).toBe(false);
    expect(isPicked({ simproEmployeeId: '' })).toBe(false);
  });
});
