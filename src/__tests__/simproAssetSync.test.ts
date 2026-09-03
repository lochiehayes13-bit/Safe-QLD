import {
  frequencyForServiceLevel,
  lastResult,
  mapSimproAsset,
  nextDue,
  SIMPRO_ASSET_SOURCE,
  statusFor,
  tagNumber,
} from '@/simpro/assetSync';
import type { SimproAsset } from '@/simpro/resources';

/**
 * Mapping the office's register onto this app's assets.
 *
 * Nothing pulled customer assets before, so none of this had ever run against
 * the real shapes. The fixtures below are the shapes the live build actually
 * returns — the type names are Simpro's own category labels and the custom
 * field headings are the ones in use, neither of which is customer data.
 *
 * The type names matter more than they look. Simpro writes them as
 * "Category - Subcategory", and the app maps them with the register importer's
 * own table rather than a second one, so that a report built from a Simpro pull
 * and one built from a CSV import cannot disagree about what a system is
 * called. If that table is edited, this is what says so.
 */

/** Every asset type on the live build, with how many assets sit under it. */
const REAL_TYPE_NAMES: [string, string][] = [
  ['Portable and Wheeled Fire Extinguishers', 'extinguisher'],
  ['Emergency Lighting', 'emergency-light'],
  ['Fire Hose Reels', 'hose-reel'],
  ['Fire Detection and Alarm Systems - Smoke Alarms and Heat Alarms', 'smoke-alarm'],
  ['Fire Hydrant Systems', 'hydrant'],
  ['Fire Blankets', 'fire-blanket'],
  ['Passive Fire and Smoke Systems - Smoke doors - Hinged and pivoted', 'fire-door'],
  ['Fire Detection and Alarm Systems - Fire Detection and Alarm Systems', 'fip'],
  ['Fire Pumpsets', 'fire-pump'],
  ['Automatic Fire Sprinkler Systems - Wet Pipe Systems', 'sprinkler-valve'],
  ['Fire Detection and Alarm Systems - Emergency Warning Systems', 'ews-panel'],
  ['Passive Fire and Smoke Systems - Fire Resistant Doorsets', 'fire-door'],
  ['Water Storage Tanks for Fire Detection Purposes', 'water-tank'],
  ['Automatic Fire Sprinkler Systems - Deluge and Water Spray Systems', 'sprinkler-valve'],
  ['Special Hazard Systems', 'gas-cylinder'],
];

function asset(over: Partial<SimproAsset> = {}): SimproAsset {
  return {
    id: '1339',
    name: 'upstairs far office',
    typeName: 'Emergency Lighting',
    siteId: '49',
    serviceLevels: [],
    custom: {},
    ...over,
  };
}

describe('asset type mapping', () => {
  it.each(REAL_TYPE_NAMES)('maps %s', (typeName, expectedTypeId) => {
    const mapped = mapSimproAsset(asset({ typeName }));
    expect({ typeName, assetTypeId: mapped.input.assetTypeId, unmapped: mapped.unmappedType })
      .toEqual({ typeName, assetTypeId: expectedTypeId, unmapped: undefined });
  });

  it('reports a type it does not recognise instead of guessing one', () => {
    // Silently filing an unknown type under a plausible neighbour puts the
    // wrong service routine against real equipment.
    const mapped = mapSimproAsset(asset({ typeName: 'Lift Car Intercom Systems' }));
    expect(mapped.unmappedType).toBe('Lift Car Intercom Systems');
  });

  it('reports an asset with no type at all', () => {
    expect(mapSimproAsset(asset({ typeName: undefined })).unmappedType).toBe('(no type)');
  });

  it('still files an unrecognised type as equipment, under the unknown type with the office\'s name for it', () => {
    // Skipped, a lay-flat hose was missing from the register the occupier's
    // statement counts; held as unrecognised, the form can say it was not placed.
    const mapped = mapSimproAsset(asset({ typeName: 'Delivery of Lay Flat Fire Hose', custom: { Location: 'Loading dock' } }));
    expect(mapped.unmappedType).toBe('Delivery of Lay Flat Fire Hose');
    expect(mapped.input).toMatchObject({
      assetTypeId: 'unknown', externalId: '1339', name: 'Loading dock',
      attributes: { simproType: 'Delivery of Lay Flat Fire Hose' },
    });
    expect(mapSimproAsset(asset({ typeName: 'Emergency Planning in Facilities', custom: {} })).input.name).toBe('Emergency Planning in Facilities');
  });

  it('does not read the office\'s master template as any kind of equipment', () => {
    const mapped = mapSimproAsset(asset({ typeName: 'ZZZ. MASTER ASSET TEMPLATE (RJ)' }));
    expect({ type: mapped.input.assetTypeId, unmapped: mapped.unmappedType })
      .toEqual({ type: 'unknown', unmapped: 'ZZZ. MASTER ASSET TEMPLATE (RJ)' });
  });

  it('keeps which door register an office door came from, since the type alone cannot say', () => {
    const fire = mapSimproAsset(asset({ typeName: 'Passive Fire and Smoke Systems - Fire Resistant Doorsets' }));
    const smoke = mapSimproAsset(asset({ typeName: 'Passive Fire and Smoke Systems - Smoke Doors' }));
    expect(fire.input.attributes?.registerSystem).toBe('fire-door');
    expect(smoke.input.attributes?.registerSystem).toBe('smoke-door');
    expect(mapSimproAsset(asset()).input.attributes?.registerSystem).toBeUndefined();
  });
});

