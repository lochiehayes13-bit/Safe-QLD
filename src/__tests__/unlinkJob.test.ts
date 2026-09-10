import { createImpairment, getImpairment, updateImpairment, upsertJob } from '@/db/opsRepo';
import { createReport, getReport, updateReport, createSite } from '@/db/repo';
import { createAssessment, getAssessment, updateAssessment } from '@/db/assessmentRepo';
import { createQuote, getQuote, updateQuote } from '@/db/quoteRepo';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
jest.mock('@/simpro/flushSoon', () => ({ flushSoon: jest.fn() }));

/**
 * Taking a record back off a Simpro job.
 *
 * Every screen that carries JobFileCard hands its Unlink through the same
 * shape: `onPickJob(null)`, which the screen turns into
 * `{ jobExternalId: job?.externalId }` — a key that is present, holding
 * undefined. That is the only way a screen can say "clear this".
 *
 * Four of these repositories skipped it. Their update loops guarded on
 * `patch[f] !== undefined`, which cannot tell "the caller did not mention this
 * field" from "the caller wants this field emptied" — so the UPDATE simply
 * left the column alone and the record stayed on the job.
 *
 * What makes it worse than a no-op is that the screen believes it worked.
 * useRecordPatch puts the cleared record on screen the moment it is asked to,
 * so the card shows unlinked, the technician moves on, and the link comes back
 * the next time the record is opened.
 *
 * `f in patch` is the distinction, and updateReport already used it for the
 * record-of-maintenance flags with a comment saying exactly why — the text
 * loop beside it simply never had a clearable column until now.
 */

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

/** What every screen sends when somebody presses Unlink. */
const unlinked = { jobExternalId: undefined, jobTitle: undefined };

describe('an impairment taken off its job', () => {
  it('clears the job, rather than quietly staying on it', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const rec = await createImpairment({ siteId: site.id, system: 'Sprinkler system' });
    await updateImpairment(rec.id, { jobExternalId: '21456', jobTitle: 'Annual routine' });
    expect((await getImpairment(rec.id))?.jobExternalId).toBe('21456');

    await updateImpairment(rec.id, unlinked);
    const back = await getImpairment(rec.id);
    expect(back?.jobExternalId).toBeFalsy();
    expect(back?.jobTitle).toBeFalsy();
  });

  it('still leaves a field alone when the caller does not mention it', async () => {
    // The other half. A patch that says nothing about the notes must not
    // empty them, or every edit to one field wipes the rest.
    const site = await createSite({ name: 'Fictional Tower' });
    const rec = await createImpairment({ siteId: site.id, system: 'Sprinkler system' });
    await updateImpairment(rec.id, { notes: 'Valve strapped shut', jobExternalId: '21456' });
    await updateImpairment(rec.id, { jobExternalId: undefined });

    const back = await getImpairment(rec.id);
    expect(back?.notes).toBe('Valve strapped shut');
    expect(back?.jobExternalId).toBeFalsy();
  });
});

describe('a service report taken off its job', () => {
  it('clears the job', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const r = await createReport({ siteId: site.id, title: 'Annual', frequency: 'annual', serviceDate: '2026-09-10', status: 'draft' } as never);
    await updateReport(r.id, { jobExternalId: '21456', jobTitle: 'Annual routine' });
    expect((await getReport(r.id))?.jobExternalId).toBe('21456');

    await updateReport(r.id, unlinked);
    const back = await getReport(r.id);
    expect(back?.jobExternalId).toBeFalsy();
    expect(back?.jobTitle).toBeFalsy();
  });

  it('leaves the technician name alone when the patch does not mention it', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const r = await createReport({ siteId: site.id, title: 'Annual', frequency: 'annual', serviceDate: '2026-09-10', status: 'draft' } as never);
    await updateReport(r.id, { technicianName: 'Sam', jobExternalId: '21456' });
    await updateReport(r.id, { jobExternalId: undefined });

    expect((await getReport(r.id))?.technicianName).toBe('Sam');
  });
});

describe('an effectiveness report taken off its job', () => {
  it('clears the job', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    const a = await createAssessment({ siteId: site.id });
    await updateAssessment(a.id, { jobExternalId: '21456', jobTitle: 'Annual routine' });
    expect((await getAssessment(a.id))?.jobExternalId).toBe('21456');

    await updateAssessment(a.id, unlinked);
    const back = await getAssessment(a.id);
    expect(back?.jobExternalId).toBeFalsy();
    expect(back?.jobTitle).toBeFalsy();
  });
});

describe('a quotation taken off its job', () => {
  it('clears the job while it is still a draft', async () => {
    const site = await createSite({ name: 'Fictional Tower' });
    await upsertJob({ externalId: '21456', siteId: site.id, siteName: site.name, title: 'Annual', status: 'scheduled' });
    const q = await createQuote({ siteId: site.id, siteName: site.name });
    await updateQuote(q.id, { jobReference: '21456' });
    expect((await getQuote(q.id))?.jobReference).toBe('21456');

    await updateQuote(q.id, { jobReference: undefined });
    expect((await getQuote(q.id))?.jobReference).toBeFalsy();
  });
});
