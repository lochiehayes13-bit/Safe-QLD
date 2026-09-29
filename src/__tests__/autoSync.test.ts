import {
  decideAutoSync, describeAge, describeAutoSync, latestFullPull, networkLooksOnline, resourcesDueSweep,
  summariseRun, sweepBehind, sweptEverything, triggerMaySweep,
  EMPTY_AUTO_SYNC, FULL_EVERY_MS, INCREMENTAL_EVERY_MS, SWEEP_CHUNK, SWEEP_EVERY_MS, SWEEP_RESOURCES,
  SWEEP_TRIGGERS,
  type AutoSyncInput, type AutoSyncRecord, type AutoSyncTrigger,
} from '@/simpro/autoSyncPolicy';
import { SYNC_RESOURCES, type SyncResource, type SyncState } from '@/simpro/incremental';

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

/** Every resource re-read in full this long ago. */
function swept(hours: number): Record<string, string> {
  return sweptEverything(hoursAgo(hours));
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
    sweptAt: swept(3),
    lastSweepAt: hoursAgo(3),
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
    const d = decideAutoSync(input({ syncState: NEVER, lastFullAt: null, sweptAt: {} }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/nothing has been synced/i);
  });

  it('fetches everything when the last sync is in the future', () => {
    // A clock put back would otherwise mean no sync until it catches up.
    const d = decideAutoSync(input({
      syncState: [state('sites', '2027-01-01T00:00:00Z')],
    }));
    expect(d.action).toBe('full');
    expect(d.reason).toMatch(/in the future/i);
  });

  it('never opens the app with one', () => {
    /*
     * The whole of the reported fault, in one assertion.
     *
     * Everything is a day overdue and nothing has been swept, which under the
     * old rules made the next trigger a six-minute full pull — and the next
     * trigger, on a phone that slept overnight, was always somebody opening
     * the app. There is no longer any input that gets a full pull out of a
     * launch or a foreground while the phone has data on it.
     */
    for (const trigger of ['launch', 'foreground', 'signin', 'queued', 'online'] as const) {
      const d = decideAutoSync(input({
        trigger,
        lastFullAt: hoursAgo(72),
        sweptAt: {},
        syncState: [state('sites', hoursAgo(26)), state('jobs', hoursAgo(26)), state('assets', hoursAgo(26))],
      }));
      expect(d.action).not.toBe('full');
      expect(d.action).not.toBe('sweep');
    }
  });
});

