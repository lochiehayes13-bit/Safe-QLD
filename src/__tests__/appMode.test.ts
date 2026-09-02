import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  APP_MODES, DEFAULT_MODE, DESTINATIONS, TAB_ORDER, auditLinks, auditManifest, destinationAt,
  destinationsFor, hiddenFrom, keptForTechnician, navFor, reach, readMode, searchDestinations,
  shows, summarise, unreachableRoutes, validateManifest, type AppMode,
} from '@/domain/appMode';

/**
 * Technician mode.
 *
 * Two failures are worth more than everything else here and both are silent.
 *
 * The first is a screen that becomes unreachable. Hiding office work from a
 * technician is a trim; hiding it with no way back is a deletion nobody
 * decided on, and it is discovered by a technician who needs the thing at
 * four in the afternoon. So the reachability proof runs over the whole
 * manifest, in both modes, and deliberately refuses to count search as a way
 * back — search only helps someone who already knows what they are looking for.
 *
 * The second is drift. The manifest is a second copy of the router's own route
 * list, and a second copy is wrong the moment somebody adds a screen. The
 * audit walks `app/` and reports both directions, so a new route joins the
 * manifest or fails the build — this repository already had six screens no
 * menu pointed at.
 */

/** The real route list, walked rather than remembered. */
function routeFiles(): string[] {
  const root = join(__dirname, '..', '..');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx') {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(join(root, 'app'));
  return out.sort();
}

/** The real file behind a route, or undefined where there is none to read. */
function readSource(file: string): string | undefined {
  try {
    return readFileSync(join(join(__dirname, '..', '..'), file), 'utf8');
  } catch {
    return undefined;
  }
}

