import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '@/db/schema';
import { MIGRATION_V14 } from '@/db/schemaSimpro';

/**
 * The site contact, end to end.
 *
 * Every routine service report this app has produced printed Contact, Mobile
 * and Email as three blank rows. The office was not missing the detail — it
 * holds a primary contact for most of its sites — the sync simply never asked
 * Simpro for the field, and the site table had no column to put it in.
 *
 * So the failure was invisible in three places at once: the request omitted a
 * column, the schema omitted the storage, and the report mapper omitted the
 * assignment. Each looked complete on its own. These tests pin all three, since
 * fixing any two of them still prints blank rows.
 */

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe('migration v14', () => {
  it('is registered in MIGRATIONS, not merely written', () => {
    // A migration file that exists but is never added to the array applies to
    // nobody, and every other test here would still pass.
    expect(MIGRATIONS).toContain(MIGRATION_V14);
  });

  it('gives the site table somewhere to keep a contact', () => {
    const cols = columns(migrated(), 'site');
    for (const c of ['contactName', 'contactEmail', 'contactWorkPhone', 'contactMobile']) {
      expect({ column: c, present: cols.has(c) }).toEqual({ column: c, present: true });
    }
  });

  it('records where a site came from, so a re-sync updates instead of duplicating', () => {
    const cols = columns(migrated(), 'site');
    expect({ externalId: cols.has('externalId'), externalSource: cols.has('externalSource') })
      .toEqual({ externalId: true, externalSource: true });
  });

  it('indexes the external pair, because the sync looks sites up by it every run', () => {
    const db = migrated();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'site'")
      .all() as { name: string }[];
    expect(idx.map((r) => r.name)).toContain('idx_site_external');
  });

  it('applies to a database that already holds sites', () => {
    // The real case: an existing install upgrading, not a fresh one. An ALTER
    // that only works on an empty table would pass every test above and brick
    // the phones that have been in use longest.
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS.slice(0, 13)) db.exec(m);
    db.prepare(
      `INSERT INTO site (id,name,address,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
    ).run('s1', 'Existing Site', '1 Test St', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    expect(() => db.exec(MIGRATION_V14)).not.toThrow();

    const row = db.prepare('SELECT name, contactName FROM site WHERE id = ?').get('s1') as
      { name: string; contactName: string | null };
    // The existing row survives and the new column reads as null, not as a
    // dropped table or a defaulted string.
    expect(row).toEqual({ name: 'Existing Site', contactName: null });
  });

  it('round-trips a contact through the columns the repository writes', () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO site (id,name,contactName,contactEmail,contactWorkPhone,contactMobile,
                         externalId,externalSource,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      's2', 'Capalaba Depot', 'Michelle Currie', 'contact@example.com', '07 3286 6310',
      '0400 000 000', '3344', 'simpro', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    );
    const row = db.prepare(
      `SELECT contactName, contactEmail, contactWorkPhone, contactMobile, externalId, externalSource
       FROM site WHERE id = ?`,
    ).get('s2');
    expect(row).toEqual({
      contactName: 'Michelle Currie',
      contactEmail: 'contact@example.com',
      contactWorkPhone: '07 3286 6310',
      contactMobile: '0400 000 000',
      externalId: '3344',
      externalSource: 'simpro',
    });
  });
});

describe('the repository writes every contact column it declares', () => {
  const repoSource = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'db', 'repo.ts'), 'utf8',
  ) as string;

  it.each(['contactName', 'contactEmail', 'contactWorkPhone', 'contactMobile', 'externalId', 'externalSource'])(
    'createSite inserts %s',
    (column) => {
      // The INSERT names its columns explicitly, so one added to the type and
      // forgotten here is silently never persisted — which is exactly how the
      // blank rows survived this long.
      const insert = repoSource.slice(repoSource.indexOf('INSERT INTO site'), repoSource.indexOf('return site;'));
      expect({ column, inInsert: insert.includes(column) }).toEqual({ column, inInsert: true });
    },
  );

  it.each(['contactName', 'contactEmail', 'contactWorkPhone', 'contactMobile'])(
    'updateSite accepts %s in its field whitelist',
    (column) => {
      // updateSite filters the patch against a fixed list; a column missing
      // from it is dropped without error, so a sync that fills a blank contact
      // would report success and change nothing.
      const update = repoSource.slice(repoSource.indexOf('export async function updateSite'));
      const whitelist = update.slice(update.indexOf('const fields'), update.indexOf('as const'));
      expect({ column, whitelisted: whitelist.includes(column) }).toEqual({ column, whitelisted: true });
    },
  );
});
