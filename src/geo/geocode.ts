import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { pendingKeys, readPositions, writeFailure, writePosition } from '@/db/geocodeRepo';
import type { LatLng, MapSite } from '@/domain/mapPins';
import { siteAddressKey, type AddressParts } from './geocodeKey';
import { GEOCODE_BATCH, GEOCODE_SOURCE, geocodeAddress } from './platformGeocode';

export { siteAddressKey } from './geocodeKey';

/**
 * Finding out where the sites are.
 *
 * One address at a time, with a pause between, from whichever geocoder the
 * platform has — see `platformGeocode.ts` and its `.web.ts` twin. It is a
 * shared service with no contract about volume whichever it is, so this is
 * deliberately a slow drip that runs while the map is open and stops when it
 * closes. Three thousand sites take a fortnight of openings to fill in on a
 * phone, and the map is useful from the first two hundred. A browser is
 * slower still and says so on the screen: it is asking OpenStreetMap, ten a
 * visit, and the phone app is the tool for a whole site list.
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

export interface LocateProgress {
  done: number;
  total: number;
  hits: number;
}

export interface LocateOptions {
  /** Addresses to attempt this run. Defaults to the platform's batch: 200 on a phone, 10 in a browser. */
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
  /**
   * What kind of fault: the location permission is missing, which the
   * technician can fix in Settings, or the platform itself threw, which
   * they cannot. The screen offers a button for one and not the other.
   */
  faultKind?: 'permission' | 'platform';
}

/** After this many geocoder throws in a row the platform is the problem, not the address. */
const MAX_CONSECUTIVE_FAULTS = 3;

/**
 * Whether the permission has been declined since the app started. Asked once
 * per run and not on every opening of the map: Android keeps answering "you
 * may ask again" after the first refusal, and a dialog on every tab switch
 * is how a person ends up refusing for good.
 */
let declinedThisRun = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Puts a position the technician already has for an address into the cache,
 * so a site created from a place found on the map lands where the place was
 * rather than wherever the geocoder later reads the typed address to be.
 */
export async function rememberPosition(parts: AddressParts, at: LatLng): Promise<void> {
  const key = siteAddressKey(parts);
  if (!key || !Number.isFinite(at.latitude) || !Number.isFinite(at.longitude)) return;
  await writePosition(key, at.latitude, at.longitude, 'place');
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
  if (!current.canAskAgain || declinedThisRun) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  if (!asked.granted) declinedThisRun = true;
  return asked.granted;
}

/**
 * Geocodes the sites the cache does not know yet, up to the budget.
 *
 * Survives the geocoder throwing: a throw is counted but not cached, the delay
 * doubles, and after a few in a row the run gives up until next time.
 */
export async function locateSites(sites: readonly MapSite[], options: LocateOptions = {}): Promise<LocateResult> {
  const budget = options.budget ?? GEOCODE_BATCH;
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
    result.faultKind = 'permission';
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
      const found = await geocodeAddress(key);
      result.attempted += 1;
      consecutiveFaults = 0;
      delay = baseDelay;
      if (found) {
        await writePosition(key, found.lat, found.lng, GEOCODE_SOURCE);
        result.hits += 1;
      } else {
        await writeFailure(key);
        result.misses += 1;
      }
    } catch (e) {
      consecutiveFaults += 1;
      if (consecutiveFaults >= MAX_CONSECUTIVE_FAULTS) {
        result.fault = e instanceof Error ? e.message : String(e);
        result.faultKind = 'platform';
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
