import { Directory, File, Paths } from 'expo-file-system';
import {
  PHOTO_DIR, isEphemeral, photoFileName, photoPath,
  type PhotoRef, type PhotoSubject,
} from '@/domain/photoStore';

/**
 * Keeping a photograph.
 *
 * The counterpart to exports, and the opposite decision. An export lives in the
 * cache because the technician has already sent it on and the operating system
 * is welcome to reclaim it. A photograph is evidence, so it goes into document
 * storage, which is backed up and is not cleared under storage pressure.
 *
 * The copy happens at capture rather than at save. A photograph sitting in the
 * cache while a technician fills in the rest of a defect form is already at
 * risk, and the window is exactly when the phone is most likely to be low on
 * space — it has just taken a photograph.
 */

function photoDir(): Directory {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Resolves a stored relative path to something an <img> or Image can load. */
export function photoUri(relativePath: string): string {
  const name = relativePath.startsWith(`${PHOTO_DIR}/`)
    ? relativePath.slice(PHOTO_DIR.length + 1)
    : relativePath;
  return new File(photoDir(), name).uri;
}

export interface StoredPhoto extends PhotoRef {
  /** A URI that can be rendered now. */
  uri: string;
}

/**
 * Copies a freshly captured photograph into document storage.
 *
 * Returns the record to save. If the source is already in document storage —
 * which happens when a photograph is re-attached — it is left where it is
 * rather than duplicated.
 */
export function keepPhoto(input: {
  id: string;
  sourceUri: string;
  subject: PhotoSubject;
  subjectId: string;
  takenAt: string;
  takenBy?: string;
  caption?: string;
}): StoredPhoto {
  const fileName = photoFileName({ ...input, sourceUri: input.sourceUri });
  const relative = photoPath(fileName);

  if (!isEphemeral(input.sourceUri)) {
    return { ...input, path: input.sourceUri, uri: input.sourceUri };
  }

  const source = new File(input.sourceUri);
  const target = new File(photoDir(), fileName);
  source.copy(target);

  return {
    id: input.id,
    subject: input.subject,
    subjectId: input.subjectId,
    caption: input.caption,
    takenAt: input.takenAt,
    takenBy: input.takenBy,
    path: relative,
    byteSize: target.size ?? undefined,
    uri: target.uri,
  };
}

/** True when the file behind a record is still there. */
export function photoExists(relativePath: string): boolean {
  try {
    return new File(photoUri(relativePath)).exists;
  } catch {
    return false;
  }
}

/** Everything currently in the photo directory, for reconciliation. */
export function listPhotoFiles(): { path: string; byteSize: number }[] {
  try {
    return photoDir().list()
      .filter((entry): entry is File => entry instanceof File)
      .map((f) => ({ path: photoPath(f.name), byteSize: f.size ?? 0 }));
  } catch {
    return [];
  }
}

/** Removes a photo file. Used only for files nothing references. */
export function deletePhotoFile(relativePath: string): void {
  try {
    const file = new File(photoUri(relativePath));
    if (file.exists) file.delete();
  } catch {
    // A file that will not delete is wasted space, not a failure worth
    // interrupting a technician over.
  }
}
