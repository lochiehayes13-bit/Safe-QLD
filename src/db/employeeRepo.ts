import { getDb, inTransaction, nowIso } from './index';

/**
 * The office's staff list, as of the last sync.
 *
 * Replaced whole on every pull, like the rate card: a few dozen rows, and a
 * person who has left must stop being offered by the picker. Archived staff
 * are kept with the flag set rather than deleted, so a phone that was set to
 * somebody who has since gone can say so.
 */

export interface EmployeeRecord {
  /** Simpro's employee id. */
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  archived: boolean;
  syncedAt: string;
}

interface EmployeeRow extends Omit<EmployeeRecord, 'archived' | 'email' | 'phone' | 'position'> {
  email: string | null;
  phone: string | null;
  position: string | null;
  archived: number;
}

const hydrate = (r: EmployeeRow): EmployeeRecord => ({
  id: r.id,
  name: r.name,
  email: r.email ?? undefined,
  phone: r.phone ?? undefined,
  position: r.position ?? undefined,
  archived: r.archived === 1,
  syncedAt: r.syncedAt,
});

/** Replaces the whole list in one transaction, so a failed pull cannot half-apply. Returns how many were written. */
export async function replaceEmployees(
  people: readonly { id: string; name: string; email?: string; phone?: string; position?: string; archived?: boolean }[],
): Promise<number> {
  const db = await getDb();
  const at = nowIso();
  let written = 0;
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM employee');
    for (const p of people) {
      if (!p.id) continue;
      await db.runAsync(
        `INSERT INTO employee (id, name, email, phone, position, archived, syncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.name, p.email ?? null, p.phone ?? null, p.position ?? null, p.archived ? 1 : 0, at,
      );
      written++;
    }
  });
  return written;
}

export async function listEmployees(options: { includeArchived?: boolean } = {}): Promise<EmployeeRecord[]> {
  const db = await getDb();
  const rows = options.includeArchived
    ? await db.getAllAsync<EmployeeRow>('SELECT * FROM employee ORDER BY name COLLATE NOCASE')
    : await db.getAllAsync<EmployeeRow>('SELECT * FROM employee WHERE archived = 0 ORDER BY name COLLATE NOCASE');
  return rows.map(hydrate);
}

export async function getEmployee(id: string): Promise<EmployeeRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<EmployeeRow>('SELECT * FROM employee WHERE id = ?', id);
  return row ? hydrate(row) : null;
}
