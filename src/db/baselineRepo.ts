import { getDb, newId, nowIso } from './index';
import {
  emptyBaseline,
  type BaselineData,
  type SpeakerCircuit,
  type YesNo,
  type ZoneTestRow,
} from '@/domain/baseline';

/**
 * Baseline data persistence.
 *
 * The repeating tables and the two checklists are held as JSON columns: they
 * are small, always read and written whole, and keeping them together means the
 * form round-trips without a join per section.
 */

interface BaselineRow extends Omit<BaselineData, 'speakerCircuits' | 'equipment' | 'confirmations' | 'zoneResults'> {
  speakerCircuits: string;
  equipment: string;
  confirmations: string;
  zoneResults: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    const v: unknown = JSON.parse(json);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function hydrate(row: BaselineRow): BaselineData {
  return {
    ...row,
    speakerCircuits: parse<SpeakerCircuit[]>(row.speakerCircuits, []),
    equipment: parse<Record<string, YesNo>>(row.equipment, {}),
    confirmations: parse<Record<string, YesNo>>(row.confirmations, {}),
    zoneResults: parse<ZoneTestRow[]>(row.zoneResults, []),
  };
}

const COLUMNS = [
  'premisesName', 'premisesAddress', 'installType', 'alterationDetails', 'systemType',
  'owsAmplifier', 'monitoringProvider', 'speakerCircuits', 'equipment',
  'fullAlarmCurrentA', 'quiescentCurrentA', 'primaryPowerV', 'batteryVoltage', 'batteryAh',
  'batteryStandbyHours', 'batteryManufactureDate', 'batteryInstallDate',
  'confirmations', 'zoneResults', 'testerNames', 'testDate',
] as const;

function serialise(b: BaselineData): (string | null)[] {
  return COLUMNS.map((c) => {
    const v = b[c];
    if (typeof v === 'string') return v;
    return JSON.stringify(v ?? null);
  });
}

export async function listBaselines(siteId?: string): Promise<BaselineData[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<BaselineRow>('SELECT * FROM baseline WHERE siteId = ? ORDER BY updatedAt DESC', siteId)
    : await db.getAllAsync<BaselineRow>('SELECT * FROM baseline ORDER BY updatedAt DESC');
  return rows.map(hydrate);
}

export async function getBaseline(id: string): Promise<BaselineData | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<BaselineRow>('SELECT * FROM baseline WHERE id = ?', id);
  return row ? hydrate(row) : null;
}

export async function createBaseline(siteId: string, seed?: Partial<BaselineData>): Promise<BaselineData> {
  const db = await getDb();
  const b: BaselineData = { ...emptyBaseline(siteId, newId(), nowIso()), ...seed };
  await db.runAsync(
    `INSERT INTO baseline (id, siteId, ${COLUMNS.join(', ')}, createdAt, updatedAt)
     VALUES (?, ?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?)`,
    b.id, b.siteId, ...serialise(b), b.createdAt, b.updatedAt,
  );
  return b;
}

export async function saveBaseline(b: BaselineData): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE baseline SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`,
    ...serialise(b), nowIso(), b.id,
  );
}

export async function deleteBaseline(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM baseline WHERE id = ?', id);
}
