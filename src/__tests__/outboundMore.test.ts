import { moreJobIdOf, queueClockEntry, sendMore } from '@/simpro/outboundMore';
import { flushQueue } from '@/simpro/sync';
import { SimproError, type SimproClient } from '@/simpro/client';
import type { SimproResources } from '@/simpro/resources';
import { getEntry, startEntry, stopOpenEntry } from '@/db/clockRepo';
import { enqueueSync, pendingSync, type SyncEntry } from '@/db/opsRepo';
import { getDb } from '@/db/index';
import { clockContentKey } from '@/domain/clockOn';
import { flushSoon } from '@/simpro/flushSoon';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));
// flushQueue's photograph path reads the phone's files; nothing here queues one.
jest.mock('@/simpro/attachmentFiles', () => ({ AttachmentFileMissing: class extends Error {}, readAttachmentForUpload: jest.fn() }));
jest.mock('@/simpro/attachments', () => ({ uploadJobAttachment: jest.fn() }));

/**
 * The send seam for the kinds added after the first four.
 *
 * A fake client records what would have gone to the office; the assertion
 * is the exact path and body, because the POST has not been tried on the
 * live build and the body is the one thing this module is for. The read
 * before the POST is answered by the same fake, so the guard against
 * posting a block twice is checked against the list shape the live build
 * answers with, and flushQueue is run over a fetch stub to see the queue
 * row land where each outcome says it should.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); (flushSoon as jest.Mock).mockClear(); });
afterEach(async () => { await db.closeAsync(); });

interface Sent { method: string; path: string; body: unknown }
interface Read { path: string; query: Record<string, string | number> | undefined }

/** Answers every GET with `held` and every POST with `answer`; records both. */
function fakeClient(
  answer: (s: Sent) => unknown = () => ({ ID: 4410 }),
  held: unknown[] | (() => unknown[]) = [],
): { client: SimproClient; sent: Sent[]; reads: Read[] } {
  const sent: Sent[] = [];
  const reads: Read[] = [];
  const client = {
    request: async (method: string, path: string, options: { body?: unknown; query?: Record<string, string | number> } = {}) => {
      if (method === 'GET') {
        reads.push({ path, query: options.query });
        return { data: typeof held === 'function' ? held() : held, total: null };
      }
      const s = { method, path, body: options.body };
      sent.push(s);
      return { data: answer(s), total: null };
    },
  } as unknown as SimproClient;
  return { client, sent, reads };
}

const deps = (client: SimproClient) => ({ client, api: {} as SimproResources });

const EMP = '77';
const ON = { employeeExternalId: EMP, kind: 'work' as const, jobExternalId: '1001', jobSectionExternalId: '5', jobCostCenterExternalId: '9', jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower' };

async function closedWorkEntry() {
  const { opened } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
  await stopOpenEntry('2026-09-07T23:30:00.000Z');
  return (await getEntry(opened.id))!;
}

const item = (entryId: string, over: Record<string, unknown> = {}) =>
  ({ id: 'q1', kind: 'timesheet-block', payload: { entryId, jobId: '1001', kind: 'work' }, ...over });

describe('queueing a clock entry', () => {
  it('queues a ready entry once, keyed on the entry, and asks for the queue to go', async () => {
    const e = await closedWorkEntry();
    expect(await queueClockEntry(e)).toEqual({ status: 'queued' });
    expect(await queueClockEntry(e)).toEqual({ status: 'duplicate' });
    const rows = await pendingSync();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'timesheet-block', contentKey: `timesheet-block|${e.id}` });
    expect(JSON.parse(rows[0]!.payload)).toEqual({ entryId: e.id, jobId: '1001', kind: 'work' });
    expect(flushSoon).toHaveBeenCalledTimes(1);
  });

  it('does not queue an entry that cannot go, and writes why on it', async () => {
    const { opened } = await startEntry({ ...ON, jobSectionExternalId: undefined, jobCostCenterExternalId: undefined }, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:30:00.000Z');
    expect(await queueClockEntry((await getEntry(opened.id))!)).toEqual({ status: 'not-ready', why: 'No cost centre on this job yet' });
    expect(await pendingSync()).toEqual([]);
    expect((await getEntry(opened.id))?.sendError).toBe('No cost centre on this job yet');
    expect(flushSoon).not.toHaveBeenCalled();
  });

  it('queues both pieces of an entry stopped across midnight, one row each', async () => {
    // On at 22:00 Brisbane, off at 02:00: the screen queues everything the stop closed.
    await startEntry(ON, '2026-09-08T12:00:00.000Z');
    const closed = await stopOpenEntry('2026-09-08T16:00:00.000Z');
    expect(closed).toHaveLength(2);
    for (const piece of closed) expect(await queueClockEntry(piece)).toEqual({ status: 'queued' });
    const rows = await pendingSync();
    expect(rows.map((r) => r.contentKey)).toEqual(closed.map((c) => clockContentKey(c.id)));
    expect(rows.map((r) => (JSON.parse(r.payload) as { entryId: string }).entryId)).toEqual(closed.map((c) => c.id));
  });
});

