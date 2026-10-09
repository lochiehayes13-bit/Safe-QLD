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
    expect(map).toContain('!shown.length && !unplaced.shown.length');
  });

  it('says how many it holds rather than how many it drew', () => {
    /*
     * It listed four and wrote "4 on this phone, but nothing knows where they
     * are yet". With eleven matching, that is not a cut list — it is a wrong
     * sentence about how many buildings the phone is holding, on the screen
     * whose whole job here is to stop the app denying a site it has.
     */
    expect(map).toContain('matching: all.length');
    expect(map).toContain('unplaced.matching > unplaced.shown.length');
  });

  it('offers the matched sites rather than only reporting them', () => {
    // "We have it and cannot show you" is useful only with the way through.
    expect(map).toContain("'Not on the map yet:'");
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

describe('starting a Form 72 for a site with no job', () => {
  /*
   * /site/form72 redirects to /form72/new when it is opened with no site —
   * from the home screen, or a pinned tile — and that screen was a job picker
   * and nothing else. So a site with no job could not start a Form 72 from the
   * one screen that exists to start them, and plenty of this work is done
   * before the office books anything. The empty state even said that, and
   * offered no way to do it: it named the capability and withheld it.
   */
  const screen = readFileSync(
    join(__dirname, '..', '..', 'app', 'form72', 'new.tsx'), 'utf8',
  );

  it('offers a site as well as a job', () => {
    expect(screen).toContain('title="Pick a site instead"');
    expect(screen).toContain('<SitePicker');
  });

  it('routes to the screen that already creates it properly', () => {
    /*
     * Rather than a second create path. /site/form72 does the register
     * prefill, writes the address as the form prints it, and auto-links the
     * job where the site has exactly one open — a second copy of that would
     * be a second thing to keep right.
     */
    expect(screen).toContain("router.push({ pathname: '/site/form72', params: { siteId: id } })");
  });

  it('reads the site list only when the site route is opened', () => {
    // Three thousand rows that most visits to this screen never need.
    expect(screen).toContain('if (sites.length) return;');
    expect(screen).toContain('setSites(await listSitePicks());');
  });

  it('says so if the site list cannot be read, rather than showing an empty picker', () => {
    expect(screen).toContain("showAlert('Could not read the site list'");
  });
});

describe('the SWMS builder’s site surface', () => {
  /*
   * This module had none: no SitePicker, no site lister, nothing — and its
   * gate refused to enable Start without a job. So a crew at a site the office
   * had not raised a job for could not have a safe work method statement,
   * which is the one document that should never wait on the office's
   * paperwork. The empty state even said "you can still pick statements below
   * and add the job later" while the button it referred to stayed disabled.
   */
  const screen = readFileSync(
    join(__dirname, '..', '..', 'app', 'swms', 'new.tsx'), 'utf8',
  );

  it('offers the site as well as the job', () => {
    expect(screen).toContain('title="No job — pick the site"');
    expect(screen).toContain('<SitePicker');
  });

  it('passes the site to the gate and to the draft', () => {
    expect(screen).toContain('builderNotReady({ job, siteId: site?.id, templateIds: selected })');
    expect(screen).toContain('siteId: site?.id,');
    expect(screen).toContain('siteName: site?.name,');
  });

  it('no longer promises what the disabled button refused', () => {
    expect(screen).not.toContain('you can still pick statements below and add the job later');
    expect(screen).toContain('or pick the site this work is at');
  });

  it('reads the site list only when it is asked for', () => {
    expect(screen).toContain('if (sites.length) return;');
    expect(screen).toContain('setSites(await listSitePicks());');
  });
});
