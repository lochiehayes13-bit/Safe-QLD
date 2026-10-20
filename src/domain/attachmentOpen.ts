import { blobTypeFor } from '@/export/webFiles';

/**
 * Opening a file the office attached to a job or a quote: the parts both
 * builds share.
 *
 * The phone keeps the file in its documents folder and hands it to the share
 * sheet; the browser has no folder, so it builds a Blob and hands that over
 * instead (src/services/simproAttachments.ts and its .web half). What they
 * have in common is which file it is, what can go wrong, what the technician
 * is told, and what kind of file the bytes are. That is kept here, pure, so it
 * is tested once and neither half can drift from the other.
 */

export type AttachmentParent =
  | { kind: 'job'; localJobId: string; externalId: string }
  | { kind: 'quote'; externalId: string };

export type OpenAttachmentOutcome =
  | { status: 'opened'; uri: string }
  | { status: 'no-signal' }
  /** The build answered but without the file's bytes. See the unverified note on `?display=Base64`. */
  | { status: 'no-bytes' }
  | { status: 'not-configured'; reason: string }
  | { status: 'failed'; error: string };

/** What to tell the person who tapped, for the outcomes that are not simply "it opened". */
export function describeOpenOutcome(outcome: OpenAttachmentOutcome): { title: string; body: string } | undefined {
  switch (outcome.status) {
    case 'opened': return undefined;
    case 'no-signal':
      return { title: 'No signal', body: 'Open it again when you have signal.' };
    case 'no-bytes':
      return { title: 'File not available', body: 'Simpro sent the name but not the file. Open it in Simpro.' };
    case 'not-configured':
      return { title: 'Simpro not connected', body: outcome.reason };
    case 'failed':
      return { title: 'Could not download the file', body: outcome.error };
  }
}

/** Types by extension that the shared export table does not carry: what the office attaches. */
const ATTACHMENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  txt: 'text/plain;charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  zip: 'application/zip',
};

/**
 * The type a downloaded attachment's Blob is given, so the browser opens a
 * PDF as a PDF and a photo as a photo rather than as an unnamed download.
 *
 * Simpro's own type wins where it names one; a generic one says nothing, so
 * the file name decides, through the same table the generated files use.
 */
export function attachmentBlobType(filename: string, mimeType?: string | null): string {
  const given = (mimeType ?? '').trim().toLowerCase();
  if (given.includes('/') && given !== 'application/octet-stream') return given;
  const fromTable = blobTypeFor(filename);
  if (fromTable !== 'application/octet-stream') return fromTable;
  const dot = filename.lastIndexOf('.');
  const ext = dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
  return ATTACHMENT_TYPES[ext] ?? 'application/octet-stream';
}

/** One attachment, as a key: the office's id is unique only under its parent. */
export function attachmentKey(parent: AttachmentParent, attachmentId: string): string {
  return `${parent.kind}-${parent.externalId}-${attachmentId}`;
}
