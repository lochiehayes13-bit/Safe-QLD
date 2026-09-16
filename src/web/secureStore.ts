/**
 * What a browser has instead of a keystore.
 *
 * `expo-secure-store` is the phone's hardware keystore and has no web
 * implementation: on the web build every call throws, which took out Settings
 * and the library the moment either read a saved key. A browser has nothing
 * equivalent — there is no hardware slot a page can put a secret in — so this
 * is `localStorage`, and the Settings screen says so in as many words before
 * anyone types an office key into a browser.
 *
 * The shape matches the parts of the module the app actually uses, so the
 * native code stays exactly as it is; metro.config.js points the web bundle
 * here.
 */

const PREFIX = 'safeqld.keystore.';

/** Named so the calling code can pass the option through unchanged. */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';
export const WHEN_UNLOCKED = 'whenUnlocked';
export const AFTER_FIRST_UNLOCK = 'afterFirstUnlock';
export const ALWAYS = 'always';

/** A browser with storage switched off throws on access, so every call is guarded. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store()?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store()?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store()?.removeItem(PREFIX + key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return store() !== null;
}

/** True wherever this file is the one that loaded: the web build, and only it. */
export const isBrowserStorage = true;
