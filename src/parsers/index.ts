import type { PanelBrand, ParsedConfig } from '@/domain/types';
import { importTabular, previewTabular } from './tabular';
import { isFfp, parseFfp } from './ampacFfp';

export * from './csv';
export * from './deviceType';
export * from './tabular';
export * from './ampacFfp';

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
  /** Not yet implemented — needs sample files to build. */
  | 'planned';

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
  /** Returns true when this parser recognises the content. */
  sniff?: (text: string, fileName: string) => boolean;
  parse?: (text: string, fileName: string) => ParsedConfig;
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
    id: 'vigilant-mx',
    brand: 'vigilant',
    brandLabel: 'Vigilant',
    models: ['F4000', 'MX4428', 'MX1', 'QE20'],
    status: 'planned',
    extensions: ['.mx1', '.cfg', '.dat', '.xml'],
    howToExport: 'From the MX1 / F4000 configuration tool, print or export the point and zone list to CSV, then import it here.',
  },
  {
    id: 'notifier',
    brand: 'notifier',
    brandLabel: 'Notifier',
    models: ['2800', '3030', 'NFS series'],
    status: 'planned',
    extensions: ['.vf', '.vfr', '.bak'],
    howToExport: 'VeriFire Tools can report the point list; export it to CSV and import it here.',
  },
  {
    id: 'pertronic',
    brand: 'pertronic',
    brandLabel: 'Pertronic',
    models: ['F100', 'F120', 'F220'],
    status: 'planned',
    extensions: ['.f120', '.pcf', '.cfg'],
    howToExport: 'Export the loop and zone schedule from the Pertronic configuration software as CSV.',
  },
  {
    id: 'simplex',
    brand: 'simplex',
    brandLabel: 'Simplex',
    models: ['4100ES', '4100U', '4010', 'Simplex networks'],
    status: 'planned',
    extensions: ['.sdb', '.bak', '.zip'],
    howToExport: 'Use the panel programmer report output for the point list, saved as CSV or tab-delimited text.',
  },
  {
    id: 'siemens',
    brand: 'siemens',
    brandLabel: 'Siemens',
    models: ['Cerberus PRO'],
    status: 'planned',
    extensions: ['.xml', '.cdb'],
    howToExport: 'Export the detector and zone list from the Siemens engineering tool to CSV.',
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
    status: 'planned',
    extensions: ['.tkc', '.syn', '.xml'],
    howToExport: 'Export the configuration report from Loop Explorer / Taktis Connect as CSV.',
  },
];

export function parserForBrand(brand: PanelBrand): PanelParser | undefined {
  return PANEL_CATALOGUE.find((p) => p.brand === brand);
}

export type ImportKind = 'tabular' | 'pack' | 'native' | 'unknown';

/**
 * Classifies a picked file so the import screen can route it.
 *
 * Content is checked before extension: techs rename files constantly, and a
 * .txt that is really a tab-separated point list should still import.
 */
export function classifyFile(fileName: string, head: string): { kind: ImportKind; parser?: PanelParser } {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.sqld')) return { kind: 'pack' };
  if (head.startsWith('SQLD')) return { kind: 'pack' };

  for (const p of PANEL_CATALOGUE) {
    if (p.status === 'planned' || !p.parse) continue;
    // Content first — techs rename files constantly — then the extension.
    if (p.sniff?.(head, fileName)) return { kind: 'native', parser: p };
    if (p.extensions.some((ext) => lower.endsWith(ext))) return { kind: 'native', parser: p };
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
