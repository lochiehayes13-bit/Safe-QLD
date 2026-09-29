import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

describe('nothing outside the storage module writes the whole blob', () => {
  /**
   * The rule the clobber above keeps coming back through.
   *
   * `patchPrefs` exists and the theme was fixed with it, and three writers
   * were left on `savePrefs` — the staff picker, the module arranger and the
   * connection applier — each holding a copy of the settings and writing every
   * field of it back. The module arranger was the live one: it read the
   * settings when it opened and wrote all of them on each tile moved, so a
   * technician could pick themselves off the staff list, arrange their home
   * screen, and be nobody again. Nothing on the screen says that has happened;
   * the first sign is My day showing an empty week.
   *
   * So it is a rule about where the whole blob may be written, rather than a
   * test of any one screen, because the next screen to edit a setting will be
   * written by somebody who has not read this. `savePrefs` stays exported —
   * `patchPrefs` is built on it — and belongs to the storage module alone.
   */
  const REPO = join(__dirname, '..', '..');
  const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__']);

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
  };

  it('is only called from app-prefs itself', () => {
    const callers: string[] = [];
    for (const file of [...walk(join(REPO, 'src')), ...walk(join(REPO, 'app'))]) {
      if (file.endsWith(join('src', 'app-prefs.ts'))) continue;
      const source = readFileSync(file, 'utf8');
      // The call, not the word: the comments above explain the hazard by name.
      if (/\bsavePrefs\s*\(/.test(source)) callers.push(file.slice(REPO.length + 1));
    }
    // Named rather than counted, so the fix is a file somebody opens.
    expect(callers.sort()).toEqual([]);
  });

  it('found the files it means to be reading', () => {
    // A walk that silently returns nothing would pass the rule above forever.
    const files = [...walk(join(REPO, 'src')), ...walk(join(REPO, 'app'))];
    expect(files.length).toBeGreaterThan(200);
    expect(files.filter((f) => /patchPrefs\s*\(/.test(readFileSync(f, 'utf8'))).length).toBeGreaterThan(4);
  });
});
