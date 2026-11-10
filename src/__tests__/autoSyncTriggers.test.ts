import {
  decideAutoSync, sweptEverything, TIMER_EVERY_MS, INCREMENTAL_EVERY_MS, SWEEP_EVERY_MS,
  type AutoSyncInput,
} from '@/simpro/autoSyncPolicy';
import type { SyncResource, SyncState } from '@/simpro/incremental';

/**
 * The two moments added so the sync is never waited on.
 *
 * `signin` is a person who has just signed in and is looking at a home
 * screen that does not yet know their jobs. `timer` is the open app's own
 * tick, for a phone left on a job all morning with none of the other
 * moments — no launch, no foreground, no signal coming back.
 *
 * The tick has since taken on the other half of the job: it is one of the two
 * triggers the rolling full re-read is allowed to spend time on, because a
 * phone ticking to itself in a ute is nobody's wait. That is what took the
 * six-minute pull off the front of opening the app.
 */

const NOW = new Date('2026-09-09T00:00:00Z');

function state(resource: SyncResource, minutesAgo: number, mode: SyncState['mode'] = 'incremental'): SyncState {
  return {
    resource,
    lastSyncedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    lastRecordCount: 100,
    mode,
  };
}

/** Synced ten minutes ago, everything read three hours ago. */
function current(over: Partial<AutoSyncInput> = {}): AutoSyncInput {
  return {
    now: NOW,
    enabled: true,
    credentialsProblem: null,
    online: true,
    inFlight: false,
    syncState: [state('sites', 10), state('jobs', 10), state('assets', 10)],
    trigger: 'timer',
    lastFullAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    sweptAt: sweptEverything(new Date(NOW.getTime() - 3 * 3_600_000).toISOString()),
    lastSweepAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    ...over,
  };
}

describe('somebody signing in', () => {
  it('fetches changes for them even when the copy is current', () => {
    // Ten minutes is inside the half-hour, so any other trigger would wait.
    const d = decideAutoSync(current({ trigger: 'signin' }));
    expect(d.action).toBe('incremental');
    expect(d.reason).toMatch(/signed in/i);
  });

  it('still fetches everything on a phone that has never synced', () => {
    const never: SyncState[] = [{ resource: 'sites', lastRecordCount: 0, mode: 'full' }];
    expect(decideAutoSync(current({ trigger: 'signin', syncState: never, lastFullAt: null })).action).toBe('full');
  });

  it('is refused like anything else while a run is under way', () => {
    expect(decideAutoSync(current({ trigger: 'signin', inFlight: true })).action).toBe('none');
  });
});

describe('the open app\'s own tick', () => {
  it('does nothing while the copy is current', () => {
    const d = decideAutoSync(current({ trigger: 'timer' }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/nothing is due/i);
  });

  it('fetches changes once the half hour is up', () => {
    const stale = [state('sites', 31), state('jobs', 31), state('assets', 31)];
    expect(decideAutoSync(current({ trigger: 'timer', syncState: stale })).action).toBe('incremental');
  });

  it('ticks often enough to notice the half hour without spending the battery on it', () => {
    expect(TIMER_EVERY_MS).toBeLessThanOrEqual(INCREMENTAL_EVERY_MS / 4);
    expect(TIMER_EVERY_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('spends the quiet ticks on the rolling re-read instead of on nothing', () => {
    // Everything is current, so before the sweep existed this tick did nothing
    // and the re-read it was not doing turned up on the next launch instead.
    const d = decideAutoSync(current({ trigger: 'timer', sweptAt: {}, lastSweepAt: null }));
    expect(d.action).toBe('sweep');
    expect(d.sweep?.length).toBeGreaterThan(0);
  });

  it('does not turn every tick into one', () => {
    expect(SWEEP_EVERY_MS).toBeGreaterThan(TIMER_EVERY_MS);
  });
});
