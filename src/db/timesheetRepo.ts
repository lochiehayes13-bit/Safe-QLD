import { getDb, newId, nowIso } from './index';
import { hydrateEntry, type Timesheet, type TimesheetEntry } from '@/domain/timesheet';

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
       employeeSignature, managerName, checkedBy, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    sheet.id, sheet.employeeName, sheet.vehicleRego, sheet.kilometerReading, sheet.weekStarting,
    JSON.stringify(sheet.entries), sheet.employeeSignature ?? null, sheet.managerName,
    sheet.checkedBy, sheet.status, sheet.createdAt, sheet.updatedAt,
  );
  return sheet;
}

export async function saveTimesheet(sheet: Timesheet): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE timesheet SET employeeName = ?, vehicleRego = ?, kilometerReading = ?, weekStarting = ?,
       entries = ?, employeeSignature = ?, managerName = ?, checkedBy = ?, status = ?, updatedAt = ?
     WHERE id = ?`,
    sheet.employeeName, sheet.vehicleRego, sheet.kilometerReading, sheet.weekStarting,
    JSON.stringify(sheet.entries), sheet.employeeSignature ?? null, sheet.managerName,
    sheet.checkedBy, sheet.status, nowIso(), sheet.id,
  );
}

export async function deleteTimesheet(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM timesheet WHERE id = ?', id);
}
