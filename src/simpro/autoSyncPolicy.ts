import { QLD_UTC_OFFSET_HOURS } from '@/domain/qldTime';
import type { SyncState } from './incremental';

/**
 * When the app syncs on its own, and what it says about it.
 *
 * "I'm sick of syncing" was the whole brief. Two buttons in Settings — a
 * six-minute pull of every site and asset, and a separate send of the outbound
 * queue — are why a phone in a van runs weeks behind the office: nobody presses
 * a six-minute button on a Tuesday afternoon. So the app does it for itself,
 * quietly and without a popup, often enough that nothing a technician wrote
 * sits on the handset any longer than the signal does.
 *
 * Every rule about *whether* to run is here, free of the network, the database
 * and React, so each one can be tested on its own. The running is in
 * ./autoSync, and the wording here is what Settings prints, so every reason is
 * a plain sentence a technician can read.
 */

/** How often to ask the office for what changed. */
export const INCREMENTAL_EVERY_MS = 30 * 60_000;

/**
 * How often to re-read everything regardless.
 *
 * An incremental pull is only as good as its watermark, and a watermark can be
 * wrong in ways nobody sees — a record edited without its modified date moving,
 * a filter the server quietly ignored. A daily full read puts a ceiling on how
 * long any of that can leave a phone confidently stale.
 */
export const FULL_EVERY_MS = 24 * 3_600_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AutoSyncTrigger = 'launch' | 'foreground' | 'online' | 'background' | 'queued';
export type AutoSyncAction = 'full' | 'incremental' | 'flush-only' | 'none';

export interface AutoSyncInput {
  now: Date;
  enabled: boolean;
  /** Why the device cannot talk to Simpro, or null when it can. See SimproClient.missingCredentials. */
  credentialsProblem: string | null;
  online: boolean;
  inFlight: boolean;
  syncState: SyncState[];
  trigger: AutoSyncTrigger;
  /**
   * When a full pull last finished, as the runner remembers it.
   *
   * Sync state alone cannot say. A resource's mode flips to 'incremental' on
   * the next partial pull and the time of the full one before it is gone, so
   * the runner keeps its own note. Optional because there may not be one yet,
   * in which case the sync state is all there is to go on.
   */
  lastFullAt?: string | null;
}

export interface AutoSyncDecision {
  action: AutoSyncAction;
  /** A sentence for Settings, never a code. */
  reason: string;
}

/**
 * What one automatic run should do.
 *
 * The order matters and is the order a technician would want it explained:
 * first the reasons nothing can happen at all, then the reasons everything
 * must be fetched, then the cheap case, then whether the queue alone is worth
 * a trip.
 */
export function decideAutoSync(input: AutoSyncInput): AutoSyncDecision {
  if (!input.enabled) {
    return { action: 'none', reason: 'Automatic sync is switched off.' };
  }
  if (input.credentialsProblem) {
    return { action: 'none', reason: input.credentialsProblem };
  }
  if (!input.online) {
    return { action: 'none', reason: 'No signal. It will run as soon as the phone is back online.' };
  }
  if (input.inFlight) {
    return { action: 'none', reason: 'A sync is already running.' };
  }

  const now = input.now.getTime();
  const lastAny = latestSync(input.syncState);
  if (lastAny === undefined) {
    return {
      action: 'full',
      reason: 'Nothing has been synced from the office yet, so everything is being fetched.',
    };
  }
  if (lastAny > now) {
    // A sync time in the future is a clock that has been put back. Waiting for
    // the clock to catch up could be days; one full read costs six minutes and
    // leaves a sync time this phone can count from.
    return {
      action: 'full',
      reason: 'The last sync time is in the future, so everything is being fetched again.',
    };
  }

  const lastFull = latestFullPull(input.syncState, input.lastFullAt);
  if (lastFull === undefined) {
    return {
      action: 'full',
      reason: 'It is not known when everything was last fetched, so it is being fetched again.',
    };
  }
  const fullAge = now - lastFull;
  if (fullAge >= FULL_EVERY_MS) {
    return {
      action: 'full',
      reason: `Everything was last fetched ${describeAge(fullAge)} ago, so it is being fetched again.`,
    };
  }

  const age = now - lastAny;
  if (age >= INCREMENTAL_EVERY_MS) {
    return {
      action: 'incremental',
      reason: `Last synced ${describeAge(age)} ago, so only what changed since then is being fetched.`,
    };
  }

  // Nothing is due to come down. Whether anything should go up depends on why
  // this run was asked for: a technician who just queued a note wants it gone,
  // and signal coming back is the moment a basement's worth of notes can go.
  if (input.trigger === 'queued') {
    return {
      action: 'flush-only',
      reason: 'Something is waiting to go to the office and the copy here is current, so only the queue is being sent.',
    };
  }
  if (input.trigger === 'online') {
    return {
      action: 'flush-only',
      reason: 'Back online. The copy here is current, so only the queue is being sent.',
    };
  }
  return { action: 'none', reason: `Synced ${describeAge(age)} ago and nothing is due yet.` };
}

