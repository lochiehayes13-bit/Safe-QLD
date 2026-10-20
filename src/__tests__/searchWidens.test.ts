/**
 * Typing a building's name exactly must not be the thing that loses it.
 *
 * "Find anything" reads the typed words as a sentence first: any three words
 * can be a phrase, and "parts", "people", "account", "bill", "order", "lead"
 * and "supplier" each map onto a kind of record. It then asked for that kind
 * and no other.
 *
 * Those words turn up in site names: an auto parts store, a stadium named
 * for its sponsor. So typing the name of a building this company
 * services asked the catalogue — or the contacts, or the customers — for it,
 * the site was never queried, and the screen answered "Nothing matched. Try a
 * number on its own, or a shorter piece of the name."
 *
 * A shorter piece does find it, which is what makes this the worst version of
 * the fault: the advice is accidentally right, and the more precisely somebody
 * typed the name the less chance they had. It is the owner's own complaint —
 * "every site appears in every single module when searching a site" — in a
 * module where the SQL was never the problem.
 *
 * A guessed kind is a preference now. A kind somebody typed as a prefix is
 * still a filter, because that is a deliberate narrowing: "site 8812" means
 * sites.
 */
import { createSite } from '@/db/repo';
import { searchEverything } from '@/db/searchRepo';
import { isPhrase, readPhrase } from '@/domain/findPhrase';
import { parseQuery } from '@/domain/search';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

/**
 * The screen's pipeline, including the widening. Kept beside the screen's own
 * source assertion below so the two cannot drift apart silently.
 */
async function screen(query: string) {
  const phrase = isPhrase(query) ? readPhrase(query) : null;
  const onlyKind = phrase?.kind;
  const parsed = parseQuery(phrase ? phrase.terms : query);
  const found = await searchEverything(parsed.text, { limitPerKind: 8, kinds: onlyKind ? [onlyKind] : undefined });
  const guessed = onlyKind && !parsed.hint;
  const wider = !found.length && guessed
    ? await searchEverything(parsed.text, { limitPerKind: 8 })
    : null;
  return {
    onlyKind,
    widened: !!wider?.length,
    ids: (wider?.length ? wider : found).map((h) => `${h.kind}:${h.id}`),
  };
}

beforeEach(async () => {
  db = openMigrated();
  await createSite({ id: 'parts', name: 'Smith Auto Parts Northside', suburb: 'Northside' });
  await createSite({ id: 'stadium', name: 'Good People Stadium', suburb: 'Eastside' });
  await createSite({ id: 'acct', name: 'Account Street Chambers', suburb: 'Brisbane' });
  await createSite({ id: 'plain', name: 'Harbourline Apartments', suburb: 'Hamilton', externalId: '8812', externalSource: 'simpro' });
});

afterEach(async () => { await db.closeAsync(); });

describe('a site whose own name carries a kind word', () => {
  it.each([
    ['Smith Auto Parts Northside', 'parts', 'catalog'],
    ['Good People Stadium', 'stadium', 'contact'],
    ['Account Street Chambers', 'acct', 'customer'],
  ])('finds %s, which the words were read as a %s search', async (query, id, kind) => {
    const out = await screen(query);
    expect(out.onlyKind).toBe(kind);
    expect(out.ids).toContain(`site:${id}`);
  });

  it('says it widened, so the row is not in a list the person was told to ignore', async () => {
    expect((await screen('Smith Auto Parts Northside')).widened).toBe(true);
  });

  it('still finds it typed the lossy way, which was the only way that worked', async () => {
    expect((await screen('Smith Auto Northside')).ids).toContain('site:parts');
  });
});

describe('a kind the person asked for on purpose', () => {
  it('keeps "site 8812" to sites', async () => {
    // parseQuery sets `hint` only for a typed prefix. That is a narrowing
    // somebody chose, and widening it would ignore them.
    const parsed = parseQuery('site 8812');
    expect(parsed.hint).toBe('site');
    expect((await screen('site 8812')).ids).toContain('site:plain');
  });

  it('does not widen a phrase that genuinely meant one kind', async () => {
    // "the open purchase orders" is about orders, and there are none: the
    // honest answer is nothing, not every record on the phone.
    const out = await screen('the open purchase orders');
    expect(out.onlyKind).toBe('order');
    expect(out.ids).toEqual([]);
    expect(out.widened).toBe(false);
  });

  it('leaves an ordinary search alone', async () => {
    const out = await screen('Harbourline');
    expect(out.onlyKind).toBeUndefined();
    expect(out.widened).toBe(false);
    expect(out.ids).toContain('site:plain');
  });
});

describe('the screen does what this tests', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'app', 'search.tsx'), 'utf8');

  it('widens only a guessed kind, never a typed prefix', () => {
    expect(source).toContain('const guessed = onlyKind && !parsed.hint;');
  });

  it('asks every kind on the second read', () => {
    expect(source).toMatch(/searchEverything\(parsed\.text, \{ limitPerKind: PER_KIND \}\)/);
  });

  it('says so on screen', () => {
    expect(source).toContain('matched. Showing all results.');
  });

  it('judges the empty state on what it ended up with, not on the first read', () => {
    // Otherwise a widened search that found the site would still offer the
    // "nothing on this phone" words underneath it.
    expect(source).toContain('if (!rows.length && !held) {');
  });
});
