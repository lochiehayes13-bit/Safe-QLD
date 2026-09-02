import {
  decideAutoSync, describeAge, describeAutoSync, latestFullPull, networkLooksOnline, summariseRun,
  EMPTY_AUTO_SYNC, FULL_EVERY_MS, INCREMENTAL_EVERY_MS,
  type AutoSyncInput, type AutoSyncRecord,
} from '@/simpro/autoSyncPolicy';
import type { SyncResource, SyncState } from '@/simpro/incremental';

/**
 * Syncing without anybody pressing anything.
 *
 * The rules here decide when a phone spends six minutes of battery and data,
 * and — the other way — how long a technician's note can sit on a handset
 * that has signal. Both failures are silent: a sync that runs too often is a
 * flat battery by lunch, and one that never runs is a due list three weeks
 * old that looks current. So each rule is checked on its own.
 */

/** Noon in Brisbane on a Wednesday. */
const NOW = new Date('2026-09-02T02:00:00Z');

function minutesAgo(minutes: number, from = NOW): string {
  return new Date(from.getTime() - minutes * 60_000).toISOString();
}

function hoursAgo(hours: number, from = NOW): string {
  return minutesAgo(hours * 60, from);
}

function state(resource: SyncResource, lastSyncedAt?: string, mode: SyncState['mode'] = 'incremental'): SyncState {
  return { resource, lastSyncedAt, lastRecordCount: lastSyncedAt ? 100 : 0, mode };
}

/** A phone that synced ten minutes ago and read everything three hours ago. */
function input(over: Partial<AutoSyncInput> = {}): AutoSyncInput {
  return {
    now: NOW,
    enabled: true,
    credentialsProblem: null,
    online: true,
    inFlight: false,
    syncState: [
      state('sites', minutesAgo(10)),
      state('jobs', minutesAgo(10)),
      state('assets', minutesAgo(10)),
      state('employees'),
    ],
    trigger: 'foreground',
    lastFullAt: hoursAgo(3),
    ...over,
  };
}

const NEVER = [state('sites'), state('jobs'), state('assets'), state('employees')];

