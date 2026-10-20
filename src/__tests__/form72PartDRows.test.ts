/**
 * The screen and the printed page claim the same stored row.
 *
 * Part D's eight department lines are laid over whatever a form actually
 * holds. The screen did that with a Map keyed on the row's duty, so two stored
 * rows at the same duty collapsed to one and the LAST of them won. The page
 * takes the FIRST — flowTableRows splices it out of the list and prints what
 * remains as added rows.
 *
 * So on a form carrying a duplicate the technician edited one reading while
 * the page put the other on the department's line, and the one they could not
 * see could not be removed either: its key is a printed key, so the screen's
 * "added rows" filter excluded it too. It was reachable nowhere.
 *
 * The screen does not make duplicates now, but rows arrive from earlier builds
 * of it, from the hydrant tool and from the sync. A row nobody can reach is a
 * reading nobody can take, on a page a licensee signs.
 */
import { partDLines, PART_D_ROWS, flowRowKey, type FlowRow } from '@/domain/form72';
import { flowTableRows } from '@/export/form72';

const metered = (rateLps: number, over: Partial<FlowRow> = {}): FlowRow => ({
  rateLps, devices: '', ...over,
});

describe('a form with two rows at the same duty', () => {
  const rows = [
    metered(10, { devices: 'SQF-001', hydrant1Kpa: 620 }),
    metered(10, { devices: 'SQF-002', hydrant1Kpa: 480 }),
  ];

  it('shows both of them, which it used to show one of', () => {
    const lines = partDLines(rows);
    const shown = lines.filter((l) => l.index !== undefined).map((l) => l.index);
    expect(shown.sort()).toEqual([0, 1]);
  });

  it('puts the first on the department’s line, as the printed page does', () => {
    const line = partDLines(rows).find((l) => l.printed && l.row.rateLps === 10);
    expect(line?.index).toBe(0);
    expect(line?.row.devices).toBe('SQF-001');
  });

  it('surfaces the second as an added row, where it can be edited or removed', () => {
    const extra = partDLines(rows).filter((l) => !l.printed);
    expect(extra).toHaveLength(1);
    expect(extra[0]?.index).toBe(1);
  });

  it('agrees with the printed page about which row is which', () => {
    /*
     * The guarantee, rather than two implementations that happen to match
     * today. flowTableRows is what the renderer uses; this walks both and
     * asserts the department's eight lines carry the same readings.
     */
    const onPage = flowTableRows({ result: 'pass', hydrantLocations: [], rows });
    const onScreen = partDLines(rows).filter((l) => l.printed);
    expect(onPage.filter((r) => r.standard).map((r) => r.row))
      .toEqual(onScreen.map((l) => l.row));
  });
});

describe('the ordinary form, which must not move', () => {
  it('draws the department’s eight lines and nothing else', () => {
    const lines = partDLines([]);
    expect(lines).toHaveLength(PART_D_ROWS.length);
    expect(lines.every((l) => l.printed && l.index === undefined)).toBe(true);
  });

  it('lays a stored row onto its own printed line', () => {
    const lines = partDLines([metered(20, { hydrant1Kpa: 300 })]);
    const line = lines.find((l) => l.row.rateLps === 20);
    expect(line).toMatchObject({ index: 0, printed: true });
    expect(lines.filter((l) => !l.printed)).toEqual([]);
  });

  it('keeps a row at a duty the department does not print as an added one', () => {
    const lines = partDLines([metered(7, { hydrant1Kpa: 300 })]);
    expect(lines.filter((l) => !l.printed)).toHaveLength(1);
    expect(lines).toHaveLength(PART_D_ROWS.length + 1);
  });

  it('keeps every stored row reachable, whatever is on the form', () => {
    // The property the fault broke: an index for every stored row, exactly once.
    const rows = [
      metered(10, { hydrant1Kpa: 1 }), metered(10, { hydrant1Kpa: 2 }),
      metered(10, { hydrant1Kpa: 3 }), { nozzleMm: 19, devices: '', hydrant1Kpa: 4 },
      { nozzleMm: 19, devices: '', hydrant1Kpa: 5 }, metered(7, { hydrant1Kpa: 6 }),
    ];
    const indices = partDLines(rows).map((l) => l.index).filter((i): i is number => i !== undefined);
    expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('never hides a row behind a printed key, which is how the first one vanished', () => {
    const rows = [metered(10, { hydrant1Kpa: 1 }), metered(10, { hydrant1Kpa: 2 })];
    for (const [i, row] of rows.entries()) {
      const line = partDLines(rows).find((l) => l.index === i);
      expect({ i, reachable: !!line, key: flowRowKey(row) })
        .toEqual({ i, reachable: true, key: flowRowKey(row) });
    }
  });
});
