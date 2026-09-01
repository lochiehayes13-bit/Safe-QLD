import { ASSET_TYPES, type SystemKind } from '@/seed/assetTypes';

/**
 * The number on the sticker, and whether it can be trusted.
 *
 * There are 12,553 assets on the register and nothing on site carries an
 * identifier a person or a scanner can read. Two 4.5 kg ABE extinguishers
 * hanging in the same corridor are, physically, indistinguishable. So are
 * eleven photoelectric heads in a ward. The only thing that tells them apart is
 * what is written on them, which means the tag is not decoration: it is the
 * primary key of the whole service history, applied with adhesive.
 *
 * That is why a check character is not optional here. A tag with no check
 * behaves badly in exactly the situation it is needed. A technician on a ladder
 * reads SQ-DET-0001847, types SQ-DET-0001947, and the app finds a real asset —
 * a different head, three levels down — and files the test against it. Now two
 * records are wrong: one device has a test it never had, and another has a gap
 * nobody will notice until an audit. A mistyped tag must fail loudly at the
 * moment of entry or it does not fail at all.
 *
 * The scheme is ISO/IEC 7064 MOD 1271-36: a pure system, radix 36, modulus
 * 1271, producing TWO check characters over the alphabet 0-9 A-Z. The obvious
 * choice was MOD 37,36, which produces one character and is what most people
 * reach for. It was measured and rejected: over 4,000 sample tags it detected
 * 100% of single-character substitutions but let through 113 of 49,245 adjacent
 * transpositions (0.23%). Transposing two digits is the single most common way
 * a person mis-copies a number, so a scheme that misses one in four hundred of
 * them is not doing the job it was added for.
 *
 * MOD 1271-36 detects, provably rather than by luck:
 *   - every single-character substitution,
 *   - every adjacent transposition,
 *   - every jump transposition (abc -> cba),
 *   - every twin error (aa -> bb).
 * The proof is short. The check is linear with weights 36^k modulo 1271, and
 * 1271 = 31 x 41. A substitution changes the sum by (a-a')·36^k; a transposition
 * by 35·36^k·(a-b); a jump transposition by 1295·36^k·(a-b); a twin error by
 * 37·36^k·(a-b). None of 35, 37, 1295 or 36 shares a factor with 31 or 41, and
 * |a-a'| never reaches 1271, so no such difference can vanish modulo 1271. Two
 * check characters also drop the odds of a wholly garbled read being accepted
 * from 1 in 36 to 1 in 1271. The test file re-proves all of this by brute force
 * rather than taking the argument on trust.
 *
 * Everything here is pure. No database, no file system: the check character
 * logic has to be testable, and it is the part that must never be wrong.
 */

// ---------------------------------------------------------------------------
// Shape of a tag
// ---------------------------------------------------------------------------

/** Company prefix. Two characters, so a stray scan of someone else's label fails fast. */
export const TAG_PREFIX = 'SQ';

/**
 * Type codes are exactly three letters, always.
 *
 * Fixed width is the reason a tag survives losing its separators. A scanner
 * hands back SQDET00018473K with no hyphens, a technician types it with spaces,
 * a label printer eats one — and the string is still cut apart the same way,
 * because the field boundaries are counted rather than searched for.
 */
export const TYPE_CODE_LENGTH = 3;

/** Seven digits: 9,999,999 assets, against 12,553 today. Widening it later would invalidate every printed tag. */
export const SERIAL_DIGITS = 7;
export const MIN_SERIAL = 1;
export const MAX_SERIAL = 9_999_999;

/** Prefix + type + serial + two check characters. */
export const TAG_LENGTH = TAG_PREFIX.length + TYPE_CODE_LENGTH + SERIAL_DIGITS + 2;

/** The ISO 7064 radix-36 alphabet. Position is the character's value. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---------------------------------------------------------------------------
// Check characters — ISO/IEC 7064 MOD 1271-36
// ---------------------------------------------------------------------------

const MODULUS = 1271;
const RADIX = 36;

export interface CheckScheme {
  id: string;
  label: string;
  /** Where the algorithm is defined. */
  source: string;
  confidence: 'high' | 'medium' | 'low';
  /** How many characters it appends. */
  characters: number;
  /** Error classes it is proven to catch, stated so a reader need not infer them. */
  detects: string[];
  /** The chance a completely garbled read is accepted anyway. Stated, not hidden. */
  residualRisk: string;
}

