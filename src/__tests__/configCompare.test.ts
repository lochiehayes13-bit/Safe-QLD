import { compareConfig, describeComparison, noChanges, siteMismatches } from '@/domain/configCompare';
import type { ConfigPoint, ConfigZone } from '@/domain/configBrowse';

/**
 * A configuration against what the app already holds.
 *
 * Two failures matter and both produce a longer answer that looks more
 * thorough. A device whose label was edited reported as one removed and one
 * added doubles the list and halves the truth of every line in it. And a
 * device with nothing to match on — the panel's own terminals, on most
 * formats — counted as removed puts a change on every comparison ever run,
 * which is how a difference report becomes something nobody opens.
 */

function point(over: Partial<ConfigPoint> = {}): ConfigPoint {
  return { text: 'DEVICE', deviceType: 'smoke-photo', unused: false, ...over };
}

function zone(number: number, text: string): ConfigZone {
  return { number, text, unused: false };
}

describe('a configuration that has not changed', () => {
  const points = [
    point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE', zoneNumber: 1 }),
    point({ loopNumber: 1, address: 2, text: 'PLANT HEAT', deviceType: 'heat', zoneNumber: 2 }),
  ];

  it('says so, with the number it looked at', () => {
    const c = compareConfig(points, points);
    expect(noChanges(c)).toBe(true);
    expect(c.unchanged).toBe(2);
    expect(describeComparison(c)).toBe('No differences across 2 devices.');
  });

  it('is not troubled by spacing or case in the labels', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'Lobby   Smoke' })],
      [point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE' })],
    );
    expect(noChanges(c)).toBe(true);
  });
});

describe('a device whose label was edited', () => {
  const c = compareConfig(
    [point({ loopNumber: 1, address: 34, text: 'LEVEL 3 STOREROOM' })],
    [point({ loopNumber: 1, address: 34, text: 'LEVEL 3 STORE' })],
  );

  it('is one change, not a removal and an addition', () => {
    expect(c.added).toHaveLength(0);
    expect(c.removed).toHaveLength(0);
    expect(c.changed).toHaveLength(1);
  });

  it('says what it was and what it is now', () => {
    expect(c.changed[0]?.differences).toEqual(['Relabelled: was "LEVEL 3 STORE", now "LEVEL 3 STOREROOM"']);
    expect(c.changed[0]?.inFile.where).toBe('1/34');
  });

  it('reads as a labelling rather than a relabelling where there was no label', () => {
    const blank = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE' })],
      [point({ loopNumber: 1, address: 1, text: '' })],
    );
    expect(blank.changed[0]?.differences).toEqual(['Labelled "LOBBY SMOKE", which was blank']);
  });
});

describe('a device that moved zone', () => {
  it('says which zone it was in and which it is in now', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE', zoneNumber: 4 })],
      [point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE', zoneNumber: 1 })],
    );
    expect(c.changed[0]?.differences).toEqual(['Moved from zone 1 to zone 4']);
  });

  it('names having no zone as having no zone, not as zone nought', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'X' })],
      [point({ loopNumber: 1, address: 1, text: 'X', zoneNumber: 2 })],
    );
    expect(c.changed[0]?.differences).toEqual(['Moved from zone 2 to no zone']);
  });
});

describe('a device whose type changed', () => {
  it('is reported where both sides know the type', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'X', deviceType: 'heat' })],
      [point({ loopNumber: 1, address: 1, text: 'X', deviceType: 'smoke-photo' })],
    );
    expect(c.changed[0]?.differences[0]).toContain('Type changed');
  });

  it('is not reported where either side does not know it', () => {
    // Half the parsers in this app hand back 'unknown' for every device. A
    // comparison between one of those and anything else would otherwise report
    // a type change on every device in the building.
    const c = compareConfig(
      [point({ loopNumber: 1, address: 1, text: 'X', deviceType: 'unknown' })],
      [point({ loopNumber: 1, address: 1, text: 'X', deviceType: 'smoke-photo' })],
    );
    expect(noChanges(c)).toBe(true);
  });
});

