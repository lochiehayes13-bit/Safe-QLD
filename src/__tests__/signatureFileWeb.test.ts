import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDataUri } from '@/domain/dataUri';
import { signatureFilename } from '@/domain/jobActions';
import { strokesToSvg } from '@/domain/signature';
import { keepSignature } from '@/export/signatureFile.web';
import { readAttachmentForUpload } from '@/simpro/attachmentFiles.web';
import { codeOf } from './support/sourceCode';

/**
 * Signing a job off on an iPhone.
 *
 * Sign off died on its first line there: the job screen built a
 * `Directory` in document storage, and `expo-file-system`'s web build is
 * stubs that throw. Even with storage, the queued path was `photos/…`, which
 * the browser's upload reader cannot resolve and reports as a missing file.
 * The browser now keeps the signature the way it keeps a photograph: a base64
 * `data:` URI that is the stored path.
 */

const svg = strokesToSvg([[{ x: 4, y: 6 }, { x: 40, y: 22 }, { x: 80, y: 10 }]], 300, 120)!;

describe('keeping a signature in a browser', () => {
  it('keeps it as a base64 SVG data: URI', () => {
    const kept = keepSignature(signatureFilename('9001', '2026-10-09T01:30:00.000Z'), svg);
    const parsed = parseDataUri(kept.localUri);
    expect(parsed?.mimeType).toBe('image/svg+xml');
    expect(Buffer.from(parsed!.base64, 'base64').toString('utf8')).toBe(svg);
    expect(kept.sizeBytes).toBe(Buffer.byteLength(svg, 'utf8'));
  });

  it('is what the upload reader accepts, so the queued row sends', async () => {
    const filename = signatureFilename('9001', '2026-10-09T01:30:00.000Z');
    const kept = keepSignature(filename, svg);
    const read = await readAttachmentForUpload({ localUri: kept.localUri, filename, mimeType: 'image/svg+xml', sizeBytes: kept.sizeBytes });
    expect(read.mimeType).toBe('image/svg+xml');
    expect(read.sizeBytes).toBe(kept.sizeBytes);
    expect(Buffer.from(read.base64, 'base64').toString('utf8')).toBe(svg);
  });

  it('survives characters outside ASCII in the document', () => {
    const named = svg.replace('</svg>', '<title>Signed by Zoë Ngāti</title></svg>');
    const kept = keepSignature('Sign-off 9001.svg', named);
    expect(Buffer.from(parseDataUri(kept.localUri)!.base64, 'base64').toString('utf8')).toBe(named);
    expect(kept.sizeBytes).toBe(Buffer.byteLength(named, 'utf8'));
  });

  it('never reaches for a file system', () => {
    const source = codeOf(readFileSync(join(__dirname, '..', 'export', 'signatureFile.web.ts'), 'utf8'));
    expect(source).not.toContain('expo-file-system');
  });
});

describe('the job screen’s sign-off', () => {
  const screen = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'work', 'job', '[id].tsx'), 'utf8'));

  it('keeps the signature through the split helper, not the file system directly', () => {
    expect(screen).toContain('keepSignature(filename, svg)');
    expect(screen).not.toContain('expo-file-system');
    expect(screen).not.toMatch(/new (Directory|File)\(/);
  });

  it('queues what the helper kept, whichever build kept it', () => {
    expect(screen).toMatch(/jobId: job\.externalId, localUri, filename, mimeType: 'image\/svg\+xml'/);
    expect(screen).not.toContain('photoPath(stored)');
  });
});
