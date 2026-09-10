import { getDb, newId, nowIso } from '@/db';
import {
  canSign, mergeSwms, whyNotSigned,
  type AddedHazard, type PermitHeld, type SwmsRecord, type SwmsStatus, type SwmsTemplate, type SwmsWorker,
} from '@/domain/swms';
import { SWMS_TEMPLATES, templateById } from '@/seed/swms';

/**
 * Storing the day's safe work method statement.
 *
 * The rules about what may be signed live in domain/swms.ts. This layer refuses
 * to write anything those rules refuse, in the same words the screen would use,
 * because the screen is not the only caller and a repository that quietly
 * signed an incomplete statement would make the validation decorative.
 *
 * A signed statement is immutable, the same way an issued Form 72 is. The crew
 * has started work under it and a principal contractor may already hold a copy;
 * changing it afterwards would leave two documents that disagree. What is
 * allowed after signing is filing — naming the Simpro job, and recording that
 * the PDF reached it — because neither changes a word on the page.
 *
 * The list columns are JSON and are read back through guards. A column that
 * cannot be parsed comes back as its empty shape rather than a plausible
 * default, so a corrupt row costs that list and is visibly wrong, rather than
 * quietly presenting a statement with no hazards on it.
 */

interface SwmsRow {
  id: string;
  templateIds: string;
  title: string;
  siteId: string | null;
  siteName: string | null;
  jobExternalId: string | null;
  jobTitle: string | null;
  date: string;
  supervisor: string | null;
  supervisorPhone: string | null;
  answers: string;
  addedHazards: string;
  ticked: string;
  ppeChecked: string;
  permits: string;
  workers: string;
  status: string;
  signedAt: string | null;
  attachedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function readJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    // A statement with one unreadable column is still worth showing; the
    // caller sees an empty list, which reads as wrong, rather than a default
    // that reads as complete.
    return fallback;
  }
}

function readStatus(value: string): SwmsStatus {
  return value === 'signed' ? 'signed' : 'draft';
}

function toRecord(r: SwmsRow): SwmsRecord {
  return {
    id: r.id,
    templateIds: readJson<string[]>(r.templateIds, []),
    title: r.title,
    siteId: r.siteId ?? undefined,
    siteName: r.siteName ?? undefined,
    jobExternalId: r.jobExternalId || undefined,
    jobTitle: r.jobTitle || undefined,
    date: r.date,
    supervisor: r.supervisor ?? undefined,
    supervisorPhone: r.supervisorPhone ?? undefined,
    answers: readJson<Record<string, string>>(r.answers, {}),
    addedHazards: readJson<AddedHazard[]>(r.addedHazards, []),
    ticked: readJson<string[]>(r.ticked, []),
    ppeChecked: readJson<string[]>(r.ppeChecked, []),
    permits: readJson<PermitHeld[]>(r.permits, []),
    workers: readJson<SwmsWorker[]>(r.workers, []),
    status: readStatus(r.status),
    signedAt: r.signedAt ?? undefined,
    attachedAt: r.attachedAt ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The templates a stored record was built from, in the order it holds them. */
export function templatesFor(record: SwmsRecord): SwmsTemplate[] {
  const out: SwmsTemplate[] = [];
  for (const id of record.templateIds) {
    const t = templateById(id);
    if (t) out.push(t);
  }
  return out;
}

export async function createSwms(input: {
  templateIds: string[];
  date: string;
  title?: string;
  siteId?: string;
  siteName?: string;
  jobExternalId?: string;
  jobTitle?: string;
  supervisor?: string;
  supervisorPhone?: string;
  /** Carried from yesterday's statement, where the crew asked for that. */
  answers?: Record<string, string>;
  addedHazards?: AddedHazard[];
  ppeChecked?: string[];
  permits?: PermitHeld[];
  workers?: SwmsWorker[];
  notes?: string;
}): Promise<SwmsRecord> {
  const at = nowIso();
  const templates = input.templateIds.map((id) => templateById(id)).filter((t): t is SwmsTemplate => Boolean(t));
  const merged = mergeSwms(templates);

  const record: SwmsRecord = {
    id: newId(),
    templateIds: templates.map((t) => t.id),
    title: input.title?.trim() || (templates.length === 1 ? templates[0]!.title : 'Job safety analysis'),
    siteId: input.siteId,
    siteName: input.siteName,
    jobExternalId: input.jobExternalId,
    jobTitle: input.jobTitle,
    date: input.date,
    supervisor: input.supervisor,
    supervisorPhone: input.supervisorPhone,
    answers: input.answers ?? {},
    addedHazards: input.addedHazards ?? [],
    ticked: [],
    ppeChecked: input.ppeChecked ?? [],
    // Every permit the chosen statements require starts on the record, unticked,
    // so the crew sees what they are missing before they start rather than at
    // the sign-off.
    permits: merged.permits.map((p) => input.permits?.find((h) => h.permit === p) ?? { permit: p, held: false }),
    workers: input.workers ?? [],
    status: 'draft',
    notes: input.notes,
    createdAt: at,
    updatedAt: at,
  };

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO swms
       (id, templateIds, title, siteId, siteName, jobExternalId, jobTitle, date, supervisor, supervisorPhone,
        answers, addedHazards, ticked, ppeChecked, permits, workers, status, signedAt, attachedAt, notes,
        createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, JSON.stringify(record.templateIds), record.title, record.siteId ?? null, record.siteName ?? null,
      record.jobExternalId ?? null, record.jobTitle ?? null, record.date, record.supervisor ?? null,
      record.supervisorPhone ?? null, JSON.stringify(record.answers), JSON.stringify(record.addedHazards),
      JSON.stringify(record.ticked), JSON.stringify(record.ppeChecked), JSON.stringify(record.permits),
      JSON.stringify(record.workers), record.status, null, null, record.notes ?? null,
      record.createdAt, record.updatedAt,
    ],
  );
  return record;
}

export async function getSwms(id: string): Promise<SwmsRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SwmsRow>('SELECT * FROM swms WHERE id = ?', [id]);
  return row ? toRecord(row) : null;
}

