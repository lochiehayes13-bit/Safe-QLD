import * as Network from 'expo-network';
import { loadPrefs } from '@/app-prefs';
import type { AttachmentRecord } from '@/db/mirrorRepo';
import type { AttachmentParent, OpenAttachmentOutcome } from '@/domain/attachmentOpen';
import { networkLooksOnline } from '@/simpro/autoSyncPolicy';
import { SimproClient } from '@/simpro/client';
import { simproConfigFromPrefs } from '@/simpro/config';
import { SimproMirror } from '@/simpro/mirrorResources';

/**
 * Reading an attachment's bytes from Simpro, for either build.
 *
 * Nothing here touches a file: the phone half writes what comes back to its
 * documents folder and the browser half builds a Blob from it, and both ask
 * this for the base64 first. Kept apart from both so the browser bundle never
 * reaches `expo-file-system` through it.
 */

export type AttachmentBytes =
  | { status: 'bytes'; base64: string }
  | Exclude<OpenAttachmentOutcome, { status: 'opened' }>;

export async function fetchAttachmentBase64(parent: AttachmentParent, attachment: AttachmentRecord): Promise<AttachmentBytes> {
  let online = true;
  try {
    online = networkLooksOnline(await Network.getNetworkStateAsync());
  } catch {
    // A device that cannot say is given the benefit of the doubt; the request itself will say.
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
    return { status: 'bytes', base64: withData.base64Data };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
