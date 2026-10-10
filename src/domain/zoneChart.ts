import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import type { Point, Zone } from '@/domain/types';

/**
 * Building a zone chart from the panel's own configuration.
 *
 * The monthly routine already checks that the zone chart at the panel is
 * present, legible and matching the installed zones. When it fails, the useful
 * thing is not a defect — it is a correct chart, printed on the spot from the
 * configuration that was imported off that panel. A chart derived from the
 * config cannot disagree with the panel; one typed up in an office two years
 * ago always eventually does.
 *
 * This is the arrangement of that data, kept apart from the rendering so it can
 * be tested without producing a PDF.
 */

export interface ZoneChartRow {
  number: number;
  text: string;
  /** Second descriptor line where the panel carries one. */
  text2?: string;
  deviceCount: number;
  /** Device classes present, most common first — "12 detectors, 2 call points". */
  summary: string;
  /** Zone exists in the config but has nothing in it. */
  unused: boolean;
}

export interface ZoneChart {
  rows: ZoneChartRow[];
  totalZones: number;
  totalDevices: number;
  /** Zones with devices but no zone text, which is what makes a chart unusable. */
  untexted: number[];
  /** Points whose zone is not in the zone table at all. */
  orphanedPoints: number;
}

/**
 * Summarises the devices in a zone.
 *
 * Ordered by count so the chart reads as what the zone mostly is. Types are
 * named rather than counted generically because "8 detectors, 1 call point"
 * tells a responder where to look and "9 devices" does not.
 */
function summarise(points: Point[]): string {
  if (!points.length) return '';
  const counts = new Map<string, number>();
  for (const p of points) {
    const label = DEVICE_TYPE_LABEL[p.deviceType] ?? 'Device';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Counted with a multiplication sign rather than pluralised. Device labels
  // carry parentheticals — "Smoke (photo)" — and appending an s to those gives
  // "4 smoke (photo)s", which is how a generated chart announces it was
  // generated.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n} × ${label.toLowerCase()}`)
    .join(', ');
}

export function buildZoneChart(zones: Zone[], points: Point[], includeUnused = false): ZoneChart {
  const byZone = new Map<number, Point[]>();
  for (const p of points) {
    if (p.zoneNumber === undefined) continue;
    const list = byZone.get(p.zoneNumber) ?? [];
    list.push(p);
    byZone.set(p.zoneNumber, list);
  }

  const known = new Set(zones.map((z) => z.number));
  let orphanedPoints = 0;
  for (const [zoneNumber, list] of byZone) {
    if (!known.has(zoneNumber)) orphanedPoints += list.length;
  }

  const untexted: number[] = [];
  const rows: ZoneChartRow[] = [];

  for (const zone of [...zones].sort((a, b) => a.number - b.number)) {
    const devices = byZone.get(zone.number) ?? [];
    // A zone the panel marks unused and that holds nothing is noise on a chart
    // meant to be read at 2am, so it is left off unless asked for.
    if (!includeUnused && zone.unused && !devices.length) continue;

    if (devices.length && !zone.text.trim()) untexted.push(zone.number);

    rows.push({
      number: zone.number,
      text: zone.text.trim(),
      text2: zone.text2?.trim() || undefined,
      deviceCount: devices.length,
      summary: summarise(devices),
      unused: zone.unused && !devices.length,
    });
  }

  return {
    rows,
    totalZones: rows.length,
    totalDevices: rows.reduce((n, r) => n + r.deviceCount, 0),
    untexted,
    orphanedPoints,
  };
}

/**
 * Splits the chart into columns for printing.
 *
 * A zone chart is read standing at a panel, so it wants to be one page with
 * short columns rather than a long list that runs onto a second sheet nobody
 * puts back. Rows are dealt down each column in turn — reading order is
 * top-to-bottom then across, which is how a numbered list is scanned.
 */
export function columnise(rows: ZoneChartRow[], columns: number): ZoneChartRow[][] {
  if (columns < 1) return [rows];
  const perColumn = Math.ceil(rows.length / columns);
  if (!perColumn) return [];
  const out: ZoneChartRow[][] = [];
  for (let i = 0; i < rows.length; i += perColumn) {
    out.push(rows.slice(i, i + perColumn));
  }
  return out;
}

/**
 * How many columns suit this many zones on one page.
 *
 * Chosen so a chart stays on a single sheet up to the sizes that actually
 * occur: a 32-zone conventional panel reads well in two columns, a 500-zone
 * addressable site needs four and small type.
 */
export function suggestedColumns(rowCount: number): number {
  if (rowCount <= 24) return 1;
  if (rowCount <= 60) return 2;
  if (rowCount <= 150) return 3;
  return 4;
}
