import {
  arrangementOf, candidateRowsFor, capacityColumns, conductorFormOf, deratingFactors, deratingFor,
  describeColumn, wiringCoverage,
} from '@/domain/wiringCables';
import { sizeCable } from '@/calc/cable';
import { WIRING_TABLES, wiringTable } from '@/seed/wiring';

/**
 * The join between the book and the calculator.
 *
 * Everything here is checked against figures that are on a page rather than
 * against the code's own output: a bridge that reads the wrong column is
 * indistinguishable from a working one until somebody's cable is undersized.
 */

describe('what the phone carries', () => {
  it('holds the capacity tables, not a sample of them', () => {
    const coverage = wiringCoverage();
    expect(coverage.tables).toBeGreaterThanOrEqual(10);
    expect(coverage.columns).toBeGreaterThan(150);
    expect(coverage.deratingFactors).toBeGreaterThan(200);
  });

  it('is the 2009 edition with its amendment, and says so on every column', () => {
    for (const c of capacityColumns()) {
      expect(c.source).toContain('AS/NZS 3008.1.1:2009');
      expect(c.source).toContain(c.tableRef);
    }
  });
});

describe('reading a capacity column', () => {
  const columns = capacityColumns();

  it('does not offer the repeated conductor size column as a rating', () => {
    // Table 4 is printed across two pages and repeats the size key at the left
    // of the second. Offered as a rating it reads "2.5 mm² carries 2.5 A".
    const table4 = columns.filter((c) => c.tableRef === 'Table 4');
    expect(table4.some((c) => c.columnN === 14)).toBe(false);
    expect(table4.length).toBeGreaterThan(20);
  });

  it('reads the figures off the page for a three-core thermoplastic run', () => {
    const c = columns.find((x) => x.tableRef === 'Table 13' && x.columnN === 2)!;
    expect(c.material).toBe('copper');
    expect(c.operatingC).toBe(75);
    expect(describeColumn(c)).toContain('Three-core and four-core');

    const { rows } = candidateRowsFor(c);
    const bySize = new Map(rows.map((r) => [r.areaMm2, r.tableAmps]));
    // AS/NZS 3008.1.1:2009 Table 13 column 2, unenclosed and spaced.
    expect(bySize.get(1)).toBe(13);
    expect(bySize.get(2.5)).toBe(23);
    expect(bySize.get(6)).toBe(40);
    expect(bySize.get(16)).toBe(72);
  });

  it('never lets aluminium beat copper in the same arrangement', () => {
    const cu = columns.find((x) => x.tableRef === 'Table 4' && x.columnN === 3)!;
    const al = columns.find((x) => x.tableRef === 'Table 4' && x.columnN === 4)!;
    expect([cu.material, al.material]).toEqual(['copper', 'aluminium']);
    expect(arrangementOf('Unenclosed › Spaced › Cu › Flexible')).toBe('Unenclosed › Spaced');

    const cuRows = new Map(candidateRowsFor(cu).rows.map((r) => [r.areaMm2, r.tableAmps]));
    for (const row of candidateRowsFor(al).rows) {
      const copper = cuRows.get(row.areaMm2);
      if (copper === undefined) continue;
      expect(row.tableAmps).toBeLessThanOrEqual(copper);
    }
  });

  it('keeps the conductor form out of the arrangement but says it', () => {
    expect(conductorFormOf('Unenclosed › Spaced › Cu › Flexible')).toBe('Flexible');
    expect(conductorFormOf('Enclosed › In conduit in a wall › Cu')).toBeUndefined();
    const flexible = columns.find((c) => c.conductorForm === 'Flexible');
    expect(flexible && describeColumn(flexible)).toContain('flexible');
  });

  it('leaves a size out rather than reading a blank as nothing carried', () => {
    const c = columns.find((x) => x.tableRef === 'Table 4' && x.columnN === 4)!;
    const rows = candidateRowsFor(c).rows;
    expect(rows.every((r) => r.tableAmps > 0)).toBe(true);
    // Aluminium is not offered in the small sizes, so its column is shorter
    // than the copper one beside it.
    expect(rows.length).toBeLessThan(candidateRowsFor(columns.find((x) => x.tableRef === 'Table 4' && x.columnN === 2)!).rows.length);
  });

  it('rises with size, in every column it offers', () => {
    for (const c of columns) {
      const rows = candidateRowsFor(c).rows;
      for (let i = 1; i < rows.length; i += 1) {
        expect({ ref: c.ref, size: rows[i]!.areaMm2, amps: rows[i]!.tableAmps })
          .toEqual({ ref: c.ref, size: rows[i]!.areaMm2, amps: expect.any(Number) });
        expect(rows[i]!.tableAmps).toBeGreaterThanOrEqual(rows[i - 1]!.tableAmps);
      }
    }
  });
});

