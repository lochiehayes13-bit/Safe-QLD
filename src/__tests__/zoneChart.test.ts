import { buildZoneChart, columnise, suggestedColumns } from '@/domain/zoneChart';
import type { Point, Zone } from '@/domain/types';

/**
 * Zone charts built from the panel's own configuration.
 *
 * The point of generating rather than transcribing is that the chart cannot
 * disagree with the panel. So the tests care most about the disagreements it
 * should surface: a zone with devices and no text, and a device pointing at a
 * zone that is not in the table.
 */

function zone(number: number, text: string, over: Partial<Zone> = {}): Zone {
  return { id: `z${number}`, panelId: 'p1', number, text, unused: false, ...over };
}

let n = 0;
function point(zoneNumber: number | undefined, deviceType: Point['deviceType'] = 'smoke'): Point {
  n += 1;
  return {
    id: `pt${n}`, panelId: 'p1', text: `Device ${n}`, deviceType, zoneNumber,
  } as Point;
}

describe('building the chart', () => {
  it('lists zones in panel order regardless of how they arrive', () => {
    const chart = buildZoneChart([zone(3, 'C'), zone(1, 'A'), zone(2, 'B')], []);
    expect(chart.rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it('counts the devices in each zone', () => {
    const chart = buildZoneChart(
      [zone(1, 'Level 1'), zone(2, 'Level 2')],
      [point(1), point(1), point(1), point(2)],
    );
    expect(chart.rows.find((r) => r.number === 1)?.deviceCount).toBe(3);
    expect(chart.rows.find((r) => r.number === 2)?.deviceCount).toBe(1);
    expect(chart.totalDevices).toBe(4);
  });

  it('names the device classes rather than counting generically', () => {
    // "8 x smoke, 1 x call point" tells a responder where to look;
    // "9 devices" does not.
    const chart = buildZoneChart(
      [zone(1, 'Level 1')],
      [point(1, 'smoke'), point(1, 'smoke'), point(1, 'mcp')],
    );
    const summary = chart.rows[0]!.summary;
    expect(summary).toMatch(/2 ×/);
    expect(summary).toMatch(/1 ×/);
    // Most common first.
    expect(summary.indexOf('2 ×')).toBeLessThan(summary.indexOf('1 ×'));
  });

  it('does not mangle a device label that ends in a parenthetical', () => {
    // "Smoke (photo)" pluralised naively becomes "smoke (photo)s", which is
    // how a generated chart announces that it was generated.
    const chart = buildZoneChart([zone(1, 'Level 1')], [point(1, 'smoke'), point(1, 'smoke')]);
    expect(chart.rows[0]!.summary).not.toMatch(/\)s/);
  });

  it('leaves an empty summary for a zone with nothing in it', () => {
    const chart = buildZoneChart([zone(1, 'Spare')], []);
    expect(chart.rows[0]!.summary).toBe('');
    expect(chart.rows[0]!.deviceCount).toBe(0);
  });
});

describe('what the chart has to surface', () => {
  it('reports a zone that has devices but no text', () => {
    // This is what makes a chart unusable: a numbered zone nobody can locate.
    const chart = buildZoneChart([zone(1, 'Level 1'), zone(2, '  ')], [point(1), point(2)]);
    expect(chart.untexted).toEqual([2]);
  });

  it('does not report an empty zone as untexted', () => {
    // A spare zone with no devices and no text is not a problem.
    const chart = buildZoneChart([zone(1, 'Level 1'), zone(2, '')], [point(1)]);
    expect(chart.untexted).toEqual([]);
  });

  it('counts devices pointing at a zone that is not in the table', () => {
    const chart = buildZoneChart([zone(1, 'Level 1')], [point(1), point(99), point(99)]);
    expect(chart.orphanedPoints).toBe(2);
  });

  it('ignores points with no zone at all rather than counting them as orphans', () => {
    const chart = buildZoneChart([zone(1, 'Level 1')], [point(1), point(undefined)]);
    expect(chart.orphanedPoints).toBe(0);
    expect(chart.totalDevices).toBe(1);
  });
});

describe('unused zones', () => {
  it('leaves an unused empty zone off a chart meant to be read at a panel', () => {
    const chart = buildZoneChart([zone(1, 'Level 1'), zone(2, 'Spare', { unused: true })], [point(1)]);
    expect(chart.rows.map((r) => r.number)).toEqual([1]);
  });

  it('includes them when asked, for commissioning', () => {
    const chart = buildZoneChart(
      [zone(1, 'Level 1'), zone(2, 'Spare', { unused: true })],
      [point(1)],
      true,
    );
    expect(chart.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(chart.rows[1]!.unused).toBe(true);
  });

  it('keeps a zone the panel marks unused if it actually holds devices', () => {
    // The config disagreeing with itself is worth seeing, not hiding.
    const chart = buildZoneChart([zone(1, 'Odd', { unused: true })], [point(1)]);
    expect(chart.rows.map((r) => r.number)).toEqual([1]);
    expect(chart.rows[0]!.unused).toBe(false);
  });
});

describe('laying it out for a page', () => {
  it('deals rows down each column in turn', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((i) => ({
      number: i, text: `Z${i}`, deviceCount: 0, summary: '', unused: false,
    }));
    expect(columnise(rows, 2).map((c) => c.map((r) => r.number))).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('handles a row count that does not divide evenly', () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({
      number: i, text: `Z${i}`, deviceCount: 0, summary: '', unused: false,
    }));
    const cols = columnise(rows, 2);
    expect(cols.flat()).toHaveLength(5);
    expect(cols.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for an empty chart rather than an empty column', () => {
    expect(columnise([], 3)).toEqual([]);
  });

  it('scales columns to the size of the panel', () => {
    expect(suggestedColumns(12)).toBe(1);
    expect(suggestedColumns(32)).toBe(2);
    expect(suggestedColumns(120)).toBe(3);
    expect(suggestedColumns(474)).toBe(4);
  });

  it('never loses a row to columnising, at any size', () => {
    for (const size of [1, 5, 24, 32, 60, 150, 474]) {
      const rows = Array.from({ length: size }, (_, i) => ({
        number: i + 1, text: `Z${i}`, deviceCount: 0, summary: '', unused: false,
      }));
      const cols = columnise(rows, suggestedColumns(size));
      expect({ size, total: cols.flat().length }).toEqual({ size, total: size });
    }
  });
});
