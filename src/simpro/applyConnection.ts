import { loadPrefs, savePrefs } from '@/app-prefs';
import { SimproClient } from './client';
import type { PastedConnection } from './oauthDetails';

/**
 * Putting a connection where the app looks for it.
 *
 * Two places, and they are not the same place: the build and the client id
 * go into ordinary preferences because every screen needs them, and the
 * secret goes to the keystore — the phone's hardware one, or on the web the
 * browser's own storage, which the Settings screen says out loud before
 * anybody types an office key into a browser.
 *
 * Shared by the three ways a connection arrives: typed into Settings field
 * by field, pasted in as the block Simpro hands out, or carried in a link.
 * Written once because the rule that matters is easy to get wrong twice —
 * a field the source does not carry is left exactly as it is. A rotated
 * secret arrives on its own, and blanking the client id beside it takes a
 * working device off the air.
 */
export async function applyConnection(connection: PastedConnection): Promise<void> {
  if (connection.clientSecret) await SimproClient.storeSecret(connection.clientSecret);
  if (!connection.domain && !connection.clientId) return;
  const prefs = await loadPrefs();
  await savePrefs({
    ...prefs,
    simproDomain: connection.domain ?? prefs.simproDomain,
    simproClientId: connection.clientId ?? prefs.simproClientId,
  });
}
