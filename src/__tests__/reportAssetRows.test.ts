import {
  addAssetRowsToReport, assetIdsOnReport, createReport, createSite, getReport, listTestRows,
  recordTestRowOnAsset, setTestResult, updateReport,
} from '@/db/repo';
import { assetTimeline, createAsset, getAsset, seedReferenceData } from '@/db/assetRepo';
import { createForm72, getForm72 } from '@/db/form72Repo';
import { testRowsFromAssets } from '@/domain/formsFromAssets';
import type { ServiceReport } from '@/domain/types';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The test sheet on a site whose equipment is the asset register.
 *
 * The rows are built by a pure function that is tested on its own; what is
 * tested here is that they survive the database — the new column round-trips,
 * a second add does not double the sheet, and a result marked on a row lands
 * on the asset the way a routine run's does — and that the report carries the
 * job number, customer and site contact it never had a column for.
 */

let db: NodeSqliteDb;
beforeEach(async () => {
  db = openMigrated();
  await seedReferenceData();
});
afterEach(async () => { await db.closeAsync(); });

async function siteWithRegister(): Promise<{ siteId: string; report: ServiceReport; assetIds: string[] }> {
  const site = await createSite({ name: 'Office-synced site' });
  const ext = await createAsset({
    siteId: site.id, assetTypeId: 'extinguisher', name: 'Foyer', walkOrder: 2,
    attributes: { assetNumber: 'E1', 'Extinguisher Type': 'ABE 4.5kg' },
  });
  const hyd = await createAsset({
    siteId: site.id, assetTypeId: 'hydrant', name: 'Ground floor riser', walkOrder: 1,
    attributes: { assetNumber: 'H1' },
  });
  const report = await createReport({
    siteId: site.id, title: 'Annual', frequency: 'annual', serviceDate: '2026-09-02', status: 'draft',
  });
  return { siteId: site.id, report, assetIds: [ext.id, hyd.id] };
}

describe('rows from the register', () => {
  it('round-trip with the asset they point at and the register type label', async () => {
    const { report, assetIds } = await siteWithRegister();
    const assets = await Promise.all(assetIds.map((id) => getAsset(id)));
    const rows = testRowsFromAssets(assets.map((a) => a!));
    expect(await addAssetRowsToReport(report.id, rows)).toBe(2);

    const back = await listTestRows(report.id);
    expect(back.map((r) => r.assetId)).toEqual([assetIds[1], assetIds[0]]);
    expect(back[0]).toMatchObject({ pointRef: 'H1', assetType: 'Fire hydrant', deviceText: 'Ground floor riser', result: 'untested' });
    expect(back[1]).toMatchObject({ pointRef: 'E1', assetType: 'Fire extinguisher — ABE 4.5kg', deviceType: 'unknown' });
    expect(await assetIdsOnReport(report.id)).toEqual(new Set(assetIds));
  });

  it('are not added twice when the button is pressed again', async () => {
    // A sync brings new equipment; pressing add again should bring only that.
    const { siteId, report, assetIds } = await siteWithRegister();
    const first = testRowsFromAssets((await Promise.all(assetIds.map((id) => getAsset(id)))).map((a) => a!));
    await addAssetRowsToReport(report.id, first);

    const reel = await createAsset({ siteId, assetTypeId: 'hose-reel', name: 'Car park' });
    const all = await Promise.all([...assetIds, reel.id].map((id) => getAsset(id)));
    const again = testRowsFromAssets(all.map((a) => a!), { firstSortIndex: 2 });
    expect(await addAssetRowsToReport(report.id, again)).toBe(1);

    const back = await listTestRows(report.id);
    expect(back).toHaveLength(3);
    expect(back[2]).toMatchObject({ assetId: reel.id, sortIndex: 2 });
  });

  it('write a marked result back onto the asset, as a routine run does', async () => {
    const { report, assetIds } = await siteWithRegister();
    const rows = testRowsFromAssets((await Promise.all(assetIds.map((id) => getAsset(id)))).map((a) => a!));
    await addAssetRowsToReport(report.id, rows);
    const [hydrantRow, extRow] = await listTestRows(report.id);

    const at = '2026-09-02T00:30:00.000Z';
    await setTestResult(hydrantRow!.id, 'fail', 'No flow at the outlet');
    await recordTestRowOnAsset({ ...hydrantRow!, comment: 'No flow at the outlet' }, 'fail', 'A Technician', at);

    const hydrant = await getAsset(hydrantRow!.assetId!);
    expect(hydrant).toMatchObject({ lastResult: 'fail', lastServicedAt: at });
    const events = await assetTimeline(hydrant!.id);
    expect(events[0]).toMatchObject({
      kind: 'failed', occurredAt: at, technician: 'A Technician', reportId: report.id,
      detail: 'No flow at the outlet',
    });

    // N/A is recorded on the timeline and leaves the last result alone:
    // nothing was serviced.
    await recordTestRowOnAsset(extRow!, 'na', 'A Technician', at);
    const ext = await getAsset(extRow!.assetId!);
    expect(ext?.lastResult ?? undefined).toBeUndefined();
    expect((await assetTimeline(ext!.id))[0]?.kind).toBe('tested');

    // Putting a row back to untested does not unmake history.
    await recordTestRowOnAsset(hydrantRow!, 'untested', 'A Technician', at);
    expect(await assetTimeline(hydrant!.id)).toHaveLength(1);
  });

  it('do nothing for a row that came from a panel point', async () => {
    const { report } = await siteWithRegister();
    await expect(recordTestRowOnAsset({ reportId: report.id, deviceText: 'L1.001' }, 'pass')).resolves.toBeUndefined();
  });
});

describe('the job number, customer and site contact on a report', () => {
  it('are stored on creation and on update', async () => {
    const site = await createSite({ name: 'A site' });
    const r = await createReport({
      siteId: site.id, title: 'Annual', frequency: 'annual', serviceDate: '2026-09-02', status: 'draft',
      jobNumber: '43747', customerName: 'Example Body Corporate',
    });
    expect(await getReport(r.id)).toMatchObject({ jobNumber: '43747', customerName: 'Example Body Corporate' });

    await updateReport(r.id, { siteContactName: 'A Manager', siteContactPhone: '0400 000 000' });
    expect(await getReport(r.id)).toMatchObject({
      jobNumber: '43747', siteContactName: 'A Manager', siteContactPhone: '0400 000 000',
    });
  });
});

describe('a Form 72 started with the register already on it', () => {
  it('keeps the parts it was given and the blanks it was not', async () => {
    const site = await createSite({ name: 'Baldwin Living' });
    const form = await createForm72({
      siteId: site.id, siteName: site.name, contractor: 'Safe QLD Pty Ltd',
      parts: {
        systemLabel: 'Boosted Hydrant System',
        flowTest: { result: 'na', hydrantLocations: ['Ground floor riser (H1)'], rows: [], onSitePumpSet: true },
      },
    });
    const back = await getForm72(form.id);
    expect(back).toMatchObject({
      systemLabel: 'Boosted Hydrant System',
      flowTest: { hydrantLocations: ['Ground floor riser (H1)'], onSitePumpSet: true },
      booster: { result: 'na' },
      status: 'draft',
    });
    expect(back?.overload).toBeUndefined();
  });
});
