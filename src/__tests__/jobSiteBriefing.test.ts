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

describe('controls that used to do nothing', () => {
  /*
   * Three presses in this app were swallowed on a site with nothing attached:
   * a bare `return` on an export, a form that rendered nothing when there was
   * no panel to attach it to, and a "pick a site" alert on a screen that had
   * the whole site list in hand. A control that does nothing and says nothing
   * is read as the app being broken, which is a worse conclusion than the
   * true one — and the third is the owner's ask in miniature: the site was
   * right there and the module would not give it to you.
   */
  const read = (...parts: string[]): string =>
    readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');

  it('the zone export says why rather than returning', () => {
    const zones = read('app', 'site', 'zones.tsx');
    expect(zones).not.toContain('if (!panel || !zones.length) return;');
    expect(zones).toContain("showAlert(\n        'No panel selected',");
    expect(zones).toContain("'This panel has no zones',");
  });

  it('cause and effect says a site with no panel has nothing to attach a rule to', () => {
    const ce = read('app', 'site', 'cause-effect.tsx');
    expect(ce).toContain('{adding && !panelId ? (');
    expect(ce).toContain('This site has no panel on the phone yet');
  });

  it('baseline data offers the site list it already holds', () => {
    const b = read('app', 'work', 'baselines.tsx');
    expect(b).not.toContain("showAlert('Pick a site'");
    expect(b).toContain('setPicking(all)');
    expect(b).toContain('<SitePicker');
  });
});

describe('a site the map cannot place', () => {
  /*
   * buildPins skips a site with no position and counts it as `unlocated`,
   * which is right — there is nothing to draw. But the map then judged its
   * search by the pins, so searching for a building that is on the phone and
   * has no position answered "Nothing found for 'Kingaroy'". That is the one
   * thing this app must not say about a site it holds, and it is the owner's
   * complaint word for word.
   */
  const map = readFileSync(
    join(__dirname, '..', '..', 'app', '(tabs)', 'map.tsx'), 'utf8',
  );

  it('does not call it nothing found when a site matched and has no position', () => {
    expect(map).not.toContain('else if (!shown.length) setPlaceError');
    expect(map).toContain('!shown.length && !unplaced.length');
  });

  it('offers the matched sites rather than only reporting them', () => {
    // "We have it and cannot show you" is useful only with the way through.
    expect(map).toContain('On this phone, but nothing knows where it is yet');
    expect(map).toContain("router.push({ pathname: '/site/[id]', params: { id: site.id } })");
  });

  it('matches them by the same definition every other site search uses', () => {
    // The map was also the one place that could not match a site reference or
    // the office's own number.
    expect(map).toContain("import { siteMatches } from '@/domain/siteSearch';");
    expect(map).toContain('siteMatches(site, q)');
  });

  it('excludes the sites that do have a pin, so nothing is listed twice', () => {
    expect(map).toContain('const placed = new Set(pins.map((p) => p.siteId));');
    expect(map).toContain('!placed.has(site.id)');
  });
});
