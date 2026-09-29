import { base64ByteLength, isDataUri, parseDataUri } from '@/domain/dataUri';
import type { OutboundAttachment, OutboundPhoto } from '@/domain/outboundWork';

/**
 * Reading a photograph for Simpro, in a browser.
 *
 * The phone half of this file opens the path with `expo-file-system` and asks
 * it for base64. There is no file system here and no file: the browser build
 * keeps a photograph as a `data:` URI and stores that URI as the path, so the
 * base64 the upload wants is already sitting in the string — it is a split, not
 * a read.
 *
 * Which also means the phone half's two hard parts do not exist here. Nothing
 * is decoded, so there is no full-size bitmap to run a handset out of memory,
 * and nothing needs shrinking at this point because the browser half of
 * `photoFiles` already caps what it keeps. What is stored is what goes up.
 *
 * The shapes are the phone half's, imported by the bare name so TypeScript
 * resolves ./attachmentFiles while Metro takes this file — the arrangement the
 * mail and photo halves already use — and so nothing from expo-file-system
 * reaches the browser bundle.
 */
import type { AttachmentToRead, ReadAttachment } from './attachmentFiles';

export type { AttachmentToRead, ReadAttachment };

/** A file the queue points at that is not there. Never a server fault, so never an unknown outcome. */
export class AttachmentFileMissing extends Error {
  constructor(readonly localUri: string) {
    super(`The photo file is no longer on this device (${localUri}).`);
    this.name = 'AttachmentFileMissing';
  }
}

/**
 * Reads a queued photograph for upload.
 *
 * A path that is not a `data:` URI is one this build cannot resolve — a record
 * made on a handset, or a `blob:` URL from a build before this one, which stops
 * resolving the moment the page reloads. Both are reported as missing rather
 * than uploaded as something else: `AttachmentFileMissing` is the outcome that
 * tells the queue the row will never send and says why, which is the honest
 * answer and the one that stops it retrying forever.
 */
export async function readAttachmentForUpload(payload: AttachmentToRead): Promise<ReadAttachment> {
  const parsed = parseDataUri(payload.localUri);
  if (!parsed) throw new AttachmentFileMissing(payload.localUri);

  return {
    base64: parsed.base64,
    // The type the bytes actually are, not the one the queue row guessed from a
    // file extension: the browser re-encodes to JPEG when it shrinks, and a PNG
    // name on JPEG bytes is a file Simpro will not open.
    mimeType: parsed.mimeType || payload.mimeType,
    filename: payload.filename,
    sizeBytes: base64ByteLength(parsed.base64),
    downscaled: false,
  };
}

/** A defect's photographs with their sizes, for the plan. Ones this build cannot read carry no size. */
export function photosWithSizes(paths: readonly string[]): OutboundPhoto[] {
  return paths.map((path) => {
    const size = isDataUri(path) ? parseDataUri(path) : undefined;
    return size ? { path, sizeBytes: base64ByteLength(size.base64) } : { path };
  });
}

/** Unused here, and exported so both halves present the same names. */
export type { OutboundAttachment };
