import { inflateRaw } from 'pako';
import { crc32 } from '@/export/zip';

/**
 * Reading a zip container.
 *
 * The app already writes zips — that is how a workbook is built. This is the
 * other half, and it exists because vendor configurations turn up wrapped:
 * a Simplex site export is a zip, and the probe can say "unpack it first"
 * without being able to.
 *
 * Deliberately strict about what it refuses. A zip64 archive or an encrypted
 * entry read as though it were an ordinary one produces bytes that look like
 * data and are not, which downstream becomes a device list full of nonsense.
 * Failing with a reason is the only safe answer.
 */

export class ZipError extends Error {}

export interface ZipEntryRead {
  name: string;
  /** Uncompressed contents. */
  bytes: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 = stored, 8 = deflate. */
  method: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** The marker a zip64 archive leaves where a 32-bit field would overflow. */
const ZIP64_SENTINEL = 0xffffffff;

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}

function u32(b: Uint8Array, at: number): number {
  // Unsigned: a shift would make anything past 2 GB negative.
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000;
}

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]!);
  // Zip stores names as UTF-8; decoding as bytes mangles anything non-ASCII,
  // which matters for a site name with an accent in it.
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

/**
 * Locates the end-of-central-directory record.
 *
 * Scanned backwards because it sits at the very end, after a comment of
 * arbitrary length. The comment is capped at 64 KB by the format, so there is
 * no need to search further back than that.
 */
function findEocd(bytes: Uint8Array): number {
  const minimum = 22;
  if (bytes.length < minimum) throw new ZipError('Too short to be a zip archive.');
  const limit = Math.max(0, bytes.length - minimum - 0xffff);
  for (let i = bytes.length - minimum; i >= limit; i--) {
    if (u32(bytes, i) === EOCD_SIG) return i;
  }
  throw new ZipError('No zip end-of-directory record — the file is not a zip, or is truncated.');
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && u32(bytes, 0) === LOCAL_SIG;
}

export function readZip(bytes: Uint8Array): ZipEntryRead[] {
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  const directoryOffset = u32(bytes, eocd + 16);

  if (directoryOffset === ZIP64_SENTINEL || count === 0xffff) {
    throw new ZipError('This is a zip64 archive, which this reader does not handle. Unpack it on a desktop first.');
  }

  const entries: ZipEntryRead[] = [];
  let at = directoryOffset;

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CENTRAL_SIG) {
      throw new ZipError(`Zip directory ends unexpectedly at entry ${i + 1} of ${count}.`);
    }

    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const expectedCrc = u32(bytes, at + 16);
    const compressedSize = u32(bytes, at + 20);
    const uncompressedSize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    const name = ascii(bytes, at + 46, nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    // Bit 0 marks an encrypted entry. Its bytes decompress to noise.
    if (flags & 0x01) throw new ZipError(`"${name}" is encrypted and cannot be read.`);
    // A directory has no content of its own.
    if (name.endsWith('/')) continue;

    if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== LOCAL_SIG) {
      throw new ZipError(`"${name}" points at a local header that is not there.`);
    }
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    if (dataAt + compressedSize > bytes.length) {
      throw new ZipError(`"${name}" runs past the end of the file.`);
    }
    const compressed = bytes.subarray(dataAt, dataAt + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      try {
        data = inflateRaw(compressed);
      } catch (e) {
        throw new ZipError(`"${name}" could not be decompressed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      throw new ZipError(`"${name}" uses compression method ${method}, which this reader does not handle.`);
    }

    // The CRC is in the archive precisely so a silently corrupted entry is not
    // handed on as though it were sound.
    if (expectedCrc !== 0 && (crc32(data) >>> 0) !== (expectedCrc >>> 0)) {
      throw new ZipError(`"${name}" failed its checksum — the archive is damaged.`);
    }

    entries.push({ name, bytes: data, compressedSize, uncompressedSize, method });
  }

  return entries;
}

/**
 * The entry most likely to be the configuration.
 *
 * A vendor archive usually carries one substantial data file among a handful of
 * small ones — icons, a manifest, a licence. Biggest-wins is a crude rule, so
 * anything obviously not data is excluded first rather than relying on size to
 * settle it.
 */
const NOT_DATA = /\.(png|jpe?g|gif|bmp|ico|dll|exe|pdf|ttf|otf)$/i;

export function likelyConfigEntry(entries: ZipEntryRead[]): ZipEntryRead | undefined {
  const candidates = entries.filter((e) => !NOT_DATA.test(e.name));
  if (!candidates.length) return undefined;
  return candidates.reduce((best, e) => (e.bytes.length > best.bytes.length ? e : best));
}
