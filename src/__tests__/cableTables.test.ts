import {
  INSTALL_METHOD_SUGGESTIONS, INSULATION_PRESETS,
  candidatesFor, checkTable, formatRatingCsv, parseRatingCsv, searchRatings,
  type CableRating, type CableTable,
} from '@/domain/cableTables';

/**
 * The office's own cable tables.
 *
 * Two failures matter here and they are not the obvious ones.
 *
 * The first is a row silently dropped on import. A table missing its 16 mm²
 * line does not look wrong — it looks like a table — and the sizing engine
 * then quietly steps past the size that was the right answer. So every line
 * the parser could not read comes back with its line number and a reason, and
 * the screen shows them.
 *
 * The second is a figure with no source. Six months on, "where did this 63 A
 * come from" has one honest answer if the table records it and none if it does
 * not, and a designer cannot stand behind a number that came from a phone.
 */

const TABLE: CableTable = {
  id: 't1',
  label: 'V-75 2C+E, enclosed in a wall',
  source: 'the office copy, table 4(1) column 6',
  material: 'copper',
  insulation: 'V-75',
  installMethod: 'Enclosed in a wall or ceiling',
  cores: '2C+E',
  operatingC: 75,
  addedAt: '2026-09-10T01:00:00.000Z',
};

const rating = (id: string, areaMm2: number, amps: number, extra: Partial<CableRating> = {}): CableRating =>
  ({ id, tableId: 't1', areaMm2, amps, ...extra });

describe('what a table has to say about itself', () => {
  it('will not be saved without a source', () => {
    const problems = checkTable({ ...TABLE, source: '   ' });
    expect(problems.map((p) => p.field)).toEqual(['source']);
    expect(problems[0]!.reason).toContain('where the figures were read');
  });

  it('wants the rest of what makes a figure findable again', () => {
    expect(checkTable({}).map((p) => p.field).sort())
      .toEqual(['installMethod', 'insulation', 'label', 'operatingC', 'source']);
  });

  it('passes a table that is complete', () => {
    expect(checkTable(TABLE)).toEqual([]);
  });

  it('offers insulation by the name the cable is sold under', () => {
    // The temperature in V-75 is part of the product's name, printed on the
    // drum — not a figure lifted out of anybody's table.
    const v75 = INSULATION_PRESETS.find((p) => p.id === 'v75')!;
    expect(v75.operatingC).toBe(75);
    expect(INSULATION_PRESETS.find((p) => p.id === 'x90')!.operatingC).toBe(90);
    expect(INSTALL_METHOD_SUGGESTIONS.length).toBeGreaterThan(4);
  });
});

describe('reading a pasted table', () => {
  it('reads a header row and maps the columns off it', () => {
    const { rows, skipped } = parseRatingCsv('size,amps,mv\n1.5,17.5,26.4\n2.5,24,15.9');
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      { areaMm2: 1.5, amps: 17.5, mvPerAmpMetre: 26.4, line: 2 },
      { areaMm2: 2.5, amps: 24, mvPerAmpMetre: 15.9, line: 3 },
    ]);
  });

  it('takes the first two numbers when there is no header, because that is the order they are printed in', () => {
    const { rows } = parseRatingCsv('1.5\t17.5\n2.5\t24');
    expect(rows.map((r) => [r.areaMm2, r.amps])).toEqual([[1.5, 17.5], [2.5, 24]]);
  });

  it('reads a line pasted out of a PDF, where the cells are single spaces apart', () => {
    const { rows } = parseRatingCsv('6 41 6.64\n10 57 3.95');
    expect(rows.map((r) => [r.areaMm2, r.amps, r.mvPerAmpMetre])).toEqual([[6, 41, 6.64], [10, 57, 3.95]]);
  });

  it('does not eat a data row that happens to be first', () => {
    // The header check refuses any line carrying a bare number, so a paste
    // with no header keeps all of its rows.
    const { rows } = parseRatingCsv('1.5,17.5\n2.5,24');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.areaMm2).toBe(1.5);
  });

  it('recognises the column names people actually use', () => {
    const { rows } = parseRatingCsv('Conductor (mm2),Current Rating,mV/A/m\n4,32,9.9');
    expect(rows[0]).toEqual({ areaMm2: 4, amps: 32, mvPerAmpMetre: 9.9, line: 2 });
  });

  it('tolerates the units people leave on the numbers', () => {
    const { rows } = parseRatingCsv('size,amps\n2.5 mm2,24 A');
    expect(rows[0]!.areaMm2).toBe(2.5);
    expect(rows[0]!.amps).toBe(24);
  });

  it('reads a thousands separator where the separator is not itself a comma', () => {
    const { rows } = parseRatingCsv('size\tamps\n630\t1,010');
    expect(rows[0]).toEqual({ areaMm2: 630, amps: 1010, line: 2 });
  });

  it('skips the caption and the blank lines without complaining about the blanks', () => {
    const { rows, skipped } = parseRatingCsv('Table 4(1)\n\nsize,amps\n1.5,17.5\n');
    expect(rows).toHaveLength(1);
    // The caption is reported; an empty line is not a line anybody typed.
    expect(skipped).toEqual([{ line: 1, text: 'Table 4(1)', reason: 'no size and capacity on this line' }]);
  });

  it('names every line it could not read, rather than dropping it', () => {
    // The failure this exists for: a table quietly missing a size.
    const { rows, skipped } = parseRatingCsv('size,amps\n1.5,17.5\n2.5,nil\n0,24\n6,41');
    expect(rows.map((r) => r.areaMm2)).toEqual([1.5, 6]);
    expect(skipped.map((s) => [s.line, s.reason])).toEqual([
      [3, 'no size and capacity on this line'],
      [4, 'the size is not a positive number'],
    ]);
  });

  it('reads an empty paste as nothing at all', () => {
    expect(parseRatingCsv('')).toEqual({ rows: [], skipped: [] });
    expect(parseRatingCsv('   \n\n  ')).toEqual({ rows: [], skipped: [] });
  });

  it('leaves out a column the table did not give rather than inventing a zero', () => {
    const { rows } = parseRatingCsv('size,amps,mv,x\n1.5,17.5,,\n');
    expect(rows[0]!.mvPerAmpMetre).toBeUndefined();
    expect(rows[0]!.reactanceOhmPerKm).toBeUndefined();
  });
});

