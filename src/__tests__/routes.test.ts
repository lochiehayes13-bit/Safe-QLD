import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every route the app navigates to has to exist.
 *
 * expo-router resolves routes from the filesystem at runtime, so a typo in a
 * pathname is invisible to the compiler and to every test that does not open
 * that screen — it surfaces as a technician tapping a row and nothing
 * happening. This walks the source for navigation targets and checks each one
 * against the files actually present.
 *
 * It caught a real one already: app/routine/run.tsx shipped with nothing
 * navigating to it, which is the same failure from the other direction.
 */

const APP_DIR = join(__dirname, '..', '..', 'app');
const SRC_DIR = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Routes that exist, as expo-router derives them from the file tree. */
function existingRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of walk(APP_DIR)) {
    const rel = relative(APP_DIR, file).replace(/\\/g, '/');
    if (!rel.endsWith('.tsx') || /(^|\/)_layout\.tsx$/.test(rel)) continue;
    let route = `/${rel.replace(/\.tsx$/, '')}`;
    route = route.replace(/\/index$/, '') || '/';
    routes.add(route);
    // A group segment like (tabs) is not part of the URL.
    const withoutGroups = route.replace(/\/\([^)]+\)/g, '');
    routes.add(withoutGroups || '/');
  }
  return routes;
}

/** Navigation targets referenced anywhere in the source. */
function referencedRoutes(): { route: string; file: string }[] {
  const found: { route: string; file: string }[] = [];
  const patterns = [
    /pathname:\s*'([^']+)'/g,
    /href:\s*'([^']+)'/g,
    /router\.(?:push|replace|navigate)\(\s*'([^']+)'\s*\)/g,
  ];

  for (const file of [...walk(APP_DIR), ...walk(SRC_DIR)]) {
    if (file.includes(`${__dirname}`)) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text))) {
        const route = m[1]!;
        // External links and anchors are not app routes.
        if (!route.startsWith('/') || route.startsWith('//')) continue;
        found.push({ route, file: relative(join(__dirname, '..', '..'), file) });
      }
    }
  }
  return found;
}

describe('navigation', () => {
  const routes = existingRoutes();
  const referenced = referencedRoutes();

  it('finds navigation targets to check', () => {
    // A regex that silently stops matching would make every assertion below
    // pass vacuously.
    expect(referenced.length).toBeGreaterThan(20);
    expect(routes.size).toBeGreaterThan(20);
  });

  it('has a screen behind every route the app navigates to', () => {
    const missing = referenced
      .filter(({ route }) => !routes.has(route))
      .map(({ route, file }) => `${route} (from ${file})`);
    expect(missing).toEqual([]);
  });

  it('gives every dynamic route its parameter segment', () => {
    // '/report/[id]' is a route; '/report/' is a typo that resolves to nothing.
    for (const { route, file } of referenced) {
      if (!route.includes('[')) continue;
      expect({ route, file, balanced: (route.match(/\[/g) ?? []).length === (route.match(/\]/g) ?? []).length })
        .toEqual({ route, file, balanced: true });
    }
  });
});
