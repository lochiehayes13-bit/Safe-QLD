import { syncJobDetail } from '@/simpro/sync';
import { upsertJob } from '@/db/opsRepo';
import { getJobFull } from '@/db/mirrorRepo';
import type { SimproJobDetail, SimproMirror } from '@/simpro/mirrorResources';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
// Nothing here queues a photograph, but the module graph reaches the phone's
// file system and image tools on the way to the sync, and neither loads on Node.
jest.mock('@/simpro/attachmentFiles', () => ({ AttachmentFileMissing: class extends Error {}, readAttachmentForUpload: jest.fn() }));
jest.mock('@/simpro/attachments', () => ({ uploadJobAttachment: jest.fn() }));

/**
 * What a mirror stand-in answers with, and a record of when it was asked.
 *
 * Declared before the module mock and named with the `mock` prefix, which is
 * the only way the hoisted factory below is allowed to see it.
 */
const mockFamilies = {
  /** 'start sections', 'end sections', … in the order the reads actually happened. */
  order: [] as string[],
  /** Families that answer with a refusal instead of rows, keyed by family name. */
  refuse: new Set<string>(),
  /** Resolved once every family has been asked, so a read can wait for its siblings. */
  allStarted: undefined as (() => void) | undefined,
  started: 0,
  expected: 6,
};

/**
 * The mirror, faked at the module, because readOneJobDetail builds its own.
 *
 * syncJobDetail constructs `new SimproMirror(new SimproClient(config))` inside
 * itself — deliberately, so a screen only has to hand it a job id — which
 * leaves the module as the only seam. Everything else in the module is the
 * real thing: the mappers, the paths and the column sets are not what this
 * file is about.
 */
jest.mock('@/simpro/mirrorResources', () => {
  const actual = jest.requireActual('@/simpro/mirrorResources');

  /**
   * One family read: says it started, waits for its five siblings to start
   * too, then answers.
   *
   * The wait is what makes this a test of overlap rather than of ordering. Six
   * reads that go out together all reach the barrier and it opens; six reads
   * that go out one after another leave the first read waiting on siblings
   * that have not been asked for yet, so it falls through on the deadline and
   * the recorded order interleaves start with end. The deadline is there so a
   * regression reads as a failed assertion about the order rather than as a
   * test that hung.
   */
  const family = async <T>(name: string, rows: T): Promise<T> => {
    mockFamilies.order.push(`start ${name}`);
    mockFamilies.started++;
    if (mockFamilies.started >= mockFamilies.expected) mockFamilies.allStarted?.();
    await Promise.race([
      new Promise<void>((resolve) => { mockFamilies.allStarted = resolve; }),
      new Promise<void>((resolve) => { setTimeout(resolve, 40); }),
    ]);
    mockFamilies.order.push(`end ${name}`);
    if (mockFamilies.refuse.has(name)) {
      throw new Error(`No permission to read ${name}. Simpro sets API permissions per endpoint.`);
    }
    return rows;
  };

  class FakeMirror {
    async jobDetail(id: string): Promise<SimproJobDetail> {
      mockFamilies.order.push('start record');
      mockFamilies.order.push('end record');
      return {
        id, title: 'Annual fire system service', tags: [], technicians: [],
        stage: 'Progress', status: 'In progress',
      } as SimproJobDetail;
    }
    jobSections() { return family('sections', []); }
    jobNotes() { return family('notes', []); }
    jobAttachments() { return family('attachments', []); }
    jobTimelines() { return family('timeline', []); }
    jobTasks() {
      return family('tasks', [
        { id: 'tk-1', subject: 'Order a replacement sounder', assignees: [] },
        { id: 'tk-2', subject: 'Book the head office return visit', assignees: [] },
      ]);
    }
    jobInvoices() { return family('invoices', []); }
  }

  return { ...actual, SimproMirror: FakeMirror as unknown as typeof SimproMirror };
});

/** No client ID is needed with a proxy, and the fake mirror never sends anything anyway. */
const CONFIG = { buildDomain: 'example.invalid', companyId: '0', clientId: '', proxyUrl: 'https://proxy.invalid' };
const LOCAL_ID = 'job-local-1';

let db: NodeSqliteDb;

beforeEach(async () => {
  db = openMigrated();
  mockFamilies.order = [];
  mockFamilies.refuse = new Set();
  mockFamilies.allStarted = undefined;
  mockFamilies.started = 0;
  mockFamilies.expected = 6;
  await upsertJob({
    id: LOCAL_ID, externalId: '39901', siteName: 'Kelvin Street depot', title: 'Annual fire system service',
  });
});

afterEach(async () => { await db.closeAsync(); });

/**
 * The six families under a job, read together.
 *
 * They were six awaits in a row, so a job cost six round trips end to end for
 * reads that depend on nothing but the job record. Sixty of those is the tail
 * of every pull. What must not be lost in making them overlap is the part-read
 * behaviour: a family the office will not let this key read has always left
 * the rest of the job alone and been named in the note, and that is the thing
 * a Promise.all would quietly break.
 */
describe('reading what sits under one job', () => {
  it('asks for all six families before any of them has answered', async () => {
    const outcome = await syncJobDetail(CONFIG, LOCAL_ID);

    expect(outcome).toEqual({ status: 'synced', partial: [] });
    // The record first and alone: everything else depends on it having come back.
    expect(mockFamilies.order.slice(0, 2)).toEqual(['start record', 'end record']);
    const firstEnd = mockFamilies.order.findIndex((e, i) => i > 1 && e.startsWith('end '));
    const startsBeforeIt = mockFamilies.order.slice(2, firstEnd).filter((e) => e.startsWith('start ')).length;
    expect(startsBeforeIt).toBe(6);
  });

  it('stores what did come back and names the families that did not, in the same order every run', async () => {
    mockFamilies.refuse = new Set(['notes', 'sections']);

    const outcome = await syncJobDetail(CONFIG, LOCAL_ID);

    // Read, not failed: four families came down, and the two that did not are
    // named in the file's order rather than in whichever order the network
    // refused them, so two runs of the same fault read the same.
    expect(outcome).toEqual({
      status: 'synced',
      partial: [
        'sections: No permission to read sections. Simpro sets API permissions per endpoint.',
        'notes: No permission to read notes. Simpro sets API permissions per endpoint.',
      ],
    });
    const full = await getJobFull(LOCAL_ID);
    expect(full?.tasks.map((t) => t.subject)).toEqual([
      'Order a replacement sounder', 'Book the head office return visit',
    ]);
    expect(full?.job.detailSyncedAt).toBeTruthy();
  });

  it('is a failed read, with nothing stamped, when the office refuses every family', async () => {
    mockFamilies.refuse = new Set(['sections', 'notes', 'attachments', 'timeline', 'tasks', 'invoices']);

    const outcome = await syncJobDetail(CONFIG, LOCAL_ID);

    expect(outcome.status).toBe('failed');
    expect(outcome).toMatchObject({ error: expect.stringContaining('nothing under the job could be read') });
    // Not stamped as read, or the next sync would skip it for a quarter of an
    // hour on the strength of a job it holds nothing under.
    expect((await getJobFull(LOCAL_ID))?.job.detailSyncedAt).toBeFalsy();
  });
});
