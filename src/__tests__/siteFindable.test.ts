/**
 * Every site is findable, whether or not anything is attached to it.
 *
 * The owner's words: "every site appears in every single module when searching
 * a site. Whether there's jobs available or not."
 *
 * The failure this guards against is specific and it is silent. A site list
 * built from jobs, or joined to one, looks correct on the owner's own data —
 * where nearly every site has a job — and loses exactly the sites a technician
 * is most likely to be hunting for: the one raised on the phone this morning,
 * the one the office has not booked work against yet, the one whose jobs are
 * all closed and purged. Nothing errors. The site simply is not there, and the
 * person looking concludes they typed it wrong.
 *
 * So this runs the real SQL against a real database holding one site with
 * NOTHING attached — no job, no panel, no point, no asset, no defect, no
 * report, no quote, and no Simpro id — and asserts it comes back from every
 * path the app has for finding a site. A second site with a job is the control:
 * it proves the assertions are not passing because the queries return
 * everything regardless.
 */
import {
  createSite, getSite, listSitePicks, listSiteSummaries, listSites,
} from '@/db/repo';
import { getSiteByExternalId, searchEverything, searchKind } from '@/db/searchRepo';
import {
  SITE_SEARCH_COLUMNS, SITE_SEARCH_PREFIX_COLUMNS, SITE_SEARCH_STAMPED_COLUMN,
  SITE_SEARCH_TEXT_COLUMNS, siteMatches,
} from '@/domain/siteSearch';
import { parseQuery } from '@/domain/search';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

/**
 * The site nobody has booked anything against.
 *
 * Typed in on the phone, so its reference is the technician's own free text
 * and it has no Simpro id — which is what makes it the site most likely to be
 * hunted for, and the one a job-shaped query loses.
 */
const BARE = {
  id: 'bare',
  name: 'Kingaroy Fire Station',
  address: '14 Markwell Street',
  suburb: 'Kingaroy',
  state: 'QLD',
  postcode: '4610',
  clientName: 'South Burnett Regional Council',
  siteRef: 'SB-014',
};

/**
 * The control: a site the office has booked work against.
 *
 * `siteRef: 'SIMPRO:8812'` is the shape the sync actually writes
 * (src/simpro/sync.ts stamps it on every synced site), and the fixture used
 * to carry 'BL-003' instead — a shape the sync never writes. That made the
 * prefix test below pass for the wrong reason: 'siteRef LIKE "%81%"' finds
 * 'SIMPRO:8812' and does not find 'BL-003', so the assertion that "81" misses
 * was true of the fixture and false of every real phone.
 */
const BUSY = {
  id: 'busy',
  name: 'Baldwin Living Emsworth',
  address: '3 Emsworth Street',
  suburb: 'Wynnum',
  state: 'QLD',
  postcode: '4178',
  clientName: 'Baldwin Living',
  siteRef: 'SIMPRO:8812',
  externalId: '8812',
  externalSource: 'simpro',
};

