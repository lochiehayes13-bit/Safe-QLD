import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A screen that opens a record has to be able to say the record is not there.
 *
 * Every one of them used to open with the same line: if the record is null,
 * show "Loading…". That is right for the second it takes to read a row and
 * wrong for ever after, because a record that does not exist produces exactly
 * the same null. Following a link to a job somebody deleted, or opening a share
 * pack that references a site this handset does not have, gave a spinner that
 * never resolved — with no way to tell whether the app was slow or broken, and
 * no way back except the operating system.
 *
 * Eleven screens had it. This is what stops the twelfth.
 *
 * The check is deliberately about the shape rather than the wording: a screen
 * that renders RecordGate must also set the flag that tells it which of the two
 * states it is in. A screen that renders the gate and never sets the flag has
 * the old bug back with a nicer spinner on it.
 */

const APP = join(__dirname, '..', '..', 'app');
const REPO = join(__dirname, '..', '..');

function screens(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) screens(full, out);
    else if (entry.endsWith('.tsx') && !entry.startsWith('_')) out.push(full);
  }
  return out;
}

/**
 * A screen's source with its comments taken out.
 *
 * These checks are about what a screen renders, and this repository explains
 * every fixed fault in a comment beside the fix — so the comment on the
 * timesheet describing the endless "Loading…" it used to show would fail the
 * very check that records it was fixed. Stripping comments first keeps the
 * check about the code and lets the code keep its history.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = screens(APP).map((f) => {
  const text = readFileSync(f, 'utf8');
  return { path: relative(REPO, f), text, code: code(text) };
});

/**
 * Whether the promise this call returns has a .catch of its own.
 *
 * "A .catch within six lines" was the first attempt, and it is satisfied by
 * any .catch that happens to be nearby — including one on a completely
 * different call three lines below. A write left unhandled directly above a
 * caught reload reads as handled, which is the precise arrangement this check
 * exists to find.
 *
 * So the call's own chain is walked instead: from the open bracket to its
 * match, then along whatever is attached to it — `.then(...).catch(...)` is
 * caught, a bare call followed by an unrelated statement is not.
 *
 * `from` is the index just after the call's opening bracket.
 */
function caught(code: string, from: number): boolean {
  let i = from;
  let depth = 1;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  // Then any number of chained calls, until something that is not one.
  for (;;) {
    const rest = code.slice(i);
    const link = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
    if (!link) return false;
    if (link[1] === 'catch') return true;
    i += link[0].length;
    depth = 1;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
  }
}

