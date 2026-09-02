import { getDb, newId, nowIso } from './index';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/** Timesheet persistence. Entries live as a JSON column — always read whole. */

interface TimesheetRow extends Omit<Timesheet, 'entries'> {
  entries: string;
}

/**
 * Every text field on an entry, so a sheet written by an older build still
 * loads with all of them present.
 *
 * The entries column is JSON and is read back with a cast, which asserts a
 * shape rather than checking one. A field added to `TimesheetEntry` later is
 * simply absent from every row already saved, and `undefined` bound into a text
 * input turns a controlled field uncontrolled — the box silently stops
 * accepting what is typed into it. Totalling survives it, because a
 * non-numeric value reads as zero; the editor does not.
 */
const ENTRY_TEXT_FIELDS = [
  'date', 'jobNumber', 'siteName', 'serviceReportNumber', 'startTime', 'finishTime',
  'sick', 'rdo', 'annual', 'lwop', 'publicHoliday', 'comments',
] as const;

function hydrateEntry(raw: Partial<TimesheetEntry>): TimesheetEntry {
  const entry = { ...raw } as Record<string, unknown>;
  for (const field of ENTRY_TEXT_FIELDS) {
    if (typeof entry[field] !== 'string') entry[field] = '';
  }
  if (entry.hourKind !== 'ord' && entry.hourKind !== 'ot' && entry.hourKind !== 'dt') {
    entry.hourKind = 'ord';
  }
  if (typeof entry.id !== 'string' || !entry.id) entry.id = newId();
  return entry as unknown as TimesheetEntry;
}

function hydrate(row: TimesheetRow): Timesheet {
  let entries: TimesheetEntry[] = [];
  try {
    const v: unknown = JSON.parse(row.entries);
    if (Array.isArray(v)) entries = v.map((e) => hydrateEntry(e as Partial<TimesheetEntry>));
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
