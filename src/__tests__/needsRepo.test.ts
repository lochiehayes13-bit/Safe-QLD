import { addNeed, deleteNeed, listNeeds, openNeedsCount, saveNeed } from '@/db/needsRepo';
import { markOrdered, tickNeed } from '@/domain/needsList';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The needs list against the schema, on Node's own SQLite.
 *
 * The reason this runs rather than being read as text: every state on this
 * screen is a round trip. A tick is worked out in the domain module, written
 * here, and read back on the next focus — so an UPDATE that could not write a
 * null would leave an un-ticked line still carrying the time it was got, and
 * the line would read as got again the moment the screen was reopened. That is
 * invisible to the type checker, invisible to the pure tests, and the first
 * person to see it is a technician who has just been told they already have a
 * part they do not have.
 */

const AT = '2026-09-03T01:15:00.000Z';

let db: NodeSqliteDb;

beforeEach(() => {
  db = openMigrated();
});

afterEach(async () => {
  await db.closeAsync();
});

describe('writing a line down', () => {
  it('takes a bare line and gives nothing back that nobody typed', async () => {
    const made = await addNeed({ what: '  Flow meter  ' });
    expect(made).toMatchObject({ what: 'Flow meter', when: 'now', state: 'needed' });

    const [read] = await listNeeds();
    // Empty is undefined, not '': a blank string on a purchase request line
    // reads as a part number somebody chose.
    expect(read).toEqual(made);
    expect(read!.quantity).toBeUndefined();
    expect(read!.partNumber).toBeUndefined();
    expect(read!.siteId).toBeUndefined();
  });

  it('round-trips everything a full line carries', async () => {
    const made = await addNeed({
      what: '4.5kg ABE',
      quantity: 2,
      partNumber: 'ABE45',
      siteId: 'site-1',
      siteName: 'YMCA Bowen Hills',
      note: 'The one with the wall bracket',
      when: 'future',
    });
    const [read] = await listNeeds();
    expect(read).toEqual(made);
    expect(read).toMatchObject({ quantity: 2, when: 'future', siteName: 'YMCA Bowen Hills' });
  });

  it('keeps a line for a site the phone has never heard of', async () => {
    /*
     * siteId is deliberately not a foreign key. A technician types the
     * building they mean and it is regularly one this handset has never
     * synced; refusing the line at the database would lose it entirely, which
     * is the one outcome worse than an unmatched name.
     */
    await addNeed({ what: 'Flow meter', siteId: 'never-synced', siteName: 'Somebody\'s shed' });
    expect((await listNeeds())[0]).toMatchObject({ siteId: 'never-synced', siteName: "Somebody's shed" });
  });
});

describe('a line surviving being ticked', () => {
  it('is still there after the tick, with the time it was got', async () => {
    const made = await addNeed({ what: 'Flow meter' });
    await saveNeed(tickNeed(made, AT));

    const all = await listNeeds({ includeGot: true });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ state: 'got', gotAt: AT, what: 'Flow meter' });
    // And it is out of the way of the work still to do.
    expect(await listNeeds()).toEqual([]);
    expect(await openNeedsCount()).toBe(0);
  });

  it('loses the time it was got when it is un-ticked, rather than reading as got for ever', async () => {
    const made = await addNeed({ what: 'Flow meter' });
    const got = tickNeed(made, AT);
    await saveNeed(got);
    await saveNeed(tickNeed(got, AT));

    const [read] = await listNeeds({ includeGot: true });
    expect(read).toMatchObject({ state: 'needed', gotAt: undefined, orderedAt: undefined });
  });

  it('un-ticks back onto the order it was already on', async () => {
    const made = await addNeed({ what: 'Detector head' });
    const ordered = markOrdered(made, '2026-09-02T00:00:00.000Z', 'On request pr-1', 'pr-1');
    await saveNeed(ordered);
    await saveNeed(tickNeed(ordered, AT));
    await saveNeed(tickNeed((await listNeeds({ includeGot: true }))[0]!, AT));

    expect((await listNeeds())[0]).toMatchObject({
      state: 'ordered',
      orderedAt: '2026-09-02T00:00:00.000Z',
      orderNote: 'On request pr-1',
      purchaseRequestId: 'pr-1',
      gotAt: undefined,
    });
  });

  it('counts what is still to get, whatever state the rest are in', async () => {
    const a = await addNeed({ what: 'Flow meter' });
    const b = await addNeed({ what: 'Detector head' });
    await addNeed({ what: 'Nozzle', when: 'future' });
    await saveNeed(markOrdered(b, AT));
    await saveNeed(tickNeed(a, AT));
    expect(await openNeedsCount()).toBe(2);
  });

  it('removes a line outright when somebody asks for that instead', async () => {
    const made = await addNeed({ what: 'Typed by mistake' });
    await deleteNeed(made.id);
    expect(await listNeeds({ includeGot: true })).toEqual([]);
  });
});

describe('the read the screen makes', () => {
  it('walks the index rather than sorting the table', async () => {
    // The one index this migration adds is the order the list is read in. An
    // index the planner does not choose is write cost on every tick for
    // nothing, and this schema has carried one of those before.
    await addNeed({ what: 'Flow meter' });
    await listNeeds();
    const read = db.statements.find((s) => /SELECT \* FROM need_line/i.test(s.sql))!;
    expect(read).toBeDefined();
    const plan = db.raw.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).all(...read.params) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toContain('idx_need_line_order');
  });

  it('reads a row written by a build this one does not know as something still needed', async () => {
    /*
     * `state` and `whenNeeded` are plain text in the table. A row from a later
     * build — or from a database edited by hand off a phone — must not be able
     * to put the screen in a group it has no heading for, and the safe fallback
     * is the state that keeps the line in front of somebody.
     */
    await db.runAsync(
      `INSERT INTO need_line (id,what,whenNeeded,state,createdAt,updatedAt)
       VALUES ('odd','Something','someday','half-ordered',?,?)`,
      AT, AT,
    );
    expect((await listNeeds())[0]).toMatchObject({ when: 'now', state: 'needed', what: 'Something' });
  });
});
