import {
  alreadyOpen, byBuilding, buildingKey, describeSummary, emptySummary, extensionOf,
  fingerprint, stemOf, summarise, type ConfigFileRecord,
} from '@/domain/configLibrary';
import type { ParsedConfig } from '@/domain/types';

/**
 * The library of configurations a phone is holding.
 *
 * Two things here can be wrong in a way nobody would notice. A fingerprint
 * that agrees for two different files makes the comparison screen report no
 * change between a config and its replacement — the exact case somebody opened
 * it for. And grouping two buildings under one name makes that same screen
 * report every device in one of them as removed. Both read as answers.
 */

function record(over: Partial<ConfigFileRecord> = {}): ConfigFileRecord {
  return {
    id: 'c1',
    fileName: 'SITE.nle',
    byteLength: 10,
    fingerprint: 'aaaaaaaabbbbbbbbcccccccc',
    brand: 'kentec',
    openedAt: '2026-09-01T00:00:00.000Z',
    lastOpenedAt: '2026-09-01T00:00:00.000Z',
    summary: emptySummary(),
    ...over,
  };
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('the fingerprint', () => {
  it('agrees with itself', () => {
    expect(fingerprint(bytes(1, 2, 3))).toBe(fingerprint(bytes(1, 2, 3)));
  });

  it('separates two files that differ by one byte in the middle', () => {
    // The case sampling gets wrong: a config and its replacement agree at both
    // ends and differ somewhere inside.
    const a = new Uint8Array(4096).fill(7);
    const b = new Uint8Array(4096).fill(7);
    b[2048] = 8;
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('separates a file from the same file with zeroes on the end', () => {
    // Length is mixed in for exactly this: appending a NUL to an FNV hash of
    // the original leaves the running value related in a way that is worth
    // closing off outright.
    expect(fingerprint(bytes(1, 2, 3))).not.toBe(fingerprint(bytes(1, 2, 3, 0)));
    expect(fingerprint(new Uint8Array(0))).not.toBe(fingerprint(bytes(0)));
  });

  it('separates the same bytes in a different order', () => {
    expect(fingerprint(bytes(1, 2, 3))).not.toBe(fingerprint(bytes(3, 2, 1)));
  });

  it('is a fixed-width hex string whatever the file', () => {
    for (const f of [new Uint8Array(0), bytes(255), new Uint8Array(9001).fill(255)]) {
      expect(fingerprint(f)).toMatch(/^[0-9a-f]{24}$/);
    }
  });

  it('stays exact past the point a plain multiply would not', () => {
    // Math.imul rather than *: the FNV prime takes the running value past 2^53
    // within a handful of bytes, and a double quietly drops the low bits —
    // which makes the hash depend on far less of the file than it looks like
    // it does. Two files differing only in their last byte are the check.
    const a = new Uint8Array(64).fill(0xff);
    const b = new Uint8Array(64).fill(0xff);
    b[63] = 0xfe;
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('finds a file already in the library, and does not find one that is not', () => {
    const library = [record({ id: 'a', fingerprint: 'x' }), record({ id: 'b', fingerprint: 'y' })];
    expect(alreadyOpen(library, 'y')?.id).toBe('b');
    expect(alreadyOpen(library, 'z')).toBeUndefined();
  });
});

describe('the extension', () => {
  it('is kept, because the bytes come back out of the database with no name on them', () => {
    expect(extensionOf('SITE.nle')).toBe('.nle');
    expect(extensionOf('Points Export.CSV')).toBe('.csv');
  });

  it('is nothing where there is not one, rather than the whole name', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('refuses a tail that is a sentence with a full stop in it', () => {
    expect(extensionOf('Level 3 rev B. final copy')).toBe('');
  });
});

describe('summarising a parsed config', () => {
  const parsed: ParsedConfig = {
    brand: 'ampac',
    parser: 'test',
    warnings: ['One zone had no text.'],
    panels: [
      {
        name: 'MAIN',
        brand: 'ampac',
        loops: [{ number: 1 }, { number: 2 }],
        zones: [
          { number: 1, text: 'LOBBY', unused: false },
          { number: 2, text: '', unused: true },
        ],
        points: [
          { text: 'LOBBY SMOKE', deviceType: 'smoke-photo', unused: false },
          { text: 'PLANT HEAT', deviceType: 'heat', unused: false },
          { text: 'LEVEL 1 SMOKE', deviceType: 'smoke-photo', unused: false },
          { text: '', deviceType: 'unknown', unused: true },
        ],
        causeEffect: [{ causeLabel: 'Zone 1 alarm', causeKind: 'zone-alarm', effects: [] }],
      },
      {
        name: 'SUB',
        brand: 'ampac',
        loops: [{ number: 1 }],
        zones: [{ number: 3, text: 'CARPARK', unused: false }],
        points: [{ text: 'CARPARK MCP', deviceType: 'mcp', unused: false }],
        causeEffect: [],
      },
    ],
  };

  const summary = summarise(parsed);

  it('counts across every panel in the file, not just the first', () => {
    expect(summary).toMatchObject({ panels: 2, loops: 3, zones: 3, points: 5, rules: 1 });
  });

  it('counts spare points inside the total rather than beside it', () => {
    // A technician reading "5 devices, 1 spare" knows there are four to test.
    // Reported separately it reads as six.
    expect(summary.points).toBe(5);
    expect(summary.unused).toBe(1);
  });

  it('orders the breakdown by how many there are', () => {
    expect(summary.breakdown[0]).toEqual({ type: 'smoke-photo', count: 2 });
    expect(summary.breakdown.map((b) => b.count)).toEqual([2, 1, 1, 1]);
  });

  it('carries the parser’s warnings rather than swallowing them', () => {
    expect(summary.warnings).toEqual(['One zone had no text.']);
  });

  it('copies the warnings, so a library row cannot be edited through the parse', () => {
    parsed.warnings.push('added later');
    expect(summary.warnings).toHaveLength(1);
  });
});

describe('the line under a file name', () => {
  it('leads with the device count', () => {
    const line = describeSummary({ ...emptySummary(), points: 142, zones: 24, loops: 2 });
    expect(line).toBe('142 devices · 24 zones · 2 loops');
  });

  it('leaves out what the file does not carry rather than printing a nought', () => {
    // A CSV device list has no zone table. "0 zones" reads as a fault in the
    // building, not as a fact about the export.
    expect(describeSummary({ ...emptySummary(), points: 30 })).toBe('30 devices');
  });

  it('says so plainly when there is nothing in it at all', () => {
    expect(describeSummary(emptySummary())).toBe('Nothing this build can read');
  });

  it('counts one of something in the singular', () => {
    expect(describeSummary({ ...emptySummary(), points: 1, zones: 1, loops: 1 }))
      .toBe('1 device · 1 zone · 1 loop');
  });

  it('mentions panels only where there is more than one, since one is the usual case', () => {
    expect(describeSummary({ ...emptySummary(), points: 5, panels: 1 })).toBe('5 devices');
    expect(describeSummary({ ...emptySummary(), points: 5, panels: 3 })).toContain('3 panels');
  });
});

describe('grouping the library by building', () => {
  it('puts two versions of the same site together, newest first', () => {
    const groups = byBuilding([
      record({ id: 'old', siteNameInFile: 'Vaxxas', lastOpenedAt: '2026-01-01T00:00:00.000Z' }),
      record({ id: 'new', siteNameInFile: 'Vaxxas', lastOpenedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Vaxxas');
    expect(groups[0]?.records.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('does not join two different site names', () => {
    const groups = byBuilding([
      record({ id: 'a', siteNameInFile: 'Vaxxas' }),
      record({ id: 'b', siteNameInFile: 'Translational Research Institute' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('falls back to the file name where the file carries no site name', () => {
    const groups = byBuilding([
      record({ id: 'a', fileName: 'TOWER rev B.pci', siteNameInFile: undefined }),
      record({ id: 'b', fileName: 'TOWER.pci', siteNameInFile: undefined }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('never reaches across a site name to a file name', () => {
    // A file that names its site and one that does not are not joined even
    // where the names would match, because one of the two facts is evidence
    // and the other is what somebody called a download.
    const groups = byBuilding([
      record({ id: 'a', fileName: 'Vaxxas.nle', siteNameInFile: 'Vaxxas' }),
      record({ id: 'b', fileName: 'Vaxxas.nle', siteNameInFile: undefined }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('orders the buildings by the most recently opened file in each', () => {
    const groups = byBuilding([
      record({ id: 'a', siteNameInFile: 'A', lastOpenedAt: '2026-01-01T00:00:00.000Z' }),
      record({ id: 'b', siteNameInFile: 'B', lastOpenedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['B', 'A']);
  });

  it('labels a group with the newest file’s site name, trimmed', () => {
    expect(byBuilding([record({ siteNameInFile: '  Vaxxas  ' })])[0]?.label).toBe('Vaxxas');
  });

  it('ignores case and surrounding space when deciding two files are one building', () => {
    expect(buildingKey(record({ siteNameInFile: ' VAXXAS ' })))
      .toBe(buildingKey(record({ siteNameInFile: 'vaxxas' })));
  });
});

describe('the file-name stem', () => {
  it('drops the ways a second copy of a configuration actually arrives', () => {
    expect(stemOf('SITE.nle')).toBe('site');
    expect(stemOf('SITE rev C.nle')).toBe('site');
    expect(stemOf('SITE v2.nle')).toBe('site');
    expect(stemOf('SITE (3).nle')).toBe('site');
    expect(stemOf('SITE - Copy.nle')).toBe('site');
  });

  it('leaves a name that is not a revision marker alone', () => {
    // "Level 3" is where the panel is, not which copy of the file this is.
    expect(stemOf('TOWER Level 3.nle')).toBe('tower level 3');
    expect(stemOf('BUILDING 7.pci')).toBe('building 7');
  });
});
