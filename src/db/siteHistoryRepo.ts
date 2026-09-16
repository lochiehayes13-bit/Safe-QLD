import { getDb } from './index';
import { assetCountsBySystem } from './assetRepo';
import { dueAtSite } from './routineRunRepo';
import { routineById } from '@/seed/serviceRoutines';
import { buildSiteFacts, type HoursRow, type LastJobRow, type NextJobRow, type RunRow, type SiteFacts,
  type OpenDefectRow,
} from '@/domain/siteHistory';
import { entryMinutes } from '@/domain/clockOn';
import { routineDue } from '@/domain/schedule';

/**
 * The facts about a site, read from every table that holds a piece of them.
 *
 * Thin: the assembly and every judgement about what an absence means live
 * in `@/domain/siteHistory`, which imports no database. This reads rows.
 *
 * The one thing worth knowing about the reads is their reach, because it
 * is why the domain says "not held here" so often. The office's schedule
 * mirror is a rolling week back; the office timesheet mirror is this
 * phone's own employee for eight weeks; the clock is this phone's own. So
 * hours on a job older than that are simply not on the phone, and the card
 * says so rather than printing a zero.
 */

interface JobRow {
  externalId: string | null;
  title: string;
  status: string;
  statusName: string | null;
  completedDate: string | null;
  completedAt: string | null;
  jobType: string | null;
  techniciansJson: string | null;
  technician: string | null;
  scheduledFor: string | null;
  updatedAt: string;
}

interface SiteRow {
  id: string;
  name: string;
  suburb: string | null;
  contactName: string | null;
  contactMobile: string | null;
  contactWorkPhone: string | null;
}

/** Hours the phone holds against one Simpro job, from every source it has. */
async function hoursForJob(jobExternalId: string, ownName: string): Promise<HoursRow[]> {
  const db = await getDb();
  const out: HoursRow[] = [];

  const sheet = await db.getAllAsync<{ date: string; totalHours: number | null; startTime: string | null; endTime: string | null }>(
    'SELECT date, totalHours, startTime, endTime FROM simpro_timesheet WHERE jobExternalId = ?', [jobExternalId],
  );
  for (const r of sheet) {
    const hours = r.totalHours ?? spanHours(r.startTime, r.endTime);
    if (hours > 0) out.push({ staffName: ownName || undefined, date: r.date, hours, source: 'office-timesheet' });
  }

  const blocks = await db.getAllAsync<{ staffId: string | null; staffName: string | null; date: string; startTime: string | null; endTime: string | null }>(
    'SELECT staffId, staffName, date, startTime, endTime FROM schedule WHERE jobId = ?', [jobExternalId],
  );
  for (const b of blocks) {
    const hours = spanHours(b.startTime, b.endTime);
    if (hours > 0) out.push({ staffName: b.staffName ?? undefined, staffId: b.staffId ?? undefined, date: b.date, hours, source: 'schedule' });
  }

  const clocks = await db.getAllAsync<{ date: string; startedAt: string; endedAt: string | null }>(
    "SELECT date, startedAt, endedAt FROM clock_entry WHERE jobExternalId = ? AND kind = 'work' AND endedAt IS NOT NULL", [jobExternalId],
  );
  for (const c of clocks) {
    const minutes = entryMinutes({ startedAt: c.startedAt, endedAt: c.endedAt ?? undefined });
    if (minutes > 0) out.push({ staffName: ownName || undefined, date: c.date, hours: minutes / 60, source: 'phone-clock' });
  }

  return out;
}

function spanHours(start: string | null, end: string | null): number {
  const m = (s: string | null) => {
    const x = s?.match(/^(\d{2}):(\d{2})/);
    return x ? Number(x[1]) * 60 + Number(x[2]) : undefined;
  };
  const a = m(start); const b = m(end);
  if (a === undefined || b === undefined || b <= a) return 0;
  return (b - a) / 60;
}

/**
 * Everything the day builder shows for one site.
 *
 * `ownName` is the phone's technician name, used to label hours that only
 * this phone's sources hold — the office timesheet mirror is this person's
 * and the clock is this phone's, and neither row carries a name.
 */
