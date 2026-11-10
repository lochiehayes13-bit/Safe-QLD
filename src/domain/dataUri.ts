/**
 * Reading and writing `data:` URIs.
 *
 * A browser has no file system this app can write to. `expo-file-system` says
 * so itself — its web half is a set of stub classes that warn and do nothing —
 * so a photograph taken in the browser build has nowhere on disk to be copied
 * to. What it has instead is the record it belongs to, and a `data:` URI is a
 * photograph that fits inside one: the bytes travel with the row rather than
 * being pointed at from it.
 *
 * That is the property worth having here. The whole reason `photoStore` exists
 * is that a path can outlive the file it names and a report then renders a gap
 * where evidence was. A `data:` URI cannot dangle. What it costs is size, which
 * is why the web half caps the picture it stores rather more tightly than the
 * phone does.
 *
 * Pure and free of both the browser and expo, so the parsing is tested directly
 * rather than through a canvas.
 */

export interface ParsedDataUri {
  /** The media type, lowercased, defaulting as the RFC says when none is given. */
  mimeType: string;
  /** The payload, still base64. Never decoded here — callers hand it straight to an upload. */
  base64: string;
}

/** True for anything shaped like a `data:` URI. Cheap enough to call on a render path. */
export function isDataUri(uri: string): boolean {
  return typeof uri === 'string' && uri.slice(0, 5).toLowerCase() === 'data:';
}

/**
 * Splits a `data:` URI into its media type and its base64 payload.
 *
 * Returns nothing for anything that is not one, and for the percent-encoded
 * form as well: that is a legal `data:` URI but not one this app ever produces,
 * and guessing at a decode would put corrupt bytes on a job rather than
 * reporting that the photograph could not be read.
 */
export function parseDataUri(uri: string): ParsedDataUri | undefined {
  if (!isDataUri(uri)) return undefined;
  const comma = uri.indexOf(',');
  if (comma < 0) return undefined;

  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (!payload) return undefined;

  const parts = header.split(';').map((p) => p.trim().toLowerCase());
  if (!parts.includes('base64')) return undefined;

  // RFC 2397: an absent media type means text/plain, but nothing here produces
  // one and a photograph that arrived without a type is not a photograph we can
  // name on an upload, so it is reported rather than assumed to be a JPEG.
  const mimeType = parts[0] && parts[0].includes('/') ? parts[0] : '';
  if (!mimeType) return undefined;

  return { mimeType, base64: payload };
}

/** The `data:` URI for a media type and its base64 payload. */
export function buildDataUri(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * How many bytes a base64 payload decodes to.
 *
 * Worked out rather than decoded: the answer is wanted for a size on a queue
 * row and for deciding whether a picture needs shrinking, and decoding a
 * megabyte of base64 to count it is a megabyte allocated for nothing.
 */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** The byte size of a whole `data:` URI's payload, or nothing when it is not one. */
export function dataUriByteSize(uri: string): number | undefined {
  const parsed = parseDataUri(uri);
  return parsed ? base64ByteLength(parsed.base64) : undefined;
}
