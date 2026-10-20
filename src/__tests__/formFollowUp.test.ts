import { createForm72, listForm72ToFollowUp } from '@/db/form72Repo';
import { createSite, updateSite } from '@/db/repo';
import {
  copyState, followUpGroups, followUpMatches, type FollowUpForm,
} from '@/domain/formFollowUp';
import { occupierCopyDueBy } from '@/export/form72';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * The cross-site Form 72 list: what is left to do, in the order to do it.
 *
 * Drafts, then issued forms whose occupier copy is owed with the day it falls
 * due, then the settled ones. The due day is the form's own count, so the list
 * cannot give a different date from the form.
 */

describe('where a form stands', () => {
  const today = '2026-07-20';

  it('is a draft until it is issued, whatever else is on it', () => {
    expect(copyState({ status: 'draft', testDate: '2026-07-03' }, today)).toEqual({ kind: 'draft' });
  });

  it('is settled once the occupier has their copy', () => {
    expect(copyState({ status: 'issued', testDate: '2026-07-03', copyGivenAt: '2026-07-10' }, today))
      .toEqual({ kind: 'given', on: '2026-07-10' });
  });

  it('gives the due date the form itself gives', () => {
    const by = occupierCopyDueBy('2026-07-10');
    expect(by).toBeDefined();
    expect(copyState({ status: 'issued', testDate: '2026-07-10' }, today)).toEqual({ kind: 'due', by });
  });

  it('is still due on the day itself and late from the day after', () => {
    // 3 July 2026 + 10 business days = 17 July (form72.test.ts).
    const form: FollowUpForm = { status: 'issued', testDate: '2026-07-03' };
    expect(copyState(form, '2026-07-17')).toEqual({ kind: 'due', by: '2026-07-17' });
    expect(copyState(form, '2026-07-18')).toEqual({ kind: 'late', by: '2026-07-17' });
  });

  it('never reads a copy with no countable date as having no deadline', () => {
    expect(copyState({ status: 'issued' }, today)).toEqual({ kind: 'uncounted' });
  });
});

describe('the three sections', () => {
  it('splits by state and keeps the order the forms came in', () => {
    const forms = [
      { id: 'd1', status: 'draft' as const },
      { id: 'o1', status: 'issued' as const, testDate: '2026-07-01' },
      { id: 'd2', status: 'draft' as const },
      { id: 's1', status: 'issued' as const, testDate: '2026-06-01', copyGivenAt: '2026-06-05' },
      { id: 'o2', status: 'issued' as const },
    ];
    const g = followUpGroups(forms);
    expect(g.drafts.map((f) => f.id)).toEqual(['d1', 'd2']);
    expect(g.owed.map((f) => f.id)).toEqual(['o1', 'o2']);
    expect(g.settled.map((f) => f.id)).toEqual(['s1']);
  });
});

