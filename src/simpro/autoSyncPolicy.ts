import { INCREMENTAL_RESOURCES, type SyncResource, type SyncState } from './incremental';

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
 * How stale any one resource is allowed to get before it is re-read in full.
 *
 * An incremental pull is only as good as its watermark, and a watermark can be
 * wrong in ways nobody sees — a record edited without its modified date moving,
 * a filter the server quietly ignored. A daily full read puts a ceiling on how
 * long any of that can leave a phone confidently stale.
 *
 * What changed is *when* that read is paid for. It used to be one six-minute
 * pull of all eighteen resources, and the trigger that collected the bill was
 * almost always `launch`: the phone sleeps overnight, the day rolls over, and
 * the next thing to ask the policy anything is somebody opening the app. So
 * the ceiling that exists to keep the phone honest was being charged to the
 * one moment a technician is waiting on it — which is the whole of "it does a
 * full sync when I open it". The ceiling is unchanged and the six minutes are
 * still spent; they are just spent two resources at a time while nobody is
 * waiting. See `resourcesDueSweep`.
 */
export const FULL_EVERY_MS = 24 * 3_600_000;

/**
 * How many resources one sweep slice re-reads in full.
 *
 * Two. Small enough that the heaviest pair on this build — sites at about
 * three thousand rows and assets at twelve and a half — is a slice and not an
 * afternoon, and large enough that all eighteen come round inside a couple of
 * hours of an app being open.
 */
export const SWEEP_CHUNK = 2;

/**
 * The shortest gap between slices.
 *
 * The open app's tick is every five minutes, which would be six slices in half
 * an hour and a warm phone. A quarter hour still turns the whole list over in
 * about four and a half hours of being open, against a ceiling of twenty-four.
 */
export const SWEEP_EVERY_MS = 15 * 60_000;

/**
 * The triggers a sweep slice is allowed to run on, and the reason this module
 * exists in the shape it does.
 *
 * `background` is the operating system waking the app with nobody looking at
 * it, and `timer` is the app sitting open in a ute with nobody touching it.
 * Both are time this phone was going to spend anyway.
 *
 * Every other trigger is somebody waiting. `launch` and `foreground` are a
 * person who has just opened the app to do something; `signin` is a person
 * watching for their own jobs to appear; `queued` and `online` are a note
 * trying to get to the office. Spending a full re-read on any of those is
 * spending it out of somebody's day, and that is exactly what was reported.
 */
export const SWEEP_TRIGGERS: readonly AutoSyncTrigger[] = ['background', 'timer'];

/**
 * Every resource the sweep rotates through: the ones read against a watermark,
 * and so the only ones a full re-read changes anything for. See
 * INCREMENTAL_RESOURCES for what is left out and why.
 */
export const SWEEP_RESOURCES: readonly SyncResource[] = INCREMENTAL_RESOURCES;

/**
 * How often the open app asks itself whether anything is due.
 *
 * The other moments — opening, coming to the front, signal returning — are
 * events, and a phone left open on a job all morning has none of them. The
 * tick is cheap: the policy answers "nothing due" in a millisecond, and only
 * every half hour does it turn into a read.
 */
export const TIMER_EVERY_MS = 5 * 60_000;


/**
 * What asked for the run. `signin` is somebody who has just signed in and
 * wants their own jobs on the phone; `timer` is the open app's own tick.
 */
export type AutoSyncTrigger = 'launch' | 'foreground' | 'online' | 'background' | 'queued' | 'signin' | 'timer';
export type AutoSyncAction = 'full' | 'sweep' | 'incremental' | 'flush-only' | 'none';

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
  /**
   * When each resource was last read in full, by the sweep or by a full pull.
   *
   * Kept by the runner rather than in `syncState`, for the same reason
   * `lastFullAt` is: a resource's mode flips to 'incremental' on its next
   * partial read and the time of the full read before it is gone.
   */
  sweptAt?: Readonly<Record<string, string>>;
  /** When the last sweep slice ran, so slices are spaced by SWEEP_EVERY_MS. */
  lastSweepAt?: string | null;
}

export interface AutoSyncDecision {
  action: AutoSyncAction;
  /** A sentence for Settings, never a code. */
  reason: string;
  /** On 'sweep', the resources this slice re-reads in full. Absent otherwise. */
  sweep?: readonly SyncResource[];
}

/**
 * The resources due a full re-read, oldest first, capped at one slice.
 *
 * Oldest first is what makes the rotation fair without storing a cursor: the
 * resource that has gone longest without a full read is always the next one,
 * so a slice that is interrupted — the operating system taking its thirty
 * seconds back, a van driving out of signal — simply comes up again rather
 * than being skipped to the end of a queue.
 *
 * A stamp in the future counts as due. A phone whose clock has been put back
 * would otherwise have every resource look freshly read and the sweep would
 * stall silently for as long as the clock was wrong.
 */
