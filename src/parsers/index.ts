import type { PanelBrand, ParsedConfig } from '@/domain/types';
import { importTabular, previewTabular } from './tabular';
import { isFfp, parseFfp } from './ampacFfp';
import { isNle, parseNle } from './kentecNle';
import { isPci, parsePci } from './notifierPci';
import { isPertronicUtil, parsePertronicUtil } from './pertronicUtil';
import { isNcf, parseNcf } from './ncfSite';
import { isVigilantBytes, parseVigilantBytes } from './vigilant';

export * from './csv';
export * from './deviceType';
export * from './effectKind';
export * from './tabular';
export * from './ampacFfp';
export * from './kentecNle';
export * from './notifierPci';
export * from './pertronicUtil';
export * from './ncfSite';
export * from './vigilant';
export * from './lineTags';
export * from './sqliteRead';
export * from './zipRead';

/**
 * Panel parser registry.
 *
 * Vendor site/config files are proprietary and, with the exception of a few
 * text-based exports, undocumented. Rather than pretend otherwise, each entry
 * declares honestly what it can do today. The UI reads `status` and tells the
 * technician exactly what will happen before they import, instead of failing
 * silently on a file it cannot read.
 */

export type ParserStatus =
  /** Reads the vendor file directly. */
  | 'native'
  /** Reads a text/CSV export produced by the vendor tool. */
  | 'export'
  /** Reads part of the file — see `limitation` for what it does not bring. */
  | 'partial'
  /** Not yet implemented — needs sample files to build. */
  | 'planned'
  /**
   * The format is recognised and cannot be read, for a reason that more work
   * would not change — an encrypted container, or a payload with no structure
   * left in it. Distinct from 'planned' because there is nothing to wait for.
   */
  | 'unreadable';

export interface PanelParser {
  id: string;
  brand: PanelBrand;
  brandLabel: string;
  /** Models this entry covers. */
  models: string[];
  status: ParserStatus;
  /** File extensions the vendor tool produces, where known. */
  extensions: string[];
  /** Shown in the import screen so techs know how to get a file out. */
  howToExport?: string;
  /** What a 'partial' or 'unreadable' entry cannot do, in one sentence. */
  limitation?: string;
  /** Returns true when this parser recognises the content. */
  sniff?: (text: string, fileName: string) => boolean;
  parse?: (text: string, fileName: string) => ParsedConfig;
  /**
   * The binary path, for formats that are not text: a SQLite database, a zip,
   * a table of length-prefixed records. Decoding those to a string first
   * corrupts them, so they are matched and parsed from the bytes.
   */
  sniffBytes?: (bytes: Uint8Array, fileName: string) => boolean;
  parseBytes?: (bytes: Uint8Array, fileName: string) => ParsedConfig;
}

/**
 * The panel catalogue.
 *
 * Every brand is listed even where no native parser exists yet, because the
 * tabular import path already works for all of them — a tech can export a
 * device list from any of these tools and load it today.
 */
