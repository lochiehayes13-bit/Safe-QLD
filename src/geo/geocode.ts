import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { pendingKeys, readPositions, writeFailure, writePosition } from '@/db/geocodeRepo';
import type { LatLng, MapSite } from '@/domain/mapPins';
import { siteAddressKey } from './geocodeKey';

export { siteAddressKey } from './geocodeKey';

/**
 * Finding out where the sites are.
 *
 * The phone's own geocoder, one address at a time, with a pause between. It is
 * a shared platform service with no contract about volume — Apple throttles
 * hard and Android's Geocoder is a black box — so this is deliberately a slow
 * drip that runs while the map is open and stops when it closes. Three
 * thousand sites take a fortnight of openings to fill in, and the map is
 * useful from the first two hundred.
 *
 * On Android the geocoder refuses to answer without the foreground location
 * permission (checked in expo-location's LocationModule.kt, not documented on
 * the manifest); it needs no Google key, but does need Google Play services on
 * the phone, and throws when they are absent. iOS needs neither. So the
 * permission is asked for on Android only, and a geocoder that throws is
 * treated as a platform fault rather than as the address's fault: the address
 * is left pending and the run stops early, instead of writing three thousand
 * misses that would not be retried for a month.
 */

const SOURCE = 'device';

export interface LocateProgress {
  done: number;
  total: number;
  hits: number;
}

export interface LocateOptions {
  /** Addresses to attempt this run. Defaults to 200. */
  budget?: number;
  /** Pause between geocoder calls, in milliseconds. Defaults to 400. */
  delayMs?: number;
  /** Site ids already positioned another way (a job's coordinates), skipped here. */
  located?: ReadonlySet<string>;
  onProgress?: (progress: LocateProgress) => void;
  /** Checked before every call; true stops the run. */
  shouldStop?: () => boolean;
}

export interface LocateResult {
  attempted: number;
  hits: number;
  misses: number;
  /** True when `shouldStop` or the budget ended the run before the pending list did. */
  stopped: boolean;
  /** Set when the platform, rather than an address, ended the run. */
  fault?: string;
}

/** After this many geocoder throws in a row the platform is the problem, not the address. */
const MAX_CONSECUTIVE_FAULTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Site id → address key, for the sites that have a usable address. */
function keysBySite(sites: readonly MapSite[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const site of sites) {
    const key = siteAddressKey(site);
    if (key) out.set(site.id, key);
  }
  return out;
}

/** Every site's cached position, keyed by site id. */
export async function cachedPositions(sites: readonly MapSite[]): Promise<Map<string, LatLng>> {
  const bySite = keysBySite(sites);
  const found = await readPositions([...new Set(bySite.values())]);
  const out = new Map<string, LatLng>();
  for (const [siteId, key] of bySite) {
    const position = found.get(key);
    if (position) out.set(siteId, position);
  }
  return out;
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted;
}

/**
 * Geocodes the sites the cache does not know yet, up to the budget.
 *
 * Survives the geocoder throwing: a throw is counted but not cached, the delay
 * doubles, and after a few in a row the run gives up until next time.
 */
export async function locateSites(sites: readonly MapSite[], options: LocateOptions = {}): Promise<LocateResult> {
  const budget = options.budget ?? 200;
  const baseDelay = options.delayMs ?? 400;
  const result: LocateResult = { attempted: 0, hits: 0, misses: 0, stopped: false };

  const bySite = keysBySite(sites);
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const [siteId, key] of bySite) {
    if (options.located?.has(siteId) || seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  if (!wanted.length) return result;

  const pending = await pendingKeys(wanted);
  if (!pending.length) return result;

  if (!(await ensurePermission())) {
    result.fault = 'Location permission is needed to look up addresses on this phone.';
    return result;
  }

  const queue = pending.slice(0, budget);
  result.stopped = queue.length < pending.length;
  let delay = baseDelay;
  let consecutiveFaults = 0;

  for (let i = 0; i < queue.length; i++) {
    if (options.shouldStop?.()) {
      result.stopped = true;
      break;
    }
    const key = queue[i]!;
    try {
      const answers = await Location.geocodeAsync(key);
      const first = answers[0];
      result.attempted += 1;
      consecutiveFaults = 0;
      delay = baseDelay;
      if (first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
        await writePosition(key, first.latitude, first.longitude, SOURCE);
        result.hits += 1;
      } else {
        await writeFailure(key);
        result.misses += 1;
      }
    } catch (e) {
      consecutiveFaults += 1;
      if (consecutiveFaults >= MAX_CONSECUTIVE_FAULTS) {
        result.fault = e instanceof Error ? e.message : String(e);
        result.stopped = true;
        break;
      }
      // Back off: a throw here is usually the platform saying "too fast".
      delay = Math.min(delay * 2, 5000);
    }
    options.onProgress?.({ done: i + 1, total: queue.length, hits: result.hits });
    if (i + 1 < queue.length) await sleep(delay);
  }

  return result;
}
