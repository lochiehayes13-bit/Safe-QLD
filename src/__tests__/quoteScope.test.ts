/**
 * A quote keeps its scope, and prices its materials off the office catalogue.
 *
 * Two faults, both on the quote a client is sent.
 *
 *   - The scope of works was printed from the defects on screen and never
 *     stored, so reprinting a quote from the quote list printed "No scope
 *     items were recorded against this quotation" over a page of priced work.
 *     The scope now goes into the quote row when it is saved (schema v40) and
 *     comes back with it.
 *   - Material lines were only ever priced by typing. The synced Simpro
 *     catalogue holds the office's sell price for the parts it stocks, and a
 *     line the catalogue sells under the same name now takes that price. Sell
 *     price only: the catalogue mirror has no cost or markup column.
 *
 * Run against the real schema on Node's SQLite, through the repository.
 */
import { createSite } from '@/db/repo';
import { createQuote, getQuote, listQuotes, officeCataloguePrices, updateQuote } from '@/db/quoteRepo';
import { upsertCatalogItem } from '@/db/moreRepo';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import type { SimproCatalogItem } from '@/simpro/moreResources';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

const SCOPE = [
  { location: 'Level 2 lift lobby', text: 'Replace the failed smoke detector head and retest the zone.' },
  { location: '', text: 'Free the jammed fire door closer.' },
];

const item = (over: Partial<SimproCatalogItem> = {}): SimproCatalogItem => ({
  id: '9001',
  partNo: 'RDH-1',
  name: 'Replacement detector head',
  sellExTaxCents: 9_120,
  isInventory: true,
  isAsset: false,
  archived: false,
  ...over,
});

beforeEach(async () => {
  db = openMigrated();
  await createSite({ id: 'tower', name: 'Fictional Tower', address: '1 Main St', suburb: 'Spring Hill', postcode: '4000' });
});

afterEach(async () => { await db.closeAsync(); });

describe('the scope saved with a quote', () => {
  it('comes back with the quote, by id and in the list', async () => {
    const saved = await createQuote({ siteId: 'tower', reference: 'Q-FT-2026-001', siteName: 'Fictional Tower', scope: SCOPE });
    expect((await getQuote(saved.id))!.scope).toEqual(SCOPE);
    expect((await listQuotes()).rows[0]!.scope).toEqual(SCOPE);
  });

  it('prints on a reprint that is handed no scope', async () => {
    const saved = await createQuote({ siteId: 'tower', reference: 'Q-FT-2026-002', siteName: 'Fictional Tower', scope: SCOPE });
    const html = quoteDocumentHtml({ quote: (await getQuote(saved.id))! });
    expect(html).toContain('Replace the failed smoke detector head and retest the zone.');
    expect(html).toContain('Level 2 lift lobby');
    expect(html).not.toMatch(/No scope items were recorded/);
  });

  it('can be changed on a draft', async () => {
    const saved = await createQuote({ siteId: 'tower', reference: 'Q-FT-2026-003', siteName: 'Fictional Tower' });
    expect((await getQuote(saved.id))!.scope).toEqual([]);
    await updateQuote(saved.id, { scope: SCOPE.slice(0, 1) });
    expect((await getQuote(saved.id))!.scope).toEqual(SCOPE.slice(0, 1));
  });

  it('reads a quote saved before the column existed as no stored scope, not as a failure', async () => {
    const saved = await createQuote({ siteId: 'tower', reference: 'Q-FT-2026-004', siteName: 'Fictional Tower' });
    // What every row written before v40 holds, and what a corrupt one might.
    await db.runAsync("UPDATE quote SET scope = '[]' WHERE id = ?", [saved.id]);
    expect((await getQuote(saved.id))!.scope).toEqual([]);
    await db.runAsync("UPDATE quote SET scope = 'not json' WHERE id = ?", [saved.id]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await getQuote(saved.id))!.scope).toEqual([]);
    warn.mockRestore();
  });
});

describe('material prices from the office catalogue', () => {
  it('takes the sell price of the item sold under the line’s name', async () => {
    await upsertCatalogItem(item());
    const prices = await officeCataloguePrices(['Replacement detector head', 'Replacement sounder']);
    expect(prices).toEqual([expect.objectContaining({
      description: 'Replacement detector head',
      unitCents: 9_120,
      source: expect.objectContaining({ kind: 'catalogue' }),
    })]);
  });

  it('ignores an archived item and one with no sell price', async () => {
    await upsertCatalogItem(item({ archived: true }));
    await upsertCatalogItem(item({ id: '9002', partNo: 'RDH-2', sellExTaxCents: undefined }));
    expect(await officeCataloguePrices(['Replacement detector head'])).toEqual([]);
  });

  it('asks for nothing when there are no materials', async () => {
    expect(await officeCataloguePrices([])).toEqual([]);
  });
});
