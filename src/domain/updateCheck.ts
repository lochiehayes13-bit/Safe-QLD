import { QLD_UTC_OFFSET_HOURS } from '@/domain/qldTime';

/**
 * Whether the build on this phone is the one the office last published.
 *
 * The app is sideloaded. CI builds an APK on every push and puts it on one
 * rolling GitHub release, and that is the whole distribution channel: nothing
 * on a handset knows a newer build exists, so a technician runs whatever was
 * installed the day the phone was set up until somebody thinks to ask. The
 * check reads that release and says, in a sentence, whether there is anything
 * newer to fetch.
 *
 * Everything that decides is here, free of the network, storage and React, so
 * each rule is tested on its own. The fetching and remembering is in
 * ../update/check.ts.
 *
 * The one rule that matters most: "newer" is never guessed. A banner that says
 * a newer build exists when it does not sends somebody through a seventy
 * megabyte download and a reinstall for nothing, and the second time it does
 * that the banner is ignored for good. Anything the release does not say
 * plainly comes back as unknown.
 */

/** The rolling release CI publishes to, and the file it attaches. */
export const RELEASE_TAG = 'android-latest';
export const APK_ASSET = 'safe-qld.apk';

/** How long a verdict is trusted before the release is read again. */
export const CHECK_EVERY_MS = 6 * 3_600_000;

/** How long "Not now" keeps the banner away. */
export const SNOOZE_MS = 24 * 3_600_000;

/**
 * How much later the release has to be than this build before it counts.
 *
 * Two builds landing within a couple of minutes of each other are the same
 * push seen twice — a cancelled run and its replacement, or a pull request
 * build and the merge — and the phone should not flap between them.
 */
export const NEWER_BY_AT_LEAST_MS = 2 * 60_000;

export const PRIVATE_REPO_REASON =
  'This repository is private, so the phone cannot see its releases without a token.';

/** What this phone is running, as CI stamped it. Both null in a development build. */
export interface RunningBuild {
  sha: string | null;
  builtAt: string | null;
}

/** What the release says about itself. Null wherever it did not say. */
export interface ReleaseInfo {
  sha: string | null;
  publishedAt: string | null;
  apkUrl: string | null;
  sizeBytes: number | null;
}

export type UpdateVerdict = 'current' | 'newer' | 'unknown';

export interface UpdateComparison {
  verdict: UpdateVerdict;
  /** A sentence for Settings, never a code. */
  reason: string;
}

export interface UpdateResult extends UpdateComparison {
  release: ReleaseInfo | null;
}

/** What the runner remembers between launches. */
export interface UpdateCheckRecord {
  /** When GitHub last answered, whatever it answered. Null until it has. */
  checkedAt: string | null;
  result: UpdateResult | null;
  /** Why the last attempt got no answer, or null when it did. */
  lastError: string | null;
  snoozedUntil: string | null;
  /** The build the snooze was for, so a newer one is not hidden by yesterday's "Not now". */
  snoozedSha: string | null;
  /**
   * The build that was running when this answer was worked out.
   *
   * This is the field the banner would not go away without. Installing the
   * new APK over the old one keeps the app's storage — that is the point of
   * installing over rather than reinstalling — so the phone came up holding
   * "a newer build is available", worked out an hour ago about the build it
   * had just replaced. The verdict was six hours from expiring and the banner
   * sat there for all six, on a phone already running the build it was
   * pointing at.
   *
   * A verdict is about a pair: this build and that release. Change either half
   * and it is no longer an answer, it is a leftover. Null on a record written
   * by a build before this field existed, which is treated the same way — as
   * something to check again rather than something to show.
   */
  forBuildSha: string | null;
}

export const EMPTY_UPDATE_CHECK: UpdateCheckRecord = {
  checkedAt: null,
  result: null,
  lastError: null,
  snoozedUntil: null,
  snoozedSha: null,
  forBuildSha: null,
};

const HOUR_MS = 3_600_000;
const INSTANT = /^\d{4}-\d{2}-\d{2}T/;

/** The line CI writes into the release notes on every run. */
const SHA_LINE = /Built from `([0-9a-fA-F]{7,40})`/;

