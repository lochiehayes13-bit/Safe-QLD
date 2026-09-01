import {
  assessIncremental, describeStaleness, newestChange, nextWatermark, planIncremental,
  type SyncState,
} from '@/simpro/incremental';

/**
 * Keeping a local copy current against an office system that changes daily.
 *
 * Both halves of this fail quietly. An incremental sync that silently misses
 * records leaves a technician with a due list that looks complete; a staleness
 * label that reads as reassuring leaves them trusting a copy from three weeks
 * ago. Neither shows up as an error.
 */

describe('planning an incremental pull', () => {
  it('asks for everything the first time', () => {
    expect(planIncremental('sites', undefined)).toMatchObject({ mode: 'full', query: {} });
  });

  it('filters on the newest change already seen', () => {
    const plan = planIncremental('jobs', '2026-08-20T09:00:00.000Z');
    expect(plan.mode).toBe('incremental');
    expect(Object.values(plan.query)[0]).toMatch(/^gt\(2026-08-20\)$/);
  });

  it('overlaps the window rather than anchoring exactly', () => {
    // A record written while the previous sync was running carries a timestamp
    // inside that window. Anchored exactly, it is skipped permanently.
    const plan = planIncremental('jobs', '2026-08-20T00:05:00.000Z');
    expect(plan.since).toBe('2026-08-19');
  });

  it('falls back to a full pull on an unreadable watermark', () => {
    expect(planIncremental('jobs', 'not a date').mode).toBe('full');
    expect(planIncremental('jobs', '2026-08-20T09:00:00.000Z', { force: true }).mode).toBe('full');
  });
});

describe('checking the filter was actually honoured', () => {
  // A REST API that does not understand a parameter usually ignores it and
  // returns everything, which looks exactly like a busy day of changes.

  it('notices when a filtered request returns the whole set', () => {
    const plan = planIncremental('assets', '2026-08-20T09:00:00.000Z');
    const outcome = assessIncremental(new Array(2000).fill({}), plan, 2000);
    expect(outcome.filterIgnored).toBe(true);
    expect(outcome.mode).toBe('full');
    expect(outcome.note).toMatch(/does not support the filter/i);
  });

  it('accepts a genuine slice', () => {
    const plan = planIncremental('assets', '2026-08-20T09:00:00.000Z');
    const outcome = assessIncremental(new Array(12).fill({}), plan, 2000);
    expect(outcome.filterIgnored).toBe(false);
    expect(outcome.mode).toBe('incremental');
  });

  it('does not judge a filter it never applied', () => {
    const outcome = assessIncremental(new Array(2000).fill({}), { query: {}, mode: 'full' }, 2000);
    expect(outcome.filterIgnored).toBe(false);
  });

  it('does not judge against a baseline it does not have', () => {
    // Nothing to compare to on a first run, so the benefit of the doubt goes
    // to the filter; a wrong call here only costs one extra full pull.
    const plan = planIncremental('assets', '2026-08-20T09:00:00.000Z');
    expect(assessIncremental(new Array(50).fill({}), plan, 0).mode).toBe('incremental');
  });
});

describe('anchoring the next sync', () => {
  it('takes the newest timestamp from the records, not the clock', () => {
    // Anchoring on local time assumes it agrees with the server's. When it runs
    // fast, every record written in the gap is skipped, silently and for good.
    expect(newestChange([
      { DateModified: '2026-08-19T10:00:00Z' },
      { DateModified: '2026-08-21T08:30:00Z' },
      { DateModified: '2026-08-20T23:00:00Z' },
    ])).toBe('2026-08-21T08:30:00.000Z');
  });

  it('reads whichever field the resource happens to use', () => {
    expect(newestChange([{ ModifiedDate: '2026-08-21T08:30:00Z' }])).toBe('2026-08-21T08:30:00.000Z');
  });

  it('returns nothing when no record carries a timestamp', () => {
    expect(newestChange([{ ID: 1 }, { ID: 2 }])).toBeUndefined();
    expect(newestChange([])).toBeUndefined();
    expect(newestChange([{ DateModified: 'sometime last week' }])).toBeUndefined();
  });
});

