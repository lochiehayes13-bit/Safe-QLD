import { buildDataUri } from '@/domain/dataUri';
import {
  AttachmentFileMissing, photosWithSizes, readAttachmentForUpload,
} from '@/simpro/attachmentFiles.web';

/**
 * Sending a browser-kept photograph to Simpro.
 *
 * The phone half opens a file and asks for base64. Here the base64 is already
 * in the stored path, because the browser build keeps a photograph as a `data:`
 * URI — so this is a split rather than a read, and what it has to get right is
 * what it does with a path it cannot split.
 */

const bytes = Buffer.from('some jpeg bytes');
const kept = buildDataUri('image/jpeg', bytes.toString('base64'));

const payload = {
  localUri: kept,
  filename: 'Level 3 east - 29092026.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 0,
};

describe('readAttachmentForUpload in a browser', () => {
  it('sends the bytes and the size that are actually there', async () => {
    const read = await readAttachmentForUpload(payload);
    expect(read.base64).toBe(bytes.toString('base64'));
    expect(read.sizeBytes).toBe(bytes.length);
    expect(read.filename).toBe(payload.filename);
    // Nothing is decoded or re-encoded on this path, so nothing was downscaled
    // and the queue should not be told otherwise.
    expect(read.downscaled).toBe(false);
  });

  it('uploads under the type the bytes are, not the one the row guessed', async () => {
    // The browser re-encodes to JPEG when it shrinks a photograph, so a row
    // carrying the original .png name would otherwise put a PNG label on JPEG
    // bytes — a file Simpro will not open.
    const read = await readAttachmentForUpload({
      ...payload,
      localUri: buildDataUri('image/jpeg', bytes.toString('base64')),
      mimeType: 'image/png',
    });
    expect(read.mimeType).toBe('image/jpeg');
  });

  /*
   * The one that matters for the queue. A row it can never send has to fail as
   * "missing", not as an error that looks like the server's — a server fault is
   * retried forever, and a photograph this build cannot resolve will not become
   * resolvable on the next attempt.
   */
  it.each([
    ['a path from a handset record', 'photos/20260929-0010-defect-p1.jpg'],
    ['a blob URL from a build before this one', 'blob:https://app.example.com/9f2c'],
    ['a file URL', 'file:///documents/photos/a.jpg'],
    ['nothing at all', ''],
  ])('reports %s as missing rather than uploading something else', async (_what, localUri) => {
    await expect(readAttachmentForUpload({ ...payload, localUri }))
      .rejects.toBeInstanceOf(AttachmentFileMissing);
  });
});

describe('photosWithSizes in a browser', () => {
  it('sizes what it can read and leaves the rest without a size', async () => {
    expect(photosWithSizes([kept, 'photos/a.jpg'])).toEqual([
      { path: kept, sizeBytes: bytes.length },
      { path: 'photos/a.jpg' },
    ]);
  });
});
