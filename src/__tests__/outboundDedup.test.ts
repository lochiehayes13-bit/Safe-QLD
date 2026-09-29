import { createSite, createDefect, listDefects, updateDefect } from '@/db/repo';
import { addAssetEvent, createAsset } from '@/db/assetRepo';
import { recordRoutineRun, type RoutineRun } from '@/db/routineRunRepo';
import { linkRunToJob, planForRun, queuedNoteKeys, toOutboundDefect } from '@/db/outboundRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * Not telling the office about the same defect twice.
 *
 * The failure this file exists to prevent has two shapes and they arrive within
 * minutes of each other on the same afternoon.
 *
 * The durable one: a defect the office has already accepted goes up again on a
 * later visit. `planOutboundWork` has always had a refusal for it, keyed on the
 * defect's `sentToOfficeAt`, and that refusal had never once fired on a real
 * handset — `planForRun` handed the plan a hard-coded `undefined` for the stamp,
 * so every defect inside the run's window read as unsent. The only thing left
 * standing between the office and a second copy was the content key, which is no
 * help at all once somebody has tidied up the wording: an edited defect hashes to
 * a new key and goes up as an "amendment" of a note the office may already have
 * quoted a price from.
 *
 * The in-flight one: the note is queued rather than posted, because a technician
 * in a basement carpark has no signal. `outbound_accepted` hears nothing until
 * the office answers, and between the queueing and the answer a person can walk
 * out to the street, open the send screen again and queue the identical critical
 * defect notice. Two notes, two defects as the office reads them, two jobs
 * against one closed valve.
 *
 * Both halves are checked here against a real database, because both of them are
 * about what is on the row and in the queue rather than about what the pure
 * planner does with numbers handed to it. The counterpart in
 * outboundWork.test.ts covers the planner's side with keys passed in by hand.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

// Invented throughout. A fictional tower, a job number well below the range the
// company has actually reached, and a technician nobody can be mistaken for.
const SITE_NAME = 'Fictional Tower';
const JOB = '38104';
const COMPLETED_AT = '2026-09-10T05:00:00.000Z';
const RAISED_AT = '2026-09-10T04:30:00.000Z';

const DEFECT_LOCATION = 'Level 3 east riser cupboard';
const DEFECT_TEXT = 'Sprinkler control valve found closed and unmonitored.';

/**
 * A site with one passing and one failing device, a run that reports exactly
 * those two, and a Simpro job linked to it.
 *
 * The counts on the run row have to agree with the asset events or the plan
 * declines everything with 'counts-disagree' and nothing below would be
 * exercising the defect path at all.
 */
async function buildingWalkedOnce(): Promise<RoutineRun> {
  const site = await createSite({ name: SITE_NAME, suburb: 'Example Heights', state: 'QLD' });

  const good = await createAsset({
    siteId: site.id, assetTypeId: 'detector', code: 'TEST-DET-0001',
    name: 'Smoke detector', level: 'Level 1',
  });
  const bad = await createAsset({
    siteId: site.id, assetTypeId: 'valve', code: 'TEST-VLV-0001',
    name: 'Sprinkler control valve', level: 'Level 3', room: 'East riser cupboard',
  });
  await addAssetEvent({ assetId: good.id, kind: 'passed', occurredAt: '2026-09-10T03:10:00.000Z', summary: 'Tested' });
  await addAssetEvent({
    assetId: bad.id, kind: 'failed', occurredAt: '2026-09-10T04:25:00.000Z',
    summary: 'Tested', detail: 'Valve closed.',
  });

  const run = await recordRoutineRun({
    siteId: site.id,
    routineId: 'routine-annual-sprinkler',
    routineLabel: 'Annual sprinkler service',
    frequency: 'yearly',
    system: 'Sprinkler',
    completedAt: COMPLETED_AT,
    technician: 'A Technician',
    checksPassed: 1,
    checksFailed: 1,
    checksNotTested: 0,
    defectsRaised: 1,
  });
  await linkRunToJob(run.id, JOB);
  return run;
}

