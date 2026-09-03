/**
 * Who is holding the phone, in Simpro's terms.
 *
 * Two answers arrive from two directions and have to be reconciled. Simpro's
 * `currentUser` endpoint says who a token belongs to, in whatever fields that
 * build returns — sometimes an employee ID, sometimes only a name and an
 * email. The employee list the sync holds says who works here. This joins the
 * two into one employee, and says how sure it is: an ID match is certain, an
 * email match is as good, and a name match is a name match.
 *
 * Pure. The screens read the pieces and hand them in; nothing here touches
 * the network, the database or the preferences.
 */

/** What Simpro says about the token's owner. Any field may be missing on a given build. */
export interface CurrentUser {
  id?: string;
  name?: string;
  email?: string;
}

/** An employee as the sync holds one. Archived people still appear so a stale id can be recognised and refused. */
export interface IdentityCandidate {
  id: string;
  name: string;
  email?: string;
  position?: string;
  archived?: boolean;
}

export type MatchedBy = 'id' | 'email' | 'name';

export interface ResolvedIdentity {
  employeeId: string;
  name: string;
  email: string;
  matchedBy: MatchedBy;
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * The employee the signed-in user is, or null when nobody can be said to be.
 *
 * Order matters and is deliberate: an ID is the office's own key and beats
 * everything; an email is unique per person in practice; a name is last
 * because two people can share one. A name match is still offered rather than
 * refused, because on a company this size it is nearly always right and the
 * picker is one tap away if it is not.
 *
 * An archived employee never matches on anything. A login whose employee has
 * left is not this person, however well the email lines up — the office
 * reuses addresses.
 */
export function resolveIdentity(input: {
  currentUser: CurrentUser | null | undefined;
  employees: readonly IdentityCandidate[];
}): ResolvedIdentity | null {
  const user = input.currentUser;
  if (!user) return null;
  const live = input.employees.filter((e) => !e.archived);

  const id = norm(user.id);
  if (id) {
    const byId = live.find((e) => norm(e.id) === id);
    if (byId) return found(byId, user, 'id');
  }

  const email = norm(user.email);
  if (email) {
    const byEmail = live.find((e) => norm(e.email) === email);
    if (byEmail) return found(byEmail, user, 'email');
  }

  const name = norm(user.name);
  if (name) {
    const byName = live.find((e) => norm(e.name) === name);
    if (byName) return found(byName, user, 'name');
  }

  return null;
}

function found(e: IdentityCandidate, user: CurrentUser, matchedBy: MatchedBy): ResolvedIdentity {
  return {
    employeeId: e.id,
    name: e.name,
    // The employee record's address where it has one; the login's otherwise,
    // so an email-less employee record still ends up with the address the
    // person actually signed in with.
    email: e.email?.trim() || user.email?.trim() || '',
    matchedBy,
  };
}

/** The preference fields identity writes. A structural subset of Prefs, so this stays free of the storage module. */
export interface IdentityPrefs {
  technicianName: string;
  simproEmployeeId: string;
  simproEmployeeEmail: string;
}

/**
 * What choosing an employee changes in the preferences.
 *
 * The display name is seeded only where it is blank. Somebody who typed
 * "Dave" because that is what goes on a report does not want it replaced by
 * "David Anthony Smith" the moment they pick themselves from a list.
 */
export function prefsForEmployee(
  prefs: IdentityPrefs,
  employee: { id: string; name: string; email?: string },
): Partial<IdentityPrefs> {
  return {
    simproEmployeeId: employee.id,
    simproEmployeeEmail: employee.email?.trim() ?? '',
    technicianName: prefs.technicianName.trim() ? prefs.technicianName : employee.name,
  };
}

/** The same, from a resolved identity. */
export function prefsFromIdentity(prefs: IdentityPrefs, identity: ResolvedIdentity): Partial<IdentityPrefs> {
  return prefsForEmployee(prefs, { id: identity.employeeId, name: identity.name, email: identity.email });
}

/** Clearing the choice. The display name stays: it is still the name on the reports. */
export function prefsForNobody(): Partial<IdentityPrefs> {
  return { simproEmployeeId: '', simproEmployeeEmail: '' };
}

/**
 * The employees whose name, position or email contains every word typed.
 *
 * Word by word rather than as one phrase, so "dav smith" finds David Smith
 * and "tech" finds everyone whose position says technician.
 */
export function searchEmployees<T extends IdentityCandidate>(employees: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const live = employees.filter((e) => !e.archived);
  if (!words.length) return live;
  return live.filter((e) => {
    const hay = `${e.name} ${e.position ?? ''} ${e.email ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
