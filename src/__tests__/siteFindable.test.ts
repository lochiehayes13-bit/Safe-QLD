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
import { parseQuery } from '@/domain/search';
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
