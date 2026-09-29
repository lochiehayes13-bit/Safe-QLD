import { WIRING_TABLES } from '@/seed/wiring';

/**
 * Table B1, and what a second extraction found in it.
 *
 * These tables were transcribed twice, blind, with a third reader settling
 * every disagreement — and then, months later, extracted again from scratch by
 * a run that did not see the first. Eight of the eleven AS/NZS 3000 tables the
 * two runs share came back identical value for value, which is the strongest
 * evidence available that the figures are right.
 *
 * B1 did not. The first transcription stopped at 16 mm² / 63 A — twelve rows
 * of a table that has twenty-one — and every one of those twelve matched the
 * second run exactly. It was not a misreading, it was a truncation, and the
 * missing rows are every size above 16 mm²: precisely the submains and larger
 * final subcircuits where route length is what actually binds. Anyone sizing a
 * 35 mm² run off this app would have found no answer at all.
 *
 * Which is the failure a value-count checker cannot see. Every row present was
 * correct, every column was consistent, currents rose and volt drops fell down
 * the columns exactly as they should. A table missing its bottom half looks
 * exactly like a table.
 */
describe('Table B1 covers the whole printed table', () => {
  const b1 = WIRING_TABLES.find((t) => t.doc === 'as3000' && t.ref === 'Table B1');

  it('is there at all', () => {
    expect(b1).toBeDefined();
  });

  it('runs to the largest printed size, not to where a transcription stopped', () => {
    expect(b1!.rows).toHaveLength(21);
    expect(b1!.rows.map((r) => String(r.key))).toEqual([
      '1', '1', '1.5', '1.5', '2.5', '2.5', '4', '4', '6', '6',
      '10', '16', '16', '25', '25', '35', '35', '50', '50', '70', '70',
    ]);
  });

  it('still holds the twelve rows the first reading got right', () => {
    // The evidence that this was extended rather than replaced.
    expect(b1!.rows[0]!.values).toEqual([1, 6, 91, 42.5, 24, 29, 39, 28, 34, 45, 204]);
    expect(b1!.rows[11]!.values).toEqual([6, 63, 76, 2.32, 43, 51, 68, 49, 59, 79, 85]);
  });

  it('gives every row a value for every column', () => {
    for (const r of b1!.rows) expect(r.values).toHaveLength(b1!.columns.length - 1);
  });

  it('keeps the shape the printed table has down each column', () => {
    /*
     * Conductor size never decreases, and the volt drop figure in column 5
     * falls as the conductor grows — a bigger conductor cannot drop more per
     * amp-metre. Both would catch a row pasted in from the wrong place.
     */
    const sizes = b1!.rows.map((r) => Number(r.key));
    const mv = b1!.rows.map((r) => Number(r.values[3]));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
      expect(mv[i]!).toBeLessThanOrEqual(mv[i - 1]!);
    }
  });

  it('says in the record that the rows were recovered', () => {
    // A table that quietly grew nine rows is a table nobody can audit.
    expect((b1!.problems ?? []).join(' ')).toMatch(/missing from the first transcription/i);
  });
});
