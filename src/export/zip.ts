import { deflateRaw } from 'pako';

/**
 * Minimal ZIP writer.
 *
 * XLSX is a ZIP of XML parts, so writing spreadsheets means writing a ZIP.
 * Doing it here rather than pulling in SheetJS keeps the bundle small, avoids
 * SheetJS's Node `fs`/`stream` shims (which misbehave under React Native), and
 * sidesteps its known advisories. Only the features XLSX needs are implemented:
 * stored and deflated entries, no encryption, no zip64.
 */

export interface ZipEntry {
  /** Path within the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
}

// Standard CRC-32 (IEEE 802.3), table built once on first use.
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(buf: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = t[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function utf8Bytes(s: string): Uint8Array {
  // TextEncoder exists in Hermes and in Node's test environment.
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  // Fallback: manual UTF-8 encode.
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++;
    /*
     * A surrogate on its own is not a character and has no UTF-8 encoding.
     * Encoded literally it produces ED A0 80 — the CESU-8 form, which strict
     * readers reject, so a single stray half of a pair from a truncated panel
     * label would make a whole workbook or pack unreadable. TextEncoder
     * substitutes U+FFFD here, and the point of a fallback is that the two
     * paths are interchangeable.
     */
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }

  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}

/**
 * Builds a ZIP archive.
 *
 * Timestamps are fixed rather than taken from the clock so the same input
 * always produces byte-identical output — that makes the exporters testable.
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const out = new ByteWriter();
  const central: { name: Uint8Array; crc: number; csize: number; usize: number; offset: number; method: number }[] = [];

  // MS-DOS date/time for 2020-01-01 00:00:00.
  const DOS_TIME = 0;
  const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

  for (const e of entries) {
    const nameBytes = utf8Bytes(e.name);
    const crc = crc32(e.data);
    const deflated = deflateRaw(e.data, { level: 6 });
    // Only use deflate when it actually helps; tiny XML parts often grow.
    const useDeflate = deflated.length < e.data.length;
    const payload = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const offset = out.length;

    out.u32(0x04034b50);      // local file header signature
    out.u16(20);              // version needed
    out.u16(0x0800);          // flags: UTF-8 names
    out.u16(method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(payload.length);
    out.u32(e.data.length);
    out.u16(nameBytes.length);
    out.u16(0);               // extra field length
    out.push(nameBytes);
    out.push(payload);

    central.push({ name: nameBytes, crc, csize: payload.length, usize: e.data.length, offset, method });
  }

  const cdStart = out.length;
  for (const c of central) {
    out.u32(0x02014b50);      // central directory header signature
    out.u16(0x031e);          // version made by (UNIX, zip 3.0)
    out.u16(20);              // version needed
    out.u16(0x0800);
    out.u16(c.method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(c.crc);
    out.u32(c.csize);
    out.u32(c.usize);
    out.u16(c.name.length);
    out.u16(0);               // extra
    out.u16(0);               // comment
    out.u16(0);               // disk number
    out.u16(0);               // internal attrs
    out.u32(0);               // external attrs
    out.u32(c.offset);
    out.push(c.name);
  }
  const cdSize = out.length - cdStart;

  out.u32(0x06054b50);        // end of central directory
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(cdSize);
  out.u32(cdStart);
  out.u16(0);                 // comment length

  return out.concat();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64-encodes bytes. expo-file-system writes binary files via base64 strings. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < len ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? B64[b2 & 0x3f] : '=';
  }
  return out;
}

/** Decodes base64 back to bytes, for reading share packs. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64.indexOf(clean[i]!);
    const c1 = B64.indexOf(clean[i + 1] ?? 'A');
    const c2 = B64.indexOf(clean[i + 2] ?? 'A');
    const c3 = B64.indexOf(clean[i + 3] ?? 'A');
    if (o < outLen) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < outLen) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (o < outLen) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}
