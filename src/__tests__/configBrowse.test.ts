import {
  addressLabel, deviceBreakdown, filterPoints, inPanelOrder, loopNumbers, loopRows,
  typesPresent, zoneChartFor, type ConfigPoint,
} from '@/domain/configBrowse';

/**
 * Reading a configuration that has not been imported.
 *
 * The search is where this earns its keep. A technician at a panel types three
 * words and needs the one device; a search that ORs those words hands back the
 * whole loop and looks for all the world like it worked, which is how a tool
 * stops being used.
 */

function point(over: Partial<ConfigPoint> = {}): ConfigPoint {
  return { text: 'DEVICE', deviceType: 'smoke-photo', unused: false, ...over };
}

const LOOP1: ConfigPoint[] = [
  point({ loopNumber: 1, address: 1, text: 'LEVEL 1 LOBBY SMOKE', zoneNumber: 1, zoneText: 'LEVEL 1', pointRef: 'L1P001' }),
  point({ loopNumber: 1, address: 3, text: 'LEVEL 1 PLANT HEAT', deviceType: 'heat', zoneNumber: 1, zoneText: 'LEVEL 1', pointRef: 'L1P003' }),
  point({ loopNumber: 1, address: 12, text: 'LEVEL 3 CORRIDOR', zoneNumber: 3, zoneText: 'LEVEL 3', pointRef: 'L1P012' }),
  point({ loopNumber: 1, address: 14, text: '', deviceType: 'unknown', unused: true, pointRef: 'L1P014' }),
];

const LOOP2: ConfigPoint[] = [
  point({ loopNumber: 2, address: 1, text: 'CARPARK BREAK GLASS', deviceType: 'mcp', zoneNumber: 9, zoneText: 'CARPARK', pointRef: 'L2P001' }),
];

const PANEL_POINTS: ConfigPoint[] = [
  ...LOOP1,
  ...LOOP2,
  point({ text: 'BRIGADE RELAY', deviceType: 'relay', pointRef: 'PANEL-IO-1' }),
];

describe('searching a config', () => {
  it('narrows on every word rather than widening', () => {
    // "level" alone matches three; adding "3" has to leave one.
    expect(filterPoints(PANEL_POINTS, { text: 'level' })).toHaveLength(3);
    expect(filterPoints(PANEL_POINTS, { text: 'level 3' }).map((p) => p.text)).toEqual(['LEVEL 3 CORRIDOR']);
  });

  it('finds a device by what it is, not only by what somebody typed', () => {
    // The label says "BREAK GLASS"; a technician searching for a call point
    // has to find it.
    expect(filterPoints(PANEL_POINTS, { text: 'call point' }).map((p) => p.pointRef)).toEqual(['L2P001']);
  });

  it('finds a device by the address written either way round', () => {
    // The panel says L1P012; the drawing says 1/12. Both are what somebody
    // has in front of them.
    expect(filterPoints(PANEL_POINTS, { text: 'l1p012' }).map((p) => p.text)).toEqual(['LEVEL 3 CORRIDOR']);
    expect(filterPoints(PANEL_POINTS, { text: '1/12' }).map((p) => p.text)).toEqual(['LEVEL 3 CORRIDOR']);
  });

  it('finds a device by its zone', () => {
    expect(filterPoints(PANEL_POINTS, { text: 'carpark' }).map((p) => p.pointRef)).toEqual(['L2P001']);
    expect(filterPoints(PANEL_POINTS, { text: 'zone 9' }).map((p) => p.pointRef)).toEqual(['L2P001']);
  });

  it('hides spare addresses, as a panel presents itself', () => {
    expect(filterPoints(PANEL_POINTS).map((p) => p.pointRef)).not.toContain('L1P014');
    expect(filterPoints(PANEL_POINTS, { includeUnused: true }).map((p) => p.pointRef)).toContain('L1P014');
  });

  it('combines a filter with the words rather than replacing them', () => {
    expect(filterPoints(PANEL_POINTS, { loop: 1, text: 'level' })).toHaveLength(3);
    expect(filterPoints(PANEL_POINTS, { loop: 2, text: 'level' })).toHaveLength(0);
  });

  it('filters by zone and by type', () => {
    expect(filterPoints(PANEL_POINTS, { zone: 1 })).toHaveLength(2);
    expect(filterPoints(PANEL_POINTS, { type: 'heat' }).map((p) => p.pointRef)).toEqual(['L1P003']);
  });

  it('returns everything visible for an empty search', () => {
    // Five of the six: the spare address is hidden, as it is without a search.
    expect(filterPoints(PANEL_POINTS, { text: '   ' })).toHaveLength(5);
  });

  it('does not let the addressing pollute a search for words', () => {
    // The plant heat detector sits at address 3 on level 1. A technician
    // searching "level 3" wants the corridor, and on a building with numbered
    // levels this collision is in every single search.
    expect(filterPoints(PANEL_POINTS, { text: 'level 3' })).toHaveLength(1);
  });

  it('searches the addresses when the query is an address', () => {
    expect(filterPoints(PANEL_POINTS, { text: '12' }).map((p) => p.pointRef)).toEqual(['L1P012']);
  });
});

