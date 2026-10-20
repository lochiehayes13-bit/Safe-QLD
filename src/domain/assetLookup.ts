import { normalise, readScannedValue, type TagRejection } from './assetTag';

/**
 * Finding an asset from the one identifier a technician has in hand.
 *
 * The same asset can be asked for in several forms. A printed label's barcode
 * carries the tag without its hyphens (SQDET00018473K) while the register
 * holds it with them; a pre-tag asset code is still on older paperwork; the
 * office's own asset number ("Asset #", "Tag No.") is hand-written on the
 * equipment and typed any old way; and the serial is on the maker's plate.
 * Each is matched whole, and again with its separators stripped.
 *
 * Kept free of the database so the decisions can be tested on their own.
 */

/** Why a value that looked like one of our labels matched nothing. */
export type LookupProblem = 'misread' | 'newer-label';

export interface IdentifierKeys {
  /** What was read or typed, trimmed. Shown back on a miss. */
  read: string;
  /** Upper-case values to compare whole against a code, an office number or a serial. */
  exact: string[];
  /** Letters and digits only, for a value typed or scanned without its separators. */
  compact: string;
  /** Set when the value is one of our labels that could not be read as one. */
  problem?: LookupProblem;
}

/*
 * A tag-shaped value that failed its check is a misread, and the only safe
 * answer is to read the label again. One that checks out but names a type or
 * format this build does not know came from a newer build.
 */
const MISREAD: ReadonlySet<TagRejection> = new Set<TagRejection>(['check-failed', 'malformed-serial', 'zero-serial']);
const NEWER: ReadonlySet<TagRejection> = new Set<TagRejection>(['future-format', 'unknown-type-code']);

export function identifierKeys(raw: string): IdentifierKeys {
  const read = raw.trim();
  if (!read) return { read, exact: [], compact: '' };

  const reading = readScannedValue(read);
  const fromPayload = reading.kind !== 'asset-code' && reading.fromPayload;
  const exact = new Set<string>();
  let compact = normalise(read);
  let problem: LookupProblem | undefined;

  if (reading.kind === 'tag') {
    // The register holds the printed form; anything tagged before the
    // scheme may still hold the pre-tag code for the same serial.
    exact.add(reading.tag.tag);
    if (reading.tag.assetCode) exact.add(reading.tag.assetCode);
    compact = reading.tag.compact;
  } else if (reading.kind === 'asset-code') {
    exact.add(reading.code.assetCode);
    // Upgraded in place keeps the serial, so the tag it became is the same asset.
    if (reading.code.proposedTag) exact.add(reading.code.proposedTag);
  } else {
    const reason = reading.rejection.reason;
    if (NEWER.has(reason)) problem = 'newer-label';
    else if (MISREAD.has(reason)) problem = 'misread';
    if (fromPayload) compact = reading.rejection.normalised;
  }

  // The value as given, for an office number or a serial. A payload is ours
  // and means nothing to the office, so its wrapper is not compared.
  if (!fromPayload) exact.add(read.toUpperCase());

  return { read, exact: [...exact], compact, problem };
}

/**
 * Characters the register query strips before comparing with `compact`.
 *
 * Not every non-alphanumeric: each one is a REPLACE on every row searched,
 * and these are the ones seen on printed tags and hand-written numbers.
 */
export const SEPARATORS = ['-', ' ', '/'] as const;

/** The office's asset number on an asset, under either key it is filed as. */
export function officeNumber(attributes: Readonly<Record<string, string | number | boolean>>): string | undefined {
  for (const key of ['assetNumber', 'tag']) {
    const v = attributes[key];
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

/** How an asset matched an identifier, best first. */
export type AssetMatch = 'code' | 'office-number' | 'serial';

const MATCH_RANK: Record<AssetMatch, number> = { code: 0, 'office-number': 1, serial: 2 };

/**
 * The matches of the best kind only.
 *
 * Our own tag is unique to one asset; an office number is unique within a
 * site at best; a serial is whatever the maker printed. A scan that hits a
 * tag should open that asset even if the same characters are another
 * asset's serial.
 */
export function bestMatches<A extends { match: AssetMatch }>(hits: readonly A[]): A[] {
  if (!hits.length) return [];
  const best = Math.min(...hits.map((h) => MATCH_RANK[h.match]));
  return hits.filter((h) => MATCH_RANK[h.match] === best);
}

export type ScanResult<A, P> =
  | { kind: 'asset'; asset: A }
  | { kind: 'assets'; assets: A[]; read: string }
  | { kind: 'part'; part: P }
  | { kind: 'none'; read: string; problem?: LookupProblem };

export interface ScanSources<A extends { match: AssetMatch }, P extends { partNumber: string }> {
  /** Assets whose code, office number or serial is one of the keys. */
  byIdentifier(keys: IdentifierKeys): Promise<A[]>;
  /** Assets whose serial contains what was read. */
  bySerialContaining(read: string): Promise<A[]>;
  /** Catalogue parts whose number contains what was read. */
  parts(read: string): Promise<P[]>;
}

/**
 * What a scanned or typed value opens.
 *
 * In order: an asset by tag, code, office number or serial; an asset whose
 * serial contains the value, when exactly one does; a catalogue part whose
 * number is the value, when exactly one is. Several assets on the best match
 * are returned as a list, since an office number repeats across sites.
 */
export async function resolveScan<A extends { match: AssetMatch }, P extends { partNumber: string }>(
  raw: string,
  sources: ScanSources<A, P>,
): Promise<ScanResult<A, P> | null> {
  const keys = identifierKeys(raw);
  if (!keys.read) return null;

  const hits = bestMatches(await sources.byIdentifier(keys));
  if (hits.length === 1) return { kind: 'asset', asset: hits[0]! };
  if (hits.length > 1) return { kind: 'assets', assets: hits, read: keys.read };

  // A maker's barcode often carries the serial with something either side.
  const loose = await sources.bySerialContaining(keys.read);
  if (loose.length === 1) return { kind: 'asset', asset: loose[0]! };

  const parts = (await sources.parts(keys.read)).filter((p) => normalise(p.partNumber) === keys.compact);
  if (parts.length === 1) return { kind: 'part', part: parts[0]! };

  return { kind: 'none', read: keys.read, problem: keys.problem };
}
