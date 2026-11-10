import { pullScheduleWindow, sendScheduleChange } from '@/simpro/outboundSchedule';
import { SimproError, type SimproClient } from '@/simpro/client';
import type { SimproResources } from '@/simpro/resources';
import { SCHEDULE_BOOK_KIND, SCHEDULE_MOVE_KIND, SCHEDULE_REMOVE_KIND } from '@/domain/scheduling';
import { listScheduleBetween } from '@/db/scheduleRepo';
import { scheduleWindow } from '@/domain/myDay';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

// The sender writes the office's answer back into the calendar, so the
// module reaches the database: the migrated node engine stands in for it.
jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The send seam for schedule changes made on the phone.
 *
 * A fake client answers every GET from a table of paths and records every
 * other request; the assertion is the exact method, path and body, because
 * the PATCH and DELETE have not been tried on the live build and the
 * request is the one thing this module is for. The guards — the minute to
 * take a change back, the read before the write, whose block it is, a
 * record already moved or gone — are each checked against the shape the
 * live build answers with (a 404 with "not found" for a record that is
 * gone). Every job number and employee id is invented.
 */

interface Sent { method: string; path: string; body: unknown }
interface Read { path: string; query: Record<string, string | number> | undefined }

/** GETs answered from `reads` by path (a function may throw); everything else recorded. */
function fakeClient(reads: Record<string, unknown | (() => unknown)> = {}): { client: SimproClient; sent: Sent[]; got: Read[] } {
  const sent: Sent[] = [];
  const got: Read[] = [];
  const client = {
    request: async (method: string, path: string, options: { body?: unknown; query?: Record<string, string | number> } = {}) => {
      if (method === 'GET') {
        got.push({ path, query: options.query });
        if (!(path in reads)) throw new SimproError(`Simpro returned HTTP 404 for ${path}. Job cost center schedule not found.`, 404, path);
        const answer = reads[path];
        return { data: typeof answer === 'function' ? (answer as () => unknown)() : answer, total: null };
      }
      sent.push({ method, path, body: options.body });
      return { data: { ID: 4410 }, total: null };
    },
  } as unknown as SimproClient;
  return { client, sent, got };
}

const deps = (client: SimproClient) => ({ client, api: {} as SimproResources });

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const COLLECTION = 'jobs/1001/sections/5/costCenters/9/schedules/';
const RECORD = 'jobs/1001/sections/5/costCenters/9/schedules/4410';
const HREF = `/api/v1.0/companies/0/${RECORD}`;

const book = (over: Record<string, unknown> = {}) => ({
  id: 'q1', kind: SCHEDULE_BOOK_KIND,
  payload: { employeeId: '77', jobId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30', notBefore: PAST, ...over },
});
const move = (over: Record<string, unknown> = {}) => ({
  id: 'q2', kind: SCHEDULE_MOVE_KIND,
  payload: {
    employeeId: '77', scheduleId: '4410', jobId: '1001', href: HREF, date: '2026-09-09', start: '08:00', end: '12:00',
    from: { date: '2026-09-08', start: '07:00', end: '15:30' }, notBefore: PAST, ...over,
  },
});
const remove = (over: Record<string, unknown> = {}) => ({
  id: 'q3', kind: SCHEDULE_REMOVE_KIND,
  payload: { employeeId: '77', scheduleId: '4410', jobId: '1001', href: HREF, date: '2026-09-08', start: '07:00', end: '15:30', notBefore: PAST, ...over },
});

const mine = { ID: 4410, Staff: { ID: 77, Name: 'Alex Fixture' }, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '15:30' }], IsLocked: false };

