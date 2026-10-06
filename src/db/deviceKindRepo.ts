import { getDb, nowIso } from '@/db';
import { FLOW_DEVICE_LABEL, type FlowDeviceKind } from '@/domain/form72';

/**
 * Which of Part C's three boxes a particular meter belongs under.
 *
 * Asked once per instrument, not once per form. The answer is a property of
 * the device — the same meter is the same kind of meter on every form it ever
 * appears on — so storing it per form meant asking the same question a hundred
 * times and getting a hundred chances to answer it differently.
 *
 * Nothing here infers an answer. Our own Flowtech certificates do not name the
 * measuring element, and the manufacturer's service document names only
 * "mechanical parts" and an "electronic metering module", so the documents
 * support more than one of the department's three boxes and settle none of
 * them. A tick the app put on by inference reads on the printed page exactly
 * like one a technician put on knowingly, and the page is signed. So this
 * records what somebody answered, who they were and what they went on, and
 * stays empty until somebody does.
 */

export interface DeviceKindAnswer {
  /** Upper-cased, because a serial typed in lower case is the same meter. */
  serialNumber: string;
  kind: FlowDeviceKind;
  /** Who answered. Kept because the answer is a claim, not a lookup. */
  answeredBy?: string;
  /** What they went on — a plate on the body, an email from the maker. */
  basis?: string;
  answeredAt: string;
}

interface DeviceKindRow {
  serialNumber: string;
  kind: string;
  answeredBy: string | null;
  basis: string | null;
  answeredAt: string;
}

/** The serial as the table keys it. */
export function deviceKindKey(serialNumber: string): string {
  return serialNumber.trim().toUpperCase();
}

function readRow(r: DeviceKindRow): DeviceKindAnswer | undefined {
  // A kind that is not one of the department's three is not an answer. It can
  // only arrive from a hand-edited database or a future value written by a
  // newer build, and either way guessing which box it meant is worse than
  // asking again.
  if (!(r.kind in FLOW_DEVICE_LABEL)) return undefined;
  return {
    serialNumber: r.serialNumber,
    kind: r.kind as FlowDeviceKind,
    answeredBy: r.answeredBy ?? undefined,
    basis: r.basis ?? undefined,
    answeredAt: r.answeredAt,
  };
}

/** What somebody answered for this meter, or nothing if nobody has. */
export async function getDeviceKind(serialNumber: string): Promise<DeviceKindAnswer | undefined> {
  const key = deviceKindKey(serialNumber);
  if (!key) return undefined;
  const db = await getDb();
  const row = await db.getFirstAsync<DeviceKindRow>(
    'SELECT * FROM device_kind WHERE serialNumber = ?', [key],
  );
  return row ? readRow(row) : undefined;
}

/**
 * Every answer on file, for the several serials one Part C holds at once.
 *
 * One query rather than one per column, because Part C has four slots and a
 * screen that woke up four times to fill in four chips flickered through them.
 */
export async function getDeviceKinds(
  serialNumbers: readonly string[],
): Promise<Map<string, DeviceKindAnswer>> {
  const keys = [...new Set(serialNumbers.map(deviceKindKey).filter(Boolean))];
  const out = new Map<string, DeviceKindAnswer>();
  if (!keys.length) return out;

  const db = await getDb();
  const rows = await db.getAllAsync<DeviceKindRow>(
    `SELECT * FROM device_kind WHERE serialNumber IN (${keys.map(() => '?').join(', ')})`, keys,
  );
  for (const row of rows) {
    const answer = readRow(row);
    if (answer) out.set(answer.serialNumber, answer);
  }
  return out;
}

/**
 * Record what somebody answered for this meter.
 *
 * Overwrites a previous answer rather than keeping both. A meter does not
 * change what it is, so a second different answer means the first one was
 * wrong, and two contradictory rows about one instrument would leave the next
 * form to pick between them. Who answered and when are stored with it, so a
 * correction is traceable to the person who made it.
 */
export async function setDeviceKind(input: {
  serialNumber: string;
  kind: FlowDeviceKind;
  answeredBy?: string;
  basis?: string;
}): Promise<DeviceKindAnswer | undefined> {
  const key = deviceKindKey(input.serialNumber);
  // A device with no serial number is not identifiable, so an answer about it
  // could not be read back against anything. Part C's blank rows start that
  // way, and a stored row keyed on '' would answer for all of them at once.
  if (!key) return undefined;

  const answeredAt = nowIso();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO device_kind (serialNumber, kind, answeredBy, basis, answeredAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(serialNumber) DO UPDATE SET
       kind = excluded.kind, answeredBy = excluded.answeredBy,
       basis = excluded.basis, answeredAt = excluded.answeredAt`,
    [key, input.kind, input.answeredBy?.trim() || null, input.basis?.trim() || null, answeredAt],
  );
  return {
    serialNumber: key,
    kind: input.kind,
    answeredBy: input.answeredBy?.trim() || undefined,
    basis: input.basis?.trim() || undefined,
    answeredAt,
  };
}

/** Forget an answer, for a meter somebody answered wrongly. */
export async function forgetDeviceKind(serialNumber: string): Promise<void> {
  const key = deviceKindKey(serialNumber);
  if (!key) return;
  const db = await getDb();
  await db.runAsync('DELETE FROM device_kind WHERE serialNumber = ?', [key]);
}
