import type { Frequency } from '@/seed/serviceRoutines';
import { parseDelimited } from './csv';

/**
 * The asset register export from a fire maintenance platform.
 *
 * This is the book of work: every asset on every site, with where it is, what
 * it is, and when each of its routines next falls due. One export per system,
 * sharing a common set of columns and adding a few of their own.
 *
 * Getting a register wrong is quieter and more damaging than getting a panel
 * config wrong. A misparsed device list looks obviously broken; a misparsed
 * register looks completely normal and sends a technician to the wrong site on
 * the wrong month.
 *
 * Three things in real exports cause that, and each is handled deliberately:
 *
 *  - Dates are Australian, day first. Read as month-first, "1/10/2025" becomes
 *    January and two thirds of a year's scheduling silently moves. There is no
 *    ambiguity to resolve — the format is fixed — so this never guesses per
 *    value, and refuses a date whose day exceeds twelve in the month position.
 *  - The overhaul column is free text typed by technicians over many years:
 *    "01/20", "1/2/23", "Jun-25", "2019". It is read to whatever precision it
 *    actually carries and no further, because a five-yearly test recorded as
 *    "Jun-25" is not the first of June, and inventing that day moves the next
 *    one by up to a month.
 *  - "unknown" is a value people type into cells. Treated as content it becomes
 *    an asset located in a room called "unknown".
 */

const PARSER_ID = 'asset-register@1';

/** Cell values that mean "nothing here", whatever the column. */
const BLANK = /^(|-+|\.|n\/?a|nil|none|unknown|unkown|tbc|tba|\?+)$/i;

export type RegisterSystem =
  | 'extinguisher'
  | 'fire-blanket'
  | 'emergency-lighting'
  | 'hose-reel'
  | 'hydrant'
  | 'detection'
  | 'smoke-alarm'
  | 'ews'
  | 'sprinkler'
  | 'special-hazard'
  | 'pump'
  | 'water-tank'
  | 'smoke-door'
  | 'fire-door'
  | 'unknown';

interface SystemDef {
  system: RegisterSystem;
  label: string;
  /** The asset type each row becomes. */
  assetTypeId: string;
  /** Matched against the file name, lower-cased with separators normalised. */
  fileNames: RegExp;
  /** A column only this system has, used when the file has been renamed. */
  signature?: RegExp;
}

/**
 * One entry per register the platform exports.
 *
 * Recognition is by file name first because the exports are named after the
 * system, then by a column only that system carries. Both are needed: names
 * get changed, and several systems share a column set.
 */
const SYSTEMS: SystemDef[] = [
  { system: 'extinguisher', label: 'Portable and Wheeled Fire Extinguishers', assetTypeId: 'extinguisher',
    fileNames: /extinguisher/, signature: /^extinguisher type$/i },
  { system: 'fire-blanket', label: 'Fire Blankets', assetTypeId: 'fire-blanket',
    fileNames: /blanket/, signature: /^blanket type/i },
  { system: 'emergency-lighting', label: 'Emergency Lighting', assetTypeId: 'emergency-light',
    fileNames: /emergency.?light/, signature: /^emergency light type/i },
  { system: 'hose-reel', label: 'Fire Hose Reels', assetTypeId: 'hose-reel',
    fileNames: /hose.?reel/, signature: /^annual flow test$/i },
  { system: 'hydrant', label: 'Fire Hydrant Systems', assetTypeId: 'hydrant',
    fileNames: /hydrant/, signature: /^size mm/i },
  { system: 'smoke-alarm', label: 'Smoke Alarms and Heat Alarms', assetTypeId: 'smoke-alarm',
    fileNames: /smoke.?alarm|heat.?alarm/, signature: /batt type/i },
  { system: 'ews', label: 'Emergency Warning Systems', assetTypeId: 'ews-panel',
    fileNames: /emergency.?warning/, signature: /^ewis brand$/i },
  { system: 'detection', label: 'Fire Detection and Alarm Systems', assetTypeId: 'fip',
    fileNames: /detection.?and.?alarm/, signature: /^battery sizes$/i },
  { system: 'sprinkler', label: 'Automatic Fire Sprinkler Systems', assetTypeId: 'sprinkler-valve',
    fileNames: /sprinkler/ },
  { system: 'special-hazard', label: 'Special Hazard Systems', assetTypeId: 'gas-cylinder',
    fileNames: /special.?hazard/ },
  { system: 'pump', label: 'Fire Pumpsets', assetTypeId: 'fire-pump',
    fileNames: /pumpset|fire.?pump/, signature: /batt sizes$/i },
  { system: 'water-tank', label: 'Water Storage Tanks', assetTypeId: 'water-tank',
    fileNames: /water.?storage|tank/ },
  { system: 'smoke-door', label: 'Smoke Doors', assetTypeId: 'fire-door',
    fileNames: /smoke.?door/, signature: /^frl level$/i },
  { system: 'fire-door', label: 'Fire Resistant Doorsets', assetTypeId: 'fire-door',
    fileNames: /doorset|resistant.?door/ },
];

