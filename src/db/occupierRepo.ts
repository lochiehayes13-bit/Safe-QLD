import { getDb, newId, nowIso } from './index';
import {
  OCCUPIER_STATEMENT_INSTALLATIONS,
  type OccupierStatementRow,
} from '@/domain/qldCompliance';
import type { StoredStatementRow } from '@/domain/occupierForm';
import { escapeLike, siteSearchClause } from '@/domain/siteSearch';

/**
 * A stored row: the statement's answer, plus what the asset register said
 * about the installation when the row was last filled from it. The register's
 * dates ride along in the same JSON so a statement opened next year still
 * shows what it was prepared against.
 */
export type OccupierRow = OccupierStatementRow & Pick<StoredStatementRow, 'lastMaintainedDate' | 'nextDueDate'>;

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
  rows: OccupierRow[];
  signedBy: string;
  signedPosition: string;
  signature?: string | null;
  signedAt?: string | null;
  sentToCommissionerAt?: string | null;
  /** The Simpro job this statement belongs to, if one has been picked. */
  jobExternalId?: string | null;
  /** That job's title, so the record still names it after the mirror moves on. */
  jobTitle?: string | null;
  /** When the statement was queued onto the job. */
  attachedAt?: string | null;
  /**
   * The site's name as the site table has it now, joined rather than stored.
   *
   * Absent where the caller did not ask for it. Not the same thing as
   * premisesName, which is what the statement itself says and is what the
   * occupier signed — a building renamed since does not change the document.
   */
  siteName?: string;
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
  'jobExternalId', 'jobTitle', 'attachedAt',
] as const;

type Column = (typeof COLUMNS)[number];

function hydrate(row: StatementRow): OccupierStatement {
  let rows: OccupierRow[] = [];
  try {
    const parsed: unknown = JSON.parse(row.rows);
    if (Array.isArray(parsed)) rows = parsed as OccupierRow[];
  } catch {
    rows = [];
  }
  return { ...row, rows: rows.length ? rows : emptyRows() };
}

/** One row per prescribed installation, in the order the statement lists them. */
export function emptyRows(): OccupierRow[] {
  return OCCUPIER_STATEMENT_INSTALLATIONS.map((installation) => ({
    installation,
    present: false,
    criticalDefectNoticeGiven: false,
  }));
}

/**
 * How many statements one page draws.
 *
 * The whole book of them, across 897 sites and a statement a year each, is not
 * a screenful and never was. Where the page cuts, the screen says so and the
 * search reaches past it, because the search runs in the database.
 */
const STATEMENT_PAGE = 300;

export interface OccupierStatementPage {
  rows: OccupierStatement[];
  /** Statements held within the filter, before the search. */
  total: number;
  /** How many the search matched, whether or not they all fit. */
  matching: number;
  capped: boolean;
}

/**
 * Statements for a site, or the ones matching what was typed.
 *
 * **Searchable by the building.** The module had no search box: every
 * statement the phone holds, every site the phone holds, read on every focus,
 * ordered by what is closest to being late, and nothing to type into. The
 * owner's "every site appears in every single module when searching a site"
 * had nothing to appear in — and this is the module where a building is the
 * only thing anybody looks a statement up by, because the statement is the
 * occupier's and the occupier is a building.
 *
 * The words match the statement's own premises name and address, the occupier,
 * who signed it, and then the site row through siteSearchClause — so this
 * module reaches a building by the same columns as every other: its name, its
 * address, its suburb, its postcode, its client, the office's reference and
 * the office's site number.
 *
 * **And the site's name is joined rather than looked up.** The screen read
 * every site on the phone to turn a statement's siteId into a name. One join
 * on a query already reading these rows.
 */
export async function listOccupierStatements(
  options: { siteId?: string; query?: string; unsentOnly?: boolean; limit?: number } = {},
): Promise<OccupierStatementPage> {
  const db = await getDb();
  // The filter and the search are kept apart so `total` can be counted within
  // the filter and before the words: "no statements yet" and "nothing matched
  // those words" are different news with different answers.
  const filter: string[] = [];
  const filterArgs: (string | number)[] = [];
  if (options.siteId) { filter.push('o.siteId = ?'); filterArgs.push(options.siteId); }
  if (options.unsentOnly) filter.push('o.sentToCommissionerAt IS NULL');

  const where = [...filter];
  const args = [...filterArgs];
  for (const word of (options.query ?? '').trim().split(/\s+/).filter(Boolean)) {
    const like = `%${escapeLike(word)}%`;
    const site = siteSearchClause(word, 's');
    where.push(`(o.premisesName LIKE ? ESCAPE '\\' OR o.premisesAddress LIKE ? ESCAPE '\\'
      OR o.occupierName LIKE ? ESCAPE '\\' OR o.signedBy LIKE ? ESCAPE '\\'${site ? ` OR ${site.where}` : ''})`);
    args.push(like, like, like, like, ...(site?.args ?? []));
  }

  const from = 'FROM occupier_statement o LEFT JOIN site s ON s.id = o.siteId';
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [counted, held] = await Promise.all([
    db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${clause}`, ...args),
    where.length === filter.length
      ? Promise.resolve(null)
      : db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n ${from} ${filter.length ? `WHERE ${filter.join(' AND ')}` : ''}`, ...filterArgs,
      ),
  ]);
  const matching = counted?.n ?? 0;

  const rows = await db.getAllAsync<StatementRow & { siteName: string | null }>(
    `SELECT o.*, s.name AS siteName ${from} ${clause}
     ORDER BY o.periodEnd DESC, o.createdAt DESC LIMIT ?`,
    ...args, options.limit ?? STATEMENT_PAGE,
  );

  return {
    rows: rows.map((r) => ({ ...hydrate(r), siteName: r.siteName ?? undefined })),
    // Without a search the two counts are the same thing, and counting it
    // twice would be a second query for an answer already in hand.
    total: held ? held.n : matching,
    matching,
    capped: matching > rows.length,
  };
}

/**
 * The last signed statement at each site, which is the portfolio's question.
 *
 * The portfolio read every statement the phone holds — each with its
 * installation rows as JSON along for the ride — to work out one date per
 * site: when the occupier last signed. Asked of the database instead. An
 * unsigned draft is not a statement the occupier has made, so it is not a
 * date, which is the same rule the portfolio applied in JavaScript and the
 * reason the filter is here rather than left to the caller.
 */
export async function latestSignedStatementBySite(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ siteId: string; signedAt: string }>(
    `SELECT siteId, MAX(signedAt) AS signedAt FROM occupier_statement
     WHERE signedAt IS NOT NULL AND TRIM(signedAt) <> '' GROUP BY siteId`,
  );
  return new Map(rows.map((r) => [r.siteId, r.signedAt]));
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
