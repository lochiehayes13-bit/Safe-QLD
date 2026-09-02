import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, newId, nowIso } from './index';
import type {
  CauseEffect,
  CauseEffectRule,
  CheckRow,
  Defect,
  Loop,
  Panel,
  ParsedConfig,
  Point,
  ServiceReport,
  Site,
  TestRow,
  Zone,
} from '@/domain/types';

// SQLite has no boolean type; these keep the conversion in one place.
const toBool = (n: number | null | undefined): boolean => n === 1;
const fromBool = (b: boolean | undefined): number => (b ? 1 : 0);

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function listSites(): Promise<Site[]> {
  const db = await getDb();
  return db.getAllAsync<Site>('SELECT * FROM site ORDER BY name COLLATE NOCASE');
}

export async function getSite(id: string): Promise<Site | null> {
  const db = await getDb();
  return (await db.getFirstAsync<Site>('SELECT * FROM site WHERE id = ?', id)) ?? null;
}

export async function createSite(input: Partial<Site> & { name: string }): Promise<Site> {
  const db = await getDb();
  const site: Site = {
    id: input.id ?? newId(),
    name: input.name,
    address: input.address,
    suburb: input.suburb,
    state: input.state ?? 'QLD',
    postcode: input.postcode,
    clientName: input.clientName,
    siteRef: input.siteRef,
    notes: input.notes,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactWorkPhone: input.contactWorkPhone,
    contactMobile: input.contactMobile,
    externalId: input.externalId,
    externalSource: input.externalSource,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.runAsync(
    `INSERT INTO site (id,name,address,suburb,state,postcode,clientName,siteRef,notes,
                       contactName,contactEmail,contactWorkPhone,contactMobile,
                       externalId,externalSource,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    site.id, site.name, site.address ?? null, site.suburb ?? null, site.state ?? null,
    site.postcode ?? null, site.clientName ?? null, site.siteRef ?? null, site.notes ?? null,
    site.contactName ?? null, site.contactEmail ?? null, site.contactWorkPhone ?? null,
    site.contactMobile ?? null, site.externalId ?? null, site.externalSource ?? null,
    site.createdAt, site.updatedAt,
  );
  return site;
}

export async function updateSite(id: string, patch: Partial<Site>): Promise<void> {
  const db = await getDb();
  const fields = ['name', 'address', 'suburb', 'state', 'postcode', 'clientName', 'siteRef', 'notes',
    'contactName', 'contactEmail', 'contactWorkPhone', 'contactMobile',
    'externalId', 'externalSource'] as const;
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const f of fields) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push((patch[f] as string | undefined) ?? null);
    }
  }
  if (!sets.length) return;
  sets.push('updatedAt = ?');
  vals.push(nowIso());
  await db.runAsync(`UPDATE site SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

export async function deleteSite(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM site WHERE id = ?', id);
}

/** Counts shown on the site list so a tech can see at a glance what a site holds. */
export interface SiteSummary extends Site {
  panelCount: number;
  pointCount: number;
  openDefects: number;
}

export async function listSiteSummaries(): Promise<SiteSummary[]> {
  const db = await getDb();
  return db.getAllAsync<SiteSummary>(`
    SELECT s.*,
      (SELECT COUNT(*) FROM panel p WHERE p.siteId = s.id) AS panelCount,
      (SELECT COUNT(*) FROM point pt JOIN panel p2 ON pt.panelId = p2.id WHERE p2.siteId = s.id) AS pointCount,
      (SELECT COUNT(*) FROM defect d WHERE d.siteId = s.id AND d.status = 'open') AS openDefects
    FROM site s
    ORDER BY s.name COLLATE NOCASE
  `);
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export async function listPanels(siteId: string): Promise<Panel[]> {
  const db = await getDb();
  return db.getAllAsync<Panel>(
    'SELECT * FROM panel WHERE siteId = ? ORDER BY COALESCE(nodeNumber, 999), name COLLATE NOCASE',
    siteId,
  );
}

export async function getPanel(id: string): Promise<Panel | null> {
  const db = await getDb();
  return (await db.getFirstAsync<Panel>('SELECT * FROM panel WHERE id = ?', id)) ?? null;
}

export async function createPanel(input: Omit<Panel, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): Promise<Panel> {
  const db = await getDb();
  const panel: Panel = { ...input, id: input.id ?? newId(), createdAt: nowIso(), updatedAt: nowIso() };
  await db.runAsync(
    `INSERT INTO panel (id,siteId,name,brand,model,nodeNumber,location,firmware,source,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    panel.id, panel.siteId, panel.name, panel.brand, panel.model ?? null,
    panel.nodeNumber ?? null, panel.location ?? null, panel.firmware ?? null,
    panel.source, panel.createdAt, panel.updatedAt,
  );
  return panel;
}

export async function deletePanel(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM panel WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Zones / points / loops
// ---------------------------------------------------------------------------

export interface PointQuery {
  panelId?: string;
  siteId?: string;
  /** Free-text across point text, zone text and point ref. */
  search?: string;
  /** Hide points the config marks unused. Defaults to true, matching panel practice. */
  includeUnused?: boolean;
  loopNumber?: number;
  zoneNumber?: number;
  deviceType?: string;
  limit?: number;
  offset?: number;
}

export async function queryPoints(q: PointQuery): Promise<Point[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (q.panelId) { where.push('pt.panelId = ?'); args.push(q.panelId); }
  if (q.siteId) { where.push('p.siteId = ?'); args.push(q.siteId); }
  if (!q.includeUnused) where.push('pt.unused = 0');
  if (q.loopNumber !== undefined) { where.push('pt.loopNumber = ?'); args.push(q.loopNumber); }
  if (q.zoneNumber !== undefined) { where.push('pt.zoneNumber = ?'); args.push(q.zoneNumber); }
  if (q.deviceType) { where.push('pt.deviceType = ?'); args.push(q.deviceType); }
  if (q.search?.trim()) {
    const term = `%${q.search.trim()}%`;
    where.push('(pt.text LIKE ? OR pt.text2 LIKE ? OR pt.zoneText LIKE ? OR pt.pointRef LIKE ?)');
    args.push(term, term, term, term);
  }

  const sql = `
    SELECT pt.* FROM point pt
    JOIN panel p ON pt.panelId = p.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pt.loopNumber, pt.address, pt.pointRef
    LIMIT ? OFFSET ?`;
  args.push(q.limit ?? 2000, q.offset ?? 0);

  const rows = await db.getAllAsync<Omit<Point, 'unused'> & { unused: number }>(sql, ...args);
  return rows.map((r) => ({ ...r, unused: toBool(r.unused) }));
}

/**
 * How many points a site holds — the number, not the rows.
 *
 * The site screen used to read every point on the site to take its length,
 * which on a large Simplex network is tens of thousands of rows for one tile.
 * Unused points are left out by default, as queryPoints leaves them out.
 */
export async function countPoints(siteId: string, includeUnused = false): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM point pt
     JOIN panel p ON pt.panelId = p.id
     WHERE p.siteId = ? ${includeUnused ? '' : 'AND pt.unused = 0'}`,
    siteId,
  );
  return row?.n ?? 0;
}

/**
 * Points per zone on a panel, counted in SQL.
 *
 * Keyed by panel rather than by site because zone numbers are: zone 1 on the
 * north panel and zone 1 on the south panel are different zones. Unused
 * points are counted, as the zone chart counts them.
 */
export async function countPointsByZone(panelId: string): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ zoneNumber: number; n: number }>(
    `SELECT zoneNumber, COUNT(*) AS n FROM point
     WHERE panelId = ? AND zoneNumber IS NOT NULL
     GROUP BY zoneNumber`,
    panelId,
  );
  return new Map(rows.map((r) => [r.zoneNumber, r.n]));
}

export async function listZones(panelId: string, includeUnused = false): Promise<Zone[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Zone, 'unused'> & { unused: number }>(
    `SELECT * FROM zone WHERE panelId = ? ${includeUnused ? '' : 'AND unused = 0'} ORDER BY number`,
    panelId,
  );
  return rows.map((r) => ({ ...r, unused: toBool(r.unused) }));
}

export async function listLoops(panelId: string): Promise<Loop[]> {
  const db = await getDb();
  return db.getAllAsync<Loop>('SELECT * FROM loop WHERE panelId = ? ORDER BY number', panelId);
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/**
 * Writes a parsed config into a site as one or more panels.
 *
 * Runs in a single transaction and batches inserts, because a large Simplex
 * network can carry tens of thousands of points and a per-row round trip would
 * take minutes on a mid-range phone.
 */
export async function importParsedConfig(
  siteId: string,
  parsed: ParsedConfig,
  source: Panel['source'] = 'config-import',
): Promise<{ panelIds: string[]; pointCount: number; zoneCount: number }> {
  const db = await getDb();
  const panelIds: string[] = [];
  let pointCount = 0;
  let zoneCount = 0;

  await db.withTransactionAsync(async () => {
    for (const pp of parsed.panels) {
      const panelId = newId();
      panelIds.push(panelId);
      const ts = nowIso();
      await db.runAsync(
        `INSERT INTO panel (id,siteId,name,brand,model,nodeNumber,location,firmware,source,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        panelId, siteId, pp.name, pp.brand, pp.model ?? null, pp.nodeNumber ?? null,
        null, null, source, ts, ts,
      );

      await insertMany(db, 'loop', ['id', 'panelId', 'number', 'label', 'protocol', 'measuredCurrentMa'],
        pp.loops.map((l) => [newId(), panelId, l.number, l.label ?? null, l.protocol ?? null, l.measuredCurrentMa ?? null]));

      await insertMany(db, 'zone', ['id', 'panelId', 'number', 'text', 'text2', 'type', 'unused'],
        pp.zones.map((z) => [newId(), panelId, z.number, z.text, z.text2 ?? null, z.type ?? null, fromBool(z.unused)]));
      zoneCount += pp.zones.length;

      await insertMany(db, 'point',
        ['id', 'panelId', 'loopNumber', 'address', 'subAddress', 'pointRef', 'text', 'text2', 'deviceTypeRaw', 'deviceType', 'zoneNumber', 'zoneText', 'unused'],
        pp.points.map((pt) => [
          newId(), panelId, pt.loopNumber ?? null, pt.address ?? null, pt.subAddress ?? null,
          pt.pointRef ?? null, pt.text, pt.text2 ?? null, pt.deviceTypeRaw ?? null,
          pt.deviceType, pt.zoneNumber ?? null, pt.zoneText ?? null, fromBool(pt.unused),
        ]));
      pointCount += pp.points.length;

      for (const rule of pp.causeEffect) {
        const ruleId = newId();
        await db.runAsync(
          `INSERT INTO ce_rule (id,panelId,causeLabel,causeKind,causeZoneNumber,causePointRef,sourceLogic,notes)
           VALUES (?,?,?,?,?,?,?,?)`,
          ruleId, panelId, rule.causeLabel, rule.causeKind, rule.causeZoneNumber ?? null,
          rule.causePointRef ?? null, rule.sourceLogic ?? null, rule.notes ?? null,
        );
        await insertMany(db, 'ce_effect', ['id', 'ruleId', 'effectLabel', 'effectKind', 'delaySeconds', 'state'],
          rule.effects.map((e) => [newId(), ruleId, e.effectLabel, e.effectKind, e.delaySeconds ?? null, e.state]));
      }
    }
  });

  return { panelIds, pointCount, zoneCount };
}

type SqlValue = string | number | null;

/**
 * Multi-row INSERT in chunks.
 *
 * SQLite's default host-parameter limit is 999, so the chunk size is derived
 * from the column count rather than fixed.
 */
async function insertMany(db: SQLiteDatabase, table: string, cols: string[], rows: SqlValue[][]): Promise<void> {
  if (!rows.length) return;
  const perRow = cols.length;
  const maxRows = Math.max(1, Math.floor(900 / perRow));
  const placeholder = `(${cols.map(() => '?').join(',')})`;

  for (let i = 0; i < rows.length; i += maxRows) {
    const chunk = rows.slice(i, i + maxRows);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${chunk.map(() => placeholder).join(',')}`;
    await db.runAsync(sql, ...chunk.flat());
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** The three record-of-maintenance answers are 1/0/NULL in the row and boolean-or-absent in the record. */
const REPORT_FLAGS = ['qdcCompliance', 'inProperWorkingOrder', 'hardcopyLeftOnSite'] as const;

function hydrateReport(row: Record<string, unknown>): ServiceReport {
  const out = { ...row } as Record<string, unknown>;
  for (const f of REPORT_FLAGS) {
    const v = row[f];
    out[f] = v === 1 || v === true ? true : v === 0 || v === false ? false : undefined;
  }
  return out as unknown as ServiceReport;
}

export async function listReports(siteId?: string): Promise<ServiceReport[]> {
  const db = await getDb();
  const rows = siteId
    ? await db.getAllAsync<Record<string, unknown>>('SELECT * FROM report WHERE siteId = ? ORDER BY serviceDate DESC, createdAt DESC', siteId)
    : await db.getAllAsync<Record<string, unknown>>('SELECT * FROM report ORDER BY serviceDate DESC, createdAt DESC');
  return rows.map(hydrateReport);
}

export async function getReport(id: string): Promise<ServiceReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM report WHERE id = ?', id);
  return row ? hydrateReport(row) : null;
}

export async function createReport(input: Omit<ServiceReport, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<ServiceReport> {
  const db = await getDb();
  const r: ServiceReport = { ...input, id: input.id ?? newId(), createdAt: nowIso(), updatedAt: nowIso() };
  await db.runAsync(
    `INSERT INTO report (id,siteId,panelId,title,frequency,serviceDate,technicianName,technicianLicence,
       companyName,witnessName,signatureTechnician,signatureWitness,status,notes,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    r.id, r.siteId, r.panelId ?? null, r.title, r.frequency, r.serviceDate,
    r.technicianName ?? null, r.technicianLicence ?? null, r.companyName ?? null,
    r.witnessName ?? null, r.signatureTechnician ?? null, r.signatureWitness ?? null,
    r.status, r.notes ?? null, r.createdAt, r.updatedAt,
  );
  return r;
}

export async function updateReport(id: string, patch: Partial<ServiceReport>): Promise<void> {
  const db = await getDb();
  const fields = ['title', 'frequency', 'serviceDate', 'technicianName', 'technicianLicence', 'companyName',
    'witnessName', 'signatureTechnician', 'signatureWitness', 'status', 'notes'] as const;
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const f of fields) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  for (const f of REPORT_FLAGS) {
    // A key present with undefined clears the answer; a key absent leaves it alone.
    if (f in patch) { sets.push(`${f} = ?`); vals.push(patch[f] === true ? 1 : patch[f] === false ? 0 : null); }
  }
  if (!sets.length) return;
  sets.push('updatedAt = ?');
  vals.push(nowIso());
  await db.runAsync(`UPDATE report SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

export async function deleteReport(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM report WHERE id = ?', id);
}

export async function listTestRows(reportId: string): Promise<TestRow[]> {
  const db = await getDb();
  return db.getAllAsync<TestRow>('SELECT * FROM test_row WHERE reportId = ? ORDER BY sortIndex, id', reportId);
}

/** "Add every device to the test sheet" — the one-tap action techs actually want. */
export async function addPointsToReport(reportId: string, points: Point[]): Promise<number> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM test_row WHERE reportId = ?', reportId);
  let idx = existing?.n ?? 0;

  const rows: SqlValue[][] = points.map((p) => [
    newId(), reportId, p.id, p.pointRef ?? null, p.loopNumber ?? null, p.address ?? null,
    p.zoneNumber ?? null, p.zoneText ?? null, p.text, p.deviceType, 'untested', null, null, null, idx++,
  ]);

  await db.withTransactionAsync(async () => {
    await insertMany(db, 'test_row',
      ['id', 'reportId', 'pointId', 'pointRef', 'loopNumber', 'address', 'zoneNumber', 'zoneText',
        'deviceText', 'deviceType', 'result', 'method', 'comment', 'testedAt', 'sortIndex'],
      rows);
  });
  return rows.length;
}

export async function setTestResult(rowId: string, result: TestRow['result'], comment?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE test_row SET result = ?, testedAt = ?, comment = COALESCE(?, comment) WHERE id = ?',
    result, result === 'untested' ? null : nowIso(), comment ?? null, rowId,
  );
}

export async function updateTestRow(rowId: string, patch: Partial<TestRow>): Promise<void> {
  const db = await getDb();
  const fields = ['deviceText', 'method', 'comment', 'result', 'zoneText'] as const;
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const f of fields) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  if (!sets.length) return;
  await db.runAsync(`UPDATE test_row SET ${sets.join(', ')} WHERE id = ?`, ...vals, rowId);
}

export async function deleteTestRow(rowId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM test_row WHERE id = ?', rowId);
}

export async function listCheckRows(reportId: string): Promise<CheckRow[]> {
  const db = await getDb();
  return db.getAllAsync<CheckRow>('SELECT * FROM check_row WHERE reportId = ? ORDER BY sortIndex, id', reportId);
}

export async function addCheckRows(reportId: string, rows: Omit<CheckRow, 'id' | 'reportId'>[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await insertMany(db, 'check_row', ['id', 'reportId', 'section', 'label', 'result', 'value', 'unit', 'comment', 'sortIndex'],
      rows.map((r) => [newId(), reportId, r.section, r.label, r.result, r.value ?? null, r.unit ?? null, r.comment ?? null, r.sortIndex]));
  });
}

export async function updateCheckRow(id: string, patch: Partial<CheckRow>): Promise<void> {
  const db = await getDb();
  const fields = ['result', 'value', 'unit', 'comment'] as const;
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const f of fields) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  if (!sets.length) return;
  await db.runAsync(`UPDATE check_row SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

// ---------------------------------------------------------------------------
// Defects
// ---------------------------------------------------------------------------

export async function listDefects(siteId?: string, status?: Defect['status']): Promise<Defect[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: SqlValue[] = [];
  if (siteId) { where.push('siteId = ?'); args.push(siteId); }
  if (status) { where.push('status = ?'); args.push(status); }
  const rows = await db.getAllAsync<Omit<Defect, 'photos'> & { photos: string }>(
    `SELECT * FROM defect ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY
      CASE severity WHEN 'critical' THEN 0 ELSE 1 END, raisedAt DESC`,
    ...args,
  );
  return rows.map((r) => ({
    ...r,
    photos: safeParseArray(r.photos),
    qldLimbInoperable: (r as unknown as { qldLimbInoperable?: number }).qldLimbInoperable === 1,
    qldLimbAdverseImpact: (r as unknown as { qldLimbAdverseImpact?: number }).qldLimbAdverseImpact === 1,
  }));
}

/** One defect by id, read the same way listDefects reads them. */
export async function getDefect(id: string): Promise<Defect | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Omit<Defect, 'photos'> & { photos: string }>('SELECT * FROM defect WHERE id = ?', id);
  if (!r) return null;
  return {
    ...r,
    photos: safeParseArray(r.photos),
    qldLimbInoperable: (r as unknown as { qldLimbInoperable?: number }).qldLimbInoperable === 1,
    qldLimbAdverseImpact: (r as unknown as { qldLimbAdverseImpact?: number }).qldLimbAdverseImpact === 1,
  };
}

/**
 * Puts a rectified defect back to open and clears the rectification date.
 *
 * Its own statement because updateDefect skips a field set to undefined, so
 * there is otherwise no way to take a date off a defect once it is on.
 */
export async function reopenDefect(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE defect SET status = 'open', rectifiedAt = NULL WHERE id = ?", id);
}

/**
 * Critical defects whose statutory notice has not been issued.
 *
 * The 24 hour clock runs from the maintenance, so this is what has to be dealt
 * with before the end of the day rather than at the next visit.
 */
export async function defectsAwaitingNotice(): Promise<Defect[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Defect, 'photos'> & { photos: string }>(
    `SELECT * FROM defect
     WHERE severity = 'critical' AND noticeIssuedAt IS NULL AND status = 'open'
     ORDER BY raisedAt`,
  );
  return rows.map((r) => ({ ...r, photos: safeParseArray(r.photos) }));
}

export async function createDefect(input: Omit<Defect, 'id' | 'raisedAt'> & { id?: string; raisedAt?: string }): Promise<Defect> {
  const db = await getDb();
  const d: Defect = { ...input, id: input.id ?? newId(), raisedAt: input.raisedAt ?? nowIso() };
  // The statutory columns go in with the row. They were returned on the record
  // and never inserted, so a defect raised as critical with both Queensland
  // limbs ticked was stored as non-critical with neither — and the notice is
  // built from the row, not from what the screen returned.
  await db.runAsync(
    `INSERT INTO defect (id,siteId,reportId,pointId,location,description,severity,status,raisedAt,rectifiedAt,photos,notes,
       defectCode,as1851Class,qldLimbInoperable,qldLimbAdverseImpact,noticeIssuedAt,noticeRecipient,
       verbalNotifiedAt,verbalNotifiedTo,rectificationDueAt,interimMeasures,extentOfImpairment)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    d.id, d.siteId, d.reportId ?? null, d.pointId ?? null, d.location, d.description,
    d.severity, d.status, d.raisedAt, d.rectifiedAt ?? null, JSON.stringify(d.photos ?? []), d.notes ?? null,
    d.defectCode ?? null, d.as1851Class ?? 'non-critical', fromBool(d.qldLimbInoperable), fromBool(d.qldLimbAdverseImpact),
    d.noticeIssuedAt ?? null, d.noticeRecipient ?? null, d.verbalNotifiedAt ?? null, d.verbalNotifiedTo ?? null,
    d.rectificationDueAt ?? null, d.interimMeasures ?? null, d.extentOfImpairment ?? null,
  );
  return d;
}

export async function updateDefect(id: string, patch: Partial<Defect>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const f of ['location', 'description', 'severity', 'status', 'rectifiedAt', 'notes',
    'defectCode', 'as1851Class', 'noticeIssuedAt', 'noticeRecipient', 'verbalNotifiedAt',
    'verbalNotifiedTo', 'rectificationDueAt', 'interimMeasures', 'extentOfImpairment'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push((patch[f] as string | undefined) ?? null); }
  }
  if (patch.photos !== undefined) { sets.push('photos = ?'); vals.push(JSON.stringify(patch.photos)); }
  for (const f of ['qldLimbInoperable', 'qldLimbAdverseImpact'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); vals.push(patch[f] ? 1 : 0); }
  }
  if (!sets.length) return;
  await db.runAsync(`UPDATE defect SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

export async function deleteDefect(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM defect WHERE id = ?', id);
}

function safeParseArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cause & effect
// ---------------------------------------------------------------------------

export async function listCauseEffect(panelId: string): Promise<CauseEffectRule[]> {
  const db = await getDb();
  const rules = await db.getAllAsync<Omit<CauseEffectRule, 'effects'>>(
    'SELECT * FROM ce_rule WHERE panelId = ? ORDER BY causeZoneNumber, causeLabel', panelId,
  );
  const out: CauseEffectRule[] = [];
  for (const r of rules) {
    const effects = await db.getAllAsync<CauseEffect>('SELECT * FROM ce_effect WHERE ruleId = ? ORDER BY effectLabel', r.id);
    out.push({ ...r, effects });
  }
  return out;
}

export async function createCauseEffectRule(
  panelId: string,
  rule: Omit<CauseEffectRule, 'id' | 'panelId'>,
): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    `INSERT INTO ce_rule (id,panelId,causeLabel,causeKind,causeZoneNumber,causePointRef,sourceLogic,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, panelId, rule.causeLabel, rule.causeKind, rule.causeZoneNumber ?? null,
    rule.causePointRef ?? null, rule.sourceLogic ?? null, rule.notes ?? null,
  );
  for (const e of rule.effects) {
    await db.runAsync(
      'INSERT INTO ce_effect (id,ruleId,effectLabel,effectKind,delaySeconds,state) VALUES (?,?,?,?,?,?)',
      newId(), id, e.effectLabel, e.effectKind, e.delaySeconds ?? null, e.state,
    );
  }
  return id;
}

export async function deleteCauseEffectRule(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM ce_rule WHERE id = ?', id);
}