/**
 * The headings each system's report puts over its own two columns.
 *
 * These live here rather than in the report template because they are the same
 * headings the register export uses, and a service report whose columns do not
 * match the register it was built from is a document the client has to
 * reconcile by hand. One source, both ends.
 */
export interface SystemColumns {
  /** Over the type/size column. */
  descriptor: string;
  /** Over the overhaul or pressure-test column; absent where the system has none. */
  overhaul?: string;
  /** Some registers label the tag column "Asset Number" rather than "Asset #". */
  assetNumber: string;
}

export const SYSTEM_COLUMNS: Record<RegisterSystem, SystemColumns> = {
  extinguisher: { descriptor: 'Extinguisher Type', overhaul: 'Last 5 Yearly', assetNumber: 'Asset #' },
  'fire-blanket': { descriptor: 'Blanket Type & Size', assetNumber: 'Asset #' },
  'emergency-lighting': { descriptor: 'Emergency Light Type & Size', assetNumber: 'Asset #' },
  'hose-reel': { descriptor: 'Equipment Type & Size', overhaul: 'Annual Flow Test', assetNumber: 'Asset #' },
  hydrant: { descriptor: 'Size mm RG / QRT', overhaul: 'Last 5 Yearly Test', assetNumber: 'Asset Number' },
  'smoke-alarm': { descriptor: 'Equipment Type & Batt Type', assetNumber: 'Asset #' },
  ews: { descriptor: 'EWIS Brand', overhaul: 'Last 5 Yearly Test', assetNumber: 'Asset #' },
  detection: { descriptor: 'Equipment Type', overhaul: 'Last 5 Yearly Test', assetNumber: 'Asset #' },
  sprinkler: { descriptor: 'Type & Size', overhaul: 'Last 5 Yearly Test', assetNumber: 'Asset #' },
  'special-hazard': { descriptor: 'Type & Size', overhaul: 'Last 10 Yearly Test', assetNumber: 'Asset #' },
  pump: { descriptor: 'Equipment Type & Batt Sizes', overhaul: 'Last 5 Yearly Test', assetNumber: 'Asset #' },
  'water-tank': { descriptor: 'Type & Size', overhaul: 'Last 10 Yearly Test', assetNumber: 'Asset #' },
  'smoke-door': { descriptor: 'Dimensions, Lockset, Closer', assetNumber: 'Tag No.' },
  'fire-door': { descriptor: 'Doorset', assetNumber: 'Asset #' },
  unknown: { descriptor: 'Type', assetNumber: 'Asset #' },
};

/** The report heading for a system, e.g. "Fire Hydrant Systems". */
export const SYSTEM_LABEL: Record<RegisterSystem, string> = {
  extinguisher: 'Portable and Wheeled Fire Extinguishers',
  'fire-blanket': 'Fire Blankets',
  'emergency-lighting': 'Emergency Lighting',
  'hose-reel': 'Fire Hose Reels',
  hydrant: 'Fire Hydrant Systems',
  'smoke-alarm': 'Fire Detection and Alarm Systems - Smoke Alarms and Heat Alarms',
  ews: 'Fire Detection and Alarm Systems - Emergency Warning Systems',
  detection: 'Fire Detection and Alarm Systems - Fire Detection and Alarm Systems',
  sprinkler: 'Automatic Fire Sprinkler Systems',
  'special-hazard': 'Special Hazard Systems',
  pump: 'Fire Pumpsets',
  'water-tank': 'Water Storage Tanks for Fire Detection Purposes',
  'smoke-door': 'Passive Fire and Smoke Systems - Smoke Doors, Hinged and Pivoted',
  'fire-door': 'Passive Fire and Smoke Systems - Fire Resistant Doorsets',
  unknown: 'Unidentified System',
};

