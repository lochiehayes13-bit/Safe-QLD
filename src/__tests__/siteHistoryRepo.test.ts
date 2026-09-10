import { planCandidates, siteFacts } from '@/db/siteHistoryRepo';
import { createSite } from '@/db/repo';
import { upsertJob } from '@/db/opsRepo';
import { createAsset, seedReferenceData } from '@/db/assetRepo';
import { recordRoutineRun } from '@/db/routineRunRepo';
import { replaceScheduleWindow } from '@/db/scheduleRepo';
import { insertClosedEntry } from '@/db/clockRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * The site facts, on the migrated database.
 *
 * The judgements are checked in siteHistory.test; this checks the reads:
 * that the last job is the last *complete* one, that hours are gathered
 * from the schedule mirror and the phone's own clock, that a next job with
 * a block on the office calendar reads as locked in, and that the day
 * builder's candidate list puts overdue work first and carries the open
 * job a block would be booked on.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const TODAY = '2026-09-10';

const RUN = { routineLabel: 'Fire detection — annual', frequency: 'annual', system: 'detection', checksPassed: 12, checksFailed: 0, checksNotTested: 0, defectsRaised: 0 };

describe('siteFacts', () => {
  it('is undefined for a site the phone does not hold', async () => {
    expect(await siteFacts('nope', TODAY)).toBeUndefined();
  });

  it('reads the last complete job, who did it, and the hours the phone holds for it', async () => {
    const site = await createSite({ name: 'Fictional Tower', suburb: 'Maroochydore', contactName: 'Pat', contactMobile: '0400 000 000' });
    await upsertJob({ externalId: '1001', siteId: site.id, siteName: site.name, title: 'Annual routine', status: 'complete', completedDate: '2026-08-01', techniciansJson: JSON.stringify([{ id: 5, name: 'Sam' }]) });
    await upsertJob({ externalId: '1002', siteId: site.id, siteName: site.name, title: 'Six-monthly routine', status: 'complete', completedDate: '2026-08-20', techniciansJson: JSON.stringify([{ id: 5, name: 'Sam' }, { id: 6, name: 'Alex' }]) });
    await upsertJob({ externalId: '1003', siteId: site.id, siteName: site.name, title: 'Callout, still open', status: 'scheduled' });

    // The office's schedule mirror holds two blocks on the later job.
    await replaceScheduleWindow('2026-08-20', '2026-08-20', [
      { id: 's1', jobId: '1002', staffId: '5', staffName: 'Sam', date: '2026-08-20', startTime: '07:00', endTime: '11:00' },
      { id: 's2', jobId: '1002', staffId: '6', staffName: 'Alex', date: '2026-08-20', startTime: '07:00', endTime: '09:30' },
    ]);
    // And this phone clocked an hour on it.
    await insertClosedEntry({ id: 'c1', employeeExternalId: '5', kind: 'work', jobExternalId: '1002', date: '2026-08-20', startedAt: '2026-08-19T21:00:00.000Z', endedAt: '2026-08-19T22:00:00.000Z' });

    await seedReferenceData();
    await createAsset({ siteId: site.id, assetTypeId: 'fip' });
    await createAsset({ siteId: site.id, assetTypeId: 'detector' });
    await createAsset({ siteId: site.id, assetTypeId: 'detector' });

    const f = (await siteFacts(site.id, TODAY, 'Sam'))!;
    expect(f.lastJob).toMatchObject({ jobNo: '1002', title: 'Six-monthly routine', finished: '2026-08-20', who: ['Sam', 'Alex'], daysAgo: 21 });
    expect(f.clockedOn).toBe('yes');
    expect(f.hours?.total).toBeCloseTo(6.5 + 1, 5);
    expect(f.hours?.byPerson.map((p) => p.name).sort()).toEqual(['Alex', 'Sam']);
    expect(f.assetsTotal).toBe(3);
    expect(f.assets.find((a) => a.system === 'detection')?.count).toBe(3);
    expect(f.contact).toEqual({ name: 'Pat', phone: '0400 000 000' });
    // The open job is the next one, but nothing on the calendar yet.
    expect(f.nextJob?.externalId).toBe('1003');
    expect(f.lockedIn).toBe('job-only');
  });

  it('reads a next job as locked in when the office has a block for it from today on', async () => {
    const site = await createSite({ name: 'Fictional Clinic' });
    await upsertJob({ externalId: '2001', siteId: site.id, siteName: site.name, title: 'Annual routine', status: 'scheduled' });
    await replaceScheduleWindow('2026-09-01', '2026-09-30', [
      { id: 'old', jobId: '2001', staffName: 'Sam', date: '2026-09-01', startTime: '07:00', endTime: '09:00' },
      { id: 'next', jobId: '2001', staffName: 'Alex', date: '2026-09-15', startTime: '07:00', endTime: '11:00' },
    ]);
    const f = (await siteFacts(site.id, TODAY))!;
    expect(f.lockedIn).toBe('booked');
    expect(f.nextJob?.scheduled).toEqual({ date: '2026-09-15', staffName: 'Alex', startTime: '07:00', endTime: '11:00' });
    expect(f.lastJob).toBeUndefined();
    expect(f.clockedOn).toBe('unknown');
  });

  it('falls back to the phone’s own routine run and dates it on the Queensland day', async () => {
    const site = await createSite({ name: 'Fictional Shed' });
    await recordRoutineRun({ siteId: site.id, routineId: 'det-annual', technician: 'Sam', completedAt: '2026-08-31T20:30:00.000Z', ...RUN });
    const f = (await siteFacts(site.id, TODAY))!;
    expect(f.lastRun).toMatchObject({ technician: 'Sam', routineLabel: RUN.routineLabel });
    // 20:30 UTC on the 31st is the 1st in Queensland: 9 days before today.
    expect(f.lastRun?.daysAgo).toBe(9);
    expect(f.lockedIn).toBe('none');
    expect(f.due.find((d) => d.routineId === 'det-annual')?.state).toBe('upcoming');
  });
});

