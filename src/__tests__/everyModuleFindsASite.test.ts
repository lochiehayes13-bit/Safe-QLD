/**
 * Every module finds the building, and says so on the box.
 *
 * The owner's words: "Can you confirm every site appears in every single
 * module when searching a site. Whether there's jobs available or not. Make
 * this faultless."
 *
 * Confirming it one module at a time is how it was half true for a year. Each
 * module's search was written on its own afternoon against whatever columns
 * that table happened to carry, so each reached a different idea of what a
 * building is: the invoice list matched the jobs it billed and never the site;
 * the quote list had no box at all; the occupier statements had no box at all;
 * the job list and every job picker behind it matched the name the office
 * wrote onto the job and nothing else about the building; the purchase orders
 * said nothing about where the parts were going; the leads matched one name;
 * the contacts could not match the sites printed on their own rows.
 *
 * So this is the one place the promise is kept, over a real database, with one
 * building described the way a synced site is described and a second as the
 * control. Every module is asked the same seven questions — the name, part of
 * the name, the address, the suburb, the postcode, the client, the office's
 * site number — and has to answer with its own row.
 *
 * Adding a module to this list is the cost of adding a module. That is the
 * point: a list of modules each confirmed separately is what this replaces.
 */
import { createSite, listSiteSummaries, updateSite } from '@/db/repo';
import { listJobPage, searchJobPicks, upsertJob } from '@/db/opsRepo';
import { listInvoices, listQuotePage, upsertInvoice, upsertQuote } from '@/db/mirrorRepo';
import { listLeads, searchContacts, searchVendorOrders, upsertContact, upsertLead, upsertVendorOrder } from '@/db/moreRepo';
import { createQuote, listQuotes } from '@/db/quoteRepo';
import { createOccupierStatement, listOccupierStatements } from '@/db/occupierRepo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;

/**
 * The building, described the way src/simpro/sync.ts writes a synced site.
 *
 * `siteRef: 'SIMPRO:8812'` is the stamped shape, which is what makes the
 * office's number matchable from the colon rather than as a substring. The
 * client is deliberately not any module's own customer: a building held by a
 * managing agent and billed to a body corporate is the ordinary case, and it
 * is the only way to tell the site's client column being searched from the
 * module's own.
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

/** The control: another building, so nothing below passes by returning everything. */
const OTHER = {
  id: 'other', name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610',
  clientName: 'South Burnett Regional Council', siteRef: 'SIMPRO:4471', externalId: '4471',
  externalSource: 'simpro',
};

/** Asked of every module, in the words a person actually has. */
const WAYS = [
  ['the name', 'Barren Heights'],
  ['part of the name, half remembered', 'arren'],
  ['the address', 'Markwell'],
  ['the suburb', 'Spring Hill'],
  ['the postcode', '4000'],
  ['the client', 'Pelham'],
  ['the office’s site number', '8812'],
] as const;

/** And of the control, so a module that answers everything fails. */
const WRONG_BUILDING = 'Kingaroy';

beforeEach(async () => {
  db = openMigrated();
  await createSite(SITE);
  await createSite(OTHER);

  // One row per module at each building. Each carries only what its own table
  // would: none of them repeats the suburb, the postcode, the client or the
  // office's site number, because none of them has a column for those.
  for (const [site, n] of [[SITE, '1'], [OTHER, '2']] as const) {
    await upsertJob({
      id: `job-${n}`, externalId: `4374${n}`, siteId: site.id, siteName: site.name,
      title: 'Six-monthly routine', status: 'scheduled',
    });
    await upsertInvoice({
      id: `INV-90${n}`, customerName: 'A Body Corporate', isPaid: false,
      dateIssued: '2026-09-02', jobs: [{ id: `4374${n}` }],
    } as never, '2026-09-02T00:00:00.000Z');
    await upsertQuote(
      {
        id: `99${n}`, name: 'Replace the booster', siteId: site.externalId, siteName: site.name,
        isClosed: false, technicians: [], tags: [],
      },
      site.id,
      '2026-09-02T00:00:00.000Z',
    );
    await createQuote({
      siteId: site.id, reference: `Q-LOCAL-${n}`, siteName: site.name, clientName: 'A Body Corporate',
    });
    await createOccupierStatement(site.id, { premisesName: site.name, periodEnd: '2026-06-30' });
    await upsertContact({
      id: `c${n}`, name: `Contact ${n}`, sites: [{ id: site.externalId, name: site.name }], customers: [],
    } as never, '2026-09-02T00:00:00.000Z');
    await upsertLead({
      id: `l${n}`, name: `Lead ${n}`, siteId: site.externalId, siteName: site.name, tags: [],
    } as never, '2026-09-02T00:00:00.000Z');
    await upsertVendorOrder({
      id: `PO-${n}`, vendorName: 'Fire Supplies', jobId: `4374${n}`, stage: 'Pending', archived: false, lines: [],
    } as never, '2026-09-02T00:00:00.000Z');
  }
});

afterEach(async () => { await db.closeAsync(); });

/**
 * Every module, as "ask it for a building and get back row ids".
 *
 * Each entry runs that module's real query. The ids are the module's own
 * record, not the site's, so a module answering with the site would fail.
 */
