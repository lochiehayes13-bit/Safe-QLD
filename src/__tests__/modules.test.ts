import { existsSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_SHORTCUTS, LEGACY_DEFAULT_SHORTCUTS, MODULES, MODULE_GROUPS,
  demoteShortcut, migrateShortcuts, moduleFor, moveShortcut, promoteShortcut, resolveShortcuts,
  searchModules, toggleShortcut,
} from '@/domain/modules';

/**
 * The catalogue behind the editable home screen.
 *
 * The failure that matters here is a tile that goes nowhere. Someone adds a
 * screen, renames a route, and a module still lists the old path — the picker
 * looks fine, the tile looks fine, and tapping it does nothing at all. So every
 * href is checked against the router directory on disk.
 */

const APP_DIR = join(__dirname, '..', '..', 'app');

/** expo-router maps /a/b to app/a/b.tsx, app/a/b/index.tsx, or a [param] file. */
function routeExists(href: string): boolean {
  const rel = href.replace(/^\//, '');
  if (existsSync(join(APP_DIR, `${rel}.tsx`))) return true;
  if (existsSync(join(APP_DIR, rel, 'index.tsx'))) return true;
  // Tab routes live in a group directory.
  if (existsSync(join(APP_DIR, '(tabs)', `${rel}.tsx`))) return true;
  return false;
}

describe('every module points at a screen that exists', () => {
  it.each(MODULES.map((m) => [m.label, m.href] as const))('%s → %s', (_label, href) => {
    expect({ href, exists: routeExists(href) }).toEqual({ href, exists: true });
  });
});

describe('the catalogue', () => {
  it('has no duplicate routes', () => {
    const seen = MODULES.map((m) => m.href);
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('puts every module in a known group', () => {
    for (const m of MODULES) {
      expect({ label: m.label, group: m.group, known: MODULE_GROUPS.includes(m.group) })
        .toEqual({ label: m.label, group: m.group, known: true });
    }
  });

  it('starts a new phone with a short grid, not a full one', () => {
    // A full grid looks finished, and nobody edits a finished thing. A short
    // one that is obviously missing your favourite is what sends you to the
    // edit button.
    expect(DEFAULT_SHORTCUTS.length).toBeLessThanOrEqual(8);
  });

  it('ships defaults that all resolve', () => {
    expect(resolveShortcuts(DEFAULT_SHORTCUTS)).toHaveLength(DEFAULT_SHORTCUTS.length);
  });

  it('starts nobody on a job list', () => {
    // The front page is for the projects crew and the apprentices as much as
    // the service technician, and the app does not know which one is holding
    // the phone. Jobs are one tap away for whoever wants them pinned.
    const groups = resolveShortcuts(DEFAULT_SHORTCUTS).map((m) => m.group);
    expect(groups).not.toContain('Jobs and planning');
  });

  it('says on every tile what the thing is for, briefly enough to fit on two lines', () => {
    for (const m of MODULES) {
      expect({ label: m.label, blurb: m.blurb, ok: m.blurb.trim().length > 0 && m.blurb.length <= 96 })
        .toEqual({ label: m.label, blurb: m.blurb, ok: true });
    }
  });
});

describe('a saved home screen from the previous build', () => {
  it('is replaced when it is exactly the old default, which nobody chose', () => {
    expect(migrateShortcuts([...LEGACY_DEFAULT_SHORTCUTS])).toEqual(DEFAULT_SHORTCUTS);
  });

  it('is kept when anybody has touched it, even slightly', () => {
    const edited = [...LEGACY_DEFAULT_SHORTCUTS.slice(1)];
    expect(migrateShortcuts(edited)).toEqual(edited);
    const reordered = [...LEGACY_DEFAULT_SHORTCUTS].reverse();
    expect(migrateShortcuts(reordered)).toEqual(reordered);
  });

  it('is kept when it is empty, because an empty home screen is a choice', () => {
    expect(migrateShortcuts([])).toEqual([]);
  });

  it('is the default when nothing was ever saved', () => {
    expect(migrateShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe('resolving saved shortcuts', () => {
  it('keeps the order the technician chose', () => {
    const order = ['/tools/resistor', '/work/jobs', '/sites'];
    expect(resolveShortcuts(order).map((m) => m.href)).toEqual(order);
  });

  it('drops a route that no longer exists rather than rendering a dead tile', () => {
    // A tile that navigates nowhere gives the technician no way to know why.
    expect(resolveShortcuts(['/work/jobs', '/tools/removed-in-v2']).map((m) => m.href))
      .toEqual(['/work/jobs']);
  });

  it('drops a repeat rather than showing the same tile twice', () => {
    expect(resolveShortcuts(['/sites', '/sites'])).toHaveLength(1);
  });
});

describe('search', () => {
  it('finds a module by a word that is not in its label', () => {
    // "EOL" is what people say; "End of line" is what the label reads.
    expect(searchModules('eol').map((m) => m.href)).toContain('/tools/resistor');
  });

  it('finds by group', () => {
    expect(searchModules('calculators').every((m) => m.group === 'Calculators')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(searchModules('  TIMESHEET ').map((m) => m.href)).toContain('/work/timesheets');
  });

  it('returns everything for an empty query', () => {
    expect(searchModules('   ')).toHaveLength(MODULES.length);
  });
});

describe('editing the list', () => {
  const list = ['/a', '/b', '/c'];

  it('moves an item up', () => {
    expect(moveShortcut(list, '/b', -1)).toEqual(['/b', '/a', '/c']);
  });

  it('moves an item down', () => {
    expect(moveShortcut(list, '/b', 1)).toEqual(['/a', '/c', '/b']);
  });

  it('refuses to move the first item up, off the end of the list', () => {
    expect(moveShortcut(list, '/a', -1)).toEqual(list);
  });

  it('refuses to move the last item down', () => {
    expect(moveShortcut(list, '/c', 1)).toEqual(list);
  });

  it('leaves the list alone when the item is not in it', () => {
    expect(moveShortcut(list, '/nope', 1)).toEqual(list);
  });

  it('adds and removes', () => {
    expect(toggleShortcut(list, '/d')).toEqual(['/a', '/b', '/c', '/d']);
    expect(toggleShortcut(list, '/b')).toEqual(['/a', '/c']);
  });

  it('can empty the list, because an empty home screen is a choice', () => {
    expect(toggleShortcut(['/a'], '/a')).toEqual([]);
  });
});

describe('moduleFor', () => {
  it('finds a known route', () => {
    expect(moduleFor('/work/timesheets')?.label).toBe('Timesheet');
  });

  it('returns nothing for an unknown one', () => {
    expect(moduleFor('/nope')).toBeUndefined();
  });
});

/**
 * Getting a tile to the top of the list.
 *
 * One place at a time is right for a nudge and useless for what people
 * actually do with this screen, which is drag the thing they open every
 * morning to the front. From fourteenth that was thirteen taps, thirteen
 * writes to preferences, and thirteen chances for the list to move out from
 * under a thumb mid-tap.
 */
describe('sending a tile to the end of the list', () => {
  const list = ['/a', '/b', '/c', '/d'];

  it('puts it at the front from anywhere', () => {
    expect(promoteShortcut(list, '/c')).toEqual(['/c', '/a', '/b', '/d']);
    expect(promoteShortcut(list, '/d')).toEqual(['/d', '/a', '/b', '/c']);
  });

  it('puts it at the back from anywhere', () => {
    expect(demoteShortcut(list, '/b')).toEqual(['/a', '/c', '/d', '/b']);
  });

  it('leaves the one already there alone', () => {
    expect(promoteShortcut(list, '/a')).toEqual(list);
    expect(demoteShortcut(list, '/d')).toEqual(list);
  });

  it('refuses to pin something that was not pinned', () => {
    // Inventing it at the top would put a tile on somebody's home screen that
    // they never chose.
    expect(promoteShortcut(list, '/nope')).toEqual(list);
    expect(demoteShortcut(list, '/nope')).toEqual(list);
  });

  it('does not modify what it was given', () => {
    const original = [...list];
    promoteShortcut(list, '/c');
    demoteShortcut(list, '/c');
    expect(list).toEqual(original);
  });

  it('keeps every tile, so nothing falls off the home screen', () => {
    for (const href of list) {
      expect([...promoteShortcut(list, href)].sort()).toEqual([...list].sort());
      expect([...demoteShortcut(list, href)].sort()).toEqual([...list].sort());
    }
  });

  it('gets there in one move where moveShortcut needs one per row', () => {
    let byOnes = [...list];
    let taps = 0;
    while (byOnes[0] !== '/d') { byOnes = moveShortcut(byOnes, '/d', -1); taps += 1; }
    expect(taps).toBe(3);
    expect(promoteShortcut(list, '/d')).toEqual(byOnes);
  });
});