describe('the voltage drop join', () => {
  it('matches the conductor temperature rather than taking the first column', () => {
    // Every drop table starts at 45 °C. A 90 °C cable read off the 45 °C
    // column understates the drop by about a fifth.
    const hot = capacityColumns().find((c) => c.tableRef === 'Table 14' && c.columnN === 2)!;
    const warm = capacityColumns().find((c) => c.tableRef === 'Table 13' && c.columnN === 2)!;
    expect(hot.operatingC).toBe(90);
    expect(candidateRowsFor(hot).dropNote).toContain('90');
    expect(candidateRowsFor(warm).dropNote).toContain('75');

    const hotRows = new Map(candidateRowsFor(hot).rows.map((r) => [r.areaMm2, r.mvPerAmpMetre]));
    const warmRows = new Map(candidateRowsFor(warm).rows.map((r) => [r.areaMm2, r.mvPerAmpMetre]));
    // Hotter conductor, higher resistance, more volts dropped per amp-metre.
    expect(hotRows.get(2.5)!).toBeGreaterThan(warmRows.get(2.5)!);
  });

  it('sends a multicore cable to the multicore table and a single-core to a single-core one', () => {
    const multicore = capacityColumns().find((c) => c.tableRef === 'Table 13' && c.columnN === 2)!;
    const single = capacityColumns().find((c) => c.tableRef === 'Table 4' && c.columnN === 2)!;
    expect(candidateRowsFor(multicore).dropNote).toContain('Table 42');
    expect(candidateRowsFor(single).dropNote).toMatch(/Table 4[01]/);
  });

  it('marks every table figure as three-phase, because that is what the standard prints', () => {
    const c = capacityColumns().find((x) => x.tableRef === 'Table 13' && x.columnN === 2)!;
    for (const row of candidateRowsFor(c).rows) {
      if (row.mvPerAmpMetre === undefined) continue;
      expect(row.mvIsThreePhase).toBe(true);
    }
  });

  it('says so rather than guessing when no drop table fits', () => {
    const orphan = capacityColumns().find((c) => c.material === 'aluminium' && /flexible|cord/i.test(c.cores));
    if (!orphan) return;
    expect(candidateRowsFor(orphan).dropNote).toContain('resistance');
  });
});

describe('the derating factors', () => {
  it('carries each condition with the table it came from', () => {
    for (const f of deratingFactors().slice(0, 200)) {
      expect(f.source).toContain('AS/NZS 3008.1.1:2009');
      expect(f.condition.length).toBeGreaterThan(10);
      expect(f.factor).toBeGreaterThan(0);
    }
  });

  it('sorts them into the kinds the calculator knows', () => {
    expect(deratingFor('ambient').length).toBeGreaterThan(10);
    expect(deratingFor('grouping').length).toBeGreaterThan(10);
    expect(deratingFor('depth').length).toBeGreaterThan(3);
    expect(deratingFor('soil').length).toBeGreaterThan(3);
  });

  it('has a reference condition of exactly one somewhere in the ambient table', () => {
    // 40 °C in air is the reference the capacity tables are computed at, so a
    // factor of 1.00 has to be in there; if it is not, the column mapping has
    // slipped.
    expect(deratingFor('ambient').some((f) => Math.abs(f.factor - 1) < 1e-9)).toBe(true);
  });
});

describe('sizing a real run off the shipped tables', () => {
  it('picks the size a sparky would pick, and cites the page', () => {
    const column = capacityColumns().find((c) => c.tableRef === 'Table 13' && c.columnN === 2)!;
    const { rows } = candidateRowsFor(column);

    const result = sizeCable({
      designCurrentA: 32,
      lengthM: 25,
      supplyVolts: 400,
      phase: 'three',
      material: column.material,
      operatingC: column.operatingC,
      derating: [],
      rows,
    });

    expect(result.chosen).toBeDefined();
    // 32 A three-phase over 25 m: capacity is what decides it, and 6 mm²
    // carries 40 A in this arrangement.
    expect(result.chosen!.row.areaMm2).toBe(6);
    expect(result.chosen!.row.source).toContain('Table 13 col 2');
    expect(result.chosen!.drop?.fromTable).toBe(true);
    expect(result.chosen!.protection.ok).toBe(true);
  });

  it('needs a bigger cable on the same run single-phase, because the drop is worse', () => {
    const column = capacityColumns().find((c) => c.tableRef === 'Table 13' && c.columnN === 2)!;
    const { rows } = candidateRowsFor(column);
    const base = {
      designCurrentA: 32,
      lengthM: 60,
      material: column.material,
      operatingC: column.operatingC,
      derating: [],
      rows,
    };
    const three = sizeCable({ ...base, supplyVolts: 400, phase: 'three' as const });
    const single = sizeCable({ ...base, supplyVolts: 230, phase: 'single' as const });
    expect(three.chosen!.row.areaMm2).toBeLessThan(single.chosen!.row.areaMm2);
  });

  it('refuses with the check that stopped it when the run is hopeless', () => {
    const column = capacityColumns().find((c) => c.tableRef === 'Table 13' && c.columnN === 2)!;
    const { rows } = candidateRowsFor(column);
    const result = sizeCable({
      designCurrentA: 32,
      lengthM: 2000,
      supplyVolts: 230,
      phase: 'single',
      material: column.material,
      operatingC: column.operatingC,
      derating: [],
      rows,
    });
    expect(result.chosen).toBeUndefined();
    expect(result.refusal).toContain('volt drop');
  });
});

describe('the tables behind all of it', () => {
  it('flags rather than hides a table the transcription could not reconcile', () => {
    const flagged = WIRING_TABLES.filter((t) => t.problems.length);
    for (const t of flagged) expect(t.rows.length).toBeGreaterThan(0);
  });

  it('finds a table by the way a person would type it', () => {
    expect(wiringTable('as3008', '4')?.ref).toBe('Table 4');
    expect(wiringTable('as3008', 'table 13')?.ref).toBe('Table 13');
    expect(wiringTable('as3000', 'Table C1')?.ref).toBe('Table C1');
    expect(wiringTable('as3008', 'nope')).toBeUndefined();
  });
});
