/**
 * What a phone should be asked the first time it opens.
 *
 * The app ships connected to the office, so the one thing it does not know
 * on a new handset is who is holding it. Until it does, a note written from a
 * job goes up under the office's name and My day has nobody's day to show.
 * So the first thing a new phone does is ask — once, and not again once the
 * person has answered it one way or another.
 *
 * What it asks is the staff list, not a login. This office's API application
 * has an Authentication Method of Client Credentials, which is the setting
 * that lets a phone reach Simpro with nobody logged in, and an application set
 * that way refuses every person-login by design. A new phone opened on a
 * username and password box that could not succeed, and the only way past it
 * was to be refused once and read the card that appeared underneath.
 *
 * So the staff list is the front door, on every build, and not only on the
 * ones where a login cannot work. Two reasons for the "every". The first is
 * that it is what was asked for: tap your name and you are in. The second is
 * that the alternative — the login where a login is possible — puts the wall
 * back the day the office adds a second application, and puts it back for a
 * person who has no idea that is what changed.
 *
 * What that costs is worth saying. A login comes back with a token of the
 * person's own, so Simpro records their work as theirs; a name picked off the
 * list is carried on each change instead, because Simpro records the sending
 * application as the actor whichever way round it is. The login is still
 * there, on the staff list screen and in Settings, for anybody who wants it.
 * It is just not the first thing a technician meets.
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
  /** "Not now" was pressed. Asked again only when the app is reinstalled or they sign out. */
  skippedSignIn: boolean;
}

export type FirstRunStep = 'whoami' | null;

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
  return 'whoami';
}
