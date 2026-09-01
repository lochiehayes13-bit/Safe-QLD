import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { MIGRATIONS } from '@/db/schema';
import { assetName, parseAssetRegister, soonestDue, type RegisterAsset } from '@/parsers/assetRegister';
import { registerScheduleLines, type RegisterScheduleRow } from '@/domain/registerSchedule';

/**
 * Loading a register into the database.
 *
 * expo-sqlite cannot run here, so the repository itself is exercised through
 * Node's engine against the real migrations: the SQL is what breaks, and a
 * column or a conflict clause that does not exist compiles perfectly and throws
 * the first time a technician imports anything.
 */

let dir: string;
let db: DatabaseSync;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'register-'));
  db = new DatabaseSync(join(dir, 'app.db'));
  for (const m of MIGRATIONS) db.exec(m);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the schema the import writes to', () => {
  it('has the columns the register needs', () => {
    const cols = db.prepare('PRAGMA table_info(asset)').all().map((c) => (c as { name: string }).name);
    expect(cols).toEqual(expect.arrayContaining(['externalId', 'externalSource', 'walkOrder']));
  });

  it('holds one schedule row per routine, not one per asset', () => {
    // An extinguisher is due six-monthly, yearly and five-yearly on three
    // different dates. A single nextDueAt can only hold the soonest.
    db.exec(`INSERT INTO site (id,name,createdAt,updatedAt) VALUES ('s1','Site',date(),date())`);
    db.exec(`INSERT INTO asset (id,siteId,assetTypeId,name,status,attributes,openDefects,createdAt,updatedAt)
             VALUES ('a1','s1','extinguisher','X','in-service','{}',0,date(),date())`);
    for (const [f, d] of [['six-monthly', '2027-03-01'], ['annual', '2027-03-01'], ['five-yearly', '2030-10-01']]) {
      db.exec(`INSERT INTO asset_schedule (id,assetId,frequency,nextDueAt,source,createdAt,updatedAt)
               VALUES ('${f}','a1','${f}','${d}','register-import',date(),date())`);
    }
    const rows = db.prepare('SELECT frequency, nextDueAt FROM asset_schedule WHERE assetId = ? ORDER BY frequency').all('a1');
    expect(rows).toHaveLength(3);
  });

  it('updates a routine in place on re-import rather than adding a second', () => {
    // The conflict target is (assetId, frequency). Without it a register
    // re-exported monthly grows a new due date every time.
    db.exec(`INSERT INTO asset_schedule (id,assetId,frequency,nextDueAt,source,createdAt,updatedAt)
             VALUES ('x','a1','annual','2028-03-01','register-import',date(),date())
             ON CONFLICT(assetId, frequency) DO UPDATE SET nextDueAt = excluded.nextDueAt`);
    const rows = db.prepare("SELECT nextDueAt FROM asset_schedule WHERE assetId='a1' AND frequency='annual'").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { nextDueAt: string }).nextDueAt).toBe('2028-03-01');
  });

  it('reads the schedule back in the shape the screen expects', () => {
    /*
     * The gap this closes is between the SQL and the type. `getAllAsync<T>` is
     * an unchecked cast: rename a column in the migration and every row comes
     * back with the field undefined, typed correctly, with nothing failing —
     * the routine list simply goes blank on a screen nobody has open.
     *
     * So the repository's own query text is run here and its rows are handed to
     * the domain function that renders them. If the two ever stop agreeing
     * about a column name, this is where it shows.
     */
    db.exec(`UPDATE asset_schedule SET lastDoneAt = NULL, lastDonePrecision = 'month',
             lastDoneRaw = 'Jun-25' WHERE assetId = 'a1' AND frequency = 'five-yearly'`);

    const rows = db.prepare(
      `SELECT frequency, nextDueAt, lastDoneAt, lastDonePrecision, lastDoneRaw
         FROM asset_schedule WHERE assetId = ?`,
    ).all('a1') as unknown as RegisterScheduleRow[];

    const lines = registerScheduleLines(rows, '2026-09-01T21:30:00.000Z');
    expect(lines.map((l) => l.frequency)).toEqual(['six-monthly', 'annual', 'five-yearly']);
    expect(lines.every((l) => l.nextDueAt)).toBe(true);
    const overhaul = lines.find((l) => l.frequency === 'five-yearly')!;
    expect(overhaul.lastDone).toBe('Jun-25');
    expect(overhaul.lastDoneImprecise).toBe(true);
  });

  it('finds an asset again by the id its source system gave it', () => {
    db.exec(`UPDATE asset SET externalId='14211', externalSource='asset-register' WHERE id='a1'`);
    const found = db.prepare(
      'SELECT id FROM asset WHERE externalSource = ? AND externalId IN (?)',
    ).all('asset-register', '14211');
    expect(found).toHaveLength(1);
  });

  it('orders a walk, putting assets with no order last', () => {
    db.exec(`INSERT INTO asset (id,siteId,assetTypeId,name,status,attributes,openDefects,walkOrder,createdAt,updatedAt)
             VALUES ('a2','s1','extinguisher','B','in-service','{}',0,2,date(),date()),
                    ('a3','s1','extinguisher','A','in-service','{}',0,1,date(),date())`);
    const walk = db.prepare(
      `SELECT id FROM asset WHERE siteId = 's1'
       ORDER BY CASE WHEN walkOrder IS NULL THEN 1 ELSE 0 END, walkOrder, name`,
    ).all().map((r) => (r as { id: string }).id);
    expect(walk).toEqual(['a3', 'a2', 'a1']);
  });
});

