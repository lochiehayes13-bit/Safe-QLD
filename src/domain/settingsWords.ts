/**
 * The Settings lines that depend on which build is running.
 *
 * The phone build keeps keys in the hardware keystore and records in a
 * database file on the phone. The web build, which is how an iPhone runs the
 * app from its home screen, has neither: metro.config.js swaps the keystore
 * for src/web/secureStore.ts (localStorage), and the records live in the
 * browser's storage for the site. So the screen asks here rather than saying
 * "keystore" to everyone.
 *
 * Pure: the screen passes `Platform.OS === 'web'`, so both builds' words are
 * testable from one place.
 */

export interface StorageWords {
  /** Where a saved key or secret is kept, to follow "Saved" or "Kept". */
  keyPlace: string;
  /** Where this device's records are kept. One line. */
  dataKept: string;
  /** When the automatic sync runs. One line. */
  autoSync: string;
}

export function storageWords(onWeb: boolean, syncEveryMinutes: number): StorageWords {
  const every = `every ${syncEveryMinutes} minutes`;
  return onWeb
    ? {
      keyPlace: 'in browser storage on this device',
      dataKept: 'Kept in this browser’s storage for this site.',
      autoSync: `Syncs ${every} while the app is open.`,
    }
    : {
      keyPlace: 'in this device’s keystore',
      dataKept: 'Kept on this phone.',
      autoSync: `Syncs ${every} when there’s signal.`,
    };
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The confirmation after a pasted oAuth2 block is saved. */
export function pastedSummary(fields: string[]): string {
  return fields.length ? `Saved the ${listOf(fields)}.` : 'Nothing was saved.';
}

/**
 * Whether Office setup starts open.
 *
 * Closed on a working phone. Open when there is no secret to reach Simpro
 * with, because every "Connect to Simpro" button in the app lands here and
 * the fields that fix it are inside.
 */
export function officeSetupStartsOpen(secretSource: 'proxy' | 'keystore' | 'built-in' | 'none' | null): boolean {
  return secretSource === 'none';
}
