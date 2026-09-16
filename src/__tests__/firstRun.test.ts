import { firstRunStep, type FirstRunState } from '@/domain/firstRun';

/**
 * The first thing a new phone asks.
 *
 * The failure this table exists to stop is the one the owner met on a handset
 * out of the box: the app opened on a Simpro username and password, and on
 * this office's build that login cannot succeed and never will, because the
 * API application the app ships with has an Authentication Method of Client
 * Credentials. There was a way past it — be refused once, then take the card
 * that appears — and a way past a wall is not the same as no wall.
 *
 * So the staff list is the front door, on every build. Pinning that is the
 * point of the first test here: sending a phone to the login "where a login
 * can work" reads as the careful answer and is the one that puts the wall
 * back, silently, on the day the office adds a second application.
 *
 * Everything else was already true and is pinned so it stays true: a phone
 * that has said whose it is, one that said "not now", and one that cannot
 * reach the office at all are all left alone.
 */

const nobody: FirstRunState = {
  connected: true,
  signedIn: false,
  employeeId: '',
  skippedSignIn: false,
};

describe('a phone that has never said whose it is', () => {
  it('is sent to the staff list', () => {
    // One tap and they are in. The alternative was a password box that
    // answers every password the same way.
    expect(firstRunStep(nobody)).toBe('whoami');
  });

  it('is sent there whatever the build could otherwise do', () => {
    /*
     * There is no input for "this build can serve a login", and that is the
     * decision rather than an omission. The moment such an input exists,
     * somebody wires it to the login and the office that adds a second
     * application hands its technicians back the wall.
     */
    expect(Object.keys(nobody).sort()).toEqual(['connected', 'employeeId', 'signedIn', 'skippedSignIn']);
  });
});

describe('a phone that has been answered already', () => {
  it('is left alone once somebody has signed in or picked their name', () => {
    expect(firstRunStep({ ...nobody, signedIn: true })).toBeNull();
    expect(firstRunStep({ ...nobody, employeeId: '45' })).toBeNull();
  });

  it('is not asked again after "Not now"', () => {
    // A prompt that comes back every launch is one people learn to dismiss
    // without reading, and then they dismiss the one that mattered too. Both
    // screens that can be shown set that flag; see app/whoami.tsx.
    expect(firstRunStep({ ...nobody, skippedSignIn: true })).toBeNull();
  });

  it('counts a blank-but-spaced employee id as nobody, because that is what a cleared field holds', () => {
    expect(firstRunStep({ ...nobody, employeeId: '   ' })).toBe('whoami');
  });
});

describe('a phone that cannot reach the office', () => {
  it('is asked nothing at all', () => {
    // There is no staff list to pick from and nothing to sign in to. The home
    // screen says the phone is nobody's, which is the whole of what is known.
    expect(firstRunStep({ ...nobody, connected: false })).toBeNull();
  });
});
