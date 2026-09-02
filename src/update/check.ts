import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  compareBuild, parseRelease, shouldCheck,
  EMPTY_UPDATE_CHECK, PRIVATE_REPO_REASON, RELEASE_TAG, SNOOZE_MS,
  type UpdateCheckRecord, type UpdateResult,
} from '@/domain/updateCheck';
import { buildInfo } from './buildInfo';

/**
 * Asking GitHub whether there is a newer build.
 *
 * This is the part that touches things: the keystore, storage and the
 * network. Whether anything is newer is decided in @/domain/updateCheck,
 * which touches nothing and is tested.
 *
 * Nothing here throws to its caller. It runs from a banner on the home
 * screen and a button in Settings, and a check that fails must fail into the
 * line under the build number, not into a red screen.
 */

const STORAGE_KEY = 'safeqld.update';

/**
 * An optional GitHub token, in the platform keystore and nowhere else.
 *
 * Only needed while the releases sit on the private repository. A
 * fine-grained token with read-only access to that one repository is enough,
 * and it is still a credential on a technician's phone, so it goes where the
 * Simpro secret and the Anthropic key go rather than into preferences.
 */
const TOKEN_SLOT = 'safeqld.github.token';

/** GitHub is quick; a request still waiting after this is a phone with no signal. */
const TIMEOUT_MS = 15_000;

export interface UpdateSnapshot {
  record: UpdateCheckRecord;
  /** True while a check is on the wire. */
  inFlight: boolean;
}

let record: UpdateCheckRecord = EMPTY_UPDATE_CHECK;
let snapshot: UpdateSnapshot = { record, inFlight: false };
let restoring: Promise<void> | null = null;
/** The check under way, so a second caller joins it rather than starting another. */
let running: Promise<UpdateCheckRecord> | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = { record, inFlight: running !== null };
  for (const listener of listeners) listener();
}

/** Reads the last answer back from storage, once. */
function restore(): Promise<void> {
  if (!restoring) {
    restoring = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        record = { ...EMPTY_UPDATE_CHECK, ...(JSON.parse(raw) as Partial<UpdateCheckRecord>) };
        publish();
      })
      .catch(() => {
        // A corrupt note is not worth a word; the next check writes a fresh one.
      });
  }
  return restoring;
}

async function remember(patch: Partial<UpdateCheckRecord>): Promise<void> {
  record = { ...record, ...patch };
  publish();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // The in-memory copy still drives the screen. A lost write only costs a
    // repeat of the check after a restart.
  }
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_SLOT, token.trim());
}

export async function hasToken(): Promise<boolean> {
  return (await SecureStore.getItemAsync(TOKEN_SLOT)) !== null;
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_SLOT);
}

async function readToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_SLOT);
  } catch {
    // A keystore that cannot be read is a check without a token, not no check.
    return null;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function fetchRelease(repo: string, token: string | null): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${RELEASE_TAG}`,
      { headers, signal: controller.signal },
    );
    // A body that is not JSON is read as a release that says nothing, which
    // the comparison reports as unknown rather than as a fault.
    const json: unknown = response.ok ? await response.json().catch(() => null) : null;
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** What GitHub's answer means, in a sentence. */
function resultFor(status: number, json: unknown, repo: string, hadToken: boolean): UpdateResult {
  if (status === 404) {
    // A private repository answers 404 rather than 403 to a request without a
    // token, so it cannot be told apart from a repository with no release —
    // except that with a token the first explanation is gone.
    return {
      verdict: 'unknown',
      reason: hadToken
        ? `GitHub has no ${RELEASE_TAG} release on ${repo}, or the token cannot see it.`
        : PRIVATE_REPO_REASON,
      release: null,
    };
  }
  if (status === 401) {
    return { verdict: 'unknown', reason: 'GitHub rejected the token; check it in Settings.', release: null };
  }
  if (status === 403 || status === 429) {
    return {
      verdict: 'unknown',
      reason: 'GitHub refused the request, most likely a rate limit; it will try again later.',
      release: null,
    };
  }
  if (status < 200 || status >= 300) {
    return { verdict: 'unknown', reason: `GitHub answered ${status}.`, release: null };
  }
  const release = parseRelease(json);
  return { ...compareBuild(buildInfo(), release), release };
}

async function run(force: boolean): Promise<UpdateCheckRecord> {
  try {
    await restore();
    if (!shouldCheck(record, new Date(), force)) return record;
    const { repo } = buildInfo();
    const token = await readToken();
    let exchange: { status: number; json: unknown };
    try {
      exchange = await fetchRelease(repo, token);
    } catch (e) {
      // No answer at all. The last real answer stays, so a newer build seen
      // this morning is still on offer in a plant room this afternoon.
      const why = e instanceof Error && e.name === 'AbortError'
        ? `GitHub did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : 'No answer from GitHub — most likely no signal.';
      await remember({ lastError: why });
      return record;
    }
    await remember({
      checkedAt: new Date().toISOString(),
      result: resultFor(exchange.status, exchange.json, repo, token !== null),
      lastError: null,
    });
    return record;
  } catch (e) {
    await remember({ lastError: `Could not check: ${message(e)}` }).catch(() => {});
    return record;
  }
}

/**
 * One check: read the release if it is due, and remember what it said.
 *
 * Resolves to the record and never rejects. Unforced, it goes to the network
 * at most once every six hours; forced — the button in Settings — it always
 * goes. A call while one is under way joins it.
 */
export function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateCheckRecord> {
  if (running) return running;
  running = run(options.force === true).finally(() => {
    running = null;
    publish();
  });
  publish();
  return running;
}

/** "Not now": keeps the banner away for a day, for the build it was pressed on. */
export async function snoozeUpdate(): Promise<void> {
  await remember({
    snoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString(),
    snoozedSha: record.result?.release?.sha ?? null,
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentUpdateCheck(): UpdateSnapshot {
  return snapshot;
}

/** The last answer and whether a check is under way, for a screen that shows it. */
export function useUpdateCheck(): UpdateSnapshot {
  useEffect(() => {
    void restore();
  }, []);
  return useSyncExternalStore(subscribe, currentUpdateCheck);
}
