import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { loadPrefs } from '@/app-prefs';
import { setJobAttachmentLocalUri, setQuoteAttachmentLocalUri, type AttachmentRecord } from '@/db/mirrorRepo';
import { shareFile } from '@/export/files';
import { safeFileName } from '@/export/fileNames';
import { fromBase64 } from '@/export/zip';
import { networkLooksOnline } from '@/simpro/autoSyncPolicy';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { SimproMirror } from '@/simpro/mirrorResources';

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

  let online = true;
  try {
    online = networkLooksOnline(await Network.getNetworkStateAsync());
  } catch {
    // A phone that cannot say is given the benefit of the doubt; the request itself will say.
  }
  if (!online) return { status: 'no-signal' };

  const prefs = await loadPrefs();
  const config = simproConfigFromPrefs(prefs);
  const missing = await SimproClient.missingCredentials(config);
  if (missing) return { status: 'not-configured', reason: missing };

  try {
    const mirror = new SimproMirror(new SimproClient(config));
    const withData = parent.kind === 'job'
      ? await mirror.jobAttachment(parent.externalId, attachment.id, { withData: true })
      : await mirror.quoteAttachment(parent.externalId, attachment.id, { withData: true });
    if (!withData.base64Data) return { status: 'no-bytes' };

    const bytes = fromBase64(withData.base64Data);
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

/** What to tell the person who tapped, for the outcomes that are not simply "it opened". */
export function describeOpenOutcome(outcome: OpenAttachmentOutcome): { title: string; body: string } | undefined {
  switch (outcome.status) {
    case 'opened': return undefined;
    case 'no-signal':
      return { title: 'Needs signal', body: 'This file is not on the phone yet. It comes down the first time it is opened with signal, and stays after that.' };
    case 'no-bytes':
      return { title: 'The office did not send the file', body: 'Simpro listed the attachment but returned it without its contents. Open it from Simpro on a computer for now.' };
    case 'not-configured':
      return { title: 'Simpro is not connected', body: outcome.reason };
    case 'failed':
      return { title: 'Could not fetch the file', body: outcome.error };
  }
}
