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

/**
 * A nullable column, read back as absent.
 *
 * Two things arrive here that mean "there is no job on this record": SQL NULL,
 * which the driver hands over as `null` while the type says `undefined`; and
 * the literal string "null", which is what the serialiser wrote before it knew
 * these columns could be absent. The second is the one that matters — it is
 * truthy, so a record nobody had linked came back claiming to be on a job
 * called "null". Rows written that way are still on disk and migrations here
 * are append-only, so the read is where they get put right.
 */
function absent(v: string | null | undefined): string | undefined {
  return v === null || v === undefined || v === '' || v === 'null' ? undefined : v;
}

function hydrate(row: BaselineRow): BaselineData {
  return {
    ...row,
    speakerCircuits: parse<SpeakerCircuit[]>(row.speakerCircuits, []),
    equipment: parse<Record<string, YesNo>>(row.equipment, {}),
    confirmations: parse<Record<string, YesNo>>(row.confirmations, {}),
    zoneResults: parse<ZoneTestRow[]>(row.zoneResults, []),
    jobExternalId: absent(row.jobExternalId),
    jobTitle: absent(row.jobTitle),
    attachedAt: absent(row.attachedAt),
  };
}

const COLUMNS = [
  'premisesName', 'premisesAddress', 'installType', 'alterationDetails', 'systemType',
  'owsAmplifier', 'monitoringProvider', 'speakerCircuits', 'equipment',
  'fullAlarmCurrentA', 'quiescentCurrentA', 'primaryPowerV', 'batteryVoltage', 'batteryAh',
  'batteryStandbyHours', 'batteryManufactureDate', 'batteryInstallDate',
  'confirmations', 'zoneResults', 'testerNames', 'testDate',
  // The v28 job link. Kept in the same list as everything else so a whole-record
  // save cannot leave it behind, which is what a separate update path would do
  // the first time somebody added a field and forgot.
  'jobExternalId', 'jobTitle', 'attachedAt',
] as const;

type Column = (typeof COLUMNS)[number];

/** The four columns that hold a repeating table or a checklist as JSON. */
const JSON_COLUMNS = new Set<Column>(['speakerCircuits', 'equipment', 'confirmations', 'zoneResults']);

/**
 * The columns that are allowed to be absent.
 *
 * Everything else on this form is TEXT NOT NULL DEFAULT '' — a field nobody
 * filled in is an empty string, and that is the right answer for a form. The
 * job link is not a form field: a baseline that has not been put on a job has
 * no job, and that is a different fact from "the job is blank".
 */
const NULLABLE_COLUMNS = new Set<Column>(['jobExternalId', 'jobTitle', 'attachedAt']);

/**
 * The record as a row, in COLUMNS order.
 *
 * This used to decide what to write by looking at the runtime type: a string
 * went in as itself and anything else went through JSON.stringify. That worked
 * for as long as every column was a TEXT NOT NULL the form always filled, and
 * broke the moment something was allowed to be absent — because
 * `JSON.stringify(undefined ?? null)` is not SQL NULL, it is the four-letter
 * string "null", and "null" is truthy. A baseline nobody had linked to
 * anything came back claiming to be on a job called "null", and the card
 * offered to send the workbook to it.
 *
 * So the columns say what they are instead of the values being guessed at.
 */
function serialise(b: BaselineData): (string | null)[] {
  return COLUMNS.map((c) => {
    const v = b[c];
    if (JSON_COLUMNS.has(c)) return JSON.stringify(v ?? null);
    if (NULLABLE_COLUMNS.has(c)) return typeof v === 'string' && v !== '' ? v : null;
    return typeof v === 'string' ? v : '';
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
