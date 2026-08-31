import type { ParsedConfig, ParsedPanel, Zone } from '@/domain/types';
import { ZipError, isZip, readZip } from './zipRead';

/**
 * The site index inside an .NCF archive.
 *
 * An .NCF is a zip holding three entries: `SITE`, a `.pcf` panel file, and an
 * empty `.txt`. The `.pcf` holds the devices and is not readable — no
 * signature, no delimiters, no text — so this reads the `SITE` entry, which is
 * a small fixed-layout table carrying the site name and the zone names.
 *
 * That is a deliberately narrow claim. What comes out is a site and its zones
 * and nothing else: no devices, no loops, no cause and effect. A zone list is
 * still the backbone of a service sheet, so it is worth having, but the import
 * says plainly what it did not bring with it.
 *
 * The panel brand is not recorded anywhere in the archive and has not been
 * confirmed, so it is imported as unspecified rather than guessed at from the
 * file extension.
 *
 * Everything below is derived from a single sample, which is thin evidence for
 * a binary layout. So rather than trusting the layout, it is checked: each
 * record declares its label length, and that length has to match a printable
 * run exactly; each record carries a constant marker; and where a label reads
 * "ZONE 4" the record's own id has to agree. A file that does not satisfy all
 * three is refused. The failure mode being designed against is not an
 * exception — it is a plausible-looking zone list that is wrong.
 */

const PARSER_ID = 'ncf-site@1';

/** Every slot in the SITE table is this long, header slots included. */
const SLOT = 112;
/** Data records start here; the two slots before are the file and site headers. */
const FIRST_RECORD = 2 * SLOT;
/** Offsets within a data record. */
const REC_KIND = 8;
const REC_ID = 12;
const REC_LABEL_LENGTH = 16;
const REC_LABEL = 17;
/** The value at REC_KIND on every data record seen. */
const KIND_LABELLED = 3;
/**
 * Ids at or above this are not zones — they are the device-category and panel
 * entries that follow the zone block.
 */
const FIRST_NON_ZONE_ID = 0x300;

export class NcfError extends Error {}

function u32le(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000;
}

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte < 0x7f;
}

/**
 * Reads a length-prefixed label, returning nothing unless the declared length
 * matches a printable run exactly.
 *
 * This is the load-bearing check. If the layout is wrong the length byte lands
 * on something arbitrary and the run will not match, so a misread announces
 * itself instead of producing a label made of adjacent fields.
 */
function labelAt(bytes: Uint8Array, lengthAt: number, textAt: number, limit: number): string | undefined {
  const length = bytes[lengthAt];
  if (length === undefined || length === 0 || textAt + length > limit) return undefined;
  for (let i = 0; i < length; i++) {
    if (!isPrintable(bytes[textAt + i]!)) return undefined;
  }
  // The byte after must not continue the run, or the length is understating it.
  const next = bytes[textAt + length];
  if (next !== undefined && textAt + length < limit && isPrintable(next)) return undefined;
  return String.fromCharCode(...bytes.subarray(textAt, textAt + length));
}

export interface NcfRecord {
  id: number;
  label: string;
}

/** Reads the SITE table: the site name and its labelled records. */
export function parseSiteTable(bytes: Uint8Array): { siteName?: string; records: NcfRecord[] } {
  if (bytes.length < FIRST_RECORD + SLOT || bytes.length % SLOT !== 0) {
    throw new NcfError(
      `The SITE entry is ${bytes.length} bytes, which is not a whole number of ${SLOT}-byte records — ` +
      `this is not a layout this reader knows.`,
    );
  }

  // The site name sits in the second slot, at its own offset rather than the
  // one the data records use.
  let siteName: string | undefined;
  for (let at = SLOT; at < FIRST_RECORD - 1; at++) {
    const found = labelAt(bytes, at, at + 1, FIRST_RECORD);
    if (found && found.length >= 3) {
      siteName = found.trim();
      break;
    }
  }

  const records: NcfRecord[] = [];
  for (let at = FIRST_RECORD; at + SLOT <= bytes.length; at += SLOT) {
    const kind = u32le(bytes, at + REC_KIND);
    if (kind !== KIND_LABELLED) {
      throw new NcfError(
        `Record at byte ${at} is marked kind ${kind}, not ${KIND_LABELLED}. ` +
        `This file uses a record layout the reader has not seen; it has stopped rather than guess.`,
      );
    }
    const label = labelAt(bytes, at + REC_LABEL_LENGTH, at + REC_LABEL, at + SLOT);
    if (label === undefined) {
      throw new NcfError(
        `Record at byte ${at} does not carry a readable length-prefixed label, so the layout does not hold ` +
        `for this file. Nothing has been imported rather than importing something wrong.`,
      );
    }
    records.push({ id: u32le(bytes, at + REC_ID), label: label.trim() });
  }

  return { siteName, records };
}

export function isNcf(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  try {
    const names = readZip(bytes).map((e) => e.name);
    return names.includes('SITE') && names.some((n) => n.toLowerCase().endsWith('.pcf'));
  } catch {
    return false;
  }
}

export function parseNcf(bytes: Uint8Array, fileName = ''): ParsedConfig {
  const entries = readZip(bytes);
  const site = entries.find((e) => e.name === 'SITE');
  if (!site) throw new ZipError('This .NCF archive has no SITE entry.');

  const { siteName, records } = parseSiteTable(site.bytes);
  const warnings: string[] = [];

  const zones: Omit<Zone, 'id' | 'panelId'>[] = [];
  for (const record of records) {
    if (record.id >= FIRST_NON_ZONE_ID) continue;

    // Where the label names its own zone, it has to be the right one. Five of
    // the six zones in the sample say "ZONE n", which is enough to confirm the
    // id field really is the zone number rather than a row index that happens
    // to line up.
    const named = record.label.match(/^ZONE\s+(\d+)$/i);
    if (named && Number.parseInt(named[1]!, 10) !== record.id) {
      throw new NcfError(
        `Record ${record.id} is labelled "${record.label}", so the id field is not the zone number. ` +
        `Importing would have renumbered the zones; nothing has been imported.`,
      );
    }

    zones.push({ number: record.id, text: record.label, unused: false });
  }

  const others = records.filter((r) => r.id >= FIRST_NON_ZONE_ID);
  if (others.length) {
    warnings.push(
      `The site table also lists ${others.map((r) => `"${r.label}"`).join(', ')}. ` +
      `These are equipment descriptions rather than zones and were not imported as such.`,
    );
  }

  const pcf = entries.find((e) => e.name.toLowerCase().endsWith('.pcf'));
  warnings.push(
    `Only the site and zone list could be read. The devices are in ` +
    `${pcf ? `"${pcf.name}"` : 'the panel file'}, which is an undocumented binary format with no readable ` +
    `structure, so no devices, loops or cause-and-effect came across.`,
  );
  warnings.push(
    'The panel brand and model are not recorded in this file, so the panel was imported as unspecified. ' +
    'Set them on the panel record.',
  );

  const panel: ParsedPanel = {
    name: siteName || fileName || 'Panel',
    brand: 'other',
    zones: zones.sort((a, b) => a.number - b.number),
    points: [],
    loops: [],
    causeEffect: [],
  };

  return { brand: 'other', siteName, panels: [panel], warnings, parser: PARSER_ID };
}
