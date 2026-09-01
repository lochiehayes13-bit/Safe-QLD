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

/**
 * The day these fixtures are read on.
 *
 * The overhaul column is judged against a calendar day — a test cannot have
 * been last done in a month still to come — so a fixture containing one has an
 * answer that depends on when it is read. Pinned rather than left to the clock,
 * because a suite that passes today and fails in 2031 is a suite nobody trusts
 * the day it goes red.
 */
const READ_ON = '2026-09-01T21:00:00.000Z';

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
    /*
     * The pivot itself, both sides of it. Two-digit years are all over the real
     * register — "1/2/23", "31/07/26", "1/9/21" — and where the split falls is
     * a fifty-year decision made by one character. Sixty-nine is 2069 and
     * seventy is 1970: for a fire door installed in the seventies that is the
     * only reading that makes sense, and for a due date in the twenties so is
     * the other one.
     *
     * Written down because nothing else says where the line is. Moving it by
     * one changes nothing any other test in this file asserts.
     */
    expect(parseAuDate('1/2/69')).toBe('2069-02-01');
    expect(parseAuDate('1/2/70')).toBe('1970-02-01');
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
  const parsed = () => parseAssetRegister(REGISTER, 'portable_and_wheeled_fire_extinguishers.csv', READ_ON);

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
  return parseAssetRegister(REGISTER, 'extinguishers.csv', READ_ON).warnings.join(' ');
}

/**
 * The boundaries of the overhaul reader.
 *
 * Free text typed by technicians over many years, so every one of these bounds
 * is a decision about which of two readings a cell gets. None of them was
 * written down, and each is one character wide.
 */
describe('what the overhaul column will and will not read', () => {
  it('splits a bare two-digit year at seventy, the same as a full date does', () => {
    // The same pivot as parseAuDate, in a second implementation of it. They can
    // drift apart silently, so both are pinned.
    expect(parseImpreciseDate('69')).toMatchObject({ year: 2069, precision: 'year' });
    expect(parseImpreciseDate('70')).toMatchObject({ year: 1970, precision: 'year' });
  });

  it('takes a four-digit year as written, leading zero and all', () => {
    expect(parseImpreciseDate('1999')).toMatchObject({ year: 1999, precision: 'year' });
    // Not a two-digit year of "01" with a nought on the front.
    expect(parseImpreciseDate('0100')).toMatchObject({ precision: 'unreadable' });
  });

  it('accepts the first and last plausible service year and nothing outside them', () => {
    /*
     * A bare number is only read as a year at all because the register really
     * does record one. Outside the range it is far more likely to be a tag
     * number or a quantity, and a tag number read as a year sets a clock.
     */
    expect(parseImpreciseDate('1970')).toMatchObject({ year: 1970, precision: 'year' });
    expect(parseImpreciseDate('2100')).toMatchObject({ year: 2100, precision: 'year' });
    expect(parseImpreciseDate('1969')).toMatchObject({ precision: 'unreadable' });
    expect(parseImpreciseDate('2101')).toMatchObject({ precision: 'unreadable' });
  });

  it('accepts January and December in a month-and-year cell', () => {
    expect(parseImpreciseDate('1/20')).toMatchObject({ year: 2020, month: 1, precision: 'month' });
    expect(parseImpreciseDate('12/20')).toMatchObject({ year: 2020, month: 12, precision: 'month' });
    // Thirteen is not a month, and reading it as a day would invent one.
    expect(parseImpreciseDate('13/20')).toMatchObject({ precision: 'unreadable' });
    expect(parseImpreciseDate('0/20')).toMatchObject({ precision: 'unreadable' });
  });
});

/**
 * A last test that has not happened yet.
 *
 * This column is the record of when the five- or ten-yearly test was **last
 * done**, and their real register has dates in it that are years away. The
 * extinguisher export has 359 rows reading "1/6/29", "1/9/29" and "1/03/2030";
 * three hydrants at Baldwin Living Northside have a whole cell of "30", which
 * is that hydrant's asset number typed into the wrong column and which this
 * reader was perfectly happy to call the year 2030.
 *
 * Believed, that is the worst failure this app has available to it. The next
 * test falls due five years after the last one, so a pressure test recorded as
 * 2030 is next due in 2035: the asset imports, sits on its site looking exactly
 * like every other asset, and never appears as due in the working life of
 * anybody who will use this. A date wrong in the other direction makes an asset
 * permanently overdue, and somebody chases that within a week.
 *
 * So the reading is refused and the cell kept verbatim. The office still sees
 * what was typed — they are the only ones who can correct it — and the schedule
 * falls back to the register's own due column, which is the right answer.
 */
