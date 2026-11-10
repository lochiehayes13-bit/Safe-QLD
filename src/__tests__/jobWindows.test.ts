/**
 * No screen searches a window of jobs and calls it the books.
 *
 * The same fault as the capped site lists, on the other table. A screen reads
 * the first N job rows, filters them in JavaScript, and presents the result as
 * though it had looked at everything. On twenty test rows it is identical. On
 * this owner's phone there are 4,562 jobs and around seven hundred open, and
 * what it produces is a search that answers "no" about a job that is sitting
 * right there.
 *
 * Two screens were still doing it, and both said something on screen that
 * could not work:
 *
 *   app/form72/new.tsx read four hundred rows and searched those, under a line
 *   reading "the list is windowed, so search if yours is not here" — the
 *   instruction and the thing preventing it on the same screen.
 *
 *   app/work/route.tsx read five hundred rows of the whole job table for a tab
 *   labelled "All open". The job list's order puts open work first, so it
 *   looked right; a couple of hundred open jobs were never on the run and
 *   nothing marked their absence. A route planned over part of the outstanding
 *   work and labelled as the whole of it is the kind of wrong that gets
 *   trusted.
 *
 * Read off the source text because these are components and the suite's
 * react-native mock cannot load one — the house pattern, see
 * timesheetLayout.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

describe('starting a Form 72 from a job', () => {
  const source = read('app/form72/new.tsx');

  it('searches with the query rather than over the rows it happens to hold', () => {
    expect(source).toMatch(/query: debounced\.trim\(\) \|\| undefined/);
  });

  it('filters the tabs in the query too, not in JavaScript afterwards', () => {
    // "Last fortnight" was a slice taken out of the four hundred. If the
    // fortnight's jobs were not in that window the tab was empty.
    expect(source).toMatch(/dayFrom: shiftDays\(today, -14\)/);
    expect(source).toMatch(/dayFrom: today, dayTo: today/);
  });

  it('no longer matches the typed words against the rows in memory', () => {
    expect(source).not.toMatch(/\bconst matches = \(j: JobSummary\)/);
    expect(source).not.toMatch(/\bconst inMode = \(j: JobSummary\)/);
  });

  it('opens the job it was sent from by its id, not by looking for it in the page', () => {
    // Once the tab and the search narrow the page, a job opened from its own
    // screen is usually not in the rows — and the preview would silently not
    // appear.
    expect(source).toMatch(/await getJob\(params\.jobId!\)/);
  });

  it('says how many matched as well as how many are drawn', () => {
    expect(source).toMatch(/First \$\{shown\.length\} of \$\{matching\.toLocaleString\(\)\}/);
  });

  it('no longer tells somebody to search their way out of a window', () => {
    expect(source).not.toContain('the list is windowed, so search if yours is not here');
  });
});

describe('today’s run', () => {
  const source = read('app/work/route.tsx');

  it('asks the database for the open work rather than taking the top of the table', () => {
    expect(source).toMatch(/listJobs\(\{ open: true, limit: OPEN_PAGE \+ 1 \}\)/);
  });

  it('reads one row more than it draws, so it can tell a full page from a whole list', () => {
    expect(source).toMatch(/rows\.length > OPEN_PAGE/);
  });

  it('plans over more jobs than this book has open', () => {
    // Around seven hundred of 4,562 are open. A cap at five hundred was below
    // that, which is how the fault was invisible: the tab was never empty.
    const cap = source.match(/const OPEN_PAGE = (\d+);/);
    expect(cap).toBeTruthy();
    expect(Number(cap![1])).toBeGreaterThan(1000);
  });

  it('says so on screen where even that is not all of it', () => {
    expect(source).toMatch(/scope === 'open' && openCut/);
    expect(source).toMatch(/More than \$\{OPEN_PAGE\.toLocaleString\(\)\} open jobs/);
  });
});
