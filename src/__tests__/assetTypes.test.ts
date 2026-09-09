import {
  customFieldsByName, customFieldsFor, locationFor, officeTypeForApp, readAssetTypes, refreshAssetTypes, tagFor,
  type OfficeAssetType,
} from '@/simpro/assetTypes';
import { listOfficeAssetTypes } from '@/db/assetTypeRepo';
import type { SimproClient } from '@/simpro/client';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The office's asset types on the phone: the read, the table, and the two
 * mappings — which office type a phone asset is created as, and which
 * office field each of its values goes under.
 *
 * The office types are invented in the office's own shape, "Category -
 * Subcategory", with the words the register importer matches on.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const office = (id: string, name: string, fields: [number, string][] = []): OfficeAssetType => ({
  id, name, customFields: fields.map(([fid, fname]) => ({ id: fid, name: fname, type: 'Text', listItems: [] })),
});

const OFFICE: OfficeAssetType[] = [
  office('1', 'Master Asset Template'),
  office('2', 'Passive Fire - Smoke Doors', [[21, 'Tag No.'], [22, 'Location'], [23, 'FRL Level']]),
  office('3', 'Passive Fire - Fire Resistant Doorsets', [[31, 'Tag No.'], [32, 'Location']]),
  office('4', 'Fire Detection and Alarm Systems - Smoke Alarms and Heat Alarms', [[41, 'Asset #'], [42, 'Location'], [43, 'Batt Type']]),
  office('5', 'Fire Detection and Alarm Systems - Panels', [[51, 'Asset #'], [52, 'Location']]),
  office('6', 'Portable Equipment - Fire Extinguishers', [[61, 'Asset #'], [62, 'Location'], [63, 'Extinguisher Type'], [64, 'Serial No.'], [65, 'Size']]),
  office('7', 'Portable Equipment - Fire Blankets', [[71, 'Asset #'], [72, 'Location']]),
  office('8', 'Fire Hydrant Systems', [[81, 'Asset Number'], [82, 'Location']]),
  office('9', 'Special Hazard Systems', [[91, 'Asset #']]),
  office('10', 'Fire Pumpsets', [[101, 'Asset #']]),
  office('11', 'Water Storage Tanks', [[111, 'Asset #']]),
  office('12', 'Emergency Lighting', [[121, 'Asset #'], [122, 'Location']]),
];

describe('which office type a phone asset is created as', () => {
  it('maps a phone type to the office type that means the same', () => {
    expect(officeTypeForApp('extinguisher', OFFICE)?.id).toBe('6');
    expect(officeTypeForApp('fire-blanket', OFFICE)?.id).toBe('7');
    expect(officeTypeForApp('smoke-alarm', OFFICE)?.id).toBe('4');
    expect(officeTypeForApp('hydrant', OFFICE)?.id).toBe('8');
    expect(officeTypeForApp('emergency-light', OFFICE)?.id).toBe('12');
    expect(officeTypeForApp('water-tank', OFFICE)?.id).toBe('11');
  });

  it('falls back to the system where the office has no type for the exact one', () => {
    // A detector is detection equipment; the office's panel register is
    // the detection type, not the smoke-alarm one that shares the words.
    expect(officeTypeForApp('detector', OFFICE)?.id).toBe('5');
    expect(officeTypeForApp('mcp', OFFICE)?.id).toBe('5');
    expect(officeTypeForApp('gas-cylinder', OFFICE)?.id).toBe('9');
    expect(officeTypeForApp('pump-controller', OFFICE)?.id).toBe('10');
  });

  it('files a door under the register the asset names, and the fire register otherwise', () => {
    expect(officeTypeForApp('fire-door', OFFICE)?.id).toBe('3');
    expect(officeTypeForApp('fire-door', OFFICE, { registerSystem: 'smoke-door' })?.id).toBe('2');
  });

  it('honours the office name an asset already carries, and never picks the template', () => {
    expect(officeTypeForApp('unknown', OFFICE, { simproType: 'water storage tanks' })?.id).toBe('11');
    expect(officeTypeForApp('unknown', OFFICE)).toBeUndefined();
    expect(officeTypeForApp('rcd', OFFICE)).toBeUndefined();
    expect(officeTypeForApp('extinguisher', [office('1', 'Master Asset Template')])).toBeUndefined();
  });
});

