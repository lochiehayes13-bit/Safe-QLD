import { getDb, newId, nowIso } from './index';
import { hydrateEntry, type Timesheet, type TimesheetEntry } from '@/domain/timesheet';
import { timesheetOwner, type TimesheetOwner } from '@/domain/timesheetOwner';
import { getEmployee } from './employeeRepo';

/** Timesheet persistence. Entries live as a JSON column — always read whole. */

interface TimesheetRow extends Omit<Timesheet, 'entries'> {
  entries: string;
}

function hydrate(row: TimesheetRow): Timesheet {
  let entries: TimesheetEntry[] = [];
  try {
    const v: unknown = JSON.parse(row.entries);
    if (Array.isArray(v)) entries = v.map((e) => hydrateEntry(e as Partial<TimesheetEntry>, newId));
  } catch {
    entries = [];
  }
  return { ...row, entries };
}

export async function listTimesheets(): Promise<Timesheet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimesheetRow>('SELECT * FROM timesheet ORDER BY weekStarting DESC');
  return rows.map(hydrate);
}

export async function getTimesheet(id: string): Promise<Timesheet | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TimesheetRow>('SELECT * FROM timesheet WHERE id = ?', id);
  return row ? hydrate(row) : null;
}

export async function createTimesheet(seed: Partial<Timesheet> & { weekStarting: string }): Promise<Timesheet> {
  const db = await getDb();
  const now = nowIso();
  const sheet: Timesheet = {
    id: newId(),
    employeeName: '',
    vehicleRego: '',
    kilometerReading: '',
    entries: [],
    managerName: '',
    checkedBy: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...seed,
  };
  await db.runAsync(
    `INSERT INTO timesheet (id, employeeName, vehicleRego, kilometerReading, weekStarting, entries,
       employeeSignature, managerName, checkedBy, status, unpaidBreakMinutes, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    sheet.id, sheet.employeeName, sheet.vehicleRego, sheet.kilometerReading, sheet.weekStarting,
    JSON.stringify(sheet.entries), sheet.employeeSignature ?? null, sheet.managerName,
    sheet.checkedBy, sheet.status, sheet.unpaidBreakMinutes ?? null, sheet.createdAt, sheet.updatedAt,
  );
  return sheet;
}

export async function saveTimesheet(sheet: Timesheet): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE timesheet SET employeeName = ?, vehicleRego = ?, kilometerReading = ?, weekStarting = ?,
       entries = ?, employeeSignature = ?, managerName = ?, checkedBy = ?, status = ?,
       unpaidBreakMinutes = ?, updatedAt = ?
     WHERE id = ?`,
    sheet.employeeName, sheet.vehicleRego, sheet.kilometerReading, sheet.weekStarting,
    JSON.stringify(sheet.entries), sheet.employeeSignature ?? null, sheet.managerName,
    sheet.checkedBy, sheet.status, sheet.unpaidBreakMinutes ?? null, nowIso(), sheet.id,
  );
}

export async function deleteTimesheet(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM timesheet WHERE id = ?', id);
}

/**
 * Whose weeks these are: the name from Settings, else the person picked in
 * Simpro as the last sync recorded them (not if they have since been
 * archived), and the vehicle from Settings.
 */
export async function ownerOfThisPhone(
  prefs: { technicianName: string; vehicleRego: string; simproEmployeeId: string },
): Promise<TimesheetOwner> {
  const id = prefs.simproEmployeeId.trim();
  const me = prefs.technicianName.trim() || !id ? null : await getEmployee(id).catch(() => null);
  return timesheetOwner(prefs, me);
}

/**
 * Puts a name on draft weeks that have none, and on nothing else.
 *
 * One statement that touches only the name, so it cannot put back an older
 * copy of a week somebody is typing into, and only drafts, so a week already
 * sent stays exactly as accounts received it. Pass an id for one week.
 */
export async function nameUnnamedDrafts(name: string, id?: string): Promise<number> {
  const who = name.trim();
  if (!who) return 0;
  const db = await getDb();
  const done = await db.runAsync(
    `UPDATE timesheet SET employeeName = ?, updatedAt = ?
     WHERE trim(employeeName) = '' AND status = 'draft'${id ? ' AND id = ?' : ''}`,
    ...(id ? [who, nowIso(), id] : [who, nowIso()]),
  );
  return done.changes;
}
