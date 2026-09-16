/**
 * Which ways of signing in a Simpro build has already refused.
 *
 * Both ways a person signs in as themselves depend on a setting on the
 * office's API application: the password grant has to be allowed, and the
 * browser's redirect has to be registered. Where one is not, Simpro refuses
 * every attempt at it identically and for ever — a different password, a
 * different phone and a different day all get the same answer.
 *
 * So a refusal of that kind is remembered against the build that gave it,
 * and the sign-in screen stops leading with a wall. This module is the
 * reading and writing of that memory and nothing else: no storage, no
 * network, no clock, so what it decides can be read in a test. The storage
 * around it is in `src/simpro/signInFlow.ts`.
 */

/** The two ways a person can sign in as themselves. */
export type SignInWay = 'password' | 'browser';

/** Which ways this build has refused. */
export interface RefusedWays { password: boolean; browser: boolean }

const NONE: RefusedWays = { password: false, browser: false };

/**
 * One office's API application.
 *
 * A phone pointed at another build, or at an application the office
 * replaced, has learned nothing about that one: the key changes and the
 * screen starts by offering everything again.
 */
export function buildKey(config: { buildDomain: string; clientId: string }): string {
  return `${config.buildDomain.trim().toLowerCase()}|${config.clientId.trim()}`;
}

/** The stored map, surviving a bad write, an older shape, or nothing at all. */
export function readRefused(raw: string | null, key: string): RefusedWays {
  if (!raw) return { ...NONE };
  try {
    const held = JSON.parse(raw) as unknown;
    if (!held || typeof held !== 'object' || Array.isArray(held)) return { ...NONE };
    const mine = (held as Record<string, unknown>)[key];
    if (!mine || typeof mine !== 'object') return { ...NONE };
    const row = mine as { password?: unknown; browser?: unknown };
    return { password: row.password === true, browser: row.browser === true };
  } catch {
    return { ...NONE };
  }
}

/**
 * The map with one way's answer changed, ready to write back.
 *
 * A build that has stopped refusing everything loses its row rather than
 * keeping one that says nothing: the office fixed it, and the memory of the
 * refusal is not worth carrying.
 */
export function withRefusal(raw: string | null, key: string, way: SignInWay, refused: boolean): string {
  let held: Record<string, { password?: boolean; browser?: boolean }> = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) held = parsed as typeof held;
  } catch {
    held = {};
  }
  const existing = held[key];
  const mine = { ...(existing && typeof existing === 'object' ? existing : {}), [way]: refused };
  if (!mine.password && !mine.browser) delete held[key];
  else held[key] = mine;
  return JSON.stringify(held);
}