describe('where the next sync starts from', () => {
  /*
   * This rule decides whether records get silently skipped, and it was written
   * inline in sync.ts — twice — where nothing can load it to test it, because
   * that module imports the database.
   */
  const previous = { lastChangeSeenAt: '2026-08-20T00:00:00.000Z', lastRecordCount: 900 };
  const STARTED = '2026-08-22T03:00:00.000Z';

  it('anchors on the newest record, whatever the phone thinks the time is', () => {
    const out = nextWatermark(
      [{ DateModified: '2026-08-21T08:30:00Z' }, { DateModified: '2026-08-21T09:45:00Z' }],
      'incremental', STARTED, previous,
    );
    expect(out.lastChangeSeenAt).toBe('2026-08-21T09:45:00.000Z');
  });

  it('keeps the old watermark when an incremental pull returned nothing', () => {
    /*
     * The case that must not be got wrong. Advancing to now on a pull that
     * learned nothing moves the window past records nobody has looked at, and
     * nothing would ever report it — the next sync just asks for a later slice
     * and those records are never mentioned again.
     */
    const out = nextWatermark([], 'incremental', STARTED, previous);
    expect(out.lastChangeSeenAt).toBe(previous.lastChangeSeenAt);
    expect(out.lastChangeSeenAt).not.toBe(STARTED);
  });

  it('keeps it too when the records came back carrying no readable timestamp', () => {
    // Records with no DateModified teach nothing about where to start next.
    const out = nextWatermark(
      [{ ID: 1 }, { DateModified: 'sometime last week' }], 'incremental', STARTED, previous,
    );
    expect(out.lastChangeSeenAt).toBe(previous.lastChangeSeenAt);
  });

  it('uses the start of a full pull when its records carry no timestamp', () => {
    /*
     * A full pull has just seen everything, so starting the next window there
     * loses nothing that existed. Leaving it empty would mean pulling
     * everything again forever.
     */
    const out = nextWatermark([{ ID: 1 }], 'full', STARTED, previous);
    expect(out.lastChangeSeenAt).toBe(STARTED);
  });

  it('counts what exists on a full pull and keeps the old count on an incremental one', () => {
    /*
     * assessIncremental compares a filtered response against this number to
     * decide whether the filter was honoured. Overwriting the full-sync count
     * with an incremental one makes the next filtered response look plausible
     * however much it returns.
     */
    expect(nextWatermark([{ ID: 1 }, { ID: 2 }], 'full', STARTED, previous).lastRecordCount).toBe(2);
    expect(nextWatermark([{ ID: 1 }, { ID: 2 }], 'incremental', STARTED, previous).lastRecordCount)
      .toBe(900);
  });

  it('does not go backwards from a first sync that has no previous watermark', () => {
    const fresh = { lastChangeSeenAt: undefined, lastRecordCount: 0 };
    expect(nextWatermark([], 'incremental', STARTED, fresh).lastChangeSeenAt).toBeUndefined();
    expect(nextWatermark([], 'full', STARTED, fresh).lastChangeSeenAt).toBe(STARTED);
  });
});

describe('saying how old the local copy is', () => {
  const state = (lastSyncedAt?: string): SyncState => ({
    resource: 'assets', lastRecordCount: 100, mode: 'incremental', lastSyncedAt,
  });
  const now = new Date('2026-09-01T12:00:00Z');

  it('does not pretend local-only data was synced', () => {
    expect(describeStaleness(state(), now)).toMatchObject({ state: 'never' });
    expect(describeStaleness(state(), now).label).toMatch(/never synced/i);
  });

  it('reads fresh within the working day', () => {
    expect(describeStaleness(state('2026-09-01T11:30:00Z'), now).state).toBe('fresh');
    expect(describeStaleness(state('2026-09-01T04:00:00Z'), now).state).toBe('fresh');
  });

  it('reads ageing after a day', () => {
    expect(describeStaleness(state('2026-08-31T06:00:00Z'), now).state).toBe('ageing');
    expect(describeStaleness(state('2026-08-31T06:00:00Z'), now).label).toMatch(/1 day ago/);
  });

  it('says plainly when the copy can no longer be trusted', () => {
    // "Synced 21 days ago" invites a technician to read a due list as current.
    const old = describeStaleness(state('2026-08-11T12:00:00Z'), now);
    expect(old.state).toBe('stale');
    expect(old.label).toMatch(/almost certainly moved on/i);
    expect(old.label).toMatch(/21 days/);
  });

  it('does not trust a sync time in the future', () => {
    // A clock set wrong on the phone would otherwise make stale data read fresh.
    expect(describeStaleness(state('2027-01-01T00:00:00Z'), now).state).toBe('never');
  });
});
