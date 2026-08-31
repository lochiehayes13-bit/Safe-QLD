import type { Point, Site, Zone } from '@/domain/types';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import type { BaselineData, ZoneTestRow } from '@/domain/baseline';
import { ZONE_TEST_ROW_COUNT } from '@/domain/baseline';

/**
 * Fills the baseline form from data the app already holds.
 *
 * The zone test table is the point of this. Once a device list is imported, the
 * app already knows zone 1 holds 24 smoke and 3 heat — writing that out by hand
 * for 32 zones is an hour of transcription and the most common place the form
 * goes stale. Existing entries are never overwritten, so a tech's own wording
 * always wins.
 */

/** Order device types appear in the summary — initiating devices first. */
const TYPE_ORDER = [
  'smoke', 'smoke-photo', 'smoke-ion', 'multi', 'heat', 'beam', 'aspirating',
  'duct', 'flame', 'mcp', 'sprinkler-flow', 'sprinkler-valve', 'gas',
  'sounder', 'sounder-strobe', 'strobe', 'module-input', 'module-output',
  'module-io', 'relay', 'isolator', 'wip', 'door-holder', 'unknown',
];

/**
 * Summarises a zone's devices the way the form asks for them,
 * e.g. "24 smoke, 3 heat".
 */
export function describeZoneDevices(points: Point[]): { qty: number; description: string } {
  const counts = new Map<string, number>();
  for (const p of points) {
    counts.set(p.deviceType, (counts.get(p.deviceType) ?? 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a[0]);
      const bi = TYPE_ORDER.indexOf(b[0]);
      // Unknown types sort last rather than first.
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map(([type, n]) => `${n} ${DEVICE_TYPE_LABEL[type as Point['deviceType']].toLowerCase()}`);

  return { qty: points.length, description: parts.join(', ') };
}

export interface AutofillSource {
  site: Site;
  zones: Zone[];
  points: Point[];
  /** Quiescent current in amps, from the battery calculation if one was done. */
  quiescentA?: number;
  alarmA?: number;
  batteryAh?: number;
  standbyHours?: number;
  /** Panel make and model, from the imported panel. */
  systemType?: string;
  technicianName?: string;
}

export interface AutofillResult {
  baseline: BaselineData;
  /** Human-readable list of what was filled, shown to the tech before applying. */
  filled: string[];
}

/**
 * Returns a copy of the baseline with blank fields filled from site data.
 *
 * Only blanks are touched. Anything already typed is left exactly as it is.
 */
export function autofillBaseline(current: BaselineData, src: AutofillSource): AutofillResult {
  const b: BaselineData = {
    ...current,
    speakerCircuits: current.speakerCircuits.map((c) => ({ ...c })),
    zoneResults: current.zoneResults.map((z) => ({ ...z })),
    equipment: { ...current.equipment },
    confirmations: { ...current.confirmations },
  };
  const filled: string[] = [];

  /**
   * Fields typed as plain string, which are the autofillable ones.
   *
   * The inner `string extends ...` check excludes literal unions such as
   * installType, so a free-text value can never be written into an enum field.
   */
  type StringField = {
    [K in keyof BaselineData]: BaselineData[K] extends string
      ? string extends BaselineData[K]
        ? K
        : never
      : never;
  }[keyof BaselineData];

  const setIfBlank = (key: StringField, value: string | undefined, label: string): void => {
    if (!value) return;
    if (!b[key].trim()) {
      b[key] = value;
      filled.push(label);
    }
  };

  setIfBlank('premisesName', src.site.name, 'Name of premises');
  setIfBlank(
    'premisesAddress',
    [src.site.address, src.site.suburb, src.site.state, src.site.postcode].filter(Boolean).join(' '),
    'Premises address',
  );
  setIfBlank('systemType', src.systemType, 'Type of system');
  setIfBlank('testerNames', src.technicianName, 'Tester name');

  if (src.quiescentA !== undefined) setIfBlank('quiescentCurrentA', src.quiescentA.toFixed(3), 'Quiescent current');
  if (src.alarmA !== undefined) setIfBlank('fullAlarmCurrentA', src.alarmA.toFixed(3), 'Full alarm current');
  if (src.batteryAh !== undefined) setIfBlank('batteryAh', String(src.batteryAh), 'Battery capacity');
  if (src.standbyHours !== undefined) setIfBlank('batteryStandbyHours', String(src.standbyHours), 'Battery standby hours');

  // Zone test table, derived from the imported device list.
  const byZone = new Map<number, Point[]>();
  for (const p of src.points) {
    if (p.zoneNumber === undefined || p.zoneNumber === null || p.unused) continue;
    const arr = byZone.get(p.zoneNumber) ?? [];
    arr.push(p);
    byZone.set(p.zoneNumber, arr);
  }

  let zonesFilled = 0;
  for (const row of b.zoneResults) {
    const points = byZone.get(row.zone);
    if (!points?.length) continue;
    if (row.qty.trim() || row.deviceTypes.trim()) continue;
    const { qty, description } = describeZoneDevices(points);
    row.qty = String(qty);
    row.deviceTypes = description;
    zonesFilled++;
  }

  if (zonesFilled) filled.push(`${zonesFilled} zone test row${zonesFilled === 1 ? '' : 's'}`);

  // Zones beyond the form's 32 rows still need recording somewhere.
  const beyond = [...byZone.keys()].filter((z) => z > ZONE_TEST_ROW_COUNT);
  if (beyond.length) {
    filled.push(`${beyond.length} zone(s) above ${ZONE_TEST_ROW_COUNT} not on the form — record separately`);
  }

  return { baseline: b, filled };
}
