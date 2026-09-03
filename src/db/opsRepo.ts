import { getDb, newId, nowIso } from './index';
import { queueKey } from '@/domain/queueKey';
import { workCompletedNote, type WorkCompletedRun } from '@/domain/outboundWork';
import { jobIsMine, type JobListFilter } from '@/domain/jobPresentation';
import type { WhoseSchedule } from '@/domain/myDay';
import { QLD_UTC_OFFSET_HOURS } from '@/domain/qldTime';
import { flushSoon } from '@/simpro/flushSoon';
import { defectByCode, type Severity } from '@/seed/defectLibrary';

/**
 * Operations persistence: jobs, defects, impairments, stock, promises and
 * company knowledge.
 *
 * These are the records that make the app a day's work rather than a form.
 */

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return (JSON.parse(s) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobRecord {
  id: string;
  externalId?: string;
  siteId?: string;
  siteName: string;
  customerName?: string;
  title: string;
  jobType?: string;
  stage?: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  scheduledFor?: string;
  dueAt?: string;
  technician?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  status: 'scheduled' | 'in-progress' | 'complete' | 'blocked';
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;

  // ---- The Simpro mirror (v18). Every field below is the office's to set;
  // ---- the sync writes them whole and nothing on the phone edits them.
  orderNo?: string;
  requestNo?: string;
  statusName?: string;
  /** Simpro's status colour, a hex string like "#f5a623", for the pill. */
  statusColor?: string;
  stageRaw?: string;
  jobTypeRaw?: string;
  customerExternalId?: string;
  /** The office's site id, kept even where no local site matched. */
  siteExternalId?: string;
  /** JSON of a SimproContact, or null. See readJobJson in mirrorRepo. */
  siteContactJson?: string;
  /** JSON of SimproPerson[]. */
  techniciansJson?: string;
  /** JSON of string[]. */
  tagsJson?: string;
  projectManager?: string;
  /** The office's description, HTML stripped. */
  descriptionText?: string;
  /** The office's notes field on the job, HTML stripped. Detail-level: only a detail sync fills it. */
  notesText?: string;
  /** The office's completion date, yyyy-mm-dd. A day, not an instant, unlike completedAt. */
  completedDate?: string;
  totalExTaxCents?: number;
  totalIncTaxCents?: number;
  convertedFromQuoteId?: string;
  /** JSON of a SimproContract, or null. Detail-level. */
  customerContractJson?: string;
  /** Simpro's own DateModified on the job. */
  dateModified?: string;
  /** When the job's children were last read. Null until somebody opens it or is booked to it. */
  detailSyncedAt?: string;
}

/**
 * Open work first, soonest first; finished work after it, newest first.
 *
 * The order used to be priority then date, ascending, which was fine while
 * the phone held the five hundred most recently changed jobs. It holds every
 * job on the books now, and ascending by date under a cap of five hundred is
 * the five hundred oldest — 2019's jobs on every screen and this week's on
 * none. Finished work is turned the other way so a picker looking for last
 * week's job finds it inside the cap.
 *
 * One string, used by every list of jobs, so a page and its count and the
 * full read cannot disagree about which job comes first.
 */
const JOB_LIST_ORDER = `ORDER BY CASE WHEN status = 'complete' THEN 1 ELSE 0 END,
              CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              CASE WHEN status = 'complete' THEN '' ELSE COALESCE(scheduledFor, '') END,
              COALESCE(scheduledFor, '') DESC`;

/**
 * A job's stage, folded the way jobPresentation folds it: the office's own
 * word where there is one, trimmed and lowered, and an empty string for a job
 * added by hand that has no stage at all.
 *
 * Written as one expression so an index can hold it — see migration v21.
 */
export const JOB_STAGE_KEY = "LOWER(TRIM(COALESCE(stageRaw, stage, '')))";

/**
 * A job still open, in SQL: neither the office nor this phone has closed it.
 *
 * The same sentence as jobPresentation.jobIsOpen — no stage at all, or a
 * stage of Pending or Progress, and not completed on this phone — because the
 * Open tab, the count on a site card and the count on a customer card are
 * this sentence three times over and a technician reads them beside each
 * other. It was written twice before; the mirror's copy compared the stage
 * exactly and against NULL only, so a hand-typed "pending " counted as closed
 * on the card and open in the tab.
 */
export const JOB_IS_OPEN = `status <> 'complete' AND ${JOB_STAGE_KEY} IN ('', 'pending', 'progress')`;

/**
 * The Queensland calendar day a job was issued on, in SQL.
 *
 * The same rule as qldIsoDay, which the Today filter used before this ran in
 * the database: a date-only value is already a calendar day and is left
 * alone, an instant is moved by Queensland's ten hours before the day is read
 * off it, and anything else is no day at all rather than a guess. Between
 * midnight and 10am the UTC day is yesterday's, and this company starts at
 * seven.
 */
const JOB_QLD_DAY = `CASE
       WHEN scheduledFor GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN scheduledFor
       WHEN scheduledFor GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'
         THEN substr(datetime(scheduledFor, '+${QLD_UTC_OFFSET_HOURS} hours'), 1, 10)
     END`;

export async function listJobs(filter: { status?: JobRecord['status']; onDate?: string; limit?: number } = {}): Promise<JobRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter.onDate) { where.push('substr(scheduledFor,1,10) = ?'); args.push(filter.onDate); }
  args.push(filter.limit ?? 200);
  return db.getAllAsync<JobRecord>(
    `SELECT * FROM job ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ${JOB_LIST_ORDER}
     LIMIT ?`,
    ...args,
  );
}

