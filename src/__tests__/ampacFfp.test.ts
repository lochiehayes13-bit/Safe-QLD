import { existsSync, readFileSync } from 'fs';
import {
  FFP_MAGIC, expandDeviceToken, isFfp, loopOf, nodeOf, parseFfp, parseSections,
} from '@/parsers/ampacFfp';

/**
 * A minimal but structurally faithful .ffp, built to exercise the parts that
 * bite: implicit addressing, blank slots between populated ones, and the split
 * of a cause-and-effect function across several sections.
 */
const SAMPLE = [
  FFP_MAGIC,
  '',
  'File Version: 1000',
  'Project: Test Site',
  'Date : 16/02/2024 9:59:42',
  'Configuration Version: 255\t0',
  'ConfigManagerPlus Version: 2.7.2.1',
  '[ P 10000 P 1',
  'MAIN FIRE PANEL\t1',
  ']',
  '[ P 20000 P 1',
  'SUB PANEL ONE\t2',
  ']',
  '[ Z 1 Z 1',
  'Y\tLEVEL 1 LOBBY\tN\tN\t0\t0',
  'Y\tLEVEL 1 PLANT\tN\tN\t0\t0',
  'N\t\tN\tN\t0\t0',
  'Y\tLEVEL 2 LOBBY\tN\tN\t0\t0',
  ']',
  '[ M 10101 X 2',
  // Address 1 populated.
  '1\tL1 LOBBY SMOKE 1\tx02\tOPT\t0\t0',
  // Address 2 deliberately blank — the trap.
  '0\t\t0\t\t0\t0',
  // Address 3 populated, and must stay at address 3.
  '2\tL1 PLANT HEAT\ta03\tHEAT\t0\t0',
  '0\tUnassigned Text\t0\t\t0\t0',
  '4\tL2 LOBBY MCP\ta03\tMCP\t0\t0',
  ']',
  '[ M 10102 X 2',
  '1\tLOOP 2 SOUNDER\ta03\tSOUND\t0\t0',
  ']',
  '[ F 7 0 1',
  'Level 1 Evacuation',
  ']',
  '[ F 7 0 13',
  'Z\t1',
  ']',
  '[ F 7 0 40',
  'GS\t1',
  ']',
  '[ F 7 0 41',
  'OL\t3',
  ']',
].join('\n');

describe('format detection', () => {
  it('recognises the magic line', () => {
    expect(isFfp(SAMPLE)).toBe(true);
    expect(isFfp('some,csv,file')).toBe(false);
  });
});

describe('section splitting', () => {
  it('reads the header block', () => {
    const { header } = parseSections(SAMPLE);
    expect(header.project).toBe('Test Site');
    expect(header.fileVersion).toBe('1000');
    expect(header.configManagerVersion).toBe('2.7.2.1');
  });

  it('splits every section with its id, sub and index', () => {
    const { sections } = parseSections(SAMPLE);
    expect(sections.length).toBe(9);
    const zone = sections.find((s) => s.type === 'Z')!;
    expect(zone.rows).toHaveLength(4);
    const loop = sections.find((s) => s.type === 'M' && s.id === 10101)!;
    expect(loop.sub).toBe('X');
    expect(loop.index).toBe(2);
    expect(loop.rows).toHaveLength(5);
  });

  it('keeps empty trailing fields, which carry meaning', () => {
    const { sections } = parseSections(SAMPLE);
    const loop = sections.find((s) => s.type === 'M' && s.id === 10101)!;
    expect(loop.rows[1]!.length).toBeGreaterThan(4);
  });
});

describe('id decoding', () => {
  it('extracts node numbers', () => {
    expect(nodeOf(10101)).toBe(1);
    expect(nodeOf(90104)).toBe(9);
    expect(nodeOf(260111)).toBe(26);
    expect(nodeOf(10000)).toBe(1);
  });

  it('extracts loop numbers', () => {
    expect(loopOf(10101)).toBe(1);
    expect(loopOf(90104)).toBe(4);
    expect(loopOf(260111)).toBe(11);
  });

  it('returns null for ids that are not loops', () => {
    expect(loopOf(10000)).toBeNull();
    expect(loopOf(20000)).toBeNull();
  });
});

