import type { AttachmentRecord } from '@/db/mirrorRepo';
import { attachmentBlobType, attachmentKey, type AttachmentParent, type OpenAttachmentOutcome } from '@/domain/attachmentOpen';
import { fromBase64 } from '@/export/zip';
import { fetchAttachmentBase64 } from './attachmentFetch';

/**
 * Opening a file the office attached to a job or a quote, in a browser.
 *
 * The phone half writes the bytes into its documents folder and opens the
 * share sheet. Neither exists here: `expo-file-system`'s web build is stubs
 * that throw on the first path they are handed, which is how tapping an
 * attachment on an iPhone came back as "Could not fetch the file" every time.
 *
 * What a browser does have is a Blob and an object URL for it. The base64
 * comes down exactly as it does on the phone, becomes a Blob of the right
 * type, and is handed to the browser as a download: Safari offers to view or
 * save it, the home-screen app opens it as a preview with its own share
 * button, and a desktop puts it in the downloads.
 *
 * Nothing is remembered on the row. An object URL dies with the page, and a
 * stored one would be a row pointing at nothing after the next reload. The
 * last few files are held for this session instead, so a second tap on the
 * site plan does not fetch it again.
 */

export type { AttachmentParent, OpenAttachmentOutcome };
export { describeOpenOutcome } from '@/domain/attachmentOpen';

/** How many fetched files this page keeps in memory. Site plans run to megabytes. */
const KEEP = 4;
const recent = new Map<string, Blob>();

function keep(key: string, blob: Blob): void {
  recent.delete(key);
  recent.set(key, blob);
  while (recent.size > KEEP) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
  }
}

/**
 * Hands a Blob to the browser through an object URL.
 *
 * A link with `download` rather than a new window: a window opened after the
 * fetch's await is a pop-up as far as the browser is concerned and is blocked
 * without a word, and navigating the home-screen app itself to the file
 * leaves it with no way back. The URL is let go a minute later, long after
 * the browser has taken the file.
 */
function hand(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

/** Opens an attachment, fetching it first unless this page already holds it. */
export async function openAttachment(parent: AttachmentParent, attachment: AttachmentRecord): Promise<OpenAttachmentOutcome> {
  const key = attachmentKey(parent, attachment.id);
  const held = recent.get(key);
  if (held) {
    keep(key, held);
    return { status: 'opened', uri: hand(held, attachment.filename) };
  }

  const fetched = await fetchAttachmentBase64(parent, attachment);
  if (fetched.status !== 'bytes') return fetched;

  try {
    const bytes = fromBase64(fetched.base64);
    // A copy the Blob owns, the way the file layer builds its Blobs.
    const blob = new Blob([bytes.slice()], { type: attachmentBlobType(attachment.filename, attachment.mimeType) });
    keep(key, blob);
    return { status: 'opened', uri: hand(blob, attachment.filename) };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
