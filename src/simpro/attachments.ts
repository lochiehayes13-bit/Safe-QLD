import type { SimproClient } from './client';
import { SIMPRO_PATHS } from './mirrorResources';
import { shrinkTarget } from '@/domain/photoStore';

/**
 * Putting a file onto a job in Simpro.
 *
 * The one upload the app makes: a photograph of a defect, filed as a job
 * attachment so it sits beside the notes that describe it. Every decision
 * about *which* photographs go and what they are called is made in
 * `@/domain/outboundWork`; this file knows how the endpoint wants them and
 * how big they may be.
 *
 * Two things are kept out of it on purpose.
 *
 * **No file system.** The bytes arrive already read and base64-encoded. That
 * keeps this module loadable under the node test preset, where expo-file-
 * system cannot be imported, so the request shape and the response check are
 * tested rather than assumed. The reading is in ./attachmentFiles.
 *
 * **No class import of the client.** It is taken as the one call this makes,
 * for the reason testResults.ts gives: importing the class as a value drags
 * the platform keystore into every test that touches this file.
 */

export interface AttachmentPoster {
  request: SimproClient['request'];
}

export interface JobAttachmentUpload {
  filename: string;
  mimeType: string;
  /** The file's bytes, base64. Never logged and never stored. */
  base64: string;
}

/**
 * What the server said it made.
 *
 * `acknowledged` is whether the reply carried a file id. A 2xx without one is
 * still a success — the server accepted the bytes — but it is a shape this app
 * did not verify on the live build, so the caller can say so rather than
 * report an id it does not have.
 */
export interface UploadedAttachment {
  id?: string;
  filename?: string;
  acknowledged: boolean;
}

/**
 * The size above which a photograph is downscaled before upload.
 *
 * Not a server limit — Simpro does not publish one for attachments — but a
 * mobile-data one. A phone camera writes four to eight megabytes a frame, a
 * defect commonly has three, and the base64 form is a third larger again.
 * Two thousand pixels on the long edge is still enough to read a data plate.
 */
export const ATTACHMENT_UPLOAD_MAX_BYTES = 4_000_000;
export const UPLOAD_MAX_DIMENSION = 2000;
export const UPLOAD_JPEG_QUALITY = 0.85;

export interface ShrinkPlan {
  /** Absent where the pixels already fit and only the encoding is being tightened. */
  resize?: { width: number; height: number };
  quality: number;
  /** What the re-encoded file is, whatever the original was. */
  mimeType: 'image/jpeg';
}

/**
 * Whether, and how, a photograph is shrunk before it goes up.
 *
 * Decided on the size on disk first: a file under the cap goes as it is,
 * because every JPEG re-encode loses a little and a photograph of a cracked
 * weld has none to spare. Over the cap, the long edge comes down to the upload
 * dimension where the pixels are known and above it; where they are not known,
 * or already fit, the file is only re-encoded at the upload quality. Either
 * way the result is a JPEG, and the caller renames the file to match.
 */
export function shrinkForUpload(
  sizeBytes: number | undefined,
  width?: number,
  height?: number,
  maxBytes: number = ATTACHMENT_UPLOAD_MAX_BYTES,
): ShrinkPlan | undefined {
  if (sizeBytes === undefined || !Number.isFinite(sizeBytes) || sizeBytes <= maxBytes) return undefined;
  const resize = width !== undefined && height !== undefined
    ? shrinkTarget(width, height, UPLOAD_MAX_DIMENSION)
    : undefined;
  return { resize, quality: UPLOAD_JPEG_QUALITY, mimeType: 'image/jpeg' };
}

/** The body the endpoint takes. Public is always false: a defect photograph is not for the customer portal. */
export function attachmentBody(file: JobAttachmentUpload): { Filename: string; Base64Data: string; Public: false } {
  return { Filename: file.filename, Base64Data: file.base64, Public: false };
}

/**
 * Reads what came back from the upload, defensively.
 *
 * The documented reply is the attachment record, with a string ID and the
 * Filename. Nothing here depends on that being true: an id of a different
 * type is stringified, a missing one is reported as unacknowledged, and a reply
 * that is not an object at all is a success with nothing to say.
 */
export function readUploadResponse(data: unknown): UploadedAttachment {
  if (!data || typeof data !== 'object') return { acknowledged: false };
  const record = data as { ID?: unknown; Filename?: unknown };
  const id = typeof record.ID === 'string' && record.ID.trim()
    ? record.ID.trim()
    : typeof record.ID === 'number' && Number.isFinite(record.ID)
      ? String(record.ID)
      : undefined;
  return {
    id,
    filename: typeof record.Filename === 'string' ? record.Filename : undefined,
    acknowledged: id !== undefined,
  };
}

/**
 * Uploads one file to a job's attachments.
 *
 * POST jobs/{id}/attachments/files/ — a collection, so it takes the trailing
 * slash, built through the same path table as every other route so the rule
 * cannot drift. A failure is thrown as the client throws it, status and all;
 * the queue decides from the status whether the server acted.
 */
export async function uploadJobAttachment(
  client: AttachmentPoster,
  jobId: string,
  file: JobAttachmentUpload,
): Promise<UploadedAttachment> {
  const { data } = await client.request<unknown>('POST', SIMPRO_PATHS.jobAttachments(jobId), {
    body: attachmentBody(file),
  });
  return readUploadResponse(data);
}
