import * as SecureStore from 'expo-secure-store';

/**
 * The signed-in person's tokens, in the platform keystore.
 *
 * Held apart from the API key's secret on purpose. The two have different
 * lives: the secret is the office's, pasted once and shared by every phone;
 * the session is this person's, and signing out has to remove it without
 * touching the shared connection underneath — otherwise "sign out" on one
 * phone would read as "disconnect the app".
 *
 * Three keys rather than one blob, because the keystore on one platform warns
 * past two kilobytes per value and a pair of tokens can get close. The
 * metadata is small and goes in the third.
 */

const ACCESS_KEY = 'safeqld.simpro.user.accessToken';
const REFRESH_KEY = 'safeqld.simpro.user.refreshToken';
const META_KEY = 'safeqld.simpro.user.meta';
/** Why the last session ended without the person asking it to. Read by Settings, cleared by the next sign-in. */
const SIGNED_OUT_REASON_KEY = 'safeqld.simpro.user.signedOutReason';

const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export interface UserSession {
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since the epoch, with the refresh margin already taken off. */
  expiresAt: number;
  /** Who signed in, for the line in Settings: the username typed, or the name Simpro gave back. */
  label?: string;
}

interface Meta {
  expiresAt: number;
  label?: string;
}

export async function readUserSession(): Promise<UserSession | null> {
  const [accessToken, refreshToken, metaRaw] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(META_KEY),
  ]);
  if (!accessToken || !metaRaw) return null;
  let meta: Meta;
  try {
    meta = JSON.parse(metaRaw) as Meta;
  } catch {
    return null;
  }
  if (typeof meta.expiresAt !== 'number') return null;
  return {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt: meta.expiresAt,
    label: meta.label,
  };
}

/** Stores a session and forgets why the last one ended: a new sign-in answers that. */
export async function writeUserSession(session: UserSession): Promise<void> {
  const meta: Meta = { expiresAt: session.expiresAt, label: session.label };
  await SecureStore.setItemAsync(ACCESS_KEY, session.accessToken, OPTIONS);
  if (session.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken, OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
  await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta), OPTIONS);
  await SecureStore.deleteItemAsync(SIGNED_OUT_REASON_KEY);
}

/**
 * Ends the session. The API key's secret is untouched.
 *
 * A reason is recorded when the app did this rather than the person — a
 * refresh the server refused, say — so Settings can explain why the phone is
 * suddenly signed out instead of leaving them to wonder whether they ever
 * signed in.
 */
export async function clearUserSession(reason?: string): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(META_KEY);
  if (reason) {
    await SecureStore.setItemAsync(SIGNED_OUT_REASON_KEY, reason, OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(SIGNED_OUT_REASON_KEY);
  }
}

export async function readSignedOutReason(): Promise<string | null> {
  return SecureStore.getItemAsync(SIGNED_OUT_REASON_KEY);
}

export async function isSignedIn(): Promise<boolean> {
  return (await readUserSession()) !== null;
}