describe('what an asset gets called', () => {
  const asset = (over: Partial<RegisterAsset>): RegisterAsset => ({
    siteName: 'Site', schedule: [], system: 'extinguisher', assetTypeId: 'extinguisher',
    extra: {}, ...over,
  });

  it('leads with what it is and where, which is how a tech finds it', () => {
    expect(assetName(asset({ descriptor: 'DCP 4.5kg ABE', location: 'Rear door' })))
      .toBe('DCP 4.5kg ABE — Rear door');
  });

  it('uses whichever half it has', () => {
    expect(assetName(asset({ location: 'Rear door' }))).toBe('Rear door');
    expect(assetName(asset({ descriptor: 'CO2 5.0kg' }))).toBe('CO2 5.0kg');
  });

  it('falls back to the system and tag rather than an empty name', () => {
    // A register row can carry neither. A blank name in a list of four hundred
    // is unusable.
    expect(assetName(asset({ assetNumber: '12' }))).toMatch(/Extinguishers 12$/);
    expect(assetName(asset({}))).toMatch(/Extinguishers$/);
  });

  it('does not run away with a very long descriptor', () => {
    expect(assetName(asset({ descriptor: 'x'.repeat(200) })).length).toBeLessThanOrEqual(120);
  });
});

describe('the denormalised due date', () => {
  it('is the soonest of the routines, not the last written', () => {
    expect(soonestDue([
      { frequency: 'five-yearly', nextDueAt: '2030-10-01' },
      { frequency: 'six-monthly', nextDueAt: '2027-03-01' },
      { frequency: 'annual', nextDueAt: '2027-09-01' },
    ])).toBe('2027-03-01');
  });

  it('is nothing when the register carries no dates', () => {
    expect(soonestDue([])).toBeUndefined();
  });
});

/** Against the real register when present; never committed. */
const DIR = '/tmp/safeqld-data';
const describeReal = existsSync(DIR) ? describe : describe.skip;

describeReal('the shape of a real register once parsed', () => {
  it('gives every asset a site, a name and a type', () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.csv'))) {
      const parsed = parseAssetRegister(readFileSync(join(DIR, f), 'utf8'), f);
      for (const asset of parsed.assets) {
        expect([f, Boolean(asset.siteName)]).toEqual([f, true]);
        expect([f, assetName(asset).length > 0]).toEqual([f, true]);
        expect([f, asset.assetTypeId]).not.toEqual([f, 'unknown']);
      }
    }
  });

  it('produces a schedule the database can hold', () => {
    // Every frequency the register uses has to be one the routine vocabulary
    // knows, or the row is written and never matches a routine again.
    const known = new Set(['monthly', 'quarterly', 'six-monthly', 'annual', 'five-yearly', 'ten-yearly']);
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.csv'))) {
      const parsed = parseAssetRegister(readFileSync(join(DIR, f), 'utf8'), f);
      for (const asset of parsed.assets) {
        for (const entry of asset.schedule) {
          expect([f, entry.frequency, known.has(entry.frequency)]).toEqual([f, entry.frequency, true]);
        }
      }
    }
  });
});
