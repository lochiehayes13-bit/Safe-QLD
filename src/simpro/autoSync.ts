import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { loadPrefs } from '@/app-prefs';
import { SimproClient } from './client';
import { simproConfigFromPrefs } from './config';
import { flushQueue, pullFromSimpro, type FlushResult, type SyncResult } from './sync';
import { readAllSyncState } from './watermark';
import { flushSoon, setFlushRunner } from './flushSoon';
import {
  decideAutoSync, latestFullPull, networkLooksOnline, summariseRun, EMPTY_AUTO_SYNC,
  type AutoSyncDecision, type AutoSyncRecord, type AutoSyncTrigger,
} from './autoSyncPolicy';

export { flushSoon } from './flushSoon';

/**
 * Syncing without anybody pressing anything.
 *
 * This is the part that touches things: preferences, the keystore, the
 * network, the database, and the pull and flush in ./sync. Whether to do any
 * of it is decided in ./autoSyncPolicy, which touches nothing and is tested.
 *
 * Nothing here throws to its caller. The callers are an AppState listener, a
 * network listener and a background task, none of which has anywhere to put
 * an exception — and a sync that fails must fail into the line in Settings,
 * not into a red screen while somebody is photographing a defect.
 */

const STORAGE_KEY = 'safeqld.autosync';

export interface AutoSyncSnapshot {
  record: AutoSyncRecord;
  /** True while a run — automatic or the manual one from Settings — is under way. */
  inFlight: boolean;
}

let record: AutoSyncRecord = EMPTY_AUTO_SYNC;
let snapshot: AutoSyncSnapshot = { record, inFlight: false };
let restoring: Promise<void> | null = null;
/**
 * The trigger of the run under way, or null.
 *
 * Claimed before the first await, so two triggers a tick apart — launch and
 * the network listener firing on the same breath — cannot both start a pull.
 * Two pulls at once each read the site list before the other has written to
 * it, and a site new to both is created twice.
 */
let active: AutoSyncTrigger | null = null;
/** Manual pulls from Settings hold this so an automatic run does not start alongside them. */
let holds = 0;
/** A queued trigger arrived mid-run; the queue is sent again once the run is over. */
let flushAgain = false;
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = { record, inFlight: active !== null || holds > 0 };
  for (const listener of listeners) listener();
}

/** Reads the note about the last run back from storage, once. */
function restore(): Promise<void> {
  if (!restoring) {
    restoring = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        record = { ...EMPTY_AUTO_SYNC, ...(JSON.parse(raw) as Partial<AutoSyncRecord>) };
        publish();
      })
      .catch(() => {
        // A corrupt note about the last run is not worth a word. The next run
        // writes a fresh one.
      });
  }
  return restoring;
}

async function remember(patch: Partial<AutoSyncRecord>): Promise<void> {
  record = { ...record, ...patch };
  publish();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // The in-memory copy still drives the screen. A lost write only costs the
    // line in Settings after a restart.
  }
}

