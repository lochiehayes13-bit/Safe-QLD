import { existsSync, readFileSync } from 'fs';
import { decodeForProbe, probeFile } from '@/parsers/probe';

/**
 * Characterising an unknown configuration file.
 *
 * The value of this is entirely in not being confidently wrong. Calling a
 * binary blob "delimited text" would send someone down a week of the wrong
 * work, and calling a readable text file "unknown binary" would mean not
 * bothering to try. So most of these check the boundaries rather than the
 * happy path.
 */

const bytes = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe('containers', () => {
  it('recognises a zip by its signature, not its extension', () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1, 2, 3]);
    expect(probeFile(zip).container).toBe('zip');
    expect(probeFile(zip).assessment).toMatch(/unpack/i);
  });

  it('recognises a SQLite database, and says it is the good case', () => {
    const db = bytes('SQLite format 3\0');
    const p = probeFile(db);
    expect(p.container).toBe('sqlite');
    expect(p.assessment).toMatch(/schema/i);
  });

  it('recognises an OLE compound file and does not pretend it is easy', () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    const p = probeFile(ole);
    expect(p.container).toBe('ole-compound');
    expect(p.assessment).toMatch(/hardest|proprietary/i);
  });

  it('recognises gzip and Access', () => {
    expect(probeFile(Uint8Array.from([0x1f, 0x8b, 0x08, 0])).container).toBe('gzip');
    expect(probeFile(bytes('\x00\x01\x00\x00Standard Jet DB')).container).toBe('ms-access');
  });

  it('recognises XML', () => {
    expect(probeFile(bytes('<?xml version="1.0"?><site><zone n="1"/></site>')).container).toBe('xml');
    expect(probeFile(bytes('<site>\n  <zone n="1"/>\n</site>')).container).toBe('xml');
  });

  it('only calls it JSON when it actually parses', () => {
    expect(probeFile(bytes('{"zones":[{"n":1}]}')).container).toBe('json');
    // Ampac's own format opens with a bracket and is not JSON. Calling it JSON
    // would be a confident wrong answer about the one format already solved.
    expect(probeFile(bytes('[ P 10000 P 1\nMAIN FIRE PANEL\t1\n[ Z 1\n')).container).toBe('plain-text');
  });

  it('calls unprintable bytes with no signature what they are', () => {
    const blob = Uint8Array.from(Array.from({ length: 4000 }, (_, i) => (i * 7 + 3) % 256));
    const p = probeFile(blob);
    expect(p.container).toBe('unknown-binary');
    expect(p.textual).toBe(false);
    expect(p.assessment).toMatch(/sample files/i);
  });
});

describe('encoding', () => {
  it('spots UTF-16 from a byte order mark', () => {
    expect(probeFile(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])).encoding).toBe('utf-16le');
    expect(probeFile(Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42])).encoding).toBe('utf-16be');
  });

  it('spots UTF-16 without a mark, which Windows tooling produces', () => {
    // "ZONE 1" as UTF-16LE with no BOM. Read as bytes this is nonsense, so
    // getting it wrong means every field comes out interleaved with nulls.
    const utf16 = Uint8Array.from(
      [...'ZONE 1 ZONE 2 ZONE 3 ZONE 4 ZONE 5'].flatMap((c) => [c.charCodeAt(0), 0]),
    );
    expect(probeFile(utf16).encoding).toBe('utf-16le');
  });

  it('reads plain ASCII as utf-8', () => {
    expect(probeFile(bytes('LEVEL 1 EAST\nLEVEL 1 WEST\n')).encoding).toBe('utf-8');
  });

  it('decodes UTF-16 back to something readable', () => {
    const utf16 = Uint8Array.from([...'ZONE'].flatMap((c) => [c.charCodeAt(0), 0]));
    expect(decodeForProbe(utf16, 'utf-16le')).toBe('ZONE');
  });
});

describe('delimiters', () => {
  it('finds a tab separator that holds across lines', () => {
    const text = Array.from({ length: 20 }, (_, i) => `${i}\tDEVICE ${i}\tSMOKE\tZONE 1`).join('\n');
    const p = probeFile(bytes(text));
    expect(p.delimiter?.name).toBe('tab');
    expect(p.delimiter!.consistency).toBeGreaterThan(0.9);
  });

  it('does not call a comma in prose a delimiter', () => {
    // Commas appear, but not the same number per line. Treating this as CSV
    // gives a column layout that shifts partway down the file.
    const text = [
      'The panel is located in the plant room, level 1.',
      'Access is via the east stair.',
      'Note: the riser, the cupboard and the roof are locked, key at reception.',
      'Contact the building manager.',
      'No further notes.',
    ].join('\n');
    expect(probeFile(bytes(text)).delimiter).toBeUndefined();
  });

  it('reports no delimiter for fixed-width records rather than guessing one', () => {
    const text = Array.from({ length: 10 }, (_, i) => `001${String(i).padStart(4, '0')}SMOKE     ZONE1`).join('\n');
    expect(probeFile(bytes(text)).delimiter).toBeUndefined();
  });
});

describe('structure', () => {
  it('generalises numbers out of section headers so repeats are visible', () => {
    const text = ['[ P 10000 P 1', 'a\tb', '[ P 20000 P 2', 'c\td', '[ P 30000 P 3', 'e\tf'].join('\n');
    const p = probeFile(bytes(text));
    // All three headers share one shape, so they should collapse to one entry
    // counted three times rather than three unrelated lines.
    expect(p.sectionMarkers.some((m) => m.includes('×3'))).toBe(true);
  });

  it('picks out a controlled vocabulary from the noise', () => {
    const text = Array.from({ length: 30 }, (_, i) => `${i}\tDEVICE ${i}\tSMOKE`).join('\n');
    const p = probeFile(bytes(text));
    expect(p.repeatedTokens.some((t) => t.token === 'SMOKE' && t.count >= 5)).toBe(true);
  });

  it('ignores bare numbers, which are data rather than vocabulary', () => {
    const text = Array.from({ length: 30 }, (_, i) => `100\t200\t300\t${i}`).join('\n');
    expect(probeFile(bytes(text)).repeatedTokens).toEqual([]);
  });

  it('survives an empty file without throwing', () => {
    const p = probeFile(new Uint8Array(0));
    expect(p.byteLength).toBe(0);
    expect(p.assessment.length).toBeGreaterThan(0);
  });

  it('truncates a very long line in the preview rather than dumping it', () => {
    const p = probeFile(bytes(`${'x'.repeat(5000)}\nshort`));
    expect(p.head[0]!.length).toBeLessThan(220);
    expect(p.head[0]).toMatch(/…$/);
  });
});

/**
 * Against the one real vendor configuration available locally. Skipped
 * otherwise — customer configurations are not committed.
 */
const REAL = '/tmp/ffpreader/data/input/QWP 16.02.24.ffp';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against a real Ampac configuration', () => {
  it('characterises it the way it actually is', () => {
    // This is the control: a format already solved by hand. If the probe
    // describes it correctly, its description of an unsolved one is worth
    // acting on.
    const p = probeFile(new Uint8Array(readFileSync(REAL)));
    expect(p.textual).toBe(true);
    expect(p.container).toBe('plain-text');
    expect(p.delimiter?.name).toBe('tab');
    expect(p.sectionMarkers.length).toBeGreaterThan(0);
    expect(p.repeatedTokens.length).toBeGreaterThan(0);
    expect(p.lineCount).toBeGreaterThan(1000);
    expect(p.assessment).toMatch(/workable/i);
  });
});