/** The newest completed sync of any resource, as epoch milliseconds. */
function latestSync(states: SyncState[]): number | undefined {
  let newest: number | undefined;
  for (const state of states) {
    const t = state.lastSyncedAt ? Date.parse(state.lastSyncedAt) : NaN;
    if (Number.isFinite(t) && (newest === undefined || t > newest)) newest = t;
  }
  return newest;
}

/**
 * When everything was last read in full, from the runner's note and from the
 * sync state, whichever is newer.
 *
 * The sync state counts as evidence only when every resource that has ever
 * synced reads 'full'. A full pull writes them all that way at once; one
 * resource on its own proves less than it looks, because a server that ignores
 * the change filter marks that resource 'full' on every incremental run, and
 * taking that as a full pull would quietly switch the daily re-read off for
 * everything else.
 */
export function latestFullPull(states: SyncState[], recorded?: string | null): number | undefined {
  let newest: number | undefined;
  const fromRecord = recorded ? Date.parse(recorded) : NaN;
  if (Number.isFinite(fromRecord)) newest = fromRecord;

  const synced = states.filter((s) => s.lastSyncedAt);
  if (synced.length && synced.every((s) => s.mode === 'full')) {
    const evidence = latestSync(synced);
    if (evidence !== undefined && (newest === undefined || evidence > newest)) newest = evidence;
  }
  return newest;
}

/**
 * Whether a network state reads as usable.
 *
 * Reachability is only really known on Android; elsewhere it mirrors
 * isConnected, and a state the module could not determine comes back with the
 * fields missing. Missing is not offline: a sync that never runs is a worse
 * failure than one that fails and says so.
 */
export function networkLooksOnline(state: { isConnected?: boolean; isInternetReachable?: boolean }): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

// ---------------------------------------------------------------------------
// What the last run did, for the line in Settings.
// ---------------------------------------------------------------------------

export interface AutoSyncRecord {
  lastRunAt: string | null;
  lastTrigger: AutoSyncTrigger | null;
  lastAction: AutoSyncAction | null;
  lastError: string | null;
  lastResultSummary: string | null;
  /** When a full pull last finished. Kept here because sync state forgets it; see latestFullPull. */
  lastFullAt: string | null;
}

export const EMPTY_AUTO_SYNC: AutoSyncRecord = {
  lastRunAt: null,
  lastTrigger: null,
  lastAction: null,
  lastError: null,
  lastResultSummary: null,
  lastFullAt: null,
};

/**
 * One line for Settings: what happened last, and when everything is next
 * re-read. Written so it cannot be mistaken for a live view of the office.
 */
export function describeAutoSync(record: AutoSyncRecord, now: Date): string {
  const ran = record.lastRunAt ? Date.parse(record.lastRunAt) : NaN;
  if (!Number.isFinite(ran)) {
    return 'Has not run yet. It runs when the app opens, comes to the front, or gets signal back.';
  }
  const ago = describeAge(Math.max(0, now.getTime() - ran));

  let first: string;
  if (record.lastError) {
    first = `Last ran ${ago} ago and hit a problem: ${sentence(record.lastError)}`;
  } else {
    switch (record.lastAction) {
      case 'full':
        first = `Last ran ${ago} ago (full pull).`;
        break;
      case 'incremental':
        first = `Last ran ${ago} ago (incremental).`;
        break;
      case 'flush-only':
        first = `Last ran ${ago} ago (sent the queue).`;
        break;
      default:
        first = `Last checked ${ago} ago. ${sentence(record.lastResultSummary ?? 'Nothing was due.')}`;
    }
  }
  return `${first} ${describeNextFull(record.lastFullAt, now)}`;
}