export const CHECK_SCHEME: CheckScheme = {
  id: 'iso7064-mod-1271-36',
  label: 'ISO/IEC 7064 MOD 1271-36',
  source: 'ISO/IEC 7064:2003 Information technology — Security techniques — Check character systems, '
    + 'https://www.iso.org/standard/31531.html — implementation verified against the standard\'s own '
    + 'worked example, ISO79 -> 3W',
  confidence: 'high',
  characters: 2,
  detects: [
    'every single-character substitution',
    'every adjacent transposition',
    'every jump transposition (abc read as cba)',
    'every twin error (aa read as bb)',
  ],
  residualRisk: 'A read wrong in several places at once is accepted with probability 1 in 1271. '
    + 'The check character proves a tag is self-consistent; it does not prove the label is on the right device.',
};

/** Character value, or -1 for anything outside the radix-36 alphabet. */
const valueOf = (ch: string): number => ALPHABET.indexOf(ch);

/**
 * The two check characters for a tag body.
 *
 * Returns undefined for a body containing anything outside 0-9 A-Z rather than
 * skipping the offending character: a check computed over a silently altered
 * string validates a string nobody ever wrote.
 */
export function checkCharacters(body: string): string | undefined {
  let p = 0;
  for (const ch of body) {
    const v = valueOf(ch);
    if (v < 0) return undefined;
    p = ((p + v) * RADIX) % MODULUS;
  }
  p = (p * RADIX) % MODULUS;
  const value = (MODULUS + 1 - p) % MODULUS;
  const high = ALPHABET[Math.floor(value / RADIX)];
  const low = ALPHABET[value % RADIX];
  return high !== undefined && low !== undefined ? high + low : undefined;
}

/** Whether a complete string (body plus its two trailing check characters) agrees with itself. */
export function checkCharactersAgree(full: string): boolean {
  if (full.length < 3) return false;
  const expected = checkCharacters(full.slice(0, -2));
  return expected !== undefined && expected === full.slice(-2);
}

// ---------------------------------------------------------------------------
// Type codes
// ---------------------------------------------------------------------------

export type CodeOrigin =
  /** Taken unchanged from the asset type catalogue's own codePrefix. */
  | 'asset-type-catalogue'
  /** The catalogue's prefix is not three letters, so a three-letter code was assigned here. */
  | 'assigned-here';

export interface TypeCode {
  assetTypeId: string;
  code: string;
  label: string;
  system: SystemKind;
  origin: CodeOrigin;
  /**
   * False where the type is a place or a circuit rather than an object — you
   * cannot stick a label on Level 3, or on loop 2. Tags are still issued (the
   * register numbers them like anything else) but the label sheet leaves them
   * out by default, because 400 labels for rooms is 400 labels in the bin.
   */
  labelled: boolean;
  note?: string;
}

/**
 * Every asset type in the app, with the three letters its tags carry.
 *
 * Written out rather than derived from ASSET_TYPES.codePrefix, for two reasons.
 * Four of the catalogue prefixes are two letters (RM, LP, SP, FD) and cannot be
 * used as-is; deriving would mean a rule like "pad it out", and a rule that
 * invents letters will one day invent a code that collides with a real one and
 * point a tag at the wrong kind of equipment. And a printed tag must outlive
 * an edit to the seed file — if someone renames a prefix, the tags already
 * stuck to 12,553 assets do not change, so the mapping has to be a decision
 * recorded here rather than a side effect of another module.
 *
 * A type absent from this table has no code. It gets no tag, and says so.
 */
