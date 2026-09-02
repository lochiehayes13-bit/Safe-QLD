import { getJob, setJobStatus, upsertJob } from '@/db/opsRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

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