describe('writing the table back out', () => {
  it('round-trips through the parser', () => {
    const rows = [
      rating('a', 2.5, 24, { mvPerAmpMetre: 15.9 }),
      rating('b', 1.5, 17.5, { mvPerAmpMetre: 26.4, reactanceOhmPerKm: 0.12 }),
    ];
    const back = parseRatingCsv(formatRatingCsv(rows)).rows;
    expect(back.map((r) => [r.areaMm2, r.amps, r.mvPerAmpMetre])).toEqual([
      [1.5, 17.5, 26.4],
      [2.5, 24, 15.9],
    ]);
    expect(back[0]!.reactanceOhmPerKm).toBe(0.12);
  });

  it('writes a header even with nothing under it, so nobody has to guess the columns', () => {
    expect(formatRatingCsv([])).toBe('size,amps,mv,x,note');
  });

  it('quotes a note that would otherwise become two columns', () => {
    expect(formatRatingCsv([rating('a', 4, 32, { note: 'derate, see p.12' })]))
      .toContain('"derate, see p.12"');
  });
});

describe('searching across every table loaded', () => {
  const second: CableTable = { ...TABLE, id: 't2', label: 'X-90 single core, on a tray', insulation: 'X-90', material: 'aluminium', installMethod: 'On a cable tray or ladder' };
  const tables = [TABLE, second];
  const ratings = [
    rating('a', 2.5, 24),
    rating('b', 6, 41),
    { ...rating('c', 6, 55), id: 'c', tableId: 't2' },
    { ...rating('d', 16, 96), id: 'd', tableId: 't2' },
  ];

  it('matches a bare number against both the size and the capacity', () => {
    // Typing "6" on site means "what is 6 mil rated at" — across every table
    // at once, which is the comparison being made by hand otherwise.
    const hits = searchRatings(tables, ratings, { text: '6' });
    expect(hits.map((h) => [h.table.id, h.rating.areaMm2])).toEqual([['t1', 6], ['t2', 6]]);
  });

  it('filters by conductor, because aluminium and copper are not alternatives', () => {
    expect(searchRatings(tables, ratings, { material: 'aluminium' }).map((h) => h.rating.id)).toEqual(['c', 'd']);
  });

  it('answers "what carries 40 amps"', () => {
    expect(searchRatings(tables, ratings, { minAmps: 50 }).map((h) => h.rating.id)).toEqual(['c', 'd']);
  });

  it('finds a table by how it was installed, or by where the figures came from', () => {
    expect(searchRatings(tables, ratings, { text: 'tray' }).map((h) => h.rating.id)).toEqual(['c', 'd']);
    expect(searchRatings(tables, ratings, { text: 'table 4(1)'.toLowerCase() }).length).toBeGreaterThan(0);
  });

  it('wants every word, so two words narrow rather than widen', () => {
    expect(searchRatings(tables, ratings, { text: 'x-90 tray' })).toHaveLength(2);
    expect(searchRatings(tables, ratings, { text: 'x-90 wall' })).toHaveLength(0);
  });

  it('ignores a row whose table is gone rather than showing it sourceless', () => {
    expect(searchRatings([TABLE], ratings, {}).map((h) => h.rating.id)).toEqual(['a', 'b']);
  });

  it('comes back in size order, which is the order a decision is made in', () => {
    expect(searchRatings(tables, ratings, {}).map((h) => h.rating.areaMm2)).toEqual([2.5, 6, 6, 16]);
  });
});

describe('handing one table to the sizing engine', () => {
  it('carries the table\'s source onto every row', () => {
    const rows = candidatesFor(TABLE, [rating('b', 6, 41), rating('a', 2.5, 24, { mvPerAmpMetre: 15.9 })]);
    expect(rows.map((r) => r.areaMm2)).toEqual([2.5, 6]);
    expect(rows.every((r) => r.source === TABLE.source)).toBe(true);
    expect(rows[0]!.mvPerAmpMetre).toBe(15.9);
  });

  it('takes only its own rows', () => {
    const foreign = { ...rating('z', 4, 32), tableId: 'other' };
    expect(candidatesFor(TABLE, [foreign, rating('a', 2.5, 24)]).map((r) => r.areaMm2)).toEqual([2.5]);
  });
});
