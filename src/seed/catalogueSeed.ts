import AsyncStorage from '@react-native-async-storage/async-storage';
import { catalogueCount, seedCatalogue, type CatalogueSeedItem } from '@/db/catalogueRepo';
import catalogueData from './catalogue.json';

/**
 * Loads the bundled catalogue into SQLite.
 *
 * The bundled file is versioned by its item count: shipping a bigger harvest
 * re-seeds automatically, while a normal start does nothing. Seeding thousands
 * of rows takes a moment, so it must not run on every launch.
 */

const VERSION_KEY = 'safeqld.catalogue.seededCount';

export async function seedCatalogueIfNeeded(): Promise<{ seeded: boolean; count: number }> {
  const items = catalogueData as CatalogueSeedItem[];
  const bundled = items.length;

  const [storedRaw, existing] = await Promise.all([
    AsyncStorage.getItem(VERSION_KEY),
    catalogueCount(),
  ]);
  const stored = storedRaw ? parseInt(storedRaw, 10) : 0;

  // Re-seed when the bundle grew, or when the table is empty despite the flag
  // (a reinstall, or storage cleared out from under us).
  if (stored === bundled && existing > 0) {
    return { seeded: false, count: existing };
  }

  const written = await seedCatalogue(items);
  await AsyncStorage.setItem(VERSION_KEY, String(bundled));
  return { seeded: true, count: written };
}

/** How many items ship with this build, for the Settings readout. */
export function bundledCatalogueSize(): number {
  return (catalogueData as CatalogueSeedItem[]).length;
}
