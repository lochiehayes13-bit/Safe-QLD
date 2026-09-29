import {
  costCentresForJob, deleteEntry, getEntry, listEntriesBetween, listEntriesForDay, markEntrySendFailed, markEntrySent,
  openEntry, queueStatesFor, startEntry, stopOpenEntry, unsentEntries, updateEntryTimes, weekWindow,
} from '@/db/clockRepo';
import { enqueueSync, markSyncFailed, upsertJob } from '@/db/opsRepo';
import { replaceJobChildren } from '@/db/mirrorRepo';
import { clockContentKey } from '@/domain/clockOn';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * The clock entries, on the migrated database.
 *
 * The model is checked on its own in clockOn.test; this checks that a row
 * survives the trip through SQLite unchanged, that the one-open rule holds
 * where the read and the write are two statements, and that the cost centre
 * read joins the job's children the way the sync writes them.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const EMP = '77';
const ON = { employeeExternalId: EMP, kind: 'work' as const, jobExternalId: '1001', jobSectionExternalId: '5', jobCostCenterExternalId: '9', jobTitle: 'Six-monthly routine', siteName: 'Fictional Tower' };

describe('clocking on and off', () => {
  it('round-trips an entry with every optional field absent or present', async () => {
    const { opened, closed } = await startEntry({ ...ON, scheduleRateId: '3', scheduleRateName: 'Ordinary', note: 'Level 2 first' }, '2026-09-07T21:00:00.000Z');
    expect(opened.date).toBe('2026-09-08');
    expect(closed).toEqual([]);
    expect(await getEntry(opened.id)).toEqual(opened);
    const { opened: bare } = await startEntry({ employeeExternalId: EMP, kind: 'break' }, '2026-09-07T23:00:00.000Z');
    expect(await getEntry(bare.id)).toEqual(bare);
    expect(Object.keys(bare).sort()).toEqual(['date', 'employeeExternalId', 'id', 'kind', 'startedAt']);
  });

  it('keeps one entry open, closing the last at the instant the next starts', async () => {
    const { opened: first } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    const second = await startEntry({ ...ON, jobExternalId: '1002' }, '2026-09-07T23:00:00.000Z');
    expect((await openEntry())?.id).toBe(second.opened.id);
    expect((await getEntry(first.id))?.endedAt).toBe('2026-09-07T23:00:00.000Z');
    // The switch hands back what it closed, so the screen can queue it.
    expect(second.closed.map((e) => [e.id, e.endedAt])).toEqual([[first.id, '2026-09-07T23:00:00.000Z']]);
    const closed = await stopOpenEntry('2026-09-08T01:00:00.000Z');
    expect(closed.map((e) => e.id)).toEqual([second.opened.id]);
    expect(await openEntry()).toBeUndefined();
    expect(await stopOpenEntry('2026-09-08T02:00:00.000Z')).toEqual([]);
  });

  it('splits an entry stopped after midnight into one row per day, and hands back both', async () => {
    const { opened: on } = await startEntry(ON, '2026-09-08T12:00:00.000Z'); // 22:00 Brisbane
    const closed = await stopOpenEntry('2026-09-08T16:00:00.000Z'); // 02:00 next day
    expect(closed.map((e) => e.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(closed[0]?.id).toBe(on.id);
    expect(closed[1]?.id).not.toBe(on.id);
    expect((await listEntriesForDay('2026-09-08')).map((e) => [e.id, e.endedAt])).toEqual([[on.id, '2026-09-08T14:00:00.000Z']]);
    expect((await listEntriesForDay('2026-09-09')).map((e) => e.startedAt)).toEqual(['2026-09-08T14:00:00.000Z']);
    expect((await listEntriesBetween('2026-09-08', '2026-09-09')).map((e) => e.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(weekWindow('2026-09-07')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('splits on a switch as well as on Off, with both pieces closed and a fresh entry open', async () => {
    const { opened: on } = await startEntry(ON, '2026-09-08T12:00:00.000Z');
    const r = await startEntry({ ...ON, jobExternalId: '1002' }, '2026-09-08T16:00:00.000Z');
    expect(r.closed.map((e) => [e.date, e.jobExternalId])).toEqual([['2026-09-08', '1001'], ['2026-09-09', '1001']]);
    expect(r.closed[0]?.id).toBe(on.id);
    expect(new Set([on.id, r.closed[1]?.id, r.opened.id]).size).toBe(3);
    expect((await openEntry())?.id).toBe(r.opened.id);
    expect((await unsentEntries()).map((e) => e.id)).toEqual([on.id, r.closed[1]?.id]);
  });
});

describe('editing', () => {
  it('changes the times within the day and refuses a time outside it', async () => {
    const { opened: e } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:00:00.000Z');
    const ok = await updateEntryTimes(e.id, '2026-09-07T21:30:00.000Z', '2026-09-07T23:15:00.000Z');
    expect(ok).toMatchObject({ ok: true, entry: { startedAt: '2026-09-07T21:30:00.000Z', endedAt: '2026-09-07T23:15:00.000Z' } });
    expect(await updateEntryTimes(e.id, '2026-09-07T23:30:00.000Z', '2026-09-07T23:15:00.000Z')).toEqual({ ok: false, why: 'Ends before it starts' });
    expect(await updateEntryTimes(e.id, '2026-09-07T21:00:00.000Z', '2026-09-08T14:30:00.000Z')).toMatchObject({ ok: false });
    expect(await updateEntryTimes('nope', '2026-09-07T21:00:00.000Z', undefined)).toEqual({ ok: false, why: 'That entry is no longer here' });
  });

  it('clears an old refusal when the times change, so the fix is tried again', async () => {
    const { opened: e } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:00:00.000Z');
    await markEntrySendFailed(e.id, 'Longer than 18 hours: check the times');
    expect((await getEntry(e.id))?.sendError).toBe('Longer than 18 hours: check the times');
    await updateEntryTimes(e.id, '2026-09-07T21:00:00.000Z', '2026-09-07T22:00:00.000Z');
    expect((await getEntry(e.id))?.sendError).toBeUndefined();
  });

  it('will not edit or delete what the office already holds', async () => {
    const { opened: e } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:00:00.000Z');
    await markEntrySent(e.id, '4410', '2026-09-07T23:01:00.000Z');
    const held = await getEntry(e.id);
    expect(held).toMatchObject({ sentAt: '2026-09-07T23:01:00.000Z', simproUid: '4410' });
    expect(held?.sendError).toBeUndefined();
    expect(await updateEntryTimes(e.id, '2026-09-07T21:00:00.000Z', '2026-09-07T22:00:00.000Z')).toMatchObject({ ok: false, why: expect.stringMatching(/Already sent/) });
    expect(await deleteEntry(e.id)).toMatchObject({ ok: false });
    expect(await getEntry(e.id)).toBeDefined();
  });

  it('deletes an unsent entry, and says nothing about one already gone', async () => {
    const { opened: e } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:00:00.000Z');
    expect(await deleteEntry(e.id)).toEqual({ ok: true });
    expect(await getEntry(e.id)).toBeUndefined();
    expect(await deleteEntry(e.id)).toEqual({ ok: true });
  });
});

describe('what is still to send', () => {
  it('lists closed entries the office has not accepted, breaks left out', async () => {
    const { opened: a } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    await startEntry({ employeeExternalId: EMP, kind: 'break' }, '2026-09-07T23:00:00.000Z');
    const { opened: c } = await startEntry({ ...ON, jobExternalId: '1002' }, '2026-09-07T23:30:00.000Z');
    const { opened: running } = await startEntry(ON, '2026-09-08T01:00:00.000Z');
    await markEntrySent(a.id, '1');
    expect((await unsentEntries()).map((e) => e.id)).toEqual([c.id]);
    expect((await openEntry())?.id).toBe(running.id);
  });

  it('reads the queue row behind each entry, newest first where one was re-queued', async () => {
    const { opened: a } = await startEntry(ON, '2026-09-07T21:00:00.000Z');
    const { opened: b } = await startEntry(ON, '2026-09-07T22:00:00.000Z');
    await stopOpenEntry('2026-09-07T23:00:00.000Z');
    const row = await enqueueSync('timesheet-block', { entryId: a.id }, { contentKey: clockContentKey(a.id) });
    await markSyncFailed(row.id, 'HTTP 500 from the office');
    const states = await queueStatesFor([a.id, b.id]);
    expect(states.get(a.id)).toEqual({ status: 'pending', lastError: 'HTTP 500 from the office' });
    expect(states.has(b.id)).toBe(false);
    expect(await queueStatesFor([])).toEqual(new Map());
  });
});

describe('the cost centres a job offers', () => {
  it('joins the job children by the office job number, in the office order', async () => {
    await upsertJob({ id: 'simpro-1001', externalId: '1001', siteName: 'Fictional Tower', title: 'Six-monthly routine', status: 'scheduled' });
    await replaceJobChildren('simpro-1001', {
      sections: [
        { id: '5', name: 'Section B', displayOrder: 2, costCenters: [{ id: '9', name: 'Fire detection', displayOrder: 1, items: [] }] },
        { id: '4', name: 'Section A', displayOrder: 1, costCenters: [
          { id: '8', name: 'Hydrants', displayOrder: 2, items: [] },
          { id: '7', name: 'Extinguishers', displayOrder: 1, items: [] },
        ] },
      ],
    }, '2026-09-07T21:00:00.000Z');
    expect(await costCentresForJob('1001')).toEqual([
      { sectionExternalId: '4', sectionName: 'Section A', costCenterExternalId: '7', name: 'Extinguishers' },
      { sectionExternalId: '4', sectionName: 'Section A', costCenterExternalId: '8', name: 'Hydrants' },
      { sectionExternalId: '5', sectionName: 'Section B', costCenterExternalId: '9', name: 'Fire detection' },
    ]);
    expect(await costCentresForJob('1002')).toEqual([]);
  });
});
