/**
 * A hook that only runs once a record has arrived is a blank screen.
 *
 * Every record screen opens the same way: read the row, and while it is not
 * there yet show `RecordGate`. That early return is fine — until a hook sits
 * below it. React counts the hooks a component calls and refuses a render that
 * calls more than the last one did, so the moment the record arrives the
 * screen throws and the technician gets an empty page with no message. It
 * happened on the timesheet: `useMemo` for the tick-box list sat under the
 * gate, and every week opened blank.
 *
 * Nothing in the type system or the test suite catches it, because both halves
 * are correct on their own. So this walks the real screens with TypeScript's
 * own parser and fails on a `use…` call that sits after a return in the same
 * function body.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const ROOT = join(__dirname, '..', '..');

/** Every screen and shared component, which is where hooks live. */
function screens(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.expo|__tests__/.test(full)) screens(full, out);
    } else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

interface Violation { file: string; component: string; returnLine: number; hook: string; hookLine: number }

/**
 * Hooks called after a return, in one function body. Nested functions are
 * their own components and are checked separately, so the walk stops at them.
 */
function violationsIn(file: string): Violation[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Violation[] = [];

  type Body = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
  const checkBody = (fn: Body, name: string) => {
    let firstReturn: number | null = null;
    const visit = (node: ts.Node) => {
      const isNested = node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
      if (isNested) return;
      if (ts.isReturnStatement(node) && firstReturn === null) firstReturn = node.getStart();
      if (
        ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && /^use[A-Z]/.test(node.expression.text)
        && firstReturn !== null && node.getStart() > firstReturn
      ) {
        found.push({
          file: relative(ROOT, file),
          component: name,
          returnLine: source.getLineAndCharacterOfPosition(firstReturn).line + 1,
          hook: node.expression.text,
          hookLine: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body ?? fn, visit);
  };

  const top = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.body) {
      const name = node.name?.text;
      const isComponent = !name || /^[A-Z]/.test(name)
        || node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isComponent) checkBody(node, name ?? 'default export');
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const init = decl.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          && ts.isIdentifier(decl.name) && /^[A-Z]/.test(decl.name.text)
          && init.body && ts.isBlock(init.body)) checkBody(init, decl.name.text);
      }
    }
    ts.forEachChild(node, top);
  };
  ts.forEachChild(source, top);
  return found;
}

describe('hooks and the record gate', () => {
  it('never calls a hook below an early return, which renders the screen blank', () => {
    const files = [...screens(join(ROOT, 'app')), ...screens(join(ROOT, 'src', 'components'))];
    expect(files.length).toBeGreaterThan(50);
    const bad = files.flatMap(violationsIn);
    const said = bad.map((v) => `${v.file} — ${v.component}: ${v.hook} on line ${v.hookLine}, below the return on line ${v.returnLine}`);
    expect(said).toEqual([]);
  });

  it('sees the fault when it is put back', () => {
    // The check is worth nothing unless it fails on the shape it is written
    // for, so this is the timesheet bug in miniature.
    const file = join(ROOT, 'src', '__tests__', 'fixtures', 'hookBelowGate.tsx');
    expect(violationsIn(file).map((v) => `${v.component}:${v.hook}`)).toEqual(['BlankOnLoad:useMemo']);
  });
});
