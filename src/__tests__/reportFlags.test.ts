import { createReport, createSite, getReport, listReports, updateReport } from '@/db/repo';
import type { ServiceReport } from '@/domain/types';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The three record-of-maintenance answers.
 *
 * They were asked on the screen, printed on the PDF, and never saved, so a
 * PDF made on a later visit printed them unanswered. The third state for
 * "in proper working order" — not answered — is a real answer and must
 * survive the round trip as absent, never as no and never as yes.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

async function fresh(): Promise<ServiceReport> {
  const site = await createSite({ name: 'Test site' });
  return createReport({
    siteId: site.id,
    title: 'Annual',
    frequency: 'annual' as unknown as ServiceReport['frequency'],
    serviceDate: '2026-09-02',
    status: 'draft',
  });
}

describe('the record-of-maintenance answers', () => {
  it('start unanswered', async () => {
    const r = await fresh();
    const back = await getReport(r.id);
    expect({ q: back?.qdcCompliance, w: back?.inProperWorkingOrder, h: back?.hardcopyLeftOnSite })
      .toEqual({ q: undefined, w: undefined, h: undefined });
  });

  it('survive a save and a reload, false as false and not as absent', async () => {
    const r = await fresh();
    await updateReport(r.id, { qdcCompliance: true, inProperWorkingOrder: false, hardcopyLeftOnSite: true });
    const back = await getReport(r.id);
    expect({ q: back?.qdcCompliance, w: back?.inProperWorkingOrder, h: back?.hardcopyLeftOnSite })
      .toEqual({ q: true, w: false, h: true });
    expect((await listReports(r.siteId))[0]?.inProperWorkingOrder).toBe(false);
  });

  it('can be put back to unanswered', async () => {
    const r = await fresh();
    await updateReport(r.id, { inProperWorkingOrder: true });
    await updateReport(r.id, { inProperWorkingOrder: undefined });
    expect((await getReport(r.id))?.inProperWorkingOrder).toBeUndefined();
  });

  it('are left alone by a save that does not mention them', async () => {
    const r = await fresh();
    await updateReport(r.id, { qdcCompliance: true });
    await updateReport(r.id, { notes: 'unrelated' });
    expect((await getReport(r.id))?.qdcCompliance).toBe(true);
  });
});