export async function siteFacts(siteId: string, today: string, ownName = ''): Promise<SiteFacts | undefined> {
  const db = await getDb();
  const site = await db.getFirstAsync<SiteRow>(
    'SELECT id, name, suburb, contactName, contactMobile, contactWorkPhone FROM site WHERE id = ?', [siteId],
  );
  if (!site) return undefined;

  const [lastJobRow, nextJobRow, runRow, counts, due] = await Promise.all([
    db.getFirstAsync<JobRow>(
      `SELECT externalId, title, status, statusName, completedDate, completedAt, jobType, techniciansJson, technician, scheduledFor, updatedAt
       FROM job WHERE siteId = ? AND externalId IS NOT NULL AND status = 'complete'
       ORDER BY COALESCE(completedDate, substr(completedAt, 1, 10), '') DESC, updatedAt DESC LIMIT 1`,
      [siteId],
    ),
    db.getFirstAsync<JobRow & { schedDate: string | null; schedStaff: string | null; schedStart: string | null; schedEnd: string | null }>(
      `SELECT j.externalId, j.title, j.status, j.statusName, j.completedDate, j.completedAt, j.jobType, j.techniciansJson, j.technician, j.scheduledFor, j.updatedAt,
              s.date AS schedDate, s.staffName AS schedStaff, s.startTime AS schedStart, s.endTime AS schedEnd
       FROM job j
       LEFT JOIN schedule s ON s.jobId = j.externalId AND s.date >= ?
       WHERE j.siteId = ? AND j.externalId IS NOT NULL AND j.status <> 'complete'
       ORDER BY (s.date IS NULL), s.date, j.updatedAt DESC LIMIT 1`,
      [today, siteId],
    ),
    db.getFirstAsync<RunRow>(
      'SELECT completedAt, technician, routineLabel, checksPassed, checksFailed, checksNotTested, defectsRaised FROM routine_run WHERE siteId = ? ORDER BY completedAt DESC LIMIT 1',
      [siteId],
    ),
    assetCountsBySystem(siteId),
    dueAtSite(siteId, today),
  ]);

  /*
   * What is still open at the site, now — counted by the database, sampled for
   * the one it names.
   *
   * The count has to be a COUNT. Reading a capped list and taking its length
   * is how a site with three hundred open defects reports two hundred, and the
   * comment that used to sit here claimed the cap could not affect the number
   * while the code took the number straight off the capped list.
   *
   * The sample is capped and ordered so the rows that decide "the worst" come
   * first: critical before the rest, oldest before newer. Twenty is plenty to
   * name one.
   */
  const [tally, openDefects] = await Promise.all([
    db.getFirstAsync<{ total: number; critical: number; oldest: string | null }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN severity = 'critical'
                         OR as1851Class = 'critical'
                         OR (qldLimbInoperable = 1 AND qldLimbAdverseImpact = 1)
                       THEN 1 ELSE 0 END) AS critical,
              MIN(raisedAt) AS oldest
       FROM defect WHERE siteId = ? AND status = 'open'`,
      [siteId],
    ),
    db.getAllAsync<Omit<OpenDefectRow, 'qldLimbInoperable' | 'qldLimbAdverseImpact'> & {
      qldLimbInoperable: number; qldLimbAdverseImpact: number;
    }>(
      `SELECT status, severity, raisedAt, location, description,
              as1851Class, qldLimbInoperable, qldLimbAdverseImpact
       FROM defect WHERE siteId = ? AND status = 'open'
       ORDER BY (severity = 'critical'
                 OR as1851Class = 'critical'
                 OR (qldLimbInoperable = 1 AND qldLimbAdverseImpact = 1)) DESC, raisedAt LIMIT 20`,
      [siteId],
    ),
  ]);

  /*
   * The two Queensland limbs are INTEGER columns, and the domain asks whether
   * they are true. A 1 is not true in JavaScript, so without this the card
   * would read every limb as unset and quietly lose the third ground a defect
   * can be critical on — which is the ground it was just taught to count.
   */
  const openRows: OpenDefectRow[] = openDefects.map((d) => ({
    ...d,
    qldLimbInoperable: d.qldLimbInoperable === 1,
    qldLimbAdverseImpact: d.qldLimbAdverseImpact === 1,
  }));

  const lastJob: LastJobRow | undefined = lastJobRow?.externalId ? {
    externalId: lastJobRow.externalId,
    title: lastJobRow.title,
    status: lastJobRow.status,
    statusName: lastJobRow.statusName ?? undefined,
    completedDate: lastJobRow.completedDate ?? undefined,
    completedAt: lastJobRow.completedAt ?? undefined,
    jobType: lastJobRow.jobType ?? undefined,
    techniciansJson: lastJobRow.techniciansJson ?? undefined,
    technician: lastJobRow.technician ?? undefined,
  } : undefined;

  const nextJob: NextJobRow | undefined = nextJobRow?.externalId ? {
    externalId: nextJobRow.externalId,
    title: nextJobRow.title,
    statusName: nextJobRow.statusName ?? undefined,
    scheduled: nextJobRow.schedDate
      ? { date: nextJobRow.schedDate, staffName: nextJobRow.schedStaff ?? undefined, startTime: nextJobRow.schedStart ?? undefined, endTime: nextJobRow.schedEnd ?? undefined }
      : undefined,
  } : undefined;

  const hours = lastJob ? await hoursForJob(lastJob.externalId, ownName) : [];

  return buildSiteFacts({
    siteId: site.id,
    siteName: site.name,
    suburb: site.suburb ?? undefined,
    lastJob,
    hours,
    lastRun: runRow ? { ...runRow, technician: runRow.technician ?? undefined } : undefined,
    assetCounts: counts,
    openDefects: openRows,
    openTally: {
      total: tally?.total ?? 0,
      critical: tally?.critical ?? 0,
      oldestRaisedAt: tally?.oldest ?? undefined,
    },
    due: due.map((d) => ({
      routineId: d.routineId,
      routineLabel: routineById(d.routineId)?.label ?? d.routineId,
      frequency: d.frequency,
      state: d.state,
      scheduledFor: d.scheduledFor,
      daysUntilDue: d.daysUntilDue,
    })),
    nextJob,
    contact: site.contactName || site.contactMobile || site.contactWorkPhone
      ? { name: site.contactName ?? undefined, phone: site.contactMobile ?? site.contactWorkPhone ?? undefined }
      : undefined,
    today,
  });
}

export interface PlanCandidate {
  siteId: string;
  siteName: string;
  suburb?: string;
  /** Why it is on the list. */
  reason: 'overdue' | 'due' | 'open-job' | 'search';
  /** The open Simpro job at the site, where there is one, for the booking. */
  job?: { externalId: string; title: string };
  daysUntilDue?: number;
}

/**
 * The sites worth putting on a day.
 *
 * Overdue first, then due, then anything with an open Simpro job — the
 * work the office has already raised — and a search over the rest, so a
 * site the technician has in mind is one box away. Every row carries the
 * open job where there is one, because that is what a block is booked on.
 */
export async function planCandidates(today: string, query = '', limit = 60): Promise<PlanCandidate[]> {
  const db = await getDb();
  const term = query.trim();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const openJobs = await db.getAllAsync<{ siteId: string; externalId: string; title: string }>(
    `SELECT siteId, externalId, title FROM job
     WHERE siteId IS NOT NULL AND externalId IS NOT NULL AND status <> 'complete'
     ORDER BY updatedAt DESC`,
  );
  const jobBySite = new Map<string, { externalId: string; title: string }>();
  for (const j of openJobs) if (!jobBySite.has(j.siteId)) jobBySite.set(j.siteId, { externalId: j.externalId, title: j.title });

  const sites = await db.getAllAsync<{ id: string; name: string; suburb: string | null }>(
    term
      ? "SELECT id, name, suburb FROM site WHERE name LIKE ? ESCAPE '\\' OR suburb LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ?"
      : 'SELECT id, name, suburb FROM site ORDER BY name COLLATE NOCASE',
    ...(term ? [like, like, like, limit] : []),
  );

  const out: PlanCandidate[] = [];
  if (term) {
    for (const s of sites) {
      out.push({ siteId: s.id, siteName: s.name, suburb: s.suburb ?? undefined, reason: 'search', job: jobBySite.get(s.id) });
    }
    return out;
  }

  // No search: what is due, then what the office has raised.
  const dueRows = await db.getAllAsync<{ siteId: string; routineId: string; firstCompletedAt: string; lastCompletedAt: string; completedCount: number }>(
    'SELECT siteId, routineId, MIN(completedAt) AS firstCompletedAt, MAX(completedAt) AS lastCompletedAt, COUNT(*) AS completedCount FROM routine_run GROUP BY siteId, routineId',
  );
  const bySite = new Map<string, { state: 'overdue' | 'due'; days: number }>();
  for (const r of dueRows) {
    const routine = routineById(r.routineId);
    if (!routine) continue;
    const d = routineDue({ routineId: r.routineId, frequency: routine.frequency, firstCompletedAt: r.firstCompletedAt, lastCompletedAt: r.lastCompletedAt, completedCount: r.completedCount }, today);
    if (d.state !== 'overdue' && d.state !== 'due') continue;
    const cur = bySite.get(r.siteId);
    const days = d.daysUntilDue ?? 0;
    if (!cur || (d.state === 'overdue' && cur.state !== 'overdue') || days < cur.days) bySite.set(r.siteId, { state: d.state, days });
  }
  const nameOf = new Map(sites.map((s) => [s.id, s]));
  for (const [siteId, d] of bySite) {
    const s = nameOf.get(siteId);
    if (!s) continue;
    out.push({ siteId, siteName: s.name, suburb: s.suburb ?? undefined, reason: d.state, job: jobBySite.get(siteId), daysUntilDue: d.days });
  }
  for (const [siteId, job] of jobBySite) {
    if (bySite.has(siteId)) continue;
    const s = nameOf.get(siteId);
    if (!s) continue;
    out.push({ siteId, siteName: s.name, suburb: s.suburb ?? undefined, reason: 'open-job', job });
  }
  const order = { overdue: 0, due: 1, 'open-job': 2, search: 3 };
  return out.sort((a, b) => order[a.reason] - order[b.reason] || (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0) || a.siteName.localeCompare(b.siteName)).slice(0, limit);
}
