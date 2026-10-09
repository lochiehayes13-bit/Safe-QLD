import { getDb, newId, nowIso } from '@/db';
import {
  canIssue, emptyForm72, overloadRun, validateForm72,
  type BoosterTest, type FlowDeviceKind, type FlowTest, type Form72, type HydrostaticTest,
  type FormDefect, type MaintenanceTest, type PartResult, type SprinklerFlowTest,
  type SprinklerHydrostatic, type TestDevice,
} from '@/domain/form72';
import { seedDevices } from '@/domain/form72Devices';

/**
 * Storing Form 72s.
 *
 * The rules about what may be signed live in domain/form72.ts, and this layer's
 * job is to refuse to write anything those rules refuse — in the same words the
 * screen would use. A repository that quietly marked a form issued while its
 * gauge was out of calibration would make validateForm72 decorative, and the
 * form would be discovered a year later by whoever is challenging it.
 *
 * An issued form is immutable. It has been given to an occupier under QDC MP
 * 6.1, so their copy and ours have to say the same thing; a correction is a new
 * form, which is also how the paper world handles it. That is enforced here
 * rather than in the screen, because the screen is not the only caller.
 *
 * The parts are stored as JSON and read back through guards. A part that cannot
 * be parsed comes back as its empty shape with the failure logged, so one
 * corrupt column costs that part rather than the whole form — but it never
 * comes back as a plausible-looking default, because a form is signed.
 */

export type Form72Status = 'draft' | 'issued';

export interface StoredForm72 extends Form72 {
  /** "Towns Main System" — the descriptor in the form's top right corner. */
  systemLabel: string;
  status: Form72Status;
  issuedAt?: string;
  /** When the occupier was handed their copy. MP 6.1 A4(b) runs against this. */
  copyGivenAt?: string;
  /**
   * The 150% overload run, where one was made. Not a box on the department's
   * form, which is why it sits beside the parts rather than inside one.
   */
  overload?: { flowLps: number; pressureKpa: number };
  /** The Simpro job the test was done under, where one has been named. */
  jobExternalId?: string;
  jobTitle?: string;
  /** When the PDF was queued onto that job's attachments. */
  attachedAt?: string;
  /**
   * The sync-queue row the PDF went onto, where one was queued since v39.
   * The row's status — pending, sent, failed, unknown — is what the screen
   * reports; `attachedAt` alone said "on the job" about uploads that never
   * went.
   */
  attachmentQueueId?: string;
}

interface Form72Row {
  id: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  contractor: string;
  systemLabel: string;
  testDate: string | null;
  testTime: string | null;
  maintenanceTest: string;
  hydrostatic: string;
  flowDeviceKinds: string;
  flowDeviceCalibrated: string | null;
  answeredParts: string | null;
  devices: string;
  flowTest: string;
  booster: string;
  sprinklerHydrostatic: string;
  sprinklerFlow: string;
  overloadFlowLps: number | null;
  overloadPressureKpa: number | null;
  criticalDefectsIdentified: number | null;
  repairsRequired: number | null;
  systemResult: string;
  systemNotes: string;
  licenseeName: string;
  licenceNumber: string;
  licenseeReportNumber: string;
  signature: string;
  owner: string | null;
  ownerContact: string | null;
  buildingClassification: string | null;
  technician: string | null;
  qualification: string | null;
  defects: string | null;
  status: string;
  issuedAt: string | null;
  copyGivenAt: string | null;
  jobExternalId: string | null;
  jobTitle: string | null;
  attachedAt: string | null;
  attachmentQueueId: string | null;
  createdAt: string;
  updatedAt: string;
}

const PART_RESULTS: PartResult[] = ['na', 'pass', 'fail'];

/** An unrecognised stored result is not quietly mapped to the nearest one. */
function readResult(v: string, where: string): PartResult {
  const found = PART_RESULTS.find((r) => r === v);
  if (!found) throw new Error(`Form 72 ${where} has an unrecognised result "${v}".`);
  return found;
}

