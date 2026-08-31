import { existsSync, readFileSync } from 'fs';
import { decodeForProbe, probeFile } from '@/parsers/probe';
import { createZip, utf8Bytes } from '@/export/zip';
import { deflate, gzip } from 'pako';

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

  it('recognises gzip and Access, in both Access formats', () => {
    expect(probeFile(Uint8Array.from([0x1f, 0x8b, 0x08, 0])).container).toBe('gzip');
    expect(probeFile(bytes('\x00\x01\x00\x00Standard Jet DB')).container).toBe('ms-access');
    // The newer engine, which is what .accdb means. Without this signature a
    // 12 MB Notifier export reads as "unknown binary" — the least useful true
    // statement available about a file that names its format in its header.
    expect(probeFile(bytes('\x00\x01\x00\x00Standard ACE DB')).container).toBe('ms-access');
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

describe('telling encrypted from merely binary', () => {
  /** Bytes with no structure left in them, as encryption or compression gives. */
  const random = (n: number): Uint8Array => {
    // A fixed linear congruential sequence: uniform over the byte range and
    // identical on every run, so the test cannot flake.
    const out = new Uint8Array(n);
    let x = 123456789;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
      out[i] = (x >>> 16) & 0xff;
    }
    return out;
  };

  it('calls a password-protected Access database what it is', () => {
    // This is the case that motivated the check. The header says Access and
    // the remaining 12 MB is noise, so the honest answer is "encrypted, and no
    // amount of work will change that" rather than "a database, go and export
    // its tables" — which sends someone off to do something impossible.
    const accdb = new Uint8Array(200000);
    accdb.set(bytes('\x00\x01\x00\x00Standard ACE DB'), 0);
    accdb.set(random(accdb.length - 20), 20);
    const p = probeFile(accdb);
    expect(p.container).toBe('ms-access');
    expect(p.randomLooking).toBe(true);
    expect(p.assessment).toMatch(/encrypted/i);
    expect(p.assessment).toMatch(/password/i);
  });

  it('does not call an ordinary Access database encrypted', () => {
    const accdb = new Uint8Array(200000);
    accdb.set(bytes('\x00\x01\x00\x00Standard ACE DB'), 0);
    // Table names, column names and padding: structured, so far from uniform.
    const filler = 'MSysObjects\0Zones\0ZoneName\0Devices\0Address\0'.repeat(4000);
    for (let i = 0; i < filler.length && 20 + i < accdb.length; i++) accdb[20 + i] = filler.charCodeAt(i);
    const p = probeFile(accdb);
    expect(p.randomLooking).toBe(false);
    expect(p.assessment).not.toMatch(/encrypted/i);
  });

  it('separates structured binary from noise', () => {
    // A device table of fixed-size records is unprintable but has structure;
    // saying "collect more samples" is right for it and wrong for noise.
    const structured = new Uint8Array(200000);
    for (let i = 0; i < structured.length; i += 16) {
      structured[i] = 0xc1 + ((i / 16) % 32);
      structured[i + 1] = 0x04;
      structured[i + 2] = 0x14;
      structured[i + 13] = 0xfb;
    }
    const s = probeFile(structured);
    expect(s.container).toBe('unknown-binary');
    expect(s.randomLooking).toBe(false);
    expect(s.assessment).toMatch(/sample files/i);

    const noise = probeFile(random(200000));
    expect(noise.container).toBe('unknown-binary');
    expect(noise.randomLooking).toBe(true);
    expect(noise.assessment).toMatch(/encrypted or already compressed/i);
    // And it says the opposite of what it tells you about structured bytes:
    // collecting more samples is the right advice there and futile here.
    expect(noise.assessment).toMatch(/no number of sample files will change that/i);
    expect(noise.assessment).not.toMatch(/Reverse engineering this needs several sample files/i);
  });

  it('does not ask the question of a text file', () => {
    // A byte histogram of English prose is nowhere near uniform, so the answer
    // would always be "no" and would only be confusing.
    expect(probeFile(bytes('LEVEL 1 EAST\nLEVEL 1 WEST\n')).randomLooking).toBe(false);
  });

  it('does not guess from too small a sample', () => {
    expect(probeFile(random(64)).randomLooking).toBe(false);
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

describe('opening a container', () => {
  it('probes the config inside a zip rather than stopping at the wrapper', () => {
    // "Unpack it first" leaves the reader where they started when the
    // interesting answer is one step away.
    const body = Array.from({ length: 50 }, (_, i) => `${i}\tDEVICE ${i}\tSMOKE\tZONE 1`).join('\n');
    const zip = createZip([
      { name: 'manifest.txt', data: utf8Bytes('v1') },
      { name: 'site.cfg', data: utf8Bytes(body) },
    ]);
    const p = probeFile(zip);
    expect(p.container).toBe('zip');
    expect(p.inner?.name).toBe('site.cfg');
    expect(p.inner?.probe.delimiter?.name).toBe('tab');
    expect(p.assessment).toMatch(/site\.cfg/);
  });

  it('unwraps a vendor header sitting in front of a zlib stream', () => {
    // Fusion's .sts is four bytes of tag, a length, a checksum, then ordinary
    // zlib. Reported as "unknown binary" it looks unreachable; opened, it is
    // one deflate call away.
    const body = Array.from({ length: 30 }, (_, i) => `${i}\tDEVICE ${i}\tSMOKE`).join('\n');
    const compressed = deflate(utf8Bytes(body));
    const wrapped = new Uint8Array(12 + compressed.length);
    wrapped.set([0x73, 0x74, 0x73, 0x01], 0);
    wrapped.set(compressed, 12);
    const p = probeFile(wrapped);
    expect(p.container).toBe('zlib');
    expect(p.inner?.probe.delimiter?.name).toBe('tab');
  });

  it('probes inside a raw zlib stream', () => {
    const body = Array.from({ length: 30 }, (_, i) => `${i},DEVICE ${i},SMOKE`).join('\n');
    const p = probeFile(deflate(utf8Bytes(body)));
    expect(p.container).toBe('zlib');
    expect(p.inner?.probe.delimiter?.name).toBe('comma');
  });

  it('probes inside a gzip', () => {
    const body = Array.from({ length: 30 }, (_, i) => `${i},DEVICE ${i},SMOKE`).join('\n');
    const p = probeFile(gzip(utf8Bytes(body)));
    expect(p.container).toBe('gzip');
    expect(p.inner?.probe.delimiter?.name).toBe('comma');
  });

  it('does not unwrap a second level', () => {
    // A container inside a container is either an unusual vendor choice worth
    // a human looking at, or an archive bomb.
    const innerZip = createZip([{ name: 'deep.txt', data: utf8Bytes('x') }]);
    const outer = createZip([{ name: 'inner.zip', data: innerZip }]);
    const p = probeFile(outer);
    expect(p.inner?.probe.container).toBe('zip');
    expect(p.inner?.probe.inner).toBeUndefined();
  });

  it('still reports the container when it will not open', () => {
    const broken = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...Array(40).fill(0)]);
    const p = probeFile(broken);
    expect(p.container).toBe('zip');
    expect(p.inner).toBeUndefined();
    expect(p.assessment).toMatch(/unpack/i);
  });
});
