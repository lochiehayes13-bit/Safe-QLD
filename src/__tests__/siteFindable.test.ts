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
  SITE_SEARCH_PREFIX_COLUMNS, SITE_SEARCH_TEXT_COLUMNS, siteMatches,
} from '@/domain/siteSearch';
import { parseQuery } from '@/domain/search';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

/** The site nobody has booked anything against. */
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

/** The control: a site the office has booked work against. */
const BUSY = {
  id: 'busy',
  name: 'Baldwin Living Emsworth',
  address: '3 Emsworth Street',
  suburb: 'Wynnum',
  state: 'QLD',
  clientName: 'Baldwin Living',
  siteRef: 'BL-003',
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

  it('finds the app’s screens, so this test is not passing on an empty list', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it.each(all.map((f) => [f.slice(f.indexOf('/app/') + 1), f] as const))(
    '%s renders no site list of its own',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      /*
       * The shape that goes wrong is a screen that holds every site and then
       * RENDERS them. Two other uses of the same expression are fine and have
       * to stay fine: `new Map(sites.map(…))` builds an id-to-name lookup, and
       * `sites.map(…)` feeding a domain function is a data transform — the
       * portfolio screen reshapes all three thousand into buildPortfolio's
       * input and never draws one. So the test is whether the mapped body
       * opens a component.
       */
      const listsEverySite = /\bconst \[sites[\s\S]*?(listSites\(\)|listSitePicks\(\))/.test(source);
      if (!listsEverySite) return;

      /*
       * Two shapes, because the first version of this guard looked only for
       * `sites.map(` and missed the one screen that mattered: app/work/labels
       * .tsx drew all three thousand through `<FlatList data={sites}>`. A
       * guard narrower than its own claim is worse than no guard, so it now
       * covers both ways of rendering a list.
       */
      const renders = [
        ...source.matchAll(/\bsites\.map\(/g),
        ...source.matchAll(/\bdata=\{\s*sites\b/g),
      ];
      for (const hit of renders) {
        const before = source.slice(Math.max(0, hit.index - 40), hit.index);
        if (before.includes('new Map(')) continue;
        /*
         * A rendered row opens a capitalised element in the arrow body. A
         * FlatList's `data=` needs no such check — handing it the list IS
         * rendering the list.
         */
        const body = source.slice(hit.index, hit.index + 240);
        const isList = /^\bdata=/.test(source.slice(hit.index, hit.index + 5));
        if (!isList && !/=>\s*\(?\s*<[A-Z]/.test(body)) continue;
        expect({
          screen: path.slice(path.indexOf('/app/') + 1),
          rendersWholeList: true,
          note: 'use SitePicker, which searches name, suburb, client, reference and address',
        }).toEqual({
          screen: path.slice(path.indexOf('/app/') + 1),
          rendersWholeList: false,
          note: 'use SitePicker, which searches name, suburb, client, reference and address',
        });
      }
    },
  );

  it('searches what a person standing on site actually has', () => {
    /*
     * If the picker is the one way in, its search has to cover what a person
     * has in their hand or hears over the phone. The columns are decided in
     * one place now — this used to assert the literals in SitePicker's own
     * filter, which went stale the moment the filter was shared.
     */
    for (const column of ['name', 'address', 'suburb', 'postcode', 'clientName', 'siteRef']) {
      expect({ column, searched: SITE_SEARCH_TEXT_COLUMNS.includes(column as never) })
        .toEqual({ column, searched: true });
    }
    // The office's own number is matched from the start, not anywhere inside:
    // a substring match on a bare number turns every digit into a hunt.
    expect([...SITE_SEARCH_PREFIX_COLUMNS]).toEqual(['externalId']);
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

  it('matches in memory exactly as it matches in SQL', () => {
    // A picker filtering rows it already holds must not disagree with the
    // screen that fetched them.
    const site = {
      name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610',
      clientName: 'South Burnett Regional Council', siteRef: 'SB-014', externalId: '8812',
    };
    for (const term of ['kingaroy', '4610', 'South Burnett', 'SB-014', '88']) {
      expect({ term, matched: siteMatches(site, term) }).toEqual({ term, matched: true });
    }
    for (const term of ['Toowoomba', '81', 'XX-999']) {
      expect({ term, matched: siteMatches(site, term) }).toEqual({ term, matched: false });
    }
  });
});