function readStatus(v: string): Form72Status {
  if (v === 'draft' || v === 'issued') return v;
  throw new Error(`Form 72 has an unrecognised status "${v}".`);
}

/**
 * Reads one JSON part.
 *
 * The empty shape is supplied by the caller rather than invented here, so a
 * part that fails to parse comes back marked N/A — an answer a reader can see
 * is wrong — instead of a pass with no readings behind it.
 */
function readJson<T>(raw: string, empty: T, what: string): T {
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    return { ...empty, ...(parsed as T) };
  } catch {
    console.warn(`Form 72 ${what} could not be read and has been treated as not recorded.`);
    return empty;
  }
}

function readJsonArray<T>(raw: string, what: string): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    console.warn(`Form 72 ${what} could not be read and has been treated as empty.`);
    return [];
  }
}

/** 1, 0 and NULL are three answers on Part H, and NULL is one of them. */
const readTriState = (v: number | null): boolean | undefined => (v === null ? undefined : v !== 0);

const writeTriState = (v: boolean | undefined): number | null => (v === undefined ? null : v ? 1 : 0);

const EMPTY_MAINTENANCE: MaintenanceTest = {
  hydrantAnnual: false, hydrantFiveYear: false,
  sprinklerAnnual: false, sprinklerFiveYear: false,
  combinedAnnual: false, combinedFiveYear: false,
};

