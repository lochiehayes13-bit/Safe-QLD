import { getDb, nowIso } from './index';
import type { ScheduleEntry } from '@/domain/myDay';

/**
 * The office's schedule, for the window around today the sync reads.
 *
 * Replaced by window rather than merged: a block the office moved to somebody
 * else, or off the day entirely, has to leave this table too. Deleting only
 * the days that were actually re-read means a sync that fell back to reading
 * today and tomorrow does not throw away the rest of the month it read last
 * time.
 */

export interface ScheduleRecord extends ScheduleEntry {
  syncedAt: string;
}

interface ScheduleRow {
  id: string;
  jobId: string | null;
  staffId: string | null;
  staffName: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  type: string | null;
  syncedAt: string;
}

const hydrate = (r: ScheduleRow): ScheduleRecord => ({
  id: r.id,
  jobId: r.jobId ?? undefined,
  staffId: r.staffId ?? undefined,
  staffName: r.staffName ?? undefined,
  date: r.date,
  startTime: r.startTime ?? undefined,
  endTime: r.endTime ?? undefined,
  type: r.type ?? undefined,
  syncedAt: r.syncedAt,
});

/**
 * Replaces every block dated inside [from, to] with the ones given.
 *
 * Blocks outside the window are left alone even if they are in the list,
 * which they should not be; the delete and the insert have to agree on the
 * window or a block could be written twice.
 */
export async function replaceScheduleWindow(from: string, to: string, blocks: readonly ScheduleEntry[]): Promise<number> {
  const db = await getDb();
  const at = nowIso();
  let written = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM schedule WHERE date >= ? AND date <= ?', from, to);
    for (const b of blocks) {
      if (!b.id || !b.date) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO schedule (id, jobId, staffId, staffName, date, startTime, endTime, type, syncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.id, b.jobId ?? null, b.staffId ?? null, b.staffName ?? null, b.date,
        b.startTime ?? null, b.endTime ?? null, b.type ?? null, at,
      );
      written++;
    }
  });
  return written;
}

/**
 * One person's blocks between two days, inclusive.
 *
 * By id where there is one; by name otherwise, case-insensitively, because
 * the name in Settings was typed by hand and the one in Simpro was not.
 * Given both, the id wins — see whoseSchedule.
 */
export async function listScheduleFor(filter: {
  staffId?: string;
  staffName?: string;
  from: string;
  to: string;
}): Promise<ScheduleRecord[]> {
  const db = await getDb();
  const where = ['date >= ?', 'date <= ?'];
  const args: string[] = [filter.from, filter.to];
  if (filter.staffId) {
    where.push('staffId = ?');
    args.push(filter.staffId);
  } else if (filter.staffName?.trim()) {
    where.push('staffName = ? COLLATE NOCASE');
    args.push(filter.staffName.trim());
  } else {
    return [];
  }
  const rows = await db.getAllAsync<ScheduleRow>(
    `SELECT * FROM schedule WHERE ${where.join(' AND ')} ORDER BY date, startTime, id`,
    ...args,
  );
  return rows.map(hydrate);
}

/** When the schedule was last written, or undefined when it never has been. */
export async function scheduleSyncedAt(): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ at: string | null }>('SELECT MAX(syncedAt) AS at FROM schedule');
  return row?.at ?? undefined;
}
