import { getDb, newId, nowIso } from './index';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import { routineDue, sortByUrgency, type RoutineDue, type RoutineHistory } from '@/domain/schedule';

/**
 * Routine completions, and what they make due.
 *
 * Every run is kept rather than a single "last serviced" column being
 * overwritten, because the schedule is anchored to the earliest run and counts
 * occurrences from there. Keeping only the latest would make a late service the
 * new baseline, which is exactly the drift the scheduling rules exist to stop.
 */

export interface RoutineRun {
  id: string;
  siteId: string;
  routineId: string;
  routineLabel: string;
  frequency: string;
  system: string;
  completedAt: string;
  technician?: string;
  checksPassed: number;
  checksFailed: number;
  checksNotTested: number;
  defectsRaised: number;
  notes?: string;
}

export async function recordRoutineRun(
  input: Omit<RoutineRun, 'id' | 'completedAt'> & { completedAt?: string },
): Promise<RoutineRun> {
  const db = await getDb();
  const rec: RoutineRun = { id: newId(), completedAt: nowIso(), ...input };
  await db.runAsync(
    `INSERT INTO routine_run
       (id,siteId,routineId,routineLabel,frequency,system,completedAt,technician,
        checksPassed,checksFailed,checksNotTested,defectsRaised,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id, rec.siteId, rec.routineId, rec.routineLabel, rec.frequency, rec.system,
    rec.completedAt, rec.technician ?? null,
    rec.checksPassed, rec.checksFailed, rec.checksNotTested, rec.defectsRaised,
    rec.notes ?? null,
  );
  return rec;
}

export async function listRoutineRuns(siteId?: string, limit = 200): Promise<RoutineRun[]> {
  const db = await getDb();
  return siteId
    ? db.getAllAsync<RoutineRun>(
        'SELECT * FROM routine_run WHERE siteId = ? ORDER BY completedAt DESC LIMIT ?', siteId, limit)
    : db.getAllAsync<RoutineRun>(
        'SELECT * FROM routine_run ORDER BY completedAt DESC LIMIT ?', limit);
}

interface HistoryRow {
  routineId: string;
  firstCompletedAt: string;
  lastCompletedAt: string;
  completedCount: number;
}

/**
 * What each routine at a site is due, newest urgency first.
 *
 * Routines with no run recorded still appear, as "never recorded" — a site that
 * has never had its annual is the case most worth seeing, and a list built only
 * from what has been done would omit exactly that.
 */
export async function dueAtSite(siteId: string, todayIso: string): Promise<RoutineDue[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<HistoryRow>(
    `SELECT routineId,
            MIN(completedAt) AS firstCompletedAt,
            MAX(completedAt) AS lastCompletedAt,
            COUNT(*)         AS completedCount
     FROM routine_run WHERE siteId = ? GROUP BY routineId`,
    siteId,
  );
  const byRoutine = new Map(rows.map((r) => [r.routineId, r]));

  const out: RoutineDue[] = SERVICE_ROUTINES.map((routine) => {
    const row = byRoutine.get(routine.id);
    const history: RoutineHistory = {
      routineId: routine.id,
      frequency: routine.frequency,
      firstCompletedAt: row?.firstCompletedAt,
      lastCompletedAt: row?.lastCompletedAt,
      completedCount: row?.completedCount ?? 0,
    };
    return routineDue(history, todayIso);
  });

  return sortByUrgency(out);
}

export interface SiteDue extends RoutineDue {
  siteId: string;
  siteName: string;
}

/**
 * Routines that have lapsed, across every site.
 *
 * Deliberately only reports routines with a history that has since lapsed. A
 * site that has never had a given routine recorded would otherwise contribute
 * one "never recorded" row per routine — across a book of sites that is
 * hundreds of rows of nothing happening, and it would bury the handful that
 * genuinely lapsed. Those still show on the site's own list, where they mean
 * something.
 */
export async function lapsedEverywhere(todayIso: string, limit = 200): Promise<SiteDue[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<HistoryRow & { siteId: string; siteName: string }>(
    `SELECT r.siteId                AS siteId,
            s.name                  AS siteName,
            r.routineId             AS routineId,
            MIN(r.completedAt)      AS firstCompletedAt,
            MAX(r.completedAt)      AS lastCompletedAt,
            COUNT(*)                AS completedCount
     FROM routine_run r JOIN site s ON s.id = r.siteId
     GROUP BY r.siteId, r.routineId`,
  );

  const out: SiteDue[] = [];
  for (const row of rows) {
    const routine = SERVICE_ROUTINES.find((x) => x.id === row.routineId);
    if (!routine) continue;
    const due = routineDue(
      {
        routineId: routine.id,
        frequency: routine.frequency,
        firstCompletedAt: row.firstCompletedAt,
        lastCompletedAt: row.lastCompletedAt,
        completedCount: row.completedCount,
      },
      todayIso,
    );
    if (due.state !== 'overdue' && due.state !== 'due') continue;
    out.push({ ...due, siteId: row.siteId, siteName: row.siteName });
  }

  return sortByUrgency(out).slice(0, limit) as SiteDue[];
}
