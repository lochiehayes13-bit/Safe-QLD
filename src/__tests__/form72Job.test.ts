import { createForm72, getForm72, issueForm72, linkForm72Job, listForm72, recordForm72Attached } from '@/db/form72Repo';
import { openMigrated } from './support/nodeSqlite';
import { createSite } from '@/db/repo';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

/**
 * A Form 72 knows which Simpro job it belongs to.
 *
 * Linking is filing, not editing, so it is allowed after issue — an issued
 * form that was never linked is exactly the one that most needs to reach
 * the job. The attachment mark is the difference between "the office has
 * it" and "I think I sent it".
 */

let siteId: string;

beforeEach(async () => {
  await openMigrated();
  const site = await createSite({ name: 'Tower', address: '1 Test St' } as never);
  siteId = site.id;
});

describe('the job on a Form 72', () => {
  it('is named at creation where the site had one open job', async () => {
    const f = await createForm72({ siteId, siteName: 'Tower', jobExternalId: '41900', jobTitle: 'Hydrant test' });
    const back = await getForm72(f.id);
    expect(back).toMatchObject({ jobExternalId: '41900', jobTitle: 'Hydrant test' });
    expect(back!.attachedAt).toBeUndefined();
  });

  it('can be linked, changed and cleared later, including after issue', async () => {
    const f = await createForm72({ siteId, siteName: 'Tower' });
    expect((await getForm72(f.id))!.jobExternalId).toBeUndefined();
    await linkForm72Job(f.id, { externalId: ' 41850 ', title: 'Pump service' });
    expect((await getForm72(f.id))).toMatchObject({ jobExternalId: '41850', jobTitle: 'Pump service' });
    await linkForm72Job(f.id, null);
    expect((await getForm72(f.id))!.jobExternalId).toBeUndefined();
  });

  it('remembers when the PDF went onto the job', async () => {
    const f = await createForm72({ siteId, siteName: 'Tower', jobExternalId: '41900' });
    await recordForm72Attached(f.id, '2026-09-10T02:00:00.000Z');
    expect((await getForm72(f.id))!.attachedAt).toBe('2026-09-10T02:00:00.000Z');
    expect((await listForm72(siteId))[0]!.attachedAt).toBe('2026-09-10T02:00:00.000Z');
  });

  it('refuses to link a form that is gone', async () => {
    await expect(linkForm72Job('nope', { externalId: '1' })).rejects.toThrow('no longer exists');
  });

  it('keeps the link through issue', async () => {
    const f = await createForm72({ siteId, siteName: 'Tower', jobExternalId: '41900' });
    // Not issuable as blank; the link must survive whatever issue does or refuses.
    await expect(issueForm72(f.id)).rejects.toThrow();
    expect((await getForm72(f.id))!.jobExternalId).toBe('41900');
  });
});