describe('the rolling re-read', () => {
  /** Every resource but these two read recently, so the slice is predictable. */
  function allButSites(): Record<string, string> {
    const at = swept(3);
    delete at.sites;
    delete at.jobs;
    return at;
  }

  it('re-reads the ones that have gone longest without it, oldest first', () => {
    const at = swept(3);
    at.assets = hoursAgo(40);
    at.quotes = hoursAgo(30);
    expect(resourcesDueSweep(at, NOW, 2)).toEqual(['assets', 'quotes']);
  });

  it('puts a resource that has never been re-read at the front of the queue', () => {
    const at = swept(3);
    at.assets = hoursAgo(40);
    delete at.invoices;
    expect(resourcesDueSweep(at, NOW, 2)).toEqual(['invoices', 'assets']);
  });

  it('treats a stamp in the future as due rather than letting the sweep stall', () => {
    // A phone whose clock was put back would otherwise read every resource as
    // freshly done and stop re-reading anything, silently, for as long as the
    // clock was wrong.
    const at = swept(3);
    at.assets = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    expect(resourcesDueSweep(at, NOW, 2)).toEqual(['assets']);
  });

  it('leaves alone anything read inside the day', () => {
    expect(resourcesDueSweep(swept(23), NOW)).toEqual([]);
    expect(sweepBehind(swept(23), NOW)).toBe(0);
  });

  it('takes a slice at a time rather than the lot', () => {
    expect(resourcesDueSweep({}, NOW)).toHaveLength(SWEEP_CHUNK);
    expect(sweepBehind({}, NOW)).toBe(SWEEP_RESOURCES.length);
  });

  it('runs on the triggers nobody is waiting on, and only those', () => {
    const waited: AutoSyncTrigger[] = ['launch', 'foreground', 'online', 'queued', 'signin'];
    for (const trigger of waited) expect(triggerMaySweep(trigger)).toBe(false);
    for (const trigger of SWEEP_TRIGGERS) expect(triggerMaySweep(trigger)).toBe(true);
  });

  it.each(SWEEP_TRIGGERS)('takes a slice on %s when one is due', (trigger) => {
    const d = decideAutoSync(input({ trigger, sweptAt: allButSites(), lastSweepAt: hoursAgo(1) }));
    expect(d.action).toBe('sweep');
    expect(d.sweep).toEqual(['sites', 'jobs']);
    expect(d.reason).toMatch(/in the background/i);
  });

  it('spaces the slices out rather than taking one every tick', () => {
    // The open app ticks every five minutes; without this that is six full
    // re-reads an hour and a warm phone.
    const recent = new Date(NOW.getTime() - SWEEP_EVERY_MS + 60_000).toISOString();
    const d = decideAutoSync(input({ trigger: 'timer', sweptAt: allButSites(), lastSweepAt: recent }));
    expect(d.action).toBe('none');
  });

  it('takes a slice when the last one is further back than the spacing', () => {
    const old = new Date(NOW.getTime() - SWEEP_EVERY_MS - 60_000).toISOString();
    expect(decideAutoSync(input({ trigger: 'timer', sweptAt: allButSites(), lastSweepAt: old })).action)
      .toBe('sweep');
  });

  it('does not let a slice delay the changes everything else is waiting on', () => {
    /*
     * Both due. The incremental is seconds and covers every resource, so it
     * goes first and the slice takes one of the gaps between them — which is
     * the point, since the gaps were being wasted.
     */
    const d = decideAutoSync(input({
      trigger: 'timer',
      syncState: [state('sites', minutesAgo(31)), state('jobs', minutesAgo(31))],
      sweptAt: allButSites(),
      lastSweepAt: hoursAgo(1),
    }));
    expect(d.action).toBe('incremental');
  });

  it('says a re-read is in hand rather than reading as idle', () => {
    // On a trigger that may not sweep, the line still has to account for the
    // eighteen resources it is not re-reading this second.
    const d = decideAutoSync(input({ trigger: 'foreground', sweptAt: allButSites() }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/waiting on a full re-read/i);
    expect(d.reason).toMatch(/background/i);
  });

  it('only rotates through resources a full read changes anything for', () => {
    // employees, schedules, tasks and timesheets are read whole on every pull
    // already, so a slice spent on one would re-read nothing.
    for (const resource of SWEEP_RESOURCES) expect(SYNC_RESOURCES).toContain(resource);
    expect(SWEEP_RESOURCES).not.toContain('employees');
    expect(SWEEP_RESOURCES).not.toContain('timesheets');
  });

  it('turns the whole list over well inside the day it is holding to', () => {
    // Slices of SWEEP_CHUNK, no closer together than SWEEP_EVERY_MS.
    const toGetRound = Math.ceil(SWEEP_RESOURCES.length / SWEEP_CHUNK) * SWEEP_EVERY_MS;
    expect(toGetRound).toBeLessThan(FULL_EVERY_MS / 2);
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
    // The queue is sent ahead of the pull in runAutoSync, so the note goes
    // first and the pull follows; a pull that is due is not skipped for it.
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
    ['a slice due', { trigger: 'timer' as const, sweptAt: {}, lastSweepAt: null }],
    ['a slice due but not this trigger', { trigger: 'foreground' as const, sweptAt: {} }],
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
    const line = describeAutoSync(record({
      lastRunAt: minutesAgo(12), lastAction: 'incremental', lastTrigger: 'foreground',
      sweptAt: swept(3),
    }), NOW);
    expect(line).toBe('Last ran 12 min ago (incremental). Everything here was re-read from the office within the last day.');
  });

  it.each([
    // [what has been re-read, what the line ends with]
    ['everything, recently', swept(3), 'Everything here was re-read from the office within the last day.'],
    ['nothing at all', {}, 'A full re-read is under way in the background, a couple at a time.'],
  ])('with %s says "%s"', (_name, sweptAt, ending) => {
    /*
     * This used to be a countdown to the next full pull — "tonight",
     * "tomorrow", "within the hour" — which was honest about a design that
     * stopped and read the company once a day. It would be a lie about this
     * one: there is no such moment any more, only a list that comes round. So
     * the line says whether it is keeping up, which is the thing a technician
     * would actually want to know.
     */
    const line = describeAutoSync(record({ lastRunAt: minutesAgo(1), lastAction: 'none', sweptAt }), NOW);
    expect(line.endsWith(ending)).toBe(true);
  });

  it('counts what is still waiting rather than rounding it to all or nothing', () => {
    const at = swept(3);
    delete at.sites;
    delete at.assets;
    const line = describeAutoSync(record({ lastRunAt: minutesAgo(1), lastAction: 'none', sweptAt: at }), NOW);
    expect(line).toContain(`2 of ${SWEEP_RESOURCES.length} are waiting on their re-read`);
  });

  it('names a slice as what it did', () => {
    const line = describeAutoSync(record({ lastRunAt: minutesAgo(4), lastAction: 'sweep', sweptAt: swept(3) }), NOW);
    expect(line).toMatch(/^Last ran 4 min ago \(re-read part of the office in the background\)\./);
  });

  it('leads with the problem when the last run hit one', () => {
    const line = describeAutoSync(record({
      lastRunAt: minutesAgo(5), lastAction: 'full', lastError: 'sites: fetch failed',
    }), NOW);
    expect(line).toBe(
      'Last ran 5 min ago and hit a problem: sites: fetch failed. '
      + 'A full re-read is under way in the background, a couple at a time.',
    );
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
      sweptAt: swept(3),
    }), NOW);
    expect(line).toBe(
      'Last checked 1 min ago. Synced 12 min ago and nothing is due yet. '
      + 'Everything here was re-read from the office within the last day.',
    );
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

  it('says why the send stopped, since the rows it left are still waiting', () => {
    expect(summariseRun('flush-only', null, { sent: 1, failed: 0, remaining: 3, stopped: { reason: 'Simpro rate limit reached.' } }))
      .toBe('Sent 1 to the office. Sending stopped: Simpro rate limit reached.');
  });

  it('counts the problems rather than hiding them', () => {
    // "Fetched everything" with three errors in it is not fetched everything.
    const line = summariseRun('incremental', { ...pull, errors: ['a', 'b', 'c'] }, { sent: 0, failed: 1, remaining: 1 });
    expect(line).toBe('Fetched changes: 3 sites, 7 jobs and 1 asset changed here. 3 problems on the way. 1 could not be sent; see Send to the office.');
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
