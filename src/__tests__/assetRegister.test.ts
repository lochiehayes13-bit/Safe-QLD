import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  detectSystem, isAssetRegister, parseAssetRegister, parseAuDate, parseImpreciseDate,
} from '@/parsers/assetRegister';

/**
 * The asset register importer.
 *
 * A misparsed register does not look misparsed. It looks like a normal book of
 * work with the wrong dates in it, and it sends a technician to the wrong site
 * in the wrong month. So most of what follows is about the two ways that
 * happens quietly: reading a day-first date the other way round, and treating
 * a technician's "unknown" as content.
 */

const HEADER = [
  'Asset ID', 'Contract Name', 'Contract No.', 'Site ID', 'Site Name', 'Walk Order',
  'Service Start Date', 'Parent Asset', 'Inherit Parent Asset Service Level', 'Asset #',
  'Extinguisher Type', 'Last 5 Yearly', 'Location', '5 Yearly', '6 Monthly', 'Yearly',
].join(',');

const row = (cells: Partial<Record<string, string>>): string => {
  const order = HEADER.split(',');
  return order.map((c) => {
    const v = cells[c] ?? '';
    return v.includes(',') ? `"${v}"` : v;
  }).join(',');
};

const REGISTER = [
  HEADER,
  row({ 'Asset ID': '14211', 'Site ID': '255', 'Site Name': 'Star of the Sea', 'Walk Order': '6',
        'Service Start Date': '1/10/2025', 'Extinguisher Type': 'DCP 2.5kg ABE', 'Last 5 Yearly': '01/20',
        Location: 'Church rear entry - LHS', '5 Yearly': '1/10/2025', '6 Monthly': '1/3/2027', Yearly: '1/3/2027' }),
  row({ 'Asset ID': '14227', 'Site ID': '1427', 'Site Name': 'ProFold Roofing', 'Walk Order': '1',
        'Service Start Date': '24/7/2026', 'Extinguisher Type': 'CO2 5.0kg', 'Last 5 Yearly': 'Jun-25',
        Location: 'RHS Rollerdoor', '5 Yearly': '24/7/2031', '6 Monthly': '24/1/2027', Yearly: '24/7/2027' }),
  // The state of a lot of real rows: someone typed "unknown" rather than leaving it blank.
  row({ 'Asset ID': '9001', 'Site ID': '1427', 'Site Name': 'ProFold Roofing', 'Walk Order': '2',
        'Service Start Date': '24/7/2026', 'Extinguisher Type': 'unknown', 'Last 5 Yearly': 'unknown',
        Location: 'unknown', Yearly: '24/7/2027' }),
].join('\r\n');

describe('reading a day-first date', () => {
  // The whole schedule rests on this. Read month-first, "1/10/2025" becomes
  // January and two thirds of a year's work silently moves.
  it('reads day, month, year', () => {
    expect(parseAuDate('1/10/2025')).toBe('2025-10-01');
    expect(parseAuDate('24/7/2026')).toBe('2026-07-24');
    expect(parseAuDate('22/5/2026')).toBe('2026-05-22');
    expect(parseAuDate('21/8/2036')).toBe('2036-08-21');
  });

  it('never reads it month-first, even where both would parse', () => {
    // 1 October, not 10 January. Nothing in the value distinguishes them, which
    // is exactly why the format has to be fixed rather than sniffed per value.
    expect(parseAuDate('1/10/2025')).toBe('2025-10-01');
    expect(parseAuDate('3/4/2026')).toBe('2026-04-03');
  });

  it('expands a two-digit year the way a service record means it', () => {
    expect(parseAuDate('1/2/23')).toBe('2023-02-01');
    expect(parseAuDate('1/2/99')).toBe('1999-02-01');
  });

  it('refuses a date that is not a real day rather than rolling it over', () => {
    // Date would happily turn 31 February into 3 March.
    expect(parseAuDate('31/2/2025')).toBeUndefined();
    expect(parseAuDate('31/4/2025')).toBeUndefined();
    expect(parseAuDate('13/13/2025')).toBeUndefined();
    expect(parseAuDate('0/1/2025')).toBeUndefined();
  });

  it('accepts a genuine end of month', () => {
    expect(parseAuDate('29/2/2024')).toBe('2024-02-29');
    expect(parseAuDate('31/1/2025')).toBe('2025-01-31');
  });

  it('refuses formats it is not sure about', () => {
    expect(parseAuDate('2025-10-01')).toBeUndefined();
    expect(parseAuDate('Jun-25')).toBeUndefined();
    expect(parseAuDate('unknown')).toBeUndefined();
    expect(parseAuDate('')).toBeUndefined();
  });
});

