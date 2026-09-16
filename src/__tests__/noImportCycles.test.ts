import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No module in this app imports its way back to itself.
 *
 * A cycle is legal JavaScript and the bundler will not complain. What it does
 * is hand one of the two modules a half-initialised copy of the other at
 * module-init time — so a `const` read at the top level is `undefined`, and
 * only for whichever module the bundler happened to reach second.
 *
 * That makes it the worst kind of fault to find here. It does not show in the
 * type checker, because the types are all fine. It does not reliably show in
 * this suite, because jest resolves modules in its own order and a test that
 * imports the pair directly usually gets the order that works. It shows on a
 * handset, as a screen that renders blank or a table that is suddenly empty,
 * and it moves when an unrelated import is added somewhere else.
 *
 * The risk is not hypothetical here. This app has 120-odd modules and a
 * deliberately layered shape — seed data, then parsers, then domain, then
 * export, then screens — and the layering is what keeps it acyclic. It is held
 * by convention and nothing else, and it takes one convenient import to break:
 * a domain module reaching back into an export helper for a formatter, say,
 * where the export module already imports the domain one.
 *
 * The two constants tables that were merged in this repository — the Schedule 2
 * system map, and the Queensland UTC offset — each moved an import edge to a
 * new place. This is the check that says those edges did not close a loop.
 */

const ROOTS = ['src', 'app'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__']);
const CODE = /\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * A module's key: its path without the extension, and nothing else.
 *
 * Folding `foo/index` into `foo` was the first attempt and it is wrong here —
 * `app/settings.tsx` and `app/settings/index.tsx` would become one node, and a
 * cycle through either would be reported against the wrong file. The folding
 * belongs at the other end, where an import specifier is resolved.
 */
function moduleKey(path: string): string {
  return path.replace(/\.tsx?$/, '');
}

/** The specifier's module, trying the file and then its directory's index. */
function resolve(specifier: string, known: Set<string>): string | undefined {
  if (known.has(specifier)) return specifier;
  const asIndex = `${specifier}/index`;
  return known.has(asIndex) ? asIndex : undefined;
}

function buildGraph(): Map<string, string[]> {
  const files = ROOTS.flatMap((r) => walk(r));
  const known = new Set(files.map(moduleKey));
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const deps = new Set<string>();
    // Only the alias imports. A relative import cannot leave its own directory
    // often enough to matter here, and every cross-layer import in this
    // codebase is written with the alias.
    for (const m of source.matchAll(/from '@\/([^']+)'/g)) {
      const key = resolve(moduleKey(`src/${m[1]}`), known);
      if (key) deps.add(key);
    }
    for (const m of source.matchAll(/from '(\.[^']+)'/g)) {
      const key = resolve(moduleKey(join(file, '..', m[1]!)), known);
      if (key) deps.add(key);
    }
    graph.set(moduleKey(file), [...deps]);
  }
  return graph;
}

/** Every cycle reachable in the graph, each as the path that closes it. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const state = new Map<string, 0 | 1 | 2>();
  const cycles: string[][] = [];

  const visit = (node: string, stack: string[]): void => {
    state.set(node, 1);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 1) {
        cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      } else if ((state.get(dep) ?? 0) === 0) {
        visit(dep, stack);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of graph.keys()) if ((state.get(node) ?? 0) === 0) visit(node, []);
  return cycles;
}

describe('the shape of the imports', () => {
  it('has no module importing its way back to itself', () => {
    const cycles = findCycles(buildGraph());
    // Printed as the loop rather than counted, because "1 cycle" sends somebody
    // looking through a hundred and twenty files and "a -> b -> a" does not.
    expect(cycles.map((c) => c.join(' -> '))).toEqual([]);
  });

  it('is reading the whole app, so a green result means something', () => {
    /*
     * The check above passes trivially on an empty graph, and a walk that
     * silently stopped finding files would report no cycles for the rest of
     * this repository's life.
     */
    const graph = buildGraph();
    expect(graph.size).toBeGreaterThan(100);
    expect([...graph.keys()]).toContain('src/domain/qldCompliance');
    expect([...graph.keys()]).toContain('app/(tabs)/index');
    // An index file keeps its own name, so a cycle through it names the file
    // somebody has to open rather than its directory.
    expect([...graph.keys()]).toContain('src/seed/catalogue/index');

    // And it is resolving edges, not just listing files.
    expect(graph.get('src/domain/qldCompliance')).toContain('src/domain/statementEvidence');
    expect(graph.get('src/domain/statementEvidence')).toContain('src/domain/occupierForm');
  });

  it('finds a cycle when there is one, on a graph built to have one', () => {
    // The check itself, checked. A cycle detector that never fires is the same
    // as no check at all, and this one is only ever exercised by passing.
    const graph = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
      ['d', ['a']],
    ]);
    expect(findCycles(graph).map((c) => c.join(' -> '))).toEqual(['a -> b -> c -> a']);
  });
});
