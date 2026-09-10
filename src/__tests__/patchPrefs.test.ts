/*
 * An in-memory store, kept local to this file.
 *
 * Nothing else in the suite exercises the storage round-trip — the other
 * tests import DEFAULT_PREFS and stop there — and a global mock would change
 * what every other suite is running against for the sake of one.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => { store.set(k, v); return Promise.resolve(); },
      removeItem: (k: string) => { store.delete(k); return Promise.resolve(); },
      clear: () => { store.clear(); return Promise.resolve(); },
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFS, loadPrefs, patchPrefs, savePrefs } from '@/app-prefs';

/**
 * Two screens editing the same settings blob.
 *
 * Every screen that edits preferences held the whole blob in state from the
 * moment it loaded and wrote all of it back on each change. That is fine while
 * only one screen ever writes. The theme lock broke it: it is chosen on the
 * Settings screen and persisted on its own, so the very next edit on that same
 * screen — the technician's name, a rate, anything — wrote the blob it had
 * read *before* the lock and quietly put the theme back to following the phone.
 *
 * The sequence is not exotic. The colour control sits on the settings screen,
 * so "lock it to dark, then fix my name" is the likely order, not a corner.
 */

beforeEach(async () => { await AsyncStorage.clear(); });

describe('changing one setting', () => {
  it('leaves the others as they are on disk', async () => {
    await savePrefs({ ...DEFAULT_PREFS, technicianName: 'Sam', theme: 'dark' });
    await patchPrefs({ technicianName: 'Alex' });

    const back = await loadPrefs();
    expect(back.technicianName).toBe('Alex');
    expect(back.theme).toBe('dark');
  });

  it('does not undo a change another screen made after this one loaded', async () => {
    // The exact clobber. A screen reads prefs, something else writes the
    // theme, then the screen saves — and the theme goes back.
    await savePrefs({ ...DEFAULT_PREFS, technicianName: 'Sam' });
    const stale = await loadPrefs();

    await patchPrefs({ theme: 'dark' });
    await patchPrefs({ technicianName: 'Alex' });

    const back = await loadPrefs();
    expect(back.theme).toBe('dark');
    expect(back.technicianName).toBe('Alex');
    // And the proof that the old shape was the problem: writing the snapshot
    // back is what loses it.
    await savePrefs({ ...stale, technicianName: 'Alex' });
    expect((await loadPrefs()).theme).toBe('system');
  });

  it('returns what is now stored, so a caller can put it on screen', async () => {
    await savePrefs({ ...DEFAULT_PREFS, technicianName: 'Sam' });
    const next = await patchPrefs({ theme: 'light' });
    expect(next.theme).toBe('light');
    expect(next.technicianName).toBe('Sam');
  });

  it('works on a phone that has never saved anything', async () => {
    const next = await patchPrefs({ theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(next.companyName).toBe(DEFAULT_PREFS.companyName);
  });

  it('applies several changes in the order they were made', async () => {
    await patchPrefs({ technicianName: 'Sam' });
    await patchPrefs({ technicianName: 'Alex' });
    expect((await loadPrefs()).technicianName).toBe('Alex');
  });
});
