import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPrefs, savePrefs } from '@/app-prefs';
import { listEmployees, replaceEmployees, type EmployeeRecord } from '@/db/employeeRepo';
import { SimproClient, type SimproConfig } from './client';
import { SimproResources } from './resources';
import { prefsFromIdentity, resolveIdentity, type CurrentUser, type ResolvedIdentity } from './identity';
import { runAutoSync } from './autoSync';
import { buildKey, readRefused, withRefusal, type RefusedWays, type SignInWay } from '@/domain/signInWays';

/**
 * What happens after Simpro says yes.
 *
 * ./auth gets the token and asks Simpro who it belongs to. This is the rest:
 * matching that answer to the staff list, writing the match into the
 * preferences so every screen knows whose phone this is, and starting the
 * sync that brings that person's jobs down — all of it here rather than in
 * the screen, so the screen is a form and this can be read on its own.
 *
 * The staff list is the one thing a sign-in on a brand-new phone needs and
 * does not yet have. It is a few dozen rows and one request, so it is read
 * right here rather than left to the full sync six minutes away; without it
 * every first sign-in ended at "pick yourself from the list" with an empty
 * list to pick from.
 */

const SKIPPED_KEY = 'safeqld.signin.skipped';
const REFUSED_KEY = 'safeqld.signin.refusedWays';

export type { RefusedWays, SignInWay };
export { buildKey };

export interface SignInOutcome {
  /** The employee the login was matched to, or null when nobody could be said to be. */
  identity: ResolvedIdentity | null;
  /** What Simpro said about the token's owner, kept for the screen's wording. */
  who: CurrentUser | null;
  /** Whether the phone holds a staff list at all, so "pick yourself" is not offered over an empty list. */
  staffKnown: boolean;
}

/**
 * Which ways in this build has refused for this application.
 *
 * A refusal here is not the person's fault and not something trying again
 * fixes: a build with the password grant switched off says no to every
 * password, and one with no redirect registered says no to every browser
 * sign-in. Remembering it is what stops the screen offering a wall first
 * and the way that works underneath it.
 */
export async function refusedWays(config: Pick<SimproConfig, 'buildDomain' | 'clientId'>): Promise<RefusedWays> {
  try {
    return readRefused(await AsyncStorage.getItem(REFUSED_KEY), buildKey(config));
  } catch {
    return { password: false, browser: false };
  }
}

/** Remembers that this build refused a way, or that it has stopped refusing it. */
export async function noteWayRefused(
  config: Pick<SimproConfig, 'buildDomain' | 'clientId'>,
  way: SignInWay,
  refused = true,
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(REFUSED_KEY);
    await AsyncStorage.setItem(REFUSED_KEY, withRefusal(raw, buildKey(config), way, refused));
  } catch {
    // The screen offers it again next time. Annoying, not harmful.
  }
}

export interface StaffList {
  /** Everyone the office has, archived included, so a phone set to an archived employee still names them. */
  people: EmployeeRecord[];
  /** The rows were read from Simpro just now rather than found on the phone. */
  fromOffice: boolean;
}

/**
 * The staff list, read from the office where the phone has not got it yet.
 *
 * Throws when that read fails, and that is the whole reason it is not
 * `ensureEmployees`. The screen that offers the list as the way in has
 * nothing to show when the read fails, and what it used to show was "No staff
 * list on this phone yet — it comes down with the next sync", said to
 * somebody holding a phone that had just been installed and had no next sync
 * to wait for. A screen that can say what Simpro said can offer to try again;
 * one handed a zero cannot.
 *
 * An office that really has nobody on it comes back empty and does not throw.
 * That is a different sentence and the screen says it differently.
 */
export async function loadStaffList(config: SimproConfig): Promise<StaffList> {
  const held = await listEmployees({ includeArchived: true });
  if (held.length) return { people: held, fromOffice: false };
  const people = await new SimproResources(new SimproClient(config)).employees();
  await replaceEmployees(people);
  return { people: await listEmployees({ includeArchived: true }), fromOffice: true };
}

/**
 * Makes sure the staff list is on the phone, reading it from the office when
 * it is not. Returns how many people are held afterwards. A read that fails
 * is not thrown: the caller still has whatever was there, which may be enough.
 */
export async function ensureEmployees(config: SimproConfig): Promise<number> {
  try {
    return (await loadStaffList(config)).people.length;
  } catch {
    return 0;
  }
}

export async function completeSignIn(config: SimproConfig, who: CurrentUser | null): Promise<SignInOutcome> {
  const staffKnown = (await ensureEmployees(config)) > 0;
  const employees = await listEmployees({ includeArchived: true });
  const identity = resolveIdentity({ currentUser: who, employees });
  if (identity) {
    const prefs = await loadPrefs();
    await savePrefs({ ...prefs, ...prefsFromIdentity(prefs, identity) });
  }
  // A sign-in answers the question "not now" was asked, so the next reinstall
  // or sign-out starts clean.
  await AsyncStorage.removeItem(SKIPPED_KEY).catch(() => undefined);
  // Their jobs, their day, and everything else — started now, watched from
  // the home screen, never waited on here.
  void runAutoSync('signin');
  return { identity, who, staffKnown };
}

/** "Not now" on the sign-in screen. The first-run gate stops asking. */
export async function markSignInSkipped(): Promise<void> {
  try {
    await AsyncStorage.setItem(SKIPPED_KEY, new Date().toISOString());
  } catch {
    // The gate asks again next launch. Annoying, not harmful.
  }
}

export async function wasSignInSkipped(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SKIPPED_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Signing out means the question is open again. */
export async function forgetSignInSkipped(): Promise<void> {
  await AsyncStorage.removeItem(SKIPPED_KEY).catch(() => undefined);
}
