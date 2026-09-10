import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * An icon name that is not an icon.
 *
 * MaterialCommunityIcons takes a string. A string it does not know draws
 * nothing at all — no warning, no error, no placeholder box on a phone — so a
 * mistyped name is invisible everywhere except on the screen a technician is
 * looking at, where a button has lost its picture and nobody can say why.
 * The typechecker catches a literal, and misses every name assembled at
 * runtime or held in a table of them, which is where this app keeps most of
 * its icons.
 *
 * So the names are checked against the font's own glyph map, which is the only
 * authority on what will actually draw.
 */

const REPO = join(__dirname, '..', '..');
const GLYPHS = join(
  REPO,
  'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
);

const glyphs = new Set(Object.keys(JSON.parse(readFileSync(GLYPHS, 'utf8')) as Record<string, number>));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sources(full, out);
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...sources(join(REPO, 'app')), ...sources(join(REPO, 'src'))];

describe('every icon name draws something', () => {
  it('read the font that decides it', () => {
    expect(glyphs.size).toBeGreaterThan(5000);
    expect(glyphs.has('weather-sunny')).toBe(true);
  });

  it('found the sources it means to check', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('has no name the font does not know', () => {
    /*
     * Anything written as `icon="..."`, `icon: '...'` or `name="..."` on an
     * icon component. Names built by concatenation are out of reach here and
     * are the reason the glyph map is worth having at all — but every one of
     * those in this app resolves to a literal in the same table, which this
     * does see.
     */
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const found = [
        ...text.matchAll(/\bicon(?:Name)?\s*[=:]\s*['"]([a-z0-9-]+)['"]/g),
        ...text.matchAll(/\bicon(?:Name)?\s*=\s*\{\s*['"]([a-z0-9-]+)['"]/g),
        ...text.matchAll(/<MaterialCommunityIcons[^>]*?\bname\s*=\s*['"]([a-z0-9-]+)['"]/g),
        ...text.matchAll(/<MaterialCommunityIcons[^>]*?\bname\s*=\s*\{\s*['"]([a-z0-9-]+)['"]/g),
      ].map((m) => m[1] ?? '');

      for (const name of found) {
        if (!name || glyphs.has(name)) continue;
        bad.push(`${relative(REPO, f)}: "${name}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('actually looked at a decent number of names', () => {
    // A regex that stopped matching would pass the check above silently.
    let seen = 0;
    for (const f of files) {
      seen += [...readFileSync(f, 'utf8').matchAll(/\bicon(?:Name)?\s*[=:]\s*['"]([a-z0-9-]+)['"]/g)].length;
    }
    expect(seen).toBeGreaterThan(150);
  });
});

describe('no screen falls back to a sun', () => {
  it('makes the empty state say what it is about', () => {
    /*
     * EmptyState's icon used to default to 'weather-sunny', and fifty-eight of
     * the app's empty states took the default — so "no sites on this phone
     * yet", "nothing on order", "weigh it" and "that record is not on this
     * device" all drew the same cheerful sun. The type now requires one, and
     * this is the check that the default has not quietly come back.
     */
    const ui = readFileSync(join(REPO, 'src/components/ui.tsx'), 'utf8');
    const block = ui.slice(ui.indexOf('export function EmptyState('));
    expect(block.slice(0, 700)).not.toContain('weather-sunny');
    expect(block.slice(0, 700)).toMatch(/icon: React\.ComponentProps/);
  });
});