function toForm(r: Form72Row): StoredForm72 {
  const flowTest = readJson<FlowTest>(
    r.flowTest, { result: 'na', hydrantLocations: [], rows: [] }, 'Part D',
  );
  const sprinklerFlow = readJson<SprinklerFlowTest>(
    r.sprinklerFlow, { result: 'na', testPoints: [] }, 'Part G',
  );

  return {
    id: r.id,
    siteId: r.siteId,
    siteName: r.siteName,
    siteAddress: r.siteAddress || undefined,
    contractor: r.contractor,
    systemLabel: r.systemLabel,
    testDate: r.testDate ?? undefined,
    testTime: r.testTime ?? undefined,
    maintenanceTest: readJson<MaintenanceTest>(r.maintenanceTest, EMPTY_MAINTENANCE, 'Part A'),
    hydrostatic: readJson<HydrostaticTest>(r.hydrostatic, { result: 'na' }, 'Part B'),
    flowDeviceKinds: readJsonArray<FlowDeviceKind>(r.flowDeviceKinds, 'Part C flow devices'),
    // Part C's two "Calibrated:" dates. Absent on every form written before
    // v35, which reads back as nobody having typed one.
    flowDeviceCalibrated: readJson<Partial<Record<FlowDeviceKind, string>>>(
      r.flowDeviceCalibrated ?? '', {}, 'Part C calibration dates',
    ),
    // Which parts somebody answered. Absent on every form written before v37,
    // which reads back as the empty list and falls back to the parts.
    answeredParts: readJsonArray<string>(r.answeredParts ?? '', 'answered parts'),
    devices: readJsonArray<TestDevice>(r.devices, 'Part C equipment'),
    // The arrays inside a part are replaced wholesale rather than merged with
    // the empty shape's, which would leave a stale row behind after a deletion.
    flowTest: { ...flowTest, hydrantLocations: flowTest.hydrantLocations ?? [], rows: flowTest.rows ?? [] },
    booster: readJson<BoosterTest>(r.booster, { result: 'na' }, 'Part E'),
    sprinklerHydrostatic: readJson<SprinklerHydrostatic>(r.sprinklerHydrostatic, { result: 'na' }, 'Part F'),
    sprinklerFlow: { ...sprinklerFlow, testPoints: sprinklerFlow.testPoints ?? [] },
    overload: r.overloadFlowLps !== null && r.overloadPressureKpa !== null
      ? { flowLps: r.overloadFlowLps, pressureKpa: r.overloadPressureKpa }
      : undefined,
    criticalDefectsIdentified: readTriState(r.criticalDefectsIdentified),
    repairsRequired: readTriState(r.repairsRequired),
    systemResult: readResult(r.systemResult, 'Part H'),
    systemNotes: r.systemNotes || undefined,
    licenseeName: r.licenseeName,
    licenceNumber: r.licenceNumber,
    licenseeReportNumber: r.licenseeReportNumber || undefined,
    signature: r.signature || undefined,
    owner: r.owner || undefined,
    ownerContact: r.ownerContact || undefined,
    buildingClassification: r.buildingClassification || undefined,
    technician: r.technician || undefined,
    qualification: r.qualification || undefined,
    defects: readJsonArray<FormDefect>(r.defects ?? '', 'defect list'),
    status: readStatus(r.status),
    issuedAt: r.issuedAt ?? undefined,
    copyGivenAt: r.copyGivenAt ?? undefined,
    jobExternalId: r.jobExternalId || undefined,
    jobTitle: r.jobTitle || undefined,
    attachedAt: r.attachedAt ?? undefined,
    attachmentQueueId: r.attachmentQueueId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createForm72(input: {
  siteId: string;
  siteName: string;
  siteAddress?: string;
  contractor?: string;
  systemLabel?: string;
  /** Prefilled where the app knows them; both still print as typed. */
  licenseeName?: string;
  licenceNumber?: string;
  testDate?: string;
  /** The Simpro job the test is being done under, where the site has one. */
  jobExternalId?: string;
  jobTitle?: string;
  /**
   * Parts the site's asset register can fill before anybody types: the
   * hydrants for Part D, the valve sets for Part G, the system descriptor.
   * Laid over the blank form, so a part not given starts empty as before.
   */
  parts?: Form72Patch;
}): Promise<StoredForm72> {
  const at = nowIso();
  const base = emptyForm72({
    id: newId(),
    siteId: input.siteId,
    siteName: input.siteName,
    contractor: input.contractor,
    now: at,
  });
  /*
   * The company's own meters, on the form before anybody types.
   *
   * Part C was the same two instruments on nearly every hydrant form the
   * company raises, and a form started empty and was issued empty more often
   * than not — four columns of "Not used" under pressures the meters read.
   * So they go on here, with whatever recertification this phone has seen
   * (seedDevices). A caller that passes its own devices keeps them.
   */
  const parts = input.parts ?? {};
  let devices = parts.devices;
  if (!devices?.length) {
    let remembered: RememberedDevice[] = [];
    try {
      remembered = await recentTestDevices();
    } catch {
      // The certificates transcribed in code are still right; a phone that
      // cannot read its own forms gets those.
      remembered = [];
    }
    devices = seedDevices(remembered);
  }
  const record: StoredForm72 = {
    ...base,
    siteAddress: input.siteAddress,
    testDate: input.testDate,
    licenseeName: input.licenseeName ?? '',
    licenceNumber: input.licenceNumber ?? '',
    systemLabel: input.systemLabel ?? '',
    status: 'draft',
    jobExternalId: input.jobExternalId,
    jobTitle: input.jobTitle,
    ...parts,
    devices,
  };

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO form_72
       (id, siteId, siteName, siteAddress, contractor, systemLabel, testDate, testTime,
        maintenanceTest, hydrostatic, flowDeviceKinds, flowDeviceCalibrated, devices,
        flowTest, booster, answeredParts,
        sprinklerHydrostatic, sprinklerFlow, overloadFlowLps, overloadPressureKpa,
        criticalDefectsIdentified, repairsRequired, systemResult, systemNotes,
        licenseeName, licenceNumber, licenseeReportNumber, signature,
        owner, ownerContact, buildingClassification, technician, qualification, defects,
        status, issuedAt, copyGivenAt, jobExternalId, jobTitle, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, record.siteId, record.siteName, record.siteAddress ?? '', record.contractor,
      record.systemLabel, record.testDate ?? null, record.testTime ?? null,
      JSON.stringify(record.maintenanceTest), JSON.stringify(record.hydrostatic),
      JSON.stringify(record.flowDeviceKinds),
      JSON.stringify(record.flowDeviceCalibrated ?? {}), JSON.stringify(record.devices),
      JSON.stringify(record.flowTest), JSON.stringify(record.booster),
      JSON.stringify(record.answeredParts ?? []),
      JSON.stringify(record.sprinklerHydrostatic), JSON.stringify(record.sprinklerFlow),
      record.overload?.flowLps ?? null, record.overload?.pressureKpa ?? null,
      writeTriState(record.criticalDefectsIdentified), writeTriState(record.repairsRequired),
      record.systemResult, record.systemNotes ?? '',
      record.licenseeName, record.licenceNumber, record.licenseeReportNumber ?? '',
      record.signature ?? '',
      record.owner ?? null, record.ownerContact ?? null, record.buildingClassification ?? null,
      record.technician ?? null, record.qualification ?? null, JSON.stringify(record.defects),
      record.status, null, null,
      record.jobExternalId ?? null, record.jobTitle ?? null, record.createdAt, record.updatedAt,
    ],
  );
  return record;
}

/**
 * Names, or clears, the Simpro job the form belongs to.
 *
 * Allowed on an issued form. Linking is filing, not editing: nothing on the
 * document changes, and an issued form that was never linked is exactly the
 * one that most needs to reach the job.
 */
export async function linkForm72Job(id: string, job: { externalId: string; title?: string } | null): Promise<void> {
  const form = await getForm72(id);
  if (!form) throw new Error('That Form 72 no longer exists.');
  const db = await getDb();
  const externalId = job?.externalId.trim() || null;
  /*
   * "Queued for the job" is a statement about the job it was queued for.
   * The screen cleared it in its own state and the row kept it, so a reload
   * after changing the job showed "On the job" against one that had nothing.
   */
  const sameJob = externalId === (form.jobExternalId ?? null);
  await db.runAsync(
    `UPDATE form_72 SET jobExternalId = ?, jobTitle = ?, updatedAt = ?${
      sameJob ? '' : ', attachedAt = NULL, attachmentQueueId = NULL'} WHERE id = ?`,
    [externalId, job?.title?.trim() || null, nowIso(), id],
  );
}

/**
 * Records which defect-register row each of a form's defects became.
 *
 * Allowed on an issued form, and that is the whole reason this exists rather
 * than going through updateForm72. A critical defect on a Form 72 obliges the
 * owner or occupier to be given a written notice, the notice is raised from the
 * defect register, and issuing the form does not discharge it — so a defect on
 * a form signed yesterday still has to reach the office. With no path for it,
 * the only route left was typing the fault into the register by hand, which is
 * the double entry this is meant to remove.
 *
 * Filing, not editing: the id is not printed anywhere and nothing on the
 * document changes. The same judgement linkForm72Job is written on.
 *
 * Only the ids move. The descriptions and the critical flags are read back off
 * the stored row and written out again untouched, matched by position, so a
 * caller cannot reach the text of a signed form through this door — and an id
 * for a position the form no longer holds is dropped rather than extending the
 * list.
 */
export async function recordForm72DefectIds(
  id: string,
  ids: readonly (string | undefined)[],
): Promise<void> {
  const form = await getForm72(id);
  if (!form) throw new Error('That Form 72 no longer exists.');

  const next = form.defects.map((d, i) => {
    const given = ids[i];
    // An id already on a defect is never replaced: it is the record of
    // something that happened, and overwriting it would orphan a register row.
    return d.defectId || !given ? d : { ...d, defectId: given };
  });

  const db = await getDb();
  await db.runAsync(
    'UPDATE form_72 SET defects = ?, updatedAt = ? WHERE id = ?',
    [JSON.stringify(next), nowIso(), id],
  );
}

/** The PDF has been queued onto the job's attachments. */
export async function recordForm72Attached(id: string, at: string = nowIso(), queueId?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE form_72 SET attachedAt = ?, attachmentQueueId = ?, updatedAt = ? WHERE id = ?',
    [at, queueId ?? null, nowIso(), id],
  );
}