export function resourcesDueSweep(
  sweptAt: Readonly<Record<string, string>> | undefined,
  now: Date,
  chunk: number = SWEEP_CHUNK,
): readonly SyncResource[] {
  const at = now.getTime();
  const due: { resource: SyncResource; when: number }[] = [];
  for (const resource of SWEEP_RESOURCES) {
    const raw = sweptAt?.[resource];
    const when = raw ? Date.parse(raw) : NaN;
    // Never swept sorts first: it is the least known and the most overdue.
    if (!Number.isFinite(when)) { due.push({ resource, when: -Infinity }); continue; }
    if (when > at || at - when >= FULL_EVERY_MS) due.push({ resource, when });
  }
  due.sort((a, b) => a.when - b.when);
  return due.slice(0, Math.max(0, chunk)).map((d) => d.resource);
}

/** How many resources are waiting on a full re-read, for the line in Settings. */
export function sweepBehind(sweptAt: Readonly<Record<string, string>> | undefined, now: Date): number {
  return resourcesDueSweep(sweptAt, now, SWEEP_RESOURCES.length).length;
}

/** Whether this trigger is one the sweep may spend time on. See SWEEP_TRIGGERS. */
export function triggerMaySweep(trigger: AutoSyncTrigger): boolean {
  return SWEEP_TRIGGERS.includes(trigger);
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

  const age = now - lastAny;
  if (input.trigger === 'signin') {
    // Their day and their jobs are what a person signing in is waiting for,
    // and the last sync may have been somebody else's. Changes only: the full
    // read ran on this phone already, or the rules above would have asked
    // for it.
    return {
      action: 'incremental',
      reason: 'Somebody just signed in, so what changed since the last sync is being fetched for them.',
    };
  }
  if (age >= INCREMENTAL_EVERY_MS) {
    return {
      action: 'incremental',
      reason: `Last synced ${describeAge(age)} ago, so only what changed since then is being fetched.`,
    };
  }

  /*
   * Nothing shallow is due. This is the gap the rolling re-read lives in, and
   * only on a trigger nobody is waiting on — see SWEEP_TRIGGERS for why that
   * restriction is the point of the whole mechanism rather than a tuning knob.
   */
  const due = resourcesDueSweep(input.sweptAt, input.now);
  if (due.length && triggerMaySweep(input.trigger)) {
    const sinceSweep = input.lastSweepAt ? Date.parse(input.lastSweepAt) : NaN;
    const spaced = !Number.isFinite(sinceSweep)
      || sinceSweep > now
      || now - sinceSweep >= SWEEP_EVERY_MS;
    if (spaced) {
      return {
        action: 'sweep',
        sweep: due,
        reason: `Re-reading ${listOf(due)} in full in the background, a couple at a time, `
          + 'so nothing has to wait for it.',
      };
    }
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
  if (due.length) {
    return {
      action: 'none',
      reason: `Synced ${describeAge(age)} ago. ${due.length === 1 ? 'One resource is' : `${sweepBehind(input.sweptAt, input.now)} resources are`} `
        + 'waiting on a full re-read, which happens in the background rather than while you wait.',
    };
  }
  return { action: 'none', reason: `Synced ${describeAge(age)} ago and nothing is due yet.` };
}

/** "sites and jobs", "sites, jobs and assets" — for a sentence, not a log. */
function listOf(resources: readonly SyncResource[]): string {
  if (resources.length <= 1) return resources[0] ?? 'nothing';
  return `${resources.slice(0, -1).join(', ')} and ${resources[resources.length - 1]}`;
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
  /** Per resource, when it was last read in full. See resourcesDueSweep. */
  sweptAt: Record<string, string>;
  /** When the last sweep slice ran, so slices stay SWEEP_EVERY_MS apart. */
  lastSweepAt: string | null;
}

export const EMPTY_AUTO_SYNC: AutoSyncRecord = {
  lastRunAt: null,
  lastTrigger: null,
  lastAction: null,
  lastError: null,
  lastResultSummary: null,
  lastFullAt: null,
  sweptAt: {},
  lastSweepAt: null,
};

/** Every resource stamped as read in full at `at`. What a real full pull earns. */
export function sweptEverything(at: string): Record<string, string> {
  return Object.fromEntries(SWEEP_RESOURCES.map((r) => [r, at]));
}

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
      case 'sweep':
        first = `Last ran ${ago} ago (re-read part of the office in the background).`;
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
  return `${first} ${describeSweep(record.sweptAt, now)}`;
}

/**
 * How the rolling re-read is going, in words a person would use.
 *
 * This used to be a countdown to the next full pull, which was honest about
 * the old design and would be a lie about this one: there is no longer a
 * moment when the app stops and reads the company. There is a list that comes
 * round, and the only thing worth saying is whether it is keeping up and that
 * it is not being paid for out of anybody's day.
 *
 * That also took the last naming of a Queensland day out of this module, so
 * the offset arithmetic that supported it went with it rather than being kept
 * against a use that may never come.
 */
function describeSweep(sweptAt: Record<string, string> | undefined, now: Date): string {
  const behind = sweepBehind(sweptAt, now);
  const total = SWEEP_RESOURCES.length;
  if (behind === 0) return 'Everything here was re-read from the office within the last day.';
  if (behind >= total) return 'A full re-read is under way in the background, a couple at a time.';
  return `${behind} of ${total} are waiting on their re-read, which happens in the background.`;
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
    const what = action === 'full' ? 'Fetched everything'
      : action === 'sweep' ? 'Re-read part of the office'
        : 'Fetched changes';
    parts.push(
      `${what}: `
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