describe('sending', () => {
  it('posts a job entry as one schedule on the cost centre and stamps the entry sent', async () => {
    const e = await closedWorkEntry();
    const { client, sent } = fakeClient();
    const outcome = await sendMore(item(e.id), deps(client));
    expect(outcome).toEqual({ status: 'sent' });
    expect(sent).toEqual([{
      method: 'POST',
      path: 'jobs/1001/sections/5/costCenters/9/schedules/',
      body: { Staff: 77, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '09:30' }] },
    }]);
    const after = await getEntry(e.id);
    expect(after?.simproUid).toBe('4410');
    expect(after?.sentAt).toBeDefined();
    expect(after?.sendError).toBeUndefined();
  });

  it('posts an activity entry to activitySchedules with the activity and the note', async () => {
    const { opened } = await startEntry({ employeeExternalId: EMP, kind: 'travel', activityExternalId: '12', activityName: 'Travel', note: 'To the coast' }, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T22:00:00.000Z');
    const { client, sent } = fakeClient(() => ({ ID: 91 }));
    await sendMore({ id: 'q1', kind: 'timesheet-block', payload: { entryId: opened.id, kind: 'travel' } }, deps(client));
    expect(sent).toEqual([{
      method: 'POST',
      path: 'activitySchedules/',
      body: { Staff: 77, Date: '2026-09-08', Activity: 12, Blocks: [{ StartTime: '07:00', EndTime: '08:00' }], Notes: 'To the coast' },
    }]);
    expect((await getEntry(opened.id))?.simproUid).toBe('91');
  });

  it('accepts a reply with no id, since the 2xx is the acceptance', async () => {
    const e = await closedWorkEntry();
    const { client } = fakeClient(() => undefined);
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'sent' });
    const after = await getEntry(e.id);
    expect(after?.sentAt).toBeDefined();
    expect(after?.simproUid).toBeUndefined();
  });

  it('answers done, posting nothing, for an entry the office already has or one that is gone', async () => {
    const e = await closedWorkEntry();
    const { client, sent } = fakeClient();
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'sent' });
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'done' });
    expect(await sendMore(item('gone', { id: 'q2' }), deps(client))).toEqual({ status: 'done' });
    expect(sent).toHaveLength(1);
  });

  it('lets the client error through untouched and keeps its words on the entry', async () => {
    const e = await closedWorkEntry();
    const refused = new SimproError('Simpro returned HTTP 422 for jobs/1001/sections/5/costCenters/9/schedules/. Staff is not scheduled to this cost centre', 422, 'jobs/1001/sections/5/costCenters/9/schedules/');
    const { client } = fakeClient(() => { throw refused; });
    await expect(sendMore(item(e.id), deps(client))).rejects.toBe(refused);
    const after = await getEntry(e.id);
    expect(after?.sentAt).toBeUndefined();
    expect(after?.sendError).toBe(refused.message);
  });

  it('abandons, rather than throws, a payload that names no entry or an entry that cannot go', async () => {
    const { client, sent } = fakeClient();
    expect(await sendMore({ id: 'q1', kind: 'timesheet-block', payload: {} }, deps(client)))
      .toEqual({ status: 'abandon', reason: expect.stringMatching(/names no entry/) });
    // Queued ready, then stripped of its cost centre before the send got to it.
    const e = await closedWorkEntry();
    await (await getDb()).runAsync('UPDATE clock_entry SET jobCostCenterExternalId = NULL WHERE id = ?', e.id);
    expect(await sendMore(item(e.id), deps(client)))
      .toEqual({ status: 'abandon', reason: 'Nothing was sent: No cost centre on this job yet.' });
    expect((await getEntry(e.id))?.sendError).toBe('No cost centre on this job yet');
    expect(sent).toEqual([]);
  });

  it('answers not-mine for a kind it does not send', async () => {
    const { client, sent } = fakeClient();
    expect(await sendMore({ id: 'q1', kind: 'something-else', payload: { jobId: '1001' } }, deps(client))).toEqual({ status: 'not-mine' });
    expect(sent).toEqual([]);
  });

  it('names the job for the queue failure rules', () => {
    expect(moreJobIdOf('timesheet-block', { entryId: 'x', jobId: '1001', kind: 'work' })).toBe('1001');
    expect(moreJobIdOf('timesheet-block', { entryId: 'x', kind: 'travel' })).toBeUndefined();
  });
});