describe('record screens', () => {
  it('found the screens it meant to check', () => {
    // A vacuous pass here would hide every assertion below it.
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no screen left showing an endless spinner', () => {
    /*
     * "Loading…" as the entire fallback is the shape of the bug. A screen may
     * still say it is working on something — the timesheet says it is adding up
     * the week — but not as the answer to "is this record here".
     */
    const spinners = files
      .filter((f) => f.code.includes('Loading…'))
      .map((f) => f.path);
    expect(spinners).toEqual([]);
  });

  it('makes every screen that shows the gate able to tell the two states apart', () => {
    const broken = files
      .filter((f) => f.code.includes('<RecordGate') && !f.code.includes('setMissing('))
      .map((f) => f.path);
    expect(broken).toEqual([]);
  });

  it('can say that the read itself failed, not only that the record is absent', () => {
    /*
     * The half of the fault the gate did not cover. A load written as
     * `void load()` throws into nothing: the record is never set and neither is
     * `missing`, so the screen falls back to "Loading…" for the rest of the
     * session with the failure invisible — the same endless spinner, arrived at
     * a different way. A screen that shows the gate has to be able to tell it
     * the read gave up.
     */
    const ungated = files
      .filter((f) => f.code.includes('<RecordGate') && !f.code.includes('failed={'))
      .map((f) => f.path);
    expect(ungated).toEqual([]);
  });

  it('never lets a share sheet that did not open pass without a word', () => {
    /*
     * `shareFile` returns false rather than throwing when the platform has no
     * share sheet, because the file itself was written. Sixteen of seventeen
     * callers dropped that answer: press Export, watch the spinner run and
     * stop, and nothing happens at all. Reading the result is the whole fix, so
     * that is what is checked — a call whose answer goes nowhere is the bug.
     */
    /*
     * Asked the other way round. It used to require the literal shape
     * `= await shareFile(`, which is what every caller here happens to write —
     * but it means a perfectly correct `if (!(await shareFile(file, 'x')))`
     * would be reported as dropping the answer, and a `=` pushed past thirty
     * characters by a longer name would too. A guard that fails on correct
     * code gets loosened by whoever hits it, and then it is gone.
     *
     * What is actually wrong is the call standing alone as a statement, its
     * answer going nowhere. So that is what is looked for: an await whose
     * result nothing receives, recognised by what sits in front of it being
     * the end of the previous statement rather than something expecting a
     * value.
     */
    const ignored: string[] = [];
    for (const f of files) {
      for (const call of f.code.matchAll(/\bshareFile\s*\(/g)) {
        const before = f.code.slice(0, call.index);
        // An import names it too; only a call has an `await` in front of it.
        if (!/await\s*$/.test(before)) continue;
        const upto = before.replace(/\s*await\s*$/, '').trimEnd();
        // Nothing at all, or the end of the statement before it: the answer
        // is going nowhere. Anything else — `=`, `(`, `!`, `return`, `&&` —
        // is something that receives it.
        if (upto === '' || /[;{}>]$/.test(upto)) ignored.push(`${f.path}@${call.index}`);
      }
    }
    expect(ignored).toEqual([]);
  });

  it('raises every message through the seam that works in a browser', () => {
    /*
     * `react-native-web`'s Alert is `static alert() {}` — not a stub that logs,
     * the whole implementation. A screen that calls `Alert.alert` says nothing
     * at all on the web build, and the web build is how this app reaches an
     * iPhone. Every message in the app went through it, including "Photo
     * required" and the confirmation before a rectification date is stamped.
     *
     * `showAlert` is the same modal on a phone and a browser prompt on the web,
     * so what is checked is that no screen has gone back to the direct call.
     */
    const direct = files.filter((f) => /\bAlert\.alert\s*\(/.test(f.code)).map((f) => f.path);
    expect(direct).toEqual([]);

    const importsAlert = files
      .filter((f) => /^import \{[^}]*\bAlert\b[^}]*\} from 'react-native';$/m.test(f.code))
      .map((f) => f.path);
    expect(importsAlert).toEqual([]);
  });

  it('has a browser half of the seam, and it is the one that does the work', () => {
    // A seam with only a native side is the bug with extra steps.
    const web = readFileSync(join(REPO, 'src/components/alert.web.ts'), 'utf8');
    expect(web).toMatch(/confirm/);
    expect(web).toMatch(/alert\?\./);
  });

  it('offers a way back from a record that is not there', () => {
    // The screen is a dead end otherwise: a technician who followed a link has
    // nothing on screen to press.
    const gate = readFileSync(join(REPO, 'src/components/RecordGate.tsx'), 'utf8');
    expect(gate).toContain('router.back()');
  });

  it('does not decide a record is missing on a timer', () => {
    /*
     * "It has been four seconds so it is probably gone" is a guess that is
     * wrong on a cold database and right most other times, and a wrong "this
     * was deleted" is worse than a slow spinner. The screens have to actually
     * know.
     */
    const gate = readFileSync(join(REPO, 'src/components/RecordGate.tsx'), 'utf8');
    expect(gate).not.toMatch(/setTimeout|setInterval/);
  });

  it('uses the shared gate rather than each screen wording it differently', () => {
    /*
     * Eleven screens saying eleven things about the same situation is how a
     * technician learns to distrust all of them.
     *
     * The rule applies to a screen that goes and fetches its record, because
     * only those have two states to tell apart. A screen whose record comes out
     * of a constant already in memory — the standards catalogue is the one —
     * resolves synchronously and has no loading state to be stuck in, so it
     * says "no such document" outright and is right to.
     */
    const fetches = (text: string) => /await |\.then\(/.test(text);
    const byId = files.filter((f) => /\[id\]\.tsx$/.test(f.path) && fetches(f.code));
    expect(byId.length).toBeGreaterThan(8);

    const notGated = byId.filter((f) => !f.code.includes('<RecordGate')).map((f) => f.path);
    expect(notGated).toEqual([]);
  });

  it('never writes a record away without holding on to what happened', () => {
    /*
     * `void saveBaseline(next)` is the same fault as the endless spinner, at
     * the other end of the screen. The value goes on screen, the write goes
     * out, and if it throws the promise is unhandled: the field still shows
     * what was typed, the row does not hold it, and nothing is said. The
     * technician finds out when the form they filled in comes back empty.
     *
     * Six screens had it. `useRecordPatch` is what they use now — it catches,
     * says so once, and re-reads the record — so what is checked is that no
     * screen has gone back to firing a repository write into nothing.
     *
     * Only writes. A read that fails is the gate's problem, and the gate is
     * checked above. The verb has to be followed by a capital or nothing at
     * all, so `attachmentQueueSummary` is not mistaken for an attach.
     */
    const VERBS = [
      'save', 'update', 'insert', 'delete', 'set', 'add', 'remove', 'clear', 'queue', 'mark',
      'patch', 'create', 'upsert', 'apply', 'record', 'start', 'stop', 'finish', 'complete',
      'close', 'reopen', 'attach', 'enqueue', 'push', 'book', 'rename', 'move', 'promote', 'assign',
    ];
    const isWrite = new RegExp(`^(${VERBS.join('|')})(?![a-z])`);

    const loose: string[] = [];
    for (const f of files) {
      // Only what the screen imported from a repository or the outbound queue.
      // A local helper named `save` is somebody else's promise to keep.
      const stored = new Set<string>();
      for (const imp of f.code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@\/db\/[^']+|@\/simpro\/[^']+)'/g)) {
        for (const named of (imp[1] ?? '').split(',')) {
          const id = named.trim().split(/\s+as\s+/).pop()?.trim();
          if (id) stored.add(id);
        }
      }
      for (const call of f.code.matchAll(/\bvoid\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1] ?? '';
        if (!stored.has(name) || !isWrite.test(name)) continue;
        if (!caught(f.code, (call.index ?? 0) + call[0].length)) {
          loose.push(`${f.path}: void ${name}(`);
        }
      }
    }
    expect(loose).toEqual([]);
  });

  it('has a shared way to edit a record, and it says when a write failed', () => {
    // The rule above is only fair because there is one obvious thing to use.
    const hook = readFileSync(join(REPO, 'src/hooks/useRecordPatch.ts'), 'utf8');
    expect(hook).toContain('showAlert');
    // Writes chained, so five keystrokes land in the order they were typed.
    expect(hook).toMatch(/chain\.current\s*=/);
    // And one message per run of failures, not one per keystroke.
    expect(hook).toContain('complaining');
  });

  it('has the record screens actually using it', () => {
    const users = files.filter((f) => /useRecordPatch\s*(<[^>]*>)?\s*\(/.test(f.code)).map((f) => f.path);
    expect(users.length).toBeGreaterThanOrEqual(6);
  });

  it('still answers on a screen whose record is already in memory', () => {
    // The exemption above is only safe because that screen does say something.
    const library = files.find((f) => f.path.endsWith('app/library/[id].tsx'))!;
    expect(library.code).toContain('No such document');
  });
});
