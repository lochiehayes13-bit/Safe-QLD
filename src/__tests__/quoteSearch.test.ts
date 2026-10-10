/**
 * Finding a quote by the building it is for.
 *
 * The quote list had no search box at all. The owner's sentence — "every site
 * appears in every single module when searching a site, whether there's jobs
 * available or not" — had nothing to appear in on this screen, while the
 * Simpro half of the same switch had had a search all along: two faces of one
 * screen disagreeing about whether a quote can be found.
 *
 * So this runs the real SQL against a real database and asserts three things
 * the screen depends on:
 *
 *   - a quote is findable by every column a site search covers, not by the
 *     name that happened to be copied onto it. This app's recurring fault is
 *     each search deciding for itself what matching a site means, and the fix
 *     is that this one asks siteSearchClause;
 *   - the counts over the list are the database's, taken before the cut, so
 *     "12 of 300" is true and "No quotes raised yet" is never said to somebody
 *     holding three hundred of them;
 *   - the lines come back in one read. This looped the quotes and awaited one
 *     query per quote, in series, on every focus of the screen.
 */
import { createSite, updateSite } from '@/db/repo';
import type { PriceSource, QuoteLine } from '@/domain/quote';
import { createQuote, listQuotes, setQuoteStatus, updateQuote } from '@/db/quoteRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

/**
 * One building, described the way a synced site is described.
 *
 * `siteRef: 'SIMPRO:8812'` is the shape src/simpro/sync.ts stamps, which is
 * what makes the office's number matchable from the colon rather than as a
 * substring.
 */
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

const RATE_CARD: PriceSource = { kind: 'settings', label: 'Charge-out rate from Settings', confidence: 'high' };

const line = (id: string, description: string, unitCents?: number): QuoteLine => ({
  id, section: 'labour', description, unit: 'hr', quantity: 2,
  unitCents, source: unitCents === undefined ? undefined : RATE_CARD,
  fromCodes: ['F1'], defectCount: 1,
});

