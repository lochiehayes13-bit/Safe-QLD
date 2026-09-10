import { OFFICE_APPLICATION, isOfficeApplication, shippedSecretFor } from '@/simpro/office';
import { DEFAULT_PREFS } from '@/app-prefs';
import { firstRunStep } from '@/domain/firstRun';
import { classifySignInRefusal } from '@/simpro/oauth';
import { jobNotHereWords, syncStripWords } from '@/domain/syncWords';

/**
 * The app ships connected.
 *
 * The office's API application travels inside the bundle so a new phone
 * works before anybody opens Settings. That is a deliberate decision with a
 * cost, and the rules here are what keep the cost where it was accepted:
 * the shipped secret goes to one host for one client id and nowhere else,
 * and the preferences the app starts with are that application.
 */

describe('the shipped office application', () => {
  it('is what a fresh install is configured for', () => {
    // A default that names a different application would ship a secret that
    // is never used and a phone that cannot sync.
    expect(DEFAULT_PREFS.simproDomain).toBe(OFFICE_APPLICATION.buildDomain);
    expect(DEFAULT_PREFS.simproClientId).toBe(OFFICE_APPLICATION.clientId);
    expect(DEFAULT_PREFS.simproCompanyId).toBe(OFFICE_APPLICATION.companyId);
  });

  it('carries a secret that looks like one of Simpro\'s', () => {
    expect(OFFICE_APPLICATION.clientSecret).toMatch(/^[0-9a-f]{10,}$/);
    expect(OFFICE_APPLICATION.clientId).toMatch(/^[0-9a-f]{30}$/);
  });

  it('hands the secret out only for its own build and client id', () => {
    const shipped = { buildDomain: OFFICE_APPLICATION.buildDomain, clientId: OFFICE_APPLICATION.clientId };
    expect(shippedSecretFor(shipped)).toBe(OFFICE_APPLICATION.clientSecret);
    // A different application on the same build has its own secret.
    expect(shippedSecretFor({ ...shipped, clientId: 'another-application' })).toBeUndefined();
    // The same client id on a different host is the one mistake this must not make.
    expect(shippedSecretFor({ ...shipped, buildDomain: 'someone-else.simprosuite.com' })).toBeUndefined();
    // Behind a proxy the phone sends no secret at all.
    expect(shippedSecretFor({ ...shipped, proxyUrl: 'https://api.safeqld.com.au/simpro' })).toBeUndefined();
  });

  it('forgives the case and whitespace a typed field picks up', () => {
    expect(isOfficeApplication({
      buildDomain: ` ${OFFICE_APPLICATION.buildDomain.toUpperCase()} `,
      clientId: `${OFFICE_APPLICATION.clientId.toUpperCase()}\n`,
    })).toBe(true);
  });
});

describe('the first thing a new phone asks', () => {
  const nobody = { connected: true, signedIn: false, employeeId: '', skippedSignIn: false };

  it('offers the sign-in on a connected phone that is nobody\'s', () => {
    expect(firstRunStep(nobody)).toBe('signin');
  });

  it('leaves alone a phone that has said whose it is, either way', () => {
    expect(firstRunStep({ ...nobody, signedIn: true })).toBeNull();
    expect(firstRunStep({ ...nobody, employeeId: '45' })).toBeNull();
  });

  it('does not ask again after "Not now"', () => {
    expect(firstRunStep({ ...nobody, skippedSignIn: true })).toBeNull();
  });

  it('has nothing to offer a phone that cannot reach the office', () => {
    expect(firstRunStep({ ...nobody, connected: false })).toBeNull();
  });

  it('treats a blank-but-spaced employee id as nobody', () => {
    expect(firstRunStep({ ...nobody, employeeId: '   ' })).toBe('signin');
  });
});