/** The critical defect on the failing valve, raised inside the run's window. */
async function raiseCriticalDefect(run: RoutineRun, over: { sentToOfficeAt?: string } = {}): Promise<string> {
  const d = await createDefect({
    siteId: run.siteId,
    location: DEFECT_LOCATION,
    description: DEFECT_TEXT,
    severity: 'critical',
    status: 'open',
    raisedAt: RAISED_AT,
    photos: [],
    as1851Class: 'critical',
    qldLimbInoperable: true,
    qldLimbAdverseImpact: true,
    verbalNotifiedAt: '2026-09-10T04:40:00.000Z',
    verbalNotifiedTo: 'The building manager on site',
    jobId: JOB,
    sentToOfficeAt: over.sentToOfficeAt,
  });
  return d.id;
}

/**
 * Puts a queue row in by hand rather than through `enqueueSync`, because the
 * point of several of these cases is a status `enqueueSync` will not produce —
 * a note the queue has given up on, or one sent with no reply.
 */
async function queueNote(contentKey: string, status: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO sync_queue (id,createdAt,kind,payload,attempts,status,contentKey) VALUES (?,?,?,?,?,?,?)',
    `q-${status}-${contentKey.slice(-6)}`, '2026-09-10T05:01:00.000Z', 'job-note',
    JSON.stringify({ jobId: JOB, subject: 'CRITICAL DEFECT', note: DEFECT_TEXT }),
    0, status, contentKey,
  );
}

/** The critical defect notice in a plan, or nothing where the plan declined it. */
const criticalNotice = (plan: Awaited<ReturnType<typeof planForRun>>) =>
  plan.plan.items.find((i) => i.urgency === 'critical');

describe('a defect the office has already accepted', () => {
  it('is declined by name and by the day it went, not sent a second time', async () => {
    /*
     * The stamp on the row is the whole test. Before this it was read from a
     * parameter nothing populated, so this refusal existed in the planner and
     * could not be reached from the app.
     */
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run, { sentToOfficeAt: '2026-08-04T23:15:00.000Z' });

    const plan = await planForRun(run, SITE_NAME);
    const declined = plan.plan.warnings.find((w) => w.code === 'defect-already-with-office');

    expect(declined?.severity).toBe('declined');
    expect(declined?.message).toContain(DEFECT_LOCATION);
    // The date it went is what somebody checks the job against, so it is named.
    expect(declined?.message).toContain('05/08/2026');
    expect(criticalNotice(plan)).toBeUndefined();
  });

  it('still lets the service record go, and leaves it out of the counts', async () => {
    // One note being refused must not stop the other: this attendance has not
    // been reported, and the defect it must not re-report is not part of it.
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run, { sentToOfficeAt: '2026-08-04T23:15:00.000Z' });

    const plan = await planForRun(run, SITE_NAME);

    expect(plan.plan.items).toHaveLength(1);
    expect(plan.plan.items[0]!.urgency).toBe('routine');
    expect(plan.plan.summary.defectsRaised).toBe(0);
    expect(plan.plan.summary.criticalDefects).toBe(0);
  });

  it('comes back to life the moment the stamp is written, not before', async () => {
    /*
     * Same defect, same run, two reads of the database either side of the office
     * accepting it. This is the one assertion that would fail against the old
     * hard-coded undefined, whatever was on the row.
     */
    const run = await buildingWalkedOnce();
    const defectId = await raiseCriticalDefect(run);

    const before = await planForRun(run, SITE_NAME);
    expect(criticalNotice(before)).toBeDefined();

    await updateDefect(defectId, { sentToOfficeAt: '2026-09-10T05:05:00.000Z' });
    const after = await planForRun(run, SITE_NAME);

    expect(criticalNotice(after)).toBeUndefined();
    expect(after.plan.warnings.map((w) => w.code)).toContain('defect-already-with-office');
  });

  it('reads an unstamped defect as unsent rather than as null', async () => {
    /*
     * listDefects spreads the SQL row, so a NULL column arrives as null and not
     * as the undefined the type promises. Truthiness hid it, but the plan is
     * handed to a screen and written into a report, and a field documented as an
     * optional string holding null is how a "sent: null" ends up in front of a
     * technician.
     */
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run);

    const [stored] = await listDefects(run.siteId);
    const out = toOutboundDefect(stored!, stored!.sentToOfficeAt);

    expect(out.sentToOfficeAt).toBeUndefined();
    expect('sentToOfficeAt' in out).toBe(true);
  });
});