describe('the office field each value goes under', () => {
  const asset = {
    code: 'SQ-EXT-0000012', level: 'Level 1', room: 'Kitchen', serial: 'S-99',
    attributes: { assetNumber: 'E-12', tag: 'E-12', 'Extinguisher Type': 'ABE', frequencies: 'six-monthly', simproServiceLevels: '3:6 Monthly' },
  };

  it('fills every field of the office type from the asset, blanks included', () => {
    expect(customFieldsFor(asset, OFFICE[5]!)).toEqual([
      { id: 61, name: 'Asset #', value: 'E-12' },
      { id: 62, name: 'Location', value: 'Level 1 Kitchen' },
      { id: 63, name: 'Extinguisher Type', value: 'ABE' },
      { id: 64, name: 'Serial No.', value: 'S-99' },
      { id: 65, name: 'Size', value: '' },
    ]);
  });

  it('uses the office words for the location where the sync brought them, and the phone code where it has no tag', () => {
    expect(locationFor({ locationNote: 'Beside lift, L1', level: '1', room: 'Lobby' })).toBe('Beside lift, L1');
    expect(locationFor({ level: '1' })).toBe('1');
    expect(tagFor({ code: 'SQ-EXT-0000012', attributes: {} })).toBe('SQ-EXT-0000012');
    expect(tagFor({ code: 'SQ-EXT-0000012', attributes: { tag: 'E-1' } })).toBe('E-1');
  });

  it('names the fields of an asset the office holds without knowing its type, leaving the phone keys out', () => {
    expect(customFieldsByName({ ...asset, locationNote: 'Kitchen wall' })).toEqual([
      { name: 'Location', value: 'Kitchen wall' },
      { name: 'Extinguisher Type', value: 'ABE' },
      { name: 'Serial Number', value: 'S-99' },
    ]);
    // A serial goes under the office's own heading for it where there is one.
    expect(customFieldsByName({ serial: 'S-1', attributes: { 'Serial No.': 'old', Location: 'x' } })).toEqual([
      { name: 'Location', value: '' },
      { name: 'Serial No.', value: 'S-1' },
    ]);
  });
});

describe('reading the types from the office', () => {
  /** Answers the list and each type's fields on the paths the build verified. */
  function fakeClient(): { client: SimproClient; reads: string[] } {
    const reads: string[] = [];
    const client = {
      listAll: async (path: string) => {
        reads.push(path);
        if (path === 'setup/assetTypes/') return [{ ID: 6, Name: 'Portable Equipment - Fire Extinguishers' }, { ID: 1, Name: 'Old', Archived: true }, { Name: 'no id' }];
        if (path === 'setup/assetTypes/6/customFields/') {
          return [{ ID: 63, Name: 'Extinguisher Type', Type: 'List', Order: 2, ListItems: ['ABE', 'CO2'] }, { ID: 61, Name: 'Asset #', Type: 'Text', Order: 1 }];
        }
        throw new Error(`unexpected read ${path}`);
      },
    } as unknown as SimproClient;
    return { client, reads };
  }

  it('reads the list and each type\'s fields, in the office\'s order', async () => {
    const { client, reads } = fakeClient();
    expect(await readAssetTypes(client)).toEqual([{
      id: '6', name: 'Portable Equipment - Fire Extinguishers',
      customFields: [
        { id: 61, name: 'Asset #', type: 'Text', listItems: [] },
        { id: 63, name: 'Extinguisher Type', type: 'List', listItems: ['ABE', 'CO2'] },
      ],
    }]);
    expect(reads).toEqual(['setup/assetTypes/', 'setup/assetTypes/6/customFields/']);
  });

  it('replaces the table whole, and the table reads back what was written', async () => {
    jest.spyOn(await import('@/simpro/client'), 'SimproClient').mockImplementation(() => fakeClient().client as never);
    await refreshAssetTypes({ buildDomain: 'example.invalid', companyId: '0', clientId: 'c' });
    const held = await listOfficeAssetTypes();
    expect(held.map((t) => t.id)).toEqual(['6']);
    expect(held[0]?.customFields.map((f) => f.name)).toEqual(['Asset #', 'Extinguisher Type']);
    await refreshAssetTypes({ buildDomain: 'example.invalid', companyId: '0', clientId: 'c' });
    expect((await listOfficeAssetTypes()).length).toBe(1);
  });
});
