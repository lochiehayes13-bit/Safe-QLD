
/**
 * Asking an office system for only what changed.
 *
 * A full pull of every site and every asset takes long enough that it stops
 * being done, which is how a local copy quietly becomes weeks old. The fix is
 * to ask only for records modified since the last successful sync.
 *
 * The awkward part is that a REST API which does not understand a filter does
 * not usually say so — it ignores the parameter and returns everything, which
 * is indistinguishable from an incremental sync that found a lot of changes.
 * So the filter is applied and then *checked*: if a request that should have
 * returned a slice returns the whole set, this reports the sync as full rather
 * than recording a watermark it has no right to.
 */

/** How far back to overlap, so a record written during the last sync is not missed. */
const OVERLAP_MINUTES = 10;

export interface IncrementalPlan {
  /** Query parameters to add, empty when a full pull is wanted. */
  query: Record<string, string>;
  /** What was asked for, for the record. */
  mode: 'incremental' | 'full';
  since?: string;
}

/**
 * Builds the filter for a resource.
 *
 * The overlap matters more than it looks: records written while the previous
 * sync was running carry a timestamp inside that window, and a filter anchored
 * exactly at the last sync time skips them permanently. Ten minutes of
 * re-reading is cheap; a job that never arrives is not.
 */
export function planIncremental(
  resource: SyncResource,
  lastChangeSeenAt: string | undefined,
  options: { force?: boolean; dateColumn?: string } = {},
): IncrementalPlan {
  if (options.force || !lastChangeSeenAt) return { query: {}, mode: 'full' };

  const anchor = Date.parse(lastChangeSeenAt);
  if (!Number.isFinite(anchor)) return { query: {}, mode: 'full' };

  const since = new Date(anchor - OVERLAP_MINUTES * 60_000).toISOString().slice(0, 10);
  const column = options.dateColumn ?? 'DateModified';
  return { query: { [column]: `gt(${since})` }, mode: 'incremental', since };
}

export interface IncrementalOutcome<T> {
  records: T[];
  /** What actually happened, which is not always what was asked for. */
  mode: 'incremental' | 'full';
  /** Set when the filter was asked for and did not take effect. */
  filterIgnored: boolean;
  note?: string;
}

/**
 * Decides whether a filtered response really was filtered.
 *
 * The signal is the count: if the previous full sync saw N records and a
 * filtered request returns N or more, the filter did nothing. That is a
 * heuristic and is treated as one — the consequence of being wrong is only
 * that the next sync is a full one, which is safe in a way the opposite is not.
 */
export function assessIncremental<T>(
  records: T[],
  plan: IncrementalPlan,
  previousCount: number,
): IncrementalOutcome<T> {
  if (plan.mode === 'full') return { records, mode: 'full', filterIgnored: false };

  const looksUnfiltered = previousCount > 0 && records.length >= previousCount;
  if (looksUnfiltered) {
    return {
      records,
      mode: 'full',
      filterIgnored: true,
      note:
        `Asked for records changed since ${plan.since} and got ${records.length}, which is everything — ` +
        `this endpoint does not support the filter, so it will keep pulling in full.`,
    };
  }
  return { records, mode: 'incremental', filterIgnored: false };
}

/**
 * The newest modification timestamp in a batch, which anchors the next sync.
 *
 * Taken from the records rather than the clock. Using the local clock assumes
 * it agrees with the server's, and when it runs fast every record written in
 * the gap is skipped — silently, and permanently.
 */
export function newestChange(
  records: Array<Record<string, unknown>>,
  fields = ['DateModified', 'ModifiedDate', 'DateIssued', 'dateModified'],
): string | undefined {
  let newest = 0;
  let iso: string | undefined;
  for (const record of records) {
    for (const field of fields) {
      const raw = record[field];
      if (typeof raw !== 'string') continue;
      const t = Date.parse(raw);
      if (Number.isFinite(t) && t > newest) {
        newest = t;
        iso = new Date(t).toISOString();
      }
    }
  }
  return iso;
}

// ---------------------------------------------------------------------------
// Sync state, and how old a local copy is.
//
// Kept here with the planning logic and free of the database layer, so both can
// be tested: the staleness wording is the only thing standing between a
// technician and a three-week-old due list that looks current.
// ---------------------------------------------------------------------------

/**
 * Rates are in this list but never come down incrementally: the setup endpoints
 * carry no modification date, so the card is always read whole. It is recorded
 * here anyway so "how current is this device" covers the figures a quote is
 * built from, which are the ones it is most costly to have stale.
 */
export type SyncResource = 'sites' | 'jobs' | 'assets' | 'employees' | 'schedules' | 'rates';

