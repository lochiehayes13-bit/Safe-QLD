/**
 * The job screen's site briefing, and whose site it is about.
 *
 * This screen shows a building's open defects, its asset count and its notes
 * under the heading of the job you opened. Three things were wrong with how it
 * decided which building that was, and all three are the same kind of fault:
 * the screen was confident about something it had not established.
 *
 * Asserted against the source, which is how this repository tests its screens
 * (see timesheetLayout.test.ts). A briefing is a composition of four reads and
 * a set of state; there is no seam to test it through, and the three faults are
 * each visible as a shape in the code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screen = readFileSync(
  join(__dirname, '..', '..', 'app', 'work', 'job', '[id].tsx'), 'utf8',
);

describe('whose site the briefing is about', () => {
  it('clears the site when the job has none, rather than keeping the last one', () => {
    /*
     * The load ran only when job.siteId was set and had no else, so opening a
     * job with no site left the PREVIOUS job's site on screen — its open
     * defects, its asset count, its notes — under the new job's name. A
     * briefing that confidently shows another building's faults is worse than
     * one that shows none.
     */
    expect(screen).toContain('setSite(null); setDefects([]); setAssetCount(0); setKnowledge([]);');
  });

  it('resolves the office’s site id when the phone has not matched one', () => {
    // A synced job carries siteExternalId even where siteId is unset, and that
    // match exists — getSiteByExternalId. Nothing looked for it, so a site the
    // phone HAS was unreachable from the job that was for it.
    expect(screen).toContain('getSiteByExternalId(f.job.siteExternalId)');
    expect(screen).toContain("import { getSiteByExternalId } from '@/db/searchRepo';");
  });

  it('reads the four site facts off the resolved site, not off the job', () => {
    /*
     * The point of resolving it is that everything downstream agrees. Reading
     * f.job.siteId again below the resolution would reintroduce the fault for
     * exactly the jobs the resolution exists for.
     */
    const block = screen.slice(screen.indexOf('const siteId = f?.job.siteId'));
    const load = block.slice(0, block.indexOf('setResolvedSiteId'));
    for (const call of [
      'getSite(siteId)', "listDefects(siteId, 'open')",
      'assetCountsBySystem(siteId)', 'listKnowledge({ siteId })',
    ]) {
      expect({ call, usesResolved: load.includes(call) }).toEqual({ call, usesResolved: true });
    }
  });

  it('lets the buttons read the same answer as the briefing above them', () => {
    // Two sources for "is there a site" is how a screen ends up offering
    // "Open site" on a job it has just said has none.
    expect(screen).toContain('setResolvedSiteId(siteId)');
    expect(screen).toContain('{resolvedSiteId ? (');
  });
});

describe('raising a defect from a job with no site', () => {
  it('omits the site rather than passing an empty one', () => {
    /*
     * An empty siteId is not "no site", it is a key: the defect screen keys
     * its recovery draft on `params.assetId ?? params.siteId ?? 'unassigned'`,
     * and ?? does not fall through an empty string — so every defect raised
     * from a job with no site shared the key `defect:new:` and overwrote the
     * last one. Omitted, it reaches the intended 'unassigned' fallback and
     * that screen asks which site.
     */
    expect(screen).toContain("{ pathname: '/work/defect/new' }");
    expect(screen).not.toContain("params: { siteId: job.siteId ?? '' }");
  });

  it('does not rely on the empty string being rejected downstream', () => {
    // It is rejected — the defect screen's save guards !siteId before writing,
    // so no orphan row was ever created. The fault was the draft, not the
    // database, and this records which so the next reader does not have to
    // find out.
    const defectScreen = readFileSync(
      join(__dirname, '..', '..', 'app', 'work', 'defect', 'new.tsx'), 'utf8',
    );
    expect(defectScreen).toContain('if (!siteId) {');
    expect(defectScreen).toContain("showAlert('Which site?'");
  });
});