export const PANEL_CATALOGUE: PanelParser[] = [
  {
    id: 'ampac-firefinder',
    brand: 'ampac',
    brandLabel: 'Ampac',
    models: ['FireFinder PLUS', 'FireFinder', 'EvacUElite'],
    status: 'native',
    extensions: ['.ffp'],
    howToExport:
      'Open the site in Configuration Manager PLUS and take the .ffp project file. Zones, loops, devices and the cause-and-effect matrix are all read directly — no export step.',
    sniff: (text) => isFfp(text),
    parse: (text) => parseFfp(text),
  },
  {
    id: 'vigilant-smartconfig',
    brand: 'vigilant',
    brandLabel: 'Vigilant',
    models: ['MX1', 'F4000', 'MX4428', 'FP1600', 'IO-NET'],
    status: 'native',
    // SmartConfig writes the site file and the template in the same format,
    // so both import; the template is how this parser was built and tested.
    extensions: ['.mx1', '.mxt', '.f4k', '.f4t', '.16t', '.ion', '.iot'],
    howToExport:
      'Take the SmartConfig site file. Zones, panel and equipment points, loop cards, circuits and the logic ' +
      'equations are read directly. If the site was saved with "Compress Files When Saving" ticked, untick it and ' +
      'save again — the compressed form is not readable.',
    sniffBytes: (bytes) => isVigilantBytes(bytes),
    parseBytes: (bytes, fileName) => parseVigilantBytes(bytes, fileName),
  },
  {
    id: 'notifier-pci',
    brand: 'notifier',
    brandLabel: 'Notifier',
    models: ['NFS2-3030', 'NFS-3030', '2800', 'NFS series'],
    status: 'native',
    extensions: ['.pci'],
    howToExport:
      'Take the .pci configuration from VeriFire Tools. Loops, devices, zones and the equations behind the ' +
      'cause-and-effect matrix are all read directly. The panel model is not recorded in the file, so set it after import.',
    sniff: (text) => isPci(text),
    parse: (text, fileName) => parsePci(text, fileName),
  },
  {
    id: 'notifier-accdb',
    brand: 'notifier',
    brandLabel: 'Notifier (VeriFire database)',
    models: ['NFS2-3030', 'NFS-3030'],
    status: 'unreadable',
    extensions: ['.accdb', '.mdb'],
    limitation:
      'VeriFire saves these with a database password, which encrypts the whole file. No tool can read one without ' +
      'that password — the encryption is real, not obfuscation.',
    howToExport: 'Open the job in VeriFire Tools and save the configuration as .pci instead; that format is read in full.',
  },
  {
    id: 'pertronic-util',
    brand: 'pertronic',
    brandLabel: 'Pertronic',
    models: ['F220', 'F120', 'F100'],
    status: 'native',
    extensions: ['.util', '.f220cfg'],
    howToExport:
      'Take the .util project file from the Pertronic configuration tool. Loops, devices, zones, output groups and ' +
      'the logic blocks are all read directly, and spare addresses are marked as spare rather than imported as devices.',
    sniffBytes: (bytes) => isPertronicUtil(bytes),
    parseBytes: (bytes, fileName) => parsePertronicUtil(bytes, fileName),
  },
  {
    id: 'ncf-site',
    brand: 'other',
    brandLabel: 'NCF site file (brand unconfirmed)',
    models: [],
    status: 'partial',
    extensions: ['.ncf'],
    limitation:
      'Only the site name and zone list. The devices live in the .pcf inside the archive, which is an undocumented ' +
      'binary format with no readable structure.',
    howToExport: 'If the tool that wrote this can also export a device schedule to CSV, that will import in full.',
    sniffBytes: (bytes) => isNcf(bytes),
    parseBytes: (bytes, fileName) => parseNcf(bytes, fileName),
  },
  {
    id: 'simplex',
    brand: 'simplex',
    brandLabel: 'Simplex',
    models: ['4100ES', '4100U', '4010ES', '4007ES', '4100ES-S1'],
    status: 'planned',
    extensions: ['.sdb4100u', '.dbf'],
    howToExport:
      'The job file is a variant of an Access database and is not read yet. In the ES Panel Programmer use ' +
      'File > Export > "Export User Points to Text File", save as CSV, and import that.',
  },
  {
    id: 'siemens',
    brand: 'siemens',
    brandLabel: 'Siemens',
    models: ['Cerberus PRO', 'FS720'],
    status: 'planned',
    extensions: ['.fsc', '.xml'],
    howToExport:
      'In Cerberus Engineering Tool open the site, select the Detection task card, then File > CSV export. ' +
      'That is a flat per-device table and imports through the column mapper.',
  },
  {
    id: 'fusion',
    brand: 'fusion',
    brandLabel: 'Fusion',
    models: ['Axis'],
    status: 'planned',
    extensions: ['.cfg', '.xml'],
    howToExport: 'Export the device schedule to CSV from the Fusion configuration tool.',
  },
  {
    id: 'fusion-sts',
    brand: 'fusion',
    brandLabel: 'Fusion wireless translator status',
    models: ['Wireless translator'],
    status: 'unreadable',
    extensions: ['.sts'],
    limitation:
      'The file unpacks cleanly — it is a zlib stream behind a twelve-byte header — but what is inside is a device ' +
      'table with no text in it at all: addresses and type codes, no labels. There is nothing to name a device with.',
    howToExport: 'Take the configuration from the panel the translator reports to; that carries the device text.',
  },
  {
    id: 'brooks',
    brand: 'brooks',
    brandLabel: 'Brooks',
    models: ['Brooks panels'],
    status: 'planned',
    extensions: ['.cfg'],
    howToExport: 'Export the device schedule to CSV.',
  },
  {
    id: 'kentec-taktis',
    brand: 'kentec',
    brandLabel: 'Incite / Kentec',
    models: ['Taktis', 'Syncro'],
    status: 'native',
    extensions: ['.nle'],
    howToExport:
      'Take the .nle site file from Loop Explorer 2. Zones, loops, devices, panel I/O and the cause-and-effect ' +
      'tables are all read directly. Device types are stored as keys into Loop Explorer\'s own device library, ' +
      'which does not travel with the file, so points import with an unknown type.',
    sniffBytes: (bytes) => isNle(bytes),
    parseBytes: (bytes, fileName) => parseNle(bytes, fileName),
  },
];

export function parserForBrand(brand: PanelBrand): PanelParser | undefined {
  return PANEL_CATALOGUE.find((p) => p.brand === brand);
}

