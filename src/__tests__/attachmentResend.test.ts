/**
 * Sending a file to the job a second time, on purpose.
 *
 * The queue's content key stops a double tap sending one photograph twice.
 * It also stopped a person sending a PDF again after the office deleted it:
 * the row the first send left in 'sent' answered "duplicate" and nothing
 * went, while the screen said the file was on its way.
 */
import { claimSync, enqueueSync, markSynced, pendingSync } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: () => undefined }));
jest.mock('@/simpro/attachmentFiles', () => ({ AttachmentFileMissing: class extends Error {}, readAttachmentForUpload: jest.fn() }));
jest.mock('@/simpro/attachments', () => ({ uploadJobAttachment: jest.fn() }));

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const pdf = {
  jobId: '9001', localUri: 'data:application/pdf;base64,JVBERi0xLjQK', filename: 'Form 72 - Tower.pdf',
  mimeType: 'application/pdf', subject: 'Form 72', sizeBytes: 9, key: '',
};

describe('queueing the same file again', () => {
  it('is a duplicate by default, which is what a double tap wants', async () => {
    const first = await queueJobAttachment(pdf);
    const second = await queueJobAttachment(pdf);
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(await pendingSync()).toHaveLength(1);
  });

  it('goes again when asked to, even after the first send succeeded', async () => {
    const first = await queueJobAttachment(pdf);
    const claimed = await claimSync(first.id);
    expect(claimed).toBe(true);
    await markSynced(first.id);

    expect((await queueJobAttachment(pdf)).duplicate).toBe(true);
    const again = await queueJobAttachment(pdf, { resend: true });
    expect(again.duplicate).toBe(false);
    expect(again.id).not.toBe(first.id);
    expect((await pendingSync()).map((r) => r.id)).toEqual([again.id]);
  });

  it('keeps the plain key for anything else on the queue', async () => {
    await enqueueSync('note', { text: 'x' }, { contentKey: 'k' });
    expect((await enqueueSync('note', { text: 'x' }, { contentKey: 'k' })).duplicate).toBe(true);
  });
});
