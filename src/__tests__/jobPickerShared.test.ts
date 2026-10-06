/**
 * One job picker, not seven.
 *
 * It was written in the clock screen and copied, verbatim, into the schedule
 * screen — seventy-one bytes-identical lines, with a comment in the copy
 * asking whether it ought to be shared. A shared component was written and
 * those two were converted. The guard put over it then looked for a screen
 * declaring `function JobPicker(`, which is the one shape nobody was writing:
 * five more screens had an inline list instead, and walked straight through.
 *
 *   src/components/JobFileCard.tsx  — and with it the six screens that file a
 *                                     document on a job: the report, the
 *                                     impairment, the occupier's notice, the
 *                                     assessment, the baseline and the quote
 *   app/swms/[id].tsx               — linking the signed statement to a job
 *   app/form72/[id].tsx             — linking the statutory test to a job
 *   app/defect/[id].tsx             — twice: the defect's job, and the photos
 *
 * Every one of them read the first fifty jobs at a site, filtered those fifty
 * in JavaScript and drew twenty or twenty-five of them. So a job past the
 * fiftieth at a busy building could not be picked at all; the box matched only
 * the columns that copy happened to join; and each said some version of "No
 * jobs on this phone for that site" about a site whose jobs were simply
 * further down the list. JobFileCard's went furthest and told the technician
 * to "search all of them above", where the box above searched the same fifty
 * — the instruction on screen could not work, which is the worst way for a
 * screen to be wrong, and the Form 72 chooser says so in its own comment about
 * the same fault.
 *
 * That is this app's recurring fault and the reason for the whole shape: the
 * site search had four definitions and the differences between them were the
 * bug.
 *
 * So the guard is anchored on where the rows come from instead. A file that
 * reads a list of jobs it did not already name goes through the shared picker,
 * and the ones that read such a list for some other reason are named below
 * with that reason, checked rather than taken on trust.
 *
 * Read off the source text because these are components and the suite's
 * react-native mock cannot load one — the house pattern, see
 * timesheetLayout.test.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './support/sourceCode';

const root = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const USERS = [
  ['the clock screen', 'app/work/clock.tsx'],
  ['the schedule screen', 'app/work/schedule.tsx'],
  ['the SWMS builder', 'app/swms/new.tsx'],
  ['the SWMS record', 'app/swms/[id].tsx'],
  ['the Form 72', 'app/form72/[id].tsx'],
  ['the defect', 'app/defect/[id].tsx'],
  ['the file-it-on-the-job card', 'src/components/JobFileCard.tsx'],
] as const;

describe('the screens that pick a job', () => {
  it.each(USERS)('%s uses the shared picker', (_what, file) => {
    expect(read(file)).toContain("import { JobPicker } from '@/components/JobPicker';");
  });

  it.each(USERS)('%s holds no copy of its own', (_what, file) => {
    expect(read(file)).not.toContain('function JobPicker(');
  });

  it.each(USERS)('%s opens the picker only once the read has come back', (_what, file) => {
    /*
     * Five of these opened it first. A read that threw then left an empty
     * picker on screen under a sentence about there being no jobs at the site
     * — an answer, and the wrong one, to a question nothing had answered.
     */
    const source = read(file);
    const opens = source.indexOf('setPicking(true)') >= 0
      ? source.indexOf('setPicking(true)')
      : source.indexOf('setPickingJob(true)');
    if (opens < 0) return; // clock and schedule open on a tab, not on a read
    const reads = source.indexOf('listJobPage(');
    if (reads < 0) return;
    expect({ file, opensAfterTheRead: opens > reads }).toEqual({ file, opensAfterTheRead: true });
  });
});

