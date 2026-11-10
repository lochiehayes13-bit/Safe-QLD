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
     * Two shapes. A plain attribute — `icon="chevron-up"`, `icon: 'ruler'` —
     * and anything inside a JSX expression container on an icon or name prop.
     *
     * The second is what the first version of this check missed. It only read
     * a literal sitting immediately after the brace, so every
     * `name={x === 'email' ? 'email-outline' : 'phone-outline'}` in the app —
     * ten of them, about fourteen distinct names — went unchecked, including
     * one this same commit wrote. A guard that reports safety over a third of
     * the icons in the app is worse than none.
     *
     * Reading everything inside the braces means excluding what is plainly not
     * an icon: a string being compared against (`x === 'email'`) and a string
     * indexing a type (`ComponentProps<...>['name']`). Both are recognisable
     * from the character in front of them, and both were real in this tree.
     */
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      const found: string[] = [];
      for (const m of text.matchAll(/\bicon(?:Name)?\s*[=:]\s*['"]([a-z0-9-]+)['"]/g)) {
        found.push(m[1] ?? '');
      }
      for (const braced of text.matchAll(/\b(?:icon|iconName|name)\s*=\s*\{([^}]*)\}/g)) {
        for (const s of (braced[1] ?? '').matchAll(/(===|!==|==|!=|\[)?\s*['"]([a-z0-9-]+)['"]/g)) {
          if (!s[1]) found.push(s[2] ?? '');
        }
      }

      for (const name of found) {
        if (!name || glyphs.has(name)) continue;
        bad.push(`${relative(REPO, f)}: "${name}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('actually looked at a decent number of names, in both shapes', () => {
    // A regex that stopped matching would pass the check above silently, and
    // the braced half is pinned separately because that is the half that was
    // missing and would go missing again unnoticed.
    let plain = 0;
    let braced = 0;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      plain += [...text.matchAll(/\bicon(?:Name)?\s*[=:]\s*['"]([a-z0-9-]+)['"]/g)].length;
      for (const b of text.matchAll(/\b(?:icon|iconName|name)\s*=\s*\{([^}]*)\}/g)) {
        for (const s of (b[1] ?? '').matchAll(/(===|!==|==|!=|\[)?\s*['"]([a-z0-9-]+)['"]/g)) {
          if (!s[1]) braced += 1;
        }
      }
    }
    expect(plain).toBeGreaterThan(150);
    expect(braced).toBeGreaterThan(20);
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
