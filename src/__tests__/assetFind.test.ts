import {
  createAsset, findAssetsByIdentifier, findBySerialContaining, queryAssets, searchAssets, seedReferenceData,
} from '@/db/assetRepo';
import { findByPartNumber } from '@/db/catalogueRepo';
import { createPanel, createSite } from '@/db/repo';
import { sitesForPanels } from '@/db/pointSites';
import { formatTag, tagPayload } from '@/domain/assetTag';
import { identifierKeys, resolveScan } from '@/domain/assetLookup';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * Find asset and Scan, on the migrated database.
 *
 * The office's asset number lives in the attributes JSON (`tag` from the
 * Simpro sync, `assetNumber` from the register importer), never in the code
 * column, and a printed label scans as the tag without its hyphens. Both
 * used to miss. These run the real SQL.
 */

let db: NodeSqliteDb;
beforeEach(async () => {
  db = openMigrated();
  await seedReferenceData();
});
afterEach(async () => { await db.closeAsync(); });

const TAG = formatTag('detector', 1847) as string;

async function fixture() {
  const tower = await createSite({ name: 'Fictional Tower' });
  const plaza = await createSite({ name: 'Main St Plaza' });
  const labelled = await createAsset({
    siteId: tower.id, assetTypeId: 'detector', code: TAG, name: 'Level 2 lobby', serial: 'SN-0099887766',
  });
  const simpro = await createAsset({
    siteId: tower.id, assetTypeId: 'extinguisher', name: 'Plant room', externalSource: 'simpro', externalId: '9001',
    attributes: { tag: 'EXT-12', assetNumber: 'EXT-12', 'Asset #': 'EXT-12' },
  });
  // The same office number at another site, which is normal: numbering is per site.
  const elsewhere = await createAsset({
    siteId: plaza.id, assetTypeId: 'extinguisher', name: 'Kitchen', attributes: { assetNumber: 'EXT-12' },
  });
  // An older sync wrote the number under `tag` only.
  const olderSync = await createAsset({
    siteId: plaza.id, assetTypeId: 'extinguisher', name: 'Car park', attributes: { tag: 'CP 044' },
  });
  return { tower, plaza, labelled, simpro, elsewhere, olderSync };
}

describe('findAssetsByIdentifier', () => {
  it('finds a labelled asset from the compact tag its barcode carries', async () => {
    const f = await fixture();
    const hits = await findAssetsByIdentifier(identifierKeys(TAG.replace(/-/g, '')));
    expect(hits.map((h) => [h.id, h.match, h.siteName])).toEqual([[f.labelled.id, 'code', 'Fictional Tower']]);
  });

  it('and from its QR payload, and typed in lower case', async () => {
    const f = await fixture();
    for (const value of [tagPayload(TAG) as string, TAG.toLowerCase()]) {
      expect((await findAssetsByIdentifier(identifierKeys(value))).map((h) => h.id)).toEqual([f.labelled.id]);
    }
  });

  it('finds a Simpro asset by the office asset number, with or without separators, at every site', async () => {
    const f = await fixture();
    for (const value of ['EXT-12', 'ext12', 'EXT 12']) {
      const hits = await findAssetsByIdentifier(identifierKeys(value));
      expect(hits.map((h) => [h.id, h.match, h.siteName])).toEqual([
        [f.simpro.id, 'office-number', 'Fictional Tower'],
        [f.elsewhere.id, 'office-number', 'Main St Plaza'],
      ]);
    }
  });

  it('reads a number filed under the older tag key', async () => {
    const f = await fixture();
    expect((await findAssetsByIdentifier(identifierKeys('CP044'))).map((h) => h.id)).toEqual([f.olderSync.id]);
  });

  it('matches a serial whole and case-blind, after codes and office numbers', async () => {
    const f = await fixture();
    expect((await findAssetsByIdentifier(identifierKeys('sn-0099887766'))).map((h) => [h.id, h.match]))
      .toEqual([[f.labelled.id, 'serial']]);
    // The maker's separators are part of a serial, so it is not matched compact.
    expect(await findAssetsByIdentifier(identifierKeys('sn0099887766'))).toEqual([]);
  });

  it('does not let one malformed attributes row fail the lookup', async () => {
    const f = await fixture();
    await db.runAsync("UPDATE asset SET attributes = '{not json' WHERE id = ?", f.olderSync.id);
    expect((await findAssetsByIdentifier(identifierKeys('EXT-12'))).length).toBe(2);
    expect((await searchAssets('EXT-12')).length).toBe(2);
  });
});