export async function getForm72(id: string): Promise<StoredForm72 | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Form72Row>('SELECT * FROM form_72 WHERE id = ?', [id]);
  return row ? toForm(row) : null;
}

export async function listForm72(siteId?: string): Promise<StoredForm72[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<Form72Row>(
      'SELECT * FROM form_72 WHERE siteId = ? ORDER BY testDate DESC, createdAt DESC', [siteId],
    )
    : await db.getAllAsync<Form72Row>('SELECT * FROM form_72 ORDER BY testDate DESC, createdAt DESC');
  return rows.map(toForm);
}

/**
 * How many forms are read back for the equipment list. Well past a year of
 * hydrant work on this book, and one column of one table.
 */
const EQUIPMENT_LOOKBACK_FORMS = 80;

/** A piece of test equipment this phone has recorded before, and when. */
export interface RememberedDevice {
  device: Omit<TestDevice, 'slot'>;
  /** The test date of the form it was last used on, ISO. */
  lastUsed?: string;
}

/**
 * The gauges and meters this phone has recorded before, newest use first.
 *
 * Part C is nine fields per instrument — serial, model, calibration date,
 * certificate, correction factor, dial size, digital reader, increments, and
 * which basis the date was accepted on — and on nearly every hydrant form they
 * are the same instruments as last time, typed again. Two of them are presets
 * (see domain/form72Devices) because they are the company's own flow meters,
 * transcribed from their certificates. The pressure gauge is the one that
 * never is: a technician's own, or a borrowed one, typed out in full at a
 * booster on every form.
 *
 * Read back off the forms already on this phone rather than from a new table,
 * because what is wanted is precisely what this technician typed last time —
 * not a catalogue somebody has to maintain. No migration, and nothing to go
 * stale except the forms themselves.
 *
 * De-duplicated by serial number, keeping the most recent, because the serial
 * is the instrument. A gauge recertified since will come back with the date it
 * had on its last form; the screen offers it rather than writing it, and
 * deviceCalibration still judges that date against this test. An offered date
 * that has lapsed is caught exactly as a typed one is.
 */
