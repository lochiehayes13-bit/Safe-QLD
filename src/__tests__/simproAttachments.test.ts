import {
  ATTACHMENT_UPLOAD_MAX_BYTES, UPLOAD_JPEG_QUALITY, UPLOAD_MAX_DIMENSION,
  attachmentBody, readUploadResponse, shrinkForUpload, uploadJobAttachment, type AttachmentPoster,
} from '@/simpro/attachments';

/**
 * Putting a photograph onto a job.
 *
 * The file system half cannot run here, so what is proved is the half that
 * decides: whether a photograph is shrunk before it goes and by how much,
 * the exact request the endpoint gets, and that the reply is read without
 * trusting it — the shape was documented, not observed on the live build.
 */
describe('shrinkForUpload', () => {
  it('sends a photograph under the cap as it is, because every re-encode loses a little', () => {
    expect(shrinkForUpload(ATTACHMENT_UPLOAD_MAX_BYTES)).toBeUndefined();
    expect(shrinkForUpload(1_200_000, 4000, 3000)).toBeUndefined();
    expect(shrinkForUpload(0)).toBeUndefined();
    expect(shrinkForUpload(undefined)).toBeUndefined();
    expect(shrinkForUpload(Number.NaN)).toBeUndefined();
  });

  it('brings the long edge down to the upload dimension, keeping the aspect ratio', () => {
    expect(shrinkForUpload(6_000_000, 4000, 3000)).toEqual({
      resize: { width: UPLOAD_MAX_DIMENSION, height: 1500 },
      quality: UPLOAD_JPEG_QUALITY,
      mimeType: 'image/jpeg',
    });
    // Taken sideways: the long edge is the height, and it is the one capped.
    expect(shrinkForUpload(6_000_000, 3000, 4000)?.resize).toEqual({ width: 1500, height: UPLOAD_MAX_DIMENSION });
  });

  it('only re-encodes where the pixels already fit, or are not known', () => {
    expect(shrinkForUpload(6_000_000, 1600, 1200)).toEqual({ resize: undefined, quality: UPLOAD_JPEG_QUALITY, mimeType: 'image/jpeg' });
    expect(shrinkForUpload(6_000_000)).toEqual({ resize: undefined, quality: UPLOAD_JPEG_QUALITY, mimeType: 'image/jpeg' });
  });

  it('is a mobile-data cap, not a server one, and the caller can move it', () => {
    expect(ATTACHMENT_UPLOAD_MAX_BYTES).toBe(4_000_000);
    expect(shrinkForUpload(500_000, 4000, 3000, 400_000)?.resize).toEqual({ width: 2000, height: 1500 });
  });
});

describe('the upload', () => {
  const poster = () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const client: AttachmentPoster = {
      request: async <T,>(method: string, path: string, options: { body?: unknown } = {}) => {
        calls.push({ method, path, body: options.body });
        return { data: { ID: '9001', Filename: 'a.jpg' } as T, total: null };
      },
    };
    return { client, calls };
  };

  it("posts to the job's attachment files with the trailing slash a collection takes, never public", async () => {
    const { client, calls } = poster();
    const out = await uploadJobAttachment(client, '43747', { filename: 'a.jpg', mimeType: 'image/jpeg', base64: 'AAAA' });
    expect(calls).toEqual([{
      method: 'POST',
      path: 'jobs/43747/attachments/files/',
      body: { Filename: 'a.jpg', Base64Data: 'AAAA', Public: false },
    }]);
    expect(out).toEqual({ id: '9001', filename: 'a.jpg', acknowledged: true });
  });

  it('never marks a photograph public', () => {
    expect(attachmentBody({ filename: 'x.jpg', mimeType: 'image/jpeg', base64: 'Zg==' }).Public).toBe(false);
  });

  it('reads the id off the reply without trusting its shape', () => {
    expect(readUploadResponse({ ID: '12', Filename: 'a.jpg' })).toEqual({ id: '12', filename: 'a.jpg', acknowledged: true });
    expect(readUploadResponse({ ID: 12 })).toEqual({ id: '12', filename: undefined, acknowledged: true });
    expect(readUploadResponse({ ID: '  ' })).toEqual({ id: undefined, filename: undefined, acknowledged: false });
    expect(readUploadResponse({})).toEqual({ id: undefined, filename: undefined, acknowledged: false });
    expect(readUploadResponse(null)).toEqual({ acknowledged: false });
    expect(readUploadResponse('created')).toEqual({ acknowledged: false });
  });

  it('lets a failure through as the client threw it, status and all', async () => {
    // The queue decides from the status whether the server acted; a wrapped
    // error would hide that.
    const client: AttachmentPoster = {
      request: async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }); },
    };
    await expect(uploadJobAttachment(client, '1', { filename: 'a.jpg', mimeType: 'image/jpeg', base64: 'AAAA' }))
      .rejects.toMatchObject({ status: 403 });
  });
});
