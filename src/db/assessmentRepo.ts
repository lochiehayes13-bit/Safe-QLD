import { getDb, newId, nowIso } from '@/db';
import { renumber, type Finding, type FindingKind, type FindingPriority } from '@/domain/findings';

/**
 * Effectiveness assessments and the findings on them.
 *
 * Deliberately its own tables and its own repository. A finding is not a defect
 * and there is no path here that could make it one — nothing writes to the
 * defect table, and the finding table has no column a severity or a statutory
 * notice could live in.
 */

export interface Assessment {
  id: string;
  siteId: string;
  reportReference: string;
  jobReference: string;
  assessmentType: string;
  /** The building this covers, which is often not the whole site. */
  scopeLabel: string;
  /** What was deliberately not assessed. */
  boundary: string;
  attendanceDate?: string;
  issueDate?: string;
  assessedBy: string;
  preparedBy: string;
  clientName: string;
  systemDescription: string;
  panelStatus: string;
  summary: string;
  statement: string;
  status: 'draft' | 'issued';
  createdAt: string;
  updatedAt: string;
}

interface AssessmentRow extends Omit<Assessment, 'attendanceDate' | 'issueDate'> {
  attendanceDate: string | null;
  issueDate: string | null;
}

interface FindingRow {
  id: string;
  assessmentId: string;
  kind: string;
  seq: number;
  item: string;
  location: string;
  reference: string | null;
  detail: string;
  action: string;
  priority: string | null;
  relatedRefs: string;
  photos: string;
  createdAt: string;
  updatedAt: string;
}

const list = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);

const toAssessment = (r: AssessmentRow): Assessment => ({
  ...r,
  attendanceDate: r.attendanceDate ?? undefined,
  issueDate: r.issueDate ?? undefined,
  status: r.status === 'issued' ? 'issued' : 'draft',
});

