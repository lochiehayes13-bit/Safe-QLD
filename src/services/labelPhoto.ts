import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import type { CompletionImage } from '@/ai/client';

/**
 * A photograph of a detector label, made small enough to send to the model.
 *
 * The camera gives back twelve megapixels; a label needs nowhere near that,
 * and every byte goes over the technician's data. The image is decoded once,
 * resized so its longer side is at most `MAX_SIDE`, and re-encoded as a JPEG
 * with base64 in the same step, which is the only way to get the bytes
 * without writing a second file and reading it back.
 *
 * Kept apart from @/ai/labelReading so that module stays pure: the
 * manipulator is native and does not load under the test preset.
 */

/** Long enough to keep small print legible, small enough to send on one bar. */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

function release(image: ImageRef | undefined): void {
  try { image?.release(); } catch { /* already gone */ }
}

/**
 * Encodes the photograph at `uri` for the model, or throws in words.
 *
 * Throws rather than returning undefined because every caller shows the
 * reason: a photograph that cannot be decoded is worth a sentence, not a
 * silent button.
 */
export async function encodeLabelPhoto(uri: string): Promise<CompletionImage> {
  let decoded: ImageRef | undefined;
  let resized: ImageRef | undefined;
  try {
    decoded = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(decoded.width, decoded.height);
    let image = decoded;
    if (longest > MAX_SIDE) {
      const scale = MAX_SIDE / longest;
      resized = await ImageManipulator.manipulate(decoded)
        .resize({ width: Math.round(decoded.width * scale), height: Math.round(decoded.height * scale) })
        .renderAsync();
      release(decoded);
      decoded = undefined;
      image = resized;
    }
    const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (!saved.base64) throw new Error('The photograph could not be encoded.');
    return { base64: saved.base64, mediaType: 'image/jpeg' };
  } finally {
    release(resized);
    release(decoded);
  }
}