describe('planCandidates', () => {
  it('lists overdue work first, then open jobs, each with the job a block is booked on', async () => {
    const overdue = await createSite({ name: 'Zed Overdue' });
    await recordRoutineRun({ siteId: overdue.id, routineId: 'det-annual', completedAt: '2024-01-15T00:00:00.000Z', ...RUN });
    await upsertJob({ externalId: '3001', siteId: overdue.id, siteName: overdue.name, title: 'Annual routine', status: 'scheduled' });

    const open = await createSite({ name: 'Alpha Open Job' });
    await upsertJob({ externalId: '3002', siteId: open.id, siteName: open.name, title: 'Callout', status: 'scheduled' });
    await upsertJob({ externalId: '3003', siteId: open.id, siteName: open.name, title: 'Done', status: 'complete', completedDate: '2026-08-01' });

    const quiet = await createSite({ name: 'Quiet Place' });
    await recordRoutineRun({ siteId: quiet.id, routineId: 'det-annual', completedAt: '2026-08-01T00:00:00.000Z', ...RUN });

    const out = await planCandidates(TODAY);
    expect(out.map((c) => [c.siteName, c.reason])).toEqual([
      ['Zed Overdue', 'overdue'],
      ['Alpha Open Job', 'open-job'],
    ]);
    expect(out[0]?.job).toEqual({ externalId: '3001', title: 'Annual routine' });
    expect(out[1]?.job).toEqual({ externalId: '3002', title: 'Callout' });
    expect(out[0]?.daysUntilDue).toBeLessThan(0);
  });

  it('searches by name, suburb or address and escapes the LIKE wildcards', async () => {
    await createSite({ name: 'Fictional Tower', suburb: 'Maroochydore' });
    await createSite({ name: 'Other Place', address: 'Unit 100% St' });
    await createSite({ name: 'Third' });
    expect((await planCandidates(TODAY, 'maroo')).map((c) => c.siteName)).toEqual(['Fictional Tower']);
    expect((await planCandidates(TODAY, '%')).map((c) => c.siteName)).toEqual(['Other Place']);
    expect((await planCandidates(TODAY, 'zzz'))).toEqual([]);
    expect((await planCandidates(TODAY, 'th'))[0]?.reason).toBe('search');
  });
});
