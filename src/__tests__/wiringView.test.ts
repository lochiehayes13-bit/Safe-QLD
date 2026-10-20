import { capacityColumns, candidateRowsFor } from '@/domain/wiringCables';
import {
  columnDoubts, doubtColumns, printedColumn, searchTables, tableDoubts, tableFacts, tidyHeading,
} from '@/domain/wiringView';
import { WIRING_TABLES, wiringTable } from '@/seed/wiring';

/** Words that belong to how the tables were typed up, never to the book. */
const WORKING = /\/tmp|scratchpad|\.txt\b|reader [ab]\b|adjudicat|extraction|transcri|not recoverable|not captured/i;

describe('what the wiring tables screen shows', () => {
  it('carries no working notes, file paths or build text in anything it prints', () => {
    for (const t of WIRING_TABLES) {
      for (const line of tableDoubts(t)) expect(line).not.toMatch(WORKING);
      for (const f of tableFacts(t)) expect(f.value).not.toMatch(WORKING);
      for (const c of t.columns) expect(c.label).not.toMatch(WORKING);
    }
  });

  it('keeps every doubt to one short line, and only a few tables have one', () => {
    const flagged = WIRING_TABLES.filter((t) => tableDoubts(t).length);
    expect(flagged.length).toBeLessThan(25);
    for (const t of flagged) for (const line of tableDoubts(t)) expect(line.length).toBeLessThanOrEqual(100);
  });

  it('shows the title-block facts a technician reads, tidied', () => {
    const facts = Object.fromEntries(tableFacts(wiringTable('as3008', 'Table 8')!).map((f) => [f.label, f.value]));
    expect(facts.Cable).toBe('Three single-core (See Note 1)');
    expect(facts.Ambient).toBe('40°C in air, 25°C in ground');
    expect(facts.Insulation).toContain('R-HF-90 or R-CSP-90');
    expect(facts.Page).toBe('45');
    expect(Object.keys(facts)).not.toContain('column numbering');
  });

  it('puts the unit on a bare list of temperatures', () => {
    const facts = tableFacts(wiringTable('as3008', 'Table 40')!);
    expect(facts.find((f) => f.label === 'Conductor temp')?.value).toBe('45, 60, 75, 90, 110 °C');
  });

  it('never matches a search on a working note', () => {
    // Table 1's meta still records how its dashes were typed up.
    expect(searchTables('transcribed')).toEqual([]);
    expect(searchTables('buried direct').some((h) => h.table.ref === 'Table 4')).toBe(true);
    expect(searchTables('table 13')[0]?.table.ref).toBe('Table 13');
  });
});

describe('tidyHeading', () => {
  it('turns a shouted title block into a sentence, keeping designations', () => {
    expect(tidyHeading('THREE SINGLE-CORE (See Note 1)')).toBe('Three single-core');
    expect(tidyHeading('X-90, X-HF-90, R-EP-90, R-CPE-90, R-HF-90 OR R-CSP-90'))
      .toBe('X-90, X-HF-90, R-EP-90, R-CPE-90, R-HF-90 or R-CSP-90');
    expect(tidyHeading('40°C IN AIR, 25°C IN GROUND')).toBe('40°C in air, 25°C in ground');
  });

  it('leaves a heading that was not shouted alone, units included', () => {
    expect(tidyHeading('mV/A.m')).toBe('mV/A.m');
    expect(tidyHeading('Three single-core (see Note 1)')).toBe('Three single-core');
  });
});

describe('column numbers as the book prints them', () => {
  const ref = (tableRef: string, label: RegExp) =>
    capacityColumns().find((c) => c.tableRef === tableRef && label.test(c.installMethod) && c.material === 'copper')!.ref;

  it('numbers the second page the way Table 3 and the notes do', () => {
    // Table 3(3): buried direct is Table 6 Column 15, Tables 7 and 8 Column 22,
    // Tables 10 and 11 Column 23.
    expect(ref('Table 6', /^Buried direct/)).toBe('Table 6 col 15');
    expect(ref('Table 7', /^Buried direct/)).toBe('Table 7 col 22');
    expect(ref('Table 9', /^Buried direct/)).toBe('Table 9 col 15');
    expect(ref('Table 10', /Buried direct/)).toBe('Table 10 col 23');
    // Tables that already keep the repeated size column are unchanged.
    expect(ref('Table 4', /^Buried direct/)).toBe('Table 4 col 22');
    expect(ref('Table 13', /^Buried direct/)).toBe('Table 13 col 23');
  });

  it('leaves the first page, and the other book, alone', () => {
    const t6 = wiringTable('as3008', 'Table 6')!;
    expect(printedColumn(t6, 2)).toBe(2);
    expect(printedColumn(t6, 9)).toBe(9);
    expect(printedColumn(t6, 10)).toBe(11);
    expect(printedColumn(wiringTable('as3000', 'Table C10')!, 20)).toBe(20);
  });

  it('still reads the figures from the seed column, not the printed number', () => {
    const c = capacityColumns().find((x) => x.tableRef === 'Table 7' && x.printedN === 22)!;
    expect(c.columnN).toBe(21);
    const rows = candidateRowsFor(c).rows;
    expect(rows.length).toBeGreaterThan(5);
  });
});

describe('the cable picker', () => {
  it('offers each cable once, however its table block was printed', () => {
    const cores = [...new Set(capacityColumns().map((c) => c.cores))];
    const folded = new Set(cores.map((c) => c.toLowerCase()));
    expect(folded.size).toBe(cores.length);
    expect(cores).toContain('Three single-core');
    expect(cores).not.toContain('');
  });

  it('reaches Tables 6 and 7, whose title-block keys are spelt with spaces', () => {
    const t6 = capacityColumns().filter((c) => c.tableRef === 'Table 6');
    const t7 = capacityColumns().filter((c) => c.tableRef === 'Table 7');
    expect(t6[0]!.cores).toBe('Two single-core');
    expect(t6[0]!.insulation).toBe('R-HF-110, R-E-110 or X-HF-110');
    expect(t6[0]!.operatingC).toBe(110);
    expect(t7[0]!.cores).toBe('Three single-core');
  });

  it('tells the two underground arrangements apart', () => {
    const t5 = capacityColumns().filter((c) => c.tableRef === 'Table 5' && /nderground/.test(c.installMethod));
    expect(new Set(t5.map((c) => c.installMethod))).toEqual(new Set([
      'Underground wiring enclosure › in same enclosure',
      'Underground wiring enclosure › in separate enclosures',
    ]));
  });

  it('carries a doubt only to the column it is about', () => {
    const t8 = wiringTable('as3008', 'Table 8')!;
    expect(doubtColumns('Columns 24–28 headings taken from Table 3(4).')).toEqual([24, 25, 26, 27, 28]);
    expect(doubtColumns('Note 8 says Column 21; it means Column 22 (buried direct, Cu).')).toEqual([]);
    expect(columnDoubts(t8, 27)).toHaveLength(1);
    expect(columnDoubts(t8, 2)).toEqual([]);
    const plain = capacityColumns().find((c) => c.tableRef === 'Table 8' && c.printedN === 2)!;
    expect(plain.doubts).toEqual([]);
  });
});
