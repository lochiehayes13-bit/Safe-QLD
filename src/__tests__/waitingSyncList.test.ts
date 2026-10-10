import { enqueueSync, markSyncUnknown, abandonSync, markSynced, waitingSyncList, claimSync } from '@/db/opsRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * Waiting to send lists what is still on its way, not only what went wrong.
 *
 * Screens across the app say "it is on Waiting to send", and for a queued
 * clock block, a day of leave or a note that was only true once the screen
 * listed pending rows. The list reads names, so the bulky note text stays in
 * the database.
 */

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

async function setCreated(id: string, at: string): Promise<void> {
  await db.runAsync('UPDATE sync_queue SET createdAt = ? WHERE id = ?', at, id);
}

describe('the rows still on their way', () => {
  it('lists pending and sending rows, oldest first, and leaves out the rest', async () => {
    const note = await enqueueSync('job-note', { jobId: '9001', subject: 'Pump room', note: 'Body' });
    const clock = await enqueueSync('timesheet-block', { entryId: 'e1', jobId: '9001', kind: 'work' });
    const sending = await enqueueSync('attachment', { jobId: '9001', filename: 'Fictional Tower.jpg', mimeType: 'image/jpeg' });
    const sent = await enqueueSync('job-note', { jobId: '9002', subject: 'Done', note: 'x' });
    const failed = await enqueueSync('job-note', { jobId: '9003', subject: 'Refused', note: 'x' });
    const unknown = await enqueueSync('job-note', { jobId: '9004', subject: 'No reply', note: 'x' });
    await setCreated(note.id, '2026-10-08T01:00:00.000Z');
    await setCreated(clock.id, '2026-10-07T01:00:00.000Z');
    await setCreated(sending.id, '2026-10-08T02:00:00.000Z');
    expect(await claimSync(sending.id)).toBe(true);
    await markSynced(sent.id);
    await abandonSync(failed.id, 'Refused');
    await markSyncUnknown(unknown.id, 'No reply');

    const rows = await waitingSyncList();
    expect(rows.map((r) => r.id)).toEqual([clock.id, note.id, sending.id]);
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending', 'sending']);
  });

  it('keeps the fields a name is built from and drops the note body', async () => {
    const long = 'Every detector on level 3 tested. '.repeat(500);
    await enqueueSync('job-note', { jobId: '9001', subject: 'Service record', note: long });
    await enqueueSync('purchase-order', { jobId: '9001', notes: long, lines: [{ partNumber: 'A1', description: 'Detector', quantity: 2 }] });

    const [first, second] = await waitingSyncList();
    const notePayload = JSON.parse(first!.payload) as Record<string, unknown>;
    expect(notePayload).toEqual({ jobId: '9001', subject: 'Service record' });
    const orderPayload = JSON.parse(second!.payload) as Record<string, unknown>;
    expect(orderPayload.notes).toBeUndefined();
    expect(orderPayload.lines).toHaveLength(1);
    expect(first!.payload.length).toBeLessThan(200);
  });

  it('names a row whose payload is not JSON by its kind, rather than failing the list', async () => {
    const row = await enqueueSync('job-note', { jobId: '9001', subject: 'x', note: 'y' });
    await db.runAsync('UPDATE sync_queue SET payload = ? WHERE id = ?', 'not json', row.id);
    const [only] = await waitingSyncList();
    expect(only!.kind).toBe('job-note');
    expect(only!.payload).toBe('{}');
  });

  it('stops at the limit', async () => {
    for (let i = 0; i < 5; i++) await enqueueSync('job-note', { jobId: `90${i}`, subject: `n${i}`, note: 'x' });
    expect(await waitingSyncList(3)).toHaveLength(3);
  });
});
