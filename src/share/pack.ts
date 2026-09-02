import { deflate, inflate } from 'pako';
import { crc32, fromBase64, toBase64, utf8Bytes } from '@/export/zip';
import type { ParsedConfig, ParsedPanel, Point, Zone } from '@/domain/types';

/**
 * Safe QLD share pack (.sqld).
 *
 * A vendor site file carries far more than a technician needs in the field —
 * a large Simplex network config runs to gigabytes. A pack holds only the
 * normalised data the app actually displays (zones, points, loops, cause and
 * effect), column-oriented and deflated, which is what gets it down to
 * megabytes. The original vendor file is never included, so sharing a pack
 * does not redistribute a customer's proprietary configuration.
 *
 * Wire format:
 *   magic   4 bytes  "SQLD"
 *   version 1 byte
 *   flags   1 byte   bit0 = deflated
 *   crc32   4 bytes  little-endian, over the uncompressed payload
 *   payload n bytes  UTF-8 JSON, deflated when bit0 set
 */

export const PACK_MAGIC = 'SQLD';
export const PACK_VERSION = 1;

const HEADER_BYTES = 10;

export interface PackMeta {
  /** App version that produced the pack. */
  app: string;
  /** Free-text site name so a receiver knows what they were sent. */
  siteName: string;
  /** ISO timestamp, supplied by the caller so packing stays deterministic. */
  createdAt: string;
  /** Optional sender name, shown on import. */
  sender?: string;
}

export interface PackPayload {
  meta: PackMeta;
  config: ParsedConfig;
}

/**
 * Column-oriented encoding of points.
 *
 * Point records are extremely repetitive — the same device type and zone text
 * repeat across hundreds of rows. Splitting into parallel arrays and
 * dictionary-encoding the repeated strings lets deflate work on runs of small
 * integers instead of scattered text, which is most of the size win.
 */
interface PackedPoints {
  n: number;
  /** Dictionary of unique strings referenced by index. */
  dict: string[];
  loop: (number | null)[];
  addr: (number | null)[];
  sub: (number | null)[];
  ref: (number | null)[];
  text: number[];
  text2: (number | null)[];
  typeRaw: (number | null)[];
  type: number[];
  zone: (number | null)[];
  zoneText: (number | null)[];
  unused: number[];
}

class Dict {
  private map = new Map<string, number>();
  readonly list: string[] = [];

  intern(s: string | undefined | null): number | null {
    if (s === undefined || s === null) return null;
    const hit = this.map.get(s);
    if (hit !== undefined) return hit;
    const idx = this.list.length;
    this.list.push(s);
    this.map.set(s, idx);
    return idx;
  }

  /** Interning a required field: empty string is still a real value. */
  internReq(s: string): number {
    return this.intern(s ?? '')!;
  }
}

function packPoints(points: Omit<Point, 'id' | 'panelId'>[]): PackedPoints {
  const d = new Dict();
  const out: PackedPoints = {
    n: points.length,
    dict: d.list,
    loop: [], addr: [], sub: [], ref: [], text: [], text2: [],
    typeRaw: [], type: [], zone: [], zoneText: [], unused: [],
  };
  for (const p of points) {
    out.loop.push(p.loopNumber ?? null);
    out.addr.push(p.address ?? null);
    out.sub.push(p.subAddress ?? null);
    out.ref.push(d.intern(p.pointRef));
    out.text.push(d.internReq(p.text));
    out.text2.push(d.intern(p.text2));
    out.typeRaw.push(d.intern(p.deviceTypeRaw));
    out.type.push(d.internReq(p.deviceType));
    out.zone.push(p.zoneNumber ?? null);
    out.zoneText.push(d.intern(p.zoneText));
    out.unused.push(p.unused ? 1 : 0);
  }
  return out;
}

function unpackPoints(p: PackedPoints): Omit<Point, 'id' | 'panelId'>[] {
  const s = (i: number | null | undefined): string | undefined =>
    i === null || i === undefined ? undefined : p.dict[i];
  const out: Omit<Point, 'id' | 'panelId'>[] = [];
  for (let i = 0; i < p.n; i++) {
    out.push({
      loopNumber: p.loop[i] ?? undefined,
      address: p.addr[i] ?? undefined,
      subAddress: p.sub[i] ?? undefined,
      pointRef: s(p.ref[i]),
      text: s(p.text[i]) ?? '',
      text2: s(p.text2[i]),
      deviceTypeRaw: s(p.typeRaw[i]),
      deviceType: (s(p.type[i]) ?? 'unknown') as Point['deviceType'],
      zoneNumber: p.zone[i] ?? undefined,
      zoneText: s(p.zoneText[i]),
      unused: p.unused[i] === 1,
    });
  }
  return out;
}

