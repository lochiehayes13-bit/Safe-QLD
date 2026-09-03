/**
 * Safe QLD baseline data record.
 *
 * Mirrors the company's own "TEST RESULTS, BASELINE DATA" form field for field,
 * so what the app exports is the document the office already expects rather
 * than a lookalike. Anything the app already knows — zone counts, device
 * breakdowns, quiescent and alarm current from the battery calculation — is
 * filled in automatically, and stays editable.
 */

import { qldIsoDay } from '@/domain/qldTime';

export type YesNo = 'YES' | 'NO' | 'N/A' | '';

export type InstallType = 'New install' | 'Alteration' | '';

/** One row of the OWS speaker circuit table. */
export interface SpeakerCircuit {
  zone: number;
  impedanceOhms: string;
  loadW: string;
}

/** One row of the zone test results table. */
export interface ZoneTestRow {
  zone: number;
  qty: string;
  /** Free text, e.g. "24 smoke, 3 heat A & Other". */
  deviceTypes: string;
}

/** Equipment-fitted checklist, in the order the form prints them. */
export const EQUIPMENT_ITEMS = [
  'OWS amplifiers',
  'External strobe',
  'Internal strobes',
  'Mechanical plant shutdown',
  'EV shutdown',
  'Security interface',
  'Warden phones',
] as const;

export type EquipmentItem = (typeof EQUIPMENT_ITEMS)[number];

/** Confirmation checklist, in the order the form prints them. */
export const CONFIRMATION_ITEMS = [
  '100% of the fire system tested',
  'Zoning correct per location diagram and AS 1670.1',
  'Installation complete and fully tested',
  'Detectors suit the environmental conditions',
  'AC plant shutdown',
  'Fan controls override MSSB manual controls',
  'All AS 1668.1 fans operate automatically',
  'Baseline data provided in the client manual',
] as const;

export type ConfirmationItem = (typeof CONFIRMATION_ITEMS)[number];

export const SPEAKER_CIRCUIT_COUNT = 8;
export const ZONE_TEST_ROW_COUNT = 32;

export interface BaselineData {
  id: string;
  siteId: string;

  // System details
  premisesName: string;
  premisesAddress: string;
  installType: InstallType;
  alterationDetails: string;
  /** Panel make, e.g. "Ampac" or "Pertronic". */
  systemType: string;
  /** Amplifier size and quantity, in watts. */
  owsAmplifier: string;
  monitoringProvider: string;

  speakerCircuits: SpeakerCircuit[];
  equipment: Record<string, YesNo>;

  // FDCIE readings
  fullAlarmCurrentA: string;
  quiescentCurrentA: string;
  primaryPowerV: string;
  batteryVoltage: string;
  batteryAh: string;
  /** Standby hours the battery is sized for. */
  batteryStandbyHours: string;
  batteryManufactureDate: string;
  batteryInstallDate: string;

  confirmations: Record<string, YesNo>;
  zoneResults: ZoneTestRow[];

  testerNames: string;
  testDate: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * Another row on the end of a numbered table.
 *
 * The printed form has eight speaker circuits and thirty-two zones because
 * that is what fits on the page, not because a building cannot have more — and
 * the ones that do are exactly the buildings where the baseline matters. The
 * numbering carries on from the highest row rather than the count, so a table
 * somebody has already renumbered does not suddenly repeat itself.
 */
export function addZoneRow(rows: readonly ZoneTestRow[]): ZoneTestRow[] {
  return [...rows, { zone: nextNumber(rows), qty: '', deviceTypes: '' }];
}

export function addSpeakerCircuit(rows: readonly SpeakerCircuit[]): SpeakerCircuit[] {
  return [...rows, { zone: nextNumber(rows), impedanceOhms: '', loadW: '' }];
}

/**
 * Taking a row off the end.
 *
 * Only ever the last one, and only while it is empty: a row in the middle
 * carries a zone number that the device list, the block plan and the panel all
 * agree on, and renumbering the ones below it to close a gap would quietly
 * make the form disagree with the building.
 */
export function canDropLastRow(rows: readonly { zone: number }[], minimum: number): boolean {
  if (rows.length <= minimum) return false;
  const last = rows[rows.length - 1] as ZoneTestRow & SpeakerCircuit;
  return !(last.qty ?? '').trim() && !(last.deviceTypes ?? '').trim()
    && !(last.impedanceOhms ?? '').trim() && !(last.loadW ?? '').trim();
}

function nextNumber(rows: readonly { zone: number }[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.zone), 0) + 1;
}

