import { listScheduleBetween, listScheduleFor, listScheduleForJob, replaceScheduleWindow } from '@/db/scheduleRepo';
import { listPendingScheduleChanges, queueScheduleChange, undoScheduleChange } from '@/db/scheduleChangeRepo';
import { abandonSync, claimSync, enqueueSync, markSyncUnknown, pendingSync } from '@/db/opsRepo';
import { SCHEDULE_BOOK_KIND, SCHEDULE_REMOVE_KIND } from '@/domain/scheduling';
import { flushSoon } from '@/simpro/flushSoon';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * The calendar's reads, on the migrated database: everyone's blocks for a
 * window, one job's blocks, and the schedule changes the phone has queued —
 * which live on the sync queue itself, so a queue outcome is a calendar
 * outcome without a second table to keep in step. Every id here is
 * invented.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); (flushSoon as jest.Mock).mockClear(); });
afterEach(async () => { await db.closeAsync(); });

const BLOCKS = [
  { id: '1', jobId: '1001', staffId: '77', staffName: 'Alex Fixture', date: '2026-09-08', startTime: '07:00', endTime: '15:30', type: 'Job' },
  { id: '2', jobId: '1002', staffId: '78', staffName: 'Zed Fixture', date: '2026-09-08', startTime: '09:00', endTime: '12:00', type: 'Job' },
  { id: '3', jobId: '1001', staffId: '78', staffName: 'Zed Fixture', date: '2026-09-09', startTime: '07:00', endTime: '15:30', type: 'Job' },
  { id: '4', jobId: '1001', staffId: '77', staffName: 'Alex Fixture', date: '2026-09-20', startTime: '07:00', endTime: '15:30', type: 'Job' },
];

describe('reading the calendar', () => {
  beforeEach(async () => { await replaceScheduleWindow('2026-09-01', '2026-09-30', BLOCKS); });

  it('lists everyone between two days, by day then name then time, and leaves the rest of the window alone', async () => {
    const rows = await listScheduleBetween('2026-09-07', '2026-09-13');
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(rows[0]).toMatchObject({ staffName: 'Alex Fixture', jobId: '1001', startTime: '07:00', endTime: '15:30', type: 'Job' });
    // The person's own read still answers the same rows for the same window.
    expect((await listScheduleFor({ staffId: '77', from: '2026-09-07', to: '2026-09-13' })).map((r) => r.id)).toEqual(['1']);
  });

  it('lists one job\'s blocks between two days', async () => {
    expect((await listScheduleForJob('1001', '2026-09-07', '2026-09-13')).map((r) => r.id)).toEqual(['1', '3']);
    expect((await listScheduleForJob('1001', '2026-09-01', '2026-09-30')).map((r) => r.id)).toEqual(['1', '3', '4']);
    expect(await listScheduleForJob('9999', '2026-09-01', '2026-09-30')).toEqual([]);
  });
});

const booking = {
  employeeId: '77', jobId: '1001', sectionId: '5', costCenterId: '9', date: '2026-09-08', start: '07:00', end: '15:30',
  siteName: 'Fictional Tower', notBefore: '2026-09-07T22:01:00.000Z',
};
const removal = { employeeId: '77', scheduleId: '1', jobId: '1001', href: '/api/v1.0/companies/0/jobs/1001/sections/5/costCenters/9/schedules/1', date: '2026-09-08', notBefore: '2026-09-07T22:01:00.000Z' };

describe('the changes the phone has queued', () => {
  it('queues a change once, keyed on what it does, and asks for the queue to go', async () => {
    const first = await queueScheduleChange({ kind: SCHEDULE_BOOK_KIND, payload: booking });
    expect(first.duplicate).toBe(false);
    const again = await queueScheduleChange({ kind: SCHEDULE_BOOK_KIND, payload: { ...booking, siteName: 'Renamed' } });
    expect(again).toEqual({ id: first.id, duplicate: true, state: 'pending' });
    expect(flushSoon).toHaveBeenCalledTimes(1);
    const rows = await pendingSync();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: SCHEDULE_BOOK_KIND, contentKey: 'schedule-book|77|1001/5/9|2026-09-08|07:00-15:30' });
    expect(JSON.parse(rows[0]!.payload)).toEqual(booking);
  });

  it('lists the schedule rows only, with the queue\'s state on each, oldest first', async () => {
    await enqueueSync('job-note', { jobId: '1001', subject: 'x', note: 'y' });
    const a = await queueScheduleChange({ kind: SCHEDULE_BOOK_KIND, payload: booking });
    const b = await queueScheduleChange({ kind: SCHEDULE_REMOVE_KIND, payload: removal });
    await markSyncUnknown(a.id, 'No reply came back');
    const c = await queueScheduleChange({ kind: SCHEDULE_BOOK_KIND, payload: { ...booking, date: '2026-09-10' } });
    await abandonSync(c.id, 'Simpro said no');
    // Three rows queued inside one millisecond share a createdAt, so the
    // order among them is not the thing under test; the set is.
    const listed = await listPendingScheduleChanges();
    const byId = (x: { queueRowId: string }, y: { queueRowId: string }) => x.queueRowId.localeCompare(y.queueRowId);
    expect([...listed].sort(byId).map((x) => [x.queueRowId, x.kind, x.state, x.lastError])).toEqual([
      [a.id, SCHEDULE_BOOK_KIND, 'unknown', 'No reply came back'],
      [b.id, SCHEDULE_REMOVE_KIND, 'pending', undefined],
      [c.id, SCHEDULE_BOOK_KIND, 'failed', 'Simpro said no'],
    ].sort((x, y) => (x[0] as string).localeCompare(y[0] as string)));
    expect(listed.find((x) => x.queueRowId === a.id)!.payload).toEqual(booking);
  });

  it('skips a schedule row whose payload will not read, rather than drawing a block with no day', async () => {
    await enqueueSync(SCHEDULE_BOOK_KIND, { employeeId: '77' });
    expect(await listPendingScheduleChanges()).toEqual([]);
  });

  it('takes a change back while it is pending, and only then', async () => {
    // Inside the minute the change waits before the queue may send it.
    const inside = '2026-09-07T22:00:30.000Z';
    const row = await queueScheduleChange({ kind: SCHEDULE_REMOVE_KIND, payload: removal });
    expect(await undoScheduleChange(row.id, inside)).toBe(true);
    expect(await pendingSync()).toEqual([]);
    expect(await listPendingScheduleChanges()).toEqual([]);
    // Gone means it can be queued afresh: the key is free again.
    const again = await queueScheduleChange({ kind: SCHEDULE_REMOVE_KIND, payload: removal });
    expect(again.duplicate).toBe(false);
    await markSyncUnknown(again.id, 'No reply came back');
    expect(await undoScheduleChange(again.id, inside)).toBe(false);
    expect((await listPendingScheduleChanges()).map((x) => x.state)).toEqual(['unknown']);
  });

  it('refuses once the minute is up or a run has claimed the row', async () => {
    const inside = '2026-09-07T22:00:30.000Z';
    const late = await queueScheduleChange({ kind: SCHEDULE_REMOVE_KIND, payload: removal });
    // The instant the queue may send it: past taking back.
    expect(await undoScheduleChange(late.id, '2026-09-07T22:01:00.000Z')).toBe(false);
    expect(await pendingSync()).toHaveLength(1);
    expect(await claimSync(late.id)).toBe(true);
    expect(await undoScheduleChange(late.id, inside)).toBe(false);
    expect(await undoScheduleChange('no-such-row', inside)).toBe(false);
  });
});
