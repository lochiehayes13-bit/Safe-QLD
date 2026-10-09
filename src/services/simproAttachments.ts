import { Directory, File, Paths } from 'expo-file-system';
import { setJobAttachmentLocalUri, setQuoteAttachmentLocalUri, type AttachmentRecord } from '@/db/mirrorRepo';
import type { AttachmentParent, OpenAttachmentOutcome } from '@/domain/attachmentOpen';
import { shareFile } from '@/export/files';
import { safeFileName } from '@/export/fileNames';
import { fromBase64 } from '@/export/zip';
import { fetchAttachmentBase64 } from './attachmentFetch';

/**
 * Opening a file the office attached to a job or a quote.
 *
 * The mirror lists attachments — name, size, who, when — but never their
 * bytes: a site plan is megabytes, and a phone that pulled every file on
 * every job would fill up in a week. So the bytes come down the first time
 * somebody taps the row, are kept in the app's own documents folder, and
 * the row remembers where they are; the second tap is free and works in a
 * basement.
 *
 * "Open" here is the system share sheet, which on both platforms is also
 * the "open with" sheet. The app has no viewer of its own for a PDF or a
 * spreadsheet and should not pretend to.
 */

export type { AttachmentParent, OpenAttachmentOutcome };
export { describeOpenOutcome } from '@/domain/attachmentOpen';

function attachmentDir(parent: AttachmentParent): Directory {
  const dir = new Directory(Paths.document, 'simpro-attachments', `${parent.kind}-${parent.externalId}`);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

async function rememberUri(parent: AttachmentParent, attachmentId: string, uri: string | null): Promise<void> {
  if (parent.kind === 'job') await setJobAttachmentLocalUri(parent.localJobId, attachmentId, uri);
  else await setQuoteAttachmentLocalUri(parent.externalId, attachmentId, uri);
}

async function present(uri: string, name: string, size: number): Promise<OpenAttachmentOutcome> {
  await shareFile({ uri, name, size });
  return { status: 'opened', uri };
}

/**
 * Opens an attachment, fetching it first where the phone does not hold it.
 *
 * A remembered file that the OS has since removed is forgotten and fetched
 * again rather than reported as broken: the row's memory is a convenience,
 * not a fact.
 */
export async function openAttachment(parent: AttachmentParent, attachment: AttachmentRecord): Promise<OpenAttachmentOutcome> {
  if (attachment.localUri) {
    try {
      const held = new File(attachment.localUri);
      if (held.exists) return await present(held.uri, attachment.filename, held.size ?? attachment.sizeBytes ?? 0);
    } catch {
      // Fall through to a fresh read.
    }
    await rememberUri(parent, attachment.id, null);
  }

  const fetched = await fetchAttachmentBase64(parent, attachment);
  if (fetched.status !== 'bytes') return fetched;

  try {
    const bytes = fromBase64(fetched.base64);
    // The office's id keeps two files with the same name apart; the name
    // keeps the share sheet readable.
    const file = new File(attachmentDir(parent), `${attachment.id}-${safeFileName(attachment.filename, 'attachment')}`);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    await rememberUri(parent, attachment.id, file.uri);
    return await present(file.uri, attachment.filename, bytes.length);
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
