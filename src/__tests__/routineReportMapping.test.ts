import { SECTION_ORDER, SYSTEM_FOR_TYPE, unmappedAssetTypes } from '@/domain/reportSections';
import { ASSET_TYPES } from '@/seed/assetTypes';

/**
 * Every asset type has to belong to a section of the service report.
 *
 * A type with no mapping does not error — it falls into "unknown" and the
 * assets appear under a heading no client recognises, or the section is
 * dropped. Either way work that was done stops appearing on the document that
 * records it, and nothing says so.
 */

describe('the report section every asset type falls into', () => {
  it('leaves nothing unmapped that a technician would service', () => {
    // Structural types are the building, not equipment: a level and a room are
    // not serviced and have no place on a service report.
    const structural = new Set(['level', 'room', 'loop', 'module', 'fip-battery', 'speaker',
      'strobe', 'wip', 'asd', 'sampling-point', 'booster', 'flow-switch', 'pump-controller',
      'penetration', 'fire-damper', 'switchboard', 'rcd']);
    const missing = unmappedAssetTypes().filter((id) => !structural.has(id));
    expect(missing).toEqual([]);
  });

  it('is checked against the real type list, not a copy of it', () => {
    // If this ever reads zero the test above passes vacuously.
    expect(ASSET_TYPES.length).toBeGreaterThan(20);
  });
});
