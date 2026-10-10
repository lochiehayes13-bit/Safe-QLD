import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Crash-safe form drafts.
 *
 * The loudest complaint about the platforms technicians are made to use is not
 * a missing feature — it is losing work. Notes, photos and test results
 * vanishing is common enough that people run a second app alongside the
 * mandated one purely to keep their notes safe.
 *
 * So every form holding unsaved state persists it as the user types and
 * restores it on return. A half-written defect survives a lock screen, a phone
 * call, a low-memory kill and a flat battery. None of it needs signal.
 */

const PREFIX = 'safeqld.draft.';

/** Writes are debounced so typing does not hit storage on every keystroke. */
const WRITE_DEBOUNCE_MS = 400;

export interface DraftState<T> {
  value: T;
  setValue: (updater: T | ((prev: T) => T)) => void;
  /** True once any previously saved draft has been loaded. */
  ready: boolean;
  /** True when a draft was recovered rather than started fresh. */
  recovered: boolean;
  /** Clears the stored draft — call on successful submit. */
  discard: () => Promise<void>;
}

/**
 * Keeps a value in storage under a stable key.
 *
 * `key` should identify the form and the thing it edits, e.g.
 * `defect:new:site-123`, so two half-written defects on different sites do not
 * overwrite each other.
 */
export function useDraft<T>(key: string, initial: T): DraftState<T> {
  const [value, setValueRaw] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = PREFIX + key;
  // Guards against a slow restore clobbering edits the user already made.
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!cancelled && raw && !dirty.current) {
          setValueRaw(JSON.parse(raw) as T);
          setRecovered(true);
        }
      } catch {
        // A corrupt draft is not worth surfacing — start fresh instead.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      dirty.current = true;
      setValueRaw((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {
            // Storage full or unavailable. The in-memory value still stands, so
            // nothing is lost right now and there is no useful recovery to
            // offer mid-keystroke.
          });
        }, WRITE_DEBOUNCE_MS);
        return next;
      });
    },
    [storageKey],
  );

  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    setRecovered(false);
    await AsyncStorage.removeItem(storageKey).catch(() => undefined);
  }, [storageKey]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { value, setValue, ready, recovered, discard };
}

/** Every draft currently held, for the readout in Settings. */
export async function listDrafts(): Promise<{ key: string; bytes: number }[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (!mine.length) return [];
    const pairs = await AsyncStorage.multiGet(mine);
    return pairs.map(([k, v]) => ({ key: k.slice(PREFIX.length), bytes: v?.length ?? 0 }));
  } catch {
    return [];
  }
}

export async function clearAllDrafts(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
    return mine.length;
  } catch {
    return 0;
  }
}
