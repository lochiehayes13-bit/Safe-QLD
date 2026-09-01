/**
 * Where a photograph lives once it has been taken.
 *
 * Photographs are evidence. A critical defect notice is a statutory document
 * and the photograph attached to it is the record of what was found, so where
 * the file is kept is not a filing detail.
 *
 * The trap this exists for: the camera and the image picker return a URI in the
 * app's *cache* directory. Both mobile operating systems clear that directory
 * under storage pressure, and iOS does it eagerly. A technician photographs a
 * seized valve in a plant room, the URI is written to the database, and days
 * later the report renders with a blank space where the evidence was. Nothing
 * throws. The record simply stops pointing at anything.
 *
 * So a photograph is copied into the documents directory the moment it is
 * taken, under a name the app chose, and the copy is what gets recorded. This
 * module is the policy — pure, so it can be tested — and the file system work
 * sits above it.
 */

export type PhotoSubject = 'defect' | 'asset' | 'site' | 'test-result' | 'report';

export interface PhotoRef {
  id: string;
  subject: PhotoSubject;
  subjectId: string;
  /** Path within the app's documents directory, never a cache URI. */
  path: string;
  caption?: string;
  /** ISO timestamp the photograph was taken. */
  takenAt: string;
  takenBy?: string;
  byteSize?: number;
}

/** Everything the app writes lives under this, inside the documents directory. */
export const PHOTO_DIR = 'photos';

/**
 * Whether a URI is somewhere the operating system may delete.
 *
 * Deliberately broad. Anything that is not recognisably the app's own document
 * storage is treated as temporary, because the cost of being wrong one way is
 * an unnecessary copy and the other way is lost evidence.
 */
export function isEphemeral(uri: string): boolean {
  if (!uri) return true;
  const u = uri.toLowerCase();
  // An allow-list, not a deny-list. Listing the temporary locations means every
  // location nobody thought of reads as permanent, which is the wrong way round
  // for something that decides whether evidence gets copied somewhere safe.
  const inDocuments = /\/documents?\//.test(u) && u.startsWith('file://');
  return !inDocuments;
}

const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

