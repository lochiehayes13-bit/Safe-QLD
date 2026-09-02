import { getJob, setJobStatus, upsertJob } from '@/db/opsRepo';
import { flushSoon } from '@/simpro/flushSoon';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
// Marking a job complete asks for the queue to be sent in a moment. Under
// test there is nothing to send it with, and the ask itself is what is checked.
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * What the office is allowed to overwrite on a job.
 *
 * A job row is written by two hands. The sync writes it from Simpro before
 * every run and again after; the technician writes to it on site — starts it,
 * finishes it, notes what they found. The upsert's conflict clause took every
 * column from the office copy, so a sync during the day put a job the
 * technician had started back to "scheduled" and threw their notes away.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

const fromOffice = (over: Partial<Parameters<typeof upsertJob>[0]> = {}) => upsertJob({
  id: 'job-1',
  externalId: '43747',
  siteName: 'BRIC Housing Emsworth St',
  title: 'Six-monthly routine',
  stage: 'Pending',
  status: 'scheduled',
  ...over,
});

describe('a job the office re-sends during the day', () => {
  it('keeps the status the technician set on site', async () => {
    await fromOffice();
    await setJobStatus('job-1', 'in-progress');
    await fromOffice();
    expect((await getJob('job-1'))?.status).toBe('in-progress');

    await setJobStatus('job-1', 'complete');
    await fromOffice();
    expect((await getJob('job-1'))?.status).toBe('complete');
  });

  it('still takes the office status while nothing has happened on site', async () => {
    await fromOffice({ status: 'scheduled' });
    await fromOffice({ status: 'blocked' });
    expect((await getJob('job-1'))?.status).toBe('blocked');
  });

  it('takes the office stage, which is the office\'s to set', async () => {
    await fromOffice({ stage: 'Pending' });
    await setJobStatus('job-1', 'in-progress');
    await fromOffice({ stage: 'Complete' });
    expect((await getJob('job-1'))?.stage).toBe('Complete');
  });

  it('keeps notes already on the job rather than blanking them', async () => {
    await fromOffice({ notes: 'Key in the lockbox, code with the manager' });
    await fromOffice({ notes: undefined });
    expect((await getJob('job-1'))?.notes).toBe('Key in the lockbox, code with the manager');
  });

  it('keeps the site it was matched to when the office copy has none', async () => {
    for (const id of ['site-9', 'site-10']) {
      await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES (?,?,'','')", id, `Site ${id}`);
    }
    await fromOffice({ siteId: 'site-9' });
    await fromOffice({ siteId: undefined });
    expect((await getJob('job-1'))?.siteId).toBe('site-9');
    await fromOffice({ siteId: 'site-10' });
    expect((await getJob('job-1'))?.siteId).toBe('site-10');
  });
});

describe('the outbound queue', () => {
  const { enqueueSync, pendingSync, markSyncUnknown, retrySync, dismissSync, unknownSync } = jest.requireActual('@/db/opsRepo') as typeof import('@/db/opsRepo');

  it('stores the same note once, however many times it is queued', async () => {
    // A double tap, or a screen that re-queues on focus, used to become two
    // notes on the job.
    const first = await enqueueSync('job-note', { jobId: '1', subject: 'S', note: 'N' });
    const second = await enqueueSync('job-note', { subject: 'S', note: 'N', jobId: '1' });
    expect({ dup1: first.duplicate, dup2: second.duplicate, sameRow: first.id === second.id }).toEqual({ dup1: false, dup2: true, sameRow: true });
    expect(await pendingSync()).toHaveLength(1);
  });

  it('keeps a send with no reply out of the retry loop until a person decides', async () => {
    const { id } = await enqueueSync('purchase-order', { jobId: '1', lines: [] });
    await markSyncUnknown(id, 'Network request failed');
    expect(await pendingSync()).toHaveLength(0);
    expect((await unknownSync()).map((u) => u.id)).toEqual([id]);
    await retrySync(id);
    expect((await pendingSync()).map((u) => u.id)).toEqual([id]);
  });

  it('lets a person close one they found in Simpro, and will not queue its twin again', async () => {
    const { id } = await enqueueSync('job-note', { jobId: '2', subject: 'T', note: 'U' });
    await markSyncUnknown(id, 'timeout');
    await dismissSync(id);
    expect(await unknownSync()).toHaveLength(0);
    expect((await enqueueSync('job-note', { jobId: '2', subject: 'T', note: 'U' })).duplicate).toBe(true);
  });
});

/**
 * Telling the office a job was finished.
 *
 * The moment a technician marks a job complete, a short note is queued for
 * the Simpro job: what, when, who. What matters is that it is one note — a
 * double tap, a re-open and re-close, a screen re-saving its state are all
 * the same completion — and that a job with no office number gets none,
 * because there is nowhere to put it.
 */
