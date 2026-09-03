import { failedSync, forgetSync, getJob, listJobSummaries, listJobs, setJobStatus, upsertJob } from '@/db/opsRepo';
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

const fromOffice = (
  over: Partial<Parameters<typeof upsertJob>[0]> = {},
  options: Parameters<typeof upsertJob>[1] = {},
) => upsertJob({
  id: 'job-1',
  externalId: '43747',
  siteName: 'BRIC Housing Emsworth St',
  title: 'Six-monthly routine',
  stage: 'Pending',
  status: 'scheduled',
  ...over,
}, options);

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

  it('drops the held site when the office has moved the job to a site this phone does not hold', async () => {
    await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES ('site-9','A','','')");
    await fromOffice({ siteId: 'site-9', siteExternalId: '3021' });
    // Same office site, no local match this run: the held site stands.
    await fromOffice({ siteId: undefined, siteExternalId: '3021' });
    expect((await getJob('job-1'))?.siteId).toBe('site-9');
    // Moved to another building the phone has no site for: filed under site A
    // it would put the job at the wrong address.
    await fromOffice({ siteId: undefined, siteExternalId: '4000' });
    expect((await getJob('job-1'))).toMatchObject({ siteId: null, siteExternalId: '4000' });
  });

  it('reopens a job the pull itself closed when the office reopens it, but not one the technician closed', async () => {
    // The pull files an invoiced job as complete. That is not the technician's
    // status, and when the office moves the job back it has to move back here.
    await fromOffice({ stage: 'Invoiced', status: 'complete' });
    expect((await getJob('job-1'))?.status).toBe('complete');
    await fromOffice({ stage: 'Progress', status: 'scheduled' });
    expect((await getJob('job-1'))?.status).toBe('scheduled');

    await setJobStatus('job-1', 'complete');
    await fromOffice({ stage: 'Progress', status: 'scheduled' });
    expect((await getJob('job-1'))?.status).toBe('complete');
  });

  it('lets the record clear a note the office deleted, and keeps it across a list row that never asked', async () => {
    await fromOffice({ notesText: 'Gate code 1234', customerContractJson: '{"id":"7"}' }, { fromDetail: true });
    await fromOffice({ notesText: undefined, customerContractJson: undefined });
    expect(await getJob('job-1')).toMatchObject({ notesText: 'Gate code 1234', customerContractJson: '{"id":"7"}' });
    await fromOffice({ notesText: undefined, customerContractJson: undefined }, { fromDetail: true });
    expect(await getJob('job-1')).toMatchObject({ notesText: null, customerContractJson: null });
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

  it('still lists what it gave up on, with the reason, so a person can send it again', async () => {
    const { markSyncFailed, abandonSync, retrySync: retry } = jest.requireActual('@/db/opsRepo') as typeof import('@/db/opsRepo');
    const note = await enqueueSync('job-note', { jobId: '3', subject: 'V', note: 'W' });
    const photo = await enqueueSync('attachment', { jobId: '3', filename: 'a.jpg' });
    for (let i = 0; i < 5; i++) await markSyncFailed(note.id, `attempt ${i + 1}`);
    await abandonSync(photo.id, 'Simpro returned HTTP 422');
    expect(await pendingSync()).toHaveLength(0);
    expect((await failedSync()).map((f) => [f.id, f.lastError])).toEqual([[note.id, 'attempt 5'], [photo.id, 'Simpro returned HTTP 422']]);
    await retry(note.id);
    expect((await failedSync()).map((f) => f.id)).toEqual([photo.id]);
    expect((await pendingSync()).map((f) => f.attempts)).toEqual([0]);
  });

  it('forgets a failed item outright, so a photograph is neither counted as uploaded nor kept off the job', async () => {
    const { abandonSync, attachmentQueueSummary } = jest.requireActual('@/db/opsRepo') as typeof import('@/db/opsRepo');
    const photo = await enqueueSync('attachment', { jobId: '4', filename: 'a.jpg' }, { contentKey: 'ATT-1' });
    await abandonSync(photo.id, 'The photo file is no longer on this device');
    await forgetSync(photo.id);
    expect(await failedSync()).toHaveLength(0);
    expect(await attachmentQueueSummary()).toEqual({ pending: 0, unknown: 0, failed: 0, sent: 0 });
    // The same photograph can be queued again by the next send.
    expect((await enqueueSync('attachment', { jobId: '4', filename: 'a.jpg' }, { contentKey: 'ATT-1' })).duplicate).toBe(false);
    // Only a failed row goes: a pending one is still the queue's to send.
    const live = await enqueueSync('job-note', { jobId: '4', subject: 'S', note: 'N' });
    await forgetSync(live.id);
    expect((await pendingSync()).map((e) => e.id)).toContain(live.id);
  });
});

describe('the job list projection', () => {
  it('reads the same rows in the same order as the full list, without the long columns', async () => {
    await upsertJob({ id: 'j-1', siteName: 'A', title: 'Later', priority: 'normal', status: 'scheduled', scheduledFor: '2026-09-09', descriptionText: 'x'.repeat(5000), tagsJson: '["Strata"]' });
    await upsertJob({ id: 'j-2', siteName: 'B', title: 'Soon', priority: 'urgent', status: 'scheduled', scheduledFor: '2026-09-03' });
    await upsertJob({ id: 'j-3', siteName: 'C', title: 'Done', priority: 'normal', status: 'complete', scheduledFor: '2026-09-01' });
    const full = await listJobs({ limit: 10 });
    const summary = await listJobSummaries({ limit: 10 });
    expect(summary.map((j) => j.id)).toEqual(full.map((j) => j.id));
    expect(summary.map((j) => j.id)).toEqual(['j-2', 'j-1', 'j-3']);
    expect(summary[1]).toMatchObject({ title: 'Later', siteName: 'A', priority: 'normal', scheduledFor: '2026-09-09' });
    expect(Object.keys(summary[1]!)).not.toEqual(expect.arrayContaining(['descriptionText', 'tagsJson', 'notesText']));
    expect((await listJobSummaries({ status: 'complete' })).map((j) => j.id)).toEqual(['j-3']);
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

  it('names the person who completed it first, with the office\'s booking beside it', async () => {
    // Two booked, one attended: the note says who was there, and keeps the
    // roster in brackets so a completion from a swapped name does not read
    // as a mistake to the scheduler reading it.
    await fromOffice({ technician: 'A. Smith, B. Jones' });
    await setJobStatus('job-1', 'complete', { completedBy: 'B. Jones' });
    const [row] = await pendingSync();
    const payload = JSON.parse(row!.payload) as { note: string };
    expect(payload.note).toContain('Completed by: B. Jones (booked technician: A. Smith, B. Jones)');
    expect(payload.note).not.toContain('Technician:');
  });

  it('falls back to the booking when nobody is signed in and no name is set', async () => {
    await fromOffice({ technician: 'A. Smith' });
    await setJobStatus('job-1', 'complete', { completedBy: '  ' });
    const [row] = await pendingSync();
    expect((JSON.parse(row!.payload) as { note: string }).note).toContain('Technician: A. Smith');
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