export interface SyncState {
  resource: SyncResource;
  /** When a sync of this resource last completed without error. */
  lastSyncedAt?: string;
  /** Newest change seen, which is where the next incremental sync starts. */
  lastChangeSeenAt?: string;
  lastRecordCount: number;
  /**
   * Whether the last sync actually managed to be incremental.
   *
   * Recorded rather than assumed: a server that ignores an unsupported filter
   * returns everything and looks exactly like a successful incremental sync.
   */
  mode: 'incremental' | 'full';
  lastError?: string;
  updatedAt?: string;
}

export type Freshness = 'never' | 'fresh' | 'ageing' | 'stale';

export interface Staleness {
  state: Freshness;
  ageHours?: number;
  /** A sentence for the screen, written so it cannot be misread as live. */
  label: string;
}

/** Thresholds chosen for a book of work that turns over daily. */
const FRESH_HOURS = 12;
const AGEING_HOURS = 72;

/**
 * Describes how old a local copy is.
 *
 * Deliberately blunt at the top end. "Synced 3 weeks ago" invites a technician
 * to read a due list as current when the office has moved on, so past a few
 * days it says so in words rather than leaving a date to be interpreted.
 */
export function describeStaleness(state: SyncState, now: Date): Staleness {
  if (!state.lastSyncedAt) {
    return { state: 'never', label: 'Never synced — this is local data only.' };
  }
  const ageHours = (now.getTime() - Date.parse(state.lastSyncedAt)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return { state: 'never', label: 'Last sync time is unreadable.' };
  }

  const rounded = Math.floor(ageHours);
  if (ageHours < 1) return { state: 'fresh', ageHours: rounded, label: 'Synced in the last hour.' };
  if (ageHours < FRESH_HOURS) {
    return { state: 'fresh', ageHours: rounded, label: `Synced ${rounded} ${rounded === 1 ? 'hour' : 'hours'} ago.` };
  }
  const days = Math.floor(ageHours / 24);
  if (ageHours < AGEING_HOURS) {
    return {
      state: 'ageing', ageHours: rounded,
      label: days >= 1 ? `Synced ${days} ${days === 1 ? 'day' : 'days'} ago.` : `Synced ${rounded} hours ago.`,
    };
  }
  return {
    state: 'stale', ageHours: rounded,
    label: `Last synced ${days} days ago — the office copy has almost certainly moved on.`,
  };
}

/**
 * Where the next sync starts, and what it counts against.
 *
 * The rule this expresses decides whether records get silently skipped, and it
 * was written inline in sync.ts — which imports the database and so cannot be
 * loaded by a test at all. Twice, once for sites and once for jobs. It is one
 * function here because the two must not drift, and because a rule about data
 * loss should be somewhere it can be argued with.
 *
 * Three cases, three different right answers:
 *
 * **The records carry a newest change.** Use it. This is the ordinary path and
 * the whole reason the watermark is taken from the server's own timestamps
 * rather than from the phone: a handset running five minutes fast would ask
 * next time for changes since a moment in the future, and everything written in
 * that gap is skipped permanently.
 *
 * **A full pull whose records carry no timestamp at all.** Fall back to when
 * this sync started. The clock is a poor anchor for the reason above, but a
 * full pull has just seen everything, so starting the next window at that
 * moment loses nothing that existed — and the alternative, leaving the
 * watermark empty, means pulling everything again forever.
 *
 * **An incremental pull that returned nothing.** Keep the previous watermark
 * exactly. This is the case that has to be got right: advancing it to now, on a
 * pull that learned nothing, moves the window past records nobody has looked
 * at. Nothing would ever report it — the next sync simply asks for a later
 * slice and the skipped records are never mentioned again.
 *
 * The record count follows the same shape, because a count from an incremental
 * pull is a count of what changed rather than of what exists, and
 * assessIncremental compares against it to decide whether a filter was honoured.
 * Overwriting the full-sync count with an incremental one would make the next
 * filtered response look plausible however much it returned.
 */
export function nextWatermark(
  records: Array<Record<string, unknown>>,
  mode: 'full' | 'incremental',
  startedAt: string,
  previous: Pick<SyncState, 'lastChangeSeenAt' | 'lastRecordCount'>,
): Pick<SyncState, 'lastChangeSeenAt' | 'lastRecordCount'> {
  return {
    lastChangeSeenAt:
      newestChange(records) ?? (mode === 'full' ? startedAt : previous.lastChangeSeenAt),
    lastRecordCount: mode === 'full' ? records.length : previous.lastRecordCount,
  };
}