describe('what is not this module\'s', () => {
  it('answers not-mine for any other kind, and abandons a payload it cannot read', async () => {
    const { client, sent } = fakeClient();
    expect(await sendScheduleChange({ id: 'x', kind: 'job-note', payload: {} }, deps(client))).toEqual({ status: 'not-mine' });
    expect(await sendScheduleChange(book({ employeeId: '' }), deps(client))).toEqual({ status: 'abandon', reason: 'Nothing was sent: The change names no Simpro employee.' });
    expect(await sendScheduleChange(move({ href: undefined }), deps(client))).toEqual({ status: 'abandon', reason: 'Nothing was sent: The block has no cost centre path on the phone, so it cannot be changed from here.' });
    expect(sent).toEqual([]);
  });

  it('leaves a change inside its minute for later, untouched', async () => {
    const { client, sent, got } = fakeClient();
    expect(await sendScheduleChange(book({ notBefore: FUTURE }), deps(client))).toEqual({ status: 'later' });
    expect(await sendScheduleChange(move({ notBefore: FUTURE }), deps(client))).toEqual({ status: 'later' });
    expect(await sendScheduleChange(remove({ notBefore: FUTURE }), deps(client))).toEqual({ status: 'later' });
    expect(sent).toEqual([]);
    expect(got).toEqual([]);
  });
});

describe('booking', () => {
  it('reads the cost centre\'s day first, then posts the block the clock would', async () => {
    const { client, sent, got } = fakeClient({ [COLLECTION]: [] });
    expect(await sendScheduleChange(book(), deps(client))).toEqual({ status: 'sent' });
    expect(got).toEqual([{ path: COLLECTION, query: { Date: '2026-09-08', columns: 'ID,Staff,Date,Blocks', pageSize: 250 } }]);
    expect(sent).toEqual([{
      method: 'POST', path: COLLECTION,
      body: { Staff: 77, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '15:30' }] },
    }]);
  });

  it('is done without posting when the office already holds the block', async () => {
    const { client, sent } = fakeClient({ [COLLECTION]: [mine, { ID: 1, Staff: { ID: 78 }, Date: '2026-09-08', Blocks: [{ StartTime: '07:00', EndTime: '15:30' }] }] });
    expect(await sendScheduleChange(book(), deps(client))).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
  });

  it('posts anyway when the read itself fails: a duplicate is recoverable, a missing booking is not', async () => {
    const { client, sent } = fakeClient({ [COLLECTION]: () => { throw new SimproError('Simpro returned HTTP 500 for the read', 500, COLLECTION); } });
    expect(await sendScheduleChange(book(), deps(client))).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
  });

  it('lets the office\'s refusal of the POST through as the client\'s own error', async () => {
    const { client } = fakeClient({ [COLLECTION]: [] });
    (client as unknown as { request: unknown }).request = async (method: string, path: string) => {
      if (method === 'GET') return { data: [], total: null };
      throw new SimproError(`Simpro returned HTTP 422 for ${path}. Staff is not scheduled to this cost centre`, 422, path);
    };
    await expect(sendScheduleChange(book(), deps(client))).rejects.toMatchObject({ status: 422 });
  });
});

