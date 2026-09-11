import { ASSET_TYPES, type AssetTypeDef, type SystemKind } from '@/seed/assetTypes';
import { SERVICE_ROUTINES, type ServiceRoutine } from '@/seed/serviceRoutines';

/**
 * Asset types no routine in this app will ever pick up.
 *
 * The routine engine resolves the assets for a check by its `assetTypeId`. A
 * check with none runs once for the system as a whole; a check with one runs
 * against every asset of that type. So a type that no check anywhere names is
 * a type the engine never visits — and the consequence is worse than not being
 * tested.
 *
 * It is not recorded as not-tested either. An inaccessible device is attempted,
 * fails to be reached, and lands on the coverage screen with its reason. A type
 * nothing services is never attempted, so it produces no result of any kind:
 * no pass, no failure, no gap. The site screen shows the asset in the register
 * and the coverage screen has nothing to say about it, and the only way anybody
 * finds out is by noticing an absence.
 *
 * That is the hole this closes, and it closes it by saying so rather than by
 * filling it. Writing a routine check for a smoke alarm would mean authoring a
 * test procedure, and the procedures live in AS 1851 — which this app does not
 * reproduce. An invented check on a service sheet is worse than a stated gap:
 * one gets chased, the other gets signed.
 *
 * Containers are excluded, and that is the whole reason the flag exists. A
 * level, a room, a loop and a fire panel hold other assets rather than being
 * serviced themselves; the devices inside them are what a routine tests, and
 * reporting a floor as unserviced would bury the six real ones in noise.
 */

export interface CoverageGap {
  type: AssetTypeDef;
  /** Why this matters here, in the words the screen shows. */
  because: string;
}

/** Every asset type at least one routine check names. */
export function servicedTypeIds(routines: readonly ServiceRoutine[] = SERVICE_ROUTINES): Set<string> {
  const out = new Set<string>();
  for (const routine of routines) {
    for (const test of routine.tests) {
      if (test.assetTypeId) out.add(test.assetTypeId);
    }
  }
  return out;
}

/**
 * The types that can be registered and never serviced.
 *
 * Sorted by system so the list reads the way a technician thinks about it, and
 * stable, because a list that reorders between two screens looks like it
 * changed.
 */
export function coverageGaps(
  routines: readonly ServiceRoutine[] = SERVICE_ROUTINES,
  types: readonly AssetTypeDef[] = ASSET_TYPES,
): CoverageGap[] {
  const serviced = servicedTypeIds(routines);
  return types
    .filter((t) => !t.container && !serviced.has(t.id))
    .map((type) => ({
      type,
      because: `No routine in this app names a ${type.label.toLowerCase()}, so running one will `
        + 'never visit it. It will not appear as not-tested either — it is never attempted, so it '
        + 'produces no result at all.',
    }))
    .sort((a, b) => a.type.system.localeCompare(b.type.system) || a.type.id.localeCompare(b.type.id));
}

/** True where a routine would visit an asset of this type. */
export function isServiced(assetTypeId: string, routines: readonly ServiceRoutine[] = SERVICE_ROUTINES): boolean {
  return servicedTypeIds(routines).has(assetTypeId);
}

export interface SiteCoverageGap extends CoverageGap {
  /** How many of this site's assets are of that type. */
  count: number;
}

/**
 * The gaps that actually bite at one site.
 *
 * A type nothing services is only a problem where the site has one. Listing all
 * six at every site would be a standing warning nobody reads, and the point is
 * to be actionable: these assets, on this site, will never be picked up.
 */
export function siteCoverageGaps(
  assets: readonly { assetTypeId: string }[],
  routines: readonly ServiceRoutine[] = SERVICE_ROUTINES,
  types: readonly AssetTypeDef[] = ASSET_TYPES,
): SiteCoverageGap[] {
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.assetTypeId, (counts.get(a.assetTypeId) ?? 0) + 1);

  return coverageGaps(routines, types)
    .map((gap) => ({ ...gap, count: counts.get(gap.type.id) ?? 0 }))
    .filter((gap) => gap.count > 0);
}

/** Systems carrying at least one unserviced type, for a summary line. */
export function systemsWithGaps(
  routines: readonly ServiceRoutine[] = SERVICE_ROUTINES,
  types: readonly AssetTypeDef[] = ASSET_TYPES,
): SystemKind[] {
  return [...new Set(coverageGaps(routines, types).map((g) => g.type.system))];
}
