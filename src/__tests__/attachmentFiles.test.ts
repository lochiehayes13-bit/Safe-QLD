/**
 * Reading a photograph for upload.
 *
 * The file system and the image manipulator cannot load under the node
 * preset, so both are stood in for here with the narrowest shapes this
 * module reaches for. What is proved is the one thing that costs a phone
 * the app: how many times a large photograph is decoded to a bitmap, and
 * that every bitmap is released — a twelve-megapixel photograph decoded
 * twice and held is what dropped the upload mid-way.
 */

interface FakeRef {
  width: number;
  height: number;
  released: number;
  release: () => void;
  saveAsync: (options: unknown) => Promise<{ uri: string; base64?: string }>;
}

const files = new Map<string, { exists: boolean; size?: number; base64: string }>();
const decodes: string[] = [];
const resizesFrom: unknown[] = [];
const refs: FakeRef[] = [];
let saveOptions: unknown[] = [];

function ref(width: number, height: number): FakeRef {
  const r: FakeRef = {
    width,
    height,
    released: 0,
    release() { r.released++; },
    async saveAsync(options) {
      saveOptions.push(options);
      files.set('file:///cache/small.jpg', { exists: true, size: 900_000, base64: 'c21hbGw=' });
      return { uri: 'file:///cache/small.jpg', base64: 'c21hbGw=' };
    },
  };
  refs.push(r);
  return r;
}

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists(): boolean { return files.get(this.uri)?.exists ?? false; }
    get size(): number | undefined { return files.get(this.uri)?.size; }
    async base64(): Promise<string> { return files.get(this.uri)?.base64 ?? ''; }
    delete(): void { files.delete(this.uri); }
  },
}));

jest.mock('@/export/photoFiles', () => ({
  photoUri: (relative: string) => `file:///documents/${relative}`,
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate(source: unknown) {
      let target: { width: number; height: number } | undefined;
      const context = {
        resize(size: { width: number; height: number }) {
          resizesFrom.push(source);
          target = size;
          return context;
        },
        async renderAsync(): Promise<FakeRef> {
          if (typeof source === 'string') {
            decodes.push(source);
            return ref(4000, 3000);
          }
          // Resizing a decoded image: the pixels come from the bitmap, not the file.
          const from = source as FakeRef;
          return ref(target?.width ?? from.width, target?.height ?? from.height);
        },
      };
      return context;
    },
  },
}));

import { readAttachmentForUpload } from '@/simpro/attachmentFiles';

beforeEach(() => {
  files.clear();
  decodes.length = 0;
  resizesFrom.length = 0;
  refs.length = 0;
  saveOptions = [];
});

const big = { localUri: 'photos/a.jpg', filename: 'Site — Plant room — 03-07-2026.jpg', mimeType: 'image/jpeg', sizeBytes: 6_000_000 };

describe('readAttachmentForUpload', () => {
  it('decodes a large photograph once, resizes from the bitmap, and releases both', async () => {
    files.set('file:///documents/photos/a.jpg', { exists: true, size: 6_000_000, base64: 'Ymln' });
    const out = await readAttachmentForUpload(big);
    expect(out.downscaled).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.filename).toBe('Site — Plant room — 03-07-2026.jpg');
    expect(out.base64).toBe('c21hbGw=');
    // The file was rendered exactly once; the resize took the decoded image, not the path.
    expect(decodes).toEqual(['file:///documents/photos/a.jpg']);
    expect(resizesFrom).toHaveLength(1);
    expect(resizesFrom[0]).toBe(refs[0]);
    expect(refs.map((r) => [r.width, r.height])).toEqual([[4000, 3000], [2000, 1500]]);
    // Every bitmap let go, the big one included.
    expect(refs.map((r) => r.released)).toEqual([1, 1]);
    expect(saveOptions[0]).toMatchObject({ compress: 0.85, format: 'jpeg', base64: true });
    // The manipulator's cache copy is not left behind.
    expect(files.has('file:///cache/small.jpg')).toBe(false);
  });

  it('re-encodes without a resize when the pixels already fit, and still releases the bitmap', async () => {
    files.set('file:///documents/photos/a.jpg', { exists: true, size: 6_000_000, base64: 'Ymln' });
    // A big file of few pixels: a scan, or a photograph with a lot of noise.
    const small = ref(1200, 900);
    const { ImageManipulator } = jest.requireMock('expo-image-manipulator') as {
      ImageManipulator: { manipulate: (s: unknown) => { renderAsync: () => Promise<FakeRef> } };
    };
    const original = ImageManipulator.manipulate;
    ImageManipulator.manipulate = (source: unknown) => ({
      resize: () => { throw new Error('a resize was asked for when the pixels already fit'); },
      renderAsync: async () => { decodes.push(String(source)); return small; },
    });
    try {
      const again = await readAttachmentForUpload(big);
      expect(again.downscaled).toBe(true);
      expect(decodes).toHaveLength(1);
      expect(resizesFrom).toEqual([]);
      expect(small.released).toBe(1);
    } finally {
      ImageManipulator.manipulate = original;
    }
  });

  it('sends a photograph under the cap as it is, without decoding it at all', async () => {
    files.set('file:///documents/photos/a.jpg', { exists: true, size: 1_000_000, base64: 'Ymln' });
    const out = await readAttachmentForUpload({ ...big, sizeBytes: 1_000_000 });
    expect(out).toEqual({ base64: 'Ymln', mimeType: 'image/jpeg', filename: big.filename, sizeBytes: 1_000_000, downscaled: false });
    expect(decodes).toEqual([]);
  });

  it('falls back to the original when the manipulator will not open the file', async () => {
    files.set('file:///documents/photos/a.jpg', { exists: true, size: 6_000_000, base64: 'Ymln' });
    const { ImageManipulator } = jest.requireMock('expo-image-manipulator') as {
      ImageManipulator: { manipulate: (s: unknown) => unknown };
    };
    const original = ImageManipulator.manipulate;
    ImageManipulator.manipulate = () => ({ renderAsync: async () => { throw new Error('unsupported format'); } });
    try {
      const out = await readAttachmentForUpload(big);
      expect(out.downscaled).toBe(false);
      expect(out.base64).toBe('Ymln');
      expect(out.sizeBytes).toBe(6_000_000);
    } finally {
      ImageManipulator.manipulate = original;
    }
  });

  it('says a missing file is missing rather than uploading nothing', async () => {
    await expect(readAttachmentForUpload(big)).rejects.toMatchObject({ name: 'AttachmentFileMissing' });
  });

  it('uses an absolute URI as it is and resolves a relative path under document storage', async () => {
    files.set('file:///somewhere/else.jpg', { exists: true, size: 10, base64: 'eA==' });
    const out = await readAttachmentForUpload({ ...big, localUri: 'file:///somewhere/else.jpg', sizeBytes: 10 });
    expect(out.base64).toBe('eA==');
  });
});