/** Newest first. Scoped to a site where one is given. */
export async function listSwms(options: { siteId?: string; limit?: number } = {}): Promise<SwmsRecord[]> {
  const db = await getDb();
  const rows = options.siteId
    ? await db.getAllAsync<SwmsRow>('SELECT * FROM swms WHERE siteId = ? ORDER BY date DESC, createdAt DESC LIMIT ?', [options.siteId, options.limit ?? 50])
    : await db.getAllAsync<SwmsRow>('SELECT * FROM swms ORDER BY date DESC, createdAt DESC LIMIT ?', [options.limit ?? 50]);
  return rows.map(toRecord);
}

/**
 * The statement already covering this day's work, where there is one.
 *
 * What stops a crew signing a second statement for the same site on the same
 * day and then arguing about which one the principal contractor holds.
 */
export async function swmsForDay(date: string, siteId?: string): Promise<SwmsRecord | null> {
  const db = await getDb();
  const row = siteId
    ? await db.getFirstAsync<SwmsRow>('SELECT * FROM swms WHERE date = ? AND siteId = ? ORDER BY createdAt DESC LIMIT 1', [date, siteId])
    : await db.getFirstAsync<SwmsRow>('SELECT * FROM swms WHERE date = ? ORDER BY createdAt DESC LIMIT 1', [date]);
  return row ? toRecord(row) : null;
}

export const SIGNED_REFUSAL = 'This statement has been signed and the crew is working under it. '
  + 'A signed statement is not edited — if the work has changed, start a new one for the change.';

export type SwmsPatch = Partial<Omit<SwmsRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'signedAt' | 'attachedAt'>>;

export async function updateSwms(id: string, patch: SwmsPatch): Promise<void> {
  const record = await getSwms(id);
  if (!record) throw new Error('That statement no longer exists.');
  if (record.status === 'signed') throw new Error(SIGNED_REFUSAL);

  const next: SwmsRecord = { ...record, ...patch, updatedAt: nowIso() };
  const db = await getDb();
  await db.runAsync(
    `UPDATE swms SET templateIds = ?, title = ?, siteId = ?, siteName = ?, jobExternalId = ?, jobTitle = ?,
       date = ?, supervisor = ?, supervisorPhone = ?, answers = ?, addedHazards = ?, ticked = ?,
       ppeChecked = ?, permits = ?, workers = ?, notes = ?, updatedAt = ?
     WHERE id = ?`,
    [
      JSON.stringify(next.templateIds), next.title, next.siteId ?? null, next.siteName ?? null,
      next.jobExternalId ?? null, next.jobTitle ?? null, next.date, next.supervisor ?? null,
      next.supervisorPhone ?? null, JSON.stringify(next.answers), JSON.stringify(next.addedHazards),
      JSON.stringify(next.ticked), JSON.stringify(next.ppeChecked), JSON.stringify(next.permits),
      JSON.stringify(next.workers), next.notes ?? null, next.updatedAt, id,
    ],
  );
}

/**
 * Signs the statement, or refuses and says why.
 *
 * The refusal is the screen's sentence rather than an error code, because this
 * is the one place in the app where "no" is the useful answer: a crew that
 * cannot sign is a crew that has not read a step or has not got a permit, and
 * both of those are things to go and do.
 */
export async function signSwms(id: string, at: string = nowIso()): Promise<SwmsRecord> {
  const record = await getSwms(id);
  if (!record) throw new Error('That statement no longer exists.');
  if (record.status === 'signed') return record;

  const merged = mergeSwms(templatesFor(record));
  if (!canSign(record, merged)) throw new Error(whyNotSigned(record, merged) ?? 'This statement is not ready to sign.');

  const db = await getDb();
  await db.runAsync('UPDATE swms SET status = ?, signedAt = ?, updatedAt = ? WHERE id = ?', ['signed', at, at, id]);
  return { ...record, status: 'signed', signedAt: at, updatedAt: at };
}

/**
 * Names, or clears, the Simpro job the statement belongs to.
 *
 * Allowed after signing. Linking is filing, not editing: nothing on the
 * document changes, and a signed statement that was never linked is exactly
 * the one that most needs to reach the job.
 */
export async function linkSwmsJob(id: string, job: { externalId: string; title?: string } | null): Promise<void> {
  const record = await getSwms(id);
  if (!record) throw new Error('That statement no longer exists.');
  const db = await getDb();
  await db.runAsync(
    'UPDATE swms SET jobExternalId = ?, jobTitle = ?, updatedAt = ? WHERE id = ?',
    [job?.externalId ?? null, job?.title ?? null, nowIso(), id],
  );
}

export async function recordSwmsAttached(id: string, at: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE swms SET attachedAt = ?, updatedAt = ? WHERE id = ?', [at, at, id]);
}

export async function deleteSwms(id: string): Promise<void> {
  const record = await getSwms(id);
  if (record?.status === 'signed') throw new Error(SIGNED_REFUSAL);
  const db = await getDb();
  await db.runAsync('DELETE FROM swms WHERE id = ?', [id]);
}

/** Every template the app ships, for the picker. */
export function allTemplates(): SwmsTemplate[] {
  return [...SWMS_TEMPLATES];
}