describe('what Simpro\'s refusal means for the person', () => {
  it('sends a wrong password back to the field', () => {
    expect(classifySignInRefusal('Simpro refused the sign-in (HTTP 400): invalid_grant — Invalid username or password.')).toBe('password');
  });

  it('sends a grant the build does not allow to the staff list', () => {
    expect(classifySignInRefusal('Simpro refused the sign-in (HTTP 400): unsupported_grant_type.')).toBe('grant');
    expect(classifySignInRefusal('(HTTP 401): unauthorized_client — grant not permitted')).toBe('grant');
  });

  it('tells a rejected application apart from a rejected person', () => {
    expect(classifySignInRefusal('(HTTP 400): invalid_client')).toBe('client');
  });

  it('names a redirect problem so the office knows which field to fix', () => {
    expect(classifySignInRefusal('The Redirect URI on the API application does not match')).toBe('redirect');
  });

  it('has an answer for words it has not seen', () => {
    expect(classifySignInRefusal('Something the server made up')).toBe('other');
  });
});

describe('the sync strip', () => {
  it('is nothing between runs with nothing wrong', () => {
    expect(syncStripWords({ inFlight: false, progress: null, trigger: null, lastError: null })).toBeNull();
  });

  it('says which rows it is on when a stage has a count', () => {
    const w = syncStripWords({ inFlight: true, progress: { stage: 'Sites', done: 1225, total: 3059 }, trigger: 'launch', lastError: null });
    expect(w).toMatchObject({ kind: 'running', detail: 'Sites 1,225 of 3,059' });
    expect(w && w.kind === 'running' ? w.fraction : 0).toBeCloseTo(1225 / 3059, 3);
  });

  it('counts the twelve stages as steps, not rows', () => {
    const w = syncStripWords({ inFlight: true, progress: { stage: 'Reading jobs', done: 1, total: 12 }, trigger: 'foreground', lastError: null });
    expect(w).toMatchObject({ kind: 'running', title: 'Syncing with the office', detail: 'Reading jobs, step 2 of 12' });
  });

  it('tells a person who just signed in that it is their jobs coming down', () => {
    const w = syncStripWords({ inFlight: true, progress: null, trigger: 'signin', lastError: null });
    expect(w).toMatchObject({ kind: 'running', title: 'Fetching your jobs from the office', detail: 'Working out what is due' });
  });

  it('shows the last problem, cut before it becomes a wall', () => {
    const long = 'x'.repeat(500);
    const w = syncStripWords({ inFlight: false, progress: null, trigger: null, lastError: long });
    expect(w?.kind).toBe('problem');
    expect((w as { detail: string }).detail.length).toBeLessThanOrEqual(220);
    expect((w as { detail: string }).detail.endsWith('…')).toBe(true);
  });

  it('never shows a stale problem over a run that is under way', () => {
    const w = syncStripWords({ inFlight: true, progress: null, trigger: 'timer', lastError: 'old news' });
    expect(w?.kind).toBe('running');
  });
});

/**
 * A schedule block whose job the phone does not hold.
 *
 * The office books somebody on, the block comes down with the schedule, and
 * the job does not — it was raised outside the window the mirror pulls, an old
 * contract service or one booked a long way ahead. The home strip then showed
 * a row reading "Job 41207" that did nothing at all when it was tapped, which
 * is indistinguishable from the app being broken.
 */
describe('a job that is not on this phone', () => {
  it('names the job, so the technician can ring the office about it', () => {
    const w = jobNotHereWords('41207');
    expect(w.title).toContain('41207');
    expect(w.body).toContain('sync');
  });

  it('says why it is missing rather than only that it is', () => {
    // "It is not here" invites a second tap. "It was raised outside the window
    // the phone pulls" does not.
    expect(jobNotHereWords('41207').body).toContain('outside the window');
  });

  it('says something different where the block has no job at all', () => {
    // Leave, a meeting, time the office set aside. Nothing to open, and no
    // sync will change that.
    const w = jobNotHereWords(undefined);
    expect(w.title).not.toMatch(/\d/);
    expect(w.body).toContain('nothing to open');
    expect(w.body).not.toContain('sync');
  });
});