/** Column headings that carry the descriptor, in the order they are preferred. */
const DESCRIPTOR_COLUMNS = [
  'extinguisher type', 'blanket type & size', 'emergency light type & size',
  'equipment type & size', 'equipment type & batt sizes', 'equipment type & batt type',
  'equipment type', 'type & size', 'size mm rg / qrt', 'ewis brand',
  'dimensions, lockset, closer', 'brand & location',
];

/** Columns that are the same on every register. */
const COMMON = new Set([
  'asset id', 'contract name', 'contract no.', 'site id', 'site name', 'walk order',
  'service start date', 'parent asset', 'inherit parent asset service level',
  'asset #', 'asset number', 'location', 'notes', 'notes/height',
]);

/** Frequency column heading -> the routine vocabulary. */
const FREQUENCY_COLUMNS: Record<string, Frequency> = {
  monthly: 'monthly',
  '3 monthly': 'quarterly',
  quarterly: 'quarterly',
  '6 monthly': 'six-monthly',
  'six monthly': 'six-monthly',
  yearly: 'annual',
  annual: 'annual',
  '5 yearly': 'five-yearly',
  '10 yearly': 'ten-yearly',
};

/**
 * A date read to the precision the source actually recorded.
 *
 * The overhaul column mixes full dates with month-and-year and bare years, and
 * the difference matters: the next test falls due a fixed interval after the
 * last one, so a month read as a day moves the next one.
 */
export interface ImpreciseDate {
  /** Exactly what the cell said. */
  raw: string;
  year?: number;
  /** 1-12. */
  month?: number;
  day?: number;
  precision: 'day' | 'month' | 'year' | 'unreadable';
  /** ISO date, only where the day is actually known. */
  iso?: string;
}

export interface RegisterAsset {
  /** The platform's own asset id, which is what makes a re-import an update. */
  externalId?: string;
  siteExternalId?: string;
  siteName: string;
  /** Position in the walk around the site. */
  walkOrder?: number;
  /** The number written on the asset's own tag. */
  assetNumber?: string;
  location?: string;
  /** The type/size text, verbatim — the column it came from varies by system. */
  descriptor?: string;
  notes?: string;
  /** ISO date servicing started at this asset. */
  serviceStartDate?: string;
  /** Next due date per routine, straight off the register. */
  schedule: { frequency: Frequency; nextDueAt: string }[];
  /** When the overhaul or pressure test was last done, to its real precision. */
  lastOverhaul?: ImpreciseDate;
  system: RegisterSystem;
  assetTypeId: string;
  /** Columns this reader did not claim to understand, kept verbatim. */
  extra: Record<string, string>;
}

export interface RegisterSite {
  externalId?: string;
  name: string;
  assetCount: number;
}

export interface ParsedRegister {
  system: RegisterSystem;
  systemLabel: string;
  assets: RegisterAsset[];
  sites: RegisterSite[];
  warnings: string[];
  parser: string;
}

function clean(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return !t || BLANK.test(t) ? undefined : t;
}

/**
 * Parses a day-first date.
 *
 * Deliberately strict. This format is fixed, so a value that does not fit it is
 * a value this reader has misunderstood, and the right answer is to say so
 * rather than to produce a date that will read as fact for years.
 */
export function parseAuDate(value: string | undefined): string | undefined {
  const t = clean(value);
  if (!t) return undefined;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return undefined;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += year < 70 ? 2000 : 1900;

  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Reject a day the month does not have, rather than letting Date roll over
  // into the next one.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function fourDigitYear(raw: number): number {
  return raw >= 100 ? raw : raw < 70 ? 2000 + raw : 1900 + raw;
}

/** Reads the overhaul column to whatever precision it carries. */
export function parseImpreciseDate(value: string | undefined): ImpreciseDate | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  if (BLANK.test(raw)) return { raw, precision: 'unreadable' };

  const iso = parseAuDate(raw);
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { raw, year: y, month: m, day: d, precision: 'day', iso };
  }

  // "Jun-25", "Jan 2020"
  const named = raw.match(/^([A-Za-z]{3,4})[-\s/]?(\d{2}|\d{4})$/);
  if (named) {
    const month = MONTH_NAMES[named[1]!.toLowerCase()];
    if (month) return { raw, year: fourDigitYear(Number(named[2])), month, precision: 'month' };
  }

  // "01/20", "1/2023" — month and year. Read the other way round it becomes a
  // day in an unknown month, which is worse than admitting to a month.
  const my = raw.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/);
  if (my) {
    const month = Number(my[1]);
    if (month >= 1 && month <= 12) {
      return { raw, year: fourDigitYear(Number(my[2])), month, precision: 'month' };
    }
  }

  // A bare year, either two digits or four.
  const bare = raw.match(/^(\d{2}|\d{4})$/);
  if (bare) {
    const year = fourDigitYear(Number(bare[1]));
    // Only plausible service years; "25" is a year, "99" on a modern register
    // is far more likely to be a tag number.
    if (year >= 1970 && year <= 2100) return { raw, year, precision: 'year' };
  }

  return { raw, precision: 'unreadable' };
}

