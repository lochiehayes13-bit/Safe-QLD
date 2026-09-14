import type { DeviceType, PanelBrand, ParsedConfig } from '@/domain/types';

/**
 * The configurations a phone is holding.
 *
 * Until this existed there was one thing you could do with a panel config:
 * import it. That writes its devices, zones and logic into a site and is not
 * reversible, so the only way to look inside a file was to commit to it —
 * which is the wrong shape for most of the reasons anybody opens one. A
 * technician handed a .nle by a builder wants to know whether it is even the
 * right building before it touches the register. Somebody standing at a panel
 * that is behaving oddly wants to read what is programmed, not merge it with
 * what the office holds. And a config that has been superseded twice is worth
 * keeping precisely because it has been: the difference between two versions
 * is the record of what somebody changed.
 *
 * So a config opened here is kept as a file, not as rows. The bytes go into
 * document storage, a row records what they are, and the contents are re-read
 * from the file each time. That costs a parse on every open and buys three
 * things worth more: the file is never altered, nothing is committed until
 * somebody says so, and the same file can be read twice by two different
 * builds of the app and give two different answers — which is what happens
 * every time a parser is improved.
 *
 * This module is the policy and holds no file system and no database. What a
 * record is, when two of them are the same file, what the copy is called, and
 * what a summary says.
 */

/** Device classes present, biggest first. */
export interface DeviceCount {
  type: DeviceType;
  count: number;
}

/** What is in a config, counted once at open so a list needs no parsing. */
export interface ConfigSummary {
  panels: number;
  loops: number;
  zones: number;
  points: number;
  /** Cause-and-effect rules across every panel in the file. */
  rules: number;
  /** Points the file marks as spare or unfitted. Counted inside `points`. */
  unused: number;
  /** What the parser said it could not do. */
  warnings: string[];
  breakdown: DeviceCount[];
}

