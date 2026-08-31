/**
 * Display names for catalogue categories.
 *
 * Kept out of the repository module deliberately: this is reference data with
 * no database dependency, and living behind the SQLite import made it
 * unreachable from the tests that check the harvest scripts cannot produce a
 * category with no label.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  detector: 'Detectors',
  mcp: 'Call points',
  panel: 'Panels',
  module: 'Modules',
  sounder: 'Sounders',
  strobe: 'Strobes',
  'sounder-strobe': 'Sounder/strobes',
  aspirating: 'Aspirating',
  beam: 'Beam detectors',
  base: 'Bases',
  isolator: 'Isolators',
  'power-supply': 'Power supplies',
  battery: 'Batteries',
  ewis: 'EWIS',
  wip: 'WIP phones',
  extinguisher: 'Extinguishers',
  'hose-reel': 'Hose reels',
  hydrant: 'Hydrants',
  sprinkler: 'Sprinkler',
  signage: 'Signage',
  'emergency-lighting': 'Emergency lighting',
  cable: 'Cable',
  pipe: 'Pipe and fittings',
  passive: 'Passive fire',
  ancillary: 'Ancillary',
  tool: 'Tools',
  accessory: 'Accessories',
  other: 'Other',
};