beforeEach(async () => {
  db = openMigrated();
  await createSite(BARE);
  await createSite(BUSY);
  // One job, against the busy site only. This is the whole point of the
  // fixture: if a lister is reading jobs, BARE vanishes and BUSY does not.
  await db.runAsync(
    `INSERT INTO job (id, siteId, siteName, title, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'j1', BUSY.id, BUSY.name, 'Annual Fire Hydrant Service', 'scheduled',
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
  );
});

afterEach(async () => { await db.closeAsync(); });

describe('the lists a picker is built from', () => {
  it('listSites holds a site with nothing attached', async () => {
    const names = (await listSites()).map((s) => s.name);
    expect(names).toContain(BARE.name);
    expect(names).toContain(BUSY.name);
  });

  it('listSitePicks holds it too, with the six fields a picker draws', async () => {
    const picks = await listSitePicks();
    const bare = picks.find((s) => s.id === BARE.id);
    expect(bare).toMatchObject({
      name: BARE.name, suburb: BARE.suburb, clientName: BARE.clientName, siteRef: BARE.siteRef,
    });
  });

  it('getSite reads it back by id', async () => {
    expect((await getSite(BARE.id))?.name).toBe(BARE.name);
  });

  it('orders by name rather than by anything attached', async () => {
    // Alphabetical puts Baldwin before Kingaroy. A list ordered by job count,
    // or by a most-recent-job date, would put the bare site last or nowhere.
    expect((await listSites()).map((s) => s.id)).toEqual(['busy', 'bare']);
  });
});

describe('the site list the sites tab and the needs screen read', () => {
  it('returns a site with nothing attached, with zero counts rather than no row', async () => {
    const page = await listSiteSummaries();
    const bare = page.rows.find((r) => r.id === BARE.id);
    expect(bare).toBeDefined();
    expect(bare).toMatchObject({ panelCount: 0, pointCount: 0, openDefects: 0 });
  });

  it('counts it in the total', async () => {
    const page = await listSiteSummaries();
    expect(page.total).toBe(2);
    expect(page.matching).toBe(2);
  });

  it.each([
    ['name', 'Kingaroy'],
    ['part of the name', 'ingaro'],
    ['suburb', 'Kingaroy'],
    ['address', 'Markwell'],
    ['client', 'South Burnett'],
    ['site reference', 'SB-014'],
  ])('finds it by %s', async (_what, term) => {
    const page = await listSiteSummaries({ query: term });
    expect(page.rows.map((r) => r.id)).toContain(BARE.id);
  });

  it('finds it whatever case the search is typed in', async () => {
    expect((await listSiteSummaries({ query: 'KINGAROY' })).rows.map((r) => r.id))
      .toContain(BARE.id);
    expect((await listSiteSummaries({ query: 'kingaroy' })).rows.map((r) => r.id))
      .toContain(BARE.id);
  });

  it('does not need a Simpro id to be listed', async () => {
    // A site raised on the phone this morning has no externalId. It is the one
    // a technician is most likely to be hunting for.
    const bare = (await listSiteSummaries()).rows.find((r) => r.id === BARE.id);
    expect(bare).toBeDefined();
    /*
     * Falsy rather than undefined: the row comes straight back from SQLite, so
     * an absent Simpro id reads as null while Site types it `string |
     * undefined`. Worth knowing — code testing it against undefined would be
     * wrong — but not what this test is about.
     */
    expect((await getSite(BARE.id))?.externalId).toBeFalsy();
  });

  it('reports when the page is capped, so a caller can say the list ended', async () => {
    const page = await listSiteSummaries({ limit: 1 });
    expect(page.capped).toBe(true);
    expect(page.matching).toBe(2);
  });

  it('reaches a site past the cap by searching for it', async () => {
    // The cap is why search has to run in the statement rather than over the
    // page: Kingaroy sorts second, so a limit of one hides it until it is the
    // thing being searched for.
    expect((await listSiteSummaries({ limit: 1 })).rows.map((r) => r.id)).toEqual(['busy']);
    const found = await listSiteSummaries({ query: 'Kingaroy', limit: 1 });
    expect(found.rows.map((r) => r.id)).toEqual(['bare']);
    expect(found.capped).toBe(false);
  });
});

describe('the global search', () => {
  const sites = async (term: string) =>
    (await searchKind('site', parseQuery(term), 20)).map((h) => h.id);

  it.each([
    ['name', 'Kingaroy'],
    ['address', 'Markwell'],
    ['suburb', 'Kingaroy'],
    ['site reference', 'SB-014'],
    ['client', 'South Burnett'],
  ])('finds a site with nothing attached by %s', async (_what, term) => {
    expect(await sites(term)).toContain(BARE.id);
  });

  it('finds it through searchEverything, which is what the search screen calls', async () => {
    const hits = await searchEverything('Kingaroy');
    expect(hits.some((h) => h.kind === 'site' && h.id === BARE.id)).toBe(true);
  });

  it('finds the busy site too, so the search is not simply returning everything', async () => {
    expect(await sites('Baldwin')).toContain(BUSY.id);
    expect(await sites('Baldwin')).not.toContain(BARE.id);
  });

  it('answers nothing for a term no site carries', async () => {
    expect(await sites('Toowoomba')).toEqual([]);
  });

  it('reads a synced site by its Simpro id, and is unbothered by one without', async () => {
    expect((await getSiteByExternalId('8812'))?.id).toBe(BUSY.id);
    expect(await getSiteByExternalId('nothing')).toBeNull();
  });
});

describe('what the queries are allowed to touch', () => {
  /*
   * The structural guard, in case somebody later "optimises" one of these by
   * joining a count in. A site list that mentions the job table is a site list
   * that can lose a site, and the SQL is the only place that is visible.
   */
  const sql = (needle: string): string[] =>
    db.statements.map((st) => st.sql).filter((s) => s.includes(needle));

  it('builds the picker lists from the site table alone', async () => {
    db.statements.length = 0;
    await listSites();
    await listSitePicks();
    for (const statement of sql('FROM site')) {
      expect({ statement, mentionsJob: /\bjob\b/i.test(statement) })
        .toEqual({ statement, mentionsJob: false });
    }
  });

  it('builds the site summary from the site table, counting only what it shows', async () => {
    db.statements.length = 0;
    await listSiteSummaries();
    const statements = db.statements.map((st) => st.sql).filter((s) => /FROM site/i.test(s));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      // Panels, points and open defects are the three figures the row prints,
      // and each is a subquery, so a site with none of them still has a row.
      expect({ statement, mentionsJob: /\bjob\b/i.test(statement) })
        .toEqual({ statement, mentionsJob: false });
      expect({ statement, innerJoin: /\bINNER\s+JOIN\b/i.test(statement) })
        .toEqual({ statement, innerJoin: false });
    }
  });

  it('searches the site table alone', async () => {
    db.statements.length = 0;
    await searchKind('site', parseQuery('Kingaroy'), 20);
    const statements = db.statements.map((st) => st.sql).filter((s) => /FROM site/i.test(s));
    expect(statements.length).toBe(1);
    expect(/\bjob\b/i.test(statements[0]!)).toBe(false);
  });
});

describe('every screen that offers a site offers a way to search for it', () => {
  /*
   * The other half of "every site appears in every module": a list is only a
   * list if the site can be reached in it. Three thousand sites as a
   * horizontal strip of chips is a minute of scrolling and then a guess, and
   * the site a technician wants is rarely near the left of the alphabet — the
   * SitePicker component exists because of exactly that, and says so in its
   * own note.
   *
   * It was written, two screens were converted to it, and two more were
   * missed: adding an asset, and importing a panel. So this is the guard that
   * a third one cannot be written. A screen that renders the whole site list
   * itself has to go through the picker.
   */
  const screens = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return screens(path);
    return name.endsWith('.tsx') ? [path] : [];
  });

  const all = screens(join(__dirname, '..', '..', 'app'));
  const named = (f: string) => f.slice(f.indexOf('/app/') + 1);

  it('finds the app’s screens, so this test is not passing on an empty list', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  /**
   * The screens that read every site and are right to.
   *
   * Each is here with its reason, because an allow-list without one is a
   * list of screens somebody could not be bothered to check. None of them
   * offers a site to pick: they build an id-to-name lookup to label rows
   * they already have, or hand the whole list to a domain function that
   * draws none of it.
   */
  const ALLOWED: Record<string, string> = {
    'app/customer/[id].tsx': 'maps the office’s site numbers onto this phone’s ids, to open this customer’s own sites',
    'app/occupier/index.tsx': 'an id-to-site lookup, to put a name under each statement',
    'app/work/defects.tsx': 'an id-to-name lookup, to put a site under each defect',
    'app/work/outbound.tsx': 'an id-to-site lookup, for the rows already on screen',
    'app/work/portfolio.tsx': 'hands every site to buildPortfolio, which draws none of them',
    'app/work/reports.tsx': 'an id-to-site lookup, to put a name under each report',
  };

  /*
   * Anchored on where the rows come from, not on what the variable is called.
   *
   * The first version of this looked for `const [sites` and then for
   * `sites.map(` with a JSX arrow body. A screen holding
   * `const [allSites] = useState(…)` from listSitePicks() and rendering
   * `allSites.map((s) => { return <Chip … /> })` walked straight through it,
   * and so did every other spelling — while the test's name claimed a third
   * raw site list could not be written. A guard narrower than the claim made
   * for it is worse than no guard, which is the lesson this file already
   * carries one paragraph up about `<FlatList data={sites}>`.
   *
   * So: a screen that reads the whole site list must go through the picker,
   * and the handful that legitimately do not are named above with why.
   */
  it.each(all.map((f) => [named(f), f] as const))(
    '%s reads the whole site list only through the picker',
    (name, path) => {
      const source = readFileSync(path, 'utf8');
      const readsEverySite = /\blistSites\s*\(|\blistSitePicks\s*\(/.test(source);
      if (!readsEverySite || ALLOWED[name]) return;
      expect({
        screen: name,
        goesThroughThePicker: source.includes('SitePicker'),
        note: 'use SitePicker, which searches name, suburb, client, reference and address',
      }).toEqual({
        screen: name,
        goesThroughThePicker: true,
        note: 'use SitePicker, which searches name, suburb, client, reference and address',
      });
    },
  );

  it('every screen on the allow-list still reads every site, so the list cannot go stale', () => {
    // A name left here after the screen stopped reading the list is a hole
    // nobody would notice: the next screen to take that path is exempt.
    for (const name of Object.keys(ALLOWED)) {
      const path = all.find((f) => named(f) === name);
      expect({ name, present: !!path }).toEqual({ name, present: true });
      const source = readFileSync(path!, 'utf8');
      expect({ name, reads: /\blistSites\s*\(|\blistSitePicks\s*\(/.test(source) })
        .toEqual({ name, reads: true });
    }
  });

  it('and none of them draws a site list to pick from', () => {
    /*
     * The reason each one is allowed, checked rather than taken on trust: a
     * lookup is built with `new Map(`, and the portfolio hands its list to a
     * domain function. A screen on this list that started rendering sites
     * would be the fourth raw site list, exempted by its own entry.
     */
    for (const name of Object.keys(ALLOWED)) {
      const source = readFileSync(all.find((f) => named(f) === name)!, 'utf8');
      const lookupOrDomain = source.includes('new Map(') || source.includes('buildPortfolio');
      expect({ name, lookupOrDomain }).toEqual({ name, lookupOrDomain: true });
    }
  });

  /*
   * The fallback is wired whole, or not at all.
   *
   * A module that has none of what was asked for says "the site below does —
   * open it" and then has to draw one. The two halves were written inline on
   * the job list and the quote list needed them next, which is how four site
   * searches over four afternoons happened the first time; they are one
   * component and one sentence now, and these hold a screen to using both.
   */
  it('every screen that promises a site below it draws one', () => {
    for (const path of all) {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('siteFallbackWords')) continue;
      expect({ screen: named(path), draws: source.includes('SiteMissCards') })
        .toEqual({ screen: named(path), draws: true });
    }
  });

  it('and every screen that draws them looks for them', () => {
    for (const path of all) {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('SiteMissCards')) continue;
      expect({ screen: named(path), looks: source.includes('useSiteMisses') })
        .toEqual({ screen: named(path), looks: true });
    }
  });

  it('is used by more than one screen, so this is not a guard over nothing', () => {
    const using = all.filter((p) => readFileSync(p, 'utf8').includes('useSiteMisses')).map(named);
    expect(using).toContain('app/work/jobs.tsx');
    expect(using).toContain('app/quotes/index.tsx');
  });

  it('searches what a person standing on site actually has', () => {
    /*
     * If the picker is the one way in, its search has to cover what a person
     * has in their hand or hears over the phone. The columns are decided in
     * one place now — this used to assert the literals in SitePicker's own
     * filter, which went stale the moment the filter was shared.
     */
    for (const column of ['name', 'address', 'suburb', 'clientName']) {
      expect({ column, searched: SITE_SEARCH_TEXT_COLUMNS.includes(column as never) })
        .toEqual({ column, searched: true });
    }
    /*
     * The numbers are matched from the start, not anywhere inside: a substring
     * match on a bare number turns every digit into a hunt, and two digits of
     * a postcode mean the area rather than any number containing them.
     */
    expect([...SITE_SEARCH_PREFIX_COLUMNS]).toEqual(['externalId', 'postcode']);
    /*
     * And the reference is its own thing, because it is two things: free text
     * where a technician typed it, and a stamped number where the sync wrote
     * it. Matching the stamped form as text is what made "81" find site 8812.
     */
    expect(SITE_SEARCH_STAMPED_COLUMN).toBe('siteRef');
    expect([...SITE_SEARCH_COLUMNS].sort()).toEqual(
      ['address', 'clientName', 'externalId', 'name', 'postcode', 'siteRef', 'suburb'],
    );
  });

  it('is the same definition in every search, which is the whole point', () => {
    /*
     * Four searches each had their own column list and the differences were
     * the bug: the sites tab missed the postcode and the office's number, the
     * planner missed the client and the reference. A search that writes its
     * own LIKE clause is how they drifted, so none of them may.
     */
    const files = [
      ['src/db/repo.ts', 'listSiteSummaries'],
      ['src/db/siteHistoryRepo.ts', 'planCandidates'],
      ['src/db/searchRepo.ts', 'the global search'],
      ['src/components/SitePicker.tsx', 'the picker'],
    ] as const;
    for (const [file, what] of files) {
      const source = readFileSync(join(__dirname, '..', '..', file), 'utf8');
      expect({ what, usesTheOneDefinition: source.includes('@/domain/siteSearch') })
        .toEqual({ what, usesTheOneDefinition: true });
    }
  });

  it('matches a site by its postcode and by the office’s number', async () => {
    // The owner's own complaint: "the number read out over the phone finds
    // nothing". Both are run through the real SQL rather than the helper.
    expect((await listSiteSummaries({ query: '4610' })).rows.map((r) => r.id)).toContain(BARE.id);
    expect((await listSiteSummaries({ query: '8812' })).rows.map((r) => r.id)).toContain(BUSY.id);
  });

  it('matches the office’s number from the start and not from the middle', async () => {
    // 8812: "88" finds it, "81" does not. A substring match on a bare number
    // turns a search containing digits into a hunt through three thousand ids.
    expect((await listSiteSummaries({ query: '88' })).rows.map((r) => r.id)).toContain(BUSY.id);
    expect((await listSiteSummaries({ query: '81' })).rows.map((r) => r.id)).not.toContain(BUSY.id);
  });

  it('reads a stamped reference as the number it is, not as text', async () => {
    /*
     * The sync writes siteRef = 'SIMPRO:8812' on every synced site, so nearly
     * every reference on a real phone is a stamped number. Matched as a
     * substring it made every digit a hunt — "81" found 8812 and "34" found
     * 3349 — which defeated the prefix rule externalId exists for. The number
     * after the colon is matched from the start, like the number it is.
     */
    const finds = async (q: string) => (await listSiteSummaries({ query: q })).rows.map((r) => r.id);
    expect(await finds('88')).toContain(BUSY.id);
    expect(await finds('8812')).toContain(BUSY.id);
    expect(await finds('81')).not.toContain(BUSY.id);
    expect(await finds('12')).not.toContain(BUSY.id);
    // And the stamp's own word is not a search term for every synced site.
    expect(await finds('SIMPRO')).not.toContain(BUSY.id);
  });

  it('still matches a reference somebody typed themselves, as text', async () => {
    // A site entered on the phone carries whatever the technician wrote.
    expect((await listSiteSummaries({ query: 'SB-014' })).rows.map((r) => r.id)).toContain(BARE.id);
    expect((await listSiteSummaries({ query: 'B-01' })).rows.map((r) => r.id)).toContain(BARE.id);
  });

  it('matches a postcode from the start, so two digits mean the area', async () => {
    // "46" is 46xx, not every number containing 46 — BARE is 4610, BUSY 4178.
    const finds = async (q: string) => (await listSiteSummaries({ query: q })).rows.map((r) => r.id);
    expect(await finds('4610')).toContain(BARE.id);
    expect(await finds('46')).toContain(BARE.id);
    expect(await finds('46')).not.toContain(BUSY.id);
    expect(await finds('17')).not.toContain(BUSY.id);
  });

  it('matches in memory exactly as it matches in SQL', () => {
    // A picker filtering rows it already holds must not disagree with the
    // screen that fetched them.
    const site = {
      name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610',
      clientName: 'South Burnett Regional Council', siteRef: 'SB-014', externalId: '8812',
    };
    for (const term of ['kingaroy', '4610', '46', 'South Burnett', 'SB-014', '88']) {
      expect({ term, matched: siteMatches(site, term) }).toEqual({ term, matched: true });
    }
    for (const term of ['Toowoomba', '81', 'XX-999']) {
      expect({ term, matched: siteMatches(site, term) }).toEqual({ term, matched: false });
    }
    // And the colon rule, on the shape the sync writes.
    const synced = { name: 'Baldwin Living', siteRef: 'SIMPRO:8812', externalId: '8812' };
    expect(siteMatches(synced, '88')).toBe(true);
    expect(siteMatches(synced, '81')).toBe(false);
    expect(siteMatches(synced, 'SIMPRO')).toBe(false);
  });
});