/** The columns a job list reads: everything the row and the filter look at, none of the JSON or the long text. */
const JOB_SUMMARY_COLUMNS = [
  'id', 'externalId', 'siteId', 'siteName', 'customerName', 'customerExternalId', 'title', 'address', 'orderNo',
  'status', 'statusName', 'statusColor', 'stage', 'stageRaw', 'jobType', 'jobTypeRaw', 'priority',
  'scheduledFor', 'dueAt', 'completedDate', 'completedAt', 'startedAt', 'technician', 'techniciansJson',
] as const;

export type JobSummary = Pick<JobRecord, (typeof JOB_SUMMARY_COLUMNS)[number]>;

/**
 * The same rows as listJobs, in the same order, without the description,
 * the office notes, the contact, the contract and the tags.
 *
 * The job list reads every job on the books on every focus so the search
 * and the "N of M" line stay instant; with the JSON columns along for the
 * ride that was most of the bytes for none of the pixels.
 */
export async function listJobSummaries(filter: { status?: JobRecord['status']; onDate?: string; limit?: number } = {}): Promise<JobSummary[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter.onDate) { where.push('substr(scheduledFor,1,10) = ?'); args.push(filter.onDate); }
  args.push(filter.limit ?? 200);
  return db.getAllAsync<JobSummary>(
    `SELECT ${JOB_SUMMARY_COLUMNS.join(', ')} FROM job ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ${JOB_LIST_ORDER}
     LIMIT ?`,
    ...args,
  );
}

// ---------------------------------------------------------------------------
// The job list as a query, rather than as a read of everything
// ---------------------------------------------------------------------------

/**
 * A word typed into a search, as a LIKE pattern.
 *
 * The literal wildcards are escaped, because a technician who types a site
 * called "A_B" means the underscore. A leading # is dropped the way the
 * in-memory match drops it: the number is written both "#43747" and "43747"
 * on the phone, on the job card and over the radio.
 */
