import { deflateRaw } from 'pako';
import { ZipError, isZip, likelyConfigEntry, readZip } from '@/parsers/zipRead';
import { createZip, crc32, utf8Bytes } from '@/export/zip';

/**
 * Reading a zip container.
 *
 * The app writes zips already, so the strongest test available is the round
 * trip: anything createZip produces must come back byte for byte. Beyond that,
 * what matters is the refusals — an encrypted or zip64 entry read as an
 * ordinary one yields bytes that look like data and are not, and downstream
 * that becomes a device list full of nonsense.
 */

const text = (b: Uint8Array): string => Buffer.from(b).toString('utf8');

describe('round trip against our own writer', () => {
  it('returns exactly what was put in', () => {
    const zip = createZip([
      { name: 'a.txt', data: utf8Bytes('LEVEL 1 EAST') },
      { name: 'b.txt', data: utf8Bytes('LEVEL 1 WEST') },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(text(entries[0]!.bytes)).toBe('LEVEL 1 EAST');
    expect(text(entries[1]!.bytes)).toBe('LEVEL 1 WEST');
  });

  it('handles a large, highly repetitive entry — which is what a config is', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `${i}\tDEVICE ${i}\tSMOKE\tZONE 1`).join('\n');
    const entries = readZip(createZip([{ name: 'site.cfg', data: utf8Bytes(body) }]));
    expect(text(entries[0]!.bytes)).toBe(body);
  });

  it('preserves a non-ASCII name rather than mangling it', () => {
    const entries = readZip(createZip([{ name: 'café.txt', data: utf8Bytes('x') }]));
    expect(entries[0]!.name).toBe('café.txt');
  });

  it('recognises a zip by its signature', () => {
    expect(isZip(createZip([{ name: 'a', data: utf8Bytes('x') }]))).toBe(true);
    expect(isZip(utf8Bytes('not a zip at all'))).toBe(false);
  });
});

describe('deflated entries', () => {
  /** Builds a minimal zip by hand so the compression method can be controlled. */
  function buildZip(name: string, raw: Uint8Array, method: 0 | 8, opts: { flags?: number } = {}): Uint8Array {
    const data = method === 8 ? deflateRaw(raw) : raw;
    const nameBytes = utf8Bytes(name);
    const crc = crc32(raw) >>> 0;
    const parts: number[] = [];
    const push32 = (n: number) => parts.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    const push16 = (n: number) => parts.push(n & 0xff, (n >>> 8) & 0xff);

    const localOffset = 0;
    push32(0x04034b50); push16(20); push16(opts.flags ?? 0); push16(method);
    push16(0); push16(0); push32(crc); push32(data.length); push32(raw.length);
    push16(nameBytes.length); push16(0);
    parts.push(...nameBytes, ...data);

    const centralOffset = parts.length;
    push32(0x02014b50); push16(20); push16(20); push16(opts.flags ?? 0); push16(method);
    push16(0); push16(0); push32(crc); push32(data.length); push32(raw.length);
    push16(nameBytes.length); push16(0); push16(0); push16(0); push16(0); push32(0);
    push32(localOffset);
    parts.push(...nameBytes);

    const dirSize = parts.length - centralOffset;
    push32(0x06054b50); push16(0); push16(0); push16(1); push16(1);
    push32(dirSize); push32(centralOffset); push16(0);
    return Uint8Array.from(parts);
  }

  it('inflates a deflated entry', () => {
    const body = 'ZONE 1 ZONE 1 ZONE 1 ZONE 1 ZONE 1 ZONE 1';
    const entries = readZip(buildZip('site.cfg', utf8Bytes(body), 8));
    expect(entries[0]!.method).toBe(8);
    expect(text(entries[0]!.bytes)).toBe(body);
  });

  it('reads a stored entry unchanged', () => {
    const entries = readZip(buildZip('site.cfg', utf8Bytes('ZONE 1'), 0));
    expect(entries[0]!.method).toBe(0);
    expect(text(entries[0]!.bytes)).toBe('ZONE 1');
  });

  it('refuses an encrypted entry rather than returning noise', () => {
    // Bit 0 set. Its bytes decompress to nothing meaningful, and handing them
    // on would produce a device list full of nonsense.
    expect(() => readZip(buildZip('site.cfg', utf8Bytes('ZONE 1'), 0, { flags: 0x01 })))
      .toThrow(/encrypted/i);
  });
});

describe('refusing what it cannot read correctly', () => {
  it('rejects something that is not a zip', () => {
    expect(() => readZip(utf8Bytes('this is a plain text file, quite long but not a zip archive')))
      .toThrow(ZipError);
  });

  it('rejects a file too short to be one', () => {
    expect(() => readZip(Uint8Array.from([0x50, 0x4b]))).toThrow(/too short/i);
  });

  it('rejects a truncated archive rather than returning the entries it managed', () => {
    // Half an archive is worse than none: a partial device list looks complete.
    const zip = createZip([
      { name: 'a.txt', data: utf8Bytes('x'.repeat(500)) },
      { name: 'b.txt', data: utf8Bytes('y'.repeat(500)) },
    ]);
    expect(() => readZip(zip.slice(0, Math.floor(zip.length / 2)))).toThrow(ZipError);
  });

  it('detects a corrupted entry through its checksum', () => {
    const zip = createZip([{ name: 'a.txt', data: utf8Bytes('LEVEL 1 EAST') }]);
    // Flip a byte inside the stored payload, past the local header and name.
    const damaged = Uint8Array.from(zip);
    damaged[35] = damaged[35]! ^ 0xff;
    expect(() => readZip(damaged)).toThrow(/checksum|damaged|decompress/i);
  });
});

describe('picking the configuration out of an archive', () => {
  it('takes the largest data entry', () => {
    const entries = readZip(createZip([
      { name: 'manifest.txt', data: utf8Bytes('v1') },
      { name: 'site.cfg', data: utf8Bytes('x'.repeat(2000)) },
      { name: 'readme.txt', data: utf8Bytes('notes') },
    ]));
    expect(likelyConfigEntry(entries)?.name).toBe('site.cfg');
  });

  it('ignores images and binaries even when they are the biggest thing there', () => {
    const entries = readZip(createZip([
      { name: 'splash.png', data: utf8Bytes('x'.repeat(9000)) },
      { name: 'site.cfg', data: utf8Bytes('y'.repeat(100)) },
    ]));
    expect(likelyConfigEntry(entries)?.name).toBe('site.cfg');
  });

  it('returns nothing when there is no plausible candidate', () => {
    const entries = readZip(createZip([{ name: 'logo.png', data: utf8Bytes('x') }]));
    expect(likelyConfigEntry(entries)).toBeUndefined();
  });
});
