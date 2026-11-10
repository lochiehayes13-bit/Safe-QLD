/**
 * The SWMS, from the job in front of you, and in the crew's words.
 *
 * Read off the source text because these are components and the suite's
 * react-native mock cannot load one; the route handling itself is tested in
 * swmsBuilder.test.ts (swmsStartFromRoute).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './support/sourceCode';

const root = join(__dirname, '..', '..');
const read = (file: string) => codeOf(readFileSync(join(root, file), 'utf8'));

describe('the job screen', () => {
  const job = read('app/work/job/[id].tsx');

  it('offers the SWMS', () => {
    expect(job).toContain('title="SWMS"');
  });

  it('opens a new statement with the job number and the site', () => {
    expect(job).toMatch(
      /pathname: '\/swms\/new',\s*params: \{ job: job\.externalId \?\? '', siteId: resolvedSiteId \?\? '', site: job\.siteName \?\? '' \}/,
    );
  });
});

describe('the new statement screen', () => {
  it('reads the job and site from the route', () => {
    expect(read('app/swms/new.tsx')).toContain('swmsStartFromRoute(params)');
  });

  it('drops the job when a site is picked instead', () => {
    /*
     * Opened from a job, the job is already held. Tapping its card and then
     * "No job? Pick the site" showed the picked site's card, but Start still
     * wrote the job's number and the job's site onto the statement, because
     * the job was never let go.
     */
    const screen = read('app/swms/new.tsx');
    const onPick = screen.match(/<SitePicker[\s\S]*?onChange=\{\(id: string\) => \{([\s\S]*?)\}\}/);
    expect(onPick).not.toBeNull();
    expect(onPick![1]).toContain('setJob(null)');
    // The register and what is due came from the job's site or the route's;
    // they are not this site's.
    expect(onPick![1]).toContain('setSystems([])');
    expect(onPick![1]).toContain('setRoutineIds([])');
  });
});

describe('the job copy chip', () => {
  /*
   * attachedAt is stamped when the PDF is queued, not when Simpro has it. The
   * Form 72 card was fixed for exactly this ("On the job" from the moment the
   * file was queued); the SWMS screens say what is known: it was queued.
   */
  it.each(['app/swms/index.tsx', 'app/swms/[id].tsx'])('%s does not call a queued PDF on the job', (file) => {
    const code = read(file);
    expect(code).not.toContain('label="On the job"');
    expect(code).toContain('label="Queued for the job"');
  });
});

describe('the reviewer’s working notes', () => {
  /*
   * The statements wait on company approval. What the crew and the PDF say is
   * that, once, and nothing from the review that led to it: no finding counts,
   * no severities, no talk of a cold read.
   */
  const FILES = [
    'app/swms/index.tsx',
    'app/swms/new.tsx',
    'app/swms/[id].tsx',
    'src/domain/swms.ts',
    'src/domain/swmsEmail.ts',
    'src/export/swms.ts',
  ];

  it.each(FILES)('%s does not put them on screen or paper', (file) => {
    const code = read(file);
    expect(code).not.toMatch(/\.correctedAgainst|\.findings\b|\.reason\b|cold read|cleared for signature/);
    expect(code).not.toMatch(/\b(fatal|serious|minor)\b/i);
  });
});
