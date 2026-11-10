import { flushQueue, pullFromSimpro, queueJobNote } from '@/simpro/sync';
import { pendingSync, upsertJob } from '@/db/opsRepo';
import { listTasks } from '@/db/mirrorRepo';
import { markerFor } from '@/domain/queueKey';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));
// The photograph path reads the phone's files and nothing here queues one, but
// the module graph loads both on the way to the sync and neither runs on Node.
jest.mock('@/simpro/attachmentFiles', () => ({ AttachmentFileMissing: class extends Error {}, readAttachmentForUpload: jest.fn() }));
jest.mock('@/simpro/attachments', () => ({ uploadJobAttachment: jest.fn() }));

/**
 * What a sync costs, over a stub that records every request.
 *
 * Until now nothing in the sync path counted anything, so every figure anybody
 * quoted about it — including the ones in its own comments — was a count of
 * requests read off the code times a round trip somebody assumed. These are
 * the two things that can be asserted without a network: that the count the
 * result reports is the number of requests that actually went out, and that
 * the reads nobody could use are no longer among them.
 *
 * `proxyUrl` keeps the client off the token server, so every fetch the stub
 * sees is one request and the count can be compared exactly.
 */
const CONFIG = { buildDomain: 'example.invalid', companyId: '0', clientId: '', proxyUrl: 'https://proxy.invalid' };

let db: NodeSqliteDb;
const original = global.fetch;
let reads: string[];
let posts: { url: string; body: unknown }[];

beforeEach(() => {
  db = openMigrated();
  reads = [];
  posts = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (init?.method && init.method !== 'GET') {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return json({ ID: 4410 });
    }
    reads.push(url);
    if (url.endsWith('/api/v1.0/companies/')) return json([{ ID: 0, Name: 'Fictional' }]);
    return json([]);
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  global.fetch = original;
  await db.closeAsync();
});

describe('what a pull reports about its own cost', () => {
  it('counts every request that went out, and times the run', async () => {
    const result = await pullFromSimpro(CONFIG, undefined, { prefetchDetails: false });

    // The measurement is the point: a figure that does not match what left the
    // phone is worse than no figure, because the next optimisation is judged by it.
    expect(result.requests).toBe(reads.length);
    expect(result.requests).toBeGreaterThan(0);
    expect(result.requestMs).toBeGreaterThan(0);
    // The two figures have to be the same kind of thing: a timer that recorded
    // an instant rather than a duration, or milliseconds against seconds, is
    // the way a measurement like this goes quietly wrong. The list stages here
    // are all but sequential — the rate card is the one pair that overlaps —
    // so the time spent inside requests sits just about at the wall clock and
    // cannot be a multiple of it.
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.requestMs).toBeLessThan(result.elapsedMs * 2);
  });

  it('says so rather than reporting a free run when the phone is not connected', async () => {
    const result = await pullFromSimpro({ buildDomain: '', companyId: '0', clientId: '' });

    expect(result.errors).toEqual(['No Simpro build domain is set. Add it in Settings.']);
    expect(result.requests).toBe(0);
    expect(reads).toEqual([]);
  });

  it('no longer reads the company-wide task list, which nothing could read back', async () => {
    const result = await pullFromSimpro(CONFIG, undefined, { prefetchDetails: false });

    // The stage wrote every row with no job against it, and the only query on
    // that table is by job, so the rows were unreachable for as long as they
    // existed. The tasks a screen shows come down under their job instead.
    expect(reads.filter((url) => url.includes('tasks'))).toEqual([]);
    expect(await listTasks()).toEqual([]);
    expect(result.tasksRead).toBe(0);
  });
});

/**
 * The read in front of a keyed note, once per job rather than once per note.
 *
 * Every keyed note is checked against the job's notes before it goes out, and
 * that check is a paged read of up to two hundred notes. One note per job cost
 * one read. A walk that fails several devices on one site queues several notes
 * against the same job, and each was paying for the same two hundred rows
 * again in front of its post.
 */
describe('sending several keyed notes to one job', () => {
  /** Invented keys in the shape the marker parser accepts: DEF, then two 16-hex halves. */
  const FIRST = 'DEF-0123456789abcdef-fedcba9876543210';
  const SECOND = 'DEF-0123456789abcdef-0f1e2d3c4b5a6978';
  const JOB = '39902';

  beforeEach(async () => {
    await upsertJob({ id: 'job-local-2', externalId: JOB, siteName: 'Kelvin Street depot', title: 'Annual fire system service' });
  });

  it('reads the job\'s notes once and posts both', async () => {
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Sounder in the east stair is silent.' }, { contentKey: FIRST });
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Detector above bay 4 is missing its base.' }, { contentKey: SECOND });

    const out = await flushQueue(CONFIG);

    expect(out).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect(reads.filter((url) => url.includes(`jobs/${JOB}/notes/`))).toHaveLength(1);
    expect(posts).toHaveLength(2);
    // The marker rides in each note, so the job itself carries the evidence.
    expect(posts.map((p) => (p.body as { Note: string }).Note)).toEqual([
      `Sounder in the east stair is silent.\n${markerFor(FIRST)}`,
      `Detector above bay 4 is missing its base.\n${markerFor(SECOND)}`,
    ]);
  });

  it('posts neither a second time when the office already holds both markers', async () => {
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Sounder in the east stair is silent.' }, { contentKey: FIRST });
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Detector above bay 4 is missing its base.' }, { contentKey: SECOND });
    // The job already carries both markers — another handset sent them, or this
    // one did before a reinstall emptied its queue.
    (global.fetch as jest.Mock).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (init?.method && init.method !== 'GET') { posts.push({ url, body: undefined }); return json({ ID: 1 }); }
      reads.push(url);
      if (url.includes(`jobs/${JOB}/notes/`)) {
        return json([
          { ID: 1, Subject: 'Defect raised', Note: `Sounder in the east stair is silent.\n${markerFor(FIRST)}` },
          { ID: 2, Subject: 'Defect raised', Note: `Detector above bay 4 is missing its base.\n${markerFor(SECOND)}` },
        ]);
      }
      return json([]);
    });

    const out = await flushQueue(CONFIG);

    expect(out).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect(posts).toEqual([]);
    expect(reads.filter((url) => url.includes(`jobs/${JOB}/notes/`))).toHaveLength(1);
    expect(await pendingSync(10)).toEqual([]);
  });

  it('does not re-ask a job whose notes it could not read, and sends anyway', async () => {
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Sounder in the east stair is silent.' }, { contentKey: FIRST });
    await queueJobNote({ jobId: JOB, subject: 'Defect raised', note: 'Detector above bay 4 is missing its base.' }, { contentKey: SECOND });
    (global.fetch as jest.Mock).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (init?.method && init.method !== 'GET') { posts.push({ url, body: undefined }); return json({ ID: 1 }); }
      reads.push(url);
      // The key may post notes but not read them, which is a real Simpro
      // permission combination and used to be paid for once per queued note.
      if (url.includes(`jobs/${JOB}/notes/`)) return json({ message: 'Forbidden' }, 403);
      return json([]);
    });

    const out = await flushQueue(CONFIG);

    // Unknown is not "already there": a lost defect is worse than a duplicate,
    // so both notes go, and the refusal is only met once.
    expect(out).toMatchObject({ sent: 2, failed: 0 });
    expect(posts).toHaveLength(2);
    expect(reads.filter((url) => url.includes(`jobs/${JOB}/notes/`))).toHaveLength(1);
  });
});
