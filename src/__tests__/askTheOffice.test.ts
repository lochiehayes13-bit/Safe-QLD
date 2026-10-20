/**
 * Ask the office, from the job in front of you.
 *
 * The job screen opens the question with that job's number and site already
 * in it, and the question screen takes them from the route. Read off the
 * source text because these are components and the suite's react-native mock
 * cannot load one; the route handling itself is tested in requests.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './support/sourceCode';

const root = join(__dirname, '..', '..');
const read = (file: string) => codeOf(readFileSync(join(root, file), 'utf8'));

describe('the job screen', () => {
  const job = read('app/work/job/[id].tsx');

  it('offers Ask the office', () => {
    expect(job).toContain('title="Ask the office"');
  });

  it('opens the question with the job number and the site', () => {
    expect(job).toMatch(
      /pathname: '\/work\/rfi',\s*params: \{ job: job\.externalId \?\? '', site: job\.siteName \?\? '' \}/,
    );
  });
});

describe('the question screen', () => {
  const rfi = read('app/work/rfi.tsx');

  it('reads the job and site from the route', () => {
    expect(rfi).toContain('requestJobFromRoute(params)');
  });

  it('picks the job with the shared picker and still takes a typed number', () => {
    expect(rfi).toContain('<JobPicker');
    expect(rfi).toContain('withPickedJob(');
    expect(rfi).toMatch(/<Field\s+label="Job number"/);
  });

  it('has no free-standing leave form left behind', () => {
    expect(readFileSync(join(root, 'src/domain/requests.ts'), 'utf8')).not.toMatch(/leaveSubject|leaveBody|LeaveRequest/);
  });
});