describe('reading the overhaul column to its real precision', () => {
  // Free text typed by technicians over years. The next test falls due a fixed
  // interval after the last, so a month read as a day moves the next one.

  it('reads a full date as a day', () => {
    expect(parseImpreciseDate('1/2/23')).toMatchObject({ precision: 'day', year: 2023, month: 2, day: 1, iso: '2023-02-01' });
  });

  it('reads month and year as a month, and invents no day', () => {
    expect(parseImpreciseDate('01/20')).toMatchObject({ precision: 'month', year: 2020, month: 1 });
    expect(parseImpreciseDate('01/20')!.day).toBeUndefined();
    expect(parseImpreciseDate('01/20')!.iso).toBeUndefined();
    expect(parseImpreciseDate('Jun-25')).toMatchObject({ precision: 'month', year: 2025, month: 6 });
    expect(parseImpreciseDate('1/2023')).toMatchObject({ precision: 'month', year: 2023, month: 1 });
  });

  it('reads a bare year as a year', () => {
    expect(parseImpreciseDate('2019')).toMatchObject({ precision: 'year', year: 2019 });
    expect(parseImpreciseDate('25')).toMatchObject({ precision: 'year', year: 2025 });
  });

  it('does not mistake a detector date code for a date', () => {
    // "6015" is a Notifier date code meaning week 60 of 2015-ish, and appears
    // in these columns. Read as a year it is 6015 AD.
    expect(parseImpreciseDate('6015')!.precision).toBe('unreadable');
  });

  it('always keeps what the cell actually said', () => {
    expect(parseImpreciseDate('Jun-25')!.raw).toBe('Jun-25');
    expect(parseImpreciseDate('unknown')).toMatchObject({ raw: 'unknown', precision: 'unreadable' });
  });
});

describe('recognising a register', () => {
  it('accepts one and rejects other tabular exports', () => {
    expect(isAssetRegister(REGISTER)).toBe(true);
    expect(isAssetRegister('Address,Zone,Text\n1,1,HALL')).toBe(false);
  });

  it('identifies the system from the file name', () => {
    expect(detectSystem('emergency_lighting_export_20260901.csv', [])?.system).toBe('emergency-lighting');
    expect(detectSystem('fire_hose_reels_export.csv', [])?.system).toBe('hose-reel');
    expect(detectSystem('portable_and_wheeled_fire_extinguishers.csv', [])?.system).toBe('extinguisher');
  });

  it('identifies it from the columns when the file has been renamed', () => {
    // Renaming an export is routine, and the column set is the better evidence.
    expect(detectSystem('export (3).csv', ['Site Name', 'Extinguisher Type'])?.system).toBe('extinguisher');
    expect(detectSystem('export (3).csv', ['Site Name', 'EWIS Brand'])?.system).toBe('ews');
    expect(detectSystem('export (3).csv', ['Site Name', 'Annual Flow Test'])?.system).toBe('hose-reel');
  });

  it('says so rather than guessing when it recognises neither', () => {
    const r = parseAssetRegister(REGISTER.replace('Extinguisher Type', 'Widget Type'), 'export.csv');
    expect(r.system).toBe('unknown');
    expect(r.warnings.join(' ')).toMatch(/could not be identified/i);
    expect(r.assets[0]!.assetTypeId).toBe('unknown');
  });
});

