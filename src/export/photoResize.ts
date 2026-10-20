import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CAPTURE_QUALITY, MAX_DIMENSION, shrinkTarget } from '@/domain/photoStore';

/**
 * Brings a captured photograph down to the size the app said it would keep.
 *
 * `MAX_DIMENSION` was declared beside `CAPTURE_QUALITY` and never used, so only
 * half the trade the comment there describes was actually made. A picker's
 * `quality` setting is JPEG compression; it does not touch the pixel count. A
 * modern handset shoots around 4000 x 3000, and compressing that still leaves a
 * couple of megabytes a photograph.
 *
 * Twenty photographs on a job is eighty megabytes, on a device that is also
 * holding 897 sites and 12,553 assets offline so it works without signal. The
 * same photographs go into a report that gets shared from a plant room.
 *
 * ---
 *
 * Two things this deliberately will not do.
 *
 * **It never fails a capture.** If the resize throws — an unsupported format, a
 * codec that will not open the file, no memory for a large bitmap — the
 * original photograph is kept at full size. A big photograph is a storage
 * problem; a missing one is evidence gone from a statutory notice, and the
 * technician has already walked away from the fault by the time anyone looks.
 *
 * **It never enlarges and never re-encodes needlessly.** A photograph already
 * inside the cap is handed straight back untouched, because every JPEG
 * re-encode loses a little and a photograph of a hairline crack has none to
 * spare. `shrinkTarget` decides that, and it is tested.
 */
export async function shrinkForStorage(asset: {
  uri: string;
  width?: number;
  height?: number;
}): Promise<string> {
  const { uri, width, height } = asset;

  // No dimensions means the picker did not report them. Resizing to a guess is
  // worse than keeping what we have.
  if (width === undefined || height === undefined) return uri;

  const target = shrinkTarget(width, height, MAX_DIMENSION);
  if (!target) return uri;

  try {
    const rendered = await ImageManipulator.manipulate(uri)
      .resize({ width: target.width, height: target.height })
      .renderAsync();
    const saved = await rendered.saveAsync({
      compress: CAPTURE_QUALITY,
      format: SaveFormat.JPEG,
    });
    return saved.uri || uri;
  } catch {
    return uri;
  }
}
