import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every module split by filename, held to offering the same names.
 *
 * Metro picks `x.web.ts` over `x.ts` for the web build and TypeScript resolves
 * the bare name, which means the compiler only ever checks one of the two. A
 * function added to the phone's half and forgotten in the browser's typechecks
 * clean, passes every test, and then throws on an iPhone — which is most of
 * the people this build exists for, since the web app is how it reaches them.
 *
 * `webFiles.test.ts` has held the file layer to this for a while. This is the
 * same check over every pair in the repository, because the file layer was
 * never the only one: there are now seven, and the two added for sending
 * photographs and for background sync would have had no guard at all.
 */

const SRC = join(__dirname, '..');

/** Every `x.ts(x)` that has an `x.web.ts(x)` beside it. */
function splitPairs(dir: string, out: { base: string; web: string }[] = []): { base: string; web: string }[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      splitPairs(full, out);
      continue;
    }
    const web = /^(.+)\.web\.(tsx?)$/.exec(entry.name);
    if (!web) continue;
    for (const ext of ['ts', 'tsx']) {
      const base = join(dir, `${web[1]}.${ext}`);
      try {
        if (statSync(base).isFile()) out.push({ base, web: full });
      } catch {
        // No base half: reported by its own test below.
      }
    }
  }
  return out;
}

/**
 * The names that exist at run time — functions and consts.
 *
 * Types are deliberately left out. A type has no run-time existence, so a
 * missing one cannot throw on an iPhone; and the browser halves that share
 * types with their phone half do it by importing them (`MapCanvas.web.tsx`,
 * `platformGeocode.web.ts`), which keeps one definition rather than two that
 * can drift. Counting an imported type as missing would have marked the
 * better arrangement as the broken one.
 */
function exportsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const names = new Set<string>();
  for (const m of source.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(m[1]!);
  for (const m of source.matchAll(/^export const (\w+)/gm)) names.add(m[1]!);
  for (const m of source.matchAll(/^export \{([^}]+)\}/gm)) {
    for (const part of m[1]!.split(',')) {
      if (/^\s*type\s/.test(part)) continue;
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

const PAIRS = splitPairs(SRC);

describe('modules split by platform', () => {
  it('finds the pairs, so a test that matched nothing cannot pass by default', () => {
    // The check below is `.each` over this list; an empty list would be green
    // and would prove nothing at all.
    expect(PAIRS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(PAIRS.map((p) => [relative(SRC, p.base), p] as const))(
    '%s offers the browser everything the phone does',
    (_name, pair) => {
      /*
       * A superset is allowed: the browser's file layer has a printer the
       * phone does not need. A name the phone has and the browser lacks is
       * the failure — that is a screen that works on Android and throws on an
       * iPhone, with nothing between it and a technician to catch it.
       */
      const phone = exportsOf(pair.base);
      const browser = new Set(exportsOf(pair.web));
      expect(phone.filter((name) => !browser.has(name))).toEqual([]);
    },
  );

  it('has a phone half for every browser half', () => {
    // TypeScript resolves the bare name, so a `.web.ts` with nothing beside it
    // is a module the compiler has never seen and the native build has not got.
    const orphans: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        const web = /^(.+)\.web\.(tsx?)$/.exec(entry.name);
        if (!web) continue;
        const hasBase = ['ts', 'tsx'].some((ext) => {
          try { return statSync(join(dir, `${web[1]}.${ext}`)).isFile(); } catch { return false; }
        });
        if (!hasBase) orphans.push(relative(SRC, full));
      }
    };
    walk(SRC);
    expect(orphans.sort()).toEqual([]);
  });
});
