import * as Sharing from 'expo-sharing';
import { validEndpoint } from '@/domain/photoSend';

/**
 * Putting photographs somewhere, on a phone.
 *
 * The counterpart to ./photos.web.ts, split by filename the way `files.ts` and
 * `mail.ts` already are. Two routes live here and neither of them is email:
 * posting to the company's own endpoint, and handing the pictures to the
 * operating system.
 *
 * The mail composer is still reachable — it is `sendMail` in ./mail.ts, and
 * the screen falls back to it where neither of these can run — but it is no
 * longer the only way a photograph leaves this app.
 */

export interface PhotoToSend {
  /** Where the picture is on this device. */
  uri: string;
  name: string;
  /** Bytes, where the picker knew. Zero where it did not. */
  size: number;
}

export interface PhotoPost {
  endpointUrl: string;
  subject: string;
  body: string;
  technicianName: string;
  photos: readonly PhotoToSend[];
}

/** How long to wait on a van's signal before calling it a failure. */
const POST_TIMEOUT_MS = 120_000;

/**
 * Posts the photographs to the company's own endpoint.
 *
 * Multipart, because that is what every server already knows how to read and
 * it does not inflate the pictures by a third the way base64 would. React
 * Native's `FormData` takes a file as `{ uri, name, type }` and streams it
 * from disk, so a ten-photo send never holds forty megabytes in memory.
 *
 * Throws on anything but a 2xx, with the server's own words where it gave
 * any: the screen shows that sentence, and a person who set the address up
 * is the one who can act on it.
 */
export async function postPhotos(post: PhotoPost): Promise<void> {
  const url = validEndpoint(post.endpointUrl);
  if (!url) throw new Error('The photo address in Settings is not a usable https address.');

  const form = new FormData();
  form.append('subject', post.subject);
  form.append('body', post.body);
  form.append('technician', post.technicianName);
  for (const photo of post.photos) {
    // The cast is the documented shape for a file in React Native's FormData,
    // which the DOM's type definition has no name for.
    form.append('photos', { uri: photo.uri, name: photo.name, type: 'image/jpeg' } as unknown as Blob);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    if (!response.ok) {
      const said = await response.text().catch(() => '');
      throw new Error(said.trim().slice(0, 200) || `The office's photo address answered ${response.status}.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this device can hand files to the operating system. */
export async function canSharePhotos(): Promise<boolean> {
  try {
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Hands the photographs to the operating system.
 *
 * `expo-sharing` takes one file at a time, which is the whole reason the mail
 * composer was preferred here for so long. One at a time is still better than
 * a download folder and an empty draft — but it means a five-photo send opens
 * five sheets, which nobody wants. So the phone shares the first and the
 * screen says plainly that this route sends one, and the composer is the one
 * that takes them all.
 *
 * Answers false where nothing was shared, so the caller can fall back rather
 * than claiming a send.
 */
export async function sharePhotos(photos: readonly PhotoToSend[], dialogTitle: string): Promise<boolean> {
  const first = photos[0];
  if (!first) return false;
  if (!(await canSharePhotos())) return false;
  await Sharing.shareAsync(first.uri, { mimeType: 'image/jpeg', dialogTitle, UTI: 'public.jpeg' });
  return true;
}

/**
 * Whether the share sheet can take the whole pick in one gesture.
 *
 * It cannot, on a phone: `expo-sharing` is one file per call. The browser's
 * half answers true where the Web Share API will take an array, which is how
 * the web build ended up with the better route of the two.
 */
export function shareTakesAll(): boolean {
  return false;
}
