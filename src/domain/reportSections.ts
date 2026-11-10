import { ASSET_TYPES } from '@/seed/assetTypes';
import type { RegisterSystem } from '@/parsers/assetRegister';
import type { RoutineResult } from '@/export/routineServiceReport';

/**
 * Which section of a service report each asset belongs in.
 *
 * Kept away from the database layer so it can be tested. A type with no mapping
 * does not error — its assets fall into "unknown", appear under a heading no
 * client recognises, or drop out of the document entirely. Work that was done
 * then stops appearing on the record of it, and nothing says so.
 */

/** The asset type each report section covers, so the columns match the register. */
export const SYSTEM_FOR_TYPE: Record<string, RegisterSystem> = {
  extinguisher: 'extinguisher',
  'fire-blanket': 'fire-blanket',
  'emergency-light': 'emergency-lighting',
  'hose-reel': 'hose-reel',
  hydrant: 'hydrant',
  'smoke-alarm': 'smoke-alarm',
  'ews-panel': 'ews',
  fip: 'detection',
  detector: 'detection',
  mcp: 'detection',
  'sprinkler-valve': 'sprinkler',
  'sprinkler-head': 'sprinkler',
  'gas-cylinder': 'special-hazard',
  'fire-pump': 'pump',
  'water-tank': 'water-tank',
  'fire-door': 'smoke-door',
};

/** Report order: the systems a technician walks first come first. */
export const SECTION_ORDER: RegisterSystem[] = [
  'hydrant', 'hose-reel', 'extinguisher', 'fire-blanket', 'emergency-lighting',
  'smoke-alarm', 'detection', 'ews', 'sprinkler', 'pump', 'water-tank',
  'special-hazard', 'smoke-door', 'fire-door', 'unknown',
];

export const RESULT_FOR_EVENT: Record<string, RoutineResult> = {
  passed: 'pass',
  failed: 'fail',
  'not-tested': 'not-tested',
};

/** Asset types with no section mapping, so a new type cannot vanish from reports. */
export function unmappedAssetTypes(): string[] {
  return ASSET_TYPES.map((t) => t.id).filter((id) => !(id in SYSTEM_FOR_TYPE));
}