const MODULES: readonly [string, (q: string) => Promise<string[]>][] = [
  ['the sites tab', async (q) => (await listSiteSummaries({ query: q, limit: 20 })).rows.map((r) => r.id)],
  ['the job list', async (q) => (await listJobPage({ filter: 'all', today: '2026-10-06', query: q, limit: 50 })).rows.map((j) => j.id)],
  ['every job picker', async (q) => (await searchJobPicks(q, 40)).map((p) => `job-${p.externalId?.slice(-1)}`)],
  ['the invoices', async (q) => (await listInvoices({ query: q })).map((i) => i.externalId)],
  ['the office’s quotes', async (q) => (await listQuotePage({ filter: 'all', query: q, limit: 50 })).rows.map((r) => r.externalId)],
  ['the quotes raised here', async (q) => (await listQuotes({ query: q })).rows.map((r) => r.reference)],
  ['the occupier statements', async (q) => (await listOccupierStatements({ query: q })).rows.map((r) => r.premisesName)],
  ['the contacts', async (q) => (await searchContacts(q)).map((c) => c.id)],
  ['the leads', async (q) => (await listLeads({ query: q })).map((l) => l.id)],
  ['the purchase orders', async (q) => (await searchVendorOrders(q)).map((o) => o.id)],
];

/** This building's row id in each module, in the same order. */
const MINE: Record<string, string> = {
  'the sites tab': 'tower',
  'the job list': 'job-1',
  'every job picker': 'job-1',
  'the invoices': 'INV-901',
  'the office’s quotes': '991',
  'the quotes raised here': 'Q-LOCAL-1',
  'the occupier statements': 'Barren Heights Tower',
  'the contacts': 'c1',
  'the leads': 'l1',
  'the purchase orders': 'PO-1',
};

describe('every module answers for the building', () => {
  it('names every module, so a new one cannot be quietly left out', () => {
    expect(MODULES.map(([name]) => name).sort()).toEqual(Object.keys(MINE).sort());
  });

  for (const [module, ask] of MODULES) {
    describe(module, () => {
      it.each(WAYS)('finds it by %s', async (_what, q) => {
        expect({ module, q, found: await ask(q) }).toEqual({ module, q, found: [MINE[module]] });
      });

      it('answers with the other building for the other building', async () => {
        // A module that returned everything would pass every test above.
        const found = await ask(WRONG_BUILDING);
        expect({ module, mine: found.includes(MINE[module]!), any: found.length })
          .toEqual({ module, mine: false, any: 1 });
      });

      it('answers nothing for a building neither of them is', async () => {
        expect({ module, found: await ask('Woolloongabba') }).toEqual({ module, found: [] });
      });

      it('finds it by the name the building has now, not only the one copied onto the row', async () => {
        /*
         * The reason every one of these reaches the site row rather than
         * trusting the name written onto its own record. The office renames a
         * building — a strata changes managers, a tower is rebranded — and
         * every record ever raised there becomes unfindable by the name the
         * technician now has in their hand.
         */
        await updateSite('tower', { name: 'Spring Hill Central' });
        expect({ module, found: await ask('Spring Hill Central') }).toEqual({ module, found: [MINE[module]] });
      });
    });
  }
});

/**
 * And the box says so.
 *
 * A placeholder is the only description of a search a technician ever reads.
 * Every box below now reaches the building's suburb — the search was widened
 * and the words over it were not, so "Job number, site or customer" described
 * a narrower box than the one underneath it. Somebody who has a suburb and
 * reads that puts the phone down.
 *
 * Read off the source text, the house pattern for a claim about a component
 * the suite's react-native mock cannot load.
 */
describe('every search box says it searches the suburb', () => {
  const BOXES: readonly [string, string][] = [
    ['the sites tab', 'app/(tabs)/sites.tsx'],
    ['the job list', 'app/work/jobs.tsx'],
    ['the shared job picker', 'src/components/JobPicker.tsx'],
    ['the timesheet’s job sheet', 'app/timesheet/[id].tsx'],
    ['starting a Form 72', 'app/form72/new.tsx'],
    ['the invoices', 'app/invoices/index.tsx'],
    ['the office’s quotes', 'app/quotes/simpro.tsx'],
    ['the quotes raised here', 'app/quotes/index.tsx'],
    ['the occupier statements', 'app/occupier/index.tsx'],
    ['the leads', 'app/leads/index.tsx'],
    ['the purchase orders', 'app/orders/index.tsx'],
    ['the day planner', 'app/work/plan.tsx'],
    ['the label sheet', 'app/work/labels.tsx'],
  ];

  const placeholders = (file: string): string[] => [
    ...readFileSync(join(__dirname, '..', '..', file), 'utf8').matchAll(/placeholder="([^"]*)"/g),
  ].map((m) => m[1]!);

  it.each(BOXES)('%s', (_what, file) => {
    const said = placeholders(file).filter((p) => /suburb/i.test(p));
    expect({ file, saysSuburb: said.length > 0 }).toEqual({ file, saysSuburb: true });
  });

  it('and the purchase orders say the site, which is what the search reaches', () => {
    // The order has no site of its own: it names a job and the job names a
    // site. "site" is the honest word for that, and the suburb comes with it.
    expect(placeholders('app/orders/index.tsx').join(' ')).toMatch(/site|suburb/i);
  });

  it('and the contacts say the site, since that is what their rows print', () => {
    expect(placeholders('app/contacts/index.tsx').join(' ')).toMatch(/site/i);
  });
});