describe('the order a panel walks its points', () => {
  it('is loop, then address, then channel', () => {
    const shuffled = [
      point({ loopNumber: 2, address: 1, text: 'B' }),
      point({ loopNumber: 1, address: 10, subAddress: 2, text: 'A2' }),
      point({ loopNumber: 1, address: 10, subAddress: 1, text: 'A1' }),
      point({ loopNumber: 1, address: 2, text: 'A' }),
    ];
    expect(inPanelOrder(shuffled).map((p) => p.text)).toEqual(['A', 'A1', 'A2', 'B']);
  });

  it('puts the points with no address after the loops, not before address 1', () => {
    // Panel terminals and network points belong at the end of the list, where
    // a panel's own display puts them.
    const mixed = [point({ text: 'PANEL RELAY' }), point({ loopNumber: 1, address: 1, text: 'LOOP DEVICE' })];
    expect(inPanelOrder(mixed).map((p) => p.text)).toEqual(['LOOP DEVICE', 'PANEL RELAY']);
  });

  it('does not alter the list it was given', () => {
    const original = [point({ address: 2 }), point({ address: 1 })];
    inPanelOrder(original);
    expect(original.map((p) => p.address)).toEqual([2, 1]);
  });
});

describe('what each loop holds', () => {
  const rows = loopRows({
    loops: [{ number: 1, label: 'Ground and Level 1' }, { number: 3, label: 'Spare card' }],
    points: PANEL_POINTS,
  });

  it('lists a loop the panel declares that nothing is addressed on', () => {
    // An empty loop card is a fact worth seeing, and it exists nowhere in the
    // addressing.
    const spare = rows.find((r) => r.number === 3);
    expect(spare).toMatchObject({ devices: 0, empty: true, label: 'Spare card' });
  });

  it('lists a loop the points sit on that the panel never declared', () => {
    // Loop 2 has a device and no loop record. Dropping it would hide a card
    // the configuration has not accounted for.
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.find((r) => r.number === 2)).toMatchObject({ devices: 1, empty: false });
  });

  it('counts spares inside the device count rather than beside it', () => {
    expect(rows.find((r) => r.number === 1)).toMatchObject({ devices: 4, spare: 1 });
  });

  it('reports the addresses free between the first and the last', () => {
    // Loop 1 runs 1 to 14 with four devices on it, so ten addresses inside the
    // range have nothing at them.
    expect(rows.find((r) => r.number === 1)).toMatchObject({
      lowestAddress: 1, highestAddress: 14, freeInRange: 10,
    });
  });

  it('reports no free addresses on a loop with nothing on it', () => {
    // Not "126 free": nothing is known about how big the card is.
    expect(rows.find((r) => r.number === 3)?.freeInRange).toBe(0);
  });

  it('does not count a multi-channel address twice when counting what is free', () => {
    const multi = loopRows({
      loops: [{ number: 1 }],
      points: [
        point({ loopNumber: 1, address: 1, subAddress: 0 }),
        point({ loopNumber: 1, address: 1, subAddress: 1 }),
        point({ loopNumber: 1, address: 3 }),
      ],
    });
    // Addresses 1 and 3 are taken, so only address 2 is free — three points
    // across two addresses.
    expect(multi[0]).toMatchObject({ devices: 3, freeInRange: 1 });
  });
});

describe('what a panel holds', () => {
  it('counts device classes, most common first, spares left out', () => {
    const breakdown = deviceBreakdown(PANEL_POINTS);
    expect(breakdown[0]).toMatchObject({ type: 'smoke-photo', count: 2 });
    expect(breakdown.map((b) => b.type)).not.toContain('unknown');
  });

  it('counts spares when asked', () => {
    expect(deviceBreakdown(PANEL_POINTS, true).map((b) => b.type)).toContain('unknown');
  });

  it('names the loops the points are actually on', () => {
    expect(loopNumbers(PANEL_POINTS)).toEqual([1, 2]);
  });

  it('offers only the device classes that are in the file', () => {
    const types = typesPresent(PANEL_POINTS);
    expect(types).toContain('mcp');
    expect(types).not.toContain('beam');
  });

  it('builds the zone chart the configuration implies', () => {
    const chart = zoneChartFor({
      zones: [
        { number: 1, text: 'LEVEL 1', unused: false },
        { number: 3, text: 'LEVEL 3', unused: false },
      ],
      points: PANEL_POINTS,
    });
    expect(chart.rows.map((r) => r.number)).toEqual([1, 3]);
    expect(chart.rows[0]?.deviceCount).toBe(2);
    // Zone 9 has a device and no zone row, which is the thing worth knowing.
    expect(chart.orphanedPoints).toBe(1);
  });
});

describe('how an address reads', () => {
  it('is loop over address', () => {
    expect(addressLabel(point({ loopNumber: 1, address: 34 }))).toBe('1/34');
  });

  it('carries the channel where there is one', () => {
    expect(addressLabel(point({ loopNumber: 1, address: 34, subAddress: 2 }))).toBe('1/34.2');
  });

  it('shows channel nought, because nought is the first channel and not "no channel"', () => {
    expect(addressLabel(point({ loopNumber: 1, address: 34, subAddress: 0 }))).toBe('1/34.0');
  });

  it('falls back to the panel’s own reference where there is no address', () => {
    expect(addressLabel(point({ pointRef: 'PANEL-IO-1' }))).toBe('PANEL-IO-1');
  });

  it('is blank rather than misleading where there is neither', () => {
    expect(addressLabel(point())).toBe('');
  });
});