describe('the block the office already holds', () => {
  const heldBlock = { ID: 4410, Staff: { ID: 77, Name: 'Somebody' }, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '09:30' }] };

  it('reads the day off the same collection before posting, and asks for the columns each list has', async () => {
    const e = await closedWorkEntry();
    const { client, reads } = fakeClient();
    await sendMore(item(e.id), deps(client));
    expect(reads).toEqual([{
      path: 'jobs/1001/sections/5/costCenters/9/schedules/',
      query: { Date: '2026-09-08', columns: 'ID,Staff,Date,Blocks', pageSize: 250 },
    }]);
    // Activity is a column on the activity list only; asking the cost centre for it is a 422.
    const { opened } = await startEntry({ employeeExternalId: EMP, kind: 'travel', activityExternalId: '12', activityName: 'Travel' }, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T22:00:00.000Z');
    const activity = fakeClient();
    await sendMore({ id: 'q2', kind: 'timesheet-block', payload: { entryId: opened.id, kind: 'travel' } }, deps(activity.client));
    expect(activity.reads[0]).toEqual({ path: 'activitySchedules/', query: { Date: '2026-09-08', columns: 'ID,Staff,Date,Blocks,Activity', pageSize: 250 } });
  });

  it('takes a block already there as the earlier acceptance: done, its id on the entry, nothing posted', async () => {
    const e = await closedWorkEntry();
    const { client, sent } = fakeClient(() => ({ ID: 9999 }), [heldBlock]);
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    const after = await getEntry(e.id);
    expect(after?.sentAt).toBeDefined();
    expect(after?.simproUid).toBe('4410');
  });

  it('posts when the day holds other blocks but not this one', async () => {
    const e = await closedWorkEntry();
    const { client, sent } = fakeClient(() => ({ ID: 9999 }), [
      { ...heldBlock, Staff: { ID: 78 } },
      { ...heldBlock, ID: 4411, Blocks: [{ StartTime: '09:30', EndTime: '12:00' }] },
    ]);
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect((await getEntry(e.id))?.simproUid).toBe('9999');
  });

  it('posts anyway when the read itself fails, since a lost block is the worse loss', async () => {
    const e = await closedWorkEntry();
    const { client, sent } = fakeClient(() => ({ ID: 9999 }), () => { throw new SimproError('Simpro returned HTTP 500 for the read', 500, 'x'); });
    expect(await sendMore(item(e.id), deps(client))).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect((await getEntry(e.id))?.simproUid).toBe('9999');
  });
});

describe('what flushQueue does with each outcome', () => {
  /**
   * The queue over a fetch stub. `proxyUrl` keeps the client off the token
   * server, so the only calls are the reachability read, the day's read
   * and the POST; each is answered by path.
   */
  const config = { buildDomain: 'example.invalid', companyId: '0', clientId: '', proxyUrl: 'https://proxy.invalid' };
  const original = global.fetch;
  let posts: { url: string; body: unknown }[];
  let held: unknown[];

  beforeEach(() => {
    posts = [];
    held = [];
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/api/v1.0/companies/')) return json([{ ID: 0, Name: 'Fictional' }]);
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ ID: 4410 });
      }
      return json(held);
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = original; });

  async function rowFor(entryId: string): Promise<SyncEntry | null> {
    return (await getDb()).getFirstAsync<SyncEntry>('SELECT * FROM sync_queue WHERE contentKey = ?', clockContentKey(entryId));
  }

  it('sends a ready entry and closes the row as sent', async () => {
    const e = await closedWorkEntry();
    await queueClockEntry(e);
    expect(await flushQueue(config)).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
    expect(posts).toHaveLength(1);
    expect((await rowFor(e.id))?.status).toBe('sent');
    expect((await getEntry(e.id))?.simproUid).toBe('4410');
  });

  it('files an entry that cannot go as failed with the reason, not as a send in doubt', async () => {
    const e = await closedWorkEntry();
    await queueClockEntry(e);
    await (await getDb()).runAsync('UPDATE clock_entry SET jobCostCenterExternalId = NULL WHERE id = ?', e.id);
    await enqueueSync('timesheet-block', { kind: 'work' }, { contentKey: 'timesheet-block|nothing' });
    expect(await flushQueue(config)).toMatchObject({ sent: 0, failed: 2, remaining: 0 });
    expect(posts).toEqual([]);
    expect(await rowFor(e.id)).toMatchObject({ status: 'failed', lastError: 'Nothing was sent: No cost centre on this job yet.' });
    const nameless = await (await getDb()).getFirstAsync<SyncEntry>("SELECT * FROM sync_queue WHERE contentKey = 'timesheet-block|nothing'");
    expect(nameless).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/names no entry/) });
  });

  it('closes the row without counting a send where the office already holds the block or the entry is gone', async () => {
    const e = await closedWorkEntry();
    await queueClockEntry(e);
    held = [{ ID: 4410, Staff: { ID: 77 }, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '09:30' }] }];
    await enqueueSync('timesheet-block', { entryId: 'gone', kind: 'work' }, { contentKey: clockContentKey('gone') });
    expect(await flushQueue(config)).toMatchObject({ sent: 0, failed: 0, remaining: 0 });
    expect(posts).toEqual([]);
    expect((await rowFor(e.id))?.status).toBe('sent');
    expect((await rowFor('gone'))?.status).toBe('sent');
    expect((await getEntry(e.id))?.simproUid).toBe('4410');
  });
});