describe('parsing', () => {
  const parsed = parseFfp(SAMPLE);
  const panel = parsed.panels[0]!;

  it('names the site from the project header', () => {
    expect(parsed.siteName).toBe('Test Site');
    expect(parsed.brand).toBe('ampac');
    expect(panel.model).toBe('FireFinder PLUS');
  });

  it('numbers zones by row position and drops empty slots', () => {
    expect(panel.zones.map((z) => z.number)).toEqual([1, 2, 4]);
    expect(panel.zones[0]!.text).toBe('LEVEL 1 LOBBY');
    expect(panel.zones[2]!.text).toBe('LEVEL 2 LOBBY');
  });

  it('assigns addresses from row position, not from the populated sequence', () => {
    // This is the trap: address 3 must stay 3 even though address 2 is blank.
    const loop1 = panel.points.filter((p) => p.loopNumber === 1);
    expect(loop1.map((p) => p.address)).toEqual([1, 3, 5]);
    expect(loop1[1]!.text).toBe('L1 PLANT HEAT');
    expect(loop1[2]!.text).toBe('L2 LOBBY MCP');
  });

  it('treats "Unassigned Text" as an empty slot', () => {
    expect(panel.points.some((p) => p.text === 'Unassigned Text')).toBe(false);
  });

  it('keeps blank slots when asked, still correctly numbered', () => {
    const all = parseFfp(SAMPLE, { includeUnused: true }).panels[0]!;
    const loop1 = all.points.filter((p) => p.loopNumber === 1);
    expect(loop1.map((p) => p.address)).toEqual([1, 2, 3, 4, 5]);
    expect(loop1[1]!.unused).toBe(true);
  });

  it('carries zone text onto each point', () => {
    const smoke = panel.points.find((p) => p.address === 1 && p.loopNumber === 1)!;
    expect(smoke.zoneNumber).toBe(1);
    expect(smoke.zoneText).toBe('LEVEL 1 LOBBY');
  });

  it('normalises device types from the Ampac token', () => {
    const byAddr = (loop: number, addr: number) =>
      panel.points.find((p) => p.loopNumber === loop && p.address === addr)!;
    expect(byAddr(1, 1).deviceType).toBe('smoke-photo');
    expect(byAddr(1, 3).deviceType).toBe('heat');
    expect(byAddr(1, 5).deviceType).toBe('mcp');
    expect(byAddr(2, 1).deviceType).toBe('sounder');
  });

  it('builds a point reference carrying node, loop and address', () => {
    expect(panel.points[0]!.pointRef).toBe('N1L1P001');
  });

  it('lists the loops it found', () => {
    expect(panel.loops.map((l) => l.number)).toEqual([1, 2]);
  });

  it('reads cause and effect split across sections', () => {
    expect(panel.causeEffect).toHaveLength(1);
    const rule = panel.causeEffect[0]!;
    expect(rule.causeLabel).toContain('Level 1 Evacuation');
    expect(rule.causeLabel).toContain('LEVEL 1 LOBBY');
    expect(rule.causeKind).toBe('zone-alarm');
    expect(rule.causeZoneNumber).toBe(1);
    expect(rule.effects).toHaveLength(2);
  });

  it('says plainly that undocumented operands were not expanded', () => {
    // GS and OL have no vendor documentation, so they stay as recorded.
    const rule = panel.causeEffect[0]!;
    expect(rule.effects.map((e) => e.effectLabel)).toEqual(['GS 1', 'OL 3']);
  });

  it('notes when the configuration spans networked panels', () => {
    expect(parsed.warnings.some((w) => w.includes('networked'))).toBe(true);
  });
});

describe('device token expansion', () => {
  it('expands the tokens seen in real configurations', () => {
    expect(expandDeviceToken('OPT')).toBe('Optical smoke detector');
    expect(expandDeviceToken('mcp')).toBe('Manual call point');
    expect(expandDeviceToken('DMULTI')).toBe('Multisensor detector');
  });

  it('leaves an unknown token unexpanded rather than guessing', () => {
    expect(expandDeviceToken('XYZZY')).toBeUndefined();
  });
});

/**
 * Runs against a real 1.7 MB site configuration when one is available locally.
 * Skipped otherwise — customer configurations are not committed.
 */
const REAL = '/tmp/ffpreader/data/input/QWP 16.02.24.ffp';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against a real site configuration', () => {
  const text = readFileSync(REAL, 'latin1');
  const parsed = parseFfp(text);
  const panel = parsed.panels[0]!;

  it('detects the format', () => {
    expect(isFfp(text)).toBe(true);
  });

  it('reads a large networked site', () => {
    expect(panel.points.length).toBeGreaterThan(3000);
    expect(panel.zones.length).toBeGreaterThan(400);
    expect(panel.loops.length).toBeGreaterThan(4);
  });

  it('starts every loop at address 1', () => {
    const all = parseFfp(text, { includeUnused: true }).panels[0]!;
    const byLoop = new Map<number, number[]>();
    for (const p of all.points) {
      const arr = byLoop.get(p.loopNumber!) ?? [];
      arr.push(p.address!);
      byLoop.set(p.loopNumber!, arr);
    }
    for (const addrs of byLoop.values()) {
      expect(Math.min(...addrs)).toBe(1);
    }
  });

  it('resolves zone text onto points', () => {
    const withZone = panel.points.filter((p) => p.zoneText);
    expect(withZone.length).toBeGreaterThan(100);
  });

  it('extracts cause and effect functions', () => {
    expect(panel.causeEffect.length).toBeGreaterThan(0);
  });

  it('parses a 1.7 MB file quickly enough for a phone', () => {
    const t0 = Date.now();
    parseFfp(text);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
