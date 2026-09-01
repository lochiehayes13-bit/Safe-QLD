import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No compiled file sitting next to the TypeScript it was compiled from.
 *
 * This one cost real time before it was found. A `standardsCatalogue.js` was
 * left in `src/domain` beside `standardsCatalogue.ts`, and both jest's module
 * resolution and Metro's prefer the `.js`. So every import of
 * `@/domain/standardsCatalogue` read the compiled copy, which was a snapshot
 * from whenever somebody last ran `tsc` without `--noEmit`.
 *
 * The failure mode is the worst kind: entirely silent, and it makes edits
 * appear to do nothing. Tests pass — against the old file. Clause links added
 * to the source do not show up in the app and do not show up in the suite
 * either, so the suite agrees with the app that the change was never made.
 * Nothing anywhere says "you are reading a different file".
 *
 * `.gitignore` now keeps such a file out of the repository. This keeps it out
 * of a working copy as well, which is where it does the damage — an ignored
 * file still shadows the source for everyone running the tests locally.
 */

const ROOTS = ['src', 'app'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'coverage']);

/** Every file under a root, as a repository-relative path. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const REPO = join(__dirname, '..', '..');
const files = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => relative(REPO, f));
const present = new Set(files);

describe('the source tree', () => {
  it('has no compiled JavaScript shadowing a TypeScript file', () => {
    /*
     * The exact case that bit: foo.js beside foo.ts. Resolution takes the .js,
     * and every edit to the .ts is invisible until somebody thinks to look.
     */
    const shadowed = files.filter((f) => {
      if (!f.endsWith('.js')) return false;
      const base = f.slice(0, -3);
      return present.has(`${base}.ts`) || present.has(`${base}.tsx`);
    });
    expect(shadowed).toEqual([]);
  });

  it('has no compiled JavaScript in the source tree at all', () => {
    // Even without a same-named sibling, a stray build artifact in src/ or app/
    // is something nobody is maintaining and everybody assumes is generated
    // from what they are reading.
    expect(files.filter((f) => f.endsWith('.js') || f.endsWith('.js.map'))).toEqual([]);
  });

  it('has no emitted declaration files beside their sources', () => {
    expect(files.filter((f) => f.endsWith('.d.ts'))).toEqual([]);
  });

  it('found the tree it meant to check, rather than passing on an empty list', () => {
    // A vacuous pass here would hide every assertion above it.
    expect(files.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length).toBeGreaterThan(100);
  });
});
