import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '@/db/schema';
import { MIGRATION_V20 } from '@/db/schemaSite';
import { createSite, getSite } from '@/db/repo';
import { setSiteOffice } from '@/db/mirrorRepo';
import { jobDetailIsStale } from '@/db/mirrorRepo';
import { SimproResources } from '@/simpro/resources';
import type { SimproClient } from '@/simpro/client';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * What the office wrote on the site, on the site.
 *
 * The public notes and the customer number are the two things a technician
 * on the doorstep asks the office for, and the site row had nowhere to put
 * either. Pinned end to end: the migration, the write, the read that the
 * screen does, and the list read that asks the build for the notes and
 * copes when it refuses.
 */

function columns(table: string): Set<string> {
  const raw = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) raw.exec(m);
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  raw.close();
  return new Set(rows.map((r) => r.name));
}

describe('migration v20', () => {
  it('is registered, and gives the site table the three columns', () => {
    expect(MIGRATIONS).toContain(MIGRATION_V20);
    const cols = columns('site');
    for (const c of ['publicNotes', 'customerExternalId', 'detailSyncedAt']) {
      expect({ column: c, present: cols.has(c) }).toEqual({ column: c, present: true });
    }
  });
});

describe('the site record', () => {
  let db: NodeSqliteDb;
  beforeEach(() => { db = openMigrated(); });
  afterEach(async () => { await db.closeAsync(); });

  it('writes the notes and the customer, clears them on null, and leaves them on undefined', async () => {
    const site = await createSite({ name: 'Harbourline Apartments', externalId: '3021', externalSource: 'simpro' });
    await setSiteOffice(site.id, { publicNotes: 'Park in visitor bay 3', customerExternalId: '812' });
    expect(await getSite(site.id)).toMatchObject({ publicNotes: 'Park in visitor bay 3', customerExternalId: '812', detailSyncedAt: null });

    // The list refused the notes column: undefined, and the notes stand.
    await setSiteOffice(site.id, { publicNotes: undefined, customerExternalId: '813' });
    expect(await getSite(site.id)).toMatchObject({ publicNotes: 'Park in visitor bay 3', customerExternalId: '813' });

    // The record says there are none now: null, and they go.
    await setSiteOffice(site.id, { publicNotes: null, detailSyncedAt: '2026-09-02T00:30:00.000Z' });
    expect(await getSite(site.id)).toMatchObject({ publicNotes: null, detailSyncedAt: '2026-09-02T00:30:00.000Z' });
    expect(jobDetailIsStale((await getSite(site.id))!, 15 * 60_000, Date.parse('2026-09-02T00:40:00.000Z'))).toBe(false);
    expect(jobDetailIsStale((await getSite(site.id))!, 15 * 60_000, Date.parse('2026-09-02T00:50:00.000Z'))).toBe(true);
  });
});

describe('the site list read', () => {
  const build = (refuseNotes: boolean) => {
    const asked: string[] = [];
    const client = {
      listAllPaged: async <T,>(path: string, query: Record<string, string | number>) => {
        asked.push(String(query.columns));
        if (refuseNotes && String(query.columns).includes('PublicNotes')) {
          const e = new Error('Simpro returned HTTP 422 for sites/. Invalid columns found: PublicNotes') as Error & { status?: number };
          e.name = 'SimproError';
          e.status = 422;
          throw e;
        }
        const row = {
          ID: 3021, Name: 'Harbourline Apartments', Customers: [{ ID: 812, Name: 'Harbourline Body Corporate' }],
          ...(refuseNotes ? {} : { PublicNotes: '<p>Park in <b>visitor bay 3</b></p>' }),
        };
        return { items: [row as T], truncated: false };
      },
    } as unknown as SimproClient;
    return { api: new SimproResources(client), asked };
  };

  it('asks for the public notes with the verified columns and reads them as plain text', async () => {
    const { api, asked } = build(false);
    const read = await api.sitesPaged();
    expect(asked).toEqual(['ID,Name,Address,Customers,PrimaryContact,Archived,DateModified,PublicNotes']);
    expect(read.columnsRejected).toBeUndefined();
    expect(read.sites[0]).toMatchObject({ id: '3021', customerName: 'Harbourline Body Corporate', customerExternalId: '812', publicNotes: 'Park in visitor bay 3' });
  });

  it('asks again without the notes when the build refuses the column, and says so', async () => {
    const { api, asked } = build(true);
    const read = await api.sitesPaged();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toBe('ID,Name,Address,Customers,PrimaryContact,Archived,DateModified');
    expect(read.columnsRejected).toContain('Invalid columns found');
    // Absent, not blank: the sync must not clear what a record read wrote.
    expect(read.sites[0]!.publicNotes).toBeUndefined();
    expect(read.sites[0]!.customerExternalId).toBe('812');
  });
});

describe('posting a test result', () => {
  it('dates it by the Queensland day, not the UTC one', async () => {
    const bodies: unknown[] = [];
    const client = {
      request: async (_method: string, _path: string, options: { body?: unknown }) => {
        bodies.push(options.body);
        return { data: undefined, total: null };
      },
    } as unknown as SimproClient;
    // Half past seven on a Brisbane morning is the previous day in UTC.
    await new SimproResources(client).postAssetTest('55', 'Pass', '2026-07-02T21:30:00.000Z', '3');
    expect(bodies[0]).toEqual({ LastTest: { Result: 'Pass', Date: '2026-07-03', ServiceLevel: { ID: 3 } } });
  });
});
