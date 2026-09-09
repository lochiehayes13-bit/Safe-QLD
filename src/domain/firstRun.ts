/**
 * What a phone should be asked the first time it opens.
 *
 * The app ships connected to the office, so the one thing it does not know
 * on a new handset is who is holding it. Until it does, a note written from a
 * job goes up under the office's name and My day has nobody's day to show.
 * So the first thing a new phone does is offer the sign-in — once, and not
 * again once the person has answered it one way or another.
 *
 * Pure, so the rule about when to stop asking is tested rather than trusted.
 * The gate that acts on it is in components/FirstRunGate.
 */

export interface FirstRunState {
  /** Whether the phone can reach the office at all. A phone that cannot has nothing to sign in to. */
  connected: boolean;
  /** A Simpro login is held on this phone. */
  signedIn: boolean;
  /** The employee this phone was set to, by login or by picking from the staff list. Blank for nobody. */
  employeeId: string;
  /** "Not now" was pressed on the sign-in screen. Asked again only when the app is reinstalled or they sign out. */
  skippedSignIn: boolean;
}

export type FirstRunStep = 'signin' | null;

/**
 * The screen to open over the home screen, or null to leave the person alone.
 *
 * Somebody who has said who they are — by signing in, or by picking their
 * name — is not asked. Somebody who said "not now" is not asked again: a
 * prompt that comes back every launch is a prompt people learn to dismiss
 * without reading, and then the one time it matters they dismiss that too.
 */
export function firstRunStep(state: FirstRunState): FirstRunStep {
  if (!state.connected) return null;
  if (state.signedIn) return null;
  if (state.employeeId.trim()) return null;
  if (state.skippedSignIn) return null;
  return 'signin';
}