/** A blank record with the tables pre-sized to the form's row counts. */
export function emptyBaseline(siteId: string, id: string, now: string): BaselineData {
  return {
    id,
    siteId,
    premisesName: '',
    premisesAddress: '',
    installType: '',
    alterationDetails: '',
    systemType: '',
    owsAmplifier: '',
    monitoringProvider: '',
    speakerCircuits: Array.from({ length: SPEAKER_CIRCUIT_COUNT }, (_, i) => ({
      zone: i + 1,
      impedanceOhms: '',
      loadW: '',
    })),
    equipment: Object.fromEntries(EQUIPMENT_ITEMS.map((k) => [k, '' as YesNo])),
    fullAlarmCurrentA: '',
    quiescentCurrentA: '',
    primaryPowerV: '',
    batteryVoltage: '24',
    batteryAh: '',
    batteryStandbyHours: '24',
    batteryManufactureDate: '',
    batteryInstallDate: '',
    confirmations: Object.fromEntries(CONFIRMATION_ITEMS.map((k) => [k, '' as YesNo])),
    zoneResults: Array.from({ length: ZONE_TEST_ROW_COUNT }, (_, i) => ({
      zone: i + 1,
      qty: '',
      deviceTypes: '',
    })),
    testerNames: '',
    // The Queensland day, not the UTC one: a form started at half past eight
    // in the morning is still stamped the previous day in UTC.
    testDate: qldIsoDay(now) ?? '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Sum of the zone quantity column, matching the form's total row. */
export function zoneQtyTotal(rows: ZoneTestRow[]): number {
  return rows.reduce((n, r) => {
    const v = parseInt(r.qty, 10);
    return n + (Number.isFinite(v) ? v : 0);
  }, 0);
}

export interface BaselineCompleteness {
  /** 0 to 1. */
  fraction: number;
  filled: number;
  total: number;
  missing: string[];
}

/**
 * How much of the form is done.
 *
 * Only the fields the office actually chases are counted — the zone table is
 * treated as one item rather than 32, so a small system is not permanently
 * stuck at 20%.
 */
export function completeness(b: BaselineData): BaselineCompleteness {
  const checks: { label: string; done: boolean }[] = [
    { label: 'Name of premises', done: !!b.premisesName.trim() },
    { label: 'Premises address', done: !!b.premisesAddress.trim() },
    { label: 'New install or alteration', done: !!b.installType },
    { label: 'Type of system', done: !!b.systemType.trim() },
    { label: 'Monitoring provider', done: !!b.monitoringProvider.trim() },
    { label: 'Full alarm current', done: !!b.fullAlarmCurrentA.trim() },
    { label: 'Quiescent current', done: !!b.quiescentCurrentA.trim() },
    { label: 'Primary power and source', done: !!b.primaryPowerV.trim() },
    { label: 'Battery capacity', done: !!b.batteryAh.trim() },
    { label: 'Battery install date', done: !!b.batteryInstallDate.trim() },
    { label: 'Equipment fitted', done: Object.values(b.equipment).some((v) => v !== '') },
    { label: 'Confirmations', done: Object.values(b.confirmations).every((v) => v !== '') },
    { label: 'Zone test results', done: b.zoneResults.some((r) => r.qty.trim() || r.deviceTypes.trim()) },
    { label: 'Tester name', done: !!b.testerNames.trim() },
    { label: 'Test date', done: !!b.testDate.trim() },
  ];

  const filled = checks.filter((c) => c.done).length;
  return {
    fraction: filled / checks.length,
    filled,
    total: checks.length,
    missing: checks.filter((c) => !c.done).map((c) => c.label),
  };
}