describe('a device that moved address', () => {
  it('is one move rather than a removal and an addition', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 14, text: 'LEVEL 3 CORRIDOR' })],
      [point({ loopNumber: 1, address: 12, text: 'LEVEL 3 CORRIDOR' })],
    );
    expect(c.added).toHaveLength(0);
    expect(c.removed).toHaveLength(0);
    expect(c.changed[0]).toMatchObject({ moved: true });
    expect(c.changed[0]?.differences).toEqual(['Moved from 1/12 to 1/14']);
  });

  it('is not guessed at where the label names more than one device', () => {
    // Two devices called SPARE say nothing about which became which, and a
    // guess here invents a move nobody made.
    const c = compareConfig(
      [point({ loopNumber: 1, address: 20, text: 'SPARE' }), point({ loopNumber: 1, address: 21, text: 'SPARE' })],
      [point({ loopNumber: 1, address: 30, text: 'SPARE' }), point({ loopNumber: 1, address: 31, text: 'SPARE' })],
    );
    expect(c.changed).toHaveLength(0);
    expect(c.added).toHaveLength(2);
    expect(c.removed).toHaveLength(2);
  });

  it('is not guessed at from a blank label', () => {
    const c = compareConfig(
      [point({ loopNumber: 1, address: 20, text: '' })],
      [point({ loopNumber: 1, address: 30, text: '' })],
    );
    expect(c.changed).toHaveLength(0);
    expect(c.added).toHaveLength(1);
    expect(c.removed).toHaveLength(1);
  });
});

describe('devices that arrived and went', () => {
  const c = compareConfig(
    [
      point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE' }),
      point({ loopNumber: 1, address: 5, text: 'NEW MEETING ROOM' }),
    ],
    [
      point({ loopNumber: 1, address: 1, text: 'LOBBY SMOKE' }),
      point({ loopNumber: 1, address: 9, text: 'OLD STORE' }),
    ],
  );

  it('reports each once, with where it is', () => {
    expect(c.added.map((p) => [p.where, p.text])).toEqual([['1/5', 'NEW MEETING ROOM']]);
    expect(c.removed.map((p) => [p.where, p.text])).toEqual([['1/9', 'OLD STORE']]);
    expect(c.unchanged).toBe(1);
  });

  it('summarises in one line', () => {
    expect(describeComparison(c)).toBe('1 in the file and not here, 1 here and not in the file.');
  });
});

describe('devices with nothing to match on', () => {
  it('are left out and said out loud, rather than counted as changes', () => {
    const c = compareConfig(
      [point({ text: 'BRIGADE RELAY' })],
      [point({ text: 'BRIGADE RELAY' }), point({ text: 'ASE FAULT' })],
    );
    expect(c.added).toHaveLength(0);
    expect(c.removed).toHaveLength(0);
    expect(c.caveats.join(' ')).toContain('3 points have no address and no reference');
  });

  it('are matched where they carry a point reference', () => {
    const c = compareConfig(
      [point({ pointRef: 'PANEL-IO-1', text: 'BRIGADE RELAY NEW' })],
      [point({ pointRef: 'PANEL-IO-1', text: 'BRIGADE RELAY' })],
    );
    expect(c.changed).toHaveLength(1);
    expect(c.caveats).toEqual([]);
  });
});

describe('spare addresses', () => {
  const inFile = [point({ loopNumber: 1, address: 60, text: '', unused: true })];

  it('are left out, because the question is about the building', () => {
    expect(noChanges(compareConfig(inFile, []))).toBe(true);
  });

  it('are compared when asked for', () => {
    expect(compareConfig(inFile, [], [], [], { includeUnused: true }).added).toHaveLength(1);
  });
});

