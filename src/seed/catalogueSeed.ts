import AsyncStorage from '@react-native-async-storage/async-storage';
import { catalogueCount, seedCatalogue, type CatalogueSeedItem } from '@/db/catalogueRepo';

/**
 * Loads the bundled catalogue into SQLite.
 *
 * The catalogue is the largest thing this app ships — thousands of parts across
 * every supplier we buy from — and it is only read by the catalogue screens and
 * the pickers that pull a part number into a form. Two consequences shape this
 * file:
 *
 * It is required lazily, not imported. A top-level import makes Hermes
 * materialise the whole array on every launch, including the overwhelmingly
 * common one where the catalogue is already seeded and nothing needs reading.
 * Behind a function, a normal start never touches it.
 *
 * It seeds off the startup path. Writing thousands of rows takes long enough to
 * be felt, and nothing on the first screen needs a part number.
 */

const VERSION_KEY = 'safeqld.catalogue.seededVersion';

/**
 * Bump when the bundled catalogue changes in a way the item count alone would
 * not reveal — a re-classification, a corrected supplier name, a merge that
 * replaces as many rows as it adds. The count catches growth; this catches
 * everything else.
 */
const CATALOGUE_REVISION = 3;

function bundled(): CatalogueSeedItem[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./catalogue.json') as CatalogueSeedItem[];
}

export async function seedCatalogueIfNeeded(): Promise<{ seeded: boolean; count: number }> {
  const [storedRaw, existing] = await Promise.all([
    AsyncStorage.getItem(VERSION_KEY),
    catalogueCount(),
  ]);

  const items = bundled();
  const version = `${CATALOGUE_REVISION}:${items.length}`;

  // Re-seed when the bundle changed, or when the table is empty despite the
  // flag (a reinstall, or storage cleared out from under us).
  if (storedRaw === version && existing > 0) {
    return { seeded: false, count: existing };
  }

  const written = await seedCatalogue(items);
  await AsyncStorage.setItem(VERSION_KEY, version);
  return { seeded: true, count: written };
}

/**
 * Seeding as the rest of the app sees it.
 *
 * Started once, awaited by whoever actually needs the catalogue. Startup fires
 * it and moves on; a catalogue screen awaits it and shows a spinner for the one
 * launch where it is still running.
 */
let inFlight: Promise<{ seeded: boolean; count: number }> | null = null;

export function startCatalogueSeed(): Promise<{ seeded: boolean; count: number }> {
  if (!inFlight) {
    inFlight = seedCatalogueIfNeeded().catch((e: unknown) => {
      // A catalogue that fails to load must not take the app down with it:
      // every other part of the job still works without it. Reset so the next
      // screen that needs it can try again.
      inFlight = null;
      throw e;
    });
  }
  return inFlight;
}

/** How many items ship with this build, for the Settings readout. */
export function bundledCatalogueSize(): number {
  return bundled().length;
}
