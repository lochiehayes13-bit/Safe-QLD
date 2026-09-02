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