/** The file extension to keep, defaulting to jpg when the URI does not say. */
export function extensionFor(uri: string): string {
  const m = uri.toLowerCase().match(/\.([a-z0-9]{3,4})(?:[?#]|$)/);
  const ext = m?.[1];
  return ext && EXTENSIONS.has(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
}

/**
 * The name a stored photograph gets.
 *
 * Timestamp first so a directory listing is chronological, then the subject it
 * belongs to, then the id. The original file name is deliberately discarded: it
 * is chosen by the operating system, collides across captures, and on Android
 * can carry characters that a later path join will not survive.
 */
export function photoFileName(photo: {
  id: string; subject: PhotoSubject; subjectId: string; takenAt: string; sourceUri?: string;
}): string {
  // Strip the fractional seconds and the zone marker, whether or not the
  // timestamp carried fractions — otherwise the same instant produces two
  // different names depending on which form it arrived in.
  const stamp = photo.takenAt
    .replace(/\.\d+/, '')
    .replace(/[zZ]$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  const safeId = photo.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'photo';
  return `${stamp}-${photo.subject}-${safeId}.${extensionFor(photo.sourceUri ?? '')}`;
}

/** The path a stored photograph gets, relative to the documents directory. */
export function photoPath(fileName: string): string {
  return `${PHOTO_DIR}/${fileName}`;
}

/**
 * Capture settings.
 *
 * A full-resolution phone photograph is around four megabytes, and a job with
 * twenty of them fills eighty. That matters on a device that also holds every
 * site's asset register offline, so quality is traded down — but not far: the
 * point of the photograph is that somebody can see the fault in it, and a
 * defect notice with an unreadable photograph attached is not evidence.
 */
export const CAPTURE_QUALITY = 0.6;
export const MAX_DIMENSION = 2048;

/** Bytes above which a photograph is worth flagging as unusually large. */
export const LARGE_PHOTO_BYTES = 6_000_000;

export interface StorageReport {
  count: number;
  totalBytes: number;
  /** Photographs recorded in the database whose file is no longer there. */
  missing: PhotoRef[];
  /** Files on disk that no record points at. */
  unreferenced: string[];
  warnings: string[];
}

/**
 * Reconciles what the database believes against what is on disk.
 *
 * Both directions matter and they fail differently. A record whose file has
 * gone is evidence lost, and the report has to say so rather than rendering a
 * gap — a blank space reads as "no photograph was taken", which is a different
 * and untrue statement. A file nobody references is only wasted space, but on a
 * device holding hundreds of sites that adds up.
 */
export function reconcilePhotos(
  records: PhotoRef[],
  filesOnDisk: { path: string; byteSize: number }[],
): StorageReport {
  const onDisk = new Map(filesOnDisk.map((f) => [f.path, f.byteSize]));
  const referenced = new Set(records.map((r) => r.path));

  const missing = records.filter((r) => !onDisk.has(r.path));
  const unreferenced = filesOnDisk.filter((f) => !referenced.has(f.path)).map((f) => f.path);
  const totalBytes = filesOnDisk.reduce((n, f) => n + f.byteSize, 0);

  const warnings: string[] = [];
  if (missing.length) {
    const subjects = [...new Set(missing.map((m) => m.subject))].join(', ');
    warnings.push(
      `${missing.length} ${missing.length === 1 ? 'photograph is' : 'photographs are'} recorded but ` +
      `the ${missing.length === 1 ? 'file is' : 'files are'} no longer on this device (${subjects}). ` +
      `They cannot be recovered here and any report including them will say so rather than leave a gap.`,
    );
  }
  if (unreferenced.length) {
    warnings.push(`${unreferenced.length} photo ${unreferenced.length === 1 ? 'file is' : 'files are'} no longer referenced and can be removed.`);
  }
  const large = filesOnDisk.filter((f) => f.byteSize > LARGE_PHOTO_BYTES);
  if (large.length) {
    warnings.push(`${large.length} ${large.length === 1 ? 'photograph is' : 'photographs are'} over ${Math.round(LARGE_PHOTO_BYTES / 1e6)} MB.`);
  }

  return { count: records.length, totalBytes, missing, unreferenced, warnings };
}

export interface PhotoGroup {
  subject: PhotoSubject;
  subjectId: string;
  /** Heading for this group in the photographic register. */
  label: string;
  photos: PhotoRef[];
}

/**
 * Groups photographs for a report's photographic register.
 *
 * The issued effectiveness report says "Photographs are grouped by subject",
 * and within a subject they run in the order they were taken, which is the
 * order the technician walked the building.
 */
export function groupForRegister(
  photos: PhotoRef[],
  labelFor: (subject: PhotoSubject, subjectId: string) => string,
): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>();
  for (const photo of photos) {
    const key = `${photo.subject}:${photo.subjectId}`;
    const group = groups.get(key);
    if (group) group.photos.push(photo);
    else {
      groups.set(key, {
        subject: photo.subject,
        subjectId: photo.subjectId,
        label: labelFor(photo.subject, photo.subjectId),
        photos: [photo],
      });
    }
  }
  for (const group of groups.values()) {
    group.photos.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }
  return [...groups.values()];
}

/** Numbers photographs the way the register cites them: Photo 1, Photo 2. */
export function numberRegister(groups: PhotoGroup[]): { ref: string; photo: PhotoRef; group: PhotoGroup }[] {
  const out: { ref: string; photo: PhotoRef; group: PhotoGroup }[] = [];
  let n = 0;
  for (const group of groups) {
    for (const photo of group.photos) out.push({ ref: `Photo ${++n}`, photo, group });
  }
  return out;
}