describe('searchAssets', () => {
  it('finds part of an office number or a tag typed without hyphens, with the site on each row', async () => {
    const f = await fixture();
    const byNumber = await searchAssets('ext1');
    expect(byNumber.map((a) => [a.id, a.siteName]).sort()).toEqual([
      [f.elsewhere.id, 'Main St Plaza'],
      [f.simpro.id, 'Fictional Tower'],
    ].sort());
    expect((await searchAssets('SQDET0001')).map((a) => a.id)).toEqual([f.labelled.id]);
  });

  it('puts an exact tag, office number or serial ahead of rows that only contain it', async () => {
    const f = await fixture();
    // Sorts ahead of the extinguishers by type, so only the rank can put it last.
    const first = await createAsset({
      siteId: f.tower.id, assetTypeId: 'detector', name: 'Riser', attributes: { assetNumber: 'EXT-120' },
    });
    const hits = (await searchAssets('ext12')).map((a) => a.id);
    expect(hits.slice(0, 2).sort()).toEqual([f.simpro.id, f.elsewhere.id].sort());
    expect(hits[2]).toBe(first.id);
  });

  it('is the same search the site register uses', async () => {
    const f = await fixture();
    expect((await queryAssets({ siteId: f.tower.id, search: 'ext12' })).map((a) => a.id)).toEqual([f.simpro.id]);
  });
});

describe('findBySerialContaining', () => {
  it('finds a serial inside a longer maker barcode, and inside the serial', async () => {
    const f = await fixture();
    expect((await findBySerialContaining('(21)SN-0099887766')).map((a) => a.id)).toEqual([f.labelled.id]);
    expect((await findBySerialContaining('99887766')).map((a) => a.id)).toEqual([f.labelled.id]);
    expect(await findBySerialContaining('SN')).toEqual([]);
  });
});

describe('Scan, end to end on the database', () => {
  const scan = (value: string) => resolveScan(value, {
    byIdentifier: (keys) => findAssetsByIdentifier(keys),
    bySerialContaining: (read) => findBySerialContaining(read),
    parts: (read) => findByPartNumber(read),
  });

  it('opens a printed label and a Simpro asset, and lists a number used at two sites', async () => {
    const f = await fixture();
    expect(await scan(TAG.replace(/-/g, ''))).toMatchObject({ kind: 'asset', asset: { id: f.labelled.id } });
    expect(await scan('CP 044')).toMatchObject({ kind: 'asset', asset: { id: f.olderSync.id, siteName: 'Main St Plaza' } });
    const both = await scan('EXT-12');
    expect(both?.kind).toBe('assets');
    expect(both?.kind === 'assets' ? both.assets.map((a) => a.siteName) : []).toEqual(['Fictional Tower', 'Main St Plaza']);
  });

  it('says nothing matched, with what was read', async () => {
    await fixture();
    expect(await scan('NOPE-404')).toEqual({ kind: 'none', read: 'NOPE-404', problem: undefined });
  });
});

describe('sitesForPanels', () => {
  it('names the site each point is on', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const panel = await createPanel({ siteId: site.id, name: 'FIP', brand: 'ampac', source: 'manual' });
    const found = await sitesForPanels([panel.id, panel.id, 'missing']);
    expect([...found.entries()]).toEqual([[panel.id, { siteId: site.id, siteName: 'Fictional Tower' }]]);
    expect((await sitesForPanels([])).size).toBe(0);
  });
});