const toFinding = (r: FindingRow): Finding => ({
  id: r.id,
  assessmentId: r.assessmentId,
  kind: r.kind === 'observation' ? 'observation' : 'recommendation',
  seq: r.seq,
  item: r.item,
  location: r.location,
  reference: r.reference ?? undefined,
  detail: r.detail,
  action: r.action,
  priority: (r.priority ?? undefined) as FindingPriority | undefined,
  relatedRefs: list(r.relatedRefs),
  photos: list(r.photos),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export async function createAssessment(
  input: Partial<Assessment> & Pick<Assessment, 'siteId'>,
): Promise<Assessment> {
  const db = await getDb();
  const at = nowIso();
  const record: Assessment = {
    id: newId(),
    reportReference: '',
    jobReference: '',
    assessmentType: 'Fire System Effectiveness / Readiness',
    scopeLabel: '',
    boundary: '',
    assessedBy: '',
    preparedBy: '',
    clientName: '',
    systemDescription: '',
    panelStatus: '',
    summary: '',
    statement: '',
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    ...input,
  };
  await db.runAsync(
    `INSERT INTO assessment
       (id, siteId, reportReference, jobReference, assessmentType, scopeLabel, boundary,
        attendanceDate, issueDate, assessedBy, preparedBy, clientName, systemDescription,
        panelStatus, summary, statement, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, record.siteId, record.reportReference, record.jobReference, record.assessmentType,
      record.scopeLabel, record.boundary, record.attendanceDate ?? null, record.issueDate ?? null,
      record.assessedBy, record.preparedBy, record.clientName, record.systemDescription,
      record.panelStatus, record.summary, record.statement, record.status,
      record.createdAt, record.updatedAt,
    ],
  );
  return record;
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AssessmentRow>('SELECT * FROM assessment WHERE id = ?', [id]);
  return row ? toAssessment(row) : null;
}

export async function listAssessments(siteId?: string): Promise<Assessment[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<AssessmentRow>(
      'SELECT * FROM assessment WHERE siteId = ? ORDER BY attendanceDate DESC, createdAt DESC', [siteId],
    )
    : await db.getAllAsync<AssessmentRow>(
      'SELECT * FROM assessment ORDER BY attendanceDate DESC, createdAt DESC',
    );
  return rows.map(toAssessment);
}

export async function updateAssessment(id: string, patch: Partial<Assessment>): Promise<void> {
  const fields: string[] = [];
  const values: (string | null)[] = [];
  const allowed: (keyof Assessment)[] = [
    'reportReference', 'jobReference', 'assessmentType', 'scopeLabel', 'boundary',
    'attendanceDate', 'issueDate', 'assessedBy', 'preparedBy', 'clientName',
    'systemDescription', 'panelStatus', 'summary', 'statement', 'status',
  ];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    fields.push(`${key} = ?`);
    values.push((patch[key] as string | undefined) ?? null);
  }
  if (!fields.length) return;
  fields.push('updatedAt = ?');
  values.push(nowIso());
  const db = await getDb();
  await db.runAsync(`UPDATE assessment SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
}

export async function deleteAssessment(id: string): Promise<void> {
  const db = await getDb();
  // Findings cascade, but the pragma is not on by default in every build, so
  // they are removed explicitly rather than left orphaned.
  await db.runAsync('DELETE FROM finding WHERE assessmentId = ?', [id]);
  await db.runAsync('DELETE FROM assessment WHERE id = ?', [id]);
}

export async function listFindings(assessmentId: string): Promise<Finding[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FindingRow>(
    `SELECT * FROM finding WHERE assessmentId = ?
     ORDER BY CASE kind WHEN 'recommendation' THEN 0 ELSE 1 END, seq`,
    [assessmentId],
  );
  return rows.map(toFinding);
}

/**
 * Adds a finding at the end of its kind.
 *
 * The sequence is taken from what is already stored rather than from a counter
 * held anywhere, so two findings added from different screens cannot collide on
 * a number.
 */
export async function addFinding(
  assessmentId: string,
  input: Partial<Omit<Finding, 'id' | 'assessmentId' | 'seq'>> & { kind: FindingKind },
): Promise<Finding> {
  const existing = await listFindings(assessmentId);
  const seq = existing.filter((f) => f.kind === input.kind).length + 1;
  const at = nowIso();
  const record: Finding = {
    id: newId(),
    assessmentId,
    seq,
    item: '',
    location: '',
    detail: '',
    action: '',
    relatedRefs: [],
    photos: [],
    createdAt: at,
    updatedAt: at,
    ...input,
  };
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO finding
       (id, assessmentId, kind, seq, item, location, reference, detail, action, priority,
        relatedRefs, photos, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, assessmentId, record.kind, record.seq, record.item, record.location,
      record.reference ?? null, record.detail, record.action, record.priority ?? null,
      record.relatedRefs.join(','), record.photos.join(','), record.createdAt, record.updatedAt,
    ],
  );
  return record;
}

export async function updateFinding(id: string, patch: Partial<Finding>): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const put = (col: string, value: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(value);
  };
  if (patch.kind !== undefined) put('kind', patch.kind);
  if (patch.seq !== undefined) put('seq', patch.seq);
  if (patch.item !== undefined) put('item', patch.item);
  if (patch.location !== undefined) put('location', patch.location);
  if (patch.reference !== undefined) put('reference', patch.reference ?? null);
  if (patch.detail !== undefined) put('detail', patch.detail);
  if (patch.action !== undefined) put('action', patch.action);
  if (patch.priority !== undefined) put('priority', patch.priority ?? null);
  if (patch.relatedRefs !== undefined) put('relatedRefs', patch.relatedRefs.join(','));
  if (patch.photos !== undefined) put('photos', patch.photos.join(','));
  if (!fields.length) return;
  put('updatedAt', nowIso());
  const db = await getDb();
  await db.runAsync(`UPDATE finding SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
}

export async function deleteFinding(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ assessmentId: string }>(
    'SELECT assessmentId FROM finding WHERE id = ?', [id],
  );
  await db.runAsync('DELETE FROM finding WHERE id = ?', [id]);
  // Numbers have to close up behind a deletion, or the register prints a gap
  // and a client asks which finding was removed before issue.
  if (row) await resequence(row.assessmentId);
}

/** Rewrites the sequence numbers so each kind runs from one without gaps. */
export async function resequence(assessmentId: string): Promise<void> {
  const current = await listFindings(assessmentId);
  const fixed = renumber(current);
  const db = await getDb();
  for (const f of fixed) {
    const before = current.find((c) => c.id === f.id);
    if (before && before.seq === f.seq) continue;
    await db.runAsync('UPDATE finding SET seq = ?, updatedAt = ? WHERE id = ?', [f.seq, nowIso(), f.id]);
  }
}