describe('moving', () => {
  it('reads the record, then patches the new date and block to its path, as documented', async () => {
    const { client, sent, got } = fakeClient({ [RECORD]: mine });
    expect(await sendScheduleChange(move(), deps(client))).toEqual({ status: 'sent' });
    expect(got).toEqual([{ path: RECORD, query: undefined }]);
    expect(sent).toEqual([{
      method: 'PATCH', path: RECORD,
      body: { Date: '2026-09-09', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }] },
    }]);
  });

  it('is done with nothing sent when the record is already where the move would put it', async () => {
    const there = fakeClient({ [RECORD]: { ...mine, Date: '2026-09-09', Blocks: [{ StartTime: '08:00', EndTime: '12:00' }] } });
    expect(await sendScheduleChange(move(), deps(there.client))).toEqual({ status: 'done' });
    expect(there.sent).toEqual([]);
  });

  it('says so rather than going quiet when the block the move is about is gone', async () => {
    // Silently done would leave the person believing the office had moved
    // the block; it has not, and the phone's copy is the stale one.
    const gone = fakeClient();
    expect(await sendScheduleChange(move(), deps(gone.client))).toMatchObject({
      status: 'abandon', reason: expect.stringContaining('moved or removed this block'),
    });
    expect(gone.sent).toEqual([]);
  });

  it('leaves a block the office has given to somebody else, or locked, alone', async () => {
    const theirs = fakeClient({ [RECORD]: { ...mine, Staff: { ID: 78 } } });
    expect(await sendScheduleChange(move(), deps(theirs.client))).toMatchObject({ status: 'abandon', reason: expect.stringContaining('somebody else') });
    expect(theirs.sent).toEqual([]);
    const locked = fakeClient({ [RECORD]: { ...mine, IsLocked: true } });
    expect(await sendScheduleChange(move(), deps(locked.client))).toMatchObject({ status: 'abandon', reason: expect.stringContaining('locked') });
    expect(locked.sent).toEqual([]);
  });

  it('finds the block on the job\'s cost centres by day when the phone holds no path', async () => {
    const other = 'jobs/1001/sections/5/costCenters/8/schedules/';
    const { client, sent, got } = fakeClient({ [other]: [{ ID: 1, Staff: { ID: 77 } }], [COLLECTION]: [mine], [RECORD]: mine });
    const outcome = await sendScheduleChange(move({ href: undefined, costCentres: [{ sectionId: '5', costCenterId: '8' }, { sectionId: '5', costCenterId: '9' }] }), deps(client));
    expect(outcome).toEqual({ status: 'sent' });
    // Looked for on the day it is on now, not the day it is going to.
    expect(got.map((g) => [g.path, g.query?.Date])).toEqual([[other, '2026-09-08'], [COLLECTION, '2026-09-08'], [RECORD, undefined]]);
    expect(sent[0]).toMatchObject({ method: 'PATCH', path: RECORD });
  });

  it('says the office moved it when the block is on none of the job\'s cost centres that day', async () => {
    const { client, sent } = fakeClient({ [COLLECTION]: [] });
    expect(await sendScheduleChange(move({ href: undefined, costCentres: [{ sectionId: '5', costCenterId: '9' }] }), deps(client))).toMatchObject({
      status: 'abandon', reason: expect.stringContaining('moved or removed this block'),
    });
    expect(sent).toEqual([]);
  });

  it('lets any other refusal of the read through to the queue\'s rules', async () => {
    const { client } = fakeClient({ [RECORD]: () => { throw new SimproError('Simpro returned HTTP 500', 500, RECORD); } });
    await expect(sendScheduleChange(move(), deps(client))).rejects.toMatchObject({ status: 500 });
  });
});

describe('removing', () => {
  it('reads the record, then deletes its path with no body, as documented', async () => {
    const { client, sent, got } = fakeClient({ [RECORD]: mine });
    expect(await sendScheduleChange(remove(), deps(client))).toEqual({ status: 'sent' });
    expect(got).toEqual([{ path: RECORD, query: undefined }]);
    expect(sent).toEqual([{ method: 'DELETE', path: RECORD, body: undefined }]);
  });

  it('is done when the record is already gone', async () => {
    const { client, sent } = fakeClient();
    expect(await sendScheduleChange(remove(), deps(client))).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
  });

  it('never deletes a block that is no longer this person\'s', async () => {
    const { client, sent } = fakeClient({ [RECORD]: { ...mine, Staff: { ID: 78 } } });
    expect(await sendScheduleChange(remove(), deps(client))).toMatchObject({ status: 'abandon' });
    expect(sent).toEqual([]);
  });
});

describe('the calendar after a change has gone', () => {
  /**
   * A booking the office accepted is on the office's calendar, and the
   * phone's copy is a fortnight old until the next sync. The sender reads
   * the window back and replaces it, so the block a person just made is
   * drawn from the office's own record rather than from the queue.
   */
  it('replaces the window from the office and says how many blocks it wrote', async () => {
    const now = '2026-09-08T00:00:00.000Z';
    const window = scheduleWindow(now);
    const blocks = [
      { id: '5001', jobId: '1001', staffId: '77', staffName: 'A Technician', date: window.today, startTime: '07:00', endTime: '15:30', type: 'job' },
      // No day: nothing to draw, so nothing written.
      { id: '5002', jobId: '1001', staffId: '77', date: '', startTime: '07:00', endTime: '08:00', type: 'job' },
    ];
    const api = { schedulesBetween: jest.fn(async () => blocks) };
    expect(await pullScheduleWindow(api as unknown as Pick<SimproResources, 'schedulesBetween'>, now)).toBe(1);
    expect(api.schedulesBetween).toHaveBeenCalledWith(window.from, window.to);
    const drawn = await listScheduleBetween(window.from, window.to);
    expect(drawn.map((b) => b.id)).toEqual(['5001']);
  });
});
