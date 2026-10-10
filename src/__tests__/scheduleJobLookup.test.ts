/**
 * The schedule asks for the jobs it names, rather than hoping they are in a window.
 *
 * My day draws the office's schedule and opens each block on the job the phone
 * holds. It used to find that job by reading the first five hundred job rows
 * and matching the block's office number against them. On this owner's phone
 * there are four and a half thousand jobs — around seven hundred of them open
 * — ordered open-first by the date the office raised them, so a block whose
 * job sat past the five hundredth row matched nothing and the row printed
 *
 *     Job 1515 is not on this phone yet — tap to sync
 *
 * for a job that was on the phone the whole time, under a button that could
 * not have fixed it. Being told to repair something that is not broken, by a
 * control that does nothing, is worse than being told nothing at all.
 *
 * The home screen has always asked by id (app/(tabs)/index.tsx) and so does
 * Today's run. My day was the one reading a window. These assertions are on
 * the source text because the screen is a component and the suite's
 * react-native mock cannot load one — the same reason timesheetLayout.test.ts
 * reads its screen as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

const SCREENS = [
  ['app/work/my-day.tsx', 'My day'],
  ['app/(tabs)/index.tsx', 'the home screen'],
] as const;

describe('a screen that matches the schedule against the job table', () => {
  it.each(SCREENS)('%s asks for the jobs by their office number', (file) => {
    const source = read(file);
    expect(source).toContain('jobSummariesByExternalIds');
  });

  it.each(SCREENS)('%s reads no window of jobs to match against', (file, what) => {
    const source = read(file);
    /*
     * The fault was `listJobs({ limit: 500 })` — any bounded read of the whole
     * job table, matched against by id afterwards, is the same bug with a
     * different number in it. A query that names a site or a customer is
     * something else and stays allowed; this is the unscoped read.
     */
    const windowed = /\blistJobs(Summaries)?\(\s*\{[^}]*\blimit\b/.test(source);
    expect({ screen: what, readsAWindowOfEveryJob: windowed })
      .toEqual({ screen: what, readsAWindowOfEveryJob: false });
  });

  it('still tells a technician when the job genuinely is not here', () => {
    // The sentence is right when it is true. Removing the window must not have
    // removed the honest case: a block for a job the sync has not brought down.
    expect(read('app/work/my-day.tsx')).toContain('jobNotHereWords');
  });
});