describe('a defect whose note is still in the outbound queue', () => {
  it('is not queued a second time by a second walk-up to the send screen', async () => {
    /*
     * The walk-out-of-the-carpark case. The first plan is what the send screen
     * queued; the queue row is what it left behind; the second plan is the same
     * screen opened again once there is signal, and it must refuse.
     */
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run);

    const first = await planForRun(run, SITE_NAME);
    const key = criticalNotice(first)!.key;
    await queueNote(key, 'pending');

    const again = await planForRun(run, SITE_NAME);

    expect(criticalNotice(again)).toBeUndefined();
    const declined = again.plan.warnings.find((w) => w.code === 'already-sent');
    // Naming the key, because that is the string somebody searches the job for.
    expect(declined?.message).toContain(key);
  });

  it('counts as sent while it is waiting, going, gone, or unanswered', async () => {
    /*
     * Four statuses, one meaning: a request either has not been made yet or has
     * been made and not disproved. Every one of them must suppress the second
     * copy, because the office may already hold the note in three of the four.
     */
    for (const status of ['pending', 'sending', 'sent', 'unknown']) {
      // A fresh database per status rather than four defects in one, so each
      // status is the only reason the notice could have been suppressed.
      await db.closeAsync();
      db = openMigrated();
      const run = await buildingWalkedOnce();
      await raiseCriticalDefect(run);
      const key = criticalNotice(await planForRun(run, SITE_NAME))!.key;
      await queueNote(key, status);

      expect(criticalNotice(await planForRun(run, SITE_NAME))).toBeUndefined();
      expect(await queuedNoteKeys()).toEqual([key]);
    }
  });

  it('goes again when the queue has given up on it, so the defect is not lost', async () => {
    /*
     * A failed note has reached nobody. If it also suppressed the notice the
     * critical defect would vanish from the office's view with a tick beside it,
     * and pressing send again — which is how a person asks for another go —
     * would do nothing. Left out of the query on purpose, the same way
     * queuedAttachmentKeys leaves a failed photograph out.
     */
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run);

    const key = criticalNotice(await planForRun(run, SITE_NAME))!.key;
    await queueNote(key, 'failed');

    const again = await planForRun(run, SITE_NAME);

    expect(criticalNotice(again)?.key).toBe(key);
    expect(again.plan.warnings.map((w) => w.code)).not.toContain('already-sent');
    expect(await queuedNoteKeys()).toEqual([]);
  });

  it('ignores queued work of other kinds, which are not notes and share no keys', async () => {
    // A photograph or a timesheet block sitting in the queue says nothing about
    // whether the defect has been reported, and folding one in would silence a
    // notice that never went.
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run);
    const key = criticalNotice(await planForRun(run, SITE_NAME))!.key;

    await db.runAsync(
      'INSERT INTO sync_queue (id,createdAt,kind,payload,attempts,status,contentKey) VALUES (?,?,?,?,?,?,?)',
      'q-other', '2026-09-10T05:01:00.000Z', 'timesheet-block', '{}', 0, 'pending', key,
    );

    expect(await queuedNoteKeys()).toEqual([]);
    expect(criticalNotice(await planForRun(run, SITE_NAME))?.key).toBe(key);
  });

  it('plans the notice normally when neither the row nor the queue has seen it', async () => {
    // The base case the three refusals above are measured against: nothing
    // stamped, nothing queued, so the defect goes.
    const run = await buildingWalkedOnce();
    await raiseCriticalDefect(run);

    const plan = await planForRun(run, SITE_NAME);

    expect(plan.plan.warnings.map((w) => w.code)).not.toContain('defect-already-with-office');
    expect(plan.plan.warnings.map((w) => w.code)).not.toContain('already-sent');
    expect(criticalNotice(plan)).toBeDefined();
    expect(plan.plan.summary.criticalDefects).toBe(1);
    expect(plan.plan.items.map((i) => i.urgency)).toEqual(['critical', 'routine']);
  });
});