export const TYPE_CODES: TypeCode[] = [
  { assetTypeId: 'level', code: 'LVL', label: 'Level / floor', system: 'structure', origin: 'asset-type-catalogue', labelled: false, note: 'A place, not a thing. Numbered for the register only.' },
  { assetTypeId: 'room', code: 'ROM', label: 'Room / area', system: 'structure', origin: 'assigned-here', labelled: false, note: 'Catalogue prefix RM is two letters; ROM assigned for a fixed-width tag.' },
  { assetTypeId: 'fip', code: 'FIP', label: 'Fire indicator panel', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'loop', code: 'LOP', label: 'Detection loop', system: 'detection', origin: 'assigned-here', labelled: false, note: 'Catalogue prefix LP is two letters. A loop is a circuit, so nothing to stick a label to.' },
  { assetTypeId: 'detector', code: 'DET', label: 'Detector', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'smoke-alarm', code: 'ALM', label: 'Smoke / heat alarm (standalone)', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'mcp', code: 'MCP', label: 'Manual call point', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'module', code: 'MOD', label: 'Interface module', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'fip-battery', code: 'BAT', label: 'Standby battery', system: 'detection', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'ews-panel', code: 'EWS', label: 'EWIS / OWS panel', system: 'ews', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'speaker', code: 'SPK', label: 'Speaker', system: 'ews', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'strobe', code: 'VAD', label: 'Visual alarm device', system: 'ews', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'wip', code: 'WIP', label: 'Warden intercom phone', system: 'ews', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'asd', code: 'ASD', label: 'Aspirating detector', system: 'aspirating', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'sampling-point', code: 'SMP', label: 'Sampling point', system: 'aspirating', origin: 'assigned-here', labelled: true, note: 'Catalogue prefix SP is two letters, and SPK/SPR are taken; SMP assigned.' },
  { assetTypeId: 'sprinkler-head', code: 'SPR', label: 'Sprinkler head', system: 'sprinkler', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'sprinkler-valve', code: 'SVS', label: 'Sprinkler valve set', system: 'sprinkler', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'flow-switch', code: 'FSW', label: 'Flow switch', system: 'sprinkler', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'hydrant', code: 'HYD', label: 'Fire hydrant', system: 'hydrant', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'booster', code: 'BST', label: 'Booster assembly', system: 'hydrant', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'hose-reel', code: 'FHR', label: 'Fire hose reel', system: 'hose-reel', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'extinguisher', code: 'EXT', label: 'Fire extinguisher', system: 'extinguisher', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'fire-blanket', code: 'FBL', label: 'Fire blanket', system: 'extinguisher', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'emergency-light', code: 'EEL', label: 'Emergency light', system: 'emergency-lighting', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'fire-pump', code: 'PMP', label: 'Fire pump', system: 'pump', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'pump-controller', code: 'PCT', label: 'Pump controller', system: 'pump', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'water-tank', code: 'TNK', label: 'Water storage tank', system: 'pump', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'gas-cylinder', code: 'CYL', label: 'Suppression cylinder', system: 'gas', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'penetration', code: 'PEN', label: 'Fire-rated penetration', system: 'passive', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'fire-damper', code: 'DMP', label: 'Fire damper', system: 'passive', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'fire-door', code: 'FDR', label: 'Fire door', system: 'door', origin: 'assigned-here', labelled: true, note: 'Catalogue prefix FD is two letters; FDR assigned.' },
  { assetTypeId: 'switchboard', code: 'SWB', label: 'Switchboard', system: 'electrical', origin: 'asset-type-catalogue', labelled: true },
  { assetTypeId: 'rcd', code: 'RCD', label: 'RCD', system: 'electrical', origin: 'asset-type-catalogue', labelled: true },
];

const CODE_BY_TYPE = new Map(TYPE_CODES.map((c) => [c.assetTypeId, c]));
const TYPE_BY_CODE = new Map(TYPE_CODES.map((c) => [c.code, c]));

/** The three letters for an asset type, or undefined when the type has no code. */
export function typeCodeFor(assetTypeId: string): string | undefined {
  return CODE_BY_TYPE.get(assetTypeId)?.code;
}

export function typeCodeEntry(assetTypeId: string): TypeCode | undefined {
  return CODE_BY_TYPE.get(assetTypeId);
}

/** The asset type a three-letter code belongs to, or undefined for a code we do not issue. */
export function assetTypeForCode(code: string): TypeCode | undefined {
  return TYPE_BY_CODE.get(code.trim().toUpperCase());
}

/**
 * Everything wrong with the code table.
 *
 * Run in the test suite rather than at start-up, because the failure it catches
 * is a developer adding an asset type and forgetting its code — which should
 * stop a build, not surprise a technician in a riser cupboard. Two types
 * sharing a code is worse than a missing one: tags would be issued that decode
 * to the wrong kind of equipment.
 */