describe('service levels', () => {
  it.each([
    ['Monthly', 'monthly'],
    ['3 Monthly', 'quarterly'],
    ['6 Monthly', 'six-monthly'],
    ['Yearly', 'annual'],
    ['5 Yearly', 'five-yearly'],
    ['10 Yearly', 'ten-yearly'],
  ])('maps the live build\'s "%s"', (name, expected) => {
    // These six are every level in use. "10 Yearly" is on exactly one asset,
    // which is the kind of value a mapping quietly loses.
    expect(frequencyForServiceLevel(name)).toBe(expected);
  });

  it('does not care how the office capitalised it', () => {
    expect(frequencyForServiceLevel('  6 MONTHLY ')).toBe('six-monthly');
  });

  it('returns nothing for a level it has no frequency for', () => {
    expect(frequencyForServiceLevel('Fortnightly')).toBeUndefined();
  });

  it('takes the earliest due date across every frequency', () => {
    // An asset is on several frequencies at once; the one that matters is
    // whichever falls first, and they do not arrive in order.
    const due = nextDue(asset({
      serviceLevels: [
        { id: '12', name: 'Yearly', dueAt: '2027-05-01' },
        { id: '3', name: '6 Monthly', dueAt: '2026-11-01' },
        { id: '9', name: 'Monthly', dueAt: '2026-10-01' },
      ],
    }));
    expect(due).toBe('2026-10-01');
  });

  it('ignores a frequency with no date rather than treating it as due now', () => {
    const due = nextDue(asset({
      serviceLevels: [
        { id: '12', name: 'Yearly' },
        { id: '3', name: '6 Monthly', dueAt: '2026-11-01' },
      ],
    }));
    expect(due).toBe('2026-11-01');
  });

  it('has no due date when nothing is scheduled', () => {
    expect(nextDue(asset())).toBeUndefined();
  });
});

describe('last test result', () => {
  it.each([['Pass', 'pass'], ['Fail', 'fail'], ['  fail ', 'fail']])('maps %s', (given, expected) => {
    expect(lastResult(given)).toBe(expected);
  });

  it('does not turn "No Test" into a pass', () => {
    // "No Test" is the state of 7,263 of the 12,546 assets. Reading it as a
    // pass would mark more than half the register as serviced when none of it
    // has been, which is the single most dangerous mistake available here.
    expect(lastResult('No Test')).toBeUndefined();
  });

  it('has no result when the office recorded none', () => {
    expect(lastResult(undefined)).toBeUndefined();
  });
});

