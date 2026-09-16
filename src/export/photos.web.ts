import { validEndpoint } from '@/domain/photoSend';

/**
 * Putting photographs somewhere, in a browser.
 *
 * This is the half that was broken. A browser cannot attach a file to a
 * `mailto:` — there is nowhere in the scheme to put one — so the old code
 * downloaded each picture, opened an empty addressed draft, and put an alert
 * on the screen telling the person to drag the files onto it. Three steps, two
 * applications, and a technician on an iPhone with no obvious downloads folder
 * to drag from.
 *
 * Browsers have had an answer to this for years and this app was not using it.
 * `navigator.share` takes an array of files and opens the operating system's
 * own share sheet with the pictures already on it: one tap to Mail, Gmail,
 * WhatsApp, anything. It is on iOS Safari and on Android Chrome, which is
 * every phone that opens this build — and where it is missing, the endpoint
 * route below does the job without any of it.
 */

/*
 * The shapes are the phone half's, imported rather than written out again:
 * TypeScript resolves the bare name to ./photos and the import is erased
 * before Metro sees it, so nothing from expo-sharing reaches the browser
 * bundle. Two copies of an interface are two things to keep in step, and this
 * is the arrangement MapCanvas and the geocoder already use.
 *
 * On the web a `uri` is a blob: or data: URL rather than a path on disk;
 * `fileFor` below is what turns one back into bytes.
 */
import type { PhotoPost, PhotoToSend } from './photos';

export type { PhotoPost, PhotoToSend };

const POST_TIMEOUT_MS = 120_000;

/** Reads a browser URI — blob: or data: — back into bytes the form can carry. */
async function fileFor(photo: PhotoToSend): Promise<File> {
  const response = await fetch(photo.uri);
  const blob = await response.blob();
  return new File([blob], photo.name, { type: blob.type || 'image/jpeg' });
}

/** Posts the photographs to the company's own endpoint. */
export async function postPhotos(post: PhotoPost): Promise<void> {
  const url = validEndpoint(post.endpointUrl);
  if (!url) throw new Error('The photo address in Settings is not a usable https address.');

  const form = new FormData();
  form.append('subject', post.subject);
  form.append('body', post.body);
  form.append('technician', post.technicianName);
  for (const photo of post.photos) form.append('photos', await fileFor(photo));

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

type FileSharer = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

function sharer(): FileSharer | null {
  if (typeof navigator === 'undefined') return null;
  const n = navigator as FileSharer;
  return typeof n.share === 'function' ? n : null;
}

/**
 * Whether this browser will take files on a share.
 *
 * `canShare` has to be asked with an actual file, because a browser that has
 * `share` for links may refuse files — and answering yes and then failing is
 * worse than answering no, since the caller has a working fallback either way.
 */
export async function canSharePhotos(): Promise<boolean> {
  const n = sharer();
  if (!n || typeof n.canShare !== 'function') return false;
  try {
    const probe = new File([new Blob([new Uint8Array([0])], { type: 'image/jpeg' })], 'probe.jpg', { type: 'image/jpeg' });
    return n.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Hands the whole pick to the operating system in one gesture.
 *
 * Answers false where the browser refused or the person dismissed the sheet,
 * so the caller can say "nothing was sent" rather than claiming one. A
 * dismissed share rejects with an AbortError, which is a person changing their
 * mind and not a fault.
 */
export async function sharePhotos(photos: readonly PhotoToSend[], dialogTitle: string): Promise<boolean> {
  const n = sharer();
  if (!n || !photos.length) return false;
  try {
    const files = await Promise.all(photos.map(fileFor));
    if (typeof n.canShare === 'function' && !n.canShare({ files })) return false;
    await n.share!({ files, title: dialogTitle });
    return true;
  } catch {
    return false;
  }
}

/** A browser's share sheet takes the whole array, unlike the phone's. */
export function shareTakesAll(): boolean {
  return true;
}
