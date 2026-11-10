import { buildDataUri } from '@/domain/dataUri';
import { listPhotoRecords, photoStorageReport } from '@/db/photoRepo';
import { createDefect, createSite } from '@/db/repo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * What the storage report says about a photograph the browser kept inline.
 *
 * The report exists to find evidence that has gone missing, and it works by
 * comparing records against a directory listing. The browser build has no
 * directory — the photograph *is* the record — so run naively, every one of
 * them comes back as "recorded but the file is no longer on this device".
 *
 * That message is the one thing this report must never get wrong. It tells a
 * technician their evidence is lost, and it would be saying so about
 * photographs sitting in front of them on the screen.
 */

const jpeg = buildDataUri('image/jpeg', Buffer.alloc(120, 9).toString('base64'));

let db: NodeSqliteDb;

beforeEach(async () => {
  db = openMigrated();
  await createSite({ id: 'site-1', name: 'An Example Building' });
});

afterEach(async () => {
  await db.closeAsync();
});

async function defectWith(photos: string[]): Promise<void> {
  await createDefect({
    id: `d-${photos.length}-${photos[0]?.slice(-6) ?? 'none'}`,
    siteId: 'site-1',
    location: 'Level 3 east',
    description: 'Sprinkler control valve found closed.',
    severity: 'critical',
    status: 'open',
    raisedAt: '2026-09-29T00:10:00.000Z',
    photos,
  });
}

describe('photoStorageReport with photographs kept inline', () => {
  it('counts them and never calls them missing', async () => {
    await defectWith([jpeg]);

    // The browser's listPhotoFiles returns an empty directory, correctly: there
    // is nothing on disk to list.
    const report = await photoStorageReport([]);

    expect(report.count).toBe(1);
    expect(report.missing).toEqual([]);
    expect(report.unreferenced).toEqual([]);
    expect(report.warnings).toEqual([]);
    // Sized from the URI itself, so the total is a real number of bytes rather
    // than a zero that reads as "no photographs held".
    expect(report.totalBytes).toBe(120);
  });

  it('still reports a genuinely missing file on the phone build', async () => {
    // The guard against fixing the browser by blinding the report: a record
    // pointing at a path with no file behind it is still evidence lost.
    await defectWith(['photos/20260929-0010-defect-p9.jpg']);

    const report = await photoStorageReport([]);

    expect(report.missing).toHaveLength(1);
    expect(report.warnings.join(' ')).toContain('no longer on this device');
  });

  it('counts both kinds at once, which is what a handset record opened in a browser looks like', async () => {
    await defectWith([jpeg]);
    await defectWith([jpeg, 'photos/20260929-0010-defect-p9.jpg']);

    const report = await photoStorageReport([{ path: 'photos/20260929-0010-defect-p9.jpg', byteSize: 400 }]);

    expect(report.count).toBe(3);
    expect(report.missing).toEqual([]);
    expect(report.totalBytes).toBe(400 + 120 + 120);
  });

  it('gathers an inline photograph as one of ours, so it is reconciled at all', async () => {
    // `ours` used to require a "photos/" prefix, which silently dropped every
    // browser-kept photograph out of the report rather than reporting it.
    await defectWith([jpeg]);
    expect((await listPhotoRecords()).map((r) => r.path)).toEqual([jpeg]);
  });
});