describe('the asset number written on the equipment', () => {
  it.each([
    [{ 'Asset #': '1' }, '1'],
    [{ 'Asset Number': 'H-12' }, 'H-12'],
    [{ 'Tag No.': 'SD-004' }, 'SD-004'],
  ])('finds it under %p', (custom, expected) => {
    // Three headings for the same thing across the type set, and it is the
    // number physically on the equipment — what a technician searches for
    // while standing in front of it.
    expect(tagNumber(custom)).toBe(expected);
  });

  it('ignores a heading that is present but empty', () => {
    expect(tagNumber({ 'Asset #': '   ', 'Asset Number': 'H-12' })).toBe('H-12');
  });

  it('has no tag when none of the headings are there', () => {
    expect(tagNumber({ Location: 'Reception' })).toBeUndefined();
  });
});

describe('a whole asset, in the shape the live build returns', () => {
  const mapped = mapSimproAsset(asset({
    id: '1339',
    typeName: 'Emergency Lighting',
    siteId: '49',
    installedDate: '2025-09-01',
    lastTestResult: 'Fail',
    lastTestAt: '2026-06-10',
    serviceLevels: [
      { id: '3', name: '6 Monthly', dueAt: '2026-11-01' },
      { id: '12', name: 'Yearly', dueAt: '2027-05-01' },
    ],
    custom: {
      'Asset #': '1',
      'Location': 'upstairs far office',
      'Emergency Light Type & Size': 'LED SPITFIRE',
    },
  }));

  it('is stamped with where it came from, so a second pull updates it', () => {
    expect({ externalId: mapped.input.externalId, externalSource: mapped.input.externalSource })
      .toEqual({ externalId: '1339', externalSource: SIMPRO_ASSET_SOURCE });
  });

  it('hands the site back for the caller to resolve rather than inventing one', () => {
    expect(mapped.remoteSiteId).toBe('49');
    expect('siteId' in mapped.input).toBe(false);
  });

  it('is named for where it is, because that is how the office identifies it', () => {
    expect(mapped.input.name).toBe('upstairs far office');
    expect(mapped.input.locationNote).toBe('upstairs far office');
  });

  it('falls back to the tag when there is no location', () => {
    const noLocation = mapSimproAsset(asset({ typeName: 'Fire Blankets', custom: { 'Asset #': '7' } }));
    expect(noLocation.input.name).toBe('Fire Blankets 7');
  });

  it('keeps the type-specific fields rather than dropping them', () => {
    // These differ per type, so there is no fixed column for them, and they
    // are what identifies the equipment on the report.
    expect(mapped.input.attributes).toMatchObject({
      'Emergency Light Type & Size': 'LED SPITFIRE',
      tag: '1',
      frequencies: 'six-monthly,annual',
    });
  });

  it('does not repeat the location inside the attributes', () => {
    expect(mapped.input.attributes).not.toHaveProperty('Location');
  });

  it('carries the office\'s last test and the earliest date due', () => {
    expect({
      lastResult: mapped.input.lastResult,
      lastServicedAt: mapped.input.lastServicedAt,
      nextDueAt: mapped.input.nextDueAt,
    }).toEqual({ lastResult: 'fail', lastServicedAt: '2026-06-10', nextDueAt: '2026-11-01' });
  });

  it('marks an archived asset as decommissioned rather than in service', () => {
    const gone = mapSimproAsset(asset({ archived: true }));
    expect(gone.input.status).toBe('decommissioned');
    expect(mapped.input.status).toBe('in-service');
  });

  it('writes the office number where the report reads it', () => {
    /*
     * The register importer files the number under `assetNumber` and the
     * routine service report reads only that, so every Simpro-synced asset
     * printed with a blank number. It is kept under `tag` as well, because
     * that is where the sync has written it until now.
     */
    expect(mapped.input.attributes).toMatchObject({ assetNumber: '1', tag: '1' });
    const untagged = mapSimproAsset(asset({ custom: {} }));
    expect(untagged.input.attributes).not.toHaveProperty('assetNumber');
  });
});

describe('the status an update carries', () => {
  it('maps archived to decommissioned so an update can retire an asset the office has', () => {
    // The sync only patched blanks on an existing asset, so one archived in
    // the office stayed in service on every phone for good.
    expect(statusFor({ archived: true })).toBe('decommissioned');
    expect(statusFor({ archived: false })).toBe('in-service');
    expect(statusFor({})).toBe('in-service');
  });

  it('is the same answer mapSimproAsset gives', () => {
    expect(mapSimproAsset(asset({ archived: true })).input.status).toBe(statusFor({ archived: true }));
  });
});
