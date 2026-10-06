/**
 * One job picker, not four.
 *
 * It was written in the clock screen and copied, verbatim, into the schedule
 * screen — seventy-one bytes-identical lines, with a comment in the copy
 * asking whether it ought to be shared. The SWMS builder would have been the
 * fourth, so a shared component was written and those two were left where they
 * were "for now". That is the whole fault pattern this app keeps producing:
 * the site search had four definitions and the differences between them were
 * the bug.
 *
 * This is not a tidiness test. The copies had already drifted behind the
 * shared one in two ways that a technician would feel. The shared picker asks
 * the database how many jobs the phone holds, so "no job matches that" and "no
 * jobs on this phone yet" are told apart — the copies inferred it from a count
 * the screen happened to be holding for another reason. And clearing the
 * search box in the copies ran outside the debounce, so the list flashed back
 * to the suggestions between two keystrokes.
 *
 * Read off the source text because these are components and the suite's
 * react-native mock cannot load one — the house pattern, see
 * timesheetLayout.test.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

const USERS = [
  ['the clock screen', 'app/work/clock.tsx'],
  ['the schedule screen', 'app/work/schedule.tsx'],
  ['the SWMS builder', 'app/swms/new.tsx'],
] as const;

describe('the screens that pick a job', () => {
  it.each(USERS)('%s uses the shared picker', (_what, file) => {
    expect(read(file)).toContain("import { JobPicker } from '@/components/JobPicker';");
  });

  it.each(USERS)('%s holds no copy of its own', (_what, file) => {
    expect(read(file)).not.toContain('function JobPicker(');
  });

  it.each(USERS)('%s says what its starting list is, in the trade’s words', (_what, file) => {
    // The two lines that genuinely differ between screens are props, so each
    // one has to supply them rather than inherit somebody else's wording.
    const source = read(file);
    expect(source).toMatch(/suggestedLabel=/);
    expect(source).toMatch(/emptyWhenNoneSuggested=/);
    expect(source).toMatch(/emptyWhenNothingOnDevice=/);
  });
});

describe('nothing writes a fourth one', () => {
  const screens = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return screens(path);
    return name.endsWith('.tsx') ? [path] : [];
  });

  const all = screens(join(__dirname, '..', '..', 'app'));

  it('finds the app’s screens, so this is not passing on an empty list', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it('no screen declares a job picker of its own', () => {
    /*
     * The timesheet's is deliberately not one of these: it is a different
     * thing — a full-screen sheet merging the device search with the jobs off
     * recent timesheets — and folding it in here would make the shared
     * component worse rather than better. It is named rather than matched by
     * accident, so a new copy somewhere else still fails this.
     */
    const ALLOWED = ['app/timesheet/[id].tsx'];
    const offenders = all
      .map((f) => f.slice(f.indexOf('/app/') + 1))
      .filter((f) => !ALLOWED.includes(f))
      .filter((f) => read(f).includes('function JobPicker('));
    expect(offenders).toEqual([]);
  });
});

describe('what the shared one does that the copies did not', () => {
  const shared = read('src/components/JobPicker.tsx');

  it('asks the database how many jobs the phone holds', () => {
    // "No match" and "no jobs on this phone" read the same on screen and have
    // completely different answers. The copies inferred it from a count their
    // screen was keeping for another reason.
    expect(shared).toContain("searchJobPicks('', 1)");
    expect(shared).toContain('const nothingAnywhere = onDevice === 0;');
  });

  it('puts clearing the box through the same delay as typing into it', () => {
    // Otherwise the list flashes back to the suggestions between keystrokes.
    expect(shared).toMatch(/const timer = setTimeout\(\(\) => \{[\s\S]{0,400}if \(!typed\) \{/);
  });

  it('drops a reply that lands after the next search', () => {
    expect(shared).toContain('return () => { current = false; clearTimeout(timer); };');
  });
});
