/**
 * Finding an occupier statement by the building it is about.
 *
 * The module had nothing to type into. Every statement the phone holds and
 * every site the phone holds, read on each focus, ordered by what is closest
 * to being late — and no way to ask about one building. The owner's sentence,
 * "every site appears in every single module when searching a site, whether
 * there's jobs available or not", had nothing to appear in here.
 *
 * This is the module where that matters most, because the statement is the
 * occupier's and an occupier is a building: a building is the only thing
 * anybody looks one up by.
 */
import { createSite, updateSite } from '@/db/repo';
import {
  createOccupierStatement, latestSignedStatementBySite, listOccupierStatements,
  updateOccupierStatement,
} from '@/db/occupierRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

const SITE = {
  id: 'tower',
  name: 'Barren Heights Tower',
  address: '14 Markwell Street',
  suburb: 'Spring Hill',
  state: 'QLD',
  postcode: '4000',
  clientName: 'Pelham Strata Management',
  siteRef: 'SIMPRO:8812',
  externalId: '8812',
  externalSource: 'simpro',
};

beforeEach(async () => {
  db = openMigrated();
  await createSite(SITE);
  // The control, so nothing below passes because the query returns everything.
  await createSite({ id: 'other', name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610' });
  await createOccupierStatement('tower', {
    premisesName: 'Barren Heights Tower', premisesAddress: '14 Markwell Street, Spring Hill',
    occupierName: 'Dale Whitmore', signedBy: 'D Whitmore', periodEnd: '2026-06-30',
    signedAt: '2026-07-02T00:00:00.000Z',
  });
  await createOccupierStatement('other', {
    premisesName: 'Kingaroy Fire Station', occupierName: 'South Burnett Regional Council',
    periodEnd: '2026-06-30',
  });
});

afterEach(async () => { await db.closeAsync(); });

const names = async (query?: string) =>
  (await listOccupierStatements(query === undefined ? {} : { query })).rows.map((r) => r.premisesName);

describe('the columns a statement is findable by', () => {
  it.each([
    ['the site’s name', 'Barren Heights'],
    ['part of it, half remembered', 'arren'],
    ['the address', 'Markwell'],
    ['the suburb', 'Spring Hill'],
    ['the postcode', '4000'],
    ['the site’s client, who is not the occupier', 'Pelham'],
    ['the office’s site number, from the colon', '8812'],
    ['the occupier', 'Whitmore'],
  ])('finds it by %s', async (_what, q) => {
    expect({ q, found: await names(q) }).toEqual({ q, found: ['Barren Heights Tower'] });
  });

  it('needs every word to land', async () => {
    expect(await names('Barren Kingaroy')).toEqual([]);
    expect(await names('Barren Markwell')).toEqual(['Barren Heights Tower']);
  });

  it('finds it by the building’s name now, not only the one on the document', async () => {
    /*
     * The reason the site row is joined. A statement carries the premises name
     * the occupier signed, which does not change when a building is rebranded
     * — and must not, because the document says what it says. The technician
     * hunting for it has the new name.
     */
    await updateSite('tower', { name: 'Spring Hill Central' });
    expect(await names('Spring Hill Central')).toEqual(['Barren Heights Tower']);
    expect(await names('Barren Heights')).toEqual(['Barren Heights Tower']);
  });

  it('carries the site’s current name without reading every site on the phone', async () => {
    /*
     * The screen read listSites() — 897 rows — on every focus to turn a
     * statement's siteId into a name. One join on the query that was already
     * reading these rows.
     */
    db.statements.length = 0;
    const page = await listOccupierStatements({ query: 'Barren' });
    expect(page.rows[0]!.siteName).toBe('Barren Heights Tower');
    // And premisesName stays what the occupier signed, which is not the same field.
    expect(page.rows[0]!.premisesName).toBe('Barren Heights Tower');
    expect(db.statements.filter((st) => /^\s*SELECT \* FROM site/i.test(st.sql))).toEqual([]);
  });

  it('cannot hold a statement whose site is not there, so the join never has nothing to find', async () => {
    /*
     * Why siteName is `string | undefined` and the join is a LEFT one even
     * though this holds: the column says what it says rather than relying on a
     * foreign key being read correctly by whoever reads this next. The
     * constraint is asserted so that a migration relaxing it is a failing test
     * rather than a screen that quietly prints "Unnamed premises".
     */
    await expect(createOccupierStatement('no-such-site', { premisesName: 'Gone' }))
      .rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('the counts the screen prints', () => {
  it('counts what the phone holds apart from what the search matched', async () => {
    const page = await listOccupierStatements({ query: 'Barren' });
    expect({ total: page.total, matching: page.matching, drawn: page.rows.length })
      .toEqual({ total: 2, matching: 1, drawn: 1 });
  });

  it('says so where the page cuts, and the count is still the whole match', async () => {
    const page = await listOccupierStatements({ limit: 1 });
    expect({ total: page.total, matching: page.matching, drawn: page.rows.length, capped: page.capped })
      .toEqual({ total: 2, matching: 2, drawn: 1, capped: true });
  });

  it('counts within the unsent filter the three tiles read', async () => {
    /*
     * A statement the commissioner has had is settled and counts toward none
     * of overdue, to-send or unsigned — so the tiles read only the unsent ones
     * rather than every statement the company has ever made.
     */
    const before = await listOccupierStatements({ unsentOnly: true });
    expect(before.total).toBe(2);
    const sent = (await listOccupierStatements({ query: 'Barren' })).rows[0]!;
    await updateOccupierStatement(sent.id, { sentToCommissionerAt: '2026-07-10T00:00:00.000Z' });
    const after = await listOccupierStatements({ unsentOnly: true });
    expect({ total: after.total, names: after.rows.map((r) => r.premisesName) })
      .toEqual({ total: 1, names: ['Kingaroy Fire Station'] });
  });
});

describe('the one date the portfolio actually wanted', () => {
  it('is the latest signature per site, and only a signature', async () => {
    /*
     * The portfolio read every statement the phone holds, each with its
     * installation rows as JSON along for the ride, to fold them down to
     * exactly this. An unsigned draft is not a statement the occupier has
     * made, so it is not a date — counting it would restart the year.
     */
    await createOccupierStatement('tower', {
      premisesName: 'Barren Heights Tower', periodEnd: '2027-06-30',
      signedAt: '2027-07-01T00:00:00.000Z',
    });
    await createOccupierStatement('tower', { premisesName: 'Barren Heights Tower', periodEnd: '2028-06-30' });
    const map = await latestSignedStatementBySite();
    expect(map.get('tower')).toBe('2027-07-01T00:00:00.000Z');
    // The Kingaroy one was never signed, so it has no date at all.
    expect(map.has('other')).toBe(false);
  });

  it('treats an empty signature column as no signature', async () => {
    // A row saved with '' rather than NULL used to come back as a date, and a
    // site whose occupier never signed read as up to date.
    const rec = await createOccupierStatement('other', { premisesName: 'Kingaroy Fire Station' });
    await updateOccupierStatement(rec.id, { signedAt: '   ' });
    expect((await latestSignedStatementBySite()).has('other')).toBe(false);
  });

  it('reads the statements once, not one query per site', async () => {
    db.statements.length = 0;
    await latestSignedStatementBySite();
    expect(db.statements.filter((st) => /FROM occupier_statement/i.test(st.sql))).toHaveLength(1);
  });
});
