import { Alert } from 'react-native';
import type { AlertChoice } from '@/domain/alertChoice';

/**
 * Saying something to whoever is holding the device.
 *
 * On a phone this is react-native's `Alert` and nothing more — the same modal
 * as before, with the same buttons in the same order. It exists as a seam
 * because the browser needs the other half: see `alert.web.ts`, and
 * `src/domain/alertChoice.ts` for why a browser needed one at all.
 *
 * Screens call this rather than `Alert.alert` directly so that the seam is not
 * something anybody has to remember. A screen that imports `Alert` from
 * react-native is a screen whose messages vanish on the web build, and the
 * check in `recordScreens.test.ts` is what keeps one from creeping back.
 */
export function showAlert(title: string, message?: string, buttons?: AlertChoice[]): void {
  Alert.alert(title, message, buttons);
}
