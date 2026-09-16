import type { SimproMirror, SimproSiteDetail } from '@/simpro/mirrorResources';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
// The note is pure, but the module it lives in is the whole sync, and the
// sync's graph reaches the phone's file system and image tools.
jest.mock('@/simpro/attachmentFiles', () => ({
  readAttachmentBytes: jest.fn(), shrinkIfNeeded: jest.fn(), photosWithSizes: jest.fn(async () => []),
}));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));

/**
 * What the sync says about assets whose building it does not hold.
 *
 * The note used to read "their Simpro site is not held on this device. Pull
 * sites first, or run a forced sync." Every word of that advice is wrong on
 * the case it actually fires for. On the office build the whole of it is one
 * archived site carrying fifteen assets: the sites endpoint does not return
 * an archived site, the assets endpoint returns its assets regardless, and no
 * amount of pulling again changes either fact. Somebody following the advice
 * spends twelve minutes on a sync and sees the same fifteen skipped.
 *
 * So the note names the building and says why. The names below are invented;
 * the shape of the case is the real one.
 */

const site = (over: Partial<SimproSiteDetail>): SimproSiteDetail => ({
  id: '1708',
  name: 'Notting Hill Terraces Body Corporate',
  customers: [],
  archived: false,
  ...over,
});

const mirrorOf = (byId: Record<string, SimproSiteDetail | Error>): Pick<SimproMirror, 'siteDetail'> => ({
  siteDetail: jest.fn(async (id: string) => {
    const found = byId[id];
    if (!found) throw new Error(`no site ${id}`);
    if (found instanceof Error) throw found;
    return found;
  }),
}) as unknown as Pick<SimproMirror, 'siteDetail'>;

describe('naming the buildings whose assets were skipped', () => {
  const describeMissingSites = async (
    mirror: Pick<SimproMirror, 'siteDetail'>,
    ids: string[],
  ): Promise<string> => {
    const mod = await import('@/simpro/sync');
    return mod.describeMissingSites(mirror, new Set(ids));
  };

  it('says an archived site is archived, which is the whole answer', () => {
    return expect(describeMissingSites(
      mirrorOf({ 1708: site({ archived: true }) }),
      ['1708'],
    )).resolves.toBe('Notting Hill Terraces Body Corporate is archived in Simpro, so it is not on the site list.');
  });

  it('says a live site is a real gap rather than blaming the archive', () => {
    // The one case worth acting on: the office has the building, the sync
    // read the sites, and it still is not here.
    return expect(describeMissingSites(
      mirrorOf({ 1708: site({ archived: false }) }),
      ['1708'],
    )).resolves.toContain('did not come down with the sites');
  });

  it('names several, separated so they can be read', async () => {
    const said = await describeMissingSites(
      mirrorOf({
        1708: site({ id: '1708', name: 'Notting Hill Terraces', archived: true }),
        1899: site({ id: '1899', name: 'Kelvin Grove Chambers', archived: true }),
      }),
      ['1708', '1899'],
    );
    expect(said).toContain('Notting Hill Terraces is archived');
    expect(said).toContain('Kelvin Grove Chambers is archived');
    expect(said.split(';')).toHaveLength(2);
  });

  it('stops naming after five and counts the rest', async () => {
    // A sync that skipped a thousand assets across two hundred sites must
    // not put two hundred building names into one line on a phone.
    const many = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [String(i), site({ id: String(i), name: `Site ${i}`, archived: true })]),
    );
    const said = await describeMissingSites(mirrorOf(many), Object.keys(many));
    expect(said).toContain('Site 4 is archived');
    expect(said).not.toContain('Site 5 is archived');
    expect(said).toContain('and 3 more');
  });

  it('reports a site it could not read as its id, rather than guessing', async () => {
    // A key without access to a site, or a dropped connection. Saying
    // "archived" here would be inventing the reason.
    const said = await describeMissingSites(mirrorOf({ 1708: new Error('403') }), ['1708']);
    expect(said).toBe('site 1708 could not be read.');
  });

  it('does not let one unreadable site hide the ones it could read', async () => {
    const said = await describeMissingSites(
      mirrorOf({ 1708: new Error('403'), 1899: site({ id: '1899', name: 'Kelvin Grove', archived: true }) }),
      ['1708', '1899'],
    );
    expect(said).toContain('site 1708 could not be read');
    expect(said).toContain('Kelvin Grove is archived');
  });
});
