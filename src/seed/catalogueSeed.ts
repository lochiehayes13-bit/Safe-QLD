import AsyncStorage from '@react-native-async-storage/async-storage';
import { catalogueCount, seedCatalogue } from '@/db/catalogueRepo';
import { CATALOGUE_CHUNKS, CATALOGUE_SIZE } from './catalogue/index';

/**
 * Loads the bundled catalogue into SQLite.
 *
 * The catalogue is the largest thing this app ships — thousands of parts across
 * every supplier we buy from — and it is only read by the catalogue screens and
 * the pickers that pull a part number into a form. Two consequences shape this
 * file:
 *
 * Nothing is required until it is needed. Metro inlines an imported JSON file
 * into the bundle, so a top-level import makes Hermes materialise every row on
 * every launch, including the overwhelmingly common one where the catalogue is
 * already seeded and nothing reads it.
 *
 * It is seeded a chunk at a time. Each chunk is required, written and released
 * before the next is touched, so peak memory is one chunk rather than the whole
 * catalogue — which matters on the phone doing this for the first time, on a
 * job, alongside everything else.
 *
 * It seeds off the startup path. Writing thousands of rows takes long enough to
 * be felt, and nothing on the first screen needs a part number.
 */

const VERSION_KEY = 'safeqld.catalogue.seededVersion';

/**
 * Bump when the bundled catalogue changes in a way the row count alone would
 * not reveal — a re-classification, a corrected supplier name, a merge that
 * replaces as many rows as it adds. The count catches growth; this catches
 * everything else.
 */
const CATALOGUE_REVISION = 6;

export async function seedCatalogueIfNeeded(): Promise<{ seeded: boolean; count: number }> {
  const [storedRaw, existing] = await Promise.all([
    AsyncStorage.getItem(VERSION_KEY),
    catalogueCount(),
  ]);

  const version = `${CATALOGUE_REVISION}:${CATALOGUE_SIZE}`;

  // Re-seed when the bundle changed, or when the table is empty despite the
  // flag (a reinstall, or storage cleared out from under us).
  if (storedRaw === version && existing > 0) {
    return { seeded: false, count: existing };
  }

  let written = 0;
  for (const chunk of CATALOGUE_CHUNKS) {
    written += await seedCatalogue(chunk());
  }

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
  return CATALOGUE_SIZE;
}
