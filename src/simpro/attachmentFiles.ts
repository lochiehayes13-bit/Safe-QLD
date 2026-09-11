import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { photoUri } from '@/export/photoFiles';
import type { OutboundAttachment, OutboundPhoto } from '@/domain/outboundWork';
import { shrinkForUpload } from './attachments';

/**
 * The file-system half of sending a photograph to Simpro.
 *
 * ./attachments knows the endpoint and ./sync runs the queue; neither can
 * touch a file, because both load under the node test preset and expo-file-
 * system does not. This is the part that does: it resolves the path a defect
 * record holds to a file that exists now, reads it as base64, and where the
 * file is over the upload cap it re-encodes a smaller copy first.
 *
 * It imports nothing from ./sync on purpose — ./sync imports this, and the
 * import graph is kept acyclic by a test. A screen that wants a defect's
 * photographs queued builds the plan with `photosWithSizes` below and hands
 * each attachment item to `queueJobAttachment` in ./sync.
 */

/** The fields of a queued attachment this file needs. The rest is for the queue screen. */
export type AttachmentToRead = Pick<OutboundAttachment, 'localUri' | 'filename' | 'mimeType' | 'sizeBytes'>;

/** A file the queue points at that is not there. Never a server fault, so never an unknown outcome. */
export class AttachmentFileMissing extends Error {
  constructor(readonly localUri: string) {
    super(`The photo file is no longer on this device (${localUri}).`);
    this.name = 'AttachmentFileMissing';
  }
}

export interface ReadAttachment {
  base64: string;
  mimeType: string;
  /** The name to upload under — changed to .jpg where the file was re-encoded. */
  filename: string;
  sizeBytes: number;
  /** True where a smaller copy was sent in place of the original. */
  downscaled: boolean;
}

/**
 * The file behind a stored photo path.
 *
 * A defect holds its photographs relative to document storage — "photos/…" —
 * and that directory moves between app installs on iOS, so it is resolved at
 * the moment of use and never stored absolute. An absolute URI is used as it
 * is: that is what a photograph re-attached from somewhere permanent looks
 * like.
 */
export function fileForPhoto(localUri: string): File {
  const absolute = /^[a-z]+:\/\//i.test(localUri) || localUri.startsWith('/');
  return new File(absolute ? localUri : photoUri(localUri));
}

/**
 * Reads a queued photograph for upload, downscaling it where it is large.
 *
 * The shrink is best effort. If the manipulator will not open the file — an
 * unsupported format, no memory for the bitmap — the original goes up at full
 * size. Big is a data problem; missing is evidence gone from the job.
 */
export async function readAttachmentForUpload(payload: AttachmentToRead): Promise<ReadAttachment> {
  const file = fileForPhoto(payload.localUri);
  if (!file.exists) throw new AttachmentFileMissing(payload.localUri);
  const sizeBytes = file.size ?? payload.sizeBytes ?? 0;

  const plan = shrinkForUpload(sizeBytes);
  if (plan) {
    /*
     * Decoded once. The pixels have to be known before the resize can keep
     * the aspect ratio, and the only way this module can learn them is to
     * render the file — a full-size bitmap held natively. Rendering the file
     * a second time for the resize is what a first version did, and a
     * twelve-megapixel photograph decoded twice over is what makes a phone
     * drop the app mid-upload. So the decoded image itself is handed to the
     * resize, which reads the bitmap rather than the file, and the big one
     * is let go the moment the smaller one exists.
     */
    let decoded: ImageRef | undefined;
    let resized: ImageRef | undefined;
    try {
      decoded = await ImageManipulator.manipulate(file.uri).renderAsync();
      const sized = shrinkForUpload(sizeBytes, decoded.width, decoded.height) ?? plan;
      let image = decoded;
      if (sized.resize) {
        resized = await ImageManipulator.manipulate(decoded).resize(sized.resize).renderAsync();
        release(decoded);
        decoded = undefined;
        image = resized;
      }
      const saved = await image.saveAsync({ compress: sized.quality, format: SaveFormat.JPEG, base64: true });
      if (saved.base64) {
        const smaller = new File(saved.uri);
        const out: ReadAttachment = {
          base64: saved.base64,
          mimeType: sized.mimeType,
          filename: payload.filename.replace(/\.[a-z0-9]+$/i, '') + '.jpg',
          sizeBytes: smaller.exists ? (smaller.size ?? sizeBytes) : sizeBytes,
          downscaled: true,
        };
        // The manipulator writes its copy to the cache; nothing else needs it.
        try { if (smaller.exists) smaller.delete(); } catch { /* cache, reclaimed by the OS anyway */ }
        return out;
      }
    } catch {
      // Fall through to the original.
    } finally {
      release(resized);
      release(decoded);
    }
  }

  return {
    base64: await file.base64(),
    mimeType: payload.mimeType,
    filename: payload.filename,
    sizeBytes,
    downscaled: false,
  };
}

/** Lets a native bitmap go. Older module builds have no release; the OS reclaims it later. */
function release(image: { release?: () => void } | undefined): void {
  try {
    image?.release?.();
  } catch {
    // Already released, or a build without it. Nothing to do about either.
  }
}

/** A defect's photographs with their sizes on disk, for the plan. Missing files carry no size. */
export function photosWithSizes(paths: readonly string[]): OutboundPhoto[] {
  return paths.map((path) => {
    try {
      const file = fileForPhoto(path);
      return file.exists ? { path, sizeBytes: file.size ?? undefined } : { path };
    } catch {
      return { path };
    }
  });
}
