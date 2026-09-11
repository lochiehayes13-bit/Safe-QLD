import { parseDelimited } from './csv';
import { normaliseDeviceType } from './deviceType';
import type { ParsedConfig, ParsedPanel, PanelBrand, Point, Zone } from '@/domain/types';

/**
 * Imports point/zone lists from delimited text.
 *
 * This is the import path that works regardless of panel brand: every
 * programming tool can produce a device list, and every tech can build one in a
 * spreadsheet. It means the app is useful on a panel nobody has written a
 * dedicated parser for yet.
 */

/** The fields a tabular import can populate. */
export type FieldKey =
  | 'ignore'
  | 'loop'
  | 'address'
  | 'subAddress'
  | 'pointRef'
  | 'text'
  | 'text2'
  | 'deviceType'
  | 'zoneNumber'
  | 'zoneText';

export interface FieldSpec {
  key: FieldKey;
  label: string;
  /** Header names that map to this field, lowercased. */
  aliases: string[];
}

export const FIELD_SPECS: FieldSpec[] = [
  { key: 'loop', label: 'Loop', aliases: ['loop', 'loop no', 'loop number', 'slc', 'circuit', 'loop#', 'l'] },
  { key: 'address', label: 'Address', aliases: ['address', 'addr', 'device address', 'point address', 'add', 'device no', 'device number', 'a'] },
  { key: 'subAddress', label: 'Sub-address', aliases: ['sub', 'subaddress', 'sub address', 'channel', 'ch', 'subpoint'] },
  { key: 'pointRef', label: 'Point ref', aliases: ['point', 'point ref', 'reference', 'ref', 'device id', 'id', 'tag', 'point id'] },
  { key: 'text', label: 'Device text / location', aliases: ['text', 'device text', 'description', 'location', 'device', 'label', 'name', 'point text', 'device description', 'user text'] },
  { key: 'text2', label: 'Second line', aliases: ['text 2', 'text2', 'line 2', 'second line', 'description 2', 'detail'] },
  { key: 'deviceType', label: 'Device type', aliases: ['type', 'device type', 'devicetype', 'model', 'sensor type', 'kind', 'point type'] },
  { key: 'zoneNumber', label: 'Zone number', aliases: ['zone', 'zone no', 'zone number', 'zone#', 'z', 'area'] },
  { key: 'zoneText', label: 'Zone text', aliases: ['zone text', 'zone name', 'zone description', 'zone label', 'area name'] },
];

export type ColumnMapping = FieldKey[];

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9 #]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Guesses a column mapping from header text.
 *
 * Exact alias matches win over partial ones, and each field is claimed at most
 * once, so a sheet with both "Zone" and "Zone Text" maps them correctly rather
 * than assigning both to the same field.
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const norm = headers.map(normaliseHeader);
  const mapping: ColumnMapping = headers.map(() => 'ignore');
  const claimed = new Set<FieldKey>();

  // Pass 1: exact alias match.
  norm.forEach((h, i) => {
    if (!h) return;
    for (const spec of FIELD_SPECS) {
      if (claimed.has(spec.key)) continue;
      if (spec.aliases.includes(h)) {
        mapping[i] = spec.key;
        claimed.add(spec.key);
        return;
      }
    }
  });

  // Pass 2: substring match for anything still unclaimed.
  norm.forEach((h, i) => {
    if (mapping[i] !== 'ignore' || !h) return;
    for (const spec of FIELD_SPECS) {
      if (claimed.has(spec.key)) continue;
      if (spec.aliases.some((a) => a.length >= 3 && (h.includes(a) || a.includes(h)))) {
        mapping[i] = spec.key;
        claimed.add(spec.key);
        return;
      }
    }
  });

  return mapping;
}

/** True when the row looks like a header rather than data. */
function looksLikeHeader(row: string[]): boolean {
  const cells = row.filter((c) => c.trim());
  if (!cells.length) return false;
  // Headers are mostly non-numeric words.
  const numeric = cells.filter((c) => /^-?\d+(\.\d+)?$/.test(c.trim())).length;
  return numeric / cells.length < 0.4;
}

function toInt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  // Tolerate "L1", "Loop 2", "Zone 003", "12A".
  const m = t.match(/-?\d+/);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface TabularImportOptions {
  panelName: string;
  brand?: PanelBrand;
  model?: string;
  /** Override the guessed mapping. */
  mapping?: ColumnMapping;
  /** Force whether row 0 is a header; auto-detected when omitted. */
  hasHeader?: boolean;
}

