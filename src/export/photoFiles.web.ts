import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { buildDataUri, dataUriByteSize, isDataUri, parseDataUri } from '@/domain/dataUri';
import type { PhotoRef, PhotoSubject } from '@/domain/photoStore';

/**
 * Keeping a photograph, in a browser.
 *
 * The half that was missing, and the one the owner hit in the field: taking a
 * photograph on Raise defect died with `this.validatePath is not a function`.
 * That is `expo-file-system` saying it is not here. Its web build is four stub
 * classes that warn and do nothing, and the `File` constructor the phone half
 * uses calls a native method those stubs do not have — so every screen that
 * kept a photograph threw at the first line that touched storage, on every
 * iPhone in the company, because the browser build is the only iOS build there
 * is.
 *
 * There is no directory to copy into here and no fixing that. What a browser
 * does have is the record itself, so the photograph is kept *as* a `data:`
 * URI and that URI is the stored path. The bytes travel inside the defect
 * rather than being pointed at from it.
 *
 * Which turns out to close the failure `photoStore` was written about, rather
 * than reopening it. A path can outlive its file; a `data:` URI cannot dangle,
 * cannot be cleared under storage pressure, and cannot be lost by an app
 * reinstall moving the documents directory. The cost is size, and it is paid
 * honestly below: the browser copy is capped harder than the phone's, because
 * these bytes sit in a row that a defect list reads.
 *
 * ---
 *
 * The rule this shares with the phone half and with `photoResize`: **it never
 * fails a capture.** Every step that could throw falls back to keeping what it
 * already has. A photograph larger than intended is a storage problem. A
 * photograph that did not get kept is evidence gone from a statutory notice,
 * and the technician has walked away from the fault by the time anyone looks.
 */

/**
 * The longest edge a browser-kept photograph is stored at, and its quality.
 *
 * Tighter than the phone's 2048: these bytes live in the record, and
 * `listDefects` selects every column, so a site's defect list reads every
 * photograph it holds. 1280 still shows a cracked weld or a closed valve —
 * which is the whole job of the picture — at roughly a fifth of the row.
 */
export const WEB_MAX_DIMENSION = 1280;
export const WEB_QUALITY = 0.5;

/**
 * Above this, a kept photograph is re-encoded smaller before it is stored.
 *
 * Only a ceiling, not a target: a picture already under it is stored exactly as
 * it arrived, because every JPEG re-encode loses a little and a photograph of a
 * hairline crack has none to spare.
 */
export const WEB_KEEP_BYTES = 400_000;

export interface StoredPhoto extends PhotoRef {
  /** A URI that can be rendered now. On the web that is the stored path itself. */
  uri: string;
}

/**
 * Resolves a stored path to something an `<img>` can load.
 *
 * On this build a stored path is already a `data:` URI, so it is handed back
 * as it is. A path in the phone's `photos/…` shape reaches here only on a
 * record made on a handset and then opened in the browser — the two builds do
 * not share a database, so it should not happen, and if it ever does the honest
 * answer is the path rather than a guess at a URL that would render blank.
 */
export function photoUri(relativePath: string): string {
  return relativePath;
}

/** Bytes to a `data:` URI, via the browser's own reader. */
async function toDataUri(uri: string): Promise<string> {
  if (isDataUri(uri)) return uri;

  // A blob: URL is what the web image picker hands back, and it is scoped to
  // this document: it stops resolving the moment the page reloads. Storing one
  // is exactly the "record that quietly stops pointing at anything" this
  // module exists to prevent, so it is read into bytes here and never kept.
  const response = await fetch(uri);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The browser could not read the photograph back.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && isDataUri(result)) resolve(result);
      else reject(new Error('The browser returned the photograph in a form this app cannot store.'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * A smaller copy, or the original where one could not be made.
 *
 * `expo-image-manipulator` draws to a canvas on the web, and a canvas refuses
 * an image it considers tainted and runs out of memory on a large one. Both
 * come back as a throw, and both are answered by keeping what we already have.
 */
async function shrunk(dataUri: string): Promise<string> {
  try {
    const rendered = await ImageManipulator.manipulate(dataUri)
      .resize({ width: WEB_MAX_DIMENSION })
      .renderAsync();
    const saved = await rendered.saveAsync({ compress: WEB_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (saved.base64) return buildDataUri('image/jpeg', saved.base64);
    // Some builds answer with a URI and no base64; read it back the long way.
    return saved.uri ? await toDataUri(saved.uri) : dataUri;
  } catch {
    return dataUri;
  }
}

/**
 * Keeps a freshly captured photograph where a browser can still find it.
 *
 * `path` is the `data:` URI, which is what every consumer of a stored path
 * already handles: `photoUri` hands it to an `<img>`, and the web half of
 * `attachmentFiles` splits it back into base64 for the upload to Simpro.
 */
export async function keepPhoto(input: {
  id: string;
  sourceUri: string;
  subject: PhotoSubject;
  subjectId: string;
  takenAt: string;
  takenBy?: string;
  caption?: string;
}): Promise<StoredPhoto> {
  const kept = await toDataUri(input.sourceUri);
  const size = dataUriByteSize(kept) ?? 0;
  const stored = size > WEB_KEEP_BYTES ? await shrunk(kept) : kept;

  return {
    id: input.id,
    subject: input.subject,
    subjectId: input.subjectId,
    caption: input.caption,
    takenAt: input.takenAt,
    takenBy: input.takenBy,
    path: stored,
    byteSize: dataUriByteSize(stored),
    uri: stored,
  };
}

/**
 * True when the photograph behind a record can still be read.
 *
 * Which on this build is a question about the record and not about a disk: a
 * stored `data:` URI that parses is a photograph, and one that does not is a
 * record that was written by something other than `keepPhoto`.
 */
export function photoExists(relativePath: string): boolean {
  return parseDataUri(relativePath) !== undefined;
}

/**
 * Everything in the photo directory, for reconciliation. Always empty here, and
 * that is the true answer rather than a stub.
 *
 * Reconciliation exists to find two things: records whose file has gone, and
 * files no record points at. Neither can happen when the photograph *is* the
 * record — there is no second place for one to be orphaned in. The Settings
 * screen calls this and `photoStorageReport` compares it against the records,
 * so the shape has to stay honest: see `photoStorageReport` for why the web
 * build reads its sizes off the records themselves.
 */
export function listPhotoFiles(): { path: string; byteSize: number }[] {
  return [];
}

/**
 * Removes a photo file. Nothing to remove on this build.
 *
 * The bytes are in the record, so taking a photograph off a defect already
 * removes them. A no-op here rather than a throw, because the callers treat a
 * failure to delete as wasted space and not as something to interrupt anyone
 * over, and here there is not even that.
 */
export function deletePhotoFile(): void {
  // Nothing to do. See listPhotoFiles.
}
