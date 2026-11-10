import * as SecureStore from 'expo-secure-store';

/**
 * The Google Places key, in the keystore and nowhere else.
 *
 * Optional: without it the map searches OpenStreetMap, which is free and
 * knows every address but not every shop name. With it, searches cost money
 * per call, so the key belongs to whoever pays the bill and is held the way
 * the other keys on this phone are — in the hardware keystore, never in
 * ordinary storage, never logged, never in a message.
 */

const KEY_SLOT = 'safeqld.google.places';

/**
 * Readable only while the phone is unlocked, and never carried to another
 * device by a backup or a keychain sync: the same terms the Simpro secret is
 * held on. A key that pays per call is a key somebody else would like.
 */
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function storePlacesKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_SLOT, key.trim(), OPTIONS);
}

export async function readPlacesKey(): Promise<string | undefined> {
  const key = await SecureStore.getItemAsync(KEY_SLOT);
  return key && key.trim() ? key.trim() : undefined;
}

export async function hasPlacesKey(): Promise<boolean> {
  return (await readPlacesKey()) !== undefined;
}

export async function clearPlacesKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SLOT);
}
