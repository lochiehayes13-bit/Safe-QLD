import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the defect screens claim after queueing something for the office.
 *
 * `enqueueSync` calls a row a duplicate while the earlier copy is still
 * 'pending' on this phone, not only once it has been sent. So a duplicate is
 * "already queued or sent", never "already on the job".
 */

const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

describe('defect detail, photos onto a job', () => {
  const source = read('app/defect/[id].tsx');

  it('does not say a duplicate photo is on the job', () => {
    expect(source).not.toContain('already on the job.');
    expect(source).toContain('already queued or sent.');
  });

  it('tells a technician with no jobs to sync, not only to connect', () => {
    expect(source).toContain('emptyWhenNothingOnDevice="No jobs yet. Connect Simpro in Settings and sync."');
  });
});

describe('bulk test result', () => {
  const source = read('app/site/bulk-test.tsx');

  it('does not say a duplicate defect note is on the job', () => {
    expect(source).not.toMatch(/\{defectNotes\.already\} already on job/);
    expect(source).toContain('{defectNotes.already} already queued or on job {defectNotes.jobId}.');
  });

  it('only asks for Record again when something is left to record', () => {
    // A throw after every asset was written left "Record again for the other 0."
    expect(source).toContain("(remaining ? ` Record again for the other ${remaining}.` : '')");
  });

  it('says "It goes" for a single queued note', () => {
    expect(source).toContain("{defectNotes.queued === 1 ? 'It goes' : 'They go'} with the next send.");
  });
});