describe('the manifest', () => {
  it('satisfies every rule it sets itself', () => {
    // validateManifest is the whole rule set in one place: unique routes, a
    // reason on everything hidden, one root per tab, no orphans, and the file
    // written in the order the app is navigated.
    expect(validateManifest()).toEqual([]);
  });

  it('lists every screen the router actually has, and promises no screen it has not', () => {
    // Drift in either direction is the failure. A manifest entry with no file
    // is a menu row that crashes; a file with no entry is a screen that only
    // exists for whoever remembers the URL.
    const audit = auditManifest(routeFiles());
    expect(audit.missingFromApp).toEqual([]);
    expect(audit.missingFromManifest).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('names the drift rather than only counting it, so the fix is obvious', () => {
    const audit = auditManifest(['app/work/jobs.tsx', 'app/work/brand-new.tsx', 'app/_layout.tsx']);
    expect(audit.missingFromManifest).toEqual(['app/work/brand-new.tsx']);
    expect(audit.missingFromApp).toContain('app/tools/battery.tsx');
    expect(audit.ok).toBe(false);
  });

  it('ignores layouts, which are not destinations anyone navigates to', () => {
    const audit = auditManifest([...routeFiles(), 'app/_layout.tsx', 'app/(tabs)/_layout.tsx']);
    expect(audit.missingFromManifest).toEqual([]);
  });
});

describe('nothing is ever unreachable', () => {
  it('proves every route in the manifest can be navigated to in at least one mode', () => {
    // The proof that matters. Not "it is in a list somewhere" — an actual tap
    // path from a tab root, through the record that owns it where it needs one.
    expect(unreachableRoutes()).toEqual([]);
  });

  it('refuses to count search as the proof, because you cannot search for a name you have never seen', () => {
    const plan = reach('/work/plan', 'technician')!;
    expect(plan.reachable).toBe(true);
    expect(plan.channel).toBe('search');
    expect(plan.proven).toBe(false);

    // And in the mode that does list it, the same route is proven.
    expect(reach('/work/plan', 'office')).toMatchObject({ proven: true, channel: 'nav' });
  });

  it('gives the tap path for anything a mode does list, so a nav row can be checked against it', () => {
    expect(reach('/tools/detector-age', 'technician')).toMatchObject({
      channel: 'nav',
      chain: ['/tools', '/tools/detector-age'],
      sentence: 'Tools → Detector age.',
    });
  });

  it('walks the record chain for a screen that cannot open without one', () => {
    // A test sheet has no meaning without its report, which has none without
    // its site. The chain is what says so.
    expect(reach('/report/[id]', 'technician')).toMatchObject({
      channel: 'record',
      chain: ['/sites', '/site/[id]', '/report/[id]'],
      proven: true,
    });
  });

  it('says it does not know a route it has never heard of, rather than inventing a path to it', () => {
    expect(reach('/work/nothing-like-this', 'technician')).toBeUndefined();
    expect(destinationAt('/work/nothing-like-this')).toBeUndefined();
    expect(shows('technician', '/work/nothing-like-this')).toBe(false);
  });

  it('reaches everything from a tab root in Office, one declared link at a time', () => {
    // Every step of every path has to be a link somebody wrote down, not a
    // shortcut this module invented. The tab a screen is filed under is not
    // the tab it is opened from — Scan a tag is filed under Sites and opened
    // from Tools — so a chain built from tabs would read plausibly and be
    // wrong, which is the worst thing a wayfinding module can be.
    const roots = DESTINATIONS.filter((d) => d.root).map((d) => d.route);
    for (const d of DESTINATIONS) {
      const r = reach(d.route, 'office')!;
      expect(r.proven).toBe(true);
      expect(roots).toContain(r.chain[0]);
      expect(r.chain[r.chain.length - 1]).toBe(d.route);
      for (let i = 1; i < r.chain.length; i += 1) {
        expect(destinationAt(r.chain[i]!)!.openedFrom).toContain(r.chain[i - 1]!);
      }
    }
  });

  it('gives the path a screen is actually opened by, not the tab it happens to be filed under', () => {
    // Scan a tag sits in the Sites group and is opened from the Tools hub. A
    // technician told "Sites → Scan a tag" taps Sites, finds nothing, and
    // stops trusting every other sentence on the screen.
    expect(reach('/scan', 'technician')).toMatchObject({
      chain: ['/tools', '/scan'],
      sentence: 'Tools → Scan a tag.',
    });
    expect(reach('/work/route', 'technician')!.chain).toEqual(['/work', '/work/route']);
  });

  it('says a hidden screen is still opened by the action that opens it, rather than sending you to search', () => {
    // Van stock ends a restock request on the purchase request it just made,
    // and it does that in Technician mode too. Telling somebody to search for
    // a screen they were standing on is how a true setting reads as a broken one.
    const po = reach('/work/purchases', 'technician')!;
    expect(po.channel).toBe('opened');
    expect(po.proven).toBe(true);
    expect(po.chain).toEqual(['/work', '/work/stock', '/work/purchases']);
    expect(po.sentence).toContain('Van stock still opens it');
  });
});

describe('the links between the screens', () => {
  it('finds every claimed opener in the file that is supposed to contain it', () => {
    // openedFrom is what reach() prints. An entry written from memory is a tap
    // path on the settings screen that does not exist in the app, and two of
    // them were wrong the first time this manifest was written.
    expect(auditLinks(readSource)).toEqual([]);
  });

  it('names a link it cannot find rather than assuming the file must open it', () => {
    expect(auditLinks(() => 'export default function Screen() { return null; }'))
      .toContain('app/(tabs)/work.tsx does not open /work/plan, but the manifest says it does.');
  });

  it('treats a file it cannot read as unverified, not as verified', () => {
    expect(auditLinks(() => undefined)[0]).toContain('could not be read');
  });
});

describe('technician mode', () => {
  it('is the default, because the phone this ships to is in a van', () => {
    // A mode switch that starts by showing everything is only ever found by
    // the people who did not need it.
    expect(DEFAULT_MODE).toBe('technician');
  });

  it('shows strictly less than office, and never anything office does not', () => {
    const tech = destinationsFor('technician');
    const office = destinationsFor('office');
    expect(tech.length).toBeLessThan(office.length);
    expect(office).toEqual(expect.arrayContaining(tech));
    expect(office.length).toBe(DESTINATIONS.length);
  });

  it('holds back only the work a technician cannot act on, and says which', () => {
    // Pinned by route so that hiding anything further is a decision somebody
    // makes on purpose, in this test, rather than a line in a diff.
    expect(hiddenFrom('technician').map((h) => h.destination.route).sort()).toEqual([
      // What is out with clients and what it is worth. Same argument as
      // /site/quote: the number commits the company, and a technician asked
      // in a corridor should not be the one who answers it.
      '/quotes',
      '/site/quote',
      '/work/baselines',
      '/work/labels',
      '/work/plan',
      // How 897 sites are going is not a question anybody answers from a plant
      // room, and it is not actionable by the person standing in one. The site
      // in front of them already shows its own state in full.
      '/work/portfolio',
      '/work/purchases',
    ]);
    expect(hiddenFrom('office')).toEqual([]);
  });

  it('gives a reason a technician can read and disagree with for every hidden item', () => {
    for (const note of hiddenFrom('technician')) {
      expect(note.because.length).toBeGreaterThan(40);
      expect(note.shownIn).toEqual(['office']);
      expect(note.stillReachedBy.reachable).toBe(true);
      expect(note.stillReachedBy.sentence).toContain('Nothing was deleted.');
    }
  });

  it('writes down why the office-looking things that stayed, stayed', () => {
    // The argument for cutting timesheets gets made every few months. The
    // answer lives here rather than in whoever was in the room.
    const kept = keptForTechnician().map((d) => d.route);
    expect(kept).toContain('/work/timesheets');
    expect(kept).toContain('/work/reports');
    for (const d of keptForTechnician()) expect(d.keptBecause!.length).toBeGreaterThan(40);
  });

  it('counts what it is doing, so the setting is not taken on trust', () => {
    const tech = summarise('technician');
    const office = summarise('office');
    expect(tech.total).toBe(DESTINATIONS.length);
    expect(tech.hidden).toBe(7);
    expect(office.hidden).toBe(0);
    expect(tech.listed).toBeLessThan(office.listed);
  });
});

describe('the grouping', () => {
  it('runs in the order a technician works: today, the site, the tools, the paperwork, setup', () => {
    expect(navFor('technician').map((g) => g.tab)).toEqual(['today', 'sites', 'tools', 'work', 'settings']);
    expect(navFor('office').map((g) => g.tab)).toEqual([...TAB_ORDER]);
  });

  it('opens each tab with the screen that tab is, then the rows under it', () => {
    const today = navFor('technician')[0]!;
    expect(today.sections[0]!.title).toBe('The day');
    expect(today.sections[0]!.destinations.slice(0, 3).map((d) => d.label))
      .toEqual(['Home', 'Jobs', "Today's run"]);
  });

  it('puts the calculators before the reference, because that is the order they get reached for', () => {
    const tools = navFor('technician').find((g) => g.tab === 'tools')!;
    expect(tools.sections.map((s) => s.title)).toEqual(['Calculators', 'Reference']);
  });

  it('never offers a row that opens a record screen with no record', () => {
    // /site/[id] with no id is a dead end, and a menu full of dead ends is how
    // a technician stops trusting the menu.
    for (const mode of APP_MODES) {
      for (const group of navFor(mode)) {
        for (const section of group.sections) {
          for (const d of section.destinations) expect(d.needsContext).toBeFalsy();
        }
      }
    }
  });

  it('drops the whole planning section from a technician rather than leaving an empty heading', () => {
    const techWork = navFor('technician').find((g) => g.tab === 'work')!;
    const officeWork = navFor('office').find((g) => g.tab === 'work')!;
    expect(techWork.sections.map((s) => s.title)).not.toContain('Planning');
    expect(officeWork.sections.map((s) => s.title)).toContain('Planning');
  });

  it('keeps every section it shows populated in both modes', () => {
    for (const mode of APP_MODES) {
      for (const group of navFor(mode)) {
        expect(group.sections.length).toBeGreaterThan(0);
        for (const section of group.sections) expect(section.destinations.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('finding a screen that is not in front of you', () => {
  it('finds a hidden screen by name and says it is hidden, rather than pretending it is gone', () => {
    const hits = searchDestinations('work planner', 'technician');
    expect(hits[0]!.destination.route).toBe('/work/plan');
    expect(hits[0]!.hidden).toBe(true);
    expect(hits[0]!.matched).toBe('name');
  });

  it('searches the whole app whatever the mode, because a trimmed menu is not a locked one', () => {
    for (const mode of APP_MODES) {
      expect(searchDestinations('quote', mode).map((h) => h.destination.route)).toContain('/site/quote');
      expect(searchDestinations('asset labels', mode)[0]!.destination.route).toBe('/work/labels');
    }
  });

  it('finds a screen by the word a technician would actually use for it', () => {
    expect(searchDestinations('date code', 'technician')[0]!.destination.route).toBe('/tools/detector-age');
    expect(searchDestinations('isolate', 'technician')[0]!.destination.route).toBe('/impairment/new');
    expect(searchDestinations('lux', 'technician')[0]!.destination.route).toBe('/tools/emergency-lighting');
  });

  it('returns nothing rather than the nearest thing lying around', () => {
    expect(searchDestinations('kayak trailer hire', 'technician')).toEqual([]);
    // One letter matches half the app, and half the app is not an answer.
    expect(searchDestinations('a', 'technician')).toEqual([]);
    expect(searchDestinations('  ', 'technician')).toEqual([]);
  });

  it('tells a technician how to get back to a hidden record screen, which search alone cannot open', () => {
    const quote = reach('/site/quote', 'technician')!;
    expect(quote.channel).toBe('link');
    expect(quote.reachable).toBe(true);
    expect(quote.sentence).toContain('direct link');
    expect(quote.sentence).toContain('Site');
  });
});

describe('reading the saved mode back', () => {
  it('takes a mode it recognises without comment', () => {
    expect(readMode('office')).toEqual({ mode: 'office' });
    expect(readMode('technician')).toEqual({ mode: 'technician' });
  });

  it('falls back to technician on a device that has never chosen', () => {
    expect(readMode(undefined)).toEqual({ mode: DEFAULT_MODE });
    expect(readMode('')).toEqual({ mode: DEFAULT_MODE });
  });

  it("says what it did with a value it does not understand, rather than reverting overnight in silence", () => {
    // A preference written by a newer build should show up as a sentence on
    // the settings screen, not as a mode that quietly changed itself.
    const read = readMode('supervisor');
    expect(read.mode).toBe(DEFAULT_MODE);
    expect(read.assumed).toContain('supervisor');
    expect(read.assumed).toContain('Technician');
  });
});

describe('what the settings screen shows', () => {
  it('describes every destination in one line, so a nav row never needs the screen open to explain it', () => {
    for (const d of DESTINATIONS) {
      expect(d.blurb.length).toBeGreaterThan(20);
      expect(d.label.length).toBeGreaterThan(1);
      expect(d.terms.length).toBeGreaterThan(1);
    }
  });

  it('covers both modes with the same manifest, so the two views cannot disagree about what exists', () => {
    const counted = new Set<string>();
    for (const mode of APP_MODES as AppMode[]) for (const d of destinationsFor(mode)) counted.add(d.route);
    expect(counted.size).toBe(DESTINATIONS.length);
  });
});
