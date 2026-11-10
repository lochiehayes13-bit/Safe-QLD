import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttachmentRecord } from '@/db/mirrorRepo';
import { codeOf } from './support/sourceCode';

/**
 * Opening an office attachment on an iPhone.
 *
 * The browser build is the only iOS build there is, and tapping a file on a
 * job or a quote there came back as "Could not fetch the file" every time:
 * the phone half writes the bytes with `expo-file-system`, whose web build is
 * stubs that throw on the first path. The browser half fetches the same
 * base64, builds a Blob and hands it over through an object URL.
 *
 * Simpro itself is faked at the one seam both halves share: the fetch.
 */

const fetchAttachmentBase64 = jest.fn();
jest.mock('@/services/attachmentFetch', () => ({
  fetchAttachmentBase64: (...args: unknown[]) => fetchAttachmentBase64(...args),
}));

interface FakeLink { href: string; download: string; rel: string; style: { display: string }; click: jest.Mock; remove: jest.Mock }

const links: FakeLink[] = [];
const blobs: Blob[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  fetchAttachmentBase64.mockReset();
  links.length = 0;
  blobs.length = 0;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      expect(tag).toBe('a');
      const link: FakeLink = { href: '', download: '', rel: '', style: { display: '' }, click: jest.fn(), remove: jest.fn() };
      links.push(link);
      return link;
    },
    body: { appendChild: jest.fn() },
  };
  let n = 0;
  jest.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    n += 1;
    return `blob:test/${n}`;
  });
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete (globalThis as unknown as { document?: unknown }).document;
});

async function web() {
  return await import('@/services/simproAttachments.web');
}

const plan: AttachmentRecord = { id: '77', filename: 'Level 2 plan.pdf', mimeType: 'application/pdf', sizeBytes: 5 };
const job = { kind: 'job' as const, localJobId: 'simpro-9001', externalId: '9001' };

describe('opening an attachment in a browser', () => {
  it('downloads the bytes as a typed Blob through an object URL', async () => {
    fetchAttachmentBase64.mockResolvedValue({ status: 'bytes', base64: Buffer.from('%PDF-').toString('base64') });
    const { openAttachment } = await web();

    const outcome = await openAttachment(job, plan);

    expect(outcome).toEqual({ status: 'opened', uri: 'blob:test/1' });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe('application/pdf');
    expect(Buffer.from(await blobs[0]!.arrayBuffer()).toString()).toBe('%PDF-');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ href: 'blob:test/1', download: 'Level 2 plan.pdf' });
    expect(links[0]!.click).toHaveBeenCalledTimes(1);
    expect(links[0]!.remove).toHaveBeenCalledTimes(1);

    // The URL is let go once the browser has had time to take the file.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('types a file Simpro sent without a type by its name', async () => {
    fetchAttachmentBase64.mockResolvedValue({ status: 'bytes', base64: Buffer.from('jpeg').toString('base64') });
    const { openAttachment } = await web();
    await openAttachment(job, { id: '78', filename: 'Riser.jpg' });
    expect(blobs[0]!.type).toBe('image/jpeg');
  });

  it('does not fetch the same file twice in one session', async () => {
    fetchAttachmentBase64.mockResolvedValue({ status: 'bytes', base64: Buffer.from('%PDF-').toString('base64') });
    const { openAttachment } = await web();
    await openAttachment(job, plan);
    const again = await openAttachment(job, plan);
    expect(fetchAttachmentBase64).toHaveBeenCalledTimes(1);
    expect(again.status).toBe('opened');
    expect(links).toHaveLength(2);
  });

  it('tells a quote’s file from a job’s with the same id', async () => {
    fetchAttachmentBase64.mockResolvedValue({ status: 'bytes', base64: Buffer.from('x').toString('base64') });
    const { openAttachment } = await web();
    await openAttachment(job, plan);
    await openAttachment({ kind: 'quote', externalId: '9001' }, plan);
    expect(fetchAttachmentBase64).toHaveBeenCalledTimes(2);
  });

  it('hands back what went wrong and opens nothing', async () => {
    const { openAttachment, describeOpenOutcome } = await web();
    for (const failure of [
      { status: 'no-signal' },
      { status: 'no-bytes' },
      { status: 'not-configured', reason: 'Add the client id in Settings.' },
      { status: 'failed', error: 'HTTP 500' },
    ]) {
      fetchAttachmentBase64.mockResolvedValueOnce(failure);
      const outcome = await openAttachment(job, plan);
      expect(outcome).toEqual(failure);
      expect(describeOpenOutcome(outcome)).toBeDefined();
    }
    expect(links).toHaveLength(0);
  });

  it('remembers nothing on the row, since an object URL dies with the page', () => {
    const source = codeOf(readFileSync(join(__dirname, '..', 'services', 'simproAttachments.web.ts'), 'utf8'));
    expect(source).not.toMatch(/setJobAttachmentLocalUri|setQuoteAttachmentLocalUri/);
  });
});

describe('nothing on the browser path touches a file system', () => {
  it.each([
    ['services/simproAttachments.web.ts'],
    ['services/attachmentFetch.ts'],
    ['domain/attachmentOpen.ts'],
  ])('%s', (file) => {
    const source = codeOf(readFileSync(join(__dirname, '..', file), 'utf8'));
    expect(source).not.toContain('expo-file-system');
    expect(source).not.toMatch(/from '@\/export\/files'/);
  });
});