export interface ConfigFileRecord {
  id: string;
  /** The name the file had when it was picked, kept verbatim. */
  fileName: string;
  byteLength: number;
  /** Content fingerprint. Two records with the same one are the same bytes. */
  fingerprint: string;
  /** The catalogue entry that read it, or absent where nothing could. */
  parserId?: string;
  brand: PanelBrand;
  model?: string;
  /** The site name the file carries itself, where it carries one. */
  siteNameInFile?: string;
  /** The site in this app somebody has tied it to. */
  siteId?: string;
  siteName?: string;
  openedAt: string;
  lastOpenedAt: string;
  /** When its contents were written into a site, where they have been. */
  importedAt?: string;
  summary: ConfigSummary;
  note?: string;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * A fingerprint over every byte of the file.
 *
 * Every byte on purpose. A fingerprint taken over the first and last few
 * kilobytes is enormously cheaper and answers the wrong question: two
 * configurations for the same building, a year apart, differ somewhere in the
 * middle and agree at both ends. Sampling would call them the same file, and
 * the one screen that most needs this — what changed between these two
 * versions — would open holding two copies of the same thing and report no
 * change at all.
 *
 * Two passes with different bases rather than one, because a single 32-bit
 * hash over a library that will hold hundreds of near-identical files is a
 * collision waiting to be someone's bad afternoon. The length is mixed in as
 * well, so a file that is another file with a run of zeroes on the end cannot
 * land on it.
 *
 * FNV-1a rather than a real digest because there is no cryptographic question
 * here and nothing is being defended: the file is not hostile, it came off a
 * laptop in the same van. It costs one pass over the bytes, which on the
 * largest configuration this app has seen is a few milliseconds.
 */
export function fingerprint(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    a ^= byte;
    // The FNV prime, as a sum of shifts: Math.imul is the only multiply that
    // stays exact at 32 bits in JavaScript, and a plain * silently goes
    // through a double and loses the low bits.
    a = Math.imul(a, 0x01000193);
    b ^= byte;
    b = Math.imul(b, 0x811c9dc5);
  }
  return hex8(a >>> 0) + hex8(b >>> 0) + hex8(bytes.length >>> 0);
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** The record for these exact bytes, where the library already holds it. */
export function alreadyOpen(
  library: readonly ConfigFileRecord[],
  print: string,
): ConfigFileRecord | undefined {
  return library.find((r) => r.fingerprint === print);
}

/**
 * The extension of a file name, with the dot, or nothing where there is none.
 *
 * Kept because the bytes are read back out of the database with no name
 * attached, and `classifyBytes` falls back to the extension when no signature
 * and no content sniff matches — which is the whole of how a plain CSV export
 * is recognised.
 *
 * Capped at eight characters: a 40-character tail after the last dot is not an
 * extension, it is part of a name somebody put a full stop in.
 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  const ext = fileName.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

// ---------------------------------------------------------------------------
// Summarising
// ---------------------------------------------------------------------------

/** What a parsed config holds, counted across every panel in it. */
export function summarise(parsed: ParsedConfig): ConfigSummary {
  const counts = new Map<DeviceType, number>();
  let points = 0;
  let unused = 0;
  let loops = 0;
  let zones = 0;
  let rules = 0;

  for (const panel of parsed.panels) {
    loops += panel.loops.length;
    zones += panel.zones.length;
    rules += panel.causeEffect.length;
    for (const point of panel.points) {
      points++;
      if (point.unused) unused++;
      counts.set(point.deviceType, (counts.get(point.deviceType) ?? 0) + 1);
    }
  }

  return {
    panels: parsed.panels.length,
    loops,
    zones,
    points,
    rules,
    unused,
    warnings: [...parsed.warnings],
    breakdown: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

/** An empty summary, for a file nothing could read. */
export function emptySummary(warnings: string[] = []): ConfigSummary {
  return { panels: 0, loops: 0, zones: 0, points: 0, rules: 0, unused: 0, warnings, breakdown: [] };
}

/**
 * One line under a file's name in the library.
 *
 * Devices first because that is the number anybody asked for, and only the
 * parts that are non-zero: "0 zones" on a device list exported from a CSV is
 * a fact about the export path, not about the building, and it reads as a
 * fault.
 */
export function describeSummary(summary: ConfigSummary): string {
  const parts: string[] = [];
  if (summary.points) parts.push(`${summary.points.toLocaleString()} device${summary.points === 1 ? '' : 's'}`);
  if (summary.zones) parts.push(`${summary.zones.toLocaleString()} zone${summary.zones === 1 ? '' : 's'}`);
  if (summary.loops) parts.push(`${summary.loops.toLocaleString()} loop${summary.loops === 1 ? '' : 's'}`);
  if (summary.panels > 1) parts.push(`${summary.panels} panels`);
  if (summary.rules) parts.push(`${summary.rules.toLocaleString()} rule${summary.rules === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Nothing this build can read';
}

// ---------------------------------------------------------------------------
// The library as a list
// ---------------------------------------------------------------------------

/** Files that appear to describe the same building, newest first. */
export interface ConfigVersions {
  /** What the building is called: the file's own site name, else the file name. */
  label: string;
  /** Newest opened first. Never empty. */
  records: ConfigFileRecord[];
}

/**
 * The library grouped by building.
 *
 * Grouped on the site name the file carries, falling back to the file's name
 * with its version-ish tail removed, because the two ways a second copy of a
 * configuration arrives are `SITE.nle` again and `SITE rev C.nle`.
 *
 * The fallback is deliberately weak. Merging two buildings that are not the
 * same one is the failure that matters: the comparison screen would then
 * report every device in one of them as removed. So a file with no site name
 * in it only groups with another whose name matches after the tail is taken
 * off, and nothing here reaches across different site names.
 */
export function byBuilding(library: readonly ConfigFileRecord[]): ConfigVersions[] {
  const groups = new Map<string, ConfigFileRecord[]>();
  for (const record of library) {
    const key = buildingKey(record);
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

  return [...groups.values()]
    .map((records) => {
      const sorted = [...records].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
      const newest = sorted[0]!;
      return { label: newest.siteNameInFile?.trim() || newest.fileName, records: sorted };
    })
    .sort((a, b) => (b.records[0]?.lastOpenedAt ?? '').localeCompare(a.records[0]?.lastOpenedAt ?? ''));
}

/** What the app considers the same building, lowercased for comparison. */
export function buildingKey(record: ConfigFileRecord): string {
  const site = record.siteNameInFile?.trim().toLowerCase();
  if (site) return `site:${site}`;
  return `file:${stemOf(record.fileName)}`;
}

/**
 * A file name with its extension and a trailing revision marker removed.
 *
 * `SITE rev C.nle`, `SITE v2.nle`, `SITE (3).nle` and `SITE - Copy.nle` are all
 * the same building. Anything else is left alone: a name is the only evidence
 * there is here, and trimming further would start joining buildings.
 */
export function stemOf(fileName: string): string {
  const ext = extensionOf(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return base
    .replace(/\s*[-–]\s*copy\s*$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[\s_-]+(rev|revision|ver|version|v)\s*[.\s]*[a-z0-9]{1,4}\s*$/i, '')
    .trim()
    .toLowerCase();
}