describe('reading a register', () => {
  const parsed = () => parseAssetRegister(REGISTER, 'portable_and_wheeled_fire_extinguishers.csv');

  it('maps rows to assets of the right type', () => {
    const r = parsed();
    expect(r.system).toBe('extinguisher');
    expect(r.assets).toHaveLength(3);
    expect(r.assets.every((a) => a.assetTypeId === 'extinguisher')).toBe(true);
  });

  it('keeps the platform id, which is what makes a re-import an update', () => {
    expect(parsed().assets[0]!.externalId).toBe('14211');
    expect(parsed().assets[0]!.siteExternalId).toBe('255');
  });

  it('reads the walk order, which is the route around the site', () => {
    expect(parsed().assets.map((a) => a.walkOrder)).toEqual([6, 1, 2]);
  });

  it('builds the schedule from the frequency columns', () => {
    expect(parsed().assets[0]!.schedule).toEqual([
      { frequency: 'five-yearly', nextDueAt: '2025-10-01' },
      { frequency: 'six-monthly', nextDueAt: '2027-03-01' },
      { frequency: 'annual', nextDueAt: '2027-03-01' },
    ]);
  });

  it('treats "unknown" as nothing, not as content', () => {
    // Otherwise the asset is located in a room called "unknown", and every
    // register in the business has hundreds of them.
    const spare = parsed().assets.find((a) => a.externalId === '9001')!;
    expect(spare.location).toBeUndefined();
    expect(spare.descriptor).toBeUndefined();
    expect(spare.lastOverhaul).toMatchObject({ raw: 'unknown', precision: 'unreadable' });
    expect(spare.schedule).toEqual([{ frequency: 'annual', nextDueAt: '2027-07-24' }]);
  });

  it('counts the sites, biggest first', () => {
    const sites = parsed().sites;
    expect(sites).toEqual([
      { externalId: '1427', name: 'ProFold Roofing', assetCount: 2 },
      { externalId: '255', name: 'Star of the Sea', assetCount: 1 },
    ]);
  });

  it('trims a heading with a trailing space', () => {
    // One real export ships "FRL Level " that way, and an untrimmed lookup
    // silently drops the column.
    const r = parseAssetRegister(
      'Site Name,Walk Order,FRL Level ,6 Monthly\r\nCentra,3,-/60/30,1/3/2027',
      'smoke_doors.csv',
    );
    expect(r.system).toBe('smoke-door');
    expect(r.assets[0]!.extra['FRL Level']).toBe('-/60/30');
  });

  it('keeps a column it does not understand rather than dropping it', () => {
    const r = parseAssetRegister(
      'Site Name,Walk Order,Extinguisher Type,Hydro Test Pressure\r\nX,1,DCP 4.5kg,2500 kPa',
      'extinguishers.csv',
    );
    expect(r.assets[0]!.extra['Hydro Test Pressure']).toBe('2500 kPa');
  });

  it('skips a row with no site rather than filing it nowhere', () => {
    const r = parseAssetRegister(`${REGISTER}\r\n${row({ 'Asset ID': '999', 'Walk Order': '9' })}`,
      'extinguishers.csv');
    expect(r.assets).toHaveLength(3);
    expect(r.warnings.join(' ')).toMatch(/1 row has no site name/i);
  });
});

describe('reporting what looks wrong in the source', () => {
  it('flags a routine due long before servicing began', () => {
    // Most due dates snap to the first of a month, so a few days early is
    // normal. Months early is a wrong year typed into the source system, and
    // the asset then reads as permanently overdue.
    const stale = [
      HEADER,
      row({ 'Asset ID': '10121', 'Site ID': '1', 'Site Name': 'Somewhere', 'Walk Order': '1',
            'Service Start Date': '1/10/2025', '5 Yearly': '1/3/1980', Yearly: '1/10/2026' }),
    ].join('\r\n');
    const r = parseAssetRegister(stale, 'extinguishers.csv');
    expect(r.warnings.join(' ')).toMatch(/due more than two months before servicing started/i);
    expect(r.warnings.join(' ')).toMatch(/1980-03-01/);
  });

  it('does not flag the ordinary first-of-month snap', () => {
    const snapped = [
      HEADER,
      row({ 'Asset ID': '1', 'Site ID': '1', 'Site Name': 'Somewhere', 'Walk Order': '1',
            'Service Start Date': '5/1/2026', Yearly: '1/1/2026' }),
    ].join('\r\n');
    expect(parseAssetRegister(snapped, 'extinguishers.csv').warnings.join(' '))
      .not.toMatch(/before servicing started/i);
  });

  it('says how many overhaul dates know only a month', () => {
    expect(parsed_warnings()).toMatch(/record a month and year but no day/i);
  });
});