export function typeCodeTableIssues(): string[] {
  const issues: string[] = [];
  const seen = new Map<string, string>();

  for (const entry of TYPE_CODES) {
    if (!/^[A-Z]{3}$/.test(entry.code)) {
      issues.push(`${entry.assetTypeId} has code "${entry.code}", which is not three capital letters.`);
    }
    const already = seen.get(entry.code);
    if (already) issues.push(`Code ${entry.code} is used by both ${already} and ${entry.assetTypeId}.`);
    seen.set(entry.code, entry.assetTypeId);

    const def = ASSET_TYPES.find((t) => t.id === entry.assetTypeId);
    if (!def) issues.push(`${entry.assetTypeId} has a tag code but is not an asset type any more.`);
    else if (def.system !== entry.system) {
      issues.push(`${entry.assetTypeId} is a ${def.system} type in the catalogue but ${entry.system} here.`);
    }
  }

  for (const def of ASSET_TYPES) {
    if (!CODE_BY_TYPE.has(def.id)) {
      issues.push(`Asset type ${def.id} (${def.label}) has no tag code, so its assets cannot be tagged.`);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Builds a tag: SQ-DET-0001847-3K.
 *
 * Returns undefined for a type with no code or a serial outside the range,
 * rather than a tag with a plausible-looking guess in it. A tag that cannot be
 * built is a thing to report on screen, not a thing to fabricate.
 */
export function formatTag(assetTypeId: string, serial: number): string | undefined {
  const code = typeCodeFor(assetTypeId);
  if (!code) return undefined;
  if (!Number.isInteger(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) return undefined;

  const body = `${TAG_PREFIX}${code}${String(serial).padStart(SERIAL_DIGITS, '0')}`;
  const check = checkCharacters(body);
  if (!check) return undefined;
  return `${TAG_PREFIX}-${code}-${body.slice(TAG_PREFIX.length + TYPE_CODE_LENGTH)}-${check}`;
}

/** The separator-free form: what the barcode carries and what a scanner hands back. */
export function compactTag(tag: string): string {
  return normalise(tag);
}

/** Puts the hyphens back into a compact tag. Assumes the fixed field widths. */
function hyphenate(compact: string): string {
  const p = TAG_PREFIX.length;
  const c = p + TYPE_CODE_LENGTH;
  const s = c + SERIAL_DIGITS;
  return `${compact.slice(0, p)}-${compact.slice(p, c)}-${compact.slice(c, s)}-${compact.slice(s)}`;
}

/**
 * Strips the decoration a tag picks up between the label and the app.
 *
 * Lower case, spaces, extra or missing hyphens, a leading tab from a paste —
 * all removed. What is deliberately NOT done is folding confusable characters:
 * no O to 0, no I to 1, no S to 5. That fold looks helpful and destroys the
 * only defence there is. The check characters can only reject a misread if the
 * misread reaches them intact; "correcting" O to 0 before the check runs turns
 * a detected error into an accepted one, silently, and the tag then points at
 * a real and different asset.
 */
export function normalise(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type TagRejection =
  | 'empty'
  | 'wrong-length'
  | 'wrong-prefix'
  | 'malformed-serial'
  | 'check-failed'
  | 'missing-check'
  | 'unknown-type-code'
  | 'zero-serial';

export interface ParsedTag {
  ok: true;
  /** Canonical printed form, with separators. */
  tag: string;
  /** Separator-free form, which is what the barcode encodes. */
  compact: string;
  typeCode: string;
  assetTypeId: string;
  typeLabel: string;
  system: SystemKind;
  serial: number;
  check: string;
  /**
   * The pre-tag asset code this tag corresponds to (SQ-DET-0001847), which is
   * still what the asset register holds for anything tagged before this scheme.
   * Undefined if the type has since left the asset type catalogue.
   */
  assetCode: string | undefined;
}

export interface RejectedTag {
  ok: false;
  reason: TagRejection;
  /** Plain English, written to be shown to a technician standing at the device. */
  message: string;
  /** What was made of the input before giving up. */
  normalised: string;
}

/**
 * Reads a tag, strictly.
 *
 * Deliberately absent: the expected check characters. It would be easy to
 * return them so a screen could say "did you mean ...-3K?", and it would undo
 * the entire scheme. A technician offered a correction takes it, and the
 * correction assumes the body is right and the check is wrong — which is
 * backwards. The check characters are almost never the part that was misread;
 * the seven digits are. The only safe instruction is to go and read the label
 * again.
 */
export function parseTag(input: string): ParsedTag | RejectedTag {
  const s = normalise(input);
  if (!s) {
    return { ok: false, reason: 'empty', message: 'Nothing to read.', normalised: s };
  }

  if (s.length !== TAG_LENGTH) {
    // A pre-tag asset code is a specific, common and recoverable case, so it is
    // named rather than lumped in with rubbish.
    const legacy = parseAssetCode(input);
    if (legacy) {
      return {
        ok: false,
        reason: 'missing-check',
        message: `${legacy.assetCode} is an asset code from before tagging, so it carries no check characters `
          + 'and cannot be verified. Assign it a tag and print a new label.',
        normalised: s,
      };
    }
    return {
      ok: false,
      reason: 'wrong-length',
      message: `A Safe QLD tag is ${TAG_LENGTH} characters; this one has ${s.length}. `
        + 'Read the whole label, including the two characters after the last hyphen.',
      normalised: s,
    };
  }

  if (!s.startsWith(TAG_PREFIX)) {
    return {
      ok: false,
      reason: 'wrong-prefix',
      message: `This is not a Safe QLD tag — it does not start with ${TAG_PREFIX}. `
        + 'It may be the manufacturer\'s own label or another contractor\'s asset number.',
      normalised: s,
    };
  }

  const typeCode = s.slice(TAG_PREFIX.length, TAG_PREFIX.length + TYPE_CODE_LENGTH);
  const serialText = s.slice(TAG_PREFIX.length + TYPE_CODE_LENGTH, TAG_PREFIX.length + TYPE_CODE_LENGTH + SERIAL_DIGITS);
  const check = s.slice(TAG_PREFIX.length + TYPE_CODE_LENGTH + SERIAL_DIGITS);

  if (!/^[A-Z]{3}$/.test(typeCode) || !/^[0-9]{7}$/.test(serialText)) {
    return {
      ok: false,
      reason: 'malformed-serial',
      message: 'The middle of this tag is not three letters followed by seven digits. '
        + 'A digit has probably been read as a letter, or the other way round.',
      normalised: s,
    };
  }

  // The check runs before the type code is looked up, and the order matters. A
  // misread that lands on a type code we do not issue should be reported as a
  // misread, not as "we do not service that kind of equipment".
  if (!checkCharactersAgree(s)) {
    return {
      ok: false,
      reason: 'check-failed',
      message: 'This tag does not check out. At least one character has been read or typed wrongly, '
        + 'so it may belong to a completely different asset. Read the label again rather than correcting it.',
      normalised: s,
    };
  }

  const entry = TYPE_BY_CODE.get(typeCode);
  if (!entry) {
    return {
      ok: false,
      reason: 'unknown-type-code',
      message: `${typeCode} is not an equipment code this app issues. The tag is internally consistent, `
        + 'so it was probably printed by a newer version of the app than this one.',
      normalised: s,
    };
  }

  const serial = Number(serialText);
  if (serial < MIN_SERIAL) {
    return {
      ok: false,
      reason: 'zero-serial',
      message: 'Serial 0 is never issued, so this tag was not printed by this app.',
      normalised: s,
    };
  }

  return {
    ok: true,
    tag: hyphenate(s),
    compact: s,
    typeCode,
    assetTypeId: entry.assetTypeId,
    typeLabel: entry.label,
    system: entry.system,
    serial,
    check,
    assetCode: assetCodeFor(entry.assetTypeId, serial),
  };
}

/** Convenience for the common "is this string a tag at all" question. */
export function isValidTag(input: string): boolean {
  return parseTag(input).ok;
}

// ---------------------------------------------------------------------------
// Pre-tag asset codes
// ---------------------------------------------------------------------------

/**
 * The codes the register already holds.
 *
 * Assets created before tagging carry SQ-DET-0001847: the same shape without
 * check characters, and with the asset type catalogue's own prefix, which for
 * four types is two letters rather than three. Those codes are on paper, in
 * old reports and in the customer's own spreadsheets, so they are read, kept
 * and upgraded in place — the serial is preserved when a tag is issued, so a
 * 2019 report referring to SQ-DET-0001847 still refers to the same head.
 */
const LEGACY_PREFIXES: { prefix: string; assetTypeId: string }[] = ASSET_TYPES
  .map((t) => ({ prefix: t.codePrefix.toUpperCase(), assetTypeId: t.id }))
  // Longest first so SPR is tried before SP; the seven-digit rule makes it
  // unambiguous anyway, but the order costs nothing and removes the question.
  .sort((a, b) => b.prefix.length - a.prefix.length);

export interface ParsedAssetCode {
  assetCode: string;
  assetTypeId: string;
  serial: number;
  /** The tag this code becomes when one is issued. Undefined if the type has no code. */
  proposedTag?: string;
}

/** The pre-tag asset code for a type and serial, as nextAssetCode() in the repo builds it. */
export function assetCodeFor(assetTypeId: string, serial: number): string | undefined {
  const def = ASSET_TYPES.find((t) => t.id === assetTypeId);
  if (!def) return undefined;
  if (!Number.isInteger(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) return undefined;
  return `SQ-${def.codePrefix}-${String(serial).padStart(SERIAL_DIGITS, '0')}`;
}

/** Reads SQ-DET-0001847. Returns undefined for anything else, including a full tag. */
export function parseAssetCode(input: string): ParsedAssetCode | undefined {
  const s = normalise(input);
  if (!s.startsWith(TAG_PREFIX)) return undefined;
  const rest = s.slice(TAG_PREFIX.length);

  for (const { prefix, assetTypeId } of LEGACY_PREFIXES) {
    if (!rest.startsWith(prefix)) continue;
    const digits = rest.slice(prefix.length);
    // Exactly seven digits and nothing after: this is what stops a full tag,
    // which has two more characters, being read as a code plus noise.
    if (!/^[0-9]{7}$/.test(digits)) continue;
    const serial = Number(digits);
    if (serial < MIN_SERIAL) continue;
    return {
      assetCode: `SQ-${prefix}-${digits}`,
      assetTypeId,
      serial,
      proposedTag: formatTag(assetTypeId, serial),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// What a code carries
// ---------------------------------------------------------------------------

/**
 * The payload a QR code on a label would carry.
 *
 * Emphatically not a URL. A URL on 12,553 labels is a promise that a server
 * answers for the next twenty years, made by a company that changes its web
 * host every few years, to a phone standing in a basement pump room with no
 * signal. It also opens a browser rather than this app, which is the wrong
 * thing at the moment a technician wants the asset's history.
 *
 * So the payload is self-describing and resolves against the local database:
 * a scheme, a format version, and the tag. The version is there because the
 * label outlives the app — a tag printed today must still be readable by an
 * app that has moved on, and the only way to do that is to say which format it
 * is rather than guess from its shape.
 */
export const PAYLOAD_SCHEME = 'SQFP';
export const PAYLOAD_VERSION = 1;

export function tagPayload(tag: string): string | undefined {
  const parsed = parseTag(tag);
  return parsed.ok ? `${PAYLOAD_SCHEME}:${PAYLOAD_VERSION}:${parsed.tag}` : undefined;
}

/** Whether a scanned string is one of our payloads, without saying whether the tag inside is any good. */
export function isTagPayload(value: string): boolean {
  return /^\s*SQFP:\d+:/i.test(value);
}

export type ScanReading =
  | { kind: 'tag'; tag: ParsedTag; fromPayload: boolean }
  | { kind: 'asset-code'; code: ParsedAssetCode }
  | { kind: 'unrecognised'; rejection: RejectedTag; fromPayload: boolean };

/**
 * Reads whatever the camera or the keyboard produced.
 *
 * Takes our payload, a bare tag, or a pre-tag asset code, and says which it
 * got. A payload whose version is ahead of this build is rejected rather than
 * unwrapped optimistically: a future format might put something else after the
 * second colon, and reading it as a tag would be a guess.
 */
export function readScannedValue(value: string): ScanReading {
  const trimmed = value.trim();
  const payload = /^SQFP:(\d+):(.*)$/i.exec(trimmed);
  const fromPayload = payload !== null;

  if (payload) {
    const version = Number(payload[1]);
    const body = payload[2] ?? '';
    if (version !== PAYLOAD_VERSION) {
      return {
        kind: 'unrecognised',
        fromPayload: true,
        rejection: {
          ok: false,
          reason: 'wrong-length',
          message: `This label uses tag format ${version}; this app understands format ${PAYLOAD_VERSION}. `
            + 'Update the app rather than typing the number in by hand.',
          normalised: normalise(body),
        },
      };
    }
    const parsed = parseTag(body);
    return parsed.ok
      ? { kind: 'tag', tag: parsed, fromPayload: true }
      : { kind: 'unrecognised', rejection: parsed, fromPayload: true };
  }

  const parsed = parseTag(trimmed);
  if (parsed.ok) return { kind: 'tag', tag: parsed, fromPayload };

  const code = parseAssetCode(trimmed);
  if (code) return { kind: 'asset-code', code };

  return { kind: 'unrecognised', rejection: parsed, fromPayload };
}

// ---------------------------------------------------------------------------
// A site's worth of assets
// ---------------------------------------------------------------------------

/**
 * The little of an asset this module needs.
 *
 * Structural rather than imported from the repo on purpose: anything that
 * reaches into @/db drags expo-sqlite in with it and cannot be loaded by a
 * test, and the decisions here are exactly the ones worth testing.
 */
export interface TaggableAsset {
  id: string;
  assetTypeId: string;
  code?: string | null;
  name?: string;
}

export interface TaggedRow {
  asset: TaggableAsset;
  tag: ParsedTag;
}

export interface UpgradeableRow {
  asset: TaggableAsset;
  code: ParsedAssetCode;
  /** The tag it becomes, keeping its existing number. Undefined when the type has no code. */
  proposedTag?: string;
}

export interface UntaggedRow {
  asset: TaggableAsset;
  /** Why it cannot simply be tagged, where that is already known. */
  blocker?: string;
}

export interface InvalidRow {
  asset: TaggableAsset;
  code: string;
  rejection: RejectedTag;
}

export interface DuplicateGroup {
  tag: string;
  assets: TaggableAsset[];
}

export interface TagAudit {
  /** Carrying a tag that validates. */
  tagged: TaggedRow[];
  /** Carrying a pre-tag asset code: valid, but unverifiable until re-labelled. */
  upgradeable: UpgradeableRow[];
  /** Carrying nothing at all. */
  untagged: UntaggedRow[];
  /** Carrying something that does not validate. Needs eyes on the physical label. */
  invalid: InvalidRow[];
  /**
   * The same tag on more than one asset. The one failure the check characters
   * cannot catch, because each tag is individually perfect — and the worst of
   * them, since a scan is then ambiguous with no way to tell.
   */
  duplicates: DuplicateGroup[];
}

/** Sorts a site's assets into what can be trusted, what can be upgraded, and what needs looking at. */
export function auditTags(assets: TaggableAsset[]): TagAudit {
  const audit: TagAudit = { tagged: [], upgradeable: [], untagged: [], invalid: [], duplicates: [] };
  const byTag = new Map<string, TaggableAsset[]>();

  for (const asset of assets) {
    const raw = (asset.code ?? '').trim();
    if (!raw) {
      audit.untagged.push({
        asset,
        blocker: typeCodeFor(asset.assetTypeId)
          ? undefined
          : `Asset type "${asset.assetTypeId}" has no tag code, so no tag can be issued for it.`,
      });
      continue;
    }

    const parsed = parseTag(raw);
    if (parsed.ok) {
      audit.tagged.push({ asset, tag: parsed });
      const group = byTag.get(parsed.tag) ?? [];
      group.push(asset);
      byTag.set(parsed.tag, group);
      continue;
    }

    const code = parseAssetCode(raw);
    if (code) {
      audit.upgradeable.push({ asset, code, proposedTag: code.proposedTag });
      continue;
    }

    audit.invalid.push({ asset, code: raw, rejection: parsed });
  }

  for (const [tag, group] of byTag) {
    if (group.length > 1) audit.duplicates.push({ tag, assets: group });
  }
  audit.duplicates.sort((a, b) => a.tag.localeCompare(b.tag));

  return audit;
}

// ---------------------------------------------------------------------------
// Issuing tags in bulk
// ---------------------------------------------------------------------------

export interface TagAssignment {
  assetId: string;
  assetTypeId: string;
  tag: string;
  serial: number;
  /** True when the number was already the asset's, and only the check characters are new. */
  keptExistingNumber: boolean;
}

export interface SkippedAssignment {
  assetId: string;
  reason: string;
}

export interface AssignmentPlan {
  assignments: TagAssignment[];
  skipped: SkippedAssignment[];
  /** Where each type's numbering has got to, so a second batch continues rather than repeats. */
  nextSerials: Record<string, number>;
}

/**
 * Works out which asset gets which tag, before anything is written.
 *
 * A plan rather than a loop of updates, because the interesting decisions are
 * all refusals and they need to be visible before 400 labels are printed:
 *
 *  - An asset already carrying a valid tag is left alone. Re-tagging it would
 *    orphan the sticker physically on the device.
 *  - An asset carrying a pre-tag code keeps its number and gains only the check
 *    characters. Issuing it a fresh serial would break every report and
 *    spreadsheet that already cites the old one.
 *  - An asset carrying something that does not validate is SKIPPED, not
 *    renumbered. Something is on that device and nobody knows what; quietly
 *    issuing a new number leaves a physical label in the field pointing at a
 *    number the register no longer uses, which is worse than the original
 *    problem. A person has to go and look.
 *  - A type with no starting serial supplied is skipped and says so, rather
 *    than starting at 1 and colliding with a decade of existing numbers.
 *
 * `nextSerials` comes from the database (the repo's nextAssetCode already
 * derives the high-water mark per prefix). It is passed in so this function
 * stays pure.
 */
export function planTagAssignments(
  assets: TaggableAsset[],
  nextSerials: Readonly<Record<string, number>>,
): AssignmentPlan {
  const plan: AssignmentPlan = { assignments: [], skipped: [], nextSerials: { ...nextSerials } };
  // Tags already spoken for in this batch — either kept from a legacy code or
  // freshly allocated — so two assets cannot leave here with the same tag.
  const used = new Set<string>();

  for (const asset of assets) {
    const existing = (asset.code ?? '').trim();
    const typeCode = typeCodeFor(asset.assetTypeId);

    if (!typeCode) {
      plan.skipped.push({
        assetId: asset.id,
        reason: `Asset type "${asset.assetTypeId}" has no tag code. Add one to the code table before tagging these.`,
      });
      continue;
    }

    if (existing) {
      const parsed = parseTag(existing);
      if (parsed.ok) {
        used.add(parsed.tag);
        plan.skipped.push({ assetId: asset.id, reason: `Already tagged ${parsed.tag}.` });
        continue;
      }

      const legacy = parseAssetCode(existing);
      if (legacy) {
        if (legacy.assetTypeId !== asset.assetTypeId) {
          plan.skipped.push({
            assetId: asset.id,
            reason: `Its code ${legacy.assetCode} belongs to a different kind of equipment than the asset is `
              + 'recorded as. Fix the record or the label before tagging.',
          });
          continue;
        }
        const upgraded = legacy.proposedTag;
        if (!upgraded) {
          plan.skipped.push({ assetId: asset.id, reason: `Could not build a tag from ${legacy.assetCode}.` });
          continue;
        }
        if (used.has(upgraded)) {
          plan.skipped.push({
            assetId: asset.id,
            reason: `Another asset in this batch already carries ${legacy.assetCode}. Two assets cannot share a number.`,
          });
          continue;
        }
        used.add(upgraded);
        plan.assignments.push({
          assetId: asset.id,
          assetTypeId: asset.assetTypeId,
          tag: upgraded,
          serial: legacy.serial,
          keptExistingNumber: true,
        });
        continue;
      }

      plan.skipped.push({
        assetId: asset.id,
        reason: `Its code "${existing}" is neither a tag nor an asset code (${parsed.message}) `
          + 'Check the physical label before replacing it.',
      });
      continue;
    }

    const next = plan.nextSerials[asset.assetTypeId];
    if (next === undefined) {
      plan.skipped.push({
        assetId: asset.id,
        reason: `No starting number was supplied for ${asset.assetTypeId}, so numbering it now could reuse `
          + 'a serial already issued.',
      });
      continue;
    }

    let serial = next;
    let tag = formatTag(asset.assetTypeId, serial);
    // Step over anything this batch has already claimed.
    while (tag && used.has(tag) && serial <= MAX_SERIAL) {
      serial += 1;
      tag = formatTag(asset.assetTypeId, serial);
    }

    if (!tag) {
      plan.skipped.push({
        assetId: asset.id,
        reason: `Numbering for ${asset.assetTypeId} has reached ${MAX_SERIAL}, which is as far as a `
          + `${SERIAL_DIGITS}-digit serial goes.`,
      });
      continue;
    }

    used.add(tag);
    plan.nextSerials[asset.assetTypeId] = serial + 1;
    plan.assignments.push({
      assetId: asset.id,
      assetTypeId: asset.assetTypeId,
      tag,
      serial,
      keptExistingNumber: false,
    });
  }

  return plan;
}

/**
 * The starting serials a plan needs, read off codes already in hand.
 *
 * A fallback for when the database high-water mark is not available: it can
 * only see the assets it is given, so it is one step above the highest of
 * those. Where the caller can ask the database instead, it should — this
 * cannot know about an asset at another site with a higher number.
 */
export function serialsInUse(assets: TaggableAsset[]): Record<string, number> {
  const highest: Record<string, number> = {};
  for (const asset of assets) {
    const raw = (asset.code ?? '').trim();
    if (!raw) continue;
    const parsed = parseTag(raw);
    const serial = parsed.ok ? parsed.serial : parseAssetCode(raw)?.serial;
    if (serial === undefined) continue;
    const current = highest[asset.assetTypeId];
    if (current === undefined || serial > current) highest[asset.assetTypeId] = serial;
  }

  const next: Record<string, number> = {};
  for (const [assetTypeId, serial] of Object.entries(highest)) next[assetTypeId] = serial + 1;
  return next;
}