export interface TabularPreview {
  headers: string[];
  mapping: ColumnMapping;
  sampleRows: string[][];
  totalRows: number;
  hasHeader: boolean;
}

/** Parses text and returns a preview so the user can confirm the mapping. */
export function previewTabular(text: string): TabularPreview {
  const rows = parseDelimited(text);
  if (!rows.length) {
    return { headers: [], mapping: [], sampleRows: [], totalRows: 0, hasHeader: false };
  }
  const first = rows[0]!;
  const hasHeader = looksLikeHeader(first);
  const headers = hasHeader ? first.map((h) => h.trim()) : first.map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return {
    headers,
    mapping: hasHeader ? guessMapping(headers) : headers.map(() => 'ignore' as FieldKey),
    sampleRows: dataRows.slice(0, 8),
    totalRows: dataRows.length,
    hasHeader,
  };
}

/** Builds a ParsedConfig from delimited text using an (optionally confirmed) mapping. */
export function importTabular(text: string, opts: TabularImportOptions): ParsedConfig {
  const rows = parseDelimited(text);
  const warnings: string[] = [];
  if (!rows.length) {
    return { brand: opts.brand ?? 'other', panels: [], warnings: ['The file contained no readable rows.'], parser: 'tabular@1' };
  }

  const first = rows[0]!;
  const hasHeader = opts.hasHeader ?? looksLikeHeader(first);
  const headers = hasHeader ? first.map((h) => h.trim()) : first.map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const mapping = opts.mapping ?? guessMapping(headers);

  const idx = (k: FieldKey): number => mapping.indexOf(k);
  const iLoop = idx('loop'), iAddr = idx('address'), iSub = idx('subAddress'), iRef = idx('pointRef');
  const iText = idx('text'), iText2 = idx('text2'), iType = idx('deviceType');
  const iZone = idx('zoneNumber'), iZoneText = idx('zoneText');

  if (iText < 0) warnings.push('No device text column was mapped — point lists will show blank descriptions.');
  if (iAddr < 0 && iRef < 0) warnings.push('No address or point reference column was mapped.');

  const points: Omit<Point, 'id' | 'panelId'>[] = [];
  // Zone text is collected as points are read, so a zone list falls out of a
  // device list even when the export has no separate zone sheet.
  const zoneMap = new Map<number, string>();

  for (const r of dataRows) {
    const cell = (i: number): string | undefined => (i >= 0 ? r[i] : undefined);
    const text = (cell(iText) ?? '').trim();
    const zoneNumber = toInt(cell(iZone));
    const zoneText = (cell(iZoneText) ?? '').trim() || undefined;

    if (zoneNumber !== undefined && zoneText && !zoneMap.has(zoneNumber)) {
      zoneMap.set(zoneNumber, zoneText);
    }

    const rawType = (cell(iType) ?? '').trim() || undefined;
    const address = toInt(cell(iAddr));
    const loopNumber = toInt(cell(iLoop));
    const pointRef = (cell(iRef) ?? '').trim() || buildRef(loopNumber, address);

    // A row with no identity and no text carries nothing worth importing.
    if (!text && address === undefined && !pointRef) continue;

    points.push({
      loopNumber,
      address,
      subAddress: toInt(cell(iSub)),
      pointRef,
      text,
      text2: (cell(iText2) ?? '').trim() || undefined,
      deviceTypeRaw: rawType,
      deviceType: normaliseDeviceType(rawType),
      zoneNumber,
      zoneText,
      unused: !text,
    });
  }

  const zones: Omit<Zone, 'id' | 'panelId'>[] = [...zoneMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, t]) => ({ number, text: t, unused: false }));

  const loopNumbers = [...new Set(points.map((p) => p.loopNumber).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);

  const panel: ParsedPanel = {
    name: opts.panelName,
    brand: opts.brand ?? 'other',
    model: opts.model,
    zones,
    points,
    loops: loopNumbers.map((number) => ({ number })),
    causeEffect: [],
  };

  if (!points.length) warnings.push('No device rows were recognised. Check the column mapping.');

  return {
    brand: opts.brand ?? 'other',
    model: opts.model,
    panels: [panel],
    warnings,
    parser: 'tabular@1',
  };
}

function buildRef(loop: number | undefined, address: number | undefined): string {
  if (loop !== undefined && address !== undefined) return `L${loop}P${String(address).padStart(3, '0')}`;
  if (address !== undefined) return String(address);
  return '';
}