export async function recentTestDevices(limit = 10): Promise<RememberedDevice[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ devices: string; testDate: string | null }>(
    `SELECT devices, testDate FROM form_72
     ORDER BY testDate DESC, createdAt DESC LIMIT ?`,
    [EQUIPMENT_LOOKBACK_FORMS],
  );
  const bySerial = new Map<string, RememberedDevice>();
  for (const row of rows) {
    // readJsonArray warns and answers empty for a column it cannot parse, so
    // one unreadable form costs its own equipment and not the list. That form
    // still reports its own fault when somebody opens it.
    for (const d of readJsonArray<TestDevice>(row.devices, 'Part C equipment')) {
      const key = d.serialNumber?.trim().toUpperCase();
      if (!key) continue;
      // Rows come back newest first, so the first sighting of a serial is the
      // most recent one and later ones are older.
      if (bySerial.has(key)) continue;
      const { slot: _slot, ...device } = d;
      bySerial.set(key, { device, lastUsed: row.testDate ?? undefined });
    }
  }
  return [...bySerial.values()].slice(0, limit);
}

/** What an issued form refuses, in the words the screen shows. */
export const ISSUED_REFUSAL = 'This Form 72 has been issued. The occupier is holding a copy of it, '
  + 'so it cannot be edited — raise a new form for the corrected test.';

/**
 * What a screen may change on a draft.
 *
 * issuedAt and copyGivenAt are not on it. They are not fields somebody types —
 * they are the record of two events, and each has one way in: issueForm72,
 * which refuses a form that cannot be issued, and recordOccupierCopy, which
 * refuses a form that has not been. Left on the patch, copyGivenAt could be set
 * on a draft, which is the one state the occupier cannot possibly have a copy
 * in, and the refusal in recordOccupierCopy would be a rule with a door beside
 * it.
 */
export type Form72Patch = Partial<Omit<
  StoredForm72,
  'id' | 'siteId' | 'createdAt' | 'updatedAt' | 'status' | 'issuedAt' | 'copyGivenAt'
  | 'jobExternalId' | 'jobTitle' | 'attachedAt'