function parsed_warnings(): string {
  return parseAssetRegister(REGISTER, 'extinguishers.csv').warnings.join(' ');
}

/**
 * Against the real register when it is present. This is Safe QLD's live book of
 * work — 12,553 assets across 897 named sites — so it is never committed and
 * these skip on CI. Everything above is built in the test for that reason.
 */
const DIR = '/tmp/safeqld-data';
const registers = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.csv')).map((f) => join(DIR, f))
  : [];
const describeReal = registers.length ? describe : describe.skip;

describeReal('against the real register', () => {
  it('identifies every system and reads every row', () => {
    let assets = 0;
    const sites = new Set<string>();
    for (const path of registers) {
      const text = readFileSync(path, 'utf8');
      expect([path, isAssetRegister(text)]).toEqual([path, true]);
      const r = parseAssetRegister(text, path);
      // Not one register may fall through unidentified.
      expect([path, r.system]).not.toEqual([path, 'unknown']);
      assets += r.assets.length;
      for (const s of r.sites) sites.add(s.externalId ?? s.name);
    }
    expect(assets).toBeGreaterThan(10000);
    expect(sites.size).toBeGreaterThan(500);
  });

  it('reads every due date it accepts, with none left unreadable', () => {
    for (const path of registers) {
      const r = parseAssetRegister(readFileSync(path, 'utf8'), path);
      expect([path, r.warnings.filter((w) => /not in day\/month\/year form/.test(w))]).toEqual([path, []]);
    }
  });
});

/**
 * An asset the app can never make due.
 *
 * Quieter than a wrong due date and worse. A wrong date makes an asset
 * permanently overdue, which somebody eventually notices and chases; no
 * interval at all means there is nothing to count from, so the asset never
 * appears in the due list, never lands in a month plan, and never gets
 * serviced through the schedule. It sits in the register looking exactly like
 * every other asset.
 */
describe('assets with no service interval', () => {
  const csvOf = (...bodies: Partial<Record<string, string>>[]) =>
    [HEADER, ...bodies.map(row)].join('\n');

  it('says how many and what they are', () => {
    const csv = csvOf(
      { 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '101', 'Walk Order': '1', 'Location': 'Kitchen', 'Service Start Date': '20/10/2025' },
      { 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '102', 'Walk Order': '2', 'Location': 'Kitchen', 'Service Start Date': '20/10/2025' },
      { 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '103', 'Walk Order': '3', 'Location': 'Level 1', 'Service Start Date': '20/10/2025', '6 Monthly': '20/04/2026' },
    );
    const warning = parseAssetRegister(csv, 'fire_blankets_export.csv').warnings
      .find((w) => w.includes('no service interval'));
    expect(warning).toBeDefined();
    expect(warning).toContain('2 assets');
  });

  it('explains the consequence rather than just counting', () => {
    /*
     * A count on its own reads as a parse complaint. What a person needs to
     * know is that these will not show up anywhere they would look for them.
     */
    const csv = csvOf({ 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '101', 'Walk Order': '1', 'Service Start Date': '20/10/2025' });
    const warning = parseAssetRegister(csv, 'fire_blankets_export.csv').warnings
      .find((w) => w.includes('no service interval'))!;
    expect(warning).toContain('will not appear in the due list');
    expect(warning).toContain('source system');
  });

  it('says nothing where every asset has an interval', () => {
    const csv = csvOf({ 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '101', 'Walk Order': '1', 'Service Start Date': '20/10/2025', '6 Monthly': '20/04/2026' });
    expect(parseAssetRegister(csv, 'fire_blankets_export.csv').warnings
      .some((w) => w.includes('no service interval'))).toBe(false);
  });

  it('still imports them, because a register row is a real asset', () => {
    // Refusing the row would lose the asset entirely. It exists on the site and
    // the technician should see it; what it lacks is a schedule.
    const csv = csvOf({ 'Site Name': 'An Example Building', 'Site ID': '1', 'Asset ID': '101', 'Walk Order': '1', 'Service Start Date': '20/10/2025' });
    const parsed = parseAssetRegister(csv, 'fire_blankets_export.csv');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]!.schedule).toEqual([]);
  });
});