describe('marking a job complete', () => {
  const { pendingSync } = jest.requireActual('@/db/opsRepo') as typeof import('@/db/opsRepo');

  beforeEach(() => { jest.mocked(flushSoon).mockClear(); });

  it('queues one work-completed note for the office, however many times it is pressed', async () => {
    await fromOffice();
    await setJobStatus('job-1', 'complete');
    await setJobStatus('job-1', 'complete');

    const queued = await pendingSync();
    expect(queued.map((q) => q.kind)).toEqual(['job-note']);
    const payload = JSON.parse(queued[0]!.payload) as { jobId: string; subject: string; note: string };
    expect(payload.jobId).toBe('43747');
    expect(payload.subject).toContain('Work completed');
    expect(payload.note).toContain('WORK COMPLETED - Six-monthly routine');
    // The note's own key is the queue's key, and it is already in the text, so
    // the sender adds no second marker.
    expect(payload.note).toContain(`[SQ-REF:${queued[0]!.contentKey}]`);
    expect(flushSoon).toHaveBeenCalledTimes(1);
  });

  it('queues it once even after the job is reopened and closed again the same day', async () => {
    await fromOffice();
    await setJobStatus('job-1', 'complete');
    await setJobStatus('job-1', 'in-progress');
    await setJobStatus('job-1', 'complete');
    expect(await pendingSync()).toHaveLength(1);
  });

  it('queues nothing for a job that did not come from the office', async () => {
    await upsertJob({ id: 'job-2', siteName: 'A site', title: 'Call-out', status: 'scheduled' });
    await setJobStatus('job-2', 'complete');
    expect(await pendingSync()).toHaveLength(0);
    expect(flushSoon).not.toHaveBeenCalled();
  });

  it('names the routine service done under the job, where one was linked', async () => {
    await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES ('site-1','An Example Building','','')");
    await db.runAsync(
      `INSERT INTO routine_run (id, siteId, routineId, routineLabel, frequency, system, completedAt,
         checksPassed, checksFailed, checksNotTested, defectsRaised)
       VALUES ('run-1','site-1','routine-annual','Annual detection service','yearly','Detection',
         '2026-07-03T04:30:00.000Z',10,1,0,1)`,
    );
    await db.runAsync("INSERT INTO outbound_job_link (runId, jobId, linkedAt) VALUES ('run-1','43747','2026-07-03T05:00:00.000Z')");
    await fromOffice();
    await setJobStatus('job-1', 'complete');

    const [row] = await pendingSync();
    const payload = JSON.parse(row!.payload) as { note: string };
    expect(payload.note).toContain('Routine: Annual detection service (yearly) - Detection, 03/07/2026.');
    expect(payload.note).toContain('Results: 10 passed, 1 failed, 0 not tested; 1 defect raised.');
  });
});

/**
 * Photographs in the queue.
 *
 * A photograph is the one queued thing whose file can go missing underneath
 * it, so it is counted apart from the rest and can be given up on at once.
 */
describe('queued photographs', () => {
  const { enqueueSync, pendingSync, markSyncUnknown, abandonSync, attachmentQueueSummary } =
    jest.requireActual('@/db/opsRepo') as typeof import('@/db/opsRepo');

  it('counts them by where they stand, apart from everything else in the queue', async () => {
    const a = await enqueueSync('attachment', { jobId: '1', filename: 'a.jpg', sizeBytes: 10 });
    const b = await enqueueSync('attachment', { jobId: '1', filename: 'b.jpg', sizeBytes: 10 });
    await enqueueSync('attachment', { jobId: '1', filename: 'c.jpg', sizeBytes: 10 });
    await enqueueSync('job-note', { jobId: '1', subject: 'S', note: 'N' });
    await abandonSync(a.id, 'The photo file is no longer on this device');
    await markSyncUnknown(b.id, 'timeout');

    expect(await attachmentQueueSummary()).toEqual({ pending: 1, unknown: 1, failed: 1, sent: 0 });
    expect((await pendingSync()).map((q) => q.kind).sort()).toEqual(['attachment', 'job-note']);
  });

  it('gives up on one at once when told to, with the reason where a person reads first', async () => {
    const { id } = await enqueueSync('attachment', { jobId: '1', filename: 'c.jpg', sizeBytes: 10 });
    await abandonSync(id, 'gone');
    const row = await db.getFirstAsync<{ status: string; attempts: number; lastError: string }>(
      'SELECT status, attempts, lastError FROM sync_queue WHERE id = ?', id,
    );
    expect(row).toEqual({ status: 'failed', attempts: 1, lastError: 'gone' });
  });

  it('keeps a caller-supplied key, so the same photograph queues once whatever its path', async () => {
    const first = await enqueueSync('attachment', { jobId: '1', filename: 'a.jpg', localUri: 'photos/x.jpg' }, { contentKey: 'k1' });
    const second = await enqueueSync('attachment', { jobId: '1', filename: 'a.jpg', localUri: 'file:///other/x.jpg' }, { contentKey: 'k1' });
    expect({ dup: second.duplicate, same: first.id === second.id }).toEqual({ dup: true, same: true });
  });
});