beforeEach(async () => {
  db = openMigrated();
  await createSite(SITE);
  // The control: a second site, so nothing below passes because the query
  // returns everything it holds.
  await createSite({ id: 'other', name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610' });
  await createQuote({
    siteId: 'tower', reference: 'Q-BHT-2026-004', clientName: 'Body Corporate 4411',
    siteName: 'Barren Heights Tower', siteAddress: '14 Markwell Street',
    lines: [line('a', 'Replace hydrant valve', 18000), line('b', 'Re-test', 9000)],
  });
  await createQuote({
    siteId: 'other', reference: 'Q-KFS-2026-001', clientName: 'South Burnett Regional Council',
    siteName: 'Kingaroy Fire Station', lines: [line('c', 'Annual inspection', 24000)],
  });
});

afterEach(async () => { await db.closeAsync(); });

const refs = async (query?: string) =>
  (await listQuotes(query === undefined ? {} : { query })).rows.map((q) => q.reference);

describe('the columns a quote is findable by', () => {
  it.each([
    ['the site’s name', 'Barren Heights'],
    ['part of the name, half remembered', 'arren'],
    ['the address', 'Markwell'],
    ['the suburb', 'Spring Hill'],
    ['the postcode', '4000'],
    ['the site’s client', 'Pelham'],
    ['the office’s site number, from the colon', '8812'],
    ['the quote’s own reference', 'Q-BHT-2026-004'],
    ['the client the quote was made out to', 'Body Corporate'],
  ])('finds it by %s', async (_what, q) => {
    expect({ q, found: await refs(q) }).toEqual({ q, found: ['Q-BHT-2026-004'] });
  });

  it('matches the office’s number from the start and not from the middle', async () => {
    /*
     * The reason the office's number and the stamped reference are matched
     * from the start rather than as a substring: on a synced phone nearly
     * every site carries one, and "81" finding 8812 turns every digit typed
     * into a hunt through three thousand ids. Somebody reading a number off a
     * work order reads it from the start.
     */
    expect(await refs('88')).toEqual(['Q-BHT-2026-004']);
    expect(await refs('881')).toEqual(['Q-BHT-2026-004']);
    expect(await refs('81')).toEqual([]);
    expect(await refs('12')).toEqual([]);
  });

  it('needs every word to land, so two unrelated words match nothing', async () => {
    expect(await refs('Barren Kingaroy')).toEqual([]);
    expect(await refs('Barren Markwell')).toEqual(['Q-BHT-2026-004']);
  });

  it('ignores case and surrounding space, the way a search box is typed into', async () => {
    for (const q of ['  barren heights  ', 'BARREN HEIGHTS', 'Barren  Heights']) {
      expect({ q, found: await refs(q) }).toEqual({ q, found: ['Q-BHT-2026-004'] });
    }
  });

  it('finds a quote by the building’s name now, not the name copied onto it', async () => {
    /*
     * The whole reason the site row is joined rather than trusting siteName.
     * A quote carries the name as it was when it was raised; the office
     * renames a building — a strata changes managers, a tower is rebranded —
     * and every quote ever raised there becomes unfindable by the name the
     * technician now has in their hand.
     */
    await updateSite('tower', { name: 'Spring Hill Central' });
    expect(await refs('Spring Hill Central')).toEqual(['Q-BHT-2026-004']);
    // And still by the name on the document, which is what the client has.
    expect(await refs('Barren Heights')).toEqual(['Q-BHT-2026-004']);
  });

  it('returns everything when nothing is typed', async () => {
    expect((await refs()).sort()).toEqual(['Q-BHT-2026-004', 'Q-KFS-2026-001']);
    expect((await refs('')).sort()).toEqual(['Q-BHT-2026-004', 'Q-KFS-2026-001']);
  });

  it('treats a site’s own wildcards as text, so a building called 100% is searchable', async () => {
    /*
     * LIKE's own wildcards, escaped. Unescaped, "100%" is "starts with 100"
     * and a typed "%" is every row the phone holds — a search box that
     * silently means something other than what was typed into it.
     */
    await createSite({ id: 'pct', name: '100% Storage' });
    await createQuote({ siteId: 'pct', reference: 'Q-PCT-1', siteName: '100% Storage' });
    expect(await refs('100%')).toEqual(['Q-PCT-1']);
    // A bare wildcard is the character, so it finds the one site that has one
    // in its name rather than every quote on the phone.
    expect(await refs('%')).toEqual(['Q-PCT-1']);
    expect(await refs('_')).toEqual([]);
  });
});

describe('the counts the screen prints over the list', () => {
  it('counts what the phone holds apart from what the search matched', async () => {
    const page = await listQuotes({ query: 'Barren' });
    expect({ total: page.total, matching: page.matching, drawn: page.rows.length })
      .toEqual({ total: 2, matching: 1, drawn: 1 });
  });

  it('says so where the list is cut, and the count is still the whole match', async () => {
    const page = await listQuotes({ limit: 1 });
    expect({ total: page.total, matching: page.matching, drawn: page.rows.length, capped: page.capped })
      .toEqual({ total: 2, matching: 2, drawn: 1, capped: true });
  });

  it('is not capped when everything fits', async () => {
    expect((await listQuotes({})).capped).toBe(false);
  });

  it('counts within a site filter, so a site’s own screen is not told about the rest', async () => {
    const page = await listQuotes({ siteId: 'tower' });
    expect({ total: page.total, matching: page.matching }).toEqual({ total: 1, matching: 1 });
  });

  it('counts within the status filter the tiles read', async () => {
    const page = await listQuotes({ status: 'draft' });
    expect({ total: page.total, matching: page.matching }).toEqual({ total: 2, matching: 2 });
    expect((await listQuotes({ status: 'issued' })).rows).toEqual([]);
  });

  it('finds the issued ones once one is issued', async () => {
    const [draft] = (await listQuotes({ query: 'Barren' })).rows;
    await setQuoteStatus(draft!.id, 'issued', { asAt: '2026-10-01T00:00:00.000Z' });
    const page = await listQuotes({ status: 'issued' });
    expect(page.rows.map((q) => q.reference)).toEqual(['Q-BHT-2026-004']);
    expect(page.total).toBe(1);
  });
});

describe('the lines', () => {
  it('come back on the right quote, in order, with their own keys', async () => {
    /*
     * The id matters. The stored key carries the quote id as a prefix so two
     * quotes can hold a line called the same thing, and the single read has to
     * strip it exactly as listQuoteLines does — or the builder writes back a
     * line the quote does not have.
     */
    const page = await listQuotes({ query: 'Barren' });
    expect(page.rows[0]!.lines.map((l) => [l.id, l.description, l.unitCents]))
      .toEqual([['a', 'Replace hydrant valve', 18000], ['b', 'Re-test', 9000]]);
    expect((await listQuotes({ query: 'Kingaroy' })).rows[0]!.lines.map((l) => l.id)).toEqual(['c']);
  });

  it('are read in one query for the whole page, not one per quote', async () => {
    /*
     * This looped the rows and awaited a query per quote, in series, every
     * time the screen was focused — a technician backing out of a quote paid
     * for a round trip per quote on the phone before anything drew.
     */
    db.statements.length = 0;
    await listQuotes({});
    const lineReads = db.statements.filter((st) => /FROM quote_line/i.test(st.sql));
    expect({ quotes: 2, lineReads: lineReads.length }).toEqual({ quotes: 2, lineReads: 1 });
  });

  it('asks for no lines at all when nothing matched', async () => {
    db.statements.length = 0;
    expect(await refs('Nowhere At All')).toEqual([]);
    expect(db.statements.filter((st) => /FROM quote_line/i.test(st.sql))).toEqual([]);
  });

  it('keeps an unpriced line unpriced rather than calling it zero', async () => {
    await createQuote({
      siteId: 'tower', reference: 'Q-BHT-2026-005', siteName: 'Barren Heights Tower',
      lines: [line('d', 'Make good render', undefined)],
    });
    const quote = (await listQuotes({ query: 'Q-BHT-2026-005' })).rows[0]!;
    expect(quote.lines[0]!.unitCents).toBeUndefined();
    expect(quote.lines[0]!.source).toBeUndefined();
  });

  it('reads the lines a quote was updated to hold, not the ones it was created with', async () => {
    const quote = (await listQuotes({ query: 'Q-BHT-2026-004' })).rows[0]!;
    await updateQuote(quote.id, { lines: [line('z', 'One line only', 5000)] });
    expect((await listQuotes({ query: 'Q-BHT-2026-004' })).rows[0]!.lines.map((l) => l.id)).toEqual(['z']);
  });
});
