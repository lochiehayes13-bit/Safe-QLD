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

const files = screens(APP).map((f) => ({ path: relative(REPO, f), text: readFileSync(f, 'utf8') }));

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
      .filter((f) => f.text.includes('Loading…'))
      .map((f) => f.path);
    expect(spinners).toEqual([]);
  });

  it('makes every screen that shows the gate able to tell the two states apart', () => {
    const broken = files
      .filter((f) => f.text.includes('<RecordGate') && !f.text.includes('setMissing('))
      .map((f) => f.path);
    expect(broken).toEqual([]);
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
    const byId = files.filter((f) => /\[id\]\.tsx$/.test(f.path) && fetches(f.text));
    expect(byId.length).toBeGreaterThan(8);

    const notGated = byId.filter((f) => !f.text.includes('<RecordGate')).map((f) => f.path);
    expect(notGated).toEqual([]);
  });

  it('still answers on a screen whose record is already in memory', () => {
    // The exemption above is only safe because that screen does say something.
    const library = files.find((f) => f.path.endsWith('app/library/[id].tsx'))!;
    expect(library.text).toContain('No such document');
  });
});
