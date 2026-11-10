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

/**
 * The pick this phone should be holding, or null to leave it exactly as it is.
 *
 * "Once somebody picks themselves, they stay picked" sounds like it needs no
 * code, and it did: the pick is one field in the same blob as the rate card,
 * the licence number and the Simpro credentials, and two screens wrote that
 * whole blob back from a copy they had read earlier. A screen that loaded
 * before the pick and saved after it put the blank back, and the phone was
 * nobody's again — silently, because nothing in the app ever says "you have
 * stopped being you". Those writes are patches now, which is the actual fix.
 *
 * This is the other half: the pick repairs itself where it can, so a phone
 * that already lost one gets it back rather than asking again. Deliberately
 * narrow, because adopting the wrong person is worse than asking:
 *
 *  - A pick already held is kept, whatever the staff list says. An employee
 *    who is not on the list is not a reason to un-pick somebody — the list is
 *    replaced whole on every sync, so a read that half-failed or an office
 *    that briefly archived them would otherwise clear the phone.
 *  - A phone with no pick adopts the name already on it only when that name
 *    matches exactly one person who works here. Two Daves and it asks.
 *  - A blank name adopts nobody. Everything else here is a guess about a
 *    person, and there is a list one tap away.
 */
export function repairPick(
  prefs: IdentityPrefs,
  employees: readonly IdentityCandidate[],
): Partial<IdentityPrefs> | null {
  if (prefs.simproEmployeeId.trim()) return null;

  const name = norm(prefs.technicianName);
  if (!name) return null;

  const matches = employees.filter((e) => !e.archived && norm(e.name) === name);
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ? prefsForEmployee(prefs, only) : null;
}

/**
 * Whether this phone has been told whose it is.
 *
 * The id rather than the name: a name is typed on a report by anybody, and
 * the id is the thing a schedule filter and a timesheet block are keyed on.
 */
export function isPicked(prefs: Pick<IdentityPrefs, 'simproEmployeeId'>): boolean {
  return prefs.simproEmployeeId.trim() !== '';
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
