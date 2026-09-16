import {
  allRatings, candidateRows, deleteCableTable, deleteDeratingEntry, deleteRating, importRatings,
  listCableTables, listDeratingEntries, listRatings, saveCableTable,
  saveDeratingEntry, saveRating, searchCableTables,
} from '@/db/cableRepo';
import { openMigrated } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The office's cable tables, actually written and read back.
 *
 * The failure this is written against is a half-imported table. A paste of
 * forty lines where three did not read leaves a table that looks complete —
 * sizes going up the screen, capacities beside them — and the sizing engine
 * then steps straight past the size that was missing and offers the next one
 * up. Nobody finds out, because a cable that is one size too big works.
 *
 * So the import reports what it read, what it replaced and every line it could
 * not, and the deletion takes the rows with the table: a capacity figure whose
 * table is gone has no source, no insulation and no installation method, and
 * the search would skip it silently.
 */

const TABLE = {
  label: 'V-75 2C+E, enclosed in a wall',
  source: 'the office copy, table 4(1) column 6',
  material: 'copper' as const,
  insulation: 'V-75',
  installMethod: 'Enclosed in a wall or ceiling',
  cores: '2C+E',
  operatingC: 75,
};

beforeEach(async () => {
  await openMigrated();
});

describe('a table', () => {
  it('goes in and comes back as it was written', async () => {
    const id = await saveCableTable(TABLE);
    const [back] = await listCableTables();
    expect(back).toMatchObject({ id, label: TABLE.label, source: TABLE.source, material: 'copper', cores: '2C+E' });
    expect(back!.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is edited in place rather than duplicated', async () => {
    const id = await saveCableTable(TABLE);
    await saveCableTable({ ...TABLE, id, label: 'V-75 2C+E, in thermal insulation' });
    const tables = await listCableTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]!.label).toContain('thermal insulation');
  });

  it('reads a conductor it has no constants for as copper rather than handing it to the calculator', async () => {
    const id = await saveCableTable({ ...TABLE, material: 'gold' as never });
    expect((await listCableTables())[0]!.material).toBe('copper');
    expect(id).toBeTruthy();
  });

  it('takes its rows with it when it goes', async () => {
    const id = await saveCableTable(TABLE);
    await importRatings(id, 'size,amps\n1.5,17.5\n2.5,24');
    await deleteCableTable(id);
    expect(await listCableTables()).toEqual([]);
    // The orphan this prevents: a capacity with nothing behind it.
    expect(await allRatings()).toEqual([]);
  });
});

describe('importing a paste', () => {
  it('says how many rows it read and names every line it could not', async () => {
    const id = await saveCableTable(TABLE);
    const outcome = await importRatings(id, 'size,amps\n1.5,17.5\n2.5,nil\n6,41');
    expect(outcome.imported).toBe(2);
    expect(outcome.replaced).toBe(0);
    expect(outcome.skipped.map((s) => s.line)).toEqual([3]);
    expect((await listRatings(id)).map((r) => r.areaMm2)).toEqual([1.5, 6]);
  });

  it('overwrites a size already there rather than listing it twice', async () => {
    // "I forgot the 16 mil row" — paste the whole thing again.
    const id = await saveCableTable(TABLE);
    await importRatings(id, 'size,amps\n1.5,17.5\n2.5,24');
    const outcome = await importRatings(id, 'size,amps\n1.5,17.5\n2.5,25\n16,96');
    expect(outcome.replaced).toBe(2);
    const rows = await listRatings(id);
    expect(rows.map((r) => r.areaMm2)).toEqual([1.5, 2.5, 16]);
    expect(rows.find((r) => r.areaMm2 === 2.5)!.amps).toBe(25);
  });

  it('clears the old figures first when the table is being replaced', async () => {
    const id = await saveCableTable(TABLE);
    await importRatings(id, 'size,amps\n1.5,17.5\n2.5,24\n6,41');
    const outcome = await importRatings(id, 'size,amps\n1.5,18\n2.5,25', { replace: true });
    expect(outcome.replaced).toBe(3);
    // Two generations of figures side by side is the thing this avoids.
    expect((await listRatings(id)).map((r) => r.areaMm2)).toEqual([1.5, 2.5]);
  });

  it('keeps a column the table did not give as absent rather than zero', async () => {
    const id = await saveCableTable(TABLE);
    await importRatings(id, 'size,amps,mv\n1.5,17.5,26.4\n2.5,24,');
    const rows = await listRatings(id);
    expect(rows[0]!.mvPerAmpMetre).toBe(26.4);
    expect(rows[1]!.mvPerAmpMetre).toBeUndefined();
  });

  it('imports nothing and complains about nothing when the paste is empty', async () => {
    const id = await saveCableTable(TABLE);
    expect(await importRatings(id, '   ')).toEqual({ imported: 0, replaced: 0, skipped: [] });
  });
});

describe('a row typed by hand', () => {
  it('is saved, edited and removed', async () => {
    const tableId = await saveCableTable(TABLE);
    const id = await saveRating({ tableId, areaMm2: 4, amps: 32 });
    await saveRating({ id, tableId, areaMm2: 4, amps: 33, note: 'derated on site' });
    const [row] = await listRatings(tableId);
    expect(row).toMatchObject({ areaMm2: 4, amps: 33, note: 'derated on site' });
    await deleteRating(id);
    expect(await listRatings(tableId)).toEqual([]);
  });
});

describe('searching across the tables', () => {
  it('finds a size in every table at once, with the table it came from', async () => {
    const copper = await saveCableTable(TABLE);
    const alu = await saveCableTable({ ...TABLE, label: 'X-90 single, on a tray', material: 'aluminium', insulation: 'X-90' });
    await importRatings(copper, 'size,amps\n6,41\n10,57');
    await importRatings(alu, 'size,amps\n6,55\n10,74');

    const hits = await searchCableTables({ text: '6' });
    expect(hits.map((h) => h.rating.amps).sort((a, b) => a - b)).toEqual([41, 55]);
    expect(hits.every((h) => h.table.source === TABLE.source)).toBe(true);

    expect((await searchCableTables({ material: 'aluminium' })).map((h) => h.rating.amps)).toEqual([55, 74]);
  });
});

describe('handing a table to the sizing engine', () => {
  it('comes back in size order with the source on every row', async () => {
    const id = await saveCableTable(TABLE);
    await importRatings(id, 'size,amps,mv\n6,41,6.64\n1.5,17.5,26.4');
    const rows = await candidateRows(id);
    expect(rows.map((r) => r.areaMm2)).toEqual([1.5, 6]);
    expect(rows[0]!.source).toBe(TABLE.source);
    expect(rows[0]!.mvPerAmpMetre).toBe(26.4);
  });

  it('is empty for a table that is not there, rather than throwing', async () => {
    expect(await candidateRows('gone')).toEqual([]);
  });
});

describe('derating factors', () => {
  it('are kept apart from the cable tables, because grouping applies to all of them', async () => {
    await saveDeratingEntry({ kind: 'grouping', condition: 'six circuits touching', factor: 0.57, source: 'office copy, table 22' });
    const id = await saveDeratingEntry({ kind: 'ambient', condition: '40 °C in air', factor: 0.87, source: 'office copy, table 27' });
    const entries = await listDeratingEntries();
    expect(entries.map((e) => e.kind)).toEqual(['ambient', 'grouping']);
    expect(entries[0]!.factor).toBe(0.87);
    await deleteDeratingEntry(id);
    expect((await listDeratingEntries()).map((e) => e.kind)).toEqual(['grouping']);
  });
});