describe('when nothing can run', () => {
  it('does nothing while switched off, even on a phone that has never synced', () => {
    // The switch is the technician's, and a phone that syncs anyway has no switch.
    expect(decideAutoSync(input({ enabled: false, syncState: NEVER })))
      .toEqual({ action: 'none', reason: 'Automatic sync is switched off.' });
  });

  it('does nothing without credentials, and says which one is missing', () => {
    // The reason is the one thing that fixes it, so it is carried through verbatim.
    const problem = 'Paste the Simpro client secret in Settings and save it to the keystore.';
    expect(decideAutoSync(input({ credentialsProblem: problem, syncState: NEVER })))
      .toEqual({ action: 'none', reason: problem });
  });

  it('does nothing offline', () => {
    // A pull with no signal fails five times over and reads as five faults.
    const d = decideAutoSync(input({ online: false, syncState: NEVER }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/no signal/i);
  });

  it('does not start a second run alongside the first', () => {
    // Two pulls at once each read the site list before the other writes, and
    // a site new to both is created twice.
    const d = decideAutoSync(input({ inFlight: true, syncState: NEVER }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/already running/i);
  });

  it('reads the switch before the credentials', () => {
    // "Paste the secret" on a phone with the sync off sends somebody to fix
    // something that will not make it run.
    const d = decideAutoSync(input({ enabled: false, credentialsProblem: 'No Simpro build domain is set.' }));
    expect(d.reason).toBe('Automatic sync is switched off.');
  });
});

describe('when everything is fetched', () => {
  it('fetches everything the first time', () => {
    const d = decideAutoSync(input({ syncState: NEVER, lastFullAt: null }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/nothing has been synced/i);
  });

  it('fetches everything again once a day', () => {
    // A watermark can be wrong in ways nobody sees; a daily re-read caps how
    // long that can leave a phone confidently stale.
    const d = decideAutoSync(input({ lastFullAt: hoursAgo(25) }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/1 day ago/);
  });

  it('is not due a full read a minute short of a day', () => {
    const d = decideAutoSync(input({ lastFullAt: new Date(NOW.getTime() - FULL_EVERY_MS + 60_000).toISOString() }));
    expect(d.action).not.toBe('full');
  });

  it('takes a manual full pull as a full pull when every resource says so', () => {
    // Sync now in Settings writes every resource 'full' at once; the runner
    // has no note of it, and should not count it as never having happened.
    const two = hoursAgo(2);
    const d = decideAutoSync(input({
      syncState: [state('sites', two, 'full'), state('jobs', two, 'full'), state('assets', two, 'full'), state('employees')],
      lastFullAt: null,
    }));
    expect(d.action).toBe('incremental');
  });

  it('does not take one resource reading full as a full pull', () => {
    // A server that ignores the change filter marks that resource 'full' on
    // every incremental run. Counting it would switch the daily read off.
    const two = hoursAgo(2);
    const d = decideAutoSync(input({
      syncState: [state('sites', two), state('jobs', two), state('assets', two, 'full'), state('employees')],
      lastFullAt: null,
    }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/not known when everything was last fetched/i);
  });

  it('prefers the daily read over a due incremental', () => {
    // Both are due; the full one makes the other unnecessary, not the reverse.
    const d = decideAutoSync(input({
      syncState: [state('sites', hoursAgo(26)), state('jobs', hoursAgo(26)), state('assets', hoursAgo(26))],
      lastFullAt: hoursAgo(26),
    }));
    expect(d.action).toBe('full');
  });

  it('fetches everything when the last sync is in the future', () => {
    // A clock put back would otherwise mean no sync until it catches up.
    const d = decideAutoSync(input({
      syncState: [state('sites', '2027-01-01T00:00:00Z')],
    }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/in the future/i);
  });
});

describe('when only changes are fetched', () => {
  it('fetches only what changed after half an hour', () => {
    const d = decideAutoSync(input({
      syncState: [state('sites', minutesAgo(45)), state('jobs', minutesAgo(45)), state('assets', minutesAgo(45))],
    }));
    expect(d.action).toBe('incremental');
    expect(d.reason).toMatch(/45 min ago/);
  });

  it('counts from the newest resource, not the oldest', () => {
    // An endpoint that keeps failing has an old sync time forever. Retrying it
    // every time anything else is checked would hammer a fault that will not
    // fix itself; it goes with the next run that is due anyway.
    const d = decideAutoSync(input({
      syncState: [state('sites', minutesAgo(10)), state('jobs', minutesAgo(10)), state('assets', hoursAgo(5))],
    }));
    expect(d.action).not.toBe('incremental');
  });

  it('is not due a minute short of the half hour', () => {
    const at = new Date(NOW.getTime() - INCREMENTAL_EVERY_MS + 60_000).toISOString();
    expect(decideAutoSync(input({ syncState: [state('sites', at)] })).action).toBe('none');
  });

  it('pulls rather than only sending when a queued item finds a pull due', () => {
    // The flush runs after every pull, so the note still goes.
    const d = decideAutoSync(input({ trigger: 'queued', syncState: [state('sites', minutesAgo(45))] }));
    expect(d.action).toBe('incremental');
  });
});

describe('when only the queue goes', () => {
  it('sends the queue on its own when something was just queued and nothing is due', () => {
    // A technician who just wrote a defect note wants it gone, not in half an hour.
    const d = decideAutoSync(input({ trigger: 'queued' }));
    expect(d.action).toBe('flush-only');
    expect(d.reason).toMatch(/only the queue/i);
  });

  it('sends the queue when signal comes back and nothing is due', () => {
    // Walking up out of a basement is the moment a morning's notes can go.
    const d = decideAutoSync(input({ trigger: 'online' }));
    expect(d.action).toBe('flush-only');
    expect(d.reason).toMatch(/back online/i);
  });

  it.each(['launch', 'foreground', 'background'] as const)('stays quiet on %s when nothing is due', (trigger) => {
    // Every foregrounding would otherwise be a network round trip.
    const d = decideAutoSync(input({ trigger }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/nothing is due yet/i);
  });
});

describe('the reasons', () => {
  const cases: [string, Partial<AutoSyncInput>][] = [
    ['off', { enabled: false }],
    ['offline', { online: false }],
    ['in flight', { inFlight: true }],
    ['never synced', { syncState: NEVER, lastFullAt: null }],
    ['full due', { lastFullAt: hoursAgo(30) }],
    ['full unknown', { lastFullAt: null }],
    ['incremental due', { syncState: [state('sites', hoursAgo(1))] }],
    ['queued', { trigger: 'queued' }],
    ['online', { trigger: 'online' }],
    ['nothing due', {}],
  ];

  it.each(cases)('reads as a sentence for %s', (_name, over) => {
    // Settings prints these to a technician, not to a log.
    const { reason } = decideAutoSync(input(over));
    expect(reason).toMatch(/^[A-Z].*\.$/);
    expect(reason).not.toMatch(/undefined|null|NaN/);
  });
});

describe('remembering the last full pull', () => {
  it('takes the newer of the note and the evidence', () => {
    const two = hoursAgo(2);
    const all = [state('sites', two, 'full'), state('jobs', two, 'full')];
    expect(latestFullPull(all, hoursAgo(5))).toBe(Date.parse(two));
    expect(latestFullPull(all, hoursAgo(1))).toBe(Date.parse(hoursAgo(1)));
  });

  it('has nothing to say about a phone that has never synced and has no note', () => {
    expect(latestFullPull(NEVER, null)).toBeUndefined();
    expect(latestFullPull(NEVER, 'not a date')).toBeUndefined();
  });
});

describe('the line in Settings', () => {
  function record(over: Partial<AutoSyncRecord> = {}): AutoSyncRecord {
    return { ...EMPTY_AUTO_SYNC, ...over };
  }

  it('says it has not run yet rather than inventing a time', () => {
    expect(describeAutoSync(record({ lastFullAt: hoursAgo(3) }), NOW)).toMatch(/^Has not run yet\./);
  });

  it('reads the way the brief asked for', () => {
    // Half past seven last night plus a day is tonight, in Brisbane.
    const line = describeAutoSync(record({
      lastRunAt: minutesAgo(12), lastAction: 'incremental', lastTrigger: 'foreground',
      lastFullAt: '2026-09-01T09:30:00Z',
    }), NOW);
    expect(line).toBe('Last ran 12 min ago (incremental). Next full pull tonight.');
  });

  it.each([
    // [when now is, when everything was last read, what the line ends with]
    ['2026-09-02T00:00:00Z', '2026-09-01T04:00:00Z', 'Next full pull later today.'],
    ['2026-09-02T12:00:00Z', '2026-09-02T00:00:00Z', 'Next full pull tomorrow.'],
    ['2026-09-02T02:00:00Z', hoursAgo(23.5), 'Next full pull within the hour.'],
    ['2026-09-02T02:00:00Z', hoursAgo(25), 'A full pull is due now.'],
    ['2026-09-02T02:00:00Z', null, 'A full pull is due.'],
  ])('at %s with a full pull at %s says "%s"', (now, lastFullAt, ending) => {
    // "Tonight" and "tomorrow" are Brisbane's; at ten at night it is still
    // today in Greenwich, and a phone that said tomorrow would be wrong.
    const line = describeAutoSync(record({ lastRunAt: minutesAgo(1, new Date(now)), lastAction: 'none', lastFullAt }), new Date(now));
    expect(line.endsWith(ending)).toBe(true);
  });

  it('leads with the problem when the last run hit one', () => {
    const line = describeAutoSync(record({
      lastRunAt: minutesAgo(5), lastAction: 'full', lastError: 'sites: fetch failed',
    }), NOW);
    expect(line).toBe('Last ran 5 min ago and hit a problem: sites: fetch failed. A full pull is due.');
  });

  it('names sending the queue as what it did', () => {
    const line = describeAutoSync(record({ lastRunAt: minutesAgo(3), lastAction: 'flush-only', lastFullAt: hoursAgo(3) }), NOW);
    expect(line).toMatch(/^Last ran 3 min ago \(sent the queue\)\./);
  });

  it('names a full pull as one', () => {
    const line = describeAutoSync(record({ lastRunAt: hoursAgo(2), lastAction: 'full', lastFullAt: hoursAgo(2) }), NOW);
    expect(line).toMatch(/^Last ran 2 hours ago \(full pull\)\./);
  });

  it('says what it found when nothing was due', () => {
    // A check that did nothing is still a check; silence would read as broken.
    const line = describeAutoSync(record({
      lastRunAt: minutesAgo(1), lastAction: 'none', lastResultSummary: 'Synced 12 min ago and nothing is due yet.',
      lastFullAt: '2026-09-01T09:30:00Z',
    }), NOW);
    expect(line).toBe('Last checked 1 min ago. Synced 12 min ago and nothing is due yet. Next full pull tonight.');
  });

  it('does not read a run time in the future as negative minutes', () => {
    const line = describeAutoSync(record({ lastRunAt: '2027-01-01T00:00:00Z', lastAction: 'incremental' }), NOW);
    expect(line).toMatch(/^Last ran less than a minute ago/);
  });
});

describe('ages in words', () => {
  it.each([
    [30_000, 'less than a minute'],
    [60_000, '1 min'],
    [12 * 60_000, '12 min'],
    [60 * 60_000, '1 hour'],
    [5 * 3_600_000, '5 hours'],
    [24 * 3_600_000, '1 day'],
    [50 * 3_600_000, '2 days'],
  ])('%d ms is "%s"', (ms, words) => {
    // Coarse on purpose: a status line, not a log.
    expect(describeAge(ms)).toBe(words);
  });
});

describe('summarising a run', () => {
  const pull = { sitesAdded: 1, sitesUpdated: 2, jobsAdded: 3, jobsUpdated: 4, assetsAdded: 0, assetsUpdated: 1, errors: [] };

  it('counts what changed and what went up', () => {
    expect(summariseRun('full', pull, { sent: 2, failed: 0, remaining: 0 }))
      .toBe('Fetched everything: 3 sites, 7 jobs and 1 asset changed here. Sent 2 to the office.');
  });

  it('says so when nothing was waiting', () => {
    expect(summariseRun('flush-only', null, { sent: 0, failed: 0, remaining: 0 })).toBe('Nothing was waiting to send.');
  });

  it('counts the problems rather than hiding them', () => {
    // "Fetched everything" with three errors in it is not fetched everything.
    const line = summariseRun('incremental', { ...pull, errors: ['a', 'b', 'c'] }, { sent: 0, failed: 1, remaining: 1 });
    expect(line).toBe('Fetched changes: 3 sites, 7 jobs and 1 asset changed here. 3 problems on the way. 1 could not be sent and will be retried.');
  });
});

describe('reading the network', () => {
  it('treats an answer it does not have as online', () => {
    // A sync that never runs is a worse failure than one that fails and says so.
    expect(networkLooksOnline({})).toBe(true);
    expect(networkLooksOnline({ isConnected: true })).toBe(true);
  });

  it('treats a connection that cannot reach the internet as offline', () => {
    expect(networkLooksOnline({ isConnected: false })).toBe(false);
    expect(networkLooksOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