/**
 * When everything is next re-read, in words a person would use.
 *
 * "Tonight" and "tomorrow" are Queensland's, not UTC's: the company runs on
 * Brisbane time and a phone that said "tomorrow" at nine in the evening
 * because it was still today in Greenwich would be answering a different
 * question. Queensland has no daylight saving, so this is arithmetic.
 */
function describeNextFull(lastFullAt: string | null, now: Date): string {
  const last = lastFullAt ? Date.parse(lastFullAt) : NaN;
  if (!Number.isFinite(last)) return 'A full pull is due.';
  const due = last + FULL_EVERY_MS;
  const wait = due - now.getTime();
  if (wait <= 0) return 'A full pull is due now.';
  if (wait < HOUR_MS) return 'Next full pull within the hour.';

  const today = qldDayIndex(now.getTime());
  const dueDay = qldDayIndex(due);
  if (dueDay === today) return qldHour(due) >= 18 ? 'Next full pull tonight.' : 'Next full pull later today.';
  if (dueDay === today + 1) return 'Next full pull tomorrow.';
  return `Next full pull in ${describeAge(wait)}.`;
}

function qldDayIndex(ms: number): number {
  return Math.floor((ms + QLD_UTC_OFFSET_HOURS * HOUR_MS) / DAY_MS);
}

function qldHour(ms: number): number {
  return Math.floor(((ms + QLD_UTC_OFFSET_HOURS * HOUR_MS) % DAY_MS) / HOUR_MS);
}

/** "12 min", "1 hour", "3 days" — coarse on purpose, this is a status line not a log. */
export function describeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Ends with a full stop, so two sentences joined on the screen read as two. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// ---------------------------------------------------------------------------
// Summarising a run, structurally typed so this file needs nothing from the
// modules that touch the database.
// ---------------------------------------------------------------------------

export interface PullCounts {
  sitesAdded: number;
  sitesUpdated: number;
  jobsAdded: number;
  jobsUpdated: number;
  assetsAdded: number;
  assetsUpdated: number;
  errors: string[];
}

export interface FlushCounts {
  sent: number;
  failed: number;
  remaining: number;
  /** Why the send stopped before the queue was through, where it did. */
  stopped?: { reason: string };
}

/**
 * What a run did, in one line. Counts rather than adjectives, and the problems
 * counted rather than hidden: "fetched everything" with three errors is not
 * the same as fetched everything.
 */
export function summariseRun(
  action: Exclude<AutoSyncAction, 'none'>,
  pull: PullCounts | null,
  flush: FlushCounts | null,
): string {
  const parts: string[] = [];
  if (pull) {
    const sites = pull.sitesAdded + pull.sitesUpdated;
    const jobs = pull.jobsAdded + pull.jobsUpdated;
    const assets = pull.assetsAdded + pull.assetsUpdated;
    parts.push(
      `${action === 'full' ? 'Fetched everything' : 'Fetched changes'}: `
      + `${sites} ${sites === 1 ? 'site' : 'sites'}, ${jobs} ${jobs === 1 ? 'job' : 'jobs'} and `
      + `${assets} ${assets === 1 ? 'asset' : 'assets'} changed here.`,
    );
    if (pull.errors.length) {
      parts.push(`${pull.errors.length} ${pull.errors.length === 1 ? 'problem' : 'problems'} on the way.`);
    }
  }
  if (flush) {
    if (flush.sent) parts.push(`Sent ${flush.sent} to the office.`);
    // Some of these the queue will try again; some it has given up on. The
    // outbound screen tells them apart, so that is where the line points.
    if (flush.failed) parts.push(`${flush.failed} could not be sent; see Send to the office.`);
    if (!flush.sent && !flush.failed) {
      parts.push(flush.remaining ? `${flush.remaining} still waiting to send.` : 'Nothing was waiting to send.');
    }
    if (flush.stopped) parts.push(`Sending stopped: ${flush.stopped.reason}`);
  }
  return parts.join(' ');
}