async function isOnline(): Promise<boolean> {
  try {
    return networkLooksOnline(await Network.getNetworkStateAsync());
  } catch {
    // If the module cannot say, let the sync find out. A request that fails is
    // recorded and read; a sync that was never attempted is neither.
    return true;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One automatic run: decide, and do what was decided.
 *
 * Resolves to the decision so a caller that wants to log it can, and never
 * rejects. Everything it learns goes into the record, which is what the line
 * in Settings reads.
 */
export async function runAutoSync(trigger: AutoSyncTrigger): Promise<AutoSyncDecision> {
  const inFlight = active !== null || holds > 0;
  if (!inFlight) {
    active = trigger;
    publish();
  }
  try {
    await restore();
    const prefs = await loadPrefs();
    const config = simproConfigFromPrefs(prefs);
    const [credentialsProblem, online, syncState] = await Promise.all([
      SimproClient.missingCredentials(config),
      isOnline(),
      readAllSyncState(),
    ]);
    // Carried forward on every note, so a manual full pull from Settings is
    // noticed by the next check rather than counted as never having happened.
    const lastFull = latestFullPull(syncState, record.lastFullAt);
    const lastFullAt = lastFull === undefined ? null : new Date(lastFull).toISOString();
    const now = new Date();
    const decision = decideAutoSync({
      now, enabled: prefs.autoSync, credentialsProblem, online, inFlight, syncState, trigger, lastFullAt,
    });

    if (decision.action === 'none') {
      if (inFlight) {
        // The run under way writes its own note. A queued item that arrived
        // during it goes with a fresh flush afterwards, since the running
        // flush may already have read the queue.
        if (trigger === 'queued') flushAgain = true;
        return decision;
      }
      await remember({
        lastRunAt: now.toISOString(), lastTrigger: trigger, lastAction: 'none',
        lastError: null, lastResultSummary: decision.reason, lastFullAt,
      });
      return decision;
    }

    const startedAt = now.toISOString();
    let pull: SyncResult | null = null;
    let flush: FlushResult | null = null;
    const errors: string[] = [];
    /*
     * The queue goes first. A note the technician just wrote is the thing
     * they are waiting on, and behind a full pull it waited six minutes —
     * or forever, if the van drove out of signal before the pull was done.
     * Each half has its own try, so a flush that throws does not cost the
     * pull and a pull that throws does not cost the flush; anything queued
     * while the pull runs goes with the flush the queued trigger asks for
     * afterwards (flushAgain).
     */
    try {
      flush = await flushQueue(config);
      if (flush.stopped) errors.push(flush.stopped.reason);
    } catch (e) {
      errors.push(message(e));
    }
    if (decision.action !== 'flush-only') {
      try {
        pull = await pullFromSimpro(config, undefined, {
          incremental: decision.action === 'incremental',
          // A run asked for by a queued note reads the lists and leaves the
          // dozen requests a job's children cost to the next foreground.
          prefetchDetails: trigger !== 'queued',
        });
        if (pull.errors.length) errors.push(pull.errors.slice(0, 3).join(' '));
      } catch (e) {
        errors.push(message(e));
      }
    }
    const error = errors.length ? errors.join(' ') : null;
    await remember({
      lastRunAt: startedAt,
      lastTrigger: trigger,
      lastAction: decision.action,
      lastError: error,
      lastResultSummary: summariseRun(decision.action, pull, flush),
      // A full attempt counts even with errors in it. A resource that failed
      // has no watermark, so the next incremental run reads it in full
      // anyway; re-running the whole six minutes every half hour against an
      // endpoint that will keep failing helps nobody.
      lastFullAt: decision.action === 'full' && pull ? startedAt : lastFullAt,
    });
    return decision;
  } catch (e) {
    const reason = `Could not check whether to sync: ${message(e)}`;
    if (!inFlight) {
      await remember({
        lastRunAt: new Date().toISOString(), lastTrigger: trigger, lastAction: 'none',
        lastError: message(e), lastResultSummary: null,
      }).catch(() => {});
    }
    return { action: 'none', reason };
  } finally {
    if (!inFlight) {
      active = null;
      publish();
      if (flushAgain) {
        flushAgain = false;
        flushSoon();
      }
    }
  }
}

/**
 * Keeps automatic runs out of the way while a manual pull from Settings runs.
 * Returns the release; calling it twice is harmless.
 */
export function holdAutoSync(): () => void {
  holds++;
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    publish();
    if (flushAgain && holds === 0 && active === null) {
      flushAgain = false;
      flushSoon();
    }
  };
}

// The queue functions in ./sync and ./assetTestQueue call flushSoon without
// importing this module; this is where it learns what to run.
setFlushRunner(() => {
  void runAutoSync('queued');
});

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentAutoSync(): AutoSyncSnapshot {
  return snapshot;
}

/** The last run and whether one is under way, for a screen that shows it. */
export function useAutoSync(): AutoSyncSnapshot {
  useEffect(() => {
    void restore();
  }, []);
  return useSyncExternalStore(subscribe, currentAutoSync);
}