describe('nothing writes another one', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.tsx') ? [path] : [];
  });

  const all = [...files(join(root, 'app')), ...files(join(root, 'src', 'components'))]
    .map((f) => f.slice(root.length + 1));

  it('finds the app’s screens and components, so this is not passing on an empty list', () => {
    expect(all.length).toBeGreaterThan(70);
  });

  /*
   * Anchored on the read, not on a declaration.
   *
   * These four hand back jobs the caller did not name — a list to choose from.
   * jobSummariesByExternalIds is deliberately not among them: it answers for
   * ids you already hold, so it cannot produce this fault.
   */
  const READS_A_JOB_LIST = /\blistJobPage\s*\(|\bopenJobPicks\s*\(|\bsearchJobPicks\s*\(|\blistJobsFor\s*\(/;

  /**
   * The files that read a job list and are right not to offer one.
   *
   * Each with its reason, because an allow-list without one is a list of
   * screens somebody could not be bothered to check.
   */
  const ALLOWED: Record<string, string> = {
    'src/components/JobPicker.tsx': 'is the shared picker',
    'app/work/jobs.tsx': 'is the job list',
    'app/customer/[id].tsx': 'this customer’s jobs, each row opening the job rather than picking it',
    'app/site/[id].tsx': 'this site’s jobs, each row opening the job rather than picking it',
    'app/report/[id].tsx': 'reads the site’s open jobs to say where a defect raised here would go; the picking is JobFileCard’s',
    'app/site/bulk-test.tsx': 'the site’s open jobs, for the note the walk writes at the end',
    'app/site/form72.tsx': 'links automatically where the site has exactly one open job, and offers no list at all',
    'app/form72/new.tsx': 'is itself a whole screen for choosing the job, searched in the database with its own tabs and counts',
    'app/timesheet/[id].tsx': 'a full-screen sheet merging the device search with the jobs off recent timesheets; folding it in would make the shared one worse',
    'app/routine/run.tsx': 'only this site’s open jobs, as a chip row — a search over every job would invite filing against another building',
    'app/work/defect/new.tsx': 'the same chip row, for the same reason',
  };

  it('every file that reads a job list offers it through the shared picker', () => {
    const offenders = all
      .filter((f) => !ALLOWED[f])
      .filter((f) => READS_A_JOB_LIST.test(codeOf(read(f))))
      .filter((f) => !read(f).includes("import { JobPicker } from '@/components/JobPicker';"));
    expect(offenders).toEqual([]);
  });

  it('every name on the allow-list is a file that still reads one', () => {
    // A name left here after the file stopped reading a job list is a hole
    // nobody would notice: the next file to take that path is exempt.
    for (const name of Object.keys(ALLOWED)) {
      expect({ name, present: all.includes(name) }).toEqual({ name, present: true });
      expect({ name, reads: READS_A_JOB_LIST.test(codeOf(read(name))) }).toEqual({ name, reads: true });
    }
  });

  it('and the reason each one is allowed still holds', () => {
    // The chip rows read one site's jobs and keep the open ones. A search box
    // appearing on either would be a search over every job the phone holds,
    // which is the thing their own comments say must not happen here.
    for (const chips of ['app/routine/run.tsx', 'app/work/defect/new.tsx']) {
      const source = read(chips);
      expect({ chips, scoped: source.includes('listJobsFor({ siteId: forSite'), open: source.includes('jobIsOpen(j)') })
        .toEqual({ chips, scoped: true, open: true });
    }
    // The Form 72 chooser's search is the query, not a filter over a window.
    expect(read('app/form72/new.tsx')).toContain('query: debounced.trim() || undefined');
    // Starting a Form 72 from a site links a job only when there is one answer.
    const start = read('app/site/form72.tsx');
    expect(start).toContain('autoLinkJob(');
    expect(start).not.toContain('SearchBox');
  });
});

describe('what the shared one does that the copies did not', () => {
  const shared = read('src/components/JobPicker.tsx');

  it('searches every job the phone holds, in the database', () => {
    // Not a filter over the fifty rows a screen happened to read.
    expect(shared).toContain('await searchJobPicks(typed, 40)');
  });

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

  it.each(USERS)('%s says what its starting list is, in the trade’s words', (_what, file) => {
    // The lines that genuinely differ between screens are props, so each one
    // supplies them rather than inheriting somebody else's wording.
    const source = read(file);
    expect(source).toMatch(/suggestedLabel=/);
    expect(source).toMatch(/emptyWhenNoneSuggested=/);
    expect(source).toMatch(/emptyWhenNothingOnDevice=/);
  });
});