interface WirePanel extends Omit<ParsedPanel, 'points'> {
  pts: PackedPoints;
}

interface WirePayload {
  meta: PackMeta;
  brand: ParsedConfig['brand'];
  model?: string;
  siteName?: string;
  parser: string;
  warnings: string[];
  panels: WirePanel[];
}

function toWire(payload: PackPayload): WirePayload {
  const { meta, config } = payload;
  return {
    meta,
    brand: config.brand,
    model: config.model,
    siteName: config.siteName,
    parser: config.parser,
    warnings: config.warnings,
    panels: config.panels.map((p) => {
      const { points, ...rest } = p;
      return { ...rest, pts: packPoints(points) };
    }),
  };
}

function fromWire(w: WirePayload): PackPayload {
  return {
    meta: w.meta,
    config: {
      brand: w.brand,
      model: w.model,
      siteName: w.siteName,
      parser: w.parser,
      warnings: w.warnings ?? [],
      panels: (w.panels ?? []).map((p, i) => {
        const { pts, ...rest } = p;
        // The points table is the pack; a panel without one is a bad file,
        // and it is told to the technician as one rather than as a crash
        // from inside the unpacker. Loops and cause-and-effect are optional
        // extras, and a screen that maps over them must not meet undefined.
        if (!pts || typeof pts !== 'object' || !Array.isArray(pts.dict)) {
          throw new PackError(`Pack panel ${i + 1}${rest.name ? ` (${rest.name})` : ''} has no points table.`);
        }
        return {
          ...rest,
          zones: (rest.zones ?? []) as Zone[] as ParsedPanel['zones'],
          points: unpackPoints(pts),
          loops: rest.loops ?? [],
          causeEffect: rest.causeEffect ?? [],
        };
      }),
    },
  };
}

/** Encodes a pack to raw bytes. */
export function encodePack(payload: PackPayload): Uint8Array {
  const json = JSON.stringify(toWire(payload));
  const raw = utf8Bytes(json);
  const crc = crc32(raw);
  const body = deflate(raw, { level: 9 });

  const out = new Uint8Array(HEADER_BYTES + body.length);
  out[0] = 0x53; // S
  out[1] = 0x51; // Q
  out[2] = 0x4c; // L
  out[3] = 0x44; // D
  out[4] = PACK_VERSION;
  out[5] = 0x01; // deflated
  out[6] = crc & 0xff;
  out[7] = (crc >>> 8) & 0xff;
  out[8] = (crc >>> 16) & 0xff;
  out[9] = (crc >>> 24) & 0xff;
  out.set(body, HEADER_BYTES);
  return out;
}

export class PackError extends Error {}

/** Decodes a pack, verifying magic, version and checksum. */
export function decodePack(bytes: Uint8Array): PackPayload {
  if (bytes.length < HEADER_BYTES) throw new PackError('File is too small to be a Safe QLD pack.');
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== PACK_MAGIC) throw new PackError('Not a Safe QLD pack file.');

  const version = bytes[4]!;
  if (version > PACK_VERSION) {
    throw new PackError(`This pack was made by a newer version of Safe QLD (format ${version}). Update the app to open it.`);
  }

  const deflated = (bytes[5]! & 0x01) === 1;
  const expectedCrc =
    ((bytes[6]! | (bytes[7]! << 8) | (bytes[8]! << 16) | (bytes[9]! << 24)) >>> 0);

  const body = bytes.subarray(HEADER_BYTES);
  let raw: Uint8Array;
  try {
    raw = deflated ? inflate(body) : body;
  } catch {
    throw new PackError('Pack is corrupt and could not be decompressed.');
  }

  if (crc32(raw) !== expectedCrc) throw new PackError('Pack failed its checksum — the file is damaged or incomplete.');

  const text = new TextDecoder().decode(raw);
  let wire: WirePayload;
  try {
    wire = JSON.parse(text) as WirePayload;
  } catch {
    throw new PackError('Pack contents could not be read.');
  }
  return fromWire(wire);
}

export function encodePackBase64(payload: PackPayload): string {
  return toBase64(encodePack(payload));
}

export function decodePackBase64(b64: string): PackPayload {
  return decodePack(fromBase64(b64));
}

/** Human-readable size, used in the share confirmation UI. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
