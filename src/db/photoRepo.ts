import { getDb } from '@/db';
import { dataUriByteSize, isDataUri } from '@/domain/dataUri';
import { PHOTO_DIR, reconcilePhotos, type PhotoRef, type StorageReport } from '@/domain/photoStore';

/**
 * Every photograph the app believes it holds.
 *
 * Photographs are attached to defects and to asset timeline events, and both
 * store them as a JSON array of paths on the row rather than in a table of
 * their own. That is fine for reading one record, and no use at all for the
 * question that matters here — is everything still on the device? — so this
 * gathers them.
 *
 * The question matters because a defect photograph is evidence on a statutory
 * notice, and a record whose file has gone produces no error at all: the report
 * renders a gap, which reads as "no photograph was taken".
 */

function paths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Only paths this app wrote; a leftover cache URI is not ours to reconcile.
 *
 * A `data:` URI is one of ours. That is what the browser build stores, because
 * it has no file system to copy into — the photograph travels inside the record
 * instead of being pointed at from it.
 */
function ours(path: string): boolean {
  return path.startsWith(`${PHOTO_DIR}/`) || isDataUri(path);
}

export async function listPhotoRecords(): Promise<PhotoRef[]> {
  const db = await getDb();
  const out: PhotoRef[] = [];

  const defects = await db.getAllAsync<{ id: string; photos: string | null; raisedAt: string }>(
    'SELECT id, photos, raisedAt FROM defect',
  );
  for (const d of defects) {
    for (const path of paths(d.photos).filter(ours)) {
      out.push({ id: `${d.id}:${path}`, subject: 'defect', subjectId: d.id, path, takenAt: d.raisedAt });
    }
  }

  const events = await db.getAllAsync<{ id: string; assetId: string; photos: string | null; occurredAt: string }>(
    "SELECT id, assetId, photos, occurredAt FROM asset_event WHERE photos != '[]'",
  );
  for (const e of events) {
    for (const path of paths(e.photos).filter(ours)) {
      out.push({ id: `${e.id}:${path}`, subject: 'asset', subjectId: e.assetId, path, takenAt: e.occurredAt });
    }
  }

  return out;
}

/**
 * What the database believes against what is on disk.
 *
 * Both directions are reported. A record whose file has gone is evidence lost;
 * a file nothing references is only wasted space, but on a device holding
 * hundreds of sites offline that adds up.
 *
 * A photograph the browser build kept inline is neither, and is taken out
 * before the comparison rather than run through it. It has no file to have
 * gone and no file to be orphaned: the bytes are the record. Left in, every one
 * of them would come back as "recorded but no longer on this device" — a report
 * telling a technician their evidence is lost while it sits in front of them —
 * because `listPhotoFiles` on that build has an empty directory to list and is
 * right to say so.
 */
export async function photoStorageReport(
  filesOnDisk: { path: string; byteSize: number }[],
): Promise<StorageReport> {
  const records = await listPhotoRecords();
  const inline = records.filter((r) => isDataUri(r.path));
  const report = reconcilePhotos(records.filter((r) => !isDataUri(r.path)), filesOnDisk);

  if (!inline.length) return report;
  return {
    ...report,
    count: report.count + inline.length,
    totalBytes: report.totalBytes + inline.reduce((n, r) => n + (dataUriByteSize(r.path) ?? 0), 0),
  };
}
