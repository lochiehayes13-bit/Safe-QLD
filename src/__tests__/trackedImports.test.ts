import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * Every file this app imports has to be a file that was actually committed.
 *
 * The build went red on a module that exists on one machine and nowhere else.
 * `schema.ts` imported `./schemaV30`, `schemaV30.ts` sat in the working tree
 * untracked, and every local check passed: the typechecker read it, Jest read
 * it, the linter read it. Only the runner — which has nothing but what is in
 * the repository — found out, and by then it was on the branch.
 *
 * It is the failure mode of working on two things at once, and it will happen
 * again: a screen written for a feature that has not landed, a seed file the
 * migration is waiting on, a module held back while its content is being
 * checked. The typechecker cannot catch it, because from where it stands the
 * file is there.
 *
 * So the question is asked of git rather than of the disk. What is tracked is
 * what the runner will get.
 *
 * Which means a new file has to be `git add`ed before this passes, even while
 * it is still being written. That is the point rather than a nuisance: the
 * moment something committed depends on it, it has to be going up too.
 */

const REPO = join(__dirname, '..', '..');

/** Extensions the bundler will try, in the order Metro tries them. */
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.web.ts', '.web.tsx', '.native.ts', '.native.tsx'];

function tracked(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const set = new Set(out.split('\0').filter(Boolean));
    // A checkout with no files is not an answer; it is git failing quietly.
    return set.size > 100 ? set : null;
  } catch {
    return null;
  }
}

const FILES = tracked();

/**
 * Where an import could land, as paths relative to the repository root.
 *
 * Both the file itself and the directory's index, because either satisfies the
 * bundler and either is a real answer.
 */
function candidates(fromFile: string, spec: string): string[] {
  const base = spec.startsWith('@/')
    ? posix.join('src', spec.slice(2))
    : posix.normalize(posix.join(posix.dirname(fromFile), spec));
  const out = [base];
  for (const e of EXTS) {
    out.push(base + e);
    out.push(posix.join(base, `index${e}`));
  }
  return out;
}

describe('imports resolve to files that are in the repository', () => {
  it('can read what git is tracking', () => {
    // Without this the whole suite below passes by doing nothing.
    expect(FILES).not.toBeNull();
    expect(FILES!.size).toBeGreaterThan(100);
  });

  it('has no module that exists only on the machine it was written on', () => {
    const files = [...FILES!].filter(
      (f) => (f.startsWith('src/') || f.startsWith('app/')) && /\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(200);

    const dangling: string[] = [];
    for (const f of files) {
      /*
       * Comments out, and a quote in front of `from` disqualifies it.
       * Both are how this check reports a module that is perfectly fine: a
       * guard test asserting that some other file contains "from './places'"
       * is a string, not an import, and the check that cannot tell the
       * difference is the check nobody trusts.
       */
      const text = readFileSync(join(REPO, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const specs = [
        ...text.matchAll(/(?<!["`])(?:from|import)\s*\(?\s*'((?:\.|@\/)[^']*)'/g),
        ...text.matchAll(/require\s*\(\s*'((?:\.|@\/)[^']*)'/g),
        /*
         * Double quotes too. Nothing in this tree writes an import that way —
         * the linter would reject it — so this half has never had anything to
         * find. It is here because the check above says it covers imports, and
         * a check whose reach is narrower than its own description is the kind
         * that gets trusted for something it never did.
         */
        ...text.matchAll(/(?<!['`])(?:from|import)\s*\(?\s*"((?:\.|@\/)[^"]*)"/g),
        ...text.matchAll(/require\s*\(\s*"((?:\.|@\/)[^"]*)"/g),
      ].map((m) => m[1] ?? '');

      for (const spec of specs) {
        if (!spec) continue;
        if (candidates(f, spec).some((c) => FILES!.has(c))) continue;
        dangling.push(`${f} imports '${spec}', which is not tracked`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('checks the file it was written for', () => {
    // schema.ts is the one that broke, and it imports its migrations by
    // relative path — so if the matcher above ever stops seeing those, this
    // fails rather than the check quietly covering nothing.
    const text = readFileSync(join(REPO, 'src/db/schema.ts'), 'utf8');
    const migrations = [...text.matchAll(/import \{ MIGRATION_V\d+ \} from '(\.\/\w+)';/g)]
      .map((m) => m[1] ?? '');
    expect(migrations.length).toBeGreaterThan(15);
    // And each of them is a file the runner will actually be handed.
    for (const spec of migrations) {
      expect(candidates('src/db/schema.ts', spec).some((c) => FILES!.has(c))).toBe(true);
    }
  });
});