function likeWord(word: string): string {
  return `%${word.replace(/^#/, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The words of a search, as jobMatchesQuery splits them. */
function searchWords(query: string | undefined): string[] {
  return (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The columns a job search looks in, which are the ones jobMatchesQuery joins
 * into its haystack. A word has to appear in one of them; every word has to
 * appear somewhere. Splitting the haystack per column is the same test — a
 * word cannot span two of them, because the words were split on whitespace.
 */
const JOB_SEARCH_COLUMNS = ['externalId', 'siteName', 'customerName', 'title', 'address', 'orderNo'] as const;

export interface JobPageQuery {
  filter: JobListFilter;
  /** The Queensland day, yyyy-mm-dd, for Today. */
  today: string;
  /** Whose phone this is, for Mine. Null where nobody has said. */
  who?: WhoseSchedule | null;
  query?: string;
  /** Opened from a site, or from a customer: only theirs. */
  siteId?: string;
  customerExternalId?: string;
  /** How many rows the screen will draw. */
  limit?: number;
}

export interface JobPage {
  rows: JobSummary[];
  /** How many jobs the filter and the search match, whether or not they all fit. */
  matching: number;
  /** How many jobs the phone holds in this scope at all, filter and search aside. */
  total: number;
  /** Whether the rows are a page of the matches rather than every one of them. */
  capped: boolean;
}

/**
 * The rows a job screen shows, chosen by the database.
 *
 * The list used to read every job on the books on every focus — four and a
 * half thousand rows, with their JSON columns, re-read every time a
 * technician backed out of a job — and then apply the filter and the search
 * in JavaScript. On the twenty rows a test writes that is instant. On the
 * owner's phone it is a second of nothing happening each time, which is what
 * a technician means when they say the module is broken.
 *
 * So the filter, the search and the cap are the query. What comes back is one
 * screenful in the same order as before, plus the two numbers the line above
 * the list needs: how many match, and how many the phone holds. Both are
 * counts rather than lengths, so "692 of 4,562 jobs" is still true when only
 * three hundred rows were read.
 *
 * Mine is the one filter that cannot be settled in SQL alone. Whether a job
 * is booked to this person is a question about the office's technicians list,
 * which is JSON on the row, and jobPresentation.jobIsMine is the answer — by
 * employee id where the phone knows one, by name otherwise, against both the
 * list and the joined names a hand-added job carries. So SQL narrows to the
 * open jobs that so much as mention this person and jobIsMine settles it over
 * those few. Narrowing with LIKE can only ever offer too many rows, never too
 * few, so the answer is jobIsMine's own.
 */
export async function listJobPage(q: JobPageQuery): Promise<JobPage> {
  const db = await getDb();
  const limit = q.limit ?? 300;
  const scope: string[] = [];
  const scopeArgs: (string | number)[] = [];
  if (q.siteId) { scope.push('siteId = ?'); scopeArgs.push(q.siteId); }
  if (q.customerExternalId) { scope.push('customerExternalId = ?'); scopeArgs.push(q.customerExternalId); }

  const where = [...scope];
  const args = [...scopeArgs];

  switch (q.filter) {
    case 'open':
    case 'mine':
      where.push(`(${JOB_IS_OPEN})`);
      break;
    case 'today':
      // The schedule's word first — a block on today's schedule is today's
      // work whatever the job's issue date says — and the issue date second,
      // for a phone whose schedule has not synced. No status condition at
      // all: a job finished at ten this morning is still today's work.
      where.push(`(
        (externalId IS NOT NULL AND externalId IN (SELECT jobId FROM schedule WHERE date = ? AND jobId IS NOT NULL))
        OR ${JOB_QLD_DAY} = ?
      )`);
      args.push(q.today, q.today);
      break;
    default:
      break;
  }

  for (const word of searchWords(q.query)) {
    where.push(`(${JOB_SEARCH_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (const _ of JOB_SEARCH_COLUMNS) args.push(likeWord(word));
  }

  if (q.filter === 'mine') {
    // Nobody has said whose phone this is, so nothing is booked to them.
    if (!q.who) return { rows: [], matching: 0, total: await countJobs(db, scope, scopeArgs), capped: false };
    const mentions = q.who.by === 'id'
      // SimproPerson writes its id as a string; the unquoted form is matched
      // too so a future numeric id cannot silently empty this tab.
      ? [`(techniciansJson LIKE ? ESCAPE '\\' OR techniciansJson LIKE ? ESCAPE '\\')`, likeWord(`"id":"${q.who.staffId}"`), likeWord(`"id":${q.who.staffId}`)] as const
      : [`(techniciansJson LIKE ? ESCAPE '\\' OR technician LIKE ? ESCAPE '\\')`, likeWord(q.who.staffName), likeWord(q.who.staffName)] as const;
    where.push(mentions[0]);
    args.push(mentions[1], mentions[2]);
    const candidates = await db.getAllAsync<JobSummary>(
      `SELECT ${JOB_SUMMARY_COLUMNS.join(', ')} FROM job WHERE ${where.join(' AND ')} ${JOB_LIST_ORDER}`,
      ...args,
    );
    const mine = candidates.filter((j) => jobIsMine(j, q.who ?? null));
    return {
      rows: mine.slice(0, limit),
      matching: mine.length,
      total: await countJobs(db, scope, scopeArgs),
      capped: mine.length > limit,
    };
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Under All with nothing typed there is no filter beyond the scope, so the
  // two numbers over the list are the same number: counted once.
  const narrowed = where.length > scope.length;
  const [rows, matching, total] = await Promise.all([
    db.getAllAsync<JobSummary>(
      `SELECT ${JOB_SUMMARY_COLUMNS.join(', ')} FROM job ${clause} ${JOB_LIST_ORDER} LIMIT ?`,
      ...args, limit,
    ),
    narrowed ? db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM job ${clause}`, ...args) : null,
    countJobs(db, scope, scopeArgs),
  ]);
  const n = narrowed ? (matching?.n ?? 0) : total;
  return { rows, matching: n, total, capped: n > limit };
}

/** How many jobs the phone holds in a scope, whatever the filter says. */
async function countJobs(
  db: Awaited<ReturnType<typeof getDb>>,
  scope: readonly string[],
  args: readonly (string | number)[],
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM job ${scope.length ? `WHERE ${scope.join(' AND ')}` : ''}`,
    ...args,
  );
  return row?.n ?? 0;
}

/** The little a picker needs off a job: the office's number, where it is, and whether it is still on. */
export type JobPick = Pick<JobRecord, 'externalId' | 'siteName' | 'siteId' | 'status'>;

/**
 * The open jobs a picker offers, newest first.
 *
 * The timesheet's job picker read four hundred whole job rows — description,
 * office notes, contact, contract, tags — to build a list of job numbers and
 * site names, and then threw away every complete one. Four columns, and only
 * the jobs that could be offered.
 */
export async function openJobPicks(limit = 400): Promise<JobPick[]> {
  const db = await getDb();
  return db.getAllAsync<JobPick>(
    `SELECT externalId, siteName, siteId, status FROM job
     WHERE ${JOB_IS_OPEN} AND externalId IS NOT NULL
     ${JOB_LIST_ORDER} LIMIT ?`,
    limit,
  );
}

/**
 * The jobs behind a set of office job numbers.
 *
 * The home screen resolves the handful of blocks on today's schedule to the
 * jobs they belong to. It used to do that by reading three hundred jobs and
 * looking through them, which found the right one only if it happened to be
 * inside the three hundred — and missed a job scheduled for today that was
 * issued last year, which is most of a maintenance contract.
 */
export async function jobSummariesByExternalIds(externalIds: readonly string[]): Promise<JobSummary[]> {
  const wanted = [...new Set(externalIds.filter(Boolean))];
  if (!wanted.length) return [];
  const db = await getDb();
  return db.getAllAsync<JobSummary>(
    `SELECT ${JOB_SUMMARY_COLUMNS.join(', ')} FROM job WHERE externalId IN (${wanted.map(() => '?').join(',')})`,
    ...wanted,
  );
}

/** The nine numbers on the Work hub's tiles. */
export interface WorkHubCounts {
  jobsOpen: number;
  reportsDraft: number;
  defectsOpen: number;
  timesheetsDraft: number;
  baselines: number;
  purchasesDraft: number;
  impairmentsOpen: number;
  restock: number;
  promisesOpen: number;
}

/**
 * The Work hub's badges, counted rather than read.
 *
 * The hub used to build its nine numbers by reading nine whole tables and
 * taking the length of what came back — five hundred jobs with their
 * descriptions, every service report with the technician's signature in it as
 * a data URI, every baseline with its zone results, every timesheet with its
 * week of entries — to draw nine integers, on every focus. One statement, nine
 * counts, no rows.
 *
 * The jobs badge counts open work the way the Jobs screen's Open tab does.
 * It used to count what was not complete inside the newest five hundred rows,
 * which on a phone holding four and a half thousand was neither the open work
 * nor five hundred of it.
 */
export async function workHubCounts(): Promise<WorkHubCounts> {
  const db = await getDb();
  const row = await db.getFirstAsync<WorkHubCounts>(
    `SELECT
       (SELECT COUNT(*) FROM job WHERE ${JOB_IS_OPEN}) AS jobsOpen,
       (SELECT COUNT(*) FROM report WHERE status = 'draft') AS reportsDraft,
       (SELECT COUNT(*) FROM defect WHERE status = 'open') AS defectsOpen,
       (SELECT COUNT(*) FROM timesheet WHERE status = 'draft') AS timesheetsDraft,
       (SELECT COUNT(*) FROM baseline) AS baselines,
       (SELECT COUNT(*) FROM purchase_request WHERE status = 'draft') AS purchasesDraft,
       (SELECT COUNT(*) FROM impairment WHERE restoredAt IS NULL) AS impairmentsOpen,
       (SELECT COUNT(*) FROM stock_item WHERE quantity <= minimum) AS restock,
       (SELECT COUNT(*) FROM promise WHERE completedAt IS NULL) AS promisesOpen`,
  );
  return row ?? {
    jobsOpen: 0, reportsDraft: 0, defectsOpen: 0, timesheetsDraft: 0, baselines: 0,
    purchasesDraft: 0, impairmentsOpen: 0, restock: 0, promisesOpen: 0,
  };
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const db = await getDb();
  return (await db.getFirstAsync<JobRecord>('SELECT * FROM job WHERE id = ?', id)) ?? null;
}

/**
 * Writes a job from the office, without overwriting what happened on site.
 *
 * The sync re-sends every job before and after each run. The office owns the
 * booking — who, where, what stage — and takes those columns whole. The
 * technician owns what they did with it: a status they set on site outranks
 * the office's, notes already on the job are kept, and a site the job was
 * matched to locally survives an office copy that has none.
 *
 * `fromDetail` says the row came from the job's own record rather than the
 * list. The two fields only the record carries — the office's notes and the
 * customer contract — are then written whole, blank included: a note the
 * office deleted has to leave the phone, and a list-level write, which never
 * asked for them, has nothing to say about them and leaves them alone.
 */
export async function upsertJob(
  input: Partial<JobRecord> & { siteName: string; title: string },
  options: { fromDetail?: boolean } = {},
): Promise<JobRecord> {
  const db = await getDb();
  const now = nowIso();
  const detail = options.fromDetail === true ? 1 : 0;
  const job: JobRecord = {
    id: input.id ?? newId(),
    priority: input.priority ?? 'normal',
    status: input.status ?? 'scheduled',
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    ...input,
  } as JobRecord;

  /*
   * The mirror columns are the office's, written whole on every list-level
   * pull — except the three only a detail read fills (notesText,
   * customerContractJson, detailSyncedAt), which a list-level pull must not
   * blank: it did not ask for them, so it has nothing to say about them.
   *
   * Three rules in the conflict clause are worth reading twice.
   *
   * The site. A job keeps the local site it was matched to when the office
   * copy has none — unless the office's own site id has changed, in which
   * case the job has moved buildings and the old match is wrong, held site
   * or not. Without that a job moved to a site the phone does not hold
   * stayed filed under the one it left.
   *
   * The status. A status the technician set on site outranks the office's.
   * Complete is the one the pull itself sets, for a job the office has
   * closed — and that one is not the technician's, so when the office
   * reopens the job it reopens here too. The technician's own completion is
   * told apart by completedAt, which only the Complete button stamps.
   *
   * The detail-only fields, per the note on the function.
   */
  await db.runAsync(
    `INSERT INTO job (id,externalId,siteId,siteName,customerName,title,jobType,stage,priority,
       scheduledFor,dueAt,technician,address,latitude,longitude,status,startedAt,completedAt,notes,createdAt,updatedAt,
       orderNo,requestNo,statusName,statusColor,stageRaw,jobTypeRaw,customerExternalId,siteExternalId,
       siteContactJson,techniciansJson,tagsJson,projectManager,descriptionText,notesText,completedDate,
       totalExTaxCents,totalIncTaxCents,convertedFromQuoteId,customerContractJson,dateModified,detailSyncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       siteId=CASE
         WHEN excluded.siteExternalId IS NOT NULL AND excluded.siteExternalId IS NOT job.siteExternalId THEN excluded.siteId
         ELSE COALESCE(excluded.siteId, job.siteId) END,
       siteName=excluded.siteName, customerName=excluded.customerName, title=excluded.title,
       jobType=excluded.jobType, stage=excluded.stage, priority=excluded.priority,
       scheduledFor=excluded.scheduledFor, dueAt=excluded.dueAt, technician=excluded.technician,
       address=excluded.address,
       status=CASE
         WHEN job.status IN ('in-progress','blocked') THEN job.status
         WHEN job.status = 'complete' AND job.completedAt IS NOT NULL THEN job.status
         ELSE excluded.status END,
       notes=COALESCE(job.notes, excluded.notes),
       updatedAt=excluded.updatedAt,
       orderNo=excluded.orderNo, requestNo=excluded.requestNo,
       statusName=excluded.statusName, statusColor=excluded.statusColor,
       stageRaw=excluded.stageRaw, jobTypeRaw=excluded.jobTypeRaw,
       customerExternalId=excluded.customerExternalId,
       siteExternalId=COALESCE(excluded.siteExternalId, job.siteExternalId),
       siteContactJson=excluded.siteContactJson, techniciansJson=excluded.techniciansJson,
       tagsJson=excluded.tagsJson, projectManager=excluded.projectManager,
       descriptionText=excluded.descriptionText,
       notesText=CASE WHEN ? THEN excluded.notesText ELSE COALESCE(excluded.notesText, job.notesText) END,
       completedDate=excluded.completedDate,
       totalExTaxCents=excluded.totalExTaxCents, totalIncTaxCents=excluded.totalIncTaxCents,
       convertedFromQuoteId=excluded.convertedFromQuoteId,
       customerContractJson=CASE WHEN ? THEN excluded.customerContractJson
         ELSE COALESCE(excluded.customerContractJson, job.customerContractJson) END,
       dateModified=COALESCE(excluded.dateModified, job.dateModified),
       detailSyncedAt=COALESCE(excluded.detailSyncedAt, job.detailSyncedAt)`,
    job.id, job.externalId ?? null, job.siteId ?? null, job.siteName, job.customerName ?? null,
    job.title, job.jobType ?? null, job.stage ?? null, job.priority, job.scheduledFor ?? null,
    job.dueAt ?? null, job.technician ?? null, job.address ?? null, job.latitude ?? null,
    job.longitude ?? null, job.status, job.startedAt ?? null, job.completedAt ?? null,
    job.notes ?? null, job.createdAt, job.updatedAt,
    job.orderNo ?? null, job.requestNo ?? null, job.statusName ?? null, job.statusColor ?? null,
    job.stageRaw ?? null, job.jobTypeRaw ?? null, job.customerExternalId ?? null, job.siteExternalId ?? null,
    job.siteContactJson ?? null, job.techniciansJson ?? null, job.tagsJson ?? null, job.projectManager ?? null,
    job.descriptionText ?? null, job.notesText ?? null, job.completedDate ?? null,
    job.totalExTaxCents ?? null, job.totalIncTaxCents ?? null, job.convertedFromQuoteId ?? null,
    job.customerContractJson ?? null, job.dateModified ?? null, job.detailSyncedAt ?? null,
    // The two CASE WHEN flags in the conflict clause, in the order they appear.
    detail, detail,
  );
  return job;
}

/**
 * The technician's own status on a job.
 *
 * `completedBy` is who is pressing Complete — the signed-in Simpro user's
 * name, else the technician name in Settings — and is what the note to the
 * office names. The job's own technician field is the office's list of
 * everyone booked to it, which is not the same thing: two people booked and
 * one attending is the ordinary case.
 */
export async function setJobStatus(
  id: string,
  status: JobRecord['status'],
  options: { completedBy?: string } = {},
): Promise<void> {
  const db = await getDb();
  const before = await getJob(id);
  const stamp = status === 'in-progress' ? 'startedAt' : status === 'complete' ? 'completedAt' : null;
  if (stamp) {
    await db.runAsync(`UPDATE job SET status = ?, ${stamp} = ?, updatedAt = ? WHERE id = ?`, status, nowIso(), nowIso(), id);
  } else {
    await db.runAsync('UPDATE job SET status = ?, updatedAt = ? WHERE id = ?', status, nowIso(), id);
  }
  // Only on the way into complete. Setting a complete job complete again is a
  // screen re-saving what it has, not a second completion.
  if (status === 'complete' && before && before.status !== 'complete') {
    const after = await getJob(id);
    if (after) await queueWorkCompletedNote(after, options);
  }
}

/**
 * Tells the office a job was finished, the moment it was.
 *
 * A short appended note on the Simpro job — what, when, who — queued rather
 * than sent, so a basement with no signal loses nothing. A job that did not
 * come from the office has no job number to put it on and gets no note. The
 * queue keys the note on its content, and the content is keyed on the job and
 * the Queensland day, so a double tap or a re-open-and-close is one note.
 *
 * The routine run linked to this job, where there is one, is named in the
 * note so the office can find the service record beside it. Read with one
 * query here rather than through outboundRepo, which imports this module.
 *
 * The person named is whoever completed it on this phone, where the screen
 * knows; the job's technician field is the office's list of everyone booked
 * and only stands in when nobody is signed in and no name is set.
 */
export async function queueWorkCompletedNote(
  job: JobRecord,
  options: { completedBy?: string } = {},
): Promise<{ queued: boolean; key?: string }> {
  const externalId = job.externalId?.trim();
  if (!externalId) return { queued: false };
  const db = await getDb();
  const run = await db.getFirstAsync<WorkCompletedRun>(
    `SELECT r.routineLabel, r.frequency, r.system, r.completedAt,
            r.checksPassed, r.checksFailed, r.checksNotTested, r.defectsRaised
       FROM outbound_job_link l JOIN routine_run r ON r.id = l.runId
      WHERE l.jobId = ?
      ORDER BY r.completedAt DESC LIMIT 1`,
    externalId,
  );
  const note = workCompletedNote({
    externalId,
    title: job.title,
    siteName: job.siteName,
    completedAt: job.completedAt ?? nowIso(),
    technician: job.technician,
    completedBy: options.completedBy?.trim() || undefined,
    notes: job.notes,
    orderNo: job.orderNo,
  }, run ?? undefined);
  // The note's own key is the queue's key: the marker is already in the text,
  // so the sender adds no second one, and the same completion cannot queue twice.
  const { duplicate } = await enqueueSync(
    'job-note',
    { jobId: note.jobId, subject: note.subject, note: note.note },
    { contentKey: note.key },
  );
  if (!duplicate) flushSoon();
  return { queued: !duplicate, key: note.key };
}

// ---------------------------------------------------------------------------
// Impairments
// ---------------------------------------------------------------------------

export interface ImpairmentRecord {
  id: string;
  siteId: string;
  system: string;
  scope: string;
  reason: string;
  startedAt: string;
  expectedRestoreAt?: string;
  restoredAt?: string;
  technician?: string;
  responsibleNotified: boolean;
  responsibleName?: string;
  brigadeNotified: boolean;
  monitoringNotified: boolean;
  fireWatchInPlace: boolean;
  signagePlaced: boolean;
  alternativeMeasures?: string;
  isolatedAssets: string[];
  notes?: string;
}

interface ImpairmentRow extends Omit<ImpairmentRecord, 'isolatedAssets' | 'responsibleNotified' | 'brigadeNotified' | 'monitoringNotified' | 'fireWatchInPlace' | 'signagePlaced'> {
  isolatedAssets: string;
  responsibleNotified: number;
  brigadeNotified: number;
  monitoringNotified: number;
  fireWatchInPlace: number;
  signagePlaced: number;
}

const hydrateImpairment = (r: ImpairmentRow): ImpairmentRecord => ({
  ...r,
  isolatedAssets: parseJson<string[]>(r.isolatedAssets, []),
  responsibleNotified: r.responsibleNotified === 1,
  brigadeNotified: r.brigadeNotified === 1,
  monitoringNotified: r.monitoringNotified === 1,
  fireWatchInPlace: r.fireWatchInPlace === 1,
  signagePlaced: r.signagePlaced === 1,
});

export async function listImpairments(openOnly = true): Promise<ImpairmentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ImpairmentRow>(
    `SELECT * FROM impairment ${openOnly ? 'WHERE restoredAt IS NULL' : ''} ORDER BY startedAt DESC`,
  );
  return rows.map(hydrateImpairment);
}

export async function getImpairment(id: string): Promise<ImpairmentRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ImpairmentRow>('SELECT * FROM impairment WHERE id = ?', id);
  return row ? hydrateImpairment(row) : null;
}

export async function createImpairment(input: Partial<ImpairmentRecord> & { siteId: string; system: string }): Promise<ImpairmentRecord> {
  const db = await getDb();
  const rec: ImpairmentRecord = {
    id: newId(),
    scope: '',
    reason: '',
    startedAt: nowIso(),
    responsibleNotified: false,
    brigadeNotified: false,
    monitoringNotified: false,
    fireWatchInPlace: false,
    signagePlaced: false,
    isolatedAssets: [],
    ...input,
  };
  await db.runAsync(
    `INSERT INTO impairment (id,siteId,system,scope,reason,startedAt,expectedRestoreAt,restoredAt,
       technician,responsibleNotified,responsibleName,brigadeNotified,monitoringNotified,
       fireWatchInPlace,signagePlaced,alternativeMeasures,isolatedAssets,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.siteId, rec.system, rec.scope, rec.reason, rec.startedAt,
    rec.expectedRestoreAt ?? null, rec.restoredAt ?? null, rec.technician ?? null,
    rec.responsibleNotified ? 1 : 0, rec.responsibleName ?? null, rec.brigadeNotified ? 1 : 0,
    rec.monitoringNotified ? 1 : 0, rec.fireWatchInPlace ? 1 : 0, rec.signagePlaced ? 1 : 0,
    rec.alternativeMeasures ?? null, JSON.stringify(rec.isolatedAssets), rec.notes ?? null,
  );
  return rec;
}

export async function updateImpairment(id: string, patch: Partial<ImpairmentRecord>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const f of ['scope', 'reason', 'expectedRestoreAt', 'restoredAt', 'technician',
    'responsibleName', 'alternativeMeasures', 'notes'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  for (const f of ['responsibleNotified', 'brigadeNotified', 'monitoringNotified',
    'fireWatchInPlace', 'signagePlaced'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push(patch[f] ? 1 : 0); }
  }
  if (patch.isolatedAssets !== undefined) { sets.push('isolatedAssets = ?'); vals.push(JSON.stringify(patch.isolatedAssets)); }
  if (!sets.length) return;
  await db.runAsync(`UPDATE impairment SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

/** How long an impairment has been running, in milliseconds. */
export function impairmentElapsedMs(rec: ImpairmentRecord, now = Date.now()): number {
  const start = Date.parse(rec.startedAt);
  const end = rec.restoredAt ? Date.parse(rec.restoredAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/** What still has to happen before an impairment can be closed out. */
export function impairmentOutstanding(rec: ImpairmentRecord): string[] {
  const out: string[] = [];
  if (!rec.responsibleNotified) out.push('Notify the responsible person');
  if (!rec.monitoringNotified) out.push('Notify the monitoring provider');
  if (!rec.fireWatchInPlace) out.push('Confirm fire watch or alternative measures');
  if (!rec.signagePlaced) out.push('Place signage at the panel');
  return out;
}

// ---------------------------------------------------------------------------
// Stock and purchasing
// ---------------------------------------------------------------------------

export interface StockLocation { id: string; label: string; kind: 'workshop' | 'van' | 'site'; owner?: string }
export interface StockItem {
  id: string;
  locationId: string;
  catalogueItemId?: string;
  partNumber: string;
  description: string;
  quantity: number;
  minimum: number;
  updatedAt: string;
}

export async function listStockLocations(): Promise<StockLocation[]> {
  const db = await getDb();
  return db.getAllAsync<StockLocation>('SELECT * FROM stock_location ORDER BY kind, label');
}

export async function createStockLocation(label: string, kind: StockLocation['kind'], owner?: string): Promise<StockLocation> {
  const db = await getDb();
  const rec: StockLocation = { id: newId(), label, kind, owner };
  await db.runAsync('INSERT INTO stock_location (id,label,kind,owner) VALUES (?,?,?,?)', rec.id, rec.label, rec.kind, rec.owner ?? null);
  return rec;
}

export async function listStock(locationId?: string): Promise<StockItem[]> {
  const db = await getDb();
  return locationId
    ? db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE locationId = ? ORDER BY description', locationId)
    : db.getAllAsync<StockItem>('SELECT * FROM stock_item ORDER BY description');
}

export async function upsertStock(item: Omit<StockItem, 'id' | 'updatedAt'> & { id?: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO stock_item (id,locationId,catalogueItemId,partNumber,description,quantity,minimum,updatedAt)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity, minimum=excluded.minimum, updatedAt=excluded.updatedAt`,
    item.id ?? newId(), item.locationId, item.catalogueItemId ?? null, item.partNumber,
    item.description, item.quantity, item.minimum, nowIso(),
  );
}

/** Items at or below their minimum — what a van needs before tomorrow. */
export async function restockNeeded(locationId?: string): Promise<StockItem[]> {
  const db = await getDb();
  return locationId
    ? db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE locationId = ? AND quantity <= minimum ORDER BY description', locationId)
    : db.getAllAsync<StockItem>('SELECT * FROM stock_item WHERE quantity <= minimum ORDER BY description');
}

export interface PurchaseLine { partNumber: string; description: string; quantity: number; note?: string }
export interface PurchaseRequest {
  id: string;
  createdAt: string;
  requestedBy?: string;
  supplier?: string;
  jobId?: string;
  siteId?: string;
  lines: PurchaseLine[];
  status: 'draft' | 'submitted' | 'ordered' | 'received' | 'cancelled';
  externalId?: string;
  notes?: string;
}

export async function listPurchaseRequests(): Promise<PurchaseRequest[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<PurchaseRequest, 'lines'> & { lines: string }>(
    'SELECT * FROM purchase_request ORDER BY createdAt DESC',
  );
  return rows.map((r) => ({ ...r, lines: parseJson<PurchaseLine[]>(r.lines, []) }));
}

export async function createPurchaseRequest(input: Partial<PurchaseRequest> & { lines: PurchaseLine[] }): Promise<PurchaseRequest> {
  const db = await getDb();
  const rec: PurchaseRequest = {
    id: newId(),
    createdAt: nowIso(),
    status: 'draft',
    ...input,
  };
  await db.runAsync(
    `INSERT INTO purchase_request (id,createdAt,requestedBy,supplier,jobId,siteId,lines,status,externalId,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.createdAt, rec.requestedBy ?? null, rec.supplier ?? null, rec.jobId ?? null,
    rec.siteId ?? null, JSON.stringify(rec.lines), rec.status, rec.externalId ?? null, rec.notes ?? null,
  );
  return rec;
}

export async function setPurchaseStatus(id: string, status: PurchaseRequest['status'], externalId?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE purchase_request SET status = ?, externalId = COALESCE(?, externalId) WHERE id = ?', status, externalId ?? null, id);
}

// ---------------------------------------------------------------------------
// Promises
// ---------------------------------------------------------------------------

export interface Promise_ {
  id: string;
  what: string;
  siteId?: string;
  assetId?: string;
  jobId?: string;
  owner?: string;
  dueAt?: string;
  createdAt: string;
  completedAt?: string;
}

export async function listPromises(openOnly = true): Promise<Promise_[]> {
  const db = await getDb();
  return db.getAllAsync<Promise_>(
    `SELECT * FROM promise ${openOnly ? 'WHERE completedAt IS NULL' : ''} ORDER BY COALESCE(dueAt, createdAt)`,
  );
}

export async function createPromise(input: Partial<Promise_> & { what: string }): Promise<Promise_> {
  const db = await getDb();
  const rec: Promise_ = { id: newId(), createdAt: nowIso(), ...input };
  await db.runAsync(
    'INSERT INTO promise (id,what,siteId,assetId,jobId,owner,dueAt,createdAt,completedAt) VALUES (?,?,?,?,?,?,?,?,?)',
    rec.id, rec.what, rec.siteId ?? null, rec.assetId ?? null, rec.jobId ?? null,
    rec.owner ?? null, rec.dueAt ?? null, rec.createdAt, rec.completedAt ?? null,
  );
  return rec;
}

export async function completePromise(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE promise SET completedAt = ? WHERE id = ?', nowIso(), id);
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  system?: string;
  manufacturer?: string;
  model?: string;
  siteId?: string;
  author?: string;
  status: 'unverified' | 'verified' | 'manufacturer-confirmed' | 'superseded';
  sourceKind: string;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listKnowledge(filter: { siteId?: string; search?: string } = {}): Promise<KnowledgeNote[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: string[] = [];
  if (filter.siteId) { where.push('siteId = ?'); args.push(filter.siteId); }
  if (filter.search?.trim()) {
    const term = `%${filter.search.trim()}%`;
    where.push('(title LIKE ? OR body LIKE ? OR manufacturer LIKE ? OR model LIKE ?)');
    args.push(term, term, term, term);
  }
  return db.getAllAsync<KnowledgeNote>(
    `SELECT * FROM knowledge_note ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE status WHEN 'manufacturer-confirmed' THEN 0 WHEN 'verified' THEN 1 WHEN 'unverified' THEN 2 ELSE 3 END,
              updatedAt DESC`,
    ...args,
  );
}

export async function createKnowledge(input: Partial<KnowledgeNote> & { title: string }): Promise<KnowledgeNote> {
  const db = await getDb();
  const now = nowIso();
  const rec: KnowledgeNote = {
    id: newId(), body: '', status: 'unverified', sourceKind: 'technician',
    createdAt: now, updatedAt: now, ...input,
  };
  await db.runAsync(
    `INSERT INTO knowledge_note (id,title,body,system,manufacturer,model,siteId,author,status,sourceKind,sourceRef,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.title, rec.body, rec.system ?? null, rec.manufacturer ?? null, rec.model ?? null,
    rec.siteId ?? null, rec.author ?? null, rec.status, rec.sourceKind, rec.sourceRef ?? null,
    rec.createdAt, rec.updatedAt,
  );
  return rec;
}

export async function setKnowledgeStatus(id: string, status: KnowledgeNote['status']): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE knowledge_note SET status = ?, updatedAt = ? WHERE id = ?', status, nowIso(), id);
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------

export interface SyncEntry {
  id: string;
  createdAt: string;
  kind: string;
  payload: string;
  attempts: number;
  lastError?: string;
  /**
   * `unknown` is a send the phone cannot vouch for either way: the request
   * went out and the reply never came. It is not retried on its own, because
   * a vendor order that did arrive would be raised twice; a person looks at
   * Simpro and either retries it or lets it go.
   */
  status: 'pending' | 'sent' | 'failed' | 'unknown';
  /** What the item is, derived from its content. See domain/queueKey. */
  contentKey?: string | null;
}

/**
 * Queues an item once.
 *
 * The same kind and content already pending, sent or in doubt is not queued
 * again: a double tap on "send", or a screen that re-queues its note on every
 * focus, used to become two notes on the job. Returns whether it was new.
 *
 * The key is derived from the whole payload unless the caller supplies one.
 * A caller does that when part of the payload is not the work — a photo's
 * local path differs between phones and moves on reinstall, and keying on it
 * would let the same photograph upload twice — or when the work already
 * carries a key of its own that the posted text will show.
 */
export async function enqueueSync(
  kind: string,
  payload: unknown,
  options: { contentKey?: string } = {},
): Promise<{ id: string; duplicate: boolean }> {
  const db = await getDb();
  const key = options.contentKey ?? queueKey(kind, payload);
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sync_queue WHERE contentKey = ? AND status IN ('pending', 'sent', 'unknown') LIMIT 1",
    key,
  );
  if (existing) return { id: existing.id, duplicate: true };
  const id = newId();
  await db.runAsync(
    'INSERT INTO sync_queue (id,createdAt,kind,payload,attempts,status,contentKey) VALUES (?,?,?,?,0,?,?)',
    id, nowIso(), kind, JSON.stringify(payload), 'pending', key,
  );
  return { id, duplicate: false };
}

export async function pendingSync(limit = 100): Promise<SyncEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SyncEntry>("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY createdAt LIMIT ?", limit);
}

/** Sends nobody can vouch for, oldest first, for a person to look at. */
export async function unknownSync(): Promise<SyncEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SyncEntry>("SELECT * FROM sync_queue WHERE status = 'unknown' ORDER BY createdAt");
}

/**
 * Sends the app has given up on, oldest first, with the last reason on each.
 *
 * Given up on is not gone. A note that failed five times in a bad afternoon
 * of signal, or a photograph the server refused by name, is still the
 * technician's work, and a queue that hides it once it stops trying has lost
 * it as surely as a crash would. The outbound screen lists these beside the
 * unknown ones so a person can send them again (retrySync) or forget them
 * (forgetSync).
 */
export async function failedSync(): Promise<SyncEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SyncEntry>("SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY createdAt");
}

/** A send that went out and got no reply. Kept out of the retry loop; see SyncEntry.status. */
export async function markSyncUnknown(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'unknown', attempts = attempts + 1, lastError = ? WHERE id = ?", error, id);
}

/** A person has looked and wants it sent again, or a failed item given another go. */
export async function retrySync(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'pending', attempts = 0, lastError = NULL WHERE id = ?", id);
}

/** A person has looked, found it in Simpro, and is done with it. */
export async function dismissSync(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'sent' WHERE id = ?", id);
}

/**
 * A person has given up on a failed item, and it is gone.
 *
 * Not dismissSync: that marks the row sent, which is right for a note found
 * in Simpro and wrong here — a photograph marked sent is counted as uploaded
 * in Settings and kept off the job's plan for good, so the next send of the
 * service would never offer it again. Deleted, the same photograph is
 * planned afresh the next time the service is sent, and a note can be
 * queued again by whatever queued it.
 */
export async function forgetSync(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM sync_queue WHERE id = ? AND status = 'failed'", id);
}

export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sync_queue SET status = 'sent' WHERE id = ?", id);
}

export async function markSyncFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  // Five attempts is enough to ride out a flat spot without hammering a real failure.
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, lastError = ?,
       status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END WHERE id = ?`,
    error, id,
  );
}

/**
 * Gives up on an item now, whatever its attempt count.
 *
 * For the failure no retry can mend: a photograph whose file is gone from
 * the phone. Left pending it would fail five times over five syncs and then
 * arrive here anyway, with the reason buried under four "still missing"
 * messages; failed at once, the reason is the first thing a person reads.
 */
export async function abandonSync(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE sync_queue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE id = ?",
    error, id,
  );
}

export async function pendingSyncCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'");
  return row?.n ?? 0;
}

export interface AttachmentQueueSummary {
  /** Waiting for signal, or for their turn. */
  pending: number;
  /** Went out and got no reply; a person decides these on the outbound screen. */
  unknown: number;
  /** Gave up after repeated refusals, or the file was gone. */
  failed: number;
  /** Uploaded to the job. */
  sent: number;
}

/**
 * Where the photographs bound for Simpro stand.
 *
 * Counted by status rather than folded into the one "waiting to sync" number,
 * because a photograph is the only queued thing whose file can go missing
 * underneath it, and "3 waiting" reads very differently from "3 failed".
 */
export async function attachmentQueueSummary(): Promise<AttachmentQueueSummary> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM sync_queue WHERE kind = 'attachment' GROUP BY status",
  );
  const out: AttachmentQueueSummary = { pending: 0, unknown: 0, failed: 0, sent: 0 };
  for (const row of rows) {
    if (row.status === 'pending') out.pending = row.n;
    else if (row.status === 'unknown') out.unknown = row.n;
    else if (row.status === 'failed') out.failed = row.n;
    else if (row.status === 'sent') out.sent = row.n;
  }
  return out;
}

/** Severity of a defect code, for sorting a mixed list. */
export function severityOf(code: string): Severity {
  return defectByCode(code)?.severity ?? 'medium';
}
