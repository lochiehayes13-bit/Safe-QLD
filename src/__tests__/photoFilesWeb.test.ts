import { buildDataUri } from '@/domain/dataUri';

/**
 * Keeping a photograph in the browser build.
 *
 * This is the bug the owner hit in the field, with the camera open and a defect
 * half filled in: "Could not keep that photo — this.validatePath is not a
 * function". `expo-file-system` has no web implementation worth the name, so
 * every screen that kept a photograph threw on the first line that touched
 * storage — on every iPhone in the company, because the browser build is the
 * only iOS build there is.
 *
 * What these hold is the two things the replacement has to get right. It has to
 * keep something that survives a page reload, which a `blob:` URL does not; and
 * it must never fail a capture, because a photograph that did not get kept is
 * evidence gone from a statutory notice and the technician has already walked
 * away from the fault.
 */

const manipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => manipulate(...args) },
  SaveFormat: { JPEG: 'jpeg' },
}));

/** A data URI of `bytes` bytes, so a size can be asserted exactly. */
function jpegOf(bytes: number): string {
  return buildDataUri('image/jpeg', Buffer.alloc(bytes, 7).toString('base64'));
}

/** What a browser's picker actually hands back, and what makes this hard. */
function mockBlobUrl(dataUri: string): void {
  const [, base64 = ''] = dataUri.split(',');
  const bytes = Buffer.from(base64, 'base64');
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
    blob: async () => ({ bytes }),
  });
  class FakeReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: { bytes: Buffer }) {
      this.result = buildDataUri('image/jpeg', blob.bytes.toString('base64'));
      this.onload?.();
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = FakeReader;
}

async function web() {
  return await import('@/export/photoFiles.web');
}

const input = {
  id: 'p1',
  subject: 'defect' as const,
  subjectId: 'pending',
  takenAt: '2026-09-29T00:10:00.000Z',
};

beforeEach(() => {
  jest.resetModules();
  manipulate.mockReset();
});

describe('keepPhoto in a browser', () => {
  it('reads a blob URL into bytes rather than storing the URL', async () => {
    /*
     * The load-bearing one. A blob: URL is scoped to the document that made it
     * and stops resolving the moment the page reloads, so storing one is
     * exactly the "record that quietly stops pointing at anything" this whole
     * module exists to prevent — the browser's version of the cleared cache
     * directory on a handset.
     */
    mockBlobUrl(jpegOf(1000));
    const { keepPhoto } = await web();

    const kept = await keepPhoto({ ...input, sourceUri: 'blob:https://app.example.com/9f2c' });

    expect(kept.path.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(kept.path).not.toContain('blob:');
    expect(kept.uri).toBe(kept.path);
    expect(kept.byteSize).toBe(1000);
    // The record is otherwise the phone's, so a screen cannot tell which half
    // it is talking to.
    expect(kept).toMatchObject({ id: 'p1', subject: 'defect', subjectId: 'pending', takenAt: input.takenAt });
  });

  it('keeps a photograph already under the cap exactly as it arrived', async () => {
    // Every JPEG re-encode loses a little, and a photograph of a hairline crack
    // has none to spare.
    const small = jpegOf(1000);
    const { keepPhoto, WEB_KEEP_BYTES } = await web();
    expect(1000).toBeLessThan(WEB_KEEP_BYTES);

    const kept = await keepPhoto({ ...input, sourceUri: small });

    expect(kept.path).toBe(small);
    expect(manipulate).not.toHaveBeenCalled();
  });

  it('re-encodes a large one smaller, because these bytes live in the record', async () => {
    const { WEB_KEEP_BYTES, WEB_MAX_DIMENSION, WEB_QUALITY } = await web();
    const saveAsync = jest.fn().mockResolvedValue({ base64: Buffer.alloc(900, 3).toString('base64'), uri: 'x' });
    const resize = jest.fn().mockReturnValue({ renderAsync: async () => ({ saveAsync }) });
    manipulate.mockReturnValue({ resize });

    const { keepPhoto } = await web();
    const kept = await keepPhoto({ ...input, sourceUri: jpegOf(WEB_KEEP_BYTES + 1) });

    expect(resize).toHaveBeenCalledWith({ width: WEB_MAX_DIMENSION });
    expect(saveAsync).toHaveBeenCalledWith(expect.objectContaining({ compress: WEB_QUALITY, base64: true }));
    expect(kept.byteSize).toBe(900);
  });

  it('keeps the big one when the shrink throws, rather than failing the capture', async () => {
    /*
     * A canvas refuses a tainted image and runs out of memory on a large one,
     * and both arrive as a throw. Big is a storage problem. Missing is evidence
     * gone from a notice, so the original is kept and nothing is said.
     */
    const { WEB_KEEP_BYTES } = await web();
    const big = jpegOf(WEB_KEEP_BYTES + 1);
    manipulate.mockImplementation(() => { throw new Error('canvas is tainted'); });

    const { keepPhoto } = await web();
    const kept = await keepPhoto({ ...input, sourceUri: big });

    expect(kept.path).toBe(big);
    expect(kept.byteSize).toBe(WEB_KEEP_BYTES + 1);
  });

  it('says so when the browser cannot read the photograph at all', async () => {
    // The one case that does throw: nothing was kept, so the screen has to be
    // able to tell the technician the photograph is not attached.
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('gone'));
    const { keepPhoto } = await web();

    await expect(keepPhoto({ ...input, sourceUri: 'blob:https://app.example.com/dead' })).rejects.toThrow('gone');
  });
});

describe('the rest of the browser half', () => {
  it('hands a stored photograph straight to an image, with no path to resolve', async () => {
    const { photoUri } = await web();
    const kept = jpegOf(10);
    expect(photoUri(kept)).toBe(kept);
  });

  it('answers whether a photograph can still be read, which cannot dangle here', async () => {
    const { photoExists } = await web();
    expect(photoExists(jpegOf(10))).toBe(true);
    // A path from a handset record, or a blob URL from a build before this one.
    expect(photoExists('photos/2026-defect-a1.jpg')).toBe(false);
    expect(photoExists('blob:https://app.example.com/9f2c')).toBe(false);
  });

  it('lists an empty directory, which is the true answer and not a stub', async () => {
    // There is no second place a photograph can be orphaned in when the
    // photograph is the record, so reconciliation has nothing to find.
    const { listPhotoFiles, deletePhotoFile } = await web();
    expect(listPhotoFiles()).toEqual([]);
    expect(() => deletePhotoFile()).not.toThrow();
  });
});
