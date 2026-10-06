import { createImpairment, getImpairment, updateImpairment, upsertJob } from '@/db/opsRepo';
import { createReport, getReport, updateReport, createSite } from '@/db/repo';
import { createAssessment, getAssessment, updateAssessment } from '@/db/assessmentRepo';
import { createQuote, getQuote, updateQuote } from '@/db/quoteRepo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The "Sent" stamp belongs to the job it was sent to.
 *
 * Filing a document records when it went. Changing the job afterwards left
 * that stamp in place, so the card showed a green "Sent on the 3rd" against a
 * job the file had never reached — the precise claim this card exists to make
 * truthfully, made falsely. JobFileCard clears it on any job change now, which
 * only works because a patch carrying undefined actually clears the column.
 */
describe('changing the job a document was filed on', () => {
  it('clears when it went, on every record that carries the card', async () => {
    const site = await createSite({ name: 'Fictional Tower' });

    const rec = await createImpairment({ siteId: site.id, system: 'Sprinkler system' });
    await updateImpairment(rec.id, { jobExternalId: '21456', attachedAt: '2026-09-03T00:00:00.000Z' });
    await updateImpairment(rec.id, { jobExternalId: '21999', jobTitle: 'Other job', attachedAt: undefined });
    const imp = await getImpairment(rec.id);
    expect(imp?.jobExternalId).toBe('21999');
    expect(imp?.attachedAt).toBeFalsy();

    const r = await createReport({ siteId: site.id, title: 'Annual', frequency: 'annual', serviceDate: '2026-09-10', status: 'draft' } as never);
    await updateReport(r.id, { jobExternalId: '21456', attachedAt: '2026-09-03T00:00:00.000Z' });
    await updateReport(r.id, { jobExternalId: '21999', attachedAt: undefined });
    const rep = await getReport(r.id);
    expect(rep?.jobExternalId).toBe('21999');
    expect(rep?.attachedAt).toBeFalsy();

    const a = await createAssessment({ siteId: site.id });
    await updateAssessment(a.id, { jobExternalId: '21456', attachedAt: '2026-09-03T00:00:00.000Z' });
    await updateAssessment(a.id, { jobExternalId: '21999', attachedAt: undefined });
    const ass = await getAssessment(a.id);
    expect(ass?.jobExternalId).toBe('21999');
    expect(ass?.attachedAt).toBeFalsy();
  });

  it('is the card that decides it, not each screen remembering', () => {
    /*
     * Six screens carry this card. Six handlers each remembering to clear the
     * stamp is six chances to forget, and the seventh screen will. The rule
     * lives in the card, and this is the check that it stays there.
     */
    const card = readFileSync(join(__dirname, '..', 'components', 'JobFileCard.tsx'), 'utf8');
    expect(card).toMatch(/onAttached\(undefined\)/);
  });

  it('and both routes out of the picker go through the one place that holds it', () => {
    /*
     * This used to count two `onAttached(undefined)` calls, one per route, and
     * passed because the rule was written twice. Converting the card to the
     * shared job picker collapsed them onto one `take`, and a test counting
     * copies called that a regression — so it asserts the property instead:
     * choosing a different job and Unlink both go through the single function,
     * and that function is the one carrying the rule.
     */
    const card = readFileSync(join(__dirname, '..', 'components', 'JobFileCard.tsx'), 'utf8');
    const take = /const take = \([\s\S]*?\n  \};/.exec(card)?.[0] ?? '';
    expect(take).toContain('onPickJob(picked)');
    expect(take).toContain('onAttached(undefined)');
    expect(take).toContain('setPicking(false)');

    // Choosing a job, and Unlink. Both hand their answer to `take` and neither
    // writes the job or the stamp itself.
    expect(card).toMatch(/onPick=\{\(job\) => take\(/);
    expect(card).toMatch(/title="Unlink"[\s\S]{0,160}onPress=\{\(\) => take\(null\)\}/);
    expect([...card.matchAll(/onAttached\(undefined\)/g)]).toHaveLength(1);
    expect([...card.matchAll(/onPickJob\(/g)]).toHaveLength(1);
  });
});