/** Which register this is, from the file name and then the column set. */
export function detectSystem(fileName: string, headers: string[]): SystemDef | undefined {
  const name = fileName.toLowerCase().replace(/[_\s]+/g, '-');
  const byName = SYSTEMS.find((s) => s.fileNames.test(name));
  if (byName) return byName;
  const lower = headers.map((h) => h.trim().toLowerCase());
  return SYSTEMS.find((s) => s.signature && lower.some((h) => s.signature!.test(h)));
}

/** True when the text looks like one of these register exports at all. */
export function isAssetRegister(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const lower = firstLine.toLowerCase();
  return lower.includes('site name') && lower.includes('walk order');
}

export function parseAssetRegister(text: string, fileName = ''): ParsedRegister {
  const warnings: string[] = [];
  const grid = parseDelimited(text);
  const rows = grid.slice(1);
  if (grid.length < 2) {
    return {
      system: 'unknown', systemLabel: 'Unknown', assets: [], sites: [],
      warnings: ['The register has no rows.'], parser: PARSER_ID,
    };
  }

  // One real export ships a heading with a trailing space ("FRL Level "), which
  // silently defeats every lookup that does not trim. A byte order mark on the
  // first heading does the same thing to "Asset ID".
  const headers = (grid[0] ?? []).map((h) => h.replace(/^\ufeff/, '').trim());
  const lower = headers.map((h) => h.toLowerCase());

  const def = detectSystem(fileName, headers);
  if (!def) {
    warnings.push(
      `The system this register covers could not be identified from the file name or its columns, ` +
      `so its assets have no type. Rename the file after the system, or map the type on import.`,
    );
  }

  const at = (row: string[], heading: string): string | undefined => {
    const i = lower.indexOf(heading);
    return i < 0 ? undefined : row[i];
  };

  const descriptorIndex = DESCRIPTOR_COLUMNS
    .map((c) => lower.indexOf(c))
    .find((i) => i >= 0);

  const frequencyIndexes = lower
    .map((h, i) => ({ i, frequency: FREQUENCY_COLUMNS[h] }))
    .filter((x): x is { i: number; frequency: Frequency } => Boolean(x.frequency));

  const overhaulIndex = lower.findIndex((h) => /^last .*(yearly|test)/.test(h));

  const claimed = new Set<number>([
    ...frequencyIndexes.map((f) => f.i),
    ...(descriptorIndex !== undefined ? [descriptorIndex] : []),
    ...(overhaulIndex >= 0 ? [overhaulIndex] : []),
    ...lower.map((h, i) => (COMMON.has(h) ? i : -1)).filter((i) => i >= 0),
  ]);

  const assets: RegisterAsset[] = [];
  const siteCounts = new Map<string, RegisterSite>();
  let unreadableDates = 0;

  for (const row of rows) {
    const siteName = clean(at(row, 'site name'));
    // A row with no site cannot be filed anywhere; counting it as an asset
    // would inflate the register with things nobody can go and service.
    if (!siteName) continue;

    const schedule: RegisterAsset['schedule'] = [];
    for (const { i, frequency } of frequencyIndexes) {
      const raw = clean(row[i]);
      if (!raw) continue;
      const nextDueAt = parseAuDate(raw);
      if (nextDueAt) schedule.push({ frequency, nextDueAt });
      else unreadableDates++;
    }

    const extra: Record<string, string> = {};
    row.forEach((value, i) => {
      const v = clean(value);
      if (v && !claimed.has(i) && headers[i]) extra[headers[i]!] = v;
    });

    const walkOrderRaw = clean(at(row, 'walk order'));
    const walkOrder = walkOrderRaw !== undefined ? Number.parseInt(walkOrderRaw, 10) : undefined;

    assets.push({
      externalId: clean(at(row, 'asset id')),
      siteExternalId: clean(at(row, 'site id')),
      siteName,
      walkOrder: Number.isFinite(walkOrder) ? walkOrder : undefined,
      assetNumber: clean(at(row, 'asset #')) ?? clean(at(row, 'asset number')),
      location: clean(at(row, 'location')),
      descriptor: descriptorIndex !== undefined ? clean(row[descriptorIndex]) : undefined,
      notes: clean(at(row, 'notes')) ?? clean(at(row, 'notes/height')),
      serviceStartDate: parseAuDate(at(row, 'service start date')),
      schedule,
      lastOverhaul: overhaulIndex >= 0 ? parseImpreciseDate(row[overhaulIndex]) : undefined,
      system: def?.system ?? 'unknown',
      assetTypeId: def?.assetTypeId ?? 'unknown',
      extra,
    });

    const siteKey = clean(at(row, 'site id')) ?? siteName;
    const site = siteCounts.get(siteKey);
    if (site) site.assetCount++;
    else siteCounts.set(siteKey, { externalId: clean(at(row, 'site id')), name: siteName, assetCount: 1 });
  }

  const skipped = rows.length - assets.length;
  if (skipped > 0) {
    warnings.push(`${skipped} ${skipped === 1 ? 'row has' : 'rows have'} no site name and were not imported.`);
  }
  if (unreadableDates) {
    warnings.push(
      `${unreadableDates} due ${unreadableDates === 1 ? 'date was' : 'dates were'} not in day/month/year form ` +
      `and were left unset rather than guessed at.`,
    );
  }
  // A due date well before servicing began is not a scheduling quirk. Most of
  // this platform's due dates snap to the first of a month, which puts a few
  // harmless days between them and a mid-month start; a gap of months means
  // someone typed a wrong year into the source system, and the asset will sit
  // permanently overdue until a human fixes it there.
  const STALE_DAYS = 60;
  const stale = assets.filter((a) => a.serviceStartDate && a.schedule.some((sch) =>
    (Date.parse(a.serviceStartDate!) - Date.parse(sch.nextDueAt)) / 86_400_000 > STALE_DAYS));
  if (stale.length) {
    const example = stale[0]!;
    const worst = example.schedule
      .filter((sch) => sch.nextDueAt < example.serviceStartDate!)
      .sort((x, y) => x.nextDueAt.localeCompare(y.nextDueAt))[0];
    warnings.push(
      `${stale.length} ${stale.length === 1 ? 'asset has a routine' : 'assets have a routine'} due more than ` +
      `two months before servicing started there — for example asset ${example.externalId ?? example.siteName} ` +
      `${worst ? `due ${worst.nextDueAt} against a start of ${example.serviceStartDate}` : ''}. ` +
      `These read as permanently overdue and look like wrong dates in the source system rather than real work.`,
    );
  }

  const vague = assets.filter((a) => a.lastOverhaul && a.lastOverhaul.precision === 'month').length;
  if (vague) {
    warnings.push(
      `${vague} overhaul ${vague === 1 ? 'date records' : 'dates record'} a month and year but no day, ` +
      `so the next one is due in that month rather than on a particular day.`,
    );
  }

  return {
    system: def?.system ?? 'unknown',
    systemLabel: def?.label ?? 'Unidentified system',
    assets,
    sites: [...siteCounts.values()].sort((a, b) => b.assetCount - a.assetCount),
    warnings,
    parser: PARSER_ID,
  };
}

/** The soonest of an asset's due dates, for the denormalised column on the row. */
export function soonestDue(schedule: RegisterAsset['schedule']): string | undefined {
  if (!schedule.length) return undefined;
  return schedule.map((s) => s.nextDueAt).sort()[0];
}

/**
 * A name for an asset that has none.
 *
 * The register does not carry one — it carries a location and a descriptor —
 * so one is built from what there is. A bare type name repeated four hundred
 * times is unusable in a list, and the location is what a technician navigates
 * by.
 */
export function assetName(asset: RegisterAsset): string {
  const parts = [asset.descriptor, asset.location].filter(Boolean);
  if (parts.length) return parts.join(' — ').slice(0, 120);
  const label = SYSTEM_LABEL[asset.system] ?? 'Asset';
  return asset.assetNumber ? `${label} ${asset.assetNumber}` : label;
}