describe('a site with nothing held yet', () => {
  it('says so, rather than presenting the whole file as new work', () => {
    const c = compareConfig([point({ loopNumber: 1, address: 1 })], []);
    expect(c.added).toHaveLength(1);
    expect(c.caveats.join(' ')).toContain('Nothing is held for this site yet');
  });
});

describe('zones', () => {
  const c = compareConfig(
    [],
    [],
    [zone(1, 'LEVEL 1'), zone(2, 'LEVEL 2 EAST'), zone(4, 'CARPARK')],
    [zone(1, 'LEVEL 1'), zone(2, 'LEVEL 2'), zone(3, 'PLANT')],
  );

  it('separates a zone added, a zone gone, and a zone renamed', () => {
    expect(c.zonesAdded).toEqual([{ number: 4, inFile: 'CARPARK' }]);
    expect(c.zonesRemoved).toEqual([{ number: 3, held: 'PLANT' }]);
    expect(c.zonesRetexted).toEqual([{ number: 2, inFile: 'LEVEL 2 EAST', held: 'LEVEL 2' }]);
  });

  it('counts in the summary line', () => {
    expect(describeComparison(c)).toContain('3 zones changed');
  });
});

describe('a comparison that could see nothing at all', () => {
  it('does not read as "nothing has changed"', () => {
    // The two are the same on screen and mean opposite things.
    const c = compareConfig([], []);
    expect(describeComparison(c)).toBe('Nothing could be compared.');
  });
});

describe('is this even the right building', () => {
  it('says so when the file names somewhere else', () => {
    const [first] = siteMismatches({ siteNameInFile: 'Rosemount Retirement Village', siteName: 'Vaxxas' });
    expect(first?.kind).toBe('name');
    expect(first?.body).toContain('Rosemount');
  });

  it('accepts a name that is the same building described at a different length', () => {
    // The office holds "Vaxxas"; the file says "VAXXAS BIO MEDICAL FACILITY".
    // Reporting that would train somebody to ignore the banner.
    expect(siteMismatches({ siteNameInFile: 'VAXXAS BIO MEDICAL FACILITY', siteName: 'Vaxxas' })).toEqual([]);
    expect(siteMismatches({ siteNameInFile: 'Ipswich Hospital', siteName: 'IPSWICH HOSPITAL MAIN FIRE CONTROL ROOM' }))
      .toEqual([]);
  });

  it('is not troubled by punctuation or spacing', () => {
    expect(siteMismatches({ siteNameInFile: 'Storage Choice - Sumner Park', siteName: 'Storage Choice Sumner Park' }))
      .toEqual([]);
  });

  it('says nothing where either side is blank', () => {
    // A column-mapped import never carries a site name, and a blank is not
    // evidence of anything.
    expect(siteMismatches({ siteName: 'Vaxxas' })).toEqual([]);
    expect(siteMismatches({ siteNameInFile: 'Vaxxas' })).toEqual([]);
  });

  it('says so when the make on record is a different one', () => {
    const [first] = siteMismatches({ fileBrand: 'pertronic', heldBrands: ['ampac'] });
    expect(first?.kind).toBe('brand');
    expect(first?.body).toContain('pertronic');
  });

  it('accepts a site that already holds a panel of the same make', () => {
    expect(siteMismatches({ fileBrand: 'ampac', heldBrands: ['ampac', 'vigilant'] })).toEqual([]);
  });

  it('says nothing about "other", which is what a CSV and a hand-typed panel both record', () => {
    expect(siteMismatches({ fileBrand: 'other', heldBrands: ['ampac'] })).toEqual([]);
    expect(siteMismatches({ fileBrand: 'ampac', heldBrands: ['other'] })).toEqual([]);
  });

  it('says nothing about a site with no panels on it yet', () => {
    expect(siteMismatches({ fileBrand: 'ampac', heldBrands: [] })).toEqual([]);
  });
});
