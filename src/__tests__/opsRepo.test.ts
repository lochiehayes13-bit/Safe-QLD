import {
  failedSync, forgetSync, getJob, jobSummariesByExternalIds, listJobPage, listJobSummaries, listJobs,
  openJobPicks, setJobStatus, upsertJob,
  searchJobPicks,
  jobCount,
} from '@/db/opsRepo';
import { scheduledJobExternalIds } from '@/db/mirrorRepo';
import { applyJobFilter, type JobListFilter } from '@/domain/jobPresentation';
import type { WhoseSchedule } from '@/domain/myDay';
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

/**
 * The job list, filtered and searched by the database.
 *
 * The screen used to read every job on the books on every focus and then
 * filter and search them in JavaScript. Moving that into SQL is only safe if
 * it picks exactly the same jobs in exactly the same order, so that is what
 * these check: against `applyJobFilter` over the whole list, which is the code
 * the screen was running until now.
 *
 * The cases that matter are the ones the SQL has to reproduce rather than
 * merely allow — a stage of "pending " in the wrong case, a Queensland day
 * that is not the UTC one, a job on today's schedule that was issued last
 * year, an underscore typed into the search.
 */
describe('the job list as a query', () => {
  const day = (d: string) => `${d}T09:00:00+10:00`;

  async function book(): Promise<void> {
    await upsertJob({
      id: 'j-open', externalId: '43747', siteName: 'Harbourline Apartments', customerName: 'Harbourline Body Corporate',
      title: 'Six-monthly routine', stage: 'Progress', status: 'scheduled', scheduledFor: '2026-08-28',
      priority: 'high', techniciansJson: JSON.stringify([{ id: '17', name: 'Dale Whitmore' }]),
    });
    await upsertJob({
      id: 'j-untidy', externalId: '43748', siteName: 'Baldwin Living', title: 'Callout',
      // The office's stage as somebody typed it, which the exact comparison missed.
      stage: 'pending ', status: 'scheduled', scheduledFor: '2026-09-04',
      techniciansJson: JSON.stringify([{ id: '18', name: 'Corey Nankervis' }]),
    });
    await upsertJob({
      id: 'j-byhand', siteName: 'Storage Choice', title: 'Add-on works', status: 'scheduled',
      scheduledFor: '2026-09-03', technician: 'Dale Whitmore',
    });
    await upsertJob({
      id: 'j-done', externalId: '43749', siteName: 'Luggage Direct', title: 'Annual routine',
      stage: 'Invoiced', status: 'complete', scheduledFor: '2026-06-01', completedDate: '2026-06-01',
    });
    await upsertJob({
      // Issued at 23:30 UTC on the 2nd, which is 09:30 on the 3rd in Brisbane.
      id: 'j-midnight', externalId: '43750', siteName: 'Milton Reach', title: 'Detector swap',
      stage: 'Pending', status: 'scheduled', scheduledFor: '2026-09-02T23:30:00Z',
    });
    await upsertJob({
      // Issued years ago, on today's schedule: what the old read of the newest
      // few hundred could not see.
      id: 'j-old', externalId: '43751', siteName: 'Cathedral Chambers', title: 'Contract service',
      stage: 'Pending', status: 'scheduled', scheduledFor: '2021-03-04',
    });
    await db.runAsync(
      "INSERT INTO schedule (id,jobId,staffId,staffName,date,syncedAt) VALUES ('b1','43751','17','Dale Whitmore','2026-09-03','')",
    );
  }

  const TODAY = '2026-09-03';
  const ME = { by: 'id', staffId: '17', label: 'employee 17' } as const;

  /** What the screen used to compute, over everything the phone holds. */
  async function inMemory(filter: JobListFilter, query: string, who: WhoseSchedule | null) {
    const all = await listJobSummaries({ limit: 6000 });
    const scheduledToday = new Set(await scheduledJobExternalIds({ from: TODAY, to: TODAY }));
    return applyJobFilter(all, { filter, today: TODAY, who, scheduledToday, query });
  }

  it.each(['open', 'mine', 'today', 'all'] as const)('picks the same jobs as the in-memory filter — %s', async (filter) => {
    await book();
    const page = await listJobPage({ filter, today: TODAY, who: ME, limit: 100 });
    const expected = await inMemory(filter, '', ME);
    expect(page.rows.map((j) => j.id)).toEqual(expected.map((j) => j.id));
    // The small case is the one that must not move: on a book of six jobs the
    // line over the list reads exactly what it read before — the matches, the
    // total, and no word about a page, because there is not one.
    expect({ matching: page.matching, total: page.total, capped: page.capped })
      .toEqual({ matching: expected.length, total: 6, capped: false });
  });

  it('searches the same fields, in the same words, as the in-memory match', async () => {
    await book();
    for (const query of ['harbour', '#43747', '43747', 'routine', 'annual luggage', 'nothing at all']) {
      const page = await listJobPage({ filter: 'all', today: TODAY, who: ME, query, limit: 100 });
      const expected = await inMemory('all', query, ME);
      expect({ query, ids: page.rows.map((j) => j.id) }).toEqual({ query, ids: expected.map((j) => j.id) });
    }
  });

  it('counts the open work the way the site and customer cards count it', async () => {
    await book();
    // Five open: Progress, the untidy "pending ", the hand-added job with no
    // stage at all, the one issued at half past nine Brisbane time, and the
    // 2021 one the office never closed. In the list's own order: the urgent
    // and high work first, then soonest first.
    const page = await listJobPage({ filter: 'open', today: TODAY, who: ME, limit: 100 });
    expect(page.rows.map((j) => j.id)).toEqual(['j-open', 'j-old', 'j-midnight', 'j-byhand', 'j-untidy']);
  });

  it('reads today on the Queensland calendar, and takes the schedule at its word', async () => {
    await book();
    const page = await listJobPage({ filter: 'today', today: TODAY, who: ME, limit: 100 });
    // j-midnight was issued at 23:30 UTC, which is this morning in Brisbane;
    // j-old was issued in 2021 and is on today's schedule; j-byhand is dated
    // today outright. Nothing else.
    expect([...page.rows.map((j) => j.id)].sort()).toEqual(['j-byhand', 'j-midnight', 'j-old']);
  });

  it('finds the person by name as well as by id, and nobody when the phone does not know whose it is', async () => {
    await book();
    const byName = await listJobPage({
      filter: 'mine', today: TODAY, limit: 100,
      who: { by: 'name', staffName: 'dale whitmore', label: 'the name "dale whitmore"' },
    });
    // The office's list on one, the joined name on the hand-added one.
    expect([...byName.rows.map((j) => j.id)].sort()).toEqual(['j-byhand', 'j-open']);
    const nobody = await listJobPage({ filter: 'mine', today: TODAY, who: null, limit: 100 });
    expect({ rows: nobody.rows.length, matching: nobody.matching, total: nobody.total }).toEqual({ rows: 0, matching: 0, total: 6 });
  });

  it('takes a wildcard typed into the search as the character it is', async () => {
    await upsertJob({ id: 'j-a', siteName: 'A_B Tower', title: 'Routine', status: 'scheduled' });
    await upsertJob({ id: 'j-b', siteName: 'AXB Tower', title: 'Routine', status: 'scheduled' });
    const page = await listJobPage({ filter: 'all', today: TODAY, query: 'a_b', limit: 100 });
    expect(page.rows.map((j) => j.id)).toEqual(['j-a']);
  });

  it('caps the page, counts past it, and says the count is not the page', async () => {
    for (let i = 0; i < 12; i++) {
      await upsertJob({ id: `j-${i}`, siteName: `Site ${i}`, title: 'Routine', stage: 'Pending', status: 'scheduled' });
    }
    const page = await listJobPage({ filter: 'all', today: TODAY, limit: 5 });
    expect({ rows: page.rows.length, matching: page.matching, total: page.total, capped: page.capped })
      .toEqual({ rows: 5, matching: 12, total: 12, capped: true });
  });

  it('scopes to a site or a customer without reading anybody else’s jobs', async () => {
    await book();
    await db.runAsync("INSERT INTO site (id,name,createdAt,updatedAt) VALUES ('site-1','Harbourline Apartments','','')");
    await upsertJob({
      id: 'j-site', siteId: 'site-1', siteName: 'Harbourline Apartments', title: 'Extra',
      customerExternalId: '812', stage: 'Pending', status: 'scheduled',
    });
    const atSite = await listJobPage({ filter: 'all', today: TODAY, siteId: 'site-1', limit: 100 });
    expect({ ids: atSite.rows.map((j) => j.id), total: atSite.total }).toEqual({ ids: ['j-site'], total: 1 });
    const forCustomer = await listJobPage({ filter: 'all', today: TODAY, customerExternalId: '812', limit: 100 });
    expect(forCustomer.rows.map((j) => j.id)).toEqual(['j-site']);
  });


  it('searches every job the way the office system does, not a slice of the newest', async () => {
    // The fault this replaces: the picker held the first sixty open jobs and
    // filtered them in the screen, so a client's name found nothing unless
    // that client happened to be in the sixty.
    await upsertJob({ id: 'j-ymca', externalId: '44432', title: 'Annual Portables September 2026', siteName: 'YMCA - Bowen Hills', customerName: 'YMCA Brisbane', status: 'scheduled' });
    await upsertJob({ id: 'j-old', externalId: '41000', title: 'Monthly HYD', siteName: 'Fictional Tower', customerName: 'Fictional Holdings', status: 'complete' });
    await upsertJob({ id: 'j-order', externalId: '41001', title: 'Repairs', siteName: 'Somewhere Else', orderNo: 'PO-8891', status: 'scheduled' });

    const bySite = await searchJobPicks('ymca');
    expect(bySite.map((p) => p.externalId)).toContain('44432');

    const byCustomer = await searchJobPicks('brisbane');
    expect(byCustomer.map((p) => p.externalId)).toContain('44432');

    const byNumber = await searchJobPicks('4443');
    expect(byNumber.map((p) => p.externalId)).toContain('44432');

    const byOrder = await searchJobPicks('PO-8891');
    expect(byOrder.map((p) => p.externalId)).toContain('41001');

    const byTitle = await searchJobPicks('portables');
    expect(byTitle.map((p) => p.externalId)).toContain('44432');
  });

  it('still finds a job that is finished, because Friday is filled in on Monday', async () => {
    await upsertJob({ id: 'j-done', externalId: '40999', title: 'Last visit', siteName: 'Closed Site', status: 'complete' });
    const found = await searchJobPicks('closed site');
    expect(found.map((p) => p.externalId)).toContain('40999');
  });

  it('puts open work first, since a timesheet is usually about this week', async () => {
    await upsertJob({ id: 'j-shut', externalId: '40001', title: 'Finished', siteName: 'Same Name Site', status: 'complete' });
    await upsertJob({ id: 'j-live', externalId: '40002', title: 'Still on', siteName: 'Same Name Site', status: 'scheduled' });
    const found = await searchJobPicks('same name site');
    expect(found[0]!.externalId).toBe('40002');
  });

  it('counts what the device holds, so a picker can tell "none here" from "no match"', async () => {
    // A browser or a fresh install starts with nothing, and "nothing matches"
    // reads as a broken search rather than a device that was never connected.
    expect(await jobCount()).toBe(0);
    await upsertJob({ id: 'j-count', externalId: '40100', title: 'Something', siteName: 'A Site', status: 'scheduled' });
    expect(await jobCount()).toBe(1);
  });

  it('offers a picker the open jobs with an office number, and only four columns of them', async () => {
    await book();
    const picks = await openJobPicks(50);
    expect(picks.map((p) => p.externalId)).toEqual(['43747', '43751', '43750', '43748']);
    // Six columns, not the forty a whole job row carries: the picker shows the
    // site, the client under it and the job number, and needs nothing else.
    expect(Object.keys(picks[0]!).sort())
      .toEqual(['customerName', 'externalId', 'siteId', 'siteName', 'status', 'title']);
  });

  it('resolves the schedule’s job numbers straight, however old the jobs are', async () => {
    await book();
    const rows = await jobSummariesByExternalIds(['43751', '43747', '43751', 'nope']);
    expect([...rows.map((j) => j.externalId)].sort()).toEqual(['43747', '43751']);
    expect(await jobSummariesByExternalIds([])).toEqual([]);
  });
});
