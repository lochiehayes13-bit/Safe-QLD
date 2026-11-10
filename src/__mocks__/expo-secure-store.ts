/**
 * A stand-in for the platform keystore, so the Simpro client can be tested.
 *
 * `src/simpro/client.ts` imports expo-secure-store at the top of the file, and
 * under the node preset that import alone makes the suite unable to load — the
 * package reaches for a native module that does not exist off-device. So the
 * OAuth exchange, the request pacing and the paging in the most heavily relied
 * on integration in the app had no tests at all, and could not have any.
 *
 * This is a real store rather than a set of no-ops on purpose. The client's
 * behaviour depends on what is in the keystore — a missing secret has to raise
 * a particular refusal, and a stored one has to reach the token request — so a
 * stub that always returned null would only be able to test half of it.
 *
 * Held in a module-level map, and `__reset` clears it between tests. Nothing
 * here touches disk: the point is to exercise the client, not the keystore.
 */

const store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? store.get(key)! : null;
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/** Test-only. Empties the store so one test cannot leak a secret into the next. */
export function __reset(): void {
  store.clear();
}
