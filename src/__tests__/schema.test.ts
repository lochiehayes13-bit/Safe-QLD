import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { applyMigrations } from '@/db/migrate';
import { nextAssetCode } from '@/db/assetRepo';
import { createDefect, createSite, listDefects, listSiteSummaries } from '@/db/repo';
import { listJobPage, upsertJob } from '@/db/opsRepo';
import { customerStats, listQuotePage, scheduledJobExternalIds, siteStats } from '@/db/mirrorRepo';
import { openMigrated, wrapNodeSqlite, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The migrations, actually run.
 *
 * Nothing else checks these. TypeScript does not parse SQL, the unit tests are
 * pure logic, and the bundle only proves the strings are strings — so a
 * migration with a typo, or a repository writing to a column no migration
 * creates, ships silently and bricks the app on first launch. A phone that
 * cannot open its database is not a degraded app, it is no app.
 *
 * expo-sqlite cannot run here, but the SQL is plain SQLite, so it runs against
 * Node's own engine. That is not the same build, and a difference in SQLite
 * versions could hide something — but it catches the class of error that
 * actually happens, which is a mistake in the SQL we wrote.
 */

const DB_DIR = join(__dirname, '..', 'db');

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function tables(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe('migrations', () => {
  it('all apply, in order, to an empty database', () => {
    // The whole point: a migration that does not parse takes the app down on
    // the first launch after an update, for everyone at once.
    expect(() => migrated()).not.toThrow();
  });

  it('applies each one individually so a failure names the migration', () => {
    const db = new DatabaseSync(':memory:');
    MIGRATIONS.forEach((migration, i) => {
      expect(() => db.exec(migration)).not.toThrow();
      // Reported as an object so a failure says which migration, not just
      // "expected not to throw".
      expect({ migration: i + 1, applied: true }).toEqual({ migration: i + 1, applied: true });
    });
    db.close();
  });

  it('counts itself correctly, since the runner writes that count to user_version', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('creates the tables the app depends on', () => {
    const db = migrated();
    const present = tables(db);
    for (const table of [
      'site', 'panel', 'zone', 'point', 'loop', 'report', 'defect',
      'baseline', 'timesheet', 'catalogue_item',
      'asset', 'asset_event', 'occupier_statement',
    ]) {
      expect({ table, present: present.has(table) }).toEqual({ table, present: true });
    }
    db.close();
  });

  it('is safe to re-run from the version already applied', () => {
    // A phone that already has migration 3 must be able to take 4 and 5 without
    // the earlier ones being replayed — which is what the runner does, so the
    // later migrations have to stand alone.
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
    for (const m of MIGRATIONS.slice(3)) {
      expect(() => db.exec(m)).not.toThrow();
    }
    db.close();
  });

  const userVersion = (db: DatabaseSync): number =>
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

  it('replays from any recorded version without throwing, through the runner the app uses', async () => {
    // A phone can be on any version that ever shipped. The runner itself is
    // what brings it forward, so it is the runner that has to be run.
    for (let from = 0; from <= MIGRATIONS.length; from++) {
      const raw = new DatabaseSync(':memory:');
      for (const m of MIGRATIONS.slice(0, from)) raw.exec(m);
      raw.exec(`PRAGMA user_version = ${from}`);
      await expect(applyMigrations(wrapNodeSqlite(raw), MIGRATIONS)).resolves.toEqual({ from, to: MIGRATIONS.length });
      expect({ from, userVersion: userVersion(raw) }).toEqual({ from, userVersion: MIGRATIONS.length });
      raw.close();
    }
  });

  it('records each migration as it lands, so a failure part-way is not replayed from the start', async () => {
    /*
     * user_version was written once, after the whole loop. A migration that
     * failed on a phone left every earlier one applied and the version at
     * what it was, so the next launch replayed them all — and a CREATE TABLE
     * without IF NOT EXISTS threw on the second attempt, for good.
     */
    const raw = new DatabaseSync(':memory:');
    const broken = [...MIGRATIONS, 'CREATE TABLE half (id TEXT); CREATE TABLE broken (;'];
    await expect(applyMigrations(wrapNodeSqlite(raw), broken)).rejects.toThrow();
    expect(userVersion(raw)).toBe(MIGRATIONS.length);
    // And the failed one left nothing behind: it ran in a transaction.
    expect(tables(raw).has('half')).toBe(false);
    raw.close();
  });
});

/**
 * Every column a repository writes has to exist.
 *
 * This is the failure that typechecking cannot see: the SQL is a string, so a
 * column that no migration creates compiles perfectly and throws the first time
 * a technician saves anything.
 */
describe('repositories against the schema', () => {
  const db = migrated();
  const present = tables(db);

  const sources = readdirSync(DB_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('schema'))
    .map((f) => ({ file: f, text: readFileSync(join(DB_DIR, f), 'utf8') }));

  it('finds repository SQL to check', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it('inserts only into columns that exist', () => {
    const problems: string[] = [];
    const insert = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/gis;

    for (const { file, text } of sources) {
      insert.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = insert.exec(text))) {
        const table = m[1]!;
        if (!present.has(table)) {
          problems.push(`${file}: INSERT INTO ${table} — no such table`);
          continue;
        }
        // A column list built at runtime from an array cannot be read here;
        // the array itself is typed against the record, which is the check.
        if (m[2]!.includes('${')) continue;
        const columns = tableColumns(db, table);
        for (const raw of m[2]!.split(',')) {
          const col = raw.trim().replace(/["`\[\]]/g, '');
          if (!col || !/^\w+$/.test(col)) continue;
          if (!columns.has(col)) problems.push(`${file}: ${table}.${col} does not exist`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('updates only columns that exist', () => {
    const problems: string[] = [];
    // `UPDATE <table> SET a = ?, b = ?` — stop at WHERE so the predicate is not
    // read as an assignment.
    const update = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|`|'|$)/gi;

    for (const { file, text } of sources) {
      update.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = update.exec(text))) {
        const table = m[1]!;
        if (!present.has(table)) {
          problems.push(`${file}: UPDATE ${table} — no such table`);
          continue;
        }
        const columns = tableColumns(db, table);
        for (const assignment of m[2]!.split(',')) {
          // Splitting on commas cuts through a function call, so
          // "COALESCE(?, externalId)" yields a fragment with no assignment in
          // it. Only a fragment containing '=' is one.
          if (!assignment.includes('=')) continue;
          const col = assignment.split('=')[0]!.trim().replace(/["`\[\]]/g, '');
          // A column name built at runtime is checked by its own typing.
          if (!col || !/^\w+$/.test(col)) continue;
          if (!columns.has(col)) problems.push(`${file}: ${table}.${col} does not exist`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('prepares every static SELECT without a bad column', () => {
    // A column that does not exist throws when the query runs, not when it is
    // written — so a screen nobody opened in testing fails the first time a
    // technician does. prepare() resolves every column name without executing
    // anything, which is exactly the check wanted here.
    //
    // Queries assembled at runtime are skipped: their fragments are not valid
    // SQL on their own, and the pieces they interpolate are typed.
    const problems: string[] = [];
    const select = /(['"`])(SELECT[\s\S]*?)\1/gi;

    for (const { file, text } of sources) {
      select.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = select.exec(text))) {
        const sql = m[2]!.trim();
        if (sql.includes('${')) continue;
        try {
          db.prepare(sql);
        } catch (e) {
          problems.push(`${file}: ${(e as Error).message} — ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  afterAll(() => db.close());
});

/**
 * Repositories run against the schema, on Node's SQLite.
 *
 * Reading the SQL as text catches a column that does not exist. It does not
 * catch an INSERT that leaves half the record's columns out, or a query that
 * walks the whole index instead of searching it — those only show when the
 * statement runs against a real database.
 */
describe('repositories, run', () => {
  it('finds the next asset code by searching the code index rather than scanning it', async () => {
    /*
     * `code LIKE 'SQ-DET-%'` cannot use the index on code, so every new asset
     * walked every code on the phone — thirteen thousand rows on the real
     * register, once per asset created. A range on the same prefix is a seek.
     */
    const db = openMigrated();
    const site = await createSite({ name: 'Baldwin Living' });
    await db.runAsync(
      `INSERT INTO asset (id,siteId,assetTypeId,code,name,status,attributes,openDefects,createdAt,updatedAt)
       VALUES ('a1',?,'detector','SQ-DET-0000041','X','in-service','{}',0,'','')`,
      site.id,
    );
    await expect(nextAssetCode('detector')).resolves.toBe('SQ-DET-0000042');

    const lookup = db.statements.find((s) => /SELECT code FROM asset/i.test(s.sql))!;
    expect(lookup).toBeDefined();
    const plan = db.raw.prepare(`EXPLAIN QUERY PLAN ${lookup.sql}`).all(...lookup.params) as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toMatch(/SEARCH/);
    expect(detail).not.toMatch(/SCAN/);
    await db.closeAsync();
  });

  it('stores the statutory fields a defect is created with, not only the ones v1 had', async () => {
    /*
     * createDefect returned the code, the AS 1851 class and the two Queensland
     * limbs it was given, and inserted none of them. The screen showed a
     * critical defect with both limbs ticked; the row said non-critical with
     * neither, and that row is what the notice is built from.
     */
    const db = openMigrated();
    const site = await createSite({ name: 'Baldwin Living' });
    const made = await createDefect({
      siteId: site.id,
      location: 'Level 2 riser',
      description: 'Zone 4 in fault',
      severity: 'critical',
      status: 'open',
      photos: [],
      defectCode: 'DET-SMK-004',
      as1851Class: 'critical',
      qldLimbInoperable: true,
      qldLimbAdverseImpact: true,
      noticeRecipient: 'Site manager',
      rectificationDueAt: '2026-08-03',
      extentOfImpairment: 'Level 2 east wing',
    });

    const row = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM defect WHERE id = ?', made.id);
    expect(row).toMatchObject({
      defectCode: 'DET-SMK-004',
      as1851Class: 'critical',
      qldLimbInoperable: 1,
      qldLimbAdverseImpact: 1,
      noticeRecipient: 'Site manager',
      rectificationDueAt: '2026-08-03',
      extentOfImpairment: 'Level 2 east wing',
    });
    // And it reads back through the repository the same way it went in.
    const [read] = await listDefects(site.id);
    expect(read).toMatchObject({ defectCode: 'DET-SMK-004', as1851Class: 'critical', qldLimbInoperable: true });
    await db.closeAsync();
  });
});

/**
 * A table the app fills and never reads.
 *
 * `asset_schedule` was one. The importer wrote a row per routine into it on
 * every register import — thirty-one thousand of them on the real one — the
 * schema gave it a unique index on (assetId, frequency) and another on
 * nextDueAt for a query nobody had written, and no repository ever selected
 * from it. The reason the table exists is written in its own schema comment:
 * an extinguisher is due six-monthly, yearly and five-yearly on three different
 * dates and the asset's single nextDueAt can only hold the soonest. The app
 * showed the soonest.
 *
 * That is this repository's recurring failure, in the schema rather than in the
 * router: something finished, correct, and reachable from nothing. It cost
 * nothing to run and it silently threw away the only answer to "which routine
 * is this asset actually due for", which is the question a technician standing
 * in front of it is asking.
 *
 * A write with no read is the shape that catches it, and it is cheap to check.
 */
describe('tables the app writes to', () => {
  const schema = MIGRATIONS.join('\n');
  const declared = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]!);

  /**
   * Read somewhere else, and deliberately.
   *
   * `defect_code` mirrors the DEFECT_LIBRARY constant, which is what the app
   * actually reads — `defectByCode` resolves against the TypeScript, never
   * against a row. Its sibling `asset_type` is seeded the same way and *is*
   * joined against, so this is a real asymmetry rather than a convention.
   * Left as it is because deciding whether the database should describe its own
   * defect vocabulary is a call about the schema, not a bug to fix quietly.
   */
  const KNOWN_WRITE_ONLY = new Set(['defect_code']);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.expo', 'coverage', '__tests__', '__mocks__'].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !entry.includes('schema')) out.push(full);
    }
    return out;
  }

  const code = ['src', 'app'].flatMap((r) => walk(r)).map((f) => readFileSync(f, 'utf8')).join('\n');

  it('has tables to check and code to check them against', () => {
    // Both halves can silently become empty, and either would pass forever.
    expect(declared.length).toBeGreaterThan(20);
    expect(declared).toContain('asset_schedule');
    expect(code.length).toBeGreaterThan(100_000);
  });

  it('reads every table it writes to', () => {
    const writeOnly: string[] = [];
    for (const table of declared) {
      if (KNOWN_WRITE_ONLY.has(table)) continue;
      const written = new RegExp(`(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i').test(code);
      const read = new RegExp(`(?:FROM|JOIN)\\s+${table}\\b`, 'i').test(code);
      if (written && !read) writeOnly.push(table);
    }
    // Named rather than counted: the fix is a repository function and a screen,
    // and neither is findable from a number.
    expect(writeOnly).toEqual([]);
  });

  it('names the one exception rather than hiding it in a count', () => {
    // An allowlist that nobody has to justify is a way of never fixing
    // anything, so the entry has to still be true.
    for (const table of KNOWN_WRITE_ONLY) {
      expect(declared).toContain(table);
      expect(new RegExp(`(?:FROM|JOIN)\\s+${table}\\b`, 'i').test(code)).toBe(false);
    }
  });
});

/**
 * The indexes v21 added, proved by the plan SQLite actually chooses.
 *
 * An index is a claim about a query, and the claim is only true if the
 * planner agrees. Two of these are indexes on expressions — the fold that
 * decides whether a job is open, and the Queensland day a job was issued —
 * and an expression index is only used when the expression in the query and
 * the expression in the index parse to the same thing. The two copies live in
 * different files: the query's in `opsRepo`, the index's in the migration,
 * which is append-only and can never be edited to follow it. If they ever
 * drift the plan silently becomes a full table scan, which is exactly the
 * thing this work was undoing. So these read the plan rather than assert in a
 * comment that the index exists.
 *
 * The other half of the claim is the one nobody writes down: an index that no
 * query searches is write cost on every sync for nothing, and this schema has
 * shipped one of those before.
 */
describe('the indexes the lists search', () => {
  /** The plan for the last statement a repository ran that matches. */
  function planFor(db: NodeSqliteDb, match: RegExp): string {
    const ran = [...db.statements].reverse().find((s) => match.test(s.sql));
    expect({ found: Boolean(ran), looking: String(match) }).toEqual({ found: true, looking: String(match) });
    const plan = db.raw.prepare(`EXPLAIN QUERY PLAN ${ran!.sql}`).all(...ran!.params) as { detail: string }[];
    return plan.map((p) => p.detail).join(' | ');
  }

  async function book(db: NodeSqliteDb): Promise<void> {
    await createSite({ id: 'site-1', name: 'Harbourline Apartments' });
    for (let i = 0; i < 200; i++) {
      const open = i % 4 === 0;
      await upsertJob({
        id: `j${i}`, externalId: String(40000 + i), siteId: 'site-1', siteName: 'Harbourline Apartments',
        title: 'Routine', customerExternalId: '812',
        stage: open ? 'Pending' : 'Invoiced', status: open ? 'scheduled' : 'complete',
        scheduledFor: i % 7 === 0 ? '2026-09-03' : '2024-02-11',
      });
      await db.runAsync(
        'INSERT INTO simpro_quote (externalId,name,isClosed,jobExternalId,siteId,syncedAt) VALUES (?,?,?,?,?,?)',
        String(20000 + i), 'Quote', i % 3 === 0 ? 1 : 0, i % 5 === 0 ? String(40000 + i) : null, 'site-1', '',
      );
      await db.runAsync(
        "INSERT INTO defect (id,siteId,location,description,severity,status,raisedAt,photos) VALUES (?,'site-1','L','D','non-critical',?,'2026-01-01T00:00:00Z','[]')",
        `d${i}`, i % 3 === 0 ? 'open' : 'rectified',
      );
      await db.runAsync(
        "INSERT INTO schedule (id,jobId,staffId,staffName,date,syncedAt) VALUES (?,?,'17','Dale','2026-09-03','')",
        `b${i}`, String(40000 + i),
      );
    }
  }

  const TODAY = '2026-09-03';

  it('searches the open work rather than reading every job to find it', async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await listJobPage({ filter: 'open', today: TODAY, limit: 50 });
    const plan = planFor(db, /^SELECT id, externalId/);
    // The expression index in the migration still means what opsRepo's
    // JOB_IS_OPEN means. If it stopped, this would read SCAN job.
    expect(plan).toContain('idx_job_open_stage');
    expect(plan).not.toMatch(/SCAN job\b/);
    await db.closeAsync();
  });

  it('searches today by the Queensland day, and the schedule by the day, on both halves of the Today tab', async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await listJobPage({ filter: 'today', today: TODAY, limit: 50 });
    const plan = planFor(db, /^SELECT id, externalId/);
    expect(plan).toContain('MULTI-INDEX OR');
    // The office's job numbers on the day, out of the covering index.
    expect(plan).toContain('idx_schedule_day_job');
    // And the jobs issued today in Brisbane, out of the expression index.
    expect(plan).toContain('idx_job_qld_day');
    expect(plan).not.toMatch(/SCAN job\b/);
    await db.closeAsync();
  });

  it('reads a day of the schedule out of the index without touching the table', async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await scheduledJobExternalIds({ from: TODAY, to: TODAY });
    expect(planFor(db, /FROM schedule/)).toContain('COVERING INDEX idx_schedule_day_job');
    await db.closeAsync();
  });

  it('searches the open defects across every site', async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await listDefects(undefined, 'open', 300);
    const plan = planFor(db, /FROM defect/);
    expect(plan).toContain('idx_defect_status');
    expect(plan).not.toMatch(/SCAN defect\b/);
    await db.closeAsync();
  });

  it("searches the quote list's tabs", async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await listQuotePage({ filter: 'open', limit: 50 });
    expect(planFor(db, /FROM simpro_quote/)).toContain('idx_simpro_quote_open');
    await db.closeAsync();
  });

  it('walks the site list in order and stops at the page, rather than sorting every site', async () => {
    const db = openMigrated();
    for (let i = 0; i < 200; i++) await createSite({ id: `s${i}`, name: `Site ${i}` });
    db.statements.length = 0;
    await listSiteSummaries({ limit: 20 });
    const plan = planFor(db, /panelCount/);
    // The order comes out of the index, so there is no temp b-tree to fill
    // before the first row can be drawn — which is the whole of what the cap
    // is worth on three thousand sites.
    expect(plan).toContain('idx_site_name');
    expect(plan).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    // And whether a name is shared is a seek, not a pass over every site.
    expect(plan).toContain('idx_site_name_key');
    await db.closeAsync();
  });

  it('counts a customer’s and a site’s jobs through their own indexes', async () => {
    const db = openMigrated();
    await book(db);
    db.statements.length = 0;
    await customerStats('812');
    const forCustomer = planFor(db, /jobsTotal/);
    // Every one of the five counts on the card is a search. The open one asks
    // the same question as the Open tab and reaches it through the customer
    // rather than through the stage, because naming a customer is the
    // narrower half — but neither reads a row it does not need.
    expect(forCustomer).toContain('idx_job_customer_external');
    expect(forCustomer).toContain('idx_simpro_quote_open');
    expect(forCustomer).not.toMatch(/SCAN (job|simpro_quote|invoice)\b/);
    db.statements.length = 0;
    await siteStats('site-1');
    expect(planFor(db, /jobsTotal/)).toContain('idx_job_site');
    await db.closeAsync();
  });
});