/** An ISO instant as milliseconds, or nothing for anything else. See qldTime for why nothing else. */
function readInstant(iso: string | null | undefined): number | undefined {
  if (!iso || !INSTANT.test(iso)) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The release as GitHub's API describes it, reduced to the four facts needed.
 *
 * Tolerant of any shape: the API's JSON is read straight off the wire and
 * nothing about it is checked before this. A field that is not there is null,
 * never a throw, because the caller is a check that must never take a screen
 * down.
 *
 * The commit is read from the notes rather than from the tag, because the tag
 * is rolling and always points at whatever was pushed last; the notes line is
 * rewritten by CI on every run and is the only record of which build the
 * download actually serves.
 */
export function parseRelease(json: unknown): ReleaseInfo {
  const none: ReleaseInfo = { sha: null, publishedAt: null, apkUrl: null, sizeBytes: null };
  if (!json || typeof json !== 'object') return none;
  const release = json as { body?: unknown; assets?: unknown };

  const body = typeof release.body === 'string' ? release.body : '';
  const sha = body.match(SHA_LINE)?.[1]?.toLowerCase() ?? null;

  const assets = Array.isArray(release.assets) ? (release.assets as unknown[]) : [];
  const apk = assets.find(
    (a) => !!a && typeof a === 'object' && (a as { name?: unknown }).name === APK_ASSET,
  ) as { browser_download_url?: unknown; updated_at?: unknown; size?: unknown } | undefined;
  if (!apk) return { ...none, sha };

  return {
    sha,
    apkUrl: typeof apk.browser_download_url === 'string' ? apk.browser_download_url : null,
    // The asset's own time rather than the release's: the release was created
    // once and updated in place ever since, so its published_at is the first
    // build for good. The file is replaced on every run.
    publishedAt: typeof apk.updated_at === 'string' ? apk.updated_at : null,
    sizeBytes: typeof apk.size === 'number' && Number.isFinite(apk.size) ? apk.size : null,
  };
}

/**
 * Two commit hashes name the same commit.
 *
 * CI stamps the full forty characters into both the build and the notes, but
 * a hand-edited note or an older build may carry the short form, and seven
 * characters is what git itself treats as enough.
 */
function sameSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  const n = Math.min(x.length, y.length);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

/**
 * Whether the release is worth downloading over what this phone has.
 *
 * The order is the order a technician would want it explained: first the
 * reasons nothing can be said, then the one case that settles it outright,
 * then the comparison — and the comparison only says "newer" when both sides
 * carry a time and the release is clearly ahead.
 */
export function compareBuild(running: RunningBuild, release: ReleaseInfo): UpdateComparison {
  if (!running.sha) {
    return {
      verdict: 'unknown',
      reason: 'This is a development build, so there is no published build to compare it with.',
    };
  }
  if (!release.sha) {
    return {
      verdict: 'unknown',
      reason: 'The release notes do not say which commit was built, so nothing can be compared.',
    };
  }
  if (!release.apkUrl) {
    return { verdict: 'unknown', reason: `The release has no ${APK_ASSET} attached to download.` };
  }
  if (sameSha(running.sha, release.sha)) {
    return { verdict: 'current', reason: 'This phone is running the build the office last published.' };
  }

  const built = readInstant(running.builtAt);
  const published = readInstant(release.publishedAt);
  if (built === undefined || published === undefined) {
    // A different commit is not the same as a newer one. Without both times
    // the honest answer is that nobody can say, and saying "newer" here is a
    // download and a reinstall on a guess.
    return {
      verdict: 'unknown',
      reason: 'The published build is a different commit, but without both build times it cannot be said which is newer.',
    };
  }
  if (published - built > NEWER_BY_AT_LEAST_MS) {
    return {
      verdict: 'newer',
      reason: `A build from ${formatBuildMoment(release.publishedAt)} is available; this phone is running one from ${formatBuildMoment(running.builtAt)}.`,
    };
  }
  return {
    verdict: 'current',
    reason: 'The published build is a different commit but no newer than the one on this phone.',
  };
}

/**
 * Abbreviated the Australian way, with the four-letter forms for the months
 * that have them: a date in this app is read in Brisbane.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/**
 * An instant as the Queensland date and time, "2 Sept 2026 15:41".
 *
 * Queensland time rather than UTC for the same reason as every other date
 * here: CI stamps the build in UTC, and the person reading Settings at seven
 * in the morning would otherwise see yesterday's date on a build made an hour
 * ago. Null for anything that is not an instant.
 */
export function formatBuildMoment(iso: string | null | undefined): string | null {
  const ms = readInstant(iso);
  if (ms === undefined) return null;
  const d = new Date(ms + QLD_UTC_OFFSET_HOURS * HOUR_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()} ${hh}:${mm}`;
}

/** The seven characters git itself shows. */
export function shortSha(sha: string): string {
  return sha.trim().slice(0, 7);
}

/** The line in Settings that says what this phone is running. */
export function describeBuild(running: RunningBuild): string {
  if (!running.sha) return 'Development build';
  const when = formatBuildMoment(running.builtAt);
  return when ? `Build ${shortSha(running.sha)}, ${when}` : `Build ${shortSha(running.sha)}`;
}

/**
 * Whether the release should be read again.
 *
 * Once a verdict is in hand it is good for six hours: builds land a few times
 * a day at most, and a request on every launch is a request from every phone
 * in the fleet every time somebody opens the app to look at a job. A forced
 * check — the button in Settings — always goes. So does a phone that has
 * never had an answer, including one whose last attempt failed, because a
 * failure sets no checkedAt and an offline phone should try again as soon as
 * it is opened with signal.
 */
export function shouldCheck(
  record: UpdateCheckRecord,
  now: Date,
  force: boolean,
  running: RunningBuild,
): boolean {
  if (force) return true;
  // An answer about a build this phone is no longer running answers nothing.
  // Checked before the age, because the whole point is that it is fresh: the
  // record written an hour before the update is five hours from expiring.
  if (!answersFor(record, running)) return true;
  const checked = readInstant(record.checkedAt);
  if (checked === undefined) return true;
  const age = now.getTime() - checked;
  // A check in the future is a clock that has been put back; waiting for it
  // to catch up could be days.
  return age < 0 || age >= CHECK_EVERY_MS;
}

/**
 * Whether the held answer is about the build that is actually running.
 *
 * A development build has no commit of its own, so nothing can be said to be
 * about it and the answer is always no.
 */
export function answersFor(record: UpdateCheckRecord, running: RunningBuild): boolean {
  if (!record.forBuildSha || !running.sha) return false;
  return sameSha(record.forBuildSha, running.sha);
}

/**
 * The release worth offering right now, or null.
 *
 * Only a verdict of newer with a file to download, and not while "Not now"
 * is in force for that same build. A snooze is tied to the build it was
 * pressed on: a newer one landing the next morning is news, not the thing
 * that was dismissed last night.
 */
export function offeredRelease(
  record: UpdateCheckRecord,
  now: Date,
  running: RunningBuild,
): ReleaseInfo | null {
  const result = record.result;
  if (!result || result.verdict !== 'newer' || !result.release?.apkUrl) return null;

  /*
   * Two ways a held "newer" can be about the past, and the banner showed
   * through both of them.
   *
   * The first is the answer being about another build: worked out before the
   * update, restored after it, still hours from expiring. The second is the
   * offer being this very build — the same commit, arrived at from the other
   * direction — which is what a stale answer naming the release you just
   * installed amounts to. Either one and there is nothing to offer, and this
   * is decided here rather than waiting on a request, so the banner is gone
   * the first time the new build draws the home screen rather than six hours
   * later.
   */
  if (!answersFor(record, running)) return null;
  if (running.sha && result.release.sha && sameSha(running.sha, result.release.sha)) return null;

  const until = readInstant(record.snoozedUntil);
  const snoozed = until !== undefined && now.getTime() < until
    && record.snoozedSha !== null && result.release.sha !== null
    && sameSha(record.snoozedSha, result.release.sha);
  return snoozed ? null : result.release;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function describeAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The line in Settings under the build.
 *
 * A failed attempt is reported alongside the last real answer rather than
 * instead of it: a phone that saw a newer build this morning and has no
 * signal this afternoon still has a newer build waiting, and the line should
 * keep saying so.
 */
export function describeUpdateCheck(record: UpdateCheckRecord, now: Date, running: RunningBuild): string {
  // An answer about the build before this one is not reported as this build's,
  // because the line under the build number is where somebody goes to find
  // out whether the update they just installed took.
  if (record.result && !answersFor(record, running)) {
    return 'This build has not been checked yet — the last answer was about the one before it.';
  }
  const checked = readInstant(record.checkedAt);
  const answered = record.result && checked !== undefined
    ? `Checked ${describeAge(now.getTime() - checked)} — ${record.result.reason}`
    : null;
  if (record.lastError) {
    return answered
      ? `Could not check again: ${record.lastError} ${answered}`
      : `Could not check: ${record.lastError}`;
  }
  return answered ?? 'Not checked yet.';
}