export type ImportKind =
  | 'tabular'
  | 'pack'
  /** A text format read directly; use `parser.parse`. */
  | 'native'
  /** A binary format read directly; use `parser.parseBytes`. */
  | 'native-binary'
  /** Recognised, and known not to be readable; show `parser.limitation`. */
  | 'unreadable'
  | 'unknown';

/** True when a parser is wired up rather than merely listed. */
function canParse(p: PanelParser): boolean {
  return Boolean(p.parse || p.parseBytes);
}

/**
 * Classifies a picked file from its bytes.
 *
 * Bytes rather than text because half the formats now read natively are
 * binary: a SQLite database, a zip, a table of length-prefixed records.
 * Decoding one of those to a string to look at its first line corrupts it, and
 * on a bad day corrupts it into something that still looks parseable.
 *
 * Order matters. Binary signatures are checked first because they are exact;
 * text sniffing next, because a technician renaming a file is routine; and the
 * extension last, as the weakest evidence of the three.
 */
export function classifyBytes(fileName: string, bytes: Uint8Array): { kind: ImportKind; parser?: PanelParser } {
  const lower = fileName.toLowerCase();

  if (bytes.length >= 4 && bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x44) {
    return { kind: 'pack' };
  }
  if (lower.endsWith('.sqld')) return { kind: 'pack' };

  for (const p of PANEL_CATALOGUE) {
    if (p.sniffBytes?.(bytes, fileName)) return { kind: 'native-binary', parser: p };
  }

  const head = decodeHead(bytes);
  const byText = classifyFile(fileName, head);

  // The tabular fallback matches on nothing more than a few commas or tabs
  // among the first lines, which binary content supplies by accident. Sending
  // a binary file to the column mapper gives the technician a screen of
  // mojibake to map; sending it on as unknown gets it probed, which is the one
  // answer that might actually help.
  if (byText.kind === 'tabular' && !plausiblyText(head)) return { kind: 'unknown' };
  if (byText.kind !== 'unknown') return byText;

  // Recognised and unreadable is a better answer than unknown: it saves the
  // technician going and fetching the same file again.
  for (const p of PANEL_CATALOGUE) {
    if (p.status === 'unreadable' && p.extensions.some((ext) => lower.endsWith(ext))) {
      return { kind: 'unreadable', parser: p };
    }
  }

  return byText;
}

/**
 * Whether text decoded from a file could be something a person typed.
 *
 * Deliberately generous — a config with a few control characters in it is
 * still a config — but a run of arbitrary bytes will not clear it.
 */
function plausiblyText(head: string): boolean {
  if (!head.length) return false;
  let printable = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  return printable / head.length >= 0.85;
}

/** Decodes enough of the front of a file to sniff it, without choking on binary. */
function decodeHead(bytes: Uint8Array, length = 8192): string {
  const slice = bytes.subarray(0, length);
  if (typeof TextDecoder !== 'undefined') {
    // Latin-1 maps every byte to a character, so a binary file decodes to
    // nonsense rather than to replacement characters that could match a sniff.
    return new TextDecoder('latin1').decode(slice);
  }
  let s = '';
  for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]!);
  return s;
}

/**
 * Classifies a picked file from its leading text.
 *
 * Content is checked before extension: techs rename files constantly, and a
 * .txt that is really a tab-separated point list should still import.
 */
export function classifyFile(fileName: string, head: string): { kind: ImportKind; parser?: PanelParser } {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.sqld')) return { kind: 'pack' };
  if (head.startsWith('SQLD')) return { kind: 'pack' };

  for (const p of PANEL_CATALOGUE) {
    if (!canParse(p)) continue;
    if (p.sniff?.(head, fileName)) return { kind: 'native', parser: p };
  }
  // Extension only after every content sniff has had a go, so a file whose
  // extension belongs to one vendor and whose contents belong to another is
  // read as what it is.
  for (const p of PANEL_CATALOGUE) {
    if (!canParse(p)) continue;
    if (p.extensions.some((ext) => lower.endsWith(ext))) {
      return { kind: p.parse ? 'native' : 'native-binary', parser: p };
    }
  }

  if (/\.(csv|tsv|tab|txt|prn)$/.test(lower)) return { kind: 'tabular' };

  // Several delimiter-looking characters on the first couple of lines is a
  // strong signal of a delimited export whatever the extension says.
  const firstLines = head.split(/\r?\n/).slice(0, 3).join('\n');
  if (/[,;\t|]/.test(firstLines) && firstLines.split(/[,;\t|]/).length >= 3) {
    return { kind: 'tabular' };
  }

  return { kind: 'unknown' };
}

export { importTabular, previewTabular };