describe('listForm72ToFollowUp', () => {
  let db: NodeSqliteDb;

  beforeEach(async () => {
    db = openMigrated();
    await createSite({ id: 'sa', name: 'Fictional Tower', address: '1 Main St' });
    await createSite({ id: 'sb', name: 'Example House', address: '9 Main St' });
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  const form = async (
    siteId: string, testDate: string | undefined,
    state: { status?: 'draft' | 'issued'; copyGivenAt?: string; updatedAt?: string } = {},
  ) => {
    const rec = await createForm72({ siteId, siteName: siteId === 'sa' ? 'Fictional Tower' : 'Example House', testDate, jobExternalId: '9001' });
    // Straight to the state under test; the issue rules have their own tests.
    await db.runAsync(
      'UPDATE form_72 SET status = ?, copyGivenAt = ?, updatedAt = COALESCE(?, updatedAt) WHERE id = ?',
      state.status ?? 'draft', state.copyGivenAt ?? null, state.updatedAt ?? null, rec.id,
    );
    return rec.id;
  };

  it('puts drafts first, then copies owed soonest due, then the rest newest first, across sites', async () => {
    const settledOld = await form('sa', '2025-03-01', { status: 'issued', copyGivenAt: '2025-03-05' });
    const owedLater = await form('sb', '2026-09-01', { status: 'issued' });
    const draftOld = await form('sa', '2026-09-20', { updatedAt: '2026-09-20T00:00:00.000Z' });
    const owedSooner = await form('sa', '2026-08-01', { status: 'issued' });
    const settledNew = await form('sb', '2026-06-01', { status: 'issued', copyGivenAt: '2026-06-03' });
    const draftNew = await form('sb', undefined, { updatedAt: '2026-10-01T00:00:00.000Z' });
    const owedUndated = await form('sb', undefined, { status: 'issued' });

    const ids = (await listForm72ToFollowUp()).map((f) => f.id);
    expect(ids).toEqual([
      draftNew, draftOld,
      // No test date leads: nobody can say when that copy is due.
      owedUndated, owedSooner, owedLater,
      settledNew, settledOld,
    ]);
  });

  it('reads whole forms, so a row can show its site and its job', async () => {
    await form('sa', '2026-08-01', { status: 'issued' });
    const [only] = await listForm72ToFollowUp();
    expect(only).toMatchObject({ siteName: 'Fictional Tower', jobExternalId: '9001', status: 'issued' });
  });

  it('writes nothing', async () => {
    await form('sa', '2026-08-01');
    const before = db.statements.length;
    await listForm72ToFollowUp();
    const ran = db.statements.slice(before).map((s) => s.sql.trim().split(/\s+/)[0]!.toUpperCase());
    expect(ran.every((verb) => verb === 'SELECT')).toBe(true);
  });
});

describe('the search box finds the building the way every module does', () => {
  /*
   * It matched only what is written on the form: the name and address it was
   * raised under, the system and the job. The client, the office's site number
   * and the postcode are not on a form at all, a form started from a job can
   * carry the street alone, and a building renamed since was findable only by
   * its old name. So "Pelham" or "8812" read out over the phone said "No form
   * matches that" about a form sitting on the phone.
   */
  let db: NodeSqliteDb;

  beforeEach(async () => {
    db = openMigrated();
    await createSite({
      id: 'tower', name: 'Barren Heights Tower', address: '14 Markwell Street', suburb: 'Spring Hill',
      state: 'QLD', postcode: '4000', clientName: 'Pelham Strata Management', siteRef: 'SIMPRO:8812',
      externalId: '8812', externalSource: 'simpro',
    });
    await createSite({
      id: 'other', name: 'Kingaroy Fire Station', suburb: 'Kingaroy', postcode: '4610',
      clientName: 'Another Body Corporate', siteRef: 'SIMPRO:4471', externalId: '4471',
      externalSource: 'simpro',
    });
    // The street alone, as a job that only knew the street fills it.
    await createForm72({ siteId: 'tower', siteName: 'Barren Heights Tower', siteAddress: '14 Markwell Street' });
    await createForm72({ siteId: 'other', siteName: 'Kingaroy Fire Station' });
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  const ask = async (q: string) => (await listForm72ToFollowUp())
    .filter((f) => followUpMatches(f, q))
    .map((f) => f.siteId);

  it.each([
    ['the name', 'Barren Heights'],
    ['part of the name, half remembered', 'arren'],
    ['the address', 'Markwell'],
    ['the suburb', 'Spring Hill'],
    ['the postcode', '4000'],
    ['the client', 'Pelham'],
    ['the office’s site number', '8812'],
    ['words in any order', 'tower barren'],
  ])('by %s', async (_what, q) => {
    expect({ q, found: await ask(q) }).toEqual({ q, found: ['tower'] });
  });

  it('answers with the other building for the other building, and nothing for neither', async () => {
    expect(await ask('Kingaroy')).toEqual(['other']);
    expect(await ask('Woolloongabba')).toEqual([]);
  });

  it('by the name the building has now, not only the one on the form', async () => {
    await updateSite('tower', { name: 'Spring Hill Central' });
    expect(await ask('Central')).toEqual(['tower']);
  });

  it('still finds a form whose site row is gone, by what the form says', () => {
    expect(followUpMatches({ siteName: 'Barren Heights Tower' }, 'barren')).toBe(true);
    expect(followUpMatches({ siteName: 'Barren Heights Tower' }, 'pelham')).toBe(false);
    expect(followUpMatches({ siteName: 'Barren Heights Tower' }, '   ')).toBe(true);
  });
});
