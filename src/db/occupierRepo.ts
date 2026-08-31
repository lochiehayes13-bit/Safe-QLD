import { getDb, newId, nowIso } from './index';
import {
  OCCUPIER_STATEMENT_INSTALLATIONS,
  type OccupierStatementRow,
} from '@/domain/qldCompliance';

/**
 * Occupier statement persistence.
 *
 * The statement is the occupier's document, not ours — Queensland puts the duty
 * on them. What we can do is arrive with it already filled in from the year's
 * maintenance, so signing it is a reading exercise rather than a research one.
 */

export interface OccupierStatement {
  id: string;
  siteId: string;
  occupierName: string;
  occupierPhone: string;
  premisesName: string;
  premisesAddress: string;
  periodStart: string;
  periodEnd: string;
  rows: OccupierStatementRow[];
  signedBy: string;
  signedPosition: string;
  signature?: string | null;
  signedAt?: string | null;
  sentToCommissionerAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StatementRow extends Omit<OccupierStatement, 'rows'> {
  rows: string;
}

const COLUMNS = [
  'occupierName', 'occupierPhone', 'premisesName', 'premisesAddress',
  'periodStart', 'periodEnd', 'rows', 'signedBy', 'signedPosition',
  'signature', 'signedAt', 'sentToCommissionerAt',
] as const;

type Column = (typeof COLUMNS)[number];

function hydrate(row: StatementRow): OccupierStatement {
  let rows: OccupierStatementRow[] = [];
  try {
    const parsed: unknown = JSON.parse(row.rows);
    if (Array.isArray(parsed)) rows = parsed as OccupierStatementRow[];
  } catch {
    rows = [];
  }
  return { ...row, rows: rows.length ? rows : emptyRows() };
}

/** One row per prescribed installation, in the order the statement lists them. */
export function emptyRows(): OccupierStatementRow[] {
  return OCCUPIER_STATEMENT_INSTALLATIONS.map((installation) => ({
    installation,
    present: false,
    criticalDefectNoticeGiven: false,
  }));
}

export async function listOccupierStatements(siteId?: string): Promise<OccupierStatement[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<StatementRow>(
        'SELECT * FROM occupier_statement WHERE siteId = ? ORDER BY periodEnd DESC, createdAt DESC', siteId)
    : await db.getAllAsync<StatementRow>(
        'SELECT * FROM occupier_statement ORDER BY periodEnd DESC, createdAt DESC');
  return rows.map(hydrate);
}

export async function getOccupierStatement(id: string): Promise<OccupierStatement | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<StatementRow>('SELECT * FROM occupier_statement WHERE id = ?', id);
  return row ? hydrate(row) : null;
}

export async function createOccupierStatement(
  siteId: string,
  seed: Partial<Omit<OccupierStatement, 'id' | 'siteId' | 'createdAt' | 'updatedAt'>> = {},
): Promise<OccupierStatement> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO occupier_statement
       (id,siteId,occupierName,occupierPhone,premisesName,premisesAddress,periodStart,periodEnd,
        rows,signedBy,signedPosition,signature,signedAt,sentToCommissionerAt,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, siteId, seed.occupierName ?? '', seed.occupierPhone ?? '',
    seed.premisesName ?? '', seed.premisesAddress ?? '',
    seed.periodStart ?? '', seed.periodEnd ?? '',
    JSON.stringify(seed.rows ?? emptyRows()),
    seed.signedBy ?? '', seed.signedPosition ?? '',
    seed.signature ?? null, seed.signedAt ?? null, seed.sentToCommissionerAt ?? null,
    now, now,
  );
  const created = await getOccupierStatement(id);
  if (!created) throw new Error('Occupier statement could not be created');
  return created;
}

export async function updateOccupierStatement(
  id: string,
  patch: Partial<Pick<OccupierStatement, Column>>,
): Promise<void> {
  const entries = COLUMNS.filter((c) => c in patch);
  if (!entries.length) return;
  const db = await getDb();
  const values = entries.map((c) => {
    const v = patch[c];
    if (c === 'rows') return JSON.stringify(v ?? []);
    return (v as string | null | undefined) ?? null;
  });
  await db.runAsync(
    `UPDATE occupier_statement SET ${entries.map((c) => `${c} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`,
    ...values, nowIso(), id,
  );
}

export async function deleteOccupierStatement(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM occupier_statement WHERE id = ?', id);
}
