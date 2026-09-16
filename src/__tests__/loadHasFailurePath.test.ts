import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

/**
 * A spinner that starts has to be able to stop with words.
 *
 * The shape this catches is the one behind most of this app's dead pages. A
 * handler turns a flag on, awaits a repository read or a file write, and turns
 * the flag off on the way out — and nothing anywhere says what to do if the
 * await throws. Two failures come out of that one omission:
 *
 *  - with no `finally`, the flag stays on and the screen spins for ever;
 *  - with a `finally` and no `catch`, the spinner stops and nothing else
 *    happens at all. Press Export, watch it think, watch it stop, and the file
 *    is not there and no reason is given. Fifteen handlers in this app did
 *    exactly that, and on the web build — the build that reaches an iPhone —
 *    every one of them failed on every press, because `expo-file-system` there
 *    is a set of stubs.
 *
 * So: a function that shows a spinner must also have a `catch`. It is checked
 * with TypeScript's own parser rather than by grep, because the thing being
 * asked about is whether a `catch` covers the same function body as the flag,
 * and no regular expression knows that.
 */

const ROOT = join(__dirname, '..', '..');
const APP = join(ROOT, 'app');

function screens(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) screens(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

interface Violation { file: string; line: number; flag: string }

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

/** `setBusy(true)` and friends: the state setter for a spinner, and its value. */
function flagSet(node: ts.Node, value: boolean): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  if (!/^set[A-Z]/.test(node.expression.text)) return undefined;
  if (node.arguments.length !== 1) return undefined;
  const arg = node.arguments[0]!;
  const wanted = value ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword;
  return arg.kind === wanted ? node.expression.text : undefined;
}

function violationsIn(file: string): Violation[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Violation[] = [];

  const check = (fn: Fn) => {
    const on = new Set<string>();
    const off = new Set<string>();
    let hasCatch = false;
    // Nested functions are checked in their own right, so the walk stops at
    // them — a catch inside a callback does not cover the body around it.
    const visit = (node: ts.Node) => {
      if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
      const onName = flagSet(node, true);
      if (onName) on.add(onName);
      const offName = flagSet(node, false);
      if (offName) off.add(offName);
      if (ts.isTryStatement(node) && node.catchClause) hasCatch = true;
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body ?? fn, visit);

    if (hasCatch) return;
    for (const flag of on) {
      // Both halves, or it is not a spinner — a flag only ever set true is a
      // one-way switch like "the pack has been imported", not a load.
      if (!off.has(flag)) continue;
      found.push({
        file: relative(ROOT, file),
        line: source.getLineAndCharacterOfPosition(fn.getStart()).line + 1,
        flag,
      });
    }
  };

  const walk = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
      check(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}

describe('a screen that shows a spinner', () => {
  const files = screens(APP);

  it('found the screens it meant to check', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('can always say what went wrong instead of just stopping', () => {
    const violations = files.flatMap(violationsIn);
    expect(violations.map((v) => `${v.file}:${v.line} ${v.flag}`)).toEqual([]);
  });

});