>>;

/**
 * Edits a draft.
 *
 * Only the fields present in the patch are written, so two screens editing
 * different parts of the same form cannot overwrite each other's part with a
 * stale copy of it.
 */
export async function updateForm72(id: string, patch: Form72Patch): Promise<void> {
  const existing = await getForm72(id);
  if (!existing) throw new Error('That Form 72 no longer exists.');
  if (existing.status === 'issued') throw new Error(ISSUED_REFUSAL);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const put = (col: string, value: string | number | null): void => {
    fields.push(`${col} = ?`);
    values.push(value);
  };

  if (patch.siteName !== undefined) put('siteName', patch.siteName);
  if (patch.siteAddress !== undefined) put('siteAddress', patch.siteAddress ?? '');
  if (patch.contractor !== undefined) put('contractor', patch.contractor);
  if (patch.systemLabel !== undefined) put('systemLabel', patch.systemLabel);
  /*
   * Present rather than defined, which for these two is the difference between
   * correcting a date and only appearing to.
   *
   * Every other field on this form is a box that clears to an empty string, so
   * `!== undefined` was true of a cleared one and it was written. The test date
   * and the time are typed fields that answer `undefined` for a box with
   * nothing in it — deliberately, because a half-typed date must never become a
   * stored one — so deleting a wrong date patched undefined, was skipped here,
   * and the screen went blank over a row that still held it. The PDF printed
   * from the screen had no date; validateForm72 and issueForm72 re-read the
   * database and accepted the old one; the next open showed it again. On the
   * field whose notice and retention clocks the whole document runs from.
   *
   * `in` is the test the rest of this function already uses for the fields that
   * can legitimately be cleared — see overload and Part H below.
   */
  if ('testDate' in patch) put('testDate', patch.testDate ?? null);
  if ('testTime' in patch) put('testTime', patch.testTime ?? null);
  if (patch.maintenanceTest !== undefined) put('maintenanceTest', JSON.stringify(patch.maintenanceTest));
  if (patch.hydrostatic !== undefined) put('hydrostatic', JSON.stringify(patch.hydrostatic));
  if (patch.flowDeviceKinds !== undefined) put('flowDeviceKinds', JSON.stringify(patch.flowDeviceKinds));
  if (patch.flowDeviceCalibrated !== undefined) {
    put('flowDeviceCalibrated', JSON.stringify(patch.flowDeviceCalibrated));
  }
  if (patch.answeredParts !== undefined) put('answeredParts', JSON.stringify(patch.answeredParts));
  if (patch.devices !== undefined) put('devices', JSON.stringify(patch.devices));
  if (patch.flowTest !== undefined) put('flowTest', JSON.stringify(patch.flowTest));
  if (patch.booster !== undefined) put('booster', JSON.stringify(patch.booster));
  if (patch.sprinklerHydrostatic !== undefined) put('sprinklerHydrostatic', JSON.stringify(patch.sprinklerHydrostatic));
  if (patch.sprinklerFlow !== undefined) put('sprinklerFlow', JSON.stringify(patch.sprinklerFlow));
  // Tested with `in` for the same reason as Part H below: undefined is the
  // stored state that means no overload run was made, so clearing a run that
  // was entered by mistake has to be able to write it back. Skipped on
  // undefined, a mistyped run would stay in the database and keep printing on
  // the form after the screen had shown it cleared.
  if ('overload' in patch) {
    // Half a run is not a run — overloadRun holds that rule, and holds it for
    // the screen and the printed page as well, so the three cannot disagree
    // about whether a run was made.
    const run = overloadRun(patch.overload);
    put('overloadFlowLps', run?.flowLps ?? null);
    put('overloadPressureKpa', run?.pressureKpa ?? null);
  }
  // Tested with `in` rather than against undefined, because undefined is the
  // stored value that means "nobody answered Part H" — a patch that sets it
  // back to unanswered has to be able to say so.
  if ('criticalDefectsIdentified' in patch) {
    put('criticalDefectsIdentified', writeTriState(patch.criticalDefectsIdentified));
  }
  if ('repairsRequired' in patch) {
    put('repairsRequired', writeTriState(patch.repairsRequired));
  }
  if (patch.systemResult !== undefined) put('systemResult', patch.systemResult);
  if (patch.systemNotes !== undefined) put('systemNotes', patch.systemNotes ?? '');
  if (patch.licenseeName !== undefined) put('licenseeName', patch.licenseeName);
  if (patch.licenceNumber !== undefined) put('licenceNumber', patch.licenceNumber);
  if (patch.licenseeReportNumber !== undefined) put('licenseeReportNumber', patch.licenseeReportNumber ?? '');
  if (patch.signature !== undefined) put('signature', patch.signature ?? '');
  if (patch.owner !== undefined) put('owner', patch.owner ?? null);
  if (patch.ownerContact !== undefined) put('ownerContact', patch.ownerContact ?? null);
  if (patch.buildingClassification !== undefined) {
    put('buildingClassification', patch.buildingClassification ?? null);
  }
  if (patch.technician !== undefined) put('technician', patch.technician ?? null);
  if (patch.qualification !== undefined) put('qualification', patch.qualification ?? null);
  if (patch.defects !== undefined) put('defects', JSON.stringify(patch.defects));

  if (!fields.length) return;
  put('updatedAt', nowIso());
  const db = await getDb();
  await db.runAsync(`UPDATE form_72 SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
}

/**
 * Marks a form issued, or refuses and says why.
 *
 * The refusal carries every blocking reason rather than the first one. A
 * technician on a roof told to fix one thing, who fixes it and is then told
 * about the next, stops trusting the app.
 */
export async function issueForm72(id: string, at?: string): Promise<StoredForm72> {
  const form = await getForm72(id);
  if (!form) throw new Error('That Form 72 no longer exists.');
  if (form.status === 'issued') return form;

  if (!canIssue(form)) {
    const blocking = validateForm72(form).filter((i) => i.blocking);
    throw new Error(
      `This Form 72 cannot be issued yet:\n\n${
        blocking.map((i) => `• Part ${i.part} — ${i.message}`).join('\n')}`,
    );
  }

  const issuedAt = at ?? nowIso();
  const db = await getDb();
  await db.runAsync(
    'UPDATE form_72 SET status = ?, issuedAt = ?, updatedAt = ? WHERE id = ?',
    ['issued', issuedAt, issuedAt, id],
  );
  return { ...form, status: 'issued', issuedAt };
}

/**
 * Records that the occupier has their copy.
 *
 * Allowed on an issued form, and only on an issued form. It is not an edit to
 * the document — it is the fact MP 6.1 A4(b) actually hangs on, and it happens
 * after issue by definition.
 */
export async function recordOccupierCopy(id: string, at: string): Promise<void> {
  const form = await getForm72(id);
  if (!form) throw new Error('That Form 72 no longer exists.');
  if (form.status !== 'issued') {
    throw new Error('The occupier cannot be given a copy of a form that has not been issued.');
  }
  const db = await getDb();
  await db.runAsync(
    'UPDATE form_72 SET copyGivenAt = ?, updatedAt = ? WHERE id = ?', [at, nowIso(), id],
  );
}

/**
 * Deletes a draft.
 *
 * An issued form is not deletable. MP 6.1 A5 requires the person who did the
 * work to keep a record of it for five years, and a delete button that removes
 * that record is a compliance failure dressed as tidying up.
 */
export async function deleteForm72(id: string): Promise<void> {
  const form = await getForm72(id);
  if (!form) return;
  if (form.status === 'issued') {
    throw new Error(
      'An issued Form 72 cannot be deleted. QDC MP 6.1 requires the person who carried out the '
      + 'maintenance to keep a record of it for at least five years.',
    );
  }
  const db = await getDb();
  await db.runAsync('DELETE FROM form_72 WHERE id = ?', [id]);
}