describe('an overhaul date that has not happened yet', () => {
  const read = (cell: string) => parseImpreciseDate(cell, '2026-09-01');

  it('refuses a full date in the future and keeps what the cell said', () => {
    expect(read('1/6/29')).toEqual({ raw: '1/6/29', precision: 'unreadable' });
    expect(read('1/03/2030')).toEqual({ raw: '1/03/2030', precision: 'unreadable' });
  });

  it('refuses the asset number somebody typed into the column', () => {
    // "30" against asset 30. Read as a year it is 2030 and it moves a hydrant's
    // pressure test to 2035.
    expect(read('30')).toEqual({ raw: '30', precision: 'unreadable' });
  });

  it('accepts today, and the month and year that today is in', () => {
    /*
     * The test done this morning is the common case, and a rule that refused it
     * would be worse than the one it replaced. A month or a year is judged by
     * its first day, because a cell reading "09/26" in September is a real
     * record of a test done earlier this month.
     */
    expect(read('1/9/2026')).toMatchObject({ precision: 'day', iso: '2026-09-01' });
    expect(read('09/26')).toMatchObject({ precision: 'month', year: 2026, month: 9 });
    expect(read('26')).toMatchObject({ precision: 'year', year: 2026 });
    // And the month before it, which is the one the pivot could take away.
    expect(read('06/26')).toMatchObject({ precision: 'month', year: 2026, month: 6 });
  });

  it('refuses the day after today, and the month after this one', () => {
    expect(read('2/9/2026')).toEqual({ raw: '2/9/2026', precision: 'unreadable' });
    expect(read('10/26')).toEqual({ raw: '10/26', precision: 'unreadable' });
    expect(read('Oct-26')).toEqual({ raw: 'Oct-26', precision: 'unreadable' });
    expect(read('27')).toEqual({ raw: '27', precision: 'unreadable' });
  });

  it('reads the same cell without a day given, which is what the rule is for', () => {
    // Without the day there is nothing to judge against, and the reader is the
    // one it always was. This is why the day is threaded through the parse
    // rather than fetched inside the reader.
    expect(parseImpreciseDate('1/6/29')).toMatchObject({ precision: 'day', iso: '2029-06-01' });
    expect(parseImpreciseDate('30')).toMatchObject({ precision: 'year', year: 2030 });
  });

  it('says so on the import, naming a cell somebody can go and find', () => {
    const csv = [
      HEADER,
      row({ 'Asset ID': '1', 'Site ID': '9', 'Site Name': 'Baldwin Living Northside', 'Walk Order': '1',
            'Asset #': '30', 'Last 5 Yearly': '30', '5 Yearly': '1/11/2030', Yearly: '1/11/2026' }),
      row({ 'Asset ID': '2', 'Site ID': '9', 'Site Name': 'Baldwin Living Northside', 'Walk Order': '2',
            'Last 5 Yearly': '1/2/23', '5 Yearly': '1/2/2028', Yearly: '1/11/2026' }),
    ].join('\r\n');
    const r = parseAssetRegister(csv, 'extinguishers.csv', READ_ON);

    const warning = r.warnings.find((w) => w.includes('in the future'))!;
    expect(warning).toContain('1 overhaul date is in the future');
    expect(warning).toContain('"30"');
    expect(warning).toContain('asset 30');
    // The consequence, not just the count. A count reads as a parse complaint.
    expect(warning).toContain('five years past it');

    // Refused on the asset, and the good one beside it untouched.
    expect(r.assets[0]!.lastOverhaul).toEqual({ raw: '30', precision: 'unreadable' });
    expect(r.assets[1]!.lastOverhaul).toMatchObject({ precision: 'day', iso: '2023-02-01' });
  });

  it('names the site where the register carries no tag for the asset', () => {
    // Most of the extinguisher rows this fires on have an empty Asset # column,
    // and "asset undefined" sends nobody anywhere.
    const csv = [
      HEADER,
      row({ 'Asset ID': '1', 'Site ID': '9', 'Site Name': 'Logan DC', 'Walk Order': '1',
            'Last 5 Yearly': '1/03/2030', Yearly: '1/3/2027' }),
    ].join('\r\n');
    const warning = parseAssetRegister(csv, 'extinguishers.csv', READ_ON)
      .warnings.find((w) => w.includes('in the future'))!;
    expect(warning).toContain('an asset at Logan DC');
  });

  it('says nothing where every overhaul date is in the past', () => {
    expect(parsed_warnings()).not.toMatch(/in the future/);
  });
});

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

  it('leaves no overhaul date in the future anywhere in it', () => {
    /*
     * The reason the rule exists, measured on the file it was found in. Read
     * on the day the register was exported, 362 cells across two systems record
     * a test that had not happened — 359 extinguishers and three hydrants —
     * and every one of them would have pushed its next pressure test past the
     * working life of the people using this.
     *
     * Asserted as none remaining rather than as the count, because the count is
     * a fact about a file that is not in this repository and will change the
     * next time it is exported. What must not change is that none of them is
     * believed.
     */
    let refused = 0;
    for (const path of registers) {
      const r = parseAssetRegister(readFileSync(path, 'utf8'), path, READ_ON);
      const ahead = r.assets
        .filter((a) => a.lastOverhaul?.year !== undefined)
        .filter((a) => {
          const o = a.lastOverhaul!;
          const first = o.iso ?? `${o.year}-${String(o.month ?? 1).padStart(2, '0')}-01`;
          return first > READ_ON.slice(0, 10);
        })
        .map((a) => a.lastOverhaul!.raw);
      expect([path, ahead]).toEqual([path, []]);
      refused += r.warnings.some((w) => w.includes('in the future')) ? 1 : 0;
    }
    // And it is finding them, rather than the registers having none.
    expect(refused).toBeGreaterThan(0);
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
